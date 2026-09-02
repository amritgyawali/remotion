'use client'

/**
 * Putting the object behind the person, and writing the result out as a video.
 *
 * Three things meet once per frame - the segmenter that finds the person, the
 * sprite that goes behind them, and the compositor that puts the two together
 * - and this is the only file that knows about all three. It hands back a
 * single `PerFrameHook` that the bake and the still preview both use unchanged,
 * so what the panel previews is literally what the encoder writes.
 *
 * Almost everything here is about not doing work.
 *
 * - **The model only runs where an object is.** Segmentation is by far the
 *   most expensive thing in the bake, and most of a talking clip has no object
 *   on screen. Outside a shot the hook returns nothing at all and the frame is
 *   copied through untouched, plus a short pre-roll so the anchor filter has
 *   settled before anything becomes visible.
 *
 * - **And not on every frame even then.** A talking head barely changes
 *   between adjacent frames, and re-running a 256x256 network to be told the
 *   same thing is pure cost. The frame the model would be given is compared
 *   with the last one it actually saw - a cheap absolute difference over a
 *   subsampled copy - and the previous mask is reused while the picture is
 *   still. A hard ceiling on consecutive skips means a slow drift can never
 *   accumulate: the mask is never more than a few frames stale, and the object
 *   sits behind a head that has not moved.
 *
 * - **The composite is proportional to the object.** See
 *   `object-compositor.ts`: the frame is never read, and only the object's own
 *   dilated rectangle is repainted.
 *
 * Between them these turn the bake from "decode, segment and repaint every
 * frame" into "decode every frame, segment some of them, repaint a corner of a
 * few" - and the report the panel shows says exactly which, because a claim
 * about speed that nobody measures is a claim about nothing.
 */

import type { CaptionVideoSource } from './types'
import { createPersonSegmenter, type PersonMask, type SegmentationProgress } from '../tools/segmentation'
import {
	extractThumbnail,
	renderVideoFilter,
	type PerFrameHook,
	type VideoFilterFormat,
	type VideoFilterQuality,
	type VideoFilterResult,
} from '../tools/video-filter'
import { anchorFilterFor, findHeadAnchor, FALLBACK_ANCHOR, type HeadAnchor, type SafeArea } from './object-anchor'
import { createObjectCompositor, type ObjectCompositorSettings } from './object-compositor'
import { shotAtMs, type ObjectSettings, type ObjectShot } from './object-plan'
import { loadObjectSprite, objectRequestFor, type ObjectSprite } from './object-sprite'

/** The long side of the copy handed to the segmentation model. */
const MODEL_INPUT_WIDTH = 256

/**
 * How long before a shot the model starts running.
 *
 * The anchor filter and the mask's own temporal smoothing both need a few
 * frames to settle, and the first frame after a gap is raw. Half a second of
 * pre-roll spends the cheapest possible amount of time getting that right
 * before anything is visible.
 */
const PREROLL_MS = 500

/**
 * How different a frame has to be before the model is re-run.
 *
 * Mean absolute difference over the subsampled model input, 0-1. Two thousandths
 * is well under what any real movement produces and comfortably above sensor
 * noise and encoder dither on a static shot.
 */
const MOTION_THRESHOLD = 0.002

/** Never reuse a mask for longer than this, whatever the difference says. */
const MAX_SKIPPED_FRAMES = 3

/** Every Nth pixel of the model input is compared, in both axes. */
const MOTION_STRIDE = 3

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))

/** What the bake actually did, for the panel to report rather than promise. */
export type ObjectRenderStats = {
	/** frames that carried an object */
	framesWithObject: number
	/** frames the segmentation model actually ran on */
	segmenterRuns: number
	/** frames that reused the previous mask because the picture had not changed */
	maskReuses: number
	/** frames where no person was found at all */
	framesWithoutSubject: number
	/** mean share of the frame the compositor repainted, 0-1 */
	meanTouchedShare: number
}

export type PreparedObjectLayer = {
	perFrame: PerFrameHook
	/** what actually happened, for the panel to report honestly */
	summary: string
	stats(): ObjectRenderStats
	dispose(): void
}

