'use client'

/**
 * Camera moves: the Ken Burns push, the slow pan, the whip, the handheld
 * wobble, the spin-in - eighteen presets that all come out of the same three
 * numbers.
 *
 * A move is a function from "how far through the clip are we" to a scale, a
 * rotation and an offset. That is the whole model, and it is enough for every
 * move an editor actually reaches for, because a camera that is not changing
 * lenses can only ever push, slide or turn. Writing it this way means the
 * render loop stays ignorant: `video-filter.ts` asks the hook what this frame
 * looks like and gets back a `FrameTransform`, and `frame-ops.ts` applies it
 * while the picture is still at native resolution, so a push-in reads real
 * detail instead of magnifying an already-scaled frame.
 *
 * Two things separate this from a naive lerp:
 *
 * - **Every move stays inside the frame.** A pan of 12% at a scale of 1.0
 *   would drag a black edge across the picture, so a move that slides is
 *   given exactly the zoom it needs to keep its own edges out of shot. That
 *   is `coverScale`, and it is why the presets do not have a "and now crop it
 *   yourself" caveat.
 * - **Easing is on the curve, not the clock.** The shaped `t` is what gets
 *   interpolated, so an eased push accelerates the way a motorised head does
 *   rather than stepping between two speeds.
 */

import type { FrameTransform } from './frame-ops'

export type MotionEasing = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out'

export type MotionPresetId =
	| 'zoom-in'
	| 'zoom-out'
	| 'pan-left'
	| 'pan-right'
	| 'pan-up'
	| 'pan-down'
	| 'ken-burns'
	| 'ken-burns-out'
	| 'push-diagonal'
	| 'whip-pan'
	| 'spin-in'
	| 'rotate-slow'
	| 'bounce-in'
	| 'pulse'
	| 'shake'
	| 'handheld'
	| 'sway'
	| 'drift'

export type MotionPreset = {
	id: MotionPresetId
	label: string
	blurb: string
	/** true when the move repeats rather than travelling from A to B */
	cyclic: boolean
}

export const MOTION_PRESETS: MotionPreset[] = [
	{ id: 'zoom-in', label: 'Zoom In', blurb: 'A steady push toward the centre of frame.', cyclic: false },
	{ id: 'zoom-out', label: 'Zoom Out', blurb: 'Starts tight and pulls back to the full frame.', cyclic: false },
	{ id: 'pan-left', label: 'Pan Left', blurb: 'Slides across the frame, right to left.', cyclic: false },
	{ id: 'pan-right', label: 'Pan Right', blurb: 'Slides across the frame, left to right.', cyclic: false },
	{ id: 'pan-up', label: 'Pan Up', blurb: 'Tilts up the frame.', cyclic: false },
	{ id: 'pan-down', label: 'Pan Down', blurb: 'Tilts down the frame.', cyclic: false },
	{ id: 'ken-burns', label: 'Ken Burns (in)', blurb: 'The documentary move: a push with a slow diagonal drift.', cyclic: false },
	{ id: 'ken-burns-out', label: 'Ken Burns (out)', blurb: 'The same drift, pulling back instead of pushing in.', cyclic: false },
	{ id: 'push-diagonal', label: 'Diagonal Push', blurb: 'Pushes in toward the top-right of frame.', cyclic: false },
	{ id: 'whip-pan', label: 'Whip Pan', blurb: 'A hard, fast slide that settles at the end - good under a cut.', cyclic: false },
	{ id: 'spin-in', label: 'Spin In', blurb: 'Rotates and scales down onto the shot.', cyclic: false },
	{ id: 'rotate-slow', label: 'Slow Rotate', blurb: 'A continuous, barely-there turn.', cyclic: false },
	{ id: 'bounce-in', label: 'Bounce In', blurb: 'Overshoots the framing and springs back.', cyclic: false },
	{ id: 'pulse', label: 'Pulse', blurb: 'Breathes in and out on a loop - good under music.', cyclic: true },
	{ id: 'shake', label: 'Shake', blurb: 'Sharp jitter, the impact kind.', cyclic: true },
	{ id: 'handheld', label: 'Handheld', blurb: 'A slow wander with a little roll, like an operator breathing.', cyclic: true },
	{ id: 'sway', label: 'Sway', blurb: 'A wide, slow side-to-side.', cyclic: true },
	{ id: 'drift', label: 'Drift', blurb: 'A lazy figure-of-eight that never quite repeats.', cyclic: true },
]

