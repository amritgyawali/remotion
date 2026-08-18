/**
 * Everything that turns raw words into editable, on-screen cues and back into
 * subtitle files. Word level timing is kept everywhere so the karaoke styles
 * can highlight the word that is being spoken.
 */

import type { CaptionCue, CaptionLayoutOptions, CaptionToken, ScriptMix } from './types'

/* ----------------------------------------------------------------- script */

const DEVANAGARI = /[\u0900-\u097F]/
/**
 * Matras, anusvara, virama and the joiners take no horizontal room of their
 * own - they stack on the consonant they belong to. Counting them as
 * characters makes "छ" and "छेउ" look the same width to the line breaker and
 * pushes Nepali captions into ragged, half-empty rows.
 */
const DEVANAGARI_COMBINING = /[\u0900-\u0902\u093A-\u094F\u0951-\u0957\u0962\u0963\u200C\u200D]/g

export function hasDevanagari(text: string): boolean {
	return DEVANAGARI.test(text)
}

/** Roughly how wide a word sets, in Latin character units. */
export function visualWidth(text: string): number {
	return text.replace(DEVANAGARI_COMBINING, '').length
}

/** What a transcript is actually made of - drives the font stack and the model hint. */
export function scriptMixOf(cues: CaptionCue[]): ScriptMix {
	let devanagariWords = 0
	let latinWords = 0
	let total = 0
	for (const cue of cues) {
		for (const token of cue.tokens) {
			total++
			if (DEVANAGARI.test(token.text)) devanagariWords++
			else if (/[A-Za-z]/.test(token.text)) latinWords++
		}
	}
	return {
		latin: latinWords > 0,
		devanagari: devanagariWords > 0,
		devanagariShare: total === 0 ? 0 : devanagariWords / total,
	}
}

export type WordTiming = {
	text: string
	startMs: number
	endMs: number
}

let cueCounter = 0

export function nextCueId(): string {
	cueCounter += 1
	return `cue-${Date.now().toString(36)}-${cueCounter.toString(36)}`
}

export function splitWords(text: string): string[] {
	return text
		.replace(/\s+/g, ' ')
		.trim()
		.split(' ')
		.filter((word) => word.length > 0)
}

/** Punctuation deserves a longer beat than a short word, hence the weighting. */
function weightOf(word: string): number {
	const letters = word.replace(/[^\p{L}\p{N}]/gu, '')
	// A Devanagari cluster is one spoken syllable, so its stripped length maps to
	// speaking time better than its raw code-point count does.
	const base = Math.max(1, DEVANAGARI.test(letters) ? visualWidth(letters) * 1.6 : letters.length)
	const pause = /[.!?।॥]$/.test(word) ? 3 : /[,;:]$/.test(word) ? 1.5 : 0
	return base + pause
}

/** Spreads a line of text across a time span, weighted by word length. */
export function timeWords(text: string, startMs: number, endMs: number): CaptionToken[] {
	const words = splitWords(text)
	if (words.length === 0) return []
	const span = Math.max(1, endMs - startMs)
	const weights = words.map(weightOf)
	const total = weights.reduce((sum, value) => sum + value, 0)

	let cursor = startMs
	return words.map((word, index) => {
		const share = (weights[index] / total) * span
		const fromMs = Math.round(cursor)
		cursor += share
		const toMs = index === words.length - 1 ? endMs : Math.round(cursor)
		return { text: word, fromMs, toMs: Math.max(fromMs + 1, toMs) }
	})
}

export function makeCue(text: string, startMs: number, endMs: number): CaptionCue {
	const safeStart = Math.max(0, Math.round(startMs))
	const safeEnd = Math.max(safeStart + 200, Math.round(endMs))
	return {
		id: nextCueId(),
		text: text.replace(/\s+/g, ' ').trim(),
		startMs: safeStart,
		endMs: safeEnd,
		tokens: timeWords(text, safeStart, safeEnd),
	}
}

export function cueFromTokens(tokens: CaptionToken[]): CaptionCue {
	const startMs = tokens[0]?.fromMs ?? 0
	const endMs = tokens[tokens.length - 1]?.toMs ?? startMs + 800
	return {
		id: nextCueId(),
		text: tokens.map((token) => token.text).join(' '),
		startMs,
		endMs,
		tokens,
	}
}

