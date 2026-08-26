#!/usr/bin/env node

/**
 * Build the public production asset library.
 *
 * Reads the independently generated visual, 3D, audio, texture and font catalogs, validates every
 * referenced file, then creates:
 *   - public/assets/catalog.json
 *   - public/assets/index.html
 *   - public/assets/production-asset-kit.zip
 *
 * This script is deterministic: it intentionally writes no timestamps.
 */

import { createHash } from 'node:crypto'
import { readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const assetsRoot = path.join(root, 'public', 'assets')
const visualRoot = path.join(assetsRoot, 'visual')
const audioRoot = path.join(assetsRoot, 'audio')
const textureRoot = path.join(assetsRoot, 'texture')
const fontRoot = path.join(assetsRoot, 'fonts')
const modelRoot = path.join(assetsRoot, '3d')
const visualCatalogPath = path.join(visualRoot, 'v1', 'catalog.json')
const audioCatalogPath = path.join(audioRoot, 'catalog.json')
const textureCatalogPath = path.join(textureRoot, 'catalog.json')
const fontCatalogPath = path.join(fontRoot, 'catalog.json')
const modelCatalogPath = path.join(modelRoot, 'v1', 'catalog.json')
const combinedCatalogPath = path.join(assetsRoot, 'catalog.json')
const galleryPath = path.join(assetsRoot, 'index.html')
const libraryReadmePath = path.join(assetsRoot, 'README.md')
const archivePath = path.join(assetsRoot, 'production-asset-kit.zip')

const MIN_VISUALS = 1_000
const MIN_MODELS_3D = 1_000
const MIN_SFX = 500
const MIN_FONTS = 64
const MAX_GALLERY_CARDS = 72
const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024
const FIXED_ZIP_DATE = new Date('2000-01-01T00:00:00.000Z')

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex')
const json = (value) => JSON.stringify(value, null, 2) + '\n'

function escapeHtml(value) {
	return String(value).replace(/[&<>"']/g, (character) => {
		const entities = {
			'&': '&amp;',
			'<': '&lt;',
			'>': '&gt;',
			'"': '&quot;',
			"'": '&#39;',
		}
		return entities[character]
	})
}

function formatBytes(bytes) {
	if (bytes < 1_000) return bytes + ' B'
	if (bytes < 1_000_000) return (bytes / 1_000).toFixed(1) + ' KB'
	return (bytes / 1_000_000).toFixed(2) + ' MB'
}

function galleryUrl(publicPath) {
	const prefix = '/assets/'
	if (!publicPath.startsWith(prefix)) {
		throw new Error('Expected an /assets/ public path, received: ' + publicPath)
	}
	return './' + publicPath.slice(prefix.length)
}

function staticFilePath(publicPath) {
	return publicPath.replace(/^\/+/, '')
}

function publicPathFromStatic(staticPath) {
	const normalized = String(staticPath).replaceAll('\\', '/').replace(/^\/+/, '')
	if (!normalized.startsWith('assets/')) throw new Error('Expected an assets/ static path, received: ' + staticPath)
	return '/' + normalized
}

function absoluteAssetPath(publicPath) {
	const relativeToAssets = publicPath.replace(/^\/assets\//, '')
	const absolutePath = path.resolve(assetsRoot, relativeToAssets)
	if (!absolutePath.startsWith(assetsRoot + path.sep)) {
		throw new Error('Asset path escapes public/assets: ' + publicPath)
	}
	return absolutePath
}

function categoryLabel(category) {
	return category
		.split('-')
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(' ')
}

async function loadCatalog(file) {
	return JSON.parse(await readFile(file, 'utf8'))
}

function assertDeclaredCount(catalog, entries, label, declared = catalog.assetCount) {
	if (!Array.isArray(entries)) throw new Error(label + ' catalog has no asset array')
	if (Number.isInteger(declared) && declared !== entries.length) {
		throw new Error(label + ' catalog declares ' + declared + ' assets but contains ' + entries.length)
	}
}

async function normalizeVisualAssets(catalog) {
	assertDeclaredCount(catalog, catalog.assets, 'Visual')
	if (catalog.assets.length < MIN_VISUALS) throw new Error('Expected at least ' + MIN_VISUALS + ' visual assets, found ' + catalog.assets.length)

	return Promise.all(
		catalog.assets.map(async (asset) => {
			if (asset.format !== 'svg' || !asset.path.endsWith('.svg')) {
				throw new Error('Visual asset is not an SVG: ' + asset.id)
			}
			const relativeToAssets = asset.path.replace(/^\/assets\//, '')
			const absolutePath = path.join(assetsRoot, relativeToAssets)
			const contents = await readFile(absolutePath)
			if (!contents.toString('utf8', 0, 256).includes('<svg')) {
				throw new Error('Visual asset has no SVG root: ' + asset.id)
			}
			const checksum = sha256(contents)
			if (!asset.sha256 || checksum !== asset.sha256) throw new Error('Visual checksum does not match its source catalog: ' + asset.id)
			if (asset.sizeBytes !== contents.length) throw new Error('Visual size does not match its source catalog: ' + asset.id)
			if (asset.id === 'geometry/grid' && (asset.generationEligible !== false || !asset.prohibitedRoles?.includes('background'))) {
				throw new Error('geometry/grid must be ineligible and prohibited as a background')
			}

			return {
				id: 'visual:' + asset.id,
				sourceId: asset.id,
				assetType: 'visual',
				kind: 'visual',
				category: asset.category,
				name: asset.name,
				title: asset.title,
				path: asset.path,
				staticFilePath: asset.staticFilePath ?? staticFilePath(asset.path),
				format: 'svg',
				mimeType: 'image/svg+xml',
				license: asset.license ?? catalog.license,
				licensePath: asset.licensePath ?? catalog.licensePath,
				attributionRequired: asset.attributionRequired ?? catalog.attributionRequired ?? false,
				family: asset.family,
				styleId: asset.styleId,
				seed: asset.seed,
				roles: asset.roles ?? ['foreground'],
				prohibitedRoles: asset.prohibitedRoles ?? [],
				generationEligible: asset.generationEligible !== false,
				legacy: asset.legacy === true,
				recipeVersion: asset.recipeVersion,
				tags: asset.tags ?? [asset.category, asset.name, 'editable', 'vector'],
				sizeBytes: contents.length,
				sha256: checksum,
				geometrySha256: asset.geometrySha256,
				absolutePath,
				contents,
			}
		}),
	)
}

async function normalizeAudioAssets(catalog) {
	assertDeclaredCount(catalog, catalog.assets, 'Audio')
	const sourceSfxCount = catalog.assets.filter((asset) => asset.kind === 'sfx').length
	if (sourceSfxCount < MIN_SFX) throw new Error('Expected at least ' + MIN_SFX + ' SFX assets, found ' + sourceSfxCount)

	return Promise.all(
		catalog.assets.map(async (asset) => {
			const staticPath = asset.staticFilePath ?? staticFilePath(asset.path ?? '')
			if (!asset.file?.endsWith('.wav') || !staticPath.endsWith('.wav')) {
				throw new Error('Audio asset is not a WAV: ' + asset.id)
			}
			const publicPath = '/' + staticPath.replace(/^\/+/, '')
			const relativeToAssets = publicPath.replace(/^\/assets\//, '')
			const absolutePath = path.join(assetsRoot, relativeToAssets)
			const contents = await readFile(absolutePath)
			const checksum = sha256(contents)
			if (asset.sha256 && checksum !== asset.sha256) {
				throw new Error('Audio checksum does not match its source catalog: ' + asset.id)
			}
			if (asset.sizeBytes && contents.length !== asset.sizeBytes) {
				throw new Error('Audio size does not match its source catalog: ' + asset.id)
			}

			return {
				id: 'audio:' + asset.id,
				sourceId: asset.id,
				assetType: 'audio',
				kind: asset.kind,
				category: asset.category,
				title: asset.title,
				path: publicPath,
				staticFilePath: staticPath,
				format: 'wav',
				mimeType: 'audio/wav',
				license: asset.license ?? catalog.license,
				licensePath: asset.licensePath ?? catalog.licensePath ?? '/assets/audio/LICENSE-AUDIO.md',
				attributionRequired: asset.attributionRequired ?? catalog.attributionRequired ?? false,
				durationSeconds: asset.durationSeconds,
				durationFramesAt30Fps: asset.durationFramesAt30Fps,
				durationFramesAt120Fps: asset.durationFramesAt120Fps,
				loopable: asset.loopable,
				bpm: asset.bpm,
				recommendedVolume: asset.recommendedVolume,
				tags: asset.tags,
				peakDbfs: asset.peakDbfs,
				rmsDbfs: asset.rmsDbfs,
				sampleRateHz: asset.sampleRateHz ?? catalog.format?.sampleRateHz,
				channels: asset.channels ?? catalog.format?.channels,
				bitsPerSample: asset.bitsPerSample ?? catalog.format?.bitsPerSample,
				family: asset.family,
				variant: asset.variant,
				seed: asset.seed,
				motion: asset.motion,
				timbre: asset.timbre,
				origin: asset.origin,
				synthesisParameters: asset.synthesisParameters,
				fingerprintStage: asset.fingerprintStage,
				contentFingerprintSha256: asset.contentFingerprintSha256,
				perceptualFingerprintSha256: asset.perceptualFingerprintSha256,
				sizeBytes: contents.length,
				sha256: checksum,
				absolutePath,
				contents,
			}
		}),
	)
}

async function normalizeTextureAssets(catalog) {
	assertDeclaredCount(catalog, catalog.assets, 'Texture')

	return Promise.all(
		catalog.assets.map(async (asset) => {
			const relativeToAssets = asset.path.replace(/^\/assets\//, '')
			const absolutePath = path.join(assetsRoot, relativeToAssets)
			const contents = await readFile(absolutePath)
			if (contents.readUInt32BE(0) !== 0x89504e47) {
				throw new Error('Texture is not a PNG: ' + asset.id)
			}
			const checksum = sha256(contents)
			if (asset.sha256 && checksum !== asset.sha256) {
				throw new Error('Texture checksum does not match its source catalog: ' + asset.id)
			}

			return {
				id: 'texture:' + asset.id,
				sourceId: asset.id,
				assetType: 'texture',
				kind: 'texture',
				category: asset.category,
				title: asset.title,
				path: asset.path,
				staticFilePath: asset.staticFilePath,
				format: 'png',
				mimeType: 'image/png',
				license: asset.license ?? catalog.license,
				licensePath: asset.licensePath ?? catalog.licensePath ?? '/assets/texture/LICENSE-TEXTURE.md',
				attributionRequired: asset.attributionRequired ?? catalog.attributionRequired ?? false,
				width: asset.width,
				height: asset.height,
				tileable: asset.tileable,
				usage: asset.usage,
				tags: asset.tags,
				sizeBytes: contents.length,
				sha256: checksum,
				absolutePath,
				contents,
			}
		}),
	)
}

async function normalizeFontAssets(catalog) {
	assertDeclaredCount(catalog, catalog.families, 'Font', catalog.counts?.families)
	if (catalog.families.length < MIN_FONTS) throw new Error('Expected at least ' + MIN_FONTS + ' font families, found ' + catalog.families.length)

	return Promise.all(
		catalog.families.map(async (family) => {
			const relativeToAssets = family.path.replace(/^\/assets\//, '')
			const absolutePath = path.join(assetsRoot, relativeToAssets)
			const contents = await readFile(absolutePath)
			// Every redistributed family keeps its OFL or Apache licence beside the binary.
			await readFile(path.join(assetsRoot, family.licensePath.replace(/^\/assets\//, '')))

			return {
				id: family.id,
				sourceId: family.slug,
				assetType: 'font',
				kind: 'font',
				category: family.category,
				title: family.family,
				family: family.family,
				path: family.path,
				staticFilePath: family.staticFilePath,
				licensePath: family.licensePath,
				format: 'ttf',
				mimeType: 'font/ttf',
				license: family.license,
				attributionRequired: false,
				variable: family.variable,
				axes: family.axes,
				weight: family.weight,
				mood: family.mood,
				usage: family.useFor,
				tags: [family.category, ...family.mood.split(/,\s*/)],
				sizeBytes: contents.length,
				sha256: sha256(contents),
				absolutePath,
				contents,
			}
		}),
	)
}

async function normalizeModelAssets(catalog) {
	assertDeclaredCount(catalog, catalog.assets, '3D model')
	if (catalog.assets.length < MIN_MODELS_3D) {
		throw new Error('Expected at least ' + MIN_MODELS_3D + ' 3D models, found ' + catalog.assets.length)
	}
	if (Number.isInteger(catalog.previewCount) && catalog.previewCount !== catalog.assets.length) {
		throw new Error('3D catalog preview count does not match its model count')
	}
	if (Number.isInteger(catalog.familyCount) && catalog.familyCount !== catalog.families?.length) {
		throw new Error('3D catalog family count does not match its family array')
	}

	const license = typeof catalog.license === 'string' ? catalog.license : catalog.license?.spdx
	if (!license) throw new Error('3D catalog has no SPDX license')
	const licensePath = catalog.license?.path ? publicPathFromStatic(catalog.license.path) : '/assets/3d/LICENSE-3D.md'

	return Promise.all(
		catalog.assets.map(async (asset) => {
			const modelStaticPath = asset.staticFilePath ?? ('assets/3d/v1/' + asset.path.replace(/^\/+/, ''))
			const previewStaticPath = asset.previewStaticFilePath ?? ('assets/3d/v1/' + asset.previewPath.replace(/^\/+/, ''))
			if (!modelStaticPath.endsWith('.glb') || !previewStaticPath.endsWith('.svg')) {
				throw new Error('3D asset must reference a GLB and SVG preview: ' + asset.id)
			}
			const publicPath = publicPathFromStatic(modelStaticPath)
			const previewPublicPath = publicPathFromStatic(previewStaticPath)
			const absolutePath = absoluteAssetPath(publicPath)
			const previewAbsolutePath = absoluteAssetPath(previewPublicPath)
			const [contents, previewContents] = await Promise.all([readFile(absolutePath), readFile(previewAbsolutePath)])

			if (contents.length < 20 || contents.toString('ascii', 0, 4) !== 'glTF') {
				throw new Error('3D asset is not a binary glTF file: ' + asset.id)
			}
			if (contents.readUInt32LE(4) !== 2 || contents.readUInt32LE(8) !== contents.length) {
				throw new Error('3D asset has an invalid GLB version or declared length: ' + asset.id)
			}
			if (!previewContents.toString('utf8', 0, 512).includes('<svg')) {
				throw new Error('3D preview has no SVG root: ' + asset.id)
			}
			const checksum = sha256(contents)
			const previewChecksum = sha256(previewContents)
			if (!asset.sha256 || checksum !== asset.sha256) throw new Error('3D checksum does not match its source catalog: ' + asset.id)
			if (!asset.previewSha256 || previewChecksum !== asset.previewSha256) {
				throw new Error('3D preview checksum does not match its source catalog: ' + asset.id)
			}
			if (asset.bytes !== contents.length || asset.previewBytes !== previewContents.length) {
				throw new Error('3D model or preview size does not match its source catalog: ' + asset.id)
			}
			if (!asset.family || !Array.isArray(asset.roles) || asset.roles.length === 0) {
				throw new Error('3D model is missing family or role metadata: ' + asset.id)
			}
			if (!Number.isInteger(asset.triangles) || asset.triangles < 1 || !Number.isInteger(asset.nodes) || asset.nodes < 1) {
				throw new Error('3D model is missing triangle or node metadata: ' + asset.id)
			}

			return {
				id: '3d:' + asset.id,
				sourceId: asset.id,
				assetType: '3d',
				kind: '3d',
				category: asset.category,
				name: asset.name,
				title: asset.name,
				path: publicPath,
				staticFilePath: modelStaticPath,
				previewPath: previewPublicPath,
				previewStaticFilePath: previewStaticPath,
				format: 'glb',
				mimeType: 'model/gltf-binary',
				previewFormat: 'svg',
				previewMimeType: 'image/svg+xml',
				license,
				licensePath,
				attributionRequired: false,
				family: asset.family,
				variant: asset.variant,
				styleId: asset.styleId,
				seed: asset.seed,
				roles: asset.roles,
				tags: asset.tags ?? [asset.category, asset.family, ...asset.roles],
				triangles: asset.triangles,
				nodes: asset.nodes,
				materials: asset.materials,
				bounds: asset.bounds,
				geometryFingerprint: asset.geometryFingerprint,
				generationEligible: asset.generationEligible !== false,
				sizeBytes: contents.length,
				previewSizeBytes: previewContents.length,
				sha256: checksum,
				previewSha256: previewChecksum,
				absolutePath,
				previewAbsolutePath,
				contents,
				previewContents,
			}
		}),
	)
}

function publicAsset(asset) {
	const { absolutePath, previewAbsolutePath, contents, previewContents, ...entry } = asset
	return entry
}

function visualCard(asset) {
	const url = galleryUrl(asset.path)
	const search = [asset.title, asset.category, asset.name, ...asset.tags].join(' ').toLowerCase()
	return [
		"<article class='asset-card visual-card' data-kind='visual' data-search='" + escapeHtml(search) + "'>",
		"<div class='preview-shell'><img loading='lazy' src='" + escapeHtml(url) + "' alt='" + escapeHtml(asset.title) + "'></div>",
		"<div class='card-body'>",
		"<div class='eyebrow-row'><span class='pill'>" + escapeHtml(categoryLabel(asset.category)) + "</span><span class='file-type'>SVG</span></div>",
		'<h3>' + escapeHtml(asset.title) + '</h3>',
		"<div class='path-row'><code>" + escapeHtml(asset.staticFilePath) + "</code><button type='button' data-copy='" + escapeHtml(asset.staticFilePath) + "' aria-label='Copy path'>Copy</button></div>",
		"<a class='download-link' href='" + escapeHtml(url) + "' download>Download SVG <span aria-hidden='true'>↓</span></a>",
		'</div>',
		'</article>',
	].join('')
}

function textureCard(asset) {
	const url = galleryUrl(asset.path)
	const search = [asset.title, asset.category, asset.usage, ...asset.tags].join(' ').toLowerCase()
	return [
		"<article class='asset-card texture-card' data-kind='texture' data-search='" + escapeHtml(search) + "'>",
		"<div class='preview-shell texture-shell'><img loading='lazy' src='" + escapeHtml(url) + "' alt='" + escapeHtml(asset.title) + "'></div>",
		"<div class='card-body'>",
		"<div class='eyebrow-row'><span class='pill'>" + escapeHtml(categoryLabel(asset.category)) + '</span>' +
			(asset.tileable ? "<span class='pill loop'>Tileable</span>" : '') +
			"<span class='file-type'>" + asset.width + '×' + asset.height + ' PNG</span></div>',
		'<h3>' + escapeHtml(asset.title) + '</h3>',
		"<p class='use-note'>" + escapeHtml(asset.usage) + '</p>',
		"<div class='path-row'><code>" + escapeHtml(asset.staticFilePath) + "</code><button type='button' data-copy='" + escapeHtml(asset.staticFilePath) + "' aria-label='Copy path'>Copy</button></div>",
		"<a class='download-link' href='" + escapeHtml(url) + "' download>Download PNG <span aria-hidden='true'>↓</span></a>",
		'</div>',
		'</article>',
	].join('')
}

function fontCard(asset) {
	const url = galleryUrl(asset.path)
	const search = [asset.title, asset.category, asset.mood, asset.usage].join(' ').toLowerCase()
	return [
		"<article class='asset-card font-card' data-kind='font' data-search='" + escapeHtml(search) + "'>",
		"<div class='font-specimen' style=\"font-family:'" + escapeHtml(asset.family) + "',sans-serif\"><span class='specimen-big'>Ag</span><span class='specimen-line'>The quick brown fox</span></div>",
		"<div class='card-body'>",
		"<div class='eyebrow-row'><span class='pill'>" + escapeHtml(categoryLabel(asset.category)) + '</span>' +
			(asset.variable ? "<span class='pill loop'>Variable " + escapeHtml(asset.weight) + '</span>' : '') +
			"<span class='file-type'>TTF · " + escapeHtml(asset.license) + '</span></div>',
		'<h3>' + escapeHtml(asset.family) + '</h3>',
		"<p class='use-note'>" + escapeHtml(asset.usage) + '</p>',
		"<div class='path-row'><code>" + escapeHtml(asset.staticFilePath) + "</code><button type='button' data-copy='" + escapeHtml(asset.staticFilePath) + "' aria-label='Copy path'>Copy</button></div>",
		"<a class='download-link' href='" + escapeHtml(url) + "' download>Download TTF <span aria-hidden='true'>↓</span></a>",
		'</div>',
		'</article>',
	].join('')
}

function fontFaceStyles(fonts) {
	return fonts
		.map((font) =>
			"@font-face{font-family:'" +
			font.family +
			"';src:url('" +
			galleryUrl(font.path) +
			"') format('truetype');font-weight:" +
			font.weight +
			';font-display:swap}',
		)
		.join('')
}

function audioArtwork(asset) {
	const bars = [32, 58, 84, 46, 72, 96, 62, 38, 76, 52, 88, 42]
		.map((height) => "<span style='height:" + height + "%'></span>")
		.join('')
	return [
		"<div class='audio-art " + (asset.kind === 'music' ? 'music-art' : 'sfx-art') + "'>",
		"<div class='waveform' aria-hidden='true'>" + bars + '</div>',
		"<span class='audio-glyph' aria-hidden='true'>" + (asset.kind === 'music' ? '♫' : '◉') + '</span>',
		'</div>',
	].join('')
}

function audioCard(asset) {
	const url = galleryUrl(asset.path)
	const search = [asset.title, asset.kind, asset.category, ...asset.tags].join(' ').toLowerCase()
	const metadata = [
		"<span class='pill'>" + escapeHtml(categoryLabel(asset.category)) + '</span>',
		"<span class='pill subtle'>" + escapeHtml(asset.durationSeconds.toFixed(1)) + 's</span>',
		asset.bpm ? "<span class='pill subtle'>" + escapeHtml(asset.bpm) + ' BPM</span>' : '',
		asset.loopable ? "<span class='pill loop'>Loop</span>" : '',
	].join('')
	return [
		"<article class='asset-card audio-card' data-kind='" + escapeHtml(asset.kind) + "' data-search='" + escapeHtml(search) + "'>",
		audioArtwork(asset),
		"<div class='card-body'>",
		"<div class='eyebrow-row'>" + metadata + "<span class='file-type'>WAV</span></div>",
		'<h3>' + escapeHtml(asset.title) + '</h3>',
		"<audio controls preload='none' src='" + escapeHtml(url) + "' aria-label='Preview " + escapeHtml(asset.title) + "'></audio>",
		"<div class='path-row'><code>" + escapeHtml(asset.staticFilePath) + "</code><button type='button' data-copy='" + escapeHtml(asset.staticFilePath) + "' aria-label='Copy path'>Copy</button></div>",
		"<div class='audio-footer'><span>Mix at " + escapeHtml(Math.round(asset.recommendedVolume * 100)) + "%</span><a class='download-link' href='" + escapeHtml(url) + "' download>Download WAV <span aria-hidden='true'>↓</span></a></div>",
		'</div>',
		'</article>',
	].join('')
}

function makeLegacyGallery(catalog) {
	const visuals = catalog.assets.filter((asset) => asset.assetType === 'visual')
	const music = catalog.assets.filter((asset) => asset.kind === 'music')
	const sfx = catalog.assets.filter((asset) => asset.kind === 'sfx')
	const textures = catalog.assets.filter((asset) => asset.assetType === 'texture')
	const fonts = catalog.assets.filter((asset) => asset.assetType === 'font')
	const visualCards = visuals.map(visualCard).join('\n')
	const musicCards = music.map(audioCard).join('\n')
	const sfxCards = sfx.map(audioCard).join('\n')
	const textureCards = textures.map(textureCard).join('\n')
	const fontCards = fonts.map(fontCard).join('\n')

	return [
		'<!doctype html>',
		"<html lang='en'>",
		'<head>',
		"<meta charset='utf-8'>",
		"<meta name='viewport' content='width=device-width, initial-scale=1'>",
		"<meta name='description' content='Browse and download " + catalog.counts.visuals + ' editable SVG visuals and ' + catalog.counts.sfx + " original sound effects for Remotion videos.'>",
		'<title>Production Asset Library</title>',
		'<style>',
		':root{color-scheme:dark;--bg:#070911;--surface:#111520;--surface2:#171c29;--line:#293143;--ink:#f4f7ff;--muted:#94a0b8;--cyan:#58f3e2;--violet:#9c7cff;--warm:#ffbe72;--green:#7cf5aa;--radius:22px}',
		'*{box-sizing:border-box}',
		'html{scroll-behavior:smooth}',
		'body{margin:0;background:radial-gradient(circle at 12% 2%,rgba(88,243,226,.12),transparent 28rem),radial-gradient(circle at 88% 9%,rgba(156,124,255,.14),transparent 32rem),var(--bg);color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;min-height:100vh}',
		'a{color:inherit}',
		'button,input{font:inherit}',
		'.wrap{width:min(1480px,calc(100% - 40px));margin:0 auto}',
		'.topbar{height:72px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid rgba(255,255,255,.07)}',
		'.brand{display:flex;align-items:center;gap:12px;font-weight:800;letter-spacing:-.02em}',
		'.brand-mark{width:34px;height:34px;border-radius:11px;background:conic-gradient(from 210deg,var(--cyan),var(--violet),var(--warm),var(--cyan));box-shadow:0 0 32px rgba(88,243,226,.28);position:relative}',
		'.brand-mark:after{content:"";position:absolute;inset:7px;border-radius:7px;background:var(--bg)}',
		'.top-actions{display:flex;gap:10px}',
		'.button{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:40px;padding:0 16px;border:1px solid var(--line);border-radius:12px;text-decoration:none;font-size:13px;font-weight:750;background:rgba(255,255,255,.035);transition:.18s ease}',
		'.button:hover{border-color:#5e6b86;background:rgba(255,255,255,.07);transform:translateY(-1px)}',
		'.button.primary{background:var(--ink);color:#070911;border-color:var(--ink)}',
		'.hero{padding:88px 0 56px;display:grid;grid-template-columns:minmax(0,1.4fr) minmax(300px,.6fr);gap:60px;align-items:end}',
		'.kicker{display:inline-flex;align-items:center;gap:9px;color:var(--cyan);font-size:12px;letter-spacing:.16em;text-transform:uppercase;font-weight:850}',
		'.kicker:before{content:"";width:24px;height:1px;background:currentColor;box-shadow:0 0 10px currentColor}',
		'h1{font-size:clamp(52px,7vw,104px);line-height:.91;letter-spacing:-.067em;margin:24px 0 26px;max-width:950px}',
		'.hero-copy{max-width:720px;margin:0;color:var(--muted);font-size:18px;line-height:1.65}',
		'.stats{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}',
		'.stat{padding:22px;border:1px solid var(--line);border-radius:18px;background:linear-gradient(145deg,rgba(255,255,255,.055),rgba(255,255,255,.018));box-shadow:0 20px 70px rgba(0,0,0,.2)}',
		'.stat strong{display:block;font-size:34px;letter-spacing:-.04em}',
		'.stat span{display:block;margin-top:5px;color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.12em}',
		'.usage{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:18px 22px;border:1px solid rgba(88,243,226,.24);background:rgba(88,243,226,.055);border-radius:16px;margin-bottom:32px}',
		'.usage p{margin:0;color:#bdd0d0;font-size:13px;line-height:1.5}',
		'.usage code{color:var(--cyan);font:700 12px ui-monospace,SFMono-Regular,Consolas,monospace}',
		'.controls{position:sticky;top:12px;z-index:20;display:flex;align-items:center;gap:12px;padding:12px;margin:0 0 56px;border:1px solid var(--line);background:rgba(10,13,22,.86);backdrop-filter:blur(22px);border-radius:18px;box-shadow:0 18px 60px rgba(0,0,0,.28)}',
		'.search{min-width:180px;flex:1;position:relative}',
		'.search input{width:100%;height:44px;border:1px solid transparent;border-radius:12px;background:#090c14;color:var(--ink);padding:0 16px 0 42px;outline:none}',
		'.search input:focus{border-color:var(--cyan);box-shadow:0 0 0 3px rgba(88,243,226,.1)}',
		'.search:before{content:"⌕";position:absolute;left:15px;top:8px;color:var(--muted);font-size:23px;pointer-events:none}',
		'.filters{display:flex;gap:7px;flex-wrap:wrap}',
		'.filter{height:38px;padding:0 14px;border:1px solid transparent;border-radius:10px;background:transparent;color:var(--muted);cursor:pointer;font-size:12px;font-weight:800}',
		'.filter:hover{color:var(--ink);background:rgba(255,255,255,.04)}',
		'.filter.active{color:#07100f;background:var(--cyan)}',
		'.result-count{padding:0 8px;color:var(--muted);font-size:12px;white-space:nowrap}',
		'.asset-section{margin-bottom:76px}',
		'.section-head{display:flex;align-items:end;justify-content:space-between;gap:20px;margin-bottom:22px}',
		'.section-head h2{font-size:31px;letter-spacing:-.04em;margin:0}',
		'.section-head p{margin:8px 0 0;color:var(--muted);font-size:14px}',
		'.count-badge{font:700 12px ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--cyan);border:1px solid rgba(88,243,226,.24);background:rgba(88,243,226,.06);padding:8px 11px;border-radius:999px}',
		'.asset-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px}',
		'.audio-grid{grid-template-columns:repeat(3,minmax(0,1fr))}',
		'.asset-card{border:1px solid var(--line);border-radius:var(--radius);overflow:hidden;background:linear-gradient(155deg,rgba(255,255,255,.052),rgba(255,255,255,.018));box-shadow:0 20px 55px rgba(0,0,0,.16);transition:transform .2s ease,border-color .2s ease,box-shadow .2s ease}',
		'.asset-card:hover{transform:translateY(-4px);border-color:#47536d;box-shadow:0 26px 70px rgba(0,0,0,.28)}',
		'.asset-card[hidden],.asset-section[hidden]{display:none}',
		'.preview-shell{aspect-ratio:1.36;display:grid;place-items:center;background-color:#0a0d16;background-image:linear-gradient(45deg,rgba(255,255,255,.025) 25%,transparent 25%),linear-gradient(-45deg,rgba(255,255,255,.025) 25%,transparent 25%),linear-gradient(45deg,transparent 75%,rgba(255,255,255,.025) 75%),linear-gradient(-45deg,transparent 75%,rgba(255,255,255,.025) 75%);background-size:30px 30px;background-position:0 0,0 15px,15px -15px,-15px 0;border-bottom:1px solid var(--line);overflow:hidden}',
		'.preview-shell img{width:74%;height:74%;object-fit:contain;filter:drop-shadow(0 14px 28px rgba(0,0,0,.38));transition:transform .25s ease}',
		'.asset-card:hover .preview-shell img{transform:scale(1.045)}',
		'.card-body{padding:18px}',
		'.eyebrow-row{min-height:24px;display:flex;align-items:center;gap:6px;flex-wrap:wrap}',
		'.pill{display:inline-flex;align-items:center;height:23px;padding:0 8px;border-radius:999px;background:rgba(156,124,255,.12);border:1px solid rgba(156,124,255,.22);color:#c8b8ff;font-size:9px;letter-spacing:.1em;text-transform:uppercase;font-weight:850}',
		'.pill.subtle{background:rgba(255,255,255,.04);border-color:rgba(255,255,255,.08);color:var(--muted)}',
		'.pill.loop{background:rgba(124,245,170,.08);border-color:rgba(124,245,170,.2);color:var(--green)}',
		'.file-type{margin-left:auto;color:#6e7a91;font:750 10px ui-monospace,SFMono-Regular,Consolas,monospace}',
		'.asset-card h3{margin:13px 0 15px;font-size:18px;letter-spacing:-.025em}',
		'.path-row{display:flex;align-items:stretch;gap:7px}',
		'.path-row code{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:10px;background:#090c14;border:1px solid rgba(255,255,255,.06);border-radius:9px;color:#9ba8c0;font:10px ui-monospace,SFMono-Regular,Consolas,monospace}',
		'.path-row button{border:1px solid var(--line);border-radius:9px;background:rgba(255,255,255,.035);color:var(--muted);font-size:10px;font-weight:800;padding:0 10px;cursor:pointer}',
		'.path-row button:hover{border-color:var(--cyan);color:var(--cyan)}',
		'.download-link{display:inline-flex;align-items:center;gap:8px;margin-top:14px;color:#cbd3e4;text-decoration:none;font-size:11px;font-weight:800}',
		'.download-link:hover{color:var(--cyan)}',
		'.audio-art{height:116px;position:relative;display:grid;place-items:center;border-bottom:1px solid var(--line);overflow:hidden;background:radial-gradient(circle at 50% 70%,rgba(156,124,255,.18),transparent 58%),#0a0d16}',
		'.music-art{background:radial-gradient(circle at 30% 80%,rgba(88,243,226,.19),transparent 52%),radial-gradient(circle at 80% 10%,rgba(156,124,255,.16),transparent 55%),#0a0d16}',
		'.waveform{position:absolute;left:18px;right:18px;top:24px;bottom:24px;display:flex;align-items:center;justify-content:center;gap:6px;opacity:.75}',
		'.waveform span{width:5px;border-radius:99px;background:linear-gradient(var(--cyan),var(--violet));box-shadow:0 0 12px rgba(88,243,226,.16)}',
		'.audio-glyph{position:relative;z-index:2;width:42px;height:42px;display:grid;place-items:center;border-radius:50%;background:rgba(7,9,17,.82);border:1px solid rgba(255,255,255,.14);box-shadow:0 10px 28px rgba(0,0,0,.32);font-size:20px}',
		'audio{display:block;width:100%;height:38px;margin:0 0 14px;filter:saturate(.75)}',
		'.audio-footer{display:flex;align-items:center;justify-content:space-between;color:var(--muted);font-size:10px}',
		'.audio-footer .download-link{margin-top:12px}',
		'.texture-shell{background-color:#0a0d16;background-image:linear-gradient(45deg,#141a26 25%,transparent 25%),linear-gradient(-45deg,#141a26 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#141a26 75%),linear-gradient(-45deg,transparent 75%,#141a26 75%);background-size:18px 18px;background-position:0 0,0 9px,9px -9px,-9px 0}',
		'.texture-shell img{width:100%;height:100%;object-fit:cover}',
		'.use-note{margin:0 0 13px;color:var(--muted);font-size:12px;line-height:1.5}',
		'.font-specimen{height:150px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;border-bottom:1px solid var(--line);background:radial-gradient(circle at 50% 20%,rgba(255,190,114,.12),transparent 60%),#0a0d16}',
		'.specimen-big{font-size:60px;line-height:1;letter-spacing:-.03em}',
		'.specimen-line{font-size:15px;color:var(--muted)}',
		fontFaceStyles(fonts),
		'.empty{display:none;padding:70px 24px;text-align:center;color:var(--muted);border:1px dashed var(--line);border-radius:20px;margin-bottom:70px}',
		'.empty.visible{display:block}',
		'footer{display:flex;align-items:center;justify-content:space-between;gap:30px;padding:34px 0 48px;border-top:1px solid rgba(255,255,255,.07);color:var(--muted);font-size:12px}',
		'footer strong{color:var(--ink)}',
		'@media(max-width:1100px){.asset-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.audio-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.hero{grid-template-columns:1fr}.stats{max-width:560px}}',
		'@media(max-width:760px){.wrap{width:min(100% - 24px,1480px)}.topbar{height:auto;padding:14px 0}.brand span:last-child{display:none}.top-actions .button:first-child{display:none}.hero{padding:58px 0 38px;gap:34px}h1{font-size:54px}.usage{align-items:flex-start;flex-direction:column}.controls{align-items:stretch;flex-direction:column;top:6px}.filters{overflow:auto;flex-wrap:nowrap}.result-count{position:absolute;right:15px;top:21px}.asset-grid,.audio-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.section-head{align-items:flex-start}.section-head p{max-width:260px}}',
		'@media(max-width:500px){.asset-grid,.audio-grid{grid-template-columns:1fr}.stats{grid-template-columns:repeat(2,1fr)}.hero-copy{font-size:16px}.top-actions .button{padding:0 12px}footer{align-items:flex-start;flex-direction:column}}',
		'</style>',
		'</head>',
		'<body>',
		"<header class='wrap topbar'><div class='brand'><span class='brand-mark' aria-hidden='true'></span><span>Remotion Production Kit</span></div><nav class='top-actions'><a class='button' href='./catalog.json'>Catalog JSON</a><a class='button primary' href='./production-asset-kit.zip' download>Download full kit ↓</a></nav></header>",
		'<main class="wrap">',
		"<section class='hero'><div><span class='kicker'>Original · Editable · license notices included</span><h1>Everything your video needs to move.</h1><p class='hero-copy'>A production-ready library of editable SVG objects, generated textures, self-hosted fonts, original music loops, and precision sound effects. Preview everything here, copy its exact path, or download the complete kit.</p></div><div class='stats'><div class='stat'><strong>" + catalog.counts.visuals + "</strong><span>SVG visuals</span></div><div class='stat'><strong>" + catalog.counts.textures + "</strong><span>Textures</span></div><div class='stat'><strong>" + (catalog.counts.music + catalog.counts.sfx) + "</strong><span>Music &amp; SFX</span></div><div class='stat'><strong>" + catalog.counts.fonts + "</strong><span>Font families</span></div></div></section>",
		"<aside class='usage'><p>Use any path directly from your Remotion composition. Shared assets are served locally and travel with local and server renders.</p><code>staticFile('assets/visual/v1/objects/phone.svg')</code></aside>",
		"<section class='controls' aria-label='Asset filters'><label class='search'><span class='sr-only'></span><input id='search' type='search' placeholder='Search assets, moods, and categories…' autocomplete='off' aria-label='Search assets'></label><div class='filters' role='group' aria-label='Filter by asset type'><button class='filter active' type='button' data-filter='all'>All</button><button class='filter' type='button' data-filter='visual'>Visuals</button><button class='filter' type='button' data-filter='texture'>Textures</button><button class='filter' type='button' data-filter='font'>Fonts</button><button class='filter' type='button' data-filter='music'>Music</button><button class='filter' type='button' data-filter='sfx'>SFX</button></div><span class='result-count' id='result-count'>" + catalog.counts.total + ' assets</span></section>',
		"<section class='asset-section' data-section><div class='section-head'><div><h2>Visual production kit</h2><p>Objects, icons, arrows, neon elements, geometry, and browser-safe dimensional art.</p></div><span class='count-badge'>" + visuals.length + " SVG</span></div><div class='asset-grid'>" + visualCards + '</div></section>',
		"<section class='asset-section' data-section><div class='section-head'><div><h2>Typography</h2><p>Self-hosted OFL and Apache families - no network fetch at render time.</p></div><span class='count-badge'>" + fonts.length + " families</span></div><div class='asset-grid audio-grid'>" + fontCards + '</div></section>',
		"<section class='asset-section' data-section><div class='section-head'><div><h2>Textures, sprites and environments</h2><p>Grain, paper, light leaks, glow sprites, matcaps and equirectangular 3D lighting.</p></div><span class='count-badge'>" + textures.length + " PNG</span></div><div class='asset-grid'>" + textureCards + '</div></section>',
		"<section class='asset-section' data-section><div class='section-head'><div><h2>Original music beds</h2><p>Frame-aligned, loopable procedural tracks with mix-ready headroom.</p></div><span class='count-badge'>" + music.length + " WAV</span></div><div class='asset-grid audio-grid'>" + musicCards + '</div></section>',
		"<section class='asset-section' data-section><div class='section-head'><div><h2>Sound effects</h2><p>UI feedback, transitions, impacts, risers, shimmers, and closing accents.</p></div><span class='count-badge'>" + sfx.length + " WAV</span></div><div class='asset-grid audio-grid'>" + sfxCards + '</div></section>',
		"<div class='empty' id='empty'><strong>No matching assets.</strong><br>Try a broader search or select another type.</div>",
		'</main>',
		"<footer class='wrap'><span><strong>" + catalog.counts.total + " assets</strong> · Original artwork/audio plus redistributable fonts</span><span>CC0-1.0 · OFL-1.1 · Apache-2.0 notices included</span></footer>",
		'<script>',
		"const cards=Array.from(document.querySelectorAll('.asset-card'));",
		"const sections=Array.from(document.querySelectorAll('[data-section]'));",
		"const filters=Array.from(document.querySelectorAll('[data-filter]'));",
		"const search=document.getElementById('search');",
		"const resultCount=document.getElementById('result-count');",
		"const empty=document.getElementById('empty');",
		"let activeFilter='all';",
		"function update(){const query=search.value.trim().toLowerCase();let visible=0;for(const card of cards){const kindMatches=activeFilter==='all'||card.dataset.kind===activeFilter;const searchMatches=!query||card.dataset.search.includes(query);card.hidden=!(kindMatches&&searchMatches);if(!card.hidden)visible++;}for(const section of sections){section.hidden=!Array.from(section.querySelectorAll('.asset-card')).some((card)=>!card.hidden);}resultCount.textContent=visible+(visible===1?' asset':' assets');empty.classList.toggle('visible',visible===0);}",
		"for(const button of filters){button.addEventListener('click',()=>{activeFilter=button.dataset.filter;for(const item of filters)item.classList.toggle('active',item===button);update();});}",
		"search.addEventListener('input',update);",
		"document.addEventListener('click',async(event)=>{const button=event.target.closest('[data-copy]');if(!button)return;const original=button.textContent;try{await navigator.clipboard.writeText(button.dataset.copy);button.textContent='Copied';}catch{button.textContent='Select path';}setTimeout(()=>{button.textContent=original;},1200);});",
		'</script>',
		'</body>',
		'</html>',
		'',
	].join('\n')
}

function makeGallery(catalog) {
	const fonts = catalog.assets.filter((asset) => asset.assetType === 'font')
	const modelExample = catalog.assets.find((asset) => asset.assetType === '3d')?.staticFilePath ?? 'assets/3d/v1/catalog.json'
	const galleryScript = `
const PAGE_SIZE = ${MAX_GALLERY_CARDS};
const state = {assets: [], activeFilter: 'all', category: 'all', query: '', eligibleOnly: false, page: 0};
const grid = document.getElementById('asset-grid');
const filters = Array.from(document.querySelectorAll('[data-filter]'));
const search = document.getElementById('search');
const category = document.getElementById('category');
const eligibleOnly = document.getElementById('eligible-only');
const resultCount = document.getElementById('result-count');
const empty = document.getElementById('empty');
const previous = document.getElementById('previous-page');
const next = document.getElementById('next-page');
const pageLabel = document.getElementById('page-label');
const pager = document.getElementById('pager');

function element(tag, className, text) {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text !== undefined) node.textContent = String(text);
	return node;
}

function kindOf(asset) {
	if (asset.assetType === 'visual') return 'visual';
	if (asset.assetType === '3d') return '3d';
	if (asset.assetType === 'texture') return 'texture';
	if (asset.assetType === 'font') return 'font';
	return asset.kind;
}

function searchText(asset) {
	return [asset.title, asset.name, asset.category, asset.family, asset.variant, asset.styleId, asset.mood, asset.usage, asset.triangles, asset.nodes, ...(asset.tags || []), ...(asset.roles || [])]
		.filter(Boolean)
		.join(' ')
		.toLowerCase();
}

function pill(text, className = '') {
	return element('span', ('pill ' + className).trim(), text);
}

function downloadLink(asset) {
	const link = element('a', 'download-link', 'Download ' + String(asset.format || 'asset').toUpperCase() + ' ↓');
	link.href = asset.path;
	link.download = '';
	return link;
}

function metadataFor(asset) {
	const row = element('div', 'eyebrow-row');
	row.append(pill(asset.category || kindOf(asset)));
	if (asset.family) row.append(pill(asset.family, 'subtle'));
	if (asset.assetType === '3d' && asset.variant) row.append(pill('v' + String(asset.variant).padStart(3, '0'), 'subtle'));
	if (asset.styleId) row.append(pill(asset.styleId, 'subtle'));
	if (asset.loopable) row.append(pill('Loop', 'loop'));
	if (asset.generationEligible === false) row.append(pill('Legacy only', 'warning'));
	row.append(element('span', 'file-type', String(asset.format || '').toUpperCase()));
	return row;
}

function makePreview(asset) {
	if (asset.assetType === 'visual' || asset.assetType === 'texture' || asset.assetType === '3d') {
		const shellClass = asset.assetType === 'texture' ? 'texture-shell' : asset.assetType === '3d' ? 'model-shell' : '';
		const shell = element('div', 'preview-shell ' + shellClass);
		const image = document.createElement('img');
		image.loading = 'lazy';
		image.decoding = 'async';
		image.src = asset.assetType === '3d' ? asset.previewPath : asset.path;
		image.alt = asset.title;
		shell.append(image);
		return shell;
	}
	if (asset.assetType === 'font') {
		const specimen = element('div', 'font-specimen');
		specimen.style.fontFamily = '"' + asset.family + '", sans-serif';
		specimen.append(element('span', 'specimen-big', 'Ag'), element('span', 'specimen-line', 'The quick brown fox'));
		return specimen;
	}
	const art = element('div', 'audio-art ' + (asset.kind === 'music' ? 'music-art' : 'sfx-art'));
	const waveform = element('div', 'waveform');
	waveform.setAttribute('aria-hidden', 'true');
	for (const height of [32, 58, 84, 46, 72, 96, 62, 38, 76, 52, 88, 42]) {
		const bar = document.createElement('span');
		bar.style.height = height + '%';
		waveform.append(bar);
	}
	art.append(waveform, element('span', 'audio-glyph', asset.kind === 'music' ? 'M' : 'SFX'));
	return art;
}

function descriptionFor(asset) {
	if (asset.assetType === '3d') {
		return asset.triangles.toLocaleString() + ' triangles | ' + asset.nodes + ' nodes | roles: ' + (asset.roles || []).join(', ');
	}
	if (asset.assetType === 'visual') {
		const blocked = (asset.prohibitedRoles || []).length ? ' | prohibited: ' + asset.prohibitedRoles.join(', ') : '';
		return 'Style: ' + (asset.styleId || 'legacy') + ' | roles: ' + (asset.roles || []).join(', ') + blocked;
	}
	if (asset.assetType === 'texture') return asset.usage;
	if (asset.assetType === 'font') return asset.usage + ' | ' + asset.license;
	if (asset.kind === 'music' || asset.kind === 'sfx') return asset.durationSeconds.toFixed(2) + 's | mix ' + Math.round(asset.recommendedVolume * 100) + '%';
	return '';
}

function makeCard(asset) {
	const card = element('article', 'asset-card ' + (asset.assetType === '3d' ? 'model-card' : kindOf(asset) + '-card'));
	card.append(makePreview(asset));
	const body = element('div', 'card-body');
	body.append(metadataFor(asset), element('h3', '', asset.title));
	const description = descriptionFor(asset);
	if (description) body.append(element('p', 'use-note', description));
	if (asset.kind === 'music' || asset.kind === 'sfx') {
		const audio = document.createElement('audio');
		audio.controls = true;
		audio.preload = 'none';
		audio.src = asset.path;
		audio.setAttribute('aria-label', 'Preview ' + asset.title);
		body.append(audio);
	}
	const publicPath = asset.staticFilePath || asset.path.replace(/^\\/+/, '');
	const pathRow = element('div', 'path-row');
	pathRow.append(element('code', '', publicPath));
	const copy = element('button', 'copy-button', 'Copy');
	copy.type = 'button';
	copy.dataset.copy = publicPath;
	copy.setAttribute('aria-label', 'Copy path');
	pathRow.append(copy);
	body.append(pathRow, downloadLink(asset));
	card.append(body);
	return card;
}

function matchesKind(asset) {
	return state.activeFilter === 'all' || kindOf(asset) === state.activeFilter;
}

function filteredAssets() {
	return state.assets.filter((asset) =>
		matchesKind(asset) &&
		(state.category === 'all' || asset.category === state.category) &&
		(!state.eligibleOnly || asset.generationEligible !== false) &&
		(!state.query || searchText(asset).includes(state.query))
	);
}

function updateCategories() {
	const available = [...new Set(state.assets.filter(matchesKind).map((asset) => asset.category).filter(Boolean))].sort();
	const selected = state.category;
	category.replaceChildren(new Option('All categories', 'all'), ...available.map((value) => new Option(value.replaceAll('-', ' '), value)));
	category.value = available.includes(selected) ? selected : 'all';
	state.category = category.value;
}

function render() {
	const matches = filteredAssets();
	const pages = Math.max(1, Math.ceil(matches.length / PAGE_SIZE));
	state.page = Math.min(state.page, pages - 1);
	const start = state.page * PAGE_SIZE;
	const pageAssets = matches.slice(start, start + PAGE_SIZE);
	grid.replaceChildren(...pageAssets.map(makeCard));
	empty.classList.toggle('visible', matches.length === 0);
	const shownEnd = Math.min(start + PAGE_SIZE, matches.length);
	resultCount.textContent = matches.length === 0 ? '0 assets' : (start + 1) + '-' + shownEnd + ' of ' + matches.length + ' assets';
	pageLabel.textContent = 'Page ' + (state.page + 1) + ' of ' + pages;
	previous.disabled = state.page === 0;
	next.disabled = state.page >= pages - 1;
	pager.hidden = matches.length <= PAGE_SIZE;
}

for (const button of filters) {
	button.addEventListener('click', () => {
		state.activeFilter = button.dataset.filter;
		state.page = 0;
		for (const item of filters) item.classList.toggle('active', item === button);
		updateCategories();
		render();
	});
}
search.addEventListener('input', () => { state.query = search.value.trim().toLowerCase(); state.page = 0; render(); });
category.addEventListener('change', () => { state.category = category.value; state.page = 0; render(); });
eligibleOnly.addEventListener('change', () => { state.eligibleOnly = eligibleOnly.checked; state.page = 0; render(); });
previous.addEventListener('click', () => { if (state.page > 0) { state.page--; render(); document.getElementById('library').scrollIntoView({behavior: 'smooth'}); } });
next.addEventListener('click', () => { state.page++; render(); document.getElementById('library').scrollIntoView({behavior: 'smooth'}); });
document.addEventListener('click', async (event) => {
	const button = event.target.closest('[data-copy]');
	if (!button) return;
	const original = button.textContent;
	try { await navigator.clipboard.writeText(button.dataset.copy); button.textContent = 'Copied'; }
	catch { button.textContent = 'Select path'; }
	setTimeout(() => { button.textContent = original; }, 1200);
});

fetch('./catalog.json')
	.then((response) => { if (!response.ok) throw new Error('Catalog request failed: ' + response.status); return response.json(); })
	.then((loadedCatalog) => { state.assets = loadedCatalog.assets; updateCategories(); render(); })
	.catch((error) => { resultCount.textContent = 'Catalog unavailable'; empty.classList.add('visible'); empty.textContent = error.message; });
`.trim()

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="Browse and download ${catalog.counts.models3d ? catalog.counts.models3d + ' production-ready 3D GLB models, ' : ''}${catalog.counts.visuals} editable SVG visuals, ${catalog.counts.sfx} original sound effects, textures, and self-hosted fonts for Remotion videos.">
<title>Production Asset Library</title>
<style>
:root{color-scheme:dark;--bg:#070911;--surface:#111520;--line:#293143;--ink:#f4f7ff;--muted:#94a0b8;--cyan:#58f3e2;--violet:#9c7cff;--warm:#ffbe72;--green:#7cf5aa;--radius:22px}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:radial-gradient(circle at 12% 2%,rgba(88,243,226,.12),transparent 28rem),radial-gradient(circle at 88% 9%,rgba(156,124,255,.14),transparent 32rem),var(--bg);color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;min-height:100vh}a{color:inherit}button,input,select{font:inherit}.wrap{width:min(1480px,calc(100% - 40px));margin:0 auto}
.topbar{min-height:72px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid rgba(255,255,255,.07)}.brand{display:flex;align-items:center;gap:12px;font-weight:800;letter-spacing:-.02em}.brand-mark{width:34px;height:34px;border-radius:50%;background:conic-gradient(from 210deg,var(--cyan),var(--violet),var(--warm),var(--cyan));box-shadow:0 0 32px rgba(88,243,226,.28);position:relative}.brand-mark:after{content:"";position:absolute;inset:7px;border-radius:50%;background:var(--bg)}.top-actions{display:flex;gap:10px}.button{display:inline-flex;align-items:center;justify-content:center;min-height:40px;padding:0 16px;border:1px solid var(--line);border-radius:12px;text-decoration:none;font-size:13px;font-weight:750;background:rgba(255,255,255,.035)}.button:hover{border-color:#5e6b86;background:rgba(255,255,255,.07)}.button.primary{background:var(--ink);color:#070911;border-color:var(--ink)}
.hero{padding:82px 0 54px;display:grid;grid-template-columns:minmax(0,1.4fr) minmax(300px,.6fr);gap:60px;align-items:end}.kicker{color:var(--cyan);font-size:12px;letter-spacing:.16em;text-transform:uppercase;font-weight:850}h1{font-size:clamp(52px,7vw,104px);line-height:.91;letter-spacing:-.067em;margin:24px 0 26px;max-width:950px}.hero-copy{max-width:760px;margin:0;color:var(--muted);font-size:18px;line-height:1.65}.stats{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}.stat{padding:22px;border:1px solid var(--line);border-radius:18px;background:linear-gradient(145deg,rgba(255,255,255,.055),rgba(255,255,255,.018))}.stat strong{display:block;font-size:34px;letter-spacing:-.04em}.stat span{display:block;margin-top:5px;color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.12em}
.usage{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:18px 22px;border:1px solid rgba(88,243,226,.24);background:rgba(88,243,226,.055);border-radius:16px;margin-bottom:32px}.usage p{margin:0;color:#bdd0d0;font-size:13px}.usage code{color:var(--cyan);font:700 12px ui-monospace,SFMono-Regular,Consolas,monospace}.controls{position:sticky;top:12px;z-index:20;display:flex;align-items:center;gap:10px;padding:12px;margin:0 0 48px;border:1px solid var(--line);background:rgba(10,13,22,.9);backdrop-filter:blur(22px);border-radius:18px;box-shadow:0 18px 60px rgba(0,0,0,.28)}.search{min-width:220px;flex:1}.search input,.category-select{height:44px;border:1px solid transparent;border-radius:12px;background:#090c14;color:var(--ink);padding:0 15px;outline:none}.search input{width:100%}.search input:focus,.category-select:focus{border-color:var(--cyan)}.category-select{min-width:150px;text-transform:capitalize}.eligible-toggle{display:flex;align-items:center;gap:7px;color:var(--muted);font-size:11px;font-weight:750;white-space:nowrap}.eligible-toggle input{accent-color:var(--cyan)}.filters{display:flex;gap:6px;flex-wrap:wrap}.filter{height:38px;padding:0 12px;border:1px solid transparent;border-radius:10px;background:transparent;color:var(--muted);cursor:pointer;font-size:12px;font-weight:800}.filter.active{color:#07100f;background:var(--cyan)}.result-count{padding:0 8px;color:var(--muted);font-size:12px;white-space:nowrap}
.asset-section{margin-bottom:76px;content-visibility:auto;contain-intrinsic-size:1200px}.section-head{display:flex;align-items:end;justify-content:space-between;gap:20px;margin-bottom:22px}.section-head h2{font-size:31px;letter-spacing:-.04em;margin:0}.section-head p{margin:8px 0 0;color:var(--muted);font-size:14px}.count-badge{font:700 12px ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--cyan);border:1px solid rgba(88,243,226,.24);background:rgba(88,243,226,.06);padding:8px 11px;border-radius:999px}.asset-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px}.asset-card{border:1px solid var(--line);border-radius:var(--radius);overflow:hidden;background:linear-gradient(155deg,rgba(255,255,255,.052),rgba(255,255,255,.018));box-shadow:0 20px 55px rgba(0,0,0,.16);content-visibility:auto;contain:layout paint style;contain-intrinsic-size:420px}.asset-card:hover{transform:translateY(-3px);border-color:#47536d}.preview-shell{aspect-ratio:1.36;display:grid;place-items:center;background:radial-gradient(circle at 28% 18%,rgba(88,243,226,.1),transparent 42%),radial-gradient(circle at 76% 84%,rgba(156,124,255,.12),transparent 44%),#0a0d16;border-bottom:1px solid var(--line);overflow:hidden}.preview-shell img{width:76%;height:76%;object-fit:contain;filter:drop-shadow(0 14px 28px rgba(0,0,0,.38))}.model-shell{background:radial-gradient(circle at 50% 72%,rgba(88,243,226,.14),transparent 46%),radial-gradient(circle at 72% 18%,rgba(156,124,255,.18),transparent 40%),#0a0d16}.model-shell img{width:88%;height:88%}.texture-shell img{width:100%;height:100%;object-fit:cover}.card-body{padding:18px}.eyebrow-row{min-height:24px;display:flex;align-items:center;gap:6px;flex-wrap:wrap}.pill{display:inline-flex;align-items:center;min-height:23px;padding:3px 8px;border-radius:999px;background:rgba(156,124,255,.12);border:1px solid rgba(156,124,255,.22);color:#c8b8ff;font-size:9px;letter-spacing:.08em;text-transform:uppercase;font-weight:850}.pill.subtle{background:rgba(255,255,255,.04);border-color:rgba(255,255,255,.08);color:var(--muted)}.pill.loop{background:rgba(124,245,170,.08);border-color:rgba(124,245,170,.2);color:var(--green)}.pill.warning{background:rgba(255,190,114,.08);border-color:rgba(255,190,114,.24);color:var(--warm)}.file-type{margin-left:auto;color:#6e7a91;font:750 10px ui-monospace,SFMono-Regular,Consolas,monospace}.asset-card h3{margin:13px 0 10px;font-size:18px}.use-note{margin:0 0 13px;color:var(--muted);font-size:11px;line-height:1.5;min-height:33px}.path-row{display:flex;gap:7px}.path-row code{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:10px;background:#090c14;border:1px solid rgba(255,255,255,.06);border-radius:9px;color:#9ba8c0;font:10px ui-monospace,SFMono-Regular,Consolas,monospace}.path-row button{border:1px solid var(--line);border-radius:9px;background:rgba(255,255,255,.035);color:var(--muted);font-size:10px;font-weight:800;padding:0 10px;cursor:pointer}.download-link{display:inline-flex;align-items:center;gap:8px;margin-top:14px;color:#cbd3e4;text-decoration:none;font-size:11px;font-weight:800}.download-link:hover{color:var(--cyan)}
.audio-art{height:116px;position:relative;display:grid;place-items:center;border-bottom:1px solid var(--line);overflow:hidden;background:radial-gradient(circle at 50% 70%,rgba(156,124,255,.18),transparent 58%),#0a0d16}.music-art{background:radial-gradient(circle at 30% 80%,rgba(88,243,226,.19),transparent 52%),radial-gradient(circle at 80% 10%,rgba(156,124,255,.16),transparent 55%),#0a0d16}.waveform{position:absolute;inset:24px 18px;display:flex;align-items:center;justify-content:center;gap:6px;opacity:.75}.waveform span{width:5px;border-radius:99px;background:linear-gradient(var(--cyan),var(--violet))}.audio-glyph{position:relative;z-index:2;min-width:42px;height:42px;padding:0 8px;display:grid;place-items:center;border-radius:50%;background:rgba(7,9,17,.82);border:1px solid rgba(255,255,255,.14);font-size:11px;font-weight:850}audio{display:block;width:100%;height:38px;margin:0 0 14px}.font-specimen{height:150px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;border-bottom:1px solid var(--line);background:radial-gradient(circle at 50% 20%,rgba(255,190,114,.12),transparent 60%),#0a0d16}.specimen-big{font-size:60px;line-height:1}.specimen-line{font-size:15px;color:var(--muted)}
${fontFaceStyles(fonts)}
.empty{display:none;padding:70px 24px;text-align:center;color:var(--muted);border:1px dashed var(--line);border-radius:20px;margin-bottom:70px}.empty.visible{display:block}.pager{display:flex;align-items:center;justify-content:center;gap:16px;margin:26px 0}.pager[hidden]{display:none}.pager button{height:40px;padding:0 16px;border:1px solid var(--line);border-radius:10px;background:var(--surface);color:var(--ink);cursor:pointer}.pager button:disabled{opacity:.35;cursor:not-allowed}.pager span{color:var(--muted);font-size:12px}footer{display:flex;align-items:center;justify-content:space-between;gap:30px;padding:34px 0 48px;border-top:1px solid rgba(255,255,255,.07);color:var(--muted);font-size:12px}footer strong{color:var(--ink)}
@media(max-width:1180px){.asset-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.hero{grid-template-columns:1fr}.controls{flex-wrap:wrap}.search{flex-basis:50%}}
@media(max-width:760px){.wrap{width:min(100% - 24px,1480px)}.topbar{padding:12px 0}.top-actions .button:first-child{display:none}.hero{padding:58px 0 38px}.asset-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.controls{position:relative;top:0}.search{flex-basis:100%}.filters{overflow:auto;flex-wrap:nowrap;width:100%}.usage{align-items:flex-start;flex-direction:column}}
@media(max-width:500px){.asset-grid{grid-template-columns:1fr}.stats{grid-template-columns:repeat(2,1fr)}.category-select{flex:1}.eligible-toggle{width:100%}footer{align-items:flex-start;flex-direction:column}}
</style>
</head>
<body>
<header class="wrap topbar"><div class="brand"><span class="brand-mark" aria-hidden="true"></span><span>Remotion Production Kit</span></div><nav class="top-actions"><a class="button" href="./catalog.json">Catalog JSON</a><a class="button primary" href="./production-asset-kit.zip" download>Download full kit &#8595;</a></nav></header>
<main class="wrap">
<section class="hero"><div><span class="kicker">Original &middot; editable &middot; license notices included</span><h1>Everything your video needs to move.</h1><p class="hero-copy">A production-ready library of lightweight 3D characters, objects, icons and scene props, plus deterministic SVG art, textures, self-hosted fonts, original music, and motion sound effects. Search exact families and roles, preview one catalog page at a time, or download the complete kit.</p></div><div class="stats">${catalog.counts.models3d ? `<div class="stat"><strong>${catalog.counts.models3d}</strong><span>3D GLB models</span></div>` : ''}<div class="stat"><strong>${catalog.counts.visuals}</strong><span>SVG visuals</span></div><div class="stat"><strong>${catalog.counts.textures}</strong><span>Textures</span></div><div class="stat"><strong>${catalog.counts.music + catalog.counts.sfx}</strong><span>Music &amp; SFX</span></div><div class="stat"><strong>${catalog.counts.fonts}</strong><span>Font families</span></div></div></section>
<aside class="usage"><p>Use any path directly from a Remotion composition. GLB models and SVG previews remain local for browser, Node, and server renders.</p><code>staticFile('${escapeHtml(modelExample)}')</code></aside>
<section class="controls" aria-label="Asset filters"><label class="search"><input id="search" type="search" placeholder="Search family, style, role, mood, or category..." autocomplete="off" aria-label="Search assets"></label><select class="category-select" id="category" aria-label="Filter by category"><option value="all">All categories</option></select><label class="eligible-toggle"><input id="eligible-only" type="checkbox">Generator-ready only</label><div class="filters" role="group" aria-label="Filter by asset type"><button class="filter active" type="button" data-filter="all">All</button>${catalog.counts.models3d ? '<button class="filter" type="button" data-filter="3d">3D models</button>' : ''}<button class="filter" type="button" data-filter="visual">Visuals</button><button class="filter" type="button" data-filter="texture">Textures</button><button class="filter" type="button" data-filter="font">Fonts</button><button class="filter" type="button" data-filter="music">Music</button><button class="filter" type="button" data-filter="sfx">SFX</button></div><span class="result-count" id="result-count">Loading catalog...</span></section>
<section class="asset-section" id="library"><div class="section-head"><div><h2>Searchable asset library</h2><p>Only ${MAX_GALLERY_CARDS} matching assets are mounted at once; 3D SVG previews decode lazily.</p></div><span class="count-badge">${catalog.counts.total} total assets</span></div><div class="asset-grid" id="asset-grid" aria-live="polite"></div><div class="pager" id="pager" hidden><button id="previous-page" type="button">Previous</button><span id="page-label">Page 1</span><button id="next-page" type="button">Next</button></div></section>
<div class="empty" id="empty"><strong>No matching assets.</strong><br>Try a broader search or another filter.</div>
<noscript><p class="empty visible">JavaScript is required for the paginated gallery. The complete machine-readable inventory remains available in <a href="./catalog.json">catalog.json</a>.</p></noscript>
</main>
<footer class="wrap"><span><strong>${catalog.counts.total} assets</strong> &middot; original CC0 3D models, previews, artwork and audio plus redistributable fonts</span><span>CC0-1.0 &middot; OFL-1.1 &middot; Apache-2.0 notices included</span></footer>
<script>${galleryScript}</script>
</body>
</html>
`
}

function archiveReadme(catalog) {
	const modelExample = catalog.assets.find((asset) => asset.assetType === '3d')?.staticFilePath ?? null
	return [
		'# Remotion Production Asset Kit',
		'',
		'This archive contains ' +
			(catalog.counts.models3d ? catalog.counts.models3d + ' lightweight GLB models with matching SVG previews, ' : '') +
			catalog.counts.visuals +
			' editable SVG visuals, ' +
			catalog.counts.textures +
			' textures, sprites and environment maps, ' +
			catalog.counts.fonts +
			' font families, ' +
			catalog.counts.music +
			' loopable music beds, and ' +
			catalog.counts.sfx +
			' sound effects.',
		'',
		'## Install',
		'',
		'Extract the contents of this archive into your Remotion project public/assets directory. The existing ' +
			(catalog.counts.models3d ? '3d/, ' : '') +
			'visual/, texture/, fonts/ and audio/ paths are preserved.',
		'',
		'Use assets without the public/ prefix:',
		'',
		...(modelExample ? ["    staticFile('" + modelExample + "')"] : []),
		"    staticFile('assets/visual/v1/kinetic/burst-001.svg')",
		"    staticFile('assets/texture/v1/overlays/film-grain.png')",
		"    staticFile('assets/audio/v1/music/neon-pulse-120bpm-loop.wav')",
		'',
		'Fonts load with @remotion/fonts so a render never waits on the network:',
		'',
		"    loadFont({family: 'Anton', url: staticFile('assets/fonts/v1/anton/Anton-Regular.ttf')})",
		'',
		'- catalog.json is the combined machine-readable catalog.',
		'- ' +
			(catalog.counts.models3d ? '3d/v1/catalog.json, ' : '') +
			'visual/v1/catalog.json, texture/catalog.json, fonts/catalog.json and audio/catalog.json contain pack-specific metadata.',
		'- index.html is the searchable gallery.',
		...(catalog.counts.models3d
			? ['- Every 3D entry records its family, intended roles, triangle/node/material counts, bounds, content hash and preview hash.']
			: []),
		'- Generated ' +
			(catalog.counts.models3d ? '3D models, SVG previews, ' : '') +
			'visuals, textures and audio are CC0-1.0 and require no attribution.',
		'- Fonts are licensed per family under OFL-1.1 or Apache-2.0. Every required license text is included beside its font binary and must remain with redistributed copies.',
		'- The combined catalog records the SPDX license and license path for every asset.',
		'',
	].join('\n')
}

async function buildArchive({
	combinedCatalogText,
	galleryHtml,
	visualCatalogText,
	modelCatalogText,
	audioCatalogText,
	textureCatalogText,
	fontCatalogText,
	fontAssets,
	assets,
}) {
	const zip = new JSZip()
	const expectedFiles = new Set()
	const add = (name, contents, options = {}) => {
		if (expectedFiles.has(name)) throw new Error('Duplicate ZIP path: ' + name)
		expectedFiles.add(name)
		zip.file(name, contents, {
			...options,
			date: FIXED_ZIP_DATE,
			createFolders: false,
		})
	}

	add('README.md', archiveReadme(JSON.parse(combinedCatalogText)))
	add('index.html', galleryHtml)
	add('catalog.json', combinedCatalogText)
	add('visual/v1/catalog.json', visualCatalogText)
	add('visual/README.md', await readFile(path.join(visualRoot, 'README.md')))
	add('visual/LICENSE-VISUAL.md', await readFile(path.join(visualRoot, 'LICENSE-VISUAL.md')))
	if (modelCatalogText !== null) {
		add('3d/v1/catalog.json', modelCatalogText)
		add('3d/README.md', await readFile(path.join(modelRoot, 'README.md')))
		add('3d/LICENSE-3D.md', await readFile(path.join(modelRoot, 'LICENSE-3D.md')))
	}
	add('audio/catalog.json', audioCatalogText)
	add('audio/README.md', await readFile(path.join(audioRoot, 'README.md')))
	add('audio/LICENSE-AUDIO.md', await readFile(path.join(audioRoot, 'LICENSE-AUDIO.md')))
	add('texture/catalog.json', textureCatalogText)
	add('texture/README.md', await readFile(path.join(textureRoot, 'README.md')))
	add('texture/LICENSE-TEXTURE.md', await readFile(path.join(textureRoot, 'LICENSE-TEXTURE.md')))
	add('fonts/catalog.json', fontCatalogText)
	add('fonts/v1/fonts.css', await readFile(path.join(fontRoot, 'v1', 'fonts.css')))

	// Redistributed OFL and Apache fonts retain their exact family license text.
	for (const font of fontAssets) {
		const licenseName = font.licensePath.replace(/^\/assets\//, '')
		add(licenseName, await readFile(path.join(assetsRoot, licenseName)))
	}

	for (const asset of assets) {
		const name = asset.path.replace(/^\/assets\//, '')
		add(name, asset.contents, {
			binary: true,
			compression: 'DEFLATE',
			compressionOptions: { level: 9 },
		})
		if (asset.previewPath && asset.previewContents) {
			add(asset.previewPath.replace(/^\/assets\//, ''), asset.previewContents, {
				binary: true,
				compression: 'DEFLATE',
				compressionOptions: { level: 9 },
			})
		}
	}

	const output = await zip.generateAsync({
		type: 'nodebuffer',
		platform: 'UNIX',
		compression: 'DEFLATE',
		compressionOptions: { level: 9 },
	})
	if (output.length > MAX_ARCHIVE_BYTES) {
		throw new Error('Compressed asset archive exceeds the safe ' + formatBytes(MAX_ARCHIVE_BYTES) + ' limit: ' + formatBytes(output.length))
	}

	const reopened = await JSZip.loadAsync(output)
	const archivedFiles = Object.values(reopened.files).filter((entry) => !entry.dir)
	const svgCount = archivedFiles.filter((entry) => entry.name.endsWith('.svg')).length
	const wavCount = archivedFiles.filter((entry) => entry.name.endsWith('.wav')).length
	const pngCount = archivedFiles.filter((entry) => entry.name.endsWith('.png')).length
	const ttfCount = archivedFiles.filter((entry) => entry.name.endsWith('.ttf')).length
	const glbCount = archivedFiles.filter((entry) => entry.name.endsWith('.glb')).length
	const expectedSvgCount = assets.filter((asset) => asset.format === 'svg').length + assets.filter((asset) => asset.previewFormat === 'svg').length
	const expectedWavCount = assets.filter((asset) => asset.format === 'wav').length
	const expectedPngCount = assets.filter((asset) => asset.format === 'png').length
	const expectedTtfCount = assets.filter((asset) => asset.format === 'ttf').length
	const expectedGlbCount = assets.filter((asset) => asset.format === 'glb').length
	if (
		svgCount !== expectedSvgCount ||
		wavCount !== expectedWavCount ||
		pngCount !== expectedPngCount ||
		ttfCount !== expectedTtfCount ||
		glbCount !== expectedGlbCount
	) {
		throw new Error(
			'ZIP asset counts are wrong: ' +
				glbCount + ' GLB, ' + svgCount + ' SVG, ' + wavCount + ' WAV, ' + pngCount + ' PNG, ' + ttfCount + ' TTF',
		)
	}
	for (const name of expectedFiles) {
		if (!reopened.file(name)) throw new Error('ZIP is missing expected file: ' + name)
	}
	if (archivedFiles.length !== expectedFiles.size) {
		throw new Error('ZIP contains an unexpected number of files')
	}

	return { output, fileCount: archivedFiles.length, glbCount, svgCount, wavCount, pngCount, ttfCount }
}

async function main() {
	// The 3D pack is generated on demand rather than committed (see .gitignore),
	// so the kit is built with it when it happens to be present and without it
	// when it is not. An absent pack reproduces what the kit has always shipped:
	// the published catalog has never carried a 3D entry.
	const has3d = await stat(modelCatalogPath).then(
		() => true,
		() => false,
	)
	const [
		visualCatalog,
		modelCatalog,
		audioCatalog,
		textureCatalog,
		fontCatalog,
		visualCatalogText,
		modelCatalogText,
		audioCatalogText,
		textureCatalogText,
		fontCatalogText,
	] = await Promise.all([
		loadCatalog(visualCatalogPath),
		has3d ? loadCatalog(modelCatalogPath) : null,
		loadCatalog(audioCatalogPath),
		loadCatalog(textureCatalogPath),
		loadCatalog(fontCatalogPath),
		readFile(visualCatalogPath, 'utf8'),
		has3d ? readFile(modelCatalogPath, 'utf8') : null,
		readFile(audioCatalogPath, 'utf8'),
		readFile(textureCatalogPath, 'utf8'),
		readFile(fontCatalogPath, 'utf8'),
	])
	const [visualAssets, modelAssets, audioAssets, textureAssets, fontAssets] = await Promise.all([
		normalizeVisualAssets(visualCatalog),
		has3d ? normalizeModelAssets(modelCatalog) : [],
		normalizeAudioAssets(audioCatalog),
		normalizeTextureAssets(textureCatalog),
		normalizeFontAssets(fontCatalog),
	])
	const allAssets = [...modelAssets, ...visualAssets, ...textureAssets, ...fontAssets, ...audioAssets]
	const ids = new Set(allAssets.map((asset) => asset.id))
	if (ids.size !== allAssets.length) throw new Error('Combined catalog contains duplicate IDs')
	const archivePaths = allAssets.flatMap((asset) => [asset.path, ...(asset.previewPath ? [asset.previewPath] : [])])
	const paths = new Set(archivePaths)
	if (paths.size !== archivePaths.length) throw new Error('Combined catalog contains duplicate public or preview paths')

	const musicCount = audioAssets.filter((asset) => asset.kind === 'music').length
	const sfxCount = audioAssets.filter((asset) => asset.kind === 'sfx').length
	const totalAssetBytes = allAssets.reduce((total, asset) => total + asset.contents.length + (asset.previewContents?.length ?? 0), 0)
	const categoryCounts = {}
	for (const asset of allAssets) {
		categoryCounts[asset.category] = (categoryCounts[asset.category] ?? 0) + 1
	}
	const licenses = [...new Set(allAssets.map((asset) => asset.license).filter(Boolean))].sort()
	const fontLicenses = [...new Set(fontAssets.map((asset) => asset.license).filter(Boolean))].sort()

	const combinedCatalog = {
		schemaVersion: 3,
		packVersion: '3.0.0',
		generatedBy: 'scripts/build-asset-library.mjs',
		title: 'Remotion Production Asset Kit',
		description:
			'Original lightweight GLB characters, objects, icons and scene props with SVG previews, editable SVG visuals, generated textures, self-hosted OFL and Apache fonts, loopable music beds, and deterministic production sound effects.',
		license: 'mixed',
		licenses,
		fontLicenses,
		attributionRequired: allAssets.some((asset) => asset.attributionRequired === true),
		licenseFilesRequired: fontAssets.length > 0,
		downloadPath: '/assets/production-asset-kit.zip',
		sourceCatalogs: [
			...(has3d
				? [{ kind: '3d', path: '/assets/3d/v1/catalog.json', packVersion: modelCatalog.packVersion, assetCount: modelAssets.length }]
				: []),
			{ kind: 'visual', path: '/assets/visual/v1/catalog.json', packVersion: visualCatalog.packVersion, assetCount: visualAssets.length },
			{ kind: 'texture', path: '/assets/texture/catalog.json', packVersion: textureCatalog.packVersion, assetCount: textureAssets.length },
			{ kind: 'font', path: '/assets/fonts/catalog.json', packVersion: fontCatalog.packVersion, assetCount: fontAssets.length },
			{ kind: 'audio', path: '/assets/audio/catalog.json', packVersion: audioCatalog.packVersion, assetCount: audioAssets.length },
		],
		...(has3d ? { modelFamilies: modelCatalog.families ?? [] } : {}),
		visualFamilies: visualCatalog.families ?? [],
		audioFamilies: audioCatalog.families ?? [],
		counts: {
			total: allAssets.length,
			totalFiles: archivePaths.length,
			...(has3d ? { models3d: modelAssets.length, modelPreviews: modelAssets.length } : {}),
			visuals: visualAssets.length,
			textures: textureAssets.length,
			fonts: fontAssets.length,
			audio: audioAssets.length,
			music: musicCount,
			sfx: sfxCount,
			byCategory: categoryCounts,
		},
		totalAssetBytes,
		gallery: { pageSize: MAX_GALLERY_CARDS, initialCardCount: 0, lazyPreviews: true },
		assets: allAssets.map(publicAsset),
	}
	const combinedCatalogText = json(combinedCatalog)
	const galleryHtml = makeGallery(combinedCatalog)
	const libraryReadmeText = archiveReadme(combinedCatalog) + '\n'
	const initialGalleryCardCount = (galleryHtml.match(/<article\b/gi) ?? []).length
	if (initialGalleryCardCount > MAX_GALLERY_CARDS) {
		throw new Error('Gallery mounts too many initial cards: ' + initialGalleryCardCount)
	}
	const archive = await buildArchive({
		combinedCatalogText,
		galleryHtml,
		visualCatalogText,
		modelCatalogText,
		audioCatalogText,
		textureCatalogText,
		fontCatalogText,
		fontAssets,
		assets: allAssets,
	})

	if (process.argv.includes('--verify-only')) {
		const [existingCatalog, existingGallery, existingReadme, existingArchive] = await Promise.all([
			readFile(combinedCatalogPath, 'utf8'),
			readFile(galleryPath, 'utf8'),
			readFile(libraryReadmePath, 'utf8'),
			readFile(archivePath),
		])
		if (existingCatalog !== combinedCatalogText) throw new Error('Combined asset catalog is stale; run npm run assets:library')
		if (existingGallery !== galleryHtml) throw new Error('Asset gallery is stale; run npm run assets:library')
		if (existingReadme !== libraryReadmeText) throw new Error('Asset library README is stale; run npm run assets:library')
		if (!existingArchive.equals(archive.output)) throw new Error('Asset archive is stale; run npm run assets:library')
		console.log(
			'verified combined library: ' + combinedCatalog.counts.total + ' assets, ' + archive.fileCount + ' archive files, ' + formatBytes(archive.output.length),
		)
		return
	}

	await Promise.all([
		writeFile(combinedCatalogPath, combinedCatalogText, 'utf8'),
		writeFile(galleryPath, galleryHtml, 'utf8'),
		writeFile(libraryReadmePath, libraryReadmeText, 'utf8'),
		writeFile(archivePath, archive.output),
	])

	console.log('catalog -> public/assets/catalog.json (' + combinedCatalog.counts.total + ' assets)')
	console.log('gallery -> public/assets/index.html')
	console.log('readme -> public/assets/README.md')
	console.log(
		'archive -> public/assets/production-asset-kit.zip (' +
			archive.fileCount +
			' files, ' +
			formatBytes(archive.output.length) +
			' compressed from ' +
			formatBytes(totalAssetBytes) +
			' raw asset bytes)',
	)
	console.log(
		'verified ' +
			archive.glbCount + ' GLB + ' + archive.svgCount + ' SVG + ' + archive.pngCount + ' PNG + ' + archive.ttfCount + ' TTF + ' + archive.wavCount + ' WAV in archive',
	)
}

main().catch((error) => {
	console.error(error)
	process.exit(1)
})
