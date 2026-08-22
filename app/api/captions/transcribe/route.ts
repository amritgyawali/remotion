/**
 * Speech -> timed words, on NVIDIA's hosted recognisers.
 *
 * The browser sends one chunk of 16 kHz mono WAV per request and this route
 * forwards it to NVIDIA with the API key that never leaves the server. Two
 * request dialects are spoken, because NVIDIA's speech endpoints answer to
 * both: the OpenAI-compatible `/v1/audio/transcriptions` form used by the NIM
 * microservices, and the Riva form (`language=en-US`, `word_time_offsets`) used
 * by the NVCF function endpoints. The first pairing that answers is remembered
 * for the life of the instance, so only the first chunk pays for probing.
 *
 * Everything the endpoints return - OpenAI verbose JSON, Riva results, or a
 * bare string of text - is normalised into the same word list, and the client
 * offsets those timings by where the chunk sat in the clip.
 */

import {
	CLOUD_ASR_MODELS,
	cloudModelForLanguage,
	isCloudAsrModel,
	rivaLocale,
	type CloudWord,
} from '../../../../lib/captions/asr-models'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const DEFAULT_ENDPOINTS = [
	'https://integrate.api.nvidia.com/v1/audio/transcriptions',
	'https://ai.api.nvidia.com/v1/audio/transcriptions',
]

/** A chunk is ~3.2 MB of WAV; anything much larger is not from this studio. */
const MAX_AUDIO_BYTES = 12 * 1024 * 1024
const REQUEST_TIMEOUT_MS = 120_000

type Dialect = 'openai' | 'riva'
type Candidate = { endpoint: string; dialect: Dialect }

/** Remembered across requests on a warm instance so probing happens once. */
let preferred: Candidate | null = null

function apiKey(): string | null {
	const key = process.env.NVIDIA_API_KEY?.trim()
	return key ? key : null
}

function endpoints(): string[] {
	const list: string[] = []
	const explicit = process.env.NVIDIA_ASR_ENDPOINT?.trim()
	if (explicit) list.push(explicit)

	const functionId = process.env.NVIDIA_ASR_FUNCTION_ID?.trim()
	if (functionId) {
		list.push(`https://${functionId}.invocation.api.nvcf.nvidia.com/v1/audio/transcriptions`)
	}

	for (const endpoint of DEFAULT_ENDPOINTS) list.push(endpoint)
	return [...new Set(list)]
}

function candidates(): Candidate[] {
	const all: Candidate[] = []
	for (const endpoint of endpoints()) {
		all.push({ endpoint, dialect: 'openai' }, { endpoint, dialect: 'riva' })
	}
	if (!preferred) return all
	// Keep the known-good pairing first, but never drop the rest: a model change
	// can make yesterday's winner the wrong dialect.
	const rest = all.filter(
		(candidate) =>
			candidate.endpoint !== preferred?.endpoint || candidate.dialect !== preferred?.dialect,
	)
	return [preferred, ...rest]
}

function modelFor(requested: string | null, language: string): string {
	const override = process.env.NVIDIA_ASR_MODEL?.trim()
	if (override) return override
	if (requested && isCloudAsrModel(requested)) return requested
	return cloudModelForLanguage(language)
}

/* ------------------------------------------------------------- normalising */

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
	return typeof value === 'object' && value !== null
}

function firstString(source: UnknownRecord, keys: string[]): string | null {
	for (const key of keys) {
		const value = source[key]
		if (typeof value === 'string' && value.trim().length > 0) return value
	}
	return null
}

function firstNumber(source: UnknownRecord, keys: string[]): number | null {
	for (const key of keys) {
		const value = source[key]
		if (typeof value === 'number' && Number.isFinite(value)) return value
		if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
			return Number(value)
		}
	}
	return null
}

type RawWord = { text: string; start: number; end: number }

function collectWords(value: unknown, into: RawWord[]): void {
	if (!Array.isArray(value)) return
	for (const entry of value) {
		if (!isRecord(entry)) continue
		const text = firstString(entry, ['word', 'text', 'value'])
		const start = firstNumber(entry, ['start', 'start_time', 'startTime', 'startMs', 'start_ms', 'offset'])
		const end = firstNumber(entry, ['end', 'end_time', 'endTime', 'endMs', 'end_ms'])
		if (!text || start === null || end === null) continue
		into.push({ text: text.trim(), start, end })
	}
}

/**
 * Endpoints disagree on units: OpenAI-shaped payloads count seconds, Riva
 * counts milliseconds. The chunk duration settles it - a chunk is at most a
 * couple of minutes, so a value far beyond that cannot be seconds.
 */
