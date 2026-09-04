'use client'

/**
 * The render graph: given a project, a frame index, and a pool of open asset
 * sinks, draws exactly one frame. This is the one function the live preview
 * (`lib/editor/player.ts`) and the deterministic export loop
 * (`lib/editor/export.ts`) both call, which is what makes "what you see is
 * what you export" true by construction rather than by two implementations
 * happening to agree - and what makes every setting below update the preview
 * the instant it changes: a slider edit is a `Command` dispatch, which
 * changes `doc`, which the player re-renders through this same function on
 * the very next frame. There is no separate "apply" step.
 *
 * This is the Canvas2D tier of the blueprint's degrade-gracefully ladder
 * (WebGPU -> WebGL2 -> Canvas2D) - always available, no adapter negotiation,
 * and correct; a WebGPU compositor is a drop-in performance upgrade for a
 * later pass, not a change to this function's contract.
 *
 * Colour grading and the stylize filters ride the browser's own
 * `CanvasRenderingContext2D.filter` - real GPU-composited work the browser
 * already does for free, not a hand-rolled per-pixel pass. Crop is free too
 * (it is just a different source rectangle). Only chroma key genuinely needs
 * to read and rewrite individual pixels, so it is the one effect that pays
 * for an extra offscreen canvas - and only on clips that actually use it.
 */

import { activeClipsAtFrame, clipsOnTrack, findAsset } from './model'
import type { AssetSinkPool } from './sinks'
import {
	type AnchorPosition,
	type ChromaKeySpec,
	type Clip,
	type ClipEffects,
	type CropRect,
	type ImageClip,
	type ProjectDoc,
	type TextStyle,
	type Transform,
	type VideoClip,
	clipEndFrame,
} from './types'

export type Canvas2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D

/** Resolves an asset's bytes for one frame. Returns `null` when the source is not currently available. */
export type BlobResolver = (assetId: string) => Blob | null

export type RenderFrameOptions = {
	/**
	 * Scale only the preview backing canvas. Timeline geometry stays in project
	 * pixels and exports omit this option, so quality is never silently reduced.
	 */
	previewScale?: number
}

function clamp01(value: number): number {
	return Math.min(1, Math.max(0, value))
}

/* ------------------------------------------------------------------ color */

function buildFilterString(effects: ClipEffects): string {
	const parts: string[] = []
	if (effects.brightness !== 1) parts.push(`brightness(${effects.brightness})`)
	if (effects.contrast !== 1) parts.push(`contrast(${effects.contrast})`)
	if (effects.saturation !== 1) parts.push(`saturate(${effects.saturation})`)
	if (effects.hueRotateDeg) parts.push(`hue-rotate(${effects.hueRotateDeg}deg)`)
	if (effects.blurPx > 0) parts.push(`blur(${effects.blurPx}px)`)
	if (effects.grayscale > 0) parts.push(`grayscale(${clamp01(effects.grayscale)})`)
	if (effects.sepia > 0) parts.push(`sepia(${clamp01(effects.sepia)})`)
	if (effects.invert > 0) parts.push(`invert(${clamp01(effects.invert)})`)
	return parts.length ? parts.join(' ') : 'none'
}

/** A warm/cool overlay tint - not a physical colour-temperature model, but a well-understood approximation without a shader. */
function drawTemperatureOverlay(ctx: Canvas2D, dx: number, dy: number, dw: number, dh: number, temperature: number): void {
	const strength = clamp01(Math.abs(temperature) / 100) * 0.35
	if (strength <= 0.002 || dw <= 0 || dh <= 0) return
	ctx.save()
	ctx.globalCompositeOperation = 'overlay'
	ctx.fillStyle = temperature > 0 ? `rgba(255,159,64,${strength})` : `rgba(64,140,255,${strength})`
	ctx.fillRect(dx, dy, dw, dh)
	ctx.restore()
}

