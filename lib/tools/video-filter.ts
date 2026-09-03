'use client'

/**
 * The visual engine: every tool that repaints the picture - rotate, flip,
 * crop, resize the frame's content, colour grade, grayscale, sepia, blur,
 * sharpen, vignette, watermark, text burn-in, or a plain format/quality
 * change - runs through here.
 *
 * Unlike the silence cutter, nothing here changes *when* a frame plays: every
 * source frame becomes exactly one output frame, at the source's own frame
 * rate, so there is no timestamp remapping to get right. That also means the
 * audio track never needs decoding - it is untouched by anything this file
 * does, so it is copied packet for packet, the same trick `av-remux.ts` uses.
 * Only the video goes through decode -> `frame-ops.ts` -> encode.
 *
 * (A frame-rate change or a plain resize, on their own, don't need any of
 * this: they are the identity case of the silence cutter's own time map, so
 * `plan-ops.ts` routes those through `lib/silence/render.ts` instead, where
 * that map already exists and is already tested.)
 */

import { computeFrameDims, drawFrame, fitWithin, type CropRect, type FrameOpsDims, type FrameOpsParams, type WatermarkSpec } from './frame-ops'
import { encodeGif, type GifFrame } from './gif-encoder'
import { createRenderSink, describeRenderFailure } from '../media/render-sink'
import { createPacketRetimer } from './packet-timing'

export type VideoFilterFormat = 'mp4' | 'webm'
export type VideoFilterQuality = 'draft' | 'high' | 'max'

/**
 * The decoded frame, handed to the per-frame hook before anything is drawn.
 *
 * A hook that only needs to know *when* it is (stabilisation, picture-in-
 * picture) ignores this; a hook that has to look at the picture itself - the
 * background remover, which must run a segmentation model over it - would
 * otherwise have to decode the whole clip a second time to get at it.
 */
export type SourceFrameAccess = {
	width: number
	height: number
	/** Draws this frame into `ctx`, scaled to `width` x `height`. */
	drawTo(ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D, width: number, height: number): void
}

/**
 * Called once per output frame, before it is drawn. This is the seam
 * stabilisation, picture-in-picture and background replacement hook into the
 * render loop without any of them needing their own copy of it: stabilisation
 * returns a `cropOffset` that nudges this frame back onto a smoothed camera
 * path; picture-in-picture returns an `overlay` (built the same way a
 * watermark is) with that instant's frame from the second clip already drawn
 * into it; anything else returns a `patch` of frame parameters that apply to
 * this frame alone.
 */
export type PerFrameHook = (
	frameIndex: number,
	timestampSeconds: number,
	frame: SourceFrameAccess,
) => Promise<{
	cropOffset?: { dx: number; dy: number }
	overlay?: WatermarkSpec | null
	patch?: Partial<FrameOpsParams>
}>

export type VideoFilterOptions = {
	source: Blob
	params: FrameOpsParams
	audio: 'copy' | 'mute'
	format: VideoFilterFormat
	quality: VideoFilterQuality
	perFrame?: PerFrameHook
	/**
	 * The longest side the output may have, in pixels.
	 *
	 * The picture is scaled down to fit and nothing else changes: the crop, the
	 * grade and the per-frame hook all still run, just over fewer pixels. This
	 * is what a draft preview turns down, and it is the single biggest lever
	 * there is on how much memory an export asks the browser for - a 1080x1920
	 * frame is sixteen times the pixels of the same clip capped at 480, in the
	 * decoder, in the canvas, in the encoder and in every scratch surface a
	 * per-frame hook keeps.
	 */
	maxDimension?: number
	/**
	 * The highest frame rate the output may have.
	 *
	 * Source frames are dropped in whole steps to reach it - never resampled -
	 * so what is encoded is a subset of what was decoded, at its original
	 * timestamps. The audio is untouched, so nothing drifts.
	 */
	maxFrameRate?: number
	/**
	 * How many seconds of the clip to write, from its start.
	 *
	 * Both tracks stop at the same instant, so the result is a shorter video
	 * rather than a video whose sound outlives its picture. Used by the draft
	 * preview: the whole point of a preview is that it is ready before the
	 * export it is previewing.
	 */
	maxSeconds?: number
	onProgress?: (progress: { phase: 'preparing' | 'encoding' | 'finishing'; ratio: number; framesDone: number; framesTotal: number }) => void
	signal: AbortSignal
}

