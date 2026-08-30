'use client'

/**
 * Layer blending: a second clip or a still image laid over the footage with
 * one of seventeen blend modes.
 *
 * This is the other half of compositing, next to the chroma key. A key
 * decides *which pixels* of the overlay survive; a blend mode decides *how
 * the ones that survive combine* with what is underneath. Between them they
 * cover almost everything an editor stacks a second layer for: light leaks
 * and lens flares on `screen`, textures and paper grain on `multiply`,
 * dust and scratch plates on `lighten`, colour washes on `color`, and a plain
 * `normal` for a straight picture-in-picture.
 *
 * Every mode here is a real Porter-Duff or separable blend implemented by the
 * browser's own compositor via `globalCompositeOperation`, not an
 * approximation - which matters, because the non-separable four (`hue`,
 * `saturation`, `color`, `luminosity`) are defined in terms of a luminance
 * and saturation transfer that is genuinely awkward to get right by hand, and
 * the browser already ships the spec-correct version.
 *
 * The overlay is drawn onto a frame-sized scratch canvas first and blended
 * from there, rather than being blended directly at its own size and
 * position. That costs one extra draw and buys correctness: a blend mode
 * applies everywhere the source layer has coverage, so blending a
 * quarter-size overlay straight onto the frame would leave the other
 * three-quarters composited against transparent black - which for `multiply`
 * means a black rectangle over most of the picture.
 */

import { anchorPoint, type AnchorPosition, type FramePass } from './frame-ops'
import { openSecondaryVideoSource, type PerFrameHook, type SecondaryVideoSource } from './video-filter'

type Ctx2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D

export type BlendMode =
	| 'normal'
	| 'multiply'
	| 'screen'
	| 'overlay'
	| 'darken'
	| 'lighten'
	| 'color-dodge'
	| 'color-burn'
	| 'hard-light'
	| 'soft-light'
	| 'difference'
	| 'exclusion'
	| 'hue'
	| 'saturation'
	| 'color'
	| 'luminosity'
	| 'add'

export const BLEND_MODES: Array<{ id: BlendMode; label: string; blurb: string }> = [
	{ id: 'normal', label: 'Normal', blurb: 'Straight on top, no interaction.' },
	{ id: 'screen', label: 'Screen', blurb: 'Black disappears - the mode for light leaks and flares.' },
	{ id: 'add', label: 'Add (linear dodge)', blurb: 'Brighter than screen, and it clips - for hard light hits.' },
	{ id: 'multiply', label: 'Multiply', blurb: 'White disappears - the mode for textures and paper grain.' },
	{ id: 'overlay', label: 'Overlay', blurb: 'Multiplies the shadows and screens the highlights.' },
	{ id: 'soft-light', label: 'Soft Light', blurb: 'A gentler overlay - good for tinting without wrecking contrast.' },
	{ id: 'hard-light', label: 'Hard Light', blurb: 'Overlay with the layers the other way round.' },
	{ id: 'darken', label: 'Darken', blurb: 'Keeps whichever layer is darker at each pixel.' },
	{ id: 'lighten', label: 'Lighten', blurb: 'Keeps whichever layer is lighter - for dust and scratch plates.' },
	{ id: 'color-dodge', label: 'Colour Dodge', blurb: 'Blows out the highlights fast.' },
	{ id: 'color-burn', label: 'Colour Burn', blurb: 'Drives the shadows down hard.' },
	{ id: 'difference', label: 'Difference', blurb: 'The absolute gap between the two layers.' },
	{ id: 'exclusion', label: 'Exclusion', blurb: 'A softer, lower-contrast difference.' },
	{ id: 'hue', label: 'Hue', blurb: "The overlay's hue over the footage's brightness and saturation." },
	{ id: 'saturation', label: 'Saturation', blurb: "The overlay's saturation, nothing else." },
	{ id: 'color', label: 'Colour', blurb: 'Hue and saturation from the overlay, luminance from the footage.' },
	{ id: 'luminosity', label: 'Luminosity', blurb: 'Brightness from the overlay, colour from the footage.' },
]

/**
 * Canvas names the additive mode differently from the CSS blend-mode list, and
 * the cast is deliberate: `plus-lighter` is in the spec and shipping, but is
 * missing from the DOM typings this project builds against.
 */
