import fontCatalog from '../../public/assets/fonts/catalog.json'

/**
 * Shared catalogue of the production asset kit that ships in /public/assets.
 *
 * The AI director picks ids from these tables and the composer turns the ids
 * into literal `staticFile('assets/…/v1/…')` calls. Keeping the catalogue in
 * one place means a storyboard can never reference a file that is not deployed.
 */

export type FontId = string

export type FontEntry = {
	id: FontId
	slug: string
	family: string
	file: string
	weight: string
	fallback: string
	use: string
	category: string
	mood: string
	devanagari: boolean
}

type CatalogFont = (typeof fontCatalog.families)[number]

/** Keep the readable camelCase ids used by the storyboard while deriving every
 * path and capability from the downloaded, hash-locked font catalog. */
const fontId = (slug: string): FontId => slug.replace(/-([a-z0-9])/g, (_, letter: string) => letter.toUpperCase())

const fontFallback = (font: CatalogFont): string => {
	if (font.category === 'serif') return 'Georgia, Times New Roman, serif'
	if (font.category === 'mono' || font.category === 'pixel') return 'ui-monospace, Consolas, monospace'
	if (font.category === 'handwriting' || font.category === 'script') return 'Segoe Script, cursive'
	if (font.category === 'condensed') return 'Arial Narrow, Arial, sans-serif'
	return 'Arial, Helvetica, sans-serif'
}