export type VideoFilterResult = {
	blob: Blob
	url: string
	format: VideoFilterFormat
	width: number
	height: number
	fps: number
	durationSeconds: number
	sizeInBytes: number
	videoCodec: string
	audioCodec: string | null
}

export class VideoFilterCancelled extends Error {
	constructor() {
		super('Cancelled')
		this.name = 'VideoFilterCancelled'
	}
}

function assertLive(signal: AbortSignal): void {
	if (signal.aborted) throw new VideoFilterCancelled()
}

const VIDEO_QUALITY = { draft: 'QUALITY_LOW', high: 'QUALITY_HIGH', max: 'QUALITY_VERY_HIGH' } as const

export async function renderVideoFilter(options: VideoFilterOptions): Promise<VideoFilterResult> {
	const { signal } = options
	assertLive(signal)

	const mediabunny = await import('mediabunny')
	const {
		ALL_FORMATS,
		BlobSource,
		EncodedAudioPacketSource,
		EncodedPacketSink,
		Input,
		Mp4OutputFormat,
		Output,
		VideoSample,
		VideoSampleSink,
		VideoSampleSource,
		WebMOutputFormat,
		getFirstEncodableVideoCodec,
	} = mediabunny

	const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(options.source) })
	// Every frame is re-encoded, so the output grows with the length of the clip
	// and belongs on disk rather than in one heap buffer.
	const sink = await createRenderSink(`filter.${options.format}`)
	let output: InstanceType<typeof Output> | null = null
	let handedOver = false
	const onAbort = () => {
		void output?.cancel()
	}
	signal.addEventListener('abort', onAbort, { once: true })

	try {
		const videoTrack = await input.getPrimaryVideoTrack()
		if (!videoTrack) throw new Error('That file has no video track to work with.')
		if (!(await videoTrack.canDecode())) {
			throw new Error('This browser cannot decode that video codec, so it cannot be re-worked here.')
		}

		const sourceWidth = await videoTrack.getDisplayWidth()
		const sourceHeight = await videoTrack.getDisplayHeight()
		// A size cap is expressed as a target size rather than as a separate
		// scale step, so everything downstream - the encoder, the per-frame
		// hook, `drawFrame` - sees one set of dimensions and cannot disagree
		// about them.
		let params: FrameOpsParams = options.params
		let dims: FrameOpsDims = computeFrameDims(sourceWidth, sourceHeight, params)
		if (options.maxDimension && Math.max(dims.width, dims.height) > options.maxDimension) {
			const fitted = fitWithin(dims.width, dims.height, options.maxDimension)
			params = { ...options.params, targetWidth: fitted.width, targetHeight: fitted.height }
			dims = computeFrameDims(sourceWidth, sourceHeight, params)
		}

		const stats = await videoTrack.computePacketStats(120)
		const fps = stats.averagePacketRate > 0 ? Math.min(120, Math.max(1, stats.averagePacketRate)) : 30
		const duration = await input.computeDuration()
		const limitSeconds = options.maxSeconds && options.maxSeconds > 0 ? options.maxSeconds : Infinity
		const framesTotal = Math.max(1, Math.round(Math.min(duration, limitSeconds) * fps))

		// Whole steps only: frame 0, 2, 4 of a 30fps clip is a real 15fps video,
		// where 30 * (15/30.7) is a stutter. The kept frames keep their own
		// timestamps, so the picture still lines up with the untouched audio.
		const stride =
			options.maxFrameRate && options.maxFrameRate > 0
				? Math.max(1, Math.floor(fps / options.maxFrameRate))
				: 1
		const outputFps = fps / stride

		options.onProgress?.({ phase: 'preparing', ratio: 0, framesDone: 0, framesTotal })

		const videoCodec = await getFirstEncodableVideoCodec(
			options.format === 'mp4' ? ['avc', 'hevc', 'vp9', 'av1'] : ['vp9', 'vp8', 'av1'],
			{ width: dims.width, height: dims.height },
		)
		if (!videoCodec) {
			throw new Error('This browser cannot encode video. Try Chrome or Edge on a desktop.')
		}

		output = new Output({
			format:
				options.format === 'mp4'
					? new Mp4OutputFormat({ fastStart: sink.streaming ? false : 'in-memory' })
					: new WebMOutputFormat(),
			target: sink.target,
		})

		const videoSource = new VideoSampleSource({
			codec: videoCodec,
			bitrate: mediabunny[VIDEO_QUALITY[options.quality]],
			keyFrameInterval: 2,
		})
		output.addVideoTrack(videoSource, { frameRate: outputFps })

		let audioTrack: Awaited<ReturnType<typeof input.getPrimaryAudioTrack>> = null
		let audioSource: InstanceType<typeof EncodedAudioPacketSource> | null = null
		let audioCodecUsed: string | null = null
		if (options.audio === 'copy') {
			audioTrack = await input.getPrimaryAudioTrack()
			if (audioTrack) {
				const audioCodec = await audioTrack.getCodec()
				const containerCheck = options.format === 'mp4' ? new Mp4OutputFormat() : new WebMOutputFormat()
				if (audioCodec && containerCheck.getSupportedAudioCodecs().includes(audioCodec as never)) {
					const source = new EncodedAudioPacketSource(audioCodec as never)
					output.addAudioTrack(source)
					audioSource = source
					audioCodecUsed = audioCodec
				} else {
					audioTrack = null
				}
			}
		}

		await output.start()

		let framesDone = 0
		const report = () => {
			options.onProgress?.({
				phase: 'encoding',
				ratio: Math.min(0.98, framesDone / framesTotal),
				framesDone,
				framesTotal,
			})
		}

		/**
		 * The surface every output frame is drawn on, and how to build another.
		 *
		 * A 2D canvas is not permanent. When the GPU process drops its context -
		 * which on a long export is a memory problem, not a bug - every draw
		 * into it silently does nothing and `new VideoFrame(canvas)` throws
		 * "Invalid source state", because the browser can no longer produce an
		 * image from it. The only cure is a new canvas, so the surface is
		 * replaceable and the frame is drawn again rather than the export dying
		 * two thirds of the way through a bake nobody wants to repeat.
		 */
		const makeSurface = () => {
			const surfaceCanvas = new OffscreenCanvas(dims.width, dims.height)
			const surfaceCtx = surfaceCanvas.getContext('2d')
			if (!surfaceCtx) throw new Error('This browser has no 2D canvas context to draw frames with.')
			return { canvas: surfaceCanvas, ctx: surfaceCtx }
		}
		let surface = makeSurface()

		/**
		 * Draws one frame and hands it to the encoder, once - or twice, if the
		 * canvas turned out to be dead.
		 *
		 * The retry is deliberately the whole draw: a replacement canvas is
		 * blank, so re-encoding without redrawing would write a transparent
		 * frame and call it a success.
		 */
		const encodeFrame = async (timestampSeconds: number, frameDuration: number, draw: (ctx: OffscreenCanvasRenderingContext2D) => void) => {
			draw(surface.ctx)
			let output: InstanceType<typeof VideoSample>
			try {
				output = new VideoSample(surface.canvas, { timestamp: timestampSeconds, duration: frameDuration })
			} catch (error) {
				if (signal.aborted) throw error
				surface = makeSurface()
				draw(surface.ctx)
				output = new VideoSample(surface.canvas, { timestamp: timestampSeconds, duration: frameDuration })
			}
			try {
				await videoSource.add(output)
			} finally {
				output.close()
			}
		}

		const encodeVideo = async () => {
			const sink = new VideoSampleSink(videoTrack)
			let index = 0
			try {
				for await (const sample of sink.samples()) {
					assertLive(signal)
					const sourceIndex = index
					index += 1
					try {
						// Dropped frames still cost a decode - the decoder has to
						// walk them to reach the next key frame - but nothing past
						// this point, which is where the work actually is.
						if (sourceIndex % stride !== 0) continue
						const timestampSeconds = sourceIndex / fps
						if (timestampSeconds >= limitSeconds) break
						const extra = options.perFrame
							? await options.perFrame(sourceIndex, timestampSeconds, {
									width: sourceWidth,
									height: sourceHeight,
									drawTo: (target, width, height) => sample.draw(target as CanvasRenderingContext2D, 0, 0, width, height),
								})
							: undefined
						const frameParams: FrameOpsParams =
							extra?.patch || extra?.overlay !== undefined
								? {
										...params,
										...(extra.patch ?? {}),
										...(extra.overlay !== undefined ? { watermark: extra.overlay } : {}),
									}
								: params

						await encodeFrame(timestampSeconds, stride / fps, (target) =>
							drawFrame(
								target,
								(c, sx, sy, sw, sh, dx, dy, dw, dh) => sample.draw(c as CanvasRenderingContext2D, sx, sy, sw, sh, dx, dy, dw, dh),
								frameParams,
								dims,
								extra?.cropOffset,
								sourceIndex,
							),
						)
					} finally {
						// Always: a decoded frame that is not closed holds a GPU
						// buffer, and enough of those is exactly the memory
						// exhaustion the retry above exists to survive.
						sample.close()
					}

					framesDone = index
					if (index % 5 === 0) report()
				}
			} finally {
				videoSource.close()
			}
		}

		/**
		 * The audio is copied packet for packet, and the only thing that has to
		 * be thought about on the way is where those packets sit in time: an
		 * ordinary MP4 starts its AAC track below zero to carry the encoder's
		 * priming, and a muxer refuses a negative timestamp outright. See
		 * `packet-timing.ts` - it decides, this loop just does as it is told.
		 */
		const encodeAudio = async () => {
			if (!audioTrack || !audioSource) return
			const decoderConfig = await audioTrack.getDecoderConfig()
			const sink = new EncodedPacketSink(audioTrack)
			const retimer = createPacketRetimer()
			let first = true
			try {
				for await (const packet of sink.packets()) {
					assertLive(signal)
					// The picture stops at `limitSeconds`, so the sound does too -
					// a preview whose audio runs on over a black screen is not a
					// preview of anything.
					if (packet.timestamp >= limitSeconds) break
					const placement = retimer.place(packet)
					if (placement.action === 'drop') continue
					const outgoing =
						placement.action === 'retime'
							? packet.clone({ timestamp: placement.timestamp, duration: placement.duration })
							: packet
					await audioSource.add(outgoing, first ? { decoderConfig: decoderConfig ?? undefined } : undefined)
					first = false
				}
			} finally {
				audioSource.close()
			}
		}

		await Promise.all([encodeVideo(), encodeAudio()])
		assertLive(signal)

		options.onProgress?.({ phase: 'finishing', ratio: 0.99, framesDone, framesTotal })
		await output.finalize()

		const blob = await sink.finish(options.format === 'mp4' ? 'video/mp4' : 'video/webm')
		handedOver = true
		options.onProgress?.({ phase: 'finishing', ratio: 1, framesDone, framesTotal })

		return {
			blob,
			url: URL.createObjectURL(blob),
			format: options.format,
			width: dims.width,
			height: dims.height,
			fps: outputFps,
			durationSeconds: framesTotal / fps,
			sizeInBytes: blob.size,
			videoCodec,
			audioCodec: audioCodecUsed,
		}
	} catch (error) {
		if (signal.aborted) throw new VideoFilterCancelled()
		throw describeRenderFailure(error)
	} finally {
		signal.removeEventListener('abort', onAbort)
		input.dispose()
		if (!handedOver) void sink.discard()
	}
}

