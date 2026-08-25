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
 * Two decisions carry the whole design:
 *
 *   1. video is driven by *output* frames, not by source frames. Asking "what
 *      belongs at output frame 900?" makes removal, speed-up and a frame-rate
 *      change the same operation, and it cannot drift, because the question is
 *      re-asked from scratch for every frame.
 *   2. audio positions are computed from absolute time, never accumulated. A
 *      per-buffer counter would collect a fraction of a sample of error at each
 *      of a hundred splices and end the file visibly out of lip-sync.
 *
 * Everything is streamed: buffers are decoded, mapped and encoded a few at a
 * time, so a long clip costs bounded memory rather than its own size in RAM.
 */

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

	async push(frame: number[]): Promise<void> {
		for (let channel = 0; channel < this.channels; channel++) {
			this.channelData[channel][this.fill] = frame[channel] ?? frame[0] ?? 0
		}
		this.fill += 1
		this.written += 1
		if (this.fill >= this.chunkFrames) await this.flush()
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
		BufferTarget,
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
	let output: InstanceType<typeof Output> | null = null
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
					? new Mp4OutputFormat({ fastStart: 'in-memory' })
					: new WebMOutputFormat(),
			target: new BufferTarget(),
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
		const report = (phase: RenderProgress['phase']) => {
			options.onProgress?.({
				phase,
				ratio: Math.min(0.999, framesDone / framesTotal),
				framesDone,
				framesTotal,
				secondsDone: framesDone / fps,
			})
		}

		/* ---------------------------------------------------------- video */

		const encodeVideo = async () => {
			const sink = new VideoSampleSink(videoTrack)
			let previous: import('mediabunny').VideoSample | null = null
			let index = 0

			try {
				for await (const sample of sink.samplesAtTimestamps(
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
					if (framesDone % 5 === 0) report('encoding')
				}
			} finally {
				previous?.close()
				videoSource.close()
			}
		}

		/* ---------------------------------------------------------- audio */

		const encodeAudio = async () => {
			if (!audioSource || !audioTrack) return
			const sink = new AudioBufferSink(audioTrack)
			const writer = new AudioWriter(
				(buffer) => audioSource.add(buffer),
				sampleRate,
				Math.max(1, channels),
			)
			const segments = keptSegments(plan)
			const totalFrames = Math.round((plan.outputDurationMs / 1000) * sampleRate)
			let cursor = 0
			const frame: number[] = new Array(Math.max(1, channels)).fill(0)

			try {
				for await (const wrapped of sink.buffers()) {
					assertLive(signal)
					const bufferStart = wrapped.timestamp
					const bufferEnd = bufferStart + wrapped.duration
					const rate = wrapped.buffer.sampleRate
					const data: Float32Array[] = []
					for (let channel = 0; channel < Math.max(1, channels); channel++) {
						data.push(
							wrapped.buffer.getChannelData(Math.min(channel, wrapped.buffer.numberOfChannels - 1)),
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

						for (let position = Math.max(firstSample, writer.position); position < lastSample; position++) {
							// Absolute, never accumulated: this is the line that keeps a
							// hundred splices in sync with the picture.
							const sourceSeconds = segStart + (position / sampleRate - outStart) * speed
							const exact = (sourceSeconds - bufferStart) * rate
							const left = Math.floor(exact)
							const fraction = exact - left
							const leftIndex = Math.max(0, Math.min(wrapped.buffer.length - 1, left))
							const rightIndex = Math.max(0, Math.min(wrapped.buffer.length - 1, left + 1))
							for (let channel = 0; channel < data.length; channel++) {
								const channelData = data[channel]
								frame[channel] =
									channelData[leftIndex] * (1 - fraction) + channelData[rightIndex] * fraction
							}
							await writer.push(frame)
						}
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
		const buffer = (output.target as InstanceType<typeof BufferTarget>).buffer
		if (!buffer) throw new Error('The encoder produced no file.')

		const blob = new Blob([buffer], {
			type: options.format === 'mp4' ? 'video/mp4' : 'video/webm',
		})

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
		throw error
	} finally {
		signal.removeEventListener('abort', onAbort)
		input.dispose()
	}
}

/** `talk.mp4` becomes `talk-cut.mp4`, which is what a person expects to find. */
export function cutFileName(name: string, format: RenderFormat): string {
	const base = name.replace(/\.[a-z0-9]+$/i, '') || 'video'
	return `${base}-cut.${format}`
}
