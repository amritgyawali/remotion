#!/usr/bin/env node

/**
 * Downloads the studio's typography kit from the official google/fonts
 * repository and writes a self-hosted, offline-verifiable copy under
 * public/assets/fonts/v1/.
 *
 * Every family here is licensed under the SIL Open Font License 1.1, which
 * explicitly allows bundling and redistribution as long as the OFL.txt stays
 * with the font files - so each family folder keeps its own licence copy.
 *
 * Fonts are the one class of asset this repository cannot synthesise: text is
 * the loudest element in most videos, and a render host that lacks the family
 * silently falls back to Arial. Self-hosting removes that failure and the
 * network dependency at render time.
 *
 * Usage:
 *   node scripts/fetch-fonts.mjs              # download (skips unchanged files)
 *   node scripts/fetch-fonts.mjs --force      # re-download everything
 *   node scripts/fetch-fonts.mjs --verify-only  # offline hash check, no network
 */

import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fontsRoot = path.join(root, 'public', 'assets', 'fonts')
const versionRoot = path.join(fontsRoot, 'v1')
const catalogPath = path.join(fontsRoot, 'catalog.json')
const lockPath = path.join(fontsRoot, 'fonts.lock.json')
const cssPath = path.join(versionRoot, 'fonts.css')

const SOURCE = 'https://raw.githubusercontent.com/google/fonts/main/ofl'
const PACK_VERSION = '1.0.0'

/**
 * One family per typographic job. Variable files are preferred so a single
 * download covers the whole weight range.
 */
const FAMILIES = [
	{
		slug: 'inter',
		family: 'Inter',
		source: 'inter',
		file: 'Inter[opsz,wght].ttf',
		category: 'sans',
		weight: '100 900',
		axes: ['opsz', 'wght'],
		mood: 'neutral, modern, screen-first',
		useFor: 'UI, explainers, product videos, body copy at any size',
	},
	{
		slug: 'archivo',
		family: 'Archivo',
		source: 'archivo',
		file: 'Archivo[wdth,wght].ttf',
		category: 'grotesk',
		weight: '100 900',
		axes: ['wdth', 'wght'],
		mood: 'editorial grotesk with a width axis',
		useFor: 'headlines that must fit an exact box; condensed captions',
	},
	{
		slug: 'anton',
		family: 'Anton',
		source: 'anton',
		file: 'Anton-Regular.ttf',
		category: 'display',
		weight: '400',
		axes: [],
		mood: 'heavy, loud, poster-like',
		useFor: 'social hooks, big single-word statements, sports and hype',
	},
	{
		slug: 'bebas-neue',
		family: 'Bebas Neue',
		source: 'bebasneue',
		file: 'BebasNeue-Regular.ttf',
		category: 'condensed',
		weight: '400',
		axes: [],
		mood: 'tall, condensed, cinematic',
		useFor: 'title cards, lower thirds, trailer-style typography',
	},
	{
		slug: 'oswald',
		family: 'Oswald',
		source: 'oswald',
		file: 'Oswald[wght].ttf',
		category: 'condensed',
		weight: '200 700',
		axes: ['wght'],
		mood: 'news, sport, documentary',
		useFor: 'stat overlays, tickers, documentary captions',
	},
	{
		slug: 'playfair-display',
		family: 'Playfair Display',
		source: 'playfairdisplay',
		file: 'PlayfairDisplay[wght].ttf',
		category: 'serif',
		weight: '400 900',
		axes: ['wght'],
		mood: 'elegant, luxury, editorial',
		useFor: 'fashion, food, real estate, wedding, premium brand films',
	},
	{
		slug: 'space-grotesk',
		family: 'Space Grotesk',
		source: 'spacegrotesk',
		file: 'SpaceGrotesk[wght].ttf',
		category: 'tech',
		weight: '300 700',
		axes: ['wght'],
		mood: 'technical, futuristic, slightly quirky',
		useFor: 'developer tools, AI and crypto explainers, launch videos',
	},
	{
		slug: 'jetbrains-mono',
		family: 'JetBrains Mono',
		source: 'jetbrainsmono',
		file: 'JetBrainsMono[wght].ttf',
		category: 'mono',
		weight: '100 800',
		axes: ['wght'],
		mood: 'code, terminal, data',
		useFor: 'code walkthroughs, labels, timestamps, technical annotation',
	},
	{
		slug: 'nunito',
		family: 'Nunito',
		source: 'nunito',
		file: 'Nunito[wght].ttf',
		category: 'rounded',
		weight: '200 1000',
		axes: ['wght'],
		mood: 'friendly, soft, approachable',
		useFor: 'education, kids, health, onboarding and community videos',
	},
	{
		slug: 'caveat',
		family: 'Caveat',
		source: 'caveat',
		file: 'Caveat[wght].ttf',
		category: 'handwriting',
		weight: '400 700',
		axes: ['wght'],
		mood: 'handwritten, personal, annotative',
		useFor: 'annotations, circled emphasis, personal notes and vlogs',
	},
	/**
	 * Devanagari coverage. None of the Latin families above carry a single
	 * Devanagari glyph, so Nepali or Hindi text set in them renders as tofu
	 * boxes. These two are loaded alongside the Latin face and the browser
	 * picks per character, which is how a mixed Nepali + English caption stays
	 * in one visual voice.
	 */
	{
		slug: 'noto-sans-devanagari',
		family: 'Noto Sans Devanagari',
		source: 'notosansdevanagari',
		file: 'NotoSansDevanagari[wdth,wght].ttf',
		category: 'devanagari',
		weight: '100 900',
		axes: ['wdth', 'wght'],
		mood: 'neutral, complete, highly legible',
		useFor: 'Nepali and Hindi subtitles, body copy and lower thirds',
	},
	{
		slug: 'anek-devanagari',
		family: 'Anek Devanagari',
		source: 'anekdevanagari',
		file: 'AnekDevanagari[wdth,wght].ttf',
		category: 'devanagari',
		weight: '100 800',
		axes: ['wdth', 'wght'],
		mood: 'contemporary, condensed, display-ready',
		useFor: 'loud Nepali social captions, titles and hooks',
	},
]

