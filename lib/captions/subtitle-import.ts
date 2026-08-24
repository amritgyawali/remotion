/**
 * Reading a subtitle file that came from somewhere else.
 *
 * Importing an .srt or .vtt looks trivial and is not: the three steps between
 * a tapped file and a cue list each fail in their own way, and each failure
 * used to surface as the same dead end ("no readable cues") or as a file
 * picker that would not let the user select anything at all.
 *
 *   1. Picking      - Android's Storage Access Framework and the iOS document
 *                     browser both resolve an `accept` list against the system
 *                     type database rather than against the filename, and
 *                     neither ships a type for `.srt` or `.vtt`. A filter that
 *                     reads fine on desktop therefore greys out every file on a
 *                     phone. `subtitleAccept()` drops the filter on those
 *                     platforms and we validate the bytes afterwards instead.
 *   2. Reading      - `File.text()` and `Blob.arrayBuffer()` are missing on
 *                     older mobile Safari, and a file handed over by a cloud
 *                     provider (Drive, OneDrive, Files "Recents") can go stale
 *                     between the pick and the read. Both need a real fallback
 *                     and a real error message.
 *   3. Decoding     - `File.text()` always decodes UTF-8. Subtitle files in the
 *                     wild are routinely UTF-16 (Windows tooling), UTF-8 with a
 *                     BOM, or legacy single-byte, and a Nepali .srt saved as
 *                     UTF-16 decodes to mojibake or to nothing. We sniff the
 *                     BOM, sniff for BOM-less UTF-16, and fall back to
 *                     windows-1252 when strict UTF-8 rejects the bytes.
 *
 * The parser itself is deliberately forgiving. It scans for timing lines
 * instead of splitting on blank lines, so a file whose cues are not separated
 * by an empty line still imports; it skips WebVTT `NOTE`/`STYLE`/`REGION`
 * blocks and cue identifiers; it understands SubRip, WebVTT and SubViewer
 * timing, including frame-based `HH:MM:SS:FF`; and it lifts WebVTT's inline
 * `<00:00:01.000>` markers into real word timing so an imported file drives the
 * karaoke styles from its own timestamps rather than from an estimate.
 */

import { cueFromTokens, makeCue, timeWords } from './cues'
import type { CaptionCue, CaptionToken } from './types'

/* ------------------------------------------------------------ file picking */

/** Extensions we offer in the picker and recognise on a dropped file. */
export const SUBTITLE_EXTENSIONS = ['.srt', '.vtt', '.webvtt', '.sbv', '.sub', '.txt'] as const

/**
 * Types a picker might report for a subtitle. `text/plain` and
 * `application/octet-stream` are in the list because that is what most Android
 * file managers and cloud providers actually hand back for an .srt.
 */
const SUBTITLE_MIME_TYPES = [
	'text/vtt',
	'text/srt',
	'text/plain',
	'application/x-subrip',
	'application/octet-stream',
] as const

/** The `accept` desktop browsers get: a real filter, with room for mislabelled files. */
export const SUBTITLE_ACCEPT = [...SUBTITLE_EXTENSIONS, ...SUBTITLE_MIME_TYPES].join(',')

/**
 * True where an `accept` list is more likely to hide the user's file than to
 * help them find it - phones and tablets, whose pickers filter by system type
 * and know no type for a subtitle. Safe to call during SSR, where it is false;
 * call it from an effect so the attribute is only relaxed after hydration.
 */
export function isRestrictiveFilePicker(): boolean {
	if (typeof navigator === 'undefined') return false
	const data = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData
	if (data?.mobile === true) return true
	const ua = navigator.userAgent || ''
	if (/Android|iPhone|iPod|Windows Phone/i.test(ua)) return true
	// iPadOS reports itself as a Mac; the touch points give it away.
	if (/iPad/i.test(ua)) return true
	return /Macintosh/i.test(ua) && navigator.maxTouchPoints > 1
}

/** What to put on the file input right now: no filter where a filter would hide everything. */
export function subtitleAccept(): string | undefined {
	return isRestrictiveFilePicker() ? undefined : SUBTITLE_ACCEPT
}