export type ThumbnailResult = { blob: Blob; url: string; width: number; height: number }

/** Grabs one frame near `atSeconds` and hands it back as a PNG. */
export async function extractThumbnail(args: {
	source: Blob
	atSeconds: number
	params?: FrameOpsParams
	/**
	 * Run for this one frame, exactly as it would be during a render - which is
	 * what lets a still preview of the background remover or a colour grade go
	 * through the identical code path as the export it is previewing.
	 */
	perFrame?: PerFrameHook
	signal: AbortSignal
}): Promise<ThumbnailResult> {
	assertLive(args.signal)
	const mediabunny = await import('mediabunny')
	const { ALL_FORMATS, BlobSource, Input, VideoSampleSink } = mediabunny
	const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(args.source) })
	try {
		const videoTrack = await input.getPrimaryVideoTrack()
		if (!videoTrack) throw new Error('That file has no video track to grab a frame from.')
		const sourceWidth = await videoTrack.getDisplayWidth()
		const sourceHeight = await videoTrack.getDisplayHeight()
		const dims = computeFrameDims(sourceWidth, sourceHeight, args.params ?? {})

		const sink = new VideoSampleSink(videoTrack)
		const sample = await sink.getSample(Math.max(0, args.atSeconds))
		if (!sample) throw new Error('No frame was found at that time - try a moment closer to the start.')

		const canvas = new OffscreenCanvas(dims.width, dims.height)
		const ctx = canvas.getContext('2d')
		if (!ctx) throw new Error('This browser has no 2D canvas context to draw frames with.')
		const extra = args.perFrame
			? await args.perFrame(0, Math.max(0, args.atSeconds), {
					width: sourceWidth,
					height: sourceHeight,
					drawTo: (target, width, height) => sample.draw(target as CanvasRenderingContext2D, 0, 0, width, height),
				})
			: undefined
		drawFrame(
			ctx,
			(c, sx, sy, sw, sh, dx, dy, dw, dh) => sample.draw(c as CanvasRenderingContext2D, sx, sy, sw, sh, dx, dy, dw, dh),
			extra?.patch || extra?.overlay !== undefined
				? {
						...(args.params ?? {}),
						...(extra.patch ?? {}),
						...(extra.overlay !== undefined ? { watermark: extra.overlay } : {}),
					}
				: (args.params ?? {}),
			dims,
			extra?.cropOffset,
		)
		sample.close()

		const blob = await canvas.convertToBlob({ type: 'image/png' })
		return { blob, url: URL.createObjectURL(blob), width: dims.width, height: dims.height }
	} finally {
		input.dispose()
	}
}

