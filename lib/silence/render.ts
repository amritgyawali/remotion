'use client'

/**
 * Cutting the file, in the tab, with nothing uploaded anywhere.
 *
 * A silence cut is not a trim - it is dozens of them, plus stretches that have
 * to run fast, welded into one continuous file. No demuxer-level trim API does
 * that, so this walks the plan itself: every output frame is fetched from the
 * source time the plan says it comes from, re-stamped onto the output clock and
 * re-encoded, and the audio is rebuilt sample by sample against the same map.
 *
 * Three decisions carry the whole design:
 *
 *   1. video is driven by *output* frames, not by source frames. Asking "what
 *      belongs at output frame 900?" makes removal, speed-up and a frame-rate
 *      change the same operation, and it cannot drift, because the question is
 *      re-asked from scratch for every frame.
 *   2. audio positions are computed from absolute time, never accumulated. A
 *      per-buffer counter would collect a fraction of a sample of error at each
 *      of a hundred splices and end the file visibly out of lip-sync.
 *   3. nothing that grows with the length of the clip is held in memory. The
 *      file is streamed to disk as it is encoded, and audio is moved a run of
 *      samples at a time rather than one sample per promise.
 */

import { createRenderSink, describeRenderFailure } from '../media/render-sink'
import { outputToSource, type CutPlan, type PlanSegment } from './plan'

export type RenderQuality = 'draft' | 'high' | 'max'
export type RenderFormat = 'mp4' | 'webm'

export type SilenceRenderOptions = {
	source: Blob
	plan: CutPlan
	/** frames per second of the finished file */
	fps: number
	quality: RenderQuality
	format: RenderFormat
	/** 1 keeps the source resolution; 0.5 halves each side */
	scale: number
	includeAudio: boolean
	onProgress?: (progress: RenderProgress) => void
	signal: AbortSignal
}

export type RenderProgress = {
	phase: 'preparing' | 'encoding' | 'finishing'
	/** 0 - 1 across the whole job */
	ratio: number
	framesDone: number
	framesTotal: number
	/** seconds of finished video produced so far */
	secondsDone: number
}

export type SilenceRenderResult = {
	blob: Blob
	url: string
	format: RenderFormat
	width: number
	height: number
	fps: number
	durationSeconds: number
	sizeInBytes: number
	videoCodec: string
	audioCodec: string | null
}

export class RenderCancelled extends Error {
	constructor() {
		super('Export cancelled')
		this.name = 'RenderCancelled'
	}
}

/** Audio is handed to the encoder in slices this long. */
const AUDIO_CHUNK_SECONDS = 0.5

/**
 * Progress is reported on a clock, not on a frame count, because the caller is
 * a React state setter: a report per frame would re-render the studio more
 * often than the screen refreshes, and the encode would spend its time laying
 * out a progress bar instead of encoding.
 */
const PROGRESS_INTERVAL_MS = 120

function assertLive(signal: AbortSignal): void {
	if (signal.aborted) throw new RenderCancelled()
}

function evenSize(value: number): number {
	const rounded = Math.max(2, Math.round(value))
	return rounded % 2 === 0 ? rounded : rounded + 1
}

/**
 * Writes output audio samples in order, tolerating both gaps and overlap.
 *
 * The mapper hands over sample positions computed from absolute time, so two
 * neighbouring segments can round to positions that touch, overlap by a sample
 * or leave one behind. Silence fills a gap; an overlapping sample is dropped.
 * Either is inaudible, and both keep the output exactly as long as the plan
 * says it should be - which is what keeps the audio locked to the picture.
 */
class AudioWriter {
	private readonly chunkFrames: number
	/**
	 * The buffer element is spelled out rather than left as a bare `Float32Array`
	 * so that `subarray()` below stays zero-copy. A bare `Float32Array` defaults
	 * its buffer parameter to `ArrayBufferLike`, `subarray()` propagates that, and
	 * `copyToChannel` accepts only a plain `ArrayBuffer` - which would force a
	 * `slice()` copy of every chunk for nothing.
	 */
	private readonly channelData: Float32Array<ArrayBuffer>[]
	private fill = 0
	/** how many output samples have been committed or buffered so far */
	private written = 0

	constructor(
		private readonly add: (buffer: AudioBuffer) => Promise<void>,
		private readonly sampleRate: number,
		private readonly channels: number,
	) {
		this.chunkFrames = Math.max(256, Math.round(sampleRate * AUDIO_CHUNK_SECONDS))
		this.channelData = Array.from({ length: channels }, () => new Float32Array(this.chunkFrames))
	}

	get position(): number {
		return this.written
	}