/**
 * A dropped or picked file that is probably a subtitle. Names arriving from a
 * share sheet often lose their extension, so an unknown type with a plausible
 * name is let through and the parser gets the final say.
 */
export function looksLikeSubtitleFile(file: File): boolean {
	const name = (file.name || '').toLowerCase()
	if (SUBTITLE_EXTENSIONS.some((extension) => name.endsWith(extension))) return true
	const type = (file.type || '').toLowerCase()
	if (type === '' || type === 'application/octet-stream') return true
	return SUBTITLE_MIME_TYPES.includes(type as (typeof SUBTITLE_MIME_TYPES)[number])
}

/* ---------------------------------------------------------------- reading */

/** A subtitle for a feature film is well under a megabyte; past this it is not one. */
export const MAX_SUBTITLE_BYTES = 16 * 1024 * 1024

/** A failure the user can act on - every message says what to do next. */
export class SubtitleImportError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'SubtitleImportError'
	}
}

/** `Blob.arrayBuffer()` is missing on Safari below 14; FileReader is not. */
function readWithFileReader(file: File): Promise<ArrayBuffer> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader()
		reader.onload = () => resolve(reader.result as ArrayBuffer)
		reader.onerror = () =>
			reject(reader.error ?? new Error('The file could not be read from this device.'))
		reader.readAsArrayBuffer(file)
	})
}

export type DecodedSubtitle = {
	text: string
	/** The encoding the bytes were read as, for the "imported as..." note. */
	encoding: string
}

const ENCODING_LABEL: Record<string, string> = {
	'utf-8': 'UTF-8',
	'utf-16le': 'UTF-16',
	'utf-16be': 'UTF-16 BE',
	'windows-1252': 'Windows-1252',
}

function decodeWith(bytes: Uint8Array, encoding: string, fatal: boolean): string {
	// The BOM handling above already sliced any mark off, so never let the
	// decoder strip a second "BOM" that is really the first character.
	return new TextDecoder(encoding, { fatal, ignoreBOM: false }).decode(bytes)
}

/**
 * Bytes to text, the way a subtitle editor does it: honour a BOM, sniff
 * BOM-less UTF-16 by its NUL pattern, then try strict UTF-8 and fall back to
 * the single-byte encoding that legacy tools wrote.
 */
export function decodeSubtitleBytes(buffer: ArrayBuffer): DecodedSubtitle {
	const bytes = new Uint8Array(buffer)
	if (bytes.length === 0) {
		throw new SubtitleImportError('That file is empty - there is nothing to import.')
	}

	// A byte order mark is the one unambiguous signal, so it wins outright.
	if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
		return { text: decodeWith(bytes.subarray(3), 'utf-8', false), encoding: ENCODING_LABEL['utf-8'] }
	}
	if (bytes[0] === 0xff && bytes[1] === 0xfe) {
		return {
			text: decodeWith(bytes.subarray(2), 'utf-16le', false),
			encoding: ENCODING_LABEL['utf-16le'],
		}
	}
	if (bytes[0] === 0xfe && bytes[1] === 0xff) {
		return {
			text: decodeWith(bytes.subarray(2), 'utf-16be', false),
			encoding: ENCODING_LABEL['utf-16be'],
		}
	}

	// No mark: UTF-16 text is half NUL bytes, and which half says which endian.
	const sample = bytes.subarray(0, Math.min(bytes.length, 2048))
	let evenNulls = 0
	let oddNulls = 0
	for (let index = 0; index < sample.length; index++) {
		if (sample[index] !== 0) continue
		if (index % 2 === 0) evenNulls++
		else oddNulls++
	}
	if (evenNulls + oddNulls > sample.length / 4) {
		const encoding = oddNulls >= evenNulls ? 'utf-16le' : 'utf-16be'
		return { text: decodeWith(bytes, encoding, false), encoding: ENCODING_LABEL[encoding] }
	}

	try {
		return { text: decodeWith(bytes, 'utf-8', true), encoding: ENCODING_LABEL['utf-8'] }
	} catch {
		// Not valid UTF-8: almost always a subtitle saved by an older Windows
		// tool. windows-1252 maps every byte, so this can no longer throw - but
		// keep a lossy UTF-8 pass for the runtime that lacks the legacy table.
		try {
			return {
				text: decodeWith(bytes, 'windows-1252', false),
				encoding: ENCODING_LABEL['windows-1252'],
			}
		} catch {
			return { text: decodeWith(bytes, 'utf-8', false), encoding: ENCODING_LABEL['utf-8'] }
		}
	}
}

