/**
 * Bulk operations on a finished transcript.
 *
 * Everything here is a pure function over the cue list: nothing touches React,
 * nothing mutates its input, and every result goes back through the studio's
 * normal undo history. Word timings are preserved wherever the words survive -
 * a find and replace that swaps one word keeps every other timestamp exactly
 * as the recogniser produced it, which is what karaoke styles depend on.
 */

import { makeCue, nextCueId, timeWords, splitWords } from './cues'
import type { CaptionCue, CaptionToken } from './types'

/* --------------------------------------------------------------- helpers */

const DEVANAGARI = /[ऀ-ॿ]/

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function retime(cue: CaptionCue, text: string, tokens: CaptionToken[]): CaptionCue {
	return { ...cue, text, tokens }
}

/**
 * Re-flows a rewritten line onto its existing timings. A line whose word count
 * survived keeps every original timestamp; one that gained or lost words is
 * spread across its own span only, so nothing drifts into the next cue.
 */
function applyText(cue: CaptionCue, text: string): CaptionCue {
	const clean = text.replace(/\s+/g, ' ').trim()
	const words = splitWords(clean)
	if (words.length === cue.tokens.length) {
		return retime(
			cue,
			clean,
			cue.tokens.map((token, index) => ({ ...token, text: words[index] })),
		)
	}
	return retime(cue, clean, timeWords(clean, cue.startMs, cue.endMs))
}

/* --------------------------------------------------------- find, replace */

export type FindReplaceOptions = {
	find: string
	replace: string
	caseSensitive: boolean
	wholeWord: boolean
}

export function countMatches(cues: CaptionCue[], options: FindReplaceOptions): number {
	if (!options.find) return 0
	const pattern = buildPattern(options)
	return cues.reduce((total, cue) => total + (cue.text.match(pattern)?.length ?? 0), 0)
}

function buildPattern(options: FindReplaceOptions): RegExp {
	const body = escapeRegExp(options.find)
	// \b does not fire between two Devanagari letters, so whole-word matching
	// falls back to a lookaround on non-letter boundaries for those scripts.
	const wrapped = options.wholeWord
		? DEVANAGARI.test(options.find)
			? `(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`
			: `\\b${body}\\b`
		: body
	return new RegExp(wrapped, options.caseSensitive ? 'gu' : 'giu')
}

export function findReplace(
	cues: CaptionCue[],
	options: FindReplaceOptions,
): { cues: CaptionCue[]; replaced: number } {
	if (!options.find) return { cues, replaced: 0 }
	const pattern = buildPattern(options)
	let replaced = 0

	const next = cues.map((cue) => {
		const matches = cue.text.match(pattern)
		if (!matches) return cue
		replaced += matches.length
		return applyText(cue, cue.text.replace(pattern, options.replace))
	})

	return { cues: next, replaced }
}

/* ------------------------------------------------------------ text tools */

export type CaseMode = 'upper' | 'lower' | 'sentence' | 'title'

const LOWER_WORDS = new Set([
	'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'nor', 'of', 'on', 'or', 'so', 'the',
	'to', 'up', 'via', 'vs', 'with', 'yet',
])

function titleCase(text: string): string {
	const words = text.split(' ')
	return words
		.map((word, index) => {
			const bare = word.toLowerCase()
			if (index > 0 && index < words.length - 1 && LOWER_WORDS.has(bare)) return bare
			return bare.replace(/^(\p{L})/u, (character) => character.toUpperCase())
		})
		.join(' ')
}

function sentenceCase(text: string): string {
	const lowered = text.toLowerCase()
	// Capitalise after a sentence end, including the Nepali danda.
	return lowered.replace(/(^|[.!?।॥]\s+)(\p{L})/gu, (_, lead, letter) => lead + letter.toUpperCase())
}

/**
 * Rewrites the transcript itself, unlike the render-time letter case which only
 * changes how it is drawn. Useful when a recogniser writes everything lowercase
 * and the .srt has to leave the studio properly cased.
 */
export function transformCase(cues: CaptionCue[], mode: CaseMode): CaptionCue[] {
	return cues.map((cue) => {
		const text =
			mode === 'upper'
				? cue.text.toUpperCase()
				: mode === 'lower'
					? cue.text.toLowerCase()
					: mode === 'title'
						? titleCase(cue.text)
						: sentenceCase(cue.text)
		return applyText(cue, text)
	})
}

/**
 * The punctuation a speech recogniser gets wrong in bulk: doubled spaces, a
 * space before a comma, three dots where an ellipsis belongs, straight quotes,
 * and a Devanagari danda pushed away from the word it closes.
 */