function compositeOperation(mode: BlendMode): GlobalCompositeOperation {
	if (mode === 'normal') return 'source-over'
	if (mode === 'add') return 'plus-lighter' as GlobalCompositeOperation
	return mode as GlobalCompositeOperation
}

export type BlendPlacement = 'fill' | AnchorPosition
export type BlendFit = 'cover' | 'contain' | 'stretch'

export type BlendSettings = {
	mode: BlendMode
	/** 0-1 */
	opacity: number
	placement: BlendPlacement
	fit: BlendFit
	/** fraction of the frame width, for an anchored (not filling) overlay */
	scale: number
}

export type BlendLayer = { source: CanvasImageSource; width: number; height: number }

export type BlendCompositor = {
	pass: FramePass
	setLayer(layer: BlendLayer | null): void
	dispose(): void
}

/** Where the overlay lands, in output pixels. */
export function placeLayer(
	settings: BlendSettings,
	frameWidth: number,
	frameHeight: number,
	layerWidth: number,
	layerHeight: number,
): { x: number; y: number; width: number; height: number } {
	const aspect = layerHeight / Math.max(layerWidth, 1)
	if (settings.placement === 'fill') {
		if (settings.fit === 'stretch') return { x: 0, y: 0, width: frameWidth, height: frameHeight }
		const scale =
			settings.fit === 'cover'
				? Math.max(frameWidth / layerWidth, frameHeight / layerHeight)
				: Math.min(frameWidth / layerWidth, frameHeight / layerHeight)
		const width = layerWidth * scale
		const height = layerHeight * scale
		return { x: (frameWidth - width) / 2, y: (frameHeight - height) / 2, width, height }
	}
	const width = frameWidth * settings.scale
	const height = width * aspect
	const margin = Math.round(Math.min(frameWidth, frameHeight) * 0.04)
	const { x, y } = anchorPoint(settings.placement, frameWidth, frameHeight, width, height, margin)
	return { x, y, width, height }
}

export function createBlendCompositor(settings: BlendSettings): BlendCompositor {
	let scratchCanvas: OffscreenCanvas | null = null
	let scratchCtx: OffscreenCanvasRenderingContext2D | null = null
	let layer: BlendLayer | null = null
	const operation = compositeOperation(settings.mode)

	const ensureScratch = (width: number, height: number): OffscreenCanvasRenderingContext2D | null => {
		if (typeof OffscreenCanvas === 'undefined') return null
		if (!scratchCanvas || !scratchCtx) {
			scratchCanvas = new OffscreenCanvas(width, height)
			scratchCtx = scratchCanvas.getContext('2d')
		} else if (scratchCanvas.width !== width || scratchCanvas.height !== height) {
			scratchCanvas.width = width
			scratchCanvas.height = height
		}
		return scratchCtx
	}

	const pass: FramePass = {
		apply(ctx: Ctx2D, width: number, height: number) {
			if (!layer) return
			const rect = placeLayer(settings, width, height, layer.width, layer.height)

			// `normal` is the one mode that composites correctly wherever the
			// overlay has no coverage - so it skips the scratch canvas entirely.
			if (operation === 'source-over') {
				ctx.save()
				ctx.globalAlpha = settings.opacity
				ctx.drawImage(layer.source, rect.x, rect.y, rect.width, rect.height)
				ctx.restore()
				return
			}

			const scratch = ensureScratch(width, height)
			if (!scratch || !scratchCanvas) return
			// Filling with the blend's identity - black for the additive family,
			// white for the subtractive one - makes the untouched area a no-op
			// instead of a rectangle.
			scratch.globalCompositeOperation = 'source-over'
			scratch.globalAlpha = 1
			scratch.fillStyle = identityColour(settings.mode)
			scratch.fillRect(0, 0, width, height)
			scratch.drawImage(layer.source, rect.x, rect.y, rect.width, rect.height)

			ctx.save()
			ctx.globalCompositeOperation = operation
			ctx.globalAlpha = settings.opacity
			ctx.drawImage(scratchCanvas as unknown as CanvasImageSource, 0, 0)
			ctx.restore()
			// A composite operation left set would silently change how the next
			// pass - a watermark, a text burn-in - lands on the frame.
			ctx.globalCompositeOperation = 'source-over'
		},
	}

	return {
		pass,
		setLayer(next) {
			layer = next
		},
		dispose() {
			scratchCanvas = null
			scratchCtx = null
			layer = null
		},
	}
}

