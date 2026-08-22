/**
 * NVIDIA hosted speech recognition over gRPC.
 *
 * This is the path NVIDIA actually documents for its hosted ASR models: the
 * models on build.nvidia.com are NVIDIA Cloud Functions, reached at
 * `grpc.nvcf.nvidia.com:443` with two pieces of metadata - the function id of
 * the model and the `nvapi-` bearer token. There is no OpenAI-compatible
 * `/v1/audio/transcriptions` on integrate.api.nvidia.com to fall back on, which
 * is exactly why an HTTP-only implementation of this feature fails on every
 * request no matter how the key is configured.
 *
 * Server only: it opens a TCP connection and must never reach a browser bundle.
 */

import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'
import descriptor from './descriptor.json'

export const RIVA_GRPC_TARGET = 'grpc.nvcf.nvidia.com:443'

/** Riva reports word timings in whole milliseconds. */
export type RivaWord = {
	word: string
	start_time: number
	end_time: number
}

type RivaAlternative = {
	transcript?: string
	confidence?: number
	words?: RivaWord[]
}

type RivaResult = {
	alternatives?: RivaAlternative[]
	channel_tag?: number
	audio_processed?: number
}

type RecognizeResponse = { results?: RivaResult[] }

type RecognizeClient = grpc.Client & {
	Recognize: (
		request: unknown,
		metadata: grpc.Metadata,
		options: grpc.CallOptions,
		callback: (error: grpc.ServiceError | null, response: RecognizeResponse) => void,
	) => void
}

/**
 * The descriptor is compiled once per instance. Building it is cheap but not
 * free, and a warm serverless instance transcribes many chunks in a row.
 */
let cachedConstructor: grpc.ServiceClientConstructor | null = null

function serviceConstructor(): grpc.ServiceClientConstructor {
	if (cachedConstructor) return cachedConstructor
	// The JSON import is a protobufjs namespace descriptor, which is exactly what
	// fromJSON expects; TypeScript only sees two unrelated object shapes.
	const packageDefinition = protoLoader.fromJSON(descriptor as unknown as Parameters<typeof protoLoader.fromJSON>[0], {
		keepCase: true,
		longs: Number,
		enums: String,
		defaults: true,
		oneofs: true,
	})
	const loaded = grpc.loadPackageDefinition(packageDefinition) as unknown as {
		nvidia: { riva: { asr: { RivaSpeechRecognition: grpc.ServiceClientConstructor } } }
	}
	cachedConstructor = loaded.nvidia.riva.asr.RivaSpeechRecognition
	return cachedConstructor
}

/**
 * NVIDIA's hosted functions are TLS only, but a self-hosted Riva NIM listens on
 * plaintext 50051 by default - and so does the fake server the checks run
 * against. Anything but a loopback address is treated as TLS unless the
 * operator says otherwise.
 */
function credentialsFor(target: string): grpc.ChannelCredentials {
	const insecure = process.env.NVIDIA_ASR_GRPC_INSECURE?.trim()
	if (insecure === '1' || insecure === 'true') return grpc.credentials.createInsecure()
	if (insecure === '0' || insecure === 'false') return grpc.credentials.createSsl()
	return /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(target)
		? grpc.credentials.createInsecure()
		: grpc.credentials.createSsl()
}

/**
 * One client per (target, function id) pair, kept alive between requests. gRPC
 * multiplexes concurrent calls over a single HTTP/2 connection, so the three
 * chunks the browser uploads in parallel share one TLS handshake instead of
 * paying for three.
 */
const clients = new Map<string, RecognizeClient>()

function clientFor(target: string): RecognizeClient {
	const existing = clients.get(target)
	if (existing) return existing

	const Service = serviceConstructor()
	const client = new Service(target, credentialsFor(target), {
		// A minute of 16 kHz mono PCM is ~1.9 MB; the default 4 MB send cap is
		// tight enough to trip on a long chunk, and transcripts can be verbose.
		'grpc.max_send_message_length': 32 * 1024 * 1024,
		'grpc.max_receive_message_length': 32 * 1024 * 1024,
		'grpc.keepalive_time_ms': 30_000,
	}) as unknown as RecognizeClient

	clients.set(target, client)
	return client
}