export function filterFileName(name: string, format: VideoFilterFormat, suffix: string): string {
	const base = name.replace(/\.[a-z0-9]+$/i, '') || 'video'
	return `${base}-${suffix}.${format}`
}

/* =============================================================================
   Analysis passes.

   These decode the clip once, cheaply (a handful of sample frames, or a
   small thumbnail per frame), to work out numbers a tool then feeds back
   into `renderVideoFilter` as ordinary parameters or a `perFrame` hook. Nothing
   here writes a file - it only measures.
   ========================================================================== */

export type AutoLevelsResult = { brightness: number; contrast: number; saturation: number }

/**
 * A one-click exposure fix: a handful of frames are sampled, folded into one
 * luminance histogram and one average saturation, and from those a
 * brightness/contrast/saturation adjustment is derived - stretch the 1st-99th
 * percentile toward the full range, recentre the mean toward a comfortable
 * midtone, and nudge saturation only when the source is visibly flat or
 * visibly oversaturated. It is a heuristic auto-levels, the same idea an
 * "Auto Contrast" button uses elsewhere - not a colour-graded look.
 */
export async function analyzeAutoLevels(source: Blob, signal: AbortSignal): Promise<AutoLevelsResult> {
	assertLive(signal)
	const mediabunny = await import('mediabunny')
	const { ALL_FORMATS, BlobSource, Input, VideoSampleSink } = mediabunny
	const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(source) })
	try {
		const videoTrack = await input.getPrimaryVideoTrack()
		if (!videoTrack) return { brightness: 1, contrast: 1, saturation: 1 }
		const duration = await input.computeDuration()
		const sink = new VideoSampleSink(videoTrack)

		const sampleCount = 8
		const width = 96
		const height = 54
		const canvas = new OffscreenCanvas(width, height)
		const ctx = canvas.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D

		const histogram = new Float64Array(256)
		let saturationSum = 0
		let saturationCount = 0
		let sampled = 0

		for (let i = 0; i < sampleCount; i++) {
			assertLive(signal)
			const sample = await sink.getSample((duration * (i + 0.5)) / sampleCount)
			if (!sample) continue
			ctx.clearRect(0, 0, width, height)
			sample.draw(ctx, 0, 0, width, height)
			sample.close()
			const data = ctx.getImageData(0, 0, width, height).data
			for (let p = 0; p < data.length; p += 4) {
				const r = data[p]
				const g = data[p + 1]
				const b = data[p + 2]
				const luminance = 0.299 * r + 0.587 * g + 0.114 * b
				histogram[Math.max(0, Math.min(255, Math.round(luminance)))] += 1
				const max = Math.max(r, g, b)
				const min = Math.min(r, g, b)
				saturationSum += max === 0 ? 0 : (max - min) / max
				saturationCount += 1
			}
			sampled += 1
		}
		if (sampled === 0) return { brightness: 1, contrast: 1, saturation: 1 }

		const total = histogram.reduce((a, b) => a + b, 0)
		const percentile = (p: number): number => {
			const target = total * p
			let running = 0
			for (let i = 0; i < 256; i++) {
				running += histogram[i]
				if (running >= target) return i
			}
			return 255
		}
		const p1 = percentile(0.01)
		const p99 = percentile(0.99)
		let meanLuminance = 0
		for (let i = 0; i < 256; i++) meanLuminance += i * histogram[i]
		meanLuminance /= total

		const brightness = Math.max(0.7, Math.min(1.6, 120 / Math.max(meanLuminance, 12)))
		const contrast = Math.max(0.8, Math.min(1.7, 190 / Math.max(p99 - p1, 30)))
		const meanSaturation = saturationCount > 0 ? saturationSum / saturationCount : 0.3
		const saturation = meanSaturation < 0.22 ? 1.18 : meanSaturation > 0.65 ? 0.92 : 1

		return {
			brightness: Number(brightness.toFixed(3)),
			contrast: Number(contrast.toFixed(3)),
			saturation: Number(saturation.toFixed(3)),
		}
	} finally {
		input.dispose()
	}
}

