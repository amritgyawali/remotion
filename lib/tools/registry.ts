/**
 * The Tools Studio catalogue: what every card on the page is, what it needs,
 * and what runs when someone presses go.
 *
 * A tool is data, not a component. Fifty-odd bespoke panels would mean fifty
 * places a bug could hide and fifty places a design change has to be repeated;
 * instead every tool is a `ToolDef` - a category, a one-line pitch, a small
 * list of parameters - and one generic panel (`ToolPanel.tsx`) renders
 * whichever fields a given tool declares. The handful of real engines live in
 * `av-remux.ts`, `video-filter.ts` and `plan-ops.ts`; `runners.ts` is the only
 * place that knows how a `handler` id turns a tool's params into a call to
 * one of them.
 *
 * Every entry is honest about `status`. `ready` means the engine behind it is
 * implemented and tested by hand; `soon` means the idea is real and useful but
 * doesn't yet have code behind it - it renders as a card that says so, not as
 * a button that fails.
 */

import type { ComponentType, SVGProps } from 'react'
import { HSL_BANDS } from './adjust'
import { VOICE_PRESETS } from './audio-fx'
import { BLEND_MODES } from './blend'
import { BORDER_STYLES } from './border'
import { CANVAS_BACKDROPS } from './canvas-bg'
import { EFFECTS } from './effects'
import { INPAINT_MODES } from './inpaint'
import { MASK_SHAPES, MASK_TREATMENTS } from './mask'
import { MOTION_PRESETS } from './motion'
import { SPLIT_LAYOUTS } from './split-screen'
import { TEXT_ANIMATIONS, TEXT_STYLES } from './text-fx'
import { TRANSITIONS } from './transitions'
import {
	IconBolt,
	IconCaptions,
	IconClock,
	IconCopy,
	IconEye,
	IconFile,
	IconFilm,
	IconForward,
	IconGauge,
	IconGrid,
	IconHistory,
	IconLayers,
	IconLink,
	IconMerge,
	IconMic,
	IconPalette,
	IconPerson,
	IconPlus,
	IconScissors,
	IconSliders,
	IconSparkle,
	IconSun,
	IconTrash,
	IconType,
	IconVolume,
	IconVolumeOff,
	IconWand,
	IconWaveform,
	IconZoomIn,
	IconZoomOut,
} from '../../components/Icons'

export type IconComponent = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>

export type ToolCategory =
	| 'levels'
	| 'timing'
	| 'transform'
	| 'color'
	| 'effects'
	| 'motion'
	| 'compose'
	| 'text'
	| 'overlay'
	| 'export'
	| 'restore'
	| 'ai'

export const CATEGORIES: Array<{ id: ToolCategory; label: string; blurb: string }> = [
	{ id: 'ai', label: 'AI & background', blurb: 'Detect the person, swap what is behind them' },
	{ id: 'levels', label: 'Audio levels & channels', blurb: 'Fix, balance and shape the sound' },
	{ id: 'timing', label: 'Silence & timing', blurb: 'Trim, speed, loop and cut' },
	{ id: 'transform', label: 'Visual transform', blurb: 'Rotate, crop, resize, reframe' },
	{ id: 'color', label: 'Color & filters', blurb: 'Grade, correct, stylise, sharpen' },
	{ id: 'effects', label: 'Effects', blurb: 'Glitch, retro, distort, light and stylise' },
	{ id: 'motion', label: 'Motion & camera', blurb: 'Ken Burns pushes, pans, shakes and spins' },
	{ id: 'compose', label: 'Compose & layout', blurb: 'Blend, split screen, transitions, canvas' },
	{ id: 'text', label: 'Text & titles', blurb: 'Styled, timed and animated titles' },
	{ id: 'overlay', label: 'Overlays & branding', blurb: 'Watermarks, text, captions' },
	{ id: 'export', label: 'Export & format', blurb: 'Convert, compress, extract' },
	{ id: 'restore', label: 'Restoration', blurb: 'Clean-up and repair' },
]

export type ToolStatus = 'ready' | 'soon'

export type ParamSpec =
	| {
			type: 'slider'
			key: string
			label: string
			min: number
			max: number
			step: number
			default: number
			unit?: string
			hint?: string
			/** resolved at run time from the loaded source instead of a fixed `max` */
			maxFrom?: 'durationSeconds'
			/** resolved at run time instead of the fixed `default`, once a source is loaded */
			defaultFrom?: 'durationSeconds' | 'durationHalf'
	  }
	| { type: 'select'; key: string; label: string; options: Array<{ value: string; label: string }>; default: string; hint?: string }
	| { type: 'toggle'; key: string; label: string; default: boolean; hint?: string }
	| { type: 'text'; key: string; label: string; default: string; placeholder?: string; hint?: string }
	| { type: 'color'; key: string; label: string; default: string; hint?: string }
	/**
	 * A colour look, chosen from the library in `color-tone.ts`.
	 *
	 * It gets a spec of its own rather than being a `select` with eighty
	 * options because nobody can pick a grade from a dropdown of names - the
	 * field renders a gallery of live thumbnails made from the loaded clip's
	 * own first frames, which is the only way the choice is a real one.
	 */
	| { type: 'tone'; key: string; label: string; default: string; hint?: string }

export type SecondaryFileSpec = { key: string; label: string; accept: string; hint: string; kind: 'image' | 'audio' | 'video' | 'media' | 'data' }

export type HandlerId =
	| 'mono-stereo'
	| 'stereo-mono'
	| 'swap-channels'
	| 'gain'
	| 'normalize'
	| 'fade'
	| 'mute-audio'
	| 'reverse-audio'
	| 'audio-delay'
	| 'noise-gate'
	| 'replace-audio'
	| 'extract-audio'
	| 'metadata-edit'
	| 'trim'
	| 'speed'
	| 'loop'
	| 'split'
	| 'rotate'
	| 'flip'
	| 'crop'
	| 'aspect-crop'
	| 'resize'
	| 'framerate'
	| 'color-grade'
	| 'grayscale'
	| 'sepia'
	| 'invert'
	| 'blur'
	| 'sharpen'
	| 'vignette'
	| 'watermark'
	| 'text-overlay'
	| 'format-convert'
	| 'compress'
	| 'thumbnail'
	| 'freeze-frame'
	| 'speed-ramp'
	| 'merge-clips'
	| 'chroma-key'
	| 'auto-color'
	| 'picture-in-picture'
	| 'export-gif'
	| 'batch-export'
	| 'declick'
	| 'spectral-denoise'
	| 'stabilize'
	| 'autocrop-bars'
	| 'scene-split'
	| 'music-ducking'
	| 'bass-boost'
	| 'treble-boost'
	| 'stereo-widen'
	| 'compressor'
	| 'limiter'
	| 'de-ess'
	| 'lufs-normalize'
	| 'pitch-shift'
	| 'letterbox-pad'
	| 'background-replace'
	| 'color-tone'
	| 'chroma-overlay'
	| 'adjust'
	| 'video-effect'
	| 'camera-motion'
	| 'shape-mask'
	| 'blend-overlay'
	| 'canvas-background'
	| 'border-frame'
	| 'animated-text'
	| 'remove-object'
	| 'retouch'
	| 'enhance'
	| 'lut-import'
	| 'auto-reframe'
	| 'reverse-video'
	| 'transition'
	| 'split-screen'
	| 'reverb'
	| 'echo'
	| 'equalizer'
	| 'voice-changer'
	| 'beat-detect'

export type ToolDef = {
	id: string
	name: string
	short: string
	category: ToolCategory
	status: ToolStatus
	icon: IconComponent
	handler?: HandlerId
	link?: { href: string; label: string }
	params?: ParamSpec[]
	secondaryFile?: SecondaryFileSpec
	/** tools that operate over an open-ended batch of files instead of the one loaded clip */
	multiFile?: { label: string; accept: string; hint: string }
	outputKind: 'video' | 'audio' | 'image' | 'file'
	/** why it's fast: shown as a small badge when the tool never re-encodes the picture */
	losslessVideo?: boolean
	/**
	 * Offers a single-frame preview before the whole clip is rendered.
	 *
	 * Only worth it for tools whose result cannot be guessed from the sliders -
	 * a background swap or a film look have to be seen - and only possible for
	 * tools whose engine is per-frame, so one frame really is representative.
	 */
	preview?: boolean
	/** shown above the parameters when a tool needs a word of warning or setup */
	note?: string
}

const ASPECT_OPTIONS = [
	{ value: '9:16', label: '9:16 vertical' },
	{ value: '1:1', label: '1:1 square' },
	{ value: '4:5', label: '4:5 portrait' },
	{ value: '16:9', label: '16:9 widescreen' },
	{ value: '4:3', label: '4:3 classic' },
]

const POSITION_OPTIONS = [
	{ value: 'top-left', label: 'Top left' },
	{ value: 'top-right', label: 'Top right' },
	{ value: 'bottom-left', label: 'Bottom left' },
	{ value: 'bottom-right', label: 'Bottom right' },
	{ value: 'bottom-center', label: 'Bottom center' },
	{ value: 'center', label: 'Center' },
]

/* --------------------------------------------------------------------------
   Option lists derived from the engines themselves.

   Every one of these is built from the array the engine already exports, so a
   look, a transition or a layout can never appear in the picker without an
   implementation behind it - and can never be implemented and then silently
   left out of the UI. The one place a new effect has to be added is the
   catalogue in `effects.ts`.
   -------------------------------------------------------------------------- */

const EFFECT_OPTIONS = EFFECTS.map((effect) => ({ value: effect.id, label: effect.label }))
const MOTION_OPTIONS = MOTION_PRESETS.map((preset) => ({ value: preset.id, label: preset.label }))
const TRANSITION_OPTIONS = TRANSITIONS.map((entry) => ({ value: entry.id, label: entry.label }))
const BLEND_OPTIONS = BLEND_MODES.map((mode) => ({ value: mode.id, label: mode.label }))
const MASK_SHAPE_OPTIONS = MASK_SHAPES.map((shape) => ({ value: shape.id, label: shape.label }))
const MASK_TREATMENT_OPTIONS = MASK_TREATMENTS.map((treatment) => ({ value: treatment.id, label: treatment.label }))
const TEXT_STYLE_OPTIONS = TEXT_STYLES.map((style) => ({ value: style.id, label: style.label }))
const TEXT_ANIMATION_OPTIONS = TEXT_ANIMATIONS.map((animation) => ({ value: animation.id, label: animation.label }))
const HSL_BAND_OPTIONS = HSL_BANDS.map((band) => ({ value: band.id, label: band.label }))
const VOICE_OPTIONS = VOICE_PRESETS.map((preset) => ({ value: preset.id, label: preset.label }))
const INPAINT_OPTIONS = INPAINT_MODES.map((mode) => ({ value: mode.id, label: mode.label }))
const BORDER_OPTIONS = BORDER_STYLES.map((style) => ({ value: style.id, label: style.label }))
const CANVAS_BACKDROP_OPTIONS = CANVAS_BACKDROPS.map((backdrop) => ({ value: backdrop.id, label: backdrop.label }))
const SPLIT_LAYOUT_OPTIONS = SPLIT_LAYOUTS.map((layout) => ({ value: layout.id, label: `${layout.label} (${layout.panels} clips)` }))

