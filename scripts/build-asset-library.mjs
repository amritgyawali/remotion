#!/usr/bin/env node

/**
 * Build the public production asset library.
 *
 * Reads the independently generated visual and audio catalogs, validates every
 * referenced file, then creates:
 *   - public/assets/catalog.json
 *   - public/assets/index.html
 *   - public/assets/production-asset-kit.zip
 *
 * This script is deterministic: it intentionally writes no timestamps.
 */

import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const assetsRoot = path.join(root, 'public', 'assets')
const visualRoot = path.join(assetsRoot, 'visual')
const audioRoot = path.join(assetsRoot, 'audio')
const textureRoot = path.join(assetsRoot, 'texture')
const fontRoot = path.join(assetsRoot, 'fonts')
const visualCatalogPath = path.join(visualRoot, 'v1', 'catalog.json')
const audioCatalogPath = path.join(audioRoot, 'catalog.json')
const textureCatalogPath = path.join(textureRoot, 'catalog.json')
const fontCatalogPath = path.join(fontRoot, 'catalog.json')
const combinedCatalogPath = path.join(assetsRoot, 'catalog.json')
const galleryPath = path.join(assetsRoot, 'index.html')
const archivePath = path.join(assetsRoot, 'production-asset-kit.zip')

const EXPECTED_VISUALS = 41
const EXPECTED_AUDIO = 28
const EXPECTED_TEXTURES = 20
const EXPECTED_FONTS = 10
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

function categoryLabel(category) {
	return category
		.split('-')
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(' ')
}

async function loadCatalog(file) {
	return JSON.parse(await readFile(file, 'utf8'))
}

async function normalizeVisualAssets(catalog) {
	if (!Array.isArray(catalog.assets) || catalog.assets.length !== EXPECTED_VISUALS) {
		throw new Error('Expected ' + EXPECTED_VISUALS + ' visual assets, found ' + (catalog.assets?.length ?? 0))
	}

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

			return {
				id: 'visual:' + asset.id,
				sourceId: asset.id,
				assetType: 'visual',
				kind: 'visual',
				category: asset.category,
				name: asset.name,
				title: asset.title,
				path: asset.path,
				staticFilePath: staticFilePath(asset.path),
				format: 'svg',
				mimeType: 'image/svg+xml',
				license: catalog.license,
				attributionRequired: false,
				tags: [asset.category, asset.name, 'editable', 'vector'],
				sizeBytes: contents.length,
				sha256: sha256(contents),
				absolutePath,
				contents,
			}
		}),
	)
}

async function normalizeAudioAssets(catalog) {
	if (!Array.isArray(catalog.assets) || catalog.assets.length !== EXPECTED_AUDIO) {
		throw new Error('Expected ' + EXPECTED_AUDIO + ' audio assets, found ' + (catalog.assets?.length ?? 0))
	}

	return Promise.all(
		catalog.assets.map(async (asset) => {
			if (!asset.file.endsWith('.wav') || !asset.staticFilePath.endsWith('.wav')) {
				throw new Error('Audio asset is not a WAV: ' + asset.id)
			}
			const publicPath = '/' + asset.staticFilePath.replace(/^\/+/, '')
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
				staticFilePath: asset.staticFilePath,
				format: 'wav',
				mimeType: 'audio/wav',
				license: catalog.license,
				attributionRequired: catalog.attributionRequired,
				durationSeconds: asset.durationSeconds,
				durationFramesAt30Fps: asset.durationFramesAt30Fps,
				loopable: asset.loopable,
				bpm: asset.bpm,
				recommendedVolume: asset.recommendedVolume,
				tags: asset.tags,
				peakDbfs: asset.peakDbfs,
				rmsDbfs: asset.rmsDbfs,
				sizeBytes: contents.length,
				sha256: checksum,
				absolutePath,
				contents,
			}
		}),
	)
}

