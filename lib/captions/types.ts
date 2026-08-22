/**
 * Data model for the Subtitle Studio.
 *
 * A cue is one on-screen line. Its tokens carry word level timing so a caption
 * can highlight the word that is being spoken right now - the whisper models
 * return word timestamps, and hand written transcripts get evenly spread ones.
 */

export type CaptionToken = {
	text: string
	fromMs: number
	toMs: number
}

export type CaptionCue = {
	id: string
	text: string
	startMs: number
	endMs: number
	tokens: CaptionToken[]
}

/** Where the transcript came from - shown in the UI and written into the .tsx header. */
export type TranscriptOrigin = 'whisper' | 'nvidia' | 'srt' | 'text' | 'none'

/**
 * Which recogniser produces the transcript.
 *
 * `nvidia` uploads 16 kHz mono audio to the studio's own route, which holds the
 * API key; `device` runs Whisper in this tab and never sends anything. `auto`
 * prefers the cloud when the server has a key - it needs no download, no
 * SharedArrayBuffer and no fast machine - and falls back to the device when it
 * does not, or when the cloud path fails mid-run.
 */
export type TranscribeEngine = 'auto' | 'nvidia' | 'device'

export type CaptionVideoSource = {
	/** object URL for an upload, or the pasted https:// address */
	url: string
	name: string
	kind: 'file' | 'url'
	sizeInBytes: number
	durationInSeconds: number
	width: number
	height: number
	fps: number
	hasAudio: boolean
	/** kept so transcription can decode the original bytes without a refetch */
	file: File | null
}

/**
 * Font identity lives with the font table, so adding a family to the kit
 * cannot leave a union here out of date. `CaptionDevanagariFontId` is the
 * subset of that table whose faces actually draw Devanagari - the companion
 * face a mixed Nepali caption needs.
 */
import type { CaptionDevanagariFontId, CaptionFontId } from './fonts'

export type { CaptionFontId, CaptionDevanagariFontId, CaptionFontCategory } from './fonts'

export type CaptionPlacement = 'bottom' | 'center' | 'top'

/** How the word being spoken is marked. */
export type CaptionHighlight = 'color' | 'box' | 'scale' | 'none'

export type CaptionBackground = 'none' | 'pill' | 'block'

export type CaptionAnimation = 'pop' | 'fade' | 'slide' | 'rise' | 'blur' | 'none'

/**
 * `line` brings the whole caption in at once - the readable, broadcast way.
 * `word` holds the line's layout and lets each word arrive on its own
 * timestamp, which is the look social edits are built on. `typewriter` types
 * the caption out character by character across its own span.
 */
export type CaptionReveal = 'line' | 'word' | 'typewriter'

/** Case is applied at render time, so the transcript itself is never rewritten. */
export type CaptionTextCase = 'upper' | 'lower' | 'title' | 'none'

export type CaptionAlign = 'left' | 'center' | 'right'

/** Solid colour, or a two-stop gradient clipped to the letterforms. */
export type CaptionFill = 'solid' | 'gradient'

/**
 * Continuous motion applied to the word being spoken, on top of the entrance.
 * Every one of these is a pure function of the frame, so a render matches the
 * preview exactly.
 */
export type CaptionWordEffect = 'none' | 'bounce' | 'wave' | 'jitter' | 'pulse' | 'flip'

export type CaptionStylePresetId =
	| 'tiktok'
	| 'karaoke'
	| 'broadcast'
	| 'minimal'
	| 'neon'
	| 'boxed'
	| 'money'
	| 'sunset'
	| 'chrome'
	| 'arcade'
	| 'vhs'
	| 'typewriter'
	| 'comic'
	| 'cinema'
	| 'marker'
	| 'glass'
	| 'nepali'
	| 'tube'

export type CaptionStyle = {
	preset: CaptionStylePresetId
	fontId: CaptionFontId
	fontWeight: number
	/** cap height as a percentage of the composition height, 2 - 12 */
	fontSizePercent: number
	textCase: CaptionTextCase
	letterSpacing: number
	lineHeight: number
	textColor: string
	highlight: CaptionHighlight
	highlightColor: string
	/** text colour used inside the highlight box, box mode only */
	highlightTextColor: string
	/** outline thickness as a percentage of the font size, 0 - 20 */
	strokeWidth: number
	strokeColor: string
	/** drop shadow strength, 0 - 1 */
	shadow: number
	background: CaptionBackground
	backgroundColor: string
	backgroundOpacity: number
	placement: CaptionPlacement
	/** distance from the chosen edge, percentage of composition height */
	offsetPercent: number
	/** caption block width, percentage of composition width */
	maxWidthPercent: number
	animation: CaptionAnimation
	reveal: CaptionReveal
	/** how many balanced lines one caption may occupy, 1 - 4 */
	maxLines: number
	/** darkening behind the caption zone for legibility on bright footage, 0 - 1 */
	scrim: number
	/** load a Devanagari companion face - set automatically when Nepali is detected */
	devanagari: boolean
	devanagariFontId: CaptionDevanagariFontId

	/* ------------------------------------------------------------- advanced */

	align: CaptionAlign
	/** solid text colour, or a gradient clipped to the glyphs */
	fill: CaptionFill
	gradientFrom: string
	gradientTo: string
	/** gradient direction in degrees, 0 = left to right */
	gradientAngle: number
	/**
	 * True karaoke: the spoken word fills left to right in the highlight colour
	 * over its own timespan instead of switching colour on one frame.
	 */
	karaokeFill: boolean
	/** halo around the type, 0 - 1; the spoken word gets a stronger one */
	glow: number
	glowColor: string
	/** faked 3D depth behind the letterforms, 0 - 1 */
	extrude: number
	extrudeColor: string
	/** drop shadow colour - a coloured shadow is what sells a retro look */
	shadowColor: string
	/** rotation of the whole caption block, degrees */
	tilt: number
	/** frosted backdrop behind the caption block, px of blur */
	backdropBlur: number
	/** continuous motion on the word being spoken */
	wordEffect: CaptionWordEffect
	/** words that always get the emphasis colour, matched case-insensitively */
	emphasisWords: string[]
	emphasisColor: string
}

/** Controls how the word stream is cut into on-screen lines. */
export type CaptionLayoutOptions = {
	maxWordsPerCue: number
	maxCharactersPerCue: number
	maxCueDurationMs: number
	/** a silence longer than this always starts a new cue */
	splitOnGapMs: number
	/**
	 * Readability floor. Subtitle practice puts the shortest comfortable cue at
	 * around 0.7 - 1s: anything briefer registers as a flash, however short the
	 * words are. Cues are only extended into silence, never over the next line.
	 */
	minCueMs: number
}

export type WhisperModelId = 'tiny' | 'tiny.en' | 'base' | 'base.en' | 'small' | 'small.en'

/** Which scripts a transcript actually contains, measured not guessed. */
export type ScriptMix = {
	latin: boolean
	devanagari: boolean
	/** share of Devanagari words, 0 - 1 */
	devanagariShare: number
}

export type TranscribeStage =
	| 'idle'
	| 'checking'
	| 'downloading-model'
	| 'extracting-audio'
	| 'decoding-audio'
	| 'transcribing'
	| 'polishing'
	| 'done'
	| 'error'
	| 'cancelled'

export type TranscribeProgress = {
	stage: TranscribeStage
	/** 0 - 1 within the current stage */
	progress: number
	message?: string
}
