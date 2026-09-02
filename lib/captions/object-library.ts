'use client'

/**
 * The objects that can stand behind the speaker.
 *
 * Everything here is already in the studio's own CC0 visual pack under
 * `public/assets/visual/v1`, which matters for two reasons: nothing is fetched
 * from a third party at bake time, and every file is a 512x512 SVG on a
 * transparent ground, which is exactly the shape a sprite drawn behind
 * someone's head needs to be. A raster PNG the user uploads goes through the
 * same code path; it just skips the catalogue.
 *
 * The catalogue is deliberately small and concrete. A subtitle says "rocket",
 * "laptop", "money" - it does not say "kinetic ribbon 037" - so the entries
 * that carry meaning are named after things, and the abstract families are
 * kept only where a family genuinely is the idea (confetti for a celebration,
 * bars for money, a burst for an explosion).
 *
 * Two decisions worth keeping:
 *
 * - **A word picks an asset, not the other way round.** `matchObjectForText`
 *   reads the cue's own words against a keyword index, so the object that
 *   appears is always traceable to something the speaker actually said. A cue
 *   with no match gets no object rather than a decorative one, because a shape
 *   that has nothing to do with the sentence is worse than an empty frame.
 *
 * - **A family's variant is chosen by hash, never at random.** The same
 *   sentence picks the same confetti burst on every bake, in every browser, so
 *   re-running a video is a repeat of the same work rather than a re-roll.
 */

export type ObjectAssetCategory = 'object' | 'icon' | 'shape' | 'motion' | 'symbol'

export type ObjectAsset = {
	id: string
	label: string
	category: ObjectAssetCategory
	/**
	 * The SVG to rasterise. A path holding `{variant}` is one of the pack's
	 * fifty-variant families; anything else is a single hand-drawn file.
	 */
	path: string
	/** how many variants the family has - 0 for a single file */
	variants: number
	/** the spoken words that choose this object */
	keywords: string[]
	/** default height, as a fraction of the frame height */
	scale: number
}

const single = (
	id: string,
	label: string,
	category: ObjectAssetCategory,
	folder: string,
	keywords: string[],
	scale = 0.34,
): ObjectAsset => ({
	id,
	label,
	category,
	path: `/assets/visual/v1/${folder}/${id}.svg`,
	variants: 0,
	keywords,
	scale,
})

const family = (
	id: string,
	label: string,
	category: ObjectAssetCategory,
	folder: string,
	keywords: string[],
	scale = 0.42,
): ObjectAsset => ({
	id,
	label,
	category,
	path: `/assets/visual/v1/${folder}/${id}-{variant}.svg`,
	variants: 50,
	keywords,
	scale,
})

/**
 * Concrete things first.
 *
 * Catalogue order is the tie-break in `matchObjectForText`, and a sentence
 * that mentions both a laptop and growth should show the laptop: a picture of
 * the noun beats a picture of the mood.
 */
