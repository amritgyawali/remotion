import { NextRequest } from 'next/server'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { QUALITY_PRESETS, FORMAT_INFO, evenDimension } from '../../../lib/presets'
import type { OutputFormat, QualityPresetId, RenderSettings, ServerRenderRequest } from '../../../lib/types'
import { validateRenderRequest, writeRenderProject } from '../../../lib/render-request'
import { getRenderAccessKey, hasRenderAccess } from '../../../lib/render-server-auth'
import { cloudEnabled } from '../../../lib/cloud/config'
import { uploadBuffer } from '../../../lib/cloud/cloudinary'
import { resolveIdentity, userIdOf } from '../../../lib/cloud/owner'
import { recordAsset } from '../../../lib/cloud/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const require_ = createRequire(import.meta.url)

const ENABLED = process.env.ENABLE_SERVER_RENDER === '1'
const PROVIDER = process.env.VERCEL ? 'vercel-sandbox' : 'node'
const ACCESS_KEY = getRenderAccessKey()
const SERVER_READY =
	ENABLED &&
	ACCESS_KEY.length > 0 &&
	(!process.env.VERCEL || Boolean(process.env.BLOB_READ_WRITE_TOKEN))
const MAX_FRAMES = Number(process.env.MAX_RENDER_FRAMES ?? 1800)
const MAX_PIXELS = Number(process.env.MAX_RENDER_PIXELS ?? 8_294_400) // 4K
const CHUNK_SIZE = 512 * 1024

function capabilities() {
	return {
		enabled: SERVER_READY,
		requiresKey: SERVER_READY,
		provider: SERVER_READY ? PROVIDER : 'disabled',
		maxFrames: MAX_FRAMES,
		maxPixels: MAX_PIXELS,
		maxDurationSeconds: maxDuration,
		blobDelivery: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
		cloudDelivery: cloudEnabled(),
		concurrency: process.env.REMOTION_CONCURRENCY ?? 'auto',
	}
}

export async function GET() {
	return Response.json(capabilities(), {
		headers: { 'cache-control': 'no-store' },
	})
}

function codecFor(format: OutputFormat): 'h264' | 'vp9' | 'gif' | 'prores' {
	if (format === 'webm') return 'vp9'
	if (format === 'gif') return 'gif'
	if (format === 'prores') return 'prores'
	return 'h264'
}

