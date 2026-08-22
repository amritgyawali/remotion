'use client'

/**
 * The cloud half of automatic captioning.
 *
 * The browser decodes the video's audio, conditions it, cuts it into chunks
 * small enough for a serverless request body, and streams them to
 * /api/captions/transcribe, which is the only place the NVIDIA key exists.
 * Chunks are uploaded a few at a time while later ones are still being decoded,
 * so a ten-minute clip does not wait for a full pass over its audio before the
 * first word comes back.
 *
 * What happens to the answer matters as much as getting one. A hosted
 * recogniser returns text and, if you are lucky, word timings; the text is
 * usually right and the timings are not always there at all. NVIDIA's hosted
 * Whisper function returns none, and the honest fallback - spread the words
 * evenly across the chunk - drifts seconds away from the speaker inside a
 * single minute of audio, which is exactly what makes captions feel broken.
 *
 * So the audio's own speech map, measured while it was being cut, is used to
 * place the words: on speech, never in a silence, weighted by how long each
 * word takes to say. When timings *are* returned they are checked against the
 * same map, the constant offset that every hosted model seems to carry is
 * measured and removed, and any word stranded in a pause is pulled back onto
 * the speech it belongs to.
 *
 * A chunk that fails is retried; a chunk that keeps failing costs its own
 * seconds of transcript and nothing more, and the caller is told which ones
 * they were. Losing one chunk must never lose the other nine.
 */

import { streamAudioChunks, type AudioChunk } from './audio'
import {
	alignmentReport,
	distributeOverSpeech,
	monotonic,
	snapWordsToSpeech,
	type AlignmentReport,
	type TimedWord,
} from './align'
import { mergeSegments, shiftSegments, type SpeechSegment } from './vad'
import { timeWords, type WordTiming } from './cues'
import type { CloudAsrStatus, CloudWord, TimingSource } from './asr-models'
import type { CaptionCue, TranscribeProgress } from './types'

const TRANSCRIBE_URL = '/api/captions/transcribe'
const REFINE_URL = '/api/captions/refine'

/** Enough parallelism to hide latency, few enough to stay polite to the API. */
const CHUNK_CONCURRENCY = 3
const CHUNK_ATTEMPTS = 3
/** Extraction and recognition share the progress bar in this proportion. */
const EXTRACT_SHARE = 0.3
const REFINE_BATCH = 40
/**
 * How much of a chunk's own opening the following chunk is allowed to overrule.
 *
 * When a boundary lands mid-word the next chunk carries the tail of this one at
 * the front of its blob, so it - and only it - saw that word whole. Its version
 * of the last fraction of a second therefore wins, and the truncated half the
 * earlier chunk produced is dropped.
 */
const BOUNDARY_TRIM_MS = 320
/** Repeats of the same word inside this window are one word heard twice. */
const DUPLICATE_WINDOW_MS = 600

export class CloudTranscriptionError extends Error {
	readonly code: string
	constructor(message: string, code = 'upstream') {
		super(message)
		this.name = 'CloudTranscriptionError'
		this.code = code
	}
}

let statusPromise: Promise<CloudAsrStatus> | null = null

/**
 * Asks the server whether cloud transcription is even possible. Cached, because
 * the answer only changes when the server restarts with a different key.
 */
export function cloudAsrStatus(force = false): Promise<CloudAsrStatus> {
	if (force) statusPromise = null
	statusPromise ??= fetch(TRANSCRIBE_URL, { method: 'GET', cache: 'no-store' })
		.then(async (response) => {
			if (!response.ok) throw new Error(`HTTP ${response.status}`)
			return (await response.json()) as CloudAsrStatus
		})
		.catch(
			(error: unknown): CloudAsrStatus => ({
				configured: false,
				reason: `The studio could not reach its own transcription endpoint (${
					error instanceof Error ? error.message : String(error)
				}).`,
				endpoints: [],
				models: [],
			}),
		)
	return statusPromise
}

type ChunkResult = {
	text: string
	words: CloudWord[]
	model: string
	endpoint: string
	estimatedTimings: boolean
}

