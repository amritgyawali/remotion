#!/usr/bin/env node

/**
 * Generates the studio's original, editable SVG production kit.
 *
 * No downloaded artwork or third-party icon paths are used. Every asset is
 * assembled from basic SVG geometry here, which keeps the public repository
 * safe to fork, publish and remix.
 */

import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const root = path.join(projectRoot, 'public', 'assets', 'visual', 'v1')
const catalogPath = path.join(root, 'catalog.json')

const PACK_VERSION = '2.0.0'
const LEGACY_ASSET_COUNT = 41
const VARIANTS_PER_FAMILY = 50
const MIN_PROCEDURAL_ASSETS = 1_200
const MIN_TOTAL_ASSETS = 1_240

const palette = {
	ink: '#F8FAFF',
	cyan: '#5FF4E5',
	purple: '#9678FF',
	pink: '#FF6EC7',
	blue: '#4DA3FF',
	dark: '#080A16',
}

const escapeXml = (value) =>
	value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

const svg = ({ title, body, viewBox = '0 0 512 512', defs = '', background = false }) => `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" role="img" aria-labelledby="title">
  <title id="title">${escapeXml(title)}</title>
  <defs>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="1">
      <stop stop-color="${palette.cyan}"/><stop offset="1" stop-color="${palette.purple}"/>
    </linearGradient>
    <radialGradient id="orb"><stop stop-color="${palette.ink}"/><stop offset=".28" stop-color="${palette.cyan}"/><stop offset="1" stop-color="${palette.purple}"/></radialGradient>
    <filter id="glow" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="13" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    ${defs}
  </defs>
  ${background ? `<rect width="512" height="512" rx="72" fill="${palette.dark}"/>` : ''}
  ${body}
</svg>
`

const lineIcon = (title, body) =>
	svg({
		title,
		body: `<g fill="none" stroke="url(#accent)" stroke-width="28" stroke-linecap="round" stroke-linejoin="round">${body}</g>`,
	})

const iconAssets = [
	['spark', 'Spark icon', '<path d="M256 58l34 128 128 34-128 34-34 128-34-128-128-34 128-34z"/><path d="M400 78v72M364 114h72"/>'],
	['play', 'Play icon', '<circle cx="256" cy="256" r="176"/><path fill="url(#accent)" stroke="none" d="M222 174l126 82-126 82z"/>'],
	['bolt', 'Lightning bolt icon', '<path d="M294 42L132 286h112l-26 184 162-250H268z"/>'],
	['target', 'Target icon', '<circle cx="256" cy="256" r="178"/><circle cx="256" cy="256" r="98"/><circle cx="256" cy="256" r="20" fill="url(#accent)" stroke="none"/>'],
	['chart', 'Growth chart icon', '<path d="M78 410V92M78 410h350"/><path d="M120 340l86-82 62 42 128-146"/><path d="M328 154h68v68"/>'],
	['layers', 'Layers icon', '<path d="M256 70L70 170l186 100 186-100z"/><path d="M92 250l164 88 164-88M92 330l164 88 164-88"/>'],
	['cube', 'Cube icon', '<path d="M256 54L82 150v210l174 98 174-98V150z"/><path d="M82 150l174 98 174-98M256 248v210"/>'],
	['code', 'Code brackets icon', '<path d="M190 126L70 256l120 130M322 126l120 130-120 130M294 78l-76 356"/>'],
	['cursor', 'Cursor icon', '<path d="M100 62l48 352 78-92 76 126 64-38-76-126 116-36z"/>'],
	['check', 'Check icon', '<circle cx="256" cy="256" r="186"/><path d="M152 258l72 76 142-160"/>'],
	['rocket', 'Rocket icon', '<path d="M178 310c8-130 70-218 222-250-10 148-88 218-220 230z"/><path d="M186 292l-90 22 74-76M280 376l-22 78-72-92"/><circle cx="310" cy="170" r="38"/><path d="M164 350c-50 8-82 40-90 92 52-8 84-38 90-92z"/>'],
	['sound', 'Sound icon', '<path d="M78 218h82l102-86v248l-102-86H78z"/><path d="M326 198c34 34 34 82 0 116M374 150c68 66 68 146 0 212"/>'],
].map(([name, title, body]) => ({ category: 'icons', name, title, svg: lineIcon(title, body) }))

const arrowAssets = [
	['arrow-right', 'Straight right arrow', '<path d="M50 256h380M320 146l110 110-110 110"/>'],
	['arrow-up-right', 'Up-right arrow', '<path d="M92 406L406 92M238 92h168v168"/>'],
	['arrow-curve', 'Curved flow arrow', '<path d="M58 368C160 92 332 92 430 240M318 190l112 50-42 116"/>'],
	['arrow-loop', 'Loop arrow', '<path d="M392 180a164 164 0 10 10 142M390 94l8 92-92-8"/>'],
	['chevrons', 'Forward chevrons', '<path d="M76 126l130 130L76 386M234 126l130 130-130 130M392 126l44 130-44 130"/>'],
].map(([name, title, body]) => ({ category: 'arrows', name, title, svg: lineIcon(title, body) }))

const neonAssets = [
	{
		category: 'neon',
		name: 'neon-ring',
		title: 'Neon energy ring',
		svg: svg({ title: 'Neon energy ring', background: true, body: `<circle cx="256" cy="256" r="154" fill="none" stroke="${palette.cyan}" stroke-width="18" filter="url(#glow)"/><circle cx="256" cy="256" r="118" fill="none" stroke="${palette.purple}" stroke-width="4" opacity=".9"/><circle cx="256" cy="102" r="17" fill="${palette.ink}" filter="url(#glow)"/>` }),
	},
	{
		category: 'neon',
		name: 'neon-portal',
		title: 'Neon portal',
		svg: svg({ title: 'Neon portal', background: true, body: `<ellipse cx="256" cy="262" rx="150" ry="202" fill="none" stroke="url(#accent)" stroke-width="22" filter="url(#glow)"/><ellipse cx="256" cy="262" rx="112" ry="164" fill="none" stroke="${palette.ink}" stroke-width="3" opacity=".7"/><path d="M112 418h288" stroke="${palette.cyan}" stroke-width="10" filter="url(#glow)"/>` }),
	},
	{
		category: 'neon',
		name: 'neon-bolt',
		title: 'Neon bolt',
		svg: svg({ title: 'Neon bolt', background: true, body: `<path d="M292 42L114 294h126l-22 176 180-266H274z" fill="none" stroke="${palette.pink}" stroke-width="21" stroke-linejoin="round" filter="url(#glow)"/><path d="M292 42L114 294h126l-22 176 180-266H274z" fill="none" stroke="${palette.ink}" stroke-width="5" stroke-linejoin="round"/>` }),
	},
	{
		category: 'neon',
		name: 'neon-rays',
		title: 'Neon radial rays',
		svg: svg({ title: 'Neon radial rays', background: true, body: `<g stroke="url(#accent)" stroke-width="12" stroke-linecap="round" filter="url(#glow)">${Array.from({ length: 16 }, (_, i) => `<path d="M256 62v72" transform="rotate(${i * 22.5} 256 256)"/>`).join('')}</g><circle cx="256" cy="256" r="62" fill="url(#orb)"/>` }),
	},
]

const geometryAssets = [
	['triangle', 'Gradient triangle', '<path d="M256 64L452 420H60z" fill="none" stroke="url(#accent)" stroke-width="24"/><path d="M256 142l118 214H138z" fill="url(#accent)" opacity=".18"/>'],
	['hexagon', 'Layered hexagon', '<path d="M256 52l178 102v204L256 460 78 358V154z" fill="none" stroke="url(#accent)" stroke-width="24"/><path d="M256 128l112 64v128l-112 64-112-64V192z" fill="none" stroke="#F8FAFF" stroke-width="8" opacity=".65"/>'],
	['diamond', 'Faceted diamond', '<path d="M256 40l190 172-190 260L66 212z" fill="url(#accent)" opacity=".3"/><path d="M66 212h380M256 40L154 212l102 260 102-260z" fill="none" stroke="#F8FAFF" stroke-width="12" stroke-linejoin="round"/>'],
	['orbit', 'Orbital geometry', '<circle cx="256" cy="256" r="46" fill="url(#orb)"/><g fill="none" stroke="url(#accent)" stroke-width="10"><ellipse cx="256" cy="256" rx="202" ry="82"/><ellipse cx="256" cy="256" rx="202" ry="82" transform="rotate(60 256 256)"/><ellipse cx="256" cy="256" rx="202" ry="82" transform="rotate(120 256 256)"/></g>'],
	['grid', 'Perspective grid', '<path d="M38 432h436L346 80H166zM92 346h328M126 258h260M152 170h208M166 80L38 432M226 80l-42 352M286 80l42 352M346 80l128 352" fill="none" stroke="url(#accent)" stroke-width="7" opacity=".9"/>'],
	['star', 'Geometric star', '<path d="M256 38l56 146 158 8-124 100 42 154-132-86-132 86 42-154-124-100 158-8z" fill="none" stroke="url(#accent)" stroke-width="20" stroke-linejoin="round"/>'],
].map(([name, title, body]) => ({ category: 'geometry', name, title, svg: svg({ title, body }) }))

