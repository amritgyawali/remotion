'use client'

/**
 * Concatenation: two clips, back to back, in one file.
 *
 * The picture is the interesting part - the two clips can be different
 * sizes, so the second one is letterboxed onto the first's canvas (via the
 * same `fit: 'contain'` frame-ops uses for aspect padding) rather than
 * stretched or cropped to fit. The two audio tracks are decoded whole (reused
 * from `av-remux.ts`, which already does this for "extract audio"),
 * resampled onto a common rate, and placed one after the other in a single
 * buffer - silence stands in for whichever clip has no audio at all, so the
 * join never jumps in level.
 */

import { computeFrameDims, drawFrame, type FrameOpsDims } from './frame-ops'
import { resampleChannel } from './audio-ops'
import { decodeWholeTrack } from './av-remux'
import { createRenderSink, describeRenderFailure } from '../media/render-sink'

export type MergeFormat = 'mp4' | 'webm'
export type MergeQuality = 'draft' | 'high' | 'max'

export type MergeProgress = { phase: 'preparing' | 'encoding' | 'finishing'; ratio: number }

export type MergeResult = {
	blob: Blob
	url: string
	format: MergeFormat
	width: number
	height: number
	fps: number
	durationSeconds: number
	sizeInBytes: number
}

export class MergeCancelled extends Error {
	constructor() {
		super('Cancelled')
		this.name = 'MergeCancelled'
	}
}

function assertLive(signal: AbortSignal): void {
	if (signal.aborted) throw new MergeCancelled()
}

const VIDEO_QUALITY = { draft: 'QUALITY_LOW', high: 'QUALITY_HIGH', max: 'QUALITY_VERY_HIGH' } as const
const AUDIO_QUALITY = { draft: 'QUALITY_LOW', high: 'QUALITY_MEDIUM', max: 'QUALITY_HIGH' } as const