export function motionPresetById(id: string): MotionPreset | null {
	return MOTION_PRESETS.find((preset) => preset.id === id) ?? null
}

export type MotionOptions = {
	preset: MotionPresetId
	/** 0-1: how much of the preset's full travel to use */
	amount: number
	easing: MotionEasing
	/** how long the whole move takes; a cyclic preset uses it as its period */
	durationSeconds: number
	fps: number
	/** reverses the direction of a one-way move */
	reverse: boolean
}

function ease(t: number, easing: MotionEasing): number {
	const x = Math.min(1, Math.max(0, t))
	switch (easing) {
		case 'ease-in':
			return x * x
		case 'ease-out':
			return 1 - (1 - x) * (1 - x)
		case 'ease-in-out':
			return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2
		default:
			return x
	}
}

/**
 * The zoom a given slide needs so its own edges never enter the frame.
 *
 * An offset is a fraction of the frame, applied about the centre, so the
 * picture must be at least `1 + 2 * offset` across for the far edge to still
 * cover. A rotation needs the diagonal instead - the corners are what swing
 * outside - which is why the rotation term uses `|sin| + |cos|`.
 */
function coverScale(offsetX: number, offsetY: number, rotateDeg: number): number {
	const slide = 1 + 2 * Math.max(Math.abs(offsetX), Math.abs(offsetY))
	if (!rotateDeg) return slide
	const radians = (Math.abs(rotateDeg) * Math.PI) / 180
	return slide * (Math.abs(Math.sin(radians)) + Math.abs(Math.cos(radians)))
}

const IDENTITY: FrameTransform = { scale: 1, rotateDeg: 0, offsetX: 0, offsetY: 0 }

/**
 * Builds the "what does frame N look like" function for a preset.
 *
 * Returned rather than applied so the same plan can drive a render, a still
 * preview and a test without any of them re-deriving the maths.
 */
