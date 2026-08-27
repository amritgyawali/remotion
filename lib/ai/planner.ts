/**
 * The local director.
 *
 * It reads the chat prompt and plans a complete storyboard without any network
 * call. Two jobs:
 *   1. it is the deterministic fallback whenever NVIDIA is unavailable, slow,
 *      rate limited or returns something unusable, so one click always makes a
 *      video, and
 *   2. it supplies the defaults that a partial AI answer is merged onto.
 *
 * It never invents facts. Numbers, quotes and place names only appear when the
 * user actually wrote them; otherwise the plan falls back to structural copy
 * built from the user's own words.
 */

import {
	type GrainId,
	type IconId,
	type LeakId,
	type MusicId,
	type PaletteId,
} from './kit'
import {
	DIMENSIONAL_SCENE_TYPES,
	MAX_SCENES,
	MAX_SECONDS,
	MIN_SECONDS,
	type AspectId,
	type ChartBar,
	type DimensionId,
	type GalleryItem,
	type MapPlace,
	type MotionId,
	type Scene,
	type SolidId,
	type StatItem,
	type MotionScene,
	SOLID_IDS,
	STRUCTURE_IDS,
	TERRAIN_IDS,
	TIME_OF_DAY_IDS,
	type StructureId,
	type TerrainId,
	type TimeOfDayId,
	type TimelineEvent,
	type Storyboard,
} from './storyboard'
import { ARC_KIT, arcsForTopic, isArcId, type ArcId, type BeatRole } from './arcs'
import {
	MOTION_SCENE_KIT,
	anchorMotionScenes,
	motionScenesForRole,
	type MotionSceneRecipe,
	type MotionSceneType,
} from './motion-scenes'
import {
	closeKickerFor,
	compareTitle,
	ctaLeadFor,
	evidenceTitle,
	hookLeadFor,
	kickerFor,
	listTitle,
	placeTitle,
	processTitle,
	sectionLabel,
	seededShuffle,
	showcaseTitle,
	statementFrame,
	taglineFor,
	timelineTitle,
	type CopyContext,
} from './copy'
import {
	normalizeAvoidFingerprints,
	normalizeCreativeSeed,
	previewHouseStyle,
	promptFallbackSeed,
	resolveArtDirection,
	seededChoice,
	seededIndex,
	type TemplateId,
} from './variation'

const STOP_WORDS = new Set([
	'a', 'an', 'and', 'the', 'for', 'with', 'about', 'into', 'onto', 'from', 'that', 'this', 'these',
	'those', 'make', 'create', 'generate', 'build', 'produce', 'design', 'want', 'need', 'please',
	'video', 'clip', 'reel', 'short', 'film', 'movie', 'animation', 'animated', 'second', 'seconds',
	'sec', 'secs', 'minute', 'minutes', 'long', 'style', 'styled', 'looking', 'look', 'using', 'use',
	'show', 'showing', 'shows', 'featuring', 'feature', 'features', 'aspect', 'ratio', 'format',
	'vertical', 'horizontal', 'square', 'portrait', 'landscape', 'widescreen', 'me', 'my', 'our',
	'your', 'their', 'its', 'it', 'is', 'are', 'was', 'were', 'be', 'of', 'in', 'on', 'to', 'at',
	'by', 'as', 'or', 'but', 'so', 'then', 'than', 'very', 'best', 'good', 'great', 'nice', 'cool',
	'please', 'end', 'ends', 'ending', 'start', 'starts', 'starting', 'title', 'text', 'copy',
	'how', 'why', 'what', 'when', 'where', 'explainer', 'explaining', 'works', 'work', 'working',
])

const DIRECTIVE_WORDS = [
	'second', 'seconds', 'sec', 'minute', 'aspect', 'ratio', '16:9', '9:16', '1:1', '4:5', '21:9',
	'vertical', 'horizontal', 'square', 'widescreen', 'portrait', 'no voiceover', 'voiceover',
	'font', 'typography', 'typeface', 'music', 'soundtrack', 'render', 'export',
]

/** Adjectives that describe the treatment, not the subject of the film. */
const STYLE_WORDS = new Set([
	'cinematic', 'luxury', 'luxurious', 'elegant', 'minimal', 'minimalist', 'bold', 'dark', 'light',
	'neon', 'warm', 'cool', 'modern', 'clean', 'epic', 'dramatic', 'vibrant', 'moody', 'retro',
	'futuristic', 'premium', 'professional', 'beautiful', 'stunning', 'amazing', 'aesthetic',
	'vintage', 'colorful', 'colourful', 'simple', 'smooth', 'dynamic', 'engaging', 'viral', 'hd',
	'4k', 'quality', 'high', 'serif', 'sans', 'gradient', 'blue', 'red', 'green', 'black', 'white',
	'golden', 'silver', 'pastel', 'monochrome', 'punchy', 'calm', 'fast', 'slow', 'up', 'down',
	'new', 'more', 'less', 'full', 'ai', 'generated',
])

type Topic =
	| 'history'
	| 'travel'
	| 'product'
	| 'tech'
	| 'data'
	| 'education'
	| 'food'
	| 'fitness'
	| 'event'
	| 'brand'

const TOPIC_KEYWORDS: Array<[Topic, string[]]> = [
	['history', ['history', 'historical', 'heritage', 'ancient', 'dynasty', 'empire', 'kingdom', 'century', 'civilisation', 'civilization', 'archive', 'museum', 'timeline', 'legacy', 'origins', 'medieval', 'war', 'monument']],
	['travel', ['travel', 'trip', 'tour', 'hotel', 'resort', 'destination', 'journey', 'mountain', 'trek', 'safari', 'island', 'beach', 'city break', 'hospitality', 'lodge', 'retreat', 'himalaya', 'nature', 'wildlife']],
	['product', ['product', 'launch', 'device', 'gadget', 'camera', 'phone', 'app', 'saas', 'feature', 'pricing', 'ecommerce', 'store', 'shop', 'brand new', 'unveil', 'preorder', 'startup']],
	['tech', ['code', 'coding', 'developer', 'javascript', 'python', 'api', 'algorithm', 'engineering', 'database', 'cloud', 'ai', 'machine learning', 'model', 'explainer', 'how it works', 'event loop', 'protocol', 'security', 'devops']],
	['data', ['data', 'report', 'metrics', 'growth', 'revenue', 'sales', 'finance', 'market', 'analytics', 'kpi', 'quarterly', 'benchmark', 'survey', 'statistics', 'investor']],
	['education', ['explain', 'explainer', 'lesson', 'course', 'tutorial', 'learn', 'teaching', 'student', 'school', 'university', 'training', 'guide', 'how to', 'onboarding']],
	['food', ['food', 'recipe', 'restaurant', 'cafe', 'coffee', 'kitchen', 'chef', 'menu', 'bakery', 'drink', 'cocktail', 'dining']],
	['fitness', ['fitness', 'gym', 'workout', 'health', 'wellness', 'yoga', 'run', 'marathon', 'training plan', 'nutrition', 'medical', 'clinic']],
	['event', ['event', 'conference', 'summit', 'festival', 'wedding', 'concert', 'meetup', 'webinar', 'anniversary', 'invitation', 'countdown']],
]

/**
 * Words that name a colour world outright. Only these pin the palette, because
 * a pinned palette is the one decision the house style cannot vary.
 */
const PALETTE_COLOR_KEYWORDS: Array<[PaletteId, string[]]> = [
	['neon', ['neon', 'cyberpunk', 'synthwave']],
	['mono', ['monochrome', 'black and white', 'high contrast', 'greyscale', 'grayscale']],
	['paper', ['paper', 'letterpress', 'newsprint', 'newspaper', 'off-white stock']],
	['arctic', ['white', 'ice', 'snow', 'icy']],
	['forest', ['green', 'emerald']],
	['royal', ['gold', 'golden', 'royal purple']],
	['sunrise', ['pastel', 'peach', 'coral']],
	['ember', ['orange', 'amber', 'crimson', 'scarlet']],
	['azure', ['blue', 'teal', 'cyan']],
	['midnight', ['midnight', 'inky', 'deep space']],
]

/**
 * Words that suggest a mood rather than a colour. They bias the shortlist the
 * house style draws from instead of overruling it, so "cinematic" no longer
 * forces every film into the same dark blue.
 */