export type PrepareObjectLayerArgs = {
	shots: ObjectShot[]
	settings: ObjectSettings
	/** the clip's measured facts - only its pixel size is used */
	probe: Pick<CaptionVideoSource, 'width' | 'height'>
	signal: AbortSignal
	onProgress?: (progress: SegmentationProgress) => void
	/** resolves an uploaded picture's vault id to its bytes */
	resolveBlob?: (blobId: string) => Promise<Blob | null>
	/** edges the object may not cross - the caption band lives in `bottom` */
	safeArea?: SafeArea
}

/** Turns the panel's 0-100 sliders into the compositor's fractions. */
function compositorSettings(settings: ObjectSettings): ObjectCompositorSettings {
	return {
		feather: (clamp(settings.feather, 0, 100) / 100) * 0.04,
		matte: clamp(settings.matte, 0, 100) / 100,
		edgeShift: clamp(settings.edgeShift, -50, 50) / 100,
		lightWrap: clamp(settings.lightWrap, 0, 100) / 100,
		contactShadow: clamp(settings.contactShadow, 0, 100) / 100,
		debug: settings.showMatte,
	}
}

/**
 * Opens the model, rasterises every object in the plan and hands back the
 * per-frame hook that both the bake and the still preview run.
 */
export async function prepareObjectLayer(args: PrepareObjectLayerArgs): Promise<PreparedObjectLayer> {
	const { settings, signal } = args
	const width = Math.max(2, Math.round(args.probe.width))
	const height = Math.max(2, Math.round(args.probe.height))

	const shots = [...args.shots].sort((left, right) => left.startMs - right.startMs)
	if (shots.length === 0) throw new Error('There are no objects to place yet. Plan the objects first.')

	/* --------------------------------------------------------- the pictures */

	const sprites = new Map<string, ObjectSprite>()
	try {
		for (const shot of shots) {
			if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
			sprites.set(
				shot.id,
				await loadObjectSprite(shot, { frameHeight: height, signal, resolveBlob: args.resolveBlob }),
			)
		}
	} catch (error) {
		for (const sprite of sprites.values()) sprite.dispose()
		throw error
	}

	/* ---------------------------------------------------------- the cut-out */

	const segmenter = await createPersonSegmenter({
		modelId: settings.model,
		smoothing: clamp(settings.smoothing, 0, 95) / 100,
		signal,
		onProgress: args.onProgress,
	}).catch((error) => {
		for (const sprite of sprites.values()) sprite.dispose()
		throw error
	})

	const compositor = createObjectCompositor(compositorSettings(settings))

	const inputWidth = MODEL_INPUT_WIDTH
	const inputHeight = Math.max(64, Math.round((MODEL_INPUT_WIDTH * height) / Math.max(width, 1)))
	const inputCanvas = new OffscreenCanvas(inputWidth, inputHeight)
	// `willReadFrequently` because the motion test reads this canvas back on
	// every frame that carries an object - without it Chrome keeps the surface
	// on the GPU and every read is a stall.
	const inputCtx = inputCanvas.getContext('2d', { willReadFrequently: true })
	if (!inputCtx) {
		segmenter.close()
		compositor.dispose()
		for (const sprite of sprites.values()) sprite.dispose()
		throw new Error('This browser has no 2D canvas context to hand the model a frame with.')
	}

	const filter = anchorFilterFor(clamp(settings.anchorDamping, 0, 100) / 100)
	const adaptive = settings.adaptiveMask !== false

	let anchor: HeadAnchor = { ...FALLBACK_ANCHOR }
	let lastMask: PersonMask | null = null
	let motionReference: Uint8ClampedArray | null = null
	let skipped = 0
	let lastMs = -Infinity

	const stats: ObjectRenderStats = {
		framesWithObject: 0,
		segmenterRuns: 0,
		maskReuses: 0,
		framesWithoutSubject: 0,
		meanTouchedShare: 0,
	}
	let touchedTotal = 0

	/**
	 * How much the model's own input has changed since it last ran.
	 *
	 * Deliberately measured on the copy the model would be given rather than on
	 * the frame: it is already drawn, it is already small, and it is the only
	 * picture whose changes can possibly change the mask.
	 */
	const motionSince = (): number => {
		const image = inputCtx.getImageData(0, 0, inputWidth, inputHeight)
		const pixels = image.data
		if (!motionReference || motionReference.length !== pixels.length) {
			motionReference = new Uint8ClampedArray(pixels)
			return 1
		}
		let total = 0
		let counted = 0
		const step = MOTION_STRIDE * 4
		for (let i = 0; i < pixels.length; i += step) {
			total += Math.abs(pixels[i] - motionReference[i]) + Math.abs(pixels[i + 1] - motionReference[i + 1])
			counted += 2
		}
		return total / (counted * 255)
	}

	const perFrame: PerFrameHook = async (_frameIndex, timestampSeconds, frame) => {
		const ms = timestampSeconds * 1000
		const shot = shotAtMs(shots, ms)
		const priming = !shot && shots.some((entry) => ms >= entry.startMs - PREROLL_MS && ms < entry.startMs)
		if (!shot && !priming) {
			// Nothing on screen: leave the frame exactly as it was decoded, and
			// forget the mask so the next shot starts from a real measurement.
			lastMask = null
			motionReference = null
			skipped = 0
			filter.reset()
			return {}
		}

		inputCtx.clearRect(0, 0, inputWidth, inputHeight)
		frame.drawTo(inputCtx, inputWidth, inputHeight)

		const reusable = adaptive && lastMask !== null && skipped < MAX_SKIPPED_FRAMES
		const still = reusable && motionSince() < MOTION_THRESHOLD

		let mask: PersonMask
		if (still && lastMask) {
			mask = lastMask
			skipped++
			stats.maskReuses++
		} else {
			mask = segmenter.segment(inputCanvas, ms)
			lastMask = mask
			skipped = 0
			stats.segmenterRuns++
			// The reference is only replaced when the model actually ran, so a
			// slow drift is measured against the last frame it saw rather than
			// against the previous frame - which is what makes a creep of one
			// grey level per frame eventually trip the threshold.
			motionReference = null
			motionSince()

			const dt = Number.isFinite(lastMs) ? Math.max(1, ms - lastMs) / 1000 : 1 / 30
			anchor = filter.push(findHeadAnchor(mask.data, mask.width, mask.height), dt)
			lastMs = ms
		}

		// The pre-roll exists only to warm the mask and the anchor up.
		if (!shot) return {}

		const sprite = sprites.get(shot.id)
		if (!sprite) return {}

		if (!anchor.found && anchor.coverage < 0.01) stats.framesWithoutSubject++

		const request = objectRequestFor({
			sprite,
			shot,
			anchor,
			ms,
			frameWidth: width,
			frameHeight: height,
			entranceMs: settings.entranceMs,
			followHead: settings.followHead,
			sizeMode: settings.sizeMode,
			safeArea: args.safeArea,
		})
		if (!request && !settings.showMatte) return {}

		stats.framesWithObject++
		compositor.setFrame({ mask, request })
		touchedTotal += compositor.lastTouchedPixels
		return { patch: { backgroundPass: compositor.pass } }
	}

	const modelLabel = settings.model === 'precise' ? 'precise' : 'balanced'

	return {
		perFrame,
		summary: settings.showMatte
			? 'showing the cut-out itself'
			: `${shots.length} object${shots.length === 1 ? '' : 's'} behind the speaker, ${modelLabel} detection`,
		stats() {
			return {
				...stats,
				meanTouchedShare:
					stats.framesWithObject > 0 ? touchedTotal / stats.framesWithObject / (width * height) : 0,
			}
		},
		dispose() {
			segmenter.close()
			compositor.dispose()
			for (const sprite of sprites.values()) sprite.dispose()
			sprites.clear()
			lastMask = null
			motionReference = null
		},
	}
}

