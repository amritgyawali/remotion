'use client'

/**
 * Joining two clips with a transition rather than a hard cut.
 *
 * `merge.ts` puts two clips end to end. This overlaps them: the last N seconds
 * of the first clip and the first N seconds of the second play at the same
 * time, and a transition decides what the frame looks like while they do. The
 * output is therefore *shorter* than the sum of its parts by exactly the
 * transition's length, which is what an editor expects and what a naive
 * implementation gets wrong.
 *
 * The interesting engineering is the reading, not the drawing. During the
 * overlap two clips must be sampled at once, and doing that with per-frame
 * seeks re-decodes from a keyframe on every call. Instead each clip gets a
 * forward-only reader: it holds one async iterator over its own frames and
 * advances it until the frame covering the requested time has been drawn. Both
 * clips are therefore decoded exactly once, in the only direction a codec is
 * fast in, and the reader is three lines of state rather than a cache.
 *
 * Every transition is a pure function of two canvases and a 0-1 progress, so
 * adding one is a case in a switch and nothing else.
 */

import { computeFrameDims, type FrameOpsDims, type FrameOpsParams } from './frame-ops'
import { createForwardFrameReader, type ForwardFrameReader, type ReadableSample } from './frame-reader'
import { resampleChannel } from './audio-ops'
import { decodeWholeTrack } from './av-remux'
import { createRenderSink, describeRenderFailure } from '../media/render-sink'

type Ctx2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D

export type TransitionId =
	| 'dissolve'
	| 'fade-black'
	| 'fade-white'
	| 'wipe-left'
	| 'wipe-right'
	| 'wipe-up'
	| 'wipe-down'
	| 'slide-left'
	| 'slide-up'
	| 'push-left'
	| 'zoom-in'
	| 'zoom-out'
	| 'spin'
	| 'iris'
	| 'blur'
	| 'flash'
	| 'glitch'

export const TRANSITIONS: Array<{ id: TransitionId; label: string; blurb: string }> = [
	{ id: 'dissolve', label: 'Cross dissolve', blurb: 'The default. One picture fades into the other.' },
	{ id: 'fade-black', label: 'Dip to black', blurb: 'Out to black, then up from black - a change of scene.' },
	{ id: 'fade-white', label: 'Dip to white', blurb: 'The same idea, brighter and faster-feeling.' },
	{ id: 'wipe-left', label: 'Wipe left', blurb: 'A soft edge travels across, revealing the next clip.' },
	{ id: 'wipe-right', label: 'Wipe right', blurb: 'The same, the other way.' },
	{ id: 'wipe-up', label: 'Wipe up', blurb: 'The edge travels up the frame.' },
	{ id: 'wipe-down', label: 'Wipe down', blurb: 'The edge travels down the frame.' },
	{ id: 'slide-left', label: 'Slide in', blurb: 'The next clip slides in over the top of this one.' },
	{ id: 'slide-up', label: 'Slide up', blurb: 'The next clip rises in from below.' },
	{ id: 'push-left', label: 'Push', blurb: 'The next clip shoves this one off the screen.' },
	{ id: 'zoom-in', label: 'Zoom in', blurb: 'The next clip rushes in from the centre.' },
	{ id: 'zoom-out', label: 'Zoom out', blurb: 'This clip falls away to reveal the next.' },
	{ id: 'spin', label: 'Spin', blurb: 'A quarter turn between the two.' },
	{ id: 'iris', label: 'Iris', blurb: 'A circle opens from the middle.' },
	{ id: 'blur', label: 'Blur through', blurb: 'Both clips defocus at the midpoint and come back sharp.' },
	{ id: 'flash', label: 'Flash', blurb: 'A frame of white at the join - a camera flash cut.' },
	{ id: 'glitch', label: 'Glitch', blurb: 'Torn, colour-split slices for the length of the join.' },
]

export type TransitionFormat = 'mp4' | 'webm'
export type TransitionQuality = 'draft' | 'high' | 'max'

export type TransitionProgress = { phase: 'preparing' | 'encoding' | 'finishing'; ratio: number }

export type TransitionResult = {
	blob: Blob
	url: string
	format: TransitionFormat
	width: number
	height: number
	fps: number
	durationSeconds: number
	sizeInBytes: number
}

export class TransitionCancelled extends Error {
	constructor() {
		super('Cancelled')
		this.name = 'TransitionCancelled'
	}
}

function assertLive(signal: AbortSignal): void {
	if (signal.aborted) throw new TransitionCancelled()
}

