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

import { ARC_IDS, ARC_KIT, arcsForTopic, type ArcId } from './arcs'
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
import {
	ACCENT_SHAPE_IDS,
	BACKGROUND_RECIPE_IDS,
	CAMERA_RECIPE_IDS,
	CORNER_STYLE_IDS,
	FINISH_RECIPE_IDS,
	LAYOUT_RECIPE_IDS,
	MOTION_SIGNATURE_IDS,
	RULE_STYLE_IDS,
	SFX_RECIPE_IDS,
	TEMPLATE_IDS,
	TEMPLATE_KIT,
	TEXT_CASE_IDS,
	TITLE_TREATMENT_IDS,
	TRANSITION_RECIPE_IDS,
	TYPOGRAPHY_RECIPE_IDS,
	type AccentShapeId,
	type BackgroundRecipeId,
	type CameraRecipeId,
	type CornerStyleId,
	type FinishRecipeId,
	type LayoutRecipeId,
	type MotionSignatureId,
	type RuleStyleId,
	type SfxRecipeId,
	type TemplateId,
	type TextCaseId,
	type TitleTreatmentId,
	type TransitionRecipeId,
	type TypographyRecipeId,
} from './template-kit'

export {
	ACCENT_SHAPE_IDS,
	BACKGROUND_RECIPE_IDS,
	CAMERA_RECIPE_IDS,
	CORNER_STYLE_IDS,
	FINISH_RECIPE_IDS,
	LAYOUT_RECIPE_IDS,
	MOTION_SIGNATURE_IDS,
	RULE_STYLE_IDS,
	SFX_RECIPE_IDS,
	TEMPLATE_IDS,
	TEMPLATE_KIT,
	TEXT_CASE_IDS,
	TITLE_TREATMENT_IDS,
	TRANSITION_RECIPE_IDS,
	TYPOGRAPHY_RECIPE_IDS,
} from './template-kit'
export type {
	AccentShapeId,
	BackgroundRecipeId,
	CameraRecipeId,
	CornerStyleId,
	FinishRecipeId,
	LayoutRecipeId,
	MotionSignatureId,
	RuleStyleId,
	SfxRecipeId,
	TemplateId,
	TemplateRecipe,
	TextCaseId,
	TitleTreatmentId,
	TransitionRecipeId,
	TypographyRecipeId,
} from './template-kit'

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
	/**
	 * The animation language: how every headline, card and badge arrives. Two
	 * videos sharing a palette and a layout still read as different films when
	 * one slams its type in and the other unfolds it.
	 */
	motionSignature: MotionSignatureId
	/** The story shape the planner used. Recorded so it can be varied and avoided. */
	arc: ArcId
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

/**
 * How many alternate renderers each scene type ships. The composer emits a
 * switch on this number, so raising it here without adding a branch there just
 * falls through to the last variant.
 */
export const SCENE_VARIANT_COUNT = 6

const TEMPO_SCALES = [0.84, 0.88, 0.92, 0.96, 1, 1.04, 1.08, 1.12, 1.16] as const
const PALETTE_SHIFTS = [0, 0, 18, 32, 48, 64, 84, 108, 140, 168, 196, 228, 262, 296, 324] as const
const MAX_AVOID_FINGERPRINTS = 48
const MAX_PROFILE_ATTEMPTS = 256

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
		motionSignature: enumValue(source.motionSignature, MOTION_SIGNATURE_IDS, fallback.motionSignature),
		arc: enumValue(source.arc, ARC_IDS, fallback.arc),
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
			return Math.abs(Math.round(number)) % SCENE_VARIANT_COUNT
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

/**
 * The arc one attempt resolves to.
 *
 * `requireArcs` is the brief speaking: a prompt that says "timeline" must get a
 * chronological shape whatever house style is drawn. When the template shares
 * no arc with the request the template's own pool is used, and the caller walks
 * on to the next attempt rather than silently telling the wrong story.
 */
function arcFor(seed: string, attempt: number, template: TemplateId, requireArcs?: readonly ArcId[]): ArcId {
	const recipe = TEMPLATE_KIT[template]
	const all = recipe.arcs as readonly ArcId[]
	const required = requireArcs && requireArcs.length > 0 ? new Set(requireArcs) : null
	const pool = required ? all.filter((id) => required.has(id)) : all
	return seededChoice(`${seed}:profile-attempt-${attempt}:${template}`, 'arc', pool.length > 0 ? pool : all)
}