	private async flush(): Promise<void> {
		if (this.fill === 0) return
		const buffer = new AudioBuffer({
			length: this.fill,
			numberOfChannels: this.channels,
			sampleRate: this.sampleRate,
		})
		for (let channel = 0; channel < this.channels; channel++) {
			buffer.copyToChannel(this.channelData[channel].subarray(0, this.fill), channel)
		}
		this.fill = 0
		await this.add(buffer)
	}

	/** Pads to `target` with silence, so a hole in the source stays a hole. */
	async silenceUntil(target: number): Promise<void> {
		while (this.written < target) {
			const run = Math.min(target - this.written, this.chunkFrames - this.fill)
			for (let channel = 0; channel < this.channels; channel++) {
				this.channelData[channel].fill(0, this.fill, this.fill + run)
			}
			this.fill += run
			this.written += run
			if (this.fill >= this.chunkFrames) await this.flush()
		}
	}

	/**
	 * Writes output samples `[from, to)` by handing the destination arrays to
	 * `render`, one contiguous run at a time.
	 *
	 * The run, not the sample, is the unit of work. A per-sample `await` costs a
	 * microtask each, and an hour of 48 kHz audio is a hundred and seventy
	 * million of them - enough on its own to make an export look hung. A run is
	 * a plain loop over typed arrays, and in the common case a memory copy.
	 */
	async writeRun(
		from: number,
		to: number,
		render: (
			channels: Float32Array<ArrayBuffer>[],
			offset: number,
			first: number,
			count: number,
		) => void,
	): Promise<void> {
		let position = Math.max(from, this.written)
		while (position < to) {
			const run = Math.min(to - position, this.chunkFrames - this.fill)
			render(this.channelData, this.fill, position, run)
			this.fill += run
			this.written += run
			position += run
			if (this.fill >= this.chunkFrames) await this.flush()
		}
	}

	async finish(totalFrames: number): Promise<void> {
		await this.silenceUntil(totalFrames)
		await this.flush()
	}
}

/**
 * The source timestamps the output frames come from.
 *
 * Non-decreasing by construction, which is what lets the sink decode each
 * packet once instead of seeking backwards for every frame.
 */
function* sourceTimestamps(plan: CutPlan, fps: number, frames: number): Generator<number> {
	for (let index = 0; index < frames; index++) {
		const outputMs = (index / fps) * 1000
		yield outputToSource(plan, outputMs).sourceMs / 1000
	}
}

/** The segments that actually reach the output, in order. */
function keptSegments(plan: CutPlan): PlanSegment[] {
	return plan.segments.filter((segment) => segment.mode !== 'drop')
}

const VIDEO_QUALITY = { draft: 'QUALITY_LOW', high: 'QUALITY_HIGH', max: 'QUALITY_VERY_HIGH' } as const
const AUDIO_QUALITY = { draft: 'QUALITY_LOW', high: 'QUALITY_MEDIUM', max: 'QUALITY_HIGH' } as const

