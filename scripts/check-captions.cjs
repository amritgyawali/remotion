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
const { buildCaptionSource } = require('../lib/captions/composition-source.ts')
const { CAPTION_PRESETS, CAPTION_FONT_IDS, CAPTION_FONTS } = require('../lib/captions/style-presets.ts')
const tools = require('../lib/captions/tools.ts')
const { cuesToAss } = require('../lib/captions/ass.ts')
const { transform } = require('sucrase')

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

/* ------------------------------------------------- the generated composition */

const CUES = [
	{
		id: 'cue-1',
		text: 'यो feature धेरै राम्रो छ',
		startMs: 0,
		endMs: 1800,
		tokens: [
			{ text: 'यो', fromMs: 0, toMs: 400 },
			{ text: 'feature', fromMs: 400, toMs: 1000 },
			{ text: 'धेरै', fromMs: 1000, toMs: 1400 },
			{ text: 'राम्रो', fromMs: 1400, toMs: 1650 },
			{ text: 'छ', fromMs: 1650, toMs: 1800 },
		],
	},
	{
		id: 'cue-2',
		text: 'Ship it today',
		startMs: 2000,
		endMs: 3400,
		tokens: [
			{ text: 'Ship', fromMs: 2000, toMs: 2500 },
			{ text: 'it', fromMs: 2500, toMs: 2800 },
			{ text: 'today', fromMs: 2800, toMs: 3400 },
		],
	},
]

const PLAN = { id: 'CaptionedVideo', width: 1080, height: 1920, fps: 30, durationInFrames: 120 }

/** Comments talk about Math.random(); only executable code may not use it. */
const stripComments = (code) =>
	code.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1')

