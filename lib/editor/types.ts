/**
 * The Editor Studio's project document.
 *
 * Time is kept as integer frame counts at `settings.fps`, not floating-point
 * seconds and not a `{num, den}` rational. A frame index has no rounding
 * error to accumulate and no gcd/lcm arithmetic to get wrong, and every cut a
 * user makes already lands on a frame boundary because the UI only ever
 * offers frame positions - so an integer *is* the exact representation here,
 * not an approximation of one. Seconds only appear at the two edges that
 * genuinely need them: talking to a decoder/encoder (`framesToSeconds`) and
 * a clip's trim into its *source* asset, which can have a different native
 * frame rate than the project.
 *
 * The document is a flat map of entities keyed by id (assets, tracks, clips)
 * plus small ordering arrays - never a nested tree. That shape is what makes
 * `lib/editor/commands.ts`'s patch-based undo possible: a command only ever
 * needs to say which *entries* changed, not how to walk a tree to find them.
 */

export const EDITOR_SCHEMA_VERSION = 1

export type AssetKind = 'video' | 'image' | 'audio'
export type AssetStatus = 'probing' | 'ready' | 'missing' | 'needs-permission' | 'error'

export type Asset = {
	id: string
	kind: AssetKind
	name: string
	/** id into the shared local vault's blob store (`lib/persist/idb.ts`) - the actual bytes, always present once ready */
	blobKey: string
	/** id into `lib/editor/handles.ts`'s store, when this asset was picked via the File System Access API */
	handleKey: string | null
	/** id of a small poster-frame blob in the vault, once generated */
	thumbKey: string | null
	/** `${size}_${lastModified}_${sha256-prefix}` - re-identifies a file after a browser refresh */
	fingerprint: string
	sizeBytes: number
	lastModified: number
	durationSeconds: number
	width: number
	height: number
	/** native frame rate for video; unused (1) for image/audio */
	fps: number
	hasAudio: boolean
	status: AssetStatus
	error: string | null
}

export type TrackKind = 'video' | 'audio' | 'text'

export type Track = {
	id: string
	kind: TrackKind
	name: string
	height: number
	muted: boolean
	locked: boolean
	hidden: boolean
}

export type Transform = {
	/** pixels, offset from canvas centre */
	x: number
	y: number
	scaleX: number
	scaleY: number
	rotationDeg: number
	opacity: number
}

export type TextAlign = 'left' | 'center' | 'right'
export type AnchorPosition =
	| 'top-left'
	| 'top-center'
	| 'top-right'
	| 'center'
	| 'bottom-left'
	| 'bottom-center'
	| 'bottom-right'

export type TextAnimation = 'none' | 'fade' | 'slide-up' | 'slide-down' | 'pop'

export type TextStyle = {
	content: string
	fontFamily: string
	fontSizePx: number
	weight: 400 | 600 | 800
	color: string
	align: TextAlign
	position: AnchorPosition
	backgroundColor: string | null
	strokeColor: string | null
	strokeWidthPx: number
	marginPx: number
	animationIn: TextAnimation
	animationOut: TextAnimation
	/** how many frames the in/out animation takes, measured from the clip's own start/end */
	animationFrames: number
}

export type ClipAudio = {
	gainDb: number
	muted: boolean
	fadeInFrames: number
	fadeOutFrames: number
}

/** Normalized (0-1) fraction of the source's *natural* size - resolution-independent, survives a relink to a different-resolution file. */
export type CropRect = { x: number; y: number; width: number; height: number }

export type ChromaKeySpec = {
	enabled: boolean
	keyColor: string
	/** 0-1: how far a pixel's colour may drift from `keyColor` and still be keyed out */
	tolerance: number
	/** 0-1: width of the soft edge between "kept" and "keyed out" */
	softness: number
	/** 0-1: how hard to pull the key colour out of the remaining edge pixels */
	spill: number
}

/**
 * Colour grade + a handful of stylize filters, applied to video and image
 * clips through the browser's own `CanvasRenderingContext2D.filter` where
 * possible (§3.5's Canvas2D tier) - free real-time GPU compositing, no
 * per-pixel JS loop. Only the crop and chroma-key (which need to inspect and
 * rewrite individual pixels) fall back to an offscreen scratch canvas; see
 * `lib/editor/compositor.ts`.
 */
export type ClipEffects = {
	/** 1 = neutral */
	brightness: number
	/** 1 = neutral */
	contrast: number
	/** 1 = neutral */
	saturation: number
	/** -100..100, 0 = neutral - a warm/cool overlay tint, not a physical colour-temperature model */
	temperature: number
	hueRotateDeg: number
	blurPx: number
	/** 0-1, 0 = neutral */
	vignette: number
	/** 0-1, 0 = neutral */
	grayscale: number
	/** 0-1, 0 = neutral */
	sepia: number
	/** 0-1, 0 = neutral */
	invert: number
	crop: CropRect | null
	chromaKey: ChromaKeySpec | null
}

type ClipBase = {
	id: string
	trackId: string
	/** position on the timeline, in project frames */
	startFrame: number
	durationFrames: number
	label: string
	enabled: boolean
	locked: boolean
	transform: Transform
	audio: ClipAudio
	effects: ClipEffects
}

export type VideoClip = ClipBase & {
	kind: 'video'
	assetId: string
	/** trim point into the *source asset*, in source seconds - also the held frame when `freezeFrame` is on */
	sourceInSeconds: number
	/** playback rate multiplier; 1 = normal, 2 = double speed, 0.5 = half */
	speed: number
	/** holds `sourceInSeconds` for the whole clip instead of advancing - a still frame, still playing on the timeline */
	freezeFrame: boolean
}

export type ImageClip = ClipBase & {
	kind: 'image'
	assetId: string
}

export type AudioClip = ClipBase & {
	kind: 'audio'
	assetId: string
	sourceInSeconds: number
	speed: number
}

export type TextClip = ClipBase & {
	kind: 'text'
	assetId: null
	text: TextStyle
}

export type Clip = VideoClip | ImageClip | AudioClip | TextClip

export type Marker = {
	id: string
	frame: number
	label: string
	color: string
}

export type ProjectSettings = {
	width: number
	height: number
	fps: number
	backgroundColor: string
}

export type UiState = {
	playheadFrame: number
	/** pixels per frame */
	zoom: number
	scrollFrame: number
	selection: string[]
	selectedTrackId: string | null
}

export type ProjectDoc = {
	schemaVersion: typeof EDITOR_SCHEMA_VERSION
	id: string
	name: string
	createdAt: number
	updatedAt: number
	settings: ProjectSettings
	trackOrder: string[]
	tracks: Record<string, Track>
	clips: Record<string, Clip>
	assets: Record<string, Asset>
	markers: Marker[]
}

/** UI state rides alongside the document but never enters the undo stack - see `lib/editor/engine.ts`. */
export type EditorSession = {
	doc: ProjectDoc
	ui: UiState
}

export function framesToSeconds(frames: number, fps: number): number {
	return frames / fps
}

export function secondsToFrames(seconds: number, fps: number, round: (n: number) => number = Math.round): number {
	return round(seconds * fps)
}

export function clampFrame(frame: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, frame))
}

export function clipEndFrame(clip: Clip): number {
	return clip.startFrame + clip.durationFrames
}

export function isMediaClip(clip: Clip): clip is VideoClip | ImageClip | AudioClip {
	return clip.kind !== 'text'
}

/** Source seconds a media clip consumes for one project-timeline frame, accounting for speed. */
export function sourceSecondsPerFrame(clip: VideoClip | AudioClip, fps: number): number {
	return (1 / fps) * clip.speed
}