export async function renderCutVideo(options: SilenceRenderOptions): Promise<SilenceRenderResult> {
	const { plan, signal } = options
	assertLive(signal)
	if (plan.outputDurationMs <= 0) {
		throw new Error('This plan removes the entire clip. Keep at least one stretch of speech.')
	}

	const mediabunny = await import('mediabunny')
	const {
		ALL_FORMATS,
		AudioBufferSink,
		AudioBufferSource,
		BlobSource,
		Input,
		Mp4OutputFormat,
		Output,
		VideoSampleSink,
		VideoSampleSource,
		WebMOutputFormat,
		getFirstEncodableAudioCodec,
		getFirstEncodableVideoCodec,
	} = mediabunny

	const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(options.source) })
	const sink = await createRenderSink(`cut.${options.format}`)
	let output: InstanceType<typeof Output> | null = null
	/** Set once the finished file belongs to the caller and must not be swept. */
	let handedOver = false
	const onAbort = () => {
		void output?.cancel()
	}
	signal.addEventListener('abort', onAbort, { once: true })

	try {
		const videoTrack = await input.getPrimaryVideoTrack()
		if (!videoTrack) throw new Error('That file has no video track to cut.')
		if (!(await videoTrack.canDecode())) {
			throw new Error('This browser cannot decode that video codec, so it cannot be re-cut here.')
		}

		const audioTrack = options.includeAudio ? await input.getPrimaryAudioTrack() : null
		const audioDecodable = audioTrack ? await audioTrack.canDecode() : false

		const sourceWidth = await videoTrack.getDisplayWidth()
		const sourceHeight = await videoTrack.getDisplayHeight()
		const scale = Math.min(1, Math.max(0.25, options.scale || 1))
		const width = evenSize(sourceWidth * scale)
		const height = evenSize(sourceHeight * scale)

		const fps = Math.min(120, Math.max(1, options.fps || 30))
		const framesTotal = Math.max(1, Math.round((plan.outputDurationMs / 1000) * fps))

		options.onProgress?.({
			phase: 'preparing',
			ratio: 0,
			framesDone: 0,
			framesTotal,
			secondsDone: 0,
		})

		const videoCodec = await getFirstEncodableVideoCodec(
			options.format === 'mp4' ? ['avc', 'hevc', 'vp9', 'av1'] : ['vp9', 'vp8', 'av1'],
			{ width, height },
		)
		if (!videoCodec) {
			throw new Error('This browser cannot encode video. Try Chrome or Edge on a desktop.')
		}

		const channels = audioTrack ? Math.min(2, audioTrack.numberOfChannels || 1) : 0
		const sampleRate = audioTrack?.sampleRate || 48_000
		const audioCodec =
			audioTrack && audioDecodable
				? await getFirstEncodableAudioCodec(
						options.format === 'mp4' ? ['aac', 'opus'] : ['opus', 'vorbis'],
						{ numberOfChannels: channels, sampleRate },
					)
				: null

		output = new Output({
			format:
				options.format === 'mp4'
					? // Fast Start and streaming to disk are mutually exclusive: putting
						// the metadata first means holding every media chunk until the very
						// end, which is the allocation this render exists to avoid. The
						// moov box goes last instead, which local playback does not mind.
						new Mp4OutputFormat({ fastStart: sink.streaming ? false : 'in-memory' })
					: new WebMOutputFormat(),
			target: sink.target,
		})

		const videoSource = new VideoSampleSource({
			codec: videoCodec,
			bitrate: mediabunny[VIDEO_QUALITY[options.quality]],
			keyFrameInterval: 2,
			sizeChangeBehavior: 'contain',
			transform: { width, height },
		})
		output.addVideoTrack(videoSource, { frameRate: fps })

		const audioSource =
			audioCodec && audioTrack
				? new AudioBufferSource({
						codec: audioCodec,
						bitrate: mediabunny[AUDIO_QUALITY[options.quality]],
					})
				: null
		if (audioSource) output.addAudioTrack(audioSource)

		await output.start()

		let framesDone = 0
		let reportedAt = 0
		const report = (phase: RenderProgress['phase']) => {
			if (!options.onProgress) return
			const now = performance.now()
			if (now - reportedAt < PROGRESS_INTERVAL_MS) return
			reportedAt = now
			options.onProgress({
				phase,
				ratio: Math.min(0.999, framesDone / framesTotal),
				framesDone,
				framesTotal,
				secondsDone: framesDone / fps,
			})
		}

		/* ---------------------------------------------------------- video */

		const encodeVideo = async () => {
			const videoSink = new VideoSampleSink(videoTrack)
			let previous: import('mediabunny').VideoSample | null = null
			let index = 0

			try {
				for await (const sample of videoSink.samplesAtTimestamps(
					sourceTimestamps(plan, fps, framesTotal),
				)) {
					assertLive(signal)
					const timestamp = index / fps
					index += 1

					// A null means the plan asked for a moment the track has no frame
					// for - before the first packet, or inside a hole. Holding the
					// last frame is what a player does there, and what looks right.
					const frame = sample ?? previous?.clone() ?? null
					if (!frame) continue

					if (sample) {
						previous?.close()
						previous = sample.clone()
					}

					frame.setTimestamp(timestamp)
					frame.setDuration(1 / fps)
					await videoSource.add(frame)
					frame.close()

					framesDone += 1
					report('encoding')
				}
			} finally {
				previous?.close()
				videoSource.close()
			}
		}

		/* ---------------------------------------------------------- audio */

		const encodeAudio = async () => {
			if (!audioSource || !audioTrack) return
			const audioSink = new AudioBufferSink(audioTrack)
			const outChannels = Math.max(1, channels)
			const writer = new AudioWriter((buffer) => audioSource.add(buffer), sampleRate, outChannels)
			const segments = keptSegments(plan)
			const totalFrames = Math.round((plan.outputDurationMs / 1000) * sampleRate)
			let cursor = 0
			const inputChannels: Float32Array[] = []

			try {
				for await (const wrapped of audioSink.buffers()) {
					assertLive(signal)
					const bufferStart = wrapped.timestamp
					const bufferEnd = bufferStart + wrapped.duration
					const rate = wrapped.buffer.sampleRate
					const lastIndex = wrapped.buffer.length - 1
					if (lastIndex < 0) continue

					inputChannels.length = 0
					for (let channel = 0; channel < outChannels; channel++) {
						inputChannels.push(
							wrapped.buffer.getChannelData(
								Math.min(channel, Math.max(0, wrapped.buffer.numberOfChannels - 1)),
							),
						)
					}

					// Segments are sorted, and so are the buffers, so the cursor only
					// ever moves forward across the whole track.
					while (cursor < segments.length && segments[cursor].sourceEndMs / 1000 <= bufferStart) {
						cursor += 1
					}

					for (let index = cursor; index < segments.length; index++) {
						const segment = segments[index]
						const segStart = segment.sourceStartMs / 1000
						const segEnd = segment.sourceEndMs / 1000
						if (segStart >= bufferEnd) break

						const from = Math.max(segStart, bufferStart)
						const to = Math.min(segEnd, bufferEnd)
						if (to <= from) continue

						const outStart = segment.outputStartMs / 1000
						const speed = segment.speed
						const firstSample = Math.round((outStart + (from - segStart) / speed) * sampleRate)
						const lastSample = Math.round((outStart + (to - segStart) / speed) * sampleRate)

						// A gap here is a stretch the source had no samples for.
						if (firstSample > writer.position) await writer.silenceUntil(firstSample)
						if (lastSample <= writer.position) continue

						// Output sample `position` reads source sample `base + position *
						// step` of this buffer. Still the same absolute mapping - nothing
						// accumulates across buffers or splices - only folded into one
						// multiply-add instead of four divisions per sample.
						const step = (speed * rate) / sampleRate
						const base = (segStart - bufferStart - outStart * speed) * rate
						const wholeOffset = Math.round(base)
						// A straight cut at unchanged speed lands exactly on source
						// samples, and then the entire run is one memory copy.
						const aligned = Math.abs(step - 1) < 1e-9 && Math.abs(base - wholeOffset) < 1e-6

						await writer.writeRun(firstSample, lastSample, (out, offset, first, count) => {
							if (aligned) {
								const start = wholeOffset + first
								// Anything reaching past either end of the buffer holds the
								// edge sample, which is what clamping the index did before.
								const head = Math.max(0, Math.min(count, -start))
								const tail = Math.max(head, Math.min(count, lastIndex + 1 - start))
								for (let channel = 0; channel < out.length; channel++) {
									const source = inputChannels[channel]
									const destination = out[channel]
									if (head > 0) destination.fill(source[0], offset, offset + head)
									if (tail > head) {
										destination.set(source.subarray(start + head, start + tail), offset + head)
									}
									if (tail < count) {
										destination.fill(source[lastIndex], offset + tail, offset + count)
									}
								}
								return
							}

							for (let channel = 0; channel < out.length; channel++) {
								const source = inputChannels[channel]
								const destination = out[channel]
								for (let n = 0; n < count; n++) {
									const exact = base + (first + n) * step
									const left = Math.floor(exact)
									const fraction = exact - left
									const leftIndex = left < 0 ? 0 : left > lastIndex ? lastIndex : left
									const right = left + 1
									const rightIndex = right < 0 ? 0 : right > lastIndex ? lastIndex : right
									destination[offset + n] =
										source[leftIndex] * (1 - fraction) + source[rightIndex] * fraction
								}
							}
						})
					}
				}

				await writer.finish(totalFrames)
			} finally {
				audioSource.close()
			}
		}

		await Promise.all([encodeVideo(), encodeAudio()])
		assertLive(signal)

		options.onProgress?.({
			phase: 'finishing',
			ratio: 0.999,
			framesDone,
			framesTotal,
			secondsDone: framesDone / fps,
		})

		await output.finalize()
		const blob = await sink.finish(options.format === 'mp4' ? 'video/mp4' : 'video/webm')
		handedOver = true

		options.onProgress?.({
			phase: 'finishing',
			ratio: 1,
			framesDone,
			framesTotal,
			secondsDone: framesDone / fps,
		})

		return {
			blob,
			url: URL.createObjectURL(blob),
			format: options.format,
			width,
			height,
			fps,
			durationSeconds: plan.outputDurationMs / 1000,
			sizeInBytes: blob.size,
			videoCodec,
			audioCodec,
		}
	} catch (error) {
		if (signal.aborted) throw new RenderCancelled()
		throw describeRenderFailure(error)
	} finally {
		signal.removeEventListener('abort', onAbort)
		input.dispose()
		if (!handedOver) void sink.discard()
	}
}

/** `talk.mp4` becomes `talk-cut.mp4`, which is what a person expects to find. */
export function cutFileName(name: string, format: RenderFormat): string {
	const base = name.replace(/\.[a-z0-9]+$/i, '') || 'video'
	return `${base}-cut.${format}`
}