const EASING_OPTIONS = [
	{ value: 'ease-in-out', label: 'Ease in and out' },
	{ value: 'ease-out', label: 'Ease out' },
	{ value: 'ease-in', label: 'Ease in' },
	{ value: 'linear', label: 'Linear' },
]

const OVERLAY_FIT_OPTIONS = [
	{ value: 'cover', label: 'Fill the frame (crop)' },
	{ value: 'contain', label: 'Fit inside (letterbox)' },
	{ value: 'stretch', label: 'Stretch to fit' },
]

const OVERLAY_PLACEMENT_OPTIONS = [{ value: 'fill', label: 'Across the whole frame' }, ...POSITION_OPTIONS]

/**
 * The effects that get a card of their own.
 *
 * Everything in `effects.ts` is reachable through the one "Video Effects"
 * tool, but the dozen people actually search for by name should be findable
 * by that name - so each of these becomes a tool whose effect is fixed and
 * whose only control is how strong it is. The definition is generated rather
 * than written out fourteen times, because the only thing that differs
 * between them is the id.
 */
const FEATURED_EFFECTS = [
	'glitch',
	'vhs',
	'old-film',
	'pixelate',
	'halftone',
	'sketch',
	'neon',
	'thermal',
	'night-vision',
	'kaleidoscope',
	'zoom-blur',
	'bloom',
	'dream',
	'light-leak',
] as const

function featuredEffectTools(): ToolDef[] {
	return FEATURED_EFFECTS.flatMap((id) => {
		const effect = EFFECTS.find((entry) => entry.id === id)
		if (!effect) return []
		const params: ParamSpec[] = [
			// A single-option select rather than a hidden constant: the runner
			// reads the effect out of the params like any other tool, so these
			// cards and the full picker share one code path.
			{ type: 'select', key: 'effect', label: 'Effect', default: effect.id, options: [{ value: effect.id, label: effect.label }] },
			{ type: 'slider', key: 'intensity', label: 'Intensity', min: 0, max: 100, step: 1, default: effect.defaultIntensity, unit: '%' },
		]
		if (effect.animated) {
			params.push({ type: 'slider', key: 'speed', label: 'Speed', min: 0.1, max: 4, step: 0.1, default: 1, unit: 'x' })
		}
		if (effect.usesAngle) {
			params.push({ type: 'slider', key: 'angle', label: 'Angle', min: 0, max: 360, step: 1, default: 0, unit: '°' })
		}
		if (effect.usesColors) {
			params.push({ type: 'color', key: 'colorA', label: 'First colour', default: '#ff2d95' })
			params.push({ type: 'color', key: 'colorB', label: 'Second colour', default: '#22d3ee' })
		}
		return [
			{
				id: `effect-${effect.id}`,
				name: effect.label,
				short: effect.blurb,
				category: 'effects' as ToolCategory,
				status: 'ready' as ToolStatus,
				icon: IconSparkle,
				handler: 'video-effect' as HandlerId,
				outputKind: 'video' as const,
				preview: true,
				params,
			},
		]
	})
}

