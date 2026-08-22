'use client'

/**
 * Turns an uploaded video into upload-sized speech audio - and into the speech
 * map that keeps the captions on the speaker's mouth.
 *
 * Every hosted recogniser wants the same thing - 16 kHz mono PCM - and every
 * serverless host caps a request body long before a real video fits in one, so
 * the audio is decoded in the browser, conditioned, and cut into chunks that
 * each land under the limit.
 *
 * Three things here exist purely to make the transcript line up:
 *
 *   1. an absolute timeline. Chunk timings used to be counted from however many
 *      samples had been decoded so far, which silently shifts the whole
 *      transcript when a container's audio track starts late or drops a packet.
 *      Every buffer is now placed at the timestamp the demuxer reports, and a
 *      hole in the track becomes a hole of silence rather than a shift.
 *   2. cuts placed in real pauses. The window around each boundary is scanned
 *      for the longest silence instead of the single quietest 20 ms frame, and
 *      when a boundary genuinely falls mid-word the next chunk carries a second
 *      of overlap so that word is transcribed whole by somebody.
 *   3. a speech map per chunk, measured by the detector in `vad.ts`. It is what
 *      lets the uploader put words on speech instead of spreading them evenly
 *      across a minute of audio.
 *
 * Conditioning - DC removal, a high-pass below the voice, and a level pass that
 * measures loudness over speech only - is the cheapest accuracy the pipeline
 * can buy: recognisers are trained on speech at a sane level, and quiet or
 * rumbly phone audio is exactly where they start inventing words.
 *
 * Decoding goes through Mediabunny (WebCodecs) first because it opens the
 * containers a <video> element will not, and falls back to the Web Audio
 * decoder for anything WebCodecs cannot handle.
 */

import { CLOUD_ASR_LIMITS } from './asr-models'
import { clipSegments, detectSpeech, mergeSegments, shiftSegments, type SpeechSegment } from './vad'

export type AudioChunk = {
	index: number
	blob: Blob
	/** first millisecond of the clip this chunk is responsible for */
	startMs: number
	/** last millisecond of the clip this chunk is responsible for */
	endMs: number
	/**
	 * Milliseconds of the previous chunk carried at the front of the blob, so a
	 * word sitting on the boundary is complete for at least one recogniser call.
	 * Word timings that come back are relative to `startMs - contextMs`.
	 */
	contextMs: number
	/** speech inside the blob, in ms from the blob's first sample */
	speech: SpeechSegment[]
	/** loudest sample in the chunk before conditioning, 0 - 1 */
	peak: number
	/** level correction applied before upload */
	gain: number
}

export class NoAudioTrackError extends Error {
	constructor(message = 'That file has no audio track, so there is nothing to transcribe.') {
		super(message)
		this.name = 'NoAudioTrackError'
	}
}

export class AudioExtractionCancelled extends Error {
	constructor() {
		super('Audio extraction cancelled')
		this.name = 'AudioExtractionCancelled'
	}
}

const SAMPLE_RATE = CLOUD_ASR_LIMITS.sampleRate
/** Resampling is done a block at a time: few contexts, bounded memory. */
const RESAMPLE_BLOCK_SECONDS = 10
/** Frame size used to measure loudness when looking for a cut point. */
const ENERGY_FRAME_MS = 20
/** A pause at least this long is a safe place to end a chunk. */
const SAFE_PAUSE_MS = 140
/** Speech RMS the uploader aims for, dBFS - where recognisers are happiest. */
const TARGET_RMS_DB = -20
/** Never push the level past this, so conditioning cannot clip. */
const CEILING = 0.97
/** A hole in the audio track shorter than this is rounding, not a gap. */
const TIMELINE_TOLERANCE_MS = 20
/** Never invent more silence than this from one bad timestamp. */
const MAX_GAP_FILL_SECONDS = 30

function assertLive(signal: AbortSignal): void {
	if (signal.aborted) throw new AudioExtractionCancelled()
}