async function postChunk(
	chunk: AudioChunk,
	args: { language: string; model: string | null; signal: AbortSignal },
): Promise<ChunkResult> {
	const form = new FormData()
	form.append('audio', chunk.blob, `chunk-${chunk.index}.wav`)
	form.append('language', args.language)
	// The blob is longer than the span the chunk owns whenever a boundary had to
	// be taken mid-word, and the recogniser must be told about the whole blob.
	form.append('durationMs', String(chunk.endMs - chunk.startMs + chunk.contextMs))
	form.append('contextMs', String(chunk.contextMs))
	form.append('fileName', `chunk-${chunk.index}.wav`)
	if (args.model) form.append('model', args.model)

	const response = await fetch(TRANSCRIBE_URL, {
		method: 'POST',
		body: form,
		signal: args.signal,
	})

	const payload = (await response.json().catch(() => null)) as
		| (ChunkResult & { error?: string; code?: string })
		| null

	if (!response.ok || !payload || payload.error) {
		const code = payload?.code ?? (response.status === 503 ? 'not-configured' : 'upstream')
		const message = payload?.error ?? `The transcription endpoint returned HTTP ${response.status}.`
		throw new CloudTranscriptionError(message, code)
	}

	return {
		text: typeof payload.text === 'string' ? payload.text : '',
		words: Array.isArray(payload.words) ? payload.words : [],
		model: payload.model,
		endpoint: payload.endpoint,
		estimatedTimings: payload.estimatedTimings === true,
	}
}

/** Credentials and configuration will not fix themselves on a retry. */
function isFatal(error: unknown): boolean {
	return (
		error instanceof CloudTranscriptionError &&
		(error.code === 'credentials' || error.code === 'not-configured')
	)
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(resolve, ms)
		signal.addEventListener(
			'abort',
			() => {
				clearTimeout(timer)
				reject(new DOMException('Aborted', 'AbortError'))
			},
			{ once: true },
		)
	})
}

async function postChunkWithRetries(
	chunk: AudioChunk,
	args: { language: string; model: string | null; signal: AbortSignal },
): Promise<ChunkResult> {
	let lastError: unknown
	for (let attempt = 1; attempt <= CHUNK_ATTEMPTS; attempt++) {
		try {
			return await postChunk(chunk, args)
		} catch (error) {
			if (args.signal.aborted) throw error
			if (isFatal(error)) throw error
			lastError = error
			if (attempt < CHUNK_ATTEMPTS) await delay(400 * attempt * attempt, args.signal)
		}
	}
	throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

export type CloudTranscribeArgs = {
	source: Blob
	language: string
	model: string | null
	durationSeconds: number
	onProgress: (progress: TranscribeProgress) => void
	signal: AbortSignal
}

export type CloudTranscribeResult = {
	words: WordTiming[]
	model: string
	endpoint: string
	chunks: number
	failedChunks: number
	estimatedTimings: boolean
	silent: boolean
	/** where speech is across the whole clip - cue grouping breaks on real pauses */
	speech: SpeechSegment[]
	/** the weakest way any chunk's timings were arrived at */
	timing: TimingSource
	/** how well the finished transcript sits on the audio */
	alignment: AlignmentReport
}

/* ------------------------------------------------------------- stitching */

/** Comparison key for "is this the same word": script and letters, nothing else. */
function wordKey(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]/gu, '')
		.normalize('NFC')
}

/**
 * Words that survive a chunk boundary can arrive twice - once at the end of one
 * chunk and once at the start of the next. Identical text inside a short window
 * is that duplicate, not a speaker repeating themselves; the two copies are
 * fused into the union of their spans so no time is lost either.
 */
function dedupe(words: TimedWord[]): TimedWord[] {
	const sorted = [...words].sort((left, right) => left.startMs - right.startMs)
	const kept: TimedWord[] = []
	for (const word of sorted) {
		const previous = kept[kept.length - 1]
		if (
			previous &&
			wordKey(previous.text) === wordKey(word.text) &&
			wordKey(word.text).length > 0 &&
			Math.abs(previous.startMs - word.startMs) < DUPLICATE_WINDOW_MS
		) {
			previous.endMs = Math.max(previous.endMs, word.endMs)
			// Prefer whichever spelling carries punctuation - it is the one the
			// recogniser saw in context rather than at a truncated edge.
			if (word.text.length > previous.text.length) previous.text = word.text
			continue
		}
		kept.push({ ...word })
	}
	return kept
}

function splitTokens(text: string): string[] {
	return text
		.replace(/\s+/g, ' ')
		.trim()
		.split(' ')
		.filter((token) => token.length > 0)
}

type ChunkTranscript = {
	index: number
	spanStartMs: number
	contextMs: number
	words: TimedWord[]
	timing: TimingSource
}

/**
 * Turns one chunk's answer into clip-relative, speech-aligned words.
 *
 * Everything the recogniser said is relative to the first sample of the blob,
 * which is `contextMs` before the span the chunk owns. Both branches end in the
 * same place - words sitting on measured speech - but they get there
 * differently: real timings are corrected, absent ones are constructed.
 */
