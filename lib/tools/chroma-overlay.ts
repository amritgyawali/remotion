'use client'

/**
 * Keying a green-screen clip and laying it over the footage.
 *
 * The studio already had a chroma key, but it pointed the other way: it keyed
 * the *loaded* clip's own backdrop and put a flat colour behind it. This is
 * the composite people actually mean by "green screen" - the main video stays
 * exactly as it was shot, and a second clip filmed against green has its
 * backdrop removed and is stacked on top of it.
 *
 * Three things here are the difference between a usable key and a green halo.
 *
 * **The key is measured in chroma, not in RGB.** A green screen is never one
 * colour: it is lit unevenly, it has shadows on it, and the subject bounces
 * light back into it. Distance in RGB confuses "darker green" with "not
 * green", so a shadowed corner survives the key as a grey smear. Converting
 * both the pixel and the key colour to Cb/Cr and measuring the distance there
 * throws away brightness entirely, which is exactly the variable that is
 * allowed to change.
 *
 * **The spill is actually removed.** This is a real despill, not the edge
 * neutralisation the AI background tool has to settle for: here the backdrop
 * colour is known, so any pixel whose key channel runs ahead of its other two
 * can have that excess pulled back down. Skin and white shirts near the screen
 * stop looking seasick.
 *
 * **The key happens before the overlay is scaled.** Keying a clip that has
 * already been shrunk means keying pixels that are half green and half
 * subject, which no tolerance can separate. So the shader runs at the overlay
 * clip's own resolution, and only the finished, transparent result is scaled
 * into place - where the browser's own filtering blends alpha, which is the
 * one thing it can do correctly.
 */

import { anchorPoint, type AnchorPosition } from './frame-ops'
import { openSecondaryVideoSource, type PerFrameHook } from './video-filter'
import { acquireGlSurface, createTexture2D, uploadTexture2D } from './webgl'

type Ctx2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D

export type OverlayPlacement = 'fill' | AnchorPosition
export type OverlayFit = 'cover' | 'contain' | 'stretch'

export type ChromaOverlaySettings = {
	/** the backdrop colour to remove, 0-255 per channel */
	keyColor: { r: number; g: number; b: number }
	/** 0-1: how far a pixel's chroma may drift from the key and still be removed */
	tolerance: number
	/** 0-1: width of the soft edge between kept and removed */
	smoothing: number
	/** 0-1: how much of the backdrop's colour cast is pulled out of what is kept */
	despill: number
	placement: OverlayPlacement
	fit: OverlayFit
	/** fraction of the frame's width the overlay occupies, for the anchored placements */
	scale: number
	opacity: number
	/** shows the key's alpha instead of the composite */
	debug: boolean
}

export type OverlayFrame = {
	source: CanvasImageSource
	width: number
	height: number
}

export type FramePass = {
	apply(ctx: Ctx2D, width: number, height: number): void
}

export type ChromaOverlayCompositor = {
	/** Stores the overlay frame to key and stack next; `null` draws nothing. */
	setFrame(frame: OverlayFrame | null): void
	pass: FramePass
	/** True when the key ran on the CPU, which is correct but much slower. */
	degraded: boolean
	dispose(): void
}

const FRAGMENT_SOURCE = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uOverlay;
uniform vec3 uKey;
uniform vec3 uKeyAxis;
uniform float uTolerance;
uniform float uSmoothing;
uniform float uDespill;
uniform float uDebug;

/**
 * Chroma only. Dropping luma is the whole point: a shadow on the screen is
 * the same colour as the screen, just darker, and has to key out with it.
 */
vec2 chroma(vec3 c) {
	return vec2(-0.169 * c.r - 0.331 * c.g + 0.5 * c.b, 0.5 * c.r - 0.419 * c.g - 0.081 * c.b);
}

