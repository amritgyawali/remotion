import { NextRequest } from 'next/server'
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { QUALITY_PRESETS, FORMAT_INFO, evenDimension } from '../../../lib/presets'
import type { OutputFormat, QualityPresetId, RenderSettings, SourceFile } from '../../../lib/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const require_ = createRequire(import.meta.url)

const ENABLED = process.env.ENABLE_SERVER_RENDER === '1'
const ACCESS_KEY = process.env.RENDER_ACCESS_KEY ?? ''
const MAX_FRAMES = Number(process.env.MAX_RENDER_FRAMES ?? 1800)
const MAX_PIXELS = Number(process.env.MAX_RENDER_PIXELS ?? 8_294_400) // 4K
const CHUNK_SIZE = 512 * 1024

function capabilities() {
	return {
		enabled: ENABLED,
		requiresKey: ENABLED && ACCESS_KEY.length > 0,
		maxFrames: MAX_FRAMES,
		maxPixels: MAX_PIXELS,
		maxDurationSeconds: maxDuration,
		blobDelivery: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
		concurrency: process.env.REMOTION_CONCURRENCY ?? 'max',
	}
}

export async function GET() {
	return Response.json(capabilities(), {
		headers: { 'cache-control': 'no-store' },
	})
}

/** Blocks `../` escapes and absolute paths before anything touches the disk. */
function sanitizeRelativePath(input: string): string {
	const normalized = path.posix.normalize(input.replace(/\\/g, '/'))
	if (
		normalized.startsWith('/') ||
		normalized.startsWith('..') ||
		normalized.includes('\0') ||
		path.posix.isAbsolute(normalized)
	) {
		throw new Error(`Refusing to write outside the project: ${input}`)
	}
	return normalized
}

type RenderRequest = {
	files: SourceFile[]
	entry: string
	compositionId: string
	settings: RenderSettings
	fileName: string
	overrides?: { width: number; height: number; fps: number; durationInFrames: number }
}

function codecFor(format: OutputFormat): 'h264' | 'vp9' | 'gif' | 'prores' {
	if (format === 'webm') return 'vp9'
	if (format === 'gif') return 'gif'
	if (format === 'prores') return 'prores'
	return 'h264'
}

