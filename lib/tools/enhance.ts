'use client'

/**
 * Cleaning up a bad source: sensor noise, compression blocking, and the
 * softness that a heavy upscale or a low bitrate leaves behind.
 *
 * This is restoration, and it is worth being precise about what it is and is
 * not. It is **not** super-resolution: nothing here invents detail that was
 * not recorded, and any tool that claims to do that in a browser tab without a
 * model is lying. What it does do is the three things that actually make a
 * weak source look better, in the order a restoration artist would do them:
 *
 *   1. **Denoise** with an edge-preserving filter, so grain and chroma noise
 *      are averaged away while edges are not. Done first, because sharpening
 *      noise is the classic way to make a clip worse.
 *   2. **Deblock**, which looks specifically for the 8-pixel grid every DCT
 *      codec quantises on and smooths *across* those boundaries only. A
 *      general blur cannot do this - the whole point is that the artefact is
 *      periodic and everything else is not.
 *   3. **Sharpen**, masked by local contrast, so genuine edges are crisped and
 *      flat regions - which is where any remaining noise lives - are left
 *      alone.
 *
 * Upscaling is a separate parameter that simply asks the encoder for a larger
 * frame; the honest gain comes from doing the three steps above at the larger
 * size, where the sharpening has room to work.
 */

import { acquireGlSurface, createTexture2D, uploadTexture2D } from './webgl'

type Ctx2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D

export type EnhanceSettings = {
	/** 0-1 */
	denoise: number
	/** 0-1 */
	deblock: number
	/** 0-1 */
	sharpen: number
	/** 0-1; recovers colour in a washed-out source */
	saturation: number
}

export type EnhanceProcessor = {
	apply(ctx: Ctx2D, width: number, height: number, frameIndex: number): void
	degraded: boolean
	dispose(): void
}

export function isNeutralEnhance(settings: EnhanceSettings): boolean {
	return settings.denoise === 0 && settings.deblock === 0 && settings.sharpen === 0 && settings.saturation === 0
}

const FRAGMENT_SOURCE = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uImage;
uniform vec2 uTexel;
uniform vec2 uResolution;
uniform float uDenoise;
uniform float uDeblock;
uniform float uSharpen;
uniform float uSaturation;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

vec3 tex(vec2 uv) {
	return texture(uImage, clamp(uv, vec2(0.0), vec2(1.0))).rgb;
}

