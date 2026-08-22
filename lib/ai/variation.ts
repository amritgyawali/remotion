/**
 * Request-scoped creative variation.
 *
 * Entropy is chosen before a Remotion file is composed. The resulting profile
 * and seed are then embedded as constants, so preview and render stay perfectly
 * deterministic while separate generation requests can use different art
 * direction.
 *
 * The top of the hierarchy is a *template*: a complete art-direction house
 * style that decides which backgrounds, layouts, typography, accents, finish,
 * camera, rhythm, palettes and font categories are even eligible. Two videos
 * built from different templates cannot look like variants of each other, and
 * the resolver refuses to reuse a design identity the caller has recently seen.
 */

import {
	FONT_IDS,
	FONT_IDS_BY_CATEGORY,
	FONT_KIT,
	PALETTE_IDS,
	VISUAL_FAMILY_IDS,
	type FontId,
	type PaletteId,
	type VisualFamilyId,
} from './kit'

export const BACKGROUND_RECIPE_IDS = [
	'aurora',
	'spotlight',
	'paper-wash',
	'soft-orbits',
	'cinematic-bands',
	'ink-bloom',
	'duotone-split',
	'halo-sweep',
	'noir-fade',
	'gradient-mesh',
	'vertical-fade',
	'corner-glow',
	'editorial-slab',
	'flat-field',
] as const
export type BackgroundRecipeId = (typeof BACKGROUND_RECIPE_IDS)[number]

export const LAYOUT_RECIPE_IDS = [
	'centered',
	'editorial-left',
	'offset-stack',
	'wide-stage',
	'poster',
	'split-vertical',
	'corner-anchor',
	'banner-top',
	'column-right',
	'full-bleed',
] as const
export type LayoutRecipeId = (typeof LAYOUT_RECIPE_IDS)[number]

export const TRANSITION_RECIPE_IDS = ['dissolve', 'directional', 'graphic-wipe', 'mixed', 'kinetic'] as const
export type TransitionRecipeId = (typeof TRANSITION_RECIPE_IDS)[number]

export const SFX_RECIPE_IDS = ['cinematic', 'crisp', 'organic', 'digital', 'minimal'] as const
export type SfxRecipeId = (typeof SFX_RECIPE_IDS)[number]

export const TYPOGRAPHY_RECIPE_IDS = [
	'poster',
	'editorial',
	'technical',
	'friendly',
	'cinematic',
	'brutalist',
	'condensed-stack',
	'serif-luxe',
	'mono-terminal',
	'handwritten',
] as const
export type TypographyRecipeId = (typeof TYPOGRAPHY_RECIPE_IDS)[number]

export const CAMERA_RECIPE_IDS = ['still', 'drift', 'dolly', 'orbit'] as const
export type CameraRecipeId = (typeof CAMERA_RECIPE_IDS)[number]

export const FINISH_RECIPE_IDS = ['clean', 'film', 'paper', 'luminous', 'matte', 'print'] as const
export type FinishRecipeId = (typeof FINISH_RECIPE_IDS)[number]

export const ACCENT_SHAPE_IDS = [
	'rings',
	'ribbons',
	'discs',
	'frames',
	'sparks',
	'arcs',
	'slashes',
	'blocks',
	'halo',
	'none',
] as const
export type AccentShapeId = (typeof ACCENT_SHAPE_IDS)[number]

/** How headline and label copy is cased. */
export const TEXT_CASE_IDS = ['title', 'upper', 'sentence'] as const
export type TextCaseId = (typeof TEXT_CASE_IDS)[number]

/** Corner language for every card, badge and plate. */
export const CORNER_STYLE_IDS = ['sharp', 'soft', 'pill'] as const
export type CornerStyleId = (typeof CORNER_STYLE_IDS)[number]

/** How a divider under a headline is drawn. */
export const RULE_STYLE_IDS = ['bar', 'thin', 'double', 'dotted', 'none'] as const
export type RuleStyleId = (typeof RULE_STYLE_IDS)[number]

/** The signature treatment applied to the main headline of a scene. */
export const TITLE_TREATMENT_IDS = ['stack', 'inline', 'boxed', 'underline', 'outline', 'sidebar'] as const
export type TitleTreatmentId = (typeof TITLE_TREATMENT_IDS)[number]

export const TEMPLATE_IDS = [
	'editorial-press',
	'swiss-poster',
	'kinetic-type',
	'broadcast-strip',
	'zine-collage',
	'minimal-air',
	'neon-arcade',
	'gallery-frame',
	'data-brief',
	'story-cards',
	'cinema-bars',
	'terminal-log',
	'pop-sticker',
	'luxe-serif',
	'split-duo',
	'archive-paper',
] as const
export type TemplateId = (typeof TEMPLATE_IDS)[number]

