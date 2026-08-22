/**
 * Proves the NVIDIA speech transport end to end, without touching NVIDIA.
 *
 * The hosted models are NVCF gRPC functions, so the interesting failures are
 * all on the wire: a descriptor that does not compile, a request whose fields
 * land in the wrong place, metadata NVIDIA never receives, a WAV whose header
 * is handed over as if it were audio, or a response whose word timings are
 * silently dropped. A real gRPC server built from the same vendored protos
 * catches every one of those - it is the same code path NVIDIA answers on,
 * with the far end replaced.
 *
 *   node scripts/check-riva.cjs
 */

require('sucrase/register')

const grpc = require('@grpc/grpc-js')
const protoLoader = require('@grpc/proto-loader')
const descriptor = require('../lib/captions/riva/descriptor.json')

process.env.NVIDIA_API_KEY = 'nvapi-check'
// The fake server is plaintext, exactly like a self-hosted Riva NIM.
process.env.NVIDIA_ASR_GRPC_INSECURE = '1'

const { rivaRecognize, closeRivaClients } = require('../lib/captions/riva/client.ts')

let failures = 0
let checks = 0

function check(label, condition, detail) {
	checks++
	if (condition) {
		console.log(`  ok   ${label}`)
		return
	}
	failures++
	console.log(`  FAIL ${label}`, detail === undefined ? '' : JSON.stringify(detail))
}

/** 16-bit mono PCM in a WAV wrapper - the exact shape the browser uploads. */
function wav(samples, sampleRate = 16_000) {
	const buffer = Buffer.alloc(44 + samples.length * 2)
	buffer.write('RIFF', 0)
	buffer.writeUInt32LE(36 + samples.length * 2, 4)
	buffer.write('WAVE', 8)
	buffer.write('fmt ', 12)
	buffer.writeUInt32LE(16, 16)
	buffer.writeUInt16LE(1, 20)
	buffer.writeUInt16LE(1, 22)
	buffer.writeUInt32LE(sampleRate, 24)
	buffer.writeUInt32LE(sampleRate * 2, 28)
	buffer.writeUInt16LE(2, 32)
	buffer.writeUInt16LE(16, 34)
	buffer.write('data', 36)
	buffer.writeUInt32LE(samples.length * 2, 40)
	for (let index = 0; index < samples.length; index++) {
		buffer.writeInt16LE(samples[index], 44 + index * 2)
	}
	return buffer
}

/** Starts a Riva-speaking server and records what each call received. */
function startFakeRiva(handler) {
	const packageDefinition = protoLoader.fromJSON(descriptor, {
		keepCase: true,
		longs: Number,
		enums: String,
		defaults: true,
		oneofs: true,
	})
	const proto = grpc.loadPackageDefinition(packageDefinition)
	const server = new grpc.Server({
		'grpc.max_receive_message_length': 32 * 1024 * 1024,
	})

	const seen = []
	server.addService(proto.nvidia.riva.asr.RivaSpeechRecognition.service, {
		Recognize: (call, callback) => {
			seen.push({
				config: call.request.config,
				audioBytes: call.request.audio ? call.request.audio.length : 0,
				audio: call.request.audio,
				metadata: {
					functionId: call.metadata.get('function-id')[0],
					authorization: call.metadata.get('authorization')[0],
				},
			})
			handler(call, callback)
		},
	})

	return new Promise((resolve, reject) => {
		server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (error, port) => {
			if (error) {
				reject(error)
				return
			}
			resolve({ server, port, seen })
		})
	})
}

const TRANSCRIPT = {
	results: [
		{
			alternatives: [
				{
					transcript: 'नमस्ते this is a test',
					confidence: 0.94,
					words: [
						{ word: 'नमस्ते', start_time: 120, end_time: 640 },
						{ word: 'this', start_time: 700, end_time: 950 },
						{ word: 'is', start_time: 950, end_time: 1100 },
						{ word: 'a', start_time: 1100, end_time: 1190 },
						{ word: 'test', start_time: 1200, end_time: 1800 },
					],
				},
			],
		},
	],
}

