/**
 * Forced alignment, without a forced aligner.
 *
 * A hosted recogniser returns one of two things. Either it hands back word
 * timings - which are usually close, sometimes systematically late, and
 * occasionally sitting in a silence where nobody is speaking - or it hands back
 * only text, and the caller has to decide when each word was said. NVIDIA's
 * hosted Whisper function is the second kind, and spreading its text evenly
 * across a minute of audio is what makes captions run seconds away from the
 * speaker's mouth.
 *
 * This module closes both gaps using the speech map from `vad.ts`:
 *
 *   - text only    -> words are laid down on speech and never on silence,
 *                     weighted by how long each one takes to say
 *   - timings back -> the systematic offset is measured by cross-correlating
 *                     the recogniser's activity against the real speech, the
 *                     shift is removed, and any word left stranded in a silence
 *                     is pulled onto the nearest speech
 *
 * The result is what a viewer reads as lip sync: the word appears on the frame
 * where it is spoken, and a pause on screen is a pause in the audio.
 *
 * Pure functions over plain data - no browser API, no network, no imports from
 * the cue layer, so it can be reasoned about and checked in isolation.
 */

import {
	clipSegments,
	msToSpeechPosition,
	speechPositionToMs,
	totalSpeechMs,
	type SpeechSegment,
} from './vad'

export type TimedWord = {
	text: string
	startMs: number
	endMs: number
}

/* ------------------------------------------------------------- speak time */

const DEVANAGARI_CONSONANT = /[क-हक़-य़ॸ-ॿ]/
const DEVANAGARI_INDEPENDENT_VOWEL = /[ऄ-औॠॡॲ-ॷ]/
/** U+094D, the mark that ties a consonant to the next instead of voicing it. */
const DEVANAGARI_VIRAMA = '्'
const DEVANAGARI_DIGIT = /[०-९]/
const CJK = /[぀-ヿ㐀-䶿一-鿿가-힯]/

/**
 * Syllables, because syllables are what take time to say.
 *
 * Character count is a bad proxy in any script and a terrible one across two:
 * "छ" and "school" are one syllable each but one and six characters, and a
 * Devanagari cluster carries its vowel as a mark that adds length without
 * adding time. Counting nuclei - independent vowels, and consonants that are
 * not tied to the next one by a virama - tracks speaking time closely enough
 * that a line of Nepali and a line of English get their fair share of the clock.
 */
export function syllableCount(word: string): number {
	const text = word.trim()
	if (!text) return 0

	let syllables = 0
	let latinRun = ''
	let sawScript = false

	const flushLatin = () => {
		if (!latinRun) return
		syllables += latinSyllables(latinRun)
		latinRun = ''
	}

	for (let index = 0; index < text.length; index++) {
		const character = text[index]

		if (/[A-Za-z]/.test(character)) {
			latinRun += character
			sawScript = true
			continue
		}
		flushLatin()

		if (DEVANAGARI_INDEPENDENT_VOWEL.test(character)) {
			syllables++
			sawScript = true
			continue
		}
		if (DEVANAGARI_CONSONANT.test(character)) {
			sawScript = true
			// A virama ties this consonant to the next: one nucleus, not two.
			if (text[index + 1] === DEVANAGARI_VIRAMA) continue
			syllables++
			continue
		}
		if (CJK.test(character)) {
			syllables++
			sawScript = true
			continue
		}
		if (/[0-9]/.test(character) || DEVANAGARI_DIGIT.test(character)) {
			syllables++
			sawScript = true
			continue
		}
		if (/\p{L}/u.test(character)) {
			// Any other script: fall back to a letter count, halved for the
			// marks and matras that carry no syllable of their own.
			syllables += 0.5
			sawScript = true
		}
	}
	flushLatin()

	if (!sawScript) return 0
	return Math.max(1, Math.round(syllables))
}