const depthAssets = [
	['isometric-cube', 'Isometric cube', '<path d="M256 48L68 154v210l188 104 188-104V154z" fill="#121735" stroke="#F8FAFF" stroke-width="10"/><path d="M68 154l188 104 188-104-188-106z" fill="url(#accent)"/><path d="M68 154v210l188 104V258z" fill="#4DA3FF" opacity=".55"/><path d="M444 154v210L256 468V258z" fill="#9678FF" opacity=".62"/>'],
	['pyramid', 'Faceted pyramid', '<path d="M256 40L52 426h408z" fill="#10142D"/><path d="M256 40L52 426h204z" fill="#4DA3FF" opacity=".68"/><path d="M256 40l204 386H256z" fill="#9678FF" opacity=".66"/><path d="M52 426h408L256 330z" fill="#5FF4E5" opacity=".46"/><path d="M256 40L52 426h408z" fill="none" stroke="#F8FAFF" stroke-width="10"/>'],
	['prism', 'Glass prism', '<path d="M158 76L52 390l258 66L460 168z" fill="url(#accent)" opacity=".32" stroke="#F8FAFF" stroke-width="10"/><path d="M158 76l152 380M52 390l408-222M158 76l302 92" fill="none" stroke="#F8FAFF" stroke-width="8" opacity=".7"/>'],
	['wire-sphere', 'Wireframe sphere', '<circle cx="256" cy="256" r="202" fill="#0B1024" stroke="url(#accent)" stroke-width="14"/><g fill="none" stroke="#F8FAFF" stroke-width="7" opacity=".72"><ellipse cx="256" cy="256" rx="92" ry="202"/><ellipse cx="256" cy="256" rx="202" ry="78"/><path d="M91 140c100 60 230 60 330 0M91 372c100-60 230-60 330 0"/></g>'],
	['torus', '3D torus', '<ellipse cx="256" cy="256" rx="204" ry="124" fill="none" stroke="#392D76" stroke-width="70"/><ellipse cx="256" cy="236" rx="204" ry="124" fill="none" stroke="url(#accent)" stroke-width="58"/><ellipse cx="256" cy="236" rx="112" ry="52" fill="#080A16" stroke="#F8FAFF" stroke-width="8" opacity=".92"/>'],
	['steps', 'Isometric steps', '<path d="M66 374l104 60 278-160-104-60z" fill="#31266A"/><path d="M66 304l104 60 214-124-104-60z" fill="#3E6FC2"/><path d="M66 234l104 60 150-86-104-60z" fill="#5CBBC4"/><path d="M66 164l104 60 86-50-104-60z" fill="#F8FAFF"/><path d="M66 164v210l104 60V224z" fill="#182044" opacity=".9"/><g fill="none" stroke="#F8FAFF" stroke-width="8" stroke-linejoin="round"><path d="M66 164l86-50 104 60 64 34 64 32 64 34v70L170 434 66 374z"/></g>'],
].map(([name, title, body]) => ({ category: 'depth-3d', name, title, svg: svg({ title, body }) }))

const objectAssets = [
	['phone', 'Smartphone object', '<rect x="136" y="30" width="240" height="452" rx="44" fill="#11162E" stroke="url(#accent)" stroke-width="14"/><rect x="156" y="74" width="200" height="332" rx="18" fill="url(#accent)" opacity=".24"/><path d="M218 52h76M228 444h56" stroke="#F8FAFF" stroke-width="12" stroke-linecap="round"/>'],
	['laptop', 'Laptop object', '<rect x="98" y="70" width="316" height="260" rx="22" fill="#11162E" stroke="url(#accent)" stroke-width="14"/><rect x="120" y="94" width="272" height="210" fill="url(#accent)" opacity=".25"/><path d="M48 354h416l-48 72H96z" fill="#262D52" stroke="#F8FAFF" stroke-width="12" stroke-linejoin="round"/><path d="M216 382h80" stroke="#5FF4E5" stroke-width="10" stroke-linecap="round"/>'],
	['lightbulb', 'Idea lightbulb object', '<path d="M158 220c0-70 40-136 98-136s98 66 98 136c0 58-34 82-56 116h-84c-22-34-56-58-56-116z" fill="url(#accent)" opacity=".45" stroke="#F8FAFF" stroke-width="14"/><path d="M214 370h84M222 408h68M240 446h32" stroke="#5FF4E5" stroke-width="16" stroke-linecap="round"/><path d="M256 18v36M82 194H40M430 194h42M120 72l30 30M392 72l-30 30" stroke="#FF6EC7" stroke-width="14" stroke-linecap="round"/>'],
	['trophy', 'Trophy object', '<path d="M158 72h196v96c0 104-44 160-98 160s-98-56-98-160z" fill="url(#accent)" opacity=".65" stroke="#F8FAFF" stroke-width="12"/><path d="M158 112H82c0 94 36 140 106 144M354 112h76c0 94-36 140-106 144M256 328v76M174 444h164M210 404h92" fill="none" stroke="#F8FAFF" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/>'],
	['camera', 'Camera object', '<rect x="58" y="132" width="396" height="286" rx="38" fill="#11162E" stroke="url(#accent)" stroke-width="14"/><path d="M144 132l34-60h156l34 60" fill="#252C50" stroke="#F8FAFF" stroke-width="12"/><circle cx="256" cy="274" r="96" fill="#080A16" stroke="#F8FAFF" stroke-width="14"/><circle cx="256" cy="274" r="58" fill="url(#orb)"/><circle cx="402" cy="184" r="16" fill="#FF6EC7"/>'],
	['microphone', 'Microphone object', '<rect x="176" y="46" width="160" height="260" rx="80" fill="url(#accent)" opacity=".65" stroke="#F8FAFF" stroke-width="14"/><path d="M118 238v20c0 78 62 140 138 140s138-62 138-140v-20M256 398v68M180 466h152" fill="none" stroke="#F8FAFF" stroke-width="16" stroke-linecap="round"/>'],
	['planet', 'Ringed planet object', '<circle cx="256" cy="256" r="118" fill="url(#orb)"/><ellipse cx="256" cy="256" rx="222" ry="72" transform="rotate(-18 256 256)" fill="none" stroke="#F8FAFF" stroke-width="18"/><path d="M164 186c60 26 122 24 180-8M158 314c60-26 132-24 192 10" fill="none" stroke="#080A16" stroke-width="14" opacity=".48"/>'],
	['package', 'Product package object', '<path d="M256 44L70 146v220l186 102 186-102V146z" fill="#151A36" stroke="#F8FAFF" stroke-width="10"/><path d="M70 146l186 104 186-104-186-102z" fill="url(#accent)" opacity=".8"/><path d="M70 146v220l186 102V250z" fill="#4DA3FF" opacity=".5"/><path d="M442 146v220L256 468V250z" fill="#9678FF" opacity=".55"/><path d="M164 94l188 104v76" fill="none" stroke="#F8FAFF" stroke-width="10" opacity=".8"/>'],
].map(([name, title, body]) => ({ category: 'objects', name, title, svg: svg({ title, body }) }))

const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const rounded = (value) => Number(value.toFixed(2))
const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

function hashSeed(text) {
	let value = 0x811c9dc5
	for (let index = 0; index < text.length; index++) {
		value ^= text.charCodeAt(index)
		value = Math.imul(value, 0x01000193)
	}
	return value >>> 0
}

function seededRandom(seedText) {
	let state = hashSeed(seedText) || 0x6d2b79f5
	return () => {
		state += 0x6d2b79f5
		let value = state
		value = Math.imul(value ^ (value >>> 15), value | 1)
		value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
		return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296
	}
}

const between = (random, min, max) => min + (max - min) * random()
const integer = (random, min, max) => Math.floor(between(random, min, max + 1))
const polar = (cx, cy, radius, angle) => ({
	x: rounded(cx + Math.cos(angle) * radius),
	y: rounded(cy + Math.sin(angle) * radius),
})
const pointText = (points) => points.map((point) => `${point.x},${point.y}`).join(' ')
const midpoint = (a, b) => ({ x: rounded((a.x + b.x) / 2), y: rounded((a.y + b.y) / 2) })