/**
 * Cuts a stream of timed words into readable lines. A cue ends when it hits the
 * word budget, the character budget, the duration budget, a long silence or a
 * sentence-ending punctuation mark - whichever comes first.
 */
export function groupWordsIntoCues(
	words: WordTiming[],
	layout: CaptionLayoutOptions,
): CaptionCue[] {
	const cues: CaptionCue[] = []
	let current: CaptionToken[] = []
	let characters = 0

	const flush = () => {
		if (current.length === 0) return
		cues.push(cueFromTokens(current))
		current = []
		characters = 0
	}

	for (const [index, word] of words.entries()) {
		const text = word.text.trim()
		if (!text) continue

		const previous = words[index - 1]
		const gap = previous ? word.startMs - previous.endMs : 0
		const width = visualWidth(text)
		const wouldOverflow =
			current.length >= layout.maxWordsPerCue ||
			characters + width + 1 > layout.maxCharactersPerCue ||
			(current.length > 0 && word.endMs - current[0].fromMs > layout.maxCueDurationMs)

		if (current.length > 0 && (wouldOverflow || gap >= layout.splitOnGapMs)) flush()

		current.push({
			text,
			fromMs: Math.max(0, Math.round(word.startMs)),
			toMs: Math.max(Math.round(word.startMs) + 1, Math.round(word.endMs)),
		})
		characters += width + 1

		// "।" (danda) and "॥" end a Nepali sentence the way a full stop ends an
		// English one, so they deserve the same line break.
		if (/[.!?।॥]$/.test(text) && current.length >= Math.min(2, layout.maxWordsPerCue)) flush()
	}

	flush()
	return cues
}

/** Re-cuts existing cues with new layout limits, keeping every word timing. */
export function regroupCues(cues: CaptionCue[], layout: CaptionLayoutOptions): CaptionCue[] {
	const words: WordTiming[] = cues.flatMap((cue) =>
		cue.tokens.map((token) => ({ text: token.text, startMs: token.fromMs, endMs: token.toMs })),
	)
	return groupWordsIntoCues(words, layout)
}

/**
 * Timing for a transcript that has no timestamps: every word gets a share of the
 * spoken window proportional to its length, which reads far better than an even
 * split and is a solid base for manual nudging afterwards.
 */
export function cuesFromPlainText(
	text: string,
	options: { durationMs: number; startMs?: number; layout: CaptionLayoutOptions },
): CaptionCue[] {
	const startMs = Math.max(0, options.startMs ?? 0)
	const endMs = Math.max(startMs + 1000, options.durationMs)
	// A blank line is an explicit paragraph break: hold it as a hard cue boundary.
	const paragraphs = text
		.split(/\n\s*\n/)
		.map((chunk) => chunk.trim())
		.filter(Boolean)
	const source = paragraphs.length > 0 ? paragraphs : [text.trim()]

	const paragraphWeights = source.map((paragraph) =>
		splitWords(paragraph).reduce((sum, word) => sum + weightOf(word), 0),
	)
	const totalWeight = paragraphWeights.reduce((sum, value) => sum + value, 0) || 1

	const words: WordTiming[] = []
	let cursor = startMs
	for (const [index, paragraph] of source.entries()) {
		const share = ((endMs - startMs) * paragraphWeights[index]) / totalWeight
		for (const token of timeWords(paragraph, cursor, cursor + share)) {
			words.push({ text: token.text, startMs: token.fromMs, endMs: token.toMs })
		}
		cursor += share
	}

	return groupWordsIntoCues(words, options.layout)
}

/* ------------------------------------------------------------------ files */

function parseTimestamp(value: string): number | null {
	const match = value
		.trim()
		.match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})[.,](\d{1,3})$/)
	if (!match) return null
	const [, hours, minutes, seconds, fraction] = match
	return (
		Number(hours ?? 0) * 3_600_000 +
		Number(minutes) * 60_000 +
		Number(seconds) * 1000 +
		Number(fraction.padEnd(3, '0'))
	)
}

