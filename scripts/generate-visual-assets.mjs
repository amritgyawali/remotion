#!/usr/bin/env node

/**
 * Generates the studio's original, editable SVG production kit.
 *
 * No downloaded artwork or third-party icon paths are used. Every asset is
 * assembled from basic SVG geometry here, which keeps the public repository
 * safe to fork, publish and remix.
 */

import path from 'node:path'
import { mkdir, rm, writeFile } from 'node:fs/promises'

const root = path.resolve(process.cwd(), 'public', 'assets', 'visual', 'v1')

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

const assets = [...iconAssets, ...arrowAssets, ...neonAssets, ...geometryAssets, ...depthAssets, ...objectAssets]

await rm(root, { recursive: true, force: true })
await mkdir(root, { recursive: true })

for (const asset of assets) {
	const directory = path.join(root, asset.category)
	await mkdir(directory, { recursive: true })
	await writeFile(path.join(directory, `${asset.name}.svg`), asset.svg, 'utf8')
}

const catalog = {
	version: 1,
	license: 'CC0-1.0',
	generated: true,
	description: 'Original editable SVG assets generated from basic geometry by this project.',
	assets: assets.map(({ category, name, title }) => ({
		id: `${category}/${name}`,
		category,
		name,
		title,
		path: `/assets/visual/v1/${category}/${name}.svg`,
		format: 'svg',
	})),
}

await writeFile(path.join(root, 'catalog.json'), `${JSON.stringify(catalog, null, 2)}\n`, 'utf8')

console.log(`Generated ${assets.length} original SVG assets in ${path.relative(process.cwd(), root)}`)
