'use client'

/**
 * Retouch: skin smoothing, tone evening, a lift on the eyes and teeth, and a
 * little warmth - the "beauty" panel, done in a way that survives being
 * looked at closely.
 *
 * The naive version of this is a blur, and it is why most beauty filters look
 * like plastic: a blur does not know the difference between the pores it is
 * meant to soften and the eyelashes it is not. Two things fix that here.
 *
 * **The filter is bilateral, not Gaussian.** Each tap is weighted by how
 * different it is from the centre pixel as well as how far away it is, so a
 * sample that crosses an edge - a lash, a nostril, the line of a lip - is
 * given almost no weight. Texture inside a flat region is averaged away;
 * structure is left standing. That is the entire difference between "smoothed
 * skin" and "smeared face".
 *
 * **It only runs on skin.** The mask is built in YCbCr, where human skin of
 * every tone occupies a compact, well-documented region of the chroma plane
 * (roughly Cb 77-127, Cr 133-173 in 8-bit terms) that is largely independent
 * of how light or dark the person is - which is exactly the property an
 * RGB-threshold mask lacks, and why RGB-based beauty filters work on some
 * people and not others. The mask is then feathered on both chroma axes so
 * its own edge never prints.
 *
 * Nothing here detects a face. It does not need to: a mask that says "this is
 * skin" is what the smoothing wants, and it works on hands, arms and necks
 * too - which is correct, since those are skin as well.
 */

import { acquireGlSurface, createTexture2D, uploadTexture2D } from './webgl'

type Ctx2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D

export type RetouchSettings = {
	/** 0-1: how much of the smoothed result is blended over the skin */
	smooth: number
	/** 0-1: evens blotchy colour without touching brightness */
	even: number
	/** 0-1: lifts skin luminance */
	brighten: number
	/** -1..1: shifts skin toward amber (positive) or away from it */
	warmth: number
	/** 0-1: brightens the bright, unsaturated things in a face - eyes and teeth */
	clarityEyes: number
	/** 0-1: how far the smoothing reaches, as a fraction of the frame */
	radius: number
}

export type RetouchProcessor = {
	apply(ctx: Ctx2D, width: number, height: number, frameIndex: number): void
	degraded: boolean
	dispose(): void
}

export const NEUTRAL_RETOUCH: RetouchSettings = {
	smooth: 0,
	even: 0,
	brighten: 0,
	warmth: 0,
	clarityEyes: 0,
	radius: 0.5,
}

export function isNeutralRetouch(settings: RetouchSettings): boolean {
	return settings.smooth === 0 && settings.even === 0 && settings.brighten === 0 && settings.warmth === 0 && settings.clarityEyes === 0
}

const FRAGMENT_SOURCE = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uImage;
uniform vec2 uTexel;
uniform float uSmooth;
uniform float uEven;
uniform float uBrighten;
uniform float uWarmth;
uniform float uEyes;
uniform float uRadius;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

/** BT.601 chroma, which is the space the skin-tone bounds are quoted in. */
vec2 chroma(vec3 c) {
	float y = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
	return vec2(0.564 * (c.b - y) + 0.5, 0.713 * (c.r - y) + 0.5);
}

/**
 * 1 where this pixel is skin, falling to 0 outside the chroma box.
 *
 * The bounds are the classic Cb 77-127 / Cr 133-173 window, normalised.
 * A smoothstep on all four sides is what keeps the mask's own boundary from
 * printing as a hard line across a cheek.
 */
float skinMask(vec3 c) {
	vec2 cbcr = chroma(c);
	float cb = cbcr.x;
	float cr = cbcr.y;
	float inCb = smoothstep(0.28, 0.34, cb) * (1.0 - smoothstep(0.48, 0.54, cb));
	float inCr = smoothstep(0.50, 0.55, cr) * (1.0 - smoothstep(0.66, 0.72, cr));
	// Very dark and blown-out pixels have no reliable chroma left in them, so
	// they are excluded rather than guessed at.
	float luma = dot(c, LUMA);
	float inRange = smoothstep(0.05, 0.14, luma) * (1.0 - smoothstep(0.93, 0.99, luma));
	return inCb * inCr * inRange;
}

