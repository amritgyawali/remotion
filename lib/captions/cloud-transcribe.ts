'use client'

/**
 * The cloud half of automatic captioning.
 *
 * The browser decodes the video's audio, cuts it into chunks small enough for a
 * serverless request body, and streams them to /api/captions/transcribe, which
 * is the only place the NVIDIA key exists. Chunks are uploaded a few at a time
 * while later ones are still being decoded, so a ten-minute clip does not wait
 * for a full pass over its audio before the first word comes back.
 *
 * A chunk that fails is retried; a chunk that keeps failing costs its own
 * seconds of transcript and nothing more, and the caller is told which ones
 * they were. Losing one chunk must never lose the other nine.
 */

import { streamAudioChunks, type AudioChunk } from './audio'
import { timeWords, type WordTiming } from './cues'
import type { CloudAsrStatus, CloudWord } from './asr-models'
import type { CaptionCue, TranscribeProgress } from './types'

const TRANSCRIBE_URL = '/api/captions/transcribe'
const REFINE_URL = '/api/captions/refine'

/** Enough parallelism to hide latency, few enough to stay polite to the API. */
const CHUNK_CONCURRENCY = 3
const CHUNK_ATTEMPTS = 3
/** Extraction and recognition share the progress bar in this proportion. */
const EXTRACT_SHARE = 0.3
const REFINE_BATCH = 40

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
	form.append('durationMs', String(chunk.endMs - chunk.startMs))
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
}

/**
 * Words that survive a chunk boundary can arrive twice - once at the end of one
 * chunk and once at the start of the next. Identical text inside a 400 ms window
 * is that duplicate, not a speaker repeating themselves.
 */
function dedupe(words: WordTiming[]): WordTiming[] {
	const sorted = [...words].sort((left, right) => left.startMs - right.startMs)
	const kept: WordTiming[] = []
	for (const word of sorted) {
		const previous = kept[kept.length - 1]
		if (
			previous &&
			previous.text === word.text &&
			Math.abs(previous.startMs - word.startMs) < 400
		) {
			previous.endMs = Math.max(previous.endMs, word.endMs)
			continue
		}
		kept.push({ ...word })
	}
	return kept
}

export async function transcribeInCloud(
	args: CloudTranscribeArgs,
): Promise<CloudTranscribeResult> {
	const { source, language, model, durationSeconds, onProgress, signal } = args

	const words: WordTiming[] = []
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
			for (const word of result.words) {
				const text = word.text.trim()
				if (!text) continue
				words.push({
					text,
					startMs: chunk.startMs + word.startMs,
					endMs: chunk.startMs + Math.max(word.endMs, word.startMs + 1),
				})
			}
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

	onProgress({ stage: 'transcribing', progress: 0.99, message: 'Merging the transcript' })

	return {
		words: dedupe(words),
		model: usedModel,
		endpoint: usedEndpoint,
		chunks: extraction.chunks,
		failedChunks: failures.length,
		estimatedTimings,
		silent: extraction.silent,
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
