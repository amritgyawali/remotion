/**
 * Subtitle sound design: the sound a sentence makes as it appears.
 *
 * A caption that pops on screen in silence reads as a caption. The same caption
 * with a 90 ms tick under it reads as an edit - which is why every social editor
 * puts a sound on the entrance. This module owns that layer:
 *
 *   - a catalogue of the studio's own CC0 effects, each with the loudness trim
 *     the asset kit measured for it, so switching effects does not change how
 *     loud the video is
 *   - a scheduler that turns the cue list into a list of timed, mixed audio
 *     events - one per sentence, per word, or only on emphasis words
 *   - deterministic variety: with 36 interchangeable takes per family, sentence
 *     11 does not sound like sentence 10, and yet frame N sounds identical in
 *     the preview, in a browser export and on a render farm
 *
 * Nothing here touches the DOM or the clock. The schedule is a pure function of
 * (cues, settings, style), which is what lets the generated .tsx carry the same
 * events as data and render them anywhere.
 */

import type {
	CaptionCue,
	CaptionSound,
	CaptionSoundVariation,
	CaptionStyle,
} from './types'

export type CaptionSfxCategory =
	| 'ui'
	| 'impacts'
	| 'transitions'
	| 'accents'
	| 'motion'
	| 'foley'

export type CaptionSfxOption = {
	id: string
	label: string
	category: CaptionSfxCategory
	/** what this sound is for, shown under the name in the picker */
	hint: string
	/**
	 * Loudness trim measured by the asset kit. Applying it means "volume 60%"
	 * sounds like 60% whichever effect is chosen - a boom and a tick are not the
	 * same number of decibels at the same fader position.
	 */
	gain: number
	/** longest take in the family, seconds - the sequence is sized from this */
	durationSeconds: number
	/** interchangeable takes; more than one lets consecutive sentences differ */
	variants: number
	/** staticFile() path, with `{NNN}` standing in for the 1-based variant */
	path: string
}

const single = (
	id: string,
	label: string,
	category: CaptionSfxCategory,
	hint: string,
	file: string,
	gain: number,
	durationSeconds: number,
): CaptionSfxOption => ({
	id,
	label,
	category,
	hint,
	gain,
	durationSeconds,
	variants: 1,
	path: `assets/audio/v1/sfx/${file}`,
})

const family = (
	id: string,
	label: string,
	category: CaptionSfxCategory,
	hint: string,
	folder: string,
	gain: number,
	durationSeconds: number,
): CaptionSfxOption => ({
	id,
	label,
	category,
	hint,
	gain,
	durationSeconds,
	variants: 36,
	// The kit nests a family in its own folder: variants/<category>/<id>/<id>-vNNN.wav
	path: `assets/audio/v1/sfx/variants/${folder}/${id}/${id}-v{NNN}.wav`,
})

/**
 * Thirty-five choices, all from the studio's own CC0 kit - nothing here calls
 * out to a third-party sound library, so an export carries no attribution debt.
 *
 * The "36 takes" entries come first in each group: they are what a caption track
 * should normally use, because a fixed one-shot repeated forty times is the
 * thing that makes an edit sound cheap.
 */
