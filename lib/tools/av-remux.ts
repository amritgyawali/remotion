'use client'

/**
 * The audio-only engine: every tool that touches sound but leaves the
 * picture untouched runs through here.
 *
 * The insight worth writing down is that most audio edits - a gain change, a
 * mono-to-stereo fix, a channel swap, a fade, a mute - never need the video to
 * be decoded at all. Mediabunny can read a track's encoded packets and hand
 * them straight to the muxer for a *different* container without ever
 * running them through a decoder, so the video stream here is always copied
 * byte-for-byte: same picture, same quality, and an export that finishes in
 * roughly the time it takes to read the file rather than the time it takes
 * to watch it. Only the audio track goes through a decode/transform/encode
 * round trip, and only when the tool actually needs to look at the samples.
 *
 * This is the same trade a video editor's "export audio only" or "replace
 * audio track" command makes under the hood - it is just usually hidden
 * behind a desktop app instead of a browser tab.
 */

import { applyGainDb } from './audio-ops'
import { createRenderSink, describeRenderFailure } from '../media/render-sink'

export type AudioOutputFormat = 'mp4' | 'webm'
export type AudioOnlyFormat = 'wav' | 'webm'

export type AudioMode =
	| { kind: 'copy' }
	| { kind: 'mute' }
	| { kind: 'process'; transform: (buffer: AudioBuffer) => AudioBuffer }
	| { kind: 'replace'; file: File | Blob; gainDb?: number }

export type RemuxProgress = {
	phase: 'reading' | 'decoding' | 'encoding' | 'finishing'
	ratio: number
}

export class RemuxCancelled extends Error {
	constructor() {
		super('Cancelled')
		this.name = 'RemuxCancelled'
	}
}

function assertLive(signal: AbortSignal): void {
	if (signal.aborted) throw new RemuxCancelled()
}

/**
 * Grows a set of per-channel `Float32Array`s to fit whatever sample position
 * is written next, and fills any position nobody ever wrote to with silence.
 *
 * Buffers arrive from the decoder in presentation order but are placed by
 * absolute sample position rather than appended, which is what makes a
 * dropped packet or a track that starts a beat late turn into a gap of
 * silence in exactly the right place instead of shifting everything after it.
 */
class SampleAccumulator {
	// Spelled out rather than a bare `Float32Array[]` so `subarray()` below stays
	// zero-copy: a bare `Float32Array` defaults its buffer parameter to
	// `ArrayBufferLike`, `subarray()` propagates that, and `copyToChannel` only
	// accepts a plain `ArrayBuffer` - the same issue `silence/render.ts` hits.
	private channels: Float32Array<ArrayBuffer>[]
	private highWater = 0

	constructor(
		channelCount: number,
		estimatedFrames: number,
	) {
		const capacity = Math.max(1024, Math.ceil(estimatedFrames * 1.1))
		this.channels = Array.from({ length: Math.max(1, channelCount) }, () => new Float32Array(capacity))
	}

	private grow(needed: number): void {
		if (needed <= this.channels[0].length) return
		const capacity = Math.max(needed, Math.round(this.channels[0].length * 1.6))
		this.channels = this.channels.map((data) => {
			const grown = new Float32Array(capacity)
			grown.set(data)
			return grown
		})
	}

	write(startFrame: number, source: Float32Array[]): void {
		if (startFrame < 0) return
		const frames = source[0]?.length ?? 0
		this.grow(startFrame + frames)
		for (let channel = 0; channel < this.channels.length; channel++) {
			const data = source[Math.min(channel, source.length - 1)]
			this.channels[channel].set(data, startFrame)
		}
		this.highWater = Math.max(this.highWater, startFrame + frames)
	}

	toAudioBuffer(sampleRate: number): AudioBuffer {
		const length = Math.max(1, this.highWater)
		const buffer = new AudioBuffer({ length, numberOfChannels: this.channels.length, sampleRate })
		for (let channel = 0; channel < this.channels.length; channel++) {
			buffer.copyToChannel(this.channels[channel].subarray(0, length), channel)
		}
		return buffer
	}
}

