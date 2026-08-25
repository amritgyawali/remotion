/**
 * Verifies the automatic captioning pipeline without touching the network.
 *
 * Six things are checked, because these are the parts that fail silently and
 * ruin a transcript rather than throwing:
 *
 *   1. speech detection       - the speech map is what every timing decision is
 *                               made against, so it has to find real pauses and
 *                               refuse to invent ones inside unbroken speech
 *   2. alignment              - syllables drive speaking time, words never land
 *                               in a silence, and a constant offset between the
 *                               recogniser and the audio is measured and removed
 *   3. the audio chunker      - chunk sizes stay under the request body limit,
 *                               cuts land in silence, a cut that cannot be
 *                               placed in a pause carries overlap, WAV headers
 *                               are valid
 *   4. the cloud uploader     - chunk timings are offset into the clip, text
 *                               without timings is aligned rather than spread,
 *                               and a chunk that keeps failing costs its own
 *                               seconds only
 *   5. /api/captions/transcribe - every NVIDIA response shape normalises to the
 *                               same word list, in milliseconds, and a rejected
 *                               request dialect falls through to the next one
 *   6. /api/captions/refine   - the clean-up pass never changes the line count
 *                               and never rewrites a line beyond recognition
 *   7. subtitle import       - an .srt or .vtt from anywhere decodes in any
 *                               encoding, parses even when it is malformed, and
 *                               never silently swallows a line of transcript
 *   8. Groq, the primary ASR  - it is tried first, its request is shaped the way
 *                               Whisper actually wants, its prompt demonstrates
 *                               style instead of instructing, and NVIDIA takes
 *                               over only when Groq cannot answer
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
// These checks stub HTTP only; the gRPC transport has its own suite in
// scripts/check-riva.cjs, which runs a real Riva-speaking server.
process.env.NVIDIA_ASR_DISABLE_GRPC = '1'

const { streamAudioChunks } = require('../lib/captions/audio.ts')
const vad = require('../lib/captions/vad.ts')
const align = require('../lib/captions/align.ts')
const script = require('../lib/captions/devanagari.ts')
const loanwords = require('../lib/captions/loanwords.ts')
const { transcribeInCloud } = require('../lib/captions/cloud-transcribe.ts')
const transcribeRoute = require('../app/api/captions/transcribe/route.ts')
const refineRoute = require('../app/api/captions/refine/route.ts')
const { buildCaptionSource } = require('../lib/captions/composition-source.ts')
const {
	CAPTION_PRESETS,
	CAPTION_FONT_IDS,
	CAPTION_FONTS,
	DEVANAGARI_FONT_IDS,
	DEVANAGARI_FONTS,
	DEFAULT_CAPTION_SOUND,
	soundForPreset,
} = require('../lib/captions/style-presets.ts')
const tools = require('../lib/captions/tools.ts')
const { cuesToAss } = require('../lib/captions/ass.ts')
const sourceAudit = require('../lib/source-audit.ts')
const sfxFile = require('../lib/captions/sfx.ts')
const subtitleImport = require('../lib/captions/subtitle-import.ts')
const asrPrompt = require('../lib/captions/asr-prompt.ts')
const cueFile = require('../lib/captions/cues.ts')
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

/** Unbroken speech: no pause anywhere, so no boundary can be placed in one. */
function synthesiseContinuous(seconds) {
	const buffer = new FakeAudioBuffer(1, seconds * RATE, RATE)
	const data = buffer.getChannelData(0)
	for (let index = 0; index < data.length; index++) {
		// Amplitude wanders so the track is not one flat tone, but never reaches
		// silence - which is exactly the case the overlap exists for.
		data[index] = Math.sin(index * 0.05) * (0.3 + 0.1 * Math.sin(index / 4000))
	}
	return buffer
}