const VIDEO_QUALITY = { draft: 'QUALITY_LOW', high: 'QUALITY_HIGH', max: 'QUALITY_VERY_HIGH' } as const
const AUDIO_QUALITY = { draft: 'QUALITY_LOW', high: 'QUALITY_MEDIUM', max: 'QUALITY_HIGH' } as const

/** Smooth start and end, so no transition begins or ends with a jolt. */
function ease(t: number): number {
	const x = Math.min(1, Math.max(0, t))
	return x * x * (3 - 2 * x)
}

/**
 * Draws one frame of a transition between `a` (outgoing) and `b` (incoming).
 *
 * `progress` is 0 at the first frame of the overlap and 1 at the last.
 * Exported so the same function can render a preview still without going
 * anywhere near an encoder.
 */
export function drawTransitionFrame(
	ctx: Ctx2D,
	a: CanvasImageSource | null,
	b: CanvasImageSource | null,
	transition: TransitionId,
	progress: number,
	width: number,
	height: number,
): void {
	const t = ease(progress)
	ctx.save()
	ctx.setTransform(1, 0, 0, 1, 0, 0)
	ctx.globalAlpha = 1
	ctx.globalCompositeOperation = 'source-over'
	ctx.filter = 'none'
	ctx.fillStyle = '#000000'
	ctx.fillRect(0, 0, width, height)

	const drawA = (alpha = 1) => {
		if (!a) return
		ctx.globalAlpha = alpha
		ctx.drawImage(a, 0, 0, width, height)
		ctx.globalAlpha = 1
	}
	const drawB = (alpha = 1) => {
		if (!b) return
		ctx.globalAlpha = alpha
		ctx.drawImage(b, 0, 0, width, height)
		ctx.globalAlpha = 1
	}

	switch (transition) {
		case 'dissolve':
			drawA()
			drawB(t)
			break

		case 'fade-black':
		case 'fade-white': {
			// Two half-length fades, not one crossfade: the first clip is gone
			// before the second arrives, which is the whole point of a dip.
			const ground = transition === 'fade-white' ? '#ffffff' : '#000000'
			ctx.fillStyle = ground
			ctx.fillRect(0, 0, width, height)
			if (t < 0.5) drawA(1 - t * 2)
			else drawB((t - 0.5) * 2)
			break
		}

		case 'wipe-left':
		case 'wipe-right':
		case 'wipe-up':
		case 'wipe-down': {
			drawA()
			if (!b) break
			// A soft edge rather than a hard one: a one-pixel boundary between
			// two moving pictures aliases badly at any bitrate.
			const soft = Math.max(2, Math.min(width, height) * 0.03)
			const vertical = transition === 'wipe-up' || transition === 'wipe-down'
			const span = vertical ? height : width
			const edge = t * (span + soft * 2) - soft
			const gradient = vertical
				? ctx.createLinearGradient(0, transition === 'wipe-down' ? edge - soft : span - edge + soft, 0, transition === 'wipe-down' ? edge + soft : span - edge - soft)
				: ctx.createLinearGradient(transition === 'wipe-right' ? edge - soft : width - edge + soft, 0, transition === 'wipe-right' ? edge + soft : width - edge - soft, 0)
			gradient.addColorStop(0, 'rgba(0,0,0,1)')
			gradient.addColorStop(1, 'rgba(0,0,0,0)')

			const layer = new OffscreenCanvas(width, height)
			const layerCtx = layer.getContext('2d')
			if (!layerCtx) break
			layerCtx.drawImage(b, 0, 0, width, height)
			layerCtx.globalCompositeOperation = 'destination-in'
			layerCtx.fillStyle = gradient
			layerCtx.fillRect(0, 0, width, height)
			ctx.drawImage(layer, 0, 0)
			break
		}

		case 'slide-left':
			drawA()
			if (b) ctx.drawImage(b, width * (1 - t), 0, width, height)
			break

		case 'slide-up':
			drawA()
			if (b) ctx.drawImage(b, 0, height * (1 - t), width, height)
			break

		case 'push-left':
			if (a) ctx.drawImage(a, -width * t, 0, width, height)
			if (b) ctx.drawImage(b, width * (1 - t), 0, width, height)
			break

		case 'zoom-in': {
			drawA()
			if (!b) break
			// Scaling about the centre while the alpha comes up: a zoom that
			// arrives at full size and full opacity together reads as one move.
			const scale = 0.4 + 0.6 * t
			const w = width * scale
			const h = height * scale
			ctx.globalAlpha = t
			ctx.drawImage(b, (width - w) / 2, (height - h) / 2, w, h)
			ctx.globalAlpha = 1
			break
		}

		case 'zoom-out': {
			drawB()
			if (!a) break
			const scale = 1 - 0.6 * t
			const w = width * scale
			const h = height * scale
			ctx.globalAlpha = 1 - t
			ctx.drawImage(a, (width - w) / 2, (height - h) / 2, w, h)
			ctx.globalAlpha = 1
			break
		}

		case 'spin': {
			drawB()
			if (!a) break
			ctx.save()
			ctx.translate(width / 2, height / 2)
			ctx.rotate(t * Math.PI * 0.5)
			const scale = 1 - t
			ctx.globalAlpha = 1 - t
			ctx.drawImage(a, (-width * scale) / 2, (-height * scale) / 2, width * scale, height * scale)
			ctx.restore()
			ctx.globalAlpha = 1
			break
		}

		case 'iris': {
			drawA()
			if (!b) break
			const layer = new OffscreenCanvas(width, height)
			const layerCtx = layer.getContext('2d')
			if (!layerCtx) break
			layerCtx.drawImage(b, 0, 0, width, height)
			layerCtx.globalCompositeOperation = 'destination-in'
			// The radius has to reach the corner, not the edge, or the last few
			// percent of the transition has nothing left to reveal.
			const maxRadius = Math.hypot(width, height) / 2
			const radius = t * maxRadius
			const gradient = layerCtx.createRadialGradient(width / 2, height / 2, Math.max(0, radius - maxRadius * 0.06), width / 2, height / 2, radius)
			gradient.addColorStop(0, 'rgba(0,0,0,1)')
			gradient.addColorStop(1, 'rgba(0,0,0,0)')
			layerCtx.fillStyle = gradient
			layerCtx.fillRect(0, 0, width, height)
			ctx.drawImage(layer, 0, 0)
			break
		}

		case 'blur': {
			// Defocus peaks at the midpoint and is gone at both ends, so the
			// transition starts and finishes on a sharp frame.
			const amount = Math.sin(t * Math.PI) * Math.min(width, height) * 0.05
			ctx.filter = amount > 0.5 ? `blur(${amount.toFixed(1)}px)` : 'none'
			drawA()
			drawB(t)
			ctx.filter = 'none'
			break
		}

		case 'flash': {
			drawA()
			drawB(t)
			const flash = Math.sin(t * Math.PI)
			ctx.fillStyle = `rgba(255,255,255,${(flash * flash).toFixed(3)})`
			ctx.fillRect(0, 0, width, height)
			break
		}

		case 'glitch': {
			drawA()
			drawB(t)
			const intensity = Math.sin(t * Math.PI)
			const slices = 14
			// Deterministic per-slice displacement, keyed on progress, so the
			// tear pattern changes every frame but is reproducible.
			for (let i = 0; i < slices; i++) {
				const y = (i / slices) * height
				const h = height / slices
				const noise = Math.sin(i * 12.9898 + Math.floor(t * 24) * 78.233) * 43758.5453
				const shift = (noise - Math.floor(noise) - 0.5) * width * 0.18 * intensity
				const source = i % 2 === 0 ? b : a
				if (!source) continue
				ctx.drawImage(source, 0, y, width, h, shift, y, width, h)
			}
			ctx.globalCompositeOperation = 'lighter'
			ctx.globalAlpha = intensity * 0.25
			if (b) ctx.drawImage(b, width * 0.004 * intensity, 0, width, height)
			ctx.globalAlpha = 1
			ctx.globalCompositeOperation = 'source-over'
			break
		}
	}

	ctx.restore()
}

