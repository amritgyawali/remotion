/**
 * The cut plan: what happens to every millisecond of the clip, and where it
 * lands in the finished file.
 *
 * A silence cutter is, underneath, one piece of arithmetic - a piecewise-linear
 * map from source time to output time - and everything else in the studio is a
 * view of it. The preview scrubs it, the waveform draws it, the exporter walks
 * it frame by frame, and the subtitle hand-off pushes caption timings through
 * it. Keeping that map in one pure module means all four agree by construction
 * rather than by luck.
 *
 * The map is built from three inputs:
 *
 *   1. where speech is, measured by the detector in `captions/vad.ts`;
 *   2. how the person wants silence handled - dropped, or run fast;
 *   3. any per-gap decisions they made by hand, which always win.
 *
 * Nothing here touches the DOM, the network or a decoder, so the same functions
 * run in the tab, in a worker and in a test.
 */

import { mergeSegments, type SpeechSegment } from '../captions/vad'
import type { CaptionCue, CaptionToken } from '../captions/types'

/** What a stretch of silence is worth keeping. */
export type SilenceAction = 'remove' | 'speed' | 'keep'

export type SegmentMode = 'keep' | 'speed' | 'drop'

export type CutSettings = {
	/**
	 * How far above the measured noise floor a frame must sit to count as
	 * speech. Higher is more aggressive: more of the clip is called silence.
	 */
	sensitivityDb: number
	/** a gap briefer than this is a breath inside a sentence, not a pause */
	minSilenceMs: number
	/** speech held on each side of every cut, so no word is ever clipped */
	paddingMs: number
	/** a blip briefer than this is a click or a chair, not a word */
	minSpeechMs: number
	/** the default treatment for a detected silence */
	action: Exclude<SilenceAction, 'keep'>
	/** playback rate applied to silence when `action` is `speed` */
	speed: number
	/**
	 * A removed pause still leaves this much of a beat behind - split evenly
	 * across the two sides of the cut. Zero is a hard splice; 120 ms or so is
	 * what keeps an edit sounding like speech instead of a machine gun.
	 */
	keepBeatMs: number
}

export const DEFAULT_CUT_SETTINGS: CutSettings = {
	sensitivityDb: 4,
	minSilenceMs: 500,
	paddingMs: 90,
	minSpeechMs: 140,
	action: 'remove',
	speed: 3,
	keepBeatMs: 120,
}

export const SPEED_CHOICES = [1.5, 2, 3, 4, 6, 8] as const

/**
 * Four starting points, because "what should the minimum pause be" is not a
 * question anyone can answer before they have seen the first cut.
 *
 * They differ mostly in nerve. A lecture wants its pauses shortened, not
 * deleted; a screen recording of somebody typing wants the typing at 6x; a
 * social edit wants every gap gone and will accept the odd clipped breath.
 */
export const CUT_PRESETS: Array<{
	id: string
	label: string
	note: string
	settings: CutSettings
}> = [
	{
		id: 'talking',
		label: 'Talking head',
		note: 'Trims the long pauses and leaves the short ones. The safe default.',
		settings: { ...DEFAULT_CUT_SETTINGS },
	},
	{
		id: 'podcast',
		label: 'Gentle',
		note: 'Only genuinely long silences go, and each cut keeps a beat of room tone.',
		settings: {
			sensitivityDb: 3,
			minSilenceMs: 900,
			paddingMs: 140,
			minSpeechMs: 180,
			action: 'remove',
			speed: 3,
			keepBeatMs: 220,
		},
	},
	{
		id: 'fast',
		label: 'Fast-forward',
		note: 'Nothing is deleted - the quiet stretches simply run at 3x.',
		settings: {
			sensitivityDb: 4,
			minSilenceMs: 400,
			paddingMs: 90,
			minSpeechMs: 140,
			action: 'speed',
			speed: 3,
			keepBeatMs: 0,
		},
	},
	{
		id: 'tight',
		label: 'Aggressive',
		note: 'Every pause over a third of a second goes. Check the preview for clipped words.',
		settings: {
			sensitivityDb: 6,
			minSilenceMs: 320,
			paddingMs: 55,
			minSpeechMs: 100,
			action: 'remove',
			speed: 4,
			keepBeatMs: 45,
		},
	},
]

export type PlanSegment = {
	id: string
	kind: 'speech' | 'silence'
	mode: SegmentMode
	/** playback rate; 1 unless the stretch is being run fast */
	speed: number
	sourceStartMs: number
	sourceEndMs: number
	/** where this lands in the finished file; equal values mean it was dropped */
	outputStartMs: number
	outputEndMs: number
	/** the detected gap this came from, so a hand decision can find it again */
	gapKey: number | null
}