function smoothClosedPath(points) {
	const start = midpoint(points.at(-1), points[0])
	let output = `M${start.x} ${start.y}`
	for (let index = 0; index < points.length; index++) {
		const point = points[index]
		const next = points[(index + 1) % points.length]
		const end = midpoint(point, next)
		output += `Q${point.x} ${point.y} ${end.x} ${end.y}`
	}
	return `${output}Z`
}

const STYLE_PROFILES = [
	{ id: 'aurora-glass', primary: '#42F5D7', secondary: '#756BFF', accent: '#F7FDFF', ink: '#0A1530', glow: '#53E8FF' },
	{ id: 'solar-pop', primary: '#FFB000', secondary: '#FF4D6D', accent: '#FFF4C7', ink: '#40142B', glow: '#FFD166' },
	{ id: 'ocean-paper', primary: '#00A6FB', secondary: '#00D4A8', accent: '#E8FBFF', ink: '#052A45', glow: '#7AE7FF' },
	{ id: 'orchid-ink', primary: '#C45BFF', secondary: '#FF5DA2', accent: '#FFF1FB', ink: '#261039', glow: '#E7A3FF' },
	{ id: 'forest-clay', primary: '#25A66A', secondary: '#B8D95A', accent: '#F4FFD8', ink: '#143526', glow: '#A8F0B8' },
	{ id: 'cobalt-brass', primary: '#3366FF', secondary: '#E7A93C', accent: '#FFF8DF', ink: '#111D4A', glow: '#79A3FF' },
	{ id: 'coral-mint', primary: '#FF6B63', secondary: '#52E0B5', accent: '#FFF8F0', ink: '#43202A', glow: '#FFC0A8' },
	{ id: 'mono-editorial', primary: '#F4F1E8', secondary: '#9EA3AE', accent: '#FFFFFF', ink: '#17191F', glow: '#D6D9E1' },
	{ id: 'ruby-night', primary: '#FF3158', secondary: '#7A2CFF', accent: '#FFF0F4', ink: '#230716', glow: '#FF6F91' },
	{ id: 'ice-lime', primary: '#A7FF4F', secondary: '#42D9FF', accent: '#F4FFF0', ink: '#102B35', glow: '#C8FF8A' },
	{ id: 'sand-indigo', primary: '#E8C77A', secondary: '#5267C9', accent: '#FFF9E9', ink: '#262944', glow: '#FFE7A5' },
	{ id: 'mango-sky', primary: '#FF8A34', secondary: '#4BB6FF', accent: '#FFF7E8', ink: '#183354', glow: '#FFBE73' },
	{ id: 'teal-plum', primary: '#2ED6C5', secondary: '#8B3D8F', accent: '#F2FFFC', ink: '#21324A', glow: '#85F4E8' },
	{ id: 'rose-denim', primary: '#FF7AA8', secondary: '#335C9F', accent: '#FFF2F7', ink: '#1B2A4A', glow: '#FFB5CD' },
	{ id: 'acid-violet', primary: '#D8FF2E', secondary: '#8A45FF', accent: '#FAFFE8', ink: '#24133D', glow: '#E8FF7E' },
	{ id: 'copper-cyan', primary: '#D97745', secondary: '#31D7E8', accent: '#FFF4EC', ink: '#29333A', glow: '#79EDF5' },
	{ id: 'berry-cream', primary: '#A62D68', secondary: '#F1B85B', accent: '#FFF8E8', ink: '#371B32', glow: '#F7C6DD' },
	{ id: 'jade-lavender', primary: '#17B890', secondary: '#A88BEB', accent: '#F2FFFA', ink: '#193446', glow: '#87E8CE' },
	{ id: 'vermillion-blue', primary: '#F04E35', secondary: '#2B77D1', accent: '#FFF2ED', ink: '#242846', glow: '#FF9A83' },
	{ id: 'electric-pastel', primary: '#56E8FF', secondary: '#FF82DB', accent: '#FFFFFF', ink: '#171A3B', glow: '#A6F3FF' },
]

