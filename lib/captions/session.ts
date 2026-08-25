'use client'

/**
 * What the Subtitle Studio remembers between visits.
 *
 * A subtitle pass is long work - upload, transcribe, re-time forty cues, pick a
 * look - and losing it to an accidental refresh is the one failure this tool
 * cannot afford. So the whole workspace is a plain, serializable object, saved
 * continuously, and every field is re-validated on the way back in: a snapshot
 * written by an older build must degrade to a default, never to a crash.
 *
 * The video itself is the exception. Its bytes live in the blob store under
 * `blobId`; only the id and the measured facts travel in here.
 */

import { DEFAULT_CAPTION_STYLE, DEFAULT_LAYOUT } from './style-presets'
import { isCaptionFontId } from './fonts'
import type {
	CaptionCue,
	CaptionLayoutOptions,
	CaptionStyle,
	CaptionToken,
	CaptionVideoSource,
	TranscribeEngine,
	TranscriptOrigin,
	WhisperModelId,
} from './types'
import type { SpeechSegment } from './vad'
import type { RenderSettings } from '../types'

export const CAPTION_SESSION_KEY = 'captions:workspace'
export const CAPTION_SESSION_VERSION = 1
/** the blob-store id the current clip's bytes are filed under */
export const CAPTION_VIDEO_BLOB_ID = 'captions:video'

export type TranscriptMode = 'auto' | 'write' | 'import'

export type StoredVideoFacts = {
	/** set for an upload; null when the source was a pasted address */
	blobId: string | null
	/** the original https:// address, kept so a URL source restores without a copy */
	url: string | null
	name: string
	kind: 'file' | 'url'
	sizeInBytes: number
	durationInSeconds: number
	width: number
	height: number
	fps: number
	hasAudio: boolean
}

export type CaptionSession = {
	video: StoredVideoFacts | null
	fps: number
	cues: CaptionCue[]
	origin: TranscriptOrigin
	style: CaptionStyle
	layout: CaptionLayoutOptions
	handEdited: boolean
	mode: TranscriptMode
	transcriptText: string
	speechProfile: string
	whisperModel: WhisperModelId
	whisperLanguage: string
	engine: TranscribeEngine
	cloudModel: string | null
	polish: boolean
	restoreEnglish: boolean
	tab: 'design' | 'tools' | 'export'
	render: RenderSettings
	/** where speech sits in the audio, so re-cutting lines still breaks on pauses */
	speech: SpeechSegment[]
	/** playhead in ms, so the preview comes back parked where it was left */
	positionMs: number
}

/* ------------------------------------------------------------- guards */

const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value)

const str = (value: unknown, fallback: string): string =>
	typeof value === 'string' ? value : fallback

const bool = (value: unknown, fallback: boolean): boolean =>
	typeof value === 'boolean' ? value : fallback

const num = (value: unknown, fallback: number, min = -Infinity, max = Infinity): number =>
	typeof value === 'number' && Number.isFinite(value)
		? Math.min(max, Math.max(min, value))
		: fallback

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
	return typeof value === 'string' && (allowed as readonly string[]).includes(value)
		? (value as T)
		: fallback
}

// 'nvidia' is the pre-Groq spelling of both unions. Keeping it here as a
// legacy input - mapped to its replacement below - means a snapshot written
// before the hosted recogniser was generalised still restores.
const ORIGINS = ['whisper', 'cloud', 'srt', 'text', 'none'] as const
const ENGINES = ['auto', 'cloud', 'device'] as const
const LEGACY_CLOUD = 'nvidia'
const MODES = ['auto', 'write', 'import'] as const
const TABS = ['design', 'tools', 'export'] as const
const WHISPER_MODELS = ['tiny', 'tiny.en', 'base', 'base.en', 'small', 'small.en'] as const
const RENDER_ENGINES = ['browser', 'server'] as const
const PRESETS = ['draft', 'high', 'max'] as const
const FORMATS = ['mp4', 'webm', 'gif', 'prores', 'png'] as const

/* ------------------------------------------------------- normalizers */

