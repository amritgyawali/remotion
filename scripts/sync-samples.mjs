#!/usr/bin/env node
/**
 * Copies /samples into /public/samples so the studio can fetch them at runtime,
 * and zips every sample folder into a downloadable multi-file project.
 *
 * Runs automatically through `predev` and `prebuild`.
 */

import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const samplesDir = path.join(root, 'samples')
const outputDir = path.join(root, 'public', 'samples')

const COPYABLE = /\.(tsx|ts|jsx|js|mjs|css|json)$/i

async function addFolder(zip, absoluteDir, prefix) {
	const entries = await readdir(absoluteDir, { withFileTypes: true })
	for (const entry of entries) {
		if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
		const absolute = path.join(absoluteDir, entry.name)
		const relative = prefix ? `${prefix}/${entry.name}` : entry.name
		if (entry.isDirectory()) {
			await addFolder(zip, absolute, relative)
		} else {
			zip.file(relative, await readFile(absolute))
		}
	}
}

async function main() {
	await mkdir(outputDir, { recursive: true })
	const entries = await readdir(samplesDir, { withFileTypes: true })

	for (const entry of entries) {
		if (entry.isFile() && COPYABLE.test(entry.name)) {
			await copyFile(path.join(samplesDir, entry.name), path.join(outputDir, entry.name))
			console.log(`sample  -> public/samples/${entry.name}`)
		}
	}

	const folders = entries.filter((entry) => entry.isDirectory())
	if (folders.length === 0) return

	let JSZip
	try {
		JSZip = (await import('jszip')).default
	} catch {
		console.warn('jszip is not installed yet - skipping the zipped samples. Re-run `npm run samples`.')
		return
	}

	for (const folder of folders) {
		const zip = new JSZip()
		await addFolder(zip, path.join(samplesDir, folder.name), '')
		const buffer = await zip.generateAsync({
			type: 'nodebuffer',
			compression: 'DEFLATE',
			compressionOptions: { level: 9 },
		})
		await writeFile(path.join(outputDir, `${folder.name}.zip`), buffer)
		console.log(`project -> public/samples/${folder.name}.zip`)
	}
}

main().catch((error) => {
	console.error(error)
	process.exit(1)
})