function proceduralSvg({ title, body, style }) {
	return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-labelledby="title">
  <title id="title">${escapeXml(title)}</title>
  <defs>
    <linearGradient id="paint" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${style.primary}"/><stop offset="1" stop-color="${style.secondary}"/></linearGradient>
    <linearGradient id="paint-reverse" x1="1" y1="0" x2="0" y2="1"><stop stop-color="${style.secondary}"/><stop offset="1" stop-color="${style.primary}"/></linearGradient>
    <radialGradient id="halo"><stop stop-color="${style.accent}"/><stop offset=".34" stop-color="${style.glow}"/><stop offset="1" stop-color="${style.secondary}"/></radialGradient>
    <filter id="soft-shadow" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="0" dy="12" stdDeviation="12" flood-color="${style.ink}" flood-opacity=".24"/></filter>
    <filter id="soft-glow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="8" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>
  ${body}
</svg>
`
}

function renderBurst({ random, style }) {
	const count = integer(random, 11, 24)
	const startRadius = between(random, 58, 94)
	const rays = Array.from({ length: count }, (_, index) => {
		const angle = (index / count) * Math.PI * 2 + between(random, -0.055, 0.055)
		const inner = polar(256, 256, startRadius + between(random, -10, 12), angle)
		const outer = polar(256, 256, between(random, 146, 220), angle)
		return `<path d="M${inner.x} ${inner.y}L${outer.x} ${outer.y}" stroke="${index % 3 === 0 ? style.accent : 'url(#paint)'}" stroke-width="${rounded(between(random, 6, 18))}" stroke-linecap="round" opacity="${rounded(between(random, 0.62, 1))}"/>`
	}).join('')
	const sides = integer(random, 5, 10)
	const core = Array.from({ length: sides }, (_, index) => polar(256, 256, between(random, 42, 72), (index / sides) * Math.PI * 2))
	return `<g filter="url(#soft-shadow)">${rays}<polygon points="${pointText(core)}" fill="url(#halo)" stroke="${style.ink}" stroke-width="6"/></g>`
}

function renderRibbon({ random, style }) {
	const direction = random() > 0.5 ? 1 : -1
	const paths = Array.from({ length: integer(random, 3, 6) }, (_, index) => {
		const y = 105 + index * between(random, 48, 70)
		const bend = between(random, 42, 150) * direction * (index % 2 ? -1 : 1)
		const endY = clamp(y + between(random, -78, 78), 56, 456)
		return `<path d="M38 ${rounded(y)}C${rounded(120 + bend)} ${rounded(y - 90)},${rounded(360 - bend)} ${rounded(endY + 90)},474 ${rounded(endY)}" fill="none" stroke="${index % 2 ? 'url(#paint-reverse)' : 'url(#paint)'}" stroke-width="${rounded(between(random, 10, 28))}" stroke-linecap="round" opacity="${rounded(1 - index * 0.08)}"/>`
	}).join('')
	return `<g filter="url(#soft-shadow)">${paths}<circle cx="${rounded(between(random, 170, 342))}" cy="${rounded(between(random, 170, 342))}" r="${rounded(between(random, 12, 28))}" fill="${style.accent}"/></g>`
}

function renderOrbitFlow({ random, style }) {
	const orbitCount = integer(random, 3, 7)
	const rotation = between(random, -70, 70)
	const orbits = Array.from({ length: orbitCount }, (_, index) => {
		const rx = 92 + index * between(random, 23, 37)
		const ry = rx * between(random, 0.28, 0.62)
		return `<ellipse cx="256" cy="256" rx="${rounded(rx)}" ry="${rounded(ry)}" transform="rotate(${rounded(rotation + index * between(random, 12, 28))} 256 256)" fill="none" stroke="${index % 2 ? style.accent : 'url(#paint)'}" stroke-width="${rounded(between(random, 5, 13))}" opacity="${rounded(between(random, 0.55, 0.95))}"/>`
	}).join('')
	const nodes = Array.from({ length: integer(random, 4, 9) }, (_, index) => {
		const point = polar(256, 256, between(random, 82, 208), between(random, 0, Math.PI * 2))
		return `<circle cx="${point.x}" cy="${point.y}" r="${rounded(between(random, 8, 19))}" fill="${index % 2 ? style.primary : style.secondary}" stroke="${style.accent}" stroke-width="4"/>`
	}).join('')
	return `<g filter="url(#soft-shadow)">${orbits}<circle cx="256" cy="256" r="${rounded(between(random, 38, 68))}" fill="url(#halo)"/>${nodes}</g>`
}

function renderWaveBands({ random, style }) {
	const count = integer(random, 4, 8)
	const bands = Array.from({ length: count }, (_, band) => {
		const amplitude = between(random, 20, 62)
		const frequency = between(random, 0.8, 2.2)
		const phase = between(random, 0, Math.PI * 2)
		const baseY = 100 + (312 / Math.max(1, count - 1)) * band
		const points = Array.from({ length: 17 }, (_, index) => ({
			x: rounded(24 + index * 29),
			y: rounded(baseY + Math.sin((index / 16) * Math.PI * 2 * frequency + phase) * amplitude),
		}))
		return `<polyline points="${pointText(points)}" fill="none" stroke="${band % 2 ? 'url(#paint-reverse)' : 'url(#paint)'}" stroke-width="${rounded(between(random, 7, 18))}" stroke-linecap="round" stroke-linejoin="round" opacity="${rounded(between(random, 0.58, 1))}"/>`
	}).join('')
	return `<g filter="url(#soft-shadow)">${bands}</g>`
}

function renderBlob({ random, style }) {
	const layers = Array.from({ length: integer(random, 2, 5) }, (_, layer) => {
		const count = integer(random, 8, 15)
		const centerX = 256 + between(random, -26, 26)
		const centerY = 256 + between(random, -26, 26)
		const base = 176 - layer * 31
		const points = Array.from({ length: count }, (_, index) => polar(centerX, centerY, base * between(random, 0.7, 1.12), (index / count) * Math.PI * 2))
		return `<path d="${smoothClosedPath(points)}" fill="${layer % 2 ? 'url(#paint-reverse)' : 'url(#paint)'}" opacity="${rounded(0.26 + layer * 0.16)}" stroke="${layer === 0 ? style.ink : style.accent}" stroke-width="${layer === 0 ? 7 : 3}"/>`
	}).join('')
	return `<g filter="url(#soft-shadow)">${layers}</g>`
}

function renderPetals({ random, style }) {
	const count = integer(random, 6, 15)
	const radius = between(random, 74, 126)
	const petals = Array.from({ length: count }, (_, index) => {
		const angle = (index / count) * 360 + between(random, -7, 7)
		const center = polar(256, 256, radius, (angle / 180) * Math.PI)
		return `<ellipse cx="${center.x}" cy="${center.y}" rx="${rounded(between(random, 24, 52))}" ry="${rounded(between(random, 62, 112))}" transform="rotate(${rounded(angle + 90)} ${center.x} ${center.y})" fill="${index % 2 ? 'url(#paint)' : 'url(#paint-reverse)'}" opacity="${rounded(between(random, 0.42, 0.82))}" stroke="${style.accent}" stroke-width="3"/>`
	}).join('')
	return `<g filter="url(#soft-shadow)">${petals}<circle cx="256" cy="256" r="${rounded(between(random, 38, 66))}" fill="url(#halo)" stroke="${style.ink}" stroke-width="6"/></g>`
}

function renderLeafSprig({ random, style }) {
	const lean = between(random, -80, 80)
	const stem = `<path d="M${rounded(256 - lean * 0.45)} 462C${rounded(220 - lean)} 350,${rounded(292 + lean)} 186,${rounded(256 + lean * 0.5)} 48" fill="none" stroke="${style.ink}" stroke-width="12" stroke-linecap="round"/>`
	const leaves = Array.from({ length: integer(random, 6, 11) }, (_, index) => {
		const y = 398 - index * between(random, 30, 43)
		const side = index % 2 ? 1 : -1
		const x = 256 + lean * ((462 - y) / 414) + side * between(random, 22, 45)
		const width = between(random, 50, 92)
		const height = between(random, 25, 50)
		return `<path d="M${rounded(x)} ${rounded(y)}q${rounded(side * width)} ${rounded(-height)} ${rounded(side * width * 1.22)} ${rounded(-height * 2.1)}q${rounded(-side * width * 0.95)} ${rounded(-height * 0.16)} ${rounded(-side * width * 1.22)} ${rounded(height * 2.1)}Z" fill="${index % 3 ? 'url(#paint)' : 'url(#paint-reverse)'}" stroke="${style.accent}" stroke-width="3"/>`
	}).join('')
	return `<g filter="url(#soft-shadow)">${stem}${leaves}</g>`
}

function renderVines({ random, style }) {
	const strandCount = integer(random, 3, 6)
	const strands = Array.from({ length: strandCount }, (_, index) => {
		const x = 84 + index * (344 / Math.max(1, strandCount - 1))
		const sway = between(random, 55, 120) * (index % 2 ? 1 : -1)
		return `<path d="M${rounded(x)} 476C${rounded(x + sway)} 390,${rounded(x - sway)} 250,${rounded(x + sway * 0.55)} 42" fill="none" stroke="${index % 2 ? 'url(#paint)' : style.accent}" stroke-width="${rounded(between(random, 7, 15))}" stroke-linecap="round"/>`
	}).join('')
	const buds = Array.from({ length: integer(random, 8, 18) }, (_, index) => `<circle cx="${rounded(between(random, 64, 448))}" cy="${rounded(between(random, 64, 444))}" r="${rounded(between(random, 7, 19))}" fill="${index % 2 ? style.primary : style.secondary}" stroke="${style.accent}" stroke-width="3"/>`).join('')
	return `<g filter="url(#soft-shadow)">${strands}${buds}</g>`
}

function renderComet({ random, style }) {
	const headX = between(random, 300, 410)
	const headY = between(random, 120, 350)
	const startX = between(random, 28, 90)
	const spread = between(random, 34, 96)
	const tails = Array.from({ length: integer(random, 4, 9) }, (_, index) => `<path d="M${rounded(startX)} ${rounded(headY + between(random, -spread, spread))}C${rounded(between(random, 130, 230))} ${rounded(headY + between(random, -spread, spread))},${rounded(headX - between(random, 80, 180))} ${rounded(headY + between(random, -45, 45))},${rounded(headX)} ${rounded(headY)}" fill="none" stroke="${index % 2 ? 'url(#paint)' : style.accent}" stroke-width="${rounded(between(random, 5, 18))}" stroke-linecap="round" opacity="${rounded(between(random, 0.45, 0.92))}"/>`).join('')
	return `<g filter="url(#soft-glow)">${tails}<circle cx="${rounded(headX)}" cy="${rounded(headY)}" r="${rounded(between(random, 34, 62))}" fill="url(#halo)"/><circle cx="${rounded(headX - 8)}" cy="${rounded(headY - 10)}" r="${rounded(between(random, 8, 18))}" fill="${style.accent}" opacity=".8"/></g>`
}

function renderConstellation({ random, style }) {
	const count = integer(random, 10, 19)
	const nodes = Array.from({ length: count }, () => ({ x: rounded(between(random, 48, 464)), y: rounded(between(random, 48, 464)), r: rounded(between(random, 5, 15)) }))
	const connections = nodes.map((node, index) => {
		const next = nodes[(index + 1) % nodes.length]
		const skip = nodes[(index + integer(random, 2, Math.min(5, nodes.length - 1))) % nodes.length]
		return `<path d="M${node.x} ${node.y}L${next.x} ${next.y}M${node.x} ${node.y}L${skip.x} ${skip.y}" stroke="${index % 2 ? style.primary : style.secondary}" stroke-width="${rounded(between(random, 2, 6))}" opacity="${rounded(between(random, 0.28, 0.62))}"/>`
	}).join('')
	const stars = nodes.map((node, index) => `<circle cx="${node.x}" cy="${node.y}" r="${node.r}" fill="${index % 3 ? 'url(#halo)' : style.accent}" stroke="${style.ink}" stroke-width="${rounded(between(random, 2, 5))}"/>`).join('')
	return `<g filter="url(#soft-glow)">${connections}${stars}</g>`
}

function renderPlanetSystem({ random, style }) {
	const cx = between(random, 215, 297)
	const cy = between(random, 205, 307)
	const radius = between(random, 82, 142)
	const ringCount = integer(random, 2, 5)
	const rotation = between(random, -38, 38)
	const rings = Array.from({ length: ringCount }, (_, index) => `<ellipse cx="${rounded(cx)}" cy="${rounded(cy)}" rx="${rounded(radius * (1.35 + index * 0.2))}" ry="${rounded(radius * (0.32 + index * 0.07))}" transform="rotate(${rounded(rotation + index * 7)} ${rounded(cx)} ${rounded(cy)})" fill="none" stroke="${index % 2 ? style.accent : 'url(#paint)'}" stroke-width="${rounded(between(random, 4, 11))}" opacity="${rounded(between(random, 0.5, 0.9))}"/>`).join('')
	const moons = Array.from({ length: integer(random, 2, 5) }, (_, index) => {
		const point = polar(cx, cy, radius * between(random, 1.65, 2.15), between(random, 0, Math.PI * 2))
		return `<circle cx="${point.x}" cy="${point.y}" r="${rounded(between(random, 8, 20))}" fill="${index % 2 ? style.primary : style.secondary}" stroke="${style.accent}" stroke-width="3"/>`
	}).join('')
	return `<g filter="url(#soft-shadow)">${rings}<circle cx="${rounded(cx)}" cy="${rounded(cy)}" r="${rounded(radius)}" fill="url(#halo)" stroke="${style.ink}" stroke-width="7"/><path d="M${rounded(cx - radius * 0.72)} ${rounded(cy - radius * 0.18)}Q${rounded(cx)} ${rounded(cy + radius * 0.35)} ${rounded(cx + radius * 0.75)} ${rounded(cy - radius * 0.06)}" fill="none" stroke="${style.accent}" stroke-width="8" opacity=".72"/>${moons}</g>`
}

function renderSatellite({ random, style }) {
	const rotation = between(random, -32, 32)
	const panelWidth = between(random, 92, 142)
	const bodyWidth = between(random, 82, 126)
	const aerials = Array.from({ length: integer(random, 2, 5) }, (_, index) => {
		const angle = between(random, -145, -35) + index * between(random, 25, 58)
		const end = polar(256, 210, between(random, 95, 170), (angle / 180) * Math.PI)
		return `<path d="M256 210L${end.x} ${end.y}" stroke="${style.accent}" stroke-width="5" stroke-linecap="round"/><circle cx="${end.x}" cy="${end.y}" r="8" fill="${style.primary}"/>`
	}).join('')
	return `<g transform="rotate(${rounded(rotation)} 256 256)" filter="url(#soft-shadow)"><rect x="${rounded(256 - bodyWidth / 2)}" y="162" width="${rounded(bodyWidth)}" height="188" rx="24" fill="url(#halo)" stroke="${style.ink}" stroke-width="7"/><rect x="${rounded(256 - bodyWidth / 2 - panelWidth)}" y="196" width="${rounded(panelWidth - 14)}" height="120" rx="12" fill="url(#paint)" stroke="${style.accent}" stroke-width="5"/><rect x="${rounded(256 + bodyWidth / 2 + 14)}" y="196" width="${rounded(panelWidth - 14)}" height="120" rx="12" fill="url(#paint-reverse)" stroke="${style.accent}" stroke-width="5"/><circle cx="256" cy="254" r="30" fill="${style.ink}" opacity=".82"/>${aerials}</g>`
}

function renderBrackets({ random, style }) {
	const inset = between(random, 36, 88)
	const arm = between(random, 70, 142)
	const width = between(random, 9, 22)
	const corners = [
		`M${rounded(inset)} ${rounded(inset + arm)}V${rounded(inset)}H${rounded(inset + arm)}`,
		`M${rounded(512 - inset - arm)} ${rounded(inset)}H${rounded(512 - inset)}V${rounded(inset + arm)}`,
		`M${rounded(inset)} ${rounded(512 - inset - arm)}V${rounded(512 - inset)}H${rounded(inset + arm)}`,
		`M${rounded(512 - inset - arm)} ${rounded(512 - inset)}H${rounded(512 - inset)}V${rounded(512 - inset - arm)}`,
	]
	return `<g fill="none" stroke-linecap="round" stroke-linejoin="round" filter="url(#soft-shadow)">${corners.map((d, index) => `<path d="${d}" stroke="${index % 2 ? style.secondary : style.primary}" stroke-width="${rounded(width + index % 2 * 4)}"/>`).join('')}<rect x="${rounded(inset + arm * 0.4)}" y="${rounded(inset + arm * 0.4)}" width="${rounded(512 - 2 * inset - arm * 0.8)}" height="${rounded(512 - 2 * inset - arm * 0.8)}" rx="${rounded(between(random, 28, 96))}" stroke="${style.accent}" stroke-width="4" stroke-dasharray="${rounded(between(random, 12, 32))} ${rounded(between(random, 12, 30))}" opacity=".64"/></g>`
}

function renderCapsule({ random, style }) {
	const count = integer(random, 3, 6)
	const rotation = between(random, -55, 55)
	const capsules = Array.from({ length: count }, (_, index) => {
		const width = between(random, 210, 408) - index * 18
		const height = between(random, 54, 92)
		const y = 84 + index * (344 / Math.max(1, count - 1))
		return `<rect x="${rounded(256 - width / 2)}" y="${rounded(y - height / 2)}" width="${rounded(width)}" height="${rounded(height)}" rx="${rounded(height / 2)}" fill="${index % 2 ? 'url(#paint-reverse)' : 'url(#paint)'}" opacity="${rounded(between(random, 0.48, 0.9))}" stroke="${style.accent}" stroke-width="4"/>`
	}).join('')
	return `<g transform="rotate(${rounded(rotation)} 256 256)" filter="url(#soft-shadow)">${capsules}</g>`
}

function renderFocus({ random, style }) {
	const ringCount = integer(random, 3, 7)
	const rings = Array.from({ length: ringCount }, (_, index) => {
		const radius = 52 + index * between(random, 28, 42)
		const dash = between(random, 22, 94)
		return `<circle cx="256" cy="256" r="${rounded(radius)}" fill="none" stroke="${index % 2 ? 'url(#paint)' : style.accent}" stroke-width="${rounded(between(random, 7, 17))}" stroke-linecap="round" stroke-dasharray="${rounded(dash)} ${rounded(between(random, 14, 52))}" stroke-dashoffset="${rounded(between(random, -100, 100))}" opacity="${rounded(between(random, 0.58, 1))}"/>`
	}).join('')
	const marker = polar(256, 256, between(random, 95, 205), between(random, 0, Math.PI * 2))
	return `<g filter="url(#soft-glow)">${rings}<circle cx="256" cy="256" r="${rounded(between(random, 22, 44))}" fill="url(#halo)"/><circle cx="${marker.x}" cy="${marker.y}" r="${rounded(between(random, 9, 19))}" fill="${style.accent}"/></g>`
}

function renderTicket({ random, style }) {
	const x = between(random, 54, 92)
	const y = between(random, 80, 130)
	const width = 512 - x * 2
	const height = 512 - y * 2
	const notch = between(random, 18, 34)
	const body = `M${rounded(x + 34)} ${rounded(y)}H${rounded(x + width - 34)}Q${rounded(x + width)} ${rounded(y)} ${rounded(x + width)} ${rounded(y + 34)}V${rounded(y + height / 2 - notch)}A${rounded(notch)} ${rounded(notch)} 0 0 0 ${rounded(x + width)} ${rounded(y + height / 2 + notch)}V${rounded(y + height - 34)}Q${rounded(x + width)} ${rounded(y + height)} ${rounded(x + width - 34)} ${rounded(y + height)}H${rounded(x + 34)}Q${rounded(x)} ${rounded(y + height)} ${rounded(x)} ${rounded(y + height - 34)}V${rounded(y + height / 2 + notch)}A${rounded(notch)} ${rounded(notch)} 0 0 0 ${rounded(x)} ${rounded(y + height / 2 - notch)}V${rounded(y + 34)}Q${rounded(x)} ${rounded(y)} ${rounded(x + 34)} ${rounded(y)}Z`
	const marks = Array.from({ length: integer(random, 3, 7) }, (_, index) => `<circle cx="${rounded(x + width * (index + 1) / 8)}" cy="${rounded(y + height / 2)}" r="${rounded(between(random, 6, 14))}" fill="${index % 2 ? style.primary : style.secondary}"/>`).join('')
	return `<g filter="url(#soft-shadow)"><path d="${body}" fill="url(#paint)" opacity=".66" stroke="${style.ink}" stroke-width="7"/><path d="M${rounded(x + 45)} ${rounded(y + height / 2)}H${rounded(x + width - 45)}" stroke="${style.accent}" stroke-width="5" stroke-linecap="round" opacity=".72"/>${marks}</g>`
}

function renderBars({ random, style }) {
	const count = integer(random, 6, 13)
	const gap = between(random, 8, 17)
	const usable = 410
	const width = (usable - gap * (count - 1)) / count
	const points = []
	const bars = Array.from({ length: count }, (_, index) => {
		const height = between(random, 62, 342)
		const x = 51 + index * (width + gap)
		const y = 430 - height
		points.push({ x: rounded(x + width / 2), y: rounded(y - between(random, 18, 42)) })
		return `<rect x="${rounded(x)}" y="${rounded(y)}" width="${rounded(width)}" height="${rounded(height)}" rx="${rounded(Math.min(width / 2, between(random, 7, 20)))}" fill="${index % 2 ? 'url(#paint-reverse)' : 'url(#paint)'}" opacity="${rounded(between(random, 0.55, 0.94))}"/>`
	}).join('')
	return `<g filter="url(#soft-shadow)">${bars}<polyline points="${pointText(points)}" fill="none" stroke="${style.accent}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>${points.map((point) => `<circle cx="${point.x}" cy="${point.y}" r="8" fill="${style.ink}" stroke="${style.accent}" stroke-width="4"/>`).join('')}</g>`
}