function hasAudioContext(): boolean {
	return typeof OfflineAudioContext !== 'undefined'
}

/** Averages every channel into one, which is what speech models are trained on. */
function downmix(buffer: AudioBuffer): Float32Array {
	const channels = buffer.numberOfChannels
	const frames = buffer.length
	if (channels === 1) return buffer.getChannelData(0).slice()

	const mono = new Float32Array(frames)
	for (let channel = 0; channel < channels; channel++) {
		const data = buffer.getChannelData(channel)
		for (let frame = 0; frame < frames; frame++) mono[frame] += data[frame]
	}
	for (let frame = 0; frame < frames; frame++) mono[frame] /= channels
	return mono
}

/** Last-resort resampler for the rare rate the audio engine refuses. */
function resampleLinear(samples: Float32Array, fromRate: number, toRate: number): Float32Array {
	const frames = Math.max(1, Math.round((samples.length * toRate) / fromRate))
	const out = new Float32Array(frames)
	const ratio = samples.length / frames
	for (let index = 0; index < frames; index++) {
		const position = index * ratio
		const left = Math.floor(position)
		const right = Math.min(samples.length - 1, left + 1)
		const fraction = position - left
		out[index] = samples[left] * (1 - fraction) + samples[right] * fraction
	}
	return out
}

/**
 * Resamples through the browser's own audio engine, which band-limits properly -
 * a naive decimation folds high frequencies back onto the speech band and
 * measurably costs accuracy.
 */
async function resampleMono(
	samples: Float32Array,
	fromRate: number,
	toRate: number,
): Promise<Float32Array> {
	if (fromRate === toRate || samples.length === 0) return samples
	if (!hasAudioContext() || fromRate < 3_000 || fromRate > 384_000) {
		return resampleLinear(samples, fromRate, toRate)
	}
	const frames = Math.max(1, Math.round((samples.length * toRate) / fromRate))
	try {
		const context = new OfflineAudioContext(1, frames, toRate)
		const buffer = context.createBuffer(1, samples.length, fromRate)
		buffer.getChannelData(0).set(samples)
		const source = context.createBufferSource()
		source.buffer = buffer
		source.connect(context.destination)
		source.start()
		const rendered = await context.startRendering()
		return rendered.getChannelData(0).slice()
	} catch {
		return resampleLinear(samples, fromRate, toRate)
	}
}

function concat(blocks: Float32Array[], total: number): Float32Array {
	if (blocks.length === 1) return blocks[0]
	const merged = new Float32Array(total)
	let offset = 0
	for (const block of blocks) {
		merged.set(block, offset)
		offset += block.length
	}
	return merged
}

/* ---------------------------------------------------------- conditioning */

/**
 * DC removal followed by a second-order high-pass at 85 Hz.
 *
 * Handset and camera audio arrives with a DC offset and with rumble - traffic,
 * air-conditioning, a hand on the desk - that lives entirely below the voice
 * but dominates every level measurement made of it. Removing it costs nothing
 * intelligible and stops the level pass from turning the gain down because of
 * noise the recogniser was never going to use.
 */
