'use client'

/**
 * Deciding which object stands behind the speaker, and for how long.
 *
 * The subtitle studio already knows what is being said and exactly when, down
 * to the word. That transcript is the whole input here: a shot list is a pure
 * function of the cues, so the same clip always plans the same objects, and a
 * user who re-times a caption sees the object move with it.
 *
 * Three rules shape the list, and each exists because the naive version looks
 * wrong on screen rather than because it is untidy in memory:
 *
 * - **One object per idea, not one per cue.** Cues are short - two seconds is
 *   typical - so an object that changed with every line would strobe. A run of
 *   consecutive cues that all point at the same asset becomes one shot.
 *
 * - **Nothing repeats back to back.** Consecutive shots exclude the previous
 *   asset from matching, so "we launched, and the launch went well" does not
 *   put the same rocket up twice with a blink in between. The second line
 *   finds its own object or gets none.
 *
 * - **A shot has a floor and a ceiling.** Below about eight-tenths of a second
 *   an object reads as a flash rather than an image, and past five seconds a
 *   still sprite behind someone's head stops being an accent and starts being
 *   a background. Shots are extended into the following silence to reach the
 *   floor - never over the next shot - and trimmed to the ceiling.
 */

import { matchObjectForText, objectAssetById, objectAssetSrc, wordsOf, type ObjectAsset } from './object-library'
import { NO_SAFE_AREA, type ObjectSizeMode, type SafeArea } from './object-anchor'
import type { CaptionCue, CaptionStyle } from './types'

export type { ObjectSizeMode, SafeArea } from './object-anchor'

/**
 * The part of the frame the captions own, which the object may not enter.
 *
 * An object that drifts down over the subtitles has broken the one thing this
 * studio exists to do, and it is not a rare accident: a tall speaker in a
 * portrait clip puts the head anchor low enough that a large object reaches
 * the caption band on its own. The band is measured from the caption style
 * itself - its distance from the edge, plus the height its lines actually
 * occupy - so restyling the captions moves the boundary with them.
 *
 * A quarter of a line is added on top. Descenders, the glow and the faked 3D
 * edge all draw outside the line box, and an object that stops exactly at the
 * measured edge still looks like it is touching the text.
 */
export function captionSafeArea(style: CaptionStyle): SafeArea {
	if (style.placement === 'center') return { ...NO_SAFE_AREA }
	const lines = Math.max(1, Math.min(4, style.maxLines))
	const band = (style.fontSizePercent * Math.max(1, style.lineHeight) * (lines + 0.25) + style.offsetPercent) / 100
	const reserved = Math.min(0.45, Math.max(0, band))
	return style.placement === 'top'
		? { ...NO_SAFE_AREA, top: reserved }
		: { ...NO_SAFE_AREA, bottom: reserved }
}

/**
 * Where an object's picture comes from.
 *
 * `web` is a picture the studio fetched from the open web for a spoken word and
 * cut out itself. It behaves exactly like an upload from here on - the bytes
 * are in the vault and the sprite loader reads them the same way - and it is a
 * separate kind only because the panel has to be able to say where a picture
 * came from and credit it.
 */
export type ObjectSourceKind = 'library' | 'upload' | 'model3d' | 'web'

/**
 * Which catalogue a plan is drawn from.
 *
 * It lives here rather than with the director because the session normaliser
 * has to validate it on the way back in, and pulling the whole planner into
 * the snapshot code to read one string union would be the wrong dependency.
 */
export type ObjectPlanMode = 'flat' | 'model3d'

/**
 * Continuous motion applied to the sprite.
 *
 * Every one of these is a pure function of the shot's own elapsed time, so a
 * re-bake reproduces the same frames, and none of them moves the object far
 * enough to leave the speaker's head - a "3D object behind the head" that
 * drifts out of frame is just an object.
 */
export type ObjectMotion = 'none' | 'float' | 'spin' | 'sway' | 'pulse'

