'use client'

/**
 * Titles: styled, positioned, timed and animated text burned into the frame.
 *
 * The plain text overlay in `frame-ops.ts` exists to stamp a line onto every
 * frame - a handle, a disclaimer, a date. This is the other kind of text: the
 * kind with an in and an out, a stroke, a shadow, a highlight box, and a move
 * on it. Nearly every short-form video has one, and doing it by re-rendering
 * the clip in a compositor is absurd when the render loop already hands us a
 * frame index and a canvas.
 *
 * Three things here are worth reading rather than skimming:
 *
 * - **Layout is measured, not guessed.** Lines are wrapped against a real
 *   `measureText` at the real size, so a long title breaks where it actually
 *   runs out of room rather than at a character count that happens to work for
 *   Latin script and nowhere else.
 * - **The animation is a function of time, not of frame.** `progress` is
 *   derived from seconds so a title lands at the same moment on a 24fps clip
 *   and a 60fps one, and the eases are the same curves the motion presets use.
 * - **Every style draws in one order:** box, shadow, stroke, fill, in that
 *   order, because a stroke drawn after a fill eats half the glyph weight and
 *   a shadow drawn after either shadows the wrong thing.
 */

import { anchorPoint, type AnchorPosition, type FramePass } from './frame-ops'

type Ctx2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D

export type TextStyleId = 'plain' | 'outline' | 'shadow' | 'glow' | 'box' | 'lower-third' | 'gradient' | 'highlight'

export const TEXT_STYLES: Array<{ id: TextStyleId; label: string; blurb: string }> = [
	{ id: 'plain', label: 'Plain', blurb: 'Just the letters.' },
	{ id: 'outline', label: 'Outlined', blurb: 'A hard contrasting rule around every glyph - readable on anything.' },
	{ id: 'shadow', label: 'Drop shadow', blurb: 'Offset shadow behind the letters.' },
	{ id: 'glow', label: 'Glow', blurb: 'A soft halo in the accent colour.' },
	{ id: 'box', label: 'Solid box', blurb: 'A filled panel behind the whole block.' },
	{ id: 'lower-third', label: 'Lower third', blurb: 'A bar with a coloured edge, sitting where a name would go.' },
	{ id: 'gradient', label: 'Gradient fill', blurb: 'The letters filled with a two-colour ramp.' },
	{ id: 'highlight', label: 'Marker highlight', blurb: 'A rough band of colour behind each line, like a highlighter pen.' },
]

export type TextAnimationId = 'none' | 'fade' | 'pop' | 'slide-up' | 'slide-left' | 'typewriter' | 'bounce' | 'wipe' | 'karaoke'

export const TEXT_ANIMATIONS: Array<{ id: TextAnimationId; label: string; blurb: string }> = [
	{ id: 'none', label: 'None', blurb: 'On for the whole window, off outside it.' },
	{ id: 'fade', label: 'Fade in / out', blurb: 'The safe one.' },
	{ id: 'pop', label: 'Pop', blurb: 'Scales up past its size and settles.' },
	{ id: 'slide-up', label: 'Slide up', blurb: 'Rises into place from below.' },
	{ id: 'slide-left', label: 'Slide in from the right', blurb: 'Travels in horizontally.' },
	{ id: 'typewriter', label: 'Typewriter', blurb: 'One character at a time.' },
	{ id: 'bounce', label: 'Bounce', blurb: 'Springs in and overshoots once.' },
	{ id: 'wipe', label: 'Wipe', blurb: 'Revealed left to right behind a moving edge.' },
	{ id: 'karaoke', label: 'Karaoke', blurb: 'Fills with the accent colour as it plays.' },
]

export type TitleSettings = {
	content: string
	fontSize: number
	weight: 400 | 600 | 800
	italic: boolean
	uppercase: boolean
	letterSpacing: number
	lineHeight: number
	color: string
	accent: string
	style: TextStyleId
	animation: TextAnimationId
	position: AnchorPosition
	/** nudges, as a fraction of the frame */
	offsetX: number
	offsetY: number
	rotation: number
	/** 0-1 */
	opacity: number
	/** the window the title is on screen for, in seconds */
	startAt: number
	durationSeconds: number
	/** how long the in and out animations take, in seconds */
	animateSeconds: number
	/** 0-1 of the frame width; the block wraps at this */
	maxWidth: number
	fps: number
}

/** The one place the font stack is spelled out, so every style agrees. */
function fontString(settings: TitleSettings, size: number): string {
	return `${settings.italic ? 'italic ' : ''}${settings.weight} ${size}px Inter, "Segoe UI", "Noto Sans", system-ui, sans-serif`
}

type Line = { text: string; width: number }