/** Reads both .srt and .vtt - the two formats every caption tool exports. */
export function cuesFromSubtitleFile(input: string): CaptionCue[] {
	const normalized = input.replace(/\r\n?/g, '\n').replace(/^﻿/, '')
	const blocks = normalized.split(/\n{2,}/)
	const cues: CaptionCue[] = []

	for (const block of blocks) {
		const lines = block.split('\n').filter((line) => line.trim().length > 0)
		if (lines.length === 0) continue
		if (/^WEBVTT/i.test(lines[0])) lines.shift()
		if (lines.length === 0) continue

		const arrowIndex = lines.findIndex((line) => line.includes('-->'))
		if (arrowIndex === -1) continue

		const [rawStart, rawEnd] = lines[arrowIndex].split('-->')
		const startMs = parseTimestamp(rawStart ?? '')
		// VTT allows cue settings after the end timestamp: "00:02.000 line:90%".
		const endMs = parseTimestamp((rawEnd ?? '').trim().split(/\s+/)[0] ?? '')
		if (startMs === null || endMs === null) continue

		const text = lines
			.slice(arrowIndex + 1)
			.join(' ')
			.replace(/<[^>]+>/g, '')
			.replace(/\s+/g, ' ')
			.trim()
		if (!text) continue

		cues.push(makeCue(text, startMs, endMs))
	}

	return cues
}