export type ObjectShot = {
	id: string
	startMs: number
	endMs: number
	/** the spoken word that chose this object, echoed in the UI */
	keyword: string
	label: string
	kind: ObjectSourceKind
	/** library asset id, or the GLB id for a `model3d` shot */
	assetId: string | null
	/** the resolved picture address - a pack path, or an object URL for an upload */
	src: string | null
	/** vault id for an uploaded or fetched picture, so a refresh restores it */
	blobId: string | null
	/** who made a fetched picture and under what licence - shown, never invented */
	credit: string | null
	/** where a fetched picture came from, so the credit can be followed */
	sourceUrl: string | null
	/** height as a fraction of the frame height */
	scale: number
	/** sideways nudge from the head anchor, as a fraction of frame width */
	offsetX: number
	/** vertical nudge from the head anchor, as a fraction of frame height */
	offsetY: number
	opacity: number
	motion: ObjectMotion
}

/** Everything about the bake that is not the shot list itself. */
export type ObjectSettings = {
	/** which segmentation model finds the person */
	model: 'balanced' | 'precise'
	/** matte controls, all 0-100 except `edgeShift`, which is -50 to 50 */
	feather: number
	matte: number
	edgeShift: number
	lightWrap: number
	/**
	 * How dark a shadow the speaker casts onto the object behind them, 0-100.
	 *
	 * This replaced the background remover's fringe clean-up, which had nothing
	 * to do here: that pass exists to strip the colour a *different* backdrop
	 * left on the subject's edge, and the backdrop here is the subject's own
	 * room. A contact shadow is what the composite actually lacks, and it is
	 * the cheapest cue that separates the two planes.
	 */
	contactShadow: number
	/** temporal smoothing of the mask itself, 0-95 */
	smoothing: number
	/** how hard the head anchor is filtered, 0-100 */
	anchorDamping: number
	/** false pins every object to the middle of the frame instead of the head */
	followHead: boolean
	/** sizes the object against the frame, or against the speaker's head */
	sizeMode: ObjectSizeMode
	/**
	 * How many head widths across a fetched object is drawn.
	 *
	 * Three is the look this was built for: big enough to read as the subject of
	 * the frame rather than a badge pinned to it, small enough that the head and
	 * shoulders still cut a clear silhouette out of the middle of it. It only
	 * governs the one-press flow - a hand-placed object keeps whatever size the
	 * slider was left at, because a number nobody typed should not overrule one
	 * somebody did.
	 */
	headMultiple: number
	/**
	 * Skips the segmentation model on frames where the picture has not moved.
	 *
	 * On by default: it is the single largest saving in the bake and it cannot
	 * change a frame the model would have agreed with. Off is for footage where
	 * the subject moves inside a frame that does not - a locked camera on a
	 * still body with only the mouth moving - where the difference test is
	 * measuring the wrong thing.
	 */
	adaptiveMask: boolean
	/** how long an object takes to arrive and to leave, milliseconds */
	entranceMs: number
	/** renders the matte instead of the picture, for checking the cut-out */
	showMatte: boolean
}

export const DEFAULT_OBJECT_SETTINGS: ObjectSettings = {
	model: 'precise',
	feather: 28,
	matte: 62,
	edgeShift: 0,
	lightWrap: 18,
	contactShadow: 35,
	smoothing: 55,
	anchorDamping: 70,
	followHead: true,
	sizeMode: 'head',
	headMultiple: 3,
	adaptiveMask: true,
	entranceMs: 260,
	showMatte: false,
}

export const DEFAULT_SHOT_LOOK = {
	scale: 0.38,
	offsetX: 0,
	/**
	 * Slightly above the head anchor.
	 *
	 * The anchor is the top of the subject's head, and an object centred
	 * exactly on it is half hidden by the skull. Lifting it by a twelfth of the
	 * frame puts the mass of the picture above the head and the bottom of it
	 * behind the shoulders, which is the arrangement that reads as "behind" at
	 * a glance.
	 */
	offsetY: -0.085,
	opacity: 1,
	motion: 'float' as ObjectMotion,
}