function placeChunkWords(chunk: AudioChunk, result: ChunkResult): ChunkTranscript {
	const blobStartMs = chunk.startMs - chunk.contextMs
	const speech = shiftSegments(chunk.speech, blobStartMs)
	const blobEndMs = chunk.endMs

	let words: TimedWord[]
	let timing: TimingSource

	const recognised = result.words
		.map((word) => ({
			text: word.text.trim(),
			startMs: blobStartMs + Math.max(0, word.startMs),
			endMs: blobStartMs + Math.max(word.startMs + 1, word.endMs),
		}))
		.filter((word) => word.text.length > 0)

	if (!result.estimatedTimings && recognised.length > 0) {
		words = snapWordsToSpeech(recognised, speech, {
			limitMs: blobEndMs + BOUNDARY_TRIM_MS,
			maxShiftMs: 1_500,
		}).words
		timing = 'recogniser'
	} else {
		const tokens = splitTokens(result.text || recognised.map((word) => word.text).join(' '))
		words = distributeOverSpeech(tokens, speech, blobStartMs, blobEndMs)
		timing = speech.length > 0 ? 'aligned' : 'spread'
	}

	// The context region belongs to the previous chunk, except for the sliver
	// around the boundary itself, where this chunk is the better witness.
	const floor = chunk.contextMs > 0 ? chunk.startMs - BOUNDARY_TRIM_MS : -Infinity
	return {
		index: chunk.index,
		spanStartMs: chunk.startMs,
		contextMs: chunk.contextMs,
		timing,
		words: words.filter((word) => (word.startMs + word.endMs) / 2 >= floor),
	}
}

/** Lays the chunks end to end, letting each one overrule the boundary before it. */
function assemble(transcripts: ChunkTranscript[]): TimedWord[] {
	const ordered = [...transcripts].sort((left, right) => left.index - right.index)
	const out: TimedWord[] = []

	for (const transcript of ordered) {
		if (transcript.contextMs > 0 && transcript.words.length > 0) {
			const boundary = transcript.spanStartMs - BOUNDARY_TRIM_MS
			while (out.length > 0 && out[out.length - 1].startMs >= boundary) out.pop()
		}
		for (const word of transcript.words) out.push(word)
	}

	return out
}

/** The weakest link, because that is what the notice has to be honest about. */
function weakestTiming(transcripts: ChunkTranscript[]): TimingSource {
	if (transcripts.some((entry) => entry.timing === 'spread')) return 'spread'
	if (transcripts.some((entry) => entry.timing === 'aligned')) return 'aligned'
	return 'recogniser'
}

