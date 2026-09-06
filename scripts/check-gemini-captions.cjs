/** Gemini wire contract, fallback behavior, and timed subtitle regression checks. No network. */
require('sucrase/register')
const assert = require('node:assert/strict')
const { parseGeminiTranscript, callGemini } = require('../lib/captions/gemini.ts')
const route = require('../app/api/captions/transcribe/route.ts')
const audioModule = require('../lib/captions/audio.ts')
const { transcribeInCloud } = require('../lib/captions/cloud-transcribe.ts')
const { groupWordsIntoCues, cuesToSrt } = require('../lib/captions/cues.ts')

const annotations = [
	{ type: 'word_info', text: 'नमस्ते', start_offset: '0.100s', end_offset: '0.450s' },
	{ type: 'word_info', text: 'very', start_offset: '0.500s', end_offset: '0.750s' },
	{ type: 'word_info', text: 'very', start_offset: '0.800s', end_offset: '1.050s' },
	{ type: 'word_info', text: 'good.', start_offset: '1.100s', end_offset: '1.450s' },
]
const fixture = (words = annotations, text = words.map(word => word.text).join(' ')) => ({
	id: 'test-interaction', status: 'completed', output_text: text,
	steps: [{ id: 'test-step', type: 'model_output', content: [{ type: 'text', text, annotations: words }] }],
})
const reply = (body, status = 200) => Response.json(body, { status })
function wav() {
	const bytes = Buffer.alloc(44 + 3 * 32000)
	bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8)
	bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22)
	bytes.writeUInt32LE(16000, 24); bytes.writeUInt32LE(32000, 28)
	bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34)
	bytes.write('data', 36); bytes.writeUInt32LE(bytes.length - 44, 40)
	return new Blob([bytes], { type: 'audio/wav' })
}
function request(provider = 'auto') {
	const form = new FormData()
	form.set('audio', wav(), 'audio.wav'); form.set('durationMs', '3000')
	form.set('language', 'auto'); form.set('provider', provider)
	return new Request('http://localhost/api/captions/transcribe', { method: 'POST', body: form })
}
const call = signal => callGemini({ audio: wav(), key: 'test-key', language: 'auto', durationMs: 3000, signal: signal ?? new AbortController().signal })