export type CutPlan = {
	segments: PlanSegment[]
	sourceDurationMs: number
	outputDurationMs: number
	/** source time that never reaches the output at all */
	droppedMs: number
	/** source time that reaches the output, but compressed */
	spedSourceMs: number
	/** wall-clock the viewer is spared, dropped and sped together */
	savedMs: number
	/** how many splices the edit makes */
	cuts: number
	silenceCount: number
	silenceMs: number
	speechMs: number
}

/** Per-gap decisions, keyed by the gap's rounded source start in ms. */
export type GapOverrides = Record<string, SilenceAction>

/** How far a stored decision may drift and still be recognised, in ms. */
const OVERRIDE_TOLERANCE_MS = 400

export const EMPTY_PLAN: CutPlan = {
	segments: [],
	sourceDurationMs: 0,
	outputDurationMs: 0,
	droppedMs: 0,
	spedSourceMs: 0,
	savedMs: 0,
	cuts: 0,
	silenceCount: 0,
	silenceMs: 0,
	speechMs: 0,
}

function clampSpeed(value: number): number {
	if (!Number.isFinite(value)) return 1
	return Math.min(16, Math.max(1, value))
}

/**
 * Widens every speech island by the padding, then merges what now overlaps.
 *
 * Padding is applied here rather than inside the detector on purpose: it is the
 * one setting a person reaches for constantly ("that cut clipped my S"), and
 * doing it in the plan means the answer is instant instead of another decode.
 */
function padSpeech(speech: SpeechSegment[], paddingMs: number, durationMs: number): SpeechSegment[] {
	if (speech.length === 0) return []
	const widened = speech.map((segment) => ({
		startMs: Math.max(0, segment.startMs - paddingMs),
		endMs: Math.min(durationMs, segment.endMs + paddingMs),
	}))
	return mergeSegments(widened, 0).filter((segment) => segment.endMs > segment.startMs)
}

/**
 * Finds the decision a person made for a gap, allowing for the gap having moved
 * a little since they made it.
 *
 * Re-tuning the detector nudges every boundary by a few frames. Matching on an
 * exact key would silently throw away every hand decision the moment a slider
 * moved, which is precisely when someone is most annoyed to lose them.
 */
function overrideFor(overrides: GapOverrides, startMs: number): SilenceAction | null {
	const exact = overrides[String(Math.round(startMs))]
	if (exact) return exact

	let best: SilenceAction | null = null
	let bestDistance = OVERRIDE_TOLERANCE_MS
	for (const [key, action] of Object.entries(overrides)) {
		const distance = Math.abs(Number(key) - startMs)
		if (distance <= bestDistance) {
			best = action
			bestDistance = distance
		}
	}
	return best
}

/**
 * Builds the source-to-output map.
 *
 * Speech is always kept at speed 1 - a silence cutter that quietly speeds up
 * the talking is a different tool, and a surprising one. Only the gaps between
 * are touched.
 */
