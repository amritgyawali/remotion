#!/usr/bin/env node

/**
 * Puts the person-detection runtime, and optionally its models, inside
 * public/ so the AI Background Replace tool has no third-party dependency at
 * run time.
 *
 * Two different kinds of file, treated differently on purpose.
 *
 * The WebAssembly runtime ships inside the `@mediapipe/tasks-vision` package
 * this repository already depends on, so it is a copy, not a download: it
 * costs nothing, it cannot drift from the JavaScript that loads it, and
 * without it the studio would have to reach for a CDN on every cold start.
 * That copy runs automatically through `predev` and `prebuild`.
 *
 * The models are 0.25 MB and 16 MB downloads from Google's public model
 * bucket, and the studio already falls back to that bucket and then caches
 * whatever it fetched in the browser's own vault. Vendoring them is worth it
 * for an offline or air-gapped deployment and is a waste of sixteen megabytes
 * for everyone else - so it is opt-in behind `--models`.
 *
 * Usage:
 *   node scripts/fetch-segmentation-assets.mjs                # runtime only
 *   node scripts/fetch-segmentation-assets.mjs --models       # runtime + models
 *   node scripts/fetch-segmentation-assets.mjs --force        # re-copy/re-download
 *   node scripts/fetch-segmentation-assets.mjs --verify-only  # offline check
 */

import { copyFile, mkdir, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packageWasmDir = path.join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm')
const publicWasmDir = path.join(root, 'public', 'mediapipe', 'wasm')
const publicModelDir = path.join(root, 'public', 'models', 'segmentation')

const argv = process.argv.slice(2)
const has = (name) => argv.includes(`--${name}`)
const WITH_MODELS = has('models')
const FORCE = has('force')
const VERIFY_ONLY = has('verify-only')

/**
 * Both models the tool offers. The sizes are the ones the bucket serves today
 * and are only used as a sanity floor - a truncated download is worse than a
 * missing one, because the browser would cache it.
 */
const MODELS = [
	{
		file: 'selfie_segmenter.tflite',
		url: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite',
		minimumBytes: 200_000,
	},
	{
		file: 'selfie_multiclass_256x256.tflite',
		url: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/1/selfie_multiclass_256x256.tflite',
		minimumBytes: 14_000_000,
	},
]

/** Only these are loaded by `FilesetResolver.forVisionTasks`. */
const WASM_FILES = /^vision_wasm_(internal|nosimd_internal)\.(js|wasm)$/

async function sizeOf(file) {
	try {
		return (await stat(file)).size
	} catch {
		return -1
	}
}

async function copyRuntime() {
	let entries
	try {
		entries = await readdir(packageWasmDir)
	} catch {
		throw new Error(
			'@mediapipe/tasks-vision is not installed - run `npm install` before vendoring the segmentation runtime.',
		)
	}

	await mkdir(publicWasmDir, { recursive: true })
	let copied = 0
	for (const name of entries) {
		if (!WASM_FILES.test(name)) continue
		const from = path.join(packageWasmDir, name)
		const to = path.join(publicWasmDir, name)
		const [fromSize, toSize] = await Promise.all([sizeOf(from), sizeOf(to)])
		if (!FORCE && fromSize === toSize) continue
		await copyFile(from, to)
		copied += 1
		console.log(`runtime -> public/mediapipe/wasm/${name}`)
	}
	if (copied === 0) console.log('runtime -> public/mediapipe/wasm (already current)')
}

async function downloadModels() {
	await mkdir(publicModelDir, { recursive: true })
	for (const model of MODELS) {
		const target = path.join(publicModelDir, model.file)
		const existing = await sizeOf(target)
		if (!FORCE && existing >= model.minimumBytes) {
			console.log(`model   -> public/models/segmentation/${model.file} (already current)`)
			continue
		}
		const response = await fetch(model.url)
		if (!response.ok) throw new Error(`${model.url} responded ${response.status}`)
		const bytes = new Uint8Array(await response.arrayBuffer())
		if (bytes.byteLength < model.minimumBytes) {
			throw new Error(`${model.file} came back as ${bytes.byteLength} bytes - refusing to write a truncated model.`)
		}
		await writeFile(target, bytes)
		console.log(`model   -> public/models/segmentation/${model.file} (${(bytes.byteLength / 1_048_576).toFixed(2)} MB)`)
	}
}

async function verify() {
	const problems = []

	for (const name of ['vision_wasm_internal.js', 'vision_wasm_internal.wasm']) {
		const size = await sizeOf(path.join(publicWasmDir, name))
		if (size < 1024) problems.push(`public/mediapipe/wasm/${name} is missing or empty`)
	}

	// Missing models are not a failure: the studio downloads them on demand and
	// keeps them in the browser. Only a truncated file is worth shouting about.
	for (const model of MODELS) {
		const size = await sizeOf(path.join(publicModelDir, model.file))
		if (size >= 0 && size < model.minimumBytes) {
			problems.push(`public/models/segmentation/${model.file} is truncated (${size} bytes)`)
		} else if (size < 0) {
			console.log(`model   -- ${model.file} not vendored; the studio will fetch it on first use`)
		} else {
			console.log(`model   ok ${model.file} (${(size / 1_048_576).toFixed(2)} MB)`)
		}
	}

	if (problems.length > 0) {
		for (const problem of problems) console.error(`  FAIL ${problem}`)
		process.exitCode = 1
		return
	}
	console.log('\nsegmentation assets verified.')
}

async function main() {
	if (VERIFY_ONLY) {
		await verify()
		return
	}
	await copyRuntime()
	if (WITH_MODELS) await downloadModels()
	else console.log('model   -- skipped; pass --models to vendor them for offline use')
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error)
	process.exitCode = 1
})