function toMilliseconds(words: RawWord[], durationMs: number): CloudWord[] {
	let largest = 0
	for (const word of words) largest = Math.max(largest, word.end, word.start)
	const seconds = largest <= Math.max(1, durationMs / 1000) * 1.5 + 1
	const scale = seconds ? 1000 : 1

	return words
		.map((word) => {
			const startMs = Math.max(0, Math.round(word.start * scale))
			const endMs = Math.max(startMs + 1, Math.round(word.end * scale))
			return { text: word.text, startMs, endMs }
		})
		.filter((word) => word.text.length > 0)
		.sort((left, right) => left.startMs - right.startMs)
}

/** Spreads a plain transcript over the chunk when no timings came back. */
function spreadWords(text: string, durationMs: number): CloudWord[] {
	const words = text.split(/\s+/).filter((word) => word.length > 0)
	if (words.length === 0) return []
	const weights = words.map((word) => Math.max(1, word.replace(/[^\p{L}\p{N}]/gu, '').length))
	const total = weights.reduce((sum, weight) => sum + weight, 0)

	let cursor = 0
	return words.map((word, index) => {
		const share = (weights[index] / total) * durationMs
		const startMs = Math.round(cursor)
		cursor += share
		const endMs = index === words.length - 1 ? durationMs : Math.round(cursor)
		return { text: word, startMs, endMs: Math.max(startMs + 1, endMs) }
	})
}

function normalise(
	payload: unknown,
	durationMs: number,
): { text: string; words: CloudWord[]; estimated: boolean } | null {
	if (typeof payload === 'string') {
		const text = payload.trim()
		return text ? { text, words: spreadWords(text, durationMs), estimated: true } : null
	}
	if (!isRecord(payload)) return null

	const raw: RawWord[] = []
	collectWords(payload.words, raw)

	// OpenAI verbose JSON: segments, each optionally carrying its own words.
	const segments = Array.isArray(payload.segments) ? payload.segments : []
	const segmentTexts: string[] = []
	for (const segment of segments) {
		if (!isRecord(segment)) continue
		collectWords(segment.words, raw)
		const text = firstString(segment, ['text', 'transcript'])
		if (text) segmentTexts.push(text.trim())
	}

	// Riva: results -> alternatives -> { transcript, words }.
	const results = Array.isArray(payload.results) ? payload.results : []
	const resultTexts: string[] = []
	for (const result of results) {
		if (!isRecord(result)) continue
		const alternatives = Array.isArray(result.alternatives) ? result.alternatives : []
		for (const alternative of alternatives) {
			if (!isRecord(alternative)) continue
			collectWords(alternative.words, raw)
			const transcript = firstString(alternative, ['transcript', 'text'])
			if (transcript) resultTexts.push(transcript.trim())
			break // the first alternative is the most likely one
		}
	}

	const words = toMilliseconds(raw, durationMs)
	const text =
		firstString(payload, ['text', 'transcript']) ??
		(segmentTexts.length > 0 ? segmentTexts.join(' ') : resultTexts.join(' ')) ??
		''
	const joined = (text || words.map((word) => word.text).join(' ')).trim()

	if (words.length > 0) return { text: joined, words, estimated: false }
	if (joined.length > 0) return { text: joined, words: spreadWords(joined, durationMs), estimated: true }
	return null
}

/* ------------------------------------------------------------- upstream */

function buildForm(args: {
	dialect: Dialect
	audio: Blob
	fileName: string
	model: string
	language: string
}): FormData {
	const form = new FormData()
	form.append('file', args.audio, args.fileName)

	if (args.dialect === 'openai') {
		form.append('model', args.model)
		form.append('response_format', 'verbose_json')
		form.append('timestamp_granularities[]', 'word')
		form.append('timestamp_granularities[]', 'segment')
		if (args.language !== 'auto') form.append('language', args.language)
		return form
	}

	form.append('language', rivaLocale(args.language))
	form.append('word_time_offsets', 'true')
	form.append('automatic_punctuation', 'true')
	if (process.env.NVIDIA_ASR_MODEL?.trim()) form.append('model', args.model)
	return form
}

async function readPayload(response: Response): Promise<unknown> {
	const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
	const body = await response.text()
	if (!body.trim()) return null
	if (contentType.includes('json') || body.trimStart().startsWith('{')) {
		try {
			return JSON.parse(body) as unknown
		} catch {
			return body
		}
	}
	return body
}

function errorText(payload: unknown, status: number): string {
	if (typeof payload === 'string' && payload.trim()) return payload.trim().slice(0, 300)
	if (isRecord(payload)) {
		const error = payload.error
		if (typeof error === 'string') return error.slice(0, 300)
		if (isRecord(error)) {
			const message = firstString(error, ['message', 'detail', 'title'])
			if (message) return message.slice(0, 300)
		}
		const message = firstString(payload, ['message', 'detail', 'title'])
		if (message) return message.slice(0, 300)
	}
	return `NVIDIA returned HTTP ${status}.`
}

