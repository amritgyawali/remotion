'use client'

/**
 * Listening to the whole clip once, so every later question is instant.
 *
 * The expensive half of finding silence is decoding the audio; the detection
 * itself is arithmetic over a level track that is a thousand times smaller than
 * the samples it was measured from. So this module decodes exactly once, keeps
 * the level track, and hands it back. Every slider in the studio - sensitivity,
 * minimum pause, padding - then re-detects in a millisecond, on the track,
 * without going near the file again.
 *
 * The track is measured at the file's own sample rate. Speech detectors usually
 * resample to 16 kHz first because a recogniser needs that; a level meter does
 * not, and skipping the resampler removes both the slowest step and the only
 * part of the pipeline that could smear a boundary.
 *
 * Buffers are placed on an absolute timeline by the timestamp the demuxer
 * reports rather than by counting samples, so a track that starts late or drops
 * a packet produces a hole of silence in the right place instead of shifting
 * every cut after it.
 */

import { detectSpeechFromFrames, type SpeechSegment, type VadResult } from '../captions/vad'
import type { CutSettings } from './plan'

/** Level is measured over windows this long. 10 ms is speech resolution. */
export const FRAME_MS = 10

/** Silence, for a frame that no audio ever landed in. */
const EMPTY_FRAME_DB = -100

/** Never invent more than this much silence from one bad timestamp. */
const MAX_GAP_FILL_MS = 30_000

export class NoAudioError extends Error {
	constructor(message = 'That file has no audio track, so there is no silence to find.') {
		super(message)
		this.name = 'NoAudioError'
	}
}

export class AnalysisCancelled extends Error {
	constructor() {
		super('Analysis cancelled')
		this.name = 'AnalysisCancelled'
	}
}

export type AudioAnalysis = {
	/** per-frame RMS level in dBFS, across the whole clip */
	frameDb: Float32Array
	frameMs: number
	durationMs: number
	/** loudest frame in the clip, dBFS */
	peakDb: number
	/** the level the detector settled on as the speech/silence split, dBFS */
	noiseFloorDb: number
	/** true when the track is quiet enough that there is nothing to detect */
	silent: boolean
	sampleRate: number
	channels: number
}

export type AnalysisProgress = {
	phase: 'decoding' | 'detecting'
	ratio: number
	secondsDone: number
}

function assertLive(signal: AbortSignal): void {
	if (signal.aborted) throw new AnalysisCancelled()
}

/**
 * A growable per-frame level accumulator.
 *
 * Frames are addressed absolutely, so a decoder that jumps forward simply
 * writes further along and the untouched space in between stays at the empty
 * level - which is exactly what a hole in the audio track means.
 */
class FrameTrack {
	private sums: Float64Array
	private counts: Int32Array
	private highWater = 0

	constructor(estimatedFrames: number) {
		const capacity = Math.max(1024, Math.ceil(estimatedFrames * 1.1))
		this.sums = new Float64Array(capacity)
		this.counts = new Int32Array(capacity)
	}

	private grow(needed: number): void {
		if (needed <= this.sums.length) return
		const capacity = Math.max(needed, this.sums.length * 2)
		const sums = new Float64Array(capacity)
		sums.set(this.sums)
		const counts = new Int32Array(capacity)
		counts.set(this.counts)
		this.sums = sums
		this.counts = counts
	}

	add(frame: number, sumSquares: number, count: number): void {
		if (frame < 0 || count <= 0) return
		this.grow(frame + 1)
		this.sums[frame] += sumSquares
		this.counts[frame] += count
		if (frame + 1 > this.highWater) this.highWater = frame + 1
	}

	get frames(): number {
		return this.highWater
	}

	/** Root-mean-square per frame, in dBFS. */
	finish(): Float32Array {
		const out = new Float32Array(this.highWater)
		for (let index = 0; index < this.highWater; index++) {
			const count = this.counts[index]
			if (count === 0) {
				out[index] = EMPTY_FRAME_DB
				continue
			}
			const rms = Math.sqrt(this.sums[index] / count)
			out[index] = 20 * Math.log10(Math.max(rms, 1e-9))
		}
		return out
	}
}

/**
 * Folds one decoded buffer into the level track.
 *
 * The loop is written frame-outer / sample-inner rather than the other way
 * round: a division per sample to find its frame costs more than the whole
 * measurement, and a minute of 48 kHz stereo is three million samples.
 */