export function createMotionPlan(options: MotionOptions): (frameIndex: number) => FrameTransform {
	const amount = Math.min(1, Math.max(0, options.amount))
	const fps = Math.max(1, options.fps)
	const totalFrames = Math.max(1, Math.round(options.durationSeconds * fps))
	const preset = options.preset

	return (frameIndex: number): FrameTransform => {
		const raw = Math.min(1, Math.max(0, frameIndex / Math.max(1, totalFrames - 1)))
		const progress = options.reverse ? 1 - raw : raw
		const t = ease(progress, options.easing)
		const seconds = frameIndex / fps
		// Cyclic moves are measured against the duration as a period, so the
		// "speed" of a wobble is set by the same slider that sets the length of
		// a push - one mental model, not two.
		const cycle = (seconds / Math.max(0.001, options.durationSeconds)) * Math.PI * 2

		switch (preset) {
			case 'zoom-in':
				return { ...IDENTITY, scale: 1 + amount * 0.45 * t }
			case 'zoom-out':
				return { ...IDENTITY, scale: 1 + amount * 0.45 * (1 - t) }
			case 'pan-left':
			case 'pan-right':
			case 'pan-up':
			case 'pan-down': {
				const travel = amount * 0.18
				const direction = preset === 'pan-left' || preset === 'pan-up' ? -1 : 1
				const vertical = preset === 'pan-up' || preset === 'pan-down'
				const shift = (t - 0.5) * 2 * travel * direction
				return {
					scale: coverScale(vertical ? 0 : travel, vertical ? travel : 0, 0),
					rotateDeg: 0,
					offsetX: vertical ? 0 : shift,
					offsetY: vertical ? shift : 0,
				}
			}
			case 'ken-burns':
			case 'ken-burns-out': {
				const travel = amount * 0.08
				const zoom = 1 + amount * 0.35 * (preset === 'ken-burns' ? t : 1 - t)
				return {
					scale: Math.max(zoom, coverScale(travel, travel, 0)),
					rotateDeg: 0,
					offsetX: (t - 0.5) * 2 * travel,
					offsetY: (0.5 - t) * 2 * travel * 0.6,
				}
			}
			case 'push-diagonal': {
				const travel = amount * 0.09
				return {
					scale: Math.max(1 + amount * 0.4 * t, coverScale(travel, travel, 0)),
					rotateDeg: 0,
					offsetX: -t * travel,
					offsetY: t * travel,
				}
			}
			case 'whip-pan': {
				// A whip is nearly all of its travel in the first fifth of the
				// move; the quintic settle is what makes the end read as "landed"
				// rather than "stopped".
				const settle = 1 - Math.pow(1 - t, 5)
				const travel = amount * 0.32
				return {
					scale: coverScale(travel, 0, 0),
					rotateDeg: 0,
					offsetX: (settle - 0.5) * 2 * travel,
					offsetY: 0,
				}
			}
			case 'spin-in': {
				const turn = (1 - t) * amount * 22
				return {
					scale: Math.max(1 + (1 - t) * amount * 0.5, coverScale(0, 0, turn)),
					rotateDeg: turn,
					offsetX: 0,
					offsetY: 0,
				}
			}
			case 'rotate-slow': {
				const turn = (t - 0.5) * 2 * amount * 6
				return { scale: coverScale(0, 0, amount * 6), rotateDeg: turn, offsetX: 0, offsetY: 0 }
			}
			case 'bounce-in': {
				// A damped spring, rectified. The absolute value matters: an
				// un-rectified spring dips below its target on the way back, and a
				// scale below 1 is a black edge round the frame - so the bounce is
				// always *outward*, oscillating above the framing and settling onto
				// it rather than crossing it.
				const spring = Math.abs(Math.exp(-6 * t) * Math.cos(t * Math.PI * 2.6))
				return { ...IDENTITY, scale: 1 + amount * 0.3 * spring }
			}
			case 'pulse':
				return { ...IDENTITY, scale: 1 + amount * 0.08 * (0.5 + 0.5 * Math.sin(cycle)) }
			case 'shake': {
				const jitter = amount * 0.02
				return {
					scale: coverScale(jitter, jitter, amount * 1.5),
					rotateDeg: Math.sin(cycle * 11.3) * amount * 1.5,
					offsetX: (Math.sin(cycle * 13.1) * 0.6 + Math.sin(cycle * 27.7) * 0.4) * jitter,
					offsetY: (Math.cos(cycle * 17.3) * 0.6 + Math.cos(cycle * 31.1) * 0.4) * jitter,
				}
			}
			case 'handheld': {
				const wander = amount * 0.012
				return {
					scale: coverScale(wander, wander, amount * 0.9),
					rotateDeg: Math.sin(cycle * 0.7) * amount * 0.9,
					offsetX: (Math.sin(cycle * 1.1) * 0.7 + Math.sin(cycle * 2.7) * 0.3) * wander,
					offsetY: (Math.cos(cycle * 0.9) * 0.7 + Math.cos(cycle * 3.1) * 0.3) * wander,
				}
			}
			case 'sway': {
				const travel = amount * 0.05
				return {
					scale: coverScale(travel, 0, 0),
					rotateDeg: 0,
					offsetX: Math.sin(cycle) * travel,
					offsetY: 0,
				}
			}
			case 'drift': {
				// Two frequencies at a 2:1 ratio trace a lissajous figure-of-eight;
				// the slight detune keeps it from closing on itself.
				const travel = amount * 0.04
				return {
					scale: coverScale(travel, travel, 0),
					rotateDeg: 0,
					offsetX: Math.sin(cycle) * travel,
					offsetY: Math.sin(cycle * 2.03) * travel * 0.6,
				}
			}
			default:
				return IDENTITY
		}
	}
}