/** Decodes an entire audio track into one in-memory `AudioBuffer`. Shared with `merge.ts`. */
export async function decodeWholeTrack(args: {
	source: Blob
	signal: AbortSignal
	onProgress?: (ratio: number) => void
}): Promise<{ buffer: AudioBuffer; codec: string | null } | null> {
	const { ALL_FORMATS, AudioBufferSink, BlobSource, Input } = await import('mediabunny')
	const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(args.source) })
	try {
		const track = await input.getPrimaryAudioTrack()
		if (!track) return null
		if (!(await track.canDecode())) {
			throw new Error('This browser cannot decode that audio codec.')
		}
		const duration = await input.computeDuration()
		const sampleRate = track.sampleRate || 48_000
		const channels = Math.max(1, track.numberOfChannels || 1)
		const codec = await track.getCodec()

		const accumulator = new SampleAccumulator(channels, duration * sampleRate)
		const sink = new AudioBufferSink(track)
		let producedSeconds = 0

		for await (const wrapped of sink.buffers()) {
			assertLive(args.signal)
			const rate = wrapped.buffer.sampleRate
			const data: Float32Array[] = []
			for (let channel = 0; channel < channels; channel++) {
				data.push(wrapped.buffer.getChannelData(Math.min(channel, wrapped.buffer.numberOfChannels - 1)))
			}
			const startFrame = Math.round(wrapped.timestamp * sampleRate)
			accumulator.write(startFrame, data)
			producedSeconds = Math.max(producedSeconds, wrapped.timestamp + wrapped.duration)
			if (duration > 0) args.onProgress?.(Math.min(0.99, producedSeconds / duration))
		}

		return { buffer: accumulator.toAudioBuffer(sampleRate), codec }
	} finally {
		input.dispose()
	}
}

/** Picks a container that can hold the source video codec byte-for-byte. */
async function pickContainerForVideoCodec(
	mediabunny: typeof import('mediabunny'),
	videoCodec: string,
	requested: AudioOutputFormat | 'auto',
): Promise<AudioOutputFormat> {
	const { Mp4OutputFormat, WebMOutputFormat } = mediabunny
	if (requested !== 'auto') {
		const format = requested === 'mp4' ? new Mp4OutputFormat() : new WebMOutputFormat()
		if (!format.getSupportedVideoCodecs().includes(videoCodec as never)) {
			throw new Error(
				`This clip's video (${videoCodec}) can't be carried inside ${requested.toUpperCase()} without ` +
					`re-encoding it, which this tool won't do just to change the audio. Try the other container.`,
			)
		}
		return requested
	}
	const mp4 = new Mp4OutputFormat()
	if (mp4.getSupportedVideoCodecs().includes(videoCodec as never)) return 'mp4'
	const webm = new WebMOutputFormat()
	if (webm.getSupportedVideoCodecs().includes(videoCodec as never)) return 'webm'
	throw new Error(`No container here can carry this clip's video codec (${videoCodec}) without re-encoding it.`)
}

export type RemuxMetadataTags = {
	title?: string
	artist?: string
	description?: string
	genre?: string
	comment?: string
}

export type RemuxOptions = {
	source: Blob
	audio: AudioMode
	format: AudioOutputFormat | 'auto'
	/** Descriptive tags to write into the output file - a pure passthrough when `audio` is `copy`. */
	metadata?: RemuxMetadataTags
	onProgress?: (progress: RemuxProgress) => void
	signal: AbortSignal
}

export type RemuxResult = {
	blob: Blob
	url: string
	format: AudioOutputFormat
	sizeInBytes: number
}

/**
 * Runs one audio-only edit over a video file: the picture is copied packet
 * for packet, the sound is decoded, transformed and re-encoded (or replaced,
 * or dropped entirely for a mute).
 */