export type PlanObjectsOptions = {
	/** a shot shorter than this is extended, or dropped if it cannot be */
	minShotMs?: number
	maxShotMs?: number
	/** how many previous assets a new shot may not reuse */
	avoidRepeatWindow?: number
	/**
	 * The quiet between one object leaving and the next arriving.
	 *
	 * This is what stops a dense passage - three nouns in four seconds - from
	 * becoming a slideshow behind someone's head. It is also the density
	 * control: a gap of a second caps the plan at about forty objects a
	 * minute however many the transcript could justify.
	 */
	minGapMs?: number
	/** where the clip ends, so the last shot cannot run past it */
	durationMs?: number
	look?: Partial<typeof DEFAULT_SHOT_LOOK>
}

const DEFAULTS = {
	minShotMs: 800,
	maxShotMs: 5_000,
	avoidRepeatWindow: 2,
	minGapMs: 700,
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))

let shotCounter = 0
const nextShotId = (): string => `object-${Date.now().toString(36)}-${(shotCounter++).toString(36)}`

/**
 * One cue's object, before it has a start and an end.
 *
 * Separating the choice from the shot is what lets the language model and the
 * keyword matcher be interchangeable: both produce a choice per cue, and one
 * function turns either into a shot list. Nothing downstream can tell which
 * of them made a given decision, which is the point - the AI pass is a
 * refinement, not a second pipeline.
 */
export type ObjectChoice = {
	kind: ObjectSourceKind
	assetId: string
	label: string
	keyword: string
	/** the picture address; null for a model, which the renderer resolves itself */
	src: string | null
	/** the asset's own idea of how big it wants to be, in frame heights */
	scale: number
	/**
	 * How much this choice is worth, when two of them cannot both be shown.
	 *
	 * The matcher's own confidence, multiplied by how distinctive the word is
	 * across this transcript. A video about rockets says "rocket" in half its
	 * lines, and showing a rocket every time is the same as showing nothing;
	 * the word that appears once is the one worth illustrating. It is inverse
	 * document frequency, computed over the cues rather than over a corpus,
	 * because the corpus that matters is this video.
	 */
	score: number
}

export function choiceFromAsset(asset: ObjectAsset, keyword: string, score = 1): ObjectChoice {
	return {
		kind: 'library',
		assetId: asset.id,
		label: asset.label,
		keyword,
		src: objectAssetSrc(asset, keyword),
		scale: asset.scale,
		score,
	}
}

export function shotFromChoice(
	choice: ObjectChoice,
	args: { startMs: number; endMs: number; look?: Partial<typeof DEFAULT_SHOT_LOOK> },
): ObjectShot {
	const look = { ...DEFAULT_SHOT_LOOK, ...args.look }
	return {
		id: nextShotId(),
		startMs: Math.max(0, Math.round(args.startMs)),
		endMs: Math.max(1, Math.round(args.endMs)),
		keyword: choice.keyword,
		label: choice.label,
		kind: choice.kind,
		assetId: choice.assetId,
		src: choice.src,
		blobId: null,
		credit: null,
		sourceUrl: null,
		// The catalogue's own size is a starting point, not a rule: a confetti
		// burst wants to be bigger than a phone for the same shot to read.
		scale: clamp(look.scale * (choice.scale / DEFAULT_SHOT_LOOK.scale), 0.05, 1.4),
		offsetX: look.offsetX,
		offsetY: look.offsetY,
		opacity: look.opacity,
		motion: look.motion,
	}
}

/** Builds a shot straight from a library asset - the panel's "swap this one" path. */
export function shotFromAsset(
	asset: ObjectAsset,
	args: { startMs: number; endMs: number; keyword: string; look?: Partial<typeof DEFAULT_SHOT_LOOK> },
): ObjectShot {
	return shotFromChoice(choiceFromAsset(asset, args.keyword), args)
}

export type ChoiceEntry = { cue: CaptionCue; choice: ObjectChoice | null }

/**
 * Collapses one choice per cue into the shot list.
 *
 * Three rules, in order, and each one is a thing that looks wrong on screen
 * rather than a thing that is untidy in memory:
 *
 * - Consecutive cues that chose the same object become one shot, so an object
 *   does not strobe line to line.
 * - A choice that repeats what is still fresh is dropped rather than shown
 *   twice with a blink between.
 * - A choice that arrives too soon after the last one has to be *worth more*
 *   than what is already there to take its place. Dropping the newcomer
 *   unconditionally would let a weak first match block a strong second one for
 *   the rest of a sentence, which is how a plan ends up illustrating "thing"
 *   and ignoring "rocket".
 */