/** A Float32Array of tone bursts, for testing the detector on its own. */
function burstWaveform(pattern) {
	const total = pattern.reduce((sum, entry) => sum + entry.seconds, 0)
	const data = new Float32Array(Math.round(total * RATE))
	let cursor = 0
	for (const entry of pattern) {
		const frames = Math.round(entry.seconds * RATE)
		for (let index = 0; index < frames; index++) {
			data[cursor + index] = entry.loud ? Math.sin((cursor + index) * 0.05) * 0.3 : 0
		}
		cursor += frames
	}
	return data
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

function checkScript() {
	console.log('\nDevanagari, both directions')

	// Typing: romanised Nepali in, Devanagari out.
	const typed = [
		['namaste', '\u0928\u092e\u0938\u094d\u0924\u0947'],
		['banda', '\u092c\u0928\u094d\u0926'],
		['ghar', '\u0918\u0930'],
		['kaam', '\u0915\u093e\u092e'],
		['hajur', '\u0939\u091c\u0941\u0930'],
		['chha', '\u091b'],
		['lekhchhu', '\u0932\u0947\u0916\u094d\u091b\u0941'],
	]
	for (const [latin, expected] of typed) {
		const actual = script.transliterateWord(latin)
		check(`"${latin}" types as ${expected}`, actual === expected, actual)
	}

	// An acronym is what a bilingual speaker shouts in the middle of a Nepali
	// sentence, and transliterating it produces nothing anybody wants to read.
	check('OTP is left in Latin', script.transliterateWord('OTP') === 'OTP')
	check('ATM is left in Latin', script.transliterateWord('ATM') === 'ATM')
	check('a lowercase word is not', script.transliterateWord('otp') !== 'otp')
	check(
		'text already in Devanagari is untouched',
		script.transliterateWord('\u0928\u092e\u0938\u094d\u0924\u0947') === '\u0928\u092e\u0938\u094d\u0924\u0947',
	)
	check(
		'spacing survives a whole line',
		script.transliterateToDevanagari('ma ghar jaanchhu') ===
			'\u092e \u0918\u0930 \u091c\u093e\u0928\u094d\u091b\u0941',
		script.transliterateToDevanagari('ma ghar jaanchhu'),
	)

	// The editor converts a word only once it is finished, so it has to find
	// exactly the run of Latin the caret is sitting at the end of.
	const run = script.trailingLatinRun('\u0928\u092e\u0938\u094d\u0924\u0947 namaste', 15)
	check('the trailing Latin run is found', run !== null && run.from === 7 && run.to === 14, run)
	check('a caret after Devanagari finds no run', script.trailingLatinRun('\u0928\u092e\u0938\u094d\u0924\u0947', 5) === null)

	// Reading: Devanagari back out to something an English lexicon recognises.
	check('a spelling sounds out', script.romanize('\u092c\u0948\u0902\u0915') === 'bainka', script.romanize('\u092c\u0948\u0902\u0915'))
	check(
		'the skeleton ignores the vowels a recogniser invents',
		script.skeletonKey(script.romanize('\u0915\u092e\u094d\u092a\u094d\u092f\u0941\u091f\u0930')) === script.skeletonKey('computer'),
		script.skeletonKey(script.romanize('\u0915\u092e\u094d\u092a\u094d\u092f\u0941\u091f\u0930')),
	)
}

function checkLoanwords() {
	console.log('\nCode switching')

	const restored = [
		['\u092c\u0948\u0902\u0915', 'bank'],
		['\u090f\u0915\u093e\u0909\u0928', 'account'],
		['\u0905\u092a\u0921\u0947\u091f', 'update'],
		['\u0913\u091f\u093f\u0935\u0940', 'OTP'],
		['\u0915\u092e\u094d\u092a\u094d\u092f\u0941\u091f\u0930', 'computer'],
		['\u092c\u094d\u0930\u0938', 'brush'],
		['\u0915\u093e\u0930', 'car'],
		['\u092d\u094d\u092f\u093e\u0928', 'van'],
		['\u092e\u094b\u092c\u093e\u0907\u0932', 'mobile'],
		['\u0921\u093e\u0915\u094d\u091f\u0930', 'doctor'],
		['\u0925\u0948\u0902\u0915\u094d\u092f\u0942', 'thank you'],
		['\u0938\u094c\u0930\u094d', 'sir'],
	]
	for (const [devanagari, english] of restored) {
		const actual = loanwords.englishFor(devanagari)
		check(`${devanagari} is written as "${english}"`, actual === english, actual)
	}

	// The expensive mistake is the other direction, so it gets more checks than
	// the feature itself: a Nepali word turned into an English one is a wrong
	// transcript, while a loanword left in Devanagari is only an unpolished one.
	const kept = [
		'\u0915\u0930', // kar - "tax", shares a skeleton with "car"
		'\u092c\u0938', // bas - "sit", shares one with "bus"
		'\u092c\u0928\u094d\u0926', // banda - "closed", shares one with "band"
		'\u092e\u0947\u0930\u094b', // mero - "my"
		'\u0938\u0930\u0915\u093e\u0930', // sarkar - "government"
		'\u092e\u093f\u0932\u0947\u0915\u094b', // mileko - shares a skeleton with "milk"
		'\u092a\u094d\u0930\u0936\u094d\u0928', // prashna - "question"
		'\u0939\u094b', // ho - "yes"
	]
	for (const word of kept) {
		check(`${word} stays Nepali`, loanwords.englishFor(word) === null, loanwords.englishFor(word))
	}

	// A loanword that has taken a Nepali ending has stopped being foreign in
	// that sentence, and "bank\u092e\u093e" is not an improvement on \u092c\u0948\u0902\u0915\u092e\u093e.
	check('an inflected loanword is left whole', loanwords.englishFor('\u092c\u0948\u0902\u0915\u092e\u093e') === null)
	check('so is a plural one', loanwords.englishFor('\u090f\u0915\u093e\u0909\u0928\u094d\u091f\u0939\u0930\u0942') === null)
	check('English already in English is not touched', loanwords.englishFor('bank') === null)

	const line = loanwords.restoreEnglishInText(
		'\u0924\u092a\u093e\u0908\u0902\u0915\u094b \u092c\u0948\u0902\u0915 \u090f\u0915\u093e\u0909\u0928\u094d\u091f \u0905\u092a\u0921\u0947\u091f \u0939\u0941\u0901\u0926\u0948\u091b\u0964',
	)
	check('a code-switched line is rewritten', line.changed === 3, line)
	check(
		'and the Nepali around it survives',
		line.text.startsWith('\u0924\u092a\u093e\u0908\u0902\u0915\u094b bank account update'),
		line.text,
	)
	check('with its danda still attached', line.text.endsWith('\u0964'), line.text)
}

function checkSpeechDetection() {
	console.log('\nSpeech detection')

	const waveform = burstWaveform([
		{ seconds: 1.0, loud: true },
		{ seconds: 0.8, loud: false },
		{ seconds: 1.2, loud: true },
		{ seconds: 0.9, loud: false },
		{ seconds: 1.0, loud: true },
	])
	const result = vad.detectSpeech(waveform, { sampleRate: RATE })
	check('three spoken stretches are found', result.segments.length === 3, result.segments)
	check(
		'the first stretch starts at the start',
		result.segments[0].startMs < 60,
		result.segments[0],
	)
	check(
		'every pause is preserved as a gap',
		result.segments.every((segment, index) =>
			index === 0 || segment.startMs - result.segments[index - 1].endMs > 400,
		),
		result.segments,
	)
	check('the speech ratio is believable', result.speechRatio > 0.5 && result.speechRatio < 0.85, result.speechRatio)

	const silent = vad.detectSpeech(new Float32Array(RATE * 3), { sampleRate: RATE })
	check('digital silence yields no speech', silent.segments.length === 0, silent.segments)

	// Unbroken speech must not be carved up: a detector that splits it invents
	// pauses in the middle of words, and every word after one lands late.
	const continuous = vad.detectSpeech(
		burstWaveform([{ seconds: 4, loud: true }]),
		{ sampleRate: RATE },
	)
	check('unbroken speech stays one stretch', continuous.segments.length === 1, continuous.segments)
	check(
		'and covers essentially all of it',
		continuous.segments[0] && continuous.segments[0].endMs - continuous.segments[0].startMs > 3_800,
		continuous.segments[0],
	)

	const segments = [
		{ startMs: 0, endMs: 1_000 },
		{ startMs: 2_000, endMs: 3_000 },
	]
	check('spoken time excludes the pause', vad.totalSpeechMs(segments) === 2_000)
	check(
		'a speech position maps over the pause',
		vad.speechPositionToMs(segments, 1_500, 'start') === 2_500,
		vad.speechPositionToMs(segments, 1_500, 'start'),
	)
	check(
		'the silence between two stretches is found',
		vad.silencesBetween(segments, 0, 3_000).some((gap) => gap.startMs === 1_000 && gap.endMs === 2_000),
		vad.silencesBetween(segments, 0, 3_000),
	)
}

function checkAlignment() {
	console.log('\nAlignment')

	// na-ma-ste: the virama binds the last two consonants into one nucleus.
	check('a Devanagari word counts its syllables', align.syllableCount('नमस्ते') === 3, align.syllableCount('नमस्ते'))
	check('a one-syllable Devanagari word counts one', align.syllableCount('छ') === 1, align.syllableCount('छ'))
	check('an English word counts its syllables', align.syllableCount('video') === 3, align.syllableCount('video'))
	check('and a two-syllable one counts two', align.syllableCount('caption') === 2, align.syllableCount('caption'))
	check('a silent trailing e is not a syllable', align.syllableCount('time') === 1, align.syllableCount('time'))
	check(
		'a long Devanagari word outweighs a short one',
		align.speakingWeight('राम्रो') > align.speakingWeight('छ'),
	)
	check(
		'a full stop buys a longer beat',
		align.speakingWeight('यो।') > align.speakingWeight('यो'),
	)

	// The case this whole pipeline exists for: text with no timings at all.
	const speech = [
		{ startMs: 0, endMs: 2_000 },
		{ startMs: 6_000, endMs: 8_000 },
	]
	const placed = align.distributeOverSpeech(
		['one', 'two', 'three', 'four'],
		speech,
		0,
		8_000,
	)
	check('every word is placed', placed.length === 4, placed)
	check(
		'no word is left sitting in the silence',
		placed.every((word) =>
			speech.some((segment) => word.startMs < segment.endMs && word.endMs > segment.startMs),
		),
		placed,
	)
	check(
		'the pause opens a hole in the captions',
		placed.some((word, index) => index > 0 && word.startMs - placed[index - 1].endMs > 3_000),
		placed,
	)
	check(
		'nothing runs past the end of the audio',
		placed[placed.length - 1].endMs <= 8_000,
		placed[placed.length - 1],
	)

	const evenly = align.distributeOverSpeech(['one', 'two'], [], 0, 1_000)
	check('with no speech map it still spreads the words', evenly.length === 2, evenly)

	// A recogniser that runs late by a constant amount is the classic lip-sync
	// complaint, and a constant is the one error that can be measured exactly.
	const truth = [
		{ text: 'one', startMs: 100, endMs: 600 },
		{ text: 'two', startMs: 700, endMs: 1_200 },
		{ text: 'three', startMs: 2_100, endMs: 2_700 },
	]
	const map = truth.map((word) => ({ startMs: word.startMs, endMs: word.endMs }))
	const late = truth.map((word) => ({ ...word, startMs: word.startMs + 400, endMs: word.endMs + 400 }))
	const estimate = align.estimateOffsetMs(late, map)
	check('a 400ms lag is measured', Math.abs(estimate.offsetMs + 400) <= 40, estimate)
	check('and the overlap improves once it is removed', estimate.after > estimate.before, estimate)

	const snapped = align.snapWordsToSpeech(late, map)
	check('and taken back out', Math.abs(snapped.words[0].startMs - 100) <= 60, snapped.words[0])
	check('the word order survives', snapped.words.map((word) => word.text).join(' ') === 'one two three')

	// maxShiftMs 0 pins the offset pass so the rescue is what is being measured;
	// with it free, a single word would simply be shifted onto the speech.
	const stranded = align.snapWordsToSpeech(
		[{ text: 'lost', startMs: 1_500, endMs: 1_800 }],
		map,
		{ maxShiftMs: 0 },
	)
	check('a word stranded in a silence is rescued', stranded.rescued === 1, stranded)
	check(
		'and lands on speech',
		map.some(
			(segment) =>
				stranded.words[0].startMs < segment.endMs && stranded.words[0].endMs > segment.startMs,
		),
		stranded.words[0],
	)

	const overlapping = align.monotonic([
		{ text: 'a', startMs: 0, endMs: 900 },
		{ text: 'b', startMs: 400, endMs: 1_000 },
	])
	check('overlapping words are pushed apart', overlapping[1].startMs >= overlapping[0].endMs, overlapping)
}

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

	check('250s becomes five chunks of about a minute', result.chunks === 5, result.chunks)
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

	check(
		'every chunk carries the speech it holds',
		chunks.every((chunk) => Array.isArray(chunk.speech) && chunk.speech.length > 0),
		chunks.map((chunk) => chunk.speech.length),
	)
	check(
		'the clip-wide speech map covers the talking',
		result.speech.length > 100 && result.speechRatio > 0.6 && result.speechRatio < 0.95,
		{ segments: result.speech.length, ratio: result.speechRatio },
	)
	check(
		'a boundary in a pause needs no overlap',
		chunks.every((chunk) => chunk.contextMs === 0),
		chunks.map((chunk) => chunk.contextMs),
	)

	// Unbroken speech has no pause to cut in, so the word on the boundary is
	// rescued by handing the next chunk the tail of this one.
	decoded = synthesiseContinuous(150)
	const dense = []
	await streamAudioChunks({
		source: new Blob([new Uint8Array(16)]),
		durationHintSeconds: 150,
		onChunk: (chunk) => dense.push(chunk),
		signal: new AbortController().signal,
	})
	check(
		'a boundary mid-word carries overlap into the next chunk',
		dense.slice(1).every((chunk) => chunk.contextMs > 1_000),
		dense.map((chunk) => chunk.contextMs),
	)
	check(
		'the overlap is really in the blob',
		dense
			.slice(1)
			.every(
				(chunk) =>
					Math.abs(
						(chunk.blob.size - 44) / 2 / RATE - (chunk.endMs - chunk.startMs + chunk.contextMs) / 1000,
					) < 0.05,
			),
		dense.map((chunk) => chunk.blob.size),
	)
	check(
		'the chunks still tile the clip exactly once',
		dense.every((chunk, index) => index === 0 || chunk.startMs === dense[index - 1].endMs),
		dense.map((chunk) => [chunk.startMs, chunk.endMs]),
	)

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

	check('one request per chunk', requests === 5, requests)
	check('all words are kept', result.words.length === 10, result.words.length)
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

	// The failure this pipeline was rebuilt around: a hosted model that returns
	// a transcript and no clock. Spreading it across the minute is what put the
	// captions seconds away from the speaker; it is aligned to speech instead.
	decoded = synthesise(60)
	global.fetch = async () =>
		nvidiaReply({
			text: 'one two three four five six seven eight',
			words: [],
			model: 'openai/whisper-large-v3',
			endpoint: 'grpc:grpc.nvcf.nvidia.com:443',
			estimatedTimings: true,
		})
	const aligned = await transcribeInCloud({
		source: new Blob([new Uint8Array(16)]),
		language: 'ne',
		model: null,
		durationSeconds: 60,
		onProgress: () => {},
		signal: new AbortController().signal,
	})
	check('a timing-free reply still yields words', aligned.words.length === 8, aligned.words.length)
	check('and says the timings were aligned, not measured', aligned.timing === 'aligned', aligned.timing)
	check(
		'every word lands on detected speech',
		aligned.alignment.onSpeech === 1,
		aligned.alignment.onSpeech,
	)
	check(
		'and none of them sits in a pause',
		aligned.words.every((word) =>
			aligned.speech.some(
				(segment) => word.startMs < segment.endMs && word.endMs > segment.startMs,
			),
		),
		aligned.words,
	)

	decoded = synthesise(250)
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
	check('the other chunks still produce a transcript', partial.words.length === 4, partial.words.length)
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
	check('NVIDIA gets the Riva dialect first', dialects[0].includes('word_time_offsets'), dialects[0])
	check(
		'and the OpenAI form is the fallback',
		dialects[1].includes('response_format'),
		dialects[1],
	)

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
/** The sound layer is off unless a check is specifically about it. */
const SILENT_SOUND = { ...DEFAULT_CAPTION_SOUND, enabled: false }

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
			sound: SILENT_SOUND,
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
			sound: SILENT_SOUND,
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

	// The Devanagari companion is a second loadFont() call in the generated
	// file. If its family or file goes missing, Nepali words render as tofu
	// boxes on the render host while the preview looks fine, so every face on
	// the shelf is asserted rather than sampled.
	let badCompanions = 0
	for (const id of DEVANAGARI_FONT_IDS) {
		const face = DEVANAGARI_FONTS[id]
		const code = buildCaptionSource({
			videoSrc: 'https://example.com/clip.mp4',
			videoName: 'clip.mp4',
			cues: CUES,
			style: { ...CAPTION_PRESETS[0].style, devanagari: true, devanagariFontId: id },
			sound: SILENT_SOUND,
			plan: PLAN,
			origin: 'test',
		})
		const issues = auditSource(code)
		if (!code.includes(`assets/fonts/v1/${face.file}`)) issues.push('companion file not referenced')
		if (!code.includes(`family: ${JSON.stringify(face.family)}`)) issues.push('companion never loaded')
		if (!code.includes(`'${face.family}'`)) issues.push('companion missing from the stack')
		if (issues.length > 0) {
			badCompanions++
			console.log(`  FAIL ${id}: ${issues.join('; ')}`)
		}
	}
	check(
		`all ${DEVANAGARI_FONT_IDS.length} Devanagari companions load into the file`,
		badCompanions === 0,
		badCompanions,
	)

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
		sound: SILENT_SOUND,
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

	// Align to speech: the manual fix for a transcript whose words are right and
	// whose clock is not. Line breaks must survive it untouched.
	const speechMap = [
		{ startMs: 500, endMs: 2_300 },
		{ startMs: 2_500, endMs: 3_900 },
	]
	const late = tools.stretchTiming(CUES, 1, 4_000).map((cue) => ({
		...cue,
		startMs: cue.startMs + 600,
		endMs: cue.endMs + 600,
		tokens: cue.tokens.map((token) => ({
			...token,
			fromMs: token.fromMs + 600,
			toMs: token.toMs + 600,
		})),
	}))
	const aligned = tools.alignToSpeech(late, speechMap, { durationMs: 4_000 })
	check('aligning keeps every line', aligned.cues.length === CUES.length, aligned.cues.length)
	check(
		'and every word inside every line',
		aligned.cues.every((cue, index) => cue.tokens.length === CUES[index].tokens.length),
		aligned.cues.map((cue) => cue.tokens.length),
	)
	check(
		'and the wording exactly as it was',
		aligned.cues.map((cue) => cue.tokens.map((token) => token.text).join(' ')).join(' | ') ===
			CUES.map((cue) => cue.tokens.map((token) => token.text).join(' ')).join(' | '),
	)
	check('most words end up on speech', aligned.onSpeech >= 0.9, aligned.onSpeech)
	check('and the lines actually moved', aligned.moved > 0, aligned.moved)
	check(
		'timings stay ordered afterwards',
		aligned.cues.every((cue, index) => index === 0 || cue.startMs >= aligned.cues[index - 1].startMs),
		aligned.cues.map((cue) => cue.startMs),
	)

	// A transcript with no usable clock at all is re-laid across the speech
	// rather than nudged, because nudging noise only moves the noise.
	const timeless = CUES.map((cue) => ({
		...cue,
		startMs: 3_960,
		endMs: 4_000,
		tokens: cue.tokens.map((token) => ({ ...token, fromMs: 3_960, toMs: 4_000 })),
	}))
	const relaid = tools.alignToSpeech(timeless, speechMap, { durationMs: 4_000 })
	check('a clockless transcript is redistributed', relaid.mode === 'redistribute', relaid.mode)
	check('and lands on the speech', relaid.onSpeech >= 0.9, relaid.onSpeech)

	const nothing = tools.alignToSpeech(CUES, [], { durationMs: 4_000 })
	check('with no speech map nothing is touched', nothing.cues === CUES && nothing.moved === 0)

	// Restoring English must never cost a timing: the whole transcript is
	// aligned to the audio by this point, and a script change knows nothing
	// about when anything was said.
	const switched = tools.restoreEnglishWords([
		{
			id: 'cue-x',
			text: '\u092c\u0948\u0902\u0915 \u090f\u0915\u093e\u0909\u0928\u094d\u091f \u0930\u093e\u092e\u094d\u0930\u094b \u091b',
			startMs: 0,
			endMs: 2_000,
			tokens: [
				{ text: '\u092c\u0948\u0902\u0915', fromMs: 0, toMs: 500 },
				{ text: '\u090f\u0915\u093e\u0909\u0928\u094d\u091f', fromMs: 500, toMs: 1_200 },
				{ text: '\u0930\u093e\u092e\u094d\u0930\u094b', fromMs: 1_200, toMs: 1_700 },
				{ text: '\u091b', fromMs: 1_700, toMs: 2_000 },
			],
		},
	])
	check('the loanwords in a cue are rewritten', switched.changed === 2, switched.changed)
	check(
		'the Nepali words are not',
		switched.cues[0].tokens[2].text === '\u0930\u093e\u092e\u094d\u0930\u094b' && switched.cues[0].tokens[3].text === '\u091b',
		switched.cues[0].tokens.map((token) => token.text),
	)
	check(
		'every timing is exactly where it was',
		switched.cues[0].tokens.every(
			(token, index) => token.fromMs === [0, 500, 1_200, 1_700][index],
		),
		switched.cues[0].tokens,
	)
	check(
		'and the line text is rebuilt from the tokens',
		switched.cues[0].text === 'bank account \u0930\u093e\u092e\u094d\u0930\u094b \u091b',
		switched.cues[0].text,
	)

	// One Devanagari word can be two English ones; the split stays inside the
	// span the single token held.
	const courtesy = tools.restoreEnglishWords([
		{
			id: 'cue-y',
			text: '\u0925\u0948\u0902\u0915\u094d\u092f\u0942',
			startMs: 1_000,
			endMs: 1_800,
			tokens: [{ text: '\u0925\u0948\u0902\u0915\u094d\u092f\u0942', fromMs: 1_000, toMs: 1_800 }],
		},
	])
	check('a two-word replacement becomes two tokens', courtesy.cues[0].tokens.length === 2, courtesy.cues[0].tokens)
	check(
		'inside the span the one token held',
		courtesy.cues[0].tokens[0].fromMs === 1_000 &&
			courtesy.cues[0].tokens[1].toMs === 1_800,
		courtesy.cues[0].tokens,
	)
	check('reading "thank you"', courtesy.cues[0].text === 'thank you', courtesy.cues[0].text)

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

/* ------------------------------------------------------- subtitle import */

/** A File stand-in: the importer only ever asks for size, name and bytes. */
function fakeFile(name, bytes) {
	const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
	return {
		name,
		size: bytes.length,
		type: '',
		arrayBuffer: async () => buffer,
	}
}

async function checkSubtitleImport() {
	console.log('\nSubtitle import (.srt / .vtt)')

	const {
		decodeSubtitleBytes,
		explainEmptyImport,
		importSubtitleFile,
		looksLikeSubtitleFile,
		parseSubtitleText,
		parseTimecode,
		SUBTITLE_ACCEPT,
		SubtitleImportError,
	} = subtitleImport

	/* -- the picker ------------------------------------------------------ */

	// Android and iOS pickers filter by system type; a bare `.srt` token
	// resolves to nothing there, so the generic types have to be in the list.
	check('the accept list offers .srt and .vtt', /\.srt/.test(SUBTITLE_ACCEPT) && /\.vtt/.test(SUBTITLE_ACCEPT))
	check(
		'and the generic types a mobile picker actually reports',
		SUBTITLE_ACCEPT.includes('text/plain') && SUBTITLE_ACCEPT.includes('application/octet-stream'),
		SUBTITLE_ACCEPT,
	)
	check('a share-sheet file with no type is still offered to the parser', looksLikeSubtitleFile({ name: 'captions', type: '' }))
	check('an .srt reported as octet-stream is accepted', looksLikeSubtitleFile({ name: 'a.srt', type: 'application/octet-stream' }))
	check('an mp4 is not', looksLikeSubtitleFile({ name: 'clip.mp4', type: 'video/mp4' }) === false)

	/* -- timecodes ------------------------------------------------------- */

	check('SubRip comma timing', parseTimecode('01:02:03,456') === 3_723_456)
	check('WebVTT dot timing', parseTimecode('01:02:03.456') === 3_723_456)
	check('WebVTT without an hour field', parseTimecode('02:03.500') === 123_500)
	check('a one digit fraction is tenths', parseTimecode('00:00:01.5') === 1500)
	check('frame based timing uses the clip fps', parseTimecode('00:00:01:12', 24) === 1500)
	check('and nothing else parses', parseTimecode('soon') === null && parseTimecode('') === null)

	/* -- parsing --------------------------------------------------------- */

	const srt = parseSubtitleText(
		'1\r\n00:00:01,000 --> 00:00:03,500\r\nHello <b>world</b>\r\nsecond line\r\n\r\n2\r\n00:00:04,000 --> 00:00:06,000\r\n{\\an8}Caf&eacute; &amp; bar\r\n',
	)
	check('a CRLF .srt reads as SubRip', srt.format === 'srt' && srt.cues.length === 2, srt.format)
	check('both lines of a two line cue survive', srt.cues[0].text === 'Hello world second line', srt.cues[0].text)
	check('markup and ASS overrides are stripped', srt.cues[1].text.startsWith('Caf'), srt.cues[1].text)
	check('entities are decoded', srt.cues[1].text === 'Café & bar', srt.cues[1].text)
	check('timings are kept exactly', srt.cues[0].startMs === 1000 && srt.cues[0].endMs === 3500)

	// The failure that sent users here: several exporters omit the blank line
	// between cues, and a blank-line splitter turns the whole file into one cue.
	const runOn = parseSubtitleText(
		'1\n00:00:01,000 --> 00:00:02,000\nOne\n2\n00:00:02,000 --> 00:00:03,000\nTwo\n3\n00:00:03,000 --> 00:00:04,000\nThree\n',
	)
	check('cues with no blank line between them still separate', runOn.cues.length === 3, runOn.cues.length)
	check('and no sequence number leaks into the text', runOn.cues.map((cue) => cue.text).join('|') === 'One|Two|Three', runOn.cues.map((cue) => cue.text))

	// A cue whose only line is a number is a caption, not an index.
	const numeric = parseSubtitleText('1\n00:00:01,000 --> 00:00:02,000\n1998\n')
	check('a numeric caption is never mistaken for an index', numeric.cues.length === 1 && numeric.cues[0].text === '1998', numeric.cues)

	// One-word lines used to be eaten by an over-eager cue-identifier test.
	const short = parseSubtitleText('00:00:01.000 --> 00:00:02.000\nYes\n\n00:00:02.000 --> 00:00:03.000\nNo\n')
	check('one word cues are not swallowed', short.cues.map((cue) => cue.text).join('|') === 'Yes|No', short.cues.map((cue) => cue.text))

	const vtt = parseSubtitleText(
		'WEBVTT - Title\n\nNOTE a note\nspanning two lines\n\nSTYLE\n::cue { color: red }\n\nintro\n00:01.000 --> 00:03.000 line:90% align:center\n<v Roger>Hi there\n\n00:03.000 --> 00:05.000\n<00:00:03.000><c>Karaoke</c> <00:00:04.000><c>words</c>\n',
	)
	check('a WebVTT header is recognised', vtt.format === 'vtt', vtt.format)
	check('NOTE and STYLE blocks are not cues', vtt.cues.length === 2, vtt.cues.length)
	check('cue settings after the end timestamp are ignored', vtt.cues[0].startMs === 1000 && vtt.cues[0].endMs === 3000)
	check('a voice span leaves only the words', vtt.cues[0].text === 'Hi there', vtt.cues[0].text)
	check('a cue identifier is not treated as dialogue', vtt.cues[0].text.includes('intro') === false)
	check('inline timestamps become real word timing', vtt.wordTimedCues === 1, vtt.wordTimedCues)
	check(
		'and each word lands on its own timestamp',
		vtt.cues[1].tokens[0].fromMs === 3000 && vtt.cues[1].tokens[1].fromMs === 4000,
		vtt.cues[1].tokens,
	)

	const sbv = parseSubtitleText('0:00:01.000,0:00:03.000\nSubViewer line\n\n0:00:03.000,0:00:05.000\nsecond\n')
	check('SubViewer timing is read too', sbv.format === 'sbv' && sbv.cues.length === 2, sbv.format)
	check('a line of dialogue with a comma is not read as timing', parseSubtitleText('00:00:01,000 --> 00:00:02,000\nWell, hello\n').cues[0].text === 'Well, hello')

	const broken = parseSubtitleText('1\n00:00:05,000 --> 00:00:05,000\nZero length\n\n2\n00:00:01,000 --> 00:00:02,000\nOut of order\n')
	check('a zero length cue is given a readable one', broken.cues.find((cue) => cue.text === 'Zero length').endMs > 5000)
	check('and says so', broken.warnings.some((warning) => warning.includes('duration')), broken.warnings)
	check('cues come back in time order', broken.cues[0].text === 'Out of order', broken.cues[0].text)

	// The studio's own exports are the files most likely to come back in.
	const roundTripped = parseSubtitleText(cueFile.cuesToSrt(CUES))
	check('the studio\'s own .srt export re-imports', roundTripped.cues.length === CUES.length, roundTripped.cues.length)
	check(
		'with its text and timings intact',
		roundTripped.cues.every((cue, index) => cue.text === CUES[index].text && cue.startMs === CUES[index].startMs && cue.endMs === CUES[index].endMs),
		roundTripped.cues.map((cue) => [cue.text, cue.startMs, cue.endMs]),
	)
	const vttRoundTrip = parseSubtitleText(cueFile.cuesToVtt(CUES))
	check('and so does its .vtt export', vttRoundTrip.cues.length === CUES.length && vttRoundTrip.format === 'vtt', vttRoundTrip.cues.length)

	/* -- encodings ------------------------------------------------------- */

	const NEPALI = '1\n00:00:01,000 --> 00:00:02,000\nनमस्ते संसार\n'
	const readBytes = (bytes) => {
		const decoded = decodeSubtitleBytes(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
		return { ...decoded, cues: parseSubtitleText(decoded.text).cues }
	}

	const utf8Bom = readBytes(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(NEPALI, 'utf8')]))
	check('a UTF-8 BOM does not become part of the first cue', utf8Bom.cues.length === 1 && utf8Bom.cues[0].text === 'नमस्ते संसार', utf8Bom.cues)

	const utf16Bom = readBytes(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(NEPALI, 'utf16le')]))
	check('UTF-16 with a BOM decodes (Windows tools write this)', utf16Bom.encoding === 'UTF-16' && utf16Bom.cues[0].text === 'नमस्ते संसार', utf16Bom)

	const utf16Bare = readBytes(Buffer.from(NEPALI, 'utf16le'))
	check('UTF-16 without a BOM is sniffed from its NUL bytes', utf16Bare.cues.length === 1 && utf16Bare.cues[0].text === 'नमस्ते संसार', utf16Bare)

	const latin1 = readBytes(Buffer.from('1\n00:00:01,000 --> 00:00:02,000\nCaf\xe9 ferm\xe9\n', 'latin1'))
	check('a legacy single byte file falls back rather than failing', latin1.encoding === 'Windows-1252' && latin1.cues[0].text === 'Café fermé', latin1)

	/* -- the whole path, and its refusals -------------------------------- */

	const imported = await importSubtitleFile(fakeFile('nepali.srt', Buffer.from(NEPALI, 'utf8')))
	check('importing a picked file returns cues, format and encoding', imported.cues.length === 1 && imported.format === 'srt' && imported.encoding === 'UTF-8', imported)

	const rejected = async (file) => {
		try {
			await importSubtitleFile(file)
			return null
		} catch (error) {
			return error
		}
	}

	const empty = await rejected(fakeFile('empty.srt', Buffer.alloc(0)))
	check('an empty file is refused with a reason', empty instanceof SubtitleImportError && /empty/i.test(empty.message), empty && empty.message)

	const huge = await rejected({ name: 'movie.mp4', size: 900 * 1024 * 1024, type: '', arrayBuffer: async () => new ArrayBuffer(0) })
	check('a video picked by mistake is refused before it is read', huge instanceof SubtitleImportError, huge && huge.message)

	const plain = await rejected(fakeFile('script.txt', Buffer.from('Just some words with no timings at all.\n', 'utf8')))
	check('a transcript with no timestamps points at the Write tab', plain instanceof SubtitleImportError && /Write tab/.test(plain.message), plain && plain.message)

	check(
		'a binary file is named as such rather than as bad subtitles',
		/binary/.test(explainEmptyImport('\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd', 'x.srt')),
		explainEmptyImport('\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd', 'x.srt'),
	)
}

