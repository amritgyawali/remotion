/**
 * What each scene template is *about*.
 *
 * Roles say which narrative beat a piece can carry; they say nothing about
 * subject. That is why a brief about a life from birth to death and a brief
 * about a quarterly revenue miss used to draw from exactly the same pool for
 * their opening beat - both want an `open`, and every anchor piece can carry
 * one.
 *
 * This table closes that gap. Each template lists the ideas it speaks to, and
 * the planner biases its draw towards the pieces whose ideas the brief actually
 * mentions. A film about ageing gets the hourglass of settling sand, the pages
 * turning and the stairs climbing; a film about a product launch gets the
 * flare, the stamp and the shatter. Neither is forced - the seed still decides
 * between everything that scores, so two runs of the same brief still cut
 * differently - but neither is left to chance either.
 *
 * Terms are matched loosely (see `promptSignals`), so 'grow' catches growing,
 * growth and grew. Keep them lowercase, singular, and about the *subject* the
 * piece suits rather than about what it draws: 'death' belongs on the scene
 * that suits an ending, not only on one that literally draws a grave.
 */

import type { SceneType } from './storyboard'

/**
 * Words that carry no subject.
 *
 * A brief nearly always says "video", "animation" or "create", and matching on
 * those would score every template equally and undo the whole exercise.
 */
const STOP_WORDS = new Set([
	'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'can', 'create', 'do', 'for', 'from', 'get',
	'give', 'has', 'have', 'how', 'i', 'in', 'is', 'it', 'its', 'make', 'me', 'my', 'need', 'of', 'on',
	'or', 'our', 'out', 'please', 'that', 'the', 'their', 'them', 'then', 'there', 'this', 'to', 'up',
	'us', 'use', 'video', 'videos', 'want', 'was', 'we', 'were', 'what', 'when', 'which', 'who', 'why',
	'will', 'with', 'you', 'your', 'animation', 'animated', 'clip', 'film', 'movie', 'reel', 'short',
	'about', 'into', 'over', 'under', 'show', 'showing', 'explain', 'explainer', 'story',
])

/**
 * The brief reduced to the words that could name a subject.
 *
 * Punctuation goes, stop words go, and anything under three letters goes -
 * two-letter tokens match far too much to be worth scoring.
 */
export function promptSignals(prompt: string): Set<string> {
	const words = prompt
		.toLowerCase()
		.replace(/[^a-z0-9\s-]/g, ' ')
		.split(/[\s-]+/)
		.filter((word) => word.length >= 3 && !STOP_WORDS.has(word))
	return new Set(words)
}

/**
 * Whether one affinity term is present in the brief.
 *
 * A term hits on an exact word, on a word that extends it ('grow' from
 * 'growth'), or on a word it extends ('ageing' from 'age') - which covers
 * English inflection well enough without dragging in a stemmer.
 */
function termHits(term: string, signals: Set<string>): boolean {
	if (signals.has(term)) return true
	for (const word of signals) {
		if (word.length >= 4 && term.length >= 4 && (word.startsWith(term) || term.startsWith(word))) return true
	}
	return false
}

/**
 * How strongly a template suits this brief.
 *
 * Returns the count of its ideas the brief mentions, so a piece that matches on
 * two words outranks one that matches on one, and a piece that matches on none
 * scores zero and is left entirely to the seed.
 */
export function affinityScore(type: SceneType, signals: Set<string>): number {
	const terms = SCENE_AFFINITY[type]
	if (!terms) return 0
	let score = 0
	for (const term of terms) if (termHits(term, signals)) score += 1
	return score
}

/**
 * The subjects each template speaks to.
 *
 * Every scene type in the kit has an entry - the `satisfies` clause below is
 * what keeps a new template from being added without one, which would quietly
 * make it unreachable by subject and reachable only by luck.
 */
