'use client'

/**
 * Reframing onto a new aspect ratio without cropping anything away - the
 * "landscape clip, vertical post" problem.
 *
 * There are only two honest ways to change a clip's shape: throw away the
 * sides, or keep the whole picture and put something behind it. The aspect
 * crop tool does the first. This does the second, and what goes behind is the
 * whole design question - a black bar reads as a mistake, a blurred blow-up of
 * the clip itself reads as intentional, which is why every social editor
 * offers exactly that.
 *
 * The backdrop is built by scaling the frame up until it covers the new
 * canvas and blurring it hard. Two details make it look right rather than
 * cheap:
 *
 * - **The blur is done small and scaled up.** A 320-pixel-wide copy blurred by
 *   a few pixels and then drawn across a 1080-wide canvas is both far cheaper
 *   than a full-resolution blur and *smoother*, because the upscale is itself
 *   a low-pass filter. A full-res blur of the same apparent radius costs
 *   twenty times as much and looks no better.
 * - **The backdrop is dimmed and desaturated slightly.** An undimmed blow-up
 *   competes with the picture in the middle of it; pulling it down a stop is
 *   what makes the eye read one as foreground and the other as wallpaper.
 *
 * It hangs off `underlayPass`, the one seam in `frame-ops.ts` that runs
 * *before* the picture is drawn - because a backdrop that ran afterwards
 * would be painting over the thing it is meant to be behind.
 */

import { drawFitted, type PlateFit } from './background-replace'
import type { FrameOpsParams, FramePass } from './frame-ops'
import type { CaptionVideoSource } from '../captions/types'
import type { PerFrameHook } from './video-filter'

export type CanvasBackdrop = 'blur' | 'color' | 'gradient' | 'image'

export const CANVAS_BACKDROPS: Array<{ id: CanvasBackdrop; label: string; blurb: string }> = [
	{ id: 'blur', label: 'Blurred blow-up of the clip', blurb: 'The usual social-video look, and the safest.' },
	{ id: 'color', label: 'A flat colour', blurb: 'Clean, and it keeps the file small.' },
	{ id: 'gradient', label: 'A two-colour gradient', blurb: 'A branded backdrop without an image to load.' },
	{ id: 'image', label: 'An image you upload', blurb: 'Your own plate behind the clip.' },
]

/** The output sizes offered, chosen to be even and to encode cleanly. */
export const CANVAS_ASPECTS: Record<string, [number, number]> = {
	'9:16': [1080, 1920],
	'1:1': [1080, 1080],
	'4:5': [1080, 1350],
	'16:9': [1920, 1080],
	'4:3': [1440, 1080],
	'2:1': [1920, 960],
}

export type CanvasBackgroundParams = {
	aspect: string
	backdrop: CanvasBackdrop
	/** 0-100; how hard the blurred backdrop is blurred */
	blurStrength: number
	/** 0-100; how far the backdrop is pulled down behind the picture */
	dim: number
	color: string
	colorB: string
	/** 0-100; the picture's own size inside the new canvas */
	foregroundScale: number
}

export type PreparedCanvasBackground = {
	/** merged into the render's `FrameOpsParams` before the per-frame hook runs */
	params: FrameOpsParams
	perFrame: PerFrameHook | undefined
	summary: string
	dispose(): void
}

function makeCanvas(width: number, height: number): { canvas: OffscreenCanvas; ctx: OffscreenCanvasRenderingContext2D } | null {
	if (typeof OffscreenCanvas === 'undefined') return null
	const canvas = new OffscreenCanvas(Math.max(1, width), Math.max(1, height))
	const ctx = canvas.getContext('2d')
	if (!ctx) return null
	return { canvas, ctx }
}

/** The width the small blur copy is rendered at - big enough to keep shape, small enough to be free. */
const BLUR_SOURCE_WIDTH = 320

