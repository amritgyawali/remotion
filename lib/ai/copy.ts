/**
 * Structural copy.
 *
 * The director never invents facts, but it does have to write the small
 * connective words a film needs — a kicker over a title, a tagline on the end
 * card, a label above a chart. Those used to be a single hard-coded string per
 * slot, which is the main reason two videos about different subjects still read
 * as the same video.
 *
 * Every phrase below is a *frame* around the user's own words, never a claim
 * about the subject. `{subject}` and `{topic}` are the only substitutions, so a
 * generated line can only ever restate what the brief already said.
 */

import { seededChoice, seededIndex } from './variation'

export type CopyContext = {
	seed: string
	subject: string
	topic: string
	/** The arc being told, so the connective copy matches the story shape. */
	arc: string
}

/**
 * Reader-facing names for the internal topic ids.
 *
 * The planner's topics are routing labels - printing "brand" or "data" over a
 * title card reads as a debug string, and "A education film" reads as a bug.
 */
const TOPIC_LABEL: Record<string, string> = {
	history: 'history',
	travel: 'travel',
	product: 'product',
	tech: 'technology',
	data: 'analysis',
	education: 'explainer',
	food: 'food',
	fitness: 'wellbeing',
	event: 'event',
	brand: 'brand story',
}

function fill(template: string, context: CopyContext): string {
	const topic = TOPIC_LABEL[context.topic] ?? context.topic
	const article = /^[aeiou]/i.test(topic) ? 'An' : 'A'
	return template
		.replaceAll('{subject}', context.subject)
		.replaceAll('{a topic}', article + ' ' + topic)
		.replaceAll('{topic}', topic)
}

/** Draws one phrase from a bank, keyed so two slots never collide. */
function pick(bank: readonly string[], context: CopyContext, slot: string): string {
	return fill(seededChoice(`${context.seed}:copy:${context.arc}`, slot, bank), context)
}

/* -------------------------------------------------------------------------- */
/*  Banks                                                                     */
/* -------------------------------------------------------------------------- */

const KICKERS = [
	'{topic}',
	'{a topic} film',
	'On {subject}',
	'Feature',
	'Presenting',
	'Chapter one',
	'The brief',
	'In focus',
	'Field guide',
	'Short film',
	'A closer look',
	'Notes on {subject}',
	'The subject',
	'Opening',
	'{topic} · {subject}',
	'Case study',
	'Dispatch',
	'Volume one',
	'Now showing',
	'Selected',
] as const

const HOOK_LEADS = [
	'Start here.',
	'Look closer.',
	'Here is the short version.',
	'One thing first.',
	'Read this twice.',
	'Everything below follows from this.',
	'Hold that thought.',
	'Consider the following.',
	'Worth saying plainly.',
	'The short answer:',
	'Before anything else.',
	'This is the part that matters.',
] as const

const SECTION_LABELS = {
	context: ['Context', 'Background', 'The setup', 'Where this starts', 'Groundwork', 'The situation'],
	evidence: ['By the numbers', 'The figures', 'Measured', 'What the data says', 'Counted', 'On record'],
	list: ['What it covers', 'The parts', 'Selected', 'In brief', 'The set', 'Line by line'],
	steps: ['Step by step', 'The method', 'How it runs', 'The sequence', 'In order', 'The procedure'],
	time: ['Over time', 'The record', 'Timeline', 'Era by era', 'The sequence', 'Milestones'],
	place: ['On the map', 'Where', 'Ground truth', 'Locations', 'The territory', 'Placed'],
	showcase: ['In view', 'The subject', 'Up close', 'Centre frame', 'Presented', 'The object'],
	compare: ['Side by side', 'Held against', 'The comparison', 'Weighed', 'Versus', 'Measured against'],
	turn: ['And yet', 'The turn', 'Here is the catch', 'Except', 'Which changes things', 'The other half'],
	quote: ['In their words', 'Quoted', 'Said aloud', 'On the record', 'Verbatim', 'Overheard'],
} as const satisfies Record<string, readonly string[]>

const TAGLINES = [
	'{subject}',
	'{a topic} film',
	'Made with Remotion',
	'End of reel',
	'That is the whole of it',
	'More on {subject}',
	'Thanks for watching',
	'Roll credits',
	'Keep going',
	'Until next time',
	'Cut',
	'Fin',
	'One more time',
	'Take it from here',
] as const

const CTA_LEADS = [
	'Watch again',
	'Start with {subject}',
	'See the rest',
	'Take a look',
	'Go deeper on {subject}',
	'Pick it up here',
	'Follow the thread',
	'Read the long version',
	'Share this one',
	'Save for later',
] as const