export type CreativeProfile = {
	/** House style. Decides which recipes below are even eligible. */
	template: TemplateId
	background: BackgroundRecipeId
	layout: LayoutRecipeId
	transition: TransitionRecipeId
	sfx: SfxRecipeId
	typography: TypographyRecipeId
	camera: CameraRecipeId
	finish: FinishRecipeId
	accentShape: AccentShapeId
	textCase: TextCaseId
	cornerStyle: CornerStyleId
	ruleStyle: RuleStyleId
	titleTreatment: TitleTreatmentId
	/** Degrees the accent colours are rotated around the colour wheel. */
	paletteShift: number
	/** Swaps accent and accentAlt roles so the same palette reads differently. */
	accentSwap: boolean
	tempoScale: number
	sceneVariants: number[]
	/** Exact generation-eligible SVG family and raw variant selected per scene. */
	visualFamilies: VisualFamilyId[]
	visualVariants: number[]
	/** Zero-based offset into each 36-file SFX family. */
	sfxVariantOffset: number
}

export type CreativeDescriptor = {
	palette: string
	displayFont: string
	textFont: string
	motion: string
	dimension: string
	sceneTypes: string[]
}

const TEMPO_SCALES = [0.84, 0.88, 0.92, 0.96, 1, 1.04, 1.08, 1.12, 1.16] as const
const PALETTE_SHIFTS = [0, 0, 18, 32, 48, 64, 84, 108, 140, 168, 196, 228, 262, 296, 324] as const
const MAX_AVOID_FINGERPRINTS = 48
const MAX_PROFILE_ATTEMPTS = 256

/**
 * A template is a complete house style. Every pool below is the *only* thing a
 * video built from that template may use, which is what stops two generations
 * from converging on the same look.
 */
type TemplateRecipe = {
	backgrounds: readonly BackgroundRecipeId[]
	layouts: readonly LayoutRecipeId[]
	typography: readonly TypographyRecipeId[]
	accents: readonly AccentShapeId[]
	finishes: readonly FinishRecipeId[]
	cameras: readonly CameraRecipeId[]
	transitions: readonly TransitionRecipeId[]
	sfx: readonly SfxRecipeId[]
	textCase: readonly TextCaseId[]
	corners: readonly CornerStyleId[]
	rules: readonly RuleStyleId[]
	titles: readonly TitleTreatmentId[]
	tempo: readonly number[]
	/** Font categories the template draws headline and body faces from. */
	displayFontCategories: readonly string[]
	bodyFontCategories: readonly string[]
	/** Palettes that suit the house style, used when the brief names none. */
	palettes: readonly PaletteId[]
}