export async function renderTransition(args: {
	first: Blob
	second: Blob
	transition: TransitionId
	/** how long the two clips overlap, in seconds */
	transitionSeconds: number
	format: TransitionFormat
	quality: TransitionQuality
	onProgress?: (progress: TransitionProgress) => void
	signal: AbortSignal
}): Promise<TransitionResult> {
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
	const sink = await createRenderSink(`transition.${args.format}`)
	let output: InstanceType<typeof Output> | null = null
	let handedOver = false
	let readerA: ForwardFrameReader | null = null
	let readerB: ForwardFrameReader | null = null
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
		const widthB = await trackB.getDisplayWidth()
		const heightB = await trackB.getDisplayHeight()
		const dims: FrameOpsDims = computeFrameDims(widthA, heightA, {})
		// The second clip is letterboxed onto the first's canvas rather than
		// stretched, exactly as `merge.ts` does - two clips of different shapes
		// is the normal case, not the exception.
		const frameParams: FrameOpsParams = { targetWidth: dims.width, targetHeight: dims.height, fit: 'contain', padColor: '#000000' }
		const dimsA = computeFrameDims(widthA, heightA, frameParams)
		const dimsB = computeFrameDims(widthB, heightB, frameParams)

		const stats = await trackA.computePacketStats(120)
		const fps = stats.averagePacketRate > 0 ? Math.min(120, Math.max(1, stats.averagePacketRate)) : 30
		const durationA = await inputA.computeDuration()
		const durationB = await inputB.computeDuration()
		// The overlap cannot be longer than either clip, or one of them would
		// have to start before it exists.
		const overlap = Math.max(0.1, Math.min(args.transitionSeconds, durationA * 0.9, durationB * 0.9))
		const totalDuration = durationA + durationB - overlap
		const framesTotal = Math.max(2, Math.round(totalDuration * fps))
		const overlapStart = durationA - overlap

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
		let audioSource: InstanceType<typeof AudioBufferSource> | null = null
		let sampleRate = 48_000
		let channels = 2
		if (audioTrackA || audioTrackB) {
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

		readerA = createForwardFrameReader(new VideoSampleSink(trackA).samples() as AsyncIterable<ReadableSample>, frameParams, dimsA)
		readerB = createForwardFrameReader(new VideoSampleSink(trackB).samples() as AsyncIterable<ReadableSample>, frameParams, dimsB)

		for (let index = 0; index < framesTotal; index++) {
			assertLive(signal)
			const time = index / fps
			const bTime = time - overlapStart

			if (time < overlapStart) {
				const frame = await readerA.at(time)
				ctx.clearRect(0, 0, dims.width, dims.height)
				if (frame) ctx.drawImage(frame, 0, 0)
			} else if (time < durationA) {
				const [frameA, frameB] = [await readerA.at(time), await readerB.at(Math.max(0, bTime))]
				drawTransitionFrame(ctx, frameA, frameB, args.transition, overlap > 0 ? bTime / overlap : 1, dims.width, dims.height)
			} else {
				const frame = await readerB.at(Math.max(0, bTime))
				ctx.clearRect(0, 0, dims.width, dims.height)
				if (frame) ctx.drawImage(frame, 0, 0)
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
			const [decodedA, decodedB] = await Promise.all([
				audioTrackA ? decodeWholeTrack({ source: args.first, signal }) : Promise.resolve(null),
				audioTrackB ? decodeWholeTrack({ source: args.second, signal }) : Promise.resolve(null),
			])
			const totalLength = Math.max(1, Math.round(totalDuration * sampleRate))
			const offsetB = Math.round(overlapStart * sampleRate)
			const overlapSamples = Math.max(1, Math.round(overlap * sampleRate))
			const combined = new AudioBuffer({ length: totalLength, numberOfChannels: channels, sampleRate })

			for (let channel = 0; channel < channels; channel++) {
				const mix = new Float32Array(totalLength)
				if (decodedA) {
					const source = decodedA.buffer.getChannelData(Math.min(channel, decodedA.buffer.numberOfChannels - 1))
					const resampled = resampleChannel(source, decodedA.buffer.sampleRate, sampleRate)
					for (let i = 0; i < Math.min(resampled.length, totalLength); i++) mix[i] = resampled[i]
				}
				if (decodedB) {
					const source = decodedB.buffer.getChannelData(Math.min(channel, decodedB.buffer.numberOfChannels - 1))
					const resampled = resampleChannel(source, decodedB.buffer.sampleRate, sampleRate)
					for (let i = 0; i < resampled.length; i++) {
						const target = offsetB + i
						if (target >= totalLength) break
						if (i < overlapSamples) {
							// Equal-power, not linear: two uncorrelated signals summed
							// with a linear crossfade dip by 3dB in the middle, which is
							// audible as a hole right at the join.
							const position = i / overlapSamples
							const fadeIn = Math.sin((position * Math.PI) / 2)
							const fadeOut = Math.cos((position * Math.PI) / 2)
							mix[target] = mix[target] * fadeOut + resampled[i] * fadeIn
						} else {
							mix[target] = resampled[i]
						}
					}
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
			width: dims.width,
			height: dims.height,
			fps,
			durationSeconds: totalDuration,
			sizeInBytes: blob.size,
		}
	} catch (error) {
		if (signal.aborted) throw new TransitionCancelled()
		throw describeRenderFailure(error)
	} finally {
		readerA?.dispose()
		readerB?.dispose()
		if (!handedOver) void sink.discard()
		signal.removeEventListener('abort', onAbort)
		inputA.dispose()
		inputB.dispose()
	}
}

export function transitionFileName(name: string, format: TransitionFormat): string {
	const base = name.replace(/\.[a-z0-9]+$/i, '') || 'video'
	return `${base}-transition.${format}`
}