const STATEMENT_FRAMES = [
	'{subject}',
	'{subject}, in one line',
	'Start with {subject}',
	'It comes down to {subject}',
	'{subject} — and what follows from it',
	'The whole of it: {subject}',
	'Why {subject} matters',
	'{subject}, plainly',
	'Everything below is {subject}',
	'{subject} is the point',
] as const

/** The small label a closing card carries above its line. */
const CLOSE_KICKERS = [
	'The end',
	'Wrapping up',
	'One last thing',
	'To close',
	'That is the film',
	'Last frame',
	'Sign off',
	'Curtain',
] as const

const TIMELINE_TITLES = [
	'{subject} timeline',
	'{subject}, in order',
	'The {subject} record',
	'How {subject} unfolded',
	'{subject} by era',
	'Marking {subject}',
] as const

const PLACE_TITLES = [
	'Where {subject} happens',
	'{subject} on the map',
	'Placing {subject}',
	'The {subject} territory',
	'{subject}, located',
	'Ground for {subject}',
] as const

const PROCESS_TITLES = [
	'How {subject} works',
	'{subject}, step by step',
	'Running {subject}',
	'The {subject} method',
	'Building {subject}',
	'{subject} in sequence',
] as const

const LIST_TITLES = [
	'{subject}',
	'Inside {subject}',
	'{subject}, in parts',
	'What makes up {subject}',
	'The {subject} set',
	'{subject} at a glance',
] as const

const EVIDENCE_TITLES = [
	'{subject} by the numbers',
	'{subject}, measured',
	'Counting {subject}',
	'The {subject} figures',
	'{subject} on record',
	'{subject}, quantified',
] as const

const COMPARE_TITLES = [
	'{subject}, compared',
	'{subject} side by side',
	'Weighing {subject}',
	'{subject} against itself',
	'The {subject} spread',
	'{subject}, ranked',
] as const

const SHOWCASE_TITLES = [
	'{subject}',
	'{subject}, up close',
	'Presenting {subject}',
	'{subject} in view',
	'A look at {subject}',
	'{subject}, centre frame',
] as const

/* -------------------------------------------------------------------------- */
/*  Public draws                                                              */
/* -------------------------------------------------------------------------- */

export function kickerFor(context: CopyContext): string {
	return pick(KICKERS, context, 'kicker')
}

export function hookLeadFor(context: CopyContext): string {
	return pick(HOOK_LEADS, context, 'hook-lead')
}

export function sectionLabel(role: keyof typeof SECTION_LABELS, context: CopyContext, ordinal = 0): string {
	return pick(SECTION_LABELS[role], context, `section-${role}-${ordinal}`)
}

export function taglineFor(context: CopyContext): string {
	return pick(TAGLINES, context, 'tagline')
}

export function closeKickerFor(context: CopyContext): string {
	return pick(CLOSE_KICKERS, context, 'close-kicker')
}

export function ctaLeadFor(context: CopyContext): string {
	return pick(CTA_LEADS, context, 'cta-lead')
}

export function statementFrame(context: CopyContext, ordinal = 0): string {
	return pick(STATEMENT_FRAMES, context, `statement-${ordinal}`)
}

export function timelineTitle(context: CopyContext): string {
	return pick(TIMELINE_TITLES, context, 'timeline-title')
}

export function placeTitle(context: CopyContext): string {
	return pick(PLACE_TITLES, context, 'place-title')
}

export function processTitle(context: CopyContext): string {
	return pick(PROCESS_TITLES, context, 'process-title')
}

export function listTitle(context: CopyContext, ordinal = 0): string {
	return pick(LIST_TITLES, context, `list-title-${ordinal}`)
}

export function evidenceTitle(context: CopyContext): string {
	return pick(EVIDENCE_TITLES, context, 'evidence-title')
}

export function compareTitle(context: CopyContext): string {
	return pick(COMPARE_TITLES, context, 'compare-title')
}

export function showcaseTitle(context: CopyContext, ordinal = 0): string {
	return pick(SHOWCASE_TITLES, context, `showcase-title-${ordinal}`)
}

/**
 * Rotates through the brief's own fragments so two scenes never quote the same
 * line, and returns an empty string once they run out rather than repeating.
 */
export function fragmentAt(fragments: readonly string[], index: number): string {
	return index < fragments.length ? fragments[index] : ''
}

/** Deterministically shuffles a list so ordering is not always source order. */
export function seededShuffle<T>(seed: string, label: string, items: readonly T[]): T[] {
	const out = [...items]
	for (let index = out.length - 1; index > 0; index -= 1) {
		const swap = seededIndex(seed, `${label}-${index}`, index + 1)
		;[out[index], out[swap]] = [out[swap], out[index]]
	}
	return out
}
