/**
 * The motion-graphics scene library.
 *
 * Fifty complete pieces of design, each one a different idea about how a frame
 * should move. They exist because art direction alone cannot stop two films
 * from feeling the same: a palette and a font change the surface, but if every
 * generation reaches for the same three compositions the viewer still sees one
 * video wearing different clothes.
 *
 * Every scene here takes the *same* props (see `MOTION_SHELL`), so the planner
 * can drop any of them into any narrative beat and the renderer derives what it
 * needs from whatever the brief actually supplied. That is what makes true
 * per-generation randomisation possible: the pool for a beat is dozens deep,
 * not one.
 */

import type { BeatRole } from './arcs'
import { DATA_SCENES } from './scenes/data'
import { FRAME_SCENES } from './scenes/frames'
import { MOTION_SHELL } from './scenes/shell'
import { STORY_SCENES } from './scenes/story'
import { STRUCTURE_SCENES } from './scenes/structure'
import { TYPE_SCENES } from './scenes/type'

export { MOTION_SHELL }

/** Every motion scene's emitted source, keyed by scene type. */
export const MOTION_SCENE_SOURCE = {
	...TYPE_SCENES,
	...STRUCTURE_SCENES,
	...FRAME_SCENES,
	...DATA_SCENES,
	...STORY_SCENES,
} as const

export type MotionSceneType = keyof typeof MOTION_SCENE_SOURCE

/**
 * What a scene is *for*.
 *
 * `roles` is the set of narrative beats the piece can carry honestly - a
 * countdown cannot be a quote, a bubble exchange cannot be a hero shot. `needs`
 * records what the renderer is built around, so the planner can prefer a scene
 * the brief can actually feed. `family` is used to keep one film from stacking
 * two pieces that share a visual language back to back.
 */
export type MotionSceneRecipe = {
	label: string
	component: string
	family: 'type' | 'structure' | 'frame' | 'data' | 'story'
	roles: readonly BeatRole[]
	needs: 'copy' | 'items' | 'numbers'
	/**
	 * How many distinct lines of copy the composition was drawn around.
	 *
	 * The renderers refuse to invent rows, so a five-band marquee handed one
	 * phrase renders one band. Rather than let that happen, the planner skips a
	 * piece the brief cannot fill.
	 */
	minLines?: number
	/** True when the piece is loud enough to open or close a film. */
	anchor?: boolean
}