export function shotsFromChoices(entries: ChoiceEntry[], options: PlanObjectsOptions = {}): ObjectShot[] {
	const avoidWindow = options.avoidRepeatWindow ?? DEFAULTS.avoidRepeatWindow
	const minGapMs = options.minGapMs ?? DEFAULTS.minGapMs
	const minShotMs = options.minShotMs ?? DEFAULTS.minShotMs
	const ordered = [...entries].sort((left, right) => left.cue.startMs - right.cue.startMs)
	const shots: ObjectShot[] = []
	const scores: number[] = []
	const recent: string[] = []

	for (const { cue, choice } of ordered) {
		if (!choice) continue
		const open = shots[shots.length - 1]
		if (open && open.assetId === choice.assetId && open.endMs >= cue.startMs - 1) {
			open.endMs = Math.max(open.endMs, cue.endMs)
			continue
		}
		if (recent.slice(-avoidWindow).includes(choice.assetId)) continue

		// Two objects collide only when making room for the newcomer would leave
		// the one already there below the readability floor. Adjacent shots are
		// the normal case and are not a collision: `tidyShots` simply trims the
		// earlier one back to open the gap, which costs it a few frames of a
		// life it was going to end anyway.
		if (open && cue.startMs - minGapMs - open.startMs < minShotMs) {
			if (choice.score <= scores[scores.length - 1]) continue
			// The newcomer is the better illustration, so it takes the slot
			// rather than queueing behind a weaker match for the rest of the
			// sentence.
			shots.pop()
			scores.pop()
			recent.pop()
		}

		shots.push(shotFromChoice(choice, { startMs: cue.startMs, endMs: cue.endMs, look: options.look }))
		scores.push(choice.score)
		recent.push(choice.assetId)
	}

	return tidyShots(shots, {
		minShotMs,
		maxShotMs: options.maxShotMs ?? DEFAULTS.maxShotMs,
		minGapMs,
		durationMs: options.durationMs,
	})
}

/**
 * How rare each word is in this transcript, as a multiplier on a match.
 *
 * Inverse document frequency over the cues. A word in one line out of forty
 * scores near three; a word in half of them scores near nothing, which is the
 * right answer - if the whole video is about rockets, the rocket is the
 * wallpaper and the one line that mentions money is the one worth a picture.
 */
export function keywordSalience(cues: CaptionCue[]): Map<string, number> {
	const documents = Math.max(1, cues.length)
	const seen = new Map<string, number>()
	for (const cue of cues) {
		for (const word of new Set(wordsOf(cue.text))) {
			seen.set(word, (seen.get(word) ?? 0) + 1)
		}
	}
	const salience = new Map<string, number>()
	for (const [word, count] of seen) {
		salience.set(word, Math.log(documents / count) + 0.25)
	}
	return salience
}

/**
 * Reads the transcript with the keyword matcher and returns one choice per
 * cue - null wherever the line is about nothing in the catalogue.
 */
export function choicesFromCues(cues: CaptionCue[], options: PlanObjectsOptions = {}): ChoiceEntry[] {
	const avoidWindow = options.avoidRepeatWindow ?? DEFAULTS.avoidRepeatWindow
	const ordered = [...cues].sort((left, right) => left.startMs - right.startMs)
	const salience = keywordSalience(ordered)
	const recent: string[] = []

	const scoreOf = (keyword: string, confidence: number): number =>
		confidence * (salience.get(keyword) ?? 1)

	return ordered.map((cue) => {
		// A cue that still mentions what is already on screen keeps it. Without
		// this the repeat guard would push a continuing sentence onto a second,
		// unrelated object - the worst of both rules.
		const plain = matchObjectForText(cue.text)
		if (plain && plain.asset.id === recent[recent.length - 1]) {
			return {
				cue,
				choice: choiceFromAsset(plain.asset, plain.keyword, scoreOf(plain.keyword, plain.score)),
			}
		}

		const match = matchObjectForText(cue.text, new Set(recent.slice(-avoidWindow)))
		if (!match) return { cue, choice: null }
		recent.push(match.asset.id)
		return {
			cue,
			choice: choiceFromAsset(match.asset, match.keyword, scoreOf(match.keyword, match.score)),
		}
	})
}