async function main() {
	const parsed = parseGeminiTranscript(fixture(), 3000)
	assert.deepEqual(parsed.words.map(word => word.text), ['नमस्ते', 'very', 'very', 'good.'])
	assert.equal(parsed.words[0].startMs, 100)
	assert.equal(parsed.words[3].endMs, 1450)
	for (const patch of [
		{ start_offset: '-0.100s' }, { start_offset: 'bad' }, { end_offset: '0.100s' },
		{ end_offset: '4s' }, { text: '' }, { start_offset: 100 },
	]) assert.throws(() => parseGeminiTranscript(fixture([{ ...annotations[0], ...patch }]), 3000))
	assert.throws(() => parseGeminiTranscript(fixture([annotations[1], annotations[0]]), 3000))
	assert.throws(() => parseGeminiTranscript(fixture(annotations.slice(0, 1), 'नमस्ते missing speech'), 3000))
	assert.throws(() => parseGeminiTranscript({ ...fixture(), status: 'failed' }, 3000))
	assert.deepEqual(parseGeminiTranscript(fixture([], ''), 3000).words, [])
	console.log('PASS strict timestamps, completeness, Devanagari, repetitions, silence')

	let calls = 0
	global.fetch = async (input, init) => {
		calls++
		const req = new Request(input, init)
		assert.match(req.url, /^https:\/\/generativelanguage.googleapis.com\/v1beta\/interactions/)
		assert.equal(req.headers.get('x-goog-api-key'), 'test-key')
		const body = await req.json()
		assert.equal(body.model, 'gemini-3.5-transcribe')
		assert.equal(body.store, false)
		assert.equal(body.input[0].mime_type, 'audio/wav')
		assert.equal(Buffer.from(body.input[0].data, 'base64').subarray(0, 4).toString(), 'RIFF')
		assert.deepEqual(body.generation_config.transcription_config, {
			language_codes: [], mode: { type: 'verbatim', timestamp_granularities: ['word'] },
		})
		return reply(fixture())
	}
	await call()
	assert.equal(calls, 1)
	console.log('PASS official SDK request: inline WAV, verbatim, word timestamps, automatic language, no storage')

	calls = 0
	global.fetch = async () => ++calls === 1 ? reply({ error: { code: 429, message: 'quota' } }, 429) : reply(fixture())
	await call(); assert.equal(calls, 2)
	calls = 0
	global.fetch = async () => { calls++; return reply({ error: { code: 403, message: 'secret should never be echoed' } }, 403) }
	await assert.rejects(call(), error => error.code === 'credentials' && !error.message.includes('secret'))
	assert.equal(calls, 1)
	calls = 0
	global.fetch = async () => { calls++; return reply(fixture(annotations, 'incomplete')) }
	await assert.rejects(call(), error => error.code === 'invalid-transcript')
	assert.equal(calls, 2)
	const aborted = new AbortController(); aborted.abort()
	await assert.rejects(call(aborted.signal)); assert.equal(calls, 2)

	calls = 0
	global.fetch = async () => { calls++; return reply(fixture([{ ...annotations[0], start_offset: '0.450s' }, ...annotations.slice(1)])) }
	const collapsed = await call()
	assert.equal(calls, 2)
	assert.deepEqual(collapsed.words[0], { text: annotations[0].text, startMs: 450, endMs: 451 })
	assert.deepEqual(collapsed.words.slice(1), parsed.words.slice(1))
	assert.equal(collapsed.timingWarnings.length, 1)
	assert.match(collapsed.timingWarnings[0], /1 ms display span/)

	console.log('PASS bounded retries, invalid-output retry, credential redaction, cancellation')

	process.env.GEMINI_API_KEY = 'test-key'; process.env.GROQ_API_KEY = 'test-groq'
	delete process.env.GOOGLE_API_KEY; delete process.env.NVIDIA_API_KEY
	assert.equal((await route.GET().json()).primary, 'gemini')
	calls = 0
	global.fetch = async input => {
		calls++
		assert.match(String(input instanceof Request ? input.url : input), /generativelanguage/)
		return reply(fixture())
	}
	let body = await (await route.POST(request())).json()
	assert.equal(body.provider, 'gemini'); assert.equal(body.fallbackUsed, false); assert.equal(calls, 1)
	const transports = []
	global.fetch = async input => {
		const url = String(input instanceof Request ? input.url : input)
		transports.push(url)
		if (url.includes('generativelanguage')) return reply({ error: { code: 403, message: 'denied' } }, 403)
		return reply({ text: 'hello', words: [{ word: 'hello', start: 0.1, end: 0.5 }] })
	}
	body = await (await route.POST(request())).json()
	assert.equal(body.provider, 'groq'); assert.equal(body.fallbackUsed, true)
	assert.match(body.fallbackReason, /gemini/i); assert.equal(transports.length, 2)
	transports.length = 0
	assert.equal((await route.POST(request('gemini'))).status, 502)
	assert.equal(transports.length, 1)
	transports.length = 0
	body = await (await route.POST(request('groq'))).json()
	assert.equal(body.provider, 'groq'); assert.equal(body.fallbackUsed, false)
	assert.ok(transports.every(url => url.includes('groq.com')))
	assert.equal((await route.POST(request('nvidia'))).status, 503)
	assert.equal((await route.POST(request('unknown'))).status, 400)
	console.log('PASS Gemini primary, explicit provider isolation, reported fallback, missing configuration')

	// Exercise the browser uploader and subtitle export with a recognizer clock
	// deliberately away from the VAD map. No heuristic may shift valid timestamps.
	const chunks = [
		{ index: 0, startMs: 0, endMs: 3000, contextMs: 0, speech: [{ startMs: 0, endMs: 100 }], blob: wav() },
		{ index: 1, startMs: 3000, endMs: 6000, contextMs: 1500, speech: [], blob: wav() },
	]
	const originalStream = audioModule.streamAudioChunks
	audioModule.streamAudioChunks = async args => {
		for (const chunk of chunks) await args.onChunk(chunk)
		return { chunks: 2, speech: [{ startMs: 0, endMs: 100 }], durationMs: 6000, silent: false }
	}
	global.fetch = async (_url, init) => {
		assert.equal(init.body.get('provider'), 'gemini')
		const index = Number(init.body.get('fileName').match(/\d+/)[0])
		return reply({ text: parsed.text, words: index === 0 ? parsed.words : [{ text: 'next', startMs: 1600, endMs: 1800 }],
			model: 'gemini-3.5-transcribe', provider: 'gemini', endpoint: 'gemini', estimatedTimings: false })
	}
	try {
		const result = await transcribeInCloud({ source: wav(), provider: 'gemini', language: 'auto', model: null,
			durationSeconds: 6, onProgress: () => {}, signal: new AbortController().signal })
		assert.deepEqual(result.words.slice(0, 4), parsed.words)
		assert.deepEqual(result.words[4], { text: 'next', startMs: 3100, endMs: 3300 })
		assert.equal(result.alignment.offsetMs, 0)
		const cues = groupWordsIntoCues(result.words, { maxWordsPerCue: 6, maxCharactersPerCue: 60, maxCueDurationMs: 4000, splitOnGapMs: 500 })
		assert.match(cuesToSrt(cues), /very very good/)
		assert.match(cuesToSrt(cues), /00:00:03,100 --> 00:00:03,300/)

		global.fetch = async (_url, init) => {
			const index = Number(init.body.get('fileName').match(/\d+/)[0])
			return reply({ text: 'very very', words: index === 0
				? [{ text: 'very', startMs: 2300, endMs: 2450 }, { text: 'very', startMs: 2500, endMs: 2820 }]
				: [{ text: 'very', startMs: 1030, endMs: 1370 }, { text: 'good', startMs: 1500, endMs: 1750 }],
				model: 'gemini-3.5-transcribe', provider: 'gemini', endpoint: 'gemini', estimatedTimings: false })
		}
		const boundary = await transcribeInCloud({ source: wav(), provider: 'gemini', language: 'auto', model: null,
			durationSeconds: 6, onProgress: () => {}, signal: new AbortController().signal })
		assert.deepEqual(boundary.words.map(word => word.text), ['very', 'very', 'good'])
		assert.equal(boundary.words[1].startMs, 2530)

	} finally { audioModule.streamAudioChunks = originalStream }
	console.log('PASS unchanged word clocks, retained repetitions, overlap offsets, SRT export')
	console.log('All Gemini caption checks passed.')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
