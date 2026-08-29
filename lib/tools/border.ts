'use client'

/**
 * Frames and borders: the band of colour, shadow or texture that sits between
 * the picture and the edge of the file.
 *
 * Small feature, but there is one thing worth getting right and almost every
 * naive implementation gets it wrong: a border drawn *over* the picture eats
 * the picture. Ten pixels of white round a 1080-wide frame is ten pixels of
 * content gone, and on a face near the edge of a vertical crop that is
 * visible. So every style here is paired with an inset - the picture is drawn
 * smaller by exactly the amount the frame will cover - and the inset is
 * expressed as a `FrameTransform`, which `frame-ops.ts` applies while the
 * picture is still at native resolution. The result is a framed clip that has
 * lost nothing, rather than a cropped one with a stripe on it.
 *
 * The styles are deliberately few and each one is a real thing someone asks
 * for by name, rather than twenty variations on "a rectangle".
 */

import type { FramePass, FrameTransform } from './frame-ops'

export type BorderStyle = 'solid' | 'rounded' | 'shadow' | 'glow' | 'polaroid' | 'double' | 'gradient' | 'inner-shadow'

export const BORDER_STYLES: Array<{ id: BorderStyle; label: string; blurb: string }> = [
	{ id: 'solid', label: 'Solid border', blurb: 'A flat band of colour all the way round.' },
	{ id: 'rounded', label: 'Rounded corners', blurb: 'The picture masked to a rounded rectangle on a plain ground.' },
	{ id: 'shadow', label: 'Drop shadow', blurb: 'The picture floated above the ground, with a soft shadow under it.' },
	{ id: 'glow', label: 'Outer glow', blurb: 'A soft halo of colour around the picture.' },
	{ id: 'polaroid', label: 'Polaroid', blurb: 'Even sides, a deep bottom margin - the instant-print shape.' },
	{ id: 'double', label: 'Double line', blurb: 'A thin inner rule inside a wider outer band.' },
	{ id: 'gradient', label: 'Gradient band', blurb: 'The border fades between two colours corner to corner.' },
	{ id: 'inner-shadow', label: 'Inner shadow', blurb: 'A vignette pressed into the edge of the picture itself.' },
]

export type BorderSettings = {
	style: BorderStyle
	/** 0-25: the band's width as a percentage of the frame's short side */
	thickness: number
	/** 0-25: corner rounding as a percentage of the frame's short side */
	radius: number
	color: string
	colorB: string
	/** 0-100 */
	opacity: number
}

/** How much the picture must shrink so the frame does not cover any of it. */
export function borderInset(settings: BorderSettings, width: number, height: number): FrameTransform | null {
	const base = Math.min(width, height)
	const band = (settings.thickness / 100) * base
	if (band <= 0.5) return null

	if (settings.style === 'polaroid') {
		// A polaroid's bottom margin is roughly three times its sides, and the
		// picture sits above centre because of it.
		const scaleX = (width - band * 2) / width
		const scaleY = (height - band * 4) / height
		const scale = Math.max(0.05, Math.min(scaleX, scaleY))
		return { scale, rotateDeg: 0, offsetX: 0, offsetY: -(band * 1.5) / height }
	}
	if (settings.style === 'inner-shadow') return null

	const scale = Math.max(0.05, Math.min((width - band * 2) / width, (height - band * 2) / height))
	return { scale, rotateDeg: 0, offsetX: 0, offsetY: 0 }
}

function roundedPath(ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
	ctx.beginPath()
	if (r > 0.5) ctx.roundRect(x, y, w, h, Math.min(r, Math.min(w, h) / 2))
	else ctx.rect(x, y, w, h)
}