export function buildPlan(args: {
	speech: SpeechSegment[]
	durationMs: number
	settings: CutSettings
	overrides?: GapOverrides
}): CutPlan {
	const { durationMs } = args
	const settings = args.settings
	const overrides = args.overrides ?? {}
	if (durationMs <= 0) return EMPTY_PLAN

	const speech = padSpeech(args.speech, settings.paddingMs, durationMs).filter(
		(segment) => segment.endMs - segment.startMs >= settings.minSpeechMs,
	)

	// Walk the clip start to finish, alternating gap / speech / gap.
	const rough: Array<{ kind: 'speech' | 'silence'; startMs: number; endMs: number }> = []
	let cursor = 0
	for (const segment of speech) {
		if (segment.startMs > cursor) {
			rough.push({ kind: 'silence', startMs: cursor, endMs: segment.startMs })
		}
		rough.push({ kind: 'speech', startMs: Math.max(cursor, segment.startMs), endMs: segment.endMs })
		cursor = Math.max(cursor, segment.endMs)
	}
	if (durationMs > cursor) rough.push({ kind: 'silence', startMs: cursor, endMs: durationMs })

	// A gap under the threshold is not a pause worth cutting; folding it into
	// the speech around it here keeps the exporter from splicing on a breath.
	const shaped: typeof rough = []
	for (const part of rough) {
		const length = part.endMs - part.startMs
		const treatAsSpeech = part.kind === 'speech' || length < settings.minSilenceMs
		const previous = shaped[shaped.length - 1]
		if (treatAsSpeech && previous && previous.kind === 'speech') {
			previous.endMs = part.endMs
			continue
		}
		shaped.push({ kind: treatAsSpeech ? 'speech' : 'silence', startMs: part.startMs, endMs: part.endMs })
	}

	const segments: PlanSegment[] = []
	let outputMs = 0
	let droppedMs = 0
	let spedSourceMs = 0
	let silenceCount = 0
	let silenceMs = 0
	let speechMs = 0
	let cuts = 0

	const push = (
		kind: 'speech' | 'silence',
		mode: SegmentMode,
		speed: number,
		startMs: number,
		endMs: number,
		gapKey: number | null,
	) => {
		if (endMs <= startMs) return
		const sourceLength = endMs - startMs
		const outputLength = mode === 'drop' ? 0 : sourceLength / speed
		segments.push({
			id: `${kind}-${Math.round(startMs)}-${Math.round(endMs)}`,
			kind,
			mode,
			speed: mode === 'drop' ? Infinity : speed,
			sourceStartMs: startMs,
			sourceEndMs: endMs,
			outputStartMs: outputMs,
			outputEndMs: outputMs + outputLength,
			gapKey,
		})
		outputMs += outputLength
		if (mode === 'drop') droppedMs += sourceLength
		if (mode === 'speed') spedSourceMs += sourceLength
	}

	for (const part of shaped) {
		const length = part.endMs - part.startMs
		if (part.kind === 'speech') {
			speechMs += length
			push('speech', 'keep', 1, part.startMs, part.endMs, null)
			continue
		}

		silenceCount += 1
		silenceMs += length
		const gapKey = Math.round(part.startMs)
		const action = overrideFor(overrides, part.startMs) ?? settings.action

		if (action === 'keep') {
			push('silence', 'keep', 1, part.startMs, part.endMs, gapKey)
			continue
		}

		if (action === 'speed') {
			cuts += 1
			push('silence', 'speed', clampSpeed(settings.speed), part.startMs, part.endMs, gapKey)
			continue
		}

		// Removal, with a beat left on each side so the splice still breathes.
		const beat = Math.max(0, Math.min(settings.keepBeatMs, length))
		if (beat >= length) {
			push('silence', 'keep', 1, part.startMs, part.endMs, gapKey)
			continue
		}
		cuts += 1
		const head = part.startMs + beat / 2
		const tail = part.endMs - beat / 2
		push('silence', 'keep', 1, part.startMs, head, gapKey)
		push('silence', 'drop', 1, head, tail, gapKey)
		push('silence', 'keep', 1, tail, part.endMs, gapKey)
	}

	return {
		segments,
		sourceDurationMs: durationMs,
		outputDurationMs: outputMs,
		droppedMs,
		spedSourceMs,
		savedMs: Math.max(0, durationMs - outputMs),
		cuts,
		silenceCount,
		silenceMs,
		speechMs,
	}
}

/* ------------------------------------------------------------- the map */

/** The segment covering an output timestamp, found by bisection. */
function segmentAtOutput(plan: CutPlan, outputMs: number): PlanSegment | null {
	const segments = plan.segments
	if (segments.length === 0) return null

	let low = 0
	let high = segments.length - 1
	let found: PlanSegment | null = null
	while (low <= high) {
		const middle = (low + high) >> 1
		const segment = segments[middle]
		if (outputMs < segment.outputStartMs) {
			high = middle - 1
			continue
		}
		if (outputMs >= segment.outputEndMs) {
			// Dropped segments are zero-length in the output; walking right past
			// them is what keeps a lookup landing on the next real frame.
			low = middle + 1
			continue
		}
		found = segment
		break
	}
	if (found) return found
	return outputMs <= 0 ? segments[0] : segments[segments.length - 1]
}

function segmentAtSource(plan: CutPlan, sourceMs: number): PlanSegment | null {
	const segments = plan.segments
	if (segments.length === 0) return null

	let low = 0
	let high = segments.length - 1
	while (low <= high) {
		const middle = (low + high) >> 1
		const segment = segments[middle]
		if (sourceMs < segment.sourceStartMs) {
			high = middle - 1
			continue
		}
		if (sourceMs >= segment.sourceEndMs) {
			low = middle + 1
			continue
		}
		return segment
	}
	return sourceMs <= 0 ? segments[0] : segments[segments.length - 1]
}

export type SourceLookup = {
	sourceMs: number
	/** the rate the source must run at to fill the output here */
	speed: number
	segment: PlanSegment | null
}

/** Where in the original file an output timestamp comes from. */
export function outputToSource(plan: CutPlan, outputMs: number): SourceLookup {
	const clamped = Math.max(0, Math.min(plan.outputDurationMs, outputMs))
	const segment = segmentAtOutput(plan, clamped)
	if (!segment) return { sourceMs: clamped, speed: 1, segment: null }
	if (segment.mode === 'drop') {
		return { sourceMs: segment.sourceEndMs, speed: 1, segment }
	}
	const into = clamped - segment.outputStartMs
	return {
		sourceMs: segment.sourceStartMs + into * segment.speed,
		speed: segment.speed,
		segment,
	}
}

export type OutputLookup = {
	outputMs: number
	/** true when this instant of the source never reaches the output */
	dropped: boolean
	segment: PlanSegment | null
}

