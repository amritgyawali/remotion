/**
 * The storyboard is the contract between the AI director and the Studio.
 *
 * The model never writes code - it returns this small JSON document, which is
 * then normalised (every enum clamped to a known value, every duration made to
 * fit the composition) and compiled into a Remotion TSX file by `compose.ts`.
 * Because the compiler input is generated locally, a generation can never fail
 * on a syntax error, a hallucinated import or a missing asset.
 */

import {
	FONT_IDS,
	GRAIN_IDS,
	MUSIC_IDS,
	PALETTE_IDS,
	isIconId,
	type FontId,
	type GrainId,
	type IconId,
	type LeakId,
	type MusicId,
	type PaletteId,
} from './kit'

export type AspectId = '16:9' | '9:16' | '1:1' | '4:5' | '21:9'

export const ASPECT_IDS: AspectId[] = ['16:9', '9:16', '1:1', '4:5', '21:9']

export const ASPECT_SIZES: Record<AspectId, { width: number; height: number }> = {
	'16:9': { width: 1920, height: 1080 },
	'9:16': { width: 1080, height: 1920 },
	'1:1': { width: 1080, height: 1080 },
	'4:5': { width: 1080, height: 1350 },
	'21:9': { width: 2048, height: 858 },
}

export type MotionId = 'calm' | 'balanced' | 'punchy'
export const MOTION_IDS: MotionId[] = ['calm', 'balanced', 'punchy']

export type TerrainId = 'mountain' | 'desert' | 'city' | 'forest' | 'ocean' | 'valley'
export const TERRAIN_IDS: TerrainId[] = ['mountain', 'desert', 'city', 'forest', 'ocean', 'valley']

export type StructureId = 'temple' | 'stupa' | 'tower' | 'arch' | 'monolith' | 'dome' | 'bridge'
export const STRUCTURE_IDS: StructureId[] = [
	'temple',
	'stupa',
	'tower',
	'arch',
	'monolith',
	'dome',
	'bridge',
]

export type TimeOfDayId = 'dawn' | 'day' | 'dusk' | 'night'
export const TIME_OF_DAY_IDS: TimeOfDayId[] = ['dawn', 'day', 'dusk', 'night']

export type SceneType =
	| 'title'
	| 'statement'
	| 'timeline'
	| 'map'
	| 'landscape'
	| 'monument'
	| 'gallery'
	| 'stats'
	| 'chart'
	| 'process'
	| 'quote'
	| 'cta'

export const SCENE_TYPES: SceneType[] = [
	'title',
	'statement',
	'timeline',
	'map',
	'landscape',
	'monument',
	'gallery',
	'stats',
	'chart',
	'process',
	'quote',
	'cta',
]

type Base = { seconds: number }

export type TitleScene = Base & {
	type: 'title'
	kicker: string
	headline: string
	subline: string
	icon: IconId
}

export type StatementScene = Base & {
	type: 'statement'
	text: string
	highlight: string
	footnote: string
}

export type TimelineEvent = { marker: string; title: string; detail: string }
export type TimelineScene = Base & {
	type: 'timeline'
	headline: string
	events: TimelineEvent[]
}

export type MapPlace = { name: string; detail: string; x: number; y: number }
export type MapScene = Base & {
	type: 'map'
	headline: string
	caption: string
	places: MapPlace[]
	connect: boolean
}

export type LandscapeScene = Base & {
	type: 'landscape'
	terrain: TerrainId
	timeOfDay: TimeOfDayId
	headline: string
	caption: string
}

export type MonumentScene = Base & {
	type: 'monument'
	structure: StructureId
	headline: string
	caption: string
}

export type GalleryItem = { title: string; detail: string; icon: IconId }
export type GalleryScene = Base & {
	type: 'gallery'
	headline: string
	items: GalleryItem[]
}

export type StatItem = { value: number; prefix: string; suffix: string; label: string; decimals: number }
export type StatsScene = Base & {
	type: 'stats'
	headline: string
	stats: StatItem[]
}

export type ChartBar = { label: string; value: number }
export type ChartScene = Base & {
	type: 'chart'
	headline: string
	unit: string
	bars: ChartBar[]
}

export type ProcessStep = { title: string; detail: string; icon: IconId }
export type ProcessScene = Base & {
	type: 'process'
	headline: string
	steps: ProcessStep[]
}

export type QuoteScene = Base & {
	type: 'quote'
	quote: string
	attribution: string
}

export type CtaScene = Base & {
	type: 'cta'
	headline: string
	subline: string
	tagline: string
	icon: IconId
}

export type Scene =
	| TitleScene
	| StatementScene
	| TimelineScene
	| MapScene
	| LandscapeScene
	| MonumentScene
	| GalleryScene
	| StatsScene
	| ChartScene
	| ProcessScene
	| QuoteScene
	| CtaScene

