'use client'

/**
 * The 3D half of the object catalogue, without any of the 3D code.
 *
 * `npm run assets:3d` builds twelve hundred original CC0 GLB models into
 * `public/assets/3d/v1` - twenty-four families of fifty variants - and this
 * file is how the rest of the studio finds out which of them exist and which
 * one a sentence is about. It deliberately imports nothing from three.js: the
 * planner has to be able to choose a model on a machine that will never
 * download the 3D runtime, and the renderer (`object-3d.ts`) is a separate
 * chunk that is only fetched once a plan actually contains a model.
 *
 * The pack is generated rather than committed, so its absence is a normal
 * state, not an error: `loadModelCatalog` returns null and the panel says how
 * to build it instead of failing a bake half way through.
 */

import { stemsOf, wordsOf } from './object-library'

export type ModelFamily = {
	id: string
	name: string
	category: string
	description: string
	variantCount: number
	/** `assets/3d/v1/<category>/<id>/<id>-{NNN}.glb`, as written by the generator */
	pathPattern: string
	tags: string[]
	roles: string[]
}

export type ModelCatalog = {
	families: ModelFamily[]
	assetCount: number
	packVersion: string
}

/**
 * What each family is *about*, in the words a speaker would actually use.
 *
 * The generated catalogue carries tags, but they describe the model
 * ("low-poly", "pbr") more than the idea, so the spoken vocabulary is written
 * here beside the family it belongs to. A family with no entry can still be
 * chosen by hand in the panel - it just never wins a match on its own.
 */
export const MODEL_KEYWORDS: Record<string, string[]> = {
	'hero-bot': ['robot', 'bot', 'ai', 'automation', 'machine', 'assistant'],
	'soft-mascot': ['mascot', 'character', 'friendly', 'cute', 'brand'],
	'space-explorer': ['astronaut', 'explorer', 'mission', 'space', 'journey', 'rocket', 'launch', 'moon'],
	'creator-camera': ['camera', 'filming', 'shoot', 'video', 'content', 'creator'],
	'studio-device': ['device', 'gadget', 'hardware', 'studio', 'setup', 'gear', 'laptop', 'computer', 'screen', 'software'],
	'lounge-chair': ['chair', 'comfort', 'relax', 'furniture', 'home', 'sit'],
	'heart-icon': ['love', 'heart', 'like', 'care', 'health', 'favourite', 'favorite'],
	'star-icon': ['star', 'rating', 'review', 'quality', 'premium', 'best'],
	'signal-badge': ['signal', 'badge', 'notification', 'alert', 'verified', 'live', 'launch'],
	'gift-box': ['gift', 'present', 'surprise', 'giveaway', 'reward', 'bonus', 'free', 'celebrate', 'party'],
	'tool-kit': ['tools', 'toolkit', 'build', 'fix', 'repair', 'craft', 'workshop'],
	'snack-stack': ['food', 'snack', 'eat', 'lunch', 'cooking', 'restaurant', 'खाना'],
	'city-rover': ['car', 'drive', 'vehicle', 'road', 'travel', 'traffic', 'गाडी'],
	'sky-glider': ['plane', 'flight', 'fly', 'airport', 'travel', 'sky'],
	'mini-boat': ['boat', 'sea', 'ocean', 'sail', 'water', 'river'],
	'city-tower': ['city', 'building', 'office', 'urban', 'tower', 'corporate', 'money', 'business', 'market'],
	'open-pavilion': ['event', 'venue', 'stage', 'conference', 'exhibition'],
	'tiny-home': ['home', 'house', 'apartment', 'rent', 'family', 'घर'],
	'lowpoly-tree': ['tree', 'nature', 'forest', 'green', 'environment', 'रुख'],
	'bloom-flower': ['flower', 'bloom', 'spring', 'garden', 'beauty', 'फूल'],
	'ringed-planet': ['planet', 'space', 'universe', 'galaxy', 'saturn', 'cosmic'],
	'kinetic-orbit': ['orbit', 'motion', 'energy', 'dynamic', 'movement', 'cycle'],
	'energy-crystal': ['energy', 'power', 'crystal', 'charge', 'magic', 'rare'],
	'motion-ribbon': ['flow', 'smooth', 'ribbon', 'wave', 'transition'],
}

export const MODEL_CATALOG_URL = '/assets/3d/v1/catalog.json'

let cached: Promise<ModelCatalog | null> | null = null

type RawCatalog = {
	packVersion?: unknown
	assetCount?: unknown
	families?: unknown
}

const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value)

