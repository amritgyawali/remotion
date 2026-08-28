'use client'

/**
 * Putting a different room behind the person.
 *
 * `segmentation.ts` says how likely each pixel is to be the subject; this
 * turns that likelihood into a composite. The interesting part is not the
 * `mix(background, foreground, alpha)` at the end - it is the three steps
 * before it, which are the difference between "obviously a video call" and
 * something that survives being watched.
 *
 * - **The matte is shaped, not thresholded.** A hard cut at 0.5 gives a
 *   jagged, aliased outline; a soft mask alone leaves a translucent ghost of
 *   the old room around the subject. So the mask is blurred by a chosen
 *   number of pixels (the feather), then pushed back through a contrast curve
 *   about its midpoint, which sharpens the transition without ever making it
 *   a single-pixel step. `edgeShift` slides that midpoint, which erodes or
 *   dilates the matte - the fix for a rim of old background, or for a subject
 *   that has been shaved into.
 *
 * - **The fringe is cleaned.** Pixels on the boundary are a genuine mixture of
 *   subject and old backdrop, so they carry its colour. Nothing can unmix them
 *   without knowing what the old backdrop was, but pulling those pixels - and
 *   only those - toward their own luminance removes the coloured halo that
 *   gives the composite away. It is honest edge clean-up rather than a
 *   green-screen despill, and it is named for what it does.
 *
 * - **The new background lights the subject.** Real light from behind spills
 *   around a silhouette. A screen blend of the blurred plate, confined to the
 *   same boundary band, fakes that convincingly, and is the single cheapest
 *   thing that makes a composite look shot rather than pasted.
 *
 * All four steps are one fragment shader. Without WebGL2 the composite still
 * happens with plain canvas operations - correct, but with no fringe clean-up
 * and no light wrap, which `degraded` reports so the UI can say so.
 */

import { acquireGlSurface, createTexture2D, uploadPixels2D, uploadTexture2D } from './webgl'

type Ctx2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D

export type BackgroundSettings = {
	/** how far the matte edge is softened, as a fraction of frame height (0-0.05) */
	feather: number
	/** 0 leaves the mask as the model produced it, 1 makes it a hard cut */
	matte: number
	/** -1 eats into the subject, +1 keeps more of the old background */
	edgeShift: number
	/** 0-1: how strongly the coloured fringe is pulled toward neutral */
	edgeClean: number
	/** 0-1: how much of the new background spills around the subject */
	lightWrap: number
	/** when set, the plate is the original frame blurred by this fraction of its height */
	blurPlate?: number
	/** shows the matte itself instead of the composite */
	debug?: boolean
}

export type BackgroundFrameInput = {
	/** the segmenter's mask for this frame, any resolution */
	mask: CanvasImageSource
	maskWidth: number
	maskHeight: number
	/** the new background, or null to blur the original frame instead */
	plate: CanvasImageSource | null
}

export type FramePass = {
	apply(ctx: Ctx2D, width: number, height: number): void
}

export type BackgroundCompositor = {
	/**
	 * Stores the mask and plate for the frame about to be drawn.
	 *
	 * The render loop is strictly one frame at a time - the per-frame hook runs,
	 * then the frame is drawn - so a single mutable slot is both safe and one
	 * fewer object allocated per frame.
	 */
	setFrame(input: BackgroundFrameInput): void
	/** Stable across frames; reads whatever `setFrame` last stored. */
	pass: FramePass
	/** True when this fell back to canvas compositing (no fringe clean-up or wrap). */
	degraded: boolean
	dispose(): void
}

const FRAGMENT_SOURCE = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uFrame;
uniform sampler2D uMask;
uniform sampler2D uPlate;
uniform sampler2D uPlateBlur;

uniform float uMatte;
uniform float uShift;
uniform float uEdgeClean;
uniform float uLightWrap;
uniform float uDebug;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