function accumulate(
	track: FrameTrack,
	buffer: AudioBuffer,
	timestampSeconds: number,
	frameSeconds: number,
): void {
	const channels = Math.min(buffer.numberOfChannels, 2)
	if (channels === 0) return
	const left = buffer.getChannelData(0)
	const right = channels > 1 ? buffer.getChannelData(1) : null
	const rate = buffer.sampleRate
	const length = buffer.length
	if (length === 0) return

	const firstFrame = Math.floor(timestampSeconds / frameSeconds)
	const lastFrame = Math.floor((timestampSeconds + length / rate) / frameSeconds)

	for (let frame = firstFrame; frame <= lastFrame; frame++) {
		// Sample window of this frame, expressed inside this buffer.
		const from = Math.max(0, Math.ceil((frame * frameSeconds - timestampSeconds) * rate))
		const to = Math.min(length, Math.ceil(((frame + 1) * frameSeconds - timestampSeconds) * rate))
		if (to <= from) continue

		let sum = 0
		if (right) {
			for (let index = from; index < to; index++) {
				const value = (left[index] + right[index]) / 2
				sum += value * value
			}
		} else {
			for (let index = from; index < to; index++) {
				const value = left[index]
				sum += value * value
			}
		}
		track.add(frame, sum, to - from)
	}
}

async function decodeWithMediabunny(args: {
	source: Blob
	track: FrameTrack
	frameSeconds: number
	signal: AbortSignal
	durationHintSeconds: number
	onProgress?: (progress: AnalysisProgress) => void
}): Promise<{ sampleRate: number; channels: number; peak: number }> {
	const { ALL_FORMATS, AudioBufferSink, BlobSource, Input } = await import('mediabunny')
	const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(args.source) })

	try {
		const audioTrack = await input.getPrimaryAudioTrack()
		if (!audioTrack) throw new NoAudioError()
		if (!(await audioTrack.canDecode())) {
			throw new Error('This browser cannot decode that audio codec.')
		}

		const sink = new AudioBufferSink(audioTrack)
		let sampleRate = audioTrack.sampleRate || 48_000
		let channels = audioTrack.numberOfChannels || 1
		let peak = 0
		/** where the decoder has written to, so a jump can be recognised */
		let producedSeconds = 0

		for await (const wrapped of sink.buffers()) {
			assertLive(args.signal)
			sampleRate = wrapped.buffer.sampleRate
			channels = wrapped.buffer.numberOfChannels

			// A timestamp far past what has been produced is a hole in the track.
			// It is left as untouched frames, which read as silence - but a wildly
			// wrong timestamp must not be allowed to invent an hour of it.
			const timestamp =
				wrapped.timestamp - producedSeconds > MAX_GAP_FILL_MS / 1000
					? producedSeconds
					: wrapped.timestamp

			accumulate(args.track, wrapped.buffer, timestamp, args.frameSeconds)
			producedSeconds = Math.max(producedSeconds, timestamp + wrapped.duration)

			// Peak is measured on the first channel only: it is a report to the
			// person, not an input to the detector, and a second pass over every
			// sample to refine it would be felt.
			const data = wrapped.buffer.getChannelData(0)
			for (let index = 0; index < data.length; index += 16) {
				const value = Math.abs(data[index])
				if (value > peak) peak = value
			}

			args.onProgress?.({
				phase: 'decoding',
				ratio:
					args.durationHintSeconds > 0
						? Math.min(0.99, producedSeconds / args.durationHintSeconds)
						: 0,
				secondsDone: producedSeconds,
			})
		}

		return { sampleRate, channels, peak }
	} finally {
		input.dispose()
	}
}

/**
 * The fallback path, for a container Mediabunny will not open.
 *
 * `decodeAudioData` wants the whole file in memory at once, which is why it is
 * second rather than first, but it opens things WebCodecs does not.
 */
async function decodeWithWebAudio(args: {
	source: Blob
	track: FrameTrack
	frameSeconds: number
	signal: AbortSignal
	onProgress?: (progress: AnalysisProgress) => void
}): Promise<{ sampleRate: number; channels: number; peak: number }> {
	if (typeof OfflineAudioContext === 'undefined') {
		throw new Error('This browser has no audio decoder, so the clip cannot be analysed.')
	}
	const bytes = await args.source.arrayBuffer()
	assertLive(args.signal)

	const context = new OfflineAudioContext(1, 1, 48_000)
	const buffer = await context.decodeAudioData(bytes).catch(() => {
		throw new Error(
			'The audio in that file could not be decoded. Re-export it as an MP4 with AAC audio and try again.',
		)
	})
	assertLive(args.signal)

	// Fed in windows so a long file still reports progress while it is measured.
	const window = Math.round(buffer.sampleRate * 5)
	const channels = Math.min(buffer.numberOfChannels, 2)
	let peak = 0

	for (let offset = 0; offset < buffer.length; offset += window) {
		assertLive(args.signal)
		const length = Math.min(window, buffer.length - offset)
		const slice = new AudioBuffer({
			length,
			numberOfChannels: channels,
			sampleRate: buffer.sampleRate,
		})
		for (let channel = 0; channel < channels; channel++) {
			const data = buffer.getChannelData(channel).subarray(offset, offset + length)
			slice.copyToChannel(data, channel)
			if (channel === 0) {
				for (let index = 0; index < data.length; index += 16) {
					const value = Math.abs(data[index])
					if (value > peak) peak = value
				}
			}
		}
		accumulate(args.track, slice, offset / buffer.sampleRate, args.frameSeconds)
		args.onProgress?.({
			phase: 'decoding',
			ratio: Math.min(0.99, (offset + length) / buffer.length),
			secondsDone: (offset + length) / buffer.sampleRate,
		})
		// Give the tab a frame back between windows.
		await new Promise((resolve) => setTimeout(resolve, 0))
	}

	return { sampleRate: buffer.sampleRate, channels, peak }
}