void main() {
	vec3 base = tex(vUv);
	vec3 colour = base;

	/* ------------------------------------------------------------- denoise */
	if (uDenoise > 0.0) {
		// A 3x3 bilateral. Small on purpose: sensor noise is high-frequency, so
		// a wide radius removes detail rather than noise, and every extra ring
		// costs eight more texture fetches per pixel for less and less benefit.
		float sigma = mix(0.10, 0.035, uDenoise);
		vec3 sum = base;
		float weightSum = 1.0;
		for (int y = -1; y <= 1; y++) {
			for (int x = -1; x <= 1; x++) {
				if (x == 0 && y == 0) continue;
				vec3 tap = tex(vUv + vec2(float(x), float(y)) * uTexel);
				float difference = length(tap - base);
				float weight = exp(-(difference * difference) / (2.0 * sigma * sigma));
				sum += tap * weight;
				weightSum += weight;
			}
		}
		colour = mix(colour, sum / weightSum, uDenoise);
	}

	/* ------------------------------------------------------------- deblock */
	if (uDeblock > 0.0) {
		// Where in its 8x8 macroblock this pixel sits. Only the two pixels
		// either side of a block boundary get touched; everything else is left
		// exactly as it is, which is what separates this from a blur.
		vec2 pixel = vUv * uResolution;
		vec2 inBlock = mod(pixel, 8.0);
		float onEdgeX = 1.0 - smoothstep(0.0, 1.6, min(inBlock.x, 8.0 - inBlock.x));
		float onEdgeY = 1.0 - smoothstep(0.0, 1.6, min(inBlock.y, 8.0 - inBlock.y));

		if (onEdgeX > 0.0) {
			vec3 across = (tex(vUv - vec2(uTexel.x * 2.0, 0.0)) + tex(vUv + vec2(uTexel.x * 2.0, 0.0))) * 0.5;
			// Only smooth when the step is small enough to be an artefact
			// rather than a real edge - a hard cut between two objects also
			// lands on the block grid sometimes.
			float step_ = length(across - base);
			float isArtefact = 1.0 - smoothstep(0.03, 0.14, step_);
			colour = mix(colour, mix(colour, across, 0.5), onEdgeX * isArtefact * uDeblock);
		}
		if (onEdgeY > 0.0) {
			vec3 across = (tex(vUv - vec2(0.0, uTexel.y * 2.0)) + tex(vUv + vec2(0.0, uTexel.y * 2.0))) * 0.5;
			float step_ = length(across - base);
			float isArtefact = 1.0 - smoothstep(0.03, 0.14, step_);
			colour = mix(colour, mix(colour, across, 0.5), onEdgeY * isArtefact * uDeblock);
		}
	}

	/* ------------------------------------------------------------- sharpen */
	if (uSharpen > 0.0) {
		vec3 blur = (
			tex(vUv + vec2(uTexel.x, 0.0)) +
			tex(vUv - vec2(uTexel.x, 0.0)) +
			tex(vUv + vec2(0.0, uTexel.y)) +
			tex(vUv - vec2(0.0, uTexel.y))
		) * 0.25;
		vec3 detail = colour - blur;
		// The mask: sharpen where there is already an edge, leave flat areas
		// (where the remaining noise lives) alone.
		float localContrast = length(detail) * 6.0;
		float mask = smoothstep(0.02, 0.35, localContrast);
		colour += detail * uSharpen * 2.2 * mask;
	}

	if (uSaturation != 0.0) {
		float grey = dot(colour, LUMA);
		colour = mix(vec3(grey), colour, 1.0 + uSaturation);
	}

	fragColor = vec4(clamp(colour, 0.0, 1.0), 1.0);
}
`

function createGpuProcessor(settings: EnhanceSettings): EnhanceProcessor | null {
	const surface = acquireGlSurface()
	if (!surface) return null
	const { gl } = surface
	const program = surface.program('enhance', FRAGMENT_SOURCE)
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
			gl.uniform2f(program.uniform('uResolution'), width, height)
			gl.uniform1f(program.uniform('uDenoise'), settings.denoise)
			gl.uniform1f(program.uniform('uDeblock'), settings.deblock)
			gl.uniform1f(program.uniform('uSharpen'), settings.sharpen)
			gl.uniform1f(program.uniform('uSaturation'), settings.saturation)

			surface.drawQuad(program)
			ctx.clearRect(0, 0, width, height)
			ctx.drawImage(surface.canvas as unknown as CanvasImageSource, 0, 0)
		},
		dispose() {
			gl.deleteTexture(texture)
		},
	}
}

/**
 * The CPU path does the same three steps with a 3x3 window read straight out
 * of one `ImageData`, which is slow but not absurd - unlike the retouch
 * bilateral, this kernel is small enough to run.
 */
function createCpuProcessor(settings: EnhanceSettings): EnhanceProcessor {
	return {
		degraded: true,
		apply(ctx, width, height) {
			const image = ctx.getImageData(0, 0, width, height)
			const src = new Uint8ClampedArray(image.data)
			const out = image.data
			const sigma = 0.1 + (0.035 - 0.1) * settings.denoise

			const at = (x: number, y: number, channel: number): number => {
				const cx = x < 0 ? 0 : x >= width ? width - 1 : x
				const cy = y < 0 ? 0 : y >= height ? height - 1 : y
				return src[(cy * width + cx) * 4 + channel] / 255
			}

			for (let y = 0; y < height; y++) {
				for (let x = 0; x < width; x++) {
					const index = (y * width + x) * 4
					let r = src[index] / 255
					let g = src[index + 1] / 255
					let b = src[index + 2] / 255
					const baseR = r
					const baseG = g
					const baseB = b

					if (settings.denoise > 0) {
						let sr = r
						let sg = g
						let sb = b
						let weightSum = 1
						for (let dy = -1; dy <= 1; dy++) {
							for (let dx = -1; dx <= 1; dx++) {
								if (dx === 0 && dy === 0) continue
								const tr = at(x + dx, y + dy, 0)
								const tg = at(x + dx, y + dy, 1)
								const tb = at(x + dx, y + dy, 2)
								const difference = Math.hypot(tr - baseR, tg - baseG, tb - baseB)
								const weight = Math.exp(-(difference * difference) / (2 * sigma * sigma))
								sr += tr * weight
								sg += tg * weight
								sb += tb * weight
								weightSum += weight
							}
						}
						r += (sr / weightSum - r) * settings.denoise
						g += (sg / weightSum - g) * settings.denoise
						b += (sb / weightSum - b) * settings.denoise
					}

					if (settings.deblock > 0) {
						const edgeX = 1 - Math.min(1, Math.min(x % 8, 8 - (x % 8)) / 1.6)
						const edgeY = 1 - Math.min(1, Math.min(y % 8, 8 - (y % 8)) / 1.6)
						if (edgeX > 0) {
							const ar = (at(x - 2, y, 0) + at(x + 2, y, 0)) / 2
							const ag = (at(x - 2, y, 1) + at(x + 2, y, 1)) / 2
							const ab = (at(x - 2, y, 2) + at(x + 2, y, 2)) / 2
							const step = Math.hypot(ar - r, ag - g, ab - b)
							const isArtefact = 1 - Math.min(1, Math.max(0, (step - 0.03) / 0.11))
							const weight = edgeX * isArtefact * settings.deblock * 0.5
							r += (ar - r) * weight
							g += (ag - g) * weight
							b += (ab - b) * weight
						}
						if (edgeY > 0) {
							const ar = (at(x, y - 2, 0) + at(x, y + 2, 0)) / 2
							const ag = (at(x, y - 2, 1) + at(x, y + 2, 1)) / 2
							const ab = (at(x, y - 2, 2) + at(x, y + 2, 2)) / 2
							const step = Math.hypot(ar - r, ag - g, ab - b)
							const isArtefact = 1 - Math.min(1, Math.max(0, (step - 0.03) / 0.11))
							const weight = edgeY * isArtefact * settings.deblock * 0.5
							r += (ar - r) * weight
							g += (ag - g) * weight
							b += (ab - b) * weight
						}
					}

					if (settings.sharpen > 0) {
						const br = (at(x + 1, y, 0) + at(x - 1, y, 0) + at(x, y + 1, 0) + at(x, y - 1, 0)) / 4
						const bg = (at(x + 1, y, 1) + at(x - 1, y, 1) + at(x, y + 1, 1) + at(x, y - 1, 1)) / 4
						const bb = (at(x + 1, y, 2) + at(x - 1, y, 2) + at(x, y + 1, 2) + at(x, y - 1, 2)) / 4
						const dr = r - br
						const dg = g - bg
						const db = b - bb
						const contrast = Math.hypot(dr, dg, db) * 6
						const mask = Math.min(1, Math.max(0, (contrast - 0.02) / 0.33))
						const amount = settings.sharpen * 2.2 * mask * mask * (3 - 2 * mask)
						r += dr * amount
						g += dg * amount
						b += db * amount
					}

					if (settings.saturation !== 0) {
						const grey = 0.2126 * r + 0.7152 * g + 0.0722 * b
						const amount = 1 + settings.saturation
						r = grey + (r - grey) * amount
						g = grey + (g - grey) * amount
						b = grey + (b - grey) * amount
					}

					out[index] = Math.min(255, Math.max(0, r * 255))
					out[index + 1] = Math.min(255, Math.max(0, g * 255))
					out[index + 2] = Math.min(255, Math.max(0, b * 255))
				}
			}
			ctx.putImageData(image, 0, 0)
		},
		dispose() {},
	}
}

export function createEnhanceProcessor(settings: EnhanceSettings): EnhanceProcessor {
	return createGpuProcessor(settings) ?? createCpuProcessor(settings)
}