/** One line of English about what the bake did, from what it counted. */
export function describeObjectRender(stats: ObjectRenderStats, summary: string): string {
	if (stats.framesWithObject === 0) return summary
	const segmented = stats.segmenterRuns + stats.maskReuses
	const savedShare = segmented > 0 ? stats.maskReuses / segmented : 0
	const parts = [summary, `${stats.framesWithObject} frames carried one`]
	if (savedShare > 0.02) {
		parts.push(`the model was skipped on ${Math.round(savedShare * 100)}% of them - the picture had not moved`)
	}
	if (stats.meanTouchedShare > 0) {
		parts.push(`each repainted ${Math.round(stats.meanTouchedShare * 100)}% of the frame`)
	}
	if (stats.framesWithoutSubject > stats.framesWithObject * 0.5) {
		parts.push('no person was found in most of them, so the objects were placed from the fallback point')
	}
	return parts.join('; ')
}

/* ==========================================================================
   The bake.
   ========================================================================== */

export type BakeObjectVideoArgs = PrepareObjectLayerArgs & {
	/** the clip's own bytes */
	source: Blob
	format?: VideoFilterFormat
	quality?: VideoFilterQuality
	onStage?: (stage: { phase: string; ratio: number }) => void
}

export type BakeObjectVideoResult = VideoFilterResult & {
	summary: string
	stats: ObjectRenderStats
	/** wall-clock seconds the bake took, measured not estimated */
	elapsedSeconds: number
}

