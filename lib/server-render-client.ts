'use client'

import type {
	RenderOutput,
	RenderProgress,
	RenderSettings,
	ServerCapabilities,
	ServerRenderDone,
	ServerRenderJob,
	ServerRenderRequest,
	VirtualProject,
} from './types'
import { FORMAT_INFO } from './presets'

export const DEFAULT_CAPABILITIES: ServerCapabilities = {
	enabled: false,
	requiresKey: false,
	provider: 'disabled',
	maxFrames: 1800,
	maxPixels: 8_294_400,
	maxDurationSeconds: 300,
	blobDelivery: false,
	cloudDelivery: false,
	concurrency: 'auto',
}

export async function fetchServerCapabilities(): Promise<ServerCapabilities> {
	try {
		const response = await fetch('/api/render', { method: 'GET', cache: 'no-store' })
		if (!response.ok) return DEFAULT_CAPABILITIES
		return { ...DEFAULT_CAPABILITIES, ...((await response.json()) as Partial<ServerCapabilities>) }
	} catch {
		return DEFAULT_CAPABILITIES
	}
}

type ServerEvent =
	| {
			type: 'progress'
			phase: RenderProgress['phase']
			progress: number
			message?: string
			renderedFrames?: number
			totalFrames?: number
		}
	| { type: 'chunk'; data: string }
	| ServerRenderDone
	| { type: 'error'; message: string }

type DetachedProgress = {
	stage:
		| 'starting'
		| 'opening-browser'
		| 'selecting-composition'
		| 'render-progress'
		| 'uploading'
		| 'done'
		| 'error'
		| 'expired'
	overallProgress?: number
	progress?: {
		renderedFrames: number
		encodedFrames: number
		progress: number
		stitchStage?: 'encoding' | 'muxing'
	}
	url?: string
	size?: number
	contentType?: string
	message?: string
}

const requestHeaders = (accessKey?: string) => ({
	'content-type': 'application/json',
	...(accessKey ? { 'x-render-key': accessKey } : {}),
})

function base64ToUint8(base64: string): Uint8Array {
	const binary = atob(base64)
	const bytes = new Uint8Array(binary.length)
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
	return bytes
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

const abortError = () => new DOMException('The render was cancelled.', 'AbortError')

function waitForNextPoll(milliseconds: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal.aborted) {
			reject(abortError())
			return
		}
		const timer = window.setTimeout(() => {
			signal.removeEventListener('abort', onAbort)
			resolve()
		}, milliseconds)
		const onAbort = () => {
			window.clearTimeout(timer)
			reject(abortError())
		}
		signal.addEventListener('abort', onAbort, { once: true })
	})
}

async function stopDetachedJob(job: ServerRenderJob, accessKey?: string): Promise<void> {
	const timeout = new AbortController()
	const timer = window.setTimeout(() => timeout.abort(), 15_000)
	try {
		await fetch('/api/render/cancel', {
			method: 'POST',
			headers: requestHeaders(accessKey),
			body: JSON.stringify({
				sandboxId: job.sandboxId,
				commandId: job.commandId,
			}),
			keepalive: true,
			signal: timeout.signal,
		}).catch(() => undefined)
	} finally {
		window.clearTimeout(timer)
	}
}

function outputFromDone(args: {
	done: ServerRenderDone
	settings: RenderSettings
	started: number
	chunks?: Uint8Array[]
}): RenderOutput {
	const mimeType = args.done.mimeType || FORMAT_INFO[args.settings.format].mimeType
	let url = args.done.url
	if (!url && args.chunks?.length) {
		url = URL.createObjectURL(
			new Blob(args.chunks as unknown as BlobPart[], { type: mimeType }),
		)
	}
	if (!url) throw new Error('The server completed the render without returning a file.')

	return {
		url,
		fileName: args.done.fileName,
		sizeInBytes: args.done.sizeInBytes,
		mimeType,
		durationMs: performance.now() - args.started,
		engine: 'server',
		width: args.done.width,
		height: args.done.height,
		codec: args.done.codec,
	}
}

function reportDetachedProgress(
	update: DetachedProgress,
	job: ServerRenderJob,
	onProgress: (progress: RenderProgress) => void,
): void {
	const remoteProgress = clamp01(update.overallProgress ?? 0)
	const progress = 0.35 + remoteProgress * 0.63

	if (update.stage === 'uploading') {
		onProgress({ phase: 'uploading', progress, message: 'Uploading the finished video' })
		return
	}
	if (update.stage === 'render-progress') {
		const renderedFrames = update.progress?.renderedFrames ?? 0
		const encodedFrames = update.progress?.encodedFrames ?? 0
		const encoding = renderedFrames >= job.totalFrames || update.progress?.stitchStage === 'muxing'
		onProgress({
			phase: encoding ? 'encoding' : 'rendering',
			progress,
			message: encoding
				? 'Encoding and muxing in Vercel Sandbox'
				: `Rendered ${Math.min(renderedFrames, job.totalFrames)}/${job.totalFrames} frames`,
			renderedFrames: Math.min(renderedFrames, job.totalFrames),
			totalFrames: job.totalFrames,
		})
		return
	}

	onProgress({
		phase: 'preparing',
		progress,
		message:
			update.stage === 'selecting-composition'
				? 'Checking the composition in Vercel Sandbox'
				: update.stage === 'opening-browser'
					? 'Opening the isolated render browser'
					: 'Starting the detached Vercel render',
	})
}

