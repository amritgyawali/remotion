'use client'

/**
 * The colour-correction desk: exposure, white balance, the four tonal
 * regions, gamma, fade, vibrance, clarity and a single-band HSL trim.
 *
 * This is deliberately *not* the same thing as `color-tone.ts`. A tone is a
 * look - a fixed table someone designed, applied whole. This is correction:
 * the sliders an editor reaches for when a shot is a stop under, or the white
 * balance drifted indoors, or the sky needs to come down without dragging the
 * faces with it. Looks are baked into a cube once and cost nothing per pixel;
 * corrections are live maths, because the whole point is that the numbers
 * move while someone watches.
 *
 * Order matters more here than anywhere else in the codebase, and it follows
 * what a colourist would do by hand:
 *
 *   white balance -> exposure -> contrast -> tonal regions -> gamma ->
 *   fade -> HSL band -> vibrance/saturation -> hue -> clarity -> sharpen
 *
 * White balance comes first because every later decision is judged against
 * neutral. Exposure and contrast are done in linear light, where doubling a
 * number really is a stop and a contrast pivot at 18% grey behaves the way a
 * light meter says it should; everything perceptual - the tonal regions,
 * saturation, the HSL band - happens back in display space, where "highlight"
 * and "shadow" mean what an eye thinks they mean. Getting that split wrong is
 * what makes naive brightness sliders turn skin grey.
 *
 * Both paths - the fragment shader and the CPU fallback - implement that same
 * chain, in the same order, with the same constants. A machine without WebGL2
 * gets a slower render, not a different picture; only clarity's blur radius
 * and the sharpen kernel differ, and `degraded` says so.
 */

import { acquireGlSurface, createTexture2D, uploadPixels2D, uploadTexture2D } from './webgl'

type Ctx2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D

/**
 * Every slider on the panel, in the units the UI shows.
 *
 * Zero is "do nothing" for every one of them, which is what makes the whole
 * struct safe to spread over a partial: an adjustment nobody touched costs a
 * uniform upload and nothing else.
 */
export type AdjustSettings = {
	/** stops of exposure; +1 is twice the light */
	exposure: number
	/** -1..1, pivoted at 18% grey */
	contrast: number
	/** -1..1; positive is warmer (more amber), negative cooler (more blue) */
	temperature: number
	/** -1..1; positive is magenta, negative green - the other white-balance axis */
	tint: number
	/** -1..1 each: the four tonal regions, in display space */
	highlights: number
	shadows: number
	whites: number
	blacks: number
	/** -1..1; positive opens the midtones without moving either end */
	gamma: number
	/** 0..1; lifts the black point for a matte, film-print falloff */
	fade: number
	/** -1..1; saturation weighted away from what is already saturated */
	vibrance: number
	/** -1..1; flat saturation */
	saturation: number
	/** -180..180 degrees of hue rotation */
	hue: number
	/** -1..1; midtone local contrast */
	clarity: number
	/** 0..1; unsharp masking on top of everything else */
	sharpness: number
	/** the one-band HSL trim: which hue it is centred on, and what it does */
	band: HslBand | null
}

export type HslBand = {
	/** 0..1 around the colour wheel; 0 is red, 1/3 green, 2/3 blue */
	center: number
	/** 0..0.5; how much of the wheel either side of `center` is affected */
	width: number
	/** -1..1, scaled to +/-60 degrees of hue shift inside the band */
	hue: number
	saturation: number
	luminance: number
}

export const NEUTRAL_ADJUST: AdjustSettings = {
	exposure: 0,
	contrast: 0,
	temperature: 0,
	tint: 0,
	highlights: 0,
	shadows: 0,
	whites: 0,
	blacks: 0,
	gamma: 0,
	fade: 0,
	vibrance: 0,
	saturation: 0,
	hue: 0,
	clarity: 0,
	sharpness: 0,
	band: null,
}

