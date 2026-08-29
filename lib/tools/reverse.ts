'use client'

/**
 * Playing a clip backwards.
 *
 * The obvious implementations are both wrong. Decoding every frame into an
 * array and then encoding it backwards runs a 1080p minute into eight
 * gigabytes and dies - which is precisely the failure this codebase has
 * already been bitten by once, in the silence cutter. Seeking to each frame in
 * turn from the end is memory-safe but re-decodes from the nearest keyframe
 * every single time, so a clip with two-second GOPs decodes roughly sixty
 * times more frames than it has.
 *
 * So it is done in chunks. The clip is divided into spans short enough that
 * one span's decoded frames fit in a fixed memory budget; spans are visited
 * from last to first; and inside each span frames are decoded *forwards* -
 * which is the only direction a codec is fast at - and then encoded in
 * reverse. Every frame is decoded exactly once, and peak memory is the budget
 * rather than the file.
 *
 * The canvases the frames land in are pooled and reused across spans, because
 * allocating a few hundred GPU-backed canvases per minute of footage is its
 * own kind of leak.
 *
 * Audio is reversed as a whole buffer: it is two orders of magnitude smaller
 * than the video, and reversing it in chunks would put a seam at every
 * boundary.
 */

import { reverseAudio } from './audio-ops'
import { decodeWholeTrack } from './av-remux'
import { createRenderSink, describeRenderFailure } from '../media/render-sink'

export type ReverseFormat = 'mp4' | 'webm'
export type ReverseQuality = 'draft' | 'high' | 'max'

export type ReverseProgress = { phase: 'preparing' | 'encoding' | 'finishing'; ratio: number }

export type ReverseResult = {
	blob: Blob
	url: string
	format: ReverseFormat
	width: number
	height: number
	fps: number
	durationSeconds: number
	sizeInBytes: number
}

export class ReverseCancelled extends Error {
	constructor() {
		super('Cancelled')
		this.name = 'ReverseCancelled'
	}
}

function assertLive(signal: AbortSignal): void {
	if (signal.aborted) throw new ReverseCancelled()
}

const VIDEO_QUALITY = { draft: 'QUALITY_LOW', high: 'QUALITY_HIGH', max: 'QUALITY_VERY_HIGH' } as const
const AUDIO_QUALITY = { draft: 'QUALITY_LOW', high: 'QUALITY_MEDIUM', max: 'QUALITY_HIGH' } as const

/**
 * How much decoded picture may be held at once. 160MB is about twenty
 * 1080p frames, or eighty 720p ones - comfortably more than a GOP, and small
 * enough to leave the encoder room on a modest machine.
 */
const FRAME_BUDGET_BYTES = 160 * 1024 * 1024