async function checkClient() {
	console.log('\ngRPC client against a Riva-speaking server')
	const fake = await startFakeRiva((call, callback) => callback(null, TRANSCRIPT))

	const pcm = Buffer.alloc(32_000) // one second of silence, 16 kHz 16-bit mono
	pcm.writeInt16LE(1234, 0)

	const result = await rivaRecognize({
		pcm,
		sampleRate: 16_000,
		languageCode: 'ne-NP',
		functionId: 'b702f636-f60c-4a3d-a6f4-f3568c13bd7d',
		apiKey: 'nvapi-check',
		timeoutMs: 10_000,
		target: `127.0.0.1:${fake.port}`,
	})

	const call = fake.seen[0]
	check('the call arrives at the service', fake.seen.length === 1)
	check('the function id travels as metadata', call.metadata.functionId === 'b702f636-f60c-4a3d-a6f4-f3568c13bd7d', call.metadata.functionId)
	check('the key travels as a bearer token', call.metadata.authorization === 'Bearer nvapi-check', call.metadata.authorization)
	check('the audio arrives byte for byte', call.audioBytes === pcm.length && call.audio.readInt16LE(0) === 1234, call.audioBytes)
	check('encoding is LINEAR_PCM', call.config.encoding === 'LINEAR_PCM', call.config.encoding)
	check('sample rate is carried', call.config.sample_rate_hertz === 16_000, call.config.sample_rate_hertz)
	check('language code is carried', call.config.language_code === 'ne-NP', call.config.language_code)
	check('word timings are requested', call.config.enable_word_time_offsets === true)
	check('punctuation is requested', call.config.enable_automatic_punctuation === true)

	check('five words come back', result.words.length === 5, result.words.length)
	check('Riva milliseconds are kept as milliseconds', result.words[0].endMs === 640, result.words[0])
	check('Devanagari survives the wire', result.words[0].text === 'नमस्ते', result.words[0].text)
	check('the transcript is joined', result.text.includes('this is a test'), result.text)

	fake.server.forceShutdown()
	closeRivaClients()
}

async function checkErrors() {
	console.log('\ngRPC failures are explained, not swallowed')
	const denied = await startFakeRiva((call, callback) =>
		callback({ code: grpc.status.UNAUTHENTICATED, details: 'invalid api key' }),
	)

	const message = await rivaRecognize({
		pcm: Buffer.alloc(1600),
		sampleRate: 16_000,
		languageCode: 'multi',
		functionId: 'x',
		apiKey: 'nvapi-bad',
		timeoutMs: 5_000,
		target: `127.0.0.1:${denied.port}`,
	}).then(
		() => 'resolved',
		(error) => error.message,
	)

	check('an auth failure names the credential', /rejected the credential/i.test(message), message)
	check('and carries the upstream detail', /invalid api key/.test(message), message)

	denied.server.forceShutdown()
	closeRivaClients()
}

async function checkRoute() {
	console.log('\n/api/captions/transcribe over gRPC')
	const fake = await startFakeRiva((call, callback) => callback(null, TRANSCRIPT))
	process.env.NVIDIA_ASR_GRPC = `127.0.0.1:${fake.port}`

	// Required after the env var is set: the route reads it at call time, but the
	// module must be loaded fresh so no earlier transport is remembered.
	delete require.cache[require.resolve('../app/api/captions/transcribe/route.ts')]
	const route = require('../app/api/captions/transcribe/route.ts')

	const form = new FormData()
	const audio = wav([0, 512, -512, 1024, 0, 0, 0, 0])
	form.append('audio', new Blob([audio], { type: 'audio/wav' }), 'chunk-0.wav')
	form.append('language', 'ne')
	form.append('durationMs', '2000')

	const response = await route.POST(
		new Request('http://localhost/api/captions/transcribe', { method: 'POST', body: form }),
	)
	const body = await response.json()

	check('the route answers 200', response.status === 200, body)
	check('with the recognised words', body.words?.length === 5, body.words)
	check('the WAV header is stripped before sending', fake.seen[0].audioBytes === audio.length - 44, fake.seen[0].audioBytes)
	check('Whisper is chosen for Nepali', body.model === 'openai/whisper-large-v3', body.model)
	check('and asked for it by ISO code', fake.seen[0].config.language_code === 'ne', fake.seen[0].config.language_code)
	check('the transport is reported back', String(body.endpoint).startsWith('grpc:'), body.endpoint)

	const status = await route.GET().json()
	check('the status probe lists the gRPC target', status.endpoints.some((entry) => entry.includes('127.0.0.1')), status.endpoints)
	check('and every model carries a function id', status.models.every((model) => /^[0-9a-f-]{36}$/.test(model.functionId)), status.models.map((model) => model.functionId))

	fake.server.forceShutdown()
	closeRivaClients()
	delete process.env.NVIDIA_ASR_GRPC
}

async function main() {
	await checkClient()
	await checkErrors()
	await checkRoute()

	if (failures > 0) {
		console.error(`\n${failures} of ${checks} checks failed.`)
		process.exit(1)
	}
	console.log(`\nAll ${checks} NVIDIA speech transport checks passed.`)
	process.exit(0)
}

main().catch((error) => {
	console.error(error)
	process.exit(1)
})