/** The eight hue families the HSL trim offers, at their wheel positions. */
export const HSL_BANDS: Array<{ id: string; label: string; center: number }> = [
	{ id: 'red', label: 'Reds', center: 0 },
	{ id: 'orange', label: 'Oranges (skin)', center: 0.075 },
	{ id: 'yellow', label: 'Yellows', center: 0.15 },
	{ id: 'green', label: 'Greens', center: 0.3 },
	{ id: 'aqua', label: 'Aquas', center: 0.48 },
	{ id: 'blue', label: 'Blues', center: 0.6 },
	{ id: 'purple', label: 'Purples', center: 0.75 },
	{ id: 'magenta', label: 'Magentas', center: 0.87 },
]

export function bandCenterById(id: string): number {
	return HSL_BANDS.find((band) => band.id === id)?.center ?? 0.075
}

export type AdjustProcessor = {
	apply(ctx: Ctx2D, width: number, height: number, frameIndex: number): void
	/** true when this is the CPU path, whose clarity and sharpen are coarser */
	degraded: boolean
	dispose(): void
}

/**
 * Nothing in `settings` asks for a change, so the whole pass can be skipped.
 *
 * Worth checking: the panel has fourteen sliders and most renders move two of
 * them, and a no-op pass still costs a full-frame upload and read-back.
 */
export function isNeutralAdjust(settings: AdjustSettings): boolean {
	return (
		settings.exposure === 0 &&
		settings.contrast === 0 &&
		settings.temperature === 0 &&
		settings.tint === 0 &&
		settings.highlights === 0 &&
		settings.shadows === 0 &&
		settings.whites === 0 &&
		settings.blacks === 0 &&
		settings.gamma === 0 &&
		settings.fade === 0 &&
		settings.vibrance === 0 &&
		settings.saturation === 0 &&
		settings.hue === 0 &&
		settings.clarity === 0 &&
		settings.sharpness === 0 &&
		(settings.band === null || (settings.band.hue === 0 && settings.band.saturation === 0 && settings.band.luminance === 0))
	)
}

const FRAGMENT_SOURCE = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uImage;
uniform sampler2D uBlur;

uniform vec2 uTexel;
uniform float uExposure;
uniform float uContrast;
uniform float uTemperature;
uniform float uTint;
uniform float uHighlights;
uniform float uShadows;
uniform float uWhites;
uniform float uBlacks;
uniform float uGamma;
uniform float uFade;
uniform float uVibrance;
uniform float uSaturation;
uniform float uHue;
uniform float uClarity;
uniform float uSharpness;
uniform float uBandCenter;
uniform float uBandWidth;
uniform float uBandHue;
uniform float uBandSat;
uniform float uBandLum;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

// The real sRGB transfer function, not a 2.2 power approximation: the linear
// toe near black is exactly where shadow work happens, and the cheap version
// crushes it.
vec3 toLinear(vec3 c) {
	return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}

vec3 toSrgb(vec3 c) {
	c = max(c, vec3(0.0));
	return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

vec3 rgbToHsl(vec3 c) {
	float maxC = max(c.r, max(c.g, c.b));
	float minC = min(c.r, min(c.g, c.b));
	float l = (maxC + minC) * 0.5;
	float d = maxC - minC;
	if (d < 1e-6) return vec3(0.0, 0.0, l);
	float s = l > 0.5 ? d / max(2.0 - maxC - minC, 1e-6) : d / max(maxC + minC, 1e-6);
	float h;
	if (maxC == c.r) h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0);
	else if (maxC == c.g) h = (c.b - c.r) / d + 2.0;
	else h = (c.r - c.g) / d + 4.0;
	return vec3(h / 6.0, s, l);
}

float hueChannel(float p, float q, float t) {
	t = fract(t);
	if (t < 1.0 / 6.0) return p + (q - p) * 6.0 * t;
	if (t < 0.5) return q;
	if (t < 2.0 / 3.0) return p + (q - p) * (2.0 / 3.0 - t) * 6.0;
	return p;
}

vec3 hslToRgb(vec3 hsl) {
	if (hsl.y < 1e-6) return vec3(hsl.z);
	float q = hsl.z < 0.5 ? hsl.z * (1.0 + hsl.y) : hsl.z + hsl.y - hsl.z * hsl.y;
	float p = 2.0 * hsl.z - q;
	return vec3(hueChannel(p, q, hsl.x + 1.0 / 3.0), hueChannel(p, q, hsl.x), hueChannel(p, q, hsl.x - 1.0 / 3.0));
}