function renderRadialData({ random, style }) {
	const ringCount = integer(random, 4, 8)
	const rings = Array.from({ length: ringCount }, (_, index) => {
		const radius = 48 + index * between(random, 24, 39)
		const circumference = Math.PI * 2 * radius
		const value = between(random, 0.2, 0.91)
		return `<circle cx="256" cy="256" r="${rounded(radius)}" fill="none" stroke="${style.ink}" stroke-width="${rounded(between(random, 8, 16))}" opacity=".14"/><circle cx="256" cy="256" r="${rounded(radius)}" fill="none" stroke="${index % 2 ? 'url(#paint)' : style.accent}" stroke-width="${rounded(between(random, 8, 16))}" stroke-linecap="round" stroke-dasharray="${rounded(circumference * value)} ${rounded(circumference)}" transform="rotate(${rounded(between(random, -170, 80))} 256 256)"/>`
	}).join('')
	const innerSides = integer(random, 5, 9)
	const inner = Array.from({ length: innerSides }, (_, index) => polar(256, 256, between(random, 22, 38), (index / innerSides) * Math.PI * 2))
	return `<g filter="url(#soft-shadow)">${rings}<polygon points="${pointText(inner)}" fill="url(#halo)"/></g>`
}

function renderTimeline({ random, style }) {
	const count = integer(random, 5, 10)
	const points = Array.from({ length: count }, (_, index) => ({
		x: rounded(52 + index * (408 / Math.max(1, count - 1))),
		y: rounded(256 + Math.sin(index * between(random, 0.7, 1.4) + between(random, -0.4, 0.4)) * between(random, 74, 145)),
	}))
	let curve = `M${points[0].x} ${points[0].y}`
	for (let index = 1; index < points.length; index++) {
		const previous = points[index - 1]
		const point = points[index]
		const midX = rounded((previous.x + point.x) / 2)
		curve += `C${midX} ${previous.y},${midX} ${point.y},${point.x} ${point.y}`
	}
	const nodes = points.map((point, index) => `<g><circle cx="${point.x}" cy="${point.y}" r="${rounded(between(random, 14, 27))}" fill="${index % 2 ? style.primary : style.secondary}" stroke="${style.accent}" stroke-width="5"/><rect x="${rounded(point.x - between(random, 25, 46))}" y="${rounded(point.y + (index % 2 ? -76 : 38))}" width="${rounded(between(random, 50, 92))}" height="${rounded(between(random, 16, 28))}" rx="9" fill="${style.ink}" opacity=".72"/></g>`).join('')
	return `<g filter="url(#soft-shadow)"><path d="${curve}" fill="none" stroke="url(#paint)" stroke-width="13" stroke-linecap="round"/>${nodes}</g>`
}

