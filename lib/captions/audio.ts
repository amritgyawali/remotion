'use client'

/**
 * Turns an uploaded video into upload-sized speech audio.
 *
 * Every hosted recogniser wants the same thing - 16 kHz mono PCM - and every
 * serverless host caps a request body long before a real video fits in one, so
 * the audio is decoded in the browser, resampled, and cut into chunks that each
 * land under the limit. Cuts are placed in the quietest moment near the target
 * boundary, which is what keeps a word from being sliced in half and coming
 * back twice.
 *
 * Decoding goes through Mediabunny (WebCodecs) first because it opens the
 * containers a <video> element will not, and falls back to the Web Audio
 * decoder for anything WebCodecs cannot handle.
 */

import { CLOUD_ASR_LIMITS } from './asr-models'

export type AudioChunk = {
	index: number
	blob: Blob
	startMs: number
	endMs: number
	/** loudest sample in the chunk, 0 - 1, so silence can be reported honestly */
	peak: number
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

/**
 * Picks the quietest 20 ms frame inside the allowed window so the boundary
 * falls between words. Returns the sample index to cut at.
 */
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

function peakOf(samples: Float32Array): number {
	let peak = 0
	for (let index = 0; index < samples.length; index++) {
		const value = Math.abs(samples[index])
		if (value > peak) peak = value
	}
	return peak
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
 * then hands each chunk to the sink with the timings it occupies in the clip.
 */
class ChunkCutter {
	private pending: Float32Array[] = []
	private pendingLength = 0
	private emittedSamples = 0
	private index = 0
	private readonly targetSamples: number
	private readonly slackSamples: number

	constructor(
		private readonly sink: ChunkSink,
		chunkSeconds: number,
		slackSeconds: number,
	) {
		this.targetSamples = Math.round(chunkSeconds * SAMPLE_RATE)
		this.slackSamples = Math.round(slackSeconds * SAMPLE_RATE)
	}

	get emittedMs(): number {
		return (this.emittedSamples / SAMPLE_RATE) * 1000
	}

	get chunkCount(): number {
		return this.index
	}

	push(samples: Float32Array): void {
		if (samples.length === 0) return
		this.pending.push(samples)
		this.pendingLength += samples.length
	}

	async drain(final: boolean, signal: AbortSignal): Promise<void> {
		const ceiling = this.targetSamples + this.slackSamples
		while (this.pendingLength > 0) {
			assertLive(signal)
			if (!final && this.pendingLength < ceiling) return

			const merged = concat(this.pending, this.pendingLength)
			let cut = merged.length
			if (merged.length > ceiling) {
				cut = quietestCut(
					merged,
					Math.max(1, this.targetSamples - this.slackSamples),
					ceiling,
					this.targetSamples,
				)
			}

			await this.emit(merged.subarray(0, cut))

			const rest = merged.subarray(cut)
			this.pending = rest.length > 0 ? [rest.slice()] : []
			this.pendingLength = rest.length
			if (rest.length === 0) return
		}
	}

	private async emit(samples: Float32Array): Promise<void> {
		if (samples.length === 0) return
		const startMs = Math.round((this.emittedSamples / SAMPLE_RATE) * 1000)
		this.emittedSamples += samples.length
		const endMs = Math.round((this.emittedSamples / SAMPLE_RATE) * 1000)
		await this.sink({
			index: this.index++,
			blob: encodeWav(samples),
			startMs,
			endMs,
			peak: peakOf(samples),
		})
	}
}

export type ExtractArgs = {
	source: Blob
	/** used only to report progress; the real duration comes out of the decoder */
	durationHintSeconds?: number
	chunkSeconds?: number
	slackSeconds?: number
	onProgress?: (ratio: number, secondsDone: number) => void
	onChunk: ChunkSink
	signal: AbortSignal
}

export type ExtractResult = {
	chunks: number
	durationMs: number
	/** true when nothing in the whole track rose above the noise floor */
	silent: boolean
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
		onProgress,
		onChunk,
		signal,
	} = args
	assertLive(signal)

	let loudest = 0
	const cutter = new ChunkCutter(
		async (chunk) => {
			loudest = Math.max(loudest, chunk.peak)
			await onChunk(chunk)
		},
		chunkSeconds,
		slackSeconds,
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

	return {
		chunks: cutter.chunkCount,
		durationMs: Math.round(cutter.emittedMs),
		// -60 dBFS: below this a track holds only encoder noise, never speech.
		silent: loudest < 0.001,
	}
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

		for await (const wrapped of sink.buffers()) {
			assertLive(signal)
			const mono = downmix(wrapped.buffer)
			if (blockRate !== 0 && wrapped.buffer.sampleRate !== blockRate) await flushBlock()
			blockRate = wrapped.buffer.sampleRate
			block.push(mono)
			blockLength += mono.length
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