export const TEMPLATE_KIT: Record<TemplateId, TemplateRecipe> = {
	'editorial-press': {
		backgrounds: ['paper-wash', 'editorial-slab', 'vertical-fade', 'flat-field'],
		layouts: ['editorial-left', 'column-right', 'offset-stack'],
		typography: ['editorial', 'serif-luxe'],
		accents: ['frames', 'slashes', 'none'],
		finishes: ['paper', 'print', 'matte'],
		cameras: ['still', 'drift'],
		transitions: ['dissolve', 'directional'],
		sfx: ['organic', 'minimal'],
		textCase: ['title', 'sentence'],
		corners: ['sharp', 'soft'],
		rules: ['thin', 'double', 'bar'],
		titles: ['stack', 'underline', 'sidebar'],
		tempo: [0.84, 0.88, 0.92, 0.96],
		displayFontCategories: ['serif', 'condensed'],
		bodyFontCategories: ['serif', 'sans', 'grotesk'],
		palettes: ['paper', 'heritage', 'mono', 'arctic'],
	},
	'swiss-poster': {
		backgrounds: ['flat-field', 'duotone-split', 'editorial-slab', 'corner-glow'],
		layouts: ['poster', 'corner-anchor', 'banner-top'],
		typography: ['poster', 'brutalist', 'condensed-stack'],
		accents: ['blocks', 'slashes', 'none'],
		finishes: ['clean', 'matte', 'print'],
		cameras: ['still'],
		transitions: ['graphic-wipe', 'directional'],
		sfx: ['crisp', 'minimal'],
		textCase: ['upper', 'title'],
		corners: ['sharp'],
		rules: ['bar', 'double', 'none'],
		titles: ['stack', 'boxed', 'sidebar'],
		tempo: [0.92, 0.96, 1, 1.04],
		displayFontCategories: ['condensed', 'grotesk', 'sans', 'display'],
		bodyFontCategories: ['grotesk', 'sans', 'condensed'],
		palettes: ['mono', 'arctic', 'azure', 'sunrise', 'paper'],
	},
	'kinetic-type': {
		backgrounds: ['flat-field', 'halo-sweep', 'spotlight', 'gradient-mesh'],
		layouts: ['centered', 'full-bleed', 'poster'],
		typography: ['poster', 'brutalist', 'cinematic'],
		accents: ['sparks', 'arcs', 'halo'],
		finishes: ['clean', 'luminous'],
		cameras: ['drift', 'dolly'],
		transitions: ['kinetic', 'directional', 'mixed'],
		sfx: ['crisp', 'digital'],
		textCase: ['upper'],
		corners: ['sharp', 'pill'],
		rules: ['bar', 'none'],
		titles: ['stack', 'inline', 'outline'],
		tempo: [1.04, 1.08, 1.12, 1.16],
		displayFontCategories: ['display', 'condensed', 'sans', 'grotesk'],
		bodyFontCategories: ['grotesk', 'sans', 'mono'],
		palettes: ['mono', 'neon', 'midnight', 'slate', 'sunrise'],
	},
	'broadcast-strip': {
		backgrounds: ['duotone-split', 'vertical-fade', 'cinematic-bands', 'corner-glow'],
		layouts: ['banner-top', 'wide-stage', 'editorial-left'],
		typography: ['condensed-stack', 'technical', 'poster'],
		accents: ['blocks', 'slashes', 'frames'],
		finishes: ['clean', 'matte', 'film'],
		cameras: ['still', 'drift'],
		transitions: ['directional', 'graphic-wipe'],
		sfx: ['crisp', 'digital'],
		textCase: ['upper', 'title'],
		corners: ['sharp', 'soft'],
		rules: ['bar', 'double'],
		titles: ['boxed', 'sidebar', 'stack'],
		tempo: [0.96, 1, 1.04, 1.08],
		displayFontCategories: ['condensed', 'grotesk', 'tech'],
		bodyFontCategories: ['sans', 'grotesk', 'condensed'],
		palettes: ['azure', 'slate', 'mono', 'midnight'],
	},
	'zine-collage': {
		backgrounds: ['paper-wash', 'ink-bloom', 'duotone-split', 'editorial-slab'],
		layouts: ['offset-stack', 'corner-anchor', 'split-vertical'],
		typography: ['brutalist', 'handwritten', 'condensed-stack'],
		accents: ['slashes', 'blocks', 'sparks', 'ribbons'],
		finishes: ['print', 'paper', 'film'],
		cameras: ['still', 'drift'],
		transitions: ['graphic-wipe', 'kinetic', 'mixed'],
		sfx: ['organic', 'crisp'],
		textCase: ['upper', 'title'],
		corners: ['sharp'],
		rules: ['dotted', 'bar', 'none'],
		titles: ['boxed', 'outline', 'stack'],
		tempo: [1, 1.04, 1.08, 1.12],
		displayFontCategories: ['retro', 'comic', 'display', 'condensed'],
		bodyFontCategories: ['sans', 'mono', 'condensed'],
		palettes: ['paper', 'sunrise', 'mono', 'ember'],
	},
	'minimal-air': {
		backgrounds: ['flat-field', 'vertical-fade', 'soft-orbits', 'paper-wash'],
		layouts: ['centered', 'column-right', 'editorial-left'],
		typography: ['editorial', 'poster', 'serif-luxe'],
		accents: ['none', 'halo', 'arcs'],
		finishes: ['clean', 'matte'],
		cameras: ['still', 'drift'],
		transitions: ['dissolve'],
		sfx: ['minimal', 'organic'],
		textCase: ['sentence', 'title'],
		corners: ['soft', 'pill'],
		rules: ['thin', 'none'],
		titles: ['stack', 'inline'],
		tempo: [0.84, 0.88, 0.92],
		displayFontCategories: ['sans', 'grotesk', 'serif', 'rounded'],
		bodyFontCategories: ['sans', 'grotesk', 'rounded'],
		palettes: ['arctic', 'paper', 'mono', 'sunrise', 'azure'],
	},
	'neon-arcade': {
		backgrounds: ['halo-sweep', 'gradient-mesh', 'ink-bloom', 'corner-glow'],
		layouts: ['centered', 'full-bleed', 'poster'],
		typography: ['technical', 'mono-terminal', 'brutalist'],
		accents: ['sparks', 'halo', 'rings', 'arcs'],
		finishes: ['luminous', 'clean'],
		cameras: ['drift', 'dolly', 'orbit'],
		transitions: ['kinetic', 'mixed', 'directional'],
		sfx: ['digital', 'crisp'],
		textCase: ['upper'],
		corners: ['sharp', 'pill'],
		rules: ['bar', 'double'],
		titles: ['outline', 'boxed', 'inline'],
		tempo: [1.08, 1.12, 1.16],
		displayFontCategories: ['tech', 'pixel', 'display', 'condensed'],
		bodyFontCategories: ['mono', 'tech', 'sans'],
		palettes: ['neon', 'midnight', 'slate'],
	},
	'gallery-frame': {
		backgrounds: ['editorial-slab', 'flat-field', 'vertical-fade', 'spotlight'],
		layouts: ['centered', 'wide-stage', 'poster'],
		typography: ['serif-luxe', 'editorial', 'cinematic'],
		accents: ['frames', 'none', 'arcs'],
		finishes: ['matte', 'print', 'clean'],
		cameras: ['still', 'drift'],
		transitions: ['dissolve', 'graphic-wipe'],
		sfx: ['minimal', 'organic'],
		textCase: ['title', 'sentence'],
		corners: ['sharp', 'soft'],
		rules: ['thin', 'double'],
		titles: ['boxed', 'underline', 'stack'],
		tempo: [0.84, 0.88, 0.92, 0.96],
		displayFontCategories: ['serif', 'display', 'sans'],
		bodyFontCategories: ['serif', 'sans', 'grotesk'],
		palettes: ['mono', 'arctic', 'royal', 'heritage', 'paper'],
	},
	'data-brief': {
		backgrounds: ['flat-field', 'vertical-fade', 'duotone-split', 'corner-glow'],
		layouts: ['editorial-left', 'banner-top', 'column-right'],
		typography: ['technical', 'mono-terminal', 'condensed-stack'],
		accents: ['blocks', 'slashes', 'none'],
		finishes: ['clean', 'matte'],
		cameras: ['still'],
		transitions: ['directional', 'dissolve'],
		sfx: ['crisp', 'digital', 'minimal'],
		textCase: ['upper', 'sentence'],
		corners: ['sharp', 'soft'],
		rules: ['bar', 'thin'],
		titles: ['sidebar', 'stack', 'underline'],
		tempo: [0.92, 0.96, 1, 1.04],
		displayFontCategories: ['grotesk', 'condensed', 'tech', 'sans'],
		bodyFontCategories: ['mono', 'sans', 'grotesk'],
		palettes: ['azure', 'slate', 'arctic', 'mono'],
	},
	'story-cards': {
		backgrounds: ['soft-orbits', 'gradient-mesh', 'vertical-fade', 'paper-wash'],
		layouts: ['centered', 'offset-stack', 'split-vertical'],
		typography: ['friendly', 'poster'],
		accents: ['discs', 'ribbons', 'blocks', 'halo'],
		finishes: ['clean', 'matte', 'luminous'],
		cameras: ['drift', 'dolly'],
		transitions: ['directional', 'mixed'],
		sfx: ['organic', 'crisp'],
		textCase: ['title', 'sentence'],
		corners: ['pill', 'soft'],
		rules: ['bar', 'thin', 'none'],
		titles: ['stack', 'inline', 'boxed'],
		tempo: [0.96, 1, 1.04, 1.08],
		displayFontCategories: ['rounded', 'display', 'sans', 'comic'],
		bodyFontCategories: ['rounded', 'sans', 'grotesk'],
		palettes: ['sunrise', 'forest', 'arctic', 'azure', 'paper'],
	},
	'cinema-bars': {
		backgrounds: ['cinematic-bands', 'spotlight', 'noir-fade', 'ink-bloom'],
		layouts: ['wide-stage', 'full-bleed', 'centered'],
		typography: ['cinematic', 'condensed-stack', 'serif-luxe'],
		accents: ['arcs', 'none', 'halo', 'frames'],
		finishes: ['film', 'luminous', 'matte'],
		cameras: ['dolly', 'drift', 'orbit'],
		transitions: ['dissolve', 'mixed'],
		sfx: ['cinematic', 'organic'],
		textCase: ['upper', 'title'],
		corners: ['sharp'],
		rules: ['thin', 'none'],
		titles: ['stack', 'inline', 'underline'],
		tempo: [0.84, 0.88, 0.92, 0.96],
		displayFontCategories: ['condensed', 'serif', 'display', 'grotesk'],
		bodyFontCategories: ['sans', 'grotesk', 'condensed'],
		palettes: ['midnight', 'heritage', 'ember', 'mono', 'royal'],
	},
	'terminal-log': {
		backgrounds: ['flat-field', 'noir-fade', 'vertical-fade', 'corner-glow'],
		layouts: ['editorial-left', 'corner-anchor', 'banner-top'],
		typography: ['mono-terminal', 'technical'],
		accents: ['slashes', 'blocks', 'none'],
		finishes: ['clean', 'matte'],
		cameras: ['still'],
		transitions: ['directional', 'kinetic'],
		sfx: ['digital', 'crisp'],
		textCase: ['upper', 'sentence'],
		corners: ['sharp'],
		rules: ['thin', 'dotted'],
		titles: ['sidebar', 'inline', 'stack'],
		tempo: [1, 1.04, 1.08, 1.12],
		displayFontCategories: ['mono', 'tech', 'pixel'],
		bodyFontCategories: ['mono', 'tech'],
		palettes: ['slate', 'midnight', 'mono', 'forest'],
	},
	'pop-sticker': {
		backgrounds: ['duotone-split', 'flat-field', 'gradient-mesh', 'halo-sweep'],
		layouts: ['poster', 'corner-anchor', 'offset-stack'],
		typography: ['brutalist', 'friendly', 'poster'],
		accents: ['discs', 'sparks', 'blocks', 'ribbons'],
		finishes: ['clean', 'print'],
		cameras: ['drift', 'still'],
		transitions: ['kinetic', 'graphic-wipe'],
		sfx: ['crisp', 'digital'],
		textCase: ['upper'],
		corners: ['pill', 'soft'],
		rules: ['bar', 'none'],
		titles: ['boxed', 'outline', 'stack'],
		tempo: [1.08, 1.12, 1.16],
		displayFontCategories: ['comic', 'display', 'rounded', 'retro'],
		bodyFontCategories: ['rounded', 'sans', 'comic'],
		palettes: ['sunrise', 'neon', 'mono', 'ember'],
	},
	'luxe-serif': {
		backgrounds: ['spotlight', 'vertical-fade', 'noir-fade', 'editorial-slab'],
		layouts: ['centered', 'column-right', 'wide-stage'],
		typography: ['serif-luxe', 'editorial'],
		accents: ['frames', 'arcs', 'none', 'halo'],
		finishes: ['matte', 'film', 'luminous'],
		cameras: ['still', 'drift'],
		transitions: ['dissolve'],
		sfx: ['cinematic', 'minimal'],
		textCase: ['title', 'sentence'],
		corners: ['sharp', 'soft'],
		rules: ['thin', 'double'],
		titles: ['stack', 'underline', 'inline'],
		tempo: [0.84, 0.88, 0.92],
		displayFontCategories: ['serif', 'display'],
		bodyFontCategories: ['serif', 'sans', 'grotesk'],
		palettes: ['royal', 'heritage', 'mono', 'midnight', 'paper'],
	},
	'split-duo': {
		backgrounds: ['duotone-split', 'editorial-slab', 'flat-field', 'corner-glow'],
		layouts: ['split-vertical', 'column-right', 'banner-top'],
		typography: ['poster', 'condensed-stack', 'technical'],
		accents: ['blocks', 'slashes', 'frames'],
		finishes: ['clean', 'matte', 'print'],
		cameras: ['still', 'drift'],
		transitions: ['graphic-wipe', 'directional'],
		sfx: ['crisp', 'minimal'],
		textCase: ['upper', 'title'],
		corners: ['sharp', 'soft'],
		rules: ['bar', 'none'],
		titles: ['sidebar', 'boxed', 'stack'],
		tempo: [0.92, 0.96, 1, 1.04],
		displayFontCategories: ['grotesk', 'condensed', 'sans', 'display'],
		bodyFontCategories: ['sans', 'grotesk', 'mono'],
		palettes: ['azure', 'mono', 'forest', 'sunrise', 'slate'],
	},
	'archive-paper': {
		backgrounds: ['paper-wash', 'editorial-slab', 'ink-bloom', 'flat-field'],
		layouts: ['editorial-left', 'centered', 'offset-stack'],
		typography: ['editorial', 'handwritten', 'serif-luxe'],
		accents: ['frames', 'sparks', 'none'],
		finishes: ['paper', 'print', 'film'],
		cameras: ['still', 'drift'],
		transitions: ['dissolve', 'graphic-wipe'],
		sfx: ['organic', 'minimal'],
		textCase: ['title', 'sentence'],
		corners: ['sharp'],
		rules: ['dotted', 'thin', 'double'],
		titles: ['underline', 'stack', 'sidebar'],
		tempo: [0.84, 0.88, 0.92, 0.96],
		displayFontCategories: ['serif', 'handwriting', 'retro', 'condensed'],
		bodyFontCategories: ['serif', 'sans', 'handwriting'],
		palettes: ['paper', 'heritage', 'ember', 'mono'],
	},
}