function normalizeTokens(value: unknown, startMs: number, endMs: number): CaptionToken[] {
	if (!Array.isArray(value)) return []
	return value
		.filter(isObject)
		.map((token) => ({
			text: str(token.text, ''),
			fromMs: num(token.fromMs, startMs, 0),
			toMs: num(token.toMs, endMs, 0),
		}))
		.filter((token) => token.text.length > 0)
}

export function normalizeStoredCues(value: unknown): CaptionCue[] {
	if (!Array.isArray(value)) return []
	const cues: CaptionCue[] = []
	for (const [index, raw] of value.entries()) {
		if (!isObject(raw)) continue
		const startMs = num(raw.startMs, 0, 0)
		const endMs = Math.max(startMs + 1, num(raw.endMs, startMs + 1000, 0))
		const text = str(raw.text, '')
		cues.push({
			id: str(raw.id, `restored-${index}`),
			text,
			startMs,
			endMs,
			tokens: normalizeTokens(raw.tokens, startMs, endMs),
		})
	}
	return cues
}

/**
 * Rebuilds a style by walking the *current* CaptionStyle keys.
 *
 * Driving the loop from the live default rather than from the stored object is
 * what makes a field added after the snapshot was written appear with its
 * default instead of as `undefined` in the middle of a render.
 */
export function normalizeStoredStyle(value: unknown): CaptionStyle {
	if (!isObject(value)) return DEFAULT_CAPTION_STYLE
	const next: CaptionStyle = { ...DEFAULT_CAPTION_STYLE }

	for (const key of Object.keys(DEFAULT_CAPTION_STYLE) as (keyof CaptionStyle)[]) {
		const stored = value[key]
		if (stored === undefined || stored === null) continue
		const fallback = DEFAULT_CAPTION_STYLE[key]
		if (Array.isArray(fallback)) {
			if (Array.isArray(stored)) {
				Object.assign(next, { [key]: stored.filter((item) => typeof item === 'string') })
			}
			continue
		}
		if (typeof stored === typeof fallback) Object.assign(next, { [key]: stored })
	}

	// A face id from another build would leave the composition loading a font
	// that no longer exists, so both id fields are checked against the live kit.
	if (!isCaptionFontId(next.fontId)) next.fontId = DEFAULT_CAPTION_STYLE.fontId
	if (!isCaptionFontId(next.devanagariFontId)) {
		next.devanagariFontId = DEFAULT_CAPTION_STYLE.devanagariFontId
	}
	return next
}

export function normalizeStoredLayout(value: unknown): CaptionLayoutOptions {
	if (!isObject(value)) return DEFAULT_LAYOUT
	return {
		maxWordsPerCue: Math.round(num(value.maxWordsPerCue, DEFAULT_LAYOUT.maxWordsPerCue, 1, 24)),
		maxCharactersPerCue: Math.round(
			num(value.maxCharactersPerCue, DEFAULT_LAYOUT.maxCharactersPerCue, 8, 120),
		),
		maxCueDurationMs: Math.round(
			num(value.maxCueDurationMs, DEFAULT_LAYOUT.maxCueDurationMs, 400, 20_000),
		),
		splitOnGapMs: Math.round(num(value.splitOnGapMs, DEFAULT_LAYOUT.splitOnGapMs, 60, 5_000)),
		minCueMs: Math.round(num(value.minCueMs, DEFAULT_LAYOUT.minCueMs, 100, 8_000)),
	}
}

export function normalizeStoredRenderSettings(
	value: unknown,
	fallback: RenderSettings,
): RenderSettings {
	if (!isObject(value)) return fallback
	return {
		engine: oneOf(value.engine, RENDER_ENGINES, fallback.engine),
		preset: oneOf(value.preset, PRESETS, fallback.preset),
		format: oneOf(value.format, FORMATS, fallback.format),
		audioEnabled: bool(value.audioEnabled, fallback.audioEnabled),
		scale: num(value.scale, fallback.scale, 0.25, 4),
		previewSeconds: Math.round(num(value.previewSeconds, fallback.previewSeconds, 0, 3_600)),
	}
}