void main() {
	vec4 texel = texture(uOverlay, vUv);
	vec3 colour = texel.rgb;

	float distance = length(chroma(colour) - chroma(uKey));
	// Inside the tolerance the pixel is backdrop; the smoothing band either
	// side of it is the soft edge that keeps the outline from aliasing.
	float alpha = smoothstep(uTolerance - uSmoothing, uTolerance + uSmoothing, distance);
	alpha *= texel.a;

	if (uDespill > 0.0) {
		// The backdrop's colour is known, so the excess in that one channel is
		// a measurable quantity rather than something to guess at.
		vec3 rest = colour * (1.0 - uKeyAxis);
		float others = max(rest.r, max(rest.g, rest.b));
		float dominant = dot(colour, uKeyAxis);
		if (dominant > others) {
			colour -= uKeyAxis * (dominant - others) * uDespill;
		}
	}

	fragColor = uDebug > 0.5 ? vec4(vec3(alpha), 1.0) : vec4(colour, alpha);
}
`

function makeScratchCanvas(): { canvas: OffscreenCanvas; ctx: OffscreenCanvasRenderingContext2D } | null {
	if (typeof OffscreenCanvas === 'undefined') return null
	const canvas = new OffscreenCanvas(2, 2)
	const ctx = canvas.getContext('2d', { willReadFrequently: true })
	if (!ctx) return null
	return { canvas, ctx }
}

/** Where the keyed overlay lands in the output frame. */
export function placeOverlay(
	settings: ChromaOverlaySettings,
	frameWidth: number,
	frameHeight: number,
	overlayWidth: number,
	overlayHeight: number,
): { x: number; y: number; width: number; height: number } {
	const aspect = overlayHeight / Math.max(overlayWidth, 1)

	if (settings.placement === 'fill') {
		if (settings.fit === 'stretch') return { x: 0, y: 0, width: frameWidth, height: frameHeight }
		const scale =
			settings.fit === 'cover'
				? Math.max(frameWidth / overlayWidth, frameHeight / overlayHeight)
				: Math.min(frameWidth / overlayWidth, frameHeight / overlayHeight)
		const width = overlayWidth * scale
		const height = overlayHeight * scale
		return { x: (frameWidth - width) / 2, y: (frameHeight - height) / 2, width, height }
	}

	const width = frameWidth * settings.scale
	const height = width * aspect
	const margin = Math.round(Math.min(frameWidth, frameHeight) * 0.04)
	const { x, y } = anchorPoint(settings.placement, frameWidth, frameHeight, width, height, margin)
	return { x, y, width, height }
}

function createGpuCompositor(settings: ChromaOverlaySettings): ChromaOverlayCompositor | null {
	const surface = acquireGlSurface()
	if (!surface) return null
	const { gl } = surface
	const program = surface.program('chroma-overlay', FRAGMENT_SOURCE)
	if (!program) return null
	const texture = createTexture2D(gl)
	if (!texture) return null

	const key = [settings.keyColor.r / 255, settings.keyColor.g / 255, settings.keyColor.b / 255]
	// One-hot for whichever channel the backdrop is built from, so despill works
	// for a blue screen exactly as it does for a green one.
	const dominant = key.indexOf(Math.max(...key))
	const axis = [dominant === 0 ? 1 : 0, dominant === 1 ? 1 : 0, dominant === 2 ? 1 : 0]

	let current: OverlayFrame | null = null

	const pass: FramePass = {
		apply(ctx, width, height) {
			if (!current) return
			surface.resize(current.width, current.height)
			uploadTexture2D(gl, 0, texture, current.source as TexImageSource)

			gl.useProgram(program.handle)
			gl.uniform1i(program.uniform('uOverlay'), 0)
			gl.uniform3f(program.uniform('uKey'), key[0], key[1], key[2])
			gl.uniform3f(program.uniform('uKeyAxis'), axis[0], axis[1], axis[2])
			gl.uniform1f(program.uniform('uTolerance'), settings.tolerance)
			gl.uniform1f(program.uniform('uSmoothing'), Math.max(0.001, settings.smoothing))
			gl.uniform1f(program.uniform('uDespill'), settings.despill)
			gl.uniform1f(program.uniform('uDebug'), settings.debug ? 1 : 0)
			surface.drawQuad(program)

			const rect = placeOverlay(settings, width, height, current.width, current.height)
			ctx.save()
			ctx.globalAlpha = settings.opacity
			ctx.drawImage(surface.canvas as unknown as CanvasImageSource, rect.x, rect.y, rect.width, rect.height)
			ctx.restore()
		},
	}

	return {
		degraded: false,
		pass,
		setFrame(frame) {
			current = frame
		},
		dispose() {
			gl.deleteTexture(texture)
		},
	}
}

/**
 * The same key, one pixel at a time.
 *
 * This is the slow path, and it is honest about being one: it runs over every
 * pixel of every overlay frame on the CPU. It exists so that a machine
 * without WebGL2 still produces the right picture rather than an error.
 */
function createCpuCompositor(settings: ChromaOverlaySettings): ChromaOverlayCompositor {
	const scratch = makeScratchCanvas()
	let current: OverlayFrame | null = null

	const key = settings.keyColor
	const keyCb = -0.169 * key.r - 0.331 * key.g + 0.5 * key.b
	const keyCr = 0.5 * key.r - 0.419 * key.g - 0.081 * key.b
	const dominant = key.r >= key.g && key.r >= key.b ? 0 : key.g >= key.b ? 1 : 2

	const pass: FramePass = {
		apply(ctx, width, height) {
			if (!current || !scratch) return
			const w = Math.max(1, Math.round(current.width))
			const h = Math.max(1, Math.round(current.height))
			if (scratch.canvas.width !== w || scratch.canvas.height !== h) {
				scratch.canvas.width = w
				scratch.canvas.height = h
			}
			scratch.ctx.clearRect(0, 0, w, h)
			scratch.ctx.drawImage(current.source, 0, 0, w, h)

			const image = scratch.ctx.getImageData(0, 0, w, h)
			const data = image.data
			// The shader works in 0-1 and this works in 0-255, so the thresholds
			// are scaled once rather than every pixel.
			const inner = (settings.tolerance - settings.smoothing) * 255
			const outer = (settings.tolerance + settings.smoothing) * 255
			const span = Math.max(1, outer - inner)

			for (let i = 0; i < data.length; i += 4) {
				const r = data[i]
				const g = data[i + 1]
				const b = data[i + 2]
				const cb = -0.169 * r - 0.331 * g + 0.5 * b - keyCb
				const cr = 0.5 * r - 0.419 * g - 0.081 * b - keyCr
				const distance = Math.sqrt(cb * cb + cr * cr)
				const alpha = distance <= inner ? 0 : distance >= outer ? 255 : Math.round((255 * (distance - inner)) / span)

				if (settings.despill > 0 && alpha > 0) {
					const others = dominant === 0 ? Math.max(g, b) : dominant === 1 ? Math.max(r, b) : Math.max(r, g)
					const value = data[i + dominant]
					if (value > others) data[i + dominant] = value - (value - others) * settings.despill
				}

				if (settings.debug) {
					data[i] = alpha
					data[i + 1] = alpha
					data[i + 2] = alpha
					data[i + 3] = 255
				} else {
					data[i + 3] = Math.round((data[i + 3] * alpha) / 255)
				}
			}
			scratch.ctx.putImageData(image, 0, 0)

			const rect = placeOverlay(settings, width, height, w, h)
			ctx.save()
			ctx.globalAlpha = settings.opacity
			ctx.drawImage(scratch.canvas, rect.x, rect.y, rect.width, rect.height)
			ctx.restore()
		},
	}

	return {
		degraded: true,
		pass,
		setFrame(frame) {
			current = frame
		},
		dispose() {},
	}
}

export function createChromaOverlayCompositor(settings: ChromaOverlaySettings): ChromaOverlayCompositor {
	return createGpuCompositor(settings) ?? createCpuCompositor(settings)
}

/* ==========================================================================
   Wiring it into a render.
   ========================================================================== */

export type ChromaOverlayParams = {
	keyColor: string
	/** samples the clip's own border instead of trusting the colour above */
	autoKey: boolean
	/** 0-100 sliders */
	tolerance: number
	smoothing: number
	despill: number
	opacity: number
	scale: number
	placement: OverlayPlacement
	fit: OverlayFit
	/** where in the main clip the overlay starts, in seconds */
	startAt: number
	loop: boolean
	showMatte: boolean
}

export type PreparedChromaOverlay = {
	perFrame: PerFrameHook
	degraded: boolean
	summary: string
	dispose(): void
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
	const clean = hex.replace('#', '')
	const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean.padEnd(6, '0')
	const value = Number.parseInt(full, 16)
	if (!Number.isFinite(value)) return { r: 0, g: 177, b: 64 }
	return { r: (value >> 16) & 0xff, g: (value >> 8) & 0xff, b: value & 0xff }
}

/**
 * Reads the backdrop colour off the clip's own edges.
 *
 * The border of a green-screen frame is the one region that is nearly always
 * backdrop and nearly never subject, so the median of a ring of samples taken
 * around it is a far better key than any colour typed into a field - it picks
 * up the actual lighting rather than the paint's nominal colour. The median,
 * not the mean: a subject that does touch one edge should not be allowed to
 * drag the answer toward their shirt.
 */
export function sampleKeyColour(source: CanvasImageSource, width: number, height: number): { r: number; g: number; b: number } | null {
	if (typeof OffscreenCanvas === 'undefined') return null
	const w = Math.min(160, Math.max(8, Math.round(width)))
	const h = Math.max(8, Math.round((height / Math.max(width, 1)) * w))
	const canvas = new OffscreenCanvas(w, h)
	const ctx = canvas.getContext('2d', { willReadFrequently: true })
	if (!ctx) return null
	ctx.drawImage(source, 0, 0, w, h)
	const data = ctx.getImageData(0, 0, w, h).data

	const reds: number[] = []
	const greens: number[] = []
	const blues: number[] = []
	const push = (x: number, y: number) => {
		const index = (y * w + x) * 4
		reds.push(data[index])
		greens.push(data[index + 1])
		blues.push(data[index + 2])
	}
	for (let x = 0; x < w; x++) {
		push(x, 0)
		push(x, h - 1)
	}
	for (let y = 0; y < h; y++) {
		push(0, y)
		push(w - 1, y)
	}
	if (reds.length === 0) return null

	const median = (values: number[]) => {
		values.sort((a, b) => a - b)
		return values[Math.floor(values.length / 2)]
	}
	return { r: median(reds), g: median(greens), b: median(blues) }
}

export async function prepareChromaOverlay(args: {
	params: ChromaOverlayParams
	overlayFile: File | null
	signal: AbortSignal
}): Promise<PreparedChromaOverlay> {
	const { params } = args
	if (!args.overlayFile) throw new Error('Choose the green-screen clip to lay over this one first.')

	const overlay = await openSecondaryVideoSource(args.overlayFile)

	let keyColor = hexToRgb(params.keyColor)
	let keySource = 'the colour you picked'
	if (params.autoKey) {
		const firstFrame = await overlay.getFrameAt(Math.min(0.1, overlay.durationSeconds / 2))
		const sampled = firstFrame ? sampleKeyColour(firstFrame.canvas, firstFrame.naturalWidth, firstFrame.naturalHeight) : null
		if (sampled) {
			keyColor = sampled
			keySource = `a colour sampled from the clip's edges (rgb ${sampled.r}, ${sampled.g}, ${sampled.b})`
		}
	}

	const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
	const settings: ChromaOverlaySettings = {
		keyColor,
		// The sliders are percentages of the widest chroma distance worth
		// treating as "still the backdrop"; 0.6 there is already everything.
		tolerance: clamp(params.tolerance, 1, 100) / 100 * 0.6,
		smoothing: clamp(params.smoothing, 0, 100) / 100 * 0.2,
		despill: clamp(params.despill, 0, 100) / 100,
		placement: params.placement,
		fit: params.fit,
		scale: clamp(params.scale, 5, 100) / 100,
		opacity: clamp(params.opacity, 0, 100) / 100,
		debug: params.showMatte,
	}

	const compositor = createChromaOverlayCompositor(settings)

	const perFrame: PerFrameHook = async (_frameIndex, timestampSeconds) => {
		const elapsed = timestampSeconds - params.startAt
		if (elapsed < 0) {
			// Before its cue the overlay simply is not there.
			compositor.setFrame(null)
			return { patch: { overlayPass: null } }
		}
		const duration = overlay.durationSeconds
		if (!params.loop && duration > 0 && elapsed > duration) {
			compositor.setFrame(null)
			return { patch: { overlayPass: null } }
		}
		const at = params.loop && duration > 0 ? elapsed % duration : Math.min(elapsed, Math.max(0, duration - 0.001))
		const frame = await overlay.getFrameAt(at)
		if (!frame) {
			compositor.setFrame(null)
			return { patch: { overlayPass: null } }
		}
		compositor.setFrame({ source: frame.canvas, width: frame.naturalWidth, height: frame.naturalHeight })
		return { patch: { overlayPass: compositor.pass } }
	}

	const summary = params.showMatte
		? `showing the key itself, from ${keySource}`
		: `${args.overlayFile.name} keyed on ${keySource}${params.loop ? ', looped' : ''}${
				compositor.degraded ? ' - keyed on the CPU' : ''
			}`

	return {
		perFrame,
		degraded: compositor.degraded,
		summary,
		dispose() {
			compositor.dispose()
			overlay.dispose()
		},
	}
}