export const CAPTION_SFX: CaptionSfxOption[] = [
	/* -------------------------------------------------------------- ui */
	family('ui-pop', 'Pop', 'ui', '36 takes - the default social caption pop.', 'ui', 0.36, 0.22),
	family('ui-click', 'Click', 'ui', '36 takes - dry, tight, never in the way.', 'ui', 0.34, 0.14),
	family('ui-key', 'Key press', 'ui', '36 takes - pairs with the typewriter reveal.', 'ui', 0.28, 0.1),
	family(
		'ui-notification',
		'Notification',
		'ui',
		'36 takes - bright and positive, good on a punchline.',
		'ui',
		0.32,
		0.33,
	),
	single('ui-pop-clean', 'Clean pop', 'ui', 'One fixed pop, every sentence identical.', 'ui/pop-clean.wav', 0.38, 0.2),
	single('ui-click-soft', 'Soft click', 'ui', 'The quietest option in the kit.', 'ui/click-soft.wav', 0.36, 0.1),
	single('ui-tick', 'Tick', 'ui', 'A counter tick - tiny, mechanical.', 'ui/tick.wav', 0.28, 0.06),
	single(
		'ui-typewriter',
		'Typewriter',
		'ui',
		'One key strike, built for character reveals.',
		'ui/typewriter.wav',
		0.3,
		0.08,
	),
	single('ui-swipe', 'Swipe', 'ui', 'A short card swipe - reads as motion.', 'ui/swipe.wav', 0.32, 0.25),
	single(
		'ui-notification-bright',
		'Bright ping',
		'ui',
		'A fixed positive ping for hooks and CTAs.',
		'ui/notification-bright.wav',
		0.34,
		0.5,
	),

	/* --------------------------------------------------------- impacts */
	family(
		'impact-hit',
		'Hit',
		'impacts',
		'36 takes - a hard landing under a stamped word.',
		'impacts',
		0.42,
		0.25,
	),
	family(
		'impact-boom',
		'Boom',
		'impacts',
		'36 takes - trailer weight. Use it sparingly.',
		'impacts',
		0.42,
		0.77,
	),
	single(
		'impact-snap',
		'Snap',
		'impacts',
		'The fastest impact - a cut you can hear.',
		'impacts/impact-snap.wav',
		0.4,
		0.16,
	),
	single(
		'impact-clean',
		'Clean impact',
		'impacts',
		'A neutral reveal hit.',
		'impacts/impact-clean.wav',
		0.46,
		0.4,
	),
	single(
		'impact-deep',
		'Deep impact',
		'impacts',
		'Bass-heavy. Check it on a phone speaker.',
		'impacts/impact-deep.wav',
		0.42,
		0.8,
	),
	single(
		'impact-boom-tail',
		'Boom with tail',
		'impacts',
		'Two seconds of tail - for a title, not a sentence.',
		'impacts/impact-boom-tail.wav',
		0.44,
		2,
	),

	/* ------------------------------------------------------ transitions */
	family(
		'transition-glitch',
		'Glitch',
		'transitions',
		'36 takes - digital stutter, pairs with the glitch entrance.',
		'transitions',
		0.35,
		0.35,
	),
	family(
		'transition-drop',
		'Drop',
		'transitions',
		'36 takes - a sub drop under a heavy line.',
		'transitions',
		0.38,
		0.7,
	),
	family(
		'transition-riser',
		'Riser',
		'transitions',
		'36 takes - builds into the line. Best on slow captions.',
		'transitions',
		0.34,
		0.83,
	),
	single(
		'whoosh-fast',
		'Fast whoosh',
		'transitions',
		'Air moving - the classic slide-in sound.',
		'transitions/whoosh-fast.wav',
		0.4,
		0.4,
	),
	single(
		'whoosh-deep',
		'Deep whoosh',
		'transitions',
		'A longer, cinematic pass.',
		'transitions/whoosh-deep.wav',
		0.38,
		0.9,
	),
	single(
		'transition-glitch-cut',
		'Glitch cut',
		'transitions',
		'One fixed glitch, same every time.',
		'transitions/glitch.wav',
		0.36,
		0.4,
	),
	single(
		'transition-sub-drop',
		'Sub drop',
		'transitions',
		'Low end only - felt more than heard.',
		'transitions/sub-drop.wav',
		0.4,
		1.2,
	),
	single(
		'riser-digital',
		'Digital riser',
		'transitions',
		'A 1.5s build. Long captions only.',
		'transitions/riser-digital.wav',
		0.35,
		1.5,
	),
	single(
		'transition-riser-organic',
		'Organic riser',
		'transitions',
		'A softer, documentary build.',
		'transitions/riser-organic.wav',
		0.34,
		2,
	),

	/* ---------------------------------------------------------- accents */
	family(
		'accent-chime',
		'Chime',
		'accents',
		'36 takes - bright and musical, good on lists.',
		'accents',
		0.31,
		0.46,
	),
	family(
		'accent-shimmer',
		'Shimmer',
		'accents',
		'36 takes - sparkle for a reveal or a product line.',
		'accents',
		0.31,
		0.7,
	),
	family(
		'accent-power',
		'Power up',
		'accents',
		'36 takes - game-style lift on a winning line.',
		'accents',
		0.33,
		0.53,
	),
	single(
		'accent-chime-sparkle',
		'Sparkle chime',
		'accents',
		'One fixed magic chime.',
		'accents/chime-sparkle.wav',
		0.32,
		1,
	),
	single(
		'reveal-shimmer',
		'Reveal shimmer',
		'accents',
		'A premium one-second reveal.',
		'accents/reveal-shimmer.wav',
		0.34,
		1,
	),
	single(
		'accent-power-up',
		'Level up',
		'accents',
		'An arcade lift - loud personality.',
		'accents/power-up.wav',
		0.34,
		0.8,
	),
	single(
		'logo-stinger',
		'Logo stinger',
		'accents',
		'A branded button. Best on the last line only.',
		'accents/logo-stinger.wav',
		0.4,
		1.2,
	),

	/* -------------------------------------------------- motion & foley */
	family(
		'motion-whoosh',
		'Whoosh',
		'motion',
		'36 takes - the sound of the line arriving.',
		'motion',
		0.38,
		0.4,
	),
	family(
		'motion-swipe',
		'Swipe by',
		'motion',
		'36 takes - lighter than a whoosh, quick to repeat.',
		'motion',
		0.32,
		0.29,
	),
	family(
		'foley-touch',
		'Touch',
		'foley',
		'36 takes - a soft physical tap, almost subliminal.',
		'foley',
		0.3,
		0.19,
	),
]