/**
 * Measures how wide the black bars along each edge are, sampling a few
 * frames and keeping only the bar width every sample agrees is black - a
 * single dark shot must never make this crop into the picture.
 */
export async function detectLetterboxCrop(source: Blob, signal: AbortSignal): Promise<CropRect | null> {
	assertLive(signal)
	const mediabunny = await import('mediabunny')
	const { ALL_FORMATS, BlobSource, Input, VideoSampleSink } = mediabunny
	const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(source) })
	try {
		const videoTrack = await input.getPrimaryVideoTrack()
		if (!videoTrack) return null
		const sourceWidth = await videoTrack.getDisplayWidth()
		const sourceHeight = await videoTrack.getDisplayHeight()
		const duration = await input.computeDuration()
		const sink = new VideoSampleSink(videoTrack)

		const width = 160
		const height = Math.max(2, Math.round((sourceHeight / sourceWidth) * width))
		const canvas = new OffscreenCanvas(width, height)
		const ctx = canvas.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D
		const sampleCount = 5
		const blackLuminance = 14

		let top = height
		let bottom = height
		let left = width
		let right = width
		let sampled = 0

		for (let i = 0; i < sampleCount; i++) {
			assertLive(signal)
			const sample = await sink.getSample((duration * (i + 0.5)) / sampleCount)
			if (!sample) continue
			ctx.clearRect(0, 0, width, height)
			sample.draw(ctx, 0, 0, width, height)
			sample.close()
			const data = ctx.getImageData(0, 0, width, height).data
			const lumAt = (x: number, y: number) => {
				const p = (y * width + x) * 4
				return 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]
			}
			const rowIsDark = (y: number): boolean => {
				let sum = 0
				for (let x = 0; x < width; x++) sum += lumAt(x, y)
				return sum / width < blackLuminance
			}
			const colIsDark = (x: number): boolean => {
				let sum = 0
				for (let y = 0; y < height; y++) sum += lumAt(x, y)
				return sum / height < blackLuminance
			}

			let t = 0
			while (t < height / 2 - 1 && rowIsDark(t)) t++
			let b = 0
			while (b < height / 2 - 1 && rowIsDark(height - 1 - b)) b++
			let l = 0
			while (l < width / 2 - 1 && colIsDark(l)) l++
			let r = 0
			while (r < width / 2 - 1 && colIsDark(width - 1 - r)) r++

			top = Math.min(top, t)
			bottom = Math.min(bottom, b)
			left = Math.min(left, l)
			right = Math.min(right, r)
			sampled += 1
		}
		if (sampled === 0) return null

		const topPx = Math.round((top / height) * sourceHeight)
		const bottomPx = Math.round((bottom / height) * sourceHeight)
		const leftPx = Math.round((left / width) * sourceWidth)
		const rightPx = Math.round((right / width) * sourceWidth)
		if (topPx + bottomPx < sourceHeight * 0.02 && leftPx + rightPx < sourceWidth * 0.02) return null

		return {
			x: leftPx,
			y: topPx,
			width: Math.max(10, sourceWidth - leftPx - rightPx),
			height: Math.max(10, sourceHeight - topPx - bottomPx),
		}
	} finally {
		input.dispose()
	}
}