/**
 * Reads the transcript and returns the objects that should stand behind the
 * speaker, in order, never overlapping.
 */
export function planObjectsFromCues(cues: CaptionCue[], options: PlanObjectsOptions = {}): ObjectShot[] {
	return shotsFromChoices(choicesFromCues(cues, options), options)
}

/**
 * Applies the floor, the ceiling and the no-overlap rule.
 *
 * Exported because the panel calls it after a hand edit: dragging one shot
 * longer must not be allowed to swallow the next one.
 */
export function tidyShots(
	shots: ObjectShot[],
	options: { minShotMs?: number; maxShotMs?: number; minGapMs?: number; durationMs?: number } = {},
): ObjectShot[] {
	const minShotMs = options.minShotMs ?? DEFAULTS.minShotMs
	const maxShotMs = options.maxShotMs ?? DEFAULTS.maxShotMs
	const minGapMs = options.minGapMs ?? 0
	const ceiling = options.durationMs && options.durationMs > 0 ? options.durationMs : Infinity

	const ordered = [...shots].sort((left, right) => left.startMs - right.startMs)
	const kept: ObjectShot[] = []

	ordered.forEach((shot, index) => {
		const next = ordered[index + 1]
		// The quiet before the next object is protected here as well as at
		// selection time: a hand-dragged shot must not be able to close it.
		const room = Math.min(next ? next.startMs - minGapMs : Infinity, ceiling)
		const start = clamp(shot.startMs, 0, Math.max(0, room - 1))
		// The floor is only reached by growing into the silence that follows;
		// nothing is ever allowed to cover the next object's first frame.
		const wanted = Math.max(shot.endMs, start + minShotMs)
		const end = Math.min(Math.min(wanted, start + maxShotMs), room)

		if (end - start < Math.min(minShotMs, 320)) return
		kept.push({ ...shot, startMs: start, endMs: end })
	})

	return kept
}

/** The shot covering this instant, or null. Shots never overlap. */
export function shotAtMs(shots: ObjectShot[], ms: number): ObjectShot | null {
	for (const shot of shots) {
		if (ms >= shot.startMs && ms < shot.endMs) return shot
	}
	return null
}

/**
 * How far into its entrance or exit this shot is, 0 to 1.
 *
 * A sprite that appears on one frame and vanishes on another looks like a
 * dropped frame. This is the ease both ends share, and it is a pure function
 * of the time, so the preview still and the baked video agree.
 */
export function shotFade(shot: ObjectShot, ms: number, entranceMs: number): number {
	const span = shot.endMs - shot.startMs
	const ramp = Math.max(1, Math.min(entranceMs, span / 2))
	const since = ms - shot.startMs
	const until = shot.endMs - ms
	if (since < 0 || until <= 0) return 0
	const rising = Math.min(1, since / ramp)
	const falling = Math.min(1, until / ramp)
	const linear = Math.min(rising, falling)
	// Smoothstep: an object that eases in reads as placed, a linear fade reads
	// as a dissolve.
	return linear * linear * (3 - 2 * linear)
}

export function describeObjectPlan(shots: ObjectShot[]): string {
	if (shots.length === 0) return 'no objects yet'
	const seconds = shots.reduce((total, shot) => total + (shot.endMs - shot.startMs), 0) / 1000
	const distinct = new Set(shots.map((shot) => shot.assetId ?? shot.src ?? shot.id)).size
	return `${shots.length} shot${shots.length === 1 ? '' : 's'}, ${distinct} distinct object${
		distinct === 1 ? '' : 's'
	}, ${seconds.toFixed(1)}s on screen`
}

/* ==========================================================================
   Restoring a plan from a snapshot.
   ========================================================================== */

const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value)

const num = (value: unknown, fallback: number, min = -Infinity, max = Infinity): number =>
	typeof value === 'number' && Number.isFinite(value) ? clamp(value, min, max) : fallback

const str = (value: unknown, fallback: string): string => (typeof value === 'string' ? value : fallback)