export async function POST(request: NextRequest) {
	if (!ENABLED) {
		return new Response(
			'Server rendering is disabled. Set ENABLE_SERVER_RENDER=1 in your environment to switch it on.',
			{ status: 503 },
		)
	}
	if (ACCESS_KEY && request.headers.get('x-render-key') !== ACCESS_KEY) {
		return new Response('Invalid or missing render key.', { status: 401 })
	}

	let body: RenderRequest
	try {
		body = (await request.json()) as RenderRequest
	} catch {
		return new Response('Malformed JSON body.', { status: 400 })
	}

	if (!Array.isArray(body.files) || body.files.length === 0) {
		return new Response('No files were sent.', { status: 400 })
	}

	const preset: QualityPresetId = body.settings?.preset ?? 'high'
	const quality = QUALITY_PRESETS[preset] ?? QUALITY_PRESETS.high
	const format: OutputFormat = body.settings?.format ?? 'mp4'
	const scale = body.settings?.scale ?? 1
	const encoder = new TextEncoder()

	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			let workDir: string | null = null
			let closed = false

			const send = (payload: Record<string, unknown>) => {
				if (closed) return
				controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
			}
			const progress = (
				phase: string,
				value: number,
				message?: string,
				extra?: Record<string, unknown>,
			) => send({ type: 'progress', phase, progress: value, message, ...extra })

			try {
				progress('preparing', 0.02, 'Writing your project to a temporary folder')

				workDir = await mkdtemp(path.join(os.tmpdir(), 'rvs-'))
				const projectDir = path.join(workDir, 'project')
				await mkdir(projectDir, { recursive: true })

				for (const file of body.files) {
					const relative = sanitizeRelativePath(file.path)
					const target = path.join(projectDir, relative)
					await mkdir(path.dirname(target), { recursive: true })
					await writeFile(target, file.contents, 'utf8')
				}

				// Remotion needs an entry that calls registerRoot(). Single-component
				// uploads usually do not, so synthesise one next to the upload.
				const entryRelative = sanitizeRelativePath(body.entry)
				const entrySource = body.files.find((file) => sanitizeRelativePath(file.path) === entryRelative)
				let entryPath = path.join(projectDir, entryRelative)

				if (entrySource && !/registerRoot\s*\(/.test(entrySource.contents)) {
					const importSpecifier = `./${entryRelative.replace(/\.(tsx|ts|jsx|js|mjs|cjs)$/i, '')}`
					const meta = body.overrides ?? {
						width: 1080,
						height: 1920,
						fps: 30,
						durationInFrames: 300,
					}
					const generated = [
						`import React from 'react';`,
						`import { Composition, registerRoot } from 'remotion';`,
						`import * as Entry from '${importSpecifier}';`,
						`const Component = (Entry.default ?? Object.values(Entry).find((value) => typeof value === 'function'));`,
						`const Root = () => React.createElement(Composition, {`,
						`  id: ${JSON.stringify(body.compositionId || 'Main')},`,
						`  component: Component,`,
						`  width: ${meta.width}, height: ${meta.height}, fps: ${meta.fps},`,
						`  durationInFrames: ${meta.durationInFrames},`,
						`});`,
						`registerRoot(Root);`,
						``,
					].join('\n')
					entryPath = path.join(projectDir, '__studio-entry.tsx')
					await writeFile(entryPath, generated, 'utf8')
				}

				progress('bundling', 0.08, 'Bundling with webpack (first run takes the longest)')

				const { bundle } = await import('@remotion/bundler')
				const {
					selectComposition,
					renderMedia,
					renderStill,
					ensureBrowser,
				} = await import('@remotion/renderer')

				const remotionRoot = path.dirname(require_.resolve('remotion/package.json'))

				const serveUrl = await bundle({
					entryPoint: entryPath,
					// Uploaded code may use the studio's built-in, copyright-safe asset kit.
					publicDir: path.join(process.cwd(), 'public'),
					onProgress: (percent: number) =>
						progress('bundling', 0.08 + (percent / 100) * 0.17, `Bundling ${percent}%`),
					webpackOverride: (config) => ({
						...config,
						resolve: {
							...config.resolve,
							modules: [
								...(config.resolve?.modules ?? ['node_modules']),
								path.join(process.cwd(), 'node_modules'),
								path.join(remotionRoot, '..'),
							],
						},
					}),
				})

				progress('preparing', 0.27, 'Starting headless Chrome')
				await ensureBrowser({ logLevel: 'error' })

				const composition = await selectComposition({
					serveUrl,
					id: body.compositionId,
					inputProps: {},
				})

				const width = evenDimension(composition.width * scale)
				const height = evenDimension(composition.height * scale)
				if (width * height > MAX_PIXELS) {
					throw new Error(
						`${width}x${height} exceeds the server limit of ${MAX_PIXELS.toLocaleString()} pixels. Lower the scale or raise MAX_RENDER_PIXELS.`,
					)
				}

				const previewFrames =
					body.settings?.previewSeconds && body.settings.previewSeconds > 0
						? Math.min(
								composition.durationInFrames,
								Math.round(body.settings.previewSeconds * composition.fps),
							)
						: composition.durationInFrames
				const totalFrames = Math.min(previewFrames, MAX_FRAMES)
				if (totalFrames < composition.durationInFrames) {
					progress(
						'preparing',
						0.29,
						`Rendering the first ${totalFrames} of ${composition.durationInFrames} frames`,
					)
				}

				const extension = FORMAT_INFO[format].extension
				const outputPath = path.join(workDir, `out.${extension}`)
				const concurrency =
					process.env.REMOTION_CONCURRENCY && process.env.REMOTION_CONCURRENCY !== 'max'
						? Number(process.env.REMOTION_CONCURRENCY)
						: null
				const chromiumOptions = { gl: (process.env.REMOTION_GL ?? 'swangle') as 'swangle' }

				if (format === 'png') {
					progress('rendering', 0.35, 'Rendering a still at full resolution')
					await renderStill({
						composition: { ...composition, width, height },
						serveUrl,
						output: outputPath,
						imageFormat: 'png',
						frame: 0,
						chromiumOptions,
						scale: 1,
						logLevel: 'error',
					})
				} else {
					progress('rendering', 0.32, `Rendering ${totalFrames} frames with every available core`)
					await renderMedia({
						composition: { ...composition, width, height, durationInFrames: totalFrames },
						serveUrl,
						codec: codecFor(format),
						outputLocation: outputPath,
						crf: format === 'gif' || format === 'prores' ? undefined : quality.crf,
						x264Preset: format === 'mp4' ? quality.x264Preset : undefined,
						pixelFormat: format === 'mp4' ? 'yuv420p' : undefined,
						audioCodec: format === 'mp4' ? 'aac' : undefined,
						audioBitrate: format === 'mp4' ? '320k' : undefined,
						imageFormat: quality.imageFormat,
						jpegQuality: quality.imageFormat === 'jpeg' ? quality.jpegQuality : undefined,
						proResProfile: format === 'prores' ? '4444' : undefined,
						everyNthFrame: format === 'gif' ? 2 : undefined,
						numberOfGifLoops: format === 'gif' ? 0 : undefined,
						concurrency,
						chromiumOptions,
						hardwareAcceleration: 'if-possible',
						offthreadVideoCacheSizeInBytes: 512 * 1024 * 1024,
						timeoutInMilliseconds: 120_000,
						logLevel: 'error',
						onProgress: ({ renderedFrames, encodedFrames }) => {
							const ratio = renderedFrames / Math.max(1, totalFrames)
							progress(
								encodedFrames >= totalFrames ? 'encoding' : 'rendering',
								0.35 + ratio * 0.5,
								`Rendered ${renderedFrames}/${totalFrames} frames`,
								{ renderedFrames, totalFrames },
							)
						},
					})
				}

				const { size } = await stat(outputPath)
				const fileName = body.fileName || `render.${extension}`
				const mimeType = FORMAT_INFO[format].mimeType

				// Prefer Vercel Blob when it is configured - it keeps large files out of
				// the response body and gives the user a permanent URL.
				let publicUrl: string | undefined
				if (process.env.BLOB_READ_WRITE_TOKEN) {
					try {
						progress('uploading', 0.9, 'Uploading to Vercel Blob')
						const { put } = (await import('@vercel/blob')) as typeof import('@vercel/blob')
						const uploaded = await put(`renders/${Date.now()}-${fileName}`, await readFile(outputPath), {
							access: 'public',
							contentType: mimeType,
						})
						publicUrl = uploaded.url
					} catch {
						publicUrl = undefined
					}
				}

				if (!publicUrl) {
					progress('uploading', 0.9, 'Streaming the file back to your browser')
					const buffer = await readFile(outputPath)
					for (let offset = 0; offset < buffer.length; offset += CHUNK_SIZE) {
						const slice = buffer.subarray(offset, Math.min(offset + CHUNK_SIZE, buffer.length))
						send({ type: 'chunk', data: slice.toString('base64') })
					}
				}

				send({
					type: 'done',
					url: publicUrl,
					sizeInBytes: size,
					codec: codecFor(format),
					width,
					height,
					fileName,
					mimeType,
				})
			} catch (error) {
				send({
					type: 'error',
					message: error instanceof Error ? error.message : 'Unknown server render error',
				})
			} finally {
				if (workDir) await rm(workDir, { recursive: true, force: true }).catch(() => undefined)
				closed = true
				controller.close()
			}
		},
	})

	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream; charset=utf-8',
			'cache-control': 'no-cache, no-transform',
			connection: 'keep-alive',
		},
	})
}