export function cleanPunctuation(cues: CaptionCue[]): { cues: CaptionCue[]; changed: number } {
	let changed = 0
	const next = cues.map((cue) => {
		const text = cue.text
			.replace(/\s+/g, ' ')
			.replace(/\s+([,.!?;:।॥])/g, '$1')
			.replace(/([,;:])(?=\p{L})/gu, '$1 ')
			.replace(/\.{3,}/g, '…')
			.replace(/--/g, '—')
			.replace(/\s*—\s*/g, ' — ')
			.replace(/"([^"]*)"/g, '“$1”')
			.replace(/(\p{L})'(\p{L})/gu, '$1’$2')
			.trim()
		if (text === cue.text) return cue
		changed++
		return applyText(cue, text)
	})
	return { cues: next, changed }
}

/* -------------------------------------------------------------- keywords */

const STOPWORDS = new Set([
	// English
	'the', 'and', 'that', 'this', 'with', 'for', 'you', 'your', 'are', 'was', 'were', 'have', 'has',
	'had', 'not', 'but', 'they', 'them', 'their', 'what', 'when', 'where', 'which', 'who', 'will',
	'just', 'from', 'about', 'into', 'over', 'then', 'than', 'there', 'here', 'been', 'because',
	'would', 'could', 'should', 'like', 'know', 'going', 'really', 'very', 'okay', 'yeah',
	// Nepali
	'हो', 'छ', 'छन्', 'हुन्', 'थियो', 'र', 'तर', 'पनि', 'मा', 'को', 'का', 'की', 'लाई', 'बाट', 'हरु',
	'हरू', 'यो', 'त्यो', 'यी', 'ती', 'म', 'हामी', 'तपाईं', 'उनी', 'भनेर', 'भन्ने', 'गर्न', 'गर्ने',
	'हुन्छ', 'अनि', 'नै', 'कि', 'जस्तो', 'अब', 'त',
])

export type KeywordSuggestion = { word: string; count: number }

/**
 * Ranks the words worth emphasising: frequent, not a stopword, and long enough
 * to carry meaning. Numbers and prices are always kept - they are usually the
 * point of the sentence they sit in.
 */
export function suggestKeywords(cues: CaptionCue[], limit = 12): KeywordSuggestion[] {
	const counts = new Map<string, number>()
	for (const cue of cues) {
		for (const token of cue.tokens) {
			const bare = token.text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
			if (!bare) continue
			const isNumber = /\d/.test(bare)
			const minLength = DEVANAGARI.test(bare) ? 2 : 4
			if (!isNumber && (bare.length < minLength || STOPWORDS.has(bare))) continue
			counts.set(bare, (counts.get(bare) ?? 0) + 1)
		}
	}
	return [...counts.entries()]
		.map(([word, count]) => ({ word, count }))
		.sort((left, right) => right.count - left.count || left.word.localeCompare(right.word))
		.slice(0, limit)
}

/* ---------------------------------------------------------- timing tools */

/**
 * Scales every timestamp by one factor. This is the fix for a transcript that
 * was written against a differently-framed export and drifts further out of
 * sync the longer the clip runs.
 */
export function stretchTiming(cues: CaptionCue[], factor: number, durationMs: number): CaptionCue[] {
	const safe = Math.max(0.5, Math.min(2, factor))
	const cap = durationMs > 0 ? durationMs : Number.MAX_SAFE_INTEGER
	const scale = (value: number) => Math.max(0, Math.min(cap, Math.round(value * safe)))
	return cues.map((cue) => ({
		...cue,
		startMs: scale(cue.startMs),
		endMs: Math.max(scale(cue.startMs) + 120, scale(cue.endMs)),
		tokens: cue.tokens.map((token) => ({
			...token,
			fromMs: scale(token.fromMs),
			toMs: Math.max(scale(token.fromMs) + 1, scale(token.toMs)),
		})),
	}))
}

/**
 * Holds a caption on screen through the silence that follows it, up to a limit.
 * Starts never move, so nothing loses sync with the audio - the caption simply
 * stops blinking out during a short pause between sentences.
 */
export function holdThroughGaps(
	cues: CaptionCue[],
	maxHoldMs: number,
	durationMs: number,
): CaptionCue[] {
	return cues.map((cue, index) => {
		const next = cues[index + 1]
		const ceiling = next ? next.startMs - 40 : durationMs || cue.endMs
		const wanted = Math.min(cue.endMs + maxHoldMs, ceiling)
		return wanted > cue.endMs ? { ...cue, endMs: Math.round(wanted) } : cue
	})
}