export const TOOLS: ToolDef[] = [
	/* --------------------------------------------------------- ai & background */
	{
		id: 'background-replace',
		name: 'AI Background Replace',
		short: 'Finds the person in every frame and puts a photo, a video, a colour or a blur behind them.',
		category: 'ai',
		status: 'ready',
		icon: IconPerson,
		handler: 'background-replace',
		outputKind: 'video',
		preview: true,
		note: 'The person-detection model is downloaded once, then kept in this browser. Nothing is uploaded - the model comes to the video, not the other way round.',
		secondaryFile: {
			key: 'plate',
			label: 'Background photo or video',
			accept: 'image/*,video/*',
			hint: 'Only used by the "Photo or video" mode. A still is fastest; a clip loops if it is shorter than yours.',
			kind: 'media',
		},
		params: [
			{
				type: 'select',
				key: 'mode',
				label: 'What goes behind the person',
				default: 'upload',
				options: [
					{ value: 'upload', label: 'Photo or video I choose' },
					{ value: 'blur', label: 'Blur the real background' },
					{ value: 'color', label: 'A solid colour' },
				],
			},
			{ type: 'color', key: 'color', label: 'Colour', default: '#0b0f1a', hint: 'Used by the solid-colour mode. Pick a green here to key it again later.' },
			{
				type: 'select',
				key: 'fit',
				label: 'How the background fills the frame',
				default: 'cover',
				options: [
					{ value: 'cover', label: 'Fill the frame (crop)' },
					{ value: 'contain', label: 'Fit inside (bars)' },
					{ value: 'stretch', label: 'Stretch to fit' },
				],
			},
			{ type: 'slider', key: 'blur', label: 'Background blur', min: 1, max: 12, step: 0.5, default: 4, unit: '%', hint: 'Used by the blur mode. Higher is a shallower, more portrait-like depth of field.' },
			{
				type: 'select',
				key: 'model',
				label: 'Detection quality',
				default: 'balanced',
				options: [
					{ value: 'balanced', label: 'Balanced - 0.25 MB, fast' },
					{ value: 'precise', label: 'Precise - 16 MB, better hair' },
				],
				hint: 'Precise is a six-class model and holds on to hair, hands and loose clothing far better.',
			},
			{ type: 'slider', key: 'feather', label: 'Edge softness', min: 0, max: 40, step: 1, default: 10, unit: '%' },
			{ type: 'slider', key: 'matte', label: 'Edge sharpness', min: 0, max: 100, step: 1, default: 55, unit: '%', hint: 'Higher makes the cut-out decisive; lower leaves a gentler, more forgiving edge.' },
			{ type: 'slider', key: 'edgeShift', label: 'Grow / shrink the cut-out', min: -50, max: 50, step: 1, default: 0, unit: '%', hint: 'Push it negative if a rim of the old room survives, positive if the subject is being shaved into.' },
			{ type: 'slider', key: 'edgeClean', label: 'Fringe clean-up', min: 0, max: 100, step: 1, default: 35, unit: '%', hint: 'Neutralises the colour the old backdrop left along the outline.' },
			{ type: 'slider', key: 'lightWrap', label: 'Light wrap', min: 0, max: 100, step: 1, default: 25, unit: '%', hint: 'Lets the new background spill light around the subject, the way a real one would.' },
			{ type: 'slider', key: 'smoothing', label: 'Steadiness', min: 0, max: 95, step: 5, default: 60, unit: '%', hint: 'Blends each frame’s cut-out with the last, which is what stops the outline shimmering.' },
			{ type: 'toggle', key: 'showMatte', label: 'Show the cut-out instead', default: false, hint: 'White is kept, black is replaced. The fastest way to judge the edge settings.' },
		],
	},

	/* ------------------------------------------------------- audio levels */
	{
		id: 'mono-to-stereo',
		name: 'Mono to Stereo',
		short: 'Fix audio that only plays out of one side by mirroring it to both channels.',
		category: 'levels',
		status: 'ready',
		icon: IconVolume,
		handler: 'mono-stereo',
		outputKind: 'video',
		losslessVideo: true,
		params: [
			{
				type: 'select',
				key: 'source',
				label: 'Which side has the sound',
				default: 'auto',
				options: [
					{ value: 'auto', label: 'Detect automatically' },
					{ value: 'left', label: 'Force from left' },
					{ value: 'right', label: 'Force from right' },
					{ value: 'mix', label: 'Mix both, then duplicate' },
				],
				hint: 'Auto measures both channels and copies whichever one actually has sound. Override it if a quiet track is detected wrong.',
			},
		],
	},
	{
		id: 'stereo-to-mono',
		name: 'Stereo to Mono',
		short: 'Sum both channels down to one - useful before uploading somewhere that folds stereo badly.',
		category: 'levels',
		status: 'ready',
		icon: IconVolume,
		handler: 'stereo-mono',
		outputKind: 'video',
		losslessVideo: true,
	},
	{
		id: 'swap-channels',
		name: 'Swap Left/Right',
		short: 'Flips the two channels - fixes a clip that was captured out of phase.',
		category: 'levels',
		status: 'ready',
		icon: IconWaveform,
		handler: 'swap-channels',
		outputKind: 'video',
		losslessVideo: true,
	},
	{
		id: 'volume-gain',
		name: 'Volume / Gain',
		short: 'Turn the whole track up or down by an exact amount.',
		category: 'levels',
		status: 'ready',
		icon: IconVolume,
		handler: 'gain',
		outputKind: 'video',
		losslessVideo: true,
		params: [
			{ type: 'slider', key: 'db', label: 'Gain', min: -24, max: 24, step: 0.5, default: 6, unit: 'dB' },
		],
	},
	{
		id: 'normalize-audio',
		name: 'Normalize Loudness',
		short: 'Raises the track so its loudest moment sits just under clipping.',
		category: 'levels',
		status: 'ready',
		icon: IconGauge,
		handler: 'normalize',
		outputKind: 'video',
		losslessVideo: true,
		params: [
			{ type: 'slider', key: 'targetDb', label: 'Target peak', min: -12, max: 0, step: 0.5, default: -1, unit: 'dB' },
		],
	},
	{
		id: 'fade-audio',
		name: 'Fade In / Out',
		short: 'Ease the sound in at the start and out at the end.',
		category: 'levels',
		status: 'ready',
		icon: IconSliders,
		handler: 'fade',
		outputKind: 'video',
		losslessVideo: true,
		params: [
			{ type: 'slider', key: 'inMs', label: 'Fade in', min: 0, max: 5000, step: 50, default: 800, unit: 'ms' },
			{ type: 'slider', key: 'outMs', label: 'Fade out', min: 0, max: 5000, step: 50, default: 800, unit: 'ms' },
		],
	},
	{
		id: 'mute-audio',
		name: 'Mute Audio',
		short: 'Strips the sound entirely - the picture is untouched.',
		category: 'levels',
		status: 'ready',
		icon: IconVolumeOff,
		handler: 'mute-audio',
		outputKind: 'video',
		losslessVideo: true,
	},
	{
		id: 'reverse-audio',
		name: 'Reverse Audio',
		short: 'Plays the track backwards - an effect, not a correction.',
		category: 'levels',
		status: 'ready',
		icon: IconForward,
		handler: 'reverse-audio',
		outputKind: 'video',
		losslessVideo: true,
	},
	{
		id: 'audio-delay',
		name: 'Audio Sync Offset',
		short: 'Nudges the sound earlier or later to fix drift against the picture.',
		category: 'levels',
		status: 'ready',
		icon: IconClock,
		handler: 'audio-delay',
		outputKind: 'video',
		losslessVideo: true,
		params: [
			{ type: 'slider', key: 'ms', label: 'Shift', min: -2000, max: 2000, step: 10, default: 0, unit: 'ms' },
		],
	},
	{
		id: 'noise-gate',
		name: 'Noise Gate',
		short: 'Quiets steady hiss and room noise sitting under real silence.',
		category: 'restore',
		status: 'ready',
		icon: IconWand,
		handler: 'noise-gate',
		outputKind: 'video',
		losslessVideo: true,
		params: [
			{ type: 'slider', key: 'thresholdDb', label: 'Threshold', min: -60, max: -10, step: 1, default: -38, unit: 'dB' },
			{ type: 'slider', key: 'attackMs', label: 'Attack', min: 1, max: 100, step: 1, default: 8, unit: 'ms' },
			{ type: 'slider', key: 'releaseMs', label: 'Release', min: 20, max: 600, step: 10, default: 180, unit: 'ms' },
		],
	},
	{
		id: 'replace-audio',
		name: 'Replace Audio Track',
		short: 'Swaps the sound for a different file - a voiceover, a music bed - and keeps the picture.',
		category: 'levels',
		status: 'ready',
		icon: IconMerge,
		handler: 'replace-audio',
		outputKind: 'video',
		losslessVideo: true,
		secondaryFile: { key: 'audio', label: 'New audio track', accept: 'audio/*,video/*', hint: 'An audio or video file - only its sound is used.', kind: 'audio' },
		params: [{ type: 'slider', key: 'db', label: 'Gain on the new track', min: -24, max: 24, step: 0.5, default: 0, unit: 'dB' }],
	},
	{
		id: 'extract-audio',
		name: 'Extract Audio',
		short: 'Saves just the sound - a WAV or a compact Opus file, no video.',
		category: 'export',
		status: 'ready',
		icon: IconMic,
		handler: 'extract-audio',
		outputKind: 'audio',
		params: [
			{
				type: 'select',
				key: 'format',
				label: 'Format',
				default: 'wav',
				options: [
					{ value: 'wav', label: 'WAV (lossless)' },
					{ value: 'webm', label: 'Opus / WebM (small)' },
				],
			},
		],
	},

	/* --------------------------------------------------------- timing */
	{
		id: 'cut-silence',
		name: 'Cut Silence Automatically',
		short: 'Finds every pause and removes it - opens the full Silence Studio.',
		category: 'timing',
		status: 'ready',
		icon: IconScissors,
		link: { href: '/silence', label: 'Open Silence Studio' },
		outputKind: 'video',
	},
	{
		id: 'fast-forward-silence',
		name: 'Fast-Forward Silence',
		short: "Keeps every pause but runs it at speed instead of deleting it - same studio, don't-cut mode.",
		category: 'timing',
		status: 'ready',
		icon: IconBolt,
		link: { href: '/silence', label: 'Open Silence Studio' },
		outputKind: 'video',
	},
	{
		id: 'trim-clip',
		name: 'Trim / Cut Range',
		short: 'Keep only the stretch between two times; everything outside it is dropped.',
		category: 'timing',
		status: 'ready',
		icon: IconScissors,
		handler: 'trim',
		outputKind: 'video',
		params: [
			{ type: 'slider', key: 'startSec', label: 'Start', min: 0, max: 0, step: 0.1, default: 0, unit: 's', maxFrom: 'durationSeconds' },
			{ type: 'slider', key: 'endSec', label: 'End', min: 0, max: 0, step: 0.1, default: 0, unit: 's', maxFrom: 'durationSeconds', defaultFrom: 'durationSeconds' },
		],
	},
	{
		id: 'split-clip',
		name: 'Split at a Point',
		short: 'Cuts one clip into two files at the time you pick.',
		category: 'timing',
		status: 'ready',
		icon: IconScissors,
		handler: 'split',
		outputKind: 'video',
		params: [{ type: 'slider', key: 'atSec', label: 'Split at', min: 0, max: 0, step: 0.1, default: 0, unit: 's', maxFrom: 'durationSeconds', defaultFrom: 'durationHalf' }],
	},
	{
		id: 'speed-change',
		name: 'Speed Change',
		short: 'Plays the whole clip faster or slower, audio included.',
		category: 'timing',
		status: 'ready',
		icon: IconGauge,
		handler: 'speed',
		outputKind: 'video',
		params: [{ type: 'slider', key: 'factor', label: 'Speed', min: 0.25, max: 4, step: 0.05, default: 1.5, unit: 'x' }],
	},
	{
		id: 'slow-motion',
		name: 'Slow Motion',
		short: 'A gentler speed preset for a slow-motion look.',
		category: 'timing',
		status: 'ready',
		icon: IconClock,
		handler: 'speed',
		outputKind: 'video',
		params: [{ type: 'slider', key: 'factor', label: 'Speed', min: 0.1, max: 0.75, step: 0.05, default: 0.5, unit: 'x' }],
	},
	{
		id: 'time-lapse',
		name: 'Time-Lapse',
		short: 'A steep speed preset for a time-lapse look.',
		category: 'timing',
		status: 'ready',
		icon: IconForward,
		handler: 'speed',
		outputKind: 'video',
		params: [{ type: 'slider', key: 'factor', label: 'Speed', min: 2, max: 30, step: 1, default: 8, unit: 'x' }],
	},
	{
		id: 'loop-clip',
		name: 'Loop / Repeat',
		short: 'Plays the clip back to back, as many times as you like.',
		category: 'timing',
		status: 'ready',
		icon: IconCopy,
		handler: 'loop',
		outputKind: 'video',
		params: [{ type: 'slider', key: 'times', label: 'Repeats', min: 2, max: 20, step: 1, default: 3, unit: 'x' }],
	},
	{
		id: 'freeze-frame',
		name: 'Freeze Frame Insert',
		short: 'Holds one moment still for a beat, then continues.',
		category: 'timing',
		status: 'ready',
		icon: IconClock,
		handler: 'freeze-frame',
		outputKind: 'video',
		params: [
			{ type: 'slider', key: 'atSec', label: 'Freeze at', min: 0, max: 0, step: 0.1, default: 0, unit: 's', maxFrom: 'durationSeconds', defaultFrom: 'durationHalf' },
			{ type: 'slider', key: 'holdMs', label: 'Hold for', min: 200, max: 5000, step: 100, default: 1500, unit: 'ms' },
		],
	},
	{
		id: 'speed-ramp',
		name: 'Speed Ramp',
		short: 'A speed curve that eases between three points instead of one flat rate.',
		category: 'timing',
		status: 'ready',
		icon: IconGauge,
		handler: 'speed-ramp',
		outputKind: 'video',
		params: [
			{ type: 'slider', key: 'startFactor', label: 'Start speed', min: 0.25, max: 4, step: 0.05, default: 1, unit: 'x' },
			{ type: 'slider', key: 'midFactor', label: 'Middle speed', min: 0.25, max: 4, step: 0.05, default: 2.5, unit: 'x' },
			{ type: 'slider', key: 'endFactor', label: 'End speed', min: 0.25, max: 4, step: 0.05, default: 1, unit: 'x' },
		],
	},

	/* ------------------------------------------------------- transform */
	{ id: 'rotate-cw', name: 'Rotate 90° Clockwise', short: 'Turns the picture a quarter turn right.', category: 'transform', status: 'ready', icon: IconZoomIn, handler: 'rotate', outputKind: 'video', params: [{ type: 'select', key: 'deg', label: 'Angle', default: '90', options: [{ value: '90', label: '90°' }] }] },
	{ id: 'rotate-ccw', name: 'Rotate 90° Counter-clockwise', short: 'Turns the picture a quarter turn left.', category: 'transform', status: 'ready', icon: IconZoomIn, handler: 'rotate', outputKind: 'video', params: [{ type: 'select', key: 'deg', label: 'Angle', default: '270', options: [{ value: '270', label: '270°' }] }] },
	{ id: 'rotate-180', name: 'Rotate 180°', short: 'Turns the picture upside down.', category: 'transform', status: 'ready', icon: IconZoomIn, handler: 'rotate', outputKind: 'video', params: [{ type: 'select', key: 'deg', label: 'Angle', default: '180', options: [{ value: '180', label: '180°' }] }] },
	{ id: 'flip-horizontal', name: 'Flip Horizontal', short: 'Mirrors the picture left to right.', category: 'transform', status: 'ready', icon: IconLayers, handler: 'flip', outputKind: 'video', params: [{ type: 'toggle', key: 'flipH', label: 'Flip horizontal', default: true }] },
	{ id: 'flip-vertical', name: 'Flip Vertical', short: 'Mirrors the picture top to bottom.', category: 'transform', status: 'ready', icon: IconLayers, handler: 'flip', outputKind: 'video', params: [{ type: 'toggle', key: 'flipV', label: 'Flip vertical', default: true }] },
	{
		id: 'crop-video',
		name: 'Crop',
		short: 'Cuts the frame down to a region you set, as a percentage of the picture.',
		category: 'transform',
		status: 'ready',
		icon: IconZoomIn,
		handler: 'crop',
		outputKind: 'video',
		params: [
			{ type: 'slider', key: 'left', label: 'Left', min: 0, max: 45, step: 1, default: 0, unit: '%' },
			{ type: 'slider', key: 'top', label: 'Top', min: 0, max: 45, step: 1, default: 0, unit: '%' },
			{ type: 'slider', key: 'right', label: 'Right', min: 0, max: 45, step: 1, default: 0, unit: '%' },
			{ type: 'slider', key: 'bottom', label: 'Bottom', min: 0, max: 45, step: 1, default: 0, unit: '%' },
		],
	},
	{
		id: 'aspect-crop',
		name: 'Aspect Ratio Crop',
		short: 'Centre-crops to a standard ratio - vertical for Shorts, square for a feed post.',
		category: 'transform',
		status: 'ready',
		icon: IconLayers,
		handler: 'aspect-crop',
		outputKind: 'video',
		params: [{ type: 'select', key: 'aspect', label: 'Ratio', default: '9:16', options: ASPECT_OPTIONS }],
	},
	{
		id: 'resize-video',
		name: 'Resize / Scale',
		short: 'Changes the pixel dimensions - upscale or downscale, any target size.',
		category: 'transform',
		status: 'ready',
		icon: IconZoomIn,
		handler: 'resize',
		outputKind: 'video',
		params: [
			{ type: 'slider', key: 'width', label: 'Width', min: 120, max: 3840, step: 2, default: 1280, unit: 'px', hint: 'The height follows automatically, keeping the source aspect ratio.' },
		],
	},
	{
		id: 'change-framerate',
		name: 'Change Frame Rate',
		short: 'Re-samples the clip to a different frame rate without changing its speed.',
		category: 'transform',
		status: 'ready',
		icon: IconGauge,
		handler: 'framerate',
		outputKind: 'video',
		params: [{ type: 'select', key: 'fps', label: 'Frame rate', default: '30', options: [24, 25, 30, 50, 60].map((f) => ({ value: String(f), label: `${f} fps` })) }],
	},
	{
		id: 'merge-clips',
		name: 'Merge / Concatenate',
		short: 'Joins a second clip on after this one, letterboxed to match if the sizes differ.',
		category: 'transform',
		status: 'ready',
		icon: IconMerge,
		handler: 'merge-clips',
		outputKind: 'video',
		secondaryFile: { key: 'second', label: 'Clip to add after', accept: 'video/*', hint: 'Joined on immediately after this clip ends.', kind: 'video' },
	},
	{
		id: 'letterbox-pad',
		name: 'Letterbox / Pad to Ratio',
		short: 'Fits the whole frame inside a new ratio with bars, instead of cropping into it.',
		category: 'transform',
		status: 'ready',
		icon: IconLayers,
		handler: 'letterbox-pad',
		outputKind: 'video',
		params: [
			{ type: 'select', key: 'aspect', label: 'Target ratio', default: '9:16', options: ASPECT_OPTIONS },
			{ type: 'color', key: 'padColor', label: 'Bar colour', default: '#000000' },
		],
	},

	/* ------------------------------------------------------------ color */
	{
		id: 'color-grade',
		name: 'Color Grade',
		short: 'Brightness, contrast and saturation in one panel.',
		category: 'color',
		status: 'ready',
		icon: IconSun,
		handler: 'color-grade',
		outputKind: 'video',
		params: [
			{ type: 'slider', key: 'brightness', label: 'Brightness', min: 0.4, max: 1.8, step: 0.02, default: 1 },
			{ type: 'slider', key: 'contrast', label: 'Contrast', min: 0.4, max: 1.8, step: 0.02, default: 1 },
			{ type: 'slider', key: 'saturation', label: 'Saturation', min: 0, max: 2.2, step: 0.02, default: 1 },
		],
	},
	{ id: 'grayscale', name: 'Grayscale', short: 'One-click black and white.', category: 'color', status: 'ready', icon: IconSun, handler: 'grayscale', outputKind: 'video' },
	{ id: 'sepia', name: 'Sepia Tone', short: 'A warm, vintage-photo tint.', category: 'color', status: 'ready', icon: IconSun, handler: 'sepia', outputKind: 'video' },
	{ id: 'invert-colors', name: 'Invert Colors', short: 'Flips every colour to its negative.', category: 'color', status: 'ready', icon: IconSun, handler: 'invert', outputKind: 'video' },
	{
		id: 'blur-video',
		name: 'Blur',
		short: 'Softens the whole picture - handy for a backdrop or to obscure something.',
		category: 'color',
		status: 'ready',
		icon: IconSparkle,
		handler: 'blur',
		outputKind: 'video',
		params: [{ type: 'slider', key: 'px', label: 'Strength', min: 1, max: 24, step: 1, default: 6, unit: 'px' }],
	},
	{
		id: 'sharpen-video',
		name: 'Sharpen',
		short: 'Adds edge contrast back to a slightly soft clip. Heavier on large frames.',
		category: 'color',
		status: 'ready',
		icon: IconSparkle,
		handler: 'sharpen',
		outputKind: 'video',
		params: [{ type: 'slider', key: 'amount', label: 'Amount', min: 0.1, max: 2, step: 0.1, default: 0.6 }],
	},
	{
		id: 'vignette',
		name: 'Vignette',
		short: 'Darkens the corners to pull the eye toward the centre.',
		category: 'color',
		status: 'ready',
		icon: IconEye,
		handler: 'vignette',
		outputKind: 'video',
		params: [{ type: 'slider', key: 'strength', label: 'Strength', min: 0.1, max: 1, step: 0.05, default: 0.5 }],
	},
	{
		id: 'chroma-key',
		name: 'Chroma Key / Green Screen',
		short: 'Keys out a solid colour backdrop and replaces it with a flat colour.',
		category: 'color',
		status: 'ready',
		icon: IconLayers,
		handler: 'chroma-key',
		outputKind: 'video',
		params: [
			{ type: 'color', key: 'keyColor', label: 'Backdrop colour to remove', default: '#00b140' },
			{ type: 'slider', key: 'tolerance', label: 'Tolerance', min: 5, max: 70, step: 1, default: 35, unit: '%' },
			{ type: 'slider', key: 'smoothing', label: 'Edge softness', min: 0, max: 40, step: 1, default: 12, unit: '%' },
			{ type: 'color', key: 'backgroundColor', label: 'Replace with', default: '#000000' },
		],
	},
	{
		id: 'color-tone',
		name: 'Color Tone / Film Look',
		short: 'Seventy-nine graded looks - cinematic, film stock, retro, monochrome - with live thumbnails of your own footage.',
		category: 'color',
		status: 'ready',
		icon: IconPalette,
		handler: 'color-tone',
		outputKind: 'video',
		preview: true,
		params: [
			{ type: 'tone', key: 'tone', label: 'Look', default: 'teal-orange' },
			{ type: 'slider', key: 'strength', label: 'Strength', min: 0, max: 100, step: 1, default: 100, unit: '%' },
			{ type: 'slider', key: 'warmth', label: 'Warmth trim', min: -100, max: 100, step: 1, default: 0, unit: '%' },
			{ type: 'slider', key: 'exposure', label: 'Exposure trim', min: -100, max: 100, step: 1, default: 0, unit: '%' },
			{ type: 'slider', key: 'saturationTrim', label: 'Saturation trim', min: -100, max: 100, step: 1, default: 0, unit: '%' },
			{ type: 'slider', key: 'contrastTrim', label: 'Contrast trim', min: -100, max: 100, step: 1, default: 0, unit: '%' },
			{ type: 'slider', key: 'grain', label: 'Extra grain', min: 0, max: 100, step: 1, default: 0, unit: '%', hint: 'Added on top of whatever grain the look already has.' },
			{ type: 'slider', key: 'vignette', label: 'Extra vignette', min: 0, max: 100, step: 1, default: 0, unit: '%' },
			{ type: 'slider', key: 'bloom', label: 'Extra bloom', min: 0, max: 100, step: 1, default: 0, unit: '%', hint: 'Glow around the brightest parts of the frame.' },
		],
	},
	{
		id: 'auto-color',
		name: 'Auto Color / Exposure Fix',
		short: 'Samples the clip and corrects exposure and contrast automatically - no sliders to set.',
		category: 'color',
		status: 'ready',
		icon: IconWand,
		handler: 'auto-color',
		outputKind: 'video',
	},

	/* ---------------------------------------------------------- overlay */
	{
		id: 'watermark',
		name: 'Watermark / Logo',
		short: 'Stamps an image onto every frame - a logo, a sticker, a brand mark.',
		category: 'overlay',
		status: 'ready',
		icon: IconLayers,
		handler: 'watermark',
		outputKind: 'video',
		secondaryFile: { key: 'image', label: 'Watermark image', accept: 'image/png,image/jpeg,image/webp,image/svg+xml', hint: 'A PNG with transparency works best.', kind: 'image' },
		params: [
			{ type: 'select', key: 'position', label: 'Position', default: 'bottom-right', options: POSITION_OPTIONS },
			{ type: 'slider', key: 'scale', label: 'Size', min: 5, max: 45, step: 1, default: 16, unit: '% of width' },
			{ type: 'slider', key: 'opacity', label: 'Opacity', min: 10, max: 100, step: 5, default: 85, unit: '%' },
		],
	},
	{
		id: 'text-overlay',
		name: 'Text Overlay / Burn-in',
		short: 'Burns a line of text into every frame - a title, a handle, a date stamp.',
		category: 'overlay',
		status: 'ready',
		icon: IconType,
		handler: 'text-overlay',
		outputKind: 'video',
		params: [
			{ type: 'text', key: 'content', label: 'Text', default: '@yourhandle', placeholder: 'Type the overlay text' },
			{ type: 'select', key: 'position', label: 'Position', default: 'bottom-center', options: POSITION_OPTIONS },
			{ type: 'slider', key: 'size', label: 'Size', min: 14, max: 96, step: 1, default: 36, unit: 'px' },
			{ type: 'color', key: 'color', label: 'Text color', default: '#ffffff' },
			{ type: 'toggle', key: 'background', label: 'Dark background chip', default: true },
		],
	},
	{
		id: 'chroma-overlay',
		name: 'Chroma Key Overlay',
		short: 'Removes the green screen from a second clip and lays it over this one.',
		category: 'overlay',
		status: 'ready',
		icon: IconLayers,
		handler: 'chroma-overlay',
		outputKind: 'video',
		preview: true,
		note: 'Your clip stays exactly as it was shot. The green-screen clip is keyed and stacked on top of it, and only the main clip’s audio is kept.',
		secondaryFile: {
			key: 'overlay',
			label: 'Green-screen clip to lay on top',
			accept: 'video/*',
			hint: 'Anything filmed against a solid green or blue backdrop. It keeps its own size until you place it.',
			kind: 'video',
		},
		params: [
			{
				type: 'toggle',
				key: 'autoKey',
				label: 'Find the backdrop colour for me',
				default: true,
				hint: 'Samples the edges of the overlay clip, which reads the lighting rather than the paint.',
			},
			{ type: 'color', key: 'keyColor', label: 'Backdrop colour', default: '#00b140', hint: 'Only used when the automatic sample is off.' },
			{ type: 'slider', key: 'tolerance', label: 'How much to remove', min: 1, max: 100, step: 1, default: 30, unit: '%' },
			{ type: 'slider', key: 'smoothing', label: 'Edge softness', min: 0, max: 100, step: 1, default: 12, unit: '%' },
			{ type: 'slider', key: 'despill', label: 'Colour spill removal', min: 0, max: 100, step: 1, default: 60, unit: '%', hint: 'Pulls the backdrop’s cast out of skin, hair and light clothing.' },
			{
				type: 'select',
				key: 'placement',
				label: 'Where it sits',
				default: 'fill',
				options: [
					{ value: 'fill', label: 'Fill the whole frame' },
					{ value: 'center', label: 'Centre' },
					{ value: 'bottom-right', label: 'Bottom right' },
					{ value: 'bottom-left', label: 'Bottom left' },
					{ value: 'top-right', label: 'Top right' },
					{ value: 'top-left', label: 'Top left' },
					{ value: 'bottom-center', label: 'Bottom centre' },
				],
			},
			{
				type: 'select',
				key: 'fit',
				label: 'How it fills the frame',
				default: 'cover',
				options: [
					{ value: 'cover', label: 'Fill the frame (crop)' },
					{ value: 'contain', label: 'Fit inside' },
					{ value: 'stretch', label: 'Stretch to fit' },
				],
				hint: 'Used by the full-frame placement.',
			},
			{ type: 'slider', key: 'scale', label: 'Size', min: 5, max: 100, step: 1, default: 35, unit: '% of width', hint: 'Used by the corner and centre placements.' },
			{ type: 'slider', key: 'opacity', label: 'Opacity', min: 10, max: 100, step: 1, default: 100, unit: '%' },
			{ type: 'slider', key: 'startAt', label: 'Starts at', min: 0, max: 600, step: 0.1, default: 0, unit: 's', maxFrom: 'durationSeconds' },
			{ type: 'toggle', key: 'loop', label: 'Loop it if it runs out', default: true },
			{ type: 'toggle', key: 'showMatte', label: 'Show the key instead', default: false, hint: 'White is kept, black is removed. The quickest way to judge the tolerance.' },
		],
	},
	{
		id: 'subtitle-burn-in',
		name: 'Subtitle Burn-in',
		short: 'Transcribe and style captions, burned permanently into the video - opens Subtitle Studio.',
		category: 'overlay',
		status: 'ready',
		icon: IconCaptions,
		link: { href: '/captions', label: 'Open Subtitle Studio' },
		outputKind: 'video',
	},
	{
		id: 'picture-in-picture',
		name: 'Picture-in-Picture',
		short: 'Overlays a second clip in a corner of the frame, timed against this one.',
		category: 'overlay',
		status: 'ready',
		icon: IconLayers,
		handler: 'picture-in-picture',
		outputKind: 'video',
		secondaryFile: { key: 'overlay', label: 'Overlay clip', accept: 'video/*', hint: 'Plays alongside the main clip, held on its last frame if it runs out first.', kind: 'video' },
		params: [
			{ type: 'select', key: 'position', label: 'Position', default: 'bottom-right', options: POSITION_OPTIONS },
			{ type: 'slider', key: 'scale', label: 'Size', min: 12, max: 50, step: 1, default: 28, unit: '% of width' },
			{ type: 'slider', key: 'opacity', label: 'Opacity', min: 20, max: 100, step: 5, default: 100, unit: '%' },
		],
	},

	/* ----------------------------------------------------------- export */
	{
		id: 'format-convert',
		name: 'Format Convert',
		short: 'Re-encodes between MP4 and WebM, same picture, different container - pick the container below.',
		category: 'export',
		status: 'ready',
		icon: IconFile,
		handler: 'format-convert',
		outputKind: 'video',
	},
	{
		id: 'compress-video',
		name: 'Compress / Reduce Size',
		short: 'Re-encodes at a lower bitrate to shrink the file - pick the target quality below.',
		category: 'export',
		status: 'ready',
		icon: IconFile,
		handler: 'compress',
		outputKind: 'video',
	},
	{
		id: 'extract-thumbnail',
		name: 'Extract Thumbnail / Frame',
		short: 'Saves one frame as a still PNG image.',
		category: 'export',
		status: 'ready',
		icon: IconFile,
		handler: 'thumbnail',
		outputKind: 'image',
		params: [{ type: 'slider', key: 'atSeconds', label: 'At time', min: 0, max: 0, step: 0.1, default: 0, unit: 's', maxFrom: 'durationSeconds', defaultFrom: 'durationHalf' }],
	},
	{
		id: 'edit-metadata',
		name: 'Edit Metadata',
		short: 'Sets the title, artist and description tags stored inside the file - picture and sound untouched.',
		category: 'export',
		status: 'ready',
		icon: IconFile,
		handler: 'metadata-edit',
		outputKind: 'video',
		losslessVideo: true,
		params: [
			{ type: 'text', key: 'title', label: 'Title', default: '', placeholder: 'Video title' },
			{ type: 'text', key: 'artist', label: 'Artist / creator', default: '', placeholder: 'Name' },
			{ type: 'text', key: 'description', label: 'Description', default: '', placeholder: 'Short description' },
		],
	},
	{
		id: 'export-gif',
		name: 'Export as GIF',
		short: 'Turns a short clip into a looping GIF, palette and all, written from scratch.',
		category: 'export',
		status: 'ready',
		icon: IconFile,
		handler: 'export-gif',
		outputKind: 'image',
		params: [
			{ type: 'slider', key: 'widthPx', label: 'Width', min: 120, max: 640, step: 10, default: 360, unit: 'px' },
			{ type: 'slider', key: 'fps', label: 'Frame rate', min: 4, max: 20, step: 1, default: 10, unit: 'fps' },
			{ type: 'slider', key: 'maxSeconds', label: 'Length cap', min: 2, max: 20, step: 1, default: 8, unit: 's', hint: 'Longer clips are trimmed to this many seconds, so the file stays a reasonable size.' },
		],
	},
	{
		id: 'batch-export',
		name: 'Batch Export Queue',
		short: 'Runs one simple, parameter-free tool over many files at once and zips the results.',
		category: 'export',
		status: 'ready',
		icon: IconLayers,
		handler: 'batch-export',
		outputKind: 'video',
		multiFile: { label: 'Files to process', accept: 'video/*', hint: 'Each one is run through the same tool below, independently.' },
		params: [
			{
				type: 'select',
				key: 'tool',
				label: 'Apply',
				default: 'mute-audio',
				options: [
					{ value: 'mute-audio', label: 'Mute Audio' },
					{ value: 'normalize-audio', label: 'Normalize Loudness' },
					{ value: 'grayscale', label: 'Grayscale' },
					{ value: 'format-convert', label: 'Format Convert' },
					{ value: 'compress-video', label: 'Compress / Reduce Size' },
					{ value: 'stereo-to-mono', label: 'Stereo to Mono' },
					{ value: 'mono-to-stereo', label: 'Mono to Stereo' },
				],
			},
		],
	},

	/* --------------------------------------------------------- restore */
	{
		id: 'click-removal',
		name: 'Click / Pop Removal',
		short: 'Detects and smooths isolated clicks and pops in the audio.',
		category: 'restore',
		status: 'ready',
		icon: IconWand,
		handler: 'declick',
		outputKind: 'video',
		losslessVideo: true,
		params: [{ type: 'slider', key: 'sensitivity', label: 'Sensitivity', min: 2, max: 14, step: 0.5, default: 6 }],
	},
	{
		id: 'vocal-noise-reduction',
		name: 'Vocal Noise Reduction',
		short: 'Learns the room tone from the first moment of quiet and subtracts it from the whole track - real spectral gating, not a deep-learning source separator.',
		category: 'restore',
		status: 'ready',
		icon: IconMic,
		handler: 'spectral-denoise',
		outputKind: 'video',
		losslessVideo: true,
		params: [{ type: 'slider', key: 'strength', label: 'Strength', min: 0, max: 100, step: 5, default: 55, unit: '%' }],
	},
	{
		id: 'stabilization',
		name: 'Video Stabilization',
		short: 'Smooths handheld camera shake by tracking and compensating frame-to-frame motion, with a small zoom to hide the edges.',
		category: 'restore',
		status: 'ready',
		icon: IconWand,
		handler: 'stabilize',
		outputKind: 'video',
		params: [{ type: 'slider', key: 'strength', label: 'Smoothing strength', min: 20, max: 100, step: 5, default: 60, unit: '%' }],
	},
	{
		id: 'autocrop-bars',
		name: 'Auto-Crop Black Bars',
		short: 'Measures the letterboxing across a few frames and crops only the bars every sample agrees are black.',
		category: 'restore',
		status: 'ready',
		icon: IconZoomIn,
		handler: 'autocrop-bars',
		outputKind: 'video',
	},
	{
		id: 'scene-split',
		name: 'Scene-Cut Auto-Split',
		short: 'Finds hard cuts by frame-difference and splits the file into one clip per shot.',
		category: 'restore',
		status: 'ready',
		icon: IconScissors,
		handler: 'scene-split',
		outputKind: 'video',
		params: [{ type: 'slider', key: 'sensitivity', label: 'Sensitivity', min: 0, max: 100, step: 5, default: 50, unit: '%' }],
	},
	{
		id: 'music-ducking',
		name: 'Background Music Ducking',
		short: 'Lays a music track under this clip and automatically pulls it down whenever this clip has sound.',
		category: 'restore',
		status: 'ready',
		icon: IconVolume,
		handler: 'music-ducking',
		outputKind: 'video',
		losslessVideo: true,
		secondaryFile: { key: 'music', label: 'Music track', accept: 'audio/*,video/*', hint: 'An audio or video file - only its sound is used, mixed in under this clip.', kind: 'audio' },
		params: [
			{ type: 'slider', key: 'duckDb', label: 'Duck by', min: 3, max: 24, step: 1, default: 12, unit: 'dB' },
			{ type: 'slider', key: 'musicGainDb', label: 'Music level', min: -18, max: 6, step: 1, default: -3, unit: 'dB' },
		],
	},

	/* ------------------------------------------------- advanced audio */
	{
		id: 'bass-boost',
		name: 'Bass Boost',
		short: 'A low shelf around 150 Hz - warms up thin-sounding audio.',
		category: 'levels',
		status: 'ready',
		icon: IconVolume,
		handler: 'bass-boost',
		outputKind: 'video',
		losslessVideo: true,
		params: [{ type: 'slider', key: 'gainDb', label: 'Boost', min: 0, max: 12, step: 0.5, default: 6, unit: 'dB' }],
	},
	{
		id: 'treble-boost',
		name: 'Treble / Air',
		short: 'A high shelf around 6 kHz - adds clarity and presence up top.',
		category: 'levels',
		status: 'ready',
		icon: IconVolume,
		handler: 'treble-boost',
		outputKind: 'video',
		losslessVideo: true,
		params: [{ type: 'slider', key: 'gainDb', label: 'Boost', min: 0, max: 12, step: 0.5, default: 5, unit: 'dB' }],
	},
	{
		id: 'stereo-widener',
		name: 'Stereo Widener',
		short: 'Mid-side widening - scales the left/right difference for a bigger stereo image.',
		category: 'levels',
		status: 'ready',
		icon: IconWaveform,
		handler: 'stereo-widen',
		outputKind: 'video',
		losslessVideo: true,
		params: [{ type: 'slider', key: 'widthPercent', label: 'Width', min: 100, max: 200, step: 5, default: 140, unit: '%' }],
	},
	{
		id: 'compressor',
		name: 'Compressor',
		short: 'Real dynamics compression - evens out a track that swings between quiet and loud.',
		category: 'levels',
		status: 'ready',
		icon: IconGauge,
		handler: 'compressor',
		outputKind: 'video',
		losslessVideo: true,
		params: [
			{ type: 'slider', key: 'thresholdDb', label: 'Threshold', min: -40, max: -5, step: 1, default: -18, unit: 'dB' },
			{ type: 'slider', key: 'ratio', label: 'Ratio', min: 1.5, max: 10, step: 0.5, default: 3, unit: ':1' },
			{ type: 'slider', key: 'attackMs', label: 'Attack', min: 1, max: 50, step: 1, default: 8, unit: 'ms' },
			{ type: 'slider', key: 'releaseMs', label: 'Release', min: 30, max: 400, step: 10, default: 120, unit: 'ms' },
			{ type: 'slider', key: 'makeupDb', label: 'Makeup gain', min: 0, max: 12, step: 0.5, default: 3, unit: 'dB' },
		],
	},
	{
		id: 'limiter',
		name: 'Limiter',
		short: 'A fast, high-ratio compressor set up as a brickwall ceiling - the last stop before clipping.',
		category: 'levels',
		status: 'ready',
		icon: IconGauge,
		handler: 'limiter',
		outputKind: 'video',
		losslessVideo: true,
		params: [{ type: 'slider', key: 'ceilingDb', label: 'Ceiling', min: -6, max: -0.5, step: 0.5, default: -1, unit: 'dB' }],
	},
	{
		id: 'de-esser',
		name: 'De-esser',
		short: 'A sidechained compressor tuned to sibilance - tames harsh "S" and "T" sounds.',
		category: 'restore',
		status: 'ready',
		icon: IconMic,
		handler: 'de-ess',
		outputKind: 'video',
		losslessVideo: true,
		params: [
			{ type: 'slider', key: 'thresholdDb', label: 'Threshold', min: -40, max: -5, step: 1, default: -22, unit: 'dB' },
			{ type: 'slider', key: 'freq', label: 'Sibilance frequency', min: 3000, max: 10000, step: 100, default: 6500, unit: 'Hz' },
		],
	},
	{
		id: 'lufs-normalize',
		name: 'Broadcast Loudness',
		short: 'An approximate ITU-R BS.1770-style loudness normalise - K-weighted, single pass, not a certified meter.',
		category: 'levels',
		status: 'ready',
		icon: IconGauge,
		handler: 'lufs-normalize',
		outputKind: 'video',
		losslessVideo: true,
		params: [{ type: 'slider', key: 'targetLufs', label: 'Target', min: -23, max: -9, step: 1, default: -16, unit: 'LUFS' }],
	},
	{
		id: 'pitch-shift',
		name: 'Pitch Shift',
		short: 'Raises or lowers pitch without changing speed, via a phase-vocoder time-stretch and resample.',
		category: 'levels',
		status: 'ready',
		icon: IconWaveform,
		handler: 'pitch-shift',
		outputKind: 'video',
		losslessVideo: true,
		params: [{ type: 'slider', key: 'semitones', label: 'Shift', min: -12, max: 12, step: 0.5, default: 0, unit: 'st' }],
	},
	/* ------------------------------------------------------- colour correction */
	{
		id: 'adjust',
		name: 'Adjust',
		short: 'The correction desk: exposure, white balance, the four tonal regions, vibrance, clarity.',
		category: 'color',
		status: 'ready',
		icon: IconSliders,
		handler: 'adjust',
		outputKind: 'video',
		preview: true,
		note: 'Exposure and contrast are worked out in linear light and everything else in display space, which is the order a colourist would use.',
		params: [
			{ type: 'slider', key: 'exposure', label: 'Exposure', min: -3, max: 3, step: 0.05, default: 0, unit: 'EV', hint: 'Stops. +1 is twice the light.' },
			{ type: 'slider', key: 'contrast', label: 'Contrast', min: -1, max: 1, step: 0.01, default: 0 },
			{ type: 'slider', key: 'temperature', label: 'Temperature', min: -1, max: 1, step: 0.01, default: 0, hint: 'Right is warmer, left is cooler.' },
			{ type: 'slider', key: 'tint', label: 'Tint', min: -1, max: 1, step: 0.01, default: 0, hint: 'Right is magenta, left is green.' },
			{ type: 'slider', key: 'highlights', label: 'Highlights', min: -1, max: 1, step: 0.01, default: 0 },
			{ type: 'slider', key: 'shadows', label: 'Shadows', min: -1, max: 1, step: 0.01, default: 0 },
			{ type: 'slider', key: 'whites', label: 'Whites', min: -1, max: 1, step: 0.01, default: 0 },
			{ type: 'slider', key: 'blacks', label: 'Blacks', min: -1, max: 1, step: 0.01, default: 0 },
			{ type: 'slider', key: 'gamma', label: 'Midtones', min: -1, max: 1, step: 0.01, default: 0 },
			{ type: 'slider', key: 'fade', label: 'Fade', min: 0, max: 1, step: 0.01, default: 0, hint: 'Lifts the black point for a matte, film-print falloff.' },
			{ type: 'slider', key: 'vibrance', label: 'Vibrance', min: -1, max: 1, step: 0.01, default: 0, hint: 'Saturation that leaves already-vivid colour alone.' },
			{ type: 'slider', key: 'saturation', label: 'Saturation', min: -1, max: 1, step: 0.01, default: 0 },
			{ type: 'slider', key: 'hue', label: 'Hue rotate', min: -180, max: 180, step: 1, default: 0, unit: '°' },
			{ type: 'slider', key: 'clarity', label: 'Clarity', min: -1, max: 1, step: 0.01, default: 0, hint: 'Midtone local contrast - texture, not global contrast.' },
			{ type: 'slider', key: 'sharpness', label: 'Sharpen', min: 0, max: 1, step: 0.01, default: 0 },
		],
	},
	{
		id: 'white-balance',
		name: 'White Balance',
		short: 'Two dials to take the colour cast out of a shot lit by the wrong light.',
		category: 'color',
		status: 'ready',
		icon: IconSun,
		handler: 'adjust',
		outputKind: 'video',
		preview: true,
		params: [
			{ type: 'slider', key: 'temperature', label: 'Temperature', min: -1, max: 1, step: 0.01, default: 0, hint: 'Right for tungsten indoors, left for shade outdoors.' },
			{ type: 'slider', key: 'tint', label: 'Tint', min: -1, max: 1, step: 0.01, default: 0, hint: 'Right takes out green, left takes out magenta.' },
		],
	},
	{
		id: 'hsl-color',
		name: 'HSL Colour',
		short: 'Change one colour family without touching the rest - skin, sky, foliage.',
		category: 'color',
		status: 'ready',
		icon: IconPalette,
		handler: 'adjust',
		outputKind: 'video',
		preview: true,
		note: 'Grey has no hue to belong to a band, so unsaturated parts of the frame are left alone however far these are pushed.',
		params: [
			{ type: 'select', key: 'band', label: 'Colour family', default: 'orange', options: HSL_BAND_OPTIONS },
			{ type: 'slider', key: 'bandHue', label: 'Hue shift', min: -1, max: 1, step: 0.01, default: 0 },
			{ type: 'slider', key: 'bandSat', label: 'Saturation', min: -1, max: 1, step: 0.01, default: 0 },
			{ type: 'slider', key: 'bandLum', label: 'Brightness', min: -1, max: 1, step: 0.01, default: 0 },
			{ type: 'slider', key: 'bandWidth', label: 'Range', min: 5, max: 50, step: 1, default: 18, unit: '%', hint: 'How much of the colour wheel either side counts as this family.' },
		],
	},
	{
		id: 'lut-import',
		name: 'Import a LUT (.cube)',
		short: 'Apply a colourist’s .cube file - a show LUT, a film emulation, a look you were sent.',
		category: 'color',
		status: 'ready',
		icon: IconFile,
		handler: 'lut-import',
		outputKind: 'video',
		preview: true,
		note: 'Both 3D cubes and 1D per-channel curves are read, and a non-standard DOMAIN_MIN/MAX is honoured rather than clipped.',
		secondaryFile: { key: 'lut', label: 'The .cube file', accept: '.cube,text/plain', hint: 'The interchange format Resolve and every LUT pack export.', kind: 'data' },
		params: [{ type: 'slider', key: 'strength', label: 'Strength', min: 0, max: 100, step: 1, default: 100, unit: '%' }],
	},

	/* ---------------------------------------------------------------- effects */
	{
		id: 'video-effects',
		name: 'Video Effects',
		short: 'Thirty-six looks - glitch, VHS, halftone, kaleidoscope, neon, bloom and the rest.',
		category: 'effects',
		status: 'ready',
		icon: IconSparkle,
		handler: 'video-effect',
		outputKind: 'video',
		preview: true,
		params: [
			{ type: 'select', key: 'effect', label: 'Effect', default: 'glitch', options: EFFECT_OPTIONS },
			{ type: 'slider', key: 'intensity', label: 'Intensity', min: 0, max: 100, step: 1, default: 55, unit: '%' },
			{ type: 'slider', key: 'speed', label: 'Speed', min: 0.1, max: 4, step: 0.1, default: 1, unit: 'x', hint: 'Only does anything for the effects that move.' },
			{ type: 'slider', key: 'angle', label: 'Angle', min: 0, max: 360, step: 1, default: 0, unit: '°', hint: 'Used by the split, halftone and directional-blur effects.' },
			{ type: 'color', key: 'colorA', label: 'First colour', default: '#ff2d95' },
			{ type: 'color', key: 'colorB', label: 'Second colour', default: '#22d3ee' },
		],
	},
	...featuredEffectTools(),
	{
		id: 'shape-mask',
		name: 'Shape Mask',
		short: 'Keep one shape sharp and blur, darken, drain or block everything outside it.',
		category: 'effects',
		status: 'ready',
		icon: IconEye,
		handler: 'shape-mask',
		outputKind: 'video',
		preview: true,
		params: [
			{ type: 'select', key: 'shape', label: 'Shape', default: 'circle', options: MASK_SHAPE_OPTIONS },
			{ type: 'select', key: 'treatment', label: 'Outside the shape', default: 'blur', options: MASK_TREATMENT_OPTIONS },
			{ type: 'slider', key: 'centerX', label: 'Position across', min: 0, max: 100, step: 1, default: 50, unit: '%' },
			{ type: 'slider', key: 'centerY', label: 'Position down', min: 0, max: 100, step: 1, default: 50, unit: '%' },
			{ type: 'slider', key: 'size', label: 'Size', min: 5, max: 200, step: 1, default: 55, unit: '%' },
			{ type: 'slider', key: 'ratio', label: 'Height', min: 10, max: 200, step: 1, default: 100, unit: '%', hint: '100% is round; below that the shape is squashed.' },
			{ type: 'slider', key: 'rotation', label: 'Rotation', min: -180, max: 180, step: 1, default: 0, unit: '°' },
			{ type: 'slider', key: 'feather', label: 'Feather', min: 0, max: 100, step: 1, default: 30, unit: '%' },
			{ type: 'slider', key: 'strength', label: 'Strength', min: 0, max: 100, step: 1, default: 80, unit: '%' },
			{ type: 'toggle', key: 'invert', label: 'Swap which side is treated', default: false },
			{ type: 'color', key: 'color', label: 'Fill colour', default: '#000000', hint: 'Only used by the "paint it flat" treatment.' },
		],
	},

	/* ----------------------------------------------------------------- motion */
	{
		id: 'camera-motion',
		name: 'Camera Motion',
		short: 'Eighteen moves - Ken Burns pushes, pans, whips, spins, handheld drift and shakes.',
		category: 'motion',
		status: 'ready',
		icon: IconZoomIn,
		handler: 'camera-motion',
		outputKind: 'video',
		preview: true,
		note: 'Every move is given exactly the zoom it needs to keep its own edges out of shot, so nothing ever slides a black bar into frame.',
		params: [
			{ type: 'select', key: 'preset', label: 'Move', default: 'ken-burns', options: MOTION_OPTIONS },
			{ type: 'slider', key: 'amount', label: 'Amount', min: 0, max: 100, step: 1, default: 60, unit: '%' },
			{ type: 'select', key: 'easing', label: 'Easing', default: 'ease-in-out', options: EASING_OPTIONS },
			{ type: 'slider', key: 'seconds', label: 'Over', min: 0.5, max: 120, step: 0.1, default: 5, unit: 's', maxFrom: 'durationSeconds', defaultFrom: 'durationSeconds', hint: 'A looping move treats this as the length of one cycle.' },
			{ type: 'toggle', key: 'reverse', label: 'Run the move backwards', default: false },
		],
	},
	{
		id: 'reverse-video',
		name: 'Reverse',
		short: 'Plays the whole clip, picture and sound, backwards.',
		category: 'timing',
		status: 'ready',
		icon: IconHistory,
		handler: 'reverse-video',
		outputKind: 'video',
		note: 'Decoded in spans rather than all at once, so a long clip cannot exhaust memory.',
		params: [{ type: 'toggle', key: 'includeAudio', label: 'Reverse the sound too', default: true }],
	},

	/* -------------------------------------------------------- compose & layout */
	{
		id: 'add-transition',
		name: 'Add a Transition',
		short: 'Joins this clip to another one with a dissolve, wipe, push, iris, flash or glitch.',
		category: 'compose',
		status: 'ready',
		icon: IconMerge,
		handler: 'transition',
		outputKind: 'video',
		note: 'The two clips overlap, so the result is shorter than the two of them added together by exactly the length of the transition.',
		secondaryFile: { key: 'second', label: 'The clip to cut to', accept: 'video/*', hint: 'It is letterboxed onto this clip’s frame rather than stretched.', kind: 'video' },
		params: [
			{ type: 'select', key: 'transition', label: 'Transition', default: 'dissolve', options: TRANSITION_OPTIONS },
			{ type: 'slider', key: 'seconds', label: 'Length', min: 0.2, max: 4, step: 0.1, default: 1, unit: 's' },
		],
	},
	{
		id: 'split-screen',
		name: 'Split Screen',
		short: 'Two, three or four clips playing at once in one frame.',
		category: 'compose',
		status: 'ready',
		icon: IconGrid,
		handler: 'split-screen',
		outputKind: 'video',
		note: 'The result runs as long as the longest clip; a panel that has finished holds its last frame rather than going black.',
		multiFile: { label: 'The clips to lay out', accept: 'video/*', hint: 'In panel order. The loaded clip is not used - add every panel here.' },
		params: [
			{ type: 'select', key: 'layout', label: 'Layout', default: 'side-by-side', options: SPLIT_LAYOUT_OPTIONS },
			{ type: 'select', key: 'aspect', label: 'Output shape', default: '16:9', options: [{ value: '16:9', label: '16:9 widescreen' }, { value: '9:16', label: '9:16 vertical' }, { value: '1:1', label: '1:1 square' }, { value: '4:5', label: '4:5 portrait' }] },
			{ type: 'select', key: 'fit', label: 'Fill each panel by', default: 'cover', options: [{ value: 'cover', label: 'Cropping to fill' }, { value: 'contain', label: 'Fitting inside' }] },
			{ type: 'slider', key: 'gap', label: 'Gap', min: 0, max: 6, step: 0.1, default: 0.8, unit: '%' },
			{ type: 'slider', key: 'radius', label: 'Corner rounding', min: 0, max: 6, step: 0.1, default: 0, unit: '%' },
			{ type: 'color', key: 'background', label: 'Background', default: '#0b0b10' },
		],
	},
	{
		id: 'blend-overlay',
		name: 'Blend an Overlay',
		short: 'Lay a clip or an image over this one with any of seventeen blend modes.',
		category: 'compose',
		status: 'ready',
		icon: IconLayers,
		handler: 'blend-overlay',
		outputKind: 'video',
		preview: true,
		note: 'Screen for light leaks and flares, multiply for textures, lighten for dust and scratch plates.',
		secondaryFile: { key: 'overlay', label: 'The clip or image to blend', accept: 'video/*,image/*', hint: 'A still is held for the whole clip; a video plays along with it.', kind: 'media' },
		params: [
			{ type: 'select', key: 'mode', label: 'Blend mode', default: 'screen', options: BLEND_OPTIONS },
			{ type: 'slider', key: 'opacity', label: 'Opacity', min: 0, max: 100, step: 1, default: 70, unit: '%' },
			{ type: 'select', key: 'placement', label: 'Placement', default: 'fill', options: OVERLAY_PLACEMENT_OPTIONS },
			{ type: 'select', key: 'fit', label: 'Fit', default: 'cover', options: OVERLAY_FIT_OPTIONS },
			{ type: 'slider', key: 'scale', label: 'Size', min: 5, max: 100, step: 1, default: 35, unit: '%', hint: 'Only used when the overlay is anchored to a corner rather than filling.' },
			{ type: 'slider', key: 'startAt', label: 'Starts at', min: 0, max: 600, step: 0.1, default: 0, unit: 's', maxFrom: 'durationSeconds' },
			{ type: 'toggle', key: 'loop', label: 'Loop it to the end', default: true },
		],
	},
	{
		id: 'canvas-background',
		name: 'Canvas & Reframe',
		short: 'Change the shape of the frame without cropping - the rest is a blurred blow-up, a colour or your own image.',
		category: 'compose',
		status: 'ready',
		icon: IconLayers,
		handler: 'canvas-background',
		outputKind: 'video',
		preview: true,
		note: 'Nothing is thrown away: the whole picture is kept and given a backdrop, which is the opposite of what Aspect Crop does.',
		secondaryFile: { key: 'plate', label: 'Backdrop image', accept: 'image/*', hint: 'Only needed when the backdrop is set to an uploaded image.', kind: 'image' },
		params: [
			{ type: 'select', key: 'aspect', label: 'Output shape', default: '9:16', options: [{ value: '9:16', label: '9:16 vertical' }, { value: '1:1', label: '1:1 square' }, { value: '4:5', label: '4:5 portrait' }, { value: '16:9', label: '16:9 widescreen' }, { value: '4:3', label: '4:3 classic' }, { value: '2:1', label: '2:1 cinematic' }] },
			{ type: 'select', key: 'backdrop', label: 'Backdrop', default: 'blur', options: CANVAS_BACKDROP_OPTIONS },
			{ type: 'slider', key: 'blurStrength', label: 'Blur', min: 10, max: 100, step: 1, default: 70, unit: '%' },
			{ type: 'slider', key: 'dim', label: 'Dim the backdrop', min: 0, max: 80, step: 1, default: 25, unit: '%' },
			{ type: 'slider', key: 'foregroundScale', label: 'Picture size', min: 40, max: 100, step: 1, default: 100, unit: '%' },
			{ type: 'color', key: 'color', label: 'Colour', default: '#0b0b10' },
			{ type: 'color', key: 'colorB', label: 'Second colour', default: '#1f2937', hint: 'The far end of the gradient.' },
		],
	},
	{
		id: 'auto-reframe',
		name: 'Auto Reframe',
		short: 'Crops to a new shape with a window that follows the person, instead of a fixed centre crop.',
		category: 'ai',
		status: 'ready',
		icon: IconPerson,
		handler: 'auto-reframe',
		outputKind: 'video',
		note: 'The person model is downloaded once and kept in this browser. With nobody in frame it follows the moving part of the picture instead.',
		params: [
			{ type: 'select', key: 'aspect', label: 'Crop to', default: '9:16', options: ASPECT_OPTIONS },
			{ type: 'slider', key: 'steadiness', label: 'Steadiness', min: 0, max: 100, step: 1, default: 60, unit: '%', hint: 'Higher holds the framing longer and moves less often.' },
			{ type: 'toggle', key: 'motionOnly', label: 'Skip the person model, follow motion only', default: false },
			{ type: 'select', key: 'model', label: 'Model', default: 'balanced', options: [{ value: 'balanced', label: 'Balanced - faster' }, { value: 'precise', label: 'Precise - slower' }] },
		],
	},

	/* ------------------------------------------------------------ text & frame */
	{
		id: 'animated-text',
		name: 'Animated Title',
		short: 'A styled, timed title with an in and an out - outlined, boxed, glowing, typed or karaoke.',
		category: 'text',
		status: 'ready',
		icon: IconType,
		handler: 'animated-text',
		outputKind: 'video',
		preview: true,
		params: [
			{ type: 'text', key: 'content', label: 'Text', default: 'Your title here', placeholder: 'Type the title' },
			{ type: 'select', key: 'style', label: 'Style', default: 'outline', options: TEXT_STYLE_OPTIONS },
			{ type: 'select', key: 'animation', label: 'Animation', default: 'fade', options: TEXT_ANIMATION_OPTIONS },
			{ type: 'select', key: 'position', label: 'Position', default: 'bottom-center', options: POSITION_OPTIONS },
			{ type: 'slider', key: 'fontSize', label: 'Size', min: 2, max: 20, step: 0.5, default: 7, unit: '%', hint: 'A percentage of the frame height, so it looks the same at any resolution.' },
			{ type: 'select', key: 'weight', label: 'Weight', default: '600', options: [{ value: '400', label: 'Regular' }, { value: '600', label: 'Semibold' }, { value: '800', label: 'Heavy' }] },
			{ type: 'color', key: 'color', label: 'Text colour', default: '#ffffff' },
			{ type: 'color', key: 'accent', label: 'Accent colour', default: '#0b0b10', hint: 'The outline, glow, box or karaoke fill.' },
			{ type: 'slider', key: 'startAt', label: 'Appears at', min: 0, max: 600, step: 0.1, default: 0, unit: 's', maxFrom: 'durationSeconds' },
			{ type: 'slider', key: 'seconds', label: 'Stays for', min: 0.2, max: 600, step: 0.1, default: 3, unit: 's', maxFrom: 'durationSeconds' },
			{ type: 'slider', key: 'animateSeconds', label: 'In and out take', min: 0.1, max: 3, step: 0.05, default: 0.5, unit: 's' },
			{ type: 'slider', key: 'maxWidth', label: 'Wrap at', min: 20, max: 100, step: 1, default: 80, unit: '%' },
			{ type: 'slider', key: 'offsetY', label: 'Nudge up or down', min: -40, max: 40, step: 1, default: 0, unit: '%' },
			{ type: 'slider', key: 'rotation', label: 'Rotation', min: -30, max: 30, step: 1, default: 0, unit: '°' },
			{ type: 'toggle', key: 'uppercase', label: 'Upper case', default: false },
		],
	},
	{
		id: 'border-frame',
		name: 'Border & Frame',
		short: 'A band, a shadow, a glow or a polaroid edge around the picture - without cropping it.',
		category: 'overlay',
		status: 'ready',
		icon: IconLayers,
		handler: 'border-frame',
		outputKind: 'video',
		preview: true,
		note: 'The picture is scaled down by exactly the width of the frame, so a border never eats the edge of the shot.',
		params: [
			{ type: 'select', key: 'style', label: 'Style', default: 'solid', options: BORDER_OPTIONS },
			{ type: 'slider', key: 'thickness', label: 'Thickness', min: 0, max: 20, step: 0.2, default: 3, unit: '%' },
			{ type: 'slider', key: 'radius', label: 'Corner rounding', min: 0, max: 20, step: 0.2, default: 0, unit: '%' },
			{ type: 'slider', key: 'opacity', label: 'Opacity', min: 0, max: 100, step: 1, default: 100, unit: '%' },
			{ type: 'color', key: 'color', label: 'Colour', default: '#ffffff' },
			{ type: 'color', key: 'colorB', label: 'Second colour', default: '#0b0b10' },
		],
	},

	/* ------------------------------------------------------------- restoration */
	{
		id: 'video-enhance',
		name: 'Enhance & Denoise',
		short: 'Edge-preserving denoise, deblocking on the codec’s own 8-pixel grid, then masked sharpening.',
		category: 'restore',
		status: 'ready',
		icon: IconWand,
		handler: 'enhance',
		outputKind: 'video',
		preview: true,
		note: 'This is restoration, not super-resolution: it cleans up what was recorded, it does not invent detail that was not.',
		params: [
			{ type: 'slider', key: 'denoise', label: 'Denoise', min: 0, max: 100, step: 1, default: 40, unit: '%' },
			{ type: 'slider', key: 'deblock', label: 'Deblock', min: 0, max: 100, step: 1, default: 30, unit: '%', hint: 'For footage that has been compressed hard.' },
			{ type: 'slider', key: 'sharpen', label: 'Sharpen', min: 0, max: 100, step: 1, default: 35, unit: '%' },
			{ type: 'slider', key: 'saturation', label: 'Colour recovery', min: 0, max: 60, step: 1, default: 0, unit: '%' },
			{ type: 'select', key: 'upscale', label: 'Output size', default: '1', options: [{ value: '1', label: 'Leave it as it is' }, { value: '1.5', label: '1.5x larger' }, { value: '2', label: '2x larger' }] },
		],
	},
	{
		id: 'watermark-remove',
		name: 'Remove an Object',
		short: 'Fill in, blur or pixelate a rectangle - a burnt-in logo, a timecode, a number plate.',
		category: 'restore',
		status: 'ready',
		icon: IconTrash,
		handler: 'remove-object',
		outputKind: 'video',
		preview: true,
		note: 'The fill reconstructs the region from its own edges. Over flat backgrounds it is invisible; over detailed texture it will smear.',
		params: [
			{ type: 'select', key: 'mode', label: 'What to do', default: 'fill', options: INPAINT_OPTIONS },
			{ type: 'slider', key: 'x', label: 'Left edge', min: 0, max: 95, step: 0.5, default: 70, unit: '%' },
			{ type: 'slider', key: 'y', label: 'Top edge', min: 0, max: 95, step: 0.5, default: 80, unit: '%' },
			{ type: 'slider', key: 'width', label: 'Width', min: 2, max: 100, step: 0.5, default: 22, unit: '%' },
			{ type: 'slider', key: 'height', label: 'Height', min: 2, max: 100, step: 0.5, default: 12, unit: '%' },
			{ type: 'slider', key: 'feather', label: 'Blend the edge', min: 0, max: 100, step: 1, default: 45, unit: '%' },
			{ type: 'slider', key: 'strength', label: 'Strength', min: 10, max: 100, step: 1, default: 70, unit: '%', hint: 'How hard the blur or pixelation is.' },
			{ type: 'toggle', key: 'matchGrain', label: 'Put the grain back over the fill', default: true },
		],
	},
	{
		id: 'retouch',
		name: 'Retouch',
		short: 'Skin smoothing that keeps the eyelashes, plus tone evening and a lift on eyes and teeth.',
		category: 'ai',
		status: 'ready',
		icon: IconPerson,
		handler: 'retouch',
		outputKind: 'video',
		preview: true,
		note: 'The filter is bilateral and runs only on skin, found in chroma - so it works across skin tones and leaves everything that is not skin alone.',
		params: [
			{ type: 'slider', key: 'smooth', label: 'Smooth', min: 0, max: 100, step: 1, default: 45, unit: '%' },
			{ type: 'slider', key: 'even', label: 'Even out the tone', min: 0, max: 100, step: 1, default: 25, unit: '%' },
			{ type: 'slider', key: 'brighten', label: 'Brighten', min: 0, max: 100, step: 1, default: 15, unit: '%' },
			{ type: 'slider', key: 'warmth', label: 'Warmth', min: -100, max: 100, step: 1, default: 10, unit: '%' },
			{ type: 'slider', key: 'eyes', label: 'Eyes and teeth', min: 0, max: 100, step: 1, default: 25, unit: '%' },
			{ type: 'slider', key: 'radius', label: 'Smoothing radius', min: 0, max: 100, step: 1, default: 50, unit: '%' },
		],
	},

	/* ------------------------------------------------------------ audio effects */
	{
		id: 'reverb',
		name: 'Reverb',
		short: 'Puts the sound in a room - eight comb filters and four allpasses, per channel.',
		category: 'levels',
		status: 'ready',
		icon: IconWaveform,
		handler: 'reverb',
		outputKind: 'video',
		params: [
			{ type: 'slider', key: 'size', label: 'Room size', min: 0, max: 100, step: 1, default: 55, unit: '%' },
			{ type: 'slider', key: 'damping', label: 'Damping', min: 0, max: 100, step: 1, default: 55, unit: '%', hint: 'How fast the top end dies away - a soft room against a tiled one.' },
			{ type: 'slider', key: 'wet', label: 'Mix', min: 0, max: 100, step: 1, default: 30, unit: '%' },
			{ type: 'slider', key: 'preDelayMs', label: 'Pre-delay', min: 0, max: 200, step: 1, default: 20, unit: 'ms' },
			{ type: 'slider', key: 'width', label: 'Width', min: 0, max: 100, step: 1, default: 100, unit: '%' },
		],
	},
	{
		id: 'echo-delay',
		name: 'Echo',
		short: 'Repeats, with feedback - straight or bouncing between the channels.',
		category: 'levels',
		status: 'ready',
		icon: IconWaveform,
		handler: 'echo',
		outputKind: 'video',
		params: [
			{ type: 'slider', key: 'delayMs', label: 'Delay', min: 20, max: 1500, step: 10, default: 320, unit: 'ms' },
			{ type: 'slider', key: 'feedback', label: 'Feedback', min: 0, max: 92, step: 1, default: 35, unit: '%' },
			{ type: 'slider', key: 'wet', label: 'Mix', min: 0, max: 100, step: 1, default: 35, unit: '%' },
			{ type: 'toggle', key: 'pingPong', label: 'Bounce left to right', default: false },
		],
	},
	{
		id: 'equalizer',
		name: 'Equaliser',
		short: 'Five bands: shelves at the ends, bells in the middle.',
		category: 'levels',
		status: 'ready',
		icon: IconSliders,
		handler: 'equalizer',
		outputKind: 'video',
		params: [
			{ type: 'slider', key: 'low', label: '80 Hz', min: -18, max: 18, step: 0.5, default: 0, unit: 'dB' },
			{ type: 'slider', key: 'lowMid', label: '250 Hz', min: -18, max: 18, step: 0.5, default: 0, unit: 'dB' },
			{ type: 'slider', key: 'mid', label: '1 kHz', min: -18, max: 18, step: 0.5, default: 0, unit: 'dB' },
			{ type: 'slider', key: 'highMid', label: '3.5 kHz', min: -18, max: 18, step: 0.5, default: 0, unit: 'dB' },
			{ type: 'slider', key: 'high', label: '10 kHz', min: -18, max: 18, step: 0.5, default: 0, unit: 'dB' },
		],
	},
	{
		id: 'voice-changer',
		name: 'Voice Changer',
		short: 'Nine characters - chipmunk, deep, robot, telephone, megaphone, alien, whisper, cave, old radio.',
		category: 'levels',
		status: 'ready',
		icon: IconMic,
		handler: 'voice-changer',
		outputKind: 'video',
		params: [{ type: 'select', key: 'preset', label: 'Character', default: 'deep', options: VOICE_OPTIONS }],
	},
	{
		id: 'beat-markers',
		name: 'Find the Beat',
		short: 'Marks every beat and estimates the tempo, so cuts can be placed on them.',
		category: 'levels',
		status: 'ready',
		icon: IconBolt,
		handler: 'beat-detect',
		outputKind: 'file',
		note: 'Nothing about the clip is changed - this writes out a list of times and a tempo.',
		params: [{ type: 'slider', key: 'sensitivity', label: 'Sensitivity', min: 0, max: 100, step: 1, default: 55, unit: '%' }],
	},
]

export function toolById(id: string): ToolDef | undefined {
	return TOOLS.find((tool) => tool.id === id)
}

export const READY_COUNT = TOOLS.filter((tool) => tool.status === 'ready').length
export const TOTAL_COUNT = TOOLS.length

export const LINK_ICON = IconLink
export const PLUS_ICON = IconPlus