export function createBorderPass(settings: BorderSettings): FramePass {
	const alpha = Math.min(1, Math.max(0, settings.opacity / 100))

	return {
		apply(ctx, width, height) {
			const base = Math.min(width, height)
			const band = (settings.thickness / 100) * base
			const radius = (settings.radius / 100) * base
			ctx.save()
			ctx.globalAlpha = alpha
			ctx.filter = 'none'

			switch (settings.style) {
				case 'inner-shadow': {
					// Drawn as a stroke whose own shadow falls inward: the stroke sits
					// outside the frame, so only its shadow is visible.
					ctx.save()
					roundedPath(ctx, -band, -band, width + band * 2, height + band * 2, radius)
					ctx.shadowColor = settings.color
					ctx.shadowBlur = Math.max(2, band * 1.4)
					ctx.strokeStyle = settings.color
					ctx.lineWidth = Math.max(1, band)
					ctx.stroke()
					ctx.restore()
					break
				}
				case 'shadow':
				case 'glow': {
					// Everything outside the picture's rectangle is ground; the
					// shadow or glow is cast by that rectangle onto it.
					const inset = band
					ctx.save()
					ctx.globalCompositeOperation = 'destination-over'
					ctx.shadowColor = settings.style === 'glow' ? settings.color : 'rgba(0,0,0,0.55)'
					ctx.shadowBlur = Math.max(4, band * 2)
					ctx.shadowOffsetY = settings.style === 'shadow' ? band * 0.35 : 0
					ctx.fillStyle = settings.style === 'glow' ? settings.color : '#000000'
					roundedPath(ctx, inset, inset, width - inset * 2, height - inset * 2, radius)
					ctx.fill()
					ctx.shadowBlur = 0
					ctx.shadowOffsetY = 0
					ctx.fillStyle = settings.colorB
					ctx.fillRect(0, 0, width, height)
					ctx.restore()
					break
				}
				case 'rounded': {
					// Punch the rounded rectangle out of a full-frame slab, and what
					// is left is exactly the corner material to paint over.
					const cutout = ctx.canvas
					ctx.save()
					ctx.globalCompositeOperation = 'destination-in'
					roundedPath(ctx, band, band, width - band * 2, height - band * 2, Math.max(radius, band))
					ctx.fillStyle = '#ffffff'
					ctx.fill()
					ctx.restore()
					ctx.save()
					ctx.globalCompositeOperation = 'destination-over'
					ctx.fillStyle = settings.color
					ctx.fillRect(0, 0, cutout.width, cutout.height)
					ctx.restore()
					break
				}
				case 'polaroid': {
					ctx.save()
					ctx.globalCompositeOperation = 'destination-over'
					ctx.fillStyle = settings.color
					ctx.fillRect(0, 0, width, height)
					ctx.restore()
					// The picture is already inset by `borderInset`, so the only work
					// left is the hairline that separates print from image.
					ctx.strokeStyle = 'rgba(0,0,0,0.18)'
					ctx.lineWidth = 1
					ctx.strokeRect(band, band, width - band * 2, height - band * 4)
					break
				}
				case 'double': {
					ctx.strokeStyle = settings.color
					ctx.lineWidth = band
					ctx.strokeRect(band / 2, band / 2, width - band, height - band)
					ctx.strokeStyle = settings.colorB
					ctx.lineWidth = Math.max(1, band * 0.18)
					const inner = band * 1.35
					ctx.strokeRect(inner, inner, width - inner * 2, height - inner * 2)
					break
				}
				case 'gradient': {
					const gradient = ctx.createLinearGradient(0, 0, width, height)
					gradient.addColorStop(0, settings.color)
					gradient.addColorStop(1, settings.colorB)
					ctx.strokeStyle = gradient
					ctx.lineWidth = band
					ctx.strokeRect(band / 2, band / 2, width - band, height - band)
					break
				}
				case 'solid':
				default: {
					ctx.strokeStyle = settings.color
					ctx.lineWidth = band
					// Stroking on the half-band inset puts the whole line inside the
					// frame; centring it on the edge would lose half of it.
					ctx.strokeRect(band / 2, band / 2, width - band, height - band)
					break
				}
			}

			ctx.restore()
		},
	}
}