/** The same contract the studio compiler and the render path both rely on. */
function auditSource(code) {
	const issues = []
	try {
		transform(code, {
			transforms: ['typescript', 'jsx'],
			jsxRuntime: 'automatic',
			filePath: 'captioned-video.tsx',
		})
	} catch (error) {
		issues.push(`sucrase: ${String(error.message).split('\n')[0]}`)
	}
	const executable = stripComments(code)
	if (!/registerRoot\(/.test(executable)) issues.push('no registerRoot()')
	if (!/<Composition\b/.test(executable)) issues.push('no <Composition>')
	if (!/loadFont\(/.test(executable)) issues.push('no loadFont()')
	if (/Math\s*\.\s*random\s*\(/.test(executable)) issues.push('Math.random() breaks determinism')
	if (/\bDate\s*\.\s*now\s*\(/.test(executable)) issues.push('Date.now() breaks determinism')
	for (const call of executable.matchAll(/staticFile\(\s*['"]([^'"]*)['"]/g)) {
		if (!call[1].startsWith('assets/fonts/v1/')) issues.push(`unexpected asset ${call[1]}`)
	}
	return issues
}

function checkComposition() {
	console.log('\nGenerated composition')

	let broken = 0
	for (const preset of CAPTION_PRESETS) {
		const code = buildCaptionSource({
			videoSrc: 'https://example.com/clip.mp4',
			videoName: 'clip.mp4',
			cues: CUES,
			style: { ...preset.style, devanagari: true },
			plan: PLAN,
			origin: 'transcribed with NVIDIA speech recognition',
		})
		const issues = auditSource(code)
		if (issues.length > 0) {
			broken++
			console.log(`  FAIL ${preset.id}: ${issues.join('; ')}`)
		}
	}
	check(`all ${CAPTION_PRESETS.length} presets compile to a valid Remotion file`, broken === 0, broken)

	// Every bundled face has to survive the same round trip, because a font is
	// the one style field that changes the generated file rather than a prop.
	let badFonts = 0
	for (const id of CAPTION_FONT_IDS) {
		const code = buildCaptionSource({
			videoSrc: 'https://example.com/clip.mp4',
			videoName: 'clip.mp4',
			cues: CUES,
			style: { ...CAPTION_PRESETS[0].style, fontId: id },
			plan: PLAN,
			origin: 'test',
		})
		const face = CAPTION_FONTS[id]
		const issues = auditSource(code)
		if (!code.includes(`assets/fonts/v1/${face.file}`)) issues.push('font file not referenced')
		if (!code.includes(`FONT_STACK = "'${face.family}'`)) issues.push('family missing from the stack')
		if (!face.variable && !/FONT_STATIC_WEIGHT: number \| null = \d+/.test(code)) {
			issues.push('a static face must pin its weight')
		}
		if (issues.length > 0) {
			badFonts++
			console.log(`  FAIL ${id}: ${issues.join('; ')}`)
		}
	}
	check(`all ${CAPTION_FONT_IDS.length} bundled faces render into the file`, badFonts === 0, badFonts)

	const fancy = buildCaptionSource({
		videoSrc: 'https://example.com/clip.mp4',
		videoName: 'clip.mp4',
		cues: CUES,
		style: {
			...CAPTION_PRESETS[0].style,
			fill: 'gradient',
			karaokeFill: true,
			glow: 0.7,
			extrude: 0.6,
			tilt: -3,
			backdropBlur: 12,
			wordEffect: 'jitter',
			reveal: 'typewriter',
			emphasisWords: ['today'],
		},
		plan: PLAN,
		origin: 'test',
	})
	check('every effect together still compiles', auditSource(fancy).length === 0, auditSource(fancy))
	check('the karaoke wipe reaches the file', /linear-gradient\(90deg/.test(fancy))
	check('the typewriter reveal reaches the file', /typedFor/.test(fancy))
	check('the backdrop blur reaches the file', /backdropFilter/.test(fancy))
}

/* -------------------------------------------------------------- the tools */

function checkTools() {
	console.log('\nBulk editing tools')

	const replaced = tools.findReplace(CUES, {
		find: 'Ship',
		replace: 'Send',
		caseSensitive: false,
		wholeWord: true,
	})
	check('find and replace rewrites the line', replaced.cues[1].text.startsWith('Send'), replaced.cues[1].text)
	check('and counts what it did', replaced.replaced === 1, replaced.replaced)
	check(
		'a same-length replacement keeps every word timing',
		replaced.cues[1].tokens[0].fromMs === CUES[1].tokens[0].fromMs &&
			replaced.cues[1].tokens[2].toMs === CUES[1].tokens[2].toMs,
		replaced.cues[1].tokens,
	)
	check(
		'whole-word matching does not fire inside a word',
		tools.findReplace(CUES, { find: 'hip', replace: 'x', caseSensitive: false, wholeWord: true })
			.replaced === 0,
	)

	const titled = tools.transformCase(CUES, 'title')
	check('title case capitalises the line', titled[1].text === 'Ship It Today', titled[1].text)
	const sentenced = tools.transformCase([{ ...CUES[1], text: 'ship it today. now go' }], 'sentence')
	check(
		'sentence case capitalises after a full stop',
		sentenced[0].text === 'Ship it today. Now go',
		sentenced[0].text,
	)
	check(
		'case changes never touch Devanagari word count',
		tools.transformCase(CUES, 'upper')[0].tokens.length === CUES[0].tokens.length,
	)

	const messy = [{ ...CUES[1], text: 'hello ,  world ... yes  "quoted"' }]
	const tidied = tools.cleanPunctuation(messy)
	check(
		'punctuation tidy fixes spacing, ellipsis and quotes',
		tidied.cues[0].text === 'hello, world… yes “quoted”',
		tidied.cues[0].text,
	)

	const keywords = tools.suggestKeywords([
		...CUES,
		{ ...CUES[1], id: 'x', text: 'today today the the', tokens: [
			{ text: 'today', fromMs: 0, toMs: 1 },
			{ text: 'today', fromMs: 1, toMs: 2 },
			{ text: 'the', fromMs: 2, toMs: 3 },
			{ text: 'the', fromMs: 3, toMs: 4 },
		] },
	])
	check('keywords rank by frequency', keywords[0].word === 'today', keywords.slice(0, 3))
	check('English stopwords are excluded', !keywords.some((entry) => entry.word === 'the'))
	check('Nepali stopwords are excluded', !keywords.some((entry) => entry.word === 'छ'))

	const stretched = tools.stretchTiming(CUES, 1.05, 10_000)
	check('stretching scales every timestamp', stretched[1].startMs === 2100, stretched[1].startMs)
	check('and scales word timings with them', stretched[1].tokens[0].fromMs === 2100)

	const held = tools.holdThroughGaps(CUES, 400, 10_000)
	check('holding extends into the gap', held[0].endMs > CUES[0].endMs, held[0].endMs)
	check('but never past the next cue', held[0].endMs < CUES[1].startMs, held[0].endMs)
	check('and never moves a start', held[0].startMs === CUES[0].startMs)

	const snapped = tools.snapToFrames(CUES, 25)
	check(
		'snapping lands on frame boundaries',
		snapped.every((cue) => Math.abs((cue.startMs % 40) - 0) < 1),
		snapped.map((cue) => cue.startMs),
	)

	const split = tools.splitLongCues(CUES, 1000)
	check('long cues are split', split.length > CUES.length, split.length)
	check(
		'splitting keeps every word',
		split.reduce((sum, cue) => sum + cue.tokens.length, 0) ===
			CUES.reduce((sum, cue) => sum + cue.tokens.length, 0),
	)

	const merged = tools.mergeShortCues(
		[
			{ ...CUES[1], id: 'a', startMs: 0, endMs: 300, tokens: [{ text: 'Hi', fromMs: 0, toMs: 300 }], text: 'Hi' },
			{ ...CUES[1], id: 'b', startMs: 350, endMs: 1400 },
		],
		600,
	)
	check('short flashes fold into their neighbour', merged.length === 1, merged.length)

	const speakers = tools.splitOnSpeakers([
		{ ...CUES[1], text: 'Ram: hello there Sita: hi back', tokens: [] },
	])
	check('speaker prefixes split onto their own cues', speakers.found === 1, speakers)
}

/* ------------------------------------------------------------ ass export */

function checkAss() {
	console.log('\nStyled .ass export')
	const style = { ...CAPTION_PRESETS[0].style, textColor: '#ffffff', strokeColor: '#000000' }
	const ass = cuesToAss(CUES, style, { width: 1080, height: 1920 })

	check('declares the script resolution', /PlayResX: 1080/.test(ass) && /PlayResY: 1920/.test(ass))
	check('carries a styled Caption line', /^Style: Caption,Anton,/m.test(ass), ass.match(/^Style:.*/m)?.[0])
	check('writes ASS BGR colours', /&H00FFFFFF/.test(ass), ass.match(/&H[0-9A-F]{8}/g)?.slice(0, 3))
	check('emits one dialogue per cue', (ass.match(/^Dialogue:/gm) ?? []).length === CUES.length)
	check('uses h:mm:ss.cc timing', /Dialogue: 0,0:00:00\.00,0:00:01\.80/.test(ass), ass.match(/^Dialogue:.*/m)?.[0])
	check('carries per-word karaoke tags', /\{\\k\d+\}/.test(ass))
	check(
		'keeps Devanagari intact',
		ass.includes('धेरै'),
	)

	const plain = cuesToAss(CUES, { ...style, highlight: 'none' }, { width: 1080, height: 1920 })
	check('a static look exports without karaoke tags', !/\{\\k/.test(plain))
}

async function main() {
	await checkChunker()
	await checkUploader()
	await checkTranscribeRoute()
	await checkRefineRoute()
	checkComposition()
	checkTools()
	checkAss()

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
