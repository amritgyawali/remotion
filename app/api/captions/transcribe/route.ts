/**
 * Speech -> timed words. Groq's hosted Whisper first, NVIDIA's recognisers second.
 *
 * The browser sends one chunk of 16 kHz mono WAV per request and this route
 * forwards it to a provider with an API key that never leaves the server. Two
 * providers are tried in order, and the browser never learns which one answered
 * beyond a `provider` field it may show:
 *
 *  1. Groq. One HTTPS hop to `api.groq.com/openai/v1/audio/transcriptions`,
 *     `whisper-large-v3`, `verbose_json` with word *and* segment timestamps. It
 *     returns a real per-word clock in seconds under keys the normaliser already
 *     reads, and its multilingual model handles Nepali and code-switched English
 *     in one pass - which is why it leads. Language is left undeclared so Whisper
 *     detects it; forcing a wrong ISO code only makes the transcript worse.
 *
 *  2. NVIDIA, unchanged, as the fallback for when Groq is unset, rate limited, or
 *     down. NVIDIA hosts its speech models as NVIDIA Cloud Functions reached by
 *     gRPC to `grpc.nvcf.nvidia.com:443` carrying the model's function id - there
 *     is no OpenAI-style `/v1/audio/transcriptions` on integrate.api.nvidia.com,
 *     so gRPC is the primary NVIDIA transport. Two HTTP transports follow it for
 *     a self-hosted NIM or an HTTP-enabled NVCF function: the OpenAI-compatible
 *     form and the Riva form (`language=en-US`, `word_time_offsets`). Whichever
 *     pairing answers first is remembered for the life of the instance, so only
 *     the first chunk pays for probing.
 *
 * Either provider's key alone is enough to run. Every failed attempt is reported
 * back so a misconfiguration names itself instead of hiding behind "could not
 * transcribe".
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
import { loanwordHints } from '../../../../lib/captions/loanwords'
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

function nvidiaApiKey(): string | null {
	const key = process.env.NVIDIA_API_KEY?.trim()
	return key ? key : null
}

/** Groq's key. Whisper is the primary recogniser; the key stays server-side only. */
function groqApiKey(): string | null {
	const key = process.env.GROQ_API_KEY?.trim()
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

/**
 * Vocabulary the recogniser should expect.
 *
 * Riva takes phrase hints with a boost, and they are the one lever that moves
 * the names a model has never seen - a person, a product, a place - out of the
 * "words written differently from how they were spoken" column. Hints arrive
 * per request from the studio and, for a deployment that always covers the same
 * subject, from NVIDIA_ASR_PHRASES on the server.
 */
function speechHints(requested: string | null, language: string): string[] {
	const fromEnv = process.env.NVIDIA_ASR_PHRASES?.trim() ?? ''
	// Nepali speech is code-switched by default, so the English a speaker is
	// likely to drop in is offered to the recogniser without being asked for.
	const codeSwitch = language.split('-')[0] === 'ne' ? loanwordHints().join(',') : ''
	const merged = [requested ?? '', fromEnv, codeSwitch]
		.join('\n')
		.split(/[\n,;|]+/)
		.map((phrase) => phrase.trim())
		.filter((phrase) => phrase.length > 0 && phrase.length <= 120)
	// Riva caps what it will accept, and a huge list dilutes every hint in it.
	return [...new Set(merged)].slice(0, 100)
}

function hintBoost(): number {
	const value = Number(process.env.NVIDIA_ASR_PHRASE_BOOST?.trim())
	// NVIDIA recommends 0 - 20; past that, false positives outweigh the recall.
	return Number.isFinite(value) && value > 0 ? Math.min(20, value) : 6
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

type TimeUnit = 'ms' | 'seconds' | 'unknown'

type RawWord = { text: string; start: number; end: number; unit: TimeUnit }

/**
 * The unit each key is documented to carry.
 *
 * Guessing from magnitude alone is what makes a short chunk come back with
 * every word crammed into its first second: a Riva reply that happens to hold
 * small millisecond values looks exactly like an OpenAI reply holding seconds.
 * The key name is the one piece of evidence that is never ambiguous, so it is
 * consulted first and the magnitude only settles what the names cannot.
 */
const START_KEYS: { key: string; unit: TimeUnit }[] = [
	{ key: 'start_time', unit: 'ms' },
	{ key: 'startMs', unit: 'ms' },
	{ key: 'start_ms', unit: 'ms' },
	{ key: 'offset', unit: 'ms' },
	{ key: 'start', unit: 'seconds' },
	{ key: 'startTime', unit: 'unknown' },
]

const END_KEYS: { key: string; unit: TimeUnit }[] = [
	{ key: 'end_time', unit: 'ms' },
	{ key: 'endMs', unit: 'ms' },
	{ key: 'end_ms', unit: 'ms' },
	{ key: 'end', unit: 'seconds' },
	{ key: 'endTime', unit: 'unknown' },
]

function firstKeyed(
	source: UnknownRecord,
	keys: { key: string; unit: TimeUnit }[],
): { value: number; unit: TimeUnit } | null {
	for (const entry of keys) {
		const value = firstNumber(source, [entry.key])
		if (value !== null) return { value, unit: entry.unit }
	}
	return null
}

function collectWords(value: unknown, into: RawWord[]): void {
	if (!Array.isArray(value)) return
	for (const entry of value) {
		if (!isRecord(entry)) continue
		const text = firstString(entry, ['word', 'text', 'value'])
		const start = firstKeyed(entry, START_KEYS)
		const end = firstKeyed(entry, END_KEYS)
		if (!text || !start || !end) continue
		const unit: TimeUnit =
			start.unit !== 'unknown' ? start.unit : end.unit !== 'unknown' ? end.unit : 'unknown'
		into.push({ text: text.trim(), start: start.value, end: end.value, unit })
	}
}

/**
 * Endpoints disagree on units: OpenAI-shaped payloads count seconds, Riva
 * counts milliseconds. The key names settle it wherever they are unambiguous;
 * otherwise the chunk duration does, since a chunk is at most a couple of
 * minutes and a value far beyond that cannot be seconds.
 */
function toMilliseconds(words: RawWord[], durationMs: number): CloudWord[] {
	const declared = words.find((word) => word.unit !== 'unknown')?.unit
	let unit: TimeUnit | undefined = declared
	if (words.some((word) => word.unit !== 'unknown' && word.unit !== declared)) unit = undefined

	if (!unit) {
		let largest = 0
		for (const word of words) largest = Math.max(largest, word.end, word.start)
		unit = largest <= Math.max(1, durationMs / 1000) * 1.5 + 1 ? 'seconds' : 'ms'
	}
	const scale = unit === 'seconds' ? 1000 : 1

	return words
		.map((word) => {
			const startMs = Math.max(0, Math.round(word.start * scale))
			const endMs = Math.max(startMs + 1, Math.round(word.end * scale))
			return { text: word.text, startMs, endMs }
		})
		.filter((word) => word.text.length > 0)
		.sort((left, right) => left.startMs - right.startMs)
}

/**
 * Timings that cannot be true are worse than no timings at all.
 *
 * A caller that is told "these are real" pins the captions to them; a caller
 * that is told "these were estimated" aligns the text to the audio itself,
 * which is the better answer whenever the recogniser's clock is wrong. All
 * zeros, everything inside the first instant, or a transcript that claims to
 * run well past the audio it came from are all that case.
 */
function timingsAreUsable(words: CloudWord[], durationMs: number): boolean {
	if (words.length === 0) return false
	const last = words[words.length - 1]
	if (last.endMs <= 0) return false
	if (words.length > 2 && last.endMs < Math.min(400, durationMs / 4)) return false
	return last.endMs <= durationMs * 1.6 + 2_000
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

	if (words.length > 0 && timingsAreUsable(words, durationMs)) {
		return { text: joined, words, estimated: false }
	}
	// Text with no usable clock is not a failure: the caller aligns it to the
	// audio itself, which beats any timing a confused recogniser can invent.
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
	hints: string[]
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
	if (args.hints.length > 0) {
		form.append('boosted_lm_words', args.hints.join(','))
		form.append('boosted_lm_score', String(hintBoost()))
	}
	if (process.env.NVIDIA_ASR_MODEL?.trim()) form.append('model', args.model.id)
	return form
}

/**
 * The Groq request. `whisper-large-v3` is the accuracy target (10.3% WER on
 * multilingual test sets) and `temperature=0` removes the one knob that makes
 * a recogniser invent a word it never heard. Timestamps come back as seconds
 * under `start`/`end`, which the normaliser already treats as seconds.
 */
function buildGroqForm(args: { audio: Blob; fileName: string; language: string | null }): FormData {
	const form = new FormData()
	form.append('file', args.audio, args.fileName)
	form.append('model', GROQ_MODEL)
	form.append('response_format', 'verbose_json')
	form.append('timestamp_granularities[]', 'word')
	form.append('timestamp_granularities[]', 'segment')
	form.append('temperature', '0')
	// Leave language out entirely. Whisper detects it, and an ISO code that
	// disagrees with the audio makes the transcript worse, not better.
	if (args.language && args.language !== 'auto' && args.language !== 'multi') {
		form.append('language', args.language)
	}
	return form
}

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions'
const GROQ_MODEL = 'whisper-large-v3'

async function callGroq(args: {
	audio: Blob
	fileName: string
	language: string | null
	key: string
	durationMs: number
}): Promise<{ text: string; words: CloudWord[]; estimated: boolean }> {
	const response = await fetch(GROQ_ENDPOINT, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${args.key}`,
			'Content-Type': 'application/x-www-form-urlencoded',
		},
		body: buildGroqForm(args),
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
	hints: string[]
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
	hints: string[]
}): Promise<{ text: string; words: CloudWord[]; estimated: boolean }> {
	const result = await rivaRecognize({
		pcm: args.pcm,
		sampleRate: args.sampleRate,
		languageCode: args.language,
		functionId: process.env.NVIDIA_ASR_FUNCTION_ID?.trim() || args.model.functionId,
		apiKey: args.key,
		timeoutMs: REQUEST_TIMEOUT_MS,
		target: args.target,
		hints: args.hints,
		hintBoost: hintBoost(),
	}).catch((error: unknown) => {
		const message = error instanceof Error ? error.message : String(error)
		if (/rejected the credential/i.test(message)) throw new CredentialError(message)
		throw new Error(message)
	})

	if (timingsAreUsable(result.words, args.durationMs)) {
		return { text: result.text, words: result.words, estimated: false }
	}
	const text = result.text || result.words.map((word) => word.text).join(' ')
	if (text.trim()) {
		// Whisper's hosted function answers with a transcript and no clock at all.
		// Saying so is what lets the studio align the words to the audio instead
		// of pinning them to timings that were never measured.
		return { text: text.trim(), words: spreadWords(text, args.durationMs), estimated: true }
	}
	// Silence is a legitimate answer, not a failure - the caller merges chunks.
	return { text: '', words: [], estimated: false }
}

/* ------------------------------------------------------------------ route */

export function GET() {
	const configured = nvidiaApiKey() !== null
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
	const groqKey = groqApiKey()
	const nvidiaKey = nvidiaApiKey()
	if (!groqKey && !nvidiaKey) {
		return Response.json(
			{
				error:
					'Neither GROQ_API_KEY nor NVIDIA_API_KEY is set on the server. Add at least one to .env.local and restart.',
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
	const hints = speechHints((form.get('hints') as string | null) ?? null, language)
	// Echoed back untouched: the studio needs it to map the recogniser's clock,
	// which starts at the blob, back onto the clip's clock.
	const contextValue = Number((form.get('contextMs') as string | null) ?? '')
	const contextMs = Number.isFinite(contextValue) && contextValue > 0 ? Math.round(contextValue) : 0

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

	// 1. Try Groq first (if key present)
	if (groqKey) {
		const groqAttempts: Attempt[] = []
		for (const languageCode of ordered) {
			try {
				const result = await callGroq({
					audio,
					fileName,
					language: languageCode === 'auto' || languageCode === 'multi' ? null : languageCode,
					key: groqKey!,
					durationMs,
				})
				// Remember the successful Groq language for next time? Not required, but we can update preferred for Groq if we want.
				// We'll keep the existing preferred for NVIDIA only, so we don't touch it here.
				return Response.json(
					{
						text: result.text,
						words: result.words,
						model: GROQ_MODEL,
						endpoint: 'groq',
						language: languageCode,
						estimatedTimings: result.estimated,
						contextMs,
						durationMs,
					},
					{ headers: { 'cache-control': 'no-store' } },
				)
			} catch (error) {
				if (error instanceof CredentialError) {
					console.warn('[api/captions/transcribe] groq credential rejected', { error: error.message })
					return Response.json(
						{
							error: `Groq rejected the API key: ${error.message}. Check GROQ_API_KEY and that the key has access to ${GROQ_MODEL}.`,
							code: 'credentials',
						},
						{ status: 502 },
					)
				}
				const message = error instanceof Error ? error.message : String(error)
				groqAttempts.push({ transport: `groq:${GROQ_ENDPOINT}`, language: languageCode, error: message.slice(0, 240) })
				// If the error is clearly not about language, break the language loop for Groq.
				if (!/language|locale|unsupported|not available|invalid[_ ]argument/i.test(message)) break
			}
		}
		console.warn('[api/captions/transcribe] groq every attempt failed', { model: GROQ_MODEL, attempts: groqAttempts })
		// Fall through to NVIDIA fallback
	}

	// 2. Fallback to NVIDIA (original logic, but using nvidiaKey)
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
								key: nvidiaKey!,
								durationMs,
								hints,
							})
						: await callHttp({
								endpoint: transport.endpoint,
								dialect: transport.dialect,
								audio,
								fileName,
								model,
								language: languageCode,
								key: nvidiaKey!,
								durationMs,
								hints,
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
						contextMs,
						durationMs,
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