/** Where a moment of the original file ends up - or that it does not. */
export function sourceToOutput(plan: CutPlan, sourceMs: number): OutputLookup {
	const clamped = Math.max(0, Math.min(plan.sourceDurationMs, sourceMs))
	const segment = segmentAtSource(plan, clamped)
	if (!segment) return { outputMs: clamped, dropped: false, segment: null }
	if (segment.mode === 'drop') {
		return { outputMs: segment.outputStartMs, dropped: true, segment }
	}
	const into = clamped - segment.sourceStartMs
	return {
		outputMs: segment.outputStartMs + into / segment.speed,
		dropped: false,
		segment,
	}
}

/**
 * The next source position that survives the edit, at or after `sourceMs`.
 *
 * This is what the live preview jumps to: a plain `<video>` playing the
 * original has no idea a stretch was cut, so the loop watches the clock and
 * seeks it over the hole.
 */
export function nextKeptSource(plan: CutPlan, sourceMs: number): number | null {
	for (const segment of plan.segments) {
		if (segment.mode === 'drop') continue
		if (segment.sourceEndMs <= sourceMs) continue
		return Math.max(sourceMs, segment.sourceStartMs)
	}
	return null
}

/* ------------------------------------------------- captions through a cut */

function remapToken(token: CaptionToken, plan: CutPlan): CaptionToken | null {
	const from = sourceToOutput(plan, token.fromMs)
	const to = sourceToOutput(plan, token.toMs)
	if (to.outputMs <= from.outputMs) return null
	return { text: token.text, fromMs: from.outputMs, toMs: to.outputMs }
}

/**
 * Pushes an existing transcript through the edit.
 *
 * A caption whose whole span was cut away is dropped; one that straddles a cut
 * is squeezed onto what is left. Word timings travel too, so a karaoke-style
 * caption still lights up the right word after the edit.
 */
export function remapCues(cues: CaptionCue[], plan: CutPlan): CaptionCue[] {
	if (plan.segments.length === 0) return cues
	const out: CaptionCue[] = []

	for (const cue of cues) {
		const start = sourceToOutput(plan, cue.startMs)
		const end = sourceToOutput(plan, cue.endMs)
		const startMs = start.outputMs
		const endMs = end.outputMs
		// Entirely inside a hole: there is no longer a moment to show it at.
		if (endMs - startMs < 1) continue

		const tokens = cue.tokens
			.map((token) => remapToken(token, plan))
			.filter((token): token is CaptionToken => token !== null)

		out.push({ id: cue.id, text: cue.text, startMs, endMs, tokens })
	}

	return out
}

/* ------------------------------------------------------------- reporting */

/** mm:ss.d - the format an editor reads without decoding it. */
export function formatTimecode(ms: number): string {
	if (!Number.isFinite(ms) || ms < 0) return '0:00.0'
	const total = ms / 1000
	const minutes = Math.floor(total / 60)
	const seconds = total - minutes * 60
	return `${minutes}:${seconds.toFixed(1).padStart(4, '0')}`
}

/** "3m 12s" - for durations, where tenths are noise. */
export function formatSpan(ms: number): string {
	const seconds = Math.max(0, ms) / 1000
	if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`
	const minutes = Math.floor(seconds / 60)
	return `${minutes}m ${String(Math.round(seconds % 60)).padStart(2, '0')}s`
}

export function planIsEdit(plan: CutPlan): boolean {
	return plan.cuts > 0 && plan.savedMs > 250
}

/** The silences a person can click, with their current treatment. */
export type GapSummary = {
	key: number
	startMs: number
	endMs: number
	lengthMs: number
	action: SilenceAction
}

export function gapsOf(plan: CutPlan): GapSummary[] {
	const byKey = new Map<number, GapSummary>()
	for (const segment of plan.segments) {
		if (segment.kind !== 'silence' || segment.gapKey === null) continue
		const existing = byKey.get(segment.gapKey)
		const action: SilenceAction =
			segment.mode === 'drop' ? 'remove' : segment.mode === 'speed' ? 'speed' : 'keep'
		if (!existing) {
			byKey.set(segment.gapKey, {
				key: segment.gapKey,
				startMs: segment.sourceStartMs,
				endMs: segment.sourceEndMs,
				lengthMs: segment.sourceEndMs - segment.sourceStartMs,
				action,
			})
			continue
		}
		existing.endMs = Math.max(existing.endMs, segment.sourceEndMs)
		existing.lengthMs = existing.endMs - existing.startMs
		// A gap split into beat / hole / beat is a removal, whatever its first
		// slice says - the piece that decides is the one that disappears.
		if (action === 'remove') existing.action = 'remove'
	}
	return [...byKey.values()].sort((left, right) => left.startMs - right.startMs)
}