/** Picked file to decoded text, with a usable message for every way it can fail. */
export async function readSubtitleFile(file: File): Promise<DecodedSubtitle> {
	if (file.size > MAX_SUBTITLE_BYTES) {
		throw new SubtitleImportError(
			`${file.name} is ${Math.round(file.size / 1024 / 1024)} MB. A subtitle file is a few hundred kilobytes at most - this looks like a different kind of file.`,
		)
	}
	if (file.size === 0) {
		throw new SubtitleImportError(
			`${file.name} is empty. If you picked it from a cloud folder, download it to this device first and try again.`,
		)
	}

	let buffer: ArrayBuffer
	try {
		buffer =
			typeof file.arrayBuffer === 'function' ? await file.arrayBuffer() : await readWithFileReader(file)
	} catch {
		// Android and iOS both hand out short-lived handles for files that live
		// in a cloud provider, and reading one after it expires lands here.
		throw new SubtitleImportError(
			`${file.name} could not be read. If it came from Drive, iCloud or another cloud folder, download it to this device and pick it again.`,
		)
	}

	return decodeSubtitleBytes(buffer)
}

/* ---------------------------------------------------------------- parsing */

export type SubtitleFormat = 'srt' | 'vtt' | 'sbv' | 'unknown'

export type SubtitleImportResult = {
	cues: CaptionCue[]
	format: SubtitleFormat
	/** Cues whose word timing came from the file rather than being estimated. */
	wordTimedCues: number
	/** Recoverable oddities worth telling the user about, never fatal. */
	warnings: string[]
}

export type ParseSubtitleOptions = {
	/** Used only to read frame-based `HH:MM:SS:FF` timing. */
	fps?: number
}

const FORMAT_LABEL: Record<SubtitleFormat, string> = {
	srt: 'SubRip (.srt)',
	vtt: 'WebVTT (.vtt)',
	sbv: 'SubViewer (.sbv)',
	unknown: 'subtitles',
}

export function subtitleFormatLabel(format: SubtitleFormat): string {
	return FORMAT_LABEL[format]
}

/** Direction marks and zero-width joins ride along in shared files and break the timing regex. */
const INVISIBLES = /[​‎‏‪-‮⁦-⁩﻿]/g

const TIMECODE = /^(?:(\d{1,4}):)?(\d{1,3}):(\d{1,2})(?:([.,])(\d{1,3})|:(\d{1,3}))?$/

/**
 * One timestamp to milliseconds. Accepts `HH:MM:SS,mmm` (SubRip),
 * `HH:MM:SS.mmm` and `MM:SS.mmm` (WebVTT), a one or two digit fraction, and
 * `HH:MM:SS:FF`, whose last field is frames rather than a fraction.
 */
export function parseTimecode(value: string, fps = 25): number | null {
	const match = value.replace(INVISIBLES, '').trim().match(TIMECODE)
	if (!match) return null
	const [, hours, minutes, seconds, , fraction, frames] = match
	const base =
		Number(hours ?? 0) * 3_600_000 + Number(minutes) * 60_000 + Number(seconds) * 1000
	if (fraction !== undefined) return base + Number(fraction.padEnd(3, '0'))
	if (frames !== undefined) {
		const rate = Number.isFinite(fps) && fps > 0 ? fps : 25
		return base + Math.round((Number(frames) / rate) * 1000)
	}
	return base
}

type TimingLine = { startMs: number; endMs: number }