void main() {
	vec2 uv = vUv;

	// The mask arrives already feathered, so all that is left is to steepen it
	// about its midpoint and slide that midpoint where the user asked.
	float raw = texture(uMask, uv).r;
	float alpha = clamp((raw - 0.5 - uShift) * uMatte + 0.5, 0.0, 1.0);

	vec3 foreground = texture(uFrame, uv).rgb;
	// 1 exactly on the boundary, 0 wherever the matte is fully in or fully out.
	float edge = 1.0 - abs(alpha * 2.0 - 1.0);

	if (uEdgeClean > 0.0) {
		float luma = dot(foreground, LUMA);
		foreground = mix(foreground, vec3(luma), uEdgeClean * edge * 0.85);
	}

	if (uLightWrap > 0.0) {
		vec3 spill = texture(uPlateBlur, uv).rgb;
		float amount = edge * uLightWrap;
		foreground = 1.0 - (1.0 - foreground) * (1.0 - spill * amount);
	}

	vec3 background = texture(uPlate, uv).rgb;
	vec3 composite = mix(background, foreground, alpha);

	fragColor = vec4(mix(composite, vec3(alpha), uDebug), 1.0);
}
`

type Scratch = { canvas: OffscreenCanvas; ctx: OffscreenCanvasRenderingContext2D }

function makeScratch(): Scratch | null {
	if (typeof OffscreenCanvas === 'undefined') return null
	const canvas = new OffscreenCanvas(2, 2)
	const ctx = canvas.getContext('2d')
	if (!ctx) return null
	return { canvas, ctx }
}

function sized(scratch: Scratch, width: number, height: number): Scratch {
	const w = Math.max(1, Math.round(width))
	const h = Math.max(1, Math.round(height))
	if (scratch.canvas.width !== w || scratch.canvas.height !== h) {
		scratch.canvas.width = w
		scratch.canvas.height = h
	}
	return scratch
}

/**
 * The mask comes back from the model at 256x256 whatever the frame is, so it
 * is scaled and feathered once, here, at a resolution that costs almost
 * nothing - the shader's bilinear sampling handles the rest of the way up to
 * the frame. Blurring at output resolution instead would be several times the
 * work for a result no one can see.
 */
const MASK_WORK_WIDTH = 512

function prepareMask(scratch: Scratch, input: BackgroundFrameInput, aspect: number, featherFraction: number): OffscreenCanvas {
	const width = Math.min(MASK_WORK_WIDTH, Math.max(64, input.maskWidth * 2))
	const height = Math.max(64, Math.round(width / Math.max(aspect, 0.05)))
	const { canvas, ctx } = sized(scratch, width, height)
	const feather = featherFraction * height
	ctx.filter = feather >= 0.5 ? `blur(${feather.toFixed(2)}px)` : 'none'
	ctx.clearRect(0, 0, width, height)
	ctx.drawImage(input.mask, 0, 0, width, height)
	ctx.filter = 'none'
	return canvas
}

function drawPlate(scratch: Scratch, ctx: Ctx2D, input: BackgroundFrameInput, width: number, height: number, blurFraction: number): OffscreenCanvas {
	const plate = sized(scratch, width, height)
	plate.ctx.clearRect(0, 0, width, height)
	if (input.plate) {
		plate.ctx.drawImage(input.plate, 0, 0, width, height)
	} else {
		// No plate means "keep this room, just throw it out of focus".
		plate.ctx.filter = `blur(${Math.max(1, Math.round(height * blurFraction))}px)`
		plate.ctx.drawImage(ctx.canvas as unknown as CanvasImageSource, 0, 0, width, height)
		plate.ctx.filter = 'none'
	}
	return plate.canvas
}

function blurPlate(scratch: Scratch, source: CanvasImageSource, width: number, height: number): OffscreenCanvas {
	const w = Math.max(2, Math.round(width / 4))
	const h = Math.max(2, Math.round(height / 4))
	const { canvas, ctx } = sized(scratch, w, h)
	ctx.filter = `blur(${Math.max(2, Math.round(h * 0.06))}px)`
	ctx.clearRect(0, 0, w, h)
	ctx.drawImage(source, 0, 0, w, h)
	ctx.filter = 'none'
	return canvas
}

/** How hard the matte curve gets at `matte = 1`. Past this it aliases. */
const MAX_MATTE_CONTRAST = 7

function createGpuCompositor(settings: BackgroundSettings): BackgroundCompositor | null {
	const surface = acquireGlSurface()
	if (!surface) return null
	const { gl } = surface
	const program = surface.program('background-replace', FRAGMENT_SOURCE)
	if (!program) return null

	const frameTexture = createTexture2D(gl)
	const maskTexture = createTexture2D(gl)
	const plateTexture = createTexture2D(gl)
	const wrapTexture = createTexture2D(gl)
	const maskScratch = makeScratch()
	const plateScratch = makeScratch()
	const wrapScratch = makeScratch()
	if (!frameTexture || !maskTexture || !plateTexture || !wrapTexture || !maskScratch || !plateScratch || !wrapScratch) {
		return null
	}

	const needsWrap = settings.lightWrap > 0
	if (!needsWrap) uploadPixels2D(gl, 3, wrapTexture, 1, 1, new Uint8Array([0, 0, 0, 255]))

	let current: BackgroundFrameInput | null = null

	const pass: FramePass = {
		apply(ctx, width, height) {
			if (!current) return
			const mask = prepareMask(maskScratch, current, width / Math.max(height, 1), settings.feather)
			const plate = drawPlate(plateScratch, ctx, current, width, height, settings.blurPlate ?? 0.03)

			surface.resize(width, height)
			uploadTexture2D(gl, 0, frameTexture, ctx.canvas as unknown as TexImageSource)
			uploadTexture2D(gl, 1, maskTexture, mask)
			uploadTexture2D(gl, 2, plateTexture, plate)
			if (needsWrap) uploadTexture2D(gl, 3, wrapTexture, blurPlate(wrapScratch, plate, width, height))

			gl.useProgram(program.handle)
			gl.uniform1i(program.uniform('uFrame'), 0)
			gl.uniform1i(program.uniform('uMask'), 1)
			gl.uniform1i(program.uniform('uPlate'), 2)
			gl.uniform1i(program.uniform('uPlateBlur'), 3)
			gl.uniform1f(program.uniform('uMatte'), 1 + settings.matte * (MAX_MATTE_CONTRAST - 1))
			gl.uniform1f(program.uniform('uShift'), settings.edgeShift * 0.4)
			gl.uniform1f(program.uniform('uEdgeClean'), settings.edgeClean)
			gl.uniform1f(program.uniform('uLightWrap'), settings.lightWrap)
			gl.uniform1f(program.uniform('uDebug'), settings.debug ? 1 : 0)

			surface.drawQuad(program)

			ctx.clearRect(0, 0, width, height)
			ctx.drawImage(surface.canvas as unknown as CanvasImageSource, 0, 0)
		},
	}

	return {
		degraded: false,
		pass,
		setFrame(input) {
			current = input
		},
		dispose() {
			gl.deleteTexture(frameTexture)
			gl.deleteTexture(maskTexture)
			gl.deleteTexture(plateTexture)
			gl.deleteTexture(wrapTexture)
		},
	}
}

function createCanvasCompositor(settings: BackgroundSettings): BackgroundCompositor {
	const maskScratch = makeScratch()
	const plateScratch = makeScratch()
	const subjectScratch = makeScratch()
	let current: BackgroundFrameInput | null = null

	const pass: FramePass = {
		apply(ctx, width, height) {
			if (!current || !maskScratch || !plateScratch || !subjectScratch) return
			const mask = prepareMask(maskScratch, current, width / Math.max(height, 1), settings.feather)
			const plate = drawPlate(plateScratch, ctx, current, width, height, settings.blurPlate ?? 0.03)

			if (settings.debug) {
				ctx.clearRect(0, 0, width, height)
				ctx.drawImage(mask, 0, 0, width, height)
				return
			}

			// `destination-in` keeps only what the mask covers - the one canvas
			// operation that writes an alpha channel from another image.
			const subject = sized(subjectScratch, width, height)
			subject.ctx.clearRect(0, 0, width, height)
			subject.ctx.globalCompositeOperation = 'source-over'
			subject.ctx.drawImage(ctx.canvas as unknown as CanvasImageSource, 0, 0)
			subject.ctx.globalCompositeOperation = 'destination-in'
			subject.ctx.drawImage(mask, 0, 0, width, height)
			subject.ctx.globalCompositeOperation = 'source-over'

			ctx.clearRect(0, 0, width, height)
			ctx.drawImage(plate, 0, 0)
			ctx.drawImage(subject.canvas, 0, 0)
		},
	}

	return {
		degraded: true,
		pass,
		setFrame(input) {
			current = input
		},
		dispose() {},
	}
}

/** GPU where there is one; a correct, plainer composite where there is not. */
export function createBackgroundCompositor(settings: BackgroundSettings): BackgroundCompositor {
	return createGpuCompositor(settings) ?? createCanvasCompositor(settings)
}

/* ==========================================================================
   Building the plate.
   ========================================================================== */

export type PlateFit = 'cover' | 'contain' | 'stretch'

/**
 * Draws a still background into a canvas the size of the output frame.
 *
 * Static plates - a colour, or an uploaded photo - are built once and reused
 * for every frame; only a video background has to be redrawn.
 */
export function renderStillPlate(args: {
	width: number
	height: number
	color: string
	image: { source: CanvasImageSource; width: number; height: number } | null
	fit: PlateFit
}): OffscreenCanvas {
	const canvas = new OffscreenCanvas(Math.max(1, args.width), Math.max(1, args.height))
	const ctx = canvas.getContext('2d')
	if (!ctx) return canvas
	ctx.fillStyle = args.color
	ctx.fillRect(0, 0, canvas.width, canvas.height)
	if (args.image) drawFitted(ctx, args.image.source, args.image.width, args.image.height, canvas.width, canvas.height, args.fit)
	return canvas
}

/** Scales a source into a frame the way `object-fit` would. */
export function drawFitted(
	ctx: Ctx2D,
	source: CanvasImageSource,
	sourceWidth: number,
	sourceHeight: number,
	width: number,
	height: number,
	fit: PlateFit,
): void {
	if (fit === 'stretch' || sourceWidth <= 0 || sourceHeight <= 0) {
		ctx.drawImage(source, 0, 0, width, height)
		return
	}
	const scale =
		fit === 'cover'
			? Math.max(width / sourceWidth, height / sourceHeight)
			: Math.min(width / sourceWidth, height / sourceHeight)
	const drawWidth = sourceWidth * scale
	const drawHeight = sourceHeight * scale
	ctx.drawImage(source, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight)
}