function renderNetwork({ random, style }) {
	const count = integer(random, 9, 17)
	const nodes = Array.from({ length: count }, () => ({ x: rounded(between(random, 54, 458)), y: rounded(between(random, 54, 458)), r: rounded(between(random, 10, 25)) }))
	const edges = nodes.map((node, index) => [1, integer(random, 2, Math.min(5, count - 1))].map((offset) => {
		const target = nodes[(index + offset) % count]
		return `<path d="M${node.x} ${node.y}Q${rounded((node.x + target.x) / 2 + between(random, -35, 35))} ${rounded((node.y + target.y) / 2 + between(random, -35, 35))} ${target.x} ${target.y}" fill="none" stroke="${index % 2 ? style.primary : style.secondary}" stroke-width="${rounded(between(random, 3, 8))}" opacity="${rounded(between(random, 0.28, 0.68))}"/>`
	}).join('')).join('')
	const dots = nodes.map((node, index) => `<circle cx="${node.x}" cy="${node.y}" r="${node.r}" fill="${index % 2 ? 'url(#halo)' : style.accent}" stroke="${style.ink}" stroke-width="5"/>`).join('')
	return `<g filter="url(#soft-shadow)">${edges}${dots}</g>`
}

function renderBadge({ random, style }) {
	const spikes = integer(random, 8, 18)
	const points = Array.from({ length: spikes * 2 }, (_, index) => polar(256, 256, index % 2 ? between(random, 128, 166) : between(random, 182, 222), (index / (spikes * 2)) * Math.PI * 2))
	const innerSides = integer(random, 5, 10)
	const inner = Array.from({ length: innerSides }, (_, index) => polar(256, 256, between(random, 66, 104), (index / innerSides) * Math.PI * 2 + between(random, -0.06, 0.06)))
	return `<g filter="url(#soft-shadow)"><polygon points="${pointText(points)}" fill="url(#paint)" opacity=".76" stroke="${style.ink}" stroke-width="7" stroke-linejoin="round"/><circle cx="256" cy="256" r="${rounded(between(random, 112, 145))}" fill="${style.accent}" opacity=".22" stroke="${style.accent}" stroke-width="5"/><polygon points="${pointText(inner)}" fill="url(#paint-reverse)" stroke="${style.accent}" stroke-width="5"/></g>`
}

function renderSpeech({ random, style }) {
	const count = integer(random, 2, 5)
	const bubbles = Array.from({ length: count }, (_, index) => {
		const width = between(random, 190, 330) - index * 20
		const height = between(random, 82, 142)
		const x = clamp(between(random, 38, 474 - width), 28, 484 - width)
		const y = 52 + index * (360 / Math.max(1, count - 1))
		const tailRight = random() > 0.5
		const tailX = tailRight ? x + width * 0.72 : x + width * 0.28
		return `<g><rect x="${rounded(x)}" y="${rounded(y)}" width="${rounded(width)}" height="${rounded(height)}" rx="${rounded(between(random, 24, 48))}" fill="${index % 2 ? 'url(#paint-reverse)' : 'url(#paint)'}" opacity="${rounded(between(random, 0.65, 0.94))}" stroke="${style.accent}" stroke-width="4"/><path d="M${rounded(tailX - 18)} ${rounded(y + height - 4)}L${rounded(tailX + (tailRight ? 34 : -34))} ${rounded(y + height + between(random, 28, 55))}L${rounded(tailX + 18)} ${rounded(y + height - 4)}Z" fill="${index % 2 ? style.secondary : style.primary}"/><circle cx="${rounded(x + width * 0.28)}" cy="${rounded(y + height * 0.5)}" r="8" fill="${style.accent}"/><rect x="${rounded(x + width * 0.4)}" y="${rounded(y + height * 0.43)}" width="${rounded(width * between(random, 0.25, 0.42))}" height="14" rx="7" fill="${style.ink}" opacity=".65"/></g>`
	}).join('')
	return `<g filter="url(#soft-shadow)">${bubbles}</g>`
}

function renderPointer({ random, style }) {
	const count = integer(random, 3, 7)
	const arrows = Array.from({ length: count }, (_, index) => {
		const start = { x: rounded(between(random, 48, 230)), y: rounded(between(random, 52, 460)) }
		const end = { x: rounded(between(random, 290, 464)), y: rounded(between(random, 52, 460)) }
		const bend = between(random, -95, 95)
		const angle = Math.atan2(end.y - (start.y + bend), end.x - 256)
		const left = polar(end.x, end.y, between(random, 24, 46), angle + Math.PI * 0.78)
		const right = polar(end.x, end.y, between(random, 24, 46), angle - Math.PI * 0.78)
		return `<g><path d="M${start.x} ${start.y}Q256 ${rounded(start.y + bend)} ${end.x} ${end.y}" fill="none" stroke="${index % 2 ? 'url(#paint)' : style.accent}" stroke-width="${rounded(between(random, 8, 18))}" stroke-linecap="round"/><path d="M${left.x} ${left.y}L${end.x} ${end.y}L${right.x} ${right.y}" fill="none" stroke="${index % 2 ? style.secondary : style.primary}" stroke-width="${rounded(between(random, 8, 18))}" stroke-linecap="round" stroke-linejoin="round"/></g>`
	}).join('')
	return `<g filter="url(#soft-shadow)">${arrows}</g>`
}