const MOTIONS: readonly ObjectMotion[] = ['none', 'float', 'spin', 'sway', 'pulse']
const KINDS: readonly ObjectSourceKind[] = ['library', 'upload', 'model3d', 'web']

/**
 * A shot read back from the vault.
 *
 * An uploaded picture's object URL dies with the tab that made it, so `src` is
 * dropped for those and rebuilt from `blobId` on the way back in. A shot whose
 * upload is gone keeps its timing and its label and is shown as needing a
 * picture, rather than silently disappearing from the plan.
 */
export function normalizeObjectShots(value: unknown): ObjectShot[] {
	if (!Array.isArray(value)) return []
	return value.flatMap((raw): ObjectShot[] => {
		if (!isObject(raw)) return []
		const startMs = num(raw.startMs, -1, 0)
		const endMs = num(raw.endMs, -1, 0)
		if (startMs < 0 || endMs <= startMs) return []
		const kind = KINDS.includes(raw.kind as ObjectSourceKind) ? (raw.kind as ObjectSourceKind) : 'library'
		const assetId = typeof raw.assetId === 'string' ? raw.assetId : null
		const blobId = typeof raw.blobId === 'string' ? raw.blobId : null
		const asset = kind === 'library' && assetId ? objectAssetById(assetId) : null
		if (kind === 'library' && !asset) return []
		const keyword = str(raw.keyword, '')
		return [
			{
				id: str(raw.id, nextShotId()),
				startMs,
				endMs,
				keyword,
				label: str(raw.label, asset?.label ?? 'Object'),
				kind,
				assetId,
				src: asset ? objectAssetSrc(asset, keyword) : null,
				blobId,
				credit: typeof raw.credit === 'string' ? raw.credit.slice(0, 300) : null,
				sourceUrl: typeof raw.sourceUrl === 'string' ? raw.sourceUrl.slice(0, 600) : null,
				scale: num(raw.scale, DEFAULT_SHOT_LOOK.scale, 0.05, 1.4),
				offsetX: num(raw.offsetX, DEFAULT_SHOT_LOOK.offsetX, -0.6, 0.6),
				offsetY: num(raw.offsetY, DEFAULT_SHOT_LOOK.offsetY, -0.6, 0.6),
				opacity: num(raw.opacity, 1, 0, 1),
				motion: MOTIONS.includes(raw.motion as ObjectMotion) ? (raw.motion as ObjectMotion) : 'float',
			},
		]
	})
}

export function normalizeObjectSettings(value: unknown): ObjectSettings {
	if (!isObject(value)) return { ...DEFAULT_OBJECT_SETTINGS }
	return {
		model: value.model === 'balanced' ? 'balanced' : 'precise',
		feather: num(value.feather, DEFAULT_OBJECT_SETTINGS.feather, 0, 100),
		matte: num(value.matte, DEFAULT_OBJECT_SETTINGS.matte, 0, 100),
		edgeShift: num(value.edgeShift, DEFAULT_OBJECT_SETTINGS.edgeShift, -50, 50),
		lightWrap: num(value.lightWrap, DEFAULT_OBJECT_SETTINGS.lightWrap, 0, 100),
		contactShadow: num(value.contactShadow, DEFAULT_OBJECT_SETTINGS.contactShadow, 0, 100),
		smoothing: num(value.smoothing, DEFAULT_OBJECT_SETTINGS.smoothing, 0, 95),
		anchorDamping: num(value.anchorDamping, DEFAULT_OBJECT_SETTINGS.anchorDamping, 0, 100),
		followHead: typeof value.followHead === 'boolean' ? value.followHead : true,
		sizeMode: value.sizeMode === 'frame' ? 'frame' : 'head',
		headMultiple: num(value.headMultiple, DEFAULT_OBJECT_SETTINGS.headMultiple, 0.5, 8),
		adaptiveMask: typeof value.adaptiveMask === 'boolean' ? value.adaptiveMask : true,
		entranceMs: num(value.entranceMs, DEFAULT_OBJECT_SETTINGS.entranceMs, 0, 2_000),
		showMatte: typeof value.showMatte === 'boolean' ? value.showMatte : false,
	}
}