/** Rounds every timestamp to a frame boundary, which is where a render lands anyway. */
export function snapToFrames(cues: CaptionCue[], fps: number): CaptionCue[] {
	const frame = 1000 / Math.max(1, fps)
	const snap = (value: number) => Math.round(value / frame) * frame
	return cues.map((cue) => {
		const startMs = Math.round(snap(cue.startMs))
		const endMs = Math.max(startMs + Math.round(frame), Math.round(snap(cue.endMs)))
		return {
			...cue,
			startMs,
			endMs,
			tokens: cue.tokens.map((token) => {
				const fromMs = Math.round(snap(token.fromMs))
				return {
					...token,
					fromMs,
					toMs: Math.max(fromMs + 1, Math.round(snap(token.toMs))),
				}
			}),
		}
	})
}

/** Cuts any cue longer than `maxMs` at a word boundary near its middle. */
export function splitLongCues(cues: CaptionCue[], maxMs: number): CaptionCue[] {
	const out: CaptionCue[] = []
	const queue = [...cues]

	while (queue.length > 0) {
		const cue = queue.shift() as CaptionCue
		if (cue.endMs - cue.startMs <= maxMs || cue.tokens.length < 2) {
			out.push(cue)
			continue
		}
		const middle = cue.startMs + (cue.endMs - cue.startMs) / 2
		let index = cue.tokens.findIndex((token) => token.fromMs >= middle)
		if (index < 1) index = Math.ceil(cue.tokens.length / 2)
		if (index >= cue.tokens.length) index = cue.tokens.length - 1

		const left = cue.tokens.slice(0, index)
		const right = cue.tokens.slice(index)
		out.push({
			id: nextCueId(),
			text: left.map((token) => token.text).join(' '),
			startMs: cue.startMs,
			endMs: right[0].fromMs,
			tokens: left,
		})
		queue.unshift({
			id: nextCueId(),
			text: right.map((token) => token.text).join(' '),
			startMs: right[0].fromMs,
			endMs: cue.endMs,
			tokens: right,
		})
	}

	return out
}

/**
 * Folds a cue shorter than `minMs` into its neighbour when they nearly touch.
 * Two-word flashes are the most common complaint about machine timing.
 */
export function mergeShortCues(cues: CaptionCue[], minMs: number, maxGapMs = 240): CaptionCue[] {
	const out: CaptionCue[] = []

	const join = (left: CaptionCue, right: CaptionCue): CaptionCue => {
		const tokens = [...left.tokens, ...right.tokens]
		return {
			...left,
			text: tokens.map((token) => token.text).join(' ') || `${left.text} ${right.text}`.trim(),
			endMs: right.endMs,
			tokens,
		}
	}

	for (let index = 0; index < cues.length; index++) {
		const cue = cues[index]
		const short = cue.endMs - cue.startMs < minMs
		const previous = out[out.length - 1]

		// Backwards first: a flash after a full line belongs to that line.
		if (short && previous && cue.startMs - previous.endMs <= maxGapMs) {
			out[out.length - 1] = join(previous, cue)
			continue
		}

		// Otherwise forwards, which is what rescues a flash that opens a cue run.
		const next = cues[index + 1]
		if (short && next && next.startMs - cue.endMs <= maxGapMs) {
			out.push(join(cue, next))
			index++
			continue
		}

		out.push(cue)
	}

	return out
}

/* --------------------------------------------------------- speaker split */

/**
 * Turns "Speaker: line" prefixes into separate cues that keep their prefix,
 * which is how an interview transcript pasted from elsewhere becomes usable
 * subtitles without hand editing every line.
 */
export function splitOnSpeakers(cues: CaptionCue[]): { cues: CaptionCue[]; found: number } {
	let found = 0
	const out: CaptionCue[] = []
	for (const cue of cues) {
		const parts = cue.text.split(/(?=\b[A-Z][A-Za-z ]{1,18}:\s)/g).filter((part) => part.trim())
		if (parts.length < 2) {
			out.push(cue)
			continue
		}
		found += parts.length - 1
		const span = cue.endMs - cue.startMs
		const total = parts.reduce((sum, part) => sum + part.length, 0)
		let cursor = cue.startMs
		for (const part of parts) {
			const share = (part.length / total) * span
			const startMs = Math.round(cursor)
			cursor += share
			out.push(makeCue(part.trim(), startMs, Math.round(cursor)))
		}
	}
	return { cues: out, found }
}