export async function remuxWithAudioEdit(options: RemuxOptions): Promise<RemuxResult> {
	const { signal } = options
	assertLive(signal)

	const mediabunny = await import('mediabunny')
	const {
		ALL_FORMATS,
		AudioBufferSource,
		BlobSource,
		EncodedPacketSink,
		EncodedAudioPacketSource,
		EncodedVideoPacketSource,
		Input,
		Mp4OutputFormat,
		Output,
		WebMOutputFormat,
		getFirstEncodableAudioCodec,
		QUALITY_HIGH,
	} = mediabunny

	const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(options.source) })
	// Streamed to disk rather than grown in memory: the picture is copied packet
	// for packet, so the output is as big as the input, and a long clip would ask
	// the browser for a contiguous buffer it cannot give.
	const sink = await createRenderSink(`remux.${options.format}`)
	let output: InstanceType<typeof Output> | null = null
	let handedOver = false
	const onAbort = () => {
		void output?.cancel()
	}
	signal.addEventListener('abort', onAbort, { once: true })

	try {
		const videoTrack = await input.getPrimaryVideoTrack()
		if (!videoTrack) throw new Error('That file has no video track to keep.')
		const videoCodec = await videoTrack.getCodec()
		if (!videoCodec) throw new Error('This browser does not recognise that video codec.')

		options.onProgress?.({ phase: 'reading', ratio: 0 })
		const containerFormat = await pickContainerForVideoCodec(mediabunny, videoCodec, options.format)

		output = new Output({
			format:
				containerFormat === 'mp4'
					? new Mp4OutputFormat({ fastStart: sink.streaming ? false : 'in-memory' })
					: new WebMOutputFormat(),
			target: sink.target,
		})

		if (options.metadata) {
			const tags = options.metadata
			output.setMetadataTags({
				title: tags.title || undefined,
				artist: tags.artist || undefined,
				description: tags.description || undefined,
				genre: tags.genre || undefined,
				comment: tags.comment || undefined,
			})
		}

		/* ------------------------------------------------------------ video */

		const videoDecoderConfig = await videoTrack.getDecoderConfig()
		const videoSource = new EncodedVideoPacketSource(videoCodec as never)
		output.addVideoTrack(videoSource, { rotation: videoTrack.rotation })

		/* ------------------------------------------------------------ audio */

		let audioSource: InstanceType<typeof AudioBufferSource> | InstanceType<typeof EncodedAudioPacketSource> | null =
			null
		let audioBufferToAdd: AudioBuffer | null = null
		let audioPassthroughTrack: Awaited<ReturnType<typeof input.getPrimaryAudioTrack>> = null

		if (options.audio.kind === 'copy') {
			audioPassthroughTrack = await input.getPrimaryAudioTrack()
			if (audioPassthroughTrack) {
				const audioCodec = await audioPassthroughTrack.getCodec()
				const containerCheck =
					containerFormat === 'mp4' ? new Mp4OutputFormat() : new WebMOutputFormat()
				if (audioCodec && containerCheck.getSupportedAudioCodecs().includes(audioCodec as never)) {
					const source = new EncodedAudioPacketSource(audioCodec as never)
					output.addAudioTrack(source)
					audioSource = source
				} else {
					audioPassthroughTrack = null
				}
			}
		} else if (options.audio.kind === 'process') {
			const decoded = await decodeWholeTrack({
				source: options.source,
				signal,
				onProgress: (ratio) => options.onProgress?.({ phase: 'decoding', ratio: ratio * 0.6 }),
			})
			if (decoded) audioBufferToAdd = options.audio.transform(decoded.buffer)
		} else if (options.audio.kind === 'replace') {
			const decoded = await decodeWholeTrack({
				source: options.audio.file,
				signal,
				onProgress: (ratio) => options.onProgress?.({ phase: 'decoding', ratio: ratio * 0.6 }),
			})
			if (!decoded) throw new Error('The replacement file has no audio track.')
			audioBufferToAdd = options.audio.gainDb
				? applyGainDb(decoded.buffer, options.audio.gainDb)
				: decoded.buffer
		}
		// 'mute' leaves both audioBufferToAdd and audioSource unset: no audio
		// track is added to the output at all.

		if (audioBufferToAdd && !audioSource) {
			const audioCodec = await getFirstEncodableAudioCodec(
				containerFormat === 'mp4' ? ['aac', 'opus'] : ['opus', 'vorbis'],
				{ numberOfChannels: audioBufferToAdd.numberOfChannels, sampleRate: audioBufferToAdd.sampleRate },
			)
			if (!audioCodec) {
				throw new Error('This browser cannot encode audio for that container. Try Chrome or Edge on a desktop.')
			}
			const source = new AudioBufferSource({ codec: audioCodec, bitrate: QUALITY_HIGH })
			output.addAudioTrack(source)
			audioSource = source
		}

		await output.start()

		/* -------------------------------------------------------- write it */

		const writeVideo = async () => {
			const sink = new EncodedPacketSink(videoTrack)
			let first = true
			let count = 0
			for await (const packet of sink.packets()) {
				assertLive(signal)
				await videoSource.add(packet, first ? { decoderConfig: videoDecoderConfig ?? undefined } : undefined)
				first = false
				count += 1
				if (count % 30 === 0) options.onProgress?.({ phase: 'encoding', ratio: 0.65 })
			}
		}

		const writeAudio = async () => {
			if (audioBufferToAdd && audioSource instanceof AudioBufferSource) {
				await audioSource.add(audioBufferToAdd)
				audioSource.close()
				return
			}
			if (audioPassthroughTrack && audioSource instanceof EncodedAudioPacketSource) {
				const audioDecoderConfig = await audioPassthroughTrack.getDecoderConfig()
				const sink = new EncodedPacketSink(audioPassthroughTrack)
				let first = true
				const packetSource = audioSource
				for await (const packet of sink.packets()) {
					assertLive(signal)
					await packetSource.add(packet, first ? { decoderConfig: audioDecoderConfig ?? undefined } : undefined)
					first = false
				}
			}
		}

		await Promise.all([writeVideo(), writeAudio()])
		assertLive(signal)

		options.onProgress?.({ phase: 'finishing', ratio: 0.99 })
		videoSource.close()
		await output.finalize()

		const blob = await sink.finish(containerFormat === 'mp4' ? 'video/mp4' : 'video/webm')
		handedOver = true
		options.onProgress?.({ phase: 'finishing', ratio: 1 })

		return { blob, url: URL.createObjectURL(blob), format: containerFormat, sizeInBytes: blob.size }
	} catch (error) {
		if (signal.aborted) throw new RemuxCancelled()
		throw describeRenderFailure(error)
	} finally {
		signal.removeEventListener('abort', onAbort)
		input.dispose()
		if (!handedOver) void sink.discard()
	}
}