const PALETTE_MOOD_KEYWORDS: Array<[PaletteId, string[]]> = [
	['neon', ['gaming', 'nightlife', 'rave', 'arcade']],
	['heritage', ['history', 'historical', 'heritage', 'ancient', 'archive', 'museum', 'dynasty', 'empire', 'temple', 'monument', 'documentary']],
	['ember', ['desert', 'sunset', 'warm', 'fire', 'sahara', 'dune', 'autumn', 'golden hour', 'volcano']],
	['forest', ['forest', 'nature', 'sustainab', 'eco', 'jungle', 'organic', 'wildlife', 'garden']],
	['royal', ['luxury', 'premium', 'elegant', 'boutique', 'couture', 'exclusive']],
	['paper', ['editorial', 'print', 'craft', 'magazine']],
	['azure', ['corporate', 'business', 'finance', 'bank', 'insurance', 'enterprise', 'b2b', 'consulting']],
	['slate', ['developer', 'engineering', 'technical', 'code', 'terminal', 'devops', 'infrastructure']],
	['sunrise', ['friendly', 'playful', 'kids', 'bright', 'cheerful', 'lifestyle', 'community']],
	['arctic', ['clean', 'minimal light', 'medical', 'clinic', 'winter']],
	['mono', ['bold minimal', 'brutalist', 'fashion']],
	['midnight', ['cinematic', 'space', 'futuristic', 'dark', 'night']],
]

const TOPIC_PALETTES: Record<Topic, readonly PaletteId[]> = {
	history: ['heritage', 'paper', 'royal'],
	travel: ['ember', 'forest', 'sunrise'],
	product: ['midnight', 'mono', 'arctic', 'royal'],
	tech: ['slate', 'midnight', 'neon', 'arctic'],
	data: ['azure', 'slate', 'arctic'],
	education: ['sunrise', 'paper', 'forest', 'arctic'],
	food: ['ember', 'sunrise', 'paper', 'forest'],
	fitness: ['forest', 'neon', 'slate', 'sunrise'],
	event: ['royal', 'neon', 'ember', 'mono'],
	brand: ['midnight', 'mono', 'royal', 'paper', 'azure'],
}

const TOPIC_MUSIC: Record<Topic, MusicId> = {
	history: 'epicCinematic',
	travel: 'warmInspiration',
	product: 'cinematicOrbit',
	tech: 'corporateClean',
	data: 'corporateClean',
	education: 'warmInspiration',
	food: 'lofiChill',
	fitness: 'neonPulse',
	event: 'neonPulse',
	brand: 'cinematicOrbit',
}

const TOPIC_ICON: Record<Topic, IconId> = {
	history: 'temple',
	travel: 'mountain',
	product: 'rocket',
	tech: 'code',
	data: 'chart',
	education: 'book',
	food: 'heart',
	fitness: 'bolt',
	event: 'star',
	brand: 'spark',
}

/**
 * Keyword lookup anchored to a word start, so "seconds" no longer matches the
 * "eco" palette rule while prefixes such as "sustainab" still match
 * "sustainability".
 */
function has(prompt: string, words: string[]): boolean {
	return words.some((word) => new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(prompt))
}

export function parseSeconds(prompt: string): number {
	const minutes = prompt.match(/(\d{1,2}(?:\.\d)?)\s*(?:-|\s)?\s*min(?:ute)?s?\b/)
	if (minutes) {
		return Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, Number.parseFloat(minutes[1]) * 60))
	}
	const seconds = prompt.match(/(\d{1,3}(?:\.\d)?)\s*(?:-|\s)?\s*(?:s\b|sec\b|secs\b|second|seconds)/)
	if (seconds) {
		return Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, Number.parseFloat(seconds[1])))
	}
	return 18
}

export function parseAspect(prompt: string): AspectId {
	const explicit = prompt.match(/\b(16\s*[:x]\s*9|9\s*[:x]\s*16|1\s*[:x]\s*1|4\s*[:x]\s*5|21\s*[:x]\s*9)\b/)
	if (explicit) {
		const compact = explicit[1].replace(/[\sx]/g, ':').replace(/::+/g, ':')
		if (compact === '16:9') return '16:9'
		if (compact === '9:16') return '9:16'
		if (compact === '1:1') return '1:1'
		if (compact === '4:5') return '4:5'
		if (compact === '21:9') return '21:9'
	}
	if (has(prompt, ['vertical', 'portrait', 'tiktok', 'reel', 'reels', 'shorts', 'story', 'stories'])) {
		return '9:16'
	}
	if (has(prompt, ['square', 'instagram post', 'feed post'])) return '1:1'
	if (has(prompt, ['4:5', 'instagram portrait'])) return '4:5'
	if (has(prompt, ['ultrawide', 'cinemascope', 'anamorphic', '21:9'])) return '21:9'
	return '16:9'
}

function detectTopic(prompt: string): Topic {
	let best: Topic = 'brand'
	let bestScore = 0
	for (const [topic, keywords] of TOPIC_KEYWORDS) {
		const score = keywords.reduce((total, keyword) => (has(prompt, [keyword]) ? total + 1 : total), 0)
		if (score > bestScore) {
			best = topic
			bestScore = score
		}
	}
	return best
}

/**
 * Only an explicit colour cue pins the palette. With no cue the template picks,
 * which is what lets the same brief come back in a different colour world.
 */
function lockedPalette(prompt: string): PaletteId | null {
	for (const [palette, keywords] of PALETTE_COLOR_KEYWORDS) {
		if (has(prompt, keywords)) return palette
	}
	return null
}

/** Mood cues first, then the topic's own leanings, as a soft shortlist. */
function preferredPalettes(prompt: string, topic: Topic): PaletteId[] {
	const moods = PALETTE_MOOD_KEYWORDS.filter(([, keywords]) => has(prompt, keywords)).map(([palette]) => palette)
	return [...new Set([...moods, ...TOPIC_PALETTES[topic]])]
}

function detectTerrain(prompt: string, seed: string): TerrainId {
	if (has(prompt, ['mountain', 'himalaya', 'everest', 'peak', 'alps', 'summit', 'ridge', 'trek'])) return 'mountain'
	if (has(prompt, ['desert', 'dune', 'sahara', 'canyon', 'arid'])) return 'desert'
	if (has(prompt, ['city', 'urban', 'skyline', 'downtown', 'metropolis', 'street'])) return 'city'
	if (has(prompt, ['forest', 'jungle', 'woods', 'tree', 'rainforest'])) return 'forest'
	if (has(prompt, ['ocean', 'sea', 'coast', 'beach', 'island', 'wave', 'harbour', 'harbor'])) return 'ocean'
	if (has(prompt, ['valley', 'plain', 'field', 'meadow', 'countryside'])) return 'valley'
	// No terrain cue in the brief: draw one rather than always building the same
	// mountain. This is the single change that stopped every unspecified film
	// opening on the same ridge line.
	return seededChoice(seed, 'terrain', TERRAIN_IDS)
}

function detectStructure(prompt: string, seed: string): StructureId {
	if (has(prompt, ['stupa', 'monastery', 'shrine', 'buddhis'])) return 'stupa'
	if (has(prompt, ['temple', 'pagoda', 'durbar', 'hindu'])) return 'temple'
	if (has(prompt, ['tower', 'skyscraper', 'lighthouse', 'minaret'])) return 'tower'
	if (has(prompt, ['arch', 'gate', 'gateway', 'portal'])) return 'arch'
	if (has(prompt, ['dome', 'mosque', 'palace', 'basilica', 'capitol'])) return 'dome'
	if (has(prompt, ['bridge', 'viaduct', 'aqueduct'])) return 'bridge'
	if (has(prompt, ['stone', 'pillar', 'obelisk', 'monolith', 'megalith'])) return 'monolith'
	return seededChoice(seed, 'structure', STRUCTURE_IDS)
}

function detectTimeOfDay(prompt: string, seed: string): TimeOfDayId {
	if (has(prompt, ['night', 'midnight', 'stars', 'moonlit', 'nocturnal'])) return 'night'
	if (has(prompt, ['sunset', 'dusk', 'golden hour', 'evening', 'twilight'])) return 'dusk'
	if (has(prompt, ['noon', 'daylight', 'bright day', 'midday'])) return 'day'
	// Unspecified light used to be dawn every single time, which put the same
	// low sun in the same corner of every landscape the director drew.
	return seededChoice(seed, 'time-of-day', TIME_OF_DAY_IDS)
}

/**
 * Words that are an actual request for three-dimensional treatment. Ambient
 * nouns such as "render", "glass" or "earth" are deliberately absent: they used
 * to drag ordinary briefs into WebGL and made every film look the same.
 */
