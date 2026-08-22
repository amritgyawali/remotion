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