/**
 * Vowel pairs that reliably break into two syllables in English - "vi-de-o",
 * "ra-di-o", "var-i-ous". "ea" is deliberately absent: it is one syllable far
 * more often than two ("each", "beautiful"), and over-counting a word costs
 * more clock than under-counting it.
 */
const HIATUS = new Set(['ia', 'io', 'eo', 'ua', 'uo', 'ii'])

function latinSyllables(word: string): number {
	const lower = word.toLowerCase()
	const groups = [...lower.matchAll(/[aeiouy]+/g)]
	let count = groups.length

	for (const match of groups) {
		const group = match[0]
		const at = match.index ?? 0
		for (let index = 0; index + 1 < group.length; index++) {
			if (!HIATUS.has(group.slice(index, index + 2))) continue
			const before = lower[at - 1] ?? ''
			const after = lower[at + index + 2] ?? ''
			// "-tion", "-sion", "-cian": that pair is one syllable, not two.
			if (after === 'n' && 'tsc'.includes(before)) continue
			count++
		}
	}

	// A trailing silent "e" is not a syllable, unless it is the only one.
	if (count > 1 && /[^aeiou]e$/.test(lower)) count--
	return Math.max(1, count)
}

/** Pause weight, in syllable-equivalents, for the punctuation a word ends on. */
function pauseWeight(word: string): number {
	if (/[।॥.!?…]["'”’)\]]*$/.test(word)) return 2.4
	if (/[,;:—–]["'”’)\]]*$/.test(word)) return 1.1
	return 0
}

/**
 * How much of the clock one word deserves. Syllables plus the pause its
 * punctuation implies, with a floor so a bare "a" still gets a frame or two.
 */
export function speakingWeight(word: string): number {
	return Math.max(0.6, syllableCount(word)) + pauseWeight(word)
}

/* --------------------------------------------------------- text -> timings */

export type DistributeOptions = {
	/** shortest word a caption should hold, ms */
	minWordMs?: number
	/** longest one word may occupy before the rest is treated as a pause, ms */
	maxWordMs?: number
}

/**
 * Lays a list of words across the speech inside [startMs, endMs).
 *
 * Words are distributed over *spoken* time rather than wall-clock time, so a
 * three-second pause in the middle of a chunk opens a three-second hole in the
 * captions instead of stretching four words across it. With no speech map the
 * function degrades to a length-weighted spread, which is what the old code did
 * for every chunk and is still the right answer when nothing is known.
 */
export function distributeOverSpeech(
	words: string[],
	segments: SpeechSegment[],
	startMs: number,
	endMs: number,
	options: DistributeOptions = {},
): TimedWord[] {
	const clean = words.map((word) => word.trim()).filter((word) => word.length > 0)
	if (clean.length === 0) return []

	const minWordMs = options.minWordMs ?? 80
	const maxWordMs = options.maxWordMs ?? 2_400
	const speech = clipSegments(segments, startMs, endMs)
	const spoken = totalSpeechMs(speech)

	// Below a couple of hundred milliseconds of detected speech there is nothing
	// to align to; an even spread over the span beats aligning to noise.
	if (speech.length === 0 || spoken < 200) {
		return spreadEvenly(clean, startMs, endMs, minWordMs)
	}

	const weights = clean.map(speakingWeight)
	const total = weights.reduce((sum, weight) => sum + weight, 0) || 1

	const out: TimedWord[] = []
	let consumed = 0
	for (let index = 0; index < clean.length; index++) {
		const share = (weights[index] / total) * spoken
		const from = speechPositionToMs(speech, consumed, 'start')
		consumed += share
		const rawTo = speechPositionToMs(speech, consumed, 'end')
		const to = Math.min(rawTo, from + maxWordMs)
		out.push({
			text: clean[index],
			startMs: Math.round(from),
			endMs: Math.round(Math.max(from + minWordMs, to)),
		})
	}

	return monotonic(out, { minWordMs, limitMs: endMs })
}

/** Length-weighted spread across a span - the answer when no speech is known. */
function spreadEvenly(
	words: string[],
	startMs: number,
	endMs: number,
	minWordMs: number,
): TimedWord[] {
	const span = Math.max(1, endMs - startMs)
	const weights = words.map(speakingWeight)
	const total = weights.reduce((sum, value) => sum + value, 0) || 1
	let cursor = startMs
	return words.map((word, index) => {
		const share = (weights[index] / total) * span
		const from = Math.round(cursor)
		cursor += share
		const to = index === words.length - 1 ? endMs : Math.round(cursor)
		return { text: word, startMs: from, endMs: Math.max(from + minWordMs, to) }
	})
}

/** Keeps a word list ordered, non-overlapping and inside the clip. */
export function monotonic(
	words: TimedWord[],
	options: { minWordMs?: number; limitMs?: number } = {},
): TimedWord[] {
	const minWordMs = options.minWordMs ?? 60
	const limitMs = options.limitMs ?? Number.MAX_SAFE_INTEGER
	const sorted = [...words].sort((left, right) => left.startMs - right.startMs)
	const out: TimedWord[] = []

	for (const word of sorted) {
		const previous = out[out.length - 1]
		const startMs = Math.max(0, previous ? Math.max(word.startMs, previous.endMs) : word.startMs)
		const endMs = Math.min(limitMs, Math.max(startMs + minWordMs, word.endMs))
		if (startMs >= limitMs) continue
		out.push({ text: word.text, startMs: Math.round(startMs), endMs: Math.round(endMs) })
	}

	return out
}

/* ------------------------------------------------------- timings -> timings */

const CORRELATION_BIN_MS = 20

/** Rasterises intervals into a 0/1 activity track at CORRELATION_BIN_MS. */
function activityTrack(
	intervals: { startMs: number; endMs: number }[],
	fromMs: number,
	bins: number,
): Float32Array {
	const track = new Float32Array(bins)
	for (const interval of intervals) {
		const first = Math.max(0, Math.floor((interval.startMs - fromMs) / CORRELATION_BIN_MS))
		const last = Math.min(bins - 1, Math.ceil((interval.endMs - fromMs) / CORRELATION_BIN_MS) - 1)
		for (let index = first; index <= last; index++) track[index] = 1
	}
	return track
}

function correlationAt(words: Float32Array, speech: Float32Array, shiftBins: number): number {
	let overlap = 0
	let wordEnergy = 0
	for (let index = 0; index < words.length; index++) {
		const value = words[index]
		if (value === 0) continue
		wordEnergy += value
		const shifted = index + shiftBins
		if (shifted < 0 || shifted >= speech.length) continue
		overlap += value * speech[shifted]
	}
	return wordEnergy === 0 ? 0 : overlap / wordEnergy
}

export type OffsetEstimate = {
	/** milliseconds to add to every word timing */
	offsetMs: number
	/** overlap with the speech map before the shift, 0 - 1 */
	before: number
	/** overlap after it */
	after: number
}

/**
 * Measures how far the recogniser's timings sit from the audio.
 *
 * A hosted model that pads its input, or a container whose audio track starts
 * at a non-zero timestamp, shifts every word by the same amount - and a
 * constant shift is exactly the error a viewer perceives as bad lip sync. It is
 * also the easiest to remove: rasterise "a word is being said" and "speech is
 * happening" onto the same grid and slide one past the other until they line
 * up best.
 */
export function estimateOffsetMs(
	words: TimedWord[],
	segments: SpeechSegment[],
	options: { maxShiftMs?: number } = {},
): OffsetEstimate {
	const maxShiftMs = options.maxShiftMs ?? 2_000
	if (words.length === 0 || segments.length === 0) {
		return { offsetMs: 0, before: 0, after: 0 }
	}

	const fromMs = Math.min(words[0].startMs, segments[0].startMs)
	const toMs = Math.max(
		words[words.length - 1].endMs,
		segments[segments.length - 1].endMs,
	)
	const bins = Math.ceil((toMs - fromMs) / CORRELATION_BIN_MS) + 1
	if (bins <= 1) return { offsetMs: 0, before: 0, after: 0 }

	const wordTrack = activityTrack(words, fromMs, bins)
	const speechTrack = activityTrack(segments, fromMs, bins)

	const maxShiftBins = Math.round(maxShiftMs / CORRELATION_BIN_MS)
	const before = correlationAt(wordTrack, speechTrack, 0)
	let bestScore = before
	let bestShift = 0

	for (let shift = -maxShiftBins; shift <= maxShiftBins; shift++) {
		if (shift === 0) continue
		const score = correlationAt(wordTrack, speechTrack, shift)
		// A tie goes to the smaller shift: never move the transcript for nothing.
		if (score > bestScore + 1e-6 || (score > bestScore - 1e-6 && Math.abs(shift) < Math.abs(bestShift))) {
			bestScore = score
			bestShift = shift
		}
	}

	return { offsetMs: bestShift * CORRELATION_BIN_MS, before, after: bestScore }
}

export type SnapOptions = {
	/** how far a word may be dragged to reach the speech it belongs to, ms */
	maxPullMs?: number
	/** a word start this close to a speech onset is snapped onto it, ms */
	snapMs?: number
	/** largest constant offset worth correcting, ms */
	maxShiftMs?: number
	/** the shift must improve overlap by at least this much to be applied */
	minGainRatio?: number
	minWordMs?: number
	limitMs?: number
}

export type SnapResult = {
	words: TimedWord[]
	/** the constant offset that was removed, ms */
	offsetMs: number
	/** how many words were pulled out of a silence */
	rescued: number
}

/**
 * Puts recogniser timings back on the speech.
 *
 * Three passes, cheapest first: remove the constant offset, pull any word that
 * landed in a silence onto the nearest speech, then snap the first word after
 * each pause onto the moment the speaker actually starts again. Nothing here
 * invents or reorders a word - it only moves the clock under them.
 */
export function snapWordsToSpeech(
	words: TimedWord[],
	segments: SpeechSegment[],
	options: SnapOptions = {},
): SnapResult {
	if (words.length === 0) return { words, offsetMs: 0, rescued: 0 }
	if (segments.length === 0) {
		return { words: monotonic(words, options), offsetMs: 0, rescued: 0 }
	}

	const maxPullMs = options.maxPullMs ?? 1_200
	const snapMs = options.snapMs ?? 140
	const minGainRatio = options.minGainRatio ?? 0.02

	const estimate = estimateOffsetMs(words, segments, { maxShiftMs: options.maxShiftMs })
	const worthIt = estimate.after - estimate.before >= minGainRatio && estimate.offsetMs !== 0
	const offsetMs = worthIt ? estimate.offsetMs : 0

	let rescued = 0
	const moved = words.map((word) => {
		const startMs = word.startMs + offsetMs
		const endMs = Math.max(startMs + 1, word.endMs + offsetMs)
		const duration = endMs - startMs

		const overlap = overlapWithSpeech(segments, startMs, endMs)
		if (overlap > 0) return { text: word.text, startMs, endMs }

		// Stranded in a silence: move it, whole, onto the closest speech.
		const target = nearestSegment(segments, startMs, endMs)
		if (!target) return { text: word.text, startMs, endMs }
		const distance =
			startMs >= target.endMs ? startMs - target.endMs : target.startMs - endMs
		if (distance > maxPullMs) return { text: word.text, startMs, endMs }

		rescued++
		const room = Math.max(1, target.endMs - target.startMs)
		const pulledStart =
			startMs >= target.endMs
				? Math.max(target.startMs, target.endMs - Math.min(duration, room))
				: target.startMs
		return {
			text: word.text,
			startMs: pulledStart,
			endMs: Math.min(target.endMs, pulledStart + duration),
		}
	})

	// Onsets: the first word after a pause is the one a viewer checks against
	// the speaker's mouth, so it gets planted exactly on the speech.
	const snapped = moved.map((word, index) => {
		const previous = moved[index - 1]
		const startsPhrase = !previous || word.startMs - previous.endMs > 200
		if (!startsPhrase) return word
		const onset = nearestOnset(segments, word.startMs, snapMs)
		if (onset === null) return word
		const shift = onset - word.startMs
		return { text: word.text, startMs: onset, endMs: Math.max(onset + 1, word.endMs + shift) }
	})

	return {
		words: monotonic(snapped, { minWordMs: options.minWordMs, limitMs: options.limitMs }),
		offsetMs,
		rescued,
	}
}

function overlapWithSpeech(segments: SpeechSegment[], startMs: number, endMs: number): number {
	let total = 0
	for (const segment of segments) {
		if (segment.startMs >= endMs) break
		if (segment.endMs <= startMs) continue
		total += Math.min(endMs, segment.endMs) - Math.max(startMs, segment.startMs)
	}
	return total
}

function nearestSegment(
	segments: SpeechSegment[],
	startMs: number,
	endMs: number,
): SpeechSegment | null {
	let best: SpeechSegment | null = null
	let bestDistance = Infinity
	for (const segment of segments) {
		const distance =
			startMs >= segment.endMs
				? startMs - segment.endMs
				: endMs <= segment.startMs
					? segment.startMs - endMs
					: 0
		if (distance < bestDistance) {
			bestDistance = distance
			best = segment
		}
		if (distance === 0) break
	}
	return best
}

function nearestOnset(segments: SpeechSegment[], ms: number, toleranceMs: number): number | null {
	let best: number | null = null
	let bestDistance = toleranceMs
	for (const segment of segments) {
		const distance = Math.abs(segment.startMs - ms)
		if (distance <= bestDistance) {
			bestDistance = distance
			best = segment.startMs
		}
		if (segment.startMs > ms + toleranceMs) break
	}
	return best
}

/* ---------------------------------------------------------------- quality */

export type AlignmentReport = {
	/** share of words that sit on speech, 0 - 1 */
	onSpeech: number
	/** constant offset removed, ms */
	offsetMs: number
	/** words pulled out of a silence */
	rescued: number
	/** share of detected speech that no word covers, 0 - 1 */
	uncovered: number
}

export function alignmentReport(
	words: TimedWord[],
	segments: SpeechSegment[],
	snap: { offsetMs: number; rescued: number },
): AlignmentReport {
	if (words.length === 0 || segments.length === 0) {
		return { onSpeech: 0, offsetMs: snap.offsetMs, rescued: snap.rescued, uncovered: 1 }
	}
	let onSpeech = 0
	for (const word of words) {
		if (overlapWithSpeech(segments, word.startMs, word.endMs) > 0) onSpeech++
	}
	const spoken = totalSpeechMs(segments)
	let covered = 0
	for (const segment of segments) {
		for (const word of words) {
			if (word.endMs <= segment.startMs) continue
			if (word.startMs >= segment.endMs) break
			covered += Math.min(word.endMs, segment.endMs) - Math.max(word.startMs, segment.startMs)
		}
	}
	return {
		onSpeech: onSpeech / words.length,
		offsetMs: snap.offsetMs,
		rescued: snap.rescued,
		uncovered: spoken > 0 ? Math.max(0, 1 - Math.min(covered, spoken) / spoken) : 0,
	}
}

/**
 * How far into the speech a moment sits - used when a caller needs to compare
 * two timelines that hold the same words but different silences.
 */
export function speechProgress(segments: SpeechSegment[], ms: number): number {
	const total = totalSpeechMs(segments)
	if (total <= 0) return 0
	return Math.min(1, msToSpeechPosition(segments, ms) / total)
}