export async function prepareCanvasBackground(args: {
	params: CanvasBackgroundParams
	probe: CaptionVideoSource
	plateFile: File | null
	signal: AbortSignal
}): Promise<PreparedCanvasBackground> {
	const { params } = args
	const [targetWidth, targetHeight] = CANVAS_ASPECTS[params.aspect] ?? CANVAS_ASPECTS['9:16']
	const dim = Math.min(1, Math.max(0, params.dim / 100))
	const foregroundScale = Math.min(1, Math.max(0.2, params.foregroundScale / 100))

	let plate: ImageBitmap | null = null
	if (params.backdrop === 'image') {
		if (!args.plateFile) throw new Error('Choose the backdrop image first.')
		plate = await createImageBitmap(args.plateFile)
	}

	// A still backdrop is drawn once and reused; only the blurred blow-up has
	// to be rebuilt as the picture changes.
	let stillBackdrop: OffscreenCanvas | null = null
	if (params.backdrop !== 'blur') {
		const built = makeCanvas(targetWidth, targetHeight)
		if (built) {
			const { ctx } = built
			if (params.backdrop === 'gradient') {
				const gradient = ctx.createLinearGradient(0, 0, targetWidth, targetHeight)
				gradient.addColorStop(0, params.color)
				gradient.addColorStop(1, params.colorB)
				ctx.fillStyle = gradient
			} else {
				ctx.fillStyle = params.color
			}
			ctx.fillRect(0, 0, targetWidth, targetHeight)
			if (plate) drawFitted(ctx, plate, plate.width, plate.height, targetWidth, targetHeight, 'cover' as PlateFit)
			stillBackdrop = built.canvas
		}
	}

	const small = params.backdrop === 'blur' ? makeCanvas(BLUR_SOURCE_WIDTH, 2) : null
	// The blur is a draw, not a filter on existing pixels, so it needs a second
	// surface to read from - a canvas cannot be both the source and the
	// destination of a filtered draw without the browser snapshotting it first.
	const smallSource = small ? makeCanvas(BLUR_SOURCE_WIDTH, 2) : null

	const underlayPass: FramePass = {
		apply(ctx, width, height) {
			ctx.save()
			ctx.filter = 'none'
			ctx.globalAlpha = 1
			ctx.globalCompositeOperation = 'source-over'
			if (stillBackdrop) {
				ctx.drawImage(stillBackdrop as unknown as CanvasImageSource, 0, 0, width, height)
			} else if (small) {
				// Cover, not contain: the backdrop must reach every edge, and any
				// part of it that falls outside the canvas is exactly the part
				// nobody was going to look at.
				const scale = Math.max(width / small.canvas.width, height / small.canvas.height)
				const drawWidth = small.canvas.width * scale
				const drawHeight = small.canvas.height * scale
				ctx.drawImage(small.canvas as unknown as CanvasImageSource, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight)
			} else {
				ctx.fillStyle = params.color
				ctx.fillRect(0, 0, width, height)
			}
			if (dim > 0) {
				ctx.fillStyle = `rgba(0,0,0,${dim.toFixed(3)})`
				ctx.fillRect(0, 0, width, height)
			}
			ctx.restore()
		},
	}

	const perFrame: PerFrameHook | undefined =
		small && smallSource
			? async (_frameIndex, _timestamp, frame) => {
				const height = Math.max(2, Math.round((frame.height / Math.max(1, frame.width)) * BLUR_SOURCE_WIDTH))
				if (small.canvas.height !== height) small.canvas.height = height
				if (smallSource.canvas.height !== height) smallSource.canvas.height = height
				smallSource.ctx.clearRect(0, 0, smallSource.canvas.width, height)
				frame.drawTo(smallSource.ctx, smallSource.canvas.width, height)

				const radius = Math.max(1, Math.round((params.blurStrength / 100) * 18))
				small.ctx.filter = `blur(${radius}px)`
				small.ctx.clearRect(0, 0, small.canvas.width, height)
				small.ctx.drawImage(smallSource.canvas, 0, 0)
				small.ctx.filter = 'none'
				// Desaturating the backdrop is what stops it competing with the
				// picture sitting in the middle of it.
				small.ctx.globalCompositeOperation = 'saturation'
				small.ctx.fillStyle = 'hsl(0, 55%, 50%)'
				small.ctx.fillRect(0, 0, small.canvas.width, height)
				small.ctx.globalCompositeOperation = 'source-over'
				return {}
			}
		: undefined

	const backdropLabel = CANVAS_BACKDROPS.find((entry) => entry.id === params.backdrop)?.label ?? params.backdrop
	return {
		params: {
			targetWidth,
			targetHeight,
			fit: 'contain',
			padColor: params.color,
			underlayPass,
			transform:
				foregroundScale !== 1
					? { scale: foregroundScale, rotateDeg: 0, offsetX: 0, offsetY: 0 }
					: null,
		},
		perFrame,
		summary: `${args.probe.width}x${args.probe.height} reframed to ${targetWidth}x${targetHeight} (${params.aspect}) on ${backdropLabel.toLowerCase()}`,
		dispose() {
			plate?.close()
		},
	}
}