export function conditionSpeech(samples: Float32Array, sampleRate = SAMPLE_RATE): Float32Array {
	const out = new Float32Array(samples.length)
	if (samples.length === 0) return out

	// One-pole DC blocker: y[n] = x[n] - x[n-1] + r * y[n-1].
	const r = 0.995
	let lastIn = 0
	let lastOut = 0
	for (let index = 0; index < samples.length; index++) {
		const value = samples[index]
		lastOut = value - lastIn + r * lastOut
		lastIn = value
		out[index] = lastOut
	}

	// Butterworth high-pass, 85 Hz, run forwards only - phase shift below the
	// voice is inaudible to a recogniser and costs one pass instead of two.
	const frequency = 85
	const omega = (2 * Math.PI * frequency) / sampleRate
	const cosine = Math.cos(omega)
	const sine = Math.sin(omega)
	const alpha = sine / Math.SQRT2
	const b0 = (1 + cosine) / 2
	const b1 = -(1 + cosine)
	const b2 = (1 + cosine) / 2
	const a0 = 1 + alpha
	const a1 = -2 * cosine
	const a2 = 1 - alpha

	let x1 = 0
	let x2 = 0
	let y1 = 0
	let y2 = 0
	for (let index = 0; index < out.length; index++) {
		const x0 = out[index]
		const y0 = (b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0
		x2 = x1
		x1 = x0
		y2 = y1
		y1 = y0
		out[index] = y0
	}

	return out
}

function rmsOver(samples: Float32Array, ranges: SpeechSegment[], sampleRate: number): number {
	let sum = 0
	let count = 0
	const measure = (from: number, to: number) => {
		for (let index = from; index < to; index++) {
			const value = samples[index]
			sum += value * value
			count++
		}
	}

	if (ranges.length === 0) {
		measure(0, samples.length)
	} else {
		for (const range of ranges) {
			const from = Math.max(0, Math.floor((range.startMs / 1000) * sampleRate))
			const to = Math.min(samples.length, Math.ceil((range.endMs / 1000) * sampleRate))
			if (to > from) measure(from, to)
		}
	}

	return count === 0 ? 0 : Math.sqrt(sum / count)
}

function peakOf(samples: Float32Array): number {
	let peak = 0
	for (let index = 0; index < samples.length; index++) {
		const value = Math.abs(samples[index])
		if (value > peak) peak = value
	}
	return peak
}

/**
 * Brings speech to a level every recogniser is comfortable with.
 *
 * The measurement is taken over the speech only. Measuring the whole chunk
 * makes a talker who leaves long pauses quieter than one who does not, which is
 * exactly backwards, and it makes a near-silent chunk get amplified until its
 * noise floor sounds like whispering - the classic way to make a model
 * hallucinate a sentence into silence.
 */
function levelGain(samples: Float32Array, speech: SpeechSegment[], sampleRate: number): number {
	const rms = rmsOver(samples, speech, sampleRate)
	if (rms < 1e-5) return 1
	const target = Math.pow(10, TARGET_RMS_DB / 20)
	// Bounded both ways: enough to rescue quiet audio, never enough to turn a
	// room tone into speech.
	const wanted = Math.min(12, Math.max(0.35, target / rms))
	const peak = peakOf(samples)
	return peak > 0 ? Math.min(wanted, CEILING / peak) : wanted
}

function applyGain(samples: Float32Array, gain: number): Float32Array {
	if (gain === 1) return samples
	for (let index = 0; index < samples.length; index++) {
		const value = samples[index] * gain
		samples[index] = value > CEILING ? CEILING : value < -CEILING ? -CEILING : value
	}
	return samples
}

/* ------------------------------------------------------------ cut points */

/** Picks the quietest 20 ms frame - the fallback when there is no real pause. */
function quietestCut(samples: Float32Array, from: number, to: number, fallback: number): number {
	const frame = Math.round((ENERGY_FRAME_MS / 1000) * SAMPLE_RATE)
	const start = Math.max(frame, Math.min(from, samples.length - frame))
	const end = Math.max(start + frame, Math.min(to, samples.length - frame))
	if (end <= start) return fallback

	let bestEnergy = Number.POSITIVE_INFINITY
	let bestIndex = fallback
	for (let index = start; index + frame <= end; index += frame) {
		let energy = 0
		for (let offset = 0; offset < frame; offset++) {
			const value = samples[index + offset]
			energy += value * value
		}
		if (energy < bestEnergy) {
			bestEnergy = energy
			bestIndex = index + Math.floor(frame / 2)
		}
	}
	return bestIndex
}

type CutChoice = { index: number; inPause: boolean }

/**
 * Finds where to end a chunk.
 *
 * The best boundary is the middle of the longest pause near the target, because
 * that is a place no word can straddle. Ties go to the pause nearest the
 * target, so chunks stay close to the size the request limit was chosen for. A
 * window with no pause at all - continuous speech, or a music bed under it -
 * says so, and the caller answers with an overlap instead.
 */
function chooseCut(samples: Float32Array, from: number, to: number, target: number): CutChoice {
	const start = Math.max(0, Math.min(from, samples.length))
	const end = Math.max(start, Math.min(to, samples.length))
	if (end - start < SAMPLE_RATE / 4) {
		return { index: quietestCut(samples, start, end, target), inPause: false }
	}

	const window = samples.subarray(start, end)
	const windowMs = (window.length / SAMPLE_RATE) * 1000
	const { segments } = detectSpeech(window, {
		sampleRate: SAMPLE_RATE,
		minSilenceMs: 80,
		minSpeechMs: 80,
		padMs: 20,
	})

	let bestMidpoint: number | null = null
	let bestLength = SAFE_PAUSE_MS
	let bestDistance = Infinity
	const targetMs = ((target - start) / SAMPLE_RATE) * 1000

	let cursor = 0
	const gaps: SpeechSegment[] = []
	for (const segment of segments) {
		if (segment.startMs > cursor) gaps.push({ startMs: cursor, endMs: segment.startMs })
		cursor = Math.max(cursor, segment.endMs)
	}
	if (windowMs > cursor) gaps.push({ startMs: cursor, endMs: windowMs })

	for (const gap of gaps) {
		const length = gap.endMs - gap.startMs
		if (length < SAFE_PAUSE_MS) continue
		const midpoint = (gap.startMs + gap.endMs) / 2
		const distance = Math.abs(midpoint - targetMs)
		const better =
			length > bestLength + 40 || (length > bestLength - 40 && distance < bestDistance)
		if (!better) continue
		bestLength = Math.max(bestLength, length)
		bestDistance = distance
		bestMidpoint = midpoint
	}

	if (bestMidpoint === null) {
		return { index: quietestCut(samples, start, end, target), inPause: false }
	}
	return {
		index: start + Math.round((bestMidpoint / 1000) * SAMPLE_RATE),
		inPause: true,
	}
}

/** 16-bit PCM WAV: universally accepted, and half the size of float audio. */
export function encodeWav(samples: Float32Array, sampleRate = SAMPLE_RATE): Blob {
	const buffer = new ArrayBuffer(44 + samples.length * 2)
	const view = new DataView(buffer)

	const writeText = (offset: number, text: string) => {
		for (let index = 0; index < text.length; index++) {
			view.setUint8(offset + index, text.charCodeAt(index))
		}
	}

	writeText(0, 'RIFF')
	view.setUint32(4, 36 + samples.length * 2, true)
	writeText(8, 'WAVE')
	writeText(12, 'fmt ')
	view.setUint32(16, 16, true)
	view.setUint16(20, 1, true) // PCM
	view.setUint16(22, 1, true) // mono
	view.setUint32(24, sampleRate, true)
	view.setUint32(28, sampleRate * 2, true) // byte rate
	view.setUint16(32, 2, true) // block align
	view.setUint16(34, 16, true) // bits per sample
	writeText(36, 'data')
	view.setUint32(40, samples.length * 2, true)

	let offset = 44
	for (let index = 0; index < samples.length; index++) {
		const clamped = Math.max(-1, Math.min(1, samples[index]))
		view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true)
		offset += 2
	}

	return new Blob([buffer], { type: 'audio/wav' })
}