class CredentialError extends Error {}

async function callNvidia(args: {
	candidate: Candidate
	audio: Blob
	fileName: string
	model: string
	language: string
	key: string
}): Promise<unknown> {
	const form = buildForm({
		dialect: args.candidate.dialect,
		audio: args.audio,
		fileName: args.fileName,
		model: args.model,
		language: args.language,
	})

	const response = await fetch(args.candidate.endpoint, {
		method: 'POST',
		headers: { Authorization: `Bearer ${args.key}`, Accept: 'application/json' },
		body: form,
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
	})

	const payload = await readPayload(response)
	if (response.ok) return payload

	const message = errorText(payload, response.status)
	if (response.status === 401 || response.status === 403) throw new CredentialError(message)
	throw new Error(message)
}

/* ------------------------------------------------------------------ route */

export function GET() {
	const configured = apiKey() !== null
	return Response.json(
		{
			configured,
			reason: configured
				? undefined
				: 'NVIDIA_API_KEY is not set on the server, so cloud transcription is off. Add a generated nvapi- key to .env.local, or transcribe on this device instead.',
			endpoints: endpoints(),
			models: CLOUD_ASR_MODELS,
			verified: preferred ? { endpoint: preferred.endpoint, model: 'ok' } : null,
		},
		{ headers: { 'cache-control': 'no-store' } },
	)
}

export async function POST(request: Request) {
	const key = apiKey()
	if (!key) {
		return Response.json(
			{
				error:
					'NVIDIA_API_KEY is not set on the server, so cloud transcription is unavailable. Switch the engine to on-device, or add a key to .env.local and restart.',
				code: 'not-configured',
			},
			{ status: 503 },
		)
	}

	let form: FormData
	try {
		form = await request.formData()
	} catch {
		return Response.json({ error: 'Send the audio as multipart/form-data.' }, { status: 400 })
	}

	const audio = form.get('audio')
	if (!(audio instanceof Blob)) {
		return Response.json({ error: 'No audio chunk was attached.' }, { status: 400 })
	}
	if (audio.size === 0) {
		return Response.json({ error: 'The audio chunk was empty.' }, { status: 400 })
	}
	if (audio.size > MAX_AUDIO_BYTES) {
		return Response.json(
			{ error: `Audio chunks must stay under ${Math.round(MAX_AUDIO_BYTES / 1024 / 1024)} MB.` },
			{ status: 413 },
		)
	}

	const language = (form.get('language') as string | null)?.trim() || 'auto'
	const requestedModel = (form.get('model') as string | null)?.trim() || null
	const durationValue = Number((form.get('durationMs') as string | null) ?? '')
	const durationMs = Number.isFinite(durationValue) && durationValue > 0 ? durationValue : 30_000
	const model = modelFor(requestedModel, language)
	const fileName = (form.get('fileName') as string | null)?.trim() || 'chunk.wav'

	const attempts: { endpoint: string; dialect: Dialect; error: string }[] = []

	for (const candidate of candidates()) {
		try {
			const payload = await callNvidia({ candidate, audio, fileName, model, language, key })
			const normalised = normalise(payload, durationMs)
			if (!normalised) {
				attempts.push({
					endpoint: candidate.endpoint,
					dialect: candidate.dialect,
					error: 'The endpoint returned no transcript.',
				})
				continue
			}

			preferred = candidate
			return Response.json(
				{
					text: normalised.text,
					words: normalised.words,
					model,
					endpoint: candidate.endpoint,
					dialect: candidate.dialect,
					estimatedTimings: normalised.estimated,
				},
				{ headers: { 'cache-control': 'no-store' } },
			)
		} catch (error) {
			if (error instanceof CredentialError) {
				console.warn('[api/captions/transcribe] credential rejected', { error: error.message })
				return Response.json(
					{
						error: `NVIDIA rejected the API key: ${error.message}. NVIDIA keys start with nvapi-; update NVIDIA_API_KEY and restart the server.`,
						code: 'credentials',
					},
					{ status: 502 },
				)
			}
			const message = error instanceof Error ? error.message : String(error)
			attempts.push({ endpoint: candidate.endpoint, dialect: candidate.dialect, error: message })
		}
	}

	console.warn('[api/captions/transcribe] every endpoint failed', { model, attempts })
	return Response.json(
		{
			error: `No NVIDIA speech endpoint accepted the audio. Tried: ${attempts
				.map((attempt) => `${attempt.endpoint} (${attempt.dialect}): ${attempt.error}`)
				.join(' | ')
				.slice(0, 600)}`,
			code: 'upstream',
			attempts,
			model,
		},
		{ status: 502 },
	)
}
