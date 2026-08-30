'use client'

/**
 * Shape masks: circle, rectangle, linear, mirror, heart, star and the rest,
 * with a feathered edge, a rotation, and a choice of what happens to
 * everything *outside* them.
 *
 * A mask on its own does nothing visible - it is a stencil, and a stencil is
 * only interesting next to something. So this module pairs the stencil with a
 * treatment for the region it does not cover: blur it, darken it, drain the
 * colour out of it, block it into pixels, or paint it flat. That covers what
 * masks are actually used for in an edit - a spotlight on a face, a blurred
 * plate behind a title, a censored number plate, a split-tone reveal - without
 * needing a compositor or a layer stack.
 *
 * The compositing is done with `destination-out` against a feathered stencil
 * rather than by testing each pixel, because the browser's own compositor is
 * both faster and correctly antialiased at the shape's edge. A hand-rolled
 * per-pixel mask would show stair-stepping on every diagonal in the star.
 */

type Ctx2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D

export type MaskShape =
	| 'rectangle'
	| 'rounded'
	| 'circle'
	| 'ellipse'
	| 'linear'
	| 'mirror'
	| 'triangle'
	| 'diamond'
	| 'hexagon'
	| 'star'
	| 'heart'

export type MaskTreatment = 'blur' | 'darken' | 'desaturate' | 'pixelate' | 'color'

export const MASK_SHAPES: Array<{ id: MaskShape; label: string }> = [
	{ id: 'circle', label: 'Circle' },
	{ id: 'ellipse', label: 'Ellipse' },
	{ id: 'rectangle', label: 'Rectangle' },
	{ id: 'rounded', label: 'Rounded rectangle' },
	{ id: 'linear', label: 'Linear (half the frame)' },
	{ id: 'mirror', label: 'Mirror (a band across)' },
	{ id: 'triangle', label: 'Triangle' },
	{ id: 'diamond', label: 'Diamond' },
	{ id: 'hexagon', label: 'Hexagon' },
	{ id: 'star', label: 'Star' },
	{ id: 'heart', label: 'Heart' },
]

export const MASK_TREATMENTS: Array<{ id: MaskTreatment; label: string }> = [
	{ id: 'blur', label: 'Blur it' },
	{ id: 'darken', label: 'Darken it' },
	{ id: 'desaturate', label: 'Drain the colour out of it' },
	{ id: 'pixelate', label: 'Block it into pixels' },
	{ id: 'color', label: 'Paint it flat' },
]

export type MaskSettings = {
	shape: MaskShape
	/** centre of the shape, as a fraction of the frame */
	centerX: number
	centerY: number
	/** the shape's long axis, as a fraction of the smaller side of the frame */
	size: number
	/** height relative to `size`; 1 is round, 0.5 is half as tall */
	ratio: number
	/** degrees, clockwise */
	rotation: number
	/** 0-1; the width of the soft edge, relative to the shape */
	feather: number
	/** swap which side of the stencil gets the treatment */
	invert: boolean
	treatment: MaskTreatment
	/** 0-1; how strongly the treatment is applied */
	strength: number
	/** used by the `color` treatment */
	color: string
}

export type MaskPass = {
	apply(ctx: Ctx2D, width: number, height: number, frameIndex: number): void
	dispose(): void
}