export type StabilizationPlan = { compensation: Array<{ dx: number; dy: number }>; cropScale: number }

/**
 * Estimates, and smooths, the camera's frame-to-frame translation.
 *
 * Every frame is shrunk to a small grayscale thumbnail and matched against
 * the previous one by a small block search (sum of absolute differences),
 * which gives a raw, shaky frame-to-frame motion. Integrating that motion
 * gives the camera's cumulative path; a moving-average low-pass of that path
 * is what the camera *should* have done; the gap between the two, scaled
 * back up to full resolution and clamped to the margin a small zoom-in
 * leaves available, is exactly how far each frame needs to be nudged.
 *
 * This is translational stabilisation only - it will not correct rotation or
 * lens-induced warp - which is the same limitation every simple stabiliser
 * has, and is worth saying rather than over-promising.
 */
export async function estimateStabilization(
	source: Blob,
	fps: number,
	signal: AbortSignal,
	strength = 0.6,
): Promise<StabilizationPlan> {
	assertLive(signal)
	const mediabunny = await import('mediabunny')
	const { ALL_FORMATS, BlobSource, Input, VideoSampleSink } = mediabunny
	const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(source) })
	try {
		const videoTrack = await input.getPrimaryVideoTrack()
		if (!videoTrack) return { compensation: [], cropScale: 1 }
		const sourceWidth = await videoTrack.getDisplayWidth()
		const sourceHeight = await videoTrack.getDisplayHeight()
		const sink = new VideoSampleSink(videoTrack)

		const thumbWidth = 64
		const thumbHeight = Math.max(2, Math.round((sourceHeight / sourceWidth) * thumbWidth))
		const canvas = new OffscreenCanvas(thumbWidth, thumbHeight)
		const ctx = canvas.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D
		const searchRange = 8

		const raw: Array<{ dx: number; dy: number }> = []
		let previous: Uint8ClampedArray | null = null

		for await (const sample of sink.samples()) {
			assertLive(signal)
			ctx.clearRect(0, 0, thumbWidth, thumbHeight)
			sample.draw(ctx, 0, 0, thumbWidth, thumbHeight)
			sample.close()
			const data = ctx.getImageData(0, 0, thumbWidth, thumbHeight).data
			const gray = new Uint8ClampedArray(thumbWidth * thumbHeight)
			for (let p = 0, i = 0; p < data.length; p += 4, i++) {
				gray[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]
			}

			if (!previous) {
				raw.push({ dx: 0, dy: 0 })
			} else {
				let bestDx = 0
				let bestDy = 0
				let bestScore = Infinity
				for (let dy = -searchRange; dy <= searchRange; dy++) {
					for (let dx = -searchRange; dx <= searchRange; dx++) {
						let score = 0
						for (let y = searchRange; y < thumbHeight - searchRange; y++) {
							for (let x = searchRange; x < thumbWidth - searchRange; x++) {
								score += Math.abs(previous[y * thumbWidth + x] - gray[(y + dy) * thumbWidth + (x + dx)])
							}
						}
						if (score < bestScore) {
							bestScore = score
							bestDx = dx
							bestDy = dy
						}
					}
				}
				raw.push({ dx: bestDx, dy: bestDy })
			}
			previous = gray
		}
		if (raw.length === 0) return { compensation: [], cropScale: 1 }

		const path: Array<{ x: number; y: number }> = [{ x: 0, y: 0 }]
		for (let i = 1; i < raw.length; i++) {
			path.push({ x: path[i - 1].x + raw[i].dx, y: path[i - 1].y + raw[i].dy })
		}
		const clampedStrength = Math.max(0, Math.min(1, strength))
		const smoothRadius = Math.max(2, Math.round((fps / 2) * (0.4 + clampedStrength)))
		const smoothed = path.map((_, i) => {
			let sumX = 0
			let sumY = 0
			let count = 0
			for (let k = -smoothRadius; k <= smoothRadius; k++) {
				const j = Math.max(0, Math.min(path.length - 1, i + k))
				sumX += path[j].x
				sumY += path[j].y
				count += 1
			}
			return { x: sumX / count, y: sumY / count }
		})

		const scaleX = sourceWidth / thumbWidth
		const scaleY = sourceHeight / thumbHeight
		// More strength buys a bigger zoom, which buys more margin to absorb a
		// larger correction into - from a 3% zoom at the gentlest setting to a
		// 15% zoom at the strongest.
		const cropScale = 1.03 + clampedStrength * 0.12
		const marginX = (sourceWidth * (cropScale - 1)) / (2 * cropScale)
		const marginY = (sourceHeight * (cropScale - 1)) / (2 * cropScale)

		const compensation = path.map((p, i) => ({
			dx: Math.max(-marginX, Math.min(marginX, (smoothed[i].x - p.x) * scaleX)),
			dy: Math.max(-marginY, Math.min(marginY, (smoothed[i].y - p.y) * scaleY)),
		}))
		return { compensation, cropScale }
	} finally {
		input.dispose()
	}
}

