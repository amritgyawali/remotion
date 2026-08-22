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

const SOURCE = 'https://raw.githubusercontent.com/google/fonts/main'
const PACK_VERSION = '2.0.0'

/**
 * One family per typographic job. Variable files are preferred so a single
 * download covers the whole weight range.
 */
/**
 * The typography kit.
 *
 * One family per typographic job, and then a deliberate surplus of display and
 * novelty faces on top: a subtitle is the loudest element in most videos, and
 * "which font" is the single biggest stylistic decision the studio hands its
 * user. Variable files are preferred where they exist, so one download covers a
 * whole weight range; where a family only ships statics, the weight that reads
 * best burned into video is the one bundled.
 *
 * `dir` is the licence folder in google/fonts - `ofl` (SIL Open Font License,
 * the default) or `apache` (Apache 2.0). Both permit bundling; each family
 * keeps its own licence file next to the font. `devanagari: true` marks the
 * faces that can actually draw Nepali and Hindi, which is what lets the studio
 * offer them as companions instead of shipping tofu boxes.
 */
const FAMILIES = [
	/* --- Workhorse text faces ------------------------------------------------- */
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
		slug: 'montserrat',
		family: 'Montserrat',
		source: 'montserrat',
		file: 'Montserrat[wght].ttf',
		category: 'sans',
		weight: '100 900',
		axes: ['wght'],
		mood: 'geometric, confident, familiar',
		useFor: 'brand videos, titles, captions that must feel mainstream',
	},
	{
		slug: 'poppins',
		family: 'Poppins',
		source: 'poppins',
		file: 'Poppins-Bold.ttf',
		category: 'sans',
		weight: '700',
		axes: [],
		mood: 'geometric, round, high contrast at size',
		useFor: 'social captions, product hooks, youthful brands',
	},
	{
		slug: 'outfit',
		family: 'Outfit',
		source: 'outfit',
		file: 'Outfit[wght].ttf',
		category: 'sans',
		weight: '100 900',
		axes: ['wght'],
		mood: 'clean geometric, very even colour',
		useFor: 'startup explainers, clean lower thirds',
	},
	{
		slug: 'sora',
		family: 'Sora',
		source: 'sora',
		file: 'Sora[wght].ttf',
		category: 'sans',
		weight: '100 800',
		axes: ['wght'],
		mood: 'technical humanist with squared bowls',
		useFor: 'AI and fintech explainers, data storytelling',
	},
	{
		slug: 'plus-jakarta-sans',
		family: 'Plus Jakarta Sans',
		source: 'plusjakartasans',
		file: 'PlusJakartaSans[wght].ttf',
		category: 'sans',
		weight: '200 800',
		axes: ['wght'],
		mood: 'friendly geometric, wide language coverage',
		useFor: 'app promos, onboarding, multilingual captions',
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
		slug: 'fredoka',
		family: 'Fredoka',
		source: 'fredoka',
		file: 'Fredoka[wdth,wght].ttf',
		category: 'rounded',
		weight: '300 700',
		axes: ['wdth', 'wght'],
		mood: 'chunky, rounded, cheerful',
		useFor: 'kids content, playful brands, reaction captions',
	},
	/* --- Condensed and news --------------------------------------------------- */
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
		slug: 'barlow-condensed',
		family: 'Barlow Condensed',
		source: 'barlowcondensed',
		file: 'BarlowCondensed-Bold.ttf',
		category: 'condensed',
		weight: '700',
		axes: [],
		mood: 'narrow grotesk, technical',
		useFor: 'dense subtitles, sports scoreboards, tight vertical frames',
	},
	{
		slug: 'staatliches',
		family: 'Staatliches',
		source: 'staatliches',
		file: 'Staatliches-Regular.ttf',
		category: 'condensed',
		weight: '400',
		axes: [],
		mood: 'poster caps, slightly rough',
		useFor: 'event promos, gig posters, hype captions',
	},
	{
		slug: 'kanit',
		family: 'Kanit',
		source: 'kanit',
		file: 'Kanit-Bold.ttf',
		category: 'condensed',
		weight: '700',
		axes: [],
		mood: 'loud sans with a slight slant',
		useFor: 'sports, gym, motivational edits',
	},
	{
		slug: 'khand',
		family: 'Khand',
		source: 'khand',
		file: 'Khand-Bold.ttf',
		category: 'condensed',
		weight: '700',
		axes: [],
		devanagari: true,
		mood: 'condensed display that also writes Devanagari',
		useFor: 'Nepali and Hindi sports or news captions',
	},
	/* --- Impact and display --------------------------------------------------- */
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
		slug: 'archivo-black',
		family: 'Archivo Black',
		source: 'archivoblack',
		file: 'ArchivoBlack-Regular.ttf',
		category: 'display',
		weight: '400',
		axes: [],
		mood: 'solid black grotesk',
		useFor: 'statement captions, brand stings, callouts',
	},
	{
		slug: 'alfa-slab-one',
		family: 'Alfa Slab One',
		source: 'alfaslabone',
		file: 'AlfaSlabOne-Regular.ttf',
		category: 'display',
		weight: '400',
		axes: [],
		mood: 'fat slab serif, circus poster',
		useFor: 'retro hooks, sale videos, loud storytelling',
	},
	{
		slug: 'titan-one',
		family: 'Titan One',
		source: 'titanone',
		file: 'TitanOne-Regular.ttf',
		category: 'display',
		weight: '400',
		axes: [],
		mood: 'inflated cartoon weight',
		useFor: 'gaming, kids, meme captions',
	},
	{
		slug: 'lilita-one',
		family: 'Lilita One',
		source: 'lilitaone',
		file: 'LilitaOne-Regular.ttf',
		category: 'display',
		weight: '400',
		axes: [],
		mood: 'punchy rounded caps',
		useFor: 'mobile-first captions, quiz and list videos',
	},
	{
		slug: 'rowdies',
		family: 'Rowdies',
		source: 'rowdies',
		file: 'Rowdies-Bold.ttf',
		category: 'display',
		weight: '700',
		axes: [],
		mood: 'stencil-ish, energetic',
		useFor: 'street, music and skate edits',
	},
	{
		slug: 'bangers',
		family: 'Bangers',
		source: 'bangers',
		file: 'Bangers-Regular.ttf',
		category: 'comic',
		weight: '400',
		axes: [],
		mood: 'comic book shout',
		useFor: 'reaction videos, meme subtitles, action beats',
	},
	{
		slug: 'luckiest-guy',
		family: 'Luckiest Guy',
		dir: 'apache',
		source: 'luckiestguy',
		file: 'LuckiestGuy-Regular.ttf',
		category: 'comic',
		weight: '400',
		axes: [],
		mood: 'cartoon brush caps',
		useFor: 'kids, gaming, playful hooks',
	},
	{
		slug: 'chewy',
		family: 'Chewy',
		dir: 'apache',
		source: 'chewy',
		file: 'Chewy-Regular.ttf',
		category: 'comic',
		weight: '400',
		axes: [],
		mood: 'soft bubbly comic',
		useFor: 'family content, food, light-hearted captions',
	},
	{
		slug: 'bungee',
		family: 'Bungee',
		source: 'bungee',
		file: 'Bungee-Regular.ttf',
		category: 'display',
		weight: '400',
		axes: [],
		mood: 'urban signage, built for stacking',
		useFor: 'street style, vertical captions, city footage',
	},
	{
		slug: 'bungee-shade',
		family: 'Bungee Shade',
		source: 'bungeeshade',
		file: 'BungeeShade-Regular.ttf',
		category: 'display',
		weight: '400',
		axes: [],
		mood: 'signage with a built-in 3D shadow',
		useFor: 'title cards and one-word hooks that need no effects',
	},
	{
		slug: 'rubik-mono-one',
		family: 'Rubik Mono One',
		source: 'rubikmonoone',
		file: 'RubikMonoOne-Regular.ttf',
		category: 'display',
		weight: '400',
		axes: [],
		mood: 'monospaced slab, very heavy',
		useFor: 'techno, crypto, brutalist edits',
	},
	{
		slug: 'shrikhand',
		family: 'Shrikhand',
		source: 'shrikhand',
		file: 'Shrikhand-Regular.ttf',
		category: 'display',
		weight: '400',
		axes: [],
		mood: 'juicy display with an Indian poster feel',
		useFor: 'food, festival and music captions',
	},
	/* --- Editorial serifs ----------------------------------------------------- */
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
		slug: 'abril-fatface',
		family: 'Abril Fatface',
		source: 'abrilfatface',
		file: 'AbrilFatface-Regular.ttf',
		category: 'serif',
		weight: '400',
		axes: [],
		mood: 'high-contrast magazine display',
		useFor: 'editorial hooks, beauty, luxury product',
	},
	{
		slug: 'dm-serif-display',
		family: 'DM Serif Display',
		source: 'dmserifdisplay',
		file: 'DMSerifDisplay-Regular.ttf',
		category: 'serif',
		weight: '400',
		axes: [],
		mood: 'refined transitional display',
		useFor: 'documentary titles, interviews, premium captions',
	},
	{
		slug: 'cinzel',
		family: 'Cinzel',
		source: 'cinzel',
		file: 'Cinzel[wght].ttf',
		category: 'serif',
		weight: '400 900',
		axes: ['wght'],
		mood: 'roman inscriptional caps',
		useFor: 'trailers, history, epic and cinematic titles',
	},
	/* --- Tech, retro and terminal --------------------------------------------- */
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
		slug: 'syne',
		family: 'Syne',
		source: 'syne',
		file: 'Syne[wght].ttf',
		category: 'tech',
		weight: '400 800',
		axes: ['wght'],
		mood: 'art-gallery grotesk with odd widths',
		useFor: 'design, music and fashion edits',
	},
	{
		slug: 'unbounded',
		family: 'Unbounded',
		source: 'unbounded',
		file: 'Unbounded[wght].ttf',
		category: 'tech',
		weight: '200 900',
		axes: ['wght'],
		mood: 'wide geometric, very contemporary',
		useFor: 'web3, product launches, bold statements',
	},
	{
		slug: 'orbitron',
		family: 'Orbitron',
		source: 'orbitron',
		file: 'Orbitron[wght].ttf',
		category: 'tech',
		weight: '400 900',
		axes: ['wght'],
		mood: 'square sci-fi',
		useFor: 'gaming, motorsport, HUD-style captions',
	},
	{
		slug: 'audiowide',
		family: 'Audiowide',
		source: 'audiowide',
		file: 'Audiowide-Regular.ttf',
		category: 'tech',
		weight: '400',
		axes: [],
		mood: 'chrome-era sci-fi display',
		useFor: 'esports, synthwave, tech reveals',
	},
	{
		slug: 'monoton',
		family: 'Monoton',
		source: 'monoton',
		file: 'Monoton-Regular.ttf',
		category: 'retro',
		weight: '400',
		axes: [],
		mood: 'neon tube lettering, inline stripes',
		useFor: 'neon signage looks, music and nightlife',
	},
	{
		slug: 'righteous',
		family: 'Righteous',
		source: 'righteous',
		file: 'Righteous-Regular.ttf',
		category: 'retro',
		weight: '400',
		axes: [],
		mood: 'art-deco geometric',
		useFor: 'retro titles, podcasts, lifestyle',
	},
	{
		slug: 'press-start-2p',
		family: 'Press Start 2P',
		source: 'pressstart2p',
		file: 'PressStart2P-Regular.ttf',
		category: 'pixel',
		weight: '400',
		axes: [],
		mood: '8-bit arcade pixels',
		useFor: 'retro gaming, speedruns, chiptune edits',
	},
	{
		slug: 'silkscreen',
		family: 'Silkscreen',
		source: 'silkscreen',
		file: 'Silkscreen-Regular.ttf',
		category: 'pixel',
		weight: '400',
		axes: [],
		mood: 'tiny crisp pixel face',
		useFor: 'UI overlays, glitch aesthetics, HUD labels',
	},
	{
		slug: 'vt323',
		family: 'VT323',
		source: 'vt323',
		file: 'VT323-Regular.ttf',
		category: 'mono',
		weight: '400',
		axes: [],
		mood: 'CRT terminal',
		useFor: 'hacker aesthetics, terminal recordings, horror edits',
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
		slug: 'courier-prime',
		family: 'Courier Prime',
		source: 'courierprime',
		file: 'CourierPrime-Regular.ttf',
		category: 'mono',
		weight: '400',
		axes: [],
		mood: 'screenplay typewriter',
		useFor: 'film scripts, documentary quotes, typewriter reveals',
	},
	{
		slug: 'special-elite',
		family: 'Special Elite',
		dir: 'apache',
		source: 'specialelite',
		file: 'SpecialElite-Regular.ttf',
		category: 'mono',
		weight: '400',
		axes: [],
		mood: 'battered typewriter with ink noise',
		useFor: 'true crime, vintage, found-footage edits',
	},
	{
		slug: 'rubik-glitch',
		family: 'Rubik Glitch',
		source: 'rubikglitch',
		file: 'RubikGlitch-Regular.ttf',
		category: 'retro',
		weight: '400',
		axes: [],
		mood: 'broken scanline distortion, baked in',
		useFor: 'glitch transitions, error states, horror',
	},
	{
		slug: 'rubik-wet-paint',
		family: 'Rubik Wet Paint',
		source: 'rubikwetpaint',
		file: 'RubikWetPaint-Regular.ttf',
		category: 'retro',
		weight: '400',
		axes: [],
		mood: 'dripping paint display',
		useFor: 'street art, music drops, halloween',
	},
	/* --- Script and handwriting ----------------------------------------------- */
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
	{
		slug: 'permanent-marker',
		family: 'Permanent Marker',
		dir: 'apache',
		source: 'permanentmarker',
		file: 'PermanentMarker-Regular.ttf',
		category: 'handwriting',
		weight: '400',
		axes: [],
		mood: 'thick marker pen',
		useFor: 'callouts, meme captions, whiteboard energy',
	},
	{
		slug: 'pacifico',
		family: 'Pacifico',
		source: 'pacifico',
		file: 'Pacifico-Regular.ttf',
		category: 'script',
		weight: '400',
		axes: [],
		mood: 'surf brush script',
		useFor: 'travel, food, summer and lifestyle edits',
	},
	{
		slug: 'lobster',
		family: 'Lobster',
		source: 'lobster',
		file: 'Lobster-Regular.ttf',
		category: 'script',
		weight: '400',
		axes: [],
		mood: 'bold connected script',
		useFor: 'restaurant, retro brand, warm storytelling',
	},
	{
		slug: 'sedgwick-ave',
		family: 'Sedgwick Ave',
		source: 'sedgwickave',
		file: 'SedgwickAve-Regular.ttf',
		category: 'handwriting',
		weight: '400',
		axes: [],
		mood: 'graffiti marker',
		useFor: 'hip hop, street culture, skate videos',
	},
	/* --- Devanagari (Nepali and Hindi) ---------------------------------------- */
	{
		slug: 'noto-sans-devanagari',
		family: 'Noto Sans Devanagari',
		source: 'notosansdevanagari',
		file: 'NotoSansDevanagari[wdth,wght].ttf',
		category: 'devanagari',
		weight: '100 900',
		axes: ['wdth', 'wght'],
		devanagari: true,
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
		devanagari: true,
		mood: 'contemporary, condensed, display-ready',
		useFor: 'loud Nepali social captions, titles and hooks',
	},
	{
		slug: 'noto-serif-devanagari',
		family: 'Noto Serif Devanagari',
		source: 'notoserifdevanagari',
		file: 'NotoSerifDevanagari[wdth,wght].ttf',
		category: 'devanagari',
		weight: '100 900',
		axes: ['wdth', 'wght'],
		devanagari: true,
		mood: 'serif Devanagari with true contrast',
		useFor: 'documentary, literary and news Nepali captions',
	},
	{
		slug: 'mukta',
		family: 'Mukta',
		source: 'mukta',
		file: 'Mukta-Bold.ttf',
		category: 'devanagari',
		weight: '700',
		axes: [],
		devanagari: true,
		mood: 'humanist Devanagari, very even',
		useFor: 'general Nepali and Hindi subtitles at any size',
	},
	{
		slug: 'hind',
		family: 'Hind',
		source: 'hind',
		file: 'Hind-Bold.ttf',
		category: 'devanagari',
		weight: '700',
		axes: [],
		devanagari: true,
		mood: 'compact Devanagari built for screens',
		useFor: 'dense Nepali captions, news tickers',
	},
	{
		slug: 'baloo-2',
		family: 'Baloo 2',
		source: 'baloo2',
		file: 'Baloo2[wght].ttf',
		category: 'devanagari',
		weight: '400 800',
		axes: ['wght'],
		devanagari: true,
		mood: 'rounded, warm, display-friendly',
		useFor: 'playful Nepali captions, kids and lifestyle',
	},
	{
		slug: 'rozha-one',
		family: 'Rozha One',
		source: 'rozhaone',
		file: 'RozhaOne-Regular.ttf',
		category: 'devanagari',
		weight: '400',
		axes: [],
		devanagari: true,
		mood: 'high-contrast Devanagari display',
		useFor: 'Nepali film titles, festival and poster captions',
	},
	{
		slug: 'yatra-one',
		family: 'Yatra One',
		source: 'yatraone',
		file: 'YatraOne-Regular.ttf',
		category: 'devanagari',
		weight: '400',
		axes: [],
		devanagari: true,
		mood: 'brush-cut Devanagari display',
		useFor: 'Nepali music, travel and street content',
	},
	{
		slug: 'kalam',
		family: 'Kalam',
		source: 'kalam',
		file: 'Kalam-Bold.ttf',
		category: 'devanagari',
		weight: '700',
		axes: [],
		devanagari: true,
		mood: 'handwritten Devanagari and Latin',
		useFor: 'personal vlogs, notes, informal Nepali captions',
	},
	{
		slug: 'tiro-devanagari-hindi',
		family: 'Tiro Devanagari Hindi',
		source: 'tirodevanagarihindi',
		file: 'TiroDevanagariHindi-Regular.ttf',
		category: 'devanagari',
		weight: '400',
		axes: [],
		devanagari: true,
		mood: 'classical calligraphic Devanagari',
		useFor: 'literature, poetry, historical documentary',
	},
	{
		slug: 'martel-sans',
		family: 'Martel Sans',
		source: 'martelsans',
		file: 'MartelSans-Bold.ttf',
		category: 'devanagari',
		weight: '700',
		axes: [],
		devanagari: true,
		mood: 'sturdy Devanagari sans',
		useFor: 'interviews and explainers in Nepali or Hindi',
	},
	{
		slug: 'teko',
		family: 'Teko',
		source: 'teko',
		file: 'Teko[wght].ttf',
		category: 'devanagari',
		weight: '300 700',
		axes: ['wght'],
		devanagari: true,
		mood: 'condensed Devanagari and Latin display',
		useFor: 'Nepali sports, hype and scoreboard captions',
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

		// Apache families keep LICENSE.txt where OFL families keep OFL.txt, and
		// the licence has to travel with the font either way.
		const dir = entry.dir ?? 'ofl'
		const licenseFile = dir === 'apache' ? 'LICENSE.txt' : 'OFL.txt'
		const base = `${SOURCE}/${dir}/${entry.source}`
		const wanted = [
			{ name: entry.file, url: `${base}/${encodeURIComponent(entry.file)}` },
			{ name: licenseFile, url: `${base}/${licenseFile}` },
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
			devanagari: entry.devanagari === true,
			licensePath: `/assets/fonts/v1/${entry.slug}/${licenseFile}`,
			license: dir === 'apache' ? 'Apache-2.0' : 'OFL-1.1',
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
					'Self-hosted open-licence families covering every common video typography job, plus display, retro and Devanagari faces for subtitles.',
				license: 'OFL-1.1 and Apache-2.0',
				attributionRequired: false,
				source: 'https://github.com/google/fonts',
				cssPath: '/assets/fonts/v1/fonts.css',
				counts: {
					families: catalogEntries.length,
					variable: catalogEntries.filter((entry) => entry.variable).length,
					devanagari: catalogEntries.filter((entry) => entry.devanagari).length,
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