/** Traces the shape into the current path, centred on the origin. */
function tracePath(ctx: Ctx2D, shape: MaskShape, radiusX: number, radiusY: number): void {
	ctx.beginPath()
	switch (shape) {
		case 'rectangle':
			ctx.rect(-radiusX, -radiusY, radiusX * 2, radiusY * 2)
			break
		case 'rounded': {
			const radius = Math.min(radiusX, radiusY) * 0.28
			ctx.roundRect(-radiusX, -radiusY, radiusX * 2, radiusY * 2, radius)
			break
		}
		case 'circle':
			ctx.arc(0, 0, radiusX, 0, Math.PI * 2)
			break
		case 'ellipse':
			ctx.ellipse(0, 0, radiusX, radiusY, 0, 0, Math.PI * 2)
			break
		case 'linear':
			// A half-plane: the rectangle is deliberately far larger than the
			// frame so that rotating it never uncovers a corner.
			ctx.rect(-radiusX * 40, -radiusY * 40, radiusX * 80, radiusY * 40)
			break
		case 'mirror':
			ctx.rect(-radiusX * 40, -radiusY, radiusX * 80, radiusY * 2)
			break
		case 'triangle':
			ctx.moveTo(0, -radiusY)
			ctx.lineTo(radiusX, radiusY)
			ctx.lineTo(-radiusX, radiusY)
			ctx.closePath()
			break
		case 'diamond':
			ctx.moveTo(0, -radiusY)
			ctx.lineTo(radiusX, 0)
			ctx.lineTo(0, radiusY)
			ctx.lineTo(-radiusX, 0)
			ctx.closePath()
			break
		case 'hexagon':
			for (let i = 0; i < 6; i++) {
				const angle = (Math.PI / 3) * i - Math.PI / 2
				const x = Math.cos(angle) * radiusX
				const y = Math.sin(angle) * radiusY
				if (i === 0) ctx.moveTo(x, y)
				else ctx.lineTo(x, y)
			}
			ctx.closePath()
			break
		case 'star': {
			const points = 5
			for (let i = 0; i < points * 2; i++) {
				const reach = i % 2 === 0 ? 1 : 0.42
				const angle = (Math.PI / points) * i - Math.PI / 2
				const x = Math.cos(angle) * radiusX * reach
				const y = Math.sin(angle) * radiusY * reach
				if (i === 0) ctx.moveTo(x, y)
				else ctx.lineTo(x, y)
			}
			ctx.closePath()
			break
		}
		case 'heart': {
			// Two bezier lobes meeting at a point, drawn from the bottom tip up -
			// the standard construction, scaled to the shape's box.
			const w = radiusX
			const h = radiusY
			ctx.moveTo(0, h)
			ctx.bezierCurveTo(-w * 1.35, h * 0.18, -w * 0.72, -h * 1.15, 0, -h * 0.35)
			ctx.bezierCurveTo(w * 0.72, -h * 1.15, w * 1.35, h * 0.18, 0, h)
			ctx.closePath()
			break
		}
	}
}

function makeCanvas(width: number, height: number): { canvas: OffscreenCanvas; ctx: OffscreenCanvasRenderingContext2D } | null {
	if (typeof OffscreenCanvas === 'undefined') return null
	const canvas = new OffscreenCanvas(Math.max(1, width), Math.max(1, height))
	const ctx = canvas.getContext('2d')
	if (!ctx) return null
	return { canvas, ctx }
}

/**
 * Draws the stencil: opaque white where the shape is, transparent elsewhere,
 * with `feather` turned into a real blur radius so the edge falls off instead
 * of cutting.
 */
function renderStencil(target: { canvas: OffscreenCanvas; ctx: OffscreenCanvasRenderingContext2D }, settings: MaskSettings, width: number, height: number): void {
	const { ctx } = target
	if (target.canvas.width !== width || target.canvas.height !== height) {
		target.canvas.width = width
		target.canvas.height = height
	}
	ctx.setTransform(1, 0, 0, 1, 0, 0)
	ctx.clearRect(0, 0, width, height)

	const base = Math.min(width, height)
	const radiusX = Math.max(1, base * settings.size * 0.5)
	const radiusY = Math.max(1, radiusX * Math.max(0.05, settings.ratio))
	const featherPx = Math.max(0, settings.feather * radiusX * 0.6)

	ctx.save()
	// The blur has to be set before the fill, and it shrinks the solid core -
	// so the path is grown by half the radius to keep the shape the size the
	// slider says it is.
	ctx.filter = featherPx > 0.5 ? `blur(${featherPx.toFixed(2)}px)` : 'none'
	ctx.translate(settings.centerX * width, settings.centerY * height)
	if (settings.rotation) ctx.rotate((settings.rotation * Math.PI) / 180)
	ctx.fillStyle = '#ffffff'
	tracePath(ctx, settings.shape, radiusX + featherPx * 0.5, radiusY + featherPx * 0.5)
	ctx.fill()
	ctx.restore()
	ctx.filter = 'none'
}

