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
import { fitWithin } from '../tools/frame-ops'
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

/**
 * How many rasterised objects are kept in memory at once.
 *
 * One is on screen; the second is the one that follows it, so a plan that
 * re-enters a shot does not pay for the picture twice. Three is the smallest
 * number that never re-rasterises during ordinary forward playback.
 */
const MAX_LIVE_SPRITES = 3

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

	/**
	 * The rasterised pictures, of which only a few are ever alive at once.
	 *
	 * A sprite is rasterised at the size it will be drawn, and the cap on that
	 * is two thousand pixels on a side - four megabytes of canvas each, on a
	 * tall frame. A one-press plan of two dozen objects that held every one of
	 * them from the first frame to the last would ask the browser for a hundred
	 * megabytes of graphics memory it never needs: only one object is ever on
	 * screen. So they are rasterised when their shot arrives and the ones left
	 * behind are thrown away, which keeps the cost of a plan flat in the number
	 * of objects in it.
	 *
	 * Promises rather than sprites, so a picture warmed during the pre-roll and
	 * the same picture asked for on the frame it appears are one load, not two.
	 */
	const sprites = new Map<string, Promise<ObjectSprite>>()
	const spriteOrder: string[] = []
	const release = (pending: Promise<ObjectSprite> | undefined) => {
		// A load still in flight is disposed when it lands: there is nothing to
		// free yet, and dropping the reference would leak the canvas it is about
		// to allocate. A failed one has nothing to free at all.
		void pending?.then((sprite) => sprite.dispose()).catch(() => {})
	}
	const disposeSprites = () => {
		for (const pending of sprites.values()) release(pending)
		sprites.clear()
		spriteOrder.length = 0
	}

	const spriteFor = (shot: ObjectShot): Promise<ObjectSprite> => {
		const held = sprites.get(shot.id)
		if (held) return held
		const pending = loadObjectSprite(shot, {
			frameHeight: height,
			signal,
			resolveBlob: args.resolveBlob,
		})
		sprites.set(shot.id, pending)
		spriteOrder.push(shot.id)
		while (spriteOrder.length > MAX_LIVE_SPRITES) {
			const evicted = spriteOrder.shift()
			if (!evicted || evicted === shot.id) continue
			release(sprites.get(evicted))
			sprites.delete(evicted)
		}
		return pending
	}

	// The first shot's picture is rasterised up front so a plan pointing at a
	// file that is not there fails before the model is downloaded rather than
	// forty seconds into a bake.
	try {
		await spriteFor(shots[0])
	} catch (error) {
		disposeSprites()
		throw error
	}

	/* ---------------------------------------------------------- the cut-out */

	const segmenter = await createPersonSegmenter({
		modelId: settings.model,
		smoothing: clamp(settings.smoothing, 0, 95) / 100,
		signal,
		onProgress: args.onProgress,
	}).catch((error) => {
		disposeSprites()
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
		disposeSprites()
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

		// The pre-roll exists only to warm the mask and the anchor up - and, since
		// it is already spending time here, the picture that is about to be
		// needed, so the frame the object first appears on is not the one that
		// pays for decoding it.
		if (!shot) {
			const upcoming = shots.find((entry) => ms >= entry.startMs - PREROLL_MS && ms < entry.startMs)
			// Swallowed here on purpose: this is a head start, not a load. If the
			// picture really cannot be read, the frame that needs it says so.
			if (upcoming) void spriteFor(upcoming).catch(() => {})
			return {}
		}

		const sprite = await spriteFor(shot)

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
			disposeSprites()
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
	/**
	 * The longest side the finished video may have. Left out, the clip keeps
	 * its own size; set, every pixel the bake touches shrinks with it - the
	 * frame, the cut-out's composite, and the objects, which are rasterised
	 * against the output rather than against the source.
	 */
	maxDimension?: number
	/** The highest frame rate the finished video may have. */
	maxFrameRate?: number
	/** How many seconds of the clip to write, from its start. */
	maxSeconds?: number
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
	// The object layer is composited into the *output* frame, so it has to be
	// planned against the output's size rather than the source's: at half the
	// width, "three heads across" is still three heads across, but only if the
	// head was measured on the frame the object lands in.
	const output = fitWithin(args.probe.width, args.probe.height, args.maxDimension ?? Infinity)
	const prepared = await prepareObjectLayer({
		shots: args.shots,
		settings: args.settings,
		probe: output,
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
			maxDimension: args.maxDimension,
			maxFrameRate: args.maxFrameRate,
			maxSeconds: args.maxSeconds,
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
   The moving preview.
   ========================================================================== */

/** The long side of a draft preview, in pixels. */
export const PREVIEW_MAX_DIMENSION = 480

/** The most frames a second a draft preview keeps. */
export const PREVIEW_MAX_FRAME_RATE = 15

/** How long a preview runs for before it stops, in seconds. */
export const PREVIEW_MAX_SECONDS = 30

/** The furthest a preview will run to reach an object that starts late. */
export const PREVIEW_HARD_LIMIT_SECONDS = 90

/**
 * How many seconds a preview of this plan should cover.
 *
 * Half a minute from the start, unless every object in the plan happens later
 * than that - a preview of a black-and-silent thirty seconds proves nothing,
 * so it runs on to the end of the first object instead, up to a limit that
 * keeps "preview" meaning "sooner than the export".
 */
export function previewSecondsFor(shots: ObjectShot[]): number {
	const firstObjectEndsAt = shots.reduce(
		(earliest, shot) => Math.min(earliest, shot.endMs),
		Number.POSITIVE_INFINITY,
	)
	if (!Number.isFinite(firstObjectEndsAt)) return PREVIEW_MAX_SECONDS
	const needed = firstObjectEndsAt / 1000 + 1
	return Math.min(PREVIEW_HARD_LIMIT_SECONDS, Math.max(PREVIEW_MAX_SECONDS, needed))
}

export type PreviewObjectVideoArgs = Omit<
	BakeObjectVideoArgs,
	'format' | 'quality' | 'maxDimension' | 'maxFrameRate' | 'maxSeconds'
> & {
	/** the long side of the preview, defaulting to `PREVIEW_MAX_DIMENSION` */
	maxDimension?: number
}

export type PreviewObjectVideoResult = BakeObjectVideoResult & {
	/** true when the clip was long enough that only its first shots were rendered */
	trimmed: boolean
	/** how many seconds of the clip the preview covers */
	previewSeconds: number
	/** how many of the plan's objects fall inside it */
	objectsShown: number
}

/**
 * The same bake, small enough to watch while you are still deciding.
 *
 * This exists because the full bake is the *only* way to see the objects move,
 * and on a long clip at full size that is minutes of work and more graphics
 * memory than a laptop has - which is the failure it is answering: an export
 * that dies two thirds of the way in tells you nothing about whether the
 * pictures were the right size.
 *
 * Three things are turned down, in the order they cost:
 *
 *   1. **The frame.** 480 pixels on its long side is a quarter of the height of
 *      a 1080x1920 clip, and so a sixteenth of its pixels. Everything
 *      downstream is proportional to that - the canvas, the encoder, the
 *      segmentation composite - so it is the setting that decides whether this
 *      runs at all.
 *   2. **The frame rate.** Fifteen frames a second, by dropping whole frames
 *      rather than resampling, halves the number of times the model runs and
 *      the encoder is called on ordinary footage.
 *   3. **The bitrate.** Draft quality, because nobody is judging compression
 *      here.
 *
 * What is *not* turned down is the pipeline: the same per-frame hook, the same
 * segmenter, the same compositor. The preview is the render, in miniature, so
 * an object that sits wrong here sits wrong in the finished video too.
 *
 * And it stops. Both tracks end together at `previewSecondsFor`, so ten minutes
 * of clip does not have to be re-encoded to look at the object in its first
 * half minute; objects past the window are dropped from the plan the preview
 * renders, so their pictures are never even rasterised. A plan whose every
 * object happens later than the window is the one case where the window moves,
 * because a preview of thirty silent seconds answers nothing.
 */
export async function previewObjectVideo(args: PreviewObjectVideoArgs): Promise<PreviewObjectVideoResult> {
	const previewSeconds = previewSecondsFor(args.shots)
	const shown = args.shots.filter((shot) => shot.startMs < previewSeconds * 1000)
	// Objects the preview will never reach are dropped from the plan it renders,
	// so their pictures are never fetched, rasterised or held.
	const shots = shown.length > 0 ? shown : args.shots.slice(0, 1)

	const result = await bakeObjectVideo({
		...args,
		shots,
		format: 'mp4',
		quality: 'draft',
		maxDimension: args.maxDimension ?? PREVIEW_MAX_DIMENSION,
		maxFrameRate: PREVIEW_MAX_FRAME_RATE,
		maxSeconds: previewSeconds,
	})
	return {
		...result,
		trimmed: shots.length < args.shots.length,
		previewSeconds,
		objectsShown: shots.length,
	}
}

/** One line about a preview, in the same voice the bake's report uses. */
export function describeObjectPreview(result: PreviewObjectVideoResult): string {
	// The window it was asked for, or the clip, whichever ran out first: a
	// five-second clip previewed "for thirty seconds" reads as a bug.
	const covered = Math.min(result.previewSeconds, result.durationSeconds)
	const parts = [
		`The first ${Math.round(covered)}s at ${result.width}x${result.height}, ${Math.round(
			result.fps,
		)} frames a second`,
		`${result.objectsShown} object${result.objectsShown === 1 ? '' : 's'} in it`,
		`rendered in ${result.elapsedSeconds.toFixed(1)}s`,
	]
	if (result.trimmed) {
		parts.push('the objects later in the clip are still in the plan, they are just past the preview')
	}
	parts.push('the clip itself has not been touched')
	return parts.join('; ')
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
