/**
 * Narrative arcs.
 *
 * An arc is the *shape of the story*, independent of the art direction. It is
 * the axis that stops two generations from feeling like the same film: a brief
 * told as a `versus` runs cold-open, split comparison, verdict, close, while
 * the same brief told as a `chronicle` runs era card, timeline, artefact,
 * reflection, close.
 *
 * Beats are roles, not scene types. The planner resolves each role against the
 * content it actually extracted from the brief, so one arc still produces
 * different scene types for different briefs — and the resolution itself is
 * seeded, so the same arc and the same brief can resolve differently on a later
 * generation.
 */

/** What a beat is *for*. The planner maps these onto concrete scene types. */
export type BeatRole =
	/** The opening card that names the film. */
	| 'open'
	/** A short, loud line meant to stop the scroll. */
	| 'hook'
	/** The claim the film is making. */
	| 'thesis'
	/** Background the viewer needs before the payoff. */
	| 'context'
	/** Numbers, measurements, proof. */
	| 'evidence'
	/** A set of parallel items. */
	| 'list'
	/** An ordered procedure. */
	| 'steps'
	/** Something that happened over time. */
	| 'time'
	/** Somewhere on the map or on the ground. */
	| 'place'
	/** A hero object, structure or vista. */
	| 'showcase'
	/** Someone else's words. */
	| 'quote'
	/** Two things held against each other. */
	| 'compare'
	/** The turn — the surprise, the reveal, the correction. */
	| 'turn'
	/** The closing card. */
	| 'close'

export type ArcRecipe = {
	label: string
	/** What the film is doing, used in the plan summary. */
	intent: string
	beats: readonly BeatRole[]
	/** Optional beats appended, in order, when the film is long enough. */
	extras?: readonly BeatRole[]
	/** Topics this shape suits, used when a template pool needs widening. */
	topics: readonly string[]
}