function formatTimestamp(ms: number, separator: ',' | '.'): string {
	const clamped = Math.max(0, Math.round(ms))
	const hours = Math.floor(clamped / 3_600_000)
	const minutes = Math.floor((clamped % 3_600_000) / 60_000)
	const seconds = Math.floor((clamped % 60_000) / 1000)
	const millis = clamped % 1000
	const pad = (value: number, size = 2) => String(value).padStart(size, '0')
	return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}${separator}${pad(millis, 3)}`
}

export function cuesToSrt(cues: CaptionCue[]): string {
	return (
		cues
			.map((cue, index) =>
				[
					index + 1,
					`${formatTimestamp(cue.startMs, ',')} --> ${formatTimestamp(cue.endMs, ',')}`,
					cue.text,
				].join('\n'),
			)
			.join('\n\n') + '\n'
	)
}

export function cuesToVtt(cues: CaptionCue[]): string {
	return (
		'WEBVTT\n\n' +
		cues
			.map((cue) =>
				[
					`${formatTimestamp(cue.startMs, '.')} --> ${formatTimestamp(cue.endMs, '.')}`,
					cue.text,
				].join('\n'),
			)
			.join('\n\n') +
		'\n'
	)
}

export function cuesToPlainText(cues: CaptionCue[]): string {
	return cues.map((cue) => cue.text).join(' ')
}

/* ------------------------------------------------------------------ edits */

/** Keeps a cue list sorted, inside the video and free of overlaps. */
export function normalizeCues(cues: CaptionCue[], durationMs: number): CaptionCue[] {
	const sorted = [...cues].sort((a, b) => a.startMs - b.startMs)
	const out: CaptionCue[] = []

	for (const cue of sorted) {
		const startMs = Math.min(Math.max(0, Math.round(cue.startMs)), Math.max(0, durationMs - 200))
		const previous = out[out.length - 1]
		const shiftedStart = previous ? Math.max(startMs, previous.endMs + 1) : startMs
		// Only a cue that starts after the last frame is dropped; an overlapping
		// one is trimmed so no edit can silently delete a line of the transcript.
		if (shiftedStart >= durationMs) continue
		const endMs = Math.min(
			Math.max(shiftedStart + 120, Math.round(cue.endMs)),
			Math.max(durationMs, shiftedStart + 120),
		)
		out.push({
			...cue,
			startMs: shiftedStart,
			endMs,
			tokens: clampTokens(cue.tokens, shiftedStart, endMs, cue.text),
		})
	}

	return out
}

function clampTokens(
	tokens: CaptionToken[],
	startMs: number,
	endMs: number,
	text: string,
): CaptionToken[] {
	if (tokens.length === 0) return timeWords(text, startMs, endMs)
	const first = tokens[0].fromMs
	const last = tokens[tokens.length - 1].toMs
	// Timings that already sit inside the cue are the transcriber's, keep them.
	if (first >= startMs && last <= endMs && last > first) return tokens

	const sourceSpan = Math.max(1, last - first)
	const targetSpan = Math.max(1, endMs - startMs)
	return tokens.map((token) => {
		const fromMs = Math.round(startMs + ((token.fromMs - first) / sourceSpan) * targetSpan)
		const toMs = Math.round(startMs + ((token.toMs - first) / sourceSpan) * targetSpan)
		return { ...token, fromMs, toMs: Math.max(fromMs + 1, toMs) }
	})
}

/** Applies edited text or timings to one cue and re-times its words. */
export function updateCue(cue: CaptionCue, patch: Partial<CaptionCue>): CaptionCue {
	const next = { ...cue, ...patch }
	const startMs = Math.max(0, Math.round(next.startMs))
	const endMs = Math.max(startMs + 120, Math.round(next.endMs))
	const textChanged = patch.text !== undefined && patch.text !== cue.text
	const timingChanged = startMs !== cue.startMs || endMs !== cue.endMs

	if (textChanged || cue.tokens.length === 0) {
		return { ...next, startMs, endMs, tokens: timeWords(next.text, startMs, endMs) }
	}
	if (timingChanged) {
		return { ...next, startMs, endMs, tokens: clampTokens(cue.tokens, startMs, endMs, next.text) }
	}
	return { ...next, startMs, endMs }
}

/** Splits a cue in two at a word boundary. */
export function splitCue(cue: CaptionCue, tokenIndex: number): CaptionCue[] {
	const index = Math.min(Math.max(1, tokenIndex), cue.tokens.length - 1)
	if (cue.tokens.length < 2) return [cue]
	const left = cue.tokens.slice(0, index)
	const right = cue.tokens.slice(index)
	return [cueFromTokens(left), cueFromTokens(right)]
}

export function mergeCues(first: CaptionCue, second: CaptionCue): CaptionCue {
	return cueFromTokens([...first.tokens, ...second.tokens])
}

/** Nudges every cue, e.g. to fix a transcript that runs slightly ahead. */
export function shiftCues(cues: CaptionCue[], deltaMs: number, durationMs: number): CaptionCue[] {
	return normalizeCues(
		cues.map((cue) => ({
			...cue,
			startMs: cue.startMs + deltaMs,
			endMs: cue.endMs + deltaMs,
			tokens: cue.tokens.map((token) => ({
				...token,
				fromMs: token.fromMs + deltaMs,
				toMs: token.toMs + deltaMs,
			})),
		})),
		durationMs,
	)
}

/**
 * Subtitle readability pass.
 *
 * Transcribers happily emit 180ms cues, which read as a flash rather than a
 * line. This stretches a cue into the silence that follows it - never over the
 * next line, never past the video - so short lines get a comfortable hold
 * without the timings drifting away from the speech.
 */
export function enforceReadability(
	cues: CaptionCue[],
	options: { minCueMs: number; gapMs?: number; durationMs: number },
): CaptionCue[] {
	const gapMs = options.gapMs ?? 40
	const sorted = [...cues].sort((a, b) => a.startMs - b.startMs)

	return sorted.map((cue, index) => {
		const next = sorted[index + 1]
		const ceiling = next ? next.startMs - gapMs : options.durationMs
		const wanted = cue.startMs + options.minCueMs
		const endMs = Math.max(cue.endMs, Math.min(wanted, Math.max(cue.endMs, ceiling)))
		if (endMs === cue.endMs) return cue
		// Word timings stay exactly where the transcriber put them; only the last
		// word's tail is stretched, which is what the eye is actually holding on.
		const tokens = cue.tokens.map((token, tokenIndex) =>
			tokenIndex === cue.tokens.length - 1 ? { ...token, toMs: Math.max(token.toMs, endMs) } : token,
		)
		return { ...cue, endMs, tokens }
	})
}

/** How long the eye has per character - a rough legibility score for the UI. */
export function readabilityWarnings(cues: CaptionCue[], minCueMs: number): number {
	return cues.filter((cue) => cue.endMs - cue.startMs < minCueMs).length
}

export function cueAtMs(cues: CaptionCue[], ms: number): CaptionCue | null {
	return cues.find((cue) => ms >= cue.startMs && ms < cue.endMs) ?? null
}

export function countWords(cues: CaptionCue[]): number {
	return cues.reduce((sum, cue) => sum + cue.tokens.length, 0)
}