/**
 * Writes a new video with the objects composited in, ready to be captioned.
 *
 * The audio track is copied packet for packet - nothing here touches sound -
 * so the bake cannot drift the transcript's timings by so much as a frame.
 */
export async function bakeObjectVideo(args: BakeObjectVideoArgs): Promise<BakeObjectVideoResult> {
	const startedAt = Date.now()
	const prepared = await prepareObjectLayer({
		shots: args.shots,
		settings: args.settings,
		probe: args.probe,
		signal: args.signal,
		resolveBlob: args.resolveBlob,
		safeArea: args.safeArea,
		// The model is a one-off download of up to sixteen megabytes, so it gets
		// its own slice of the bar rather than a frozen 0%.
		onProgress: (progress) =>
			args.onStage?.({
				phase: progress.phase === 'model' ? 'downloading the person model' : 'starting the person model',
				ratio: progress.ratio * 0.12,
			}),
	})

	try {
		const result = await renderVideoFilter({
			source: args.source,
			params: {},
			audio: 'copy',
			format: args.format ?? 'mp4',
			quality: args.quality ?? 'high',
			perFrame: prepared.perFrame,
			signal: args.signal,
			onProgress: (progress) =>
				args.onStage?.({ phase: progress.phase, ratio: 0.12 + progress.ratio * 0.88 }),
		})
		return {
			...result,
			summary: prepared.summary,
			stats: prepared.stats(),
			elapsedSeconds: (Date.now() - startedAt) / 1000,
		}
	} finally {
		prepared.dispose()
	}
}

/* ==========================================================================
   The still preview.
   ========================================================================== */

export type ObjectStillArgs = PrepareObjectLayerArgs & {
	source: Blob
	atSeconds: number
}

/**
 * One composited frame, as a PNG.
 *
 * It runs the identical per-frame hook the bake runs, so what the panel shows
 * while a slider moves is the render, not an approximation of it. Only the
 * shot covering that instant is prepared: rasterising a whole plan - and
 * spinning up three.js for every model in it - to draw one frame would make
 * the preview slower than the bake it is previewing.
 */
export async function renderObjectStill(args: ObjectStillArgs): Promise<{ url: string; blob: Blob }> {
	const covering = shotAtMs(args.shots, args.atSeconds * 1000)
	if (!covering) {
		// Nothing is on screen at that instant, so the honest preview is the
		// untouched frame - and there is no reason to open the model for it.
		const plain = await extractThumbnail({
			source: args.source,
			atSeconds: args.atSeconds,
			signal: args.signal,
		})
		return { url: plain.url, blob: plain.blob }
	}

	const prepared = await prepareObjectLayer({
		shots: [covering],
		settings: args.settings,
		probe: args.probe,
		signal: args.signal,
		onProgress: args.onProgress,
		resolveBlob: args.resolveBlob,
		safeArea: args.safeArea,
	})
	try {
		const still = await extractThumbnail({
			source: args.source,
			atSeconds: args.atSeconds,
			perFrame: prepared.perFrame,
			signal: args.signal,
		})
		return { url: still.url, blob: still.blob }
	} finally {
		prepared.dispose()
	}
}
