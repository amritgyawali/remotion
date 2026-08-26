'use client'

/**
 * Deterministic export: renders every frame of the timeline through the exact
 * same `renderFrame` the preview uses, encodes it, and mixes the whole
 * project's audio down offline before muxing the two together. "Deterministic"
 * here means what the blueprint's export contract (§7.1) asks for - the frame
 * loop is driven by an integer frame counter, never by how fast decoding or
 * encoding happens to run, so the same project always produces the same
 * output regardless of the machine's speed.
 *
 * Video and audio are still encoded concurrently (each `await`s its own
 * backpressure independently) for throughput, but neither one can skip a
 * unit of work to keep up with the other - a slow encoder makes the export
 * take longer, never drops a frame or a sample.
 */

import { activeClipsAtFrame, projectDurationFrames } from './model'
import { renderFrame } from './compositor'
import type { AssetSinkPool } from './sinks'
import { framesToSeconds, type AudioClip, type ProjectDoc, type VideoClip } from './types'

export type ExportFormat = 'mp4' | 'webm'
export type ExportQuality = 'draft' | 'high' | 'max'

export type ExportOptions = {
	format: ExportFormat
	quality: ExportQuality
	/** frame-count multiplier on the project's canvas size; 1 = as authored */
	scale: number
	/** defaults to the whole timeline */
	startFrame?: number
	endFrame?: number
	includeAudio: boolean
	signal: AbortSignal
}

export type ExportProgress = {
	phase: 'preparing' | 'rendering' | 'mixing' | 'finishing'
	ratio: number
	framesDone: number
	framesTotal: number
}

export type ExportResult = {
	blob: Blob
	url: string
	format: ExportFormat
	width: number
	height: number
	fps: number
	durationSeconds: number
	sizeInBytes: number
	offlineAssetCount: number
}

export class ExportCancelled extends Error {
	constructor() {
		super('Cancelled')
		this.name = 'ExportCancelled'
	}
}

function assertLive(signal: AbortSignal): void {
	if (signal.aborted) throw new ExportCancelled()
}

const QUALITY_KEY = { draft: 'QUALITY_LOW', high: 'QUALITY_HIGH', max: 'QUALITY_VERY_HIGH' } as const

function dbToGain(db: number): number {
	return Math.pow(10, db / 20)
}

export async function renderEditorExport(
	doc: ProjectDoc,
	pool: AssetSinkPool,
	resolveBlob: (assetId: string) => Blob | null,
	options: ExportOptions,
	onProgress?: (progress: ExportProgress) => void,
): Promise<ExportResult> {
	const { signal } = options
	assertLive(signal)

	const startFrame = Math.max(0, Math.round(options.startFrame ?? 0))
	const endFrame = Math.max(startFrame + 1, Math.round(options.endFrame ?? projectDurationFrames(doc)))
	const framesTotal = endFrame - startFrame
	if (framesTotal <= 0) throw new Error('There is nothing on the timeline to export yet.')

	const fps = doc.settings.fps
	const width = Math.max(2, Math.round(doc.settings.width * options.scale))
	const height = Math.max(2, Math.round(doc.settings.height * options.scale))
	const scaledDoc: ProjectDoc = width === doc.settings.width && height === doc.settings.height ? doc : { ...doc, settings: { ...doc.settings, width, height } }

	onProgress?.({ phase: 'preparing', ratio: 0, framesDone: 0, framesTotal })

	const mediabunny = await import('mediabunny')
	const { BufferTarget, CanvasSource, Mp4OutputFormat, Output, WebMOutputFormat, getFirstEncodableVideoCodec, AudioBufferSource } = mediabunny

	const videoCodec = await getFirstEncodableVideoCodec(options.format === 'mp4' ? ['avc', 'hevc', 'vp9', 'av1'] : ['vp9', 'vp8', 'av1'], { width, height })
	if (!videoCodec) throw new Error('This browser cannot encode video. Try Chrome or Edge on a desktop.')

	const output = new Output({
		format: options.format === 'mp4' ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(),
		target: new BufferTarget(),
	})
	const onAbort = () => void output.cancel()
	signal.addEventListener('abort', onAbort, { once: true })

	try {
		const canvas = new OffscreenCanvas(width, height)
		const videoSource = new CanvasSource(canvas, { codec: videoCodec, bitrate: mediabunny[QUALITY_KEY[options.quality]], keyFrameInterval: 2 })
		output.addVideoTrack(videoSource, { frameRate: fps })

		let audioSource: InstanceType<typeof AudioBufferSource> | null = null
		if (options.includeAudio) {
			const audioCodec = options.format === 'mp4' ? 'aac' : 'opus'
			audioSource = new AudioBufferSource({ codec: audioCodec, bitrate: mediabunny.QUALITY_HIGH })
			output.addAudioTrack(audioSource)
		}

		await output.start()

		const offlineAssetIds = new Set<string>()
		let framesDone = 0
		const reportRender = () => {
			onProgress?.({ phase: 'rendering', ratio: Math.min(0.94, (framesDone / framesTotal) * 0.94), framesDone, framesTotal })
		}

		const renderVideo = async () => {
			for (let frame = startFrame; frame < endFrame; frame++) {
				assertLive(signal)
				const result = await renderFrame(scaledDoc, pool, resolveBlob, frame, canvas)
				for (const id of result.offlineAssetIds) offlineAssetIds.add(id)
				await videoSource.add(framesToSeconds(frame - startFrame, fps), 1 / fps)
				framesDone = frame - startFrame + 1
				if (framesDone % 5 === 0) reportRender()
			}
			videoSource.close()
		}

		const mixAudio = async () => {
			if (!audioSource) return
			onProgress?.({ phase: 'mixing', ratio: 0.95, framesDone, framesTotal })
			const buffer = await mixdownAudio(scaledDoc, pool, resolveBlob, startFrame, endFrame, signal)
			assertLive(signal)
			if (buffer) await audioSource.add(buffer)
			audioSource.close()
		}

		await Promise.all([renderVideo(), mixAudio()])
		assertLive(signal)

		onProgress?.({ phase: 'finishing', ratio: 0.99, framesDone, framesTotal })
		await output.finalize()

		const buffer = (output.target as InstanceType<typeof BufferTarget>).buffer
		if (!buffer) throw new Error('The encoder produced no file.')
		const blob = new Blob([buffer], { type: options.format === 'mp4' ? 'video/mp4' : 'video/webm' })
		onProgress?.({ phase: 'finishing', ratio: 1, framesDone, framesTotal })

		return {
			blob,
			url: URL.createObjectURL(blob),
			format: options.format,
			width,
			height,
			fps,
			durationSeconds: framesTotal / fps,
			sizeInBytes: blob.size,
			offlineAssetCount: offlineAssetIds.size,
		}
	} catch (error) {
		if (signal.aborted) throw new ExportCancelled()
		throw error
	} finally {
		signal.removeEventListener('abort', onAbort)
	}
}

