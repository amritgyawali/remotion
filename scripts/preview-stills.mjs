#!/usr/bin/env node
/**
 * Renders a handful of frames from a composition so the art direction can be
 * reviewed as images instead of scrubbing a video. One bundle, many stills.
 *
 *   node scripts/preview-stills.mjs samples/ai-master-template.tsx
 *   node scripts/preview-stills.mjs my-video.tsx --frames 0,60,120 --scale 0.5
 *
 * Flags
 *   --composition <id>   composition to sample (defaults to the first one)
 *   --frames <a,b,c>     frames to render (default: 6 frames spread evenly)
 *   --scale <number>     resolution multiplier   (default: 0.5)
 *   --out <dir>          output folder           (default: out/stills)
 */

import path from 'node:path'
import os from 'node:os'
import { mkdir } from 'node:fs/promises'
import { bundle } from '@remotion/bundler'
import { ensureBrowser, getCompositions, renderStill, selectComposition } from '@remotion/renderer'

function parseArgs(argv) {
	const args = { entry: null }
	for (let index = 0; index < argv.length; index++) {
		const token = argv[index]
		if (token.startsWith('--')) {
			args[token.slice(2)] = argv[index + 1]
			index++
		} else if (!args.entry) {
			args.entry = token
		}
	}
	return args
}

function openGlRenderer() {
	const configured = process.env.REMOTION_GL?.trim()
	if (configured) return configured
	return os.platform() === 'linux' ? 'swangle' : 'angle'
}

const args = parseArgs(process.argv.slice(2))
if (!args.entry) {
	console.error('Usage: node scripts/preview-stills.mjs <entry.tsx> [--frames 0,60,120] [--scale 0.5]')
	process.exit(1)
}

const scale = Number(args.scale ?? 0.5)
const outDir = path.resolve(process.cwd(), args.out ?? path.join('out', 'stills'))
await mkdir(outDir, { recursive: true })

const serveUrl = await bundle({
	entryPoint: path.resolve(process.cwd(), args.entry),
	publicDir: path.join(process.cwd(), 'public'),
})
await ensureBrowser()

let compositionId = args.composition
if (!compositionId) {
	const compositions = await getCompositions(serveUrl)
	if (compositions.length === 0) throw new Error('No <Composition /> was registered by that entry.')
	compositionId = compositions[0].id
}

// The composition keeps its authored size; `scale` only changes the raster
// resolution, so the layout stays identical to the real render.
const composition = await selectComposition({ serveUrl, id: compositionId, inputProps: {} })
const base = composition

const frames = args.frames
	? args.frames.split(',').map((value) => Number(value))
	: Array.from({ length: 6 }, (_, index) =>
			Math.round((index / 5) * (base.durationInFrames - 1)),
		)

console.log(
	`\n  ${compositionId}  ${Math.round(composition.width * scale)}x${Math.round(composition.height * scale)}  frames ${frames.join(', ')}\n`,
)
for (const frame of frames) {
	const output = path.join(outDir, `${compositionId}-${String(frame).padStart(4, '0')}.png`)
	await renderStill({
		composition,
		serveUrl,
		output,
		frame: Math.min(Math.max(0, frame), base.durationInFrames - 1),
		imageFormat: 'png',
		scale,
		chromiumOptions: { gl: openGlRenderer() },
		overwrite: true,
		logLevel: 'error',
	})
	console.log(`  ${output}`)
}
console.log('')