function profileFor(
	seed: string,
	sceneTypes: string[],
	attempt: number,
	requireArcs?: readonly ArcId[],
): CreativeProfile {
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
		motionSignature: seededChoice(key, 'motion-signature', recipe.motion),
		arc: arcFor(seed, attempt, template, requireArcs),
		paletteShift: seededChoice(key, 'palette-shift', PALETTE_SHIFTS),
		accentSwap: seededIndex(key, 'accent-swap', 2) === 1,
		tempoScale: seededChoice(key, 'tempo-scale', recipe.tempo.length > 0 ? recipe.tempo : TEMPO_SCALES),
		sceneVariants: sceneTypes.map((type, index) => seededIndex(key, `scene-${index}-${type}`, SCENE_VARIANT_COUNT)),
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
		motionSignature: profile.motionSignature,
		arc: profile.arc,
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

/** The template and arc a seed resolves to at one attempt, before scenes exist. */
export type HouseStyle = { template: TemplateId; arc: ArcId; attempt: number }

/**
 * Resolves only the house style and story shape.
 *
 * The planner needs both *before* it can build a scene list, and the full
 * profile needs the scene list to size its per-scene arrays. Because the
 * template and the arc depend on nothing but the seed and the attempt number,
 * they can be settled first and the attempt handed back so the later, complete
 * resolution lands on exactly the same house style.
 */
export function previewHouseStyle(args: {
	seed: string
	avoidTemplates?: readonly TemplateId[]
	avoidArcs?: readonly ArcId[]
	/** Arcs the brief itself demands. When set, nothing outside it is chosen. */
	requireArcs?: readonly ArcId[]
}): HouseStyle {
	const avoidedTemplates = args.avoidTemplates ?? []
	const avoidedArcs = args.avoidArcs ?? []
	const required = args.requireArcs && args.requireArcs.length > 0 ? new Set(args.requireArcs) : null
	let templateOnly: HouseStyle | null = null
	let requiredOnly: HouseStyle | null = null

	for (let attempt = 0; attempt < MAX_PROFILE_ATTEMPTS; attempt += 1) {
		const template = templateFor(args.seed, attempt)
		const arc = arcFor(args.seed, attempt, template, args.requireArcs)
		const candidate: HouseStyle = { template, arc, attempt }
		const arcAllowed = !required || required.has(arc)

		if (arcAllowed && !requiredOnly) requiredOnly = candidate
		if (templateWasJustUsed(template, avoidedTemplates)) continue
		if (!templateOnly) templateOnly = candidate
		if (arcAllowed && !avoidedArcs.includes(arc)) return candidate
	}

	return templateOnly ?? requiredOnly ?? { template: TEMPLATE_IDS[0], arc: ARC_IDS[0], attempt: 0 }
}

export function resolveCreativeProfile(args: {
	seed: string
	descriptor: CreativeDescriptor
	avoidFingerprints?: readonly string[]
	avoidTemplates?: readonly TemplateId[]
	avoidArcs?: readonly ArcId[]
}): { profile: CreativeProfile; fingerprint: string } {
	const avoided = new Set(args.avoidFingerprints?.map((item) => item.toLowerCase()) ?? [])
	const avoidedTemplates = args.avoidTemplates ?? []
	const avoidedArcs = args.avoidArcs ?? []
	let firstUnseenFingerprint: { profile: CreativeProfile; fingerprint: string } | null = null
	let last: { profile: CreativeProfile; fingerprint: string } | null = null

	for (let attempt = 0; attempt < MAX_PROFILE_ATTEMPTS; attempt += 1) {
		const profile = profileFor(args.seed, args.descriptor.sceneTypes, attempt)
		const fingerprint = creativeFingerprint(profile, args.descriptor)
		last = { profile, fingerprint }
		if (avoided.has(fingerprint)) continue
		if (!firstUnseenFingerprint) firstUnseenFingerprint = last
		if (templateWasJustUsed(profile.template, avoidedTemplates)) continue
		if (avoidedArcs.includes(profile.arc)) continue
		return last
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
	/** Story shapes the caller has recently shipped. */
	avoidArcs?: readonly ArcId[]
	/**
	 * Story shapes the brief demands. Must match what `previewHouseStyle` was
	 * given, or the profile would record a different arc than the one the
	 * scenes were actually built from.
	 */
	requireArcs?: readonly ArcId[]
	/**
	 * The attempt `previewHouseStyle` settled on. Starting there guarantees the
	 * scenes the planner just built belong to the template that chose their arc.
	 */
	startAttempt?: number
}

/**
 * Resolves house style, palette and the type pairing together, so the fonts and
 * colours always belong to the template that was drawn rather than being picked
 * independently and then forced to live with it.
 */
export function resolveArtDirection(request: ArtDirectionRequest): ArtDirection {
	const avoided = new Set(request.avoidFingerprints?.map((item) => item.toLowerCase()) ?? [])
	const avoidedTemplates = request.avoidTemplates ?? []
	const avoidedArcs = request.avoidArcs ?? []
	const devanagari = request.requireDevanagari === true
	const start = Number.isInteger(request.startAttempt) ? Math.max(0, request.startAttempt as number) : 0
	let firstUnseen: ArtDirection | null = null
	let last: ArtDirection | null = null

	for (let step = 0; step < MAX_PROFILE_ATTEMPTS; step += 1) {
		const attempt = start + step
		const profile = profileFor(request.seed, request.sceneTypes, attempt, request.requireArcs)
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
		if (templateWasJustUsed(profile.template, avoidedTemplates)) continue
		if (avoidedArcs.includes(profile.arc)) continue
		return last
	}

	if (firstUnseen) return firstUnseen
	if (!last) throw new Error('Art direction selection failed.')
	return last
}

export function creativeSeedSuffix(seed: string): string {
	return stableHash(seed, 0xa24baed4).toString(36).padStart(7, '0').slice(0, 7)
}