export const ARC_KIT = {
	'three-act': {
		label: 'Three Act',
		intent: 'sets up a subject, complicates it, then resolves it',
		beats: ['open', 'context', 'turn', 'close'],
		extras: ['showcase', 'evidence'],
		topics: ['history', 'travel', 'brand', 'education'],
	},
	'thesis-proof': {
		label: 'Thesis and Proof',
		intent: 'states a claim then backs it with evidence',
		beats: ['open', 'thesis', 'evidence', 'close'],
		extras: ['list', 'compare'],
		topics: ['data', 'tech', 'product', 'brand'],
	},
	'feature-lede': {
		label: 'Feature Lede',
		intent: 'opens like a magazine feature and widens out',
		beats: ['open', 'hook', 'context', 'list', 'close'],
		extras: ['quote', 'showcase'],
		topics: ['history', 'brand', 'education', 'food'],
	},
	'long-read': {
		label: 'Long Read',
		intent: 'unhurried, paragraph by paragraph',
		beats: ['open', 'context', 'list', 'quote', 'close'],
		extras: ['showcase', 'time'],
		topics: ['history', 'education', 'brand'],
	},
	manifesto: {
		label: 'Manifesto',
		intent: 'hammers a position home in short declarative cards',
		beats: ['open', 'thesis', 'thesis', 'close'],
		extras: ['hook', 'quote'],
		topics: ['brand', 'product', 'tech'],
	},
	'hook-drop': {
		label: 'Hook Drop',
		intent: 'opens on the payoff and explains afterwards',
		beats: ['hook', 'open', 'list', 'close'],
		extras: ['evidence', 'showcase'],
		topics: ['product', 'brand', 'fitness', 'food'],
	},
	'cold-open': {
		label: 'Cold Open',
		intent: 'drops the viewer into a scene before naming the film',
		beats: ['showcase', 'open', 'context', 'close'],
		extras: ['quote', 'time'],
		topics: ['travel', 'history', 'event', 'brand'],
	},
	reveal: {
		label: 'Slow Reveal',
		intent: 'withholds the subject and unveils it late',
		beats: ['hook', 'context', 'showcase', 'close'],
		extras: ['evidence', 'quote'],
		topics: ['product', 'brand', 'event'],
	},
	'rapid-list': {
		label: 'Rapid List',
		intent: 'fires through parallel items at pace',
		beats: ['open', 'list', 'list', 'close'],
		extras: ['evidence', 'hook'],
		topics: ['product', 'food', 'fitness', 'education'],
	},
	'index-cards': {
		label: 'Index Cards',
		intent: 'one idea per card, evenly weighted',
		beats: ['open', 'list', 'compare', 'close'],
		extras: ['evidence', 'quote'],
		topics: ['education', 'data', 'brand'],
	},
	explainer: {
		label: 'Explainer',
		intent: 'answers a question step by step',
		beats: ['open', 'thesis', 'steps', 'close'],
		extras: ['evidence', 'list'],
		topics: ['education', 'tech', 'product', 'data'],
	},
	'how-to': {
		label: 'How To',
		intent: 'walks a procedure from first move to finished result',
		beats: ['open', 'steps', 'showcase', 'close'],
		extras: ['list', 'evidence'],
		topics: ['education', 'food', 'fitness', 'tech'],
	},
	'data-story': {
		label: 'Data Story',
		intent: 'lets the numbers carry the argument',
		beats: ['open', 'evidence', 'compare', 'close'],
		extras: ['thesis', 'list'],
		topics: ['data', 'tech', 'product'],
	},
	briefing: {
		label: 'Briefing',
		intent: 'delivers the situation, the detail and the ask',
		beats: ['open', 'context', 'evidence', 'list', 'close'],
		extras: ['compare', 'quote'],
		topics: ['data', 'brand', 'tech', 'event'],
	},
	newsroom: {
		label: 'Newsroom',
		intent: 'headline first, detail after, attribution last',
		beats: ['hook', 'context', 'evidence', 'quote', 'close'],
		extras: ['list', 'time'],
		topics: ['data', 'history', 'event'],
	},
	diagnostic: {
		label: 'Diagnostic',
		intent: 'symptom, cause, remedy',
		beats: ['open', 'hook', 'steps', 'evidence', 'close'],
		extras: ['compare', 'thesis'],
		topics: ['tech', 'data', 'fitness'],
	},
	roadmap: {
		label: 'Roadmap',
		intent: 'plots where things are going and in what order',
		beats: ['open', 'time', 'steps', 'close'],
		extras: ['evidence', 'list'],
		topics: ['product', 'tech', 'brand', 'data'],
	},
	chronicle: {
		label: 'Chronicle',
		intent: 'follows a subject across eras',
		beats: ['open', 'time', 'showcase', 'close'],
		extras: ['quote', 'place'],
		topics: ['history', 'travel', 'education'],
	},
	'archive-dig': {
		label: 'Archive Dig',
		intent: 'pulls artefacts out of a record one at a time',
		beats: ['open', 'quote', 'time', 'list', 'close'],
		extras: ['showcase', 'context'],
		topics: ['history', 'education', 'brand'],
	},
	journey: {
		label: 'Journey',
		intent: 'moves the viewer from place to place',
		beats: ['open', 'place', 'showcase', 'close'],
		extras: ['list', 'quote'],
		topics: ['travel', 'history', 'event', 'food'],
	},
	'field-notes': {
		label: 'Field Notes',
		intent: 'observations recorded on the ground',
		beats: ['open', 'list', 'place', 'quote', 'close'],
		extras: ['evidence', 'showcase'],
		topics: ['travel', 'education', 'food', 'history'],
	},
	versus: {
		label: 'Versus',
		intent: 'holds two options against each other and picks one',
		beats: ['open', 'compare', 'evidence', 'close'],
		extras: ['thesis', 'list'],
		topics: ['product', 'data', 'tech', 'fitness'],
	},
	'before-after': {
		label: 'Before and After',
		intent: 'shows the old state, then the new one',
		beats: ['open', 'context', 'compare', 'turn', 'close'],
		extras: ['evidence', 'showcase'],
		topics: ['product', 'fitness', 'brand', 'tech'],
	},
	'myth-bust': {
		label: 'Myth Bust',
		intent: 'states the common belief, then dismantles it',
		beats: ['hook', 'thesis', 'evidence', 'turn', 'close'],
		extras: ['compare', 'list'],
		topics: ['education', 'data', 'fitness', 'food'],
	},
	'hot-take': {
		label: 'Hot Take',
		intent: 'one loud opinion, defended fast',
		beats: ['hook', 'thesis', 'list', 'close'],
		extras: ['quote', 'evidence'],
		topics: ['brand', 'tech', 'product'],
	},
	'product-tour': {
		label: 'Product Tour',
		intent: 'walks the viewer through what a thing does',
		beats: ['open', 'showcase', 'list', 'evidence', 'close'],
		extras: ['compare', 'steps'],
		topics: ['product', 'tech', 'brand'],
	},
	lookbook: {
		label: 'Lookbook',
		intent: 'presents a set of things worth looking at',
		beats: ['open', 'showcase', 'list', 'close'],
		extras: ['quote', 'place'],
		topics: ['brand', 'travel', 'food', 'event'],
	},
	'poster-series': {
		label: 'Poster Series',
		intent: 'a run of standalone statements that share a look',
		beats: ['open', 'thesis', 'list', 'thesis', 'close'],
		extras: ['hook', 'showcase'],
		topics: ['brand', 'event', 'education'],
	},
	scrapbook: {
		label: 'Scrapbook',
		intent: 'assembles fragments into an impression',
		beats: ['open', 'list', 'quote', 'showcase', 'close'],
		extras: ['place', 'time'],
		topics: ['travel', 'food', 'event', 'history'],
	},
	countdown: {
		label: 'Countdown',
		intent: 'counts down to a single moment',
		beats: ['open', 'list', 'evidence', 'turn', 'close'],
		extras: ['hook', 'compare'],
		topics: ['event', 'product', 'fitness'],
	},
	'beat-drop': {
		label: 'Beat Drop',
		intent: 'builds tension and releases it on one card',
		beats: ['hook', 'thesis', 'turn', 'close'],
		extras: ['showcase', 'list'],
		topics: ['brand', 'event', 'product'],
	},
	scoreboard: {
		label: 'Scoreboard',
		intent: 'reports results, ranked',
		beats: ['open', 'evidence', 'compare', 'list', 'close'],
		extras: ['quote', 'turn'],
		topics: ['data', 'fitness', 'event', 'product'],
	},
} as const satisfies Record<string, ArcRecipe>

export type ArcId = keyof typeof ARC_KIT
export const ARC_IDS = Object.keys(ARC_KIT) as ArcId[]

export function isArcId(value: unknown): value is ArcId {
	return typeof value === 'string' && value in ARC_KIT
}

/** Arcs that suit a topic, used when the template's own pool is exhausted. */
export function arcsForTopic(topic: string): ArcId[] {
	const matches = ARC_IDS.filter((id) => (ARC_KIT[id].topics as readonly string[]).includes(topic))
	return matches.length > 0 ? matches : ARC_IDS
}
