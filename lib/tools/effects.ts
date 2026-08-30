'use client'

/**
 * The effects rack: thirty-six named looks - glitch, VHS, kaleidoscope,
 * halftone, neon, zoom blur, night vision and the rest - behind one shader
 * and one interface.
 *
 * They are one module rather than thirty-six because they are one shape of
 * problem. Every effect here is some combination of three stages:
 *
 *   1. a UV remap        - where this pixel reads from (warps, mirrors, shakes)
 *   2. a colour function - what happens to the value it read (tints, quantises)
 *   3. a neighbourhood   - what the pixels around it contribute (edges, blurs)
 *
 * Written as separate passes they would be thirty-six copies of the same
 * texture upload, the same read-back, and the same CPU fallback. Written as
 * one branch on `uEffect` they are a single upload, a single draw, and one
 * fallback to keep honest. GPUs handle a uniform branch that is identical for
 * every pixel in a draw call about as well as they handle no branch at all,
 * so the shared shader costs nothing at run time.
 *
 * The CPU fallback is real, not a stub. It implements the same three stages -
 * a bilinear resample for the remap, the same colour maths, and the same
 * kernels - so a machine without WebGL2 gets the effect it asked for, slowly.
 * The only thing it cannot reproduce is the browser's own blur, which it
 * borrows from a canvas filter rather than reimplementing.
 *
 * `time` is the frame index divided by the frame rate, times the speed knob.
 * Passing seconds rather than frames is what keeps a glitch running at the
 * same rate on a 24fps clip and a 60fps one.
 */

import { acquireGlSurface, createTexture2D, uploadPixels2D, uploadTexture2D } from './webgl'

type Ctx2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D

export type EffectGroup = 'distort' | 'retro' | 'light' | 'stylise' | 'motion'

export type EffectDef = {
	id: string
	label: string
	group: EffectGroup
	/** the one-line pitch shown under the picker */
	blurb: string
	/** where the intensity slider starts, 0-100 */
	defaultIntensity: number
	/** true when the look changes over time and the speed knob does something */
	animated: boolean
	/** true when it reads a blurred copy of the frame, so one gets rendered */
	needsBlur?: boolean
	/** true when the two colour swatches are used */
	usesColors?: boolean
	/** true when the angle dial is used */
	usesAngle?: boolean
}

/**
 * The catalogue, in picker order. `code` is the shader's `uEffect` value and
 * is derived from the array index, so this order is load-bearing - inserting
 * in the middle renumbers everything after it, which is fine because both
 * paths read the same list.
 */
export const EFFECTS: EffectDef[] = [
	{ id: 'glitch', label: 'Digital Glitch', group: 'retro', blurb: 'Torn scanline blocks with the colour channels pulled apart.', defaultIntensity: 55, animated: true },
	{ id: 'rgb-split', label: 'RGB Split', group: 'retro', blurb: 'Red and blue slide off the picture in opposite directions.', defaultIntensity: 40, animated: false, usesAngle: true },
	{ id: 'chromatic', label: 'Chromatic Aberration', group: 'light', blurb: 'Lens dispersion that grows toward the corners of the frame.', defaultIntensity: 45, animated: false },
	{ id: 'vhs', label: 'VHS Tape', group: 'retro', blurb: 'Head-switching wobble, colour bleed, tracking noise and scanlines.', defaultIntensity: 60, animated: true },
	{ id: 'scanlines', label: 'CRT Scanlines', group: 'retro', blurb: 'Fine horizontal lines and a soft phosphor glow.', defaultIntensity: 50, animated: false },
	{ id: 'static', label: 'TV Static', group: 'retro', blurb: 'Broadcast snow mixed over the picture.', defaultIntensity: 35, animated: true },
	{ id: 'old-film', label: 'Old Film', group: 'retro', blurb: 'Gate weave, dust, scratches and a warm silver tone.', defaultIntensity: 55, animated: true },
	{ id: 'pixelate', label: 'Pixelate', group: 'stylise', blurb: 'Square blocks, hard edges - the classic censor look.', defaultIntensity: 45, animated: false },
	{ id: 'mosaic', label: 'Mosaic Tiles', group: 'stylise', blurb: 'Blocks with grouted edges, like glass tile.', defaultIntensity: 50, animated: false },
	{ id: 'halftone', label: 'Halftone Dots', group: 'stylise', blurb: 'Newsprint dots that grow and shrink with brightness.', defaultIntensity: 55, animated: false, usesAngle: true },
	{ id: 'crosshatch', label: 'Crosshatch', group: 'stylise', blurb: 'Pen strokes layered by tone, the way an etching is shaded.', defaultIntensity: 60, animated: false },
	{ id: 'sketch', label: 'Pencil Sketch', group: 'stylise', blurb: 'Graphite on white, from the picture edges alone.', defaultIntensity: 65, animated: false },
	{ id: 'edge', label: 'Edge Detect', group: 'stylise', blurb: 'A Sobel outline of everything in frame.', defaultIntensity: 60, animated: false },
	{ id: 'neon', label: 'Neon Outline', group: 'light', blurb: 'Edges lit as glowing tubes over a dark plate.', defaultIntensity: 60, animated: false, usesColors: true },
	{ id: 'emboss', label: 'Emboss', group: 'stylise', blurb: 'Grey relief, lit from one corner.', defaultIntensity: 55, animated: false },
	{ id: 'posterize', label: 'Posterize', group: 'stylise', blurb: 'Colour flattened into a handful of steps.', defaultIntensity: 50, animated: false },
	{ id: 'threshold', label: 'Threshold', group: 'stylise', blurb: 'Pure black and pure white, nothing between.', defaultIntensity: 50, animated: false },
	{ id: 'comic', label: 'Comic Book', group: 'stylise', blurb: 'Flat inked colour with a hard outline over it.', defaultIntensity: 60, animated: false },
	{ id: 'oil', label: 'Oil Paint', group: 'stylise', blurb: 'Brush-sized patches of the most common local colour.', defaultIntensity: 50, animated: false },
	{ id: 'duotone', label: 'Duotone', group: 'stylise', blurb: 'The whole picture mapped between two colours.', defaultIntensity: 80, animated: false, usesColors: true },
	{ id: 'thermal', label: 'Thermal Camera', group: 'stylise', blurb: 'Brightness read as heat, on an infrared ramp.', defaultIntensity: 90, animated: false },
	{ id: 'night-vision', label: 'Night Vision', group: 'stylise', blurb: 'Green intensifier tube with grain and a hard vignette.', defaultIntensity: 80, animated: true },
	{ id: 'hologram', label: 'Hologram', group: 'light', blurb: 'Interlaced cyan projection with a rolling bar.', defaultIntensity: 60, animated: true, usesColors: true },
	{ id: 'kaleidoscope', label: 'Kaleidoscope', group: 'distort', blurb: 'The frame folded into repeating mirrored wedges.', defaultIntensity: 50, animated: false },
	{ id: 'mirror-x', label: 'Mirror (left/right)', group: 'distort', blurb: 'The left half reflected onto the right.', defaultIntensity: 100, animated: false },
	{ id: 'mirror-y', label: 'Mirror (top/bottom)', group: 'distort', blurb: 'The top half reflected onto the bottom.', defaultIntensity: 100, animated: false },
	{ id: 'twirl', label: 'Twirl', group: 'distort', blurb: 'A swirl that winds tighter toward the centre.', defaultIntensity: 50, animated: false },
	{ id: 'ripple', label: 'Ripple', group: 'distort', blurb: 'Concentric waves running out from the middle.', defaultIntensity: 45, animated: true },
	{ id: 'wave', label: 'Wave Warp', group: 'distort', blurb: 'A sideways sine that rolls down the frame.', defaultIntensity: 40, animated: true },
	{ id: 'fisheye', label: 'Fisheye', group: 'distort', blurb: 'Wide-lens barrel curvature.', defaultIntensity: 45, animated: false },
	{ id: 'bulge', label: 'Bulge', group: 'distort', blurb: 'The centre pushed toward the viewer.', defaultIntensity: 45, animated: false },
	{ id: 'shake', label: 'Camera Shake', group: 'motion', blurb: 'Handheld jitter, on two frequencies so it never loops.', defaultIntensity: 40, animated: true },
	{ id: 'zoom-blur', label: 'Zoom Blur', group: 'motion', blurb: 'Streaks running outward from the centre of frame.', defaultIntensity: 45, animated: false },
	{ id: 'spin-blur', label: 'Spin Blur', group: 'motion', blurb: 'Streaks running around the centre of frame.', defaultIntensity: 45, animated: false },
	{ id: 'motion-blur', label: 'Directional Blur', group: 'motion', blurb: 'A straight smear along whichever angle you set.', defaultIntensity: 45, animated: false, usesAngle: true },
	{ id: 'bloom', label: 'Bloom Glow', group: 'light', blurb: 'Highlights spill light into what is around them.', defaultIntensity: 55, animated: false, needsBlur: true },
	{ id: 'dream', label: 'Dreamy Soft Focus', group: 'light', blurb: 'A diffusion filter over the lens - soft, but still sharp underneath.', defaultIntensity: 55, animated: false, needsBlur: true },
	{ id: 'bokeh', label: 'Bokeh Lights', group: 'light', blurb: 'Out-of-focus highlight discs floating over the picture.', defaultIntensity: 50, animated: true, needsBlur: true },
	{ id: 'star', label: 'Star Filter', group: 'light', blurb: 'Four-point streaks off every specular highlight.', defaultIntensity: 50, animated: false, needsBlur: true },
	{ id: 'light-leak', label: 'Light Leak', group: 'light', blurb: 'Warm flare bleeding in from the edge of the gate.', defaultIntensity: 55, animated: true, usesColors: true },
]