vec3 grade(vec3 colour) {
	// --- white balance, before anything is judged against neutral -----------
	if (uTemperature != 0.0 || uTint != 0.0) {
		colour.r *= 1.0 + uTemperature * 0.32;
		colour.b *= 1.0 - uTemperature * 0.32;
		colour.g *= 1.0 - uTint * 0.22;
		colour.r *= 1.0 + uTint * 0.10;
		colour.b *= 1.0 + uTint * 0.10;
	}

	// --- exposure and contrast, in linear light ----------------------------
	vec3 linear = toLinear(clamp(colour, 0.0, 1.0));
	if (uExposure != 0.0) linear *= exp2(uExposure);
	if (uContrast != 0.0) {
		// 0.18 is an 18% grey card - the point a contrast change should pivot
		// around if it is not to shift the overall exposure with it.
		float amount = 1.0 + uContrast;
		linear = max(vec3(0.0), (linear - 0.18) * amount + 0.18);
	}
	colour = clamp(toSrgb(linear), 0.0, 1.0);

	// --- the four tonal regions, in display space --------------------------
	float luma = dot(colour, LUMA);
	if (uHighlights != 0.0) {
		// smoothstep, not a hard threshold: a region mask with an edge in it
		// prints as a visible band across a sky.
		float mask = smoothstep(0.5, 1.0, luma);
		colour += uHighlights * 0.35 * mask * (1.0 - colour);
		if (uHighlights < 0.0) colour = mix(colour, colour * (1.0 + uHighlights * 0.35 * mask), 1.0);
	}
	if (uShadows != 0.0) {
		float mask = 1.0 - smoothstep(0.0, 0.5, luma);
		colour += uShadows * 0.35 * mask * (uShadows > 0.0 ? (1.0 - colour) : colour);
	}
	if (uWhites != 0.0) {
		float mask = smoothstep(0.6, 1.0, luma);
		colour += uWhites * 0.22 * mask;
	}
	if (uBlacks != 0.0) {
		float mask = 1.0 - smoothstep(0.0, 0.35, luma);
		colour += uBlacks * 0.22 * mask;
	}
	colour = clamp(colour, 0.0, 1.0);

	// --- gamma, then fade --------------------------------------------------
	if (uGamma != 0.0) colour = pow(colour, vec3(1.0 / (1.0 + uGamma * 0.6)));
	if (uFade > 0.0) colour = mix(colour, colour * (1.0 - uFade * 0.35) + uFade * 0.16, 1.0);

	// --- the one-band HSL trim ---------------------------------------------
	if (uBandWidth > 0.0 && (uBandHue != 0.0 || uBandSat != 0.0 || uBandLum != 0.0)) {
		vec3 hsl = rgbToHsl(colour);
		// Hue is a circle, so the distance has to wrap: 0.02 and 0.98 are
		// neighbours, not opposites.
		float delta = abs(fract(hsl.x - uBandCenter + 0.5) - 0.5);
		float weight = 1.0 - smoothstep(uBandWidth * 0.5, uBandWidth, delta);
		// Grey has no hue to belong to a band; without this a desaturated wall
		// picks up whichever band happens to be selected.
		weight *= smoothstep(0.04, 0.18, hsl.y);
		if (weight > 0.0) {
			hsl.x = fract(hsl.x + uBandHue * (60.0 / 360.0) * weight);
			hsl.y = clamp(hsl.y * (1.0 + uBandSat * weight), 0.0, 1.0);
			hsl.z = clamp(hsl.z + uBandLum * 0.25 * weight, 0.0, 1.0);
			colour = hslToRgb(hsl);
		}
	}

	// --- vibrance, saturation, hue -----------------------------------------
	if (uVibrance != 0.0) {
		float grey = dot(colour, LUMA);
		float current = max(colour.r, max(colour.g, colour.b)) - min(colour.r, min(colour.g, colour.b));
		// The whole point of vibrance: what is already vivid is left alone, so
		// skin and saturated logos do not blow out while a flat sky comes up.
		float weight = 1.0 - current;
		colour = mix(vec3(grey), colour, 1.0 + uVibrance * weight);
	}
	if (uSaturation != 0.0) {
		float grey = dot(colour, LUMA);
		colour = mix(vec3(grey), colour, 1.0 + uSaturation);
	}
	if (uHue != 0.0) {
		vec3 hsl = rgbToHsl(clamp(colour, 0.0, 1.0));
		hsl.x = fract(hsl.x + uHue / 360.0);
		colour = hslToRgb(hsl);
	}

	return clamp(colour, 0.0, 1.0);
}