type ChunkSink = (chunk: AudioChunk) => Promise<void> | void

/**
 * Holds resampled 16 kHz audio until there is enough of it to cut a chunk,
 * then conditions it, measures where the speech is, and hands it to the sink
 * with the timings it occupies in the clip.
 */
class ChunkCutter {
	private pending: Float32Array[] = []
	private pendingLength = 0
	private emittedSamples = 0
	private index = 0
	/** tail of the previous chunk, prepended to the next blob as context */
	private carry: Float32Array = new Float32Array(0)
	private readonly targetSamples: number
	private readonly slackSamples: number
	private readonly contextSamples: number

	constructor(
		private readonly sink: ChunkSink,
		chunkSeconds: number,
		slackSeconds: number,
		contextSeconds: number,
	) {
		this.targetSamples = Math.round(chunkSeconds * SAMPLE_RATE)
		this.slackSamples = Math.round(slackSeconds * SAMPLE_RATE)
		this.contextSamples = Math.round(contextSeconds * SAMPLE_RATE)
	}

	get emittedMs(): number {
		return (this.emittedSamples / SAMPLE_RATE) * 1000
	}

	get pushedMs(): number {
		return ((this.emittedSamples + this.pendingLength) / SAMPLE_RATE) * 1000
	}

	get chunkCount(): number {
		return this.index
	}