export const OBJECT_LIBRARY: ObjectAsset[] = [
	/* ------------------------------------------------------------- things */
	single('laptop', 'Laptop', 'object', 'objects', [
		'laptop', 'computer', 'macbook', 'pc', 'coding', 'developer', 'software', 'typing', 'कम्प्युटर',
	]),
	single('phone', 'Phone', 'object', 'objects', [
		'phone', 'mobile', 'iphone', 'android', 'smartphone', 'call', 'texting', 'app', 'मोबाइल', 'फोन',
	]),
	single('camera', 'Camera', 'object', 'objects', [
		'camera', 'photo', 'photography', 'shoot', 'filming', 'lens', 'shot', 'क्यामेरा',
	]),
	single('microphone', 'Microphone', 'object', 'objects', [
		'microphone', 'mic', 'podcast', 'recording', 'voice', 'singing', 'interview', 'माइक',
	]),
	single('lightbulb', 'Idea bulb', 'object', 'objects', [
		'idea', 'insight', 'realise', 'realize', 'think', 'thought', 'lightbulb', 'invention',
		'creative', 'solution', 'आइडिया',
	]),
	single('package', 'Package', 'object', 'objects', [
		'package', 'delivery', 'shipping', 'order', 'parcel', 'box', 'product', 'ship',
	]),
	single('trophy', 'Trophy', 'object', 'objects', [
		'trophy', 'win', 'winner', 'won', 'award', 'champion', 'victory', 'prize', 'जित',
	]),
	single('planet', 'Planet', 'object', 'objects', [
		'planet', 'earth', 'world', 'global', 'globe', 'international', 'worldwide', 'संसार',
	]),

	/* -------------------------------------------------------------- icons */
	single('rocket', 'Rocket', 'icon', 'icons', [
		'rocket', 'launch', 'startup', 'fast', 'speed', 'boost', 'takeoff', 'ambition',
	]),
	single('bolt', 'Bolt', 'icon', 'icons', [
		'power', 'energy', 'instant', 'quick', 'electric', 'electricity', 'charge', 'shock', 'बिजुली',
	]),
	single('chart', 'Chart', 'icon', 'icons', [
		'chart', 'graph', 'revenue', 'sales', 'profit', 'analytics', 'metrics', 'stats',
		'statistics', 'report',
	]),
	single('check', 'Check', 'icon', 'icons', [
		'correct', 'approved', 'verified', 'complete', 'finished', 'success', 'ठीक',
	]),
	single('code', 'Code', 'icon', 'icons', [
		'code', 'program', 'programming', 'script', 'function', 'bug', 'debug', 'api', 'github',
		'repository',
	]),
	single('cube', 'Cube', 'icon', 'icons', ['cube', 'block', 'module', 'component', 'unit']),
	single('cursor', 'Cursor', 'icon', 'icons', ['click', 'cursor', 'button', 'tap', 'select', 'pointer']),
	single('layers', 'Layers', 'icon', 'icons', [
		'layers', 'stack', 'levels', 'depth', 'structure', 'architecture', 'system',
	]),
	single('play', 'Play', 'icon', 'icons', [
		'play', 'video', 'watch', 'youtube', 'stream', 'streaming', 'movie', 'clip', 'episode',
	]),
	single('sound', 'Sound', 'icon', 'icons', [
		'sound', 'audio', 'music', 'loud', 'listen', 'hear', 'song', 'volume', 'गीत',
	]),
	single('spark', 'Spark', 'icon', 'icons', [
		'magic', 'amazing', 'beautiful', 'special', 'incredible', 'sparkle', 'shine',
	]),
	single('target', 'Target', 'icon', 'icons', [
		'target', 'goal', 'focus', 'aim', 'objective', 'mission', 'plan', 'strategy', 'लक्ष्य',
	]),

	/* ------------------------------------------------------------- shapes */
	single('isometric-cube', 'Isometric cube', 'shape', 'depth-3d', ['isometric', 'volume', 'model']),
	single('prism', 'Prism', 'shape', 'depth-3d', ['prism', 'spectrum', 'refract', 'colour', 'color']),
	single('pyramid', 'Pyramid', 'shape', 'depth-3d', ['pyramid', 'hierarchy', 'foundation', 'base']),
	single('steps', 'Steps', 'shape', 'depth-3d', [
		'steps', 'step', 'process', 'stages', 'progress', 'climb', 'journey', 'roadmap',
	]),
	single('torus', 'Torus', 'shape', 'depth-3d', ['torus', 'ring', 'donut']),
	single('wire-sphere', 'Wire sphere', 'shape', 'depth-3d', [
		'sphere', 'internet', 'web', 'data', 'neural', 'intelligence',
	]),
	single('star', 'Star', 'shape', 'geometry', [
		'star', 'rating', 'favourite', 'favorite', 'quality', 'premium', 'excellent',
	]),
	single('diamond', 'Diamond', 'shape', 'geometry', [
		'diamond', 'value', 'valuable', 'rare', 'luxury', 'expensive', 'worth',
	]),
	single('hexagon', 'Hexagon', 'shape', 'geometry', ['hexagon', 'pattern', 'tile', 'cell']),
	single('orbit', 'Orbit', 'shape', 'geometry', ['revolve', 'circle', 'cycle', 'around']),
	single('triangle', 'Triangle', 'shape', 'geometry', ['triangle', 'peak', 'apex']),
	single('grid', 'Grid', 'shape', 'geometry', ['grid', 'layout', 'organised', 'organized', 'table']),

	/* ------------------------------------------------------------- arrows */
	single('arrow-up-right', 'Rising arrow', 'symbol', 'arrows', [
		'rise', 'increase', 'higher', 'better', 'improve', 'grow', 'growth', 'बढ्यो',
	]),
	single('arrow-right', 'Arrow', 'symbol', 'arrows', ['next', 'forward', 'direction']),
	single('arrow-curve', 'Curved arrow', 'symbol', 'arrows', ['return', 'undo', 'reverse', 'turn']),
	single('arrow-loop', 'Loop arrow', 'symbol', 'arrows', ['loop', 'iterate', 'retry', 'repeat']),
	single('chevrons', 'Chevrons', 'symbol', 'arrows', ['faster', 'accelerate', 'ahead', 'onwards']),

	/* --------------------------------------------------------------- neon */
	single(
		'neon-portal',
		'Neon portal',
		'motion',
		'neon',
		['portal', 'future', 'dimension', 'gateway', 'beyond', 'unknown'],
		0.5,
	),
	single('neon-ring', 'Neon ring', 'motion', 'neon', ['halo', 'aura', 'glow'], 0.5),
	single('neon-rays', 'Neon rays', 'motion', 'neon', ['light', 'bright', 'reveal', 'radiant'], 0.5),
	single('neon-bolt', 'Neon bolt', 'motion', 'neon', ['strike', 'sudden', 'flash', 'impact'], 0.42),

	/* ----------------------------------------------------------- families */
	family(
		'confetti',
		'Confetti',
		'motion',
		'symbols',
		['celebrate', 'celebration', 'party', 'congratulations', 'congrats', 'birthday', 'anniversary'],
		0.55,
	),
	family('badge', 'Badge', 'symbol', 'symbols', [
		'badge', 'certified', 'official', 'guarantee', 'trusted', 'proof', 'seal',
	]),
	family('speech', 'Speech bubble', 'symbol', 'symbols', [
		'said', 'talk', 'speak', 'conversation', 'comment', 'chat', 'message', 'question', 'भन्यो',
	]),
	family('pointer-flow', 'Pointer flow', 'symbol', 'symbols', ['choose', 'option', 'decide', 'path']),
	family('bars', 'Bar chart', 'symbol', 'data', [
		'money', 'income', 'earnings', 'business', 'market', 'invest', 'investment', 'dollars',
		'rupees', 'price', 'cost', 'पैसा',
	]),
	family('radial-data', 'Radial data', 'symbol', 'data', ['percent', 'percentage', 'share', 'ratio']),
	family('timeline', 'Timeline', 'symbol', 'data', [
		'timeline', 'schedule', 'history', 'deadline', 'tomorrow', 'समय',
	]),
	family('network', 'Network', 'symbol', 'data', [
		'team', 'people', 'community', 'connect', 'connection', 'together', 'social', 'friends',
		'network',
	]),
	family('comet', 'Comet', 'motion', 'cosmic', ['comet', 'meteor', 'streak']),
	family('constellation', 'Constellation', 'motion', 'cosmic', ['stars', 'night', 'constellation']),
	family(
		'planet-system',
		'Planet system',
		'motion',
		'cosmic',
		['space', 'universe', 'galaxy', 'solar', 'cosmic', 'nasa', 'ब्रह्माण्ड'],
		0.5,
	),
	family('satellite', 'Satellite', 'motion', 'cosmic', ['satellite', 'signal', 'gps', 'orbit']),
	family('blob', 'Blob', 'motion', 'organic', ['fluid', 'smooth', 'organic']),
	family('petals', 'Petals', 'motion', 'organic', ['flower', 'bloom', 'spring', 'beauty', 'फूल']),
	family('leaf-sprig', 'Leaf', 'motion', 'organic', [
		'nature', 'green', 'plant', 'eco', 'sustainable', 'environment', 'leaf', 'tree', 'रुख',
	]),
	family('vines', 'Vines', 'motion', 'organic', ['vine', 'spread', 'wild', 'jungle']),
	family(
		'burst',
		'Burst',
		'motion',
		'kinetic',
		['explode', 'explosion', 'blast', 'boom', 'massive'],
		0.55,
	),
	family('ribbon', 'Ribbon', 'motion', 'kinetic', ['sweep', 'silk', 'flow']),
	family('orbit-flow', 'Orbit flow', 'motion', 'kinetic', ['spin', 'rotate', 'circular']),
	family('wave-bands', 'Wave bands', 'motion', 'kinetic', [
		'wave', 'frequency', 'rhythm', 'beat', 'pulse',
	]),
	family('focus-rings', 'Focus rings', 'symbol', 'frames', ['attention', 'important', 'notice']),
	family('brackets', 'Brackets', 'symbol', 'frames', ['highlight', 'exactly', 'precisely']),
	family('capsule', 'Capsule', 'symbol', 'frames', ['label', 'tag', 'category', 'title']),
	family('ticket', 'Ticket', 'symbol', 'frames', ['ticket', 'event', 'booking', 'entry', 'pass']),
]

