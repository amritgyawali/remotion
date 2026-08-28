'use client'

/**
 * Wiring the background remover into the render loop.
 *
 * Three separate pieces have to meet once per frame - the segmenter that
 * finds the person, the plate that goes behind them, and the compositor that
 * puts the two together - and none of them should know about the other two.
 * This is the only file that does, which is why it is here rather than as a
 * branch inside `runners.ts`: it opens the model, decides what the new
 * background is, and hands back a single `PerFrameHook` that the renderer and
 * the still preview can both use unchanged.
 *
 * Two decisions are worth calling out.
 *
 * The model is fed a small copy of the frame, not the frame. MediaPipe
 * resizes whatever it is given to the model's own 256x256 input, so handing
 * it a 1080p frame buys nothing and costs an upsampled mask of two million
 * floats to copy back every frame. A 256-wide copy goes through the identical
 * internal resize and comes back small enough to turn into a texture for
 * free.
 *
 * A still background is drawn once. A photo or a colour does not change from
 * frame to frame, so the fitted plate is built when the tool starts and
 * re-uploaded as-is; only a video background is redrawn, and it loops if it
 * is shorter than the clip rather than freezing on its last frame.
 */

import type { CaptionVideoSource } from '../captions/types'
import {
	createBackgroundCompositor,
	drawFitted,
	renderStillPlate,
	type BackgroundSettings,
	type PlateFit,
} from './background-replace'
import { createPersonSegmenter, type SegmentationModelId, type SegmentationProgress } from './segmentation'
import { openSecondaryVideoSource, type PerFrameHook } from './video-filter'

export type BackgroundMode = 'upload' | 'blur' | 'color'

export type BackgroundReplaceParams = {
	mode: BackgroundMode
	color: string
	fit: PlateFit
	/** background blur, as a percentage of frame height */
	blurPercent: number
	model: SegmentationModelId
	/** every one of these is a 0-100 slider except `edgeShift`, which is -50 to 50 */
	feather: number
	matte: number
	edgeShift: number
	edgeClean: number
	lightWrap: number
	smoothing: number
	showMatte: boolean
}

export type PreparedBackground = {
	perFrame: PerFrameHook
	/** true when the composite ran without a GPU, so there is no wrap or fringe clean-up */
	degraded: boolean
	/** what actually happened, for the output panel to report honestly */
	summary: string
	dispose(): void
}

export type PrepareBackgroundArgs = {
	params: BackgroundReplaceParams
	probe: CaptionVideoSource
	/** the photo or clip to put behind the subject, for the `upload` mode */
	plateFile: File | null
	signal: AbortSignal
	onProgress?: (progress: SegmentationProgress) => void
}

/** The long side of the copy handed to the model. */
const MODEL_INPUT_WIDTH = 256

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))

function isVideoFile(file: File): boolean {
	return file.type.startsWith('video/') || /\.(mp4|mov|webm|mkv|m4v|avi)$/i.test(file.name)
}

