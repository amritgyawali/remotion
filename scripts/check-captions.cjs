/**
 * Verifies the automatic captioning pipeline without touching the network.
 *
 * Four things are checked, because these are the parts that fail silently and
 * ruin a transcript rather than throwing:
 *
 *   1. the audio chunker      - chunk sizes stay under the request body limit,
 *                               cuts land in silence, WAV headers are valid
 *   2. the cloud uploader     - chunk timings are offset into the clip, a chunk
 *                               that keeps failing costs its own seconds only
 *   3. /api/captions/transcribe - every NVIDIA response shape normalises to the
 *                               same word list, in milliseconds, and a rejected
 *                               request dialect falls through to the next one
 *   4. /api/captions/refine   - the clean-up pass never changes the line count
 *                               and never rewrites a line beyond recognition
 *
 *   node scripts/check-captions.cjs
 */

require('sucrase/register')

const RATE = 16_000

/* -------------------------------------------------- browser API stand-ins */

class FakeAudioBuffer {
	constructor(channels, length, sampleRate) {
		this.numberOfChannels = channels
		this.length = length
		this.sampleRate = sampleRate
		this.data = Array.from({ length: channels }, () => new Float32Array(length))
	}
	getChannelData(index) {
		return this.data[index]
	}
}

let decoded = null

global.OfflineAudioContext = class {
	constructor(channels, length, sampleRate) {
		this.sampleRate = sampleRate
	}
	createBuffer(channels, length, sampleRate) {
		return new FakeAudioBuffer(channels, length, sampleRate)
	}
	async decodeAudioData() {
		if (!decoded) throw new Error('no audio')
		return decoded
	}
	createBufferSource() {
		return { buffer: null, connect() {}, start() {} }
	}
	async startRendering() {
		throw new Error('nothing should need resampling at 16 kHz')
	}
}

process.env.NVIDIA_API_KEY = 'nvapi-check'

const { streamAudioChunks } = require('../lib/captions/audio.ts')
const { transcribeInCloud } = require('../lib/captions/cloud-transcribe.ts')
const transcribeRoute = require('../app/api/captions/transcribe/route.ts')
const refineRoute = require('../app/api/captions/refine/route.ts')

/* ------------------------------------------------------------- test tools */

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

/** Tone bursts separated by exact silence, so a cutter has somewhere to cut. */
function synthesise(seconds, { silent = false } = {}) {
	const buffer = new FakeAudioBuffer(1, seconds * RATE, RATE)
	const data = buffer.getChannelData(0)
	if (silent) return buffer
	for (let index = 0; index < data.length; index++) {
		const inSilence = (index / RATE) % 2 > 1.6
		data[index] = inSilence ? 0 : Math.sin(index * 0.05) * 0.4
	}
	return buffer
}

function parseWav(bytes) {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
	const tag = (offset) => String.fromCharCode(...bytes.slice(offset, offset + 4))
	return {
		riff: tag(0),
		wave: tag(8),
		channels: view.getUint16(22, true),
		sampleRate: view.getUint32(24, true),
		bits: view.getUint16(34, true),
		dataBytes: view.getUint32(40, true),
	}
}

function audioRequest(durationMs = 3000, language = 'ne') {
	const form = new FormData()
	form.append('audio', new Blob([new Uint8Array(2048)], { type: 'audio/wav' }), 'chunk-0.wav')
	form.append('language', language)
	form.append('durationMs', String(durationMs))
	return new Request('http://localhost/api/captions/transcribe', { method: 'POST', body: form })
}

function jsonRequest(url, body) {
	return new Request(url, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body),
	})
}

function nvidiaReply(body, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' },
	})
}

function chatReply(content) {
	return nvidiaReply({ choices: [{ message: { content } }] })
}

/* ------------------------------------------------------------- the checks */