export type Storyboard = {
	title: string
	concept: string
	subject: string
	aspect: AspectId
	fps: number
	seconds: number
	palette: PaletteId
	displayFont: FontId
	textFont: FontId
	music: MusicId
	grain: GrainId
	leak: LeakId
	motion: MotionId
	scenes: Scene[]
}

export type SceneTiming = {
	scene: Scene
	durationInFrames: number
	/** Absolute start frame inside the composition, transitions accounted for. */
	from: number
	transitionOut: number
}

export type StoryboardLayout = {
	width: number
	height: number
	fps: number
	durationInFrames: number
	timings: SceneTiming[]
}

export const MIN_SECONDS = 4
export const MAX_SECONDS = 120
export const MAX_SCENES = 9

const MIN_SCENE_SECONDS = 1.6

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
	const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''))
	if (!Number.isFinite(parsed)) return fallback
	return Math.min(max, Math.max(min, parsed))
}

function pickEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
	if (typeof value !== 'string') return fallback
	const normalized = value.trim()
	const direct = allowed.find((item) => item.toLowerCase() === normalized.toLowerCase())
	return direct ?? fallback
}

function text(value: unknown, fallback: string, max = 220): string {
	if (typeof value !== 'string') return fallback
	const trimmed = value.replace(/\s+/g, ' ').trim()
	if (!trimmed) return fallback
	return trimmed.slice(0, max)
}

function icon(value: unknown, fallback: IconId): IconId {
	return isIconId(value) ? value : fallback
}

function list(value: unknown): unknown[] {
	return Array.isArray(value) ? value : []
}