async function pollDetachedJob(args: {
	job: ServerRenderJob
	settings: RenderSettings
	accessKey?: string
	onProgress: (progress: RenderProgress) => void
	signal: AbortSignal
	started: number
}): Promise<RenderOutput> {
	let consecutiveFailures = 0
	try {
		while (true) {
			if (args.signal.aborted) throw abortError()
			const query = new URLSearchParams({
				sandboxId: args.job.sandboxId,
				commandId: args.job.commandId,
			})

			let response: Response
			try {
				response = await fetch(`/api/render/progress?${query}`, {
					method: 'GET',
					headers: args.accessKey ? { 'x-render-key': args.accessKey } : {},
					cache: 'no-store',
					signal: args.signal,
				})
			} catch (error) {
				if (args.signal.aborted) throw abortError()
				consecutiveFailures++
				if (consecutiveFailures >= 4) throw error
				await waitForNextPoll(750 * consecutiveFailures, args.signal)
				continue
			}

			if (!response.ok) {
				const detail = await response.text().catch(() => '')
				if (response.status >= 500 && ++consecutiveFailures < 4) {
					await waitForNextPoll(750 * consecutiveFailures, args.signal)
					continue
				}
				throw new Error(detail || `Could not read render progress (${response.status}).`)
			}
			consecutiveFailures = 0

			const update = (await response.json()) as DetachedProgress
			if (update.stage === 'done') {
				if (!update.url || !Number.isFinite(update.size)) {
					throw new Error('The Vercel render finished without a valid Blob result.')
				}
				return outputFromDone({
					done: {
						type: 'done',
						url: update.url,
						sizeInBytes: update.size as number,
						codec: args.job.codec,
						width: args.job.width,
						height: args.job.height,
						fileName: args.job.fileName,
						mimeType: update.contentType || args.job.mimeType,
					},
					settings: args.settings,
					started: args.started,
				})
			}
			if (update.stage === 'error') {
				throw new Error(update.message || 'The Vercel Sandbox render failed.')
			}
			if (update.stage === 'expired') {
				throw new Error('The Vercel Sandbox expired before the render completed.')
			}

			reportDetachedProgress(update, args.job, args.onProgress)
			await waitForNextPoll(1000, args.signal)
		}
	} finally {
		// Stopping is idempotent. It releases the Sandbox after success or error,
		// and actively cancels Chrome/FFmpeg when the user aborts.
		await stopDetachedJob(args.job, args.accessKey)
	}
}

async function readServerEventStream(args: {
	response: Response
	settings: RenderSettings
	onProgress: (progress: RenderProgress) => void
	started: number
}): Promise<RenderOutput> {
	if (!args.response.body) throw new Error('The server returned an empty render stream.')

	const reader = args.response.body.getReader()
	const decoder = new TextDecoder()
	const chunks: Uint8Array[] = []
	let buffer = ''
	let result: ServerRenderDone | null = null

	while (true) {
		const { value, done } = await reader.read()
		if (done) break
		buffer += decoder.decode(value, { stream: true })

		const lines = buffer.split('\n')
		buffer = lines.pop() ?? ''

		for (const line of lines) {
			const trimmed = line.trim()
			if (!trimmed.startsWith('data:')) continue
			const payload = trimmed.slice(5).trim()
			if (!payload) continue

			const event = JSON.parse(payload) as ServerEvent
			if (event.type === 'progress') {
				args.onProgress({
					phase: event.phase,
					progress: event.progress,
					message: event.message,
					renderedFrames: event.renderedFrames,
					totalFrames: event.totalFrames,
				})
			} else if (event.type === 'chunk') {
				chunks.push(base64ToUint8(event.data))
			} else if (event.type === 'error') {
				throw new Error(event.message)
			} else if (event.type === 'done') {
				result = event
			}
		}
	}

	if (!result) throw new Error('The server closed the connection before the render finished.')
	return outputFromDone({
		done: result,
		settings: args.settings,
		started: args.started,
		chunks,
	})
}

export async function renderOnServer(args: {
	project: VirtualProject
	compositionId: string
	settings: RenderSettings
	fileName: string
	accessKey?: string
	overrides?: { width: number; height: number; fps: number; durationInFrames: number }
	/** leave the finished file in the cloud library instead of streaming it back */
	deliver?: 'stream' | 'cloud'
	onProgress: (progress: RenderProgress) => void
	signal: AbortSignal
}): Promise<RenderOutput> {
	const started = performance.now()
	args.onProgress({
		phase: 'bundling',
		progress: 0.03,
		message: 'Sending the protected project to the render service',
	})

	const response = await fetch('/api/render', {
		method: 'POST',
		headers: requestHeaders(args.accessKey),
		signal: args.signal,
		body: JSON.stringify({
			files: args.project.files,
			entry: args.project.entry,
			compositionId: args.compositionId,
			settings: args.settings,
			overrides: args.overrides,
			fileName: args.fileName,
			deliver: args.deliver ?? 'stream',
		} satisfies ServerRenderRequest),
	})

	if (!response.ok) {
		const detail = await response.text().catch(() => '')
		throw new Error(detail || `Server render failed with status ${response.status}`)
	}

	const contentType = response.headers.get('content-type') ?? ''
	if (contentType.includes('application/json')) {
		const result = (await response.json()) as ServerRenderJob | ServerRenderDone | ServerEvent
		if (result.type === 'error') throw new Error(result.message)
		if (result.type === 'done') {
			return outputFromDone({ done: result, settings: args.settings, started })
		}
		if (result.type !== 'job') throw new Error('The render service returned an invalid job.')
		args.onProgress({
			phase: 'preparing',
			progress: 0.35,
			message: 'Detached Vercel render started',
		})
		return pollDetachedJob({
			job: result,
			settings: args.settings,
			accessKey: args.accessKey,
			onProgress: args.onProgress,
			signal: args.signal,
			started,
		})
	}

	return readServerEventStream({
		response,
		settings: args.settings,
		onProgress: args.onProgress,
		started,
	})
}
