'use client'

/**
 * Compositing one object behind the speaker, in the cheapest way the algebra
 * allows.
 *
 * The first version of this reused the Tools Studio's background remover: it
 * built a full-frame *plate* (the frame with the object painted on it), pushed
 * frame, mask, plate and a blurred plate into a fragment shader, and mixed them
 * by the matte. Correct, and far more work than the problem needs. Writing the
 * mix out shows why:
 *
 *     out = mix(plate, frame, a)                    // a = person matte
 *     plate = over(object, frame)                   // = o.rgb*o.a + frame*(1-o.a)
 *     out = frame*(a + (1-a)(1-o.a)) + o.rgb*o.a*(1-a)
 *
 * which is exactly `frame` with the object drawn over it at an effective alpha
 * of `o.a * (1 - a)`. **The frame is never read.** So there is no plate to
 * build, no frame texture to upload, no full-frame shader pass and no
 * full-frame read-back: the whole composite is one ordinary source-over draw of
 * a small object layer whose alpha has been multiplied by one minus the matte.
 *
 * Three consequences, all of them the point:
 *
 * - **The work is proportional to the object, not to the frame.** Everything
 *   happens inside the object's own rectangle, dilated for the soft edge. A
 *   40%-height object on a 1080p frame touches around a tenth of the pixels a
 *   full-frame pass did, and a 4K frame with the same object costs the same as
 *   a 1080p one plus the final blit.
 *
 * - **There is no GPU path to diverge from.** The old compositor had a shader
 *   and a canvas fallback that produced visibly different pictures. Canvas 2D
 *   does `destination-out` and a blur natively, so there is one implementation,
 *   it runs anywhere, and what a machine without WebGL renders is what every
 *   other machine renders.
 *
 * - **The matte only has to be right where the object is.** Outside the
 *   dilated rectangle the frame is untouched - not "mixed with itself", not
 *   re-encoded through a shader, untouched - so a segmentation error somewhere
 *   else in the picture cannot show up at all.
 *
 * Two things are added on top, and both are about making the object read as
 * *behind* rather than *pasted*:
 *
 * - **The speaker casts a shadow onto the object.** The matte, blurred and
 *   offset, darkens the object where the person is in front of it. This is the
 *   single cheapest cue that separates the two planes, and it costs one extra
 *   draw of something that is already in hand.
 *
 * - **The object spills light around the silhouette.** A blurred copy of the
 *   object's own colour, confined to the band where the matte is neither fully
 *   in nor fully out, screened over the subject's edge. Real light behind a
 *   head does this, and its absence is what makes a composite look flat.
 */

type Ctx2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D

export type ObjectCompositorSettings = {
	/** how far the matte edge is softened, as a fraction of the frame height */
	feather: number
	/** 0 leaves the mask as the model produced it, 1 makes it a hard cut */
	matte: number
	/** -1 eats into the subject, +1 keeps more of them */
	edgeShift: number
	/** 0-1: how much of the object's colour spills around the silhouette */
	lightWrap: number
	/** 0-1: how dark a shadow the speaker casts onto the object behind them */
	contactShadow: number
	/** draws the matte itself instead of the composite */
	debug?: boolean
}

/** What the segmenter produced for this frame. */
export type MaskFrame = {
	/** single-channel confidence, 0 background to 1 subject, row-major */
	data: Float32Array
	width: number
	height: number
}

/** Where and how big the object is, in frame pixels. */
export type ObjectPlacementRequest = {
	sprite: CanvasImageSource
	centerX: number
	centerY: number
	width: number
	height: number
	/** radians */
	rotation: number
	/** 0-1 */
	alpha: number
}

export type ObjectCompositor = {
	/**
	 * Stores what the next frame draws. A null request means "no object on
	 * screen", and the frame is then left exactly as it arrived.
	 */
	setFrame(input: { mask: MaskFrame | null; request: ObjectPlacementRequest | null }): void
	pass: { apply(ctx: Ctx2D, width: number, height: number): void }
	/** How many pixels the last frame actually touched, for the bake's report. */
	readonly lastTouchedPixels: number
	dispose(): void
}

/** How hard the matte curve gets at `matte = 1`. Past this it aliases. */
const MAX_MATTE_CONTRAST = 7

/** The shadow's blur and offset, as fractions of the object's height. */
const SHADOW_BLUR = 0.06
const SHADOW_OFFSET = 0.02