export async function transcribeInCloud(
	args: CloudTranscribeArgs,
): Promise<CloudTranscribeResult> {
	const { source, language, model, durationSeconds, onProgress, signal } = args

	const transcripts: ChunkTranscript[] = []
	const inflight = new Set<Promise<void>>()
	const failures: number[] = []
	// The upstream text is the only part of a failure a user can act on, so it
	// is carried all the way out instead of being replaced by a generic message.
	let lastError: string | null = null
	let fatal: unknown = null
	let started = 0
	let finished = 0
	let expected = 0
	let usedModel = model ?? ''
	let usedEndpoint = ''
	let estimatedTimings = false

	const report = (extractRatio: number) => {
		const extracted = Math.min(1, extractRatio)
		const recognised = expected > 0 ? finished / Math.max(expected, started) : 0
		const progress = extracted * EXTRACT_SHARE + recognised * (1 - EXTRACT_SHARE)
		onProgress({
			stage: finished > 0 || started > 0 ? 'transcribing' : 'extracting-audio',
			progress: Math.max(0, Math.min(0.99, progress)),
			message:
				started === 0
					? `Reading the audio - ${Math.round(extracted * 100)}%`
					: `Transcribing on NVIDIA - ${finished}/${Math.max(started, expected)} chunks`,
		})
	}

	const runChunk = async (chunk: AudioChunk) => {
		try {
			const result = await postChunkWithRetries(chunk, { language, model, signal })
			usedModel = result.model || usedModel
			usedEndpoint = result.endpoint || usedEndpoint
			estimatedTimings ||= result.estimatedTimings
			transcripts.push(placeChunkWords(chunk, result))
		} catch (error) {
			if (signal.aborted) throw error
			if (isFatal(error)) {
				fatal ??= error
				throw error
			}
			lastError = error instanceof Error ? error.message : String(error)
			failures.push(chunk.index)
		} finally {
			finished++
			report(1)
		}
	}

	const extraction = await streamAudioChunks({
		source,
		durationHintSeconds: durationSeconds,
		onProgress: (ratio) => report(ratio),
		signal,
		onChunk: async (chunk) => {
			if (fatal) throw fatal
			while (inflight.size >= CHUNK_CONCURRENCY) {
				await Promise.race([...inflight])
			}
			started++
			expected = Math.max(expected, started)
			report(1)
			// An abort or a credential failure is remembered rather than thrown
			// here: the pipeline drains first, then the caller sees one error.
			const guarded = runChunk(chunk).catch((error: unknown) => {
				fatal ??= error
			})
			let tracked: Promise<void>
			tracked = guarded.finally(() => {
				inflight.delete(tracked)
			})
			inflight.add(tracked)
		},
	})

	expected = extraction.chunks
	await Promise.all([...inflight])
	if (fatal) throw fatal

	if (failures.length === extraction.chunks && extraction.chunks > 0) {
		throw new CloudTranscriptionError(
			lastError ??
				'NVIDIA could not transcribe any part of that audio. Check the server logs for the endpoint error, or transcribe on this device instead.',
		)
	}

	onProgress({ stage: 'transcribing', progress: 0.99, message: 'Aligning the transcript' })

	const speech = mergeSegments(extraction.speech, 120)
	const stitched = dedupe(assemble(transcripts))

	// One last pass over the whole clip. Per-chunk correction cannot see an
	// offset that every chunk shares - a hosted model that pads its input, or a
	// track whose first packet is late - and that shared offset is precisely
	// what a viewer reads as the captions being out of sync with the mouth.
	const snapped = snapWordsToSpeech(stitched, speech, {
		maxShiftMs: 1_200,
		limitMs: Math.max(extraction.durationMs, durationSeconds * 1000),
	})

	const words = monotonic(snapped.words, { minWordMs: 60 })

	return {
		words,
		model: usedModel,
		endpoint: usedEndpoint,
		chunks: extraction.chunks,
		failedChunks: failures.length,
		estimatedTimings,
		silent: extraction.silent,
		speech,
		timing: weakestTiming(transcripts),
		alignment: alignmentReport(words, speech, snapped),
	}
}

/* ----------------------------------------------------------------- refine */

export type RefineResult = {
	cues: CaptionCue[]
	changed: number
	notice?: string
}

/**
 * Sends the caption text - never the audio - to an NVIDIA language model for a
 * punctuation and spelling pass, then puts the corrected words back on the
 * timings that came from the recogniser. A line whose word count survives keeps
 * its exact per-word timings; a line that gained or lost a word is re-timed
 * inside its own span, so nothing drifts outside the cue it belongs to.
 */
export async function refineCues(
	cues: CaptionCue[],
	args: { language: string; signal: AbortSignal; onProgress?: (ratio: number) => void },
): Promise<RefineResult> {
	if (cues.length === 0) return { cues, changed: 0 }

	const next = [...cues]
	let changed = 0
	let notice: string | undefined

	for (let start = 0; start < cues.length; start += REFINE_BATCH) {
		if (args.signal.aborted) break
		const batch = cues.slice(start, start + REFINE_BATCH)

		type RefinePayload = { lines?: unknown; changed?: unknown; notice?: unknown }
		let payload: RefinePayload | null = null
		try {
			const response = await fetch(REFINE_URL, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					lines: batch.map((cue) => cue.text),
					language: args.language,
				}),
				signal: args.signal,
			})
			payload = (await response.json()) as RefinePayload
		} catch (error) {
			if (args.signal.aborted) break
			notice ??= `The clean-up pass could not be reached (${
				error instanceof Error ? error.message : String(error)
			}). The transcript is exactly as recognised.`
			continue
		}

		const lines = Array.isArray(payload?.lines) ? payload.lines : []
		if (typeof payload?.notice === 'string') notice ??= payload.notice
		if (lines.length !== batch.length) continue

		batch.forEach((cue, offset) => {
			const line = typeof lines[offset] === 'string' ? (lines[offset] as string).trim() : ''
			if (!line || line === cue.text) return
			const tokens = line.split(/\s+/).filter(Boolean)
			changed++
			next[start + offset] = {
				...cue,
				text: line,
				tokens:
					tokens.length === cue.tokens.length
						? cue.tokens.map((token, index) => ({ ...token, text: tokens[index] }))
						: timeWords(line, cue.startMs, cue.endMs),
			}
		})

		args.onProgress?.(Math.min(1, (start + batch.length) / cues.length))
	}

	return { cues: next, changed, notice }
}
