/**
 * Speech -> timed words, on NVIDIA's hosted recognisers.
 *
 * The browser sends one chunk of 16 kHz mono WAV per request and this route
 * forwards it to NVIDIA with the API key that never leaves the server.
 *
 * NVIDIA hosts its speech models as NVIDIA Cloud Functions, and the documented
 * way to reach them is gRPC to `grpc.nvcf.nvidia.com:443` carrying the model's
 * function id - there is no OpenAI-style `/v1/audio/transcriptions` on
 * integrate.api.nvidia.com, which is why an HTTP-only client fails on every
 * request however the key is set. gRPC is therefore the primary transport here.
 *
 * Two HTTP transports are still tried afterwards, because a self-hosted NIM or
 * an NVCF function with HTTP enabled speaks them: the OpenAI-compatible form,
 * and the Riva form (`language=en-US`, `word_time_offsets`). Whichever pairing
 * answers first is remembered for the life of the instance, so only the first
 * chunk pays for probing, and every failed attempt is reported back so a
 * misconfiguration names itself instead of hiding behind "could not transcribe".
 */

import {
	CLOUD_ASR_LIMITS,
	CLOUD_ASR_MODELS,
	cloudAsrModelById,
	cloudModelForLanguage,
	isCloudAsrModel,
	languageCandidates,
	rivaLocale,
	type CloudAsrModel,
	type CloudWord,
} from '../../../../lib/captions/asr-models'
import { RIVA_GRPC_TARGET, rivaRecognize } from '../../../../lib/captions/riva/client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

/** A chunk is ~1.9 MB of WAV; anything much larger is not from this studio. */
const MAX_AUDIO_BYTES = 12 * 1024 * 1024
const REQUEST_TIMEOUT_MS = 120_000

type Transport =
	| { kind: 'grpc'; target: string }
	| { kind: 'http'; endpoint: string; dialect: 'openai' | 'riva' }

type Attempt = { transport: string; language: string; error: string }

/** Remembered across requests on a warm instance so probing happens once. */
let preferred: { transport: Transport; language: string } | null = null

function apiKey(): string | null {
	const key = process.env.NVIDIA_API_KEY?.trim()
	return key ? key : null
}

function grpcTarget(): string {
	return process.env.NVIDIA_ASR_GRPC?.trim() || RIVA_GRPC_TARGET
}

function httpEndpoints(model: CloudAsrModel): { endpoint: string; dialect: 'openai' | 'riva' }[] {
	const list: { endpoint: string; dialect: 'openai' | 'riva' }[] = []
	const explicit = process.env.NVIDIA_ASR_ENDPOINT?.trim()
	if (explicit) list.push({ endpoint: explicit, dialect: 'openai' }, { endpoint: explicit, dialect: 'riva' })

	// Some NVCF functions expose the NIM's own HTTP server as well as gRPC.
	const functionId = process.env.NVIDIA_ASR_FUNCTION_ID?.trim() || model.functionId
	if (functionId) {
		const invocation = `https://${functionId}.invocation.api.nvcf.nvidia.com/v1/audio/transcriptions`
		list.push({ endpoint: invocation, dialect: 'riva' }, { endpoint: invocation, dialect: 'openai' })
	}
	return list
}

/** Escape hatch for an HTTP-only deployment - a NIM behind a plain proxy. */
function grpcDisabled(): boolean {
	const value = process.env.NVIDIA_ASR_DISABLE_GRPC?.trim()
	return value === '1' || value === 'true'
}

function transportsFor(model: CloudAsrModel): Transport[] {
	const all: Transport[] = [
		...(grpcDisabled() ? [] : [{ kind: 'grpc' as const, target: grpcTarget() }]),
		...httpEndpoints(model).map(
			(entry): Transport => ({ kind: 'http', endpoint: entry.endpoint, dialect: entry.dialect }),
		),
	]
	if (!preferred) return all
	const key = transportKey(preferred.transport)
	return [preferred.transport, ...all.filter((transport) => transportKey(transport) !== key)]
}

