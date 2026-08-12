#!/usr/bin/env node
/**
 * MAX POWER local renderer.
 *
 * The browser and the serverless function both have ceilings. This script has
 * none: it uses every CPU core, hardware acceleration when the machine offers
 * it, lossless PNG frames and near-lossless encoding.
 *
 *   node scripts/render-local.mjs samples/code-becomes-geometry.tsx --preset max
 *   node scripts/render-local.mjs my-video.tsx --composition Main --scale 2 --codec h265
 *   node scripts/render-local.mjs project/src/index.ts --preset max --out out/final.mp4
 *
 * Flags
 *   --composition <id>   composition to render (defaults to the first one)
 *   --preset <name>      draft | high | max          (default: max)
 *   --codec <name>       h264 | h265 | vp9 | prores | gif   (default: h264)
 *   --scale <number>     resolution multiplier        (default: 1)
 *   --crf <number>       overrides the preset quality
 *   --concurrency <n>    overrides "use every core"
 *   --frames <a-b>       render a frame range, e.g. 0-119
 *   --out <path>         output file                  (default: out/<id>.<ext>)
 */

import os from 'node:os'
import path from 'node:path'
import { mkdir } from 'node:fs/promises'
import { bundle } from '@remotion/bundler'
import { ensureBrowser, renderMedia, selectComposition, getCompositions } from '@remotion/renderer'

const PRESETS = {
	draft: { crf: 26, x264Preset: 'veryfast', imageFormat: 'jpeg', jpegQuality: 80 },
	high: { crf: 16, x264Preset: 'slow', imageFormat: 'jpeg', jpegQuality: 95 },
	max: { crf: 9, x264Preset: 'veryslow', imageFormat: 'png', jpegQuality: 100 },
}

const EXTENSIONS = { h264: 'mp4', h265: 'mp4', vp9: 'webm', prores: 'mov', gif: 'gif' }

function parseArgs(argv) {
	const args = { entry: null }
	for (let index = 0; index < argv.length; index++) {
		const token = argv[index]
		if (token.startsWith('--')) {
			const key = token.slice(2)
			const value = argv[index + 1]
			args[key] = value
			index++
		} else if (!args.entry) {
			args.entry = token
		}
	}
	return args
}

function bar(ratio) {
	const width = 28
	const filled = Math.round(Math.max(0, Math.min(1, ratio)) * width)
	return `[${'#'.repeat(filled)}${'-'.repeat(width - filled)}]`
}

async function main() {
	const args = parseArgs(process.argv.slice(2))
	if (!args.entry) {
		console.error('Usage: node scripts/render-local.mjs <entry.tsx> [--preset max] [--codec h264]')
		process.exit(1)
	}

	const entryPoint = path.resolve(process.cwd(), args.entry)
	const presetName = args.preset ?? 'max'
	const preset = PRESETS[presetName] ?? PRESETS.max
	const codec = args.codec ?? 'h264'
	const scale = Number(args.scale ?? 1)
	const cores = os.cpus().length
	const concurrency = args.concurrency ? Number(args.concurrency) : null

	console.log(`\n  Remotion max-power render`)
	console.log(`  entry       ${args.entry}`)
	console.log(`  preset      ${presetName} (crf ${args.crf ?? preset.crf}, ${preset.imageFormat} frames)`)
	console.log(`  codec       ${codec}`)
	console.log(`  cores       ${concurrency ?? `${cores} (all)`}\n`)

	const serveUrl = await bundle({
		entryPoint,
		publicDir: path.join(process.cwd(), 'public'),
		onProgress: (percent) => process.stdout.write(`\r  bundling ${bar(percent / 100)} ${percent}%  `),
	})
	process.stdout.write('\n')

	await ensureBrowser()

	let compositionId = args.composition
	if (!compositionId) {
		const compositions = await getCompositions(serveUrl)
		if (compositions.length === 0) throw new Error('No <Composition /> was registered by that entry.')
		compositionId = compositions[0].id
		if (compositions.length > 1) {
			console.log(`  found ${compositions.map((c) => c.id).join(', ')} - rendering ${compositionId}`)
		}
	}

	const base = await selectComposition({ serveUrl, id: compositionId, inputProps: {} })
	const even = (value) => {
		const rounded = Math.round(value)
		return rounded % 2 === 0 ? rounded : rounded + 1
	}
	const composition = {
		...base,
		width: even(base.width * scale),
		height: even(base.height * scale),
	}

	const extension = EXTENSIONS[codec] ?? 'mp4'
	const outputLocation = path.resolve(
		process.cwd(),
		args.out ?? path.join('out', `${compositionId}.${extension}`),
	)
	await mkdir(path.dirname(outputLocation), { recursive: true })

	const frameRange = args.frames
		? args.frames.split('-').map((value) => Number(value))
		: undefined

	const started = Date.now()
	await renderMedia({
		composition,
		serveUrl,
		codec,
		outputLocation,
		crf: codec === 'gif' || codec === 'prores' ? undefined : Number(args.crf ?? preset.crf),
		x264Preset: codec === 'h264' ? preset.x264Preset : undefined,
		// yuv420p is what every social platform and QuickTime expects.
		pixelFormat: codec === 'h264' || codec === 'h265' ? 'yuv420p' : undefined,
		audioCodec: codec === 'h264' || codec === 'h265' ? 'aac' : undefined,
		audioBitrate: codec === 'h264' || codec === 'h265' ? '320k' : undefined,
		imageFormat: preset.imageFormat,
		jpegQuality: preset.imageFormat === 'jpeg' ? preset.jpegQuality : undefined,
		proResProfile: codec === 'prores' ? '4444' : undefined,
		frameRange,
		concurrency,
		chromiumOptions: { gl: process.env.REMOTION_GL ?? 'angle' },
		hardwareAcceleration: 'if-possible',
		offthreadVideoCacheSizeInBytes: 1024 * 1024 * 1024,
		timeoutInMilliseconds: 300_000,
		logLevel: 'error',
		onProgress: ({ progress, renderedFrames, encodedFrames }) => {
			process.stdout.write(
				`\r  rendering ${bar(progress)} ${Math.round(progress * 100)}%  frames ${renderedFrames} rendered / ${encodedFrames} encoded  `,
			)
		},
	})

	const seconds = ((Date.now() - started) / 1000).toFixed(1)
	console.log(`\n\n  done in ${seconds}s -> ${outputLocation}`)
	console.log(`  ${composition.width}x${composition.height} @ ${composition.fps}fps\n`)
}

main().catch((error) => {
	console.error('\n', error)
	process.exit(1)
})