const VISUAL_FAMILIES_BY_SCENE: Record<string, readonly VisualFamilyId[]> = {
	title: ['burst', 'ribbon', 'orbit-flow', 'wave-bands', 'badge', 'confetti', 'brackets', 'focus-rings'],
	statement: ['brackets', 'capsule', 'badge', 'speech', 'blob', 'wave-bands'],
	timeline: ['timeline', 'pointer-flow', 'orbit-flow', 'network'],
	map: ['network', 'pointer-flow', 'constellation', 'satellite'],
	landscape: ['leaf-sprig', 'vines', 'blob', 'petals', 'comet', 'wave-bands'],
	monument: ['brackets', 'focus-rings', 'ticket', 'orbit-flow', 'badge'],
	gallery: ['ticket', 'capsule', 'brackets', 'confetti', 'speech'],
	stats: ['bars', 'radial-data', 'badge', 'focus-rings'],
	chart: ['bars', 'radial-data', 'network', 'timeline'],
	process: ['pointer-flow', 'timeline', 'network', 'capsule', 'orbit-flow'],
	quote: ['speech', 'brackets', 'blob', 'capsule'],
	cta: ['badge', 'confetti', 'burst', 'focus-rings', 'ribbon'],
	object3d: ['orbit-flow', 'focus-rings', 'satellite', 'planet-system'],
	globe3d: ['planet-system', 'satellite', 'constellation', 'orbit-flow'],
	terrain3d: ['leaf-sprig', 'vines', 'comet', 'wave-bands'],
	carousel3d: ['ticket', 'capsule', 'orbit-flow', 'pointer-flow'],
}