void main() {
	vec3 colour = texture(uImage, vUv).rgb;

	if (uClarity != 0.0) {
		// Local contrast is the difference between a pixel and its
		// neighbourhood; adding a scaled copy of that back is what makes
		// texture read without touching global contrast. Weighted toward the
		// midtones so it does not eat highlight or shadow detail.
		vec3 blurred = texture(uBlur, vUv).rgb;
		float luma = dot(colour, LUMA);
		float weight = 1.0 - abs(luma * 2.0 - 1.0);
		colour += (colour - blurred) * uClarity * 1.4 * (0.35 + 0.65 * weight);
		colour = clamp(colour, 0.0, 1.0);
	}

	colour = grade(colour);

	if (uSharpness > 0.0) {
		// A four-neighbour unsharp mask applied after the grade, so it sharpens
		// what will actually be seen rather than what came out of the decoder.
		vec3 sum =
			grade(texture(uImage, vUv + vec2(uTexel.x, 0.0)).rgb) +
			grade(texture(uImage, vUv - vec2(uTexel.x, 0.0)).rgb) +
			grade(texture(uImage, vUv + vec2(0.0, uTexel.y)).rgb) +
			grade(texture(uImage, vUv - vec2(0.0, uTexel.y)).rgb);
		colour = clamp(colour + (colour - sum * 0.25) * uSharpness * 1.6, 0.0, 1.0);
	}

	fragColor = vec4(colour, 1.0);
}
`

function createGpuProcessor(settings: AdjustSettings): AdjustProcessor | null {
	const surface = acquireGlSurface()
	if (!surface) return null
	const { gl } = surface
	const program = surface.program('adjust', FRAGMENT_SOURCE)
	if (!program) return null

	const imageTexture = createTexture2D(gl)
	const blurTexture = createTexture2D(gl)
	if (!imageTexture || !blurTexture) return null

	const needsBlur = settings.clarity !== 0
	let scratch: { canvas: OffscreenCanvas; ctx: OffscreenCanvasRenderingContext2D } | null = null
	if (needsBlur && typeof OffscreenCanvas !== 'undefined') {
		const canvas = new OffscreenCanvas(2, 2)
		const ctx = canvas.getContext('2d')
		if (ctx) scratch = { canvas, ctx }
	}
	if (!scratch) uploadPixels2D(gl, 1, blurTexture, 1, 1, new Uint8Array([0, 0, 0, 255]))

	const band = settings.band

	return {
		degraded: false,
		apply(ctx, width, height) {
			const source = ctx.canvas as unknown as TexImageSource
			surface.resize(width, height)
			uploadTexture2D(gl, 0, imageTexture, source)

			if (scratch) {
				// A half-resolution blur is both faster and a better clarity
				// reference than a full-resolution one - the radius wanted here is
				// large, and detail in the reference is exactly what must not be
				// there.
				const w = Math.max(2, Math.round(width / 2))
				const h = Math.max(2, Math.round(height / 2))
				if (scratch.canvas.width !== w || scratch.canvas.height !== h) {
					scratch.canvas.width = w
					scratch.canvas.height = h
				}
				scratch.ctx.filter = `blur(${Math.max(1, Math.round(h * 0.012))}px)`
				scratch.ctx.clearRect(0, 0, w, h)
				scratch.ctx.drawImage(source as CanvasImageSource, 0, 0, w, h)
				scratch.ctx.filter = 'none'
				uploadTexture2D(gl, 1, blurTexture, scratch.canvas)
			}

			gl.useProgram(program.handle)
			gl.uniform1i(program.uniform('uImage'), 0)
			gl.uniform1i(program.uniform('uBlur'), 1)
			gl.uniform2f(program.uniform('uTexel'), 1 / Math.max(1, width), 1 / Math.max(1, height))
			gl.uniform1f(program.uniform('uExposure'), settings.exposure)
			gl.uniform1f(program.uniform('uContrast'), settings.contrast)
			gl.uniform1f(program.uniform('uTemperature'), settings.temperature)
			gl.uniform1f(program.uniform('uTint'), settings.tint)
			gl.uniform1f(program.uniform('uHighlights'), settings.highlights)
			gl.uniform1f(program.uniform('uShadows'), settings.shadows)
			gl.uniform1f(program.uniform('uWhites'), settings.whites)
			gl.uniform1f(program.uniform('uBlacks'), settings.blacks)
			gl.uniform1f(program.uniform('uGamma'), settings.gamma)
			gl.uniform1f(program.uniform('uFade'), settings.fade)
			gl.uniform1f(program.uniform('uVibrance'), settings.vibrance)
			gl.uniform1f(program.uniform('uSaturation'), settings.saturation)
			gl.uniform1f(program.uniform('uHue'), settings.hue)
			gl.uniform1f(program.uniform('uClarity'), settings.clarity)
			gl.uniform1f(program.uniform('uSharpness'), settings.sharpness)
			gl.uniform1f(program.uniform('uBandCenter'), band?.center ?? 0)
			gl.uniform1f(program.uniform('uBandWidth'), band?.width ?? 0)
			gl.uniform1f(program.uniform('uBandHue'), band?.hue ?? 0)
			gl.uniform1f(program.uniform('uBandSat'), band?.saturation ?? 0)
			gl.uniform1f(program.uniform('uBandLum'), band?.luminance ?? 0)

			surface.drawQuad(program)
			ctx.clearRect(0, 0, width, height)
			ctx.drawImage(surface.canvas as unknown as CanvasImageSource, 0, 0)
		},
		dispose() {
			gl.deleteTexture(imageTexture)
			gl.deleteTexture(blurTexture)
		},
	}
}

/* ==========================================================================
   The CPU path.

   Same chain, same constants, one pixel at a time. It exists so a machine
   without WebGL2 renders slowly instead of failing, and it is written to be
   read against the shader above - the helpers below are the GLSL builtins the
   shader gets for free.
   ========================================================================== */

function srgbToLinear(c: number): number {
	return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

function linearToSrgb(c: number): number {
	if (c <= 0) return 0
	return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
}

function smoothstep(edge0: number, edge1: number, x: number): number {
	const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0 || 1e-6)))
	return t * t * (3 - 2 * t)
}

function clamp01(value: number): number {
	return value < 0 ? 0 : value > 1 ? 1 : value
}

type Hsl = { h: number; s: number; l: number }

function rgbToHsl(r: number, g: number, b: number): Hsl {
	const maxC = Math.max(r, g, b)
	const minC = Math.min(r, g, b)
	const l = (maxC + minC) / 2
	const d = maxC - minC
	if (d < 1e-6) return { h: 0, s: 0, l }
	const s = l > 0.5 ? d / Math.max(2 - maxC - minC, 1e-6) : d / Math.max(maxC + minC, 1e-6)
	let h: number
	if (maxC === r) h = (g - b) / d + (g < b ? 6 : 0)
	else if (maxC === g) h = (b - r) / d + 2
	else h = (r - g) / d + 4
	return { h: h / 6, s, l }
}

function hueChannel(p: number, q: number, t: number): number {
	const x = t - Math.floor(t)
	if (x < 1 / 6) return p + (q - p) * 6 * x
	if (x < 0.5) return q
	if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6
	return p
}

function hslToRgb(hsl: Hsl): [number, number, number] {
	if (hsl.s < 1e-6) return [hsl.l, hsl.l, hsl.l]
	const q = hsl.l < 0.5 ? hsl.l * (1 + hsl.s) : hsl.l + hsl.s - hsl.l * hsl.s
	const p = 2 * hsl.l - q
	return [hueChannel(p, q, hsl.h + 1 / 3), hueChannel(p, q, hsl.h), hueChannel(p, q, hsl.h - 1 / 3)]
}

/** The shader's `grade()`, pixel by pixel. Values in and out are 0-1. */
function gradePixel(rgb: [number, number, number], s: AdjustSettings): [number, number, number] {
	let [r, g, b] = rgb

	if (s.temperature !== 0 || s.tint !== 0) {
		r *= 1 + s.temperature * 0.32
		b *= 1 - s.temperature * 0.32
		g *= 1 - s.tint * 0.22
		r *= 1 + s.tint * 0.1
		b *= 1 + s.tint * 0.1
	}

	let lr = srgbToLinear(clamp01(r))
	let lg = srgbToLinear(clamp01(g))
	let lb = srgbToLinear(clamp01(b))
	if (s.exposure !== 0) {
		const gain = Math.pow(2, s.exposure)
		lr *= gain
		lg *= gain
		lb *= gain
	}
	if (s.contrast !== 0) {
		const amount = 1 + s.contrast
		lr = Math.max(0, (lr - 0.18) * amount + 0.18)
		lg = Math.max(0, (lg - 0.18) * amount + 0.18)
		lb = Math.max(0, (lb - 0.18) * amount + 0.18)
	}
	r = clamp01(linearToSrgb(lr))
	g = clamp01(linearToSrgb(lg))
	b = clamp01(linearToSrgb(lb))

	const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
	if (s.highlights !== 0) {
		const mask = smoothstep(0.5, 1, luma) * s.highlights * 0.35
		r += mask * (1 - r)
		g += mask * (1 - g)
		b += mask * (1 - b)
	}
	if (s.shadows !== 0) {
		const mask = (1 - smoothstep(0, 0.5, luma)) * s.shadows * 0.35
		r += mask * (s.shadows > 0 ? 1 - r : r)
		g += mask * (s.shadows > 0 ? 1 - g : g)
		b += mask * (s.shadows > 0 ? 1 - b : b)
	}
	if (s.whites !== 0) {
		const add = smoothstep(0.6, 1, luma) * s.whites * 0.22
		r += add
		g += add
		b += add
	}
	if (s.blacks !== 0) {
		const add = (1 - smoothstep(0, 0.35, luma)) * s.blacks * 0.22
		r += add
		g += add
		b += add
	}
	r = clamp01(r)
	g = clamp01(g)
	b = clamp01(b)

	if (s.gamma !== 0) {
		const power = 1 / (1 + s.gamma * 0.6)
		r = Math.pow(r, power)
		g = Math.pow(g, power)
		b = Math.pow(b, power)
	}
	if (s.fade > 0) {
		const scale = 1 - s.fade * 0.35
		const lift = s.fade * 0.16
		r = r * scale + lift
		g = g * scale + lift
		b = b * scale + lift
	}

	const band = s.band
	if (band && band.width > 0 && (band.hue !== 0 || band.saturation !== 0 || band.luminance !== 0)) {
		const hsl = rgbToHsl(r, g, b)
		const raw = hsl.h - band.center + 0.5
		const delta = Math.abs(raw - Math.floor(raw) - 0.5)
		let weight = 1 - smoothstep(band.width * 0.5, band.width, delta)
		weight *= smoothstep(0.04, 0.18, hsl.s)
		if (weight > 0) {
			const shifted = hsl.h + band.hue * (60 / 360) * weight
			hsl.h = shifted - Math.floor(shifted)
			hsl.s = clamp01(hsl.s * (1 + band.saturation * weight))
			hsl.l = clamp01(hsl.l + band.luminance * 0.25 * weight)
			;[r, g, b] = hslToRgb(hsl)
		}
	}

	if (s.vibrance !== 0) {
		const grey = 0.2126 * r + 0.7152 * g + 0.0722 * b
		const current = Math.max(r, g, b) - Math.min(r, g, b)
		const amount = 1 + s.vibrance * (1 - current)
		r = grey + (r - grey) * amount
		g = grey + (g - grey) * amount
		b = grey + (b - grey) * amount
	}
	if (s.saturation !== 0) {
		const grey = 0.2126 * r + 0.7152 * g + 0.0722 * b
		const amount = 1 + s.saturation
		r = grey + (r - grey) * amount
		g = grey + (g - grey) * amount
		b = grey + (b - grey) * amount
	}
	if (s.hue !== 0) {
		const hsl = rgbToHsl(clamp01(r), clamp01(g), clamp01(b))
		const shifted = hsl.h + s.hue / 360
		hsl.h = shifted - Math.floor(shifted)
		;[r, g, b] = hslToRgb(hsl)
	}

	return [clamp01(r), clamp01(g), clamp01(b)]
}

function createCpuProcessor(settings: AdjustSettings): AdjustProcessor {
	return {
		degraded: true,
		apply(ctx, width, height) {
			// Clarity and sharpen both need a neighbourhood, and the browser's own
			// blur is far faster than a hand-rolled one - so the reference copy is
			// made with canvas filters and only the per-pixel maths is done here.
			let blurData: Uint8ClampedArray | null = null
			if (settings.clarity !== 0 && typeof OffscreenCanvas !== 'undefined') {
				const scratch = new OffscreenCanvas(width, height)
				const scratchCtx = scratch.getContext('2d')
				if (scratchCtx) {
					scratchCtx.filter = `blur(${Math.max(1, Math.round(height * 0.012))}px)`
					scratchCtx.drawImage(ctx.canvas as unknown as CanvasImageSource, 0, 0)
					blurData = scratchCtx.getImageData(0, 0, width, height).data
				}
			}

			const image = ctx.getImageData(0, 0, width, height)
			const data = image.data
			const graded = new Uint8ClampedArray(data.length)

			for (let i = 0; i < data.length; i += 4) {
				let r = data[i] / 255
				let g = data[i + 1] / 255
				let b = data[i + 2] / 255

				if (blurData) {
					const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
					const weight = settings.clarity * 1.4 * (0.35 + 0.65 * (1 - Math.abs(luma * 2 - 1)))
					r = clamp01(r + (r - blurData[i] / 255) * weight)
					g = clamp01(g + (g - blurData[i + 1] / 255) * weight)
					b = clamp01(b + (b - blurData[i + 2] / 255) * weight)
				}

				const out = gradePixel([r, g, b], settings)
				graded[i] = out[0] * 255
				graded[i + 1] = out[1] * 255
				graded[i + 2] = out[2] * 255
				graded[i + 3] = data[i + 3]
			}

			if (settings.sharpness > 0) {
				const amount = settings.sharpness * 1.6
				const sharpened = new Uint8ClampedArray(graded.length)
				for (let y = 0; y < height; y++) {
					for (let x = 0; x < width; x++) {
						const index = (y * width + x) * 4
						for (let channel = 0; channel < 3; channel++) {
							const c = graded[index + channel]
							const up = y > 0 ? graded[index - width * 4 + channel] : c
							const down = y < height - 1 ? graded[index + width * 4 + channel] : c
							const left = x > 0 ? graded[index - 4 + channel] : c
							const right = x < width - 1 ? graded[index + 4 + channel] : c
							sharpened[index + channel] = c + (c - (up + down + left + right) * 0.25) * amount
						}
						sharpened[index + 3] = graded[index + 3]
					}
				}
				image.data.set(sharpened)
			} else {
				image.data.set(graded)
			}

			ctx.putImageData(image, 0, 0)
		},
		dispose() {},
	}
}

/** GPU when the machine has one, the same chain on the CPU when it does not. */
export function createAdjustProcessor(settings: AdjustSettings): AdjustProcessor {
	return createGpuProcessor(settings) ?? createCpuProcessor(settings)
}

/** Exposed for the offline checks, which verify the two paths agree. */
export function adjustPixelForTest(rgb: [number, number, number], settings: AdjustSettings): [number, number, number] {
	return gradePixel(rgb, settings)
}