export const objectAssetById = (id: string): ObjectAsset | null =>
	OBJECT_LIBRARY.find((asset) => asset.id === id) ?? null

/* ==========================================================================
   Matching a sentence to an object.
   ========================================================================== */

type IndexEntry = { asset: ObjectAsset; rank: number }

/** keyword -> the assets that claim it, in catalogue order */
const KEYWORD_INDEX: Map<string, IndexEntry[]> = (() => {
	const index = new Map<string, IndexEntry[]>()
	OBJECT_LIBRARY.forEach((asset, rank) => {
		for (const keyword of asset.keywords) {
			const key = keyword.toLowerCase()
			const bucket = index.get(key)
			if (bucket) bucket.push({ asset, rank })
			else index.set(key, [{ asset, rank }])
		}
	})
	return index
})()

/**
 * The plausible roots of an inflected word, best first.
 *
 * This is deliberately not a stemmer. A real one over-trims ("business" ->
 * "busi") and would need the index stemmed to match it, which turns a lookup
 * anyone can read into one nobody can debug. What it *is* is an admission that
 * one rule per suffix is not enough: "packages" drops an s and "boxes" drops
 * two, "celebrating" wants an e back and "shipping" wants a p taken away, and
 * there is no way to tell which from the spelling. So every reading is
 * returned and the first one that is a real keyword wins. A word whose root is
 * not in the catalogue reaches nothing, which is the correct answer.
 */