function readFamily(raw: unknown): ModelFamily | null {
	if (!isObject(raw)) return null
	const id = typeof raw.id === 'string' ? raw.id : null
	const pathPattern = typeof raw.pathPattern === 'string' ? raw.pathPattern : null
	if (!id || !pathPattern) return null
	return {
		id,
		name: typeof raw.name === 'string' ? raw.name : id,
		category: typeof raw.category === 'string' ? raw.category : 'objects',
		description: typeof raw.description === 'string' ? raw.description : '',
		variantCount:
			typeof raw.variantCount === 'number' && Number.isFinite(raw.variantCount)
				? Math.max(1, Math.round(raw.variantCount))
				: 1,
		pathPattern,
		tags: Array.isArray(raw.tags) ? raw.tags.filter((tag): tag is string => typeof tag === 'string') : [],
		roles: Array.isArray(raw.roles) ? raw.roles.filter((role): role is string => typeof role === 'string') : [],
	}
}

/**
 * Reads the generated pack's catalogue, once per page.
 *
 * Returns null - not an error - when the pack has not been built: that is the
 * default state of a fresh checkout, and the caller's job is to say so.
 */
export async function loadModelCatalog(signal?: AbortSignal): Promise<ModelCatalog | null> {
	cached ??= (async () => {
		try {
			const response = await fetch(MODEL_CATALOG_URL, { signal, cache: 'force-cache' })
			if (!response.ok) return null
			const raw = (await response.json()) as RawCatalog
			const families = Array.isArray(raw.families)
				? raw.families.flatMap((entry) => {
						const family = readFamily(entry)
						return family ? [family] : []
					})
				: []
			if (families.length === 0) return null
			return {
				families,
				assetCount: typeof raw.assetCount === 'number' ? raw.assetCount : families.length,
				packVersion: typeof raw.packVersion === 'string' ? raw.packVersion : '0.0.0',
			}
		} catch {
			return null
		}
	})()

	const result = await cached
	// A failed read must not poison the page: the pack can be built while the
	// tab is open, and the next attempt should see it.
	if (!result) cached = null
	return result
}

/* ==========================================================================
   Addressing one model.
   ========================================================================== */

/** `gift-box-014` - a family and a variant in one string, safe in a snapshot. */
export function modelAssetId(familyId: string, variant: number): string {
	return `${familyId}-${String(Math.max(1, Math.round(variant))).padStart(3, '0')}`
}

export function parseModelAssetId(assetId: string): { familyId: string; variant: number } | null {
	const match = /^(.*)-(\d{3})$/.exec(assetId)
	if (!match) return null
	const variant = Number(match[2])
	if (!Number.isFinite(variant) || variant < 1) return null
	return { familyId: match[1], variant }
}

/** The GLB address for one variant, as an absolute path from the site root. */
export function modelPathFor(family: ModelFamily, variant: number): string {
	const clamped = Math.min(family.variantCount, Math.max(1, Math.round(variant)))
	const relative = family.pathPattern.replace('{NNN}', String(clamped).padStart(3, '0'))
	return relative.startsWith('/') ? relative : `/${relative}`
}

export function modelPathForAssetId(catalog: ModelCatalog, assetId: string): string | null {
	const parsed = parseModelAssetId(assetId)
	if (!parsed) return null
	const family = catalog.families.find((entry) => entry.id === parsed.familyId)
	return family ? modelPathFor(family, parsed.variant) : null
}

/* ==========================================================================
   Matching a sentence to a model.
   ========================================================================== */

export type ModelMatch = { familyId: string; family: ModelFamily; variant: number; keyword: string; score: number }

/** FNV-1a, so the same word always picks the same variant of a family. */
function hash(text: string): number {
	let value = 0x811c9dc5
	for (let index = 0; index < text.length; index++) {
		value ^= text.charCodeAt(index)
		value = Math.imul(value, 0x01000193)
	}
	return value >>> 0
}

/**
 * Finds the model a line of speech is about.
 *
 * Same contract as the flat catalogue's matcher: an exact spoken word beats a
 * stemmed one, catalogue order breaks a tie, and a line about nothing in the
 * pack returns null rather than a shrug.
 */
export function matchModelForText(
	text: string,
	catalog: ModelCatalog,
	exclude?: ReadonlySet<string>,
): ModelMatch | null {
	const words = wordsOf(text)

	let best: ModelMatch | null = null

	catalog.families.forEach((family) => {
		if (exclude?.has(family.id)) return
		const vocabulary = new Set([...(MODEL_KEYWORDS[family.id] ?? []), ...family.tags.map((tag) => tag.toLowerCase())])
		if (vocabulary.size === 0) return

		for (const word of words) {
			const exact = vocabulary.has(word)
			const stemmed = !exact && stemsOf(word).some((stem) => vocabulary.has(stem))
			if (!exact && !stemmed) continue
			const score = exact ? 3 : 2
			if (best && score <= best.score) continue
			best = {
				familyId: family.id,
				family,
				variant: (hash(`${family.id}:${word}`) % family.variantCount) + 1,
				keyword: word,
				score,
			}
		}
	})

	return best
}
