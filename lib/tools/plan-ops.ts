/**
 * Trim, speed change and loop, expressed as `CutPlan`s.
 *
 * The silence cutter already owns a piecewise-linear source-to-output time
 * map, a frame-accurate renderer that walks it, and an audio writer that
 * never drifts across a splice - `lib/silence/plan.ts` and
 * `lib/silence/render.ts`. A trim is a plan with one kept segment; a uniform
 * speed change is a plan with one sped segment; a loop is the same segment
 * repeated with a different output offset each time. None of that needs a
 * second renderer - it needs three small functions that build the plan the
 * existing one already knows how to execute, so the export path a trim takes
 * is exactly as tested as the one a silence cut takes.
 *
 * What this *cannot* express: anything where source time would have to run
 * backwards. `outputToSource` is a non-decreasing function of output time by
 * construction, which is what lets the renderer decode every packet once
 * instead of seeking - so reverse playback is a different tool, not a plan.
 */

import type { CutPlan, PlanSegment } from '../silence/plan'

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value))
}

/** Keeps `[startMs, endMs)` of the clip and drops everything outside it. */
export function trimPlan(durationMs: number, startMs: number, endMs: number): CutPlan {
	const start = clamp(Math.min(startMs, endMs), 0, durationMs)
	const end = clamp(Math.max(startMs, endMs), 0, durationMs)
	const kept = Math.max(0, end - start)

	const segments: PlanSegment[] = []
	if (start > 0) {
		segments.push(dropSegment('head', 0, start))
	}
	if (kept > 0) {
		segments.push({
			id: 'kept',
			kind: 'speech',
			mode: 'keep',
			speed: 1,
			sourceStartMs: start,
			sourceEndMs: end,
			outputStartMs: 0,
			outputEndMs: kept,
			gapKey: null,
		})
	}
	if (end < durationMs) {
		segments.push(dropSegment('tail', end, durationMs))
	}

	return {
		segments,
		sourceDurationMs: durationMs,
		outputDurationMs: kept,
		droppedMs: durationMs - kept,
		spedSourceMs: 0,
		savedMs: durationMs - kept,
		cuts: (start > 0 ? 1 : 0) + (end < durationMs ? 1 : 0),
		silenceCount: 0,
		silenceMs: 0,
		speechMs: kept,
	}
}

function dropSegment(id: string, startMs: number, endMs: number): PlanSegment {
	return {
		id,
		kind: 'silence',
		mode: 'drop',
		speed: Infinity,
		sourceStartMs: startMs,
		sourceEndMs: endMs,
		outputStartMs: 0,
		outputEndMs: 0,
		gapKey: null,
	}
}

/** Runs the whole clip at a uniform playback rate. Nothing is dropped. */
export function speedPlan(durationMs: number, factor: number): CutPlan {
	const speed = clamp(factor, 0.1, 16)
	const outputDurationMs = durationMs / speed
	return {
		segments:
			durationMs > 0
				? [
						{
							id: 'speed',
							kind: 'speech',
							mode: speed === 1 ? 'keep' : 'speed',
							speed,
							sourceStartMs: 0,
							sourceEndMs: durationMs,
							outputStartMs: 0,
							outputEndMs: outputDurationMs,
							gapKey: null,
						},
					]
				: [],
		sourceDurationMs: durationMs,
		outputDurationMs,
		droppedMs: 0,
		spedSourceMs: speed === 1 ? 0 : durationMs,
		savedMs: durationMs - outputDurationMs,
		cuts: 0,
		silenceCount: 0,
		silenceMs: 0,
		speechMs: durationMs,
	}
}

/** Repeats the whole clip `times` in a row, back to back. */
export function loopPlan(durationMs: number, times: number): CutPlan {
	const count = Math.max(1, Math.round(times))
	const segments: PlanSegment[] = []
	for (let i = 0; i < count; i++) {
		segments.push({
			id: `loop-${i}`,
			kind: 'speech',
			mode: 'keep',
			speed: 1,
			sourceStartMs: 0,
			sourceEndMs: durationMs,
			outputStartMs: i * durationMs,
			outputEndMs: (i + 1) * durationMs,
			gapKey: null,
		})
	}
	return {
		segments,
		sourceDurationMs: durationMs,
		outputDurationMs: durationMs * count,
		droppedMs: 0,
		spedSourceMs: 0,
		savedMs: durationMs - durationMs * count,
		cuts: Math.max(0, count - 1),
		silenceCount: 0,
		silenceMs: 0,
		speechMs: durationMs * count,
	}
}