const THREE_D_REQUEST_WORDS = [
	'3d', '3-d', 'three dimensional', 'three-dimensional', 'webgl', 'cgi', 'cinema 4d', 'c4d',
	'blender render', 'octane', 'ray trace', 'raytrace', 'ray-trace', 'turntable', 'product turntable',
	'3d model', '3d models', '3d scene', '3d animation', '3d text', '3d globe', '3d map', '3d chart',
	'rotating globe', 'spinning globe', 'volumetric', 'extruded 3d', 'mesh render', 'polygonal',
]

/** Words that ask for the flat, purely graphic treatment outright. */
const FLAT_REQUEST_WORDS = [
	'flat design', 'flat 2d', '2d', 'two dimensional', 'two-dimensional', 'text only', 'text-only',
	'typographic only', 'purely typographic', 'no 3d', 'no depth', 'no perspective', 'vector only',
]

/** Words that ask for layered depth without asking for real geometry. */
const DEPTH_REQUEST_WORDS = [
	'parallax', 'depth', 'layered', 'perspective', 'dimensional', 'cinematic camera', 'dolly',
	'camera move', 'push in', 'tilt shift', 'diorama',
]

/**
 * True only when the brief actually asks for three-dimensional treatment.
 * Exported so the API route can hold the model to the same rule it gives the
 * local planner.
 */
export function promptRequestsThreeDimensional(rawPrompt: string): boolean {
	const prompt = rawPrompt.toLowerCase()
	if (has(prompt, FLAT_REQUEST_WORDS)) return false
	return has(prompt, THREE_D_REQUEST_WORDS)
}

/**
 * WebGL is opt-in. Unless the brief asks for 3D in so many words the film is
 * built from flat graphic design, which is what keeps consecutive generations
 * from converging on the same lit-object look. A perspective stage is still
 * available when the brief asks for depth, parallax or a camera move.
 */
function detectDimension(rawPrompt: string, prompt: string, allowThreeDimensional: boolean): DimensionId {
	if (allowThreeDimensional && !has(prompt, FLAT_REQUEST_WORDS)) return 'three'
	if (has(prompt, FLAT_REQUEST_WORDS)) return 'flat'
	if (has(prompt, DEPTH_REQUEST_WORDS)) return 'depth'
	return 'flat'
}

function detectSolid(prompt: string, seed: string): SolidId {
	if (has(prompt, ['sphere', 'ball', 'orb', 'planet', 'bubble'])) return 'sphere'
	if (has(prompt, ['torus', 'knot', 'loop', 'infinite', 'flow'])) return 'torus'
	if (has(prompt, ['cube', 'box', 'block', 'package', 'container'])) return 'cube'
	if (has(prompt, ['prism', 'hexagon', 'column', 'pillar'])) return 'prism'
	if (has(prompt, ['capsule', 'pill', 'battery', 'cylinder'])) return 'capsule'
	if (has(prompt, ['ring', 'halo', 'circle', 'portal', 'cycle'])) return 'ring'
	return seededChoice(seed, 'solid', SOLID_IDS)
}

function detectMotion(prompt: string): MotionId {
	if (has(prompt, ['fast', 'punchy', 'energetic', 'hype', 'snappy', 'kinetic', 'tiktok', 'shorts'])) return 'punchy'
	if (has(prompt, ['calm', 'slow', 'gentle', 'meditative', 'elegant', 'luxury', 'documentary', 'ambient'])) return 'calm'
	return 'balanced'
}

function detectGrain(prompt: string, palette: PaletteId): GrainId {
	if (has(prompt, ['paper', 'print', 'letterpress', 'craft', 'archive'])) return 'paper'
	if (has(prompt, ['halftone', 'comic', 'risograph', 'newsprint'])) return 'halftone'
	if (has(prompt, ['scanline', 'crt', 'retro tv', 'vhs', 'glitch'])) return 'scanlines'
	if (has(prompt, ['film', 'cinematic', '35mm', 'analog', 'documentary'])) return 'film'
	return palette === 'paper' || palette === 'arctic' || palette === 'sunrise' ? 'soft' : 'fine'
}

function detectLeak(prompt: string, palette: PaletteId): LeakId {
	if (has(prompt, ['light leak', 'flare', 'golden hour', 'sunset', 'warm light', 'desert'])) return 'warm'
	if (has(prompt, ['cool light', 'mist', 'fog', 'ice', 'blue hour', 'moon'])) return 'cool'
	return palette === 'ember' || palette === 'heritage' ? 'warm' : palette === 'midnight' || palette === 'azure' ? 'cool' : 'none'
}

type TypeRequest = {
	requireDevanagari: boolean
	/** Empty means "no explicit request", so the template decides. */
	displayCategories: string[]
	bodyCategories: string[]
}

/**
 * Reads a typographic request out of the brief without pinning one family.
 *
 * Only the script requirement is absolute. Everything else narrows the pool the
 * house style draws from, so "elegant serif typography" is honoured while the
 * exact pairing still changes between generations.
 */
function detectTypeRequest(rawPrompt: string, prompt: string): TypeRequest {
	// Script coverage is a prerequisite, not an aesthetic afterthought. Check the
	// actual Unicode range before any style keyword can select a Latin-only
	// family.
	const requireDevanagari =
		/[\u0900-\u097f]/u.test(rawPrompt) || has(prompt, ['devanagari', 'nepali', 'hindi', 'nepal', 'kathmandu'])
	if (requireDevanagari) {
		return { requireDevanagari, displayCategories: ['devanagari'], bodyCategories: ['devanagari'] }
	}
	if (has(prompt, ['serif', 'elegant typography', 'editorial typography', 'classical type'])) {
		return { requireDevanagari, displayCategories: ['serif'], bodyCategories: ['serif', 'sans', 'grotesk'] }
	}
	if (has(prompt, ['monospace', 'mono type', 'terminal type', 'typewriter'])) {
		return { requireDevanagari, displayCategories: ['mono', 'tech'], bodyCategories: ['mono'] }
	}
	if (has(prompt, ['handwritten', 'handwriting', 'script type', 'signature type', 'brush type'])) {
		return { requireDevanagari, displayCategories: ['handwriting', 'script'], bodyCategories: ['sans', 'serif'] }
	}
	if (has(prompt, ['pixel', '8-bit', '8 bit', 'retro game', 'arcade type'])) {
		return { requireDevanagari, displayCategories: ['pixel', 'retro'], bodyCategories: ['mono', 'sans'] }
	}
	if (has(prompt, ['condensed', 'narrow type', 'poster type'])) {
		return { requireDevanagari, displayCategories: ['condensed', 'display'], bodyCategories: ['grotesk', 'sans'] }
	}
	if (has(prompt, ['rounded type', 'friendly typography', 'playful typography'])) {
		return { requireDevanagari, displayCategories: ['rounded', 'comic'], bodyCategories: ['rounded', 'sans'] }
	}
	return { requireDevanagari, displayCategories: [], bodyCategories: [] }
}

/**
 * Verbs that frame a request rather than name a subject.
 *
 * "Explain how solar panels work" is a brief about solar panels; leaving the
 * verb in produced titles like "Explain Solar Panels Turn", which is the studio
 * reading its own instructions back to the viewer.
 */
const FRAMING_VERBS = new Set([
	'explain', 'explains', 'explaining', 'describe', 'describes', 'tell', 'tells', 'teach', 'teaches',
	'cover', 'covers', 'discuss', 'discusses', 'present', 'presents', 'introduce', 'introduces',
	'summarise', 'summarize', 'outline', 'outlines', 'review', 'reviews', 'analyse', 'analyze',
	'walk', 'walks', 'talk', 'talks', 'highlight', 'highlights', 'showcase', 'showcases',
])

/** Linking verbs that survive the stop list but say nothing about the subject. */
const LINKING_VERBS = new Set([
	'turn', 'turns', 'turning', 'become', 'becomes', 'becoming', 'gets', 'goes', 'comes',
	'happens', 'happen', 'means', 'gives', 'takes', 'puts',
])

function titleCase(value: string): string {
	return value
		.split(/\s+/)
		.filter(Boolean)
		.map((word) => (word.length > 2 ? word[0].toUpperCase() + word.slice(1) : word))
		.join(' ')
}

function extractQuoted(raw: string): string[] {
	return [...raw.matchAll(/[“"']([^“”"']{2,80})[”"']/g)]
		.map((match) => match[1].trim())
		.filter((value) => value.length > 1)
}