/** The light wrap's blur, as a fraction of the object's height. */
const WRAP_BLUR = 0.05

type Scratch = {
	canvas: OffscreenCanvas | HTMLCanvasElement
	ctx: Ctx2D
	/**
	 * A pixel buffer the size of this canvas, kept between frames.
	 *
	 * `createImageData` hands back a fresh zeroed buffer every time it is
	 * called, and the matte is written once per frame for the whole length of a
	 * bake. At mask size that is about a hundred and fifty kilobytes of garbage
	 * per frame - a few hundred megabytes over a two minute clip, all of it
	 * identical in shape and all of it collected again immediately. Holding one
	 * buffer per canvas and overwriting it costs one allocation for the whole
	 * render, and every byte of it is rewritten before it is read, so nothing
	 * needs clearing.
	 */
	image: ImageData | null
}

function makeScratch(): Scratch {
	if (typeof OffscreenCanvas !== 'undefined') {
		const canvas = new OffscreenCanvas(2, 2)
		const ctx = canvas.getContext('2d')
		if (!ctx) throw new Error('This browser has no 2D canvas context to composite the object with.')
		return { canvas, ctx, image: null }
	}
	const canvas = document.createElement('canvas')
	canvas.width = 2
	canvas.height = 2
	const ctx = canvas.getContext('2d')
	if (!ctx) throw new Error('This browser has no 2D canvas context to composite the object with.')
	return { canvas, ctx, image: null }
}

function sized(scratch: Scratch, width: number, height: number): Scratch {
	const w = Math.max(1, Math.round(width))
	const h = Math.max(1, Math.round(height))
	if (scratch.canvas.width !== w || scratch.canvas.height !== h) {
		scratch.canvas.width = w
		scratch.canvas.height = h
		// Resizing a canvas resets its contents, and the held buffer is now the
		// wrong shape. Dropping it here is what keeps `pixelsFor` a pure lookup.
		scratch.image = null
	}
	return scratch
}

/**
 * The scratch's own pixel buffer at its current size, allocated at most once
 * per size change rather than once per frame.
 */
function pixelsFor(scratch: Scratch, width: number, height: number): ImageData {
	const existing = scratch.image
	if (existing && existing.width === width && existing.height === height) return existing
	const created = scratch.ctx.createImageData(width, height)
	scratch.image = created
	return created
}

export type Rect = { x: number; y: number; width: number; height: number }

/**
 * The pixels one placement can possibly affect.
 *
 * A rotated rectangle's bounding box, grown by everything that spreads beyond
 * the sprite - the feathered matte edge, the shadow's blur and offset, the
 * light wrap's blur - and clamped to the frame. Getting this wrong in the
 * generous direction costs a little speed; getting it wrong in the tight
 * direction leaves a visible seam, so every term that can bleed is counted.
 */
export function affectedRect(
	request: ObjectPlacementRequest,
	frameWidth: number,
	frameHeight: number,
	settings: ObjectCompositorSettings,
): Rect | null {
	const cos = Math.abs(Math.cos(request.rotation))
	const sin = Math.abs(Math.sin(request.rotation))
	const spanX = request.width * cos + request.height * sin
	const spanY = request.width * sin + request.height * cos

	const bleed =
		settings.feather * frameHeight * 3 +
		(settings.contactShadow > 0 ? request.height * (SHADOW_BLUR * 3 + SHADOW_OFFSET) : 0) +
		(settings.lightWrap > 0 ? request.height * WRAP_BLUR * 3 : 0) +
		2

	const left = Math.floor(request.centerX - spanX / 2 - bleed)
	const top = Math.floor(request.centerY - spanY / 2 - bleed)
	const right = Math.ceil(request.centerX + spanX / 2 + bleed)
	const bottom = Math.ceil(request.centerY + spanY / 2 + bleed)

	const x = Math.max(0, left)
	const y = Math.max(0, top)
	const width = Math.min(frameWidth, right) - x
	const height = Math.min(frameHeight, bottom) - y
	if (width <= 0 || height <= 0) return null
	return { x, y, width, height }
}