/** Stable 32-bit hash that works identically in Node and browsers. */
export function stableHash(value: string, salt = 0): number {
	let hash = (0x811c9dc5 ^ salt) >>> 0
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index)
		hash = Math.imul(hash, 0x01000193) >>> 0
	}
	hash ^= hash >>> 16
	hash = Math.imul(hash, 0x85ebca6b) >>> 0
	hash ^= hash >>> 13
	hash = Math.imul(hash, 0xc2b2ae35) >>> 0
	return (hash ^ (hash >>> 16)) >>> 0
}

export function seededIndex(seed: string, label: string, length: number): number {
	if (length <= 1) return 0
	return stableHash(`${seed}:${label}`) % length
}

export function seededChoice<T>(seed: string, label: string, choices: readonly T[]): T {
	if (choices.length === 0) throw new Error(`No creative choices are available for ${label}.`)
	return choices[seededIndex(seed, label, choices.length)]
}

export function promptFallbackSeed(prompt: string): string {
	const first = stableHash(prompt, 0x13579bdf).toString(16).padStart(8, '0')
	const second = stableHash(prompt, 0x2468ace0).toString(16).padStart(8, '0')
	return `local-${first}-${second}`
}

export function normalizeCreativeSeed(value: unknown, fallback: string): string {
	if (typeof value !== 'string') return fallback
	const normalized = value.trim().slice(0, 96)
	return /^[A-Za-z0-9][A-Za-z0-9_-]{7,95}$/.test(normalized) ? normalized : fallback
}