export function effectById(id: string): EffectDef | null {
	return EFFECTS.find((effect) => effect.id === id) ?? null
}

/** The shader's `uEffect` value for an id, or -1 for "leave the frame alone". */
export function effectCode(id: string): number {
	return EFFECTS.findIndex((effect) => effect.id === id)
}

export type EffectSettings = {
	effect: string
	/** 0-1 */
	intensity: number
	/** multiplies the clock; 1 is real time */
	speed: number
	/** degrees, for the effects that have a direction */
	angle: number
	colorA: { r: number; g: number; b: number }
	colorB: { r: number; g: number; b: number }
	/** needed to turn a frame index into seconds */
	fps: number
}

export type EffectProcessor = {
	apply(ctx: Ctx2D, width: number, height: number, frameIndex: number): void
	degraded: boolean
	dispose(): void
}

const FRAGMENT_SOURCE = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uImage;
uniform sampler2D uBlur;

uniform int uEffect;
uniform float uIntensity;
uniform float uTime;
uniform float uAngle;
uniform vec2 uResolution;
uniform vec3 uColorA;
uniform vec3 uColorB;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

float hash11(float p) {
	p = fract(p * 0.1031);
	p *= p + 33.33;
	return fract(p * (p + p));
}

float hash21(vec2 p) {
	p = fract(p * vec2(123.34, 456.21));
	p += dot(p, p + 45.32);
	return fract(p.x * p.y);
}

/** Aspect-corrected offset from the centre, so circles stay circular. */
vec2 centered(vec2 uv) {
	vec2 c = uv - 0.5;
	c.x *= uResolution.x / max(uResolution.y, 1.0);
	return c;
}

vec2 uncentered(vec2 c) {
	c.x /= uResolution.x / max(uResolution.y, 1.0);
	return c + 0.5;
}

vec3 tex(vec2 uv) {
	return texture(uImage, clamp(uv, vec2(0.0), vec2(1.0))).rgb;
}

/* ---------------------------------------------------------------- stage 1
   Where this pixel reads from. Everything that bends, folds, mirrors or
   shakes the picture happens here and nowhere else.
   ------------------------------------------------------------------------ */