/**
 * Turns the model's confidence into an alpha channel, once per frame.
 *
 * The curve is applied here rather than after the blur on purpose: shaping
 * first and softening second gives a hard decision with a soft edge, which is
 * what a matte wants. Softening first and shaping second sharpens the blur
 * back up and undoes it.
 *
 * The canvas this writes is mask-sized - 256x144 for a landscape clip - so
 * this is the only per-frame cost that does not scale with the object, and it
 * is under forty thousand pixels.
 */
function writeMatte(scratch: Scratch, mask: MaskFrame, settings: ObjectCompositorSettings): Scratch {
	const { ctx } = sized(scratch, mask.width, mask.height)
	const image = pixelsFor(scratch, mask.width, mask.height)
	const pixels = image.data
	const contrast = 1 + Math.min(1, Math.max(0, settings.matte)) * (MAX_MATTE_CONTRAST - 1)
	const shift = settings.edgeShift * 0.4

	for (let i = 0, p = 0; i < mask.data.length; i++, p += 4) {
		const shaped = (mask.data[i] - 0.5 - shift) * contrast + 0.5
		// RGB stays white so the same canvas can be drawn as a picture in the
		// debug view; only the alpha channel carries the matte.
		pixels[p] = 255
		pixels[p + 1] = 255
		pixels[p + 2] = 255
		pixels[p + 3] = shaped <= 0 ? 0 : shaped >= 1 ? 255 : Math.round(shaped * 255)
	}
	ctx.putImageData(image, 0, 0)
	// The scratch itself, not a copy of two of its fields: the held buffer has
	// to travel with the canvas it belongs to or the next frame reallocates it.
	return scratch
}

/** Draws the matte, scaled and softened, over a rectangle of the frame. */
function drawMatteInto(
	target: Ctx2D,
	matte: Scratch,
	mask: MaskFrame,
	rect: Rect,
	frameWidth: number,
	frameHeight: number,
	featherPx: number,
	extraBlurPx = 0,
): void {
	const scaleX = mask.width / frameWidth
	const scaleY = mask.height / frameHeight
	const blur = featherPx + extraBlurPx
	if (blur >= 0.5) target.filter = `blur(${blur.toFixed(2)}px)`
	target.drawImage(
		matte.canvas as CanvasImageSource,
		rect.x * scaleX,
		rect.y * scaleY,
		rect.width * scaleX,
		rect.height * scaleY,
		0,
		0,
		rect.width,
		rect.height,
	)
	target.filter = 'none'
}