/** A cue's timing line, in any of the three dialects, or null if this is text. */
function readTimingLine(line: string, fps: number): TimingLine | null {
	const clean = line.replace(INVISIBLES, '').trim()
	if (clean.length === 0) return null

	// SubRip and WebVTT: "start --> end [settings]". Some exporters write a
	// single arrow or an en dash, so accept those too.
	const arrow = clean.match(/^(.*?)\s*(?:-{1,3}>|–>|—>|=>)\s*(.*)$/)
	if (arrow) {
		const startMs = parseTimecode(arrow[1], fps)
		// WebVTT allows cue settings after the end timestamp: "00:02.000 line:90%".
		const endMs = parseTimecode(arrow[2].trim().split(/\s+/)[0] ?? '', fps)
		if (startMs === null || endMs === null) return null
		return { startMs, endMs }
	}

	// SubViewer: "0:00:01.000,0:00:03.000". Guarded by the fraction so a line of
	// dialogue that merely contains a comma is never mistaken for timing.
	const sbv = clean.match(/^([\d:.,]+?[.,]\d{1,3}),([\d:.,]+?[.,]\d{1,3})$/)
	if (sbv) {
		const startMs = parseTimecode(sbv[1], fps)
		const endMs = parseTimecode(sbv[2], fps)
		if (startMs === null || endMs === null) return null
		return { startMs, endMs }
	}

	return null
}

/**
 * The entities that actually turn up in subtitle payloads: the five XML ones,
 * the punctuation an editor inserts, and the Latin-1 letters a European
 * subtitle carries. Anything else is left alone rather than guessed at.
 */
const NAMED_ENTITIES: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: ' ',
	hellip: '\u2026',
	mdash: '\u2014',
	ndash: '\u2013',
	rsquo: '\u2019',
	lsquo: '\u2018',
	rdquo: '\u201d',
	ldquo: '\u201c',
	laquo: '\u00ab',
	raquo: '\u00bb',
	deg: '\u00b0',
	eacute: '\u00e9',
	Eacute: '\u00c9',
	egrave: '\u00e8',
	agrave: '\u00e0',
	ccedil: '\u00e7',
	uuml: '\u00fc',
	ouml: '\u00f6',
	auml: '\u00e4',
	Uuml: '\u00dc',
	Ouml: '\u00d6',
	Auml: '\u00c4',
	szlig: '\u00df',
	ntilde: '\u00f1',
	iacute: '\u00ed',
	oacute: '\u00f3',
	uacute: '\u00fa',
	aacute: '\u00e1',
	ocirc: '\u00f4',
	ecirc: '\u00ea',
	acirc: '\u00e2',
	iquest: '\u00bf',
	iexcl: '\u00a1',
	middot: '\u00b7',
	bull: '\u2022',
	lrm: '',
	rlm: '',
}

function decodeEntities(text: string): string {
	return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (whole, body: string) => {
		if (body.startsWith('#')) {
			const code = body[1]?.toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : Number(body.slice(1))
			if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole
			try {
				return String.fromCodePoint(code)
			} catch {
				return whole
			}
		}
		return NAMED_ENTITIES[body.toLowerCase()] ?? whole
	})
}

/**
 * Cue payload to the words a viewer should see: markup out, entities in, and
 * the positioning overrides that .srt files inherited from ASS dropped.
 */
function cleanCueText(raw: string): string {
	return decodeEntities(
		raw
			// <b>, <i>, <c.yellow>, <v Roger>, and WebVTT's inline <00:00:01.000>
			.replace(/<[^>]*>/g, '')
			// {\an8}, {\i1}, {\pos(...)} - ASS overrides that leak into .srt
			.replace(/\{\\[^}]*\}/g, '')
			.replace(INVISIBLES, ''),
	)
		.replace(/[ \t ]+/g, ' ')
		.trim()
}

/**
 * An .srt sequence number, or a WebVTT cue identifier, that belongs to the cue
 * *below* rather than to the text above it.
 *
 * The test is deliberately narrow. WebVTT identifiers are optional and rare,
 * while a line of dialogue that happens to be one short word is not; a loose
 * heuristic here silently deletes transcript, which is the worst thing this
 * importer could do. So: a bare number always, and otherwise only a
 * single token that carries a digit or a separator - `cue-3`, `c12`, `s1_04`.
 */