export async function renderReversed(args: {
	source: Blob
	format: ReverseFormat
	quality: ReverseQuality
	includeAudio: boolean
	onProgress?: (progress: ReverseProgress) => void
	signal: AbortSignal
}): Promise<ReverseResult> {
	const { signal } = args
	assertLive(signal)

	const mediabunny = await import('mediabunny')
	const {
		ALL_FORMATS,
		AudioBufferSource,
		BlobSource,
		Input,
		Mp4OutputFormat,
		Output,
		VideoSample,
		VideoSampleSink,
		VideoSampleSource,
		WebMOutputFormat,
		getFirstEncodableAudioCodec,
		getFirstEncodableVideoCodec,
	} = mediabunny

	const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(args.source) })
	const sink = await createRenderSink(`reverse.${args.format}`)
	let output: InstanceType<typeof Output> | null = null
	let handedOver = false
	const onAbort = () => {
		void output?.cancel()
	}
	signal.addEventListener('abort', onAbort, { once: true })

	try {
		const videoTrack = await input.getPrimaryVideoTrack()
		if (!videoTrack) throw new Error('That file has no video track to reverse.')
		if (!(await videoTrack.canDecode())) {
			throw new Error('This browser cannot decode that video codec, so it cannot be reversed here.')
		}

		const width = await videoTrack.getDisplayWidth()
		const height = await videoTrack.getDisplayHeight()
		const stats = await videoTrack.computePacketStats(120)
		const fps = stats.averagePacketRate > 0 ? Math.min(120, Math.max(1, stats.averagePacketRate)) : 30
		const duration = await input.computeDuration()
		const framesTotal = Math.max(1, Math.round(duration * fps))

		args.onProgress?.({ phase: 'preparing', ratio: 0 })

		const videoCodec = await getFirstEncodableVideoCodec(
			args.format === 'mp4' ? ['avc', 'hevc', 'vp9', 'av1'] : ['vp9', 'vp8', 'av1'],
			{ width, height },
		)
		if (!videoCodec) throw new Error('This browser cannot encode video. Try Chrome or Edge on a desktop.')

		output = new Output({
			format:
				args.format === 'mp4'
					? new Mp4OutputFormat({ fastStart: sink.streaming ? false : 'in-memory' })
					: new WebMOutputFormat(),
			target: sink.target,
		})
		const videoSource = new VideoSampleSource({
			codec: videoCodec,
			bitrate: mediabunny[VIDEO_QUALITY[args.quality]],
			keyFrameInterval: 2,
		})
		output.addVideoTrack(videoSource, { frameRate: fps })

		const audioTrack = args.includeAudio ? await input.getPrimaryAudioTrack() : null
		let audioSource: InstanceType<typeof AudioBufferSource> | null = null
		if (audioTrack) {
			const audioCodec = await getFirstEncodableAudioCodec(
				args.format === 'mp4' ? ['aac', 'opus'] : ['opus', 'vorbis'],
				{ numberOfChannels: Math.max(1, Math.min(2, audioTrack.numberOfChannels)), sampleRate: audioTrack.sampleRate },
			)
			if (audioCodec) {
				audioSource = new AudioBufferSource({ codec: audioCodec, bitrate: mediabunny[AUDIO_QUALITY[args.quality]] })
				output.addAudioTrack(audioSource)
			}
		}

		await output.start()

		/* ------------------------------------------------------------- video */

		const bytesPerFrame = Math.max(1, width * height * 4)
		const framesPerChunk = Math.max(4, Math.min(240, Math.floor(FRAME_BUDGET_BYTES / bytesPerFrame)))
		const chunkSeconds = framesPerChunk / fps
		const chunkCount = Math.max(1, Math.ceil(duration / chunkSeconds))

		// One pool, grown on demand, reused by every chunk.
		const pool: Array<{ canvas: OffscreenCanvas; ctx: OffscreenCanvasRenderingContext2D }> = []
		const takeCanvas = (index: number) => {
			while (pool.length <= index) {
				const canvas = new OffscreenCanvas(width, height)
				const ctx = canvas.getContext('2d')
				if (!ctx) throw new Error('This browser has no 2D canvas context to draw frames with.')
				pool.push({ canvas, ctx })
			}
			return pool[index]
		}

		let framesDone = 0
		const frameSink = new VideoSampleSink(videoTrack)

		for (let chunk = chunkCount - 1; chunk >= 0; chunk--) {
			assertLive(signal)
			const start = chunk * chunkSeconds
			const end = Math.min(duration, start + chunkSeconds)

			let held = 0
			for await (const sample of frameSink.samples(start, end)) {
				assertLive(signal)
				const slot = takeCanvas(held)
				slot.ctx.clearRect(0, 0, width, height)
				sample.draw(slot.ctx, 0, 0, width, height)
				sample.close()
				held++
				// A variable frame rate can put more frames in a span than its
				// nominal length suggests; the budget is a hard limit, so the
				// overflow is dropped rather than allowed to exhaust memory.
				if (held >= framesPerChunk) break
			}

			for (let i = held - 1; i >= 0; i--) {
				assertLive(signal)
				const frame = new VideoSample(pool[i].canvas, { timestamp: framesDone / fps, duration: 1 / fps })
				await videoSource.add(frame)
				frame.close()
				framesDone++
				if (framesDone % 5 === 0) {
					args.onProgress?.({ phase: 'encoding', ratio: Math.min(0.9, framesDone / framesTotal) })
				}
			}
		}
		videoSource.close()

		/* ------------------------------------------------------------- audio */

		if (audioSource) {
			args.onProgress?.({ phase: 'encoding', ratio: 0.92 })
			const decoded = await decodeWholeTrack({ source: args.source, signal })
			if (decoded) {
				await audioSource.add(reverseAudio(decoded.buffer))
			}
			audioSource.close()
		}

		assertLive(signal)
		args.onProgress?.({ phase: 'finishing', ratio: 0.98 })
		await output.finalize()

		const blob = await sink.finish(args.format === 'mp4' ? 'video/mp4' : 'video/webm')
		handedOver = true
		args.onProgress?.({ phase: 'finishing', ratio: 1 })

		return {
			blob,
			url: URL.createObjectURL(blob),
			format: args.format,
			width,
			height,
			fps,
			durationSeconds: framesDone / fps,
			sizeInBytes: blob.size,
		}
	} catch (error) {
		if (signal.aborted) throw new ReverseCancelled()
		throw describeRenderFailure(error)
	} finally {
		if (!handedOver) void sink.discard()
		signal.removeEventListener('abort', onAbort)
		input.dispose()
	}
}