export function stemsOf(word: string): string[] {
	if (word.length < 5) return []
	const candidates: string[] = []
	const push = (candidate: string) => {
		if (candidate.length >= 3 && !candidates.includes(candidate)) candidates.push(candidate)
	}

	if (word.endsWith('ies')) push(`${word.slice(0, -3)}y`)
	if (word.endsWith('s') && !word.endsWith('ss')) push(word.slice(0, -1))
	if (word.endsWith('es') && !word.endsWith('ses')) push(word.slice(0, -2))
	if (word.endsWith('ing')) {
		const stem = word.slice(0, -3)
		push(stem)
		push(`${stem}e`)
		// "shipping" -> "ship": a doubled final consonant is spelling, not root.
		if (stem.length > 2 && stem[stem.length - 1] === stem[stem.length - 2]) push(stem.slice(0, -1))
	}
	if (word.endsWith('ed')) {
		const stem = word.slice(0, -2)
		push(stem)
		push(word.slice(0, -1))
		if (stem.length > 2 && stem[stem.length - 1] === stem[stem.length - 2]) push(stem.slice(0, -1))
	}
	return candidates
}

/**
 * The words of a line, lower-cased.
 *
 * Combining marks are kept with their letters: Devanagari writes its vowels as
 * marks, so splitting on letters alone tears कम्प्युटर into eight fragments and
 * every Nepali line matches nothing at all.
 */
export function wordsOf(text: string): string[] {
	return text
		.toLowerCase()
		.split(/[^\p{L}\p{N}\p{M}]+/u)
		.filter((word) => word.length > 0)
}

export type ObjectMatch = {
	asset: ObjectAsset
	/** the spoken word that chose it, as written in the cue */
	keyword: string
	/** 3 for an exact keyword, 2 for a stemmed one - never lower */
	score: number
}

/**
 * Picks the one object a line of speech is about, or nothing.
 *
 * Nothing is a real answer here. A caption like "and then, you know, anyway"
 * has no object in it, and inventing one would put a shape behind the
 * speaker's head for no reason a viewer could follow.
 */
export function matchObjectForText(text: string, exclude?: ReadonlySet<string>): ObjectMatch | null {
	let best: (ObjectMatch & { rank: number }) | null = null

	for (const word of wordsOf(text)) {
		const candidates: Array<{ entries: IndexEntry[]; score: number }> = []
		const exact = KEYWORD_INDEX.get(word)
		if (exact) candidates.push({ entries: exact, score: 3 })
		for (const stem of stemsOf(word)) {
			const stemmed = KEYWORD_INDEX.get(stem)
			if (stemmed) {
				candidates.push({ entries: stemmed, score: 2 })
				break
			}
		}

		for (const candidate of candidates) {
			for (const entry of candidate.entries) {
				if (exclude?.has(entry.asset.id)) continue
				const better =
					!best ||
					candidate.score > best.score ||
					(candidate.score === best.score && entry.rank < best.rank)
				if (better) {
					best = { asset: entry.asset, keyword: word, score: candidate.score, rank: entry.rank }
				}
			}
		}
	}

	return best ? { asset: best.asset, keyword: best.keyword, score: best.score } : null
}

/* ==========================================================================
   Resolving one asset to one file.
   ========================================================================== */

/** FNV-1a, so a variant is stable across browsers and across bakes. */
export function hashSeed(text: string): number {
	let value = 0x811c9dc5
	for (let index = 0; index < text.length; index++) {
		value ^= text.charCodeAt(index)
		value = Math.imul(value, 0x01000193)
	}
	return value >>> 0
}

/**
 * The URL to rasterise for this asset. A family picks one of its fifty
 * variants from the seed - normally the word that chose it - so the same
 * sentence always draws the same confetti.
 */
export function objectAssetSrc(asset: ObjectAsset, seed = ''): string {
	if (asset.variants <= 0) return asset.path
	const variant = (hashSeed(`${asset.id}:${seed}`) % asset.variants) + 1
	return asset.path.replace('{variant}', String(variant).padStart(3, '0'))
}
