'use client'

/**
 * Applies a baked colour cube, plus the parts of a look no cube can hold, to
 * a frame that has already been drawn.
 *
 * `color-tone.ts` turns a look into 35,937 numbers; this turns those numbers
 * into pixels. On the GPU that is one trilinear fetch per pixel, so a heavy
 * film emulation and a mild warm-up cost exactly the same. Grain, vignette,
 * bloom, halation, diffusion and chromatic aberration ride along in the same
 * fragment shader, because each of them needs either the pixel's position or
 * a neighbourhood - neither of which a colour-in/colour-out table has.
 *
 * The two blurs the shader samples are made with the 2D canvas' own
 * `filter: blur()` at a quarter resolution, which is both faster and better
 * looking than a hand-rolled separable pass: the browser is already using the
 * GPU for it, and a bloom source does not need to be sharp.
 *
 * Without WebGL2 the same cube is applied on the CPU with the identical
 * trilinear maths, and grain and vignette are drawn with plain canvas
 * operations. The colour comes out the same; only bloom, halation, diffusion
 * and aberration are missing, and `ToneProcessor.degraded` says so, so the UI
 * can tell the truth about what it rendered.
 */

import { applyToneLutToImageData, type ToneFinish, type ToneLut } from './color-tone'
import { acquireGlSurface, createTexture2D, createTexture3D, uploadLut3D, uploadPixels2D, uploadTexture2D } from './webgl'

type Ctx2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D

export type ToneProcessor = {
	/** Repaints `ctx` in place. `frameIndex` only moves the grain along. */
	apply(ctx: Ctx2D, width: number, height: number, frameIndex: number): void
	/** True when this fell back to the CPU and the optical effects are absent. */
	degraded: boolean
	dispose(): void
}

export type ToneProcessorOptions = {
	lut: ToneLut
	/** 0 leaves the picture alone, 1 is the look at full weight */
	strength: number
	finish: Required<ToneFinish>
}

const FRAGMENT_SOURCE = `#version 300 es
precision highp float;
precision highp sampler3D;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uImage;
uniform sampler2D uSoft;
uniform sampler2D uBloom;
uniform sampler3D uLut;

uniform float uLutSize;
uniform float uStrength;
uniform float uGrain;
uniform float uGrainSize;
uniform float uVignette;
uniform float uBloomAmount;
uniform float uHalation;
uniform float uSoftness;
uniform float uChroma;
uniform float uSeed;
uniform vec2 uResolution;

/**
 * The half-texel inset is what stops the outermost cells of the cube from
 * being clamped into: without it, pure black and pure white would each be
 * sampled from half a cell outside the table.
 */
vec3 lookup(vec3 colour) {
	vec3 scaled = clamp(colour, 0.0, 1.0) * (uLutSize - 1.0);
	return texture(uLut, (scaled + 0.5) / uLutSize).rgb;
}

float hash(vec2 p) {
	p = fract(p * vec2(123.34, 456.21));
	p += dot(p, p + 45.32);
	return fract(p.x * p.y);
}

void main() {
	vec2 uv = vUv;
	vec2 centered = uv - 0.5;

	vec3 source;
	if (uChroma > 0.0) {
		// Real lens dispersion grows toward the edge of the frame, so the
		// offset is scaled by the distance from the centre rather than fixed.
		vec2 shift = centered * uChroma * 0.008;
		source.r = texture(uImage, uv + shift).r;
		source.g = texture(uImage, uv).g;
		source.b = texture(uImage, uv - shift).b;
	} else {
		source = texture(uImage, uv).rgb;
	}

	if (uSoftness > 0.0) {
		source = mix(source, texture(uSoft, uv).rgb, uSoftness * 0.7);
	}

	vec3 graded = mix(source, lookup(source), uStrength);

	if (uBloomAmount > 0.0 || uHalation > 0.0) {
		// Only what was already bright blooms; the 0.62 knee keeps midtones
		// from turning into haze.
		vec3 bright = max(texture(uBloom, uv).rgb - 0.62, vec3(0.0)) / 0.38;
		graded += bright * uBloomAmount * 0.8;
		float halo = dot(bright, vec3(0.4, 0.4, 0.2));
		graded += vec3(halo, halo * 0.22, halo * 0.1) * uHalation;
	}

	if (uVignette > 0.0) {
		float aspect = uResolution.x / max(uResolution.y, 1.0);
		float distance = length(centered * vec2(aspect, 1.0));
		graded *= 1.0 - smoothstep(0.42, 1.05, distance) * uVignette;
	}

	if (uGrain > 0.0) {
		vec2 cell = floor(gl_FragCoord.xy / max(uGrainSize, 1.0));
		float noise = hash(cell + uSeed) - 0.5;
		// Film grain lives in the midtones. Clean black and blown white have
		// no silver left to be uneven, so weight it by distance from both.
		float luma = dot(graded, vec3(0.2126, 0.7152, 0.0722));
		float weight = 1.0 - abs(luma * 2.0 - 1.0);
		graded += noise * uGrain * 0.32 * (0.3 + 0.7 * weight);
	}

	fragColor = vec4(clamp(graded, 0.0, 1.0), 1.0);
}
`