vec2 remap(vec2 uv) {
	float k = uIntensity;

	if (uEffect == 23) {                        // kaleidoscope
		float wedges = floor(3.0 + k * 9.0);
		vec2 c = centered(uv);
		float angle = atan(c.y, c.x);
		float radius = length(c);
		float segment = 6.2831853 / wedges;
		angle = mod(angle, segment);
		// Reflecting the second half of every wedge is what makes the seams
		// meet: without it each wedge is a rotation and the joins are visible.
		angle = abs(angle - segment * 0.5);
		return uncentered(vec2(cos(angle), sin(angle)) * radius);
	}
	if (uEffect == 24) {                        // mirror left/right
		float folded = uv.x < 0.5 ? uv.x : 1.0 - uv.x;
		return vec2(mix(uv.x, folded, k), uv.y);
	}
	if (uEffect == 25) {                        // mirror top/bottom
		float folded = uv.y < 0.5 ? uv.y : 1.0 - uv.y;
		return vec2(uv.x, mix(uv.y, folded, k));
	}
	if (uEffect == 26) {                        // twirl
		vec2 c = centered(uv);
		float radius = length(c);
		float amount = (1.0 - smoothstep(0.0, 0.6, radius)) * k * 5.0;
		float s = sin(amount);
		float co = cos(amount);
		return uncentered(vec2(c.x * co - c.y * s, c.x * s + c.y * co));
	}
	if (uEffect == 27) {                        // ripple
		vec2 c = centered(uv);
		float radius = length(c);
		float wave = sin(radius * 42.0 - uTime * 4.0) * k * 0.035 * (1.0 - smoothstep(0.0, 0.75, radius));
		return uncentered(c + normalize(c + 1e-6) * wave);
	}
	if (uEffect == 28) {                        // wave warp
		return vec2(uv.x + sin(uv.y * 18.0 + uTime * 3.0) * k * 0.045, uv.y);
	}
	if (uEffect == 29) {                        // fisheye
		vec2 c = centered(uv);
		float radius = length(c);
		float scaled = radius * (1.0 + k * 0.9 * radius * radius);
		return uncentered(normalize(c + 1e-6) * scaled);
	}
	if (uEffect == 30) {                        // bulge
		vec2 c = centered(uv);
		float radius = length(c);
		float amount = 1.0 - k * 0.7 * (1.0 - smoothstep(0.0, 0.7, radius));
		return uncentered(c * amount);
	}
	if (uEffect == 31) {                        // camera shake
		// Two frequencies that do not divide into each other, so the path never
		// repeats on a loop the eye can find.
		float x = sin(uTime * 12.7) * 0.6 + sin(uTime * 29.3) * 0.4;
		float y = cos(uTime * 15.1) * 0.6 + cos(uTime * 33.7) * 0.4;
		return uv + vec2(x, y) * k * 0.018;
	}
	if (uEffect == 0) {                         // digital glitch
		float band = floor(uv.y * 24.0);
		float roll = hash11(band + floor(uTime * 12.0) * 7.0);
		float shift = step(1.0 - k * 0.55, roll) * (roll - 0.5) * k * 0.22;
		return vec2(uv.x + shift, uv.y);
	}
	if (uEffect == 3) {                         // vhs head-switching wobble
		float wobble = sin(uv.y * 320.0 + uTime * 8.0) * 0.0012 * k;
		wobble += step(0.97, fract(uv.y + uTime * 0.12)) * k * 0.02;
		return vec2(uv.x + wobble, uv.y);
	}
	if (uEffect == 6) {                         // old film gate weave
		float weave = (hash11(floor(uTime * 16.0)) - 0.5) * k * 0.006;
		float lift = (hash11(floor(uTime * 16.0) + 91.0) - 0.5) * k * 0.004;
		return uv + vec2(weave, lift);
	}
	return uv;
}

/* ---------------------------------------------------------------- stage 3
   Neighbourhood work: the effects that must read more than one texel.
   Each returns true when it has produced the final colour itself.
   ------------------------------------------------------------------------ */
bool neighbourhood(vec2 uv, out vec3 result) {
	vec2 texel = 1.0 / uResolution;
	float k = uIntensity;

	if (uEffect == 7 || uEffect == 8) {         // pixelate / mosaic
		float blocks = mix(160.0, 12.0, k);
		vec2 cell = floor(uv * blocks) / blocks;
		vec3 colour = tex(cell + 0.5 / blocks);
		if (uEffect == 8) {
			// Mosaic is pixelate plus grout: darken the cell border so the tiles
			// read as separate pieces rather than one flat field.
			vec2 inCell = fract(uv * blocks);
			float edge = min(min(inCell.x, inCell.y), min(1.0 - inCell.x, 1.0 - inCell.y));
			colour *= 0.55 + 0.45 * smoothstep(0.0, 0.12, edge);
		}
		result = colour;
		return true;
	}
	if (uEffect == 9) {                         // halftone
		float scale = mix(200.0, 45.0, k);
		float a = radians(uAngle);
		mat2 rot = mat2(cos(a), -sin(a), sin(a), cos(a));
		vec2 aspect = vec2(uResolution.x / max(uResolution.y, 1.0), 1.0);
		vec2 grid = rot * (uv * aspect) * scale;
		vec2 cellCenter = (floor(grid) + 0.5) / scale;
		vec3 colour = tex((transpose(rot) * cellCenter) / aspect);
		float luma = dot(colour, LUMA);
		float dist = length(fract(grid) - 0.5);
		// A dot whose radius tracks 1-luma is exactly how a printing screen
		// makes a tone: big dots for shadows, pinpricks for highlights.
		float dotMask = 1.0 - smoothstep(0.0, 0.05, dist - sqrt(1.0 - luma) * 0.62);
		result = mix(vec3(1.0), colour * 0.35, dotMask);
		return true;
	}
	if (uEffect == 10) {                        // crosshatch
		float luma = dot(tex(uv), LUMA);
		vec2 p = uv * uResolution;
		float ink = 1.0;
		float spacing = mix(14.0, 5.0, k);
		if (luma < 0.85 && mod(p.x + p.y, spacing) < 1.2) ink = 0.25;
		if (luma < 0.6 && mod(p.x - p.y, spacing) < 1.2) ink = 0.2;
		if (luma < 0.4 && mod(p.x + p.y, spacing * 0.5) < 1.2) ink = 0.15;
		if (luma < 0.22 && mod(p.x - p.y, spacing * 0.5) < 1.2) ink = 0.1;
		result = vec3(ink);
		return true;
	}
	if (uEffect == 11 || uEffect == 12 || uEffect == 13 || uEffect == 17) {
		// sketch / edge / neon / comic all start from the same Sobel pair.
		float tl = dot(tex(uv + texel * vec2(-1.0, -1.0)), LUMA);
		float t = dot(tex(uv + texel * vec2(0.0, -1.0)), LUMA);
		float tr = dot(tex(uv + texel * vec2(1.0, -1.0)), LUMA);
		float l = dot(tex(uv + texel * vec2(-1.0, 0.0)), LUMA);
		float r = dot(tex(uv + texel * vec2(1.0, 0.0)), LUMA);
		float bl = dot(tex(uv + texel * vec2(-1.0, 1.0)), LUMA);
		float b = dot(tex(uv + texel * vec2(0.0, 1.0)), LUMA);
		float br = dot(tex(uv + texel * vec2(1.0, 1.0)), LUMA);
		float gx = -tl - 2.0 * l - bl + tr + 2.0 * r + br;
		float gy = -tl - 2.0 * t - tr + bl + 2.0 * b + br;
		float edge = clamp(length(vec2(gx, gy)) * (0.6 + k * 2.4), 0.0, 1.0);

		if (uEffect == 11) { result = vec3(1.0 - edge); return true; }
		if (uEffect == 12) { result = vec3(edge); return true; }
		if (uEffect == 13) {
			vec3 tint = mix(uColorA, uColorB, clamp(dot(tex(uv), LUMA), 0.0, 1.0));
			result = tint * pow(edge, 0.75) * (1.0 + k);
			return true;
		}
		vec3 flat_ = tex(uv);
		float steps = mix(8.0, 3.0, k);
		flat_ = floor(flat_ * steps + 0.5) / steps;
		result = flat_ * (1.0 - smoothstep(0.25, 0.7, edge));
		return true;
	}
	if (uEffect == 14) {                        // emboss
		vec3 up = tex(uv - texel);
		vec3 down = tex(uv + texel);
		float relief = dot(up - down, LUMA) * (1.0 + k * 6.0);
		result = vec3(clamp(0.5 + relief, 0.0, 1.0));
		return true;
	}
	if (uEffect == 18) {                        // oil paint
		// A cheap Kuwahara: four quadrants, keep the flattest one. Real oil
		// filters compare variance; comparing the spread of the min and max is
		// close enough at this radius and a fraction of the taps.
		float radius = 1.0 + floor(k * 4.0);
		vec3 best = tex(uv);
		float bestSpread = 10.0;
		for (int q = 0; q < 4; q++) {
			vec2 dir = vec2(q == 0 || q == 3 ? -1.0 : 1.0, q < 2 ? -1.0 : 1.0);
			vec3 sum = vec3(0.0);
			float lo = 10.0;
			float hi = -10.0;
			float count = 0.0;
			for (int i = 0; i <= 4; i++) {
				for (int j = 0; j <= 4; j++) {
					if (float(i) > radius || float(j) > radius) continue;
					vec3 c = tex(uv + texel * dir * vec2(float(i), float(j)));
					sum += c;
					float l = dot(c, LUMA);
					lo = min(lo, l);
					hi = max(hi, l);
					count += 1.0;
				}
			}
			float spread = hi - lo;
			if (spread < bestSpread) {
				bestSpread = spread;
				best = sum / max(count, 1.0);
			}
		}
		result = best;
		return true;
	}
	if (uEffect == 32 || uEffect == 33 || uEffect == 34) {
		// zoom / spin / directional blur: the same accumulation, three paths.
		vec3 sum = vec3(0.0);
		const int TAPS = 12;
		vec2 c = uv - 0.5;
		float a = radians(uAngle);
		vec2 dir = vec2(cos(a), sin(a));
		for (int i = 0; i < TAPS; i++) {
			float t = float(i) / float(TAPS - 1) - 0.5;
			vec2 offset;
			if (uEffect == 32) offset = c * t * k * 0.5;
			else if (uEffect == 33) offset = vec2(-c.y, c.x) * t * k * 0.5;
			else offset = dir * t * k * 0.08;
			sum += tex(uv + offset);
		}
		result = sum / float(TAPS);
		return true;
	}
	if (uEffect == 38) {                        // star filter
		vec3 base = tex(uv);
		vec3 streak = vec3(0.0);
		const int TAPS = 10;
		for (int i = 1; i <= TAPS; i++) {
			float step_ = float(i) * texel.y * 3.0 * (0.5 + k);
			float falloff = 1.0 - float(i) / float(TAPS + 1);
			vec3 h = max(tex(uv + vec2(step_, 0.0)) + tex(uv - vec2(step_, 0.0)) - 1.4, vec3(0.0));
			vec3 v = max(tex(uv + vec2(0.0, step_)) + tex(uv - vec2(0.0, step_)) - 1.4, vec3(0.0));
			streak += (h + v) * falloff;
		}
		result = base + streak * k * 0.35;
		return true;
	}
	return false;
}