function renderConfetti({ random, style }) {
	const count = integer(random, 24, 52)
	const pieces = Array.from({ length: count }, (_, index) => {
		const x = between(random, 38, 474)
		const y = between(random, 38, 474)
		const rotation = between(random, 0, 360)
		const color = index % 3 === 0 ? style.accent : index % 2 ? style.primary : style.secondary
		const shape = index % 4
		if (shape === 0) return `<circle cx="${rounded(x)}" cy="${rounded(y)}" r="${rounded(between(random, 5, 15))}" fill="${color}"/>`
		if (shape === 1) return `<rect x="${rounded(x - 6)}" y="${rounded(y - 16)}" width="${rounded(between(random, 9, 18))}" height="${rounded(between(random, 20, 45))}" rx="4" transform="rotate(${rounded(rotation)} ${rounded(x)} ${rounded(y)})" fill="${color}"/>`
		if (shape === 2) {
			const size = between(random, 10, 24)
			return `<polygon points="${rounded(x)},${rounded(y - size)} ${rounded(x + size)},${rounded(y + size)} ${rounded(x - size)},${rounded(y + size)}" transform="rotate(${rounded(rotation)} ${rounded(x)} ${rounded(y)})" fill="${color}"/>`
		}
		return `<path d="M${rounded(x - 18)} ${rounded(y + 8)}Q${rounded(x)} ${rounded(y - 22)} ${rounded(x + 18)} ${rounded(y + 8)}" fill="none" stroke="${color}" stroke-width="${rounded(between(random, 5, 11))}" stroke-linecap="round"/>`
	}).join('')
	return `<g filter="url(#soft-shadow)">${pieces}</g>`
}

const PROCEDURAL_FAMILIES = [
	{ category: 'kinetic', id: 'burst', title: 'Pulse Burst', roles: ['foreground', 'transition', 'accent'], tags: ['energy', 'radial'], render: renderBurst },
	{ category: 'kinetic', id: 'ribbon', title: 'Flow Ribbon', roles: ['foreground', 'transition', 'accent'], tags: ['flow', 'sweep'], render: renderRibbon },
	{ category: 'kinetic', id: 'orbit-flow', title: 'Orbit Flow', roles: ['foreground', 'transition', 'accent'], tags: ['orbit', 'motion'], render: renderOrbitFlow },
	{ category: 'kinetic', id: 'wave-bands', title: 'Wave Bands', roles: ['foreground', 'transition', 'accent'], tags: ['wave', 'rhythm'], render: renderWaveBands },
	{ category: 'organic', id: 'blob', title: 'Organic Blob', roles: ['foreground', 'overlay', 'accent'], tags: ['organic', 'fluid'], render: renderBlob },
	{ category: 'organic', id: 'petals', title: 'Kinetic Petals', roles: ['foreground', 'accent'], tags: ['flower', 'radial'], render: renderPetals },
	{ category: 'organic', id: 'leaf-sprig', title: 'Leaf Sprig', roles: ['foreground', 'scene', 'accent'], tags: ['leaf', 'nature'], render: renderLeafSprig },
	{ category: 'organic', id: 'vines', title: 'Flowing Vines', roles: ['foreground', 'scene', 'accent'], tags: ['vine', 'nature'], render: renderVines },
	{ category: 'cosmic', id: 'comet', title: 'Motion Comet', roles: ['foreground', 'transition', 'scene'], tags: ['space', 'trail'], render: renderComet },
	{ category: 'cosmic', id: 'constellation', title: 'Constellation', roles: ['foreground', 'diagram', 'scene'], tags: ['space', 'nodes'], render: renderConstellation },
	{ category: 'cosmic', id: 'planet-system', title: 'Planet System', roles: ['foreground', 'scene'], tags: ['space', 'orbit'], render: renderPlanetSystem },
	{ category: 'cosmic', id: 'satellite', title: 'Satellite', roles: ['foreground', 'scene'], tags: ['space', 'technology'], render: renderSatellite },
	{ category: 'frames', id: 'brackets', title: 'Editorial Brackets', roles: ['foreground', 'frame', 'callout'], tags: ['frame', 'focus'], render: renderBrackets },
	{ category: 'frames', id: 'capsule', title: 'Layered Capsule', roles: ['foreground', 'frame', 'callout'], tags: ['capsule', 'label'], render: renderCapsule },
	{ category: 'frames', id: 'focus-rings', title: 'Focus Rings', roles: ['foreground', 'frame', 'callout'], tags: ['focus', 'target'], render: renderFocus },
	{ category: 'frames', id: 'ticket', title: 'Ticket Frame', roles: ['foreground', 'frame', 'callout'], tags: ['ticket', 'panel'], render: renderTicket },
	{ category: 'data', id: 'bars', title: 'Data Bars', roles: ['foreground', 'diagram', 'data'], tags: ['chart', 'growth'], render: renderBars },
	{ category: 'data', id: 'radial-data', title: 'Radial Data', roles: ['foreground', 'diagram', 'data'], tags: ['chart', 'radial'], render: renderRadialData },
	{ category: 'data', id: 'timeline', title: 'Motion Timeline', roles: ['foreground', 'diagram', 'data'], tags: ['timeline', 'progress'], render: renderTimeline },
	{ category: 'data', id: 'network', title: 'Connected Network', roles: ['foreground', 'diagram', 'data'], tags: ['network', 'nodes'], render: renderNetwork },
	{ category: 'symbols', id: 'badge', title: 'Dynamic Badge', roles: ['foreground', 'callout', 'accent'], tags: ['badge', 'award'], render: renderBadge },
	{ category: 'symbols', id: 'speech', title: 'Speech Stack', roles: ['foreground', 'callout', 'accent'], tags: ['speech', 'message'], render: renderSpeech },
	{ category: 'symbols', id: 'pointer-flow', title: 'Pointer Flow', roles: ['foreground', 'callout', 'transition'], tags: ['pointer', 'direction'], render: renderPointer },
	{ category: 'symbols', id: 'confetti', title: 'Celebration Confetti', roles: ['foreground', 'overlay', 'accent'], tags: ['celebration', 'particles'], render: renderConfetti },
]

const legacyAssets = [...iconAssets, ...arrowAssets, ...neonAssets, ...geometryAssets, ...depthAssets, ...objectAssets].map((asset) => {
	const isGrid = asset.category === 'geometry' && asset.name === 'grid'
	const roleByCategory = {
		icons: ['foreground', 'icon', 'callout'],
		arrows: ['foreground', 'transition', 'callout'],
		neon: ['foreground', 'accent'],
		geometry: ['foreground', 'diagram', 'accent'],
		'depth-3d': ['foreground', 'scene'],
		objects: ['foreground', 'scene'],
	}
	return {
		...asset,
		family: `legacy-${asset.category}`,
		styleId: asset.category === 'neon' ? 'legacy-neon-dark' : 'legacy-gradient-line',
		seed: null,
		roles: roleByCategory[asset.category],
		prohibitedRoles: isGrid ? ['background'] : [],
		tags: [asset.category, asset.name, 'legacy', 'editable', 'vector'],
		generationEligible: !isGrid,
		legacy: true,
		recipeVersion: 1,
		geometrySha256: sha256(asset.svg),
	}
})

const proceduralAssets = PROCEDURAL_FAMILIES.flatMap((family, familyIndex) =>
	Array.from({ length: VARIANTS_PER_FAMILY }, (_, variantIndex) => {
		const variant = variantIndex + 1
		const suffix = String(variant).padStart(3, '0')
		const name = `${family.id}-${suffix}`
		const seed = `visual-v2:${family.category}:${family.id}:${suffix}`
		const random = seededRandom(seed)
		const style = STYLE_PROFILES[(familyIndex * 11 + variantIndex * 7) % STYLE_PROFILES.length]
		const title = `${family.title} ${suffix}`
		const body = family.render({ random, style, variant })
		return {
			category: family.category,
			name,
			title,
			family: family.id,
			styleId: style.id,
			seed,
			roles: family.roles,
			prohibitedRoles: [],
			tags: [...family.tags, family.category, family.id, style.id, 'procedural', 'editable', 'vector', 'non-grid'],
			generationEligible: true,
			legacy: false,
			recipeVersion: 2,
			geometrySha256: sha256(body),
			svg: proceduralSvg({ title, body, style }),
		}
	}),
)