/**
 * The colour that leaves the underlying frame untouched under a given mode.
 *
 * Black for anything that adds light, white for anything that removes it, and
 * mid-grey for the overlay family that pivots at 50%. Getting this wrong is
 * what makes a small overlay print a hard rectangle onto the picture.
 */
function identityColour(mode: BlendMode): string {
	switch (mode) {
		case 'multiply':
		case 'darken':
		case 'color-burn':
			return '#ffffff'
		case 'overlay':
		case 'soft-light':
		case 'hard-light':
			return '#808080'
		case 'hue':
		case 'saturation':
		case 'color':
		case 'luminosity':
			// The non-separable modes have no neutral fill; the overlay's own
			// bounds are the only honest answer, so the rest is left transparent
			// and the blend is confined to where the layer actually is.
			return 'rgba(0,0,0,0)'
		default:
			return '#000000'
	}
}

/* ==========================================================================
   Wiring it into a render.
   ========================================================================== */

export type BlendParams = {
	mode: BlendMode
	opacity: number
	placement: BlendPlacement
	fit: BlendFit
	scale: number
	/** where in the main clip the overlay starts, in seconds */
	startAt: number
	loop: boolean
}

export type PreparedBlend = {
	perFrame: PerFrameHook
	summary: string
	dispose(): void
}

export async function prepareBlendOverlay(args: {
	params: BlendParams
	overlayFile: File | null
	signal: AbortSignal
}): Promise<PreparedBlend> {
	const { params } = args
	if (!args.overlayFile) throw new Error('Choose the clip or image to blend over this one first.')

	const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
	const settings: BlendSettings = {
		mode: params.mode,
		opacity: clamp(params.opacity, 0, 100) / 100,
		placement: params.placement,
		fit: params.fit,
		scale: clamp(params.scale, 5, 100) / 100,
	}
	const compositor = createBlendCompositor(settings)

	// A still and a clip are the same thing to the compositor; only one of them
	// has to be re-read every frame.
	const isImage = args.overlayFile.type.startsWith('image/')
	let still: ImageBitmap | null = null
	let video: SecondaryVideoSource | null = null
	if (isImage) {
		still = await createImageBitmap(args.overlayFile)
	} else {
		video = await openSecondaryVideoSource(args.overlayFile)
	}

	const perFrame: PerFrameHook = async (_frameIndex, timestampSeconds) => {
		const elapsed = timestampSeconds - params.startAt
		if (elapsed < 0) {
			compositor.setLayer(null)
			return { patch: { overlayPass: null } }
		}
		if (still) {
			compositor.setLayer({ source: still, width: still.width, height: still.height })
			return { patch: { overlayPass: compositor.pass } }
		}
		if (!video) return { patch: { overlayPass: null } }

		const duration = video.durationSeconds
		if (!params.loop && duration > 0 && elapsed > duration) {
			compositor.setLayer(null)
			return { patch: { overlayPass: null } }
		}
		const at = params.loop && duration > 0 ? elapsed % duration : Math.min(elapsed, Math.max(0, duration - 0.001))
		const frame = await video.getFrameAt(at)
		if (!frame) {
			compositor.setLayer(null)
			return { patch: { overlayPass: null } }
		}
		compositor.setLayer({ source: frame.canvas, width: frame.naturalWidth, height: frame.naturalHeight })
		return { patch: { overlayPass: compositor.pass } }
	}

	const modeLabel = BLEND_MODES.find((entry) => entry.id === params.mode)?.label ?? params.mode
	return {
		perFrame,
		summary: `${args.overlayFile.name} blended with ${modeLabel} at ${Math.round(settings.opacity * 100)}%${
			!isImage && params.loop ? ', looped' : ''
		}`,
		dispose() {
			compositor.dispose()
			still?.close()
			video?.dispose()
		},
	}
}