/* ------------------------------------------------- Groq as the primary ASR */

async function checkGroqPrimary() {
	console.log('\nGroq Whisper (primary speech provider)')

	const { buildWhisperPrompt, whisperLanguage, PROMPT_TOKEN_BUDGET } = asrPrompt

	/* -- the prompt is an exemplar, never an instruction ------------------ */

	const english = buildWhisperPrompt({ language: 'en' })
	check('a prompt is produced', english.length > 0)
	check(
		'it never issues an instruction (Whisper would transcribe it)',
		!/\b(transcribe|do not|don't|you (are|should|must)|output|please)\b/i.test(english),
		english,
	)
	check('it demonstrates sentence casing and terminal punctuation', /[A-Z][^.?!]*[.?!]/.test(english))
	check('it demonstrates a disfluency, so verbatim speech is kept', /\bum\b/i.test(english), english)
	check('it stays inside the 224 token window', english.length <= PROMPT_TOKEN_BUDGET * 4, english.length)

	const nepali = buildWhisperPrompt({ language: 'ne' })
	check('Nepali gets a Devanagari exemplar', /[ऀ-ॿ]/.test(nepali))
	check(
		'that exemplar keeps English loanwords in Latin script',
		/feature|update|release/.test(nepali),
		nepali,
	)
	check('and the loanword vocabulary rides along', nepali.length > english.length)

	// The vocabulary is the part that must never be truncated away, so it goes last.
	const withVocab = buildWhisperPrompt({ language: 'en', vocabulary: ['Remotion', 'Zathura'] })
	check('supplied vocabulary reaches the prompt', /Remotion/.test(withVocab) && /Zathura/.test(withVocab))
	// The caller's own terms are the ones a recogniser cannot guess, so they must
	// sit behind the generic loanwords where clamping cannot reach them.
	const mixed = buildWhisperPrompt({ language: 'ne', vocabulary: ['Kathmandu', 'Remotion'] })
	check(
		"the caller's terms come last, after the generic loanwords",
		mixed.trim().endsWith('Kathmandu, Remotion.'),
		mixed.slice(-70),
	)
	// Terms long enough that 60 of them alone blow the window, so the clamp
	// genuinely fires rather than the vocabulary cap quietly doing the work.
	const flooded = buildWhisperPrompt({
		language: 'en',
		vocabulary: Array.from({ length: 400 }, (_, i) => `Supercalifragilistic${i}Expialidocious`),
	})
	check('an over-long prompt is clamped', flooded.length <= PROMPT_TOKEN_BUDGET * 4, flooded.length)
	// Clamping drops the FRONT, so the exemplar goes and the vocabulary - the
	// part a recogniser cannot guess - is what survives.
	check('clamping keeps the tail, where the vocabulary lives', /Expialidocious\.$/.test(flooded.trim()), flooded.slice(-60))
	check('and spends the lost budget on the style exemplar, not the terms', !/\bum\b/i.test(flooded), flooded.slice(0, 60))

	const continued = buildWhisperPrompt({ language: 'en', previousText: 'and then the render finished.' })
	check('real previous text is carried in', /render finished/.test(continued), continued)

	/* -- language codes --------------------------------------------------- */

	check('a Riva locale is reduced to ISO-639-1', whisperLanguage('ne-NP') === 'ne')
	check('an ISO code passes through', whisperLanguage('en') === 'en')
	check("'auto' and 'multi' mean 'let Whisper detect'", whisperLanguage('auto') === null && whisperLanguage('multi') === null)
	check('so does nothing at all', whisperLanguage('') === null && whisperLanguage(null) === null)

	/* -- the route prefers Groq ------------------------------------------- */

	process.env.GROQ_API_KEY = 'gsk-check'
	try {
		const seen = []
		global.fetch = async (url, init) => {
			seen.push({ url: String(url), init })
			return nvidiaReply({
				text: 'नमस्ते this is a test',
				words: [
					{ word: 'नमस्ते', start: 0.1, end: 0.6 },
					{ word: 'this', start: 0.7, end: 0.95 },
					{ word: 'test', start: 1.2, end: 1.8 },
				],
			})
		}
		let body = await (await transcribeRoute.POST(audioRequest())).json()

		check('Groq is called first', seen[0].url.includes('api.groq.com'), seen[0].url)
		check('and answers alone - NVIDIA is never reached', seen.length === 1, seen.length)
		check('the response names the provider', body.provider === 'groq', body.provider)
		check('word timings come back in milliseconds', body.words[0].endMs === 600, body.words[0])
		check('and are not flagged as estimated', body.estimatedTimings === false)
		check('Devanagari survives', body.words[0].text === 'नमस्ते', body.words[0])

		// The bug that made every Groq request fail: setting Content-Type by hand
		// replaces the generated multipart boundary with nothing.
		const headers = seen[0].init.headers ?? {}
		const headerNames = Object.keys(headers).map((name) => name.toLowerCase())
		check('no Content-Type header is set, so the multipart boundary survives', !headerNames.includes('content-type'), headerNames)
		check('the key is sent as a bearer token', /^Bearer /.test(headers.Authorization ?? ''))

		const sent = seen[0].init.body
		const fields = Object.fromEntries([...sent.entries()].filter(([, v]) => typeof v === 'string'))
		check('whisper-large-v3 is the model', fields.model === 'whisper-large-v3', fields.model)
		check('verbose_json is requested', fields.response_format === 'verbose_json')
		check('temperature is pinned to 0', fields.temperature === '0')
		check('word timestamps are asked for', [...sent.getAll('timestamp_granularities[]')].includes('word'))
		check('segment timestamps too', [...sent.getAll('timestamp_granularities[]')].includes('segment'))
		check('the language is sent as ISO-639-1', fields.language === 'ne', fields.language)
		check('a prompt is attached', typeof fields.prompt === 'string' && fields.prompt.length > 0)

		/* -- fallback --------------------------------------------------- */

		const calls = []
		global.fetch = async (url) => {
			calls.push(String(url))
			if (String(url).includes('groq')) return nvidiaReply({ error: { message: 'service unavailable' } }, 503)
			return nvidiaReply({ text: 'hello', words: [{ word: 'hello', start_time: 0, end_time: 500 }] })
		}
		body = await (await transcribeRoute.POST(audioRequest())).json()
		check('a Groq outage falls through to NVIDIA', body.words.length === 1, body)
		check('Groq was still tried first', calls[0].includes('groq'), calls[0])
		check('and NVIDIA answered second', calls.length > 1 && !calls[1].includes('groq'), calls)

		// One request, not one per language candidate: Whisper takes one code.
		const groqOnly = calls.filter((url) => url.includes('groq'))
		check('Groq is attempted exactly once, not once per locale', groqOnly.length === 1, groqOnly)

		/* -- Groq alone, with no NVIDIA key ------------------------------ */

		delete process.env.NVIDIA_API_KEY
		global.fetch = async (url) => {
			if (String(url).includes('groq')) return nvidiaReply({ error: { message: 'rate limited' } }, 429)
			throw new Error('NVIDIA must not be called without a key')
		}
		const response = await transcribeRoute.POST(audioRequest())
		body = await response.json()
		check('without an NVIDIA key the failure is reported as Groq\'s', /Groq/.test(body.error), body.error)
		check('and NVIDIA is not dialled at all', !/nvidia/i.test(body.error ?? ''), body.error)

		const status = await transcribeRoute.GET().json()
		check('a Groq-only server still reports the cloud as configured', status.configured === true, status)
		check('and names Groq as the primary', status.primary === 'groq', status.primary)
		check('the fallback is listed as unavailable', status.providers.find((p) => p.id === 'nvidia').available === false)
	} finally {
		delete process.env.GROQ_API_KEY
		process.env.NVIDIA_API_KEY = 'nvapi-check'
	}

	const noCloud = (() => {
		delete process.env.NVIDIA_API_KEY
		const out = transcribeRoute.GET()
		process.env.NVIDIA_API_KEY = 'nvapi-check'
		return out
	})()
	const noCloudBody = await noCloud.json()
	check('with neither key the cloud reports itself off', noCloudBody.configured === false)
	check('and the reason names the free Groq key first', /GROQ_API_KEY/.test(noCloudBody.reason ?? ''), noCloudBody.reason)
}


/* ------------------------------------------------------- caption sound */

/**
 * The sound layer.
 *
 * Three things make this feature either invisible or infuriating, and none of
 * them throws when it breaks: a sound file that is not where the catalogue says
 * it is (silence in the export, no error anywhere), a schedule that is not a
 * pure function of the cues (a render that does not match the preview), and a
 * guard that lets fast speech fire forty effects a second. All three are
 * asserted here rather than discovered in an export.
 */
function checkCaptionSound() {
	console.log('\nCaption sound effects')

	const fs = require('node:fs')
	const path = require('node:path')
	const publicDir = path.join(__dirname, '..', 'public')

	// 1. every catalogued option points at files that actually ship
	let missing = []
	for (const option of sfxFile.CAPTION_SFX) {
		for (let variant = 1; variant <= option.variants; variant++) {
			const src = sfxFile.sfxSrc(option, variant)
			if (!fs.existsSync(path.join(publicDir, src))) missing.push(src)
		}
	}
	check(
		`all ${sfxFile.CAPTION_SFX.length} effects resolve to files in the kit`,
		missing.length === 0,
		missing.slice(0, 3).join(', '),
	)
	/**
	 * The advertised length has to cover the real file.
	 *
	 * The sequence that holds an effect is sized from `durationSeconds`. Under-
	 * state it and Remotion closes the sequence early, which cuts the tail off
	 * every hit - a defect nobody sees in a waveform and everybody hears. So the
	 * WAV headers are read and compared rather than trusted.
	 */
	const wavSeconds = (file) => {
		const buffer = fs.readFileSync(file)
		let offset = 12
		let byteRate = 0
		while (offset + 8 <= buffer.length) {
			const id = buffer.toString('ascii', offset, offset + 4)
			const size = buffer.readUInt32LE(offset + 4)
			if (id === 'fmt ') byteRate = buffer.readUInt32LE(offset + 16)
			if (id === 'data') return byteRate > 0 ? size / byteRate : 0
			offset += 8 + size + (size % 2)
		}
		return 0
	}

	const short = []
	for (const option of sfxFile.CAPTION_SFX) {
		let longest = 0
		for (let variant = 1; variant <= option.variants; variant++) {
			const file = path.join(publicDir, sfxFile.sfxSrc(option, variant))
			if (!fs.existsSync(file)) continue
			longest = Math.max(longest, wavSeconds(file))
		}
		// A hair of tolerance: the sequence also gets 40ms of padding on top.
		if (longest > option.durationSeconds + 0.02) {
			short.push(`${option.id} holds ${longest.toFixed(2)}s but claims ${option.durationSeconds}s`)
		}
	}
	check(
		'no effect is cut short by the sequence that holds it',
		short.length === 0,
		short.slice(0, 3).join('; '),
	)

	check(
		'the catalogue offers both fixed one-shots and multi-take families',
		sfxFile.CAPTION_SFX.some((option) => option.variants === 1) &&
			sfxFile.CAPTION_SFX.some((option) => option.variants > 1),
	)

	// 2. the auto mapping has an answer for every entrance, and each is real
	const animations = ['pop', 'fade', 'slide', 'rise', 'blur', 'stamp', 'whoosh', 'glitch', 'none']
	const unmapped = animations.filter(
		(animation) =>
			!sfxFile.isCaptionSfxId(
				sfxFile.autoSfxIdFor({ animation, reveal: 'word', wordEffect: 'none' }),
			),
	)
	check('every entrance maps to a real effect in auto mode', unmapped.length === 0, unmapped)
	check(
		'the typewriter reveal overrides the entrance and picks key strikes',
		sfxFile.autoSfxIdFor({ animation: 'pop', reveal: 'typewriter', wordEffect: 'none' }) === 'ui-key',
	)
	check(
		'the loud entrances each get a matching sound family',
		sfxFile.autoSfxIdFor({ animation: 'stamp', reveal: 'line', wordEffect: 'none' }) === 'impact-hit' &&
			sfxFile.autoSfxIdFor({ animation: 'glitch', reveal: 'line', wordEffect: 'none' }) ===
				'transition-glitch' &&
			sfxFile.autoSfxIdFor({ animation: 'whoosh', reveal: 'line', wordEffect: 'none' }) ===
				'motion-whoosh',
	)

	const style = { ...CAPTION_PRESETS[0].style, emphasisWords: ['today'] }
	const on = {
		...DEFAULT_CAPTION_SOUND,
		enabled: true,
		effectId: 'ui-pop',
		offsetMs: 0,
		minGapMs: 0,
		pitchVariation: 0,
	}

	// 3. the schedule is a pure function of its inputs
	check('the sound layer is off until it is switched on', sfxFile.buildSoundtrack(CUES, DEFAULT_CAPTION_SOUND, style).length === 0)
	const first = sfxFile.buildSoundtrack(CUES, on, style)
	const second = sfxFile.buildSoundtrack(CUES, on, style)
	check('one sound per sentence', first.length === CUES.length, `${first.length} vs ${CUES.length}`)
	check(
		'two runs of the same project schedule byte-identical sound',
		JSON.stringify(first) === JSON.stringify(second),
	)
	check(
		'every hit lands on its own caption',
		first.every((event, index) => event.atMs === CUES[index].startMs),
	)
	check(
		'shuffle spreads a family across its takes rather than repeating one',
		new Set(first.map((event) => event.src)).size > 1,
	)
	check(
		'a fixed take plays the same file every sentence',
		new Set(
			sfxFile.buildSoundtrack(CUES, { ...on, variation: 'fixed' }, style).map((e) => e.src),
		).size === 1,
	)
	check(
		'cycling walks the takes in order',
		sfxFile
			.buildSoundtrack(CUES, { ...on, variation: 'cycle' }, style)
			.every((event, index) => event.src.includes(String(index + 1).padStart(3, '0'))),
	)

	// 4. level, pitch and timing
	const option = sfxFile.sfxById('ui-pop')
	check(
		'the fader is scaled by the effect loudness trim, so switching effect does not change the mix',
		Math.abs(first[0].volume - on.volume * option.gain) < 0.001,
		`${first[0].volume}`,
	)
	check('silence at zero volume schedules nothing', sfxFile.buildSoundtrack(CUES, { ...on, volume: 0 }, style).length === 0)
	check(
		'pitch drift stays inside the range it advertises',
		sfxFile
			.buildSoundtrack(CUES, { ...on, pitchVariation: 0.1 }, style)
			.every((event) => event.playbackRate >= 0.89 && event.playbackRate <= 1.11),
	)
	check(
		'pitch drift off means every hit plays at its recorded speed',
		first.every((event) => event.playbackRate === 1),
	)
	const early = sfxFile.buildSoundtrack(CUES, { ...on, offsetMs: -120 }, style)
	check(
		'a negative offset fires the sound early, never before the video starts',
		early.every((event, index) => event.atMs === Math.max(0, CUES[index].startMs - 120)),
	)
	check(
		'a hit is never scheduled past the end of the timeline',
		sfxFile.buildSoundtrack(CUES, on, style, { durationMs: CUES[0].endMs }).length < CUES.length,
	)

	// 5. triggers and the machine-gun guard
	const words = CUES.reduce((sum, cue) => sum + cue.tokens.length, 0)
	check(
		'per-word firing places one sound per word',
		sfxFile.buildSoundtrack(CUES, { ...on, trigger: 'word' }, style).length === words,
	)
	check(
		'emphasis firing places sound only on the marked words',
		sfxFile.buildSoundtrack(CUES, { ...on, trigger: 'emphasis' }, style).length ===
			CUES.reduce(
				(sum, cue) =>
					sum + cue.tokens.filter((token) => /today/i.test(token.text.replace(/[^a-z]/gi, ''))).length,
				0,
			),
	)
	const guarded = sfxFile.buildSoundtrack(CUES, { ...on, trigger: 'word', minGapMs: 400 }, style)
	check('the minimum gap thins a per-word track', guarded.length < words, `${guarded.length} of ${words}`)
	check(
		'and no two hits are ever closer than that gap',
		guarded.every((event, index) => index === 0 || event.atMs - guarded[index - 1].atMs >= 400),
	)

	// 6. ducking
	check(
		'ducking is a no-op away from every effect',
		sfxFile.duckingGainAt(CUES[0].startMs - 5000, first, 0.5) === 1,
	)
	check(
		'and pulls the video down under one',
		sfxFile.duckingGainAt(first[0].atMs + 10, first, 0.5) < 0.55,
	)
	check('ducking set to zero never touches the video', sfxFile.duckingGainAt(first[0].atMs, first, 0) === 1)

	// 7. the generated file carries the whole mix as data
	const code = buildCaptionSource({
		videoSrc: 'https://example.com/clip.mp4',
		videoName: 'clip.mp4',
		cues: CUES,
		style,
		sound: on,
		plan: PLAN,
		origin: 'test',
	})
	const issues = auditSource(code)
	check('a composition with sound still compiles', issues.length === 0, issues)
	check('it imports the media Audio component', /import \{ Audio, Video \} from '@remotion\/media'/.test(code))
	check('it holds one row per scheduled hit', (code.match(/atMs: \d+, durationMs:/g) ?? []).length === first.length)
	check('it ducks the video under the effects', /volume=\{videoVolume\}/.test(code))
	check('and the sound layer is in the props the studio can re-style live', /soundtrack: SOUNDTRACK/.test(code))

	// Every sound path written into the file has to exist in public/, or the
	// export is silent and the .tsx download is broken for whoever opens it.
	const referenced = [...code.matchAll(/src: "(assets\/audio\/[^"]+)"/g)].map((match) => match[1])
	check('every sound path in the file ships in public/', referenced.length > 0 &&
		referenced.every((src) => fs.existsSync(path.join(publicDir, src))))

	const silent = buildCaptionSource({
		videoSrc: 'https://example.com/clip.mp4',
		videoName: 'clip.mp4',
		cues: CUES,
		style,
		sound: SILENT_SOUND,
		plan: PLAN,
		origin: 'test',
	})
	check('a silent project writes an empty schedule', /SOUNDTRACK: CaptionSoundEvent\[\] = \[\]/.test(silent))
	check('and still compiles', auditSource(silent).length === 0)

	// 8. presets carry a sound opinion without switching the layer on
	const loud = CAPTION_PRESETS.filter(
		(preset) => soundForPreset(preset.id, DEFAULT_CAPTION_SOUND).enabled,
	)
	check('no preset turns the sound layer on by itself', loud.length === 0, loud.map((p) => p.id))
	const badPresetSounds = CAPTION_PRESETS.filter((preset) => {
		const suggested = soundForPreset(preset.id, DEFAULT_CAPTION_SOUND)
		return suggested.effectId !== 'auto' && !sfxFile.isCaptionSfxId(suggested.effectId)
	})
	check(
		`all ${CAPTION_PRESETS.length} presets suggest an effect that exists`,
		badPresetSounds.length === 0,
		badPresetSounds.map((p) => p.id),
	)
}


/**
 * Executes the generated composition instead of only transpiling it.
 *
 * A file can be perfectly valid TypeScript and still throw the moment React
 * calls it - an identifier that only exists in the studio, a prop that is
 * destructured but never passed, a helper used above where it is defined. None
 * of that shows up in a transpile, and all of it is a black preview and a
 * failed export. So the file is evaluated against stand-in Remotion modules and
 * actually rendered, at several frames, with the sound layer on.
 */
function renderGeneratedComposition(code, { frame }) {
	const React = require('react')
	const { renderToStaticMarkup } = require('react-dom/server')

	// 'imports' is what turns the ESM file into something a CommonJS shim can
	// load - the same transform the studio's in-browser compiler applies.
	const js = transform(code, {
		transforms: ['typescript', 'jsx', 'imports'],
		jsxRuntime: 'automatic',
		filePath: 'captioned-video.tsx',
	}).code

	const audio = []
	const video = []
	const registered = []

	const passthrough = (name) =>
		function Stub(props) {
			return React.createElement('div', { 'data-stub': name }, props.children ?? null)
		}

	const remotion = {
		AbsoluteFill: passthrough('AbsoluteFill'),
		Sequence: passthrough('Sequence'),
		Composition: (props) => {
			registered.push(props)
			return null
		},
		Still: () => null,
		useCurrentFrame: () => frame,
		useVideoConfig: () => ({
			fps: PLAN.fps,
			width: PLAN.width,
			height: PLAN.height,
			durationInFrames: PLAN.durationInFrames,
		}),
		interpolate: (input, inputRange, outputRange) => {
			const [a, b] = inputRange
			const [x, y] = outputRange
			if (input <= a) return x
			if (input >= b) return y
			return x + ((input - a) / (b - a || 1)) * (y - x)
		},
		spring: () => 1,
		staticFile: (path) => `/${path}`,
		registerRoot: (Root) => renderToStaticMarkup(React.createElement(Root)),
	}

	const modules = {
		react: React,
		'react/jsx-runtime': require('react/jsx-runtime'),
		'react/jsx-dev-runtime': require('react/jsx-dev-runtime'),
		remotion,
		'@remotion/fonts': { loadFont: () => Promise.resolve() },
		'@remotion/media': {
			Video: (props) => {
				video.push(props)
				return null
			},
			Audio: (props) => {
				audio.push(props)
				return null
			},
		},
	}

	const exported = {}
	const moduleObject = { exports: exported }
	const load = (specifier) => {
		if (!(specifier in modules)) throw new Error(`unexpected import ${specifier}`)
		return modules[specifier]
	}
	new Function('require', 'module', 'exports', js)(load, moduleObject, moduleObject.exports)

	const Component = moduleObject.exports.CaptionedVideo
	const markup = renderToStaticMarkup(React.createElement(Component))
	return { markup, audio, video, registered, exports: moduleObject.exports }
}

function checkCompositionRuntime() {
	console.log('\nGenerated composition, executed')

	const style = { ...CAPTION_PRESETS[0].style, emphasisWords: ['today'] }
	const sound = {
		...DEFAULT_CAPTION_SOUND,
		enabled: true,
		effectId: 'ui-pop',
		duck: 0.4,
		minGapMs: 0,
	}
	const code = buildCaptionSource({
		videoSrc: 'https://example.com/clip.mp4',
		videoName: 'clip.mp4',
		cues: CUES,
		style,
		sound,
		plan: PLAN,
		origin: 'test',
	})

	let run = null
	let threw = null
	try {
		run = renderGeneratedComposition(code, { frame: 3 })
	} catch (error) {
		threw = error
	}
	check('the generated file executes and renders', threw === null, threw && threw.message)
	if (!run) return

	check('it registers exactly one composition', run.registered.length === 1)
	check('the captions reach the markup', run.markup.includes(CUES[0].tokens[0].text))
	check(
		'one <Audio> per scheduled sound',
		run.audio.length === sfxFile.buildSoundtrack(CUES, sound, style).length,
		`${run.audio.length}`,
	)
	check(
		'each one points at a file in the kit and carries its own level',
		run.audio.every(
			(props) => props.src.startsWith('/assets/audio/') && props.volume > 0 && props.volume <= 1,
		),
	)
	check(
		'the video ducks through a volume function rather than a fixed number',
		run.video.length === 1 && typeof run.video[0].volume === 'function',
	)
	check(
		'and that function dips under an effect and not away from one',
		run.video[0].volume(Math.round((CUES[0].startMs / 1000) * PLAN.fps)) < 1 &&
			run.video[0].volume(PLAN.durationInFrames - 1) === 1,
	)

	// Every entrance has to survive a real render, at the frames where it does
	// its work - frame 0, mid-entrance, and after it has settled.
	const animations = ['pop', 'fade', 'slide', 'rise', 'blur', 'stamp', 'whoosh', 'glitch', 'none']
	const broken = []
	for (const animation of animations) {
		for (const reveal of ['line', 'word', 'typewriter']) {
			for (const frame of [0, 3, 40]) {
				try {
					const variant = buildCaptionSource({
						videoSrc: 'https://example.com/clip.mp4',
						videoName: 'clip.mp4',
						cues: CUES,
						style: { ...style, animation, reveal },
						sound,
						plan: PLAN,
						origin: 'test',
					})
					const out = renderGeneratedComposition(variant, { frame })
					// The typewriter splits a word across a shown and a hidden span, so
					// the tags come off before the text is looked for.
					const text = out.markup.replace(/<[^>]*>/g, '')
					if (!text.includes(CUES[0].tokens[0].text)) {
						broken.push(`${animation}/${reveal}@${frame}: nothing drawn`)
					}
				} catch (error) {
					broken.push(`${animation}/${reveal}@${frame}: ${error.message}`)
				}
			}
		}
	}
	check(
		`all ${animations.length} entrances render in every reveal mode`,
		broken.length === 0,
		broken.slice(0, 3).join(' | '),
	)

	// The studio's own source audit runs on this file every time it compiles. A
	// caption track schedules its sounds through staticFile(event.src), and the
	// audit used to read that computed path as "reaching outside the asset kit"
	// - a permanent, wrong warning on every captioned video.
	const warnings = sourceAudit.analyzeSources([{ path: 'captioned-video.tsx', contents: code }])
	check(
		'the studio raises no asset warning for a captioned video with sound',
		!warnings.some((warning) => /outside the built-in asset kit/.test(warning)),
		warnings.join(' | '),
	)
	const outside = sourceAudit.analyzeSources([
		{
			path: 'other.tsx',
			contents: "import {staticFile} from 'remotion'\nexport const a = staticFile('my-clip.mp4')",
		},
	])
	check(
		'but still warns about a path that is genuinely not in the kit',
		outside.some((warning) => /outside the built-in asset kit/.test(warning)),
	)

	// A silent project must not mount a single audio decoder.
	const silent = renderGeneratedComposition(
		buildCaptionSource({
			videoSrc: 'https://example.com/clip.mp4',
			videoName: 'clip.mp4',
			cues: CUES,
			style,
			sound: SILENT_SOUND,
			plan: PLAN,
			origin: 'test',
		}),
		{ frame: 3 },
	)
	check('a silent project mounts no audio at all', silent.audio.length === 0)
	check(
		'and leaves the video volume untouched',
		silent.video.length === 1 && silent.video[0].volume === 1,
	)
}

async function main() {
	checkScript()
	checkLoanwords()
	checkSpeechDetection()
	checkAlignment()
	await checkChunker()
	await checkUploader()
	await checkTranscribeRoute()
	await checkRefineRoute()
	checkComposition()
	checkCaptionSound()
	checkCompositionRuntime()
	checkTools()
	checkAss()
	await checkSubtitleImport()
	await checkGroqPrimary()

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