const args = new Set(process.argv.slice(2))
const verifyOnly = args.has('--verify-only')
const force = args.has('--force')

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex')

async function readIfExists(filePath) {
	try {
		return await readFile(filePath)
	} catch {
		return null
	}
}

async function download(url) {
	const response = await fetch(url)
	if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`)
	return Buffer.from(await response.arrayBuffer())
}

function fontFaceRule(entry) {
	return [
		'@font-face {',
		`\tfont-family: '${entry.family}';`,
		`\tsrc: url('/assets/fonts/v1/${entry.slug}/${encodeURIComponent(entry.file)}') format('truetype');`,
		`\tfont-weight: ${entry.weight};`,
		'\tfont-style: normal;',
		'\tfont-display: block;',
		'}',
	].join('\n')
}

async function main() {
	const previousLock = JSON.parse((await readIfExists(lockPath))?.toString('utf8') ?? '{"files":{}}')
	const lock = { schemaVersion: 1, packVersion: PACK_VERSION, source: SOURCE, files: {} }
	const catalogEntries = []
	let downloaded = 0
	let reused = 0

	if (!verifyOnly) await mkdir(versionRoot, { recursive: true })

	for (const entry of FAMILIES) {
		const targetDir = path.join(versionRoot, entry.slug)
		if (!verifyOnly) await mkdir(targetDir, { recursive: true })

		const wanted = [
			{ name: entry.file, url: `${SOURCE}/${entry.source}/${encodeURIComponent(entry.file)}` },
			{ name: 'OFL.txt', url: `${SOURCE}/${entry.source}/OFL.txt` },
		]

		for (const item of wanted) {
			const filePath = path.join(targetDir, item.name)
			const relative = path.posix.join('v1', entry.slug, item.name)
			const existing = await readIfExists(filePath)
			const expected = previousLock.files?.[relative]?.sha256

			if (verifyOnly) {
				if (!existing) throw new Error(`Missing ${relative}. Run "npm run fonts" to download it.`)
				const digest = sha256(existing)
				if (expected && digest !== expected) {
					throw new Error(`${relative} does not match the recorded hash. Re-run "npm run fonts --force".`)
				}
				lock.files[relative] = { sha256: digest, bytes: existing.length }
				console.log(`verified ${relative.padEnd(46)} ${(existing.length / 1024).toFixed(0)} KB`)
				continue
			}

			let buffer = existing
			if (!buffer || force || (expected && sha256(buffer) !== expected)) {
				buffer = await download(item.url)
				await writeFile(filePath, buffer)
				downloaded++
				console.log(`downloaded ${relative.padEnd(45)} ${(buffer.length / 1024).toFixed(0)} KB`)
			} else {
				reused++
				console.log(`kept       ${relative.padEnd(45)} ${(buffer.length / 1024).toFixed(0)} KB`)
			}
			lock.files[relative] = { sha256: sha256(buffer), bytes: buffer.length }
		}

		const fontBytes = lock.files[path.posix.join('v1', entry.slug, entry.file)].bytes
		catalogEntries.push({
			id: `font:${entry.slug}`,
			family: entry.family,
			slug: entry.slug,
			category: entry.category,
			mood: entry.mood,
			useFor: entry.useFor,
			weight: entry.weight,
			variable: entry.axes.length > 0,
			axes: entry.axes,
			path: `/assets/fonts/v1/${entry.slug}/${entry.file}`,
			staticFilePath: `assets/fonts/v1/${entry.slug}/${entry.file}`,
			licensePath: `/assets/fonts/v1/${entry.slug}/OFL.txt`,
			license: 'OFL-1.1',
			bytes: fontBytes,
		})
	}

	if (verifyOnly) {
		console.log(`\nverified ${catalogEntries.length} font families`)
		return
	}

	// Drop folders from an older kit revision so the catalog and disk agree.
	const known = new Set(FAMILIES.map((entry) => entry.slug))
	for (const item of await readdir(versionRoot, { withFileTypes: true })) {
		if (item.isDirectory() && !known.has(item.name)) {
			await rm(path.join(versionRoot, item.name), { recursive: true, force: true })
			console.log(`removed    v1/${item.name} (no longer in the kit)`)
		}
	}

	await writeFile(lockPath, `${JSON.stringify(lock, null, '\t')}\n`)
	await writeFile(
		catalogPath,
		`${JSON.stringify(
			{
				schemaVersion: 1,
				packVersion: PACK_VERSION,
				title: 'Remotion Studio Typography Kit',
				description:
					'Self-hosted SIL Open Font License families covering every common video typography job.',
				license: 'OFL-1.1',
				attributionRequired: false,
				source: 'https://github.com/google/fonts',
				cssPath: '/assets/fonts/v1/fonts.css',
				counts: {
					families: catalogEntries.length,
					variable: catalogEntries.filter((entry) => entry.variable).length,
					bytes: catalogEntries.reduce((total, entry) => total + entry.bytes, 0),
				},
				families: catalogEntries,
			},
			null,
			'\t',
		)}\n`,
	)
	await writeFile(
		cssPath,
		`/* Generated by scripts/fetch-fonts.mjs - do not edit by hand. */\n\n${FAMILIES.map(fontFaceRule).join('\n\n')}\n`,
	)

	const megabytes = catalogEntries.reduce((total, entry) => total + entry.bytes, 0) / 1024 / 1024
	console.log(
		`\n${catalogEntries.length} families ready (${downloaded} downloaded, ${reused} kept) - ${megabytes.toFixed(2)} MB of fonts`,
	)
}

main().catch((error) => {
	console.error(`\n${error instanceof Error ? error.message : error}\n`)
	process.exit(1)
})