async function normalizeTextureAssets(catalog) {
	if (!Array.isArray(catalog.assets) || catalog.assets.length !== EXPECTED_TEXTURES) {
		throw new Error('Expected ' + EXPECTED_TEXTURES + ' textures, found ' + (catalog.assets?.length ?? 0))
	}

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
				license: catalog.license,
				attributionRequired: false,
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
	if (!Array.isArray(catalog.families) || catalog.families.length !== EXPECTED_FONTS) {
		throw new Error('Expected ' + EXPECTED_FONTS + ' font families, found ' + (catalog.families?.length ?? 0))
	}

	return Promise.all(
		catalog.families.map(async (family) => {
			const relativeToAssets = family.path.replace(/^\/assets\//, '')
			const absolutePath = path.join(assetsRoot, relativeToAssets)
			const contents = await readFile(absolutePath)
			// Every OFL family must keep its licence next to the binary.
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

function publicAsset(asset) {
	const { absolutePath, contents, ...entry } = asset
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
			"<span class='file-type'>TTF · OFL</span></div>",
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

function makeGallery(catalog) {
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
		"<meta name='description' content='Browse and download 41 editable SVG visuals and 13 original music and sound assets for Remotion videos.'>",
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
		"<section class='hero'><div><span class='kicker'>Original · Editable · CC0 + OFL fonts</span><h1>Everything your video needs to move.</h1><p class='hero-copy'>A production-ready library of editable SVG objects, grain and matcap textures, 3D environment maps, self-hosted variable fonts, original music loops, and precision sound effects. Preview everything here, copy its exact path, or download the complete kit.</p></div><div class='stats'><div class='stat'><strong>" + catalog.counts.visuals + "</strong><span>SVG visuals</span></div><div class='stat'><strong>" + catalog.counts.textures + "</strong><span>Textures</span></div><div class='stat'><strong>" + (catalog.counts.music + catalog.counts.sfx) + "</strong><span>Music &amp; SFX</span></div><div class='stat'><strong>" + catalog.counts.fonts + "</strong><span>Font families</span></div></div></section>",
		"<aside class='usage'><p>Use any path directly from your Remotion composition. Shared assets are served locally and travel with local and server renders.</p><code>staticFile('assets/visual/v1/objects/phone.svg')</code></aside>",
		"<section class='controls' aria-label='Asset filters'><label class='search'><span class='sr-only'></span><input id='search' type='search' placeholder='Search assets, moods, and categories…' autocomplete='off' aria-label='Search assets'></label><div class='filters' role='group' aria-label='Filter by asset type'><button class='filter active' type='button' data-filter='all'>All</button><button class='filter' type='button' data-filter='visual'>Visuals</button><button class='filter' type='button' data-filter='texture'>Textures</button><button class='filter' type='button' data-filter='font'>Fonts</button><button class='filter' type='button' data-filter='music'>Music</button><button class='filter' type='button' data-filter='sfx'>SFX</button></div><span class='result-count' id='result-count'>" + catalog.counts.total + ' assets</span></section>',
		"<section class='asset-section' data-section><div class='section-head'><div><h2>Visual production kit</h2><p>Objects, icons, arrows, neon elements, geometry, and browser-safe dimensional art.</p></div><span class='count-badge'>" + visuals.length + " SVG</span></div><div class='asset-grid'>" + visualCards + '</div></section>',
		"<section class='asset-section' data-section><div class='section-head'><div><h2>Typography</h2><p>Self-hosted SIL Open Font License families - no network fetch at render time.</p></div><span class='count-badge'>" + fonts.length + " families</span></div><div class='asset-grid audio-grid'>" + fontCards + '</div></section>',
		"<section class='asset-section' data-section><div class='section-head'><div><h2>Textures, sprites and environments</h2><p>Grain, paper, light leaks, glow sprites, matcaps and equirectangular 3D lighting.</p></div><span class='count-badge'>" + textures.length + " PNG</span></div><div class='asset-grid'>" + textureCards + '</div></section>',
		"<section class='asset-section' data-section><div class='section-head'><div><h2>Original music beds</h2><p>Frame-aligned, loopable procedural tracks with mix-ready headroom.</p></div><span class='count-badge'>" + music.length + " WAV</span></div><div class='asset-grid audio-grid'>" + musicCards + '</div></section>',
		"<section class='asset-section' data-section><div class='section-head'><div><h2>Sound effects</h2><p>UI feedback, transitions, impacts, risers, shimmers, and closing accents.</p></div><span class='count-badge'>" + sfx.length + " WAV</span></div><div class='asset-grid audio-grid'>" + sfxCards + '</div></section>',
		"<div class='empty' id='empty'><strong>No matching assets.</strong><br>Try a broader search or select another type.</div>",
		'</main>',
		"<footer class='wrap'><span><strong>" + catalog.counts.total + " assets</strong> · Original artwork and audio, plus SIL Open Font License typefaces</span><span>CC0-1.0 assets · OFL-1.1 fonts · Attribution not required</span></footer>",
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

function archiveReadme(catalog) {
	return [
		'# Remotion Production Asset Kit',
		'',
		'This archive contains ' +
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
		'Extract the contents of this archive into your Remotion project public/assets directory. The existing visual/, texture/, fonts/ and audio/ paths are preserved.',
		'',
		'Use assets without the public/ prefix:',
		'',
		"    staticFile('assets/visual/v1/objects/phone.svg')",
		"    staticFile('assets/texture/v1/overlays/film-grain.png')",
		"    staticFile('assets/audio/v1/music/neon-pulse-120bpm-loop.wav')",
		'',
		'Fonts load with @remotion/fonts so a render never waits on the network:',
		'',
		"    loadFont({family: 'Anton', url: staticFile('assets/fonts/v1/anton/Anton-Regular.ttf')})",
		'',
		'- catalog.json is the combined machine-readable catalog.',
		'- visual/v1/catalog.json, texture/catalog.json, fonts/catalog.json and audio/catalog.json contain pack-specific metadata.',
		'- index.html is the searchable gallery.',
		'- Generated visuals, textures and audio are CC0-1.0 and require no attribution.',
		'- Fonts are SIL Open Font License 1.1; each family folder keeps its OFL.txt, which must travel with the font files.',
		'',
	].join('\n')
}

async function buildArchive({
	combinedCatalogText,
	galleryHtml,
	visualCatalogText,
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
	add('audio/catalog.json', audioCatalogText)
	add('audio/README.md', await readFile(path.join(audioRoot, 'README.md')))
	add('audio/LICENSE-AUDIO.md', await readFile(path.join(audioRoot, 'LICENSE-AUDIO.md')))
	add('texture/catalog.json', textureCatalogText)
	add('fonts/catalog.json', fontCatalogText)
	add('fonts/v1/fonts.css', await readFile(path.join(fontRoot, 'v1', 'fonts.css')))

	// The OFL requires the licence to ship with the fonts it covers.
	for (const font of fontAssets) {
		const licenseName = font.licensePath.replace(/^\/assets\//, '')
		add(licenseName, await readFile(path.join(assetsRoot, licenseName)))
	}

	for (const asset of assets) {
		const name = asset.path.replace(/^\/assets\//, '')
		add(name, asset.contents, {
			binary: true,
			compression: asset.format === 'wav' ? 'STORE' : 'DEFLATE',
			compressionOptions: asset.format === 'wav' ? undefined : { level: 9 },
		})
	}

	const output = await zip.generateAsync({
		type: 'nodebuffer',
		platform: 'UNIX',
		compression: 'DEFLATE',
		compressionOptions: { level: 9 },
	})

	const reopened = await JSZip.loadAsync(output)
	const archivedFiles = Object.values(reopened.files).filter((entry) => !entry.dir)
	const svgCount = archivedFiles.filter((entry) => entry.name.endsWith('.svg')).length
	const wavCount = archivedFiles.filter((entry) => entry.name.endsWith('.wav')).length
	const pngCount = archivedFiles.filter((entry) => entry.name.endsWith('.png')).length
	const ttfCount = archivedFiles.filter((entry) => entry.name.endsWith('.ttf')).length
	if (
		svgCount !== EXPECTED_VISUALS ||
		wavCount !== EXPECTED_AUDIO ||
		pngCount !== EXPECTED_TEXTURES ||
		ttfCount !== EXPECTED_FONTS
	) {
		throw new Error(
			'ZIP asset counts are wrong: ' +
				svgCount + ' SVG, ' + wavCount + ' WAV, ' + pngCount + ' PNG, ' + ttfCount + ' TTF',
		)
	}
	for (const name of expectedFiles) {
		if (!reopened.file(name)) throw new Error('ZIP is missing expected file: ' + name)
	}
	if (archivedFiles.length !== expectedFiles.size) {
		throw new Error('ZIP contains an unexpected number of files')
	}

	return { output, fileCount: archivedFiles.length, svgCount, wavCount, pngCount, ttfCount }
}

async function main() {
	const [
		visualCatalog,
		audioCatalog,
		textureCatalog,
		fontCatalog,
		visualCatalogText,
		audioCatalogText,
		textureCatalogText,
		fontCatalogText,
	] = await Promise.all([
		loadCatalog(visualCatalogPath),
		loadCatalog(audioCatalogPath),
		loadCatalog(textureCatalogPath),
		loadCatalog(fontCatalogPath),
		readFile(visualCatalogPath, 'utf8'),
		readFile(audioCatalogPath, 'utf8'),
		readFile(textureCatalogPath, 'utf8'),
		readFile(fontCatalogPath, 'utf8'),
	])
	const [visualAssets, audioAssets, textureAssets, fontAssets] = await Promise.all([
		normalizeVisualAssets(visualCatalog),
		normalizeAudioAssets(audioCatalog),
		normalizeTextureAssets(textureCatalog),
		normalizeFontAssets(fontCatalog),
	])
	const allAssets = [...visualAssets, ...textureAssets, ...fontAssets, ...audioAssets]
	const ids = new Set(allAssets.map((asset) => asset.id))
	if (ids.size !== allAssets.length) throw new Error('Combined catalog contains duplicate IDs')

	const musicCount = audioAssets.filter((asset) => asset.kind === 'music').length
	const sfxCount = audioAssets.filter((asset) => asset.kind === 'sfx').length
	const totalAssetBytes = allAssets.reduce((total, asset) => total + asset.contents.length, 0)
	const categoryCounts = {}
	for (const asset of allAssets) {
		categoryCounts[asset.category] = (categoryCounts[asset.category] ?? 0) + 1
	}

	const combinedCatalog = {
		schemaVersion: 1,
		packVersion: '1.0.0',
		generatedBy: 'scripts/build-asset-library.mjs',
		title: 'Remotion Production Asset Kit',
		description:
			'Original editable SVG visuals, generated textures and 3D environment maps, self-hosted OFL fonts, loopable music beds, and production sound effects.',
		license: 'CC0-1.0',
		fontLicense: 'OFL-1.1',
		attributionRequired: false,
		downloadPath: '/assets/production-asset-kit.zip',
		sourceCatalogs: [
			{ kind: 'visual', path: '/assets/visual/v1/catalog.json', assetCount: visualAssets.length },
			{ kind: 'texture', path: '/assets/texture/catalog.json', assetCount: textureAssets.length },
			{ kind: 'font', path: '/assets/fonts/catalog.json', assetCount: fontAssets.length },
			{ kind: 'audio', path: '/assets/audio/catalog.json', assetCount: audioAssets.length },
		],
		counts: {
			total: allAssets.length,
			visuals: visualAssets.length,
			textures: textureAssets.length,
			fonts: fontAssets.length,
			audio: audioAssets.length,
			music: musicCount,
			sfx: sfxCount,
			byCategory: categoryCounts,
		},
		totalAssetBytes,
		assets: allAssets.map(publicAsset),
	}
	const combinedCatalogText = json(combinedCatalog)
	const galleryHtml = makeGallery(combinedCatalog)
	const archive = await buildArchive({
		combinedCatalogText,
		galleryHtml,
		visualCatalogText,
		audioCatalogText,
		textureCatalogText,
		fontCatalogText,
		fontAssets,
		assets: allAssets,
	})

	await Promise.all([
		writeFile(combinedCatalogPath, combinedCatalogText, 'utf8'),
		writeFile(galleryPath, galleryHtml, 'utf8'),
		writeFile(archivePath, archive.output),
	])

	console.log('catalog -> public/assets/catalog.json (' + combinedCatalog.counts.total + ' assets)')
	console.log('gallery -> public/assets/index.html')
	console.log('archive -> public/assets/production-asset-kit.zip (' + archive.fileCount + ' files, ' + formatBytes(archive.output.length) + ')')
	console.log(
		'verified ' +
			archive.svgCount + ' SVG + ' + archive.pngCount + ' PNG + ' + archive.ttfCount + ' TTF + ' + archive.wavCount + ' WAV in archive',
	)
}

main().catch((error) => {
	console.error(error)
	process.exit(1)
})