async function checkChunker() {
	console.log('\nAudio chunker')
	decoded = synthesise(250)
	const chunks = []
	const result = await streamAudioChunks({
		source: new Blob([new Uint8Array(16)]),
		durationHintSeconds: 250,
		onChunk: (chunk) => chunks.push(chunk),
		signal: new AbortController().signal,
	})

	check('250s becomes three chunks', result.chunks === 3, result.chunks)
	check('duration is preserved', Math.abs(result.durationMs - 250_000) < 50, result.durationMs)
	check('a speaking track is not called silent', result.silent === false)
	check(
		'chunks tile the clip without gaps',
		chunks.every((chunk, index) => index === 0 || chunk.startMs === chunks[index - 1].endMs),
	)
	check(
		'every chunk fits a serverless request body',
		chunks.every((chunk) => chunk.blob.size < 4 * 1024 * 1024),
		chunks.map((chunk) => chunk.blob.size),
	)
	check(
		'boundaries land in silence, not mid-word',
		chunks.slice(0, -1).every((chunk) => (chunk.endMs / 1000) % 2 > 1.55),
		chunks.map((chunk) => Number(((chunk.endMs / 1000) % 2).toFixed(2))),
	)

	const header = parseWav(new Uint8Array(await chunks[0].blob.arrayBuffer()))
	check('WAV header is well formed', header.riff === 'RIFF' && header.wave === 'WAVE', header)
	check(
		'16 kHz mono 16-bit, as every recogniser wants',
		header.sampleRate === RATE && header.channels === 1 && header.bits === 16,
		header,
	)
	check('declared data length matches the blob', header.dataBytes === chunks[0].blob.size - 44)

	decoded = synthesise(12, { silent: true })
	const silence = await streamAudioChunks({
		source: new Blob([new Uint8Array(16)]),
		durationHintSeconds: 12,
		onChunk: () => {},
		signal: new AbortController().signal,
	})
	check('a silent track is reported as silent', silence.silent === true)
}

async function checkUploader() {
	console.log('\nCloud uploader')
	decoded = synthesise(250)
	let requests = 0
	global.fetch = async () => {
		requests++
		return nvidiaReply({
			text: 'one two',
			words: [
				{ text: 'one', startMs: 100, endMs: 400 },
				{ text: 'two', startMs: 500, endMs: 900 },
			],
			model: 'openai/whisper-large-v3',
			endpoint: 'https://integrate.api.nvidia.com/v1/audio/transcriptions',
			estimatedTimings: false,
		})
	}

	const stages = []
	const result = await transcribeInCloud({
		source: new Blob([new Uint8Array(16)]),
		language: 'ne',
		model: null,
		durationSeconds: 250,
		onProgress: (progress) => stages.push(progress.stage),
		signal: new AbortController().signal,
	})

	check('one request per chunk', requests === 3, requests)
	check('all words are kept', result.words.length === 6, result.words.length)
	check('the model is reported back', result.model === 'openai/whisper-large-v3', result.model)
	check(
		'later chunks are offset into the clip',
		result.words.some((word) => word.startMs > 150_000),
	)
	check(
		'the merged transcript is in order',
		result.words.every((word, index, all) => index === 0 || word.startMs >= all[index - 1].startMs),
	)
	check('progress reaches the transcribing stage', stages.includes('transcribing'))

	let attempts = 0
	global.fetch = async (url, init) => {
		if (init.body.get('fileName') === 'chunk-1.wav') {
			attempts++
			return nvidiaReply({ error: 'upstream exploded', code: 'upstream' }, 502)
		}
		return nvidiaReply({
			text: 'one',
			words: [{ text: 'one', startMs: 10, endMs: 200 }],
			model: 'openai/whisper-large-v3',
			endpoint: 'x',
			estimatedTimings: false,
		})
	}

	const partial = await transcribeInCloud({
		source: new Blob([new Uint8Array(16)]),
		language: 'ne',
		model: null,
		durationSeconds: 250,
		onProgress: () => {},
		signal: new AbortController().signal,
	})
	check('a failing chunk is retried', attempts === 3, attempts)
	check('the other chunks still produce a transcript', partial.words.length === 2, partial.words.length)
	check('the loss is counted, not thrown', partial.failedChunks === 1, partial.failedChunks)
}