export function normalizeAvoidFingerprints(value: unknown): string[] {
	if (!Array.isArray(value)) return []
	return [
		...new Set(
			value
				.filter((item): item is string => typeof item === 'string')
				.map((item) => item.trim().toLowerCase())
				.filter((item) => /^design-[a-f0-9]{16}$/.test(item)),
		),
	].slice(-MAX_AVOID_FINGERPRINTS)
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
	return typeof value === 'string' && allowed.includes(value as T) ? (value as T) : fallback
}

/** Repairs a profile without allowing unknown recipes into generated source. */
export function normalizeCreativeProfile(value: unknown, fallback: CreativeProfile): CreativeProfile {
	const source = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
	const rawVariants = Array.isArray(source.sceneVariants) ? source.sceneVariants : fallback.sceneVariants
	const rawVisualFamilies = Array.isArray(source.visualFamilies) ? source.visualFamilies : fallback.visualFamilies
	const rawVisualVariants = Array.isArray(source.visualVariants) ? source.visualVariants : fallback.visualVariants
	return {
		template: enumValue(source.template, TEMPLATE_IDS, fallback.template),
		background: enumValue(source.background, BACKGROUND_RECIPE_IDS, fallback.background),
		layout: enumValue(source.layout, LAYOUT_RECIPE_IDS, fallback.layout),
		transition: enumValue(source.transition, TRANSITION_RECIPE_IDS, fallback.transition),
		sfx: enumValue(source.sfx, SFX_RECIPE_IDS, fallback.sfx),
		typography: enumValue(source.typography, TYPOGRAPHY_RECIPE_IDS, fallback.typography),
		camera: enumValue(source.camera, CAMERA_RECIPE_IDS, fallback.camera),
		finish: enumValue(source.finish, FINISH_RECIPE_IDS, fallback.finish),
		accentShape: enumValue(source.accentShape, ACCENT_SHAPE_IDS, fallback.accentShape),
		textCase: enumValue(source.textCase, TEXT_CASE_IDS, fallback.textCase),
		cornerStyle: enumValue(source.cornerStyle, CORNER_STYLE_IDS, fallback.cornerStyle),
		ruleStyle: enumValue(source.ruleStyle, RULE_STYLE_IDS, fallback.ruleStyle),
		titleTreatment: enumValue(source.titleTreatment, TITLE_TREATMENT_IDS, fallback.titleTreatment),
		paletteShift:
			typeof source.paletteShift === 'number' && Number.isFinite(source.paletteShift)
				? ((Math.round(source.paletteShift) % 360) + 360) % 360
				: fallback.paletteShift,
		accentSwap: typeof source.accentSwap === 'boolean' ? source.accentSwap : fallback.accentSwap,
		tempoScale:
			typeof source.tempoScale === 'number' && Number.isFinite(source.tempoScale)
				? Math.min(1.16, Math.max(0.84, source.tempoScale))
				: fallback.tempoScale,
		sceneVariants: fallback.sceneVariants.slice(0, 12).map((fallbackVariant, index) => {
			const item = rawVariants[index]
			const number = typeof item === 'number' && Number.isFinite(item) ? item : fallbackVariant
			return Math.abs(Math.round(number)) % 5
		}),
		visualFamilies: fallback.visualFamilies.slice(0, 12).map((fallbackFamily, index) =>
			enumValue(rawVisualFamilies[index], VISUAL_FAMILY_IDS, fallbackFamily),
		),
		visualVariants: fallback.visualVariants.slice(0, 12).map((fallbackVariant, index) => {
			const item = rawVisualVariants[index]
			const number = typeof item === 'number' && Number.isFinite(item) ? item : fallbackVariant
			return Math.abs(Math.round(number)) % 50
		}),
		sfxVariantOffset:
			typeof source.sfxVariantOffset === 'number' && Number.isFinite(source.sfxVariantOffset)
				? Math.abs(Math.round(source.sfxVariantOffset)) % 36
				: fallback.sfxVariantOffset,
	}
}

/**
 * Rotates the template pool per attempt so a retry never lands on the same
 * house style, then walks the whole list before repeating one.
 */
function templateFor(seed: string, attempt: number): TemplateId {
	const start = seededIndex(seed, 'template', TEMPLATE_IDS.length)
	const stride = 1 + seededIndex(seed, 'template-stride', TEMPLATE_IDS.length - 1)
	return TEMPLATE_IDS[(start + attempt * stride) % TEMPLATE_IDS.length]
}