function record(value: unknown): Record<string, unknown> {
	return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function normalizeScene(raw: unknown, subject: string): Scene | null {
	const source = record(raw)
	const type = pickEnum(source.type, SCENE_TYPES, 'statement')
	const seconds = clampNumber(source.seconds, MIN_SCENE_SECONDS, 30, 0)

	switch (type) {
		case 'title':
			return {
				type,
				seconds,
				kicker: text(source.kicker, subject, 60),
				headline: text(source.headline, subject, 90),
				subline: text(source.subline, '', 160),
				icon: icon(source.icon, 'spark'),
			}
		case 'statement':
			return {
				type,
				seconds,
				text: text(source.text ?? source.headline, subject, 180),
				highlight: text(source.highlight, '', 40),
				footnote: text(source.footnote, '', 120),
			}
		case 'timeline': {
			const events = list(source.events)
				.map((rawEvent) => {
					const event = record(rawEvent)
					const title = text(event.title ?? event.label, '', 70)
					if (!title) return null
					return {
						marker: text(event.marker ?? event.year ?? event.step, '', 18),
						title,
						detail: text(event.detail, '', 120),
					}
				})
				.filter((event): event is TimelineEvent => event !== null)
				.slice(0, 6)
			if (events.length < 2) return null
			return { type, seconds, headline: text(source.headline, '', 80), events }
		}
		case 'map': {
			const places = list(source.places ?? source.regions ?? source.locations)
				.map((rawPlace, placeIndex) => {
					const place = record(rawPlace)
					const name = text(place.name ?? place.label, '', 40)
					if (!name) return null
					const golden = (placeIndex * 0.61803398875) % 1
					return {
						name,
						detail: text(place.detail, '', 80),
						x: clampNumber(place.x, 0.08, 0.92, 0.2 + golden * 0.6),
						y: clampNumber(place.y, 0.1, 0.9, 0.25 + ((placeIndex * 0.37) % 1) * 0.5),
					}
				})
				.filter((place): place is MapPlace => place !== null)
				.slice(0, 6)
			if (places.length === 0) return null
			return {
				type,
				seconds,
				headline: text(source.headline, '', 80),
				caption: text(source.caption, '', 140),
				places,
				connect: source.connect !== false,
			}
		}
		case 'landscape':
			return {
				type,
				seconds,
				terrain: pickEnum(source.terrain, TERRAIN_IDS, 'mountain'),
				timeOfDay: pickEnum(source.timeOfDay ?? source.time, TIME_OF_DAY_IDS, 'dawn'),
				headline: text(source.headline, '', 80),
				caption: text(source.caption, '', 140),
			}
		case 'monument':
			return {
				type,
				seconds,
				structure: pickEnum(source.structure, STRUCTURE_IDS, 'temple'),
				headline: text(source.headline, '', 80),
				caption: text(source.caption, '', 140),
			}
		case 'gallery': {
			const items = list(source.items ?? source.cards)
				.map((rawItem, itemIndex) => {
					const item = record(rawItem)
					const title = text(item.title ?? item.label, '', 46)
					if (!title) return null
					const defaults: IconId[] = ['spark', 'layers', 'target', 'bolt', 'globe', 'check']
					return {
						title,
						detail: text(item.detail, '', 110),
						icon: icon(item.icon, defaults[itemIndex % defaults.length]),
					}
				})
				.filter((item): item is GalleryItem => item !== null)
				.slice(0, 6)
			if (items.length < 2) return null
			return { type, seconds, headline: text(source.headline, '', 80), items }
		}
		case 'stats': {
			const stats = list(source.stats ?? source.items)
				.map((rawStat) => {
					const stat = record(rawStat)
					const label = text(stat.label, '', 46)
					const value = clampNumber(stat.value, -1_000_000_000, 1_000_000_000, Number.NaN)
					if (!label || !Number.isFinite(value)) return null
					return {
						value,
						prefix: text(stat.prefix, '', 4),
						suffix: text(stat.suffix, '', 6),
						label,
						decimals: Math.round(clampNumber(stat.decimals, 0, 2, Number.isInteger(value) ? 0 : 1)),
					}
				})
				.filter((stat): stat is StatItem => stat !== null)
				.slice(0, 4)
			if (stats.length === 0) return null
			return { type, seconds, headline: text(source.headline, '', 80), stats }
		}
		case 'chart': {
			const bars = list(source.bars ?? source.data ?? source.series)
				.map((rawBar) => {
					const bar = record(rawBar)
					const label = text(bar.label, '', 24)
					const value = clampNumber(bar.value, 0, 1_000_000_000, Number.NaN)
					if (!label || !Number.isFinite(value)) return null
					return { label, value }
				})
				.filter((bar): bar is ChartBar => bar !== null)
				.slice(0, 7)
			if (bars.length < 2) return null
			return { type, seconds, headline: text(source.headline, '', 80), unit: text(source.unit, '', 10), bars }
		}
		case 'process': {
			const steps = list(source.steps ?? source.items)
				.map((rawStep, stepIndex) => {
					const step = record(rawStep)
					const title = text(step.title ?? step.label, '', 46)
					if (!title) return null
					const defaults: IconId[] = ['target', 'gear', 'layers', 'rocket', 'check']
					return {
						title,
						detail: text(step.detail, '', 110),
						icon: icon(step.icon, defaults[stepIndex % defaults.length]),
					}
				})
				.filter((step): step is ProcessStep => step !== null)
				.slice(0, 5)
			if (steps.length < 2) return null
			return { type, seconds, headline: text(source.headline, '', 80), steps }
		}
		case 'quote': {
			const quote = text(source.quote ?? source.text, '', 220)
			if (!quote) return null
			return { type, seconds, quote, attribution: text(source.attribution ?? source.author, '', 60) }
		}
		case 'cta':
			return {
				type,
				seconds,
				headline: text(source.headline, subject, 80),
				subline: text(source.subline, '', 120),
				tagline: text(source.tagline, '', 60),
				icon: icon(source.icon, 'arrow'),
			}
		default:
			return null
	}
}

/**
 * Turns whatever the model returned into a storyboard that is guaranteed to be
 * renderable. Anything missing or malformed falls back to the locally planned
 * storyboard, so a partial answer still produces a complete video.
 */
export function normalizeStoryboard(raw: unknown, fallback: Storyboard): Storyboard {
	const source = record(raw)
	const subject = text(source.subject ?? source.title, fallback.subject, 70)
	const scenes = list(source.scenes)
		.map((scene) => normalizeScene(scene, subject))
		.filter((scene): scene is Scene => scene !== null)

	return {
		title: text(source.title, fallback.title, 80),
		concept: text(source.concept ?? source.logline, fallback.concept, 240),
		subject,
		aspect: pickEnum(source.aspect ?? source.aspectRatio, ASPECT_IDS, fallback.aspect),
		fps: Math.round(clampNumber(source.fps, 24, 60, fallback.fps)),
		seconds: clampNumber(source.seconds ?? source.durationInSeconds, MIN_SECONDS, MAX_SECONDS, fallback.seconds),
		palette: pickEnum(source.palette, PALETTE_IDS, fallback.palette),
		displayFont: pickEnum(source.displayFont, FONT_IDS, fallback.displayFont),
		textFont: pickEnum(source.textFont, FONT_IDS, fallback.textFont),
		music: pickEnum(source.music, MUSIC_IDS, fallback.music),
		grain: pickEnum(source.grain, GRAIN_IDS, fallback.grain),
		leak: pickEnum(source.leak, ['warm', 'cool', 'none'] as LeakId[], fallback.leak),
		motion: pickEnum(source.motion, MOTION_IDS, fallback.motion),
		scenes: scenes.length > 0 ? scenes.slice(0, MAX_SCENES) : fallback.scenes,
	}
}

/** Keeps the number of scenes honest for the requested runtime. */
function fitScenes(scenes: Scene[], seconds: number): Scene[] {
	const capacity = Math.max(1, Math.min(MAX_SCENES, Math.floor(seconds / 2.1)))
	if (scenes.length <= capacity) return scenes
	if (capacity === 1) return [scenes[0]]

	const kept: Scene[] = [scenes[0]]
	const last = scenes[scenes.length - 1]
	const middle = scenes.slice(1, -1)
	const slots = capacity - 2
	if (slots > 0 && middle.length > 0) {
		const stride = middle.length / slots
		for (let index = 0; index < slots; index += 1) {
			kept.push(middle[Math.min(middle.length - 1, Math.round(index * stride))])
		}
	}
	kept.push(last)
	return kept.filter((scene, index, all) => all.indexOf(scene) === index)
}

/**
 * Converts scene weights into exact frame counts. TransitionSeries overlaps
 * neighbouring sequences, so the composition duration is
 * `sum(scenes) - sum(transitions)` and must be computed here, not guessed.
 */
export function layoutStoryboard(storyboard: Storyboard): StoryboardLayout {
	const { width, height } = ASPECT_SIZES[storyboard.aspect]
	const fps = storyboard.fps
	const scenes = fitScenes(storyboard.scenes, storyboard.seconds)
	const totalFrames = Math.max(fps * MIN_SECONDS, Math.round(storyboard.seconds * fps))

	const weights = scenes.map((scene) => (scene.seconds > 0 ? scene.seconds : defaultSceneSeconds(scene)))
	const weightSum = weights.reduce((total, weight) => total + weight, 0) || scenes.length
	const minFrames = Math.max(24, Math.round(fps * 1.2))

	const transitionBase = storyboard.motion === 'punchy' ? 0.24 : storyboard.motion === 'calm' ? 0.6 : 0.4
	const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)
	const transitionsFor = (values: number[]): number[] => {
		const list: number[] = []
		for (let index = 0; index < values.length - 1; index += 1) {
			const room = Math.floor(Math.min(values[index], values[index + 1]) / 3)
			list.push(Math.max(4, Math.min(Math.round(fps * transitionBase), room)))
		}
		return list
	}

	let frames = weights.map((weight) => Math.max(minFrames, Math.round((weight / weightSum) * totalFrames)))
	let transitions = transitionsFor(frames)

	/**
	 * Each transition overlaps two scenes, so the sequences have to be longer
	 * than the runtime by exactly the total overlap. Converge on the requested
	 * duration instead of silently delivering a shorter film.
	 */
	for (let pass = 0; pass < 6; pass += 1) {
		const delta = totalFrames - (sum(frames) - sum(transitions))
		if (delta === 0) break
		const current = sum(frames)
		frames = frames.map((value) => Math.max(minFrames, Math.round(value + (delta * value) / current)))
		transitions = transitionsFor(frames)
	}

	const residual = totalFrames - (sum(frames) - sum(transitions))
	if (residual !== 0) {
		const longest = frames.indexOf(Math.max(...frames))
		frames[longest] = Math.max(minFrames, frames[longest] + residual)
		transitions = transitionsFor(frames)
	}

	const timings: SceneTiming[] = []
	let cursor = 0
	for (const [index, scene] of scenes.entries()) {
		timings.push({
			scene,
			durationInFrames: frames[index],
			from: cursor,
			transitionOut: transitions[index] ?? 0,
		})
		cursor += frames[index] - (transitions[index] ?? 0)
	}

	const durationInFrames = sum(frames) - sum(transitions)

	return { width, height, fps, durationInFrames: Math.max(fps, durationInFrames), timings }
}

export function defaultSceneSeconds(scene: Scene): number {
	switch (scene.type) {
		case 'title':
			return 3.4
		case 'statement':
			return 3
		case 'timeline':
			return Math.max(4, scene.events.length * 1.5)
		case 'map':
			return Math.max(4, scene.places.length * 1.2)
		case 'landscape':
			return 4
		case 'monument':
			return 3.6
		case 'gallery':
			return Math.max(3.6, scene.items.length * 1.15)
		case 'stats':
			return Math.max(3.2, scene.stats.length * 1.3)
		case 'chart':
			return 4
		case 'process':
			return Math.max(3.6, scene.steps.length * 1.3)
		case 'quote':
			return 3.6
		case 'cta':
			return 3.2
		default:
			return 3
	}
}

export function storyboardSummary(storyboard: Storyboard, layout: StoryboardLayout): string {
	const seconds = (layout.durationInFrames / layout.fps).toFixed(1)
	const scenes = layout.timings.map((timing) => timing.scene.type).join(' → ')
	return `${storyboard.aspect} · ${seconds}s · ${layout.timings.length} scenes · ${scenes}`
}