	push(samples: Float32Array): void {
		if (samples.length === 0) return
		this.pending.push(samples)
		this.pendingLength += samples.length
	}

	/** Writes `seconds` of digital silence, to keep a gap in the track honest. */
	pushSilence(samples: number): void {
		if (samples <= 0) return
		this.push(new Float32Array(Math.min(samples, MAX_GAP_FILL_SECONDS * SAMPLE_RATE)))
	}

	async drain(final: boolean, signal: AbortSignal): Promise<void> {
		const ceiling = this.targetSamples + this.slackSamples
		while (this.pendingLength > 0) {
			assertLive(signal)
			if (!final && this.pendingLength < ceiling) return

			const merged = concat(this.pending, this.pendingLength)
			let cut = merged.length
			let inPause = true
			if (merged.length > ceiling) {
				const choice = chooseCut(
					merged,
					Math.max(1, this.targetSamples - this.slackSamples),
					ceiling,
					this.targetSamples,
				)
				cut = choice.index
				inPause = choice.inPause
			}

			await this.emit(merged.subarray(0, cut), inPause)

			const rest = merged.subarray(cut)
			this.pending = rest.length > 0 ? [rest.slice()] : []
			this.pendingLength = rest.length
			if (rest.length === 0) return
		}
	}

	/**
	 * `inPause` says whether the *previous* boundary fell in a real pause. When
	 * it did there is nothing to rescue and the blob starts exactly on its own
	 * first sample; when it did not, the tail of the previous chunk rides along
	 * so whichever word straddled the cut is transcribed whole at least once.
	 */
	private async emit(samples: Float32Array, cutInPause: boolean): Promise<void> {
		if (samples.length === 0) return

		const startMs = Math.round((this.emittedSamples / SAMPLE_RATE) * 1000)
		this.emittedSamples += samples.length
		const endMs = Math.round((this.emittedSamples / SAMPLE_RATE) * 1000)

		const context = this.carry
		const body = new Float32Array(context.length + samples.length)
		body.set(context, 0)
		body.set(samples, context.length)

		const rawPeak = peakOf(samples)
		const conditioned = conditionSpeech(body)
		const { segments } = detectSpeech(conditioned, { sampleRate: SAMPLE_RATE })
		const gain = levelGain(conditioned, segments, SAMPLE_RATE)
		applyGain(conditioned, gain)

		// The tail only helps when the next cut lands mid-word, so it is kept
		// only when this one did - and never for a chunk that ends the clip.
		this.carry = cutInPause
			? new Float32Array(0)
			: samples.slice(Math.max(0, samples.length - this.contextSamples))

		await this.sink({
			index: this.index++,
			blob: encodeWav(conditioned),
			startMs,
			endMs,
			contextMs: Math.round((context.length / SAMPLE_RATE) * 1000),
			speech: segments,
			peak: rawPeak,
			gain,
		})
	}
}