/**
 * Strips the request wrapper off a line.
 *
 * "A short film about street food in Kathmandu" is a request for a film about
 * street food; putting the whole sentence on a card makes the video narrate its
 * own prompt. Only the framing is removed - every word about the subject stays.
 */
function stripRequestFraming(value: string): string {
	let out = value.trim()
	const preambles = [
		/^(please\s+)?(can you\s+)?(make|create|generate|build|produce|design|do|give me|show me|i want|i need)\b/i,
		/^(a|an|the)\s+(short|quick|small|brief|long|full)?\s*(film|video|clip|reel|animation|teaser|explainer|montage|promo|ad|advert|story)\b/i,
		/^(film|video|clip|reel|animation|teaser|explainer|montage|promo|ad|advert)\b/i,
		/^(explain|describe|tell me|teach me|show|walk me through|introduce|summarise|summarize|outline)\b/i,
		/^(about|on|for|of|regarding|covering)\b/i,
	]
	/**
	 * "a calm meditation video about breathing" and "launch teaser for a new
	 * running shoe" both name the deliverable before they name the subject. When
	 * a media word is followed by about/for/of near the start of the line,
	 * everything up to that preposition is the request, not the film.
	 */
	const deliverable =
		/^[^.]{0,40}?\b(film|video|clip|reel|animation|teaser|trailer|promo|advert|ad|explainer|montage|short|story|piece)\b\s+(about|for|on|of|covering)\s+(a|an|the)?\s*/i
	const trimmed = out.replace(deliverable, '').trim()
	if (trimmed.length > 2) out = trimmed

	let changed = true
	while (changed) {
		changed = false
		for (const pattern of preambles) {
			const next = out.replace(pattern, '').trim()
			if (next !== out && next.length > 2) {
				out = next
				changed = true
			}
		}
	}
	return out.replace(/^[-–—:,]\s*/, '').trim()
}