/**
 * Measures the level of every 10 ms of the clip.
 *
 * `durationHintSeconds` only steers the progress bar and the initial
 * allocation; the truth about length comes from the audio itself.
 */
export async function analyzeAudio(args: {
	source: Blob
	durationHintSeconds?: number
	onProgress?: (progress: AnalysisProgress) => void
	signal: AbortSignal
}): Promise<AudioAnalysis> {
	const frameSeconds = FRAME_MS / 1000
	const durationHintSeconds = args.durationHintSeconds ?? 0
	const track = new FrameTrack(Math.ceil((durationHintSeconds || 60) / frameSeconds))

	let decoded: { sampleRate: number; channels: number; peak: number }
	try {
		decoded = await decodeWithMediabunny({
			source: args.source,
			track,
			frameSeconds,
			signal: args.signal,
			durationHintSeconds,
			onProgress: args.onProgress,
		})
	} catch (error) {
		if (error instanceof NoAudioError || error instanceof AnalysisCancelled) throw error
		decoded = await decodeWithWebAudio({
			source: args.source,
			track,
			frameSeconds,
			signal: args.signal,
			onProgress: args.onProgress,
		})
	}

	assertLive(args.signal)
	args.onProgress?.({ phase: 'detecting', ratio: 1, secondsDone: track.frames * frameSeconds })

	const frameDb = track.finish()
	if (frameDb.length === 0) throw new NoAudioError()

	let peakDb = -100
	for (let index = 0; index < frameDb.length; index++) {
		if (frameDb[index] > peakDb) peakDb = frameDb[index]
	}

	// One detection pass at default sensitivity, purely to report the floor the
	// UI draws its threshold line against.
	const probe = detectSpeechFromFrames(frameDb, FRAME_MS, DETECTION_BASE)

	return {
		frameDb,
		frameMs: FRAME_MS,
		durationMs: frameDb.length * FRAME_MS,
		peakDb,
		noiseFloorDb: probe.noiseFloorDb,
		// -60 dBFS: below this a track holds only encoder noise, never speech.
		silent: decoded.peak < 0.001,
		sampleRate: decoded.sampleRate,
		channels: decoded.channels,
	}
}

/**
 * The detector settings the studio always measures with.
 *
 * Deliberately finer than anything the person will ask for: the detector finds
 * every real pause, and the plan - not the detector - decides which of them are
 * long enough to be worth cutting. Shaping in the plan is what makes the
 * "minimum pause" slider free rather than another analysis pass.
 */
const DETECTION_BASE = {
	frameMs: FRAME_MS,
	minSilenceMs: 80,
	minSpeechMs: 60,
	padMs: 0,
	hangoverMs: 160,
} as const

export type DetectionResult = {
	speech: SpeechSegment[]
	noiseFloorDb: number
	speechRatio: number
}

/**
 * Re-runs the detector on an already-measured clip. Milliseconds, not seconds -
 * this is what every slider in the studio calls.
 */
export function detectFrom(analysis: AudioAnalysis, settings: CutSettings): DetectionResult {
	const result: VadResult = detectSpeechFromFrames(
		analysis.frameDb,
		analysis.frameMs,
		{
			...DETECTION_BASE,
			onsetDb: settings.sensitivityDb,
			offsetDb: settings.sensitivityDb,
		},
		analysis.durationMs,
	)
	return {
		speech: result.segments,
		noiseFloorDb: result.noiseFloorDb,
		speechRatio: result.speechRatio,
	}
}

/**
 * Max-pooled levels for drawing, one value per pixel column.
 *
 * Pooling by maximum rather than by average is what keeps a single loud
 * syllable from vanishing when an hour is drawn a thousand pixels wide - the
 * waveform has to show what the detector reacted to.
 */
export function poolLevels(
	frameDb: Float32Array,
	fromFrame: number,
	toFrame: number,
	columns: number,
): Float32Array {
	const out = new Float32Array(Math.max(1, columns))
	const start = Math.max(0, Math.min(frameDb.length, Math.floor(fromFrame)))
	const end = Math.max(start, Math.min(frameDb.length, Math.ceil(toFrame)))
	const span = end - start
	if (span <= 0) {
		out.fill(EMPTY_FRAME_DB)
		return out
	}

	for (let column = 0; column < out.length; column++) {
		const from = start + Math.floor((column / out.length) * span)
		const to = Math.max(from + 1, start + Math.floor(((column + 1) / out.length) * span))
		let loudest = EMPTY_FRAME_DB
		for (let index = from; index < to && index < end; index++) {
			if (frameDb[index] > loudest) loudest = frameDb[index]
		}
		out[column] = loudest
	}
	return out
}