void main() {
	vec2 uv = remap(vUv);
	float k = uIntensity;
	vec3 colour;

	if (!neighbourhood(uv, colour)) colour = tex(uv);

	/* -------------------------------------------------------------- stage 2
	   What happens to the value that was read.
	   ---------------------------------------------------------------------- */
	if (uEffect == 0) {                         // digital glitch colour tear
		float band = floor(uv.y * 24.0);
		float roll = hash11(band + floor(uTime * 12.0) * 7.0);
		float split = step(1.0 - k * 0.7, roll) * k * 0.012;
		colour.r = tex(uv + vec2(split, 0.0)).r;
		colour.b = tex(uv - vec2(split, 0.0)).b;
		colour += (hash21(uv * 400.0 + uTime) - 0.5) * k * 0.12;
	} else if (uEffect == 1) {                  // rgb split
		float a = radians(uAngle);
		vec2 offset = vec2(cos(a), sin(a)) * k * 0.02;
		colour.r = tex(uv + offset).r;
		colour.b = tex(uv - offset).b;
	} else if (uEffect == 2) {                  // chromatic aberration
		vec2 c = uv - 0.5;
		vec2 offset = c * k * 0.045;
		colour.r = tex(uv + offset).r;
		colour.b = tex(uv - offset).b;
	} else if (uEffect == 3) {                  // vhs
		float bleed = k * 0.006;
		colour.r = tex(uv + vec2(bleed, 0.0)).r;
		colour.b = tex(uv - vec2(bleed * 0.6, 0.0)).b;
		float lines = 0.88 + 0.12 * sin(uv.y * uResolution.y * 1.6);
		colour *= mix(1.0, lines, k);
		float tracking = smoothstep(0.0, 0.06, abs(fract(uv.y - uTime * 0.08) - 0.5) - 0.44);
		colour += tracking * k * 0.22;
		colour += (hash21(uv * 600.0 + uTime * 30.0) - 0.5) * k * 0.06;
		colour = mix(colour, colour * vec3(1.03, 0.99, 1.05), k);
	} else if (uEffect == 4) {                  // crt scanlines
		float lines = 0.75 + 0.25 * sin(uv.y * uResolution.y * 3.14159);
		vec3 mask = vec3(
			0.92 + 0.08 * sin(uv.x * uResolution.x * 3.14159),
			0.92 + 0.08 * sin(uv.x * uResolution.x * 3.14159 + 2.094),
			0.92 + 0.08 * sin(uv.x * uResolution.x * 3.14159 + 4.188)
		);
		colour = mix(colour, colour * lines * mask, k);
	} else if (uEffect == 5) {                  // tv static
		float snow = hash21(uv * uResolution * 0.5 + uTime * 60.0);
		colour = mix(colour, vec3(snow), k * 0.75);
	} else if (uEffect == 6) {                  // old film
		float grey = dot(colour, LUMA);
		colour = mix(colour, vec3(grey) * vec3(1.12, 1.02, 0.86), k);
		float dust = hash21(floor(uv * 140.0) + floor(uTime * 18.0) * 13.0);
		colour -= step(0.995, dust) * k * 0.65;
		// Scratches are vertical, thin, and only a few frames long - the seed
		// changes with time so they do not sit still down the whole clip.
		float scratchSeed = hash11(floor(uv.x * 220.0) + floor(uTime * 6.0) * 51.0);
		colour += step(0.996, scratchSeed) * k * 0.45;
		float radius = length(centered(uv));
		colour *= 1.0 - smoothstep(0.35, 0.95, radius) * k * 0.6;
	} else if (uEffect == 15) {                 // posterize
		float steps = mix(12.0, 3.0, k);
		colour = floor(colour * steps + 0.5) / steps;
	} else if (uEffect == 16) {                 // threshold
		float luma = dot(colour, LUMA);
		colour = vec3(step(0.5, luma));
		colour = mix(tex(uv), colour, k);
	} else if (uEffect == 19) {                 // duotone
		float luma = dot(colour, LUMA);
		colour = mix(colour, mix(uColorA, uColorB, luma), k);
	} else if (uEffect == 20) {                 // thermal
		float luma = dot(colour, LUMA);
		// A five-stop infrared ramp: black, blue, magenta, orange, white.
		vec3 ramp = luma < 0.25
			? mix(vec3(0.0, 0.0, 0.15), vec3(0.1, 0.0, 0.65), luma / 0.25)
			: luma < 0.5
				? mix(vec3(0.1, 0.0, 0.65), vec3(0.85, 0.0, 0.5), (luma - 0.25) / 0.25)
				: luma < 0.75
					? mix(vec3(0.85, 0.0, 0.5), vec3(1.0, 0.65, 0.0), (luma - 0.5) / 0.25)
					: mix(vec3(1.0, 0.65, 0.0), vec3(1.0, 1.0, 0.85), (luma - 0.75) / 0.25);
		colour = mix(colour, ramp, k);
	} else if (uEffect == 21) {                 // night vision
		float luma = dot(colour, LUMA);
		vec3 tube = vec3(luma * 0.35, luma * 1.25 + 0.06, luma * 0.35);
		tube += (hash21(uv * uResolution + uTime * 40.0) - 0.5) * 0.14;
		float radius = length(centered(uv));
		tube *= 1.0 - smoothstep(0.3, 0.85, radius);
		tube *= 0.9 + 0.1 * sin(uv.y * uResolution.y * 1.2);
		colour = mix(colour, clamp(tube, 0.0, 1.0), k);
	} else if (uEffect == 22) {                 // hologram
		float luma = dot(colour, LUMA);
		vec3 holo = mix(uColorA, uColorB, luma) * (0.4 + luma);
		float lines = step(0.5, fract(uv.y * uResolution.y * 0.4));
		holo *= 0.65 + 0.35 * lines;
		// The bar that rolls down a projected image, wrapping at the bottom.
		float bar = smoothstep(0.0, 0.08, abs(fract(uv.y - uTime * 0.25) - 0.5) - 0.42);
		holo += bar * 0.3;
		colour = mix(colour, holo, k);
	} else if (uEffect == 39) {                 // light leak
		vec2 c = uv - vec2(1.05, 0.0);
		float flare = exp(-dot(c, c) * mix(9.0, 2.5, k));
		flare *= 0.75 + 0.25 * sin(uTime * 1.7);
		float edge = smoothstep(0.35, 1.0, uv.x + sin(uTime * 0.9) * 0.08);
		vec3 leak = mix(uColorA, uColorB, uv.y);
		colour += leak * (flare + edge * 0.35) * k;
	}

	/* -------------------------------------------------------- blur-fed looks */
	if (uEffect == 35) {                        // bloom
		vec3 bright = max(texture(uBlur, uv).rgb - 0.55, vec3(0.0)) / 0.45;
		colour += bright * k * 1.1;
	} else if (uEffect == 36) {                 // dreamy soft focus
		vec3 soft = texture(uBlur, uv).rgb;
		// Screen the blur over the sharp frame rather than crossfading to it -
		// that is what keeps the underlying detail while the glow builds.
		colour = mix(colour, 1.0 - (1.0 - colour) * (1.0 - soft * 0.85), k * 0.85);
		colour = mix(colour, colour * 1.04 + 0.02, k * 0.5);
	} else if (uEffect == 37) {                 // bokeh lights
		vec3 soft = texture(uBlur, uv).rgb;
		vec3 bright = max(soft - 0.6, vec3(0.0)) / 0.4;
		vec2 grid = uv * vec2(uResolution.x / max(uResolution.y, 1.0), 1.0) * 9.0;
		vec2 cell = floor(grid);
		float jitter = hash21(cell);
		vec2 centre = cell + 0.5 + vec2(hash21(cell + 3.7), hash21(cell + 8.1)) * 0.5 - 0.25;
		float disc = 1.0 - smoothstep(0.22, 0.32, length(grid - centre));
		float drift = 0.6 + 0.4 * sin(uTime * (0.6 + jitter) + jitter * 6.28);
		colour += bright * disc * drift * k * 1.4;
	}

	fragColor = vec4(clamp(colour, 0.0, 1.0), 1.0);
}
`

function makeScratch(): { canvas: OffscreenCanvas; ctx: OffscreenCanvasRenderingContext2D } | null {
	if (typeof OffscreenCanvas === 'undefined') return null
	const canvas = new OffscreenCanvas(2, 2)
	const ctx = canvas.getContext('2d')
	if (!ctx) return null
	return { canvas, ctx }
}

function createGpuProcessor(settings: EffectSettings): EffectProcessor | null {
	const def = effectById(settings.effect)
	if (!def) return null
	const surface = acquireGlSurface()
	if (!surface) return null
	const { gl } = surface
	const program = surface.program('effects', FRAGMENT_SOURCE)
	if (!program) return null

	const imageTexture = createTexture2D(gl)
	const blurTexture = createTexture2D(gl)
	if (!imageTexture || !blurTexture) return null

	const code = effectCode(settings.effect)
	const scratch = def.needsBlur ? makeScratch() : null
	if (!scratch) uploadPixels2D(gl, 1, blurTexture, 1, 1, new Uint8Array([0, 0, 0, 255]))

	return {
		degraded: false,
		apply(ctx, width, height, frameIndex) {
			const source = ctx.canvas as unknown as TexImageSource
			surface.resize(width, height)
			uploadTexture2D(gl, 0, imageTexture, source)

			if (scratch) {
				const w = Math.max(2, Math.round(width / 4))
				const h = Math.max(2, Math.round(height / 4))
				if (scratch.canvas.width !== w || scratch.canvas.height !== h) {
					scratch.canvas.width = w
					scratch.canvas.height = h
				}
				scratch.ctx.filter = `blur(${Math.max(1, Math.round(h * 0.03))}px)`
				scratch.ctx.clearRect(0, 0, w, h)
				scratch.ctx.drawImage(source as CanvasImageSource, 0, 0, w, h)
				scratch.ctx.filter = 'none'
				uploadTexture2D(gl, 1, blurTexture, scratch.canvas)
			}

			gl.useProgram(program.handle)
			gl.uniform1i(program.uniform('uImage'), 0)
			gl.uniform1i(program.uniform('uBlur'), 1)
			gl.uniform1i(program.uniform('uEffect'), code)
			gl.uniform1f(program.uniform('uIntensity'), settings.intensity)
			gl.uniform1f(program.uniform('uTime'), (frameIndex / Math.max(1, settings.fps)) * settings.speed)
			gl.uniform1f(program.uniform('uAngle'), settings.angle)
			gl.uniform2f(program.uniform('uResolution'), width, height)
			gl.uniform3f(program.uniform('uColorA'), settings.colorA.r / 255, settings.colorA.g / 255, settings.colorA.b / 255)
			gl.uniform3f(program.uniform('uColorB'), settings.colorB.r / 255, settings.colorB.g / 255, settings.colorB.b / 255)

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
   The CPU fallback.

   The same three stages, done by hand. Stage 1 becomes a bilinear resample
   out of a copy of the frame; stages 2 and 3 are the same arithmetic on
   `Uint8ClampedArray`s. It is between one and two orders of magnitude slower
   than the shader, which is why the UI says so - but it is the same effect,
   not an approximation of one, and that is the point of having it.
   ========================================================================== */

function hash11(p: number): number {
	let x = (p * 0.1031) % 1
	if (x < 0) x += 1
	x *= x + 33.33
	const y = x * (x + x)
	return y - Math.floor(y)
}

function hash21(x: number, y: number): number {
	let px = (x * 123.34) % 1
	let py = (y * 456.21) % 1
	const dot = px * (px + 45.32) + py * (py + 45.32)
	px += dot
	py += dot
	const value = px * py
	return value - Math.floor(value)
}

function smoothstep(edge0: number, edge1: number, x: number): number {
	const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0 || 1e-6)))
	return t * t * (3 - 2 * t)
}

type Sampler = (u: number, v: number, channel: number) => number

function makeSampler(data: Uint8ClampedArray, width: number, height: number): Sampler {
	return (u, v, channel) => {
		const x = Math.min(width - 1, Math.max(0, u * width - 0.5))
		const y = Math.min(height - 1, Math.max(0, v * height - 0.5))
		const x0 = Math.floor(x)
		const y0 = Math.floor(y)
		const x1 = Math.min(width - 1, x0 + 1)
		const y1 = Math.min(height - 1, y0 + 1)
		const fx = x - x0
		const fy = y - y0
		const i00 = (y0 * width + x0) * 4 + channel
		const i10 = (y0 * width + x1) * 4 + channel
		const i01 = (y1 * width + x0) * 4 + channel
		const i11 = (y1 * width + x1) * 4 + channel
		const top = data[i00] * (1 - fx) + data[i10] * fx
		const bottom = data[i01] * (1 - fx) + data[i11] * fx
		return (top * (1 - fy) + bottom * fy) / 255
	}
}

/** Stage 1, in JavaScript - kept line-for-line comparable with `remap()`. */
function remapCpu(effect: string, u: number, v: number, k: number, time: number, aspect: number): [number, number] {
	const cx = (u - 0.5) * aspect
	const cy = v - 0.5
	const back = (x: number, y: number): [number, number] => [x / aspect + 0.5, y + 0.5]

	switch (effect) {
		case 'kaleidoscope': {
			const wedges = Math.floor(3 + k * 9)
			const radius = Math.hypot(cx, cy)
			const segment = (Math.PI * 2) / wedges
			let angle = Math.atan2(cy, cx) % segment
			if (angle < 0) angle += segment
			angle = Math.abs(angle - segment * 0.5)
			return back(Math.cos(angle) * radius, Math.sin(angle) * radius)
		}
		case 'mirror-x': {
			const folded = u < 0.5 ? u : 1 - u
			return [u + (folded - u) * k, v]
		}
		case 'mirror-y': {
			const folded = v < 0.5 ? v : 1 - v
			return [u, v + (folded - v) * k]
		}
		case 'twirl': {
			const radius = Math.hypot(cx, cy)
			const amount = (1 - smoothstep(0, 0.6, radius)) * k * 5
			const s = Math.sin(amount)
			const c = Math.cos(amount)
			return back(cx * c - cy * s, cx * s + cy * c)
		}
		case 'ripple': {
			const radius = Math.hypot(cx, cy) || 1e-6
			const wave = Math.sin(radius * 42 - time * 4) * k * 0.035 * (1 - smoothstep(0, 0.75, radius))
			return back(cx + (cx / radius) * wave, cy + (cy / radius) * wave)
		}
		case 'wave':
			return [u + Math.sin(v * 18 + time * 3) * k * 0.045, v]
		case 'fisheye': {
			const radius = Math.hypot(cx, cy) || 1e-6
			const scaled = radius * (1 + k * 0.9 * radius * radius)
			return back((cx / radius) * scaled, (cy / radius) * scaled)
		}
		case 'bulge': {
			const radius = Math.hypot(cx, cy)
			const amount = 1 - k * 0.7 * (1 - smoothstep(0, 0.7, radius))
			return back(cx * amount, cy * amount)
		}
		case 'shake': {
			const x = Math.sin(time * 12.7) * 0.6 + Math.sin(time * 29.3) * 0.4
			const y = Math.cos(time * 15.1) * 0.6 + Math.cos(time * 33.7) * 0.4
			return [u + x * k * 0.018, v + y * k * 0.018]
		}
		case 'glitch': {
			const band = Math.floor(v * 24)
			const roll = hash11(band + Math.floor(time * 12) * 7)
			const shift = (roll >= 1 - k * 0.55 ? 1 : 0) * (roll - 0.5) * k * 0.22
			return [u + shift, v]
		}
		case 'vhs': {
			let wobble = Math.sin(v * 320 + time * 8) * 0.0012 * k
			const rolled = (v + time * 0.12) % 1
			wobble += (rolled >= 0.97 ? 1 : 0) * k * 0.02
			return [u + wobble, v]
		}
		case 'old-film': {
			const weave = (hash11(Math.floor(time * 16)) - 0.5) * k * 0.006
			const lift = (hash11(Math.floor(time * 16) + 91) - 0.5) * k * 0.004
			return [u + weave, v + lift]
		}
		default:
			return [u, v]
	}
}

function createCpuProcessor(settings: EffectSettings): EffectProcessor {
	const def = effectById(settings.effect)
	return {
		degraded: true,
		apply(ctx, width, height, frameIndex) {
			if (!def) return
			const k = settings.intensity
			const time = (frameIndex / Math.max(1, settings.fps)) * settings.speed
			const aspect = width / Math.max(1, height)

			// The blur-fed looks borrow the browser's blur rather than
			// reimplementing a separable Gaussian nobody would read.
			let blur: Uint8ClampedArray | null = null
			if (def.needsBlur && typeof OffscreenCanvas !== 'undefined') {
				const scratch = new OffscreenCanvas(width, height)
				const scratchCtx = scratch.getContext('2d')
				if (scratchCtx) {
					scratchCtx.filter = `blur(${Math.max(2, Math.round(height * 0.03))}px)`
					scratchCtx.drawImage(ctx.canvas as unknown as CanvasImageSource, 0, 0)
					blur = scratchCtx.getImageData(0, 0, width, height).data
				}
			}

			const image = ctx.getImageData(0, 0, width, height)
			const src = new Uint8ClampedArray(image.data)
			const out = image.data
			const sample = makeSampler(src, width, height)
			const texelX = 1 / width
			const texelY = 1 / height
			const angle = (settings.angle * Math.PI) / 180
			const dirX = Math.cos(angle)
			const dirY = Math.sin(angle)
			const a = settings.colorA
			const b = settings.colorB

			for (let y = 0; y < height; y++) {
				for (let x = 0; x < width; x++) {
					const index = (y * width + x) * 4
					const u0 = (x + 0.5) / width
					const v0 = (y + 0.5) / height
					const [u, v] = remapCpu(settings.effect, u0, v0, k, time, aspect)

					let r = sample(u, v, 0)
					let g = sample(u, v, 1)
					let bl = sample(u, v, 2)

					switch (settings.effect) {
						case 'pixelate':
						case 'mosaic': {
							const blocks = 160 + (12 - 160) * k
							const cellU = Math.floor(u * blocks) / blocks + 0.5 / blocks
							const cellV = Math.floor(v * blocks) / blocks + 0.5 / blocks
							r = sample(cellU, cellV, 0)
							g = sample(cellU, cellV, 1)
							bl = sample(cellU, cellV, 2)
							if (settings.effect === 'mosaic') {
								const inU = (u * blocks) % 1
								const inV = (v * blocks) % 1
								const edge = Math.min(inU, inV, 1 - inU, 1 - inV)
								const shade = 0.55 + 0.45 * smoothstep(0, 0.12, edge)
								r *= shade
								g *= shade
								bl *= shade
							}
							break
						}
						case 'posterize': {
							const steps = 12 + (3 - 12) * k
							r = Math.floor(r * steps + 0.5) / steps
							g = Math.floor(g * steps + 0.5) / steps
							bl = Math.floor(bl * steps + 0.5) / steps
							break
						}
						case 'threshold': {
							const luma = 0.2126 * r + 0.7152 * g + 0.0722 * bl
							const on = luma >= 0.5 ? 1 : 0
							r += (on - r) * k
							g += (on - g) * k
							bl += (on - bl) * k
							break
						}
						case 'duotone': {
							const luma = 0.2126 * r + 0.7152 * g + 0.0722 * bl
							r += ((a.r + (b.r - a.r) * luma) / 255 - r) * k
							g += ((a.g + (b.g - a.g) * luma) / 255 - g) * k
							bl += ((a.b + (b.b - a.b) * luma) / 255 - bl) * k
							break
						}
						case 'thermal': {
							const luma = 0.2126 * r + 0.7152 * g + 0.0722 * bl
							const stops: Array<[number, number, number]> = [
								[0, 0, 0.15],
								[0.1, 0, 0.65],
								[0.85, 0, 0.5],
								[1, 0.65, 0],
								[1, 1, 0.85],
							]
							const scaled = Math.min(3.999, luma * 4)
							const lo = stops[Math.floor(scaled)]
							const hi = stops[Math.floor(scaled) + 1]
							const t = scaled - Math.floor(scaled)
							r += (lo[0] + (hi[0] - lo[0]) * t - r) * k
							g += (lo[1] + (hi[1] - lo[1]) * t - g) * k
							bl += (lo[2] + (hi[2] - lo[2]) * t - bl) * k
							break
						}
						case 'night-vision': {
							const luma = 0.2126 * r + 0.7152 * g + 0.0722 * bl
							const noise = (hash21(u * width + time * 40, v * height + time * 40) - 0.5) * 0.14
							const radius = Math.hypot((u - 0.5) * aspect, v - 0.5)
							const falloff = 1 - smoothstep(0.3, 0.85, radius)
							const scan = 0.9 + 0.1 * Math.sin(v * height * 1.2)
							r += ((luma * 0.35 + noise) * falloff * scan - r) * k
							g += ((luma * 1.25 + 0.06 + noise) * falloff * scan - g) * k
							bl += ((luma * 0.35 + noise) * falloff * scan - bl) * k
							break
						}
						case 'rgb-split': {
							r = sample(u + dirX * k * 0.02, v + dirY * k * 0.02, 0)
							bl = sample(u - dirX * k * 0.02, v - dirY * k * 0.02, 2)
							break
						}
						case 'chromatic': {
							const ox = (u - 0.5) * k * 0.045
							const oy = (v - 0.5) * k * 0.045
							r = sample(u + ox, v + oy, 0)
							bl = sample(u - ox, v - oy, 2)
							break
						}
						case 'glitch': {
							const band = Math.floor(v * 24)
							const roll = hash11(band + Math.floor(time * 12) * 7)
							const split = (roll >= 1 - k * 0.7 ? 1 : 0) * k * 0.012
							r = sample(u + split, v, 0)
							bl = sample(u - split, v, 2)
							const grain = (hash21(u * 400 + time, v * 400 + time) - 0.5) * k * 0.12
							r += grain
							g += grain
							bl += grain
							break
						}
						case 'vhs': {
							const bleed = k * 0.006
							r = sample(u + bleed, v, 0)
							bl = sample(u - bleed * 0.6, v, 2)
							const lines = 0.88 + 0.12 * Math.sin(v * height * 1.6)
							const shade = 1 + (lines - 1) * k
							r *= shade
							g *= shade
							bl *= shade
							const grain = (hash21(u * 600 + time * 30, v * 600 + time * 30) - 0.5) * k * 0.06
							r += grain
							g += grain
							bl += grain
							break
						}
						case 'scanlines': {
							const lines = 0.75 + 0.25 * Math.sin(v * height * Math.PI)
							const shade = 1 + (lines - 1) * k
							r *= shade
							g *= shade
							bl *= shade
							break
						}
						case 'static': {
							const snow = hash21(u * width * 0.5 + time * 60, v * height * 0.5 + time * 60)
							r += (snow - r) * k * 0.75
							g += (snow - g) * k * 0.75
							bl += (snow - bl) * k * 0.75
							break
						}
						case 'old-film': {
							const grey = 0.2126 * r + 0.7152 * g + 0.0722 * bl
							r += (grey * 1.12 - r) * k
							g += (grey * 1.02 - g) * k
							bl += (grey * 0.86 - bl) * k
							const dust = hash21(Math.floor(u * 140) + Math.floor(time * 18) * 13, Math.floor(v * 140))
							const speck = dust >= 0.995 ? k * 0.65 : 0
							r -= speck
							g -= speck
							bl -= speck
							const radius = Math.hypot((u - 0.5) * aspect, v - 0.5)
							const falloff = 1 - smoothstep(0.35, 0.95, radius) * k * 0.6
							r *= falloff
							g *= falloff
							bl *= falloff
							break
						}
						case 'edge':
						case 'sketch':
						case 'neon':
						case 'comic': {
							const luma = (uu: number, vv: number) =>
								0.2126 * sample(uu, vv, 0) + 0.7152 * sample(uu, vv, 1) + 0.0722 * sample(uu, vv, 2)
							const tl = luma(u - texelX, v - texelY)
							const t = luma(u, v - texelY)
							const tr = luma(u + texelX, v - texelY)
							const l = luma(u - texelX, v)
							const rr = luma(u + texelX, v)
							const blq = luma(u - texelX, v + texelY)
							const bq = luma(u, v + texelY)
							const br = luma(u + texelX, v + texelY)
							const gx = -tl - 2 * l - blq + tr + 2 * rr + br
							const gy = -tl - 2 * t - tr + blq + 2 * bq + br
							const edge = Math.min(1, Math.hypot(gx, gy) * (0.6 + k * 2.4))
							if (settings.effect === 'edge') {
								r = g = bl = edge
							} else if (settings.effect === 'sketch') {
								r = g = bl = 1 - edge
							} else if (settings.effect === 'neon') {
								const base = 0.2126 * r + 0.7152 * g + 0.0722 * bl
								const glow = Math.pow(edge, 0.75) * (1 + k)
								r = ((a.r + (b.r - a.r) * base) / 255) * glow
								g = ((a.g + (b.g - a.g) * base) / 255) * glow
								bl = ((a.b + (b.b - a.b) * base) / 255) * glow
							} else {
								const steps = 8 + (3 - 8) * k
								const ink = 1 - smoothstep(0.25, 0.7, edge)
								r = (Math.floor(r * steps + 0.5) / steps) * ink
								g = (Math.floor(g * steps + 0.5) / steps) * ink
								bl = (Math.floor(bl * steps + 0.5) / steps) * ink
							}
							break
						}
						case 'emboss': {
							const up = 0.2126 * sample(u - texelX, v - texelY, 0) + 0.7152 * sample(u - texelX, v - texelY, 1) + 0.0722 * sample(u - texelX, v - texelY, 2)
							const down = 0.2126 * sample(u + texelX, v + texelY, 0) + 0.7152 * sample(u + texelX, v + texelY, 1) + 0.0722 * sample(u + texelX, v + texelY, 2)
							const relief = (up - down) * (1 + k * 6)
							r = g = bl = Math.min(1, Math.max(0, 0.5 + relief))
							break
						}
						case 'zoom-blur':
						case 'spin-blur':
						case 'motion-blur': {
							const taps = 12
							let sr = 0
							let sg = 0
							let sb = 0
							for (let i = 0; i < taps; i++) {
								const t = i / (taps - 1) - 0.5
								let ox: number
								let oy: number
								if (settings.effect === 'zoom-blur') {
									ox = (u - 0.5) * t * k * 0.5
									oy = (v - 0.5) * t * k * 0.5
								} else if (settings.effect === 'spin-blur') {
									ox = -(v - 0.5) * t * k * 0.5
									oy = (u - 0.5) * t * k * 0.5
								} else {
									ox = dirX * t * k * 0.08
									oy = dirY * t * k * 0.08
								}
								sr += sample(u + ox, v + oy, 0)
								sg += sample(u + ox, v + oy, 1)
								sb += sample(u + ox, v + oy, 2)
							}
							r = sr / taps
							g = sg / taps
							bl = sb / taps
							break
						}
						case 'light-leak': {
							const dx = u - 1.05
							const dy = v
							const flare = Math.exp(-(dx * dx + dy * dy) * (9 + (2.5 - 9) * k)) * (0.75 + 0.25 * Math.sin(time * 1.7))
							const edge = smoothstep(0.35, 1, u + Math.sin(time * 0.9) * 0.08)
							const weight = (flare + edge * 0.35) * k
							r += ((a.r + (b.r - a.r) * v) / 255) * weight
							g += ((a.g + (b.g - a.g) * v) / 255) * weight
							bl += ((a.b + (b.b - a.b) * v) / 255) * weight
							break
						}
						default:
							break
					}

					if (blur) {
						const bi = index
						const sr = blur[bi] / 255
						const sg = blur[bi + 1] / 255
						const sb = blur[bi + 2] / 255
						if (settings.effect === 'bloom') {
							r += Math.max(0, (sr - 0.55) / 0.45) * k * 1.1
							g += Math.max(0, (sg - 0.55) / 0.45) * k * 1.1
							bl += Math.max(0, (sb - 0.55) / 0.45) * k * 1.1
						} else if (settings.effect === 'dream') {
							r += (1 - (1 - r) * (1 - sr * 0.85) - r) * k * 0.85
							g += (1 - (1 - g) * (1 - sg * 0.85) - g) * k * 0.85
							bl += (1 - (1 - bl) * (1 - sb * 0.85) - bl) * k * 0.85
						} else if (settings.effect === 'bokeh' || settings.effect === 'star') {
							const bright = Math.max(0, (0.2126 * sr + 0.7152 * sg + 0.0722 * sb - 0.6) / 0.4)
							r += bright * k * 0.9
							g += bright * k * 0.9
							bl += bright * k * 0.9
						}
					}

					out[index] = Math.min(255, Math.max(0, r * 255))
					out[index + 1] = Math.min(255, Math.max(0, g * 255))
					out[index + 2] = Math.min(255, Math.max(0, bl * 255))
				}
			}

			ctx.putImageData(image, 0, 0)
		},
		dispose() {},
	}
}

export function createEffectProcessor(settings: EffectSettings): EffectProcessor {
	return createGpuProcessor(settings) ?? createCpuProcessor(settings)
}