export type ExtractArgs = {
	source: Blob
	/** used only to report progress; the real duration comes out of the decoder */
	durationHintSeconds?: number
	chunkSeconds?: number
	slackSeconds?: number
	/** overlap carried into the next chunk when a boundary falls mid-word */
	contextSeconds?: number
	onProgress?: (ratio: number, secondsDone: number) => void
	onChunk: ChunkSink
	signal: AbortSignal
}

export type ExtractResult = {
	chunks: number
	durationMs: number
	/** true when nothing in the whole track rose above the noise floor */
	silent: boolean
	/** where speech is, across the whole clip, in ms from its start */
	speech: SpeechSegment[]
	/** share of the clip that holds speech, 0 - 1 */
	speechRatio: number
}

/**
 * Decodes the audio of `source`, cuts it into chunks and streams them to
 * `onChunk`. The sink is awaited, so a caller that uploads inside it controls
 * how much audio is ever held in memory at once.
 */
export async function streamAudioChunks(args: ExtractArgs): Promise<ExtractResult> {
	const {
		source,
		durationHintSeconds = 0,
		chunkSeconds = CLOUD_ASR_LIMITS.chunkSeconds,
		slackSeconds = CLOUD_ASR_LIMITS.chunkSlackSeconds,
		contextSeconds = CLOUD_ASR_LIMITS.contextSeconds,
		onProgress,
		onChunk,
		signal,
	} = args
	assertLive(signal)

	let loudest = 0
	const speech: SpeechSegment[] = []
	const cutter = new ChunkCutter(
		async (chunk) => {
			loudest = Math.max(loudest, chunk.peak)
			// Chunk-relative speech becomes clip-relative, clipped to the span the
			// chunk owns so an overlap cannot be counted twice.
			for (const segment of clipSegments(
				shiftSegments(chunk.speech, chunk.startMs - chunk.contextMs),
				chunk.startMs,
				chunk.endMs,
			)) {
				speech.push(segment)
			}
			await onChunk(chunk)
		},
		chunkSeconds,
		slackSeconds,
		contextSeconds,
	)

	const report = () => {
		if (!onProgress) return
		const secondsDone = cutter.emittedMs / 1000
		const ratio = durationHintSeconds > 0 ? Math.min(0.99, secondsDone / durationHintSeconds) : 0
		onProgress(ratio, secondsDone)
	}

	try {
		await decodeWithMediabunny(source, cutter, signal, report)
	} catch (error) {
		if (error instanceof NoAudioTrackError || error instanceof AudioExtractionCancelled) throw error
		await decodeWithWebAudio(source, cutter, signal, report)
	}

	await cutter.drain(true, signal)
	onProgress?.(1, cutter.emittedMs / 1000)

	if (cutter.chunkCount === 0) throw new NoAudioTrackError()

	const durationMs = Math.round(cutter.emittedMs)
	const merged = mergeSegments(speech, 120)

	return {
		chunks: cutter.chunkCount,
		durationMs,
		// -60 dBFS: below this a track holds only encoder noise, never speech.
		silent: loudest < 0.001,
		speech: merged,
		speechRatio:
			durationMs > 0
				? merged.reduce((sum, segment) => sum + (segment.endMs - segment.startMs), 0) / durationMs
				: 0,
	}
}

/**
 * Measures where the speech is, without transcribing anything.
 *
 * The studio needs this for a transcript that arrived with no reliable clock -
 * a pasted .srt, or a script typed by hand - so the align tool has something
 * true to align to. It is the extraction pipeline with the upload removed.
 */
export async function measureSpeech(args: {
	source: Blob
	durationHintSeconds?: number
	onProgress?: (ratio: number) => void
	signal: AbortSignal
}): Promise<{ speech: SpeechSegment[]; durationMs: number; silent: boolean }> {
	const result = await streamAudioChunks({
		source: args.source,
		durationHintSeconds: args.durationHintSeconds,
		onProgress: (ratio) => args.onProgress?.(ratio),
		onChunk: () => {},
		signal: args.signal,
	})
	return { speech: result.speech, durationMs: result.durationMs, silent: result.silent }
}