export const CAPTION_SFX_IDS = CAPTION_SFX.map((option) => option.id)

const SFX_BY_ID = new Map(CAPTION_SFX.map((option) => [option.id, option]))

export const SFX_CATEGORY_LABEL: Record<CaptionSfxCategory, string> = {
	ui: 'Interface',
	impacts: 'Impacts',
	transitions: 'Transitions',
	accents: 'Accents',
	motion: 'Motion',
	foley: 'Foley',
}

export const SFX_CATEGORY_ORDER: CaptionSfxCategory[] = [
	'ui',
	'impacts',
	'motion',
	'transitions',
	'accents',
	'foley',
]

/** Never throws: a sound id from an older project falls back to the default pop. */
export function sfxById(id: string): CaptionSfxOption {
	return SFX_BY_ID.get(id) ?? SFX_BY_ID.get('ui-pop') ?? CAPTION_SFX[0]
}

export function isCaptionSfxId(id: unknown): id is string {
	return typeof id === 'string' && SFX_BY_ID.has(id)
}

/**
 * The entrance a caption uses decides what it should sound like.
 *
 * This is the "Auto" option, and it is the one most people should leave on: a
 * word that stamps onto the screen wants an impact, a word that slides in wants
 * air, and a typewriter wants key strikes. Changing the look then changes the
 * sound with it, which is the pairing the studio is trying to make obvious.
 */
export function autoSfxIdFor(style: Pick<CaptionStyle, 'animation' | 'reveal' | 'wordEffect'>): string {
	if (style.reveal === 'typewriter') return 'ui-key'
	switch (style.animation) {
		case 'stamp':
			return 'impact-hit'
		case 'glitch':
			return 'transition-glitch'
		case 'whoosh':
			return 'motion-whoosh'
		case 'slide':
			return 'motion-swipe'
		case 'rise':
			return 'foley-touch'
		case 'blur':
			return 'accent-shimmer'
		case 'fade':
			return 'ui-click'
		case 'none':
			return 'ui-click'
		case 'pop':
		default:
			return style.wordEffect === 'bounce' || style.wordEffect === 'jitter' ? 'impact-hit' : 'ui-pop'
	}
}

/** The sound a given entrance implies, resolved through `auto`. */
export function resolveSfxId(
	sound: Pick<CaptionSound, 'effectId'>,
	style: Pick<CaptionStyle, 'animation' | 'reveal' | 'wordEffect'>,
): string {
	return sound.effectId === 'auto' ? autoSfxIdFor(style) : sound.effectId
}

/**
 * Deterministic hash - the same one the asset kit uses to pick a variant.
 *
 * Math.random() cannot appear anywhere in this pipeline: a render is frames
 * computed in parallel, sometimes on different machines, and a sound that
 * differs between two runs of the same project is a bug, not variety.
 */
function fnv1a(text: string): number {
	let hash = 0x811c9dc5
	for (let index = 0; index < text.length; index++) {
		hash ^= text.charCodeAt(index)
		hash = Math.imul(hash, 0x01000193) >>> 0
	}
	return hash >>> 0
}

/** Picks which take of a family this event uses, 1-based. */
function variantFor(
	option: CaptionSfxOption,
	index: number,
	seed: string,
	variation: CaptionSoundVariation,
): number {
	if (option.variants <= 1) return 1
	if (variation === 'fixed') return 1
	if (variation === 'cycle') return (index % option.variants) + 1
	return (fnv1a(`${seed}:${option.id}:${index}`) % option.variants) + 1
}

export function sfxSrc(option: CaptionSfxOption, variant: number): string {
	if (option.variants <= 1) return option.path
	return option.path.replace('{NNN}', String(variant).padStart(3, '0'))
}

/** One scheduled sound: everything the composition needs, already resolved. */
export type CaptionSoundEvent = {
	/** staticFile() path relative to public/ */
	src: string
	/** when it fires, in milliseconds on the video's own timeline */
	atMs: number
	/** how long to hold the sequence open, milliseconds */
	durationMs: number
	/** final linear gain, loudness trim and user volume already applied */
	volume: number
	/** 1 unless pitch variation is on */
	playbackRate: number
}