export type SecondaryVideoFrame = { canvas: OffscreenCanvas; naturalWidth: number; naturalHeight: number }

export type SecondaryVideoSource = {
	durationSeconds: number
	getFrameAt: (seconds: number) => Promise<SecondaryVideoFrame | null>
	dispose: () => void
}

/**
 * Opens a second clip for picture-in-picture and hands back a simple
 * "give me the frame at this time" accessor, so the main render loop never
 * has to know mediabunny opened it.
 */
export async function openSecondaryVideoSource(source: Blob): Promise<SecondaryVideoSource> {
	const mediabunny = await import('mediabunny')
	const { ALL_FORMATS, BlobSource, Input, VideoSampleSink } = mediabunny
	const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(source) })
	const videoTrack = await input.getPrimaryVideoTrack()
	if (!videoTrack) {
		input.dispose()
		throw new Error('That overlay clip has no video track.')
	}
	const naturalWidth = await videoTrack.getDisplayWidth()
	const naturalHeight = await videoTrack.getDisplayHeight()
	const durationSeconds = await input.computeDuration()
	const sink = new VideoSampleSink(videoTrack)
	let lastFrame: SecondaryVideoFrame | null = null

	return {
		durationSeconds,
		async getFrameAt(seconds: number) {
			const sample = await sink.getSample(Math.max(0, Math.min(durationSeconds, seconds)))
			if (!sample) return lastFrame
			const canvas = new OffscreenCanvas(naturalWidth, naturalHeight)
			const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D
			sample.draw(ctx, 0, 0, naturalWidth, naturalHeight)
			sample.close()
			lastFrame = { canvas, naturalWidth, naturalHeight }
			return lastFrame
		},
		dispose() {
			input.dispose()
		},
	}
}

