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

import type { GrainId, IconId, LeakId, MusicId, PaletteId } from './kit'
import {
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
	type StructureId,
	type TerrainId,
	type TimeOfDayId,
	type TimelineEvent,
	type Storyboard,
} from './storyboard'

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

const PALETTE_KEYWORDS: Array<[PaletteId, string[]]> = [
	['neon', ['neon', 'cyberpunk', 'gaming', 'nightlife', 'rave', 'arcade', 'synthwave']],
	['heritage', ['history', 'historical', 'heritage', 'ancient', 'archive', 'museum', 'dynasty', 'empire', 'temple', 'monument', 'documentary']],
	['ember', ['desert', 'sunset', 'warm', 'fire', 'sahara', 'dune', 'autumn', 'golden hour', 'volcano']],
	['forest', ['forest', 'nature', 'green', 'sustainab', 'eco', 'jungle', 'organic', 'wildlife', 'garden']],
	['royal', ['luxury', 'premium', 'elegant', 'royal', 'gold', 'boutique', 'couture', 'exclusive']],
	['paper', ['paper', 'editorial', 'print', 'craft', 'newspaper', 'magazine', 'letterpress', 'archive paper']],
	['azure', ['corporate', 'business', 'finance', 'bank', 'insurance', 'enterprise', 'b2b', 'consulting']],
	['slate', ['developer', 'engineering', 'technical', 'code', 'terminal', 'devops', 'infrastructure', 'dark technical']],
	['sunrise', ['friendly', 'playful', 'kids', 'bright', 'cheerful', 'lifestyle', 'community', 'pastel']],
	['arctic', ['clean', 'minimal light', 'medical', 'clinic', 'white', 'ice', 'winter', 'snow']],
	['mono', ['monochrome', 'black and white', 'bold minimal', 'brutalist', 'fashion', 'high contrast']],
	['midnight', ['cinematic', 'space', 'ai', 'futuristic', 'dark', 'night', 'tech']],
]