const clamp = (value: number, min: number, max: number): number =>
	Math.max(min, Math.min(max, value))

/**
 * Turns the cue list into the sound track for it.
 *
 * Three shapes, all built from the same word timings the captions already use:
 *
 *   sentence - one sound as each caption appears (the default)
 *   word     - one per word, which is the karaoke/typewriter texture
 *   emphasis - only on the words the style already marks as emphasis, so the
 *              sound lands on the point rather than on every line
 *
 * `minGapMs` is what keeps that from turning into a machine gun: on fast speech
 * the word mode would otherwise fire ten times a second. Events closer together
 * than the gap are dropped, not stacked.
 */
export function buildSoundtrack(
	cues: CaptionCue[],
	sound: CaptionSound,
	style: Pick<CaptionStyle, 'animation' | 'reveal' | 'wordEffect' | 'emphasisWords'>,
	options?: { durationMs?: number },
): CaptionSoundEvent[] {
	if (!sound.enabled || cues.length === 0) return []

	const option = sfxById(resolveSfxId(sound, style))
	const volume = clamp(sound.volume, 0, 1) * option.gain
	if (volume <= 0.0005) return []

	const emphasis = new Set(
		style.emphasisWords.map((word) => word.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')),
	)
	const bare = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')

	// Where the sounds are allowed to be, in media milliseconds.
	const hits: { atMs: number; index: number }[] = []
	let index = 0
	for (const cue of cues) {
		if (sound.trigger === 'sentence') {
			hits.push({ atMs: cue.startMs, index: index++ })
			continue
		}
		for (const token of cue.tokens) {
			if (sound.trigger === 'emphasis' && !emphasis.has(bare(token.text))) continue
			hits.push({ atMs: token.fromMs, index: index++ })
		}
	}

	const seed = sound.seed || 'captions'
	const events: CaptionSoundEvent[] = []
	let lastAt = Number.NEGATIVE_INFINITY

	for (const hit of hits) {
		const atMs = Math.max(0, hit.atMs + sound.offsetMs)
		if (atMs - lastAt < sound.minGapMs) continue
		if (options?.durationMs && atMs >= options.durationMs) continue
		lastAt = atMs

		const variant = variantFor(option, hit.index, seed, sound.variation)
		// A small pitch drift is the cheapest way to stop a repeated one-shot
		// sounding like a loop. It is derived from the event index, never rolled.
		const drift =
			sound.pitchVariation > 0
				? 1 + ((fnv1a(`${seed}:rate:${hit.index}`) % 1000) / 1000 - 0.5) * 2 * sound.pitchVariation
				: 1
		const playbackRate = clamp(Number(drift.toFixed(4)), 0.5, 2)

		events.push({
			src: sfxSrc(option, variant),
			atMs: Math.round(atMs),
			// Playing faster shortens the take; the sequence must not cut its tail.
			durationMs: Math.ceil((option.durationSeconds * 1000) / playbackRate) + 40,
			volume: Number(volume.toFixed(4)),
			playbackRate,
		})
	}

	return events
}

/**
 * How much the video's own audio is pulled down around a sound effect.
 *
 * Broadcast practice: a sound placed over speech either ducks the speech or
 * fights it. The dip is a triangle - down over 60 ms, held for the length of
 * the effect, back up over 220 ms - computed from the frame, so the preview and
 * the render duck identically.
 */
export function duckingGainAt(
	timeMs: number,
	events: CaptionSoundEvent[],
	duck: number,
): number {
	if (duck <= 0 || events.length === 0) return 1
	const attackMs = 60
	const releaseMs = 220
	let deepest = 0

	for (const event of events) {
		const start = event.atMs - attackMs
		const end = event.atMs + event.durationMs + releaseMs
		if (timeMs < start || timeMs > end) continue
		const amount =
			timeMs < event.atMs
				? (timeMs - start) / attackMs
				: timeMs <= event.atMs + event.durationMs
					? 1
					: 1 - (timeMs - event.atMs - event.durationMs) / releaseMs
		if (amount > deepest) deepest = amount
	}

	return 1 - clamp(deepest, 0, 1) * clamp(duck, 0, 1)
}

/** One-line summary for the panel and for the generated file's header. */
export function describeSoundtrack(events: CaptionSoundEvent[], sound: CaptionSound): string {
	if (!sound.enabled) return 'off'
	if (events.length === 0) return 'no sounds scheduled'
	const unique = new Set(events.map((event) => event.src)).size
	return `${events.length} hit${events.length === 1 ? '' : 's'} from ${unique} take${
		unique === 1 ? '' : 's'
	} at ${Math.round(sound.volume * 100)}% volume`
}