export async function POST(request: NextRequest) {
	if (!SERVER_READY) {
		return new Response(
			process.env.VERCEL
				? 'Vercel Sandbox rendering requires ENABLE_SERVER_RENDER=1, RENDER_ACCESS_KEY, and a connected Blob store.'
				: 'Server rendering requires ENABLE_SERVER_RENDER=1 and RENDER_ACCESS_KEY.',
			{ status: 503 },
		)
	}
	if (!hasRenderAccess(request)) {
		return new Response('Invalid or missing render key.', { status: 401 })
	}

	let body: ServerRenderRequest
	try {
		body = (await request.json()) as ServerRenderRequest
	} catch {
		return new Response('Malformed JSON body.', { status: 400 })
	}

	if (!Array.isArray(body.files) || body.files.length === 0) {
		return new Response('No files were sent.', { status: 400 })
	}
	try {
		validateRenderRequest(body)
	} catch (error) {
		return new Response(error instanceof Error ? error.message : 'Invalid render request.', {
			status: 400,
		})
	}
	if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(body.compositionId ?? '')) {
		return new Response('Invalid composition id.', { status: 400 })
	}

	const rawSettings = (body.settings ?? {}) as Partial<RenderSettings>
	const preset: QualityPresetId =
		rawSettings.preset && Object.hasOwn(QUALITY_PRESETS, rawSettings.preset)
			? rawSettings.preset
			: 'high'
	const format: OutputFormat =
		rawSettings.format && Object.hasOwn(FORMAT_INFO, rawSettings.format)
			? rawSettings.format
			: 'mp4'
	const scale = rawSettings.scale ?? 1
	if (![0.5, 1, 2].includes(scale)) {
		return new Response('Render scale must be 0.5, 1, or 2.', { status: 400 })
	}
	const previewSeconds = Number.isFinite(rawSettings.previewSeconds)
		? Math.max(0, rawSettings.previewSeconds ?? 0)
		: 0
	const audioEnabled = rawSettings.audioEnabled !== false
	body = {
		...body,
		fileName: path
			.basename(body.fileName || `render.${FORMAT_INFO[format].extension}`)
			.replace(/[^A-Za-z0-9._-]+/g, '-')
			.slice(0, 120),
		settings: {
			engine: 'server',
			preset,
			format,
			scale,
			previewSeconds,
			audioEnabled,
		},
	}

	if (process.env.VERCEL && !body.overrides) {
		return new Response('Vercel Sandbox renders require composition metadata.', { status: 400 })
	}
	if (body.overrides) {
		const metadata = [
			body.overrides.width,
			body.overrides.height,
			body.overrides.fps,
			body.overrides.durationInFrames,
		]
		if (!metadata.every((value) => Number.isFinite(value) && value > 0)) {
			return new Response('Composition dimensions, fps, and duration must be positive numbers.', {
				status: 400,
			})
		}
		if (
			!Number.isInteger(body.overrides.width) ||
			!Number.isInteger(body.overrides.height) ||
			!Number.isInteger(body.overrides.durationInFrames)
		) {
			return new Response('Composition width, height, and duration must be whole numbers.', {
				status: 400,
			})
		}
		const width = evenDimension(body.overrides.width * scale)
		const height = evenDimension(body.overrides.height * scale)
		if (width < 2 || height < 2 || width * height > MAX_PIXELS) {
			return new Response(`Requested ${width}x${height} output exceeds the pixel limit.`, {
				status: 400,
			})
		}
		const requestedFrames =
			previewSeconds > 0
				? Math.min(
						body.overrides.durationInFrames,
						Math.round(previewSeconds * body.overrides.fps),
					)
				: body.overrides.durationInFrames
		if (requestedFrames < 1 || requestedFrames > MAX_FRAMES) {
			return new Response(`Requested ${requestedFrames} frames exceeds the ${MAX_FRAMES}-frame limit.`, {
				status: 400,
			})
		}
	}

	if (process.env.VERCEL) {
		if (!body.overrides) {
			return new Response('Vercel Sandbox renders require composition metadata.', { status: 400 })
		}
		const { renderInVercelSandbox } = await import('../../../lib/vercel-sandbox-render')
		return renderInVercelSandbox({ body: { ...body, overrides: body.overrides } })
	}

	const quality = QUALITY_PRESETS[preset] ?? QUALITY_PRESETS.high
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
				const entryPath = await writeRenderProject(body, projectDir)

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
					process.env.REMOTION_CONCURRENCY &&
					!['max', 'auto'].includes(process.env.REMOTION_CONCURRENCY)
						? Number(process.env.REMOTION_CONCURRENCY)
						: null
				const chromiumOptions = {
					// WebGL (@remotion/three) needs ANGLE. Headless Linux hosts have no
					// graphics stack, so they use ANGLE's SwiftShader backend instead.
					gl: (process.env.REMOTION_GL?.trim() ||
						(os.platform() === 'linux' ? 'swangle' : 'angle')) as 'angle' | 'swangle',
				}

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
					progress('rendering', 0.32, `Rendering ${totalFrames} frames with auto-tuned concurrency`)
					await renderMedia({
						composition: { ...composition, width, height, durationInFrames: totalFrames },
						serveUrl,
						codec: codecFor(format),
						outputLocation: outputPath,
						crf: format === 'gif' || format === 'prores' ? undefined : quality.crf,
						x264Preset: format === 'mp4' ? quality.x264Preset : undefined,
						pixelFormat: format === 'mp4' ? 'yuv420p' : undefined,
						muted: !audioEnabled,
						audioCodec: audioEnabled && format === 'mp4' ? 'aac' : undefined,
						audioBitrate: audioEnabled && format === 'mp4' ? '320k' : undefined,
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

				let publicUrl: string | undefined

				/**
				 * Cloud delivery, when the studio asked for it.
				 *
				 * This is the difference between a render that ends in the browser's
				 * memory and one that ends in a library. The finished file goes
				 * straight from this server's temp directory to Cloudinary, so a
				 * 200 MB export never has to be base64'd through an event stream and
				 * re-assembled by a tab that may not have the headroom for it.
				 */
				if (body.deliver === 'cloud' && cloudEnabled()) {
					try {
						progress('uploading', 0.9, 'Uploading the finished file to your cloud library')
						const identity = await resolveIdentity()
						const resource = await uploadBuffer({
							owner: identity.owner,
							data: await readFile(outputPath),
							fileName,
							resourceType: format === 'png' ? 'image' : 'video',
						})
						publicUrl = resource.secure_url
						await recordAsset({
							owner: identity.owner,
							userId: userIdOf(identity),
							publicId: resource.public_id,
							resourceType: format === 'png' ? 'image' : 'video',
							kind: 'output',
							format: resource.format ?? null,
							bytes: resource.bytes ?? size,
							duration: resource.duration ?? null,
							width: resource.width ?? width,
							height: resource.height ?? height,
							secureUrl: resource.secure_url,
							originalName: fileName,
						})
					} catch (error) {
						// A cloud that refuses the upload must not lose the render: fall
						// through to whichever delivery path would have run anyway.
						progress(
							'uploading',
							0.9,
							`Cloud upload failed (${error instanceof Error ? error.message : 'unknown error'}); delivering the file directly instead`,
						)
						publicUrl = undefined
					}
				}

				// Prefer Vercel Blob when it is configured - it keeps large files out of
				// the response body and gives the user a permanent URL.
				if (!publicUrl && process.env.BLOB_READ_WRITE_TOKEN) {
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
