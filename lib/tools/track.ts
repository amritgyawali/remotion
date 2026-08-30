'use client'

/**
 * Auto-reframe: turning a wide shot into a vertical one without losing the
 * person it is about.
 *
 * A centred 9:16 crop of a 16:9 interview throws away three-quarters of the
 * width and, more often than not, half the speaker with it. What is actually
 * wanted is a crop window that *follows* the subject - which is a tracking
 * problem, and the studio already has the two things it needs to solve it:
 * a person segmenter, and a per-frame crop offset in the render loop.
 *
 * The method:
 *
 *   1. **Sample.** The clip is decoded once at a low resolution and a low
 *      rate - a handful of frames a second is plenty, since a subject cannot
 *      cross a frame in a tenth of a second - and the segmenter is run on each
 *      sample to get the subject's centre of mass.
 *   2. **Fall back when there is no person.** If the mask is empty (a product
 *      shot, a screen recording, a landscape), the centroid of frame-to-frame
 *      *change* is used instead. That is what "the interesting part of the
 *      picture" means when there is nobody in it, and it keeps the tool useful
 *      on footage the segmenter was never going to help with.
 *   3. **Smooth, then dead-band.** The raw path is low-passed, and then any
 *      movement below a threshold is discarded entirely. The dead band is the
 *      important half: a smoothed path still drifts constantly, and a crop
 *      that never stops moving reads as a mistake. Real camera operators hold,
 *      then move, then hold.
 *   4. **Clamp.** The window is kept inside the source frame at all times, so
 *      no output frame can ever contain an edge that was not in the original.
 */

import { centeredAspectCrop, type CropRect } from './frame-ops'
import { createPersonSegmenter, SegmentationUnavailableError, type SegmentationModelId, type SegmentationProgress } from './segmentation'

export type TrackPlan = {
	crop: CropRect
	/** one entry per output frame, in source pixels */
	offsets: Array<{ dx: number; dy: number }>
	/** what the analysis actually managed to follow, for the result note */
	summary: string
}

export type TrackOptions = {
	source: Blob
	/** the aspect the crop window is cut to */
	aspectW: number
	aspectH: number
	fps: number
	/** 0-1; higher holds the frame longer and moves less */
	steadiness: number
	model: SegmentationModelId
	/** true to skip the model entirely and track motion only */
	motionOnly: boolean
	signal: AbortSignal
	onProgress?: (progress: { phase: string; ratio: number }) => void
	onModelProgress?: (progress: SegmentationProgress) => void
}

/** How often the subject is located. Four times a second is more than enough. */
const SAMPLES_PER_SECOND = 4
/** The width the analysis runs at. The segmenter's own input is smaller than this. */
const ANALYSIS_WIDTH = 256

type Sample = { time: number; x: number; y: number; confident: boolean }

/** Centre of mass of a confidence mask, in 0-1 frame coordinates. */
function maskCentroid(data: Float32Array, width: number, height: number): { x: number; y: number; weight: number } {
	let sumX = 0
	let sumY = 0
	let total = 0
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const value = data[y * width + x]
			if (value <= 0.35) continue
			sumX += x * value
			sumY += y * value
			total += value
		}
	}
	if (total <= 0) return { x: 0.5, y: 0.5, weight: 0 }
	return { x: sumX / total / width, y: sumY / total / height, weight: total / (width * height) }
}

/** Centre of mass of what changed between two grayscale thumbnails. */
function motionCentroid(previous: Uint8ClampedArray, current: Uint8ClampedArray, width: number, height: number): { x: number; y: number; weight: number } {
	let sumX = 0
	let sumY = 0
	let total = 0
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const index = y * width + x
			// The threshold is what stops sensor noise, which is everywhere,
			// from pulling the centroid back to the middle of the frame.
			const delta = Math.abs(current[index] - previous[index])
			if (delta < 12) continue
			sumX += x * delta
			sumY += y * delta
			total += delta
		}
	}
	if (total <= 0) return { x: 0.5, y: 0.5, weight: 0 }
	return { x: sumX / total / width, y: sumY / total / height, weight: total / (width * height * 255) }
}