function isCueLabel(line: string): boolean {
	const clean = line.replace(INVISIBLES, '').trim()
	if (clean.length === 0) return false
	if (/^\d{1,6}\.?$/.test(clean)) return true
	if (clean.length > 40) return false
	return /^[A-Za-z][A-Za-z0-9_.\-]*$/.test(clean) && /[\d_\-]/.test(clean)
}

/**
 * WebVTT's inline timestamps to real word timing.
 *
 * `<00:00:01.000><c>word</c>` marks when each word is spoken; the studio's
 * karaoke styles want exactly that, so a file carrying them should not have its
 * timing thrown away and re-estimated. Words before the first marker, and words
 * in a run between two markers, are spread across their own span by the same
 * weighting the transcriber uses.
 */
function tokensFromInlineTimings(
	payload: string,
	startMs: number,
	endMs: number,
	fps: number,
): CaptionToken[] | null {
	const markers = [...payload.matchAll(/<(\d{1,4}:)?\d{1,3}:\d{1,2}[.,]\d{1,3}>/g)]
	if (markers.length === 0) return null

	const chunks: { atMs: number | null; text: string }[] = []
	let cursor = 0
	let pendingStart: number | null = null
	for (const marker of markers) {
		const index = marker.index ?? 0
		chunks.push({ atMs: pendingStart, text: cleanCueText(payload.slice(cursor, index)) })
		pendingStart = parseTimecode(marker[0].slice(1, -1), fps)
		cursor = index + marker[0].length
	}
	chunks.push({ atMs: pendingStart, text: cleanCueText(payload.slice(cursor)) })

	const filled = chunks.filter((chunk) => chunk.text.length > 0)
	if (filled.length === 0) return null

	const tokens: CaptionToken[] = []
	for (let index = 0; index < filled.length; index++) {
		const chunk = filled[index]
		const from = chunk.atMs ?? (tokens[tokens.length - 1]?.toMs ?? startMs)
		const nextStart = filled.slice(index + 1).find((entry) => entry.atMs !== null)?.atMs ?? endMs
		const to = Math.max(from + 1, nextStart)
		tokens.push(...timeWords(chunk.text, Math.max(startMs, from), Math.min(endMs, to)))
	}
	return tokens.length > 0 ? tokens : null
}

function detectFormat(text: string, hasArrow: boolean, hasSbv: boolean): SubtitleFormat {
	if (/^﻿?WEBVTT/i.test(text.trimStart())) return 'vtt'
	if (hasArrow) return 'srt'
	if (hasSbv) return 'sbv'
	return 'unknown'
}

/**
 * Subtitle text to cues.
 *
 * Timing lines are the anchors, not blank lines: a file whose cues run together
 * without a separating newline - which several popular exporters produce, and
 * which the previous reader collapsed into one enormous cue - imports exactly
 * like a well-formed one.
 */