export type ExtractAudioResult = {
	blob: Blob
	url: string
	format: AudioOnlyFormat
	sizeInBytes: number
	durationSeconds: number
}

/** Pulls the audio track out on its own, with no video at all. */
export async function extractAudioOnly(args: {
	source: Blob
	format: AudioOnlyFormat
	transform?: (buffer: AudioBuffer) => AudioBuffer
	onProgress?: (ratio: number) => void
	signal: AbortSignal
}): Promise<ExtractAudioResult> {
	assertLive(args.signal)
	const decoded = await decodeWholeTrack({
		source: args.source,
		signal: args.signal,
		onProgress: (ratio) => args.onProgress?.(ratio * 0.7),
	})
	if (!decoded) throw new Error('That file has no audio track to extract.')
	const buffer = args.transform ? args.transform(decoded.buffer) : decoded.buffer

	const mediabunny = await import('mediabunny')
	const { AudioBufferSource, BufferTarget, Output, WavOutputFormat, WebMOutputFormat, getFirstEncodableAudioCodec, QUALITY_HIGH } =
		mediabunny

	const output = new Output({
		format: args.format === 'wav' ? new WavOutputFormat() : new WebMOutputFormat(),
		target: new BufferTarget(),
	})

	const codec =
		args.format === 'wav'
			? 'pcm-s16'
			: await getFirstEncodableAudioCodec(['opus', 'vorbis'], {
					numberOfChannels: buffer.numberOfChannels,
					sampleRate: buffer.sampleRate,
				})
	if (!codec) throw new Error('This browser cannot encode audio. Try Chrome or Edge on a desktop.')

	const source = new AudioBufferSource(args.format === 'wav' ? { codec } : { codec, bitrate: QUALITY_HIGH })
	output.addAudioTrack(source)
	await output.start()
	await source.add(buffer)
	source.close()
	args.onProgress?.(0.99)
	await output.finalize()

	const raw = (output.target as InstanceType<typeof BufferTarget>).buffer
	if (!raw) throw new Error('The encoder produced no file.')
	const blob = new Blob([raw], { type: args.format === 'wav' ? 'audio/wav' : 'audio/webm' })
	args.onProgress?.(1)
	return {
		blob,
		url: URL.createObjectURL(blob),
		format: args.format,
		sizeInBytes: blob.size,
		durationSeconds: buffer.length / buffer.sampleRate,
	}
}

/** Decodes the primary audio track of a file, for tools that only need to inspect it (e.g. balance meters). */
export async function decodeAudioForInspection(
	source: Blob,
	signal: AbortSignal,
): Promise<AudioBuffer | null> {
	const decoded = await decodeWholeTrack({ source, signal })
	return decoded?.buffer ?? null
}

export function remuxFileName(name: string, format: AudioOutputFormat | AudioOnlyFormat, suffix: string): string {
	const base = name.replace(/\.[a-z0-9]+$/i, '') || 'video'
	return `${base}-${suffix}.${format}`
}