export async function prepareBackgroundReplace(args: PrepareBackgroundArgs): Promise<PreparedBackground> {
	const { params, probe, signal } = args
	const width = probe.width
	const height = probe.height

	const settings: BackgroundSettings = {
		// The sliders are percentages; the compositor works in fractions of the
		// frame's height so a setting means the same thing at any resolution.
		feather: clamp(params.feather, 0, 100) / 100 * 0.04,
		matte: clamp(params.matte, 0, 100) / 100,
		edgeShift: clamp(params.edgeShift, -50, 50) / 100,
		edgeClean: clamp(params.edgeClean, 0, 100) / 100,
		lightWrap: clamp(params.lightWrap, 0, 100) / 100,
		blurPlate: clamp(params.blurPercent, 0.5, 20) / 100,
		debug: params.showMatte,
	}

	/* ------------------------------------------------------------- plate */

	let staticPlate: OffscreenCanvas | null = null
	let videoPlate: Awaited<ReturnType<typeof openSecondaryVideoSource>> | null = null
	let videoPlateCanvas: OffscreenCanvas | null = null
	let videoPlateCtx: OffscreenCanvasRenderingContext2D | null = null
	let plateBitmap: ImageBitmap | null = null
	let plateLabel = ''

	if (params.mode === 'color') {
		staticPlate = renderStillPlate({ width, height, color: params.color, image: null, fit: params.fit })
		plateLabel = `a solid ${params.color}`
	} else if (params.mode === 'blur') {
		plateLabel = `the original room, blurred by ${params.blurPercent}%`
	} else {
		if (!args.plateFile) throw new Error('Choose the photo or video to put behind the person first.')
		if (isVideoFile(args.plateFile)) {
			videoPlate = await openSecondaryVideoSource(args.plateFile)
			videoPlateCanvas = new OffscreenCanvas(width, height)
			videoPlateCtx = videoPlateCanvas.getContext('2d')
			if (!videoPlateCtx) throw new Error('This browser has no 2D canvas context to draw the background with.')
			plateLabel = `${args.plateFile.name}, looped`
		} else {
			plateBitmap = await createImageBitmap(args.plateFile).catch(() => {
				throw new Error(`"${args.plateFile?.name}" could not be read as an image.`)
			})
			staticPlate = renderStillPlate({
				width,
				height,
				color: '#000000',
				image: { source: plateBitmap, width: plateBitmap.width, height: plateBitmap.height },
				fit: params.fit,
			})
			plateLabel = args.plateFile.name
		}
	}

	/* --------------------------------------------------------- segmenter */

	const segmenter = await createPersonSegmenter({
		modelId: params.model,
		smoothing: clamp(params.smoothing, 0, 95) / 100,
		signal,
		onProgress: args.onProgress,
	}).catch((error) => {
		plateBitmap?.close()
		videoPlate?.dispose()
		throw error
	})

	const compositor = createBackgroundCompositor(settings)

	const inputWidth = MODEL_INPUT_WIDTH
	const inputHeight = Math.max(64, Math.round((MODEL_INPUT_WIDTH * height) / Math.max(width, 1)))
	const inputCanvas = new OffscreenCanvas(inputWidth, inputHeight)
	const inputCtx = inputCanvas.getContext('2d', { willReadFrequently: false })
	if (!inputCtx) {
		segmenter.close()
		compositor.dispose()
		throw new Error('This browser has no 2D canvas context to hand the model a frame with.')
	}

	const perFrame: PerFrameHook = async (_frameIndex, timestampSeconds, frame) => {
		inputCtx.clearRect(0, 0, inputWidth, inputHeight)
		frame.drawTo(inputCtx, inputWidth, inputHeight)
		const mask = segmenter.segment(inputCanvas, timestampSeconds * 1000)

		let plate: OffscreenCanvas | null = staticPlate
		if (videoPlate && videoPlateCanvas && videoPlateCtx) {
			// A background clip shorter than the footage repeats rather than
			// freezing - a frozen plate reads as a crash, a loop reads as a choice.
			const loopedAt = videoPlate.durationSeconds > 0 ? timestampSeconds % videoPlate.durationSeconds : 0
			const source = await videoPlate.getFrameAt(loopedAt)
			if (source) {
				videoPlateCtx.clearRect(0, 0, width, height)
				drawFitted(videoPlateCtx, source.canvas, source.naturalWidth, source.naturalHeight, width, height, params.fit)
				plate = videoPlateCanvas
			}
		}

		compositor.setFrame({ mask: mask.canvas, maskWidth: mask.width, maskHeight: mask.height, plate })
		return { patch: { backgroundPass: compositor.pass } }
	}

	const summary = params.showMatte
		? 'showing the cut-out itself'
		: `${params.model === 'precise' ? 'precise' : 'balanced'} detection over ${plateLabel}${
				compositor.degraded ? ', composited without a GPU' : ''
			}`

	return {
		perFrame,
		degraded: compositor.degraded,
		summary,
		dispose() {
			segmenter.close()
			compositor.dispose()
			videoPlate?.dispose()
			plateBitmap?.close()
		},
	}
}
