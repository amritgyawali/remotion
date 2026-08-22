/**
 * Voice activity detection, and the arithmetic that hangs off it.
 *
 * Every timing problem this studio ever had comes back to one thing: a
 * recogniser is asked "what was said" and answers well, then is asked "when"
 * and answers badly - or, for a hosted Whisper function, does not answer at
 * all. When no word timings come back the only honest fallback is to spread the
 * text across the chunk, and text spread evenly across a minute of audio drifts
 * seconds away from the speaker within a few lines.
 *
 * Knowing where speech actually *is* fixes that class of error outright. It is
 * measured, not guessed, and it is measurable in the browser from the same 16
 * kHz mono samples the uploader already has in hand. Words are then laid down
 * on speech and never on silence, a recogniser's own timings are checked
 * against it, and chunk cuts are placed in real pauses instead of in whichever
 * 20 ms frame happened to be quietest.
 *
 * Pure arithmetic over Float32Array: no browser API, no DOM, no network. It
 * runs in the tab, in a worker, in Node and in the check script unchanged.
 */

/** A stretch of the clip that holds speech, in milliseconds from its start. */
export type SpeechSegment = {
	startMs: number
	endMs: number
}

export type VadOptions = {
	sampleRate?: number
	/** analysis frame, in ms; 10 ms is the usual resolution for speech */
	frameMs?: number
	/** dB above the local speech/silence split at which speech is declared */
	onsetDb?: number
	/** dB below that split at which speech is released */
	offsetDb?: number
	/** speech is held this long after the level drops, so a stop consonant survives */
	hangoverMs?: number
	/** anything briefer than this is a click, a breath or a chair, not a word */
	minSpeechMs?: number
	/** a shorter gap than this is a pause inside a phrase, not a break between two */
	minSilenceMs?: number
	/** widen each segment by this much, so onsets and tails are not clipped */
	padMs?: number
	/** absolute floor, dBFS: below this there is nothing to transcribe */
	absoluteFloorDb?: number
	/** window over which the speech/silence split is recomputed */
	floorWindowMs?: number
	/**
	 * How far apart the two classes must sit before a window is believed to hold
	 * both speech and silence. Below this the window is all one thing - unbroken
	 * narration, or a room with nobody in it - and splitting it would invent
	 * pauses in the middle of words.
	 */
	minSeparationDb?: number
}

const DEFAULTS = {
	sampleRate: 16_000,
	frameMs: 10,
	onsetDb: 2.5,
	offsetDb: 2.5,
	hangoverMs: 220,
	minSpeechMs: 120,
	minSilenceMs: 180,
	padMs: 70,
	absoluteFloorDb: -58,
	floorWindowMs: 3_000,
	minSeparationDb: 6,
} satisfies Required<VadOptions>

export type VadResult = {
	segments: SpeechSegment[]
	/** share of the analysed span that holds speech, 0 - 1 */
	speechRatio: number
	/** loudest frame, dBFS - useful for reporting an all-but-silent track */
	peakDb: number
	/** the median speech/silence split across the span, dBFS */
	noiseFloorDb: number
	/** per-frame energy in dBFS, kept so callers can pick a cut point */
	frameDb: Float32Array
	frameMs: number
}

function toDb(value: number): number {
	return 20 * Math.log10(Math.max(value, 1e-9))
}

/** Root-mean-square level of every frame, in dBFS. */
function frameEnergies(samples: Float32Array, frame: number): Float32Array {
	const count = Math.max(1, Math.floor(samples.length / frame))
	const out = new Float32Array(count)
	for (let index = 0; index < count; index++) {
		const from = index * frame
		const to = Math.min(samples.length, from + frame)
		let sum = 0
		for (let cursor = from; cursor < to; cursor++) {
			const value = samples[cursor]
			sum += value * value
		}
		out[index] = toDb(Math.sqrt(sum / Math.max(1, to - from)))
	}
	return out
}

function quantile(values: number[], ratio: number): number {
	if (values.length === 0) return -100
	const sorted = [...values].sort((left, right) => left - right)
	const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * ratio)))
	return sorted[index]
}

/** dBFS is clamped into this range before any histogram is built from it. */
const HISTOGRAM_FLOOR_DB = -100
const HISTOGRAM_BINS = 100

