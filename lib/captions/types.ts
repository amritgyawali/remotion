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
export type TranscriptOrigin = 'whisper' | 'srt' | 'text' | 'none'

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

export type CaptionFontId =
	| 'inter'
	| 'archivo'
	| 'anton'
	| 'bebasNeue'
	| 'oswald'
	| 'playfairDisplay'
	| 'spaceGrotesk'
	| 'jetBrainsMono'
	| 'nunito'
	| 'caveat'

export type CaptionPlacement = 'bottom' | 'center' | 'top'

/** How the word being spoken is marked. */
export type CaptionHighlight = 'color' | 'box' | 'scale' | 'none'

export type CaptionBackground = 'none' | 'pill' | 'block'

export type CaptionAnimation = 'pop' | 'fade' | 'slide' | 'none'

export type CaptionStylePresetId =
	| 'tiktok'
	| 'karaoke'
	| 'broadcast'
	| 'minimal'
	| 'neon'
	| 'boxed'

export type CaptionStyle = {
	preset: CaptionStylePresetId
	fontId: CaptionFontId
	fontWeight: number
	/** cap height as a percentage of the composition height, 2 - 12 */
	fontSizePercent: number
	uppercase: boolean
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
}

/** Controls how the word stream is cut into on-screen lines. */
export type CaptionLayoutOptions = {
	maxWordsPerCue: number
	maxCharactersPerCue: number
	maxCueDurationMs: number
	/** a silence longer than this always starts a new cue */
	splitOnGapMs: number
}

export type WhisperModelId = 'tiny' | 'tiny.en' | 'base' | 'base.en' | 'small' | 'small.en'

export type TranscribeStage =
	| 'idle'
	| 'checking'
	| 'downloading-model'
	| 'decoding-audio'
	| 'transcribing'
	| 'done'
	| 'error'
	| 'cancelled'

export type TranscribeProgress = {
	stage: TranscribeStage
	/** 0 - 1 within the current stage */
	progress: number
	message?: string
}