export const FONT_KIT: Record<FontId, FontEntry> = Object.fromEntries(
	fontCatalog.families.map((font) => {
		const id = fontId(font.slug)
		return [
			id,
			{
				id,
				slug: font.slug,
				family: font.family,
				file: font.staticFilePath.replace(/^assets\/fonts\/v1\//, ''),
				weight: font.weight,
				fallback: fontFallback(font),
				use: font.useFor,
				category: font.category,
				mood: font.mood,
				devanagari: font.devanagari,
			} satisfies FontEntry,
		]
	}),
)

export const FONT_IDS = Object.keys(FONT_KIT) as FontId[]

/** Useful to the local director when it needs a fresh but compatible pairing. */
export const FONT_IDS_BY_CATEGORY = Object.fromEntries(
	[...new Set(Object.values(FONT_KIT).map((font) => font.category))].map((category) => [
		category,
		FONT_IDS.filter((id) => FONT_KIT[id].category === category),
	]),
) as Record<string, FontId[]>

if (FONT_IDS.length < 64) {
	throw new Error(`The AI typography kit expected at least 64 local families, found ${FONT_IDS.length}.`)
}

export type MusicId =
	| 'ambientCalm'
	| 'cinematicOrbit'
	| 'corporateClean'
	| 'epicCinematic'
	| 'lofiChill'
	| 'neonPulse'
	| 'tensionDrone'
	| 'warmInspiration'

export const MUSIC_KIT: Record<MusicId, { file: string; bpm: number; use: string }> = {
	ambientCalm: { file: 'music/ambient-calm-70bpm-loop.wav', bpm: 70, use: 'calm, reflective, wellness' },
	cinematicOrbit: { file: 'music/cinematic-orbit-80bpm-loop.wav', bpm: 80, use: 'cinematic, space, discovery' },
	corporateClean: { file: 'music/corporate-clean-112bpm-loop.wav', bpm: 112, use: 'business, SaaS, explainer' },
	epicCinematic: { file: 'music/epic-cinematic-88bpm-loop.wav', bpm: 88, use: 'history, epic, trailer' },
	lofiChill: { file: 'music/lofi-chill-84bpm-loop.wav', bpm: 84, use: 'lofi, casual, creator' },
	neonPulse: { file: 'music/neon-pulse-120bpm-loop.wav', bpm: 120, use: 'neon, tech, hype, sport' },
	tensionDrone: { file: 'music/tension-drone-72bpm-loop.wav', bpm: 72, use: 'tension, mystery, problem framing' },
	warmInspiration: { file: 'music/warm-inspiration-96bpm-loop.wav', bpm: 96, use: 'uplifting, travel, brand' },
}

export const MUSIC_IDS = Object.keys(MUSIC_KIT) as MusicId[]

export type SfxId =
	| 'whooshFast'
	| 'whooshDeep'
	| 'riserDigital'
	| 'riserOrganic'
	| 'subDrop'
	| 'glitch'
	| 'impactClean'
	| 'impactDeep'
	| 'impactSnap'
	| 'impactBoom'
	| 'chimeSparkle'
	| 'logoStinger'
	| 'powerUp'
	| 'revealShimmer'
	| 'clickSoft'
	| 'popClean'
	| 'swipe'
	| 'tick'
	| 'typewriter'
	| 'notification'

export const SFX_KIT: Record<SfxId, string> = {
	whooshFast: 'sfx/transitions/whoosh-fast.wav',
	whooshDeep: 'sfx/transitions/whoosh-deep.wav',
	riserDigital: 'sfx/transitions/riser-digital.wav',
	riserOrganic: 'sfx/transitions/riser-organic.wav',
	subDrop: 'sfx/transitions/sub-drop.wav',
	glitch: 'sfx/transitions/glitch.wav',
	impactClean: 'sfx/impacts/impact-clean.wav',
	impactDeep: 'sfx/impacts/impact-deep.wav',
	impactSnap: 'sfx/impacts/impact-snap.wav',
	impactBoom: 'sfx/impacts/impact-boom-tail.wav',
	chimeSparkle: 'sfx/accents/chime-sparkle.wav',
	logoStinger: 'sfx/accents/logo-stinger.wav',
	powerUp: 'sfx/accents/power-up.wav',
	revealShimmer: 'sfx/accents/reveal-shimmer.wav',
	clickSoft: 'sfx/ui/click-soft.wav',
	popClean: 'sfx/ui/pop-clean.wav',
	swipe: 'sfx/ui/swipe.wav',
	tick: 'sfx/ui/tick.wav',
	typewriter: 'sfx/ui/typewriter.wav',
	notification: 'sfx/ui/notification-bright.wav',
}

/** Compact indexes for the large raw packs. Importing the 1,800-entry public
 * catalog into the browser composer would add needless weight; these family
 * contracts mirror the generator catalogs and make every variant addressable. */
export const SFX_VARIANT_KIT = {
	'ui-click': { category: 'ui', variants: 36, volume: 0.34 },
	'ui-pop': { category: 'ui', variants: 36, volume: 0.36 },
	'ui-notification': { category: 'ui', variants: 36, volume: 0.32 },
	'ui-key': { category: 'ui', variants: 36, volume: 0.28 },
	'motion-whoosh': { category: 'motion', variants: 36, volume: 0.38 },
	'motion-swipe': { category: 'motion', variants: 36, volume: 0.32 },
	'transition-glitch': { category: 'transitions', variants: 36, volume: 0.35 },
	'transition-riser': { category: 'transitions', variants: 36, volume: 0.34 },
	'transition-drop': { category: 'transitions', variants: 36, volume: 0.38 },
	'impact-hit': { category: 'impacts', variants: 36, volume: 0.42 },
	'impact-boom': { category: 'impacts', variants: 36, volume: 0.42 },
	'accent-chime': { category: 'accents', variants: 36, volume: 0.31 },
	'accent-shimmer': { category: 'accents', variants: 36, volume: 0.31 },
	'accent-power': { category: 'accents', variants: 36, volume: 0.33 },
	'foley-touch': { category: 'foley', variants: 36, volume: 0.3 },
} as const

export type SfxVariantFamilyId = keyof typeof SFX_VARIANT_KIT

export const SFX_LEGACY_FAMILY: Record<SfxId, SfxVariantFamilyId> = {
	whooshFast: 'motion-whoosh',
	whooshDeep: 'motion-whoosh',
	riserDigital: 'transition-riser',
	riserOrganic: 'transition-riser',
	subDrop: 'transition-drop',
	glitch: 'transition-glitch',
	impactClean: 'impact-hit',
	impactDeep: 'impact-boom',
	impactSnap: 'impact-hit',
	impactBoom: 'impact-boom',
	chimeSparkle: 'accent-chime',
	logoStinger: 'accent-chime',
	powerUp: 'accent-power',
	revealShimmer: 'accent-shimmer',
	clickSoft: 'ui-click',
	popClean: 'ui-pop',
	swipe: 'motion-swipe',
	tick: 'ui-key',
	typewriter: 'ui-key',
	notification: 'ui-notification',
}

function wrapVariantIndex(value: number, count: number): number {
	if (!Number.isFinite(value)) return 0
	return ((Math.trunc(value) % count) + count) % count
}

/** `variantIndex` is zero-based and wraps, so any stable hash is accepted. */
export function sfxVariantPath(family: SfxVariantFamilyId, variantIndex: number): string {
	const entry = SFX_VARIANT_KIT[family]
	const variant = wrapVariantIndex(variantIndex, entry.variants) + 1
	const suffix = String(variant).padStart(3, '0')
	return `sfx/variants/${entry.category}/${family}/${family}-v${suffix}.wav`
}

export const VISUAL_FAMILY_KIT = {
	burst: { category: 'kinetic', roles: ['foreground', 'transition', 'accent'] },
	ribbon: { category: 'kinetic', roles: ['foreground', 'transition', 'accent'] },
	'orbit-flow': { category: 'kinetic', roles: ['foreground', 'transition', 'accent'] },
	'wave-bands': { category: 'kinetic', roles: ['foreground', 'transition', 'accent'] },
	blob: { category: 'organic', roles: ['foreground', 'overlay', 'accent'] },
	petals: { category: 'organic', roles: ['foreground', 'accent'] },
	'leaf-sprig': { category: 'organic', roles: ['foreground', 'scene', 'accent'] },
	vines: { category: 'organic', roles: ['foreground', 'scene', 'accent'] },
	comet: { category: 'cosmic', roles: ['foreground', 'transition', 'scene'] },
	constellation: { category: 'cosmic', roles: ['foreground', 'diagram', 'scene'] },
	'planet-system': { category: 'cosmic', roles: ['foreground', 'scene'] },
	satellite: { category: 'cosmic', roles: ['foreground', 'scene'] },
	brackets: { category: 'frames', roles: ['foreground', 'frame', 'callout'] },
	capsule: { category: 'frames', roles: ['foreground', 'frame', 'callout'] },
	'focus-rings': { category: 'frames', roles: ['foreground', 'frame', 'callout'] },
	ticket: { category: 'frames', roles: ['foreground', 'frame', 'callout'] },
	bars: { category: 'data', roles: ['foreground', 'diagram', 'data'] },
	'radial-data': { category: 'data', roles: ['foreground', 'diagram', 'data'] },
	timeline: { category: 'data', roles: ['foreground', 'diagram', 'data'] },
	network: { category: 'data', roles: ['foreground', 'diagram', 'data'] },
	badge: { category: 'symbols', roles: ['foreground', 'callout', 'accent'] },
	speech: { category: 'symbols', roles: ['foreground', 'callout', 'accent'] },
	'pointer-flow': { category: 'symbols', roles: ['foreground', 'callout', 'transition'] },
	confetti: { category: 'symbols', roles: ['foreground', 'overlay', 'accent'] },
} as const

export type VisualFamilyId = keyof typeof VISUAL_FAMILY_KIT
export const VISUAL_FAMILY_IDS = Object.keys(VISUAL_FAMILY_KIT) as VisualFamilyId[]

/** `variantIndex` is zero-based and wraps across the 50 raw SVG variants. */
export function visualVariantPath(family: VisualFamilyId, variantIndex: number): string {
	const variant = wrapVariantIndex(variantIndex, 50) + 1
	const suffix = String(variant).padStart(3, '0')
	return `${VISUAL_FAMILY_KIT[family].category}/${family}-${suffix}.svg`
}

export type GrainId = 'film' | 'fine' | 'paper' | 'halftone' | 'scanlines' | 'soft' | 'none'

export const GRAIN_KIT: Record<Exclude<GrainId, 'none'>, string> = {
	film: 'overlays/film-grain.png',
	fine: 'overlays/grain-fine.png',
	paper: 'overlays/paper-fiber.png',
	halftone: 'overlays/halftone-dots.png',
	scanlines: 'overlays/scanlines.png',
	soft: 'overlays/noise-soft.png',
}

export const GRAIN_IDS: GrainId[] = ['film', 'fine', 'paper', 'halftone', 'scanlines', 'soft', 'none']

export type LeakId = 'warm' | 'cool' | 'none'

export const LEAK_KIT: Record<Exclude<LeakId, 'none'>, string> = {
	warm: 'overlays/light-leak-warm.png',
	cool: 'overlays/light-leak-cool.png',
}

export const VIGNETTE_TEXTURE = 'overlays/vignette.png'

export type PaletteId =
	| 'midnight'
	| 'ember'
	| 'heritage'
	| 'neon'
	| 'forest'
	| 'mono'
	| 'paper'
	| 'azure'
	| 'sunrise'
	| 'slate'
	| 'royal'
	| 'arctic'

export type Palette = {
	background: string
	backgroundAlt: string
	surface: string
	ink: string
	muted: string
	accent: string
	accentAlt: string
	glow: string
	scheme: 'dark' | 'light'
	use: string
}

export const PALETTES: Record<PaletteId, Palette> = {
	midnight: {
		background: '#05070F',
		backgroundAlt: '#0B1225',
		surface: '#131C33',
		ink: '#F2F6FF',
		muted: '#9AA8C7',
		accent: '#5FF4E5',
		accentAlt: '#9678FF',
		glow: '#5FF4E5',
		scheme: 'dark',
		use: 'cinematic tech, AI, space, default dark',
	},
	ember: {
		background: '#140A05',
		backgroundAlt: '#2A1206',
		surface: '#3A1B0A',
		ink: '#FFF3E6',
		muted: '#D6AE8C',
		accent: '#FF9B3D',
		accentAlt: '#FF4D3D',
		glow: '#FF9B3D',
		scheme: 'dark',
		use: 'desert, warm light, energy, adventure',
	},
	heritage: {
		background: '#120E0B',
		backgroundAlt: '#241A12',
		surface: '#33241A',
		ink: '#F6EBDA',
		muted: '#C4A88A',
		accent: '#D9A441',
		accentAlt: '#9E3B2E',
		glow: '#D9A441',
		scheme: 'dark',
		use: 'history, culture, museums, documentary',
	},
	neon: {
		background: '#04030A',
		backgroundAlt: '#0D0620',
		surface: '#171034',
		ink: '#FFFFFF',
		muted: '#9C8FD1',
		accent: '#FF3DDB',
		accentAlt: '#3DF5FF',
		glow: '#FF3DDB',
		scheme: 'dark',
		use: 'neon, cyberpunk, gaming, nightlife',
	},
	forest: {
		background: '#050D0A',
		backgroundAlt: '#0B1A14',
		surface: '#12271E',
		ink: '#EAF6EF',
		muted: '#93B3A3',
		accent: '#7BE495',
		accentAlt: '#E3C88D',
		glow: '#7BE495',
		scheme: 'dark',
		use: 'nature, sustainability, outdoors, health',
	},
	mono: {
		background: '#070707',
		backgroundAlt: '#111111',
		surface: '#1B1B1B',
		ink: '#FAFAFA',
		muted: '#A3A3A3',
		accent: '#FF3B30',
		accentAlt: '#FAFAFA',
		glow: '#FF3B30',
		scheme: 'dark',
		use: 'bold minimal, fashion, statement typography',
	},
	paper: {
		background: '#F4EFE6',
		backgroundAlt: '#E9E1D4',
		surface: '#FFFFFF',
		ink: '#1A1712',
		muted: '#6B6154',
		accent: '#B4451F',
		accentAlt: '#2E5D4B',
		glow: '#B4451F',
		scheme: 'light',
		use: 'editorial print, craft, archive, luxury paper',
	},
	azure: {
		background: '#04101F',
		backgroundAlt: '#082138',
		surface: '#0E2E4D',
		ink: '#F0F7FF',
		muted: '#93B4D2',
		accent: '#3DA9FC',
		accentAlt: '#78F0C8',
		glow: '#3DA9FC',
		scheme: 'dark',
		use: 'corporate, SaaS, finance, trust',
	},
	sunrise: {
		background: '#FFF1E6',
		backgroundAlt: '#FFD9C7',
		surface: '#FFFFFF',
		ink: '#2A1420',
		muted: '#7C5468',
		accent: '#F2545B',
		accentAlt: '#F9A03F',
		glow: '#F2545B',
		scheme: 'light',
		use: 'friendly, lifestyle, food, consumer app',
	},
	slate: {
		background: '#0B0D10',
		backgroundAlt: '#141A20',
		surface: '#1D242C',
		ink: '#EDF2F7',
		muted: '#8E9AA8',
		accent: '#B9F73E',
		accentAlt: '#4CC9F0',
		glow: '#B9F73E',
		scheme: 'dark',
		use: 'developer tools, data, engineering',
	},
	royal: {
		background: '#0A0616',
		backgroundAlt: '#170C2E',
		surface: '#241344',
		ink: '#F7F2FF',
		muted: '#B6A5D6',
		accent: '#E8C36B',
		accentAlt: '#8E6BFF',
		glow: '#E8C36B',
		scheme: 'dark',
		use: 'luxury, hospitality, premium brand',
	},
	arctic: {
		background: '#EEF4F8',
		backgroundAlt: '#DDE9F1',
		surface: '#FFFFFF',
		ink: '#0C1B26',
		muted: '#5A7183',
		accent: '#0A84FF',
		accentAlt: '#00C2A8',
		glow: '#0A84FF',
		scheme: 'light',
		use: 'clean product, medical, minimal light',
	},
}

export const PALETTE_IDS = Object.keys(PALETTES) as PaletteId[]

/**
 * Original 24x24 stroke glyphs drawn as inline SVG with the theme colour.
 * Unlike the fixed-gradient /assets/visual SVGs these always match the palette
 * the director chose, so a scene never ships an off-brand icon.
 */
export const ICON_PATHS = {
	spark: [
		'M12 2.5L14.3 9.3L21 12L14.3 14.6L12 21.5L9.6 14.6L3 12L9.6 9.3Z',
		'M18.5 3.5V7',
		'M16.75 5.25H20.25',
	],
	play: ['M8 5.5L19 12L8 18.5Z'],
	bolt: ['M13.6 2.5L5.5 13H11L9.8 21.5L18.5 10.2H13Z'],
	target: [
		'M12 3A9 9 0 1 0 21 12A9 9 0 0 0 12 3Z',
		'M12 7A5 5 0 1 0 17 12A5 5 0 0 0 12 7Z',
		'M12 10.3A1.7 1.7 0 1 0 13.7 12A1.7 1.7 0 0 0 12 10.3Z',
	],
	chart: ['M4 19V11', 'M10 19V5', 'M16 19V9', 'M3 19H21', 'M4 8L9 3L14 7L20 2'],
	layers: ['M12 3L21 8L12 13L3 8Z', 'M4.5 12L12 16.2L19.5 12', 'M4.5 16L12 20.2L19.5 16'],
	cube: ['M12 3L20 7.5L12 12L4 7.5Z', 'M4 7.5V16.5L12 21V12', 'M20 7.5V16.5L12 21'],
	code: ['M9 7L4 12L9 17', 'M15 7L20 12L15 17', 'M13.5 4L10.5 20'],
	cursor: ['M5 3L18.5 13L12.2 14.5L9 20.5Z', 'M12.2 14.5L17 20'],
	check: ['M12 3A9 9 0 1 0 21 12A9 9 0 0 0 12 3Z', 'M7.5 12.2L10.5 15.2L16.8 8.8'],
	rocket: [
		'M8.2 15.8C6.2 15.5 4.8 16.2 3.5 18.5C5.8 19.1 7.5 18.5 8.8 16.8',
		'M9 15L6 12L7.8 8.5L12 7C14.7 4.3 17.5 3.2 21 3C20.8 6.5 19.7 9.3 17 12L15.5 16.2L12 18L9 15Z',
		'M14.8 8.2A1.8 1.8 0 1 0 18.4 8.2A1.8 1.8 0 0 0 14.8 8.2Z',
	],
	sound: ['M4 10H8L13 6V18L8 14H4Z', 'M16 9C17.6 10.5 17.6 13.5 16 15', 'M18.8 6.5C22 9.5 22 14.5 18.8 17.5'],
	orbit: [
		'M5 14.5C2.4 12.8 3.8 9.5 7.8 7.2C11.8 4.9 17.2 4.5 19.6 6.5C22 8.5 19.9 12 16 14.3C12.1 16.6 7.4 17.2 5 14.5Z',
		'M12 10.2A1.8 1.8 0 1 0 13.8 12A1.8 1.8 0 0 0 12 10.2Z',
		'M4.5 17.5L6.8 15.2',
	],
	idea: [
		'M8.5 15.5C6.8 14.3 6 12.6 6 10.5A6 6 0 0 1 18 10.5C18 12.6 17.2 14.3 15.5 15.5L14.5 17H9.5Z',
		'M9.5 20H14.5',
		'M12 1.5V4',
		'M3.5 5L5.4 6.6',
		'M20.5 5L18.6 6.6',
	],
	globe: [
		'M12 3A9 9 0 1 0 21 12A9 9 0 0 0 12 3Z',
		'M3 12H21',
		'M12 3C14.5 5.5 15.6 8.7 15.6 12C15.6 15.3 14.5 18.5 12 21',
		'M12 3C9.5 5.5 8.4 8.7 8.4 12C8.4 15.3 9.5 18.5 12 21',
	],
	mountain: ['M2 19L9 7L13.5 14L16 10L22 19Z', 'M9 7L11.2 10.7', 'M6.2 19L9 14.2'],
	temple: ['M4 20H20', 'M6 20V13H18V20', 'M3.5 13L12 8L20.5 13', 'M5.5 8L12 4L18.5 8', 'M12 20V16'],
	flag: ['M6 21V3', 'M6 4H18L15.4 8L18 12H6'],
	book: [
		'M4 5.5C6.5 4 9.5 4 12 5.5C14.5 4 17.5 4 20 5.5V18.5C17.5 17 14.5 17 12 18.5C9.5 17 6.5 17 4 18.5Z',
		'M12 5.5V18.5',
	],
	clock: ['M12 3A9 9 0 1 0 21 12A9 9 0 0 0 12 3Z', 'M12 7V12L15.5 14'],
	compass: ['M12 3A9 9 0 1 0 21 12A9 9 0 0 0 12 3Z', 'M15.5 8.5L13.6 13.6L8.5 15.5L10.4 10.4Z'],
	camera: [
		'M3.5 8.5H7L8.8 6H15.2L17 8.5H20.5V18.5H3.5Z',
		'M12 9.5A3.6 3.6 0 1 0 15.6 13.1A3.6 3.6 0 0 0 12 9.5Z',
	],
	leaf: ['M5 19C4 12 8 5.5 19 5C19.5 15 13 20 5 19Z', 'M5 19C8 15 11.5 12.5 15.5 10.8'],
	sun: [
		'M12 7.5A4.5 4.5 0 1 0 16.5 12A4.5 4.5 0 0 0 12 7.5Z',
		'M12 1.8V4',
		'M12 20V22.2',
		'M4.2 4.2L5.8 5.8',
		'M18.2 18.2L19.8 19.8',
		'M1.8 12H4',
		'M20 12H22.2',
		'M4.2 19.8L5.8 18.2',
		'M18.2 5.8L19.8 4.2',
	],
	pin: [
		'M12 21.5C12 21.5 19 15.4 19 10.5A7 7 0 0 0 5 10.5C5 15.4 12 21.5 12 21.5Z',
		'M12 7.8A2.7 2.7 0 1 0 14.7 10.5A2.7 2.7 0 0 0 12 7.8Z',
	],
	users: [
		'M9 11.5A3.5 3.5 0 1 0 9 4.5A3.5 3.5 0 0 0 9 11.5Z',
		'M2.5 20C3.2 16.2 5.8 14 9 14C12.2 14 14.8 16.2 15.5 20',
		'M16 5.2A3.2 3.2 0 0 1 16 11.4',
		'M17.6 14.4C19.6 15.3 21 17.3 21.5 20',
	],
	shield: ['M12 2.8L20 6V12C20 16.6 16.6 20.2 12 21.4C7.4 20.2 4 16.6 4 12V6Z', 'M8.6 12.2L11.2 14.8L15.6 10'],
	coin: [
		'M12 4C16.4 4 20 5.8 20 8C20 10.2 16.4 12 12 12C7.6 12 4 10.2 4 8C4 5.8 7.6 4 12 4Z',
		'M4 8V16C4 18.2 7.6 20 12 20C16.4 20 20 18.2 20 16V8',
	],
	wave: [
		'M2.5 9C5 6 7 12 9.5 9C12 6 14 12 16.5 9C19 6 21 12 21.5 10.5',
		'M2.5 15C5 12 7 18 9.5 15C12 12 14 18 16.5 15C19 12 21 18 21.5 16.5',
	],
	star: ['M12 3L14.7 9.3L21.5 9.9L16.4 14.4L17.9 21L12 17.5L6.1 21L7.6 14.4L2.5 9.9L9.3 9.3Z'],
	arrow: ['M4 12H20', 'M14 6L20 12L14 18'],
	gear: [
		'M12 9A3 3 0 1 0 15 12A3 3 0 0 0 12 9Z',
		'M12 2.5L13.4 5.2L16.4 4.6L16.9 7.6L19.6 9L18.2 11.7L19.6 14.4L16.9 15.8L16.4 18.8L13.4 18.2L12 20.9L10.6 18.2L7.6 18.8L7.1 15.8L4.4 14.4L5.8 11.7L4.4 9L7.1 7.6L7.6 4.6L10.6 5.2Z',
	],
	database: [
		'M12 3.5C16 3.5 19 4.8 19 6.4C19 8 16 9.3 12 9.3C8 9.3 5 8 5 6.4C5 4.8 8 3.5 12 3.5Z',
		'M5 6.4V17.6C5 19.2 8 20.5 12 20.5C16 20.5 19 19.2 19 17.6V6.4',
		'M5 12C5 13.6 8 14.9 12 14.9C16 14.9 19 13.6 19 12',
	],
	cloud: ['M7.5 19A4.5 4.5 0 0 1 7.2 10A5.6 5.6 0 0 1 18 10.4A4.3 4.3 0 0 1 17.4 19Z'],
	heart: ['M12 20.5C7 17 3.5 13.8 3.5 10.1A4.6 4.6 0 0 1 12 7.6A4.6 4.6 0 0 1 20.5 10.1C20.5 13.8 17 17 12 20.5Z'],
	search: ['M11 4A7 7 0 1 0 18 11A7 7 0 0 0 11 4Z', 'M16.1 16.1L21 21'],
	film: ['M3.5 5.5H20.5V18.5H3.5Z', 'M7.5 5.5V18.5', 'M16.5 5.5V18.5', 'M3.5 12H20.5'],
	microphone: [
		'M12 3.5A2.8 2.8 0 0 1 14.8 6.3V12A2.8 2.8 0 0 1 9.2 12V6.3A2.8 2.8 0 0 1 12 3.5Z',
		'M5.8 11.5A6.2 6.2 0 0 0 18.2 11.5',
		'M12 17.7V21',
		'M8.8 21H15.2',
	],
	trophy: [
		'M8 4H16V10A4 4 0 0 1 8 10Z',
		'M8 5.5H5.2V7.2A3.4 3.4 0 0 0 8.6 10.6',
		'M16 5.5H18.8V7.2A3.4 3.4 0 0 1 15.4 10.6',
		'M12 14V17.5',
		'M8.6 20.5H15.4L14.6 17.5H9.4Z',
	],
	tree: [
		'M12 21V11',
		'M12 12.5C9 12.5 7 10.5 7 7.5C10 7.5 12 9.5 12 12.5Z',
		'M12 12.5C15 12.5 17 10.5 17 7.5C14 7.5 12 9.5 12 12.5Z',
		'M12 11C12 7.5 13.6 4.5 16 3',
		'M8 21H16',
	],
} as const

export type IconId = keyof typeof ICON_PATHS

export const ICON_IDS = Object.keys(ICON_PATHS) as IconId[]

export function isIconId(value: unknown): value is IconId {
	return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ICON_PATHS, value)
}