export const MOTION_SCENE_KIT = {
	/* -- Typographic ------------------------------------------------------- */
	'kinetic-type': {
		label: 'Kinetic Typography',
		component: 'KineticTypeScene',
		family: 'type',
		roles: ['open', 'hook', 'thesis', 'turn', 'close'],
		needs: 'copy',
		anchor: true,
	},
	'word-swap': {
		label: 'Word Swap',
		component: 'WordSwapScene',
		family: 'type',
		roles: ['hook', 'thesis', 'list', 'turn'],
		needs: 'copy',
		minLines: 3,
	},
	'type-ladder': {
		label: 'Type Ladder',
		component: 'TypeLadderScene',
		family: 'type',
		roles: ['list', 'context', 'thesis', 'steps'],
		needs: 'copy',
		minLines: 2,
	},
	'mask-wipe': {
		label: 'Mask Wipe',
		component: 'MaskWipeScene',
		family: 'type',
		roles: ['open', 'hook', 'thesis', 'turn'],
		needs: 'copy',
		anchor: true,
		minLines: 2,
	},
	'glitch-title': {
		label: 'Signal Loss',
		component: 'GlitchTitleScene',
		family: 'type',
		roles: ['open', 'hook', 'turn'],
		needs: 'copy',
		anchor: true,
	},
	'neon-sign': {
		label: 'Neon Sign',
		component: 'NeonSignScene',
		family: 'type',
		roles: ['open', 'showcase', 'close'],
		needs: 'copy',
		anchor: true,
	},
	'stamp-impact': {
		label: 'Stamp Impact',
		component: 'StampImpactScene',
		family: 'type',
		roles: ['hook', 'thesis', 'turn', 'close'],
		needs: 'copy',
		anchor: true,
		minLines: 2,
	},
	'marquee-bands': {
		label: 'Marquee Bands',
		component: 'MarqueeBandsScene',
		family: 'type',
		roles: ['open', 'hook', 'list', 'close'],
		needs: 'copy',
		anchor: true,
		minLines: 2,
	},
	'ticker-strip': {
		label: 'Ticker Strip',
		component: 'TickerStripScene',
		family: 'type',
		roles: ['open', 'context', 'evidence', 'close'],
		needs: 'copy',
		minLines: 2,
	},
	'letter-grid': {
		label: 'Letter Grid',
		component: 'LetterGridScene',
		family: 'type',
		roles: ['open', 'hook', 'turn'],
		needs: 'copy',
		anchor: true,
		minLines: 1,
	},

	/* -- Structural -------------------------------------------------------- */
	'split-reveal': {
		label: 'Split Reveal',
		component: 'SplitRevealScene',
		family: 'structure',
		roles: ['open', 'turn', 'compare', 'close'],
		needs: 'copy',
		anchor: true,
	},
	'grid-mosaic': {
		label: 'Grid Mosaic',
		component: 'GridMosaicScene',
		family: 'structure',
		roles: ['open', 'context', 'turn', 'showcase'],
		needs: 'copy',
		anchor: true,
	},
	'card-stack': {
		label: 'Card Deck',
		component: 'CardStackScene',
		family: 'structure',
		roles: ['list', 'steps', 'showcase'],
		needs: 'items',
	},
	'iso-layers': {
		label: 'Isometric Stack',
		component: 'IsoLayersScene',
		family: 'structure',
		roles: ['steps', 'context', 'list', 'showcase'],
		needs: 'items',
	},
	'path-draw': {
		label: 'Drawn Line',
		component: 'PathDrawScene',
		family: 'structure',
		roles: ['context', 'showcase', 'steps', 'place'],
		needs: 'copy',
	},
	'particle-assemble': {
		label: 'Particle Assembly',
		component: 'ParticleAssembleScene',
		family: 'structure',
		roles: ['open', 'turn', 'showcase', 'close'],
		needs: 'copy',
		anchor: true,
	},
	'orbit-nodes': {
		label: 'Orbit',
		component: 'OrbitNodesScene',
		family: 'structure',
		roles: ['list', 'context', 'showcase'],
		needs: 'items',
	},
	'network-graph': {
		label: 'Network',
		component: 'NetworkGraphScene',
		family: 'structure',
		roles: ['context', 'list', 'place', 'evidence'],
		needs: 'items',
		minLines: 3,
	},
	'wave-form': {
		label: 'Waveform',
		component: 'WaveFormScene',
		family: 'structure',
		roles: ['open', 'hook', 'showcase', 'close'],
		needs: 'copy',
		anchor: true,
	},
	'liquid-blob': {
		label: 'Liquid Field',
		component: 'LiquidBlobScene',
		family: 'structure',
		roles: ['open', 'thesis', 'quote', 'close'],
		needs: 'copy',
		anchor: true,
	},

	/* -- Framed ------------------------------------------------------------ */
	'spotlight-reveal': {
		label: 'Spotlight',
		component: 'SpotlightRevealScene',
		family: 'frame',
		roles: ['open', 'turn', 'quote', 'showcase'],
		needs: 'copy',
		anchor: true,
		minLines: 1,
	},
	'film-strip': {
		label: 'Film Strip',
		component: 'FilmStripScene',
		family: 'frame',
		roles: ['list', 'time', 'showcase'],
		needs: 'copy',
		minLines: 2,
	},
	'chapter-slate': {
		label: 'Production Slate',
		component: 'ChapterSlateScene',
		family: 'frame',
		roles: ['open', 'context', 'time'],
		needs: 'copy',
		anchor: true,
	},
	'terminal-type': {
		label: 'Terminal',
		component: 'TerminalTypeScene',
		family: 'frame',
		roles: ['steps', 'evidence', 'context', 'list'],
		needs: 'copy',
		minLines: 4,
	},
	'browser-window': {
		label: 'Browser',
		component: 'BrowserWindowScene',
		family: 'frame',
		roles: ['showcase', 'list', 'steps'],
		needs: 'items',
	},
	'phone-scroll': {
		label: 'Handset Feed',
		component: 'PhoneScrollScene',
		family: 'frame',
		roles: ['showcase', 'list', 'evidence'],
		needs: 'items',
	},
	'device-grid': {
		label: 'Screen Wall',
		component: 'DeviceGridScene',
		family: 'frame',
		roles: ['list', 'showcase', 'compare'],
		needs: 'items',
	},
	'matrix-rain': {
		label: 'Glyph Rain',
		component: 'MatrixRainScene',
		family: 'frame',
		roles: ['open', 'hook', 'turn', 'context'],
		needs: 'copy',
		anchor: true,
	},
	'poster-collage': {
		label: 'Cut Paper',
		component: 'PosterCollageScene',
		family: 'frame',
		roles: ['open', 'list', 'showcase', 'close'],
		needs: 'copy',
		anchor: true,
		minLines: 2,
	},
	'parallax-strata': {
		label: 'Parallax Strata',
		component: 'ParallaxStrataScene',
		family: 'frame',
		roles: ['open', 'context', 'showcase', 'close'],
		needs: 'copy',
		anchor: true,
		minLines: 1,
	},

	/* -- Data-shaped ------------------------------------------------------- */
	'bar-race': {
		label: 'Ranked Race',
		component: 'BarRaceScene',
		family: 'data',
		roles: ['evidence', 'compare', 'list'],
		needs: 'numbers',
		minLines: 3,
	},
	'donut-breakdown': {
		label: 'Share Ring',
		component: 'DonutBreakdownScene',
		family: 'data',
		roles: ['evidence', 'compare', 'list'],
		needs: 'numbers',
		minLines: 3,
	},
	'progress-rings': {
		label: 'Progress Rings',
		component: 'ProgressRingsScene',
		family: 'data',
		roles: ['evidence', 'list', 'steps'],
		needs: 'numbers',
	},
	speedometer: {
		label: 'Gauge',
		component: 'SpeedometerScene',
		family: 'data',
		roles: ['evidence', 'turn', 'hook'],
		needs: 'numbers',
	},
	'funnel-steps': {
		label: 'Funnel',
		component: 'FunnelStepsScene',
		family: 'data',
		roles: ['steps', 'evidence', 'list'],
		needs: 'items',
	},
	'pyramid-tiers': {
		label: 'Tier Stack',
		component: 'PyramidTiersScene',
		family: 'data',
		roles: ['list', 'context', 'steps'],
		needs: 'items',
	},
	'venn-overlap': {
		label: 'Overlap',
		component: 'VennOverlapScene',
		family: 'data',
		roles: ['compare', 'thesis', 'turn'],
		needs: 'copy',
		minLines: 3,
	},
	'heat-grid': {
		label: 'Heat Field',
		component: 'HeatGridScene',
		family: 'data',
		roles: ['evidence', 'context', 'list'],
		needs: 'copy',
		minLines: 3,
	},
	'sankey-flow': {
		label: 'Flow Bands',
		component: 'SankeyFlowScene',
		family: 'data',
		roles: ['steps', 'context', 'evidence', 'compare'],
		needs: 'copy',
		minLines: 3,
	},
	'counter-burst': {
		label: 'Counter',
		component: 'CounterBurstScene',
		family: 'data',
		roles: ['evidence', 'hook', 'turn', 'close'],
		needs: 'numbers',
		anchor: true,
	},

	/* -- Narrative --------------------------------------------------------- */
	'versus-clash': {
		label: 'Clash',
		component: 'VersusClashScene',
		family: 'story',
		roles: ['compare', 'turn', 'hook'],
		needs: 'copy',
		anchor: true,
	},
	'comparison-slider': {
		label: 'Before and After',
		component: 'ComparisonSliderScene',
		family: 'story',
		roles: ['compare', 'turn'],
		needs: 'copy',
		anchor: true,
	},
	'checklist-tick': {
		label: 'Checklist',
		component: 'ChecklistTickScene',
		family: 'story',
		roles: ['list', 'steps', 'evidence'],
		needs: 'items',
	},
	'qa-bubbles': {
		label: 'Exchange',
		component: 'QaBubblesScene',
		family: 'story',
		roles: ['quote', 'context', 'list'],
		needs: 'copy',
		minLines: 3,
	},
	'price-tiers': {
		label: 'Tiers',
		component: 'PriceTiersScene',
		family: 'story',
		roles: ['compare', 'list', 'close'],
		needs: 'items',
	},
	'logo-wall': {
		label: 'Mark Wall',
		component: 'LogoWallScene',
		family: 'story',
		roles: ['list', 'evidence', 'showcase'],
		needs: 'items',
	},
	'countdown-clock': {
		label: 'Countdown',
		component: 'CountdownClockScene',
		family: 'story',
		roles: ['turn', 'close', 'hook'],
		needs: 'copy',
		anchor: true,
	},
	'calendar-flip': {
		label: 'Split Flap',
		component: 'CalendarFlipScene',
		family: 'story',
		roles: ['time', 'list', 'context'],
		needs: 'copy',
		minLines: 3,
	},
	'ribbon-banner': {
		label: 'Banner',
		component: 'RibbonBannerScene',
		family: 'story',
		roles: ['open', 'close', 'showcase'],
		needs: 'copy',
		anchor: true,
	},
	'zoom-punch': {
		label: 'Punch Through',
		component: 'ZoomPunchScene',
		family: 'story',
		roles: ['hook', 'turn', 'list', 'close'],
		needs: 'copy',
		anchor: true,
		minLines: 2,
	},
} as const satisfies Record<MotionSceneType, MotionSceneRecipe>