export type RivaRecognizeArgs = {
	/** raw 16-bit little-endian PCM, mono, at `sampleRate` - no container */
	pcm: Buffer
	sampleRate: number
	/** Riva language code: `en-US`, `ne-NP`, or `multi` to auto-detect */
	languageCode: string
	functionId: string
	apiKey: string
	timeoutMs: number
	/** optional Riva model name; hosted functions serve one model each */
	model?: string
	target?: string
	/**
	 * Phrases the recogniser should expect - names, products, places. Riva
	 * raises their probability against similar-sounding alternatives, which is
	 * the only lever that reliably fixes a word written differently from the way
	 * it was spoken.
	 */
	hints?: string[]
	/** how hard to push those phrases; NVIDIA recommends 0 - 20 */
	hintBoost?: number
}

export type RivaRecognizeResult = {
	text: string
	words: { text: string; startMs: number; endMs: number }[]
}

function describeError(error: grpc.ServiceError): string {
	const name = grpc.status[error.code] ?? `code ${error.code}`
	const detail = error.details || error.message || 'no detail'
	// UNAUTHENTICATED and PERMISSION_DENIED are the two a user can act on, so
	// they are spelled out rather than left as a numeric gRPC status.
	if (error.code === grpc.status.UNAUTHENTICATED || error.code === grpc.status.PERMISSION_DENIED) {
		return `NVIDIA rejected the credential (${name}): ${detail}`
	}
	if (error.code === grpc.status.NOT_FOUND) {
		return `NVIDIA has no such speech function (${name}): ${detail}`
	}
	return `${name}: ${detail}`
}

/** Runs one offline recognition against a hosted NVCF speech function. */
export function rivaRecognize(args: RivaRecognizeArgs): Promise<RivaRecognizeResult> {
	const target = args.target ?? RIVA_GRPC_TARGET
	const client = clientFor(target)

	const metadata = new grpc.Metadata()
	metadata.set('function-id', args.functionId)
	metadata.set('authorization', `Bearer ${args.apiKey}`)

	const hints = (args.hints ?? []).filter((phrase) => phrase.trim().length > 0)

	const request = {
		config: {
			encoding: 'LINEAR_PCM',
			sample_rate_hertz: args.sampleRate,
			language_code: args.languageCode,
			max_alternatives: 1,
			audio_channel_count: 1,
			enable_word_time_offsets: true,
			enable_automatic_punctuation: true,
			// Inverse text normalisation on: "two thousand twenty five" becomes
			// "2025", which is what a subtitle should read.
			verbatim_transcripts: false,
			profanity_filter: false,
			...(hints.length > 0
				? {
						speech_contexts: [
							{ phrases: hints, boost: args.hintBoost ?? 6 },
						],
					}
				: {}),
			...(args.model ? { model: args.model } : {}),
		},
		audio: args.pcm,
	}

	return new Promise((resolve, reject) => {
		client.Recognize(
			request,
			metadata,
			{ deadline: Date.now() + args.timeoutMs },
			(error, response) => {
				if (error) {
					reject(new Error(describeError(error)))
					return
				}

				const words: RivaRecognizeResult['words'] = []
				const parts: string[] = []

				for (const result of response?.results ?? []) {
					const best = result.alternatives?.[0]
					if (!best) continue
					if (best.transcript) parts.push(best.transcript.trim())
					for (const word of best.words ?? []) {
						const text = (word.word ?? '').trim()
						if (!text) continue
						const startMs = Math.max(0, Math.round(Number(word.start_time) || 0))
						const endMs = Math.max(startMs + 1, Math.round(Number(word.end_time) || 0))
						words.push({ text, startMs, endMs })
					}
				}

				resolve({
					text: parts.join(' ').replace(/\s+/g, ' ').trim(),
					words: words.sort((left, right) => left.startMs - right.startMs),
				})
			},
		)
	})
}

/** Closes the pooled connections - only used by tests. */
export function closeRivaClients(): void {
	for (const client of clients.values()) client.close()
	clients.clear()
}