/**
 * Renders the whole project's audio into one `AudioBuffer` on an
 * `OfflineAudioContext` - the same graph-building idea the blueprint's export
 * contract (§7.3) calls for, sized here to exactly the exported range.
 */
async function mixdownAudio(
	doc: ProjectDoc,
	pool: AssetSinkPool,
	resolveBlob: (assetId: string) => Blob | null,
	startFrame: number,
	endFrame: number,
	signal: AbortSignal,
): Promise<AudioBuffer | null> {
	const fps = doc.settings.fps
	const sampleRate = 48_000
	const durationSeconds = (endFrame - startFrame) / fps
	const length = Math.max(1, Math.ceil(durationSeconds * sampleRate))
	if (typeof OfflineAudioContext === 'undefined') return null
	const ctx = new OfflineAudioContext({ numberOfChannels: 2, length, sampleRate })

	const audibleClips = new Set<string>()
	for (let frame = startFrame; frame < endFrame; frame += Math.max(1, Math.round(fps))) {
		for (const clip of activeClipsAtFrame(doc, frame)) {
			if ((clip.kind === 'video' || clip.kind === 'audio') && !clip.audio.muted && !(clip.kind === 'video' && clip.freezeFrame)) audibleClips.add(clip.id)
		}
	}

	let scheduled = 0
	for (const clipId of audibleClips) {
		assertLive(signal)
		const clip = doc.clips[clipId] as VideoClip | AudioClip | undefined
		if (!clip) continue
		const asset = doc.assets[clip.assetId]
		if (!asset || !asset.hasAudio || asset.status !== 'ready') continue
		const blob = resolveBlob(asset.id)
		if (!blob) continue
		const sink = await pool.get(asset, blob)
		if (!sink?.audioSink) continue

		// Clamp the clip to the exported range, in project frames, then convert
		// to source seconds through its own trim + speed.
		const clipStart = Math.max(clip.startFrame, startFrame)
		const clipEnd = Math.min(clip.startFrame + clip.durationFrames, endFrame)
		if (clipEnd <= clipStart) continue
		const sourceFrom = clip.sourceInSeconds + ((clipStart - clip.startFrame) / fps) * clip.speed
		const sourceTo = clip.sourceInSeconds + ((clipEnd - clip.startFrame) / fps) * clip.speed
		const timelineOffsetSeconds = (clipStart - startFrame) / fps
		const gain = ctx.createGain()
		gain.gain.value = dbToGain(clip.audio.gainDb)
		gain.connect(ctx.destination)

		const fadeInSeconds = clip.audio.fadeInFrames / fps
		const fadeOutSeconds = clip.audio.fadeOutFrames / fps
		const clipDuration = (clipEnd - clipStart) / fps
		if (fadeInSeconds > 0) {
			gain.gain.setValueAtTime(0, timelineOffsetSeconds)
			gain.gain.linearRampToValueAtTime(dbToGain(clip.audio.gainDb), timelineOffsetSeconds + Math.min(fadeInSeconds, clipDuration))
		}
		if (fadeOutSeconds > 0) {
			const rampStart = timelineOffsetSeconds + Math.max(0, clipDuration - fadeOutSeconds)
			gain.gain.setValueAtTime(dbToGain(clip.audio.gainDb), rampStart)
			gain.gain.linearRampToValueAtTime(0, timelineOffsetSeconds + clipDuration)
		}

		for await (const wrapped of sink.audioSink.buffers(sourceFrom, sourceTo)) {
			assertLive(signal)
			const node = ctx.createBufferSource()
			node.buffer = wrapped.buffer
			if (clip.speed !== 1) node.playbackRate.value = clip.speed
			node.connect(gain)
			const at = timelineOffsetSeconds + (wrapped.timestamp - sourceFrom) / clip.speed
			node.start(Math.max(0, at))
			scheduled += 1
		}
	}

	if (scheduled === 0) return null
	return ctx.startRendering()
}