function drawVignetteOverlay(ctx: Canvas2D, dx: number, dy: number, dw: number, dh: number, amount: number): void {
	const strength = clamp01(amount)
	if (strength <= 0.002 || dw <= 0 || dh <= 0) return
	const cx = dx + dw / 2
	const cy = dy + dh / 2
	const outerRadius = Math.sqrt((dw / 2) ** 2 + (dh / 2) ** 2)
	const gradient = ctx.createRadialGradient(cx, cy, outerRadius * 0.35 * (1 - strength * 0.5), cx, cy, outerRadius)
	gradient.addColorStop(0, 'rgba(0,0,0,0)')
	gradient.addColorStop(1, `rgba(0,0,0,${strength})`)
	ctx.save()
	ctx.globalCompositeOperation = 'multiply'
	ctx.fillStyle = gradient
	ctx.fillRect(dx, dy, dw, dh)
	ctx.restore()
}

function hexToRgb(hex: string): [number, number, number] {
	const clean = hex.replace('#', '')
	const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean.padStart(6, '0')
	const value = parseInt(full, 16)
	return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

/**
 * Keys `keyColor` out of a rendered patch in place, with a soft feathered
 * edge and spill suppression on the fringe pixels. Runs once per keyed clip
 * per frame on an offscreen canvas sized to the clip's own (cropped) source
 * resolution, not the full output canvas - the cost scales with the clip,
 * not with the project.
 */
function applyChromaKey(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, width: number, height: number, spec: ChromaKeySpec): void {
	if (width <= 0 || height <= 0) return
	const [kr, kg, kb] = hexToRgb(spec.keyColor)
	const dominant: 'r' | 'g' | 'b' = kg >= kr && kg >= kb ? 'g' : kb >= kr ? 'b' : 'r'
	const tolerance = clamp01(spec.tolerance) * 220
	const softness = Math.max(1, clamp01(spec.softness) * 140)
	const spill = clamp01(spec.spill)

	let imageData: ImageData
	try {
		imageData = ctx.getImageData(0, 0, width, height)
	} catch {
		return // never let a keying failure (e.g. a tainted canvas) take the whole frame down
	}
	const data = imageData.data
	for (let i = 0; i < data.length; i += 4) {
		const r = data[i]
		const g = data[i + 1]
		const b = data[i + 2]
		const dist = Math.sqrt((r - kr) ** 2 + (g - kg) ** 2 + (b - kb) ** 2)

		let alpha = 1
		if (dist <= tolerance) alpha = 0
		else if (dist <= tolerance + softness) alpha = (dist - tolerance) / softness
		if (alpha < 1) data[i + 3] = Math.round(data[i + 3] * alpha)

		if (spill > 0 && alpha > 0) {
			const closeness = 1 - Math.min(1, dist / (tolerance + softness + 1))
			const suppress = spill * closeness
			if (suppress > 0.002) {
				if (dominant === 'g') data[i + 1] = Math.round(g - (g - Math.max(r, b)) * suppress)
				else if (dominant === 'b') data[i + 2] = Math.round(b - (b - Math.max(r, g)) * suppress)
				else data[i] = Math.round(r - (r - Math.max(g, b)) * suppress)
			}
		}
	}
	ctx.putImageData(imageData, 0, 0)
}

function cropRectPx(crop: CropRect | null, naturalWidth: number, naturalHeight: number): { sx: number; sy: number; sw: number; sh: number } {
	if (!crop) return { sx: 0, sy: 0, sw: naturalWidth, sh: naturalHeight }
	const sx = clamp01(crop.x) * naturalWidth
	const sy = clamp01(crop.y) * naturalHeight
	const maxW = Math.max(2, naturalWidth - sx)
	const maxH = Math.max(2, naturalHeight - sy)
	return { sx, sy, sw: Math.min(maxW, Math.max(2, clamp01(crop.width) * naturalWidth)), sh: Math.min(maxH, Math.max(2, clamp01(crop.height) * naturalHeight)) }
}

/* -------------------------------------------------------------- transform */

/** Fits `naturalW x naturalH` inside the canvas ("contain"), applies the clip's scale/position/rotation, then colour grade + temperature + vignette on top - all inside the same transformed space, so overlays rotate and scale with the clip instead of sitting axis-aligned on the canvas. */
function withClipTransform(
	ctx: Canvas2D,
	transform: Transform,
	naturalWidth: number,
	naturalHeight: number,
	canvasWidth: number,
	canvasHeight: number,
	effects: ClipEffects | null,
	draw: (dx: number, dy: number, dw: number, dh: number) => void,
): void {
	if (naturalWidth <= 0 || naturalHeight <= 0) return
	const fit = Math.min(canvasWidth / naturalWidth, canvasHeight / naturalHeight)
	const w = naturalWidth * fit * transform.scaleX
	const h = naturalHeight * fit * transform.scaleY

	ctx.save()
	ctx.globalAlpha = clamp01(transform.opacity)
	ctx.translate(canvasWidth / 2 + transform.x, canvasHeight / 2 + transform.y)
	if (transform.rotationDeg) ctx.rotate((transform.rotationDeg * Math.PI) / 180)
	if (effects) ctx.filter = buildFilterString(effects)
	draw(-w / 2, -h / 2, w, h)
	if (effects) {
		ctx.filter = 'none' // the overlays below are flat fills, not more picture to grade
		if (effects.temperature !== 0) drawTemperatureOverlay(ctx, -w / 2, -h / 2, w, h, effects.temperature)
		if (effects.vignette > 0) drawVignetteOverlay(ctx, -w / 2, -h / 2, w, h, effects.vignette)
	}
	ctx.restore()
}

function withOpacityMultiplier(transform: Transform, multiplier: number): Transform {
	return multiplier === 1 ? transform : { ...transform, opacity: transform.opacity * multiplier }
}

function drawOfflineSlate(ctx: Canvas2D, label: string, transform: Transform, canvasWidth: number, canvasHeight: number): void {
	const w = canvasWidth * 0.6 * transform.scaleX
	const h = canvasHeight * 0.6 * transform.scaleY
	ctx.save()
	ctx.globalAlpha = clamp01(transform.opacity)
	ctx.translate(canvasWidth / 2 + transform.x, canvasHeight / 2 + transform.y)
	if (transform.rotationDeg) ctx.rotate((transform.rotationDeg * Math.PI) / 180)
	ctx.fillStyle = '#1c1f27'
	ctx.strokeStyle = '#3a3f4d'
	ctx.lineWidth = 2
	ctx.fillRect(-w / 2, -h / 2, w, h)
	ctx.strokeRect(-w / 2, -h / 2, w, h)
	ctx.fillStyle = '#8890a8'
	ctx.font = '600 20px Inter, sans-serif'
	ctx.textAlign = 'center'
	ctx.textBaseline = 'middle'
	ctx.fillText(`Media offline - ${label}`, 0, 0)
	ctx.restore()
}

function anchorFor(position: AnchorPosition, width: number, height: number, margin: number): { x: number; y: number; align: CanvasTextAlign; baseline: CanvasTextBaseline } {
	const left = margin
	const centerX = width / 2
	const right = width - margin
	const top = margin
	const centerY = height / 2
	const bottom = height - margin
	switch (position) {
		case 'top-left':
			return { x: left, y: top, align: 'left', baseline: 'top' }
		case 'top-center':
			return { x: centerX, y: top, align: 'center', baseline: 'top' }
		case 'top-right':
			return { x: right, y: top, align: 'right', baseline: 'top' }
		case 'bottom-left':
			return { x: left, y: bottom, align: 'left', baseline: 'bottom' }
		case 'bottom-center':
			return { x: centerX, y: bottom, align: 'center', baseline: 'bottom' }
		case 'bottom-right':
			return { x: right, y: bottom, align: 'right', baseline: 'bottom' }
		default:
			return { x: centerX, y: centerY, align: 'center', baseline: 'middle' }
	}
}

/** ease-out cubic - animations that arrive read as more natural than a straight linear ramp. */
function easeOutCubic(t: number): number {
	const c = clamp01(t)
	return 1 - (1 - c) ** 3
}

/**
 * How far into its enter/exit animation a text clip is right now, expressed
 * as an opacity multiplier, a vertical offset in pixels, and a uniform scale
 * multiplier - all three default to "fully settled" (1, 0, 1) outside the
 * animation windows, so a clip with `animationIn: 'none'` costs nothing extra.
 */
function textEnterExit(text: TextStyle, localFrame: number, durationFrames: number): { opacity: number; offsetY: number; scale: number } {
	const span = Math.max(1, Math.min(text.animationFrames, Math.floor(durationFrames / 2)))
	let phase: 'in' | 'out' | null = null
	let t = 1
	if (text.animationIn !== 'none' && localFrame < span) {
		phase = 'in'
		t = easeOutCubic(localFrame / span)
	} else if (text.animationOut !== 'none' && localFrame > durationFrames - span) {
		phase = 'out'
		t = easeOutCubic((durationFrames - localFrame) / span)
	}
	if (!phase) return { opacity: 1, offsetY: 0, scale: 1 }

	const kind = phase === 'in' ? text.animationIn : text.animationOut
	switch (kind) {
		case 'fade':
			return { opacity: t, offsetY: 0, scale: 1 }
		case 'slide-up':
			return { opacity: t, offsetY: (1 - t) * 46, scale: 1 }
		case 'slide-down':
			return { opacity: t, offsetY: -(1 - t) * 46, scale: 1 }
		case 'pop':
			return { opacity: t, offsetY: 0, scale: 0.82 + 0.18 * t }
		default:
			return { opacity: 1, offsetY: 0, scale: 1 }
	}
}

function drawTextClip(ctx: Canvas2D, text: TextStyle, transform: Transform, canvasWidth: number, canvasHeight: number, localFrame: number, durationFrames: number): void {
	const anchor = anchorFor(text.position, canvasWidth, canvasHeight, text.marginPx)
	const lines = text.content.split('\n')
	const lineHeight = text.fontSizePx * 1.25
	const anim = textEnterExit(text, localFrame, durationFrames)

	ctx.save()
	ctx.globalAlpha = clamp01(transform.opacity) * anim.opacity
	ctx.translate(anchor.x + transform.x, anchor.y + transform.y + anim.offsetY)
	if (transform.rotationDeg) ctx.rotate((transform.rotationDeg * Math.PI) / 180)
	ctx.scale(transform.scaleX * anim.scale, transform.scaleY * anim.scale)
	ctx.font = `${text.weight} ${text.fontSizePx}px ${text.fontFamily}`
	ctx.textAlign = anchor.align
	ctx.textBaseline = 'alphabetic'

	// The vertical anchor (top/middle/bottom) is resolved against the whole
	// block of lines here, then every line is drawn with a plain alphabetic
	// baseline - mixing `textBaseline: 'middle'` with multi-line text drifts
	// baseline-to-baseline in every browser's font metrics differently.
	const blockHeight = lineHeight * lines.length
	const firstBaselineY =
		anchor.baseline === 'top'
			? text.fontSizePx * 0.85
			: anchor.baseline === 'bottom'
				? -blockHeight + lineHeight - text.fontSizePx * 0.25
				: -blockHeight / 2 + text.fontSizePx * 0.85

	if (text.backgroundColor) {
		let maxWidth = 0
		for (const line of lines) maxWidth = Math.max(maxWidth, ctx.measureText(line).width)
		const padX = text.fontSizePx * 0.35
		const padY = text.fontSizePx * 0.25
		const boxX = anchor.align === 'left' ? -padX : anchor.align === 'right' ? -maxWidth - padX : -maxWidth / 2 - padX
		ctx.fillStyle = text.backgroundColor
		ctx.fillRect(boxX, firstBaselineY - text.fontSizePx * 0.85 - padY, maxWidth + padX * 2, blockHeight + padY * 2)
	}

	lines.forEach((line, i) => {
		const y = firstBaselineY + i * lineHeight
		if (text.strokeColor && text.strokeWidthPx > 0) {
			ctx.strokeStyle = text.strokeColor
			ctx.lineWidth = text.strokeWidthPx
			ctx.lineJoin = 'round'
			ctx.strokeText(line, 0, y)
		}
		ctx.fillStyle = text.color
		ctx.fillText(line, 0, y)
	})
	ctx.restore()
}

/* ------------------------------------------------------------- transitions */

/**
 * Two video/image clips on the *same track* that overlap in time crossfade
 * across that overlap automatically - drag one clip to overlap its neighbour
 * to create a dissolve, the classic NLE convention, no separate "transition"
 * object to manage. Returns each overlapping clip's opacity multiplier for
 * this frame; clips with no overlap are left out entirely (multiplier 1).
 */
function computeCrossfadeMultipliers(clips: Clip[], frameIndex: number): Map<string, number> {
	const overrides = new Map<string, number>()
	const byTrack = new Map<string, Array<VideoClip | ImageClip>>()
	for (const clip of clips) {
		if (clip.kind !== 'video' && clip.kind !== 'image') continue
		const list = byTrack.get(clip.trackId)
		if (list) list.push(clip)
		else byTrack.set(clip.trackId, [clip])
	}
	for (const list of byTrack.values()) {
		if (list.length < 2) continue
		list.sort((a, b) => a.startFrame - b.startFrame)
		for (let i = 0; i < list.length - 1; i++) {
			const earlier = list[i]
			const later = list[i + 1]
			const overlapStart = later.startFrame
			const overlapEnd = clipEndFrame(earlier)
			if (overlapEnd <= overlapStart) continue
			const progress = clamp01((frameIndex - overlapStart) / (overlapEnd - overlapStart))
			overrides.set(earlier.id, Math.min(overrides.get(earlier.id) ?? 1, 1 - progress))
			overrides.set(later.id, Math.min(overrides.get(later.id) ?? 1, progress))
		}
	}
	return overrides
}

/* ---------------------------------------------------------------- render */

/**
 * Renders `frameIndex` of `doc` into `canvas`. Returns the set of asset ids
 * that were needed but had no resolvable source, so the caller (a live
 * preview, or an export progress line) can surface "3 clips offline" rather
 * than silently showing a black gap.
 */
export async function renderFrame(
	doc: ProjectDoc,
	pool: AssetSinkPool,
	resolveBlob: BlobResolver,
	frameIndex: number,
	canvas: OffscreenCanvas | HTMLCanvasElement,
	options: RenderFrameOptions = {},
): Promise<{ offlineAssetIds: Set<string> }> {
	const { width, height, fps, backgroundColor } = doc.settings
	const previewScale = Math.min(1, Math.max(0.25, options.previewScale ?? 1))
	const backingWidth = Math.max(2, Math.round(width * previewScale))
	const backingHeight = Math.max(2, Math.round(height * previewScale))
	if (canvas.width !== backingWidth) canvas.width = backingWidth
	if (canvas.height !== backingHeight) canvas.height = backingHeight
	const ctx = canvas.getContext('2d') as Canvas2D | null
	const offlineAssetIds = new Set<string>()
	if (!ctx) return { offlineAssetIds }

	ctx.save()
	ctx.setTransform(1, 0, 0, 1, 0, 0)
	ctx.globalAlpha = 1
	ctx.filter = 'none'
	ctx.fillStyle = backgroundColor
	ctx.fillRect(0, 0, backingWidth, backingHeight)
	ctx.restore()
	ctx.save()
	ctx.setTransform(backingWidth / width, 0, 0, backingHeight / height, 0, 0)

	try {
		const clips = activeClipsAtFrame(doc, frameIndex)
		const crossfades = computeCrossfadeMultipliers(clips, frameIndex)
		for (const clip of clips) {
			await drawClip(ctx, doc, pool, resolveBlob, clip, frameIndex, fps, width, height, offlineAssetIds, crossfades.get(clip.id) ?? 1, previewScale)
		}
	} finally {
		ctx.restore()
	}

	return { offlineAssetIds }
}

async function drawClip(
	ctx: Canvas2D,
	doc: ProjectDoc,
	pool: AssetSinkPool,
	resolveBlob: BlobResolver,
	clip: Clip,
	frameIndex: number,
	fps: number,
	canvasWidth: number,
	canvasHeight: number,
	offlineAssetIds: Set<string>,
	opacityMultiplier: number,
	previewScale: number,
): Promise<void> {
	if (clip.kind === 'text') {
		drawTextClip(ctx, clip.text, withOpacityMultiplier(clip.transform, opacityMultiplier), canvasWidth, canvasHeight, frameIndex - clip.startFrame, clip.durationFrames)
		return
	}
	if (clip.kind === 'audio') return // audio-only clips have nothing to paint

	const transform = withOpacityMultiplier(clip.transform, opacityMultiplier)
	const asset = findAsset(doc, clip.assetId)
	if (!asset || asset.status !== 'ready') {
		offlineAssetIds.add(clip.assetId)
		drawOfflineSlate(ctx, clip.label, transform, canvasWidth, canvasHeight)
		return
	}
	const blob = resolveBlob(asset.id)
	if (!blob) {
		offlineAssetIds.add(asset.id)
		drawOfflineSlate(ctx, clip.label, transform, canvasWidth, canvasHeight)
		return
	}

	if (clip.kind === 'image') {
		const bitmap = await pool.getImage(asset, blob)
		if (!bitmap) {
			offlineAssetIds.add(asset.id)
			drawOfflineSlate(ctx, clip.label, transform, canvasWidth, canvasHeight)
			return
		}
		const { sx, sy, sw, sh } = cropRectPx(clip.effects.crop, bitmap.width, bitmap.height)
		if (clip.effects.chromaKey?.enabled) {
			const scratch = new OffscreenCanvas(Math.max(2, Math.round(sw * previewScale)), Math.max(2, Math.round(sh * previewScale)))
			const scratchCtx = scratch.getContext('2d')
			if (scratchCtx) {
				scratchCtx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, scratch.width, scratch.height)
				applyChromaKey(scratchCtx, scratch.width, scratch.height, clip.effects.chromaKey)
				withClipTransform(ctx, transform, scratch.width, scratch.height, canvasWidth, canvasHeight, clip.effects, (dx, dy, dw, dh) => {
					ctx.drawImage(scratch, dx, dy, dw, dh)
				})
			}
		} else {
			withClipTransform(ctx, transform, sw, sh, canvasWidth, canvasHeight, clip.effects, (dx, dy, dw, dh) => {
				ctx.drawImage(bitmap, sx, sy, sw, sh, dx, dy, dw, dh)
			})
		}
		return
	}

	// clip.kind === 'video'
	const sink = await pool.get(asset, blob)
	if (!sink || !sink.videoSink) {
		offlineAssetIds.add(asset.id)
		drawOfflineSlate(ctx, clip.label, transform, canvasWidth, canvasHeight)
		return
	}
	const sourceSeconds = clip.freezeFrame ? clip.sourceInSeconds : clip.sourceInSeconds + ((frameIndex - clip.startFrame) / fps) * clip.speed
	const sample = await sink.videoSink.getSample(Math.max(0, sourceSeconds))
	if (!sample) return
	try {
		const { sx, sy, sw, sh } = cropRectPx(clip.effects.crop, sink.naturalWidth, sink.naturalHeight)
		if (clip.effects.chromaKey?.enabled) {
			const scratch = new OffscreenCanvas(Math.max(2, Math.round(sw * previewScale)), Math.max(2, Math.round(sh * previewScale)))
			const scratchCtx = scratch.getContext('2d')
			if (scratchCtx) {
				sample.draw(scratchCtx, sx, sy, sw, sh, 0, 0, scratch.width, scratch.height)
				applyChromaKey(scratchCtx, scratch.width, scratch.height, clip.effects.chromaKey)
				withClipTransform(ctx, transform, scratch.width, scratch.height, canvasWidth, canvasHeight, clip.effects, (dx, dy, dw, dh) => {
					ctx.drawImage(scratch, dx, dy, dw, dh)
				})
			}
		} else {
			withClipTransform(ctx, transform, sw, sh, canvasWidth, canvasHeight, clip.effects, (dx, dy, dw, dh) => {
				sample.draw(ctx, sx, sy, sw, sh, dx, dy, dw, dh)
			})
		}
	} finally {
		sample.close()
	}
}

/** Re-exported so `Timeline.tsx` can draw an overlap indicator using the exact same pairing logic the renderer uses. */
export function findTrackOverlaps(doc: ProjectDoc, trackId: string): Array<{ startFrame: number; endFrame: number }> {
	const clips = clipsOnTrack(doc, trackId).filter((c) => c.kind === 'video' || c.kind === 'image')
	const overlaps: Array<{ startFrame: number; endFrame: number }> = []
	for (let i = 0; i < clips.length - 1; i++) {
		const overlapStart = clips[i + 1].startFrame
		const overlapEnd = clipEndFrame(clips[i])
		if (overlapEnd > overlapStart) overlaps.push({ startFrame: overlapStart, endFrame: overlapEnd })
	}
	return overlaps
}