function profileFor(seed: string, sceneTypes: string[], attempt: number): CreativeProfile {
	const template = templateFor(seed, attempt)
	const recipe = TEMPLATE_KIT[template]
	const key = `${seed}:profile-attempt-${attempt}:${template}`
	return {
		template,
		background: seededChoice(key, 'background', recipe.backgrounds),
		layout: seededChoice(key, 'layout', recipe.layouts),
		transition: seededChoice(key, 'transition', recipe.transitions),
		sfx: seededChoice(key, 'sfx', recipe.sfx),
		typography: seededChoice(key, 'typography', recipe.typography),
		camera: seededChoice(key, 'camera', recipe.cameras),
		finish: seededChoice(key, 'finish', recipe.finishes),
		accentShape: seededChoice(key, 'accent-shape', recipe.accents),
		textCase: seededChoice(key, 'text-case', recipe.textCase),
		cornerStyle: seededChoice(key, 'corner-style', recipe.corners),
		ruleStyle: seededChoice(key, 'rule-style', recipe.rules),
		titleTreatment: seededChoice(key, 'title-treatment', recipe.titles),
		paletteShift: seededChoice(key, 'palette-shift', PALETTE_SHIFTS),
		accentSwap: seededIndex(key, 'accent-swap', 2) === 1,
		tempoScale: seededChoice(key, 'tempo-scale', recipe.tempo.length > 0 ? recipe.tempo : TEMPO_SCALES),
		sceneVariants: sceneTypes.map((type, index) => seededIndex(key, `scene-${index}-${type}`, 5)),
		visualFamilies: sceneTypes.map((type, index) =>
			seededChoice(key, `visual-family-${index}-${type}`, VISUAL_FAMILIES_BY_SCENE[type] ?? VISUAL_FAMILY_IDS),
		),
		visualVariants: sceneTypes.map((type, index) => seededIndex(key, `visual-variant-${index}-${type}`, 50)),
		sfxVariantOffset: seededIndex(key, 'sfx-variant-offset', 36),
	}
}

/**
 * Fingerprints actual creative decisions. The request nonce is deliberately not
 * included: two seeds that resolve to the same visible recipe collide.
 */
export function creativeFingerprint(profile: CreativeProfile, descriptor: CreativeDescriptor): string {
	const canonical = JSON.stringify({
		template: profile.template,
		background: profile.background,
		layout: profile.layout,
		transition: profile.transition,
		sfx: profile.sfx,
		typography: profile.typography,
		camera: profile.camera,
		finish: profile.finish,
		accentShape: profile.accentShape,
		textCase: profile.textCase,
		cornerStyle: profile.cornerStyle,
		ruleStyle: profile.ruleStyle,
		titleTreatment: profile.titleTreatment,
		paletteShift: profile.paletteShift,
		accentSwap: profile.accentSwap,
		tempoScale: profile.tempoScale,
		sceneVariants: profile.sceneVariants,
		visualFamilies: profile.visualFamilies,
		visualVariants: profile.visualVariants,
		sfxVariantOffset: profile.sfxVariantOffset,
		palette: descriptor.palette,
		displayFont: descriptor.displayFont,
		textFont: descriptor.textFont,
		motion: descriptor.motion,
		dimension: descriptor.dimension,
		sceneTypes: descriptor.sceneTypes,
	})
	const first = stableHash(canonical, 0x6d2b79f5).toString(16).padStart(8, '0')
	const second = stableHash(canonical, 0x1b873593).toString(16).padStart(8, '0')
	return `design-${first}${second}`
}

/**
 * A design identity is "recent" when the exact fingerprint was seen, and also
 * when its house style was the immediately preceding one. Templates are the
 * loudest signal a viewer reads, so back-to-back reuse is what actually makes
 * two videos feel like the same video.
 */
function templateWasJustUsed(template: TemplateId, recentTemplates: readonly TemplateId[]): boolean {
	return recentTemplates.includes(template)
}

export function resolveCreativeProfile(args: {
	seed: string
	descriptor: CreativeDescriptor
	avoidFingerprints?: readonly string[]
	avoidTemplates?: readonly TemplateId[]
}): { profile: CreativeProfile; fingerprint: string } {
	const avoided = new Set(args.avoidFingerprints?.map((item) => item.toLowerCase()) ?? [])
	const avoidedTemplates = args.avoidTemplates ?? []
	let firstUnseenFingerprint: { profile: CreativeProfile; fingerprint: string } | null = null
	let last: { profile: CreativeProfile; fingerprint: string } | null = null

	for (let attempt = 0; attempt < MAX_PROFILE_ATTEMPTS; attempt += 1) {
		const profile = profileFor(args.seed, args.descriptor.sceneTypes, attempt)
		const fingerprint = creativeFingerprint(profile, args.descriptor)
		last = { profile, fingerprint }
		if (avoided.has(fingerprint)) continue
		if (!firstUnseenFingerprint) firstUnseenFingerprint = last
		if (!templateWasJustUsed(profile.template, avoidedTemplates)) return last
	}

	// The space is intentionally much larger than the retained avoidance window.
	// These fallbacks are defensive and remain deterministic.
	if (firstUnseenFingerprint) return firstUnseenFingerprint
	if (!last) throw new Error('Creative profile selection failed.')
	return last
}