/** A quarter-size blurred copy, reused every frame so nothing is reallocated. */
type BlurScratch = {
	canvas: OffscreenCanvas
	ctx: OffscreenCanvasRenderingContext2D
}

function makeScratch(): BlurScratch | null {
	if (typeof OffscreenCanvas === 'undefined') return null
	const canvas = new OffscreenCanvas(2, 2)
	const ctx = canvas.getContext('2d')
	if (!ctx) return null
	return { canvas, ctx }
}

function renderBlur(scratch: BlurScratch, source: TexImageSource, width: number, height: number, radiusFraction: number): void {
	const w = Math.max(2, Math.round(width / 4))
	const h = Math.max(2, Math.round(height / 4))
	if (scratch.canvas.width !== w || scratch.canvas.height !== h) {
		scratch.canvas.width = w
		scratch.canvas.height = h
	}
	scratch.ctx.filter = `blur(${Math.max(1, Math.round(h * radiusFraction))}px)`
	scratch.ctx.clearRect(0, 0, w, h)
	scratch.ctx.drawImage(source as CanvasImageSource, 0, 0, w, h)
	scratch.ctx.filter = 'none'
}

function createGpuProcessor(options: ToneProcessorOptions): ToneProcessor | null {
	const surface = acquireGlSurface()
	if (!surface) return null
	const { gl } = surface
	const program = surface.program('tone', FRAGMENT_SOURCE)
	if (!program) return null

	const imageTexture = createTexture2D(gl)
	const softTexture = createTexture2D(gl)
	const bloomTexture = createTexture2D(gl)
	const lutTexture = createTexture3D(gl)
	if (!imageTexture || !softTexture || !bloomTexture || !lutTexture) return null

	uploadLut3D(gl, 3, lutTexture, options.lut.size, options.lut.data)

	const softScratch = makeScratch()
	const bloomScratch = makeScratch()
	const placeholder = new Uint8Array([0, 0, 0, 255])
	const needsSoft = options.finish.softness > 0
	const needsBloom = options.finish.bloom > 0 || options.finish.halation > 0
	if (!needsSoft || !softScratch) uploadPixels2D(gl, 1, softTexture, 1, 1, placeholder)
	if (!needsBloom || !bloomScratch) uploadPixels2D(gl, 2, bloomTexture, 1, 1, placeholder)

	return {
		degraded: false,
		apply(ctx, width, height, frameIndex) {
			const source = ctx.canvas as unknown as TexImageSource
			surface.resize(width, height)

			uploadTexture2D(gl, 0, imageTexture, source)
			if (needsSoft && softScratch) {
				renderBlur(softScratch, source, width, height, 0.006)
				uploadTexture2D(gl, 1, softTexture, softScratch.canvas)
			}
			if (needsBloom && bloomScratch) {
				renderBlur(bloomScratch, source, width, height, 0.02)
				uploadTexture2D(gl, 2, bloomTexture, bloomScratch.canvas)
			}
			gl.activeTexture(gl.TEXTURE3)
			gl.bindTexture(gl.TEXTURE_3D, lutTexture)

			gl.useProgram(program.handle)
			gl.uniform1i(program.uniform('uImage'), 0)
			gl.uniform1i(program.uniform('uSoft'), 1)
			gl.uniform1i(program.uniform('uBloom'), 2)
			gl.uniform1i(program.uniform('uLut'), 3)
			gl.uniform1f(program.uniform('uLutSize'), options.lut.size)
			gl.uniform1f(program.uniform('uStrength'), options.strength)
			gl.uniform1f(program.uniform('uGrain'), options.finish.grain)
			gl.uniform1f(program.uniform('uGrainSize'), options.finish.grainSize)
			gl.uniform1f(program.uniform('uVignette'), options.finish.vignette)
			gl.uniform1f(program.uniform('uBloomAmount'), options.finish.bloom)
			gl.uniform1f(program.uniform('uHalation'), options.finish.halation)
			gl.uniform1f(program.uniform('uSoftness'), options.finish.softness)
			gl.uniform1f(program.uniform('uChroma'), options.finish.chroma)
			// A grain pattern that never moves reads as dirt on the lens, so the
			// seed walks with the frame - but slowly enough not to shimmer.
			gl.uniform1f(program.uniform('uSeed'), (frameIndex % 512) * 1.618)
			gl.uniform2f(program.uniform('uResolution'), width, height)

			surface.drawQuad(program)

			ctx.clearRect(0, 0, width, height)
			ctx.drawImage(surface.canvas as unknown as CanvasImageSource, 0, 0)
		},
		dispose() {
			gl.deleteTexture(imageTexture)
			gl.deleteTexture(softTexture)
			gl.deleteTexture(bloomTexture)
			gl.deleteTexture(lutTexture)
		},
	}
}