/**
 * Holds one moment of the clip for `holdMs`, then continues.
 *
 * Rather than a literal zero-width source range (`speed: 0`), the held
 * moment is expressed as the thinnest real slice the frame rate can produce -
 * one frame's worth of source - stretched across the hold. That keeps the
 * hold inside the same "speed is a positive multiplier" arithmetic the
 * renderer already trusts everywhere else, at the cost of a single
 * imperceptible frame of motion at the very edge of the freeze rather than a
 * mathematically perfect - but untested - divide-by-zero path through it.
 */
export function freezeFramePlan(durationMs: number, atMs: number, holdMs: number, fps: number): CutPlan {
	const at = clamp(atMs, 0, durationMs)
	const frameMs = Math.max(1, 1000 / Math.max(1, fps))
	const freezeEnd = Math.min(durationMs, at + frameMs)
	const hold = Math.max(1, holdMs)
	const freezeSpeed = (freezeEnd - at) / hold

	const segments: PlanSegment[] = []
	let outputMs = 0
	if (at > 0) {
		segments.push({ id: 'pre', kind: 'speech', mode: 'keep', speed: 1, sourceStartMs: 0, sourceEndMs: at, outputStartMs: 0, outputEndMs: at, gapKey: null })
		outputMs = at
	}
	segments.push({
		id: 'freeze',
		kind: 'speech',
		mode: 'speed',
		speed: freezeSpeed,
		sourceStartMs: at,
		sourceEndMs: freezeEnd,
		outputStartMs: outputMs,
		outputEndMs: outputMs + hold,
		gapKey: null,
	})
	outputMs += hold
	if (freezeEnd < durationMs) {
		const tailOutput = outputMs + (durationMs - freezeEnd)
		segments.push({ id: 'post', kind: 'speech', mode: 'keep', speed: 1, sourceStartMs: freezeEnd, sourceEndMs: durationMs, outputStartMs: outputMs, outputEndMs: tailOutput, gapKey: null })
		outputMs = tailOutput
	}

	return {
		segments,
		sourceDurationMs: durationMs,
		outputDurationMs: outputMs,
		droppedMs: 0,
		spedSourceMs: freezeEnd - at,
		savedMs: durationMs - outputMs,
		cuts: 2,
		silenceCount: 0,
		silenceMs: 0,
		speechMs: outputMs,
	}
}

export type RampPoint = { t: number; factor: number }

/**
 * A smooth speed curve instead of one flat rate: `points` are (fraction of
 * the clip, speed factor) pairs, and the clip is sliced into many small,
 * equal *source*-time steps, each running at the factor linearly
 * interpolated between the two points it falls between. More steps makes the
 * ramp smoother at the cost of more (tiny, cheap) segments.
 */
export function speedRampPlan(durationMs: number, points: RampPoint[], steps = 40): CutPlan {
	if (durationMs <= 0 || points.length === 0) return speedPlan(durationMs, 1)
	const sorted = [...points].sort((a, b) => a.t - b.t)

	const factorAt = (t: number): number => {
		if (t <= sorted[0].t) return sorted[0].factor
		if (t >= sorted[sorted.length - 1].t) return sorted[sorted.length - 1].factor
		for (let i = 0; i < sorted.length - 1; i++) {
			const a = sorted[i]
			const b = sorted[i + 1]
			if (t >= a.t && t <= b.t) {
				const span = b.t - a.t
				const local = span > 0 ? (t - a.t) / span : 0
				return a.factor + (b.factor - a.factor) * local
			}
		}
		return 1
	}

	const sliceLen = durationMs / steps
	const segments: PlanSegment[] = []
	let outputMs = 0
	let spedSourceMs = 0
	for (let i = 0; i < steps; i++) {
		const sourceStart = i * sliceLen
		const sourceEnd = Math.min(durationMs, (i + 1) * sliceLen)
		const midT = (sourceStart + sliceLen / 2) / durationMs
		const speed = clamp(factorAt(midT), 0.1, 16)
		const outputLen = (sourceEnd - sourceStart) / speed
		segments.push({
			id: `ramp-${i}`,
			kind: 'speech',
			mode: speed === 1 ? 'keep' : 'speed',
			speed,
			sourceStartMs: sourceStart,
			sourceEndMs: sourceEnd,
			outputStartMs: outputMs,
			outputEndMs: outputMs + outputLen,
			gapKey: null,
		})
		outputMs += outputLen
		if (speed !== 1) spedSourceMs += sourceEnd - sourceStart
	}

	return {
		segments,
		sourceDurationMs: durationMs,
		outputDurationMs: outputMs,
		droppedMs: 0,
		spedSourceMs,
		savedMs: durationMs - outputMs,
		cuts: 0,
		silenceCount: 0,
		silenceMs: 0,
		speechMs: outputMs,
	}
}

export { renderCutVideo, cutFileName, RenderCancelled } from '../silence/render'
export type { RenderProgress, RenderFormat, RenderQuality, SilenceRenderResult } from '../silence/render'
export type { CutPlan } from '../silence/plan'