const TOPIC_PALETTE: Record<Topic, PaletteId> = {
	history: 'heritage',
	travel: 'ember',
	product: 'midnight',
	tech: 'slate',
	data: 'azure',
	education: 'sunrise',
	food: 'ember',
	fitness: 'forest',
	event: 'royal',
	brand: 'midnight',
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

function detectPalette(prompt: string, topic: Topic): PaletteId {
	for (const [palette, keywords] of PALETTE_KEYWORDS) {
		if (has(prompt, keywords)) return palette
	}
	return TOPIC_PALETTE[topic]
}

function detectTerrain(prompt: string): TerrainId {
	if (has(prompt, ['mountain', 'himalaya', 'everest', 'peak', 'alps', 'summit', 'ridge', 'trek'])) return 'mountain'
	if (has(prompt, ['desert', 'dune', 'sahara', 'canyon', 'arid'])) return 'desert'
	if (has(prompt, ['city', 'urban', 'skyline', 'downtown', 'metropolis', 'street'])) return 'city'
	if (has(prompt, ['forest', 'jungle', 'woods', 'tree', 'rainforest'])) return 'forest'
	if (has(prompt, ['ocean', 'sea', 'coast', 'beach', 'island', 'wave', 'harbour', 'harbor'])) return 'ocean'
	if (has(prompt, ['valley', 'plain', 'field', 'meadow', 'countryside'])) return 'valley'
	return 'mountain'
}

function detectStructure(prompt: string): StructureId {
	if (has(prompt, ['stupa', 'monastery', 'shrine', 'buddhis'])) return 'stupa'
	if (has(prompt, ['temple', 'pagoda', 'durbar', 'hindu'])) return 'temple'
	if (has(prompt, ['tower', 'skyscraper', 'lighthouse', 'minaret'])) return 'tower'
	if (has(prompt, ['arch', 'gate', 'gateway', 'portal'])) return 'arch'
	if (has(prompt, ['dome', 'mosque', 'palace', 'basilica', 'capitol'])) return 'dome'
	if (has(prompt, ['bridge', 'viaduct', 'aqueduct'])) return 'bridge'
	if (has(prompt, ['stone', 'pillar', 'obelisk', 'monolith', 'megalith'])) return 'monolith'
	return 'temple'
}

function detectTimeOfDay(prompt: string): TimeOfDayId {
	if (has(prompt, ['night', 'midnight', 'stars', 'moonlit', 'nocturnal'])) return 'night'
	if (has(prompt, ['sunset', 'dusk', 'golden hour', 'evening', 'twilight'])) return 'dusk'
	if (has(prompt, ['noon', 'daylight', 'bright day', 'midday'])) return 'day'
	return 'dawn'
}

/**
 * Real WebGL is worth its cost when the brief asks for an object, a planet or a
 * landscape you can move a camera through. Everything else still gets the
 * cheaper CSS-3D staging rather than a flat layout.
 */
function detectDimension(prompt: string): DimensionId {
	if (has(prompt, ['flat design', '2d', 'two dimensional', 'text only', 'typographic only', 'no 3d'])) {
		return 'flat'
	}
	if (
		has(prompt, [
			'3d', 'three dimensional', 'cgi', 'render', 'rendered', 'octane', 'blender', 'ray trace',
			'raytrace', 'glass', 'metallic', 'chrome', 'crystal', 'globe', 'planet', 'earth', 'orbit',
			'terrain', 'topograph', 'wireframe', 'hologram', 'holographic', 'isometric', 'volumetric',
			'product shot', 'turntable', 'mesh', 'geometry', 'sculpt',
		])
	) {
		return 'three'
	}
	return 'depth'
}

function detectSolid(prompt: string): SolidId {
	if (has(prompt, ['sphere', 'ball', 'orb', 'planet', 'bubble'])) return 'sphere'
	if (has(prompt, ['torus', 'knot', 'loop', 'infinite', 'flow'])) return 'torus'
	if (has(prompt, ['cube', 'box', 'block', 'package', 'container'])) return 'cube'
	if (has(prompt, ['prism', 'hexagon', 'column', 'pillar'])) return 'prism'
	if (has(prompt, ['capsule', 'pill', 'battery', 'cylinder'])) return 'capsule'
	if (has(prompt, ['ring', 'halo', 'circle', 'portal', 'cycle'])) return 'ring'
	return 'crystal'
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

function detectFonts(prompt: string, topic: Topic): { displayFont: Storyboard['displayFont']; textFont: Storyboard['textFont'] } {
	if (has(prompt, ['serif', 'elegant', 'editorial', 'luxury', 'heritage', 'history', 'fashion', 'wedding'])) {
		return { displayFont: 'playfairDisplay', textFont: 'inter' }
	}
	if (has(prompt, ['technical', 'code', 'developer', 'terminal', 'engineering', 'data', 'api'])) {
		return { displayFont: 'spaceGrotesk', textFont: 'jetBrainsMono' }
	}
	if (has(prompt, ['news', 'sport', 'documentary', 'report'])) {
		return { displayFont: 'oswald', textFont: 'inter' }
	}
	if (has(prompt, ['friendly', 'kids', 'education', 'health', 'community'])) {
		return { displayFont: 'nunito', textFont: 'inter' }
	}
	if (has(prompt, ['devanagari', 'nepali', 'hindi', 'nepal', 'kathmandu'])) {
		return { displayFont: 'anekDevanagari', textFont: 'notoSansDevanagari' }
	}
	if (topic === 'history') return { displayFont: 'playfairDisplay', textFont: 'inter' }
	if (topic === 'tech' || topic === 'data') return { displayFont: 'spaceGrotesk', textFont: 'inter' }
	if (topic === 'product') return { displayFont: 'anton', textFont: 'inter' }
	return { displayFont: 'bebasNeue', textFont: 'inter' }
}

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

/** Comma / "and" separated fragments of the brief, minus the production directives. */
function briefFragments(raw: string): string[] {
	return raw
		.replace(/[“”"']/g, ' ')
		.split(/[,;.\n]|\band\b|\bwith\b|\bplus\b/i)
		.map((part) => part.replace(/\s+/g, ' ').trim())
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
		if (index === 0 && clean.toLowerCase() !== clean) {
			// A leading capitalised verb like "Create" is not a subject.
			if (STOP_WORDS.has(clean.toLowerCase())) continue
		}
		if (STOP_WORDS.has(clean.toLowerCase()) || STYLE_WORDS.has(clean.toLowerCase())) continue
		if (!found.includes(clean)) found.push(clean)
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
	const nouns = properNouns(raw).map((noun) => noun.toLowerCase())
	const words = firstClause
		.replace(/[^A-Za-z0-9\s-]/g, ' ')
		.split(/\s+/)
		.filter(Boolean)
		.filter((word) => !/\d/.test(word))
		.filter((word) => !STOP_WORDS.has(word.toLowerCase()))
		.filter((word) => !STYLE_WORDS.has(word.toLowerCase()))

	const ordered = [
		...words.filter((word) => nouns.includes(word.toLowerCase())),
		...words.filter((word) => !nouns.includes(word.toLowerCase())),
	]

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
	return fragments.slice(0, 4).map((fragment, index) => ({
		title: titleCase(fragment.split(' ').slice(0, 4).join(' ')),
		detail: fragment.split(' ').length > 4 ? fragment : '',
		icon: palette[index % palette.length],
	}))
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

/** Builds a complete, renderable storyboard from the raw chat prompt. */
export function planStoryboard(rawPrompt: string): Storyboard {
	const raw = rawPrompt.replace(/\s+/g, ' ').trim()
	const prompt = raw.toLowerCase()

	const topic = detectTopic(prompt)
	const palette = detectPalette(prompt, topic)
	const aspect = parseAspect(prompt)
	const seconds = parseSeconds(prompt)
	const motion = detectMotion(prompt)
	const dimension = detectDimension(prompt)
	const { displayFont, textFont } = detectFonts(prompt, topic)
	const subject = subjectOf(raw)
	const quoted = extractQuoted(raw)
	const fragments = briefFragments(raw).filter((fragment) => fragment.toLowerCase() !== subject.toLowerCase())
	const nouns = properNouns(raw)
	const stats = numbersWithLabels(raw)
	const years = yearEvents(raw)

	const wantsTimeline =
		topic === 'history' || has(prompt, ['timeline', 'chronology', 'history', 'roadmap', 'milestones', 'evolution'])
	const wantsMap = has(prompt, ['map', 'maps', 'region', 'country', 'world', 'geography', 'route', 'locations', 'cities'])
	const wantsScenery =
		topic === 'travel' ||
		topic === 'history' ||
		has(prompt, ['landscape', 'scenery', 'mountain', 'desert', 'ocean', 'forest', 'city', 'valley', 'nature'])
	const wantsMonument = has(prompt, ['monument', 'temple', 'stupa', 'tower', 'palace', 'architecture', 'landmark', 'heritage', 'monuments'])
	const wantsProcess = has(prompt, ['how', 'steps', 'process', 'workflow', 'explainer', 'tutorial', 'works', 'guide'])
	const wantsChart = stats.length >= 2 && has(prompt, ['chart', 'graph', 'growth', 'compare', 'comparison', 'data', 'metrics'])
	const solid = dimension === 'three'
	const wantsGlobe = solid && (wantsMap || has(prompt, ['globe', 'world', 'planet', 'earth', 'global', 'international']))

	const scenes: Scene[] = []

	scenes.push({
		type: 'title',
		seconds: 0,
		kicker: titleCase(topic === 'brand' ? 'feature' : topic),
		headline: subject,
		subline: fragments[0] ? titleCase(fragments[0]) : '',
		icon: TOPIC_ICON[topic],
	})

	// In WebGL mode the hero object replaces the flat statement card, and a
	// displaced terrain mesh replaces the layered SVG landscape.
	if (solid && !wantsScenery && !wantsGlobe) {
		scenes.push({
			type: 'object3d',
			seconds: 0,
			solid: detectSolid(prompt),
			headline: subject,
			caption: fragments[0] ? titleCase(fragments[0]) : '',
			wireframe: true,
		})
	}

	if (wantsGlobe) {
		scenes.push({
			type: 'globe3d',
			seconds: 0,
			headline: `${subject} worldwide`,
			caption: fragments[1] ?? '',
			places: mapPlaces(nouns),
		})
	}

	if (wantsScenery) {
		scenes.push(
			solid
				? {
						type: 'terrain3d',
						seconds: 0,
						terrain: detectTerrain(prompt),
						headline: subject,
						caption: fragments[1] ?? '',
					}
				: {
						type: 'landscape',
						seconds: 0,
						terrain: detectTerrain(prompt),
						timeOfDay: detectTimeOfDay(prompt),
						headline: subject,
						caption: fragments[1] ?? '',
					},
		)
	}

	if (wantsTimeline) {
		const events: TimelineEvent[] =
			years.length >= 2
				? years
				: STRUCTURAL_ERAS.map((era, index) => ({
						marker: String(index + 1).padStart(2, '0'),
						title: era,
						detail: fragments[index] ? titleCase(fragments[index]) : '',
					}))
		scenes.push({ type: 'timeline', seconds: 0, headline: `${subject} timeline`, events })
	}

	if (wantsMap && !wantsGlobe && nouns.length > 0) {
		scenes.push({
			type: 'map',
			seconds: 0,
			headline: `Where ${subject} happens`,
			caption: fragments[2] ?? '',
			places: mapPlaces(nouns),
			connect: true,
		})
	}

	if (wantsMonument) {
		scenes.push({
			type: 'monument',
			seconds: 0,
			structure: detectStructure(prompt),
			headline: subject,
			caption: fragments[3] ?? '',
		})
	}

	if (wantsProcess && fragments.length >= 2) {
		scenes.push({
			type: 'process',
			seconds: 0,
			headline: `How ${subject} works`,
			steps: galleryFrom(fragments, topic)
				.slice(0, 4)
				.map((item) => ({ title: item.title, detail: item.detail, icon: item.icon })),
		})
	}

	if (stats.length >= 2) {
		scenes.push({ type: 'stats', seconds: 0, headline: subject, stats })
	}

	if (wantsChart) {
		scenes.push({ type: 'chart', seconds: 0, headline: subject, unit: stats[0]?.suffix ?? '', bars: chartBars(stats) })
	}

	const galleryItems = galleryFrom(fragments.slice(wantsProcess ? 4 : 0), topic)
	if (galleryItems.length >= 2 && scenes.length < 6) {
		scenes.push(
			dimension !== 'flat' && galleryItems.length >= 3
				? { type: 'carousel3d', seconds: 0, headline: subject, items: galleryItems }
				: { type: 'gallery', seconds: 0, headline: subject, items: galleryItems },
		)
	}

	if (quoted.length > 0 && scenes.length < 7) {
		scenes.push({ type: 'quote', seconds: 0, quote: quoted[0], attribution: '' })
	}

	if (scenes.length < 3) {
		scenes.push({
			type: 'statement',
			seconds: 0,
			text: fragments[0] ? titleCase(fragments[0]) : subject,
			highlight: subject.split(' ')[0] ?? '',
			footnote: '',
		})
	}

	scenes.push({
		type: 'cta',
		seconds: 0,
		headline: quoted.at(-1) ?? subject,
		subline: fragments.at(-1) ?? '',
		tagline: titleCase(topic === 'brand' ? 'made with remotion' : `${topic} film`),
		icon: 'arrow',
	})

	return {
		title: subject,
		concept: raw.slice(0, 240),
		subject,
		aspect,
		fps: 30,
		seconds,
		palette,
		displayFont,
		textFont,
		music: TOPIC_MUSIC[topic],
		grain: detectGrain(prompt, palette),
		leak: detectLeak(prompt, palette),
		motion,
		dimension,
		scenes,
	}
}