function transportKey(transport: Transport): string {
	return transport.kind === 'grpc' ? `grpc:${transport.target}` : `${transport.dialect}:${transport.endpoint}`
}

function modelFor(requested: string | null, language: string): CloudAsrModel {
	const override = process.env.NVIDIA_ASR_MODEL?.trim()
	const id = override && isCloudAsrModel(override)
		? override
		: requested && isCloudAsrModel(requested)
			? requested
			: cloudModelForLanguage(language)
	return cloudAsrModelById(id) ?? CLOUD_ASR_MODELS[0]
}

/* --------------------------------------------------------------- the audio */

/**
 * Riva wants raw little-endian PCM, not a container. The studio always sends a
 * 16-bit mono WAV, so the header is parsed for the real sample rate and the
 * `data` chunk is handed over untouched.
 */
function pcmFromWav(bytes: Uint8Array): { pcm: Buffer; sampleRate: number } {
	const defaultRate: number = CLOUD_ASR_LIMITS.sampleRate
	const fallback = { pcm: Buffer.from(bytes), sampleRate: defaultRate }
	if (bytes.length < 44) return fallback

	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
	const tag = (offset: number) =>
		String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3])
	if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return fallback

	let sampleRate = defaultRate
	let cursor = 12
	while (cursor + 8 <= bytes.length) {
		const id = tag(cursor)
		const size = view.getUint32(cursor + 4, true)
		const body = cursor + 8
		if (id === 'fmt ' && body + 16 <= bytes.length) {
			sampleRate = view.getUint32(body + 4, true) || sampleRate
		}
		if (id === 'data') {
			const end = Math.min(bytes.length, body + size)
			return { pcm: Buffer.from(bytes.subarray(body, end)), sampleRate }
		}
		// Chunks are word aligned; an odd size carries a pad byte.
		cursor = body + size + (size % 2)
	}
	return { pcm: Buffer.from(bytes.subarray(44)), sampleRate }
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

/* ------------------------------------------------------------- transports */

class CredentialError extends Error {}

function buildForm(args: {
	dialect: 'openai' | 'riva'
	audio: Blob
	fileName: string
	model: CloudAsrModel
	language: string
}): FormData {
	const form = new FormData()
	form.append('file', args.audio, args.fileName)

	if (args.dialect === 'openai') {
		form.append('model', args.model.id)
		form.append('response_format', 'verbose_json')
		form.append('timestamp_granularities[]', 'word')
		form.append('timestamp_granularities[]', 'segment')
		if (args.language !== 'multi') form.append('language', args.language)
		return form
	}

	form.append('language', args.language === 'multi' ? 'multi' : rivaLocale(args.language))
	form.append('word_time_offsets', 'true')
	form.append('automatic_punctuation', 'true')
	if (process.env.NVIDIA_ASR_MODEL?.trim()) form.append('model', args.model.id)
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
	return `HTTP ${status}`
}

async function callHttp(args: {
	endpoint: string
	dialect: 'openai' | 'riva'
	audio: Blob
	fileName: string
	model: CloudAsrModel
	language: string
	key: string
	durationMs: number
}): Promise<{ text: string; words: CloudWord[]; estimated: boolean }> {
	const response = await fetch(args.endpoint, {
		method: 'POST',
		headers: { Authorization: `Bearer ${args.key}`, Accept: 'application/json' },
		body: buildForm(args),
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
	})

	const payload = await readPayload(response)
	if (!response.ok) {
		const message = errorText(payload, response.status)
		if (response.status === 401 || response.status === 403) throw new CredentialError(message)
		throw new Error(message)
	}

	const normalised = normalise(payload, args.durationMs)
	if (!normalised) throw new Error('the endpoint returned no transcript')
	return normalised
}