export const SCENE_AFFINITY = {
	/* -- Classic ----------------------------------------------------------- */
	title: ['launch', 'introduce', 'brand', 'name', 'welcome', 'announce'],
	statement: ['belief', 'claim', 'manifesto', 'truth', 'principle', 'opinion', 'argue'],
	timeline: ['history', 'year', 'era', 'chronology', 'evolution', 'century', 'decade', 'past', 'birth', 'death', 'life'],
	map: ['country', 'city', 'region', 'route', 'travel', 'geography', 'location', 'world', 'border'],
	landscape: ['nature', 'mountain', 'desert', 'forest', 'ocean', 'valley', 'climate', 'weather', 'earth', 'wild'],
	monument: ['building', 'architecture', 'landmark', 'temple', 'monument', 'heritage', 'ancient', 'ruin'],
	gallery: ['feature', 'collection', 'portfolio', 'catalogue', 'range', 'lineup', 'variety'],
	stats: ['number', 'figure', 'statistic', 'metric', 'percent', 'measure', 'data', 'result'],
	chart: ['chart', 'graph', 'revenue', 'sales', 'trend', 'compare', 'quarter', 'growth', 'decline'],
	process: ['step', 'process', 'method', 'recipe', 'workflow', 'procedure', 'how', 'guide', 'tutorial'],
	quote: ['quote', 'said', 'wisdom', 'proverb', 'testimonial', 'voice', 'poem', 'saying'],
	cta: ['signup', 'subscribe', 'download', 'join', 'buy', 'offer', 'contact', 'today'],
	object3d: ['product', 'object', 'crystal', 'shape', 'material', 'design', 'render', 'prototype'],
	globe3d: ['global', 'planet', 'world', 'earth', 'international', 'network', 'orbit', 'space'],
	terrain3d: ['terrain', 'landscape', 'elevation', 'mountain', 'survey', 'topography', 'expedition'],
	carousel3d: ['showcase', 'range', 'gallery', 'rotate', 'display', 'lineup', 'collection'],

	/* -- Typographic ------------------------------------------------------- */
	'kinetic-type': ['energy', 'youth', 'music', 'speech', 'rhythm', 'shout', 'lyric', 'hype'],
	'word-swap': ['choice', 'option', 'alternative', 'many', 'label', 'identity', 'role', 'name'],
	'type-ladder': ['rank', 'order', 'priority', 'list', 'hierarchy', 'level', 'tier'],
	'mask-wipe': ['reveal', 'secret', 'hidden', 'unveil', 'discover', 'behind', 'expose'],
	'glitch-title': ['error', 'bug', 'crash', 'hack', 'cyber', 'broken', 'failure', 'security', 'digital'],
	'neon-sign': ['night', 'city', 'bar', 'club', 'retro', 'street', 'nightlife', 'diner', 'vice'],
	'stamp-impact': ['approve', 'verdict', 'decision', 'official', 'certify', 'reject', 'final', 'seal'],
	'marquee-bands': ['festival', 'lineup', 'poster', 'protest', 'slogan', 'chant', 'campaign'],
	'ticker-strip': ['news', 'market', 'stock', 'headline', 'breaking', 'finance', 'trading', 'update'],
	'letter-grid': ['language', 'alphabet', 'code', 'puzzle', 'word', 'writing', 'letter', 'crossword'],

	/* -- Structural -------------------------------------------------------- */
	'split-reveal': ['contrast', 'before', 'after', 'divide', 'split', 'either', 'versus'],
	'grid-mosaic': ['community', 'crowd', 'portfolio', 'tile', 'many', 'population', 'diversity'],
	'card-stack': ['deck', 'pitch', 'card', 'hand', 'option', 'shuffle', 'draw'],
	'iso-layers': ['stack', 'layer', 'architecture', 'platform', 'infrastructure', 'foundation', 'system'],
	'path-draw': ['route', 'journey', 'connect', 'link', 'path', 'trace', 'line', 'flow'],
	'particle-assemble': ['form', 'emerge', 'assemble', 'atom', 'cell', 'origin', 'creation', 'birth', 'build'],
	'orbit-nodes': ['ecosystem', 'satellite', 'partner', 'centre', 'gravity', 'planet', 'network'],
	'network-graph': ['network', 'graph', 'relation', 'social', 'cluster', 'connection', 'web', 'node'],
	'wave-form': ['sound', 'audio', 'music', 'podcast', 'voice', 'signal', 'frequency', 'song'],
	'liquid-blob': ['organic', 'fluid', 'soft', 'change', 'morph', 'flexible', 'adapt', 'shift'],

	/* -- Framed ------------------------------------------------------------ */
	'spotlight-reveal': ['focus', 'attention', 'star', 'highlight', 'stage', 'spotlight', 'feature'],
	'film-strip': ['cinema', 'movie', 'frame', 'archive', 'memory', 'documentary', 'footage', 'reel'],
	'chapter-slate': ['chapter', 'part', 'section', 'act', 'episode', 'series', 'book'],
	'terminal-type': ['code', 'developer', 'command', 'software', 'terminal', 'script', 'engineer', 'linux'],
	'browser-window': ['website', 'browser', 'online', 'internet', 'landing', 'page', 'saas', 'web'],
	'phone-scroll': ['mobile', 'app', 'phone', 'social', 'feed', 'chat', 'scroll', 'notification'],
	'device-grid': ['device', 'responsive', 'platform', 'screen', 'hardware', 'multi', 'gadget'],
	'matrix-rain': ['data', 'cyber', 'hacker', 'stream', 'digital', 'code', 'machine', 'algorithm'],
	'poster-collage': ['art', 'culture', 'exhibition', 'collage', 'zine', 'gallery', 'punk', 'graphic'],
	'parallax-strata': ['depth', 'geology', 'strata', 'layer', 'history', 'sediment', 'core', 'excavate'],

	/* -- Data -------------------------------------------------------------- */
	'bar-race': ['rank', 'league', 'compete', 'leader', 'growth', 'race', 'top', 'market'],
	'donut-breakdown': ['share', 'portion', 'breakdown', 'percent', 'split', 'budget', 'allocation'],
	'progress-rings': ['goal', 'target', 'progress', 'fitness', 'completion', 'score', 'health'],
	speedometer: ['speed', 'performance', 'fast', 'engine', 'car', 'limit', 'rate', 'velocity'],
	'funnel-steps': ['funnel', 'conversion', 'sales', 'pipeline', 'customer', 'lead', 'drop'],
	'pyramid-tiers': ['pyramid', 'hierarchy', 'need', 'tier', 'foundation', 'class', 'structure'],
	'venn-overlap': ['overlap', 'common', 'intersection', 'shared', 'both', 'combine', 'union'],
	'heat-grid': ['heat', 'density', 'pattern', 'calendar', 'activity', 'frequency', 'usage', 'grid'],
	'sankey-flow': ['flow', 'energy', 'budget', 'migration', 'traffic', 'distribution', 'supply', 'chain'],
	'counter-burst': ['milestone', 'record', 'total', 'count', 'reach', 'achievement', 'million'],

	/* -- Story ------------------------------------------------------------- */
	'versus-clash': ['versus', 'rival', 'fight', 'competitor', 'battle', 'debate', 'conflict', 'war'],
	'comparison-slider': ['before', 'after', 'restore', 'renovate', 'improve', 'transform', 'compare'],
	'checklist-tick': ['checklist', 'requirement', 'todo', 'complete', 'audit', 'criteria', 'ready'],
	'qa-bubbles': ['question', 'answer', 'interview', 'faq', 'conversation', 'dialogue', 'chat', 'ask'],
	'price-tiers': ['price', 'plan', 'subscription', 'cost', 'package', 'tier', 'billing'],
	'logo-wall': ['client', 'partner', 'brand', 'trust', 'customer', 'logo', 'sponsor'],
	'countdown-clock': ['countdown', 'deadline', 'launch', 'timer', 'urgent', 'remaining', 'event'],
	'calendar-flip': ['date', 'schedule', 'calendar', 'day', 'month', 'year', 'anniversary', 'time'],
	'ribbon-banner': ['award', 'celebrate', 'winner', 'honour', 'announce', 'prize', 'proud'],
	'zoom-punch': ['impact', 'shock', 'sudden', 'punch', 'bold', 'urgent', 'wake'],

	/* -- Optical ----------------------------------------------------------- */
	'lens-flare-title': ['light', 'sun', 'hope', 'dawn', 'premiere', 'glamour', 'cinematic', 'shine'],
	'chromatic-split': ['split', 'identity', 'tension', 'divide', 'psychology', 'mind', 'fracture'],
	'moire-field': ['pattern', 'interference', 'illusion', 'perception', 'optical', 'texture', 'physics'],
	'caustic-pool': ['water', 'ocean', 'swim', 'calm', 'reflection', 'liquid', 'summer', 'pool'],
	'prism-refract': ['spectrum', 'colour', 'diversity', 'physics', 'light', 'science', 'rainbow', 'split'],
	'bokeh-drift': ['dream', 'memory', 'romance', 'soft', 'night', 'blur', 'nostalgia', 'wedding'],
	'scanline-crt': ['retro', 'vintage', 'archive', 'analogue', 'eighties', 'broadcast', 'television'],
	'halftone-bloom': ['print', 'comic', 'pop', 'newspaper', 'ink', 'graphic', 'poster'],
	'light-leak-wipe': ['transition', 'change', 'shift', 'moment', 'film', 'analogue', 'turn'],
	'vignette-pulse': ['intimate', 'quiet', 'reflection', 'meditation', 'breath', 'calm', 'focus', 'death'],

	/* -- Physical ---------------------------------------------------------- */
	'gravity-drop': ['fall', 'drop', 'gravity', 'weight', 'crash', 'impact', 'collapse', 'physics'],
	'pendulum-swing': ['balance', 'swing', 'rhythm', 'time', 'hang', 'oscillate', 'tension', 'clock'],
	'domino-fall': ['chain', 'consequence', 'cascade', 'trigger', 'domino', 'collapse', 'effect', 'ripple'],
	'elastic-rope': ['tension', 'pull', 'connect', 'stress', 'stretch', 'deal', 'bond', 'strain'],
	'sand-settle': ['time', 'age', 'erosion', 'patience', 'accumulate', 'memory', 'death', 'slow', 'desert'],
	'magnet-snap': ['order', 'organise', 'chaos', 'attract', 'align', 'clean', 'sort', 'magnet'],
	'spring-board': ['launch', 'boost', 'accelerate', 'startup', 'jump', 'energy', 'momentum'],
	'liquid-fill': ['fill', 'capacity', 'water', 'volume', 'reservoir', 'level', 'tank', 'hydration'],
	'smoke-reveal': ['mystery', 'fog', 'unclear', 'clarity', 'emerge', 'smoke', 'fire', 'reveal'],
	'shatter-glass': ['break', 'shatter', 'barrier', 'record', 'destroy', 'glass', 'ceiling', 'disrupt'],

	/* -- Editorial --------------------------------------------------------- */
	'magazine-spread': ['magazine', 'editorial', 'feature', 'journalism', 'essay', 'fashion', 'interview'],
	'newspaper-fold': ['news', 'press', 'headline', 'report', 'journalism', 'scandal', 'front', 'paper'],
	'index-card': ['research', 'note', 'study', 'index', 'archive', 'library', 'catalogue', 'reference'],
	'footnote-margin': ['academic', 'analysis', 'annotate', 'detail', 'thesis', 'scholar', 'critique'],
	'contact-sheet': ['photography', 'select', 'shoot', 'frame', 'choose', 'edit', 'darkroom', 'camera'],
	'book-page-turn': ['book', 'read', 'chapter', 'literature', 'novel', 'story', 'life', 'biography'],
	'stamp-postcard': ['travel', 'letter', 'postcard', 'holiday', 'abroad', 'mail', 'greeting', 'distance'],
	'receipt-roll': ['cost', 'expense', 'bill', 'shopping', 'total', 'budget', 'invoice', 'spend'],
	'blueprint-draft': ['engineering', 'design', 'plan', 'blueprint', 'construct', 'technical', 'architect'],
	'sticker-sheet': ['fun', 'playful', 'youth', 'sticker', 'casual', 'community', 'craft', 'kid'],

	/* -- Signal ------------------------------------------------------------ */
	'radar-sweep': ['detect', 'scan', 'radar', 'search', 'threat', 'monitor', 'discover', 'surveillance'],
	'waveform-scrub': ['audio', 'podcast', 'music', 'recording', 'interview', 'sound', 'playback', 'time'],
	'equalizer-bars': ['music', 'sound', 'mix', 'balance', 'frequency', 'energy', 'concert', 'audio'],
	'sonar-ping': ['deep', 'ocean', 'submarine', 'echo', 'search', 'silence', 'signal', 'distance'],
	'barcode-scan': ['retail', 'product', 'scan', 'inventory', 'supply', 'checkout', 'logistics', 'code'],
	'loading-bars': ['progress', 'status', 'load', 'deploy', 'build', 'task', 'parallel', 'complete'],
	'notification-stack': ['alert', 'notification', 'message', 'demand', 'inbox', 'attention', 'social'],
	'search-suggest': ['search', 'question', 'google', 'query', 'curiosity', 'find', 'ask', 'answer'],
	'dial-tuner': ['radio', 'tune', 'station', 'frequency', 'find', 'broadcast', 'channel', 'search'],
	'telemetry-hud': ['flight', 'mission', 'monitor', 'sensor', 'aviation', 'space', 'control', 'system'],

	/* -- Spatial ----------------------------------------------------------- */
	'corridor-fly': ['journey', 'travel', 'tour', 'passage', 'move', 'transit', 'explore', 'corridor'],
	'card-ring': ['showcase', 'rotate', 'range', 'carousel', 'display', 'collection', 'menu'],
	'elevator-floors': ['level', 'floor', 'building', 'rise', 'stage', 'tier', 'career', 'climb'],
	'tunnel-rings': ['depth', 'infinite', 'space', 'portal', 'travel', 'scale', 'universe', 'passage', 'death'],
	'cube-unfold': ['reveal', 'whole', 'facet', 'unfold', 'dimension', 'open', 'perspective'],
	'stairs-climb': ['progress', 'climb', 'career', 'growth', 'step', 'improve', 'ascend', 'life'],
	'window-grid': ['city', 'building', 'urban', 'neighbour', 'apartment', 'community', 'night', 'office'],
	'horizon-parallax': ['journey', 'distance', 'travel', 'horizon', 'road', 'landscape', 'future', 'ahead'],
	'orbit-slab': ['monument', 'weight', 'permanence', 'statement', 'sculpture', 'solid', 'brand'],
	'depth-push': ['argument', 'claim', 'point', 'insist', 'sequence', 'clarity', 'assert'],
} as const satisfies Record<SceneType, readonly string[]>