export const MOTION_SCENE_IDS = Object.keys(MOTION_SCENE_KIT) as MotionSceneType[]

/** The kit widened to its declared shape, so optional fields read cleanly. */
const KIT: Record<MotionSceneType, MotionSceneRecipe> = MOTION_SCENE_KIT

export function isMotionSceneType(value: unknown): value is MotionSceneType {
	return typeof value === 'string' && value in MOTION_SCENE_KIT
}

/** Component name emitted for each motion scene. */
export const MOTION_SCENE_COMPONENT = Object.fromEntries(
	MOTION_SCENE_IDS.map((id) => [id, KIT[id].component]),
) as Record<MotionSceneType, string>

/**
 * Motion scenes that can carry one narrative beat.
 *
 * The planner draws from this with the request seed, which is where the actual
 * variety comes from: `list` alone has more than a dozen honest answers, so two
 * films built from the same arc and the same brief still cut differently.
 */
export function motionScenesForRole(role: BeatRole): MotionSceneType[] {
	return MOTION_SCENE_IDS.filter((id) => KIT[id].roles.includes(role))
}

/** Motion scenes loud enough to open or close on. */
export function anchorMotionScenes(role: BeatRole): MotionSceneType[] {
	const pool = motionScenesForRole(role).filter((id) => KIT[id].anchor === true)
	return pool.length > 0 ? pool : motionScenesForRole(role)
}