/** Greedy wrap against real measured widths, honouring explicit newlines. */
function layoutLines(ctx: Ctx2D, text: string, maxWidth: number): Line[] {
	const lines: Line[] = []
	for (const paragraph of text.split('\n')) {
		const words = paragraph.split(/\s+/).filter(Boolean)
		if (words.length === 0) {
			lines.push({ text: '', width: 0 })
			continue
		}
		let current = words[0]
		for (let i = 1; i < words.length; i++) {
			const candidate = `${current} ${words[i]}`
			if (ctx.measureText(candidate).width <= maxWidth) current = candidate
			else {
				lines.push({ text: current, width: ctx.measureText(current).width })
				current = words[i]
			}
		}
		lines.push({ text: current, width: ctx.measureText(current).width })
	}
	return lines
}

function easeOut(t: number): number {
	return 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3)
}

type Animation = {
	/** 0 when the title is not on screen at all */
	alpha: number
	scale: number
	dx: number
	dy: number
	/** 0-1: how much of the text has arrived, for typewriter and karaoke */
	reveal: number
}

/** Where the title is in its own life, at this instant. */
function animationAt(settings: TitleSettings, seconds: number): Animation {
	const idle: Animation = { alpha: 1, scale: 1, dx: 0, dy: 0, reveal: 1 }
	const start = settings.startAt
	const end = settings.durationSeconds > 0 ? start + settings.durationSeconds : Number.POSITIVE_INFINITY
	if (seconds < start || seconds > end) return { ...idle, alpha: 0 }
	if (settings.animation === 'none') return idle

	const span = Math.max(0.05, settings.animateSeconds)
	const sinceIn = seconds - start
	const untilOut = end - seconds
	const inT = Math.min(1, sinceIn / span)
	const outT = Number.isFinite(end) ? Math.min(1, untilOut / span) : 1
	const t = Math.min(inT, outT)
	const eased = easeOut(t)

	switch (settings.animation) {
		case 'fade':
			return { ...idle, alpha: eased }
		case 'pop':
			// Overshoot on the way in, straight fade on the way out - a title
			// that springs as it leaves reads as a glitch.
			return { ...idle, alpha: eased, scale: 0.86 + 0.14 * eased + Math.sin(Math.min(1, inT) * Math.PI) * 0.06 }
		case 'slide-up':
			return { ...idle, alpha: eased, dy: (1 - eased) * 0.06 }
		case 'slide-left':
			return { ...idle, alpha: eased, dx: (1 - eased) * 0.12 }
		case 'bounce': {
			const spring = 1 - Math.exp(-7 * inT) * Math.cos(inT * Math.PI * 3)
			return { ...idle, alpha: Math.min(1, outT), scale: 0.8 + 0.2 * spring, dy: (1 - spring) * 0.03 }
		}
		case 'typewriter':
			return { ...idle, alpha: Math.min(1, outT), reveal: Math.min(1, sinceIn / Math.max(0.05, settings.animateSeconds)) }
		case 'wipe':
		case 'karaoke':
			return { ...idle, alpha: Math.min(1, outT), reveal: Math.min(1, sinceIn / Math.max(0.05, settings.animateSeconds)) }
		default:
			return idle
	}
}