export function parseSubtitleText(
	input: string,
	options: ParseSubtitleOptions = {},
): SubtitleImportResult {
	const fps = options.fps && options.fps > 0 ? options.fps : 25
	const normalized = input.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
	const lines = normalized.split('\n')

	const warnings: string[] = []
	const cues: CaptionCue[] = []
	let wordTimedCues = 0
	let unreadableTimings = 0
	let emptyCues = 0
	let repairedSpans = 0
	let sawArrow = false
	let sawSbv = false

	// One pass: collect each timing line and the payload lines under it.
	type Pending = { timing: TimingLine; payload: string[] }
	let pending: Pending | null = null

	const flush = () => {
		if (!pending) return
		const current = pending
		pending = null

		// A trailing sequence number belongs to the next cue, not to this text.
		// Never take the last line away: a cue whose only line reads "12" is a
		// caption that says twelve, not a stray index.
		while (current.payload.length > 1 && isCueLabel(current.payload[current.payload.length - 1])) {
			current.payload.pop()
		}
		const payload = current.payload.join('\n')
		const text = cleanCueText(payload.replace(/\n+/g, ' '))
		if (text.length === 0) {
			emptyCues++
			return
		}

		let { startMs, endMs } = current.timing
		startMs = Math.max(0, startMs)
		if (endMs <= startMs) {
			// Zero-length and reversed spans are common in hand-edited files.
			// Give the line the time its own length asks for rather than dropping it.
			endMs = startMs + Math.max(800, Math.min(7000, text.length * 60))
			repairedSpans++
		}

		const tokens = tokensFromInlineTimings(payload, startMs, endMs, fps)
		if (tokens) {
			wordTimedCues++
			const cue = cueFromTokens(tokens)
			cues.push({ ...cue, text, startMs, endMs })
			return
		}
		cues.push(makeCue(text, startMs, endMs))
	}

	for (let index = 0; index < lines.length; index++) {
		const line = lines[index]
		const trimmed = line.replace(INVISIBLES, '').trim()

		// WebVTT header and its blocks carry no dialogue; skip to the next blank line.
		if (pending === null && /^(WEBVTT|NOTE|STYLE|REGION)\b/i.test(trimmed)) {
			while (index + 1 < lines.length && lines[index + 1].trim().length > 0) index++
			continue
		}

		const timing = readTimingLine(line, fps)
		if (timing) {
			if (trimmed.includes('>')) sawArrow = true
			else sawSbv = true
			flush()
			pending = { timing, payload: [] }
			continue
		}

		if (pending) {
			if (trimmed.length > 0) pending.payload.push(trimmed)
			continue
		}

		// Text before the first timing line (a stray header, an .srt index) is
		// dropped, but a line that fails to parse *as* timing is worth counting.
		if (trimmed.includes('-->')) unreadableTimings++
	}
	flush()

	if (unreadableTimings > 0) {
		warnings.push(
			`${unreadableTimings} line${unreadableTimings === 1 ? '' : 's'} looked like timing but could not be read, so ${unreadableTimings === 1 ? 'its cue was' : 'those cues were'} skipped.`,
		)
	}
	if (emptyCues > 0) {
		warnings.push(`${emptyCues} cue${emptyCues === 1 ? '' : 's'} had no text and ${emptyCues === 1 ? 'was' : 'were'} skipped.`)
	}
	if (repairedSpans > 0) {
		warnings.push(
			`${repairedSpans} cue${repairedSpans === 1 ? '' : 's'} had no duration in the file and ${repairedSpans === 1 ? 'was' : 'were'} given a readable one.`,
		)
	}

	cues.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)

	return {
		cues,
		format: detectFormat(normalized, sawArrow, sawSbv),
		wordTimedCues,
		warnings,
	}
}

/**
 * Why a file produced nothing, phrased so the user knows which of the three
 * recoveries to reach for: a different export, the Write tab, or a re-save.
 */
export function explainEmptyImport(text: string, label: string): string {
	const trimmed = text.trim()
	if (trimmed.length === 0) {
		return `${label} is empty. Export the subtitles again and pick the new file.`
	}
	// Replacement characters mean the bytes never decoded to text at all.
	const damaged = (trimmed.match(/�/g) ?? []).length
	if (damaged > trimmed.length / 20) {
		return `${label} does not look like text - it may be a compressed or binary file. Open it in a subtitle editor and save it again as .srt or .vtt.`
	}
	if (!trimmed.includes('-->') && !/\d{1,2}:\d{2}/.test(trimmed)) {
		return `${label} has no timestamps in it, so there is nothing to place on the timeline. Paste its text into the Write tab and let the studio time it for you.`
	}
	return `${label} has timestamps the studio could not read. Re-export it as SubRip (.srt) or WebVTT (.vtt) and try again.`
}

/** The whole import, from a picked file to cues, as the panel needs it. */
export async function importSubtitleFile(
	file: File,
	options: ParseSubtitleOptions = {},
): Promise<SubtitleImportResult & { encoding: string; name: string }> {
	const { text, encoding } = await readSubtitleFile(file)
	const result = parseSubtitleText(text, options)
	if (result.cues.length === 0) {
		throw new SubtitleImportError(explainEmptyImport(text, file.name || 'That file'))
	}
	return { ...result, encoding, name: file.name || 'subtitles' }
}