async function callGrpc(args: {
	target: string
	pcm: Buffer
	sampleRate: number
	language: string
	model: CloudAsrModel
	key: string
	durationMs: number
}): Promise<{ text: string; words: CloudWord[]; estimated: boolean }> {
	const result = await rivaRecognize({
		pcm: args.pcm,
		sampleRate: args.sampleRate,
		languageCode: args.language,
		functionId: process.env.NVIDIA_ASR_FUNCTION_ID?.trim() || args.model.functionId,
		apiKey: args.key,
		timeoutMs: REQUEST_TIMEOUT_MS,
		target: args.target,
	}).catch((error: unknown) => {
		const message = error instanceof Error ? error.message : String(error)
		if (/rejected the credential/i.test(message)) throw new CredentialError(message)
		throw new Error(message)
	})

	if (result.words.length > 0) return { text: result.text, words: result.words, estimated: false }
	if (result.text) {
		return { text: result.text, words: spreadWords(result.text, args.durationMs), estimated: true }
	}
	// Silence is a legitimate answer, not a failure - the caller merges chunks.
	return { text: '', words: [], estimated: false }
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
			endpoints: [
				...(grpcDisabled() ? [] : [grpcTarget()]),
				...httpEndpoints(CLOUD_ASR_MODELS[0]).map((entry) => entry.endpoint),
			],
			models: CLOUD_ASR_MODELS,
			verified: preferred
				? { endpoint: transportKey(preferred.transport), model: preferred.language }
				: null,
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
	const fileName = (form.get('fileName') as string | null)?.trim() || 'chunk.wav'

	const model = modelFor(requestedModel, language)
	const bytes = new Uint8Array(await audio.arrayBuffer())
	const { pcm, sampleRate } = pcmFromWav(bytes)

	// The remembered language spelling goes first; the rest still follow, so a
	// model swap mid-session cannot strand the request on the wrong dialect.
	const languages = languageCandidates(model, language)
	const ordered =
		preferred && languages.includes(preferred.language)
			? [preferred.language, ...languages.filter((entry) => entry !== preferred?.language)]
			: languages

	const attempts: Attempt[] = []

	for (const transport of transportsFor(model)) {
		for (const languageCode of ordered) {
			const label = transportKey(transport)
			try {
				const result =
					transport.kind === 'grpc'
						? await callGrpc({
								target: transport.target,
								pcm,
								sampleRate,
								language: languageCode,
								model,
								key,
								durationMs,
							})
						: await callHttp({
								endpoint: transport.endpoint,
								dialect: transport.dialect,
								audio,
								fileName,
								model,
								language: languageCode,
								key,
								durationMs,
							})

				preferred = { transport, language: languageCode }
				return Response.json(
					{
						text: result.text,
						words: result.words,
						model: model.id,
						endpoint: label,
						language: languageCode,
						estimatedTimings: result.estimated,
					},
					{ headers: { 'cache-control': 'no-store' } },
				)
			} catch (error) {
				if (error instanceof CredentialError) {
					console.warn('[api/captions/transcribe] credential rejected', { error: error.message })
					return Response.json(
						{
							error: `NVIDIA rejected the API key: ${error.message}. NVIDIA keys start with nvapi-; check NVIDIA_API_KEY and that the key has access to ${model.id}.`,
							code: 'credentials',
						},
						{ status: 502 },
					)
				}
				const message = error instanceof Error ? error.message : String(error)
				attempts.push({ transport: label, language: languageCode, error: message.slice(0, 240) })
				// A language the model refuses is worth retrying with another
				// spelling; a dead transport is not, so stop cycling spellings once
				// the failure is clearly not about the language code.
				if (!/language|locale|unsupported|not available|invalid[_ ]argument/i.test(message)) break
			}
		}
	}

	console.warn('[api/captions/transcribe] every transport failed', { model: model.id, attempts })
	return Response.json(
		{
			error: `NVIDIA did not accept the audio for ${model.id}. ${attempts
				.map((attempt) => `${attempt.transport} [${attempt.language}]: ${attempt.error}`)
				.join(' | ')
				.slice(0, 700)}`,
			code: 'upstream',
			attempts,
			model: model.id,
		},
		{ status: 502 },
	)
}