export async function planAutoReframe(options: TrackOptions): Promise<TrackPlan> {
	const { signal } = options
	if (signal.aborted) throw new DOMException('Aborted', 'AbortError')

	const mediabunny = await import('mediabunny')
	const { ALL_FORMATS, BlobSource, Input, VideoSampleSink } = mediabunny
	const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(options.source) })

	let segmenter: Awaited<ReturnType<typeof createPersonSegmenter>> | null = null
	let segmenterFailed = ''
	if (!options.motionOnly) {
		try {
			segmenter = await createPersonSegmenter({
				modelId: options.model,
				// Tracking wants a stable centroid, not a crisp edge, so the mask is
				// smoothed harder here than the background remover smooths it.
				smoothing: 0.55,
				signal,
				onProgress: options.onModelProgress,
			})
		} catch (error) {
			if (signal.aborted) throw error
			if (!(error instanceof SegmentationUnavailableError)) throw error
			segmenterFailed = error.message
		}
	}

	try {
		const videoTrack = await input.getPrimaryVideoTrack()
		if (!videoTrack) throw new Error('That file has no video track to reframe.')
		const sourceWidth = await videoTrack.getDisplayWidth()
		const sourceHeight = await videoTrack.getDisplayHeight()
		const duration = await input.computeDuration()

		const analysisWidth = Math.min(ANALYSIS_WIDTH, sourceWidth)
		const analysisHeight = Math.max(2, Math.round((sourceHeight / Math.max(1, sourceWidth)) * analysisWidth))
		const canvas = new OffscreenCanvas(analysisWidth, analysisHeight)
		const ctx = canvas.getContext('2d', { willReadFrequently: true })
		if (!ctx) throw new Error('This browser has no 2D canvas context to analyse frames with.')

		const sink = new VideoSampleSink(videoTrack)
		const sampleCount = Math.max(2, Math.ceil(duration * SAMPLES_PER_SECOND))
		const samples: Sample[] = []
		let previousGray: Uint8ClampedArray | null = null
		let personFrames = 0

		for (let i = 0; i < sampleCount; i++) {
			if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
			const time = (i / Math.max(1, sampleCount - 1)) * Math.max(0, duration - 0.05)
			const sample = await sink.getSample(time)
			if (!sample) continue
			ctx.clearRect(0, 0, analysisWidth, analysisHeight)
			sample.draw(ctx, 0, 0, analysisWidth, analysisHeight)
			sample.close()

			let located: { x: number; y: number; weight: number } | null = null
			if (segmenter) {
				// Timestamps must not go backwards for a VIDEO-mode segmenter, and
				// the loop is strictly forward, so passing the sample time directly
				// is safe.
				const mask = segmenter.segment(canvas, time * 1000)
				const centroid = maskCentroid(mask.data, mask.width, mask.height)
				if (centroid.weight > 0.012) {
					located = centroid
					personFrames++
				}
			}

			if (!located) {
				const image = ctx.getImageData(0, 0, analysisWidth, analysisHeight).data
				const gray = new Uint8ClampedArray(analysisWidth * analysisHeight)
				for (let p = 0, g = 0; p < image.length; p += 4, g++) {
					gray[g] = 0.299 * image[p] + 0.587 * image[p + 1] + 0.114 * image[p + 2]
				}
				if (previousGray) {
					const motion = motionCentroid(previousGray, gray, analysisWidth, analysisHeight)
					if (motion.weight > 0.0015) located = motion
				}
				previousGray = gray
			}

			samples.push({
				time,
				x: located?.x ?? 0.5,
				y: located?.y ?? 0.5,
				confident: located !== null,
			})
			options.onProgress?.({ phase: 'finding the subject', ratio: (i + 1) / sampleCount })
		}

		/* ------------------------------------------------ turn samples into a path */

		const crop = centeredAspectCrop(sourceWidth, sourceHeight, options.aspectW, options.aspectH)
		// How far the window can travel before it would show an edge.
		const marginX = (sourceWidth - crop.width) / 2
		const marginY = (sourceHeight - crop.height) / 2
		const frameCount = Math.max(1, Math.round(duration * options.fps))

		if (samples.length === 0) {
			return {
				crop,
				offsets: new Array(frameCount).fill({ dx: 0, dy: 0 }),
				summary: 'nothing could be tracked, so the crop is centred',
			}
		}

		// Samples that found nothing hold the last known position rather than
		// snapping to the middle - a subject who briefly turns away has not
		// moved to the centre of the frame.
		let lastKnown = samples.find((entry) => entry.confident) ?? samples[0]
		const filled = samples.map((entry) => {
			if (entry.confident) {
				lastKnown = entry
				return entry
			}
			return { ...entry, x: lastKnown.x, y: lastKnown.y }
		})

		const steadiness = Math.min(1, Math.max(0, options.steadiness))
		const smoothRadius = Math.max(1, Math.round(filled.length * (0.02 + steadiness * 0.12)))
		const smoothed = filled.map((_, index) => {
			let sumX = 0
			let sumY = 0
			let count = 0
			for (let offset = -smoothRadius; offset <= smoothRadius; offset++) {
				const other = filled[Math.min(filled.length - 1, Math.max(0, index + offset))]
				sumX += other.x
				sumY += other.y
				count++
			}
			return { x: sumX / count, y: sumY / count }
		})

		// The dead band, in fractions of the frame: below this, the window does
		// not move at all. This is what turns a constant drift into a hold.
		const deadBand = 0.01 + steadiness * 0.05
		const held: Array<{ x: number; y: number }> = []
		let current = smoothed[0]
		for (const point of smoothed) {
			if (Math.hypot(point.x - current.x, point.y - current.y) > deadBand) {
				current = point
			}
			held.push(current)
		}

		const offsets: Array<{ dx: number; dy: number }> = []
		for (let frame = 0; frame < frameCount; frame++) {
			const time = frame / options.fps
			// Linear interpolation between the two nearest samples, so the window
			// moves continuously between measurements instead of stepping.
			const position = (time / Math.max(0.001, duration)) * (held.length - 1)
			const lowIndex = Math.max(0, Math.min(held.length - 1, Math.floor(position)))
			const highIndex = Math.min(held.length - 1, lowIndex + 1)
			const blend = position - lowIndex
			const x = held[lowIndex].x + (held[highIndex].x - held[lowIndex].x) * blend
			const y = held[lowIndex].y + (held[highIndex].y - held[lowIndex].y) * blend

			// The subject's position in source pixels, minus where the centred
			// window already is - that difference is the shift.
			const wantedX = x * sourceWidth - crop.width / 2
			const wantedY = y * sourceHeight - crop.height / 2
			offsets.push({
				dx: Math.max(-marginX, Math.min(marginX, wantedX - crop.x)),
				dy: Math.max(-marginY, Math.min(marginY, wantedY - crop.y)),
			})
		}

		const trackedRatio = personFrames / Math.max(1, samples.length)
		const summary = segmenterFailed
			? `tracked the moving part of the frame (${segmenterFailed})`
			: personFrames > 0
				? `followed a person in ${Math.round(trackedRatio * 100)}% of the clip`
				: 'no person was found, so it followed the moving part of the frame'

		return { crop, offsets, summary }
	} finally {
		segmenter?.close()
		input.dispose()
	}
}