const assets = [...legacyAssets, ...proceduralAssets].map((asset) => {
	const relativePath = `${asset.category}/${asset.name}.svg`
	const contents = Buffer.from(asset.svg, 'utf8')
	return {
		...asset,
		relativePath,
		sizeBytes: contents.length,
		sha256: sha256(contents),
		contents,
	}
})

function publicAsset(asset) {
	return {
		id: `${asset.category}/${asset.name}`,
		category: asset.category,
		name: asset.name,
		title: asset.title,
		family: asset.family,
		styleId: asset.styleId,
		seed: asset.seed,
		roles: asset.roles,
		prohibitedRoles: asset.prohibitedRoles,
		tags: asset.tags,
		generationEligible: asset.generationEligible,
		legacy: asset.legacy,
		recipeVersion: asset.recipeVersion,
		path: `/assets/visual/v1/${asset.relativePath}`,
		staticFilePath: `assets/visual/v1/${asset.relativePath}`,
		format: 'svg',
		mimeType: 'image/svg+xml',
		viewBox: '0 0 512 512',
		license: 'CC0-1.0',
		licensePath: '/assets/visual/LICENSE-VISUAL.md',
		attributionRequired: false,
		sizeBytes: asset.sizeBytes,
		sha256: asset.sha256,
		geometrySha256: asset.geometrySha256,
	}
}

function makeCatalog() {
	const totalBytes = assets.reduce((total, asset) => total + asset.sizeBytes, 0)
	const familyCounts = Object.fromEntries(PROCEDURAL_FAMILIES.map((family) => [family.id, VARIANTS_PER_FAMILY]))
	const categoryCounts = {}
	for (const asset of assets) categoryCounts[asset.category] = (categoryCounts[asset.category] ?? 0) + 1
	return {
		schemaVersion: 2,
		version: 1,
		packVersion: PACK_VERSION,
		generatedBy: 'scripts/generate-visual-assets.mjs',
		license: 'CC0-1.0',
		licensePath: '/assets/visual/LICENSE-VISUAL.md',
		attributionRequired: false,
		generated: true,
		sourceMaterial: 'Original procedural SVG geometry only; no third-party artwork or icon paths.',
		description: 'Original editable SVG assets generated deterministically from project-owned geometry recipes.',
		assetCount: assets.length,
		legacyAssetCount: legacyAssets.length,
		proceduralAssetCount: proceduralAssets.length,
		variantsPerFamily: VARIANTS_PER_FAMILY,
		families: PROCEDURAL_FAMILIES.map((family) => ({
			id: family.id,
			category: family.category,
			prefix: `/assets/visual/v1/${family.category}/${family.id}-`,
			pathTemplate: `/assets/visual/v1/${family.category}/${family.id}-{variant}.svg`,
			firstVariant: '001',
			lastVariant: String(VARIANTS_PER_FAMILY).padStart(3, '0'),
			count: VARIANTS_PER_FAMILY,
			recommendedRoles: family.roles,
			generationEligible: true,
			tags: family.tags,
		})),
		counts: { byCategory: categoryCounts, byProceduralFamily: familyCounts },
		totalBytes,
		assets: assets.map(publicAsset),
	}
}

function validateDefinitions(catalog) {
	if (legacyAssets.length !== LEGACY_ASSET_COUNT) throw new Error(`Expected ${LEGACY_ASSET_COUNT} legacy visuals, found ${legacyAssets.length}`)
	if (proceduralAssets.length < MIN_PROCEDURAL_ASSETS) throw new Error(`Expected at least ${MIN_PROCEDURAL_ASSETS} procedural visuals, found ${proceduralAssets.length}`)
	if (assets.length < MIN_TOTAL_ASSETS) throw new Error(`Expected at least ${MIN_TOTAL_ASSETS} total visuals, found ${assets.length}`)
	if (catalog.assetCount !== catalog.assets.length || catalog.assetCount !== assets.length) throw new Error('Visual catalog count is inconsistent')
	if (catalog.families.length !== PROCEDURAL_FAMILIES.length) throw new Error('Visual family index is incomplete')
	for (const family of catalog.families) {
		const matching = catalog.assets.filter((asset) => !asset.legacy && asset.category === family.category && asset.family === family.id)
		if (matching.length !== family.count || family.count !== VARIANTS_PER_FAMILY) {
			throw new Error(`${family.category}/${family.id}: family count is inconsistent`)
		}
		if (!family.generationEligible || family.recommendedRoles.includes('background')) {
			throw new Error(`${family.category}/${family.id}: invalid generation roles`)
		}
	}

	for (const [label, values] of [
		['ID', catalog.assets.map((asset) => asset.id)],
		['path', catalog.assets.map((asset) => asset.path)],
		['file SHA-256', catalog.assets.map((asset) => asset.sha256)],
		['geometry SHA-256', catalog.assets.map((asset) => asset.geometrySha256)],
	]) {
		if (new Set(values).size !== values.length) throw new Error(`Duplicate visual ${label}`)
	}

	const grid = catalog.assets.find((asset) => asset.id === 'geometry/grid')
	if (!grid || grid.generationEligible !== false || !grid.prohibitedRoles.includes('background')) {
		throw new Error('Legacy geometry/grid must be preserved but prohibited as a generated background')
	}
	if (catalog.assets.filter((asset) => !asset.legacy && asset.tags.includes('grid')).length > 0) {
		throw new Error('Procedural visual pack must not generate grid assets')
	}
}

async function listSvgFiles(directory, prefix = '') {
	const entries = await readdir(directory, { withFileTypes: true })
	const files = []
	for (const entry of entries) {
		const relative = prefix ? `${prefix}/${entry.name}` : entry.name
		if (entry.isDirectory()) files.push(...await listSvgFiles(path.join(directory, entry.name), relative))
		else if (entry.isFile() && entry.name.endsWith('.svg')) files.push(relative)
	}
	return files.sort()
}

async function verifyOnly() {
	const expectedCatalog = makeCatalog()
	validateDefinitions(expectedCatalog)
	const expectedCatalogText = `${JSON.stringify(expectedCatalog, null, 2)}\n`
	const actualCatalogText = await readFile(catalogPath, 'utf8')
	if (actualCatalogText !== expectedCatalogText) throw new Error('Visual catalog is stale; regenerate with npm run assets:visual')

	const expectedPaths = assets.map((asset) => asset.relativePath).sort()
	const actualPaths = await listSvgFiles(root)
	const missing = expectedPaths.filter((file) => !actualPaths.includes(file))
	const orphans = actualPaths.filter((file) => !expectedPaths.includes(file))
	if (missing.length > 0) throw new Error(`Missing visual files: ${missing.slice(0, 8).join(', ')}`)
	if (orphans.length > 0) throw new Error(`Orphan visual files: ${orphans.slice(0, 8).join(', ')}`)

	for (const asset of assets) {
		const actual = await readFile(path.join(root, asset.relativePath))
		if (!actual.equals(asset.contents)) throw new Error(`${asset.relativePath}: contents do not match deterministic generator`)
		if (actual.length !== asset.sizeBytes) throw new Error(`${asset.relativePath}: size does not match catalog`)
		if (sha256(actual) !== asset.sha256) throw new Error(`${asset.relativePath}: SHA-256 does not match catalog`)
		if (!actual.toString('utf8', 0, 256).includes('<svg')) throw new Error(`${asset.relativePath}: missing SVG root`)
	}

	console.log(`verified ${assets.length} deterministic SVG visuals (${proceduralAssets.length} procedural + ${legacyAssets.length} legacy)`)
}

async function generate() {
	const catalog = makeCatalog()
	validateDefinitions(catalog)
	await rm(root, { recursive: true, force: true })
	for (const category of new Set(assets.map((asset) => asset.category))) {
		await mkdir(path.join(root, category), { recursive: true })
	}
	for (const asset of assets) {
		await writeFile(path.join(root, asset.relativePath), asset.contents)
	}
	await writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8')
	console.log(
		`Generated ${assets.length} original SVG assets (${proceduralAssets.length} procedural + ${legacyAssets.length} legacy, ${(catalog.totalBytes / 1_000_000).toFixed(2)} MB) in ${path.relative(projectRoot, root)}`,
	)
}

const verifyOnlyMode = process.argv.includes('--verify-only')
;(verifyOnlyMode ? verifyOnly() : generate()).catch((error) => {
	console.error(`\n${error instanceof Error ? error.message : error}\n`)
	process.exit(1)
})