/** Comma / "and" separated fragments of the brief, minus the production directives. */
function briefFragments(raw: string): string[] {
	return raw
		.replace(/[“”"']/g, ' ')
		.split(/[,;.\n]|\band\b|\bwith\b|\bplus\b/i)
		.map((part) => stripRequestFraming(part.replace(/\s+/g, ' ').trim()))
		.filter((part) => part.length > 2 && part.split(' ').length <= 9)
		.filter((part) => !DIRECTIVE_WORDS.some((word) => part.toLowerCase().includes(word)))
		.filter((part) => {
			const words = part.toLowerCase().split(/\s+/).filter(Boolean)
			// A fragment made only of art direction ("corporate blue") is a
			// treatment note, not something the film should put on a card.
			return words.some((word) => !STYLE_WORDS.has(word) && !STOP_WORDS.has(word))
		})
}

function properNouns(raw: string): string[] {
	const words = raw.split(/\s+/)
	const found: string[] = []
	for (const [index, word] of words.entries()) {
		const clean = word.replace(/[^A-Za-z-]/g, '')
		if (clean.length < 3) continue
		if (clean[0] !== clean[0].toUpperCase()) continue
		if (index === 0) {
			/**
			 * The first word of a sentence is capitalised whatever it is, so it
			 * is no evidence of a name. "Explain how solar panels work" was
			 * yielding "Explain" as a proper noun and printing it on a card. It
			 * only counts here if the brief capitalises it again later, or if
			 * the word after it is also capitalised.
			 */
			const next = (words[1] ?? '').replace(/[^A-Za-z-]/g, '')
			const repeated = words.slice(1).some((other) => other.replace(/[^A-Za-z-]/g, '') === clean)
			const startsName = next.length > 1 && next[0] === next[0].toUpperCase()
			if (!repeated && !startsName) continue
			if (FRAMING_VERBS.has(clean.toLowerCase()) || LINKING_VERBS.has(clean.toLowerCase())) continue
		}
		if (STOP_WORDS.has(clean.toLowerCase())) continue
		// "New" is a style word on its own and half of a place name in "New
		// Orleans". A capital that is not sentence-initial and is followed by
		// another capital is part of a name, so it stays.
		const next = (words[index + 1] ?? '').replace(/[^A-Za-z-]/g, '')
		const partOfName = index > 0 && next.length > 1 && next[0] === next[0].toUpperCase()
		if (STYLE_WORDS.has(clean.toLowerCase()) && !partOfName) continue
		/**
		 * Consecutive capitals are one name. Kept apart, "New Orleans" reached
		 * the screen as two cards reading "New" and "Orleans".
		 */
		const previous = found.at(-1)
		const followsName =
			previous !== undefined && index > 0 && words[index - 1].replace(/[^A-Za-z-]/g, '').endsWith(previous)
		if (followsName) {
			found[found.length - 1] = previous + ' ' + clean
			continue
		}
		if (!found.some((name) => name.split(' ').includes(clean))) found.push(clean)
	}
	return found.slice(0, 6)
}

/**
 * The subject is what the film is about, not how it should look. Duration,
 * aspect ratio and art direction are stripped, and any proper noun is promoted
 * to the front so "cinematic 20-second history of Nepal" becomes "Nepal
 * History".
 */
function subjectOf(raw: string): string {
	const firstClause = raw.split(/[,;.\n]/)[0] ?? raw
	// Names are grouped ("New Orleans"); membership here is tested per word.
	const nouns = properNouns(raw).flatMap((noun) => noun.toLowerCase().split(' '))
	const words = firstClause
		.replace(/[^A-Za-z0-9\s-]/g, ' ')
		.split(/\s+/)
		.filter(Boolean)
		.filter((word) => !/\d/.test(word))
		.filter((word) => !FRAMING_VERBS.has(word.toLowerCase()))
		.filter((word) => !LINKING_VERBS.has(word.toLowerCase()))
		.filter((word) => !STOP_WORDS.has(word.toLowerCase()))
		.filter((word) => nouns.includes(word.toLowerCase()) || !STYLE_WORDS.has(word.toLowerCase()))

	/**
	 * The brief's own order is kept. Promoting proper nouns to the front turned
	 * "the history of jazz in New Orleans" into "Orleans History Jazz", which is
	 * not a phrase anybody would write.
	 */
	const ordered = words

	const subject = ordered.slice(0, 4).join(' ')
	if (subject.length >= 3) return titleCase(subject)
	const fallbackNouns = properNouns(raw)
	return fallbackNouns.length > 0 ? fallbackNouns.slice(0, 3).join(' ') : 'Your Story'
}

function numbersWithLabels(raw: string): StatItem[] {
	const matches = [
		...raw.matchAll(
			/(\$|€|£)?\s?(\d{1,3}(?:[,\d]{0,12})(?:\.\d+)?)\s?(%|percent|x|k\b|m\b|bn\b|million|billion|hours?|days?|weeks?|months?|years?|km|kg|mph|fps)?\s*([A-Za-z][A-Za-z\s-]{2,28})?/g,
		),
	]
	const stats: StatItem[] = []
	for (const match of matches) {
		const value = Number.parseFloat(match[2].replace(/,/g, ''))
		if (!Number.isFinite(value)) continue
		const unit = (match[3] ?? '').trim()
		const label = (match[4] ?? '').replace(/\s+/g, ' ').trim()
		if (!label || label.split(' ').length > 4) continue
		if (DIRECTIVE_WORDS.some((word) => label.toLowerCase().includes(word))) continue
		stats.push({
			value,
			prefix: match[1] ?? '',
			suffix: unit === 'percent' ? '%' : unit,
			label: titleCase(label),
			decimals: Number.isInteger(value) ? 0 : 1,
		})
		if (stats.length === 3) break
	}
	return stats
}

function yearEvents(raw: string): TimelineEvent[] {
	const matches = [...raw.matchAll(/\b(1\d{3}|20\d{2}|\d{1,2}(?:st|nd|rd|th)\s+century)\b[\s:–-]*([A-Za-z][^,;.\n]{2,60})?/g)]
	const events: TimelineEvent[] = []
	for (const match of matches) {
		const detail = (match[2] ?? '').replace(/\s+/g, ' ').trim()
		events.push({
			marker: match[1],
			title: detail ? titleCase(detail.split(' ').slice(0, 5).join(' ')) : 'Milestone',
			detail: detail.length > 24 ? detail.slice(0, 110) : '',
		})
		if (events.length === 5) break
	}
	return events
}

const STRUCTURAL_ERAS = ['Origins', 'Formation', 'Turning Point', 'Modern Era']

function galleryFrom(fragments: string[], topic: Topic): GalleryItem[] {
	const icons: Record<Topic, IconId[]> = {
		history: ['book', 'temple', 'compass', 'flag', 'globe', 'clock'],
		travel: ['mountain', 'compass', 'camera', 'sun', 'pin', 'leaf'],
		product: ['rocket', 'bolt', 'layers', 'shield', 'target', 'spark'],
		tech: ['code', 'database', 'cloud', 'gear', 'layers', 'bolt'],
		data: ['chart', 'target', 'coin', 'users', 'search', 'layers'],
		education: ['book', 'idea', 'users', 'check', 'target', 'spark'],
		food: ['heart', 'leaf', 'star', 'clock', 'users', 'spark'],
		fitness: ['bolt', 'heart', 'target', 'clock', 'users', 'check'],
		event: ['star', 'users', 'microphone', 'clock', 'pin', 'trophy'],
		brand: ['spark', 'layers', 'target', 'bolt', 'globe', 'check'],
	}
	const palette = icons[topic]
	return fragments.slice(0, 4).map((fragment, index) => {
		const parts = fragment.split(' ')
		return {
			title: titleCase(parts.slice(0, 4).join(' ')),
			// The detail is the *rest* of the line. Returning the whole fragment
			// printed the title again underneath itself on every card.
			detail: parts.length > 4 ? parts.slice(4).join(' ') : '',
			icon: palette[index % palette.length],
		}
	})
}

function mapPlaces(nouns: string[]): MapPlace[] {
	const positions = [
		{ x: 0.28, y: 0.34 },
		{ x: 0.62, y: 0.28 },
		{ x: 0.46, y: 0.58 },
		{ x: 0.74, y: 0.66 },
		{ x: 0.2, y: 0.7 },
	]
	return nouns.slice(0, positions.length).map((name, index) => ({
		name,
		detail: '',
		x: positions[index].x,
		y: positions[index].y,
	}))
}

function chartBars(stats: StatItem[]): ChartBar[] {
	return stats.map((stat) => ({ label: stat.label, value: Math.abs(stat.value) }))
}

export type StoryboardPlanOptions = {
	creativeSeed?: string
	avoidDesignFingerprints?: readonly string[]
	/** House styles used by the caller's recent videos, never reused back to back. */
	avoidTemplates?: readonly TemplateId[]
	/** Story shapes used by the caller's recent videos, never reused back to back. */
	avoidArcs?: readonly ArcId[]
	/**
	 * Overrides the 3D gate. The API route decides this across the whole chat,
	 * so a follow-up turn ("now make it 20 seconds") keeps an earlier 3D
	 * request. Left unset, only the prompt itself is read.
	 */
	allowThreeDimensional?: boolean
}

/* -------------------------------------------------------------------------- */
/*  Arc engine                                                                */
/* -------------------------------------------------------------------------- */

/** Everything the beat resolvers may draw on. Nothing here is invented. */
type BriefContent = {
	seed: string
	subject: string
	topic: Topic
	prompt: string
	fragments: string[]
	nouns: string[]
	stats: StatItem[]
	years: TimelineEvent[]
	quoted: string[]
	solid: boolean
	copy: CopyContext
	/** Cursors into the brief, so no two scenes quote the same line. */
	cursor: { fragment: number; showcase: number; list: number; statement: number }
	/**
	 * Motion pieces already spent in this film, and the visual family of the
	 * scene that came immediately before. Together they stop one generation from
	 * running two pieces of the same design language back to back, and stop the
	 * same piece appearing twice in one edit.
	 */
	usedMotion: Set<MotionSceneType>
	usedFamilies: Set<string>
	lastFamily: string
}

function nextFragment(content: BriefContent): string {
	const value = content.fragments[content.cursor.fragment] ?? ''
	if (value) content.cursor.fragment += 1
	return value ? titleCase(value) : ''
}


/* -------------------------------------------------------------------------- */
/*  Motion scene selection                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The lines a motion piece lays out.
 *
 * Read from the cursor forward so two scenes in one film never set the same
 * sentence, and shuffled with the seed so the order is not the order the user
 * happened to type.
 */
function motionCopyLines(content: BriefContent, ordinal: number, want: number): string[] {
	const pool = content.fragments.slice(content.cursor.fragment)
	const taken = pool.slice(0, want).map((line) => titleCase(line))
	if (taken.length > 0) content.cursor.fragment += Math.min(taken.length, Math.max(1, want - 1))
	// Bare proper nouns only stand in when the brief gave nothing else. Mixed in
	// beside real lines they read as a word salad - "New", "Orleans" as separate
	// cards rather than as a place.
	const merged =
		taken.length > 0 ? taken : content.nouns.length >= 2 ? content.nouns.map((noun) => titleCase(noun)) : []
	return seededShuffle(content.seed, `motion-lines-${ordinal}`, merged.slice(0, want))
}

/** The headline a motion piece carries, chosen to suit the beat it is filling. */
function motionHeadline(content: BriefContent, role: BeatRole, ordinal: number): string {
	switch (role) {
		case 'open':
			return content.subject
		case 'evidence':
			return evidenceTitle(content.copy)
		case 'list':
			return listTitle(content.copy, ordinal)
		case 'steps':
			return processTitle(content.copy)
		case 'time':
			return timelineTitle(content.copy)
		case 'place':
			return placeTitle(content.copy)
		case 'showcase':
			return showcaseTitle(content.copy, ordinal)
		case 'compare':
			return compareTitle(content.copy)
		case 'quote':
			return content.quoted[Math.min(ordinal, Math.max(0, content.quoted.length - 1))] || statementFrame(content.copy, ordinal)
		case 'close':
			return ctaLeadFor(content.copy)
		default:
			return nextFragment(content) || statementFrame(content.copy, ordinal)
	}
}

/** The small label above the figure, matched to the beat rather than fixed. */
function motionKicker(content: BriefContent, role: BeatRole, ordinal: number): string {
	switch (role) {
		case 'open':
			return kickerFor(content.copy)
		case 'hook':
			return hookLeadFor(content.copy)
		case 'close':
			return closeKickerFor(content.copy)
		case 'context':
		case 'evidence':
		case 'list':
		case 'steps':
		case 'time':
		case 'place':
		case 'showcase':
		case 'compare':
		case 'turn':
		case 'quote':
			return sectionLabel(role, content.copy, ordinal)
		default:
			return kickerFor(content.copy)
	}
}

/**
 * Draws one motion piece for a beat.
 *
 * This is where a generation stops repeating itself. The pool for a beat is
 * every piece in the library that can carry that beat honestly, minus the ones
 * this film has already used, minus anything sharing a visual family with the
 * scene immediately before, minus the number-shaped pieces when the brief
 * carried no numbers. Whatever survives is drawn with the request seed - so the
 * same brief on the same arc still cuts differently on the next generation.
 */
function motionScene(content: BriefContent, role: BeatRole, ordinal: number, anchor = false): MotionScene | null {
	const base = anchor ? anchorMotionScenes(role) : motionScenesForRole(role)
	const hasNumbers = content.stats.length >= 2
	/**
	 * A deck, a wall or a checklist with one row on it looks broken, and the
	 * renderers deliberately refuse to pad themselves with invented rows. So a
	 * card-shaped piece is only eligible while the brief still has enough left in
	 * it to fill one.
	 */
	const availableItems =
		galleryFrom(content.fragments.slice(content.cursor.list), content.topic).length +
		content.fragments.slice(content.cursor.fragment).length
	/** Distinct phrases still available to a multi-slot composition. */
	const availableLines =
		1 + // the headline itself, which every piece can always set
		content.fragments.slice(content.cursor.fragment).length +
		content.stats.length +
		content.quoted.length +
		(content.nouns.length >= 2 ? content.nouns.length : 0)
	const eligible = base.filter((id) => {
		const recipe = MOTION_SCENE_KIT[id] as MotionSceneRecipe
		if (recipe.needs === 'numbers' && !hasNumbers) return false
		if (recipe.needs === 'items' && availableItems < 3) return false
		if ((recipe.minLines ?? 1) > Math.max(1, availableLines)) return false
		return true
	})
	const fresh = eligible.filter((id) => !content.usedMotion.has(id))
	// Three preferences, applied in order: a piece this film has not used, from a
	// visual family it has not used, and never one sharing a family with the
	// scene immediately before. Each falls back to the next when it empties.
	const unusedFamily = fresh.filter((id) => !content.usedFamilies.has(MOTION_SCENE_KIT[id].family))
	const notAdjacent = fresh.filter((id) => MOTION_SCENE_KIT[id].family !== content.lastFamily)
	const pool =
		unusedFamily.length > 0 ? unusedFamily : notAdjacent.length > 0 ? notAdjacent : fresh.length > 0 ? fresh : eligible
	if (pool.length === 0) return null

	const chosen = seededChoice(content.seed, `motion-${role}-${ordinal}-${content.usedMotion.size}`, pool)
	content.usedMotion.add(chosen)
	content.usedFamilies.add(MOTION_SCENE_KIT[chosen].family)
	content.lastFamily = MOTION_SCENE_KIT[chosen].family

	const wants = MOTION_SCENE_KIT[chosen].needs
	const lines = motionCopyLines(content, ordinal, wants === 'items' ? 6 : 5)
	const items = galleryFrom(content.fragments.slice(content.cursor.list), content.topic)
	if (items.length > 0 && wants === 'items') content.cursor.list += Math.min(items.length, 3)

	return {
		type: chosen,
		seconds: 0,
		kicker: motionKicker(content, role, ordinal),
		headline: motionHeadline(content, role, ordinal),
		caption: role === 'close' ? taglineFor(content.copy) : nextFragment(content),
		lines,
		items,
		stats: content.stats.slice(0, 4),
		icon: TOPIC_ICON[content.topic],
	}
}

/**
 * Should this beat be told with a motion piece rather than a classic card?
 *
 * Weighted by the seed, so a film is a mix rather than all one or all the
 * other. The classic renderers stay in rotation because they are the ones that
 * can lay out a real timeline, a real map or a real set of figures.
 */
function prefersMotion(content: BriefContent, role: BeatRole, ordinal: number, weight: number): boolean {
	if (motionScenesForRole(role).length === 0) return false
	return seededIndex(content.seed, `motion-gate-${role}-${ordinal}`, 100) < weight
}

/** Beats that need content the brief does not carry are dropped, not faked. */
type BeatResolver = (content: BriefContent, ordinal: number) => Scene | null

/**
 * The opening card.
 *
 * Two thirds of the time this is a piece from the motion library rather than
 * the classic title card, because the first four seconds are what a viewer
 * uses to decide whether they have seen this video before.
 */
const resolveOpen: BeatResolver = (content, ordinal) => {
	if (prefersMotion(content, 'open', ordinal, 68)) {
		const scene = motionScene(content, 'open', ordinal, true)
		if (scene) return scene
	}
	return {
		type: 'title',
		seconds: 0,
		kicker: kickerFor(content.copy),
		headline: content.subject,
		subline: nextFragment(content),
		icon: TOPIC_ICON[content.topic],
	}
}

const resolveHook: BeatResolver = (content, ordinal) => {
	if (prefersMotion(content, 'hook', ordinal, 76)) {
		const scene = motionScene(content, 'hook', ordinal, true)
		if (scene) return scene
	}
	return {
		type: 'statement',
		seconds: 0,
		text: nextFragment(content) || statementFrame(content.copy, ordinal),
		highlight: content.subject.split(' ')[0] ?? '',
		footnote: hookLeadFor(content.copy),
	}
}

const resolveThesis: BeatResolver = (content, ordinal) => {
	content.cursor.statement += 1
	if (prefersMotion(content, 'thesis', ordinal, 70)) {
		const scene = motionScene(content, 'thesis', ordinal)
		if (scene) return scene
	}
	return {
		type: 'statement',
		seconds: 0,
		text: nextFragment(content) || statementFrame(content.copy, content.cursor.statement),
		highlight: content.subject.split(' ')[0] ?? '',
		footnote: sectionLabel('context', content.copy, ordinal),
	}
}

const resolveList: BeatResolver = (content, ordinal) => {
	const pool = content.fragments.slice(content.cursor.list)
	const items = galleryFrom(pool, content.topic)
	if (prefersMotion(content, 'list', ordinal, items.length < 2 ? 100 : 66)) {
		const scene = motionScene(content, 'list', ordinal)
		if (scene) return scene
	}
	if (items.length < 2) return null
	content.cursor.list += items.length
	const ordered = seededShuffle(content.seed, `list-order-${ordinal}`, items)
	return content.solid && ordered.length >= 3
		? { type: 'carousel3d', seconds: 0, headline: listTitle(content.copy, ordinal), items: ordered }
		: { type: 'gallery', seconds: 0, headline: listTitle(content.copy, ordinal), items: ordered }
}

const resolveQuote: BeatResolver = (content, ordinal) => {
	const quote = content.quoted[Math.min(ordinal, content.quoted.length - 1)]
	if (!quote) {
		const scene = motionScene(content, 'quote', ordinal)
		return scene ?? resolveThesis(content, ordinal)
	}
	if (prefersMotion(content, 'quote', ordinal, 45)) {
		const scene = motionScene(content, 'quote', ordinal)
		if (scene) return scene
	}
	return { type: 'quote', seconds: 0, quote, attribution: '' }
}

const resolveContext: BeatResolver = (content, ordinal) => {
	if (prefersMotion(content, 'context', ordinal, 70)) {
		const scene = motionScene(content, 'context', ordinal)
		if (scene) return scene
	}
	const line = nextFragment(content)
	if (!line && content.quoted.length > 0) return resolveQuote(content, ordinal)
	return {
		type: 'statement',
		seconds: 0,
		text: line || statementFrame(content.copy, ordinal + 3),
		highlight: '',
		footnote: sectionLabel('context', content.copy, ordinal),
	}
}

const resolveEvidence: BeatResolver = (content, ordinal) => {
	if (content.stats.length >= 2) {
		if (prefersMotion(content, 'evidence', ordinal, 62)) {
			const scene = motionScene(content, 'evidence', ordinal)
			if (scene) return scene
		}
		return { type: 'stats', seconds: 0, headline: evidenceTitle(content.copy), stats: content.stats.slice(0, 3) }
	}
	if (prefersMotion(content, 'evidence', ordinal, 74)) {
		const scene = motionScene(content, 'evidence', ordinal)
		if (scene) return scene
	}
	// No figures in the brief means no figures on screen. The beat falls back to
	// the set of ideas the brief did supply.
	return resolveList(content, ordinal)
}

const resolveCompare: BeatResolver = (content, ordinal) => {
	if (prefersMotion(content, 'compare', ordinal, content.stats.length >= 2 ? 55 : 84)) {
		const scene = motionScene(content, 'compare', ordinal)
		if (scene) return scene
	}
	if (content.stats.length >= 2) {
		return {
			type: 'chart',
			seconds: 0,
			headline: compareTitle(content.copy),
			unit: content.stats[0]?.suffix ?? '',
			bars: chartBars(content.stats),
		}
	}
	return resolveList(content, ordinal)
}

const resolveSteps: BeatResolver = (content, ordinal) => {
	if (prefersMotion(content, 'steps', ordinal, 66)) {
		const scene = motionScene(content, 'steps', ordinal)
		if (scene) return scene
	}
	const pool = content.fragments.slice(content.cursor.list)
	const steps = galleryFrom(pool, content.topic).slice(0, 4)
	if (steps.length < 2) return resolveList(content, ordinal)
	content.cursor.list += steps.length
	return {
		type: 'process',
		seconds: 0,
		headline: processTitle(content.copy),
		steps: steps.map((item) => ({ title: item.title, detail: item.detail, icon: item.icon })),
	}
}

const resolveTime: BeatResolver = (content, ordinal) => {
	// A real chronology in the brief earns the classic timeline; an invented one
	// does not, so a brief with no dates gets a motion piece instead of a rail
	// of made-up eras.
	if (content.years.length < 2 || prefersMotion(content, 'time', ordinal, 48)) {
		const scene = motionScene(content, 'time', ordinal)
		if (scene) return scene
	}
	const events: TimelineEvent[] =
		content.years.length >= 2
			? content.years
			: STRUCTURAL_ERAS.map((era, index) => ({
					marker: String(index + 1).padStart(2, '0'),
					title: era,
					detail: content.fragments[index] ? titleCase(content.fragments[index]) : '',
				}))
	return { type: 'timeline', seconds: 0, headline: timelineTitle(content.copy), events }
}

/**
 * The hero beat.
 *
 * The landscape card used to be the default here, which is exactly why a film
 * about solar panels and a film about street food both came back as the same
 * ridge under the same sun. Scenery and architecture are now *only* drawn when
 * the brief actually named them; every other brief gets a piece from the motion
 * library, so the hero shot belongs to the subject instead of to a stock
 * illustration nobody asked for.
 */
const resolveShowcase: BeatResolver = (content, ordinal) => {
	type Kind = 'landscape' | 'monument' | 'object' | 'terrain'
	const wantsScenery = has(content.prompt, [
		'landscape', 'scenery', 'mountain', 'desert', 'ocean', 'forest', 'city', 'valley', 'nature', 'outdoors',
		'skyline', 'coast', 'horizon', 'countryside', 'island', 'sunset', 'sunrise',
	])
	const wantsMonument = has(content.prompt, [
		'monument', 'temple', 'stupa', 'tower', 'palace', 'architecture', 'landmark', 'heritage', 'building',
		'cathedral', 'castle', 'bridge', 'ruins', 'shrine',
	])

	const candidates: Kind[] = []
	if (wantsScenery) candidates.push(content.solid ? 'terrain' : 'landscape')
	if (wantsMonument) candidates.push('monument')
	if (content.solid) candidates.push('object')

	// Nothing in the brief names a thing to build. Drawing a mountain here would
	// be the studio inventing a subject, so the motion library answers instead.
	if (candidates.length === 0) {
		const scene = motionScene(content, 'showcase', ordinal, true)
		if (scene) return scene
		return resolveList(content, ordinal) ?? resolveThesis(content, ordinal)
	}

	// Even when the brief did name scenery, the motion library still gets a turn
	// so a five-scene travel film is not five illustrations in a row.
	if (prefersMotion(content, 'showcase', ordinal, 42)) {
		const scene = motionScene(content, 'showcase', ordinal, true)
		if (scene) return scene
	}

	content.cursor.showcase += 1
	const kind = seededChoice(content.seed, `showcase-${ordinal}-${content.cursor.showcase}`, candidates)
	const headline = showcaseTitle(content.copy, ordinal)
	const caption = nextFragment(content)
	const sceneSeed = `${content.seed}:showcase-${ordinal}`

	if (kind === 'monument') {
		return { type: 'monument', seconds: 0, structure: detectStructure(content.prompt, sceneSeed), headline, caption }
	}
	if (kind === 'object') {
		return {
			type: 'object3d',
			seconds: 0,
			solid: detectSolid(content.prompt, sceneSeed),
			headline,
			caption,
			wireframe: seededIndex(content.seed, `wireframe-${ordinal}`, 2) === 1,
		}
	}
	if (kind === 'terrain') {
		return { type: 'terrain3d', seconds: 0, terrain: detectTerrain(content.prompt, sceneSeed), headline, caption }
	}
	return {
		type: 'landscape',
		seconds: 0,
		terrain: detectTerrain(content.prompt, sceneSeed),
		timeOfDay: detectTimeOfDay(content.prompt, sceneSeed),
		headline,
		caption,
	}
}

const resolvePlace: BeatResolver = (content, ordinal) => {
	// A map with nothing real on it is a decoration, not a location, so a brief
	// with no place names is answered from the motion library instead.
	if (content.nouns.length === 0 || prefersMotion(content, 'place', ordinal, 44)) {
		const scene = motionScene(content, 'place', ordinal)
		if (scene) return scene
	}
	if (content.solid && content.nouns.length > 0) {
		return {
			type: 'globe3d',
			seconds: 0,
			headline: placeTitle(content.copy),
			caption: nextFragment(content),
			places: mapPlaces(content.nouns),
		}
	}
	if (content.nouns.length > 0) {
		return {
			type: 'map',
			seconds: 0,
			headline: placeTitle(content.copy),
			caption: nextFragment(content),
			places: mapPlaces(content.nouns),
			connect: seededIndex(content.seed, `map-connect-${ordinal}`, 3) > 0,
		}
	}
	return resolveShowcase(content, ordinal)
}

const resolveTurn: BeatResolver = (content, ordinal) => {
	if (prefersMotion(content, 'turn', ordinal, 78)) {
		const scene = motionScene(content, 'turn', ordinal, true)
		if (scene) return scene
	}
	const line = nextFragment(content)
	if (!line && content.stats.length >= 2) return resolveEvidence(content, ordinal)
	if (!line && content.quoted.length > 0) return resolveQuote(content, ordinal)
	return {
		type: 'statement',
		seconds: 0,
		text: line || statementFrame(content.copy, ordinal + 1),
		highlight: content.subject.split(' ').at(-1) ?? '',
		footnote: sectionLabel('turn', content.copy, ordinal),
	}
}

const CTA_ICONS = ['arrow', 'spark', 'check', 'star', 'rocket'] as const

const resolveClose: BeatResolver = (content, ordinal) => {
	if (prefersMotion(content, 'close', ordinal, 52)) {
		const scene = motionScene(content, 'close', ordinal, true)
		if (scene) return scene
	}
	return closingCard(content)
}

const closingCard = (content: BriefContent): Scene => ({
	type: 'cta',
	seconds: 0,
	headline: content.quoted.at(-1) ?? ctaLeadFor(content.copy),
	subline: content.fragments.at(-1) ? titleCase(content.fragments.at(-1) as string) : '',
	tagline: taglineFor(content.copy),
	icon: seededChoice(content.seed, 'cta-icon', CTA_ICONS),
})

const BEAT_RESOLVERS: Record<BeatRole, BeatResolver> = {
	open: resolveOpen,
	hook: resolveHook,
	thesis: resolveThesis,
	context: resolveContext,
	evidence: resolveEvidence,
	list: resolveList,
	steps: resolveSteps,
	time: resolveTime,
	place: resolvePlace,
	showcase: resolveShowcase,
	quote: resolveQuote,
	compare: resolveCompare,
	turn: resolveTurn,
	close: resolveClose,
}

/** Story shapes the brief itself demands, which outrank the house style's pool. */
function requestedArcs(prompt: string, topic: Topic): ArcId[] {
	const forced: ArcId[] = []
	if (has(prompt, ['timeline', 'chronology', 'history of', 'milestones', 'evolution', 'through the years'])) {
		forced.push('chronicle', 'archive-dig')
	}
	if (has(prompt, ['step', 'steps', 'how to', 'tutorial', 'workflow', 'process', 'guide', 'recipe'])) {
		forced.push('how-to', 'explainer')
	}
	if (has(prompt, ['vs', 'versus', 'compare', 'comparison', 'against', 'alternative'])) {
		forced.push('versus', 'before-after')
	}
	if (has(prompt, ['before and after', 'transformation', 'redesign', 'migration'])) forced.push('before-after')
	if (has(prompt, ['myth', 'misconception', 'truth about', 'debunk'])) forced.push('myth-bust')
	if (has(prompt, ['countdown', 'launch day', 'top 5', 'top 10', 'ranking', 'ranked'])) {
		forced.push('countdown', 'scoreboard')
	}
	if (has(prompt, ['route', 'itinerary', 'road trip', 'journey', 'expedition'])) forced.push('journey')
	if (has(prompt, ['report', 'quarterly', 'metrics', 'kpi', 'revenue', 'analytics'])) {
		forced.push('data-story', 'briefing')
	}
	if (has(prompt, ['pitch', 'investor', 'roadmap', 'launch plan'])) forced.push('roadmap', 'product-tour')
	if (forced.length > 0) return [...new Set(forced)]
	return arcsForTopic(topic)
}

/**
 * Beats the brief names outright.
 *
 * A brief that says "chart" gets a chart whichever arc is drawn; the arc only
 * decides where in the film it lands. Without this the story shape could
 * quietly drop something the user asked for by name.
 */
function demandedBeats(content: BriefContent): BeatRole[] {
	const demanded: BeatRole[] = []
	const prompt = content.prompt
	if (content.stats.length >= 2 && has(prompt, ['chart', 'graph', 'bar', 'compare', 'comparison', 'ranked'])) {
		demanded.push('compare')
	}
	if (content.stats.length >= 2 && has(prompt, ['stat', 'stats', 'kpi', 'metric', 'metrics', 'numbers', 'figures'])) {
		demanded.push('evidence')
	}
	if (has(prompt, ['timeline', 'chronology', 'milestones', 'eras', 'through the years'])) demanded.push('time')
	if (has(prompt, ['map', 'maps', 'route', 'region', 'locations', 'cities', 'globe', 'worldwide'])) demanded.push('place')
	if (has(prompt, ['step', 'steps', 'process', 'workflow', 'method', 'how to', 'tutorial'])) demanded.push('steps')
	if (has(prompt, ['monument', 'temple', 'landmark', 'architecture', 'landscape', 'scenery', 'turntable'])) {
		demanded.push('showcase')
	}
	if (content.quoted.length > 0) demanded.push('quote')
	return demanded
}

/** Beats the brief cannot support are removed before the film is sized. */
function buildScenes(arc: ArcId, content: BriefContent, seconds: number): Scene[] {
	const recipe = ARC_KIT[arc]
	const beats: BeatRole[] = [...recipe.beats]

	// Longer films earn their optional beats; a six-second reel never does.
	const budget = seconds >= 40 ? 2 : seconds >= 22 ? 1 : 0
	for (const extra of (recipe.extras ?? []).slice(0, budget)) {
		beats.splice(Math.max(1, beats.length - 1), 0, extra)
	}

	// Anything the brief named by name is inserted before the closing beat, in
	// the order the brief implied, and only if the arc did not already carry it.
	for (const demand of demandedBeats(content)) {
		if (beats.includes(demand)) continue
		if (beats.length >= MAX_SCENES) break
		beats.splice(Math.max(1, beats.length - 1), 0, demand)
	}

	const scenes: Scene[] = []
	const used = new Map<Scene['type'], number>()

	/** Appends one beat, refusing anything that would flatten the edit. */
	const admit = (role: BeatRole, ordinal: number): boolean => {
		if (scenes.length >= MAX_SCENES) return false
		const scene = BEAT_RESOLVERS[role](content, ordinal)
		if (!scene) return false
		// Two identical scene types back to back read as one long scene, which
		// is exactly the flatness this engine exists to remove.
		if (scenes.at(-1)?.type === scene.type) return false
		// And no treatment appears more than twice in one film, however long it
		// runs - three monuments is a brief being padded, not a film.
		if ((used.get(scene.type) ?? 0) >= 2) return false
		used.set(scene.type, (used.get(scene.type) ?? 0) + 1)
		scenes.push(scene)
		return true
	}

	// The closing beat is held back until the body is finished, so a top-up can
	// never land after the end card.
	const body = beats.filter((role) => role !== 'close')
	for (const [ordinal, role] of body.entries()) admit(role, ordinal)

	/**
	 * A long film needs more beats, not longer ones: three scenes stretched over
	 * 45 seconds is fifteen seconds a card, which reads as a stalled slideshow.
	 * The top-up is measured against *resolved* scenes rather than planned
	 * beats, because a beat the brief cannot support resolves to nothing.
	 */
	const target = Math.max(3, Math.min(MAX_SCENES, Math.round(seconds / 5.5) + 1))
	// The old top-up asked for 'showcase' three times out of eight, which is how
	// a long film ended up as a run of hero cards. The rotation is now wide and
	// seeded, so a padded film gains variety rather than repetition.
	const padding: BeatRole[] = seededShuffle(content.seed, 'padding-order', [
		'list',
		'context',
		'evidence',
		'steps',
		'showcase',
		'compare',
		'thesis',
		'turn',
		'quote',
		'time',
	])
	// One slot is reserved for the closing card the caller appends below.
	for (let index = 0; scenes.length < target - 1 && index < padding.length * 3; index += 1) {
		admit(padding[index % padding.length], body.length + index)
	}

	if (scenes.length === 0) {
		const open = resolveOpen(content, 0)
		if (open) scenes.unshift(open)
	}
	const close = resolveClose(content, scenes.length)
	if (close && scenes.at(-1)?.type !== close.type) scenes.push(close)
	// An arc that opens on its close (a one-beat brief) would otherwise end on
	// two cards doing the same job.
	while (scenes.length > 1 && scenes[scenes.length - 2].type === scenes[scenes.length - 1].type) {
		scenes.splice(scenes.length - 2, 1)
	}
	while (scenes.length < 3) {
		const filler = resolveThesis(content, scenes.length)
		if (!filler) break
		scenes.splice(Math.max(0, scenes.length - 1), 0, filler)
	}

	// A brief that explicitly asked for three-dimensional treatment must reach
	// WebGL whatever arc was drawn, so the promise the prompt made is kept even
	// when the story shape contains no natural hero beat.
	if (content.solid && !scenes.some((scene) => DIMENSIONAL_SCENE_TYPES.includes(scene.type))) {
		const hero = resolveShowcase(content, scenes.length)
		if (hero && DIMENSIONAL_SCENE_TYPES.includes(hero.type)) {
			scenes.splice(Math.min(1, Math.max(0, scenes.length - 1)), 0, hero)
		} else {
			scenes.splice(Math.min(1, Math.max(0, scenes.length - 1)), 0, {
				type: 'object3d',
				seconds: 0,
				solid: detectSolid(content.prompt, `${content.seed}:hero`),
				headline: content.subject,
				caption: nextFragment(content),
				wireframe: seededIndex(content.seed, 'hero-wireframe', 2) === 1,
			})
		}
	}

	return scenes.slice(0, MAX_SCENES)
}

/** Builds a complete, renderable storyboard from the raw chat prompt. */
export function planStoryboard(rawPrompt: string, options: StoryboardPlanOptions = {}): Storyboard {
	const raw = rawPrompt.replace(/\s+/g, ' ').trim()
	const prompt = raw.toLowerCase()
	const creativeSeed = normalizeCreativeSeed(options.creativeSeed, promptFallbackSeed(raw))
	const avoidDesignFingerprints = normalizeAvoidFingerprints(options.avoidDesignFingerprints)

	const topic = detectTopic(prompt)
	const aspect = parseAspect(prompt)
	const seconds = parseSeconds(prompt)
	const motion = detectMotion(prompt)
	const allowThreeDimensional = options.allowThreeDimensional ?? promptRequestsThreeDimensional(raw)
	const dimension = detectDimension(raw, prompt, allowThreeDimensional)
	const typeRequest = detectTypeRequest(raw, prompt)
	const subject = subjectOf(raw)
	const quoted = extractQuoted(raw)
	const fragments = briefFragments(raw).filter((fragment) => fragment.toLowerCase() !== subject.toLowerCase())
	const nouns = properNouns(raw)
	const stats = numbersWithLabels(raw)
	const years = yearEvents(raw)

	/**
	 * House style and story shape are settled first, because the arc decides
	 * which scenes exist and the scenes decide the shape of the profile's
	 * per-scene arrays. The attempt number is carried forward so the full
	 * resolution below lands on exactly the same template and arc.
	 */
	const requireArcs = requestedArcs(prompt, topic)
	const house = previewHouseStyle({
		seed: creativeSeed,
		avoidTemplates: options.avoidTemplates,
		avoidArcs: options.avoidArcs,
		requireArcs,
	})

	const content: BriefContent = {
		seed: creativeSeed,
		subject,
		topic,
		prompt,
		fragments,
		nouns,
		stats,
		years,
		quoted,
		solid: dimension === 'three',
		copy: { seed: creativeSeed, subject, topic, arc: house.arc },
		cursor: { fragment: 0, showcase: 0, list: 0, statement: 0 },
		usedMotion: new Set<MotionSceneType>(),
		usedFamilies: new Set<string>(),
		lastFamily: '',
	}

	const scenes = buildScenes(house.arc, content, seconds)

	// House style, palette and the type pairing are resolved together so the
	// three always belong to one another, and so a design identity the caller
	// has already seen is never handed back.
	const art = resolveArtDirection({
		seed: creativeSeed,
		sceneTypes: scenes.map((scene) => scene.type),
		motion,
		dimension,
		lockedPalette: lockedPalette(prompt),
		preferredPalettes: preferredPalettes(prompt, topic),
		displayCategories: typeRequest.displayCategories,
		bodyCategories: typeRequest.bodyCategories,
		requireDevanagari: typeRequest.requireDevanagari,
		avoidFingerprints: avoidDesignFingerprints,
		avoidTemplates: options.avoidTemplates,
		avoidArcs: options.avoidArcs,
		requireArcs,
		startAttempt: house.attempt,
	})

	return {
		title: subject,
		concept: raw.slice(0, 240),
		subject,
		aspect,
		fps: 30,
		seconds,
		palette: art.palette,
		displayFont: art.displayFont,
		textFont: art.textFont,
		music: TOPIC_MUSIC[topic],
		grain: detectGrain(prompt, art.palette),
		leak: detectLeak(prompt, art.palette),
		motion,
		dimension,
		scenes,
		creativeSeed,
		creativeProfile: art.profile,
		designFingerprint: art.fingerprint,
	}
}