function createCpuProcessor(options: ToneProcessorOptions): ToneProcessor {
	const { grain, grainSize, vignette } = options.finish
	return {
		degraded: true,
		apply(ctx, width, height, frameIndex) {
			const image = ctx.getImageData(0, 0, width, height)
			applyToneLutToImageData(image, options.lut, options.strength)

			if (grain > 0) {
				// One noise value per grain cell, expanded across the cell, so a
				// larger grain does not cost more than a fine one.
				const cell = Math.max(1, Math.round(grainSize))
				const data = image.data
				const cellsX = Math.ceil(width / cell)
				const noise = new Float32Array(cellsX * Math.ceil(height / cell))
				let seed = (frameIndex % 512) * 9781 + 1
				for (let i = 0; i < noise.length; i++) {
					seed = (seed * 1664525 + 1013904223) >>> 0
					noise[i] = (seed / 0xffffffff - 0.5) * grain * 82
				}
				for (let y = 0; y < height; y++) {
					const row = Math.floor(y / cell) * cellsX
					for (let x = 0; x < width; x++) {
						const value = noise[row + Math.floor(x / cell)]
						const index = (y * width + x) * 4
						data[index] += value
						data[index + 1] += value
						data[index + 2] += value
					}
				}
			}

			ctx.putImageData(image, 0, 0)

			if (vignette > 0) {
				const gradient = ctx.createRadialGradient(
					width / 2,
					height / 2,
					Math.min(width, height) * 0.35,
					width / 2,
					height / 2,
					Math.max(width, height) * 0.72,
				)
				gradient.addColorStop(0, 'rgba(0,0,0,0)')
				gradient.addColorStop(1, `rgba(0,0,0,${Math.min(1, vignette)})`)
				ctx.save()
				ctx.globalCompositeOperation = 'multiply'
				ctx.fillStyle = gradient
				ctx.fillRect(0, 0, width, height)
				ctx.restore()
			}
		},
		dispose() {},
	}
}

/** GPU when the machine has one, identical colour on the CPU when it does not. */
export function createToneProcessor(options: ToneProcessorOptions): ToneProcessor {
	return createGpuProcessor(options) ?? createCpuProcessor(options)
}