export function createTitlePass(settings: TitleSettings): FramePass {
	const text = settings.uppercase ? settings.content.toUpperCase() : settings.content

	return {
		apply(ctx: Ctx2D, width: number, height: number, frameIndex: number) {
			if (!text.trim()) return
			const seconds = frameIndex / Math.max(1, settings.fps)
			const anim = animationAt(settings, seconds)
			if (anim.alpha <= 0.001) return

			// The size slider is a percentage of the frame height, so a title looks
			// the same on a 720p export and a 4K one.
			const size = Math.max(8, (settings.fontSize / 100) * height)
			ctx.save()
			ctx.filter = 'none'
			ctx.globalCompositeOperation = 'source-over'
			ctx.font = fontString(settings, size)
			ctx.textBaseline = 'middle'
			ctx.textAlign = 'left'
			if (settings.letterSpacing && 'letterSpacing' in ctx) {
				;(ctx as CanvasRenderingContext2D).letterSpacing = `${settings.letterSpacing.toFixed(2)}px`
			}

			const maxWidth = Math.max(40, settings.maxWidth * width)
			const lines = layoutLines(ctx, text, maxWidth)
			const lineHeight = size * settings.lineHeight
			const blockWidth = Math.max(...lines.map((line) => line.width), 1)
			const blockHeight = lineHeight * lines.length
			const padding = size * 0.42
			const boxWidth = blockWidth + padding * 2
			const boxHeight = blockHeight + padding * 1.2
			const margin = Math.round(Math.min(width, height) * 0.05)
			const anchor = anchorPoint(settings.position, width, height, boxWidth, boxHeight, margin)

			const centreX = anchor.x + boxWidth / 2 + (settings.offsetX + anim.dx) * width
			const centreY = anchor.y + boxHeight / 2 + (settings.offsetY + anim.dy) * height

			ctx.globalAlpha = Math.min(1, Math.max(0, settings.opacity * anim.alpha))
			ctx.translate(centreX, centreY)
			if (settings.rotation) ctx.rotate((settings.rotation * Math.PI) / 180)
			if (anim.scale !== 1) ctx.scale(anim.scale, anim.scale)

			const left = -blockWidth / 2
			const top = -blockHeight / 2

			/* --------------------------------------------------------- the box */
			if (settings.style === 'box' || settings.style === 'lower-third') {
				ctx.fillStyle = settings.style === 'lower-third' ? 'rgba(8,10,16,0.78)' : settings.accent
				const radius = settings.style === 'lower-third' ? 0 : size * 0.22
				ctx.beginPath()
				ctx.roundRect(-boxWidth / 2, -boxHeight / 2, boxWidth, boxHeight, radius)
				ctx.fill()
				if (settings.style === 'lower-third') {
					// The coloured spine on the leading edge - the detail that makes
					// a grey bar read as a broadcast name plate.
					ctx.fillStyle = settings.accent
					ctx.fillRect(-boxWidth / 2, -boxHeight / 2, Math.max(3, size * 0.12), boxHeight)
				}
			}
			if (settings.style === 'highlight') {
				ctx.fillStyle = settings.accent
				lines.forEach((line, index) => {
					if (!line.text) return
					const y = top + lineHeight * index
					// The uneven inset is what stops it looking like a rectangle: a
					// real marker stroke does not start and stop square.
					ctx.beginPath()
					ctx.roundRect(left - padding * 0.4, y + lineHeight * 0.18, line.width + padding * 0.8, lineHeight * 0.7, lineHeight * 0.12)
					ctx.fill()
				})
			}

			/* ------------------------------------------------------ the letters */
			const fillFor = (lineWidth: number): string | CanvasGradient => {
				if (settings.style !== 'gradient') return settings.color
				const gradient = ctx.createLinearGradient(left, 0, left + lineWidth, 0)
				gradient.addColorStop(0, settings.color)
				gradient.addColorStop(1, settings.accent)
				return gradient
			}

			// A wipe is a clip, not a cut-out: erasing with `destination-out` here
			// would take the video with it, since this pass draws straight onto
			// the finished frame rather than onto a layer of its own.
			const wiping = settings.animation === 'wipe' && anim.reveal < 1
			if (wiping) {
				ctx.save()
				ctx.beginPath()
				ctx.rect(left - padding, top - lineHeight, blockWidth * anim.reveal + padding, blockHeight + lineHeight * 2)
				ctx.clip()
			}

			lines.forEach((line, index) => {
				if (!line.text) return
				const y = top + lineHeight * index + lineHeight / 2
				let drawn = line.text
				if (settings.animation === 'typewriter') {
					// The reveal is spread across the whole block, so a two-line title
					// types the second line after the first rather than both at once.
					const totalChars = lines.reduce((sum, entry) => sum + entry.text.length, 0)
					const before = lines.slice(0, index).reduce((sum, entry) => sum + entry.text.length, 0)
					const allowed = Math.round(totalChars * anim.reveal) - before
					if (allowed <= 0) return
					drawn = line.text.slice(0, allowed)
				}

				if (settings.style === 'shadow') {
					ctx.shadowColor = 'rgba(0,0,0,0.65)'
					ctx.shadowBlur = size * 0.18
					ctx.shadowOffsetX = size * 0.05
					ctx.shadowOffsetY = size * 0.07
				} else if (settings.style === 'glow') {
					ctx.shadowColor = settings.accent
					ctx.shadowBlur = size * 0.55
					ctx.shadowOffsetX = 0
					ctx.shadowOffsetY = 0
				}

				if (settings.style === 'outline') {
					ctx.lineJoin = 'round'
					ctx.miterLimit = 2
					ctx.strokeStyle = settings.accent
					ctx.lineWidth = Math.max(2, size * 0.14)
					ctx.strokeText(drawn, left, y)
				}

				ctx.fillStyle = fillFor(line.width)
				ctx.fillText(drawn, left, y)
				ctx.shadowBlur = 0
				ctx.shadowOffsetX = 0
				ctx.shadowOffsetY = 0

				if (settings.animation === 'karaoke' && anim.reveal < 1) {
					// The filled part is the same text clipped to a moving edge, so
					// the glyph shapes cannot drift between the two colours.
					ctx.save()
					ctx.beginPath()
					ctx.rect(left, y - lineHeight, line.width * anim.reveal, lineHeight * 2)
					ctx.clip()
					ctx.fillStyle = settings.accent
					ctx.fillText(drawn, left, y)
					ctx.restore()
				}
			})

			if (wiping) ctx.restore()

			ctx.restore()
		},
	}
}
