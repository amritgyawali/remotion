'use client'

/**
 * Split screen: two, three or four clips playing at once in one frame.
 *
 * The reaction video, the before-and-after, the four-way panel. Mechanically
 * it is the same shape as a transition - several clips read forward at once
 * and composited into a single output - so it reuses the same forward frame
 * reader, and the only new thinking is the layout and what happens when the
 * clips are different lengths.
 *
 * Two decisions worth stating:
 *
 * - **The output runs as long as the longest clip**, and a clip that has run
 *   out holds its last frame rather than going black. Cutting one panel to
 *   black while the others keep playing looks like a fault; a held frame looks
 *   like a decision. That behaviour falls out of the reader for free - it
 *   keeps the last frame it drew - which is why it is worth having the reader
 *   own that rule rather than each caller.
 * - **Each cell is filled, not fitted.** A panel with its own letterbox inside
 *   a frame that already has gaps between panels is two kinds of empty space.
 *   `cover` crops to fill, which is nearly always what is wanted; `contain` is
 *   offered for the cases where it is not.
 *
 * Audio from every clip is mixed rather than picked. Each source is attenuated
 * by 1/sqrt(n) before summing, which keeps the perceived loudness roughly
 * constant however many panels there are - summing at full gain would clip
 * four talking heads instantly.
 */

import { drawFitted } from './background-replace'
import { computeFrameDims } from './frame-ops'
import { createForwardFrameReader, type ForwardFrameReader, type ReadableSample } from './frame-reader'
import { resampleChannel } from './audio-ops'
import { decodeWholeTrack } from './av-remux'
import { createRenderSink, describeRenderFailure } from '../media/render-sink'

export type SplitLayoutId = 'side-by-side' | 'stacked' | 'triptych' | 'triptych-v' | 'grid' | 'left-feature' | 'top-feature'

export type SplitLayout = {
	id: SplitLayoutId
	label: string
	blurb: string
	/** how many clips it takes */
	panels: number
	/** each panel as x, y, width, height in 0-1 of the output frame */
	cells: Array<[number, number, number, number]>
}

export const SPLIT_LAYOUTS: SplitLayout[] = [
	{
		id: 'side-by-side',
		label: 'Side by side',
		blurb: 'Two clips, left and right.',
		panels: 2,
		cells: [
			[0, 0, 0.5, 1],
			[0.5, 0, 0.5, 1],
		],
	},
	{
		id: 'stacked',
		label: 'Stacked',
		blurb: 'Two clips, one above the other - the vertical reaction layout.',
		panels: 2,
		cells: [
			[0, 0, 1, 0.5],
			[0, 0.5, 1, 0.5],
		],
	},
	{
		id: 'triptych',
		label: 'Three across',
		blurb: 'Three equal columns.',
		panels: 3,
		cells: [
			[0, 0, 1 / 3, 1],
			[1 / 3, 0, 1 / 3, 1],
			[2 / 3, 0, 1 / 3, 1],
		],
	},
	{
		id: 'triptych-v',
		label: 'Three down',
		blurb: 'Three equal rows.',
		panels: 3,
		cells: [
			[0, 0, 1, 1 / 3],
			[0, 1 / 3, 1, 1 / 3],
			[0, 2 / 3, 1, 1 / 3],
		],
	},
	{
		id: 'left-feature',
		label: 'One large, two small',
		blurb: 'A main clip on the left with two stacked beside it.',
		panels: 3,
		cells: [
			[0, 0, 2 / 3, 1],
			[2 / 3, 0, 1 / 3, 0.5],
			[2 / 3, 0.5, 1 / 3, 0.5],
		],
	},
	{
		id: 'top-feature',
		label: 'One on top, two below',
		blurb: 'A main clip across the top with two underneath.',
		panels: 3,
		cells: [
			[0, 0, 1, 2 / 3],
			[0, 2 / 3, 0.5, 1 / 3],
			[0.5, 2 / 3, 0.5, 1 / 3],
		],
	},
	{
		id: 'grid',
		label: 'Two by two',
		blurb: 'Four clips in a grid.',
		panels: 4,
		cells: [
			[0, 0, 0.5, 0.5],
			[0.5, 0, 0.5, 0.5],
			[0, 0.5, 0.5, 0.5],
			[0.5, 0.5, 0.5, 0.5],
		],
	},
]

export function splitLayoutById(id: string): SplitLayout | null {
	return SPLIT_LAYOUTS.find((layout) => layout.id === id) ?? null
}