type Split = {
	/** the level that best separates speech from silence, dBFS */
	thresholdDb: number
	/** how far the two class means sit apart, dB - the confidence in the split */
	separationDb: number
}

/**
 * Splits one window of frame levels into speech and silence.
 *
 * This is Otsu's method on a one-dB histogram: it picks the level that leaves
 * the two groups as internally similar and as mutually different as possible,
 * without being told anything about either in advance. That matters because the
 * obvious alternative - "the noise floor is the fifteenth percentile" - is only
 * true of a window that happens to be about fifteen per cent silent. Unbroken
 * narration is barely silent at all, and a percentile floor there lands inside
 * the speech and cuts holes in the middle of words; a long pause is almost
 * entirely silent, and the same percentile lands in the noise and hears
 * breathing as speech.
 */
function splitOf(frameDb: Float32Array, from: number, to: number): Split {
	const counts = new Int32Array(HISTOGRAM_BINS)
	const span = -HISTOGRAM_FLOOR_DB
	const binOf = (value: number) => {
		const clamped = Math.max(HISTOGRAM_FLOOR_DB, Math.min(0, value))
		return Math.min(HISTOGRAM_BINS - 1, Math.floor(((clamped - HISTOGRAM_FLOOR_DB) / span) * HISTOGRAM_BINS))
	}
	const levelOf = (bin: number) => HISTOGRAM_FLOOR_DB + ((bin + 0.5) / HISTOGRAM_BINS) * span

	let total = 0
	for (let index = from; index < to; index++) {
		counts[binOf(frameDb[index])]++
		total++
	}
	if (total === 0) return { thresholdDb: HISTOGRAM_FLOOR_DB, separationDb: 0 }

	let sum = 0
	for (let bin = 0; bin < HISTOGRAM_BINS; bin++) sum += counts[bin] * levelOf(bin)

	let quietWeight = 0
	let quietSum = 0
	let bestScore = -1
	let bestBin = 0
	let bestQuietMean = levelOf(0)
	let bestLoudMean = levelOf(0)

	for (let bin = 0; bin < HISTOGRAM_BINS - 1; bin++) {
		quietWeight += counts[bin]
		quietSum += counts[bin] * levelOf(bin)
		if (quietWeight === 0) continue
		const loudWeight = total - quietWeight
		if (loudWeight === 0) break

		const quietMean = quietSum / quietWeight
		const loudMean = (sum - quietSum) / loudWeight
		const between = quietWeight * loudWeight * (loudMean - quietMean) * (loudMean - quietMean)
		if (between <= bestScore) continue
		bestScore = between
		bestBin = bin
		bestQuietMean = quietMean
		bestLoudMean = loudMean
	}

	return { thresholdDb: levelOf(bestBin), separationDb: bestLoudMean - bestQuietMean }
}

/**
 * The split is not one number for a whole clip. A recording can open in a quiet
 * room and end in a cafe, so it is recomputed per window and interpolated
 * between window centres, which follows a changing room without chasing
 * individual syllables. A window whose two classes are not far enough apart to
 * be two classes is given the absolute floor instead: everything audible in it
 * counts as speech, which is the right answer for unbroken narration and
 * harmless for a room with nobody in it.
 */
function thresholdTrack(
	frameDb: Float32Array,
	framesPerWindow: number,
	minSeparationDb: number,
	absoluteFloorDb: number,
): Float32Array {
	const track = new Float32Array(frameDb.length)
	if (frameDb.length === 0) return track

	const windows = Math.max(1, Math.ceil(frameDb.length / framesPerWindow))
	const centres: number[] = []
	const levels: number[] = []

	for (let window = 0; window < windows; window++) {
		const from = window * framesPerWindow
		const to = Math.min(frameDb.length, from + framesPerWindow)
		const split = splitOf(frameDb, from, to)
		centres.push((from + to) / 2)
		levels.push(split.separationDb >= minSeparationDb ? split.thresholdDb : absoluteFloorDb)
	}

	for (let index = 0; index < frameDb.length; index++) {
		if (centres.length === 1) {
			track[index] = levels[0]
			continue
		}
		// Locate the pair of window centres this frame falls between and blend.
		let right = 0
		while (right < centres.length && centres[right] < index) right++
		if (right === 0) {
			track[index] = levels[0]
			continue
		}
		if (right >= centres.length) {
			track[index] = levels[levels.length - 1]
			continue
		}
		const left = right - 1
		const gap = Math.max(1, centres[right] - centres[left])
		const ratio = (index - centres[left]) / gap
		track[index] = levels[left] * (1 - ratio) + levels[right] * ratio
	}

	return track
}