function normalizeStoredVideo(value: unknown): StoredVideoFacts | null {
	if (!isObject(value)) return null
	const kind = value.kind === 'url' ? 'url' : 'file'
	const durationInSeconds = num(value.durationInSeconds, 0, 0)
	const width = Math.round(num(value.width, 0, 0))
	const height = Math.round(num(value.height, 0, 0))
	if (!durationInSeconds || !width || !height) return null

	const blobId = typeof value.blobId === 'string' ? value.blobId : null
	const url = typeof value.url === 'string' ? value.url : null
	// Neither the bytes nor an address: there is nothing left to restore from.
	if (!blobId && !url) return null

	return {
		blobId,
		url,
		name: str(value.name, 'video'),
		kind,
		sizeInBytes: Math.round(num(value.sizeInBytes, 0, 0)),
		durationInSeconds,
		width,
		height,
		fps: num(value.fps, 30, 1, 240),
		hasAudio: bool(value.hasAudio, true),
	}
}

function normalizeSpeech(value: unknown): SpeechSegment[] {
	if (!Array.isArray(value)) return []
	return value
		.filter(isObject)
		.map((segment) => ({
			startMs: num(segment.startMs, 0, 0),
			endMs: num(segment.endMs, 0, 0),
		}))
		.filter((segment) => segment.endMs > segment.startMs)
}

export function normalizeCaptionSession(
	value: unknown,
	defaults: { render: RenderSettings },
): CaptionSession | null {
	if (!isObject(value)) return null

	return {
		video: normalizeStoredVideo(value.video),
		fps: Math.round(num(value.fps, 30, 1, 240)),
		cues: normalizeStoredCues(value.cues),
		origin: oneOf(value.origin === LEGACY_CLOUD ? 'cloud' : value.origin, ORIGINS, 'none'),
		style: normalizeStoredStyle(value.style),
		layout: normalizeStoredLayout(value.layout),
		handEdited: bool(value.handEdited, false),
		mode: oneOf(value.mode, MODES, 'auto'),
		transcriptText: str(value.transcriptText, '').slice(0, 400_000),
		speechProfile: str(value.speechProfile, 'nepali-english'),
		whisperModel: oneOf(value.whisperModel, WHISPER_MODELS, 'small'),
		whisperLanguage: str(value.whisperLanguage, 'ne'),
		engine: oneOf(value.engine === LEGACY_CLOUD ? 'cloud' : value.engine, ENGINES, 'auto'),
		cloudModel: typeof value.cloudModel === 'string' ? value.cloudModel : null,
		polish: bool(value.polish, true),
		restoreEnglish: bool(value.restoreEnglish, true),
		tab: oneOf(value.tab, TABS, 'design'),
		render: normalizeStoredRenderSettings(value.render, defaults.render),
		speech: normalizeSpeech(value.speech),
		positionMs: num(value.positionMs, 0, 0),
	}
}

/** Strips the live File and object URL back down to the facts worth storing. */
export function videoFactsOf(video: CaptionVideoSource, blobId: string | null): StoredVideoFacts {
	return {
		blobId: video.kind === 'file' ? blobId : null,
		url: video.kind === 'url' ? video.url : null,
		name: video.name,
		kind: video.kind,
		sizeInBytes: video.sizeInBytes,
		durationInSeconds: video.durationInSeconds,
		width: video.width,
		height: video.height,
		fps: video.fps,
		hasAudio: video.hasAudio,
	}
}

/**
 * Turns stored facts back into a live source.
 *
 * The measurements are reused rather than re-probed: demuxing a gigabyte again
 * would add seconds to a reload for numbers that cannot have changed.
 */
export function videoFromFacts(
	facts: StoredVideoFacts,
	file: File | null,
): CaptionVideoSource | null {
	if (facts.kind === 'file') {
		if (!file) return null
		return {
			url: URL.createObjectURL(file),
			name: facts.name,
			kind: 'file',
			sizeInBytes: facts.sizeInBytes || file.size,
			durationInSeconds: facts.durationInSeconds,
			width: facts.width,
			height: facts.height,
			fps: facts.fps,
			hasAudio: facts.hasAudio,
			file,
		}
	}

	if (!facts.url) return null
	return {
		url: facts.url,
		name: facts.name,
		kind: 'url',
		sizeInBytes: facts.sizeInBytes,
		durationInSeconds: facts.durationInSeconds,
		width: facts.width,
		height: facts.height,
		fps: facts.fps,
		hasAudio: facts.hasAudio,
		file: null,
	}
}