/** Paints the treated version of the whole frame onto `target`. */
function renderTreatment(
	target: { canvas: OffscreenCanvas; ctx: OffscreenCanvasRenderingContext2D },
	source: CanvasImageSource,
	settings: MaskSettings,
	width: number,
	height: number,
): void {
	const { ctx } = target
	if (target.canvas.width !== width || target.canvas.height !== height) {
		target.canvas.width = width
		target.canvas.height = height
	}
	const strength = Math.min(1, Math.max(0, settings.strength))
	ctx.setTransform(1, 0, 0, 1, 0, 0)
	ctx.clearRect(0, 0, width, height)
	ctx.globalAlpha = 1
	ctx.filter = 'none'

	switch (settings.treatment) {
		case 'blur':
			ctx.filter = `blur(${Math.max(1, Math.round(Math.min(width, height) * 0.04 * strength))}px)`
			ctx.drawImage(source, 0, 0, width, height)
			ctx.filter = 'none'
			break
		case 'darken':
			ctx.drawImage(source, 0, 0, width, height)
			ctx.fillStyle = `rgba(0,0,0,${(strength * 0.85).toFixed(3)})`
			ctx.fillRect(0, 0, width, height)
			break
		case 'desaturate':
			ctx.filter = `grayscale(${strength})`
			ctx.drawImage(source, 0, 0, width, height)
			ctx.filter = 'none'
			break
		case 'pixelate': {
			// Down then up with smoothing off is the cheapest correct way to
			// block a frame: the browser does both resamples on the GPU.
			const blocks = Math.max(4, Math.round(90 - strength * 78))
			const smallWidth = Math.max(2, Math.round(blocks * (width / Math.max(1, height))))
			const scratch = makeCanvas(smallWidth, blocks)
			if (scratch) {
				scratch.ctx.drawImage(source, 0, 0, smallWidth, blocks)
				ctx.imageSmoothingEnabled = false
				ctx.drawImage(scratch.canvas, 0, 0, width, height)
				ctx.imageSmoothingEnabled = true
			} else {
				ctx.drawImage(source, 0, 0, width, height)
			}
			break
		}
		case 'color':
			ctx.drawImage(source, 0, 0, width, height)
			ctx.globalAlpha = strength
			ctx.fillStyle = settings.color
			ctx.fillRect(0, 0, width, height)
			ctx.globalAlpha = 1
			break
	}
}

export function createMaskPass(settings: MaskSettings): MaskPass {
	let stencil = makeCanvas(2, 2)
	let treated = makeCanvas(2, 2)
	let frameCopy = makeCanvas(2, 2)
	let lastWidth = -1
	let lastHeight = -1

	return {
		apply(ctx, width, height) {
			if (!stencil || !treated || !frameCopy) return

			// The frame is about to be painted over, so the treatment has to read
			// from a copy of it rather than from the canvas it is being written to.
			if (frameCopy.canvas.width !== width || frameCopy.canvas.height !== height) {
				frameCopy.canvas.width = width
				frameCopy.canvas.height = height
			}
			frameCopy.ctx.clearRect(0, 0, width, height)
			frameCopy.ctx.drawImage(ctx.canvas as unknown as CanvasImageSource, 0, 0)

			// The stencil only depends on the settings and the frame size, so it
			// is rendered once and reused for every frame of the clip.
			if (width !== lastWidth || height !== lastHeight) {
				renderStencil(stencil, settings, width, height)
				lastWidth = width
				lastHeight = height
			}

			renderTreatment(treated, frameCopy.canvas, settings, width, height)

			// Punch the shape out of the treated copy, so what is left is only the
			// part that should replace the original.
			treated.ctx.save()
			treated.ctx.globalCompositeOperation = settings.invert ? 'destination-in' : 'destination-out'
			treated.ctx.drawImage(stencil.canvas, 0, 0)
			treated.ctx.restore()

			ctx.save()
			ctx.globalCompositeOperation = 'source-over'
			ctx.drawImage(treated.canvas as unknown as CanvasImageSource, 0, 0)
			ctx.restore()
		},
		dispose() {
			stencil = null
			treated = null
			frameCopy = null
		},
	}
}