export type GifExportResult = { blob: Blob; url: string; width: number; height: number; frameCount: number; trimmedToSeconds: number | null }

/**
 * Turns a clip into a looping GIF: frames are sampled at `fps` up to
 * `maxSeconds` of the clip, drawn at `targetWidth` (height keeps the source's
 * aspect ratio), and handed to the from-scratch encoder in `gif-encoder.ts`.
 * The length cap is real and reported back, not silent - a GIF a few minutes
 * long at even a modest size is tens of megabytes before it's even keyed one
 * frame.
 */
export async function exportGif(args: {
	source: Blob
	targetWidth: number
	fps: number
	maxSeconds: number
	signal: AbortSignal
	onProgress?: (ratio: number) => void
}): Promise<GifExportResult> {
	assertLive(args.signal)
	const mediabunny = await import('mediabunny')
	const { ALL_FORMATS, BlobSource, Input, VideoSampleSink } = mediabunny
	const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(args.source) })
	try {
		const videoTrack = await input.getPrimaryVideoTrack()
		if (!videoTrack) throw new Error('That file has no video track to turn into a GIF.')
		const sourceWidth = await videoTrack.getDisplayWidth()
		const sourceHeight = await videoTrack.getDisplayHeight()
		const dims = computeFrameDims(sourceWidth, sourceHeight, { targetWidth: Math.max(80, Math.min(640, args.targetWidth)) })

		const fullDuration = await input.computeDuration()
		const cap = Math.max(1, args.maxSeconds)
		const duration = Math.min(fullDuration, cap)
		const trimmedToSeconds = fullDuration > cap ? cap : null
		const fps = Math.max(2, Math.min(20, args.fps))
		const frameCount = Math.max(1, Math.round(duration * fps))

		const canvas = new OffscreenCanvas(dims.width, dims.height)
		const ctx = canvas.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D
		const sink = new VideoSampleSink(videoTrack)
		const frames: GifFrame[] = []

		for (let i = 0; i < frameCount; i++) {
			assertLive(args.signal)
			const sample = await sink.getSample(i / fps)
			if (!sample) continue
			ctx.clearRect(0, 0, dims.width, dims.height)
			drawFrame(ctx, (c, sx, sy, sw, sh, dx, dy, dw, dh) => sample.draw(c as CanvasRenderingContext2D, sx, sy, sw, sh, dx, dy, dw, dh), {}, dims)
			sample.close()
			const imageData = ctx.getImageData(0, 0, dims.width, dims.height)
			frames.push({ data: imageData.data, delayMs: 1000 / fps })
			args.onProgress?.(Math.min(0.92, (i + 1) / frameCount))
		}

		const blob = await encodeGif({ frames, width: dims.width, height: dims.height, maxColors: 200, signal: args.signal })
		args.onProgress?.(1)
		return { blob, url: URL.createObjectURL(blob), width: dims.width, height: dims.height, frameCount: frames.length, trimmedToSeconds }
	} finally {
		input.dispose()
	}
}