/**
 * Finds the stretches of `samples` that hold speech.
 *
 * Two thresholds with a hangover, which is what keeps a detector from chopping
 * a word in half: speech starts when the level clears the floor by `onsetDb`
 * and only ends after it has stayed under `offsetDb` for the whole hangover.
 * Short blips are dropped and short gaps are closed afterwards, so what comes
 * out is phrase-shaped rather than syllable-shaped.
 */
export function detectSpeech(samples: Float32Array, options: VadOptions = {}): VadResult {
	const config = { ...DEFAULTS, ...options }
	const frame = Math.max(1, Math.round((config.frameMs / 1000) * config.sampleRate))
	const frameMs = (frame / config.sampleRate) * 1000
	const frameDb = frameEnergies(samples, frame)
	const totalMs = (samples.length / config.sampleRate) * 1000

	if (frameDb.length === 0) {
		return { segments: [], speechRatio: 0, peakDb: -100, noiseFloorDb: -100, frameDb, frameMs }
	}

	const split = thresholdTrack(
		frameDb,
		Math.max(1, Math.round(config.floorWindowMs / Math.max(1, frameMs))),
		config.minSeparationDb,
		config.absoluteFloorDb,
	)

	let peakDb = -Infinity
	for (let index = 0; index < frameDb.length; index++) peakDb = Math.max(peakDb, frameDb[index])

	const hangoverFrames = Math.max(1, Math.round(config.hangoverMs / Math.max(1, frameMs)))
	const raw: SpeechSegment[] = []
	let speaking = false
	let openedAt = 0
	let quietFor = 0

	for (let index = 0; index < frameDb.length; index++) {
		const onset = Math.max(split[index] + config.onsetDb, config.absoluteFloorDb)
		const offset = Math.max(split[index] - config.offsetDb, config.absoluteFloorDb - 6)
		const level = frameDb[index]

		if (!speaking) {
			if (level >= onset) {
				speaking = true
				openedAt = index
				quietFor = 0
			}
			continue
		}

		if (level >= offset) {
			quietFor = 0
			continue
		}

		quietFor++
		if (quietFor < hangoverFrames) continue
		speaking = false
		// The hangover frames were silence: they belong outside the segment.
		raw.push({
			startMs: openedAt * frameMs,
			endMs: (index - quietFor + 1) * frameMs,
		})
		quietFor = 0
	}

	if (speaking) raw.push({ startMs: openedAt * frameMs, endMs: frameDb.length * frameMs })

	const segments = tidySegments(raw, {
		minSpeechMs: config.minSpeechMs,
		minSilenceMs: config.minSilenceMs,
		padMs: config.padMs,
		limitMs: totalMs,
	})

	return {
		segments,
		speechRatio: totalMs > 0 ? totalSpeechMs(segments) / totalMs : 0,
		peakDb: Number.isFinite(peakDb) ? peakDb : -100,
		noiseFloorDb: quantile(Array.from(split), 0.5),
		frameDb,
		frameMs,
	}
}

/** Pads, closes short gaps and drops blips - in that order, which matters. */
export function tidySegments(
	segments: SpeechSegment[],
	options: { minSpeechMs: number; minSilenceMs: number; padMs: number; limitMs: number },
): SpeechSegment[] {
	if (segments.length === 0) return []

	const padded = segments
		.map((segment) => ({
			startMs: Math.max(0, segment.startMs - options.padMs),
			endMs: Math.min(options.limitMs, segment.endMs + options.padMs),
		}))
		.filter((segment) => segment.endMs > segment.startMs)
		.sort((left, right) => left.startMs - right.startMs)

	const merged: SpeechSegment[] = []
	for (const segment of padded) {
		const previous = merged[merged.length - 1]
		if (previous && segment.startMs - previous.endMs <= options.minSilenceMs) {
			previous.endMs = Math.max(previous.endMs, segment.endMs)
			continue
		}
		merged.push({ ...segment })
	}

	return merged.filter((segment) => segment.endMs - segment.startMs >= options.minSpeechMs)
}