async function decodeWithMediabunny(
	source: Blob,
	cutter: ChunkCutter,
	signal: AbortSignal,
	report: () => void,
): Promise<void> {
	const { ALL_FORMATS, AudioBufferSink, BlobSource, Input } = await import('mediabunny')
	const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(source) })

	try {
		const track = await input.getPrimaryAudioTrack()
		if (!track) throw new NoAudioTrackError()
		if (!(await track.canDecode())) {
			throw new Error('This browser cannot decode that audio codec.')
		}

		const sink = new AudioBufferSink(track)
		let blockRate = 0
		let block: Float32Array[] = []
		let blockLength = 0

		const flushBlock = async () => {
			if (blockLength === 0) return
			const merged = concat(block, blockLength)
			block = []
			blockLength = 0
			cutter.push(await resampleMono(merged, blockRate, SAMPLE_RATE))
			await cutter.drain(false, signal)
			report()
		}

		/** Where the decoder has written to so far, in ms of the clip. */
		const producedMs = () => cutter.pushedMs + (blockLength / Math.max(1, blockRate)) * 1000

		for await (const wrapped of sink.buffers()) {
			assertLive(signal)
			const mono = downmix(wrapped.buffer)
			if (blockRate !== 0 && wrapped.buffer.sampleRate !== blockRate) await flushBlock()
			blockRate = wrapped.buffer.sampleRate

			// The demuxer's timestamp is the truth about where this audio belongs.
			// Counting decoded samples instead is what puts a whole transcript a
			// second early on a file whose audio track starts late.
			const driftMs = wrapped.timestamp * 1000 - producedMs()
			if (driftMs > TIMELINE_TOLERANCE_MS) {
				const frames = Math.min(
					Math.round((driftMs / 1000) * blockRate),
					MAX_GAP_FILL_SECONDS * blockRate,
				)
				block.push(new Float32Array(frames))
				blockLength += frames
			}

			let usable = mono
			if (driftMs < -TIMELINE_TOLERANCE_MS) {
				const overlap = Math.min(mono.length, Math.round((-driftMs / 1000) * blockRate))
				usable = mono.subarray(overlap)
			}
			if (usable.length === 0) continue

			block.push(usable)
			blockLength += usable.length
			if (blockLength >= blockRate * RESAMPLE_BLOCK_SECONDS) await flushBlock()
		}
		await flushBlock()
	} finally {
		input.dispose()
	}
}

/**
 * The fallback decoder. Handing the file to an audio context that already runs
 * at 16 kHz makes the browser resample it for us, so the only work left here is
 * the downmix.
 */
async function decodeWithWebAudio(
	source: Blob,
	cutter: ChunkCutter,
	signal: AbortSignal,
	report: () => void,
): Promise<void> {
	if (!hasAudioContext()) {
		throw new Error('This browser has no audio decoder, so the audio cannot be read.')
	}
	const bytes = await source.arrayBuffer()
	assertLive(signal)

	const context = new OfflineAudioContext(1, 1, SAMPLE_RATE)
	const buffer = await context.decodeAudioData(bytes).catch(() => {
		throw new Error(
			'The audio in that file could not be decoded. Re-export it as an MP4 with AAC audio and try again.',
		)
	})
	assertLive(signal)

	const mono = downmix(buffer)
	const samples =
		buffer.sampleRate === SAMPLE_RATE
			? mono
			: await resampleMono(mono, buffer.sampleRate, SAMPLE_RATE)

	// Fed in windows so an hour-long file still reports progress while it cuts.
	const window = SAMPLE_RATE * RESAMPLE_BLOCK_SECONDS
	for (let offset = 0; offset < samples.length; offset += window) {
		assertLive(signal)
		cutter.push(samples.subarray(offset, Math.min(samples.length, offset + window)).slice())
		await cutter.drain(false, signal)
		report()
	}
}