void main() {
	vec3 base = texture(uImage, vUv).rgb;
	float skin = skinMask(base);

	vec3 colour = base;

	if (uSmooth > 0.0 || uEven > 0.0) {
		// A 16-tap ring pair rather than a full kernel: two radii at eight
		// angles each cover the neighbourhood evenly at a quarter of the cost
		// of a 5x5, and a bilateral weight makes the sampling pattern almost
		// invisible because mismatched taps drop out anyway.
		float radius = mix(1.5, 7.0, uRadius);
		vec3 sum = base;
		float weightSum = 1.0;
		// The range sigma is what decides "same surface or not". Too large and
		// it becomes a Gaussian; too small and nothing is ever averaged.
		float sigma = 0.09 + 0.10 * (1.0 - uSmooth);

		for (int ring = 1; ring <= 2; ring++) {
			float r = radius * float(ring) * 0.6;
			for (int i = 0; i < 8; i++) {
				float angle = (6.2831853 / 8.0) * float(i) + float(ring) * 0.4;
				vec2 offset = vec2(cos(angle), sin(angle)) * r * uTexel;
				vec3 tap = texture(uImage, vUv + offset).rgb;
				float difference = length(tap - base);
				float weight = exp(-(difference * difference) / (2.0 * sigma * sigma));
				sum += tap * weight;
				weightSum += weight;
			}
		}
		vec3 smoothed = sum / weightSum;

		// Smoothing takes texture out of everything; evening takes it only out
		// of colour, keeping the original luminance, which is what removes
		// blotchiness without removing skin.
		vec3 evened = smoothed * (dot(base, LUMA) / max(dot(smoothed, LUMA), 0.001));
		colour = mix(colour, smoothed, uSmooth * skin);
		colour = mix(colour, evened, uEven * skin);
	}

	if (uBrighten != 0.0) {
		colour += uBrighten * 0.18 * skin * (1.0 - colour);
	}
	if (uWarmth != 0.0) {
		colour.r += uWarmth * 0.10 * skin;
		colour.b -= uWarmth * 0.08 * skin;
	}
	if (uEyes > 0.0) {
		// Eyes and teeth are the bright, near-neutral things that sit inside a
		// face: high luminance, low saturation, next to skin. That triple is
		// enough to find them without a landmark model.
		float luma = dot(colour, LUMA);
		float maxC = max(colour.r, max(colour.g, colour.b));
		float minC = min(colour.r, min(colour.g, colour.b));
		float saturation = maxC - minC;
		float neighbourSkin = 0.0;
		for (int i = 0; i < 6; i++) {
			float angle = (6.2831853 / 6.0) * float(i);
			neighbourSkin += skinMask(texture(uImage, vUv + vec2(cos(angle), sin(angle)) * uTexel * 9.0).rgb);
		}
		neighbourSkin /= 6.0;
		float target = smoothstep(0.42, 0.72, luma) * (1.0 - smoothstep(0.10, 0.26, saturation)) * smoothstep(0.15, 0.45, neighbourSkin);
		colour += uEyes * 0.22 * target * (1.0 - colour);
		// A touch of desaturation is what takes the yellow out of teeth.
		colour = mix(colour, vec3(luma), uEyes * 0.25 * target);
	}

	fragColor = vec4(clamp(colour, 0.0, 1.0), 1.0);
}
`

function createGpuProcessor(settings: RetouchSettings): RetouchProcessor | null {
	const surface = acquireGlSurface()
	if (!surface) return null
	const { gl } = surface
	const program = surface.program('retouch', FRAGMENT_SOURCE)
	if (!program) return null
	const texture = createTexture2D(gl)
	if (!texture) return null

	return {
		degraded: false,
		apply(ctx, width, height) {
			surface.resize(width, height)
			uploadTexture2D(gl, 0, texture, ctx.canvas as unknown as TexImageSource)

			gl.useProgram(program.handle)
			gl.uniform1i(program.uniform('uImage'), 0)
			gl.uniform2f(program.uniform('uTexel'), 1 / Math.max(1, width), 1 / Math.max(1, height))
			gl.uniform1f(program.uniform('uSmooth'), settings.smooth)
			gl.uniform1f(program.uniform('uEven'), settings.even)
			gl.uniform1f(program.uniform('uBrighten'), settings.brighten)
			gl.uniform1f(program.uniform('uWarmth'), settings.warmth)
			gl.uniform1f(program.uniform('uEyes'), settings.clarityEyes)
			gl.uniform1f(program.uniform('uRadius'), settings.radius)

			surface.drawQuad(program)
			ctx.clearRect(0, 0, width, height)
			ctx.drawImage(surface.canvas as unknown as CanvasImageSource, 0, 0)
		},
		dispose() {
			gl.deleteTexture(texture)
		},
	}
}

/** The same skin window as the shader, for the CPU path. */
function skinMaskCpu(r: number, g: number, b: number): number {
	const y = 0.299 * r + 0.587 * g + 0.114 * b
	const cb = 0.564 * (b - y) + 0.5
	const cr = 0.713 * (r - y) + 0.5
	const step = (edge0: number, edge1: number, x: number) => {
		const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0 || 1e-6)))
		return t * t * (3 - 2 * t)
	}
	const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
	const inCb = step(0.28, 0.34, cb) * (1 - step(0.48, 0.54, cb))
	const inCr = step(0.5, 0.55, cr) * (1 - step(0.66, 0.72, cr))
	const inRange = step(0.05, 0.14, luma) * (1 - step(0.93, 0.99, luma))
	return inCb * inCr * inRange
}

/**
 * The CPU path trades the bilateral for a plain blur plus the same skin mask.
 *
 * A sixteen-tap bilateral per pixel in JavaScript is minutes per frame, which
 * is not a fallback, it is a hang. A canvas blur restricted to the skin mask
 * is a genuinely worse filter - it will soften a lash that happens to sit on
 * skin - but it renders, and `degraded` tells the UI to say so.
 */
function createCpuProcessor(settings: RetouchSettings): RetouchProcessor {
	return {
		degraded: true,
		apply(ctx, width, height) {
			let blurred: Uint8ClampedArray | null = null
			if ((settings.smooth > 0 || settings.even > 0) && typeof OffscreenCanvas !== 'undefined') {
				const scratch = new OffscreenCanvas(width, height)
				const scratchCtx = scratch.getContext('2d', { willReadFrequently: true })
				if (scratchCtx) {
					const radius = Math.max(1, Math.round(Math.min(width, height) * 0.004 * (0.5 + settings.radius)))
					scratchCtx.filter = `blur(${radius}px)`
					scratchCtx.drawImage(ctx.canvas as unknown as CanvasImageSource, 0, 0)
					blurred = scratchCtx.getImageData(0, 0, width, height).data
				}
			}

			const image = ctx.getImageData(0, 0, width, height)
			const data = image.data
			for (let i = 0; i < data.length; i += 4) {
				let r = data[i] / 255
				let g = data[i + 1] / 255
				let b = data[i + 2] / 255
				const skin = skinMaskCpu(r, g, b)
				if (skin > 0.001) {
					if (blurred) {
						const sr = blurred[i] / 255
						const sg = blurred[i + 1] / 255
						const sb = blurred[i + 2] / 255
						const weight = settings.smooth * skin
						r += (sr - r) * weight
						g += (sg - g) * weight
						b += (sb - b) * weight
						if (settings.even > 0) {
							const baseLuma = 0.2126 * r + 0.7152 * g + 0.0722 * b
							const softLuma = Math.max(0.001, 0.2126 * sr + 0.7152 * sg + 0.0722 * sb)
							const ratio = baseLuma / softLuma
							const evenWeight = settings.even * skin
							r += (sr * ratio - r) * evenWeight
							g += (sg * ratio - g) * evenWeight
							b += (sb * ratio - b) * evenWeight
						}
					}
					if (settings.brighten !== 0) {
						r += settings.brighten * 0.18 * skin * (1 - r)
						g += settings.brighten * 0.18 * skin * (1 - g)
						b += settings.brighten * 0.18 * skin * (1 - b)
					}
					if (settings.warmth !== 0) {
						r += settings.warmth * 0.1 * skin
						b -= settings.warmth * 0.08 * skin
					}
				}
				data[i] = Math.min(255, Math.max(0, r * 255))
				data[i + 1] = Math.min(255, Math.max(0, g * 255))
				data[i + 2] = Math.min(255, Math.max(0, b * 255))
			}
			ctx.putImageData(image, 0, 0)
		},
		dispose() {},
	}
}

export function createRetouchProcessor(settings: RetouchSettings): RetouchProcessor {
	return createGpuProcessor(settings) ?? createCpuProcessor(settings)
}

/** Exposed so the offline checks can assert the skin window is where it should be. */
export function skinMaskForTest(r: number, g: number, b: number): number {
	return skinMaskCpu(r / 255, g / 255, b / 255)
}
