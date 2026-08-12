'use client'

/**
 * Free, unlimited, zero-server rendering.
 *
 * Visual-only compositions keep the broad-CSS Thumbnail -> html-to-image path.
 * Compositions importing @remotion/media use Remotion's web renderer so music,
 * SFX and video audio are mixed and muxed into the output. Both paths encode
 * frame-accurately with WebCodecs rather than recording wall-clock playback.
 */

import { computeBitrate, evenDimension, h264CodecString, QUALITY_PRESETS } from './presets'
import type { CompiledComposition, RenderOutput, RenderProgress, RenderSettings } from './types'

export type BrowserRenderArgs = {
	composition: CompiledComposition
	settings: RenderSettings
	css?: string
	fileName: string
	onProgress: (progress: RenderProgress) => void
	signal: AbortSignal
}

export class RenderCancelled extends Error {
	constructor() {
		super('Render cancelled')
		this.name = 'RenderCancelled'
	}
}

export function isWebCodecsSupported(): boolean {
	return typeof window !== 'undefined' && typeof window.VideoEncoder === 'function'
}

function nextPaint(): Promise<void> {
	return new Promise((resolve) => {
		requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
	})
}

function wait(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

function assertLive(signal: AbortSignal): void {
	if (signal.aborted) throw new RenderCancelled()
}

function ensureExtension(fileName: string, extension: string): string {
	return fileName.toLowerCase().endsWith(`.${extension.toLowerCase()}`)
		? fileName
		: `${fileName}.${extension}`
}

type EncoderChoice = {
	config: VideoEncoderConfig
	container: 'mp4' | 'webm'
	muxerCodec: 'avc' | 'vp9' | 'vp8'
	label: string
}

async function pickEncoderConfig(
	width: number,
	height: number,
	fps: number,
	bitrate: number,
	format: 'mp4' | 'webm',
): Promise<EncoderChoice> {
	const base = {
		width,
		height,
		bitrate,
		framerate: fps,
		latencyMode: 'quality' as const,
	}

	const candidates: EncoderChoice[] =
		format === 'webm'
			? [
					{
						label: 'VP9',
						container: 'webm',
						muxerCodec: 'vp9',
						config: { ...base, codec: 'vp09.00.51.08' },
					},
					{ label: 'VP8', container: 'webm', muxerCodec: 'vp8', config: { ...base, codec: 'vp8' } },
				]
			: [
					{
						label: 'H.264 High',
						container: 'mp4',
						muxerCodec: 'avc',
						config: {
							...base,
							codec: h264CodecString(width, height, fps),
							avc: { format: 'avc' as const },
							hardwareAcceleration: 'prefer-hardware' as const,
						},
					},
					{
						label: 'H.264 High (software)',
						container: 'mp4',
						muxerCodec: 'avc',
						config: {
							...base,
							codec: h264CodecString(width, height, fps),
							avc: { format: 'avc' as const },
						},
					},
					{
						label: 'H.264 Main',
						container: 'mp4',
						muxerCodec: 'avc',
						config: { ...base, codec: 'avc1.4d0034', avc: { format: 'avc' as const } },
					},
					{
						label: 'VP9 in MP4',
						container: 'mp4',
						muxerCodec: 'vp9',
						config: { ...base, codec: 'vp09.00.51.08' },
					},
				]

	for (const candidate of candidates) {
		try {
			const support = await VideoEncoder.isConfigSupported(candidate.config)
			if (support.supported) {
				return { ...candidate, config: (support.config ?? candidate.config) as VideoEncoderConfig }
			}
		} catch {
			/* try the next candidate */
		}
	}

	throw new Error(
		`This browser cannot encode ${width}x${height} video. Try a 1x scale, or switch to the server renderer.`,
	)
}

type Stage = {
	host: HTMLDivElement
	setFrame: (frame: number) => void
	dispose: () => void
}

async function mountStage(
	composition: CompiledComposition,
	css: string | undefined,
): Promise<Stage> {
	const [{ createRoot }, { flushSync }, { Thumbnail }, React] = await Promise.all([
		import('react-dom/client'),
		import('react-dom'),
		import('@remotion/player'),
		import('react'),
	])

	const wrapper = document.createElement('div')
	wrapper.setAttribute('data-render-stage', '')
	Object.assign(wrapper.style, {
		position: 'fixed',
		top: '0px',
		left: '-200000px',
		width: `${composition.width}px`,
		height: `${composition.height}px`,
		pointerEvents: 'none',
		zIndex: '-1',
		backgroundColor: '#000000',
		overflow: 'hidden',
	} satisfies Partial<CSSStyleDeclaration>)

	if (css) {
		const style = document.createElement('style')
		style.textContent = css
		wrapper.appendChild(style)
	}

	const mount = document.createElement('div')
	mount.style.width = `${composition.width}px`
	mount.style.height = `${composition.height}px`
	wrapper.appendChild(mount)
	document.body.appendChild(wrapper)

	const root = createRoot(mount)

	const setFrame = (frame: number) => {
		flushSync(() => {
			root.render(
				React.createElement(Thumbnail, {
					component: composition.component,
					compositionWidth: composition.width,
					compositionHeight: composition.height,
					durationInFrames: Math.max(1, composition.durationInFrames),
					fps: composition.fps,
					frameToDisplay: Math.min(frame, Math.max(0, composition.durationInFrames - 1)),
					inputProps: composition.defaultProps ?? {},
					style: { width: composition.width, height: composition.height },
					errorFallback: () => null,
				}),
			)
		})
	}

	return {
		host: mount,
		setFrame,
		dispose: () => {
			try {
				root.unmount()
			} catch {
				/* already gone */
			}
			wrapper.remove()
		},
	}
}

async function settle(host: HTMLElement): Promise<void> {
	await nextPaint()
	const images = Array.from(host.querySelectorAll('img'))
	if (images.length > 0) {
		await Promise.all(
			images.map((image) => (image.decode ? image.decode().catch(() => undefined) : undefined)),
		)
	}
}

/** Renders a single frame as a full resolution PNG. */
export async function renderStillInBrowser(args: BrowserRenderArgs): Promise<RenderOutput> {
	const { composition, settings, css, signal, onProgress } = args
	const started = performance.now()
	const width = evenDimension(composition.width * settings.scale)
	const height = evenDimension(composition.height * settings.scale)
	const frame = Math.min(
		Math.max(0, Math.round(settings.previewSeconds * composition.fps)),
		composition.durationInFrames - 1,
	)

	onProgress({ phase: 'preparing', progress: 0, message: 'Mounting composition' })
	const stage = await mountStage(composition, css)
	try {
		const { toCanvas } = await import('html-to-image')
		stage.setFrame(frame)
		await document.fonts.ready
		await settle(stage.host)
		await wait(120)
		assertLive(signal)

		onProgress({ phase: 'encoding', progress: 0.6, message: 'Rasterising frame' })
		const canvas = await toCanvas(stage.host, {
			width: composition.width,
			height: composition.height,
			canvasWidth: width,
			canvasHeight: height,
			pixelRatio: 1,
			cacheBust: false,
		} as Parameters<typeof toCanvas>[1])

		const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
		if (!blob) throw new Error('The browser could not export the frame as PNG.')

		onProgress({ phase: 'done', progress: 1 })
		return {
			url: URL.createObjectURL(blob),
			fileName: ensureExtension(args.fileName, 'png'),
			sizeInBytes: blob.size,
			mimeType: 'image/png',
			durationMs: performance.now() - started,
			engine: 'browser',
			width,
			height,
			codec: 'PNG',
		}
	} finally {
		stage.dispose()
	}
}

async function renderMediaWithSound(args: BrowserRenderArgs): Promise<RenderOutput> {
	const { composition, settings, css, signal, onProgress } = args

	if (settings.format === 'png') return renderStillInBrowser(args)
	if (!isWebCodecsSupported()) {
		throw new Error(
			'This browser has no WebCodecs support. Use Chrome, Edge, Safari 17+ or Firefox 130+, or switch to the server renderer.',
		)
	}

	const container: 'mp4' | 'webm' = settings.format === 'webm' ? 'webm' : 'mp4'
	const preset = QUALITY_PRESETS[settings.preset]
	const started = performance.now()

	const width = evenDimension(composition.width * settings.scale)
	const height = evenDimension(composition.height * settings.scale)
	const fps = composition.fps
	const totalFrames = Math.max(
		1,
		settings.previewSeconds > 0
			? Math.min(composition.durationInFrames, Math.round(settings.previewSeconds * fps))
			: composition.durationInFrames,
	)
	const bitrate = computeBitrate(width, height, fps, settings.preset)
	const audioBitrate = settings.preset === 'draft' ? 128_000 : settings.preset === 'max' ? 320_000 : 256_000
	const style = css ? document.createElement('style') : null
	if (style) {
		style.setAttribute('data-browser-render-css', '')
		style.textContent = css ?? ''
		document.head.appendChild(style)
	}

	onProgress({ phase: 'preparing', progress: 0, message: 'Checking video and audio codecs', totalFrames })
	try {
		const {
			canRenderMediaOnWeb,
			getEncodableAudioCodecs,
			getEncodableVideoCodecs,
			renderMediaOnWeb,
		} = await import('@remotion/web-renderer')
		const [videoCodecs, audioCodecs] = await Promise.all([
			getEncodableVideoCodecs(container, { videoBitrate: bitrate }),
			getEncodableAudioCodecs(container, { audioBitrate }),
		])
		const videoCodec =
			container === 'webm'
				? videoCodecs.includes('vp9')
					? 'vp9'
					: videoCodecs.includes('vp8')
						? 'vp8'
						: null
				: videoCodecs.includes('h264')
					? 'h264'
					: null
		const audioCodec =
			container === 'webm'
				? audioCodecs.includes('opus')
					? 'opus'
					: null
				: audioCodecs.includes('aac')
					? 'aac'
					: null

		if (!videoCodec || !audioCodec) {
			throw new Error(
				`This browser cannot encode ${container.toUpperCase()} video with sound. Try Chrome or Edge, choose another format, or switch to the server renderer.`,
			)
		}

		const capability = await canRenderMediaOnWeb({
			container,
			videoCodec,
			audioCodec,
			width,
			height,
			videoBitrate: bitrate,
			audioBitrate,
		})
		if (!capability.canRender) {
			const reason = capability.issues
				.filter((issue) => issue.severity === 'error')
				.map((issue) => issue.message)
				.join(' ')
			throw new Error(reason || 'This browser cannot render the selected video settings.')
		}

		const result = await renderMediaOnWeb({
			composition: {
				id: composition.id,
				component: composition.component,
				durationInFrames: composition.durationInFrames,
				fps,
				width: composition.width,
				height: composition.height,
				defaultProps: composition.defaultProps ?? {},
			},
			inputProps: composition.defaultProps ?? {},
			container,
			videoCodec,
			audioCodec,
			videoBitrate: bitrate,
			audioBitrate,
			frameRange: totalFrames < composition.durationInFrames ? [0, totalFrames - 1] : null,
			scale: settings.scale,
			hardwareAcceleration: 'prefer-hardware',
			keyframeIntervalInSeconds: preset.keyframeIntervalSeconds,
			pageResponsiveness: 'medium',
			outputTarget: 'arraybuffer',
			licenseKey: process.env.NEXT_PUBLIC_REMOTION_LICENSE_KEY?.trim() || 'free-license',
			signal,
			logLevel: 'warn',
			onProgress: ({ encodedFrames, progress, renderEstimatedTime }) => {
				const elapsed = (performance.now() - started) / 1000
				const renderedFrames = Math.min(totalFrames, encodedFrames)
				onProgress({
					phase: progress >= 0.98 ? 'encoding' : 'rendering',
					progress,
					renderedFrames,
					totalFrames,
					framesPerSecond: renderedFrames / Math.max(elapsed, 0.001),
					etaSeconds: Math.max(0, renderEstimatedTime / 1000),
					message: `${videoCodec.toUpperCase()} + ${audioCodec.toUpperCase()} - ${renderedFrames}/${totalFrames} frames`,
				})
			},
		})
		assertLive(signal)
		const blob = await result.getBlob()
		const mimeType = container === 'webm' ? 'video/webm' : 'video/mp4'

		onProgress({ phase: 'done', progress: 1, totalFrames, renderedFrames: totalFrames })

		return {
			url: URL.createObjectURL(blob),
			fileName: ensureExtension(args.fileName, container),
			sizeInBytes: blob.size,
			mimeType,
			durationMs: performance.now() - started,
			engine: 'browser',
			width,
			height,
			codec: `${videoCodec.toUpperCase()} + ${audioCodec.toUpperCase()}`,
		}
	} catch (error) {
		if (signal.aborted) throw new RenderCancelled()
		throw error
	} finally {
		style?.remove()
	}
}

/**
 * Keeps the original DOM-screenshot renderer for visual-only compositions.
 * It supports a wider range of browser CSS than @remotion/web-renderer's DOM
 * compositor, but deliberately has no audio track.
 */
async function renderVisualOnly(args: BrowserRenderArgs): Promise<RenderOutput> {
	const { composition, settings, css, signal, onProgress } = args
	const format: 'mp4' | 'webm' = settings.format === 'webm' ? 'webm' : 'mp4'
	const preset = QUALITY_PRESETS[settings.preset]
	const started = performance.now()

	const width = evenDimension(composition.width * settings.scale)
	const height = evenDimension(composition.height * settings.scale)
	const fps = composition.fps
	const totalFrames = Math.max(
		1,
		settings.previewSeconds > 0
			? Math.min(composition.durationInFrames, Math.round(settings.previewSeconds * fps))
			: composition.durationInFrames,
	)
	const bitrate = computeBitrate(width, height, fps, settings.preset)
	const keyFrameInterval = Math.max(1, Math.round(fps * preset.keyframeIntervalSeconds))

	onProgress({ phase: 'preparing', progress: 0, message: 'Configuring encoder', totalFrames })
	const choice = await pickEncoderConfig(width, height, fps, bitrate, format)

	const [{ Muxer: Mp4Muxer, ArrayBufferTarget: Mp4Target }, webmModule] = await Promise.all([
		import('mp4-muxer'),
		choice.container === 'webm' ? import('webm-muxer') : Promise.resolve(null),
	])

	type MuxerLike = {
		addVideoChunk: (chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata) => void
		finalize: () => void
	}

	const target =
		choice.container === 'webm' && webmModule
			? new webmModule.ArrayBufferTarget()
			: new Mp4Target()

	const muxer: MuxerLike =
		choice.container === 'webm' && webmModule
			? new webmModule.Muxer({
					target: target as InstanceType<typeof webmModule.ArrayBufferTarget>,
					video: {
						codec: choice.muxerCodec === 'vp8' ? 'V_VP8' : 'V_VP9',
						width,
						height,
						frameRate: fps,
					},
				})
			: new Mp4Muxer({
					target: target as InstanceType<typeof Mp4Target>,
					video: { codec: choice.muxerCodec === 'vp9' ? 'vp9' : 'avc', width, height, frameRate: fps },
					fastStart: 'in-memory',
				})

	let encoderError: Error | null = null
	const encoder = new VideoEncoder({
		output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
		error: (error) => {
			encoderError = error instanceof Error ? error : new Error(String(error))
		},
	})
	encoder.configure(choice.config)

	const stage = await mountStage(composition, css)

	try {
		const { toCanvas, getFontEmbedCSS } = await import('html-to-image')

		stage.setFrame(0)
		await document.fonts.ready
		await settle(stage.host)
		await wait(150)

		let fontEmbedCSS = ''
		try {
			fontEmbedCSS = await getFontEmbedCSS(stage.host)
		} catch {
			fontEmbedCSS = ''
		}

		const rasterOptions = {
			width: composition.width,
			height: composition.height,
			canvasWidth: width,
			canvasHeight: height,
			pixelRatio: 1,
			cacheBust: false,
			fontEmbedCSS,
			skipFonts: fontEmbedCSS === '',
		} as Parameters<typeof toCanvas>[1]

		const frameDuration = Math.round(1_000_000 / fps)
		let lastReport = 0

		for (let frame = 0; frame < totalFrames; frame++) {
			assertLive(signal)
			if (encoderError) throw encoderError

			stage.setFrame(frame)
			await settle(stage.host)

			const canvas = await toCanvas(stage.host, rasterOptions)
			const videoFrame = new VideoFrame(canvas, {
				timestamp: Math.round((frame * 1_000_000) / fps),
				duration: frameDuration,
			})

			encoder.encode(videoFrame, { keyFrame: frame % keyFrameInterval === 0 })
			videoFrame.close()

			while (encoder.encodeQueueSize > 8) {
				assertLive(signal)
				await wait(4)
			}

			const now = performance.now()
			if (now - lastReport > 120 || frame === totalFrames - 1) {
				lastReport = now
				const elapsed = (now - started) / 1000
				const framesPerSecond = (frame + 1) / Math.max(elapsed, 0.001)
				onProgress({
					phase: 'rendering',
					progress: (frame + 1) / totalFrames,
					renderedFrames: frame + 1,
					totalFrames,
					framesPerSecond,
					etaSeconds: (totalFrames - frame - 1) / Math.max(framesPerSecond, 0.001),
					message: `${choice.label} - frame ${frame + 1} of ${totalFrames}`,
				})
			}
		}

		onProgress({ phase: 'encoding', progress: 0.99, message: 'Finalising container', totalFrames })
		await encoder.flush()
		if (encoderError) throw encoderError
		muxer.finalize()

		const buffer = (target as { buffer: ArrayBuffer }).buffer
		const mimeType = choice.container === 'webm' ? 'video/webm' : 'video/mp4'
		const blob = new Blob([buffer], { type: mimeType })

		onProgress({ phase: 'done', progress: 1, totalFrames, renderedFrames: totalFrames })

		return {
			url: URL.createObjectURL(blob),
			fileName: ensureExtension(args.fileName, choice.container),
			sizeInBytes: blob.size,
			mimeType,
			durationMs: performance.now() - started,
			engine: 'browser',
			width,
			height,
			codec: choice.label,
		}
	} finally {
		stage.dispose()
		if (encoder.state !== 'closed') {
			try {
				encoder.close()
			} catch {
				/* already closed */
			}
		}
	}
}

export async function renderInBrowser(args: BrowserRenderArgs): Promise<RenderOutput> {
	if (args.settings.format === 'png') return renderStillInBrowser(args)
	if (!isWebCodecsSupported()) {
		throw new Error(
			'This browser has no WebCodecs support. Use Chrome, Edge, Safari 17+ or Firefox 130+, or switch to the server renderer.',
		)
	}

	return args.composition.usesWebMedia
		? renderMediaWithSound(args)
		: renderVisualOnly(args)
}