/* -------------------------------------------------------------------------- */
/*  Template-aware palette and typography                                     */
/* -------------------------------------------------------------------------- */

function fontPool(categories: readonly string[], devanagari: boolean): FontId[] {
	const categorized = categories.flatMap((category) => FONT_IDS_BY_CATEGORY[category] ?? [])
	const candidates = categorized.filter((id) => Boolean(FONT_KIT[id]) && (!devanagari || FONT_KIT[id].devanagari))
	if (candidates.length > 0) return [...new Set(candidates)]
	return FONT_IDS.filter((id) => !devanagari || FONT_KIT[id].devanagari)
}

/** The full art direction for one generation: house style, colour and type. */
export type ArtDirection = {
	template: TemplateId
	palette: PaletteId
	displayFont: FontId
	textFont: FontId
	profile: CreativeProfile
	fingerprint: string
}

export type ArtDirectionRequest = {
	seed: string
	sceneTypes: string[]
	motion: string
	dimension: string
	/** Set when the brief named a colour direction outright. */
	lockedPalette?: PaletteId | null
	/**
	 * Palettes the subject leans toward. Used only where they overlap the
	 * template's own list, so the film stays on-topic without breaking the
	 * house style.
	 */
	preferredPalettes?: readonly PaletteId[] | null
	/** Set when the brief named a typographic direction outright. */
	lockedDisplayFont?: FontId | null
	lockedTextFont?: FontId | null
	/**
	 * Font categories the brief asked for ("serif typography", "monospace").
	 * These narrow the pool without pinning one family, so the request is
	 * honoured and the exact pairing still changes between generations.
	 */
	displayCategories?: readonly string[] | null
	bodyCategories?: readonly string[] | null
	/** Devanagari coverage is a hard requirement, never an aesthetic choice. */
	requireDevanagari?: boolean
	avoidFingerprints?: readonly string[]
	avoidTemplates?: readonly TemplateId[]
}

/**
 * Resolves house style, palette and the type pairing together, so the fonts and
 * colours always belong to the template that was drawn rather than being picked
 * independently and then forced to live with it.
 */
export function resolveArtDirection(request: ArtDirectionRequest): ArtDirection {
	const avoided = new Set(request.avoidFingerprints?.map((item) => item.toLowerCase()) ?? [])
	const avoidedTemplates = request.avoidTemplates ?? []
	const devanagari = request.requireDevanagari === true
	let firstUnseen: ArtDirection | null = null
	let last: ArtDirection | null = null

	for (let attempt = 0; attempt < MAX_PROFILE_ATTEMPTS; attempt += 1) {
		const profile = profileFor(request.seed, request.sceneTypes, attempt)
		const recipe = TEMPLATE_KIT[profile.template]
		const key = `${request.seed}:art-attempt-${attempt}:${profile.template}`

		const housePalettes = recipe.palettes.filter((id) => PALETTE_IDS.includes(id))
		const preferred = housePalettes.filter((id) => request.preferredPalettes?.includes(id))
		const palettePool = preferred.length > 0 ? preferred : housePalettes.length > 0 ? housePalettes : PALETTE_IDS
		const palette = request.lockedPalette ?? seededChoice(key, 'palette', palettePool)

		// Devanagari briefs must draw from families that actually carry the
		// script; the template only gets to influence the shortlist inside it.
		// An explicit typographic request from the brief outranks the template.
		const displayCategories = devanagari
			? ['devanagari']
			: request.displayCategories && request.displayCategories.length > 0
				? request.displayCategories
				: recipe.displayFontCategories
		const bodyCategories = devanagari
			? ['devanagari']
			: request.bodyCategories && request.bodyCategories.length > 0
				? request.bodyCategories
				: recipe.bodyFontCategories
		const displayFont = request.lockedDisplayFont ?? seededChoice(key, 'display-font', fontPool(displayCategories, devanagari))
		const bodyCandidates = fontPool(bodyCategories, devanagari).filter((id) => id !== displayFont)
		const textFont =
			request.lockedTextFont ??
			seededChoice(
				key,
				'text-font',
				bodyCandidates.length > 0 ? bodyCandidates : FONT_IDS.filter((id) => id !== displayFont),
			)

		const descriptor: CreativeDescriptor = {
			palette,
			displayFont,
			textFont,
			motion: request.motion,
			dimension: request.dimension,
			sceneTypes: request.sceneTypes,
		}
		const fingerprint = creativeFingerprint(profile, descriptor)
		last = { template: profile.template, palette, displayFont, textFont, profile, fingerprint }
		if (avoided.has(fingerprint)) continue
		if (!firstUnseen) firstUnseen = last
		if (!templateWasJustUsed(profile.template, avoidedTemplates)) return last
	}

	if (firstUnseen) return firstUnseen
	if (!last) throw new Error('Art direction selection failed.')
	return last
}

export function creativeSeedSuffix(seed: string): string {
	return stableHash(seed, 0xa24baed4).toString(36).padStart(7, '0').slice(0, 7)
}