export function totalSpeechMs(segments: SpeechSegment[]): number {
	let total = 0
	for (const segment of segments) total += Math.max(0, segment.endMs - segment.startMs)
	return total
}

export function shiftSegments(segments: SpeechSegment[], deltaMs: number): SpeechSegment[] {
	return segments.map((segment) => ({
		startMs: segment.startMs + deltaMs,
		endMs: segment.endMs + deltaMs,
	}))
}

/** The part of `segments` inside [fromMs, toMs), clipped rather than dropped. */
export function clipSegments(
	segments: SpeechSegment[],
	fromMs: number,
	toMs: number,
): SpeechSegment[] {
	const out: SpeechSegment[] = []
	for (const segment of segments) {
		const startMs = Math.max(segment.startMs, fromMs)
		const endMs = Math.min(segment.endMs, toMs)
		if (endMs > startMs) out.push({ startMs, endMs })
	}
	return out
}

export function mergeSegments(segments: SpeechSegment[], gapMs = 0): SpeechSegment[] {
	const sorted = [...segments].sort((left, right) => left.startMs - right.startMs)
	const out: SpeechSegment[] = []
	for (const segment of sorted) {
		const previous = out[out.length - 1]
		if (previous && segment.startMs - previous.endMs <= gapMs) {
			previous.endMs = Math.max(previous.endMs, segment.endMs)
			continue
		}
		out.push({ ...segment })
	}
	return out
}

/** The silences between the speech, inside [fromMs, toMs). */
export function silencesBetween(
	segments: SpeechSegment[],
	fromMs: number,
	toMs: number,
): SpeechSegment[] {
	const inside = clipSegments(segments, fromMs, toMs)
	const gaps: SpeechSegment[] = []
	let cursor = fromMs
	for (const segment of inside) {
		if (segment.startMs > cursor) gaps.push({ startMs: cursor, endMs: segment.startMs })
		cursor = Math.max(cursor, segment.endMs)
	}
	if (toMs > cursor) gaps.push({ startMs: cursor, endMs: toMs })
	return gaps
}

/** True when `ms` falls inside any segment. */
export function isSpeechAt(segments: SpeechSegment[], ms: number): boolean {
	for (const segment of segments) {
		if (ms >= segment.startMs && ms < segment.endMs) return true
		if (segment.startMs > ms) break
	}
	return false
}

/**
 * Maps a position along the concatenated speech onto the real clock.
 *
 * Laying words down on speech means working in a timeline that has the silence
 * squeezed out of it: the third of the way through what was *said* is not the
 * third of the way through the clip. `mode` decides which side of a pause a
 * boundary lands on - a word's end stays on the speech before the pause, the
 * next word's start jumps to the speech after it - which is what puts a real
 * gap between two words instead of stretching one across the silence.
 */
export function speechPositionToMs(
	segments: SpeechSegment[],
	positionMs: number,
	mode: 'start' | 'end' = 'start',
): number {
	if (segments.length === 0) return positionMs
	const total = totalSpeechMs(segments)
	const clamped = Math.max(0, Math.min(total, positionMs))

	let consumed = 0
	for (const segment of segments) {
		const length = Math.max(0, segment.endMs - segment.startMs)
		const next = consumed + length
		if (clamped < next || (mode === 'end' && clamped <= next)) {
			return segment.startMs + (clamped - consumed)
		}
		consumed = next
	}
	return segments[segments.length - 1].endMs
}

/** The inverse: how much speech has been spoken by `ms`. */
export function msToSpeechPosition(segments: SpeechSegment[], ms: number): number {
	let consumed = 0
	for (const segment of segments) {
		if (ms <= segment.startMs) break
		consumed += Math.min(ms, segment.endMs) - segment.startMs
		if (ms < segment.endMs) break
	}
	return Math.max(0, consumed)
}