/** The output shapes offered, matching the ones the canvas tool uses. */
export const SPLIT_ASPECTS: Record<string, [number, number]> = {
	'16:9': [1920, 1080],
	'9:16': [1080, 1920],
	'1:1': [1080, 1080],
	'4:5': [1080, 1350],
}

export type SplitFormat = 'mp4' | 'webm'
export type SplitQuality = 'draft' | 'high' | 'max'

export type SplitProgress = { phase: 'preparing' | 'encoding' | 'finishing'; ratio: number }

export type SplitResult = {
	blob: Blob
	url: string
	format: SplitFormat
	width: number
	height: number
	fps: number
	durationSeconds: number
	sizeInBytes: number
	panels: number
}

export class SplitCancelled extends Error {
	constructor() {
		super('Cancelled')
		this.name = 'SplitCancelled'
	}
}

function assertLive(signal: AbortSignal): void {
	if (signal.aborted) throw new SplitCancelled()
}

const VIDEO_QUALITY = { draft: 'QUALITY_LOW', high: 'QUALITY_HIGH', max: 'QUALITY_VERY_HIGH' } as const
const AUDIO_QUALITY = { draft: 'QUALITY_LOW', high: 'QUALITY_MEDIUM', max: 'QUALITY_HIGH' } as const

export async function renderSplitScreen(args: {
	clips: Array<File | Blob>
	layout: SplitLayoutId
	aspect: string
	/** 0-6: the gutter between panels, as a percentage of the frame's short side */
	gap: number
	background: string
	fit: 'cover' | 'contain'
	/** 0-6: rounded corners on each panel, as a percentage of the short side */
	radius: number
	format: SplitFormat
	quality: SplitQuality
	onProgress?: (progress: SplitProgress) => void
	signal: AbortSignal
}): Promise<SplitResult> {
	const { signal } = args
	assertLive(signal)

	const layout = splitLayoutById(args.layout)
	if (!layout) throw new Error('Pick a split-screen layout first.')
	if (args.clips.length < layout.panels) {
		throw new Error(`"${layout.label}" needs ${layout.panels} clips; ${args.clips.length} were added.`)
	}
	const clips = args.clips.slice(0, layout.panels)

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

	const inputs = clips.map((clip) => new Input({ formats: ALL_FORMATS, source: new BlobSource(clip) }))
	const sink = await createRenderSink(`split.${args.format}`)
	let output: InstanceType<typeof Output> | null = null
	let handedOver = false
	const readers: ForwardFrameReader[] = []
	const onAbort = () => {
		void output?.cancel()
	}
	signal.addEventListener('abort', onAbort, { once: true })

	try {
		const [targetWidth, targetHeight] = SPLIT_ASPECTS[args.aspect] ?? SPLIT_ASPECTS['16:9']
		const shortSide = Math.min(targetWidth, targetHeight)
		const gapPx = Math.round((Math.min(6, Math.max(0, args.gap)) / 100) * shortSide)
		const radiusPx = Math.round((Math.min(6, Math.max(0, args.radius)) / 100) * shortSide)

		const tracks = []
		let fps = 30
		let longest = 0
		for (let i = 0; i < inputs.length; i++) {
			const track = await inputs[i].getPrimaryVideoTrack()
			if (!track) throw new Error(`Clip ${i + 1} has no video track.`)
			if (!(await track.canDecode())) throw new Error(`This browser cannot decode clip ${i + 1}.`)
			const width = await track.getDisplayWidth()
			const height = await track.getDisplayHeight()
			const duration = await inputs[i].computeDuration()
			longest = Math.max(longest, duration)
			if (i === 0) {
				const stats = await track.computePacketStats(120)
				if (stats.averagePacketRate > 0) fps = Math.min(120, Math.max(1, stats.averagePacketRate))
			}
			tracks.push({ track, width, height, duration })
		}

		const framesTotal = Math.max(2, Math.round(longest * fps))
		args.onProgress?.({ phase: 'preparing', ratio: 0 })

		const videoCodec = await getFirstEncodableVideoCodec(
			args.format === 'mp4' ? ['avc', 'hevc', 'vp9', 'av1'] : ['vp9', 'vp8', 'av1'],
			{ width: targetWidth, height: targetHeight },
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

		const audioTracks = await Promise.all(inputs.map((entry) => entry.getPrimaryAudioTrack()))
		const hasAudio = audioTracks.some(Boolean)
		let audioSource: InstanceType<typeof AudioBufferSource> | null = null
		let sampleRate = 48_000
		let channels = 2
		if (hasAudio) {
			const first = audioTracks.find(Boolean)
			sampleRate = first?.sampleRate || 48_000
			channels = Math.max(1, Math.min(2, first?.numberOfChannels || 2))
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

		const canvas = new OffscreenCanvas(targetWidth, targetHeight)
		const ctx = canvas.getContext('2d')
		if (!ctx) throw new Error('This browser has no 2D canvas context to draw frames with.')

		// Each panel is read at its own native size and scaled into its cell at
		// draw time, so a small cell never costs a full-size intermediate.
		for (const entry of tracks) {
			const dims = computeFrameDims(entry.width, entry.height, {})
			readers.push(
				createForwardFrameReader(new VideoSampleSink(entry.track).samples() as AsyncIterable<ReadableSample>, {}, dims),
			)
		}

		for (let index = 0; index < framesTotal; index++) {
			assertLive(signal)
			const time = index / fps

			ctx.setTransform(1, 0, 0, 1, 0, 0)
			ctx.filter = 'none'
			ctx.globalAlpha = 1
			ctx.fillStyle = args.background
			ctx.fillRect(0, 0, targetWidth, targetHeight)

			for (let panel = 0; panel < readers.length; panel++) {
				const frame = await readers[panel].at(time)
				if (!frame) continue
				const [cx, cy, cw, ch] = layout.cells[panel]
				// The gutter is taken out of the inside of every cell, so the
				// outer edge of the montage stays flush with the frame.
				const x = cx * targetWidth + gapPx / 2
				const y = cy * targetHeight + gapPx / 2
				const width = Math.max(2, cw * targetWidth - gapPx)
				const height = Math.max(2, ch * targetHeight - gapPx)

				ctx.save()
				ctx.beginPath()
				if (radiusPx > 0) ctx.roundRect(x, y, width, height, radiusPx)
				else ctx.rect(x, y, width, height)
				ctx.clip()
				ctx.translate(x, y)
				drawFitted(ctx, frame, frame.width, frame.height, width, height, args.fit)
				ctx.restore()
			}

			const sample = new VideoSample(canvas, { timestamp: time, duration: 1 / fps })
			await videoSource.add(sample)
			sample.close()
			if (index % 5 === 0) args.onProgress?.({ phase: 'encoding', ratio: Math.min(0.88, index / framesTotal) })
		}
		videoSource.close()

		/* ------------------------------------------------------------- audio */

		if (audioSource) {
			args.onProgress?.({ phase: 'encoding', ratio: 0.9 })
			const decoded = await Promise.all(
				clips.map((clip, i) => (audioTracks[i] ? decodeWholeTrack({ source: clip, signal }) : Promise.resolve(null))),
			)
			const present = decoded.filter(Boolean).length
			const totalLength = Math.max(1, Math.round(longest * sampleRate))
			const combined = new AudioBuffer({ length: totalLength, numberOfChannels: channels, sampleRate })
			// Equal-power rather than equal-gain: summing n uncorrelated sources
			// raises the level by sqrt(n), so that is what has to come back out.
			const gain = present > 0 ? 1 / Math.sqrt(present) : 1

			for (let channel = 0; channel < channels; channel++) {
				const mix = new Float32Array(totalLength)
				for (const track of decoded) {
					if (!track) continue
					const source = track.buffer.getChannelData(Math.min(channel, track.buffer.numberOfChannels - 1))
					const resampled = resampleChannel(source, track.buffer.sampleRate, sampleRate)
					const limit = Math.min(resampled.length, totalLength)
					for (let i = 0; i < limit; i++) mix[i] += resampled[i] * gain
				}
				for (let i = 0; i < totalLength; i++) mix[i] = Math.max(-1, Math.min(1, mix[i]))
				combined.copyToChannel(mix, channel)
			}
			await audioSource.add(combined)
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
			width: targetWidth,
			height: targetHeight,
			fps,
			durationSeconds: longest,
			sizeInBytes: blob.size,
			panels: readers.length,
		}
	} catch (error) {
		if (signal.aborted) throw new SplitCancelled()
		throw describeRenderFailure(error)
	} finally {
		for (const reader of readers) reader.dispose()
		if (!handedOver) void sink.discard()
		signal.removeEventListener('abort', onAbort)
		for (const entry of inputs) entry.dispose()
	}
}

export function splitFileName(format: SplitFormat): string {
	return `split-screen.${format}`
}