async function checkTranscribeRoute() {
	console.log('\n/api/captions/transcribe')
	const status = await transcribeRoute.GET().json()
	check('reports itself configured when a key is set', status.configured === true)
	check('offers at least one endpoint', status.endpoints.length > 0)

	global.fetch = async () =>
		nvidiaReply({
			text: 'नमस्ते this is a test',
			segments: [
				{
					start: 0,
					end: 2,
					text: 'नमस्ते this is a test',
					words: [
						{ word: 'नमस्ते', start: 0.1, end: 0.6 },
						{ word: 'this', start: 0.7, end: 0.95 },
						{ word: 'test', start: 1.2, end: 1.8 },
					],
				},
			],
		})
	let body = await (await transcribeRoute.POST(audioRequest())).json()
	check('OpenAI verbose JSON is understood', body.words.length === 3, body.words)
	check('seconds are converted to milliseconds', body.words[0].endMs === 600, body.words[0])
	check('Devanagari survives the round trip', body.words[0].text === 'नमस्ते', body.words[0])
	check('timings are not flagged as estimated', body.estimatedTimings === false)

	global.fetch = async () =>
		nvidiaReply({
			results: [
				{
					alternatives: [
						{
							transcript: 'hello there friend',
							words: [
								{ word: 'hello', start_time: 120, end_time: 480 },
								{ word: 'there', start_time: 500, end_time: 900 },
								{ word: 'friend', start_time: 950, end_time: 1600 },
							],
						},
					],
				},
			],
		})
	body = await (await transcribeRoute.POST(audioRequest())).json()
	check('Riva results are understood', body.words.length === 3, body.words)
	check('millisecond timings are left alone', body.words[2].endMs === 1600, body.words[2])

	global.fetch = async () => nvidiaReply({ text: 'just the words no timings here' })
	body = await (await transcribeRoute.POST(audioRequest(4000))).json()
	check('a bare transcript still yields words', body.words.length === 6, body.words.length)
	check('estimated words fill the chunk exactly', body.words.at(-1).endMs === 4000, body.words.at(-1))
	check('the estimate is declared', body.estimatedTimings === true)

	const dialects = []
	global.fetch = async (url, init) => {
		dialects.push([...init.body.keys()])
		if (dialects.length === 1) {
			return nvidiaReply({ error: { message: 'unknown field timestamp_granularities' } }, 422)
		}
		return nvidiaReply({
			text: 'hello',
			words: [{ word: 'hello', start_time: 0, end_time: 500 }],
		})
	}
	body = await (await transcribeRoute.POST(audioRequest())).json()
	check('a rejected dialect falls through to the next', body.words.length === 1, body)
	check('the fallback speaks the Riva dialect', dialects[1].includes('word_time_offsets'), dialects[1])

	global.fetch = async () => nvidiaReply({ error: { message: 'invalid api key' } }, 401)
	const rejected = await transcribeRoute.POST(audioRequest())
	body = await rejected.json()
	check('a bad key is reported as a credential problem', body.code === 'credentials', body.code)
	check('the message says what a key looks like', /nvapi-/.test(body.error))
}

async function checkRefineRoute() {
	console.log('\n/api/captions/refine')
	const lines = ['hello there my friend', 'this is a test of the studio']

	global.fetch = async () => chatReply(JSON.stringify(['Hello there, my friend.', 'This is a test of the studio.']))
	let body = await (
		await refineRoute.POST(jsonRequest('http://localhost/api/captions/refine', { lines, language: 'en' }))
	).json()
	check('the line count never changes', body.lines.length === 2, body.lines)
	check('punctuation is applied', body.lines[0] === 'Hello there, my friend.', body.lines[0])
	check('both changes are counted', body.changed === 2, body.changed)

	global.fetch = async () => chatReply(JSON.stringify(['merged everything into one line']))
	body = await (
		await refineRoute.POST(jsonRequest('http://localhost/api/captions/refine', { lines, language: 'en' }))
	).json()
	check('a re-segmented reply is rejected', body.lines[0] === lines[0], body.lines)
	check('the rejection is explained', typeof body.notice === 'string', body.notice)

	global.fetch = async () =>
		chatReply(
			JSON.stringify([
				'Hello there, my friend, and welcome to this greatly expanded sentence that the model invented from nothing at all.',
				'This is a test of the studio.',
			]),
		)
	body = await (
		await refineRoute.POST(jsonRequest('http://localhost/api/captions/refine', { lines, language: 'en' }))
	).json()
	check('a runaway rewrite keeps the original line', body.lines[0] === lines[0], body.lines[0])
	check('the sane line is still improved', body.lines[1].endsWith('.'), body.lines[1])

	delete process.env.NVIDIA_API_KEY
	global.fetch = async () => {
		throw new Error('the refine route must not call NVIDIA without a key')
	}
	body = await (
		await refineRoute.POST(jsonRequest('http://localhost/api/captions/refine', { lines, language: 'ne' }))
	).json()
	check('no key means the transcript is returned untouched', body.lines[0] === lines[0])
	check('and the user is told why', /NVIDIA_API_KEY/.test(body.notice ?? ''), body.notice)
	process.env.NVIDIA_API_KEY = 'nvapi-check'
}

async function main() {
	await checkChunker()
	await checkUploader()
	await checkTranscribeRoute()
	await checkRefineRoute()

	if (failures > 0) {
		console.error(`\n${failures} of ${checks} checks failed.`)
		process.exit(1)
	}
	console.log(`\nAll ${checks} caption checks passed.`)
}

main().catch((error) => {
	console.error(error)
	process.exit(1)
})
