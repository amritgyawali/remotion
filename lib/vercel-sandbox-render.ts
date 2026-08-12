import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import type { Sandbox } from '@vercel/sandbox'
import { evenDimension, FORMAT_INFO, QUALITY_PRESETS } from './presets'
import { writeRenderProject } from './render-request'
import { isValidVercelJobId } from './render-server-auth'
import type {
	OutputFormat,
	QualityPresetId,
	RenderOverrides,
	ServerRenderDone,
	ServerRenderJob,
	ServerRenderRequest,
} from './types'

type SandboxRenderArgs = {
	body: ServerRenderRequest & { overrides: RenderOverrides }
}

type CompositionMetadata = RenderOverrides

const require_ = createRequire(import.meta.url)

const positiveEnvironmentNumber = (name: string, fallback: number): number => {
	const parsed = Number(process.env[name])
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const sandboxVcpus = () => Math.max(1, Math.floor(positiveEnvironmentNumber('VERCEL_SANDBOX_VCPUS', 4)))
const sandboxTimeout = () =>
	Math.max(5 * 60 * 1000, positiveEnvironmentNumber('VERCEL_SANDBOX_TIMEOUT_MS', 45 * 60 * 1000))

/**
 * Vercel Sandbox is a GPU-less Linux VM, so WebGL has to go through ANGLE's
 * SwiftShader backend. Plain `angle` finds no graphics stack there and would
 * hand @remotion/three an empty canvas.
 */
const sandboxOpenGlRenderer = (): 'swangle' | 'angle' | 'swiftshader' | 'egl' | 'vulkan' => {
	const configured = process.env.REMOTION_GL?.trim()
	if (configured === 'angle' || configured === 'swiftshader' || configured === 'egl' || configured === 'vulkan') {
		return configured
	}
	return 'swangle'
}

const codecFor = (format: OutputFormat): 'h264' | 'vp9' | 'gif' | 'prores' => {
	if (format === 'webm') return 'vp9'
	if (format === 'gif') return 'gif'
	if (format === 'prores') return 'prores'
	return 'h264'
}

const configuredConcurrency = (): number | null => {
	const value = process.env.REMOTION_CONCURRENCY
	if (!value || value === 'auto' || value === 'max') return null
	const parsed = Number(value)
	return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null
}

async function createOrRestoreSandbox(): Promise<Sandbox> {
	const { Sandbox: VercelSandbox } = await import('@vercel/sandbox')
	const snapshotId = process.env.VERCEL_SANDBOX_SNAPSHOT_ID?.trim()
	if (snapshotId) {
		return VercelSandbox.create({
			source: { type: 'snapshot', snapshotId },
			resources: { vcpus: sandboxVcpus() },
			timeout: sandboxTimeout(),
		})
	}

	const { createSandbox } = await import('@remotion/vercel')
	return createSandbox({
		resources: { vcpus: sandboxVcpus() },
		timeoutInMilliseconds: sandboxTimeout(),
	})
}

/**
 * Select the composition inside the isolated VM before starting a paid detached
 * render. This makes the server-side safety limits authoritative instead of
 * trusting metadata supplied by the browser.
 */
async function inspectComposition(
	sandbox: Sandbox,
	compositionId: string,
): Promise<CompositionMetadata> {
	const scriptPath = '/tmp/inspect-composition.mjs'
	const resultPath = '/tmp/composition-metadata.json'
	const gl = sandboxOpenGlRenderer()
	await sandbox.writeFiles([
		{
			path: scriptPath,
			content: Buffer.from([
				`import {writeFile} from 'node:fs/promises';`,
				`import {selectComposition} from '@remotion/renderer';`,
				`const composition = await selectComposition({`,
				`  serveUrl: '/vercel/sandbox/remotion-bundle',`,
				`  id: process.argv[2],`,
				`  inputProps: {},`,
				`  chromiumOptions: {gl: ${JSON.stringify(gl)}},`,
				`  chromeMode: 'headless-shell',`,
				`  logLevel: 'error',`,
				`  timeoutInMilliseconds: 120000,`,
				`});`,
				`await writeFile(${JSON.stringify(resultPath)}, JSON.stringify({`,
				`  width: composition.width,`,
				`  height: composition.height,`,
				`  fps: composition.fps,`,
				`  durationInFrames: composition.durationInFrames,`,
				`}));`,
			].join('\n')),
		},
	])

	const command = await sandbox.runCommand('node', [scriptPath, compositionId])
	if (command.exitCode !== 0) {
		throw new Error(`Could not inspect the composition: ${await command.stderr()}`)
	}

	const buffer = await sandbox.readFileToBuffer({ path: resultPath })
	if (!buffer) throw new Error('The composition inspection did not return metadata.')
	return JSON.parse(buffer.toString('utf8')) as CompositionMetadata
}

function assertMatchingMetadata(actual: CompositionMetadata, expected: RenderOverrides): void {
	const keys = ['width', 'height', 'fps', 'durationInFrames'] as const
	for (const key of keys) {
		if (!Number.isFinite(actual[key]) || actual[key] !== expected[key]) {
			throw new Error(
				`Composition metadata changed before rendering (${key}: expected ${expected[key]}, received ${actual[key]}). Reload the project and try again.`,
			)
		}
	}
}

const jsonError = (error: unknown) =>
	Response.json(
		{
			type: 'error',
			message: error instanceof Error ? error.message : 'Vercel Sandbox render failed.',
		},
		{ status: 500, headers: { 'cache-control': 'no-store' } },
	)

/**
 * Bundles in the Function, then runs Chrome and FFmpeg inside Vercel Sandbox.
 * Videos are detached and uploaded by the VM, so the Function can return as
 * soon as the job starts. Stills remain synchronous because they finish fast.
 */
export async function renderInVercelSandbox({ body }: SandboxRenderArgs): Promise<Response> {
	const blobToken = process.env.BLOB_READ_WRITE_TOKEN
	if (!blobToken) {
		return Response.json(
			{
				type: 'error',
				message:
					'Vercel server rendering requires a connected Blob store (BLOB_READ_WRITE_TOKEN). Browser rendering remains available.',
			},
			{ status: 503 },
		)
	}

	const presetName: QualityPresetId = body.settings.preset
	const quality = QUALITY_PRESETS[presetName] ?? QUALITY_PRESETS.high
	const format: OutputFormat = body.settings.format
	const audioEnabled = body.settings.audioEnabled !== false
	const extension = FORMAT_INFO[format].extension
	const mimeType = FORMAT_INFO[format].mimeType
	const outputWidth = evenDimension(body.overrides.width * body.settings.scale)
	const outputHeight = evenDimension(body.overrides.height * body.settings.scale)
	const requestedFrames =
		body.settings.previewSeconds > 0
			? Math.min(
					body.overrides.durationInFrames,
					Math.round(body.settings.previewSeconds * body.overrides.fps),
				)
			: body.overrides.durationInFrames
	const outputFileName = body.fileName || `render.${extension}`
	const blobPath = `renders/${Date.now()}-${randomUUID()}-${outputFileName}`

	let workDir: string | null = null
	let sandbox: Sandbox | null = null
	let detached = false
	try {
		workDir = await mkdtemp(path.join(os.tmpdir(), 'rvs-vercel-bundle-'))
		const projectDir = path.join(workDir, 'project')
		const entryPath = await writeRenderProject(body, projectDir)
		const bundleDir = path.join(workDir, 'bundle')

		const { bundle } = await import('@remotion/bundler')
		const remotionRoot = path.dirname(require_.resolve('remotion/package.json'))
		await bundle({
			entryPoint: entryPath,
			outDir: bundleDir,
			publicDir: path.join(process.cwd(), 'public'),
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

		const { addBundleToSandbox, renderMediaOnVercel, renderStillOnVercel, uploadToVercelBlob } =
			await import('@remotion/vercel')
		sandbox = await createOrRestoreSandbox()
		await addBundleToSandbox({ sandbox, bundleDir })

		const actualMetadata = await inspectComposition(sandbox, body.compositionId)
		assertMatchingMetadata(actualMetadata, body.overrides)

		const outputFile = `/tmp/render.${extension}`
		if (format === 'png') {
			const result = await renderStillOnVercel({
				sandbox,
				compositionId: body.compositionId,
				inputProps: {},
				outputFile,
				imageFormat: 'png',
				scale: body.settings.scale,
				chromiumOptions: { gl: sandboxOpenGlRenderer() },
				licenseKey: process.env.NEXT_PUBLIC_REMOTION_LICENSE_KEY?.trim() || 'free-license',
			})
			const uploaded = await uploadToVercelBlob({
				sandbox,
				sandboxFilePath: result.sandboxFilePath,
				contentType: result.contentType,
				blobToken,
				blobPath,
				access: 'public',
			})
			const done: ServerRenderDone = {
				type: 'done',
				url: uploaded.url,
				sizeInBytes: uploaded.size,
				codec: 'png',
				width: outputWidth,
				height: outputHeight,
				fileName: outputFileName,
				mimeType: result.contentType,
			}
			return Response.json(done, { headers: { 'cache-control': 'no-store' } })
		}

		const result = await renderMediaOnVercel({
			sandbox,
			compositionId: body.compositionId,
			inputProps: {},
			outputFile,
			codec: codecFor(format),
			crf: format === 'gif' || format === 'prores' ? undefined : quality.crf,
			x264Preset: format === 'mp4' ? quality.x264Preset : undefined,
			pixelFormat: format === 'mp4' ? 'yuv420p' : undefined,
			imageFormat: quality.imageFormat,
			jpegQuality: quality.jpegQuality,
			proResProfile: format === 'prores' ? '4444' : undefined,
			frameRange:
				requestedFrames < body.overrides.durationInFrames ? [0, requestedFrames - 1] : null,
			everyNthFrame: format === 'gif' ? 2 : 1,
			numberOfGifLoops: format === 'gif' ? 0 : undefined,
			scale: body.settings.scale,
			muted: !audioEnabled,
			audioCodec: audioEnabled && format === 'mp4' ? 'aac' : undefined,
			audioBitrate: audioEnabled && format === 'mp4' ? '320k' : undefined,
			chromiumOptions: { gl: sandboxOpenGlRenderer() },
			hardwareAcceleration: 'if-possible',
			concurrency: configuredConcurrency(),
			timeoutInMilliseconds: 120_000,
			licenseKey: process.env.NEXT_PUBLIC_REMOTION_LICENSE_KEY?.trim() || 'free-license',
			detached: true,
			detachedSandboxTimeoutInMilliseconds: sandboxTimeout(),
			vercelBlob: {
				blobToken,
				blobPath,
				access: 'public',
			},
		})

		if (!isValidVercelJobId(result.sandboxId) || !isValidVercelJobId(result.cmdId)) {
			throw new Error('Vercel returned an invalid detached render identifier.')
		}
		detached = true
		const job: ServerRenderJob = {
			type: 'job',
			provider: 'vercel-sandbox',
			sandboxId: result.sandboxId,
			commandId: result.cmdId,
			fileName: outputFileName,
			mimeType,
			codec: codecFor(format),
			width: outputWidth,
			height: outputHeight,
			totalFrames: requestedFrames,
		}

		return Response.json(job, {
			status: 202,
			headers: { 'cache-control': 'no-store' },
		})
	} catch (error) {
		return jsonError(error)
	} finally {
		// A detached render owns its Sandbox until the progress/cancel endpoint
		// stops it. Everything before detachment is cleaned up here on failure.
		if (!detached) await sandbox?.stop().catch(() => undefined)
		if (workDir) await rm(workDir, { recursive: true, force: true }).catch(() => undefined)
	}
}