export async function mergeClips(args: {
	first: Blob
	second: Blob
	format: MergeFormat
	quality: MergeQuality
	onProgress?: (progress: MergeProgress) => void
	signal: AbortSignal
}): Promise<MergeResult> {
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

	const inputA = new Input({ formats: ALL_FORMATS, source: new BlobSource(args.first) })
	const inputB = new Input({ formats: ALL_FORMATS, source: new BlobSource(args.second) })
	// Two clips end to end make a file bigger than either of them; it goes to
	// disk as it is written rather than being grown in one heap buffer.
	const sink = await createRenderSink(`merge.${args.format}`)
	let output: InstanceType<typeof Output> | null = null
	let handedOver = false
	const onAbort = () => {
		void output?.cancel()
	}
	signal.addEventListener('abort', onAbort, { once: true })

	try {
		const trackA = await inputA.getPrimaryVideoTrack()
		const trackB = await inputB.getPrimaryVideoTrack()
		if (!trackA) throw new Error('The first clip has no video track.')
		if (!trackB) throw new Error('The second clip has no video track.')
		if (!(await trackA.canDecode()) || !(await trackB.canDecode())) {
			throw new Error('This browser cannot decode one of these two clips.')
		}

		const widthA = await trackA.getDisplayWidth()
		const heightA = await trackA.getDisplayHeight()
		const dims: FrameOpsDims = computeFrameDims(widthA, heightA, {})
		const frameParams = { targetWidth: dims.width, targetHeight: dims.height, fit: 'contain' as const, padColor: '#000000' }

		const stats = await trackA.computePacketStats(120)
		const fps = stats.averagePacketRate > 0 ? Math.min(120, Math.max(1, stats.averagePacketRate)) : 30
		const durationA = await inputA.computeDuration()
		const durationB = await inputB.computeDuration()
		const framesTotal = Math.max(2, Math.round((durationA + durationB) * fps))

		args.onProgress?.({ phase: 'preparing', ratio: 0 })

		const videoCodec = await getFirstEncodableVideoCodec(
			args.format === 'mp4' ? ['avc', 'hevc', 'vp9', 'av1'] : ['vp9', 'vp8', 'av1'],
			{ width: dims.width, height: dims.height },
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

		const audioTrackA = await inputA.getPrimaryAudioTrack()
		const audioTrackB = await inputB.getPrimaryAudioTrack()
		const wantsAudio = Boolean(audioTrackA || audioTrackB)
		let audioSource: InstanceType<typeof AudioBufferSource> | null = null
		let sampleRate = 48_000
		let channels = 2
		if (wantsAudio) {
			sampleRate = audioTrackA?.sampleRate || audioTrackB?.sampleRate || 48_000
			channels = Math.max(1, Math.min(2, audioTrackA?.numberOfChannels || audioTrackB?.numberOfChannels || 2))
			const audioCodec = await getFirstEncodableAudioCodec(
				args.format === 'mp4' ? ['aac', 'opus'] : ['opus', 'vorbis'],
				{ numberOfChannels: channels, sampleRate },
			)
			if (audioCodec) {
				audioSource = new AudioBufferSource({ codec: audioCodec, bitrate: mediabunny[AUDIO_QUALITY[args.quality]] })
				output.addAudioTrack(audioSource)
			}
		}

		await output.start()

		const canvas = new OffscreenCanvas(dims.width, dims.height)
		const ctx = canvas.getContext('2d')
		if (!ctx) throw new Error('This browser has no 2D canvas context to draw frames with.')

		let framesDone = 0
		const report = () => {
			args.onProgress?.({ phase: 'encoding', ratio: Math.min(0.85, framesDone / framesTotal) })
		}

		const encodeClipVideo = async (
			track: NonNullable<Awaited<ReturnType<typeof inputA.getPrimaryVideoTrack>>>,
			sourceWidth: number,
			sourceHeight: number,
			indexOffset: number,
		): Promise<number> => {
			const clipDims = computeFrameDims(sourceWidth, sourceHeight, frameParams)
			const sink = new VideoSampleSink(track)
			let index = 0
			for await (const sample of sink.samples()) {
				assertLive(signal)
				drawFrame(
					ctx,
					(c, sx, sy, sw, sh, dx, dy, dw, dh) => sample.draw(c as CanvasRenderingContext2D, sx, sy, sw, sh, dx, dy, dw, dh),
					frameParams,
					clipDims,
				)
				sample.close()
				const frame = new VideoSample(canvas, { timestamp: (indexOffset + index) / fps, duration: 1 / fps })
				await videoSource.add(frame)
				frame.close()
				index += 1
				framesDone = indexOffset + index
				if (framesDone % 5 === 0) report()
			}
			return index
		}

		const framesFromA = await encodeClipVideo(trackA, widthA, heightA, 0)
		const framesFromB = await encodeClipVideo(trackB, await trackB.getDisplayWidth(), await trackB.getDisplayHeight(), framesFromA)
		videoSource.close()

		if (audioSource) {
			const [decodedA, decodedB] = await Promise.all([
				audioTrackA ? decodeWholeTrack({ source: args.first, signal }) : Promise.resolve(null),
				audioTrackB ? decodeWholeTrack({ source: args.second, signal }) : Promise.resolve(null),
			])
			const totalLength = Math.max(1, Math.round((durationA + durationB) * sampleRate))
			const offsetB = Math.round(durationA * sampleRate)
			const combined = new AudioBuffer({ length: totalLength, numberOfChannels: channels, sampleRate })
			for (let channel = 0; channel < channels; channel++) {
				const data = new Float32Array(totalLength)
				if (decodedA) {
					const source = decodedA.buffer.getChannelData(Math.min(channel, decodedA.buffer.numberOfChannels - 1))
					const resampled = resampleChannel(source, decodedA.buffer.sampleRate, sampleRate)
					data.set(resampled.subarray(0, Math.min(resampled.length, offsetB)), 0)
				}
				if (decodedB) {
					const source = decodedB.buffer.getChannelData(Math.min(channel, decodedB.buffer.numberOfChannels - 1))
					const resampled = resampleChannel(source, decodedB.buffer.sampleRate, sampleRate)
					const remaining = totalLength - offsetB
					if (remaining > 0) data.set(resampled.subarray(0, Math.min(resampled.length, remaining)), offsetB)
				}
				combined.copyToChannel(data, channel)
			}
			await audioSource.add(combined)
			audioSource.close()
		}

		assertLive(signal)
		args.onProgress?.({ phase: 'finishing', ratio: 0.99 })
		await output.finalize()

		const blob = await sink.finish(args.format === 'mp4' ? 'video/mp4' : 'video/webm')
		handedOver = true
		args.onProgress?.({ phase: 'finishing', ratio: 1 })

		const totalFrames = framesFromA + framesFromB
		return {
			blob,
			url: URL.createObjectURL(blob),
			format: args.format,
			width: dims.width,
			height: dims.height,
			fps,
			durationSeconds: totalFrames / fps,
			sizeInBytes: blob.size,
		}
	} catch (error) {
		if (signal.aborted) throw new MergeCancelled()
		throw describeRenderFailure(error)
	} finally {
		if (!handedOver) void sink.discard()
		signal.removeEventListener('abort', onAbort)
		inputA.dispose()
		inputB.dispose()
	}
}

export function mergeFileName(name: string, format: MergeFormat): string {
	const base = name.replace(/\.[a-z0-9]+$/i, '') || 'video'
	return `${base}-merged.${format}`
}
