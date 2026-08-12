'use client'

import type {
	RenderOutput,
	RenderProgress,
	RenderSettings,
	ServerCapabilities,
	VirtualProject,
} from './types'
import { FORMAT_INFO } from './presets'

export const DEFAULT_CAPABILITIES: ServerCapabilities = {
	enabled: false,
	requiresKey: false,
	maxFrames: 1800,
	maxPixels: 8_294_400,
	maxDurationSeconds: 300,
	blobDelivery: false,
	concurrency: 'max',
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
	| { type: 'progress'; phase: RenderProgress['phase']; progress: number; message?: string; renderedFrames?: number; totalFrames?: number }
	| { type: 'chunk'; data: string }
	| { type: 'done'; url?: string; sizeInBytes: number; codec: string; width: number; height: number; fileName: string; mimeType: string }
	| { type: 'error'; message: string }

function base64ToUint8(base64: string): Uint8Array {
	const binary = atob(base64)
	const bytes = new Uint8Array(binary.length)
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
	return bytes
}

export async function renderOnServer(args: {
	project: VirtualProject
	compositionId: string
	settings: RenderSettings
	fileName: string
	accessKey?: string
	overrides?: { width: number; height: number; fps: number; durationInFrames: number }
	onProgress: (progress: RenderProgress) => void
	signal: AbortSignal
}): Promise<RenderOutput> {
	const started = performance.now()

	const response = await fetch('/api/render', {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			...(args.accessKey ? { 'x-render-key': args.accessKey } : {}),
		},
		signal: args.signal,
		body: JSON.stringify({
			files: args.project.files,
			entry: args.project.entry,
			compositionId: args.compositionId,
			settings: args.settings,
			overrides: args.overrides,
			fileName: args.fileName,
		}),
	})

	if (!response.ok || !response.body) {
		const detail = await response.text().catch(() => '')
		throw new Error(detail || `Server render failed with status ${response.status}`)
	}

	const reader = response.body.getReader()
	const decoder = new TextDecoder()
	const chunks: Uint8Array[] = []
	let buffer = ''
	let result: Extract<ServerEvent, { type: 'done' }> | null = null

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

	const mimeType = result.mimeType || FORMAT_INFO[args.settings.format].mimeType
	const url =
		result.url ??
		URL.createObjectURL(new Blob(chunks as unknown as BlobPart[], { type: mimeType }))

	return {
		url,
		fileName: result.fileName,
		sizeInBytes: result.sizeInBytes,
		mimeType,
		durationMs: performance.now() - started,
		engine: 'server',
		width: result.width,
		height: result.height,
		codec: result.codec,
	}
}