export function createObjectCompositor(settings: ObjectCompositorSettings): ObjectCompositor {
	const matteScratch = makeScratch()
	const layerScratch = makeScratch()
	const shadowScratch = makeScratch()
	const wrapScratch = makeScratch()

	let mask: MaskFrame | null = null
	let request: ObjectPlacementRequest | null = null
	let touched = 0

	const pass = {
		apply(ctx: Ctx2D, width: number, height: number) {
			touched = 0
			if (!mask) return

			const matte = writeMatte(matteScratch, mask, settings)

			if (settings.debug) {
				// The diagnostic view is the only thing here that is allowed to
				// cost a whole frame: it exists to be looked at, not shipped.
				ctx.save()
				ctx.globalCompositeOperation = 'source-over'
				ctx.fillStyle = '#000000'
				ctx.fillRect(0, 0, width, height)
				ctx.drawImage(matte.canvas as CanvasImageSource, 0, 0, width, height)
				ctx.restore()
				touched = width * height
				return
			}

			if (!request || request.alpha <= 0.002) return
			const rect = affectedRect(request, width, height, settings)
			if (!rect) return

			const featherPx = settings.feather * height
			const layer = sized(layerScratch, rect.width, rect.height)
			layer.ctx.setTransform(1, 0, 0, 1, 0, 0)
			layer.ctx.globalCompositeOperation = 'source-over'
			layer.ctx.globalAlpha = 1
			layer.ctx.clearRect(0, 0, rect.width, rect.height)

			/* ------------------------------------------------------- object */

			layer.ctx.save()
			layer.ctx.translate(request.centerX - rect.x, request.centerY - rect.y)
			if (request.rotation !== 0) layer.ctx.rotate(request.rotation)
			layer.ctx.drawImage(
				request.sprite,
				-request.width / 2,
				-request.height / 2,
				request.width,
				request.height,
			)
			layer.ctx.restore()

			/* ------------------------------------------------------- shadow */

			if (settings.contactShadow > 0) {
				const shadow = sized(shadowScratch, rect.width, rect.height)
				shadow.ctx.setTransform(1, 0, 0, 1, 0, 0)
				shadow.ctx.globalCompositeOperation = 'source-over'
				shadow.ctx.globalAlpha = 1
				shadow.ctx.clearRect(0, 0, rect.width, rect.height)

				// The shadow is the subject's own matte, blurred and pushed down
				// and right - the direction a key light above and to one side
				// implies, and the one that reads as depth rather than as a glow.
				shadow.ctx.save()
				shadow.ctx.translate(request.height * SHADOW_OFFSET, request.height * SHADOW_OFFSET)
				drawMatteInto(
					shadow.ctx,
					matte,
					mask,
					rect,
					width,
					height,
					featherPx,
					request.height * SHADOW_BLUR,
				)
				shadow.ctx.restore()

				// The matte's own colour is white, so it is repainted black
				// through its own alpha: drawing it as it stands would wash the
				// object out instead of darkening it.
				shadow.ctx.globalCompositeOperation = 'source-in'
				shadow.ctx.fillStyle = '#000000'
				shadow.ctx.fillRect(0, 0, rect.width, rect.height)
				shadow.ctx.globalCompositeOperation = 'source-over'

				// `source-atop` keeps the shadow inside the object it falls on,
				// so nothing darkens the footage around it.
				layer.ctx.save()
				layer.ctx.globalCompositeOperation = 'source-atop'
				layer.ctx.globalAlpha = Math.min(1, settings.contactShadow)
				layer.ctx.drawImage(shadow.canvas as CanvasImageSource, 0, 0)
				layer.ctx.restore()
			}

			/* ---------------------------------------------------- the cut-out */

			// Everything above is the object as if it were in front. This one
			// operation is what puts it behind: `destination-out` multiplies the
			// layer's alpha by one minus the matte's.
			layer.ctx.save()
			layer.ctx.globalCompositeOperation = 'destination-out'
			drawMatteInto(layer.ctx, matte, mask, rect, width, height, featherPx)
			layer.ctx.restore()

			/* ---------------------------------------------------- the frame */

			ctx.save()
			ctx.globalCompositeOperation = 'source-over'
			ctx.globalAlpha = Math.min(1, Math.max(0, request.alpha))
			ctx.drawImage(layer.canvas as CanvasImageSource, rect.x, rect.y)
			ctx.restore()

			/* ------------------------------------------------------- spill */

			if (settings.lightWrap > 0) {
				const wrap = sized(wrapScratch, rect.width, rect.height)
				wrap.ctx.setTransform(1, 0, 0, 1, 0, 0)
				wrap.ctx.globalCompositeOperation = 'source-over'
				wrap.ctx.clearRect(0, 0, rect.width, rect.height)
				// The object's own colour, blurred: what would actually be
				// spilling if the object were a lit surface behind the speaker.
				wrap.ctx.save()
				wrap.ctx.filter = `blur(${Math.max(1, request.height * WRAP_BLUR).toFixed(2)}px)`
				wrap.ctx.translate(request.centerX - rect.x, request.centerY - rect.y)
				if (request.rotation !== 0) wrap.ctx.rotate(request.rotation)
				wrap.ctx.drawImage(
					request.sprite,
					-request.width / 2,
					-request.height / 2,
					request.width,
					request.height,
				)
				wrap.ctx.restore()

				// Confined to the subject: `destination-in` against the matte
				// keeps only what falls on the person, and the soft matte edge
				// is what makes it a rim rather than a wash.
				wrap.ctx.save()
				wrap.ctx.globalCompositeOperation = 'destination-in'
				drawMatteInto(wrap.ctx, matte, mask, rect, width, height, featherPx * 2 + 1)
				wrap.ctx.restore()

				ctx.save()
				ctx.globalCompositeOperation = 'lighter'
				ctx.globalAlpha = Math.min(1, settings.lightWrap) * 0.5 * request.alpha
				ctx.drawImage(wrap.canvas as CanvasImageSource, rect.x, rect.y)
				ctx.restore()
			}

			touched = rect.width * rect.height
		},
	}

	return {
		pass,
		get lastTouchedPixels() {
			return touched
		},
		setFrame(input) {
			mask = input.mask
			request = input.request
		},
		dispose() {
			mask = null
			request = null
		},
	}
}
