'use client'

/**
 * What the Silence Studio remembers between visits.
 *
 * The unusual part is the level track. Analysing a long clip is the one slow
 * step in this studio, and it produces a Float32Array - which JSON turns into a
 * hundred thousand quoted numbers, so it has no business in a snapshot. It is
 * written to the blob store as raw bytes instead, and the snapshot carries only
 * its shape. A refresh therefore comes back with the waveform already drawn and
 * every slider live, without decoding a frame.
 */

import { DEFAULT_CUT_SETTINGS, type CutSettings, type GapOverrides, type SilenceAction } from './plan'
import type { AudioAnalysis } from './analyze'
import type { RenderFormat, RenderQuality } from './render'

export const SILENCE_SESSION_KEY = 'silence:workspace'
export const SILENCE_SESSION_VERSION = 1
/** the blob-store id the current clip's bytes are filed under */
export const SILENCE_VIDEO_BLOB_ID = 'silence:video'
/** and the id its measured level track is filed under */
export const SILENCE_LEVELS_BLOB_ID = 'silence:levels'

export type StoredVideoFacts = {
	blobId: string | null
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

export type StoredAnalysis = {
	frames: number
	frameMs: number
	durationMs: number
	peakDb: number
	noiseFloorDb: number
	silent: boolean
	sampleRate: number
	channels: number
}

export type ExportSettings = {
	format: RenderFormat
	quality: RenderQuality
	/** null keeps the clip's own frame rate */
	fps: number | null
	scale: number
	includeAudio: boolean
}

export const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
	format: 'mp4',
	quality: 'high',
	fps: null,
	scale: 1,
	includeAudio: true,
}

export type SilenceSession = {
	video: StoredVideoFacts | null
	analysis: StoredAnalysis | null
	settings: CutSettings
	overrides: GapOverrides
	exportSettings: ExportSettings
	/** preview playhead, in output milliseconds */
	positionMs: number
	previewOriginal: boolean
	tab: 'detect' | 'export'
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

const ACTIONS = ['remove', 'speed', 'keep'] as const
const FORMATS = ['mp4', 'webm'] as const
const QUALITIES = ['draft', 'high', 'max'] as const
const TABS = ['detect', 'export'] as const

export function normalizeSettings(value: unknown): CutSettings {
	if (!isObject(value)) return DEFAULT_CUT_SETTINGS
	return {
		sensitivityDb: num(value.sensitivityDb, DEFAULT_CUT_SETTINGS.sensitivityDb, 0.5, 24),
		minSilenceMs: Math.round(num(value.minSilenceMs, DEFAULT_CUT_SETTINGS.minSilenceMs, 80, 10_000)),
		paddingMs: Math.round(num(value.paddingMs, DEFAULT_CUT_SETTINGS.paddingMs, 0, 1_000)),
		minSpeechMs: Math.round(num(value.minSpeechMs, DEFAULT_CUT_SETTINGS.minSpeechMs, 0, 2_000)),
		action: value.action === 'speed' ? 'speed' : 'remove',
		speed: num(value.speed, DEFAULT_CUT_SETTINGS.speed, 1, 16),
		keepBeatMs: Math.round(num(value.keepBeatMs, DEFAULT_CUT_SETTINGS.keepBeatMs, 0, 2_000)),
	}
}

function normalizeOverrides(value: unknown): GapOverrides {
	if (!isObject(value)) return {}
	const out: GapOverrides = {}
	// Bounded on the way in: a snapshot from a broken build must not be able to
	// hand the plan builder a hundred thousand keys to scan per rebuild.
	for (const [key, action] of Object.entries(value).slice(0, 4_000)) {
		if (!/^-?\d+$/.test(key)) continue
		if (typeof action !== 'string') continue
		out[key] = oneOf<SilenceAction>(action, ACTIONS, 'remove')
	}
	return out
}

function normalizeVideo(value: unknown): StoredVideoFacts | null {
	if (!isObject(value)) return null
	const durationInSeconds = num(value.durationInSeconds, 0, 0)
	const width = Math.round(num(value.width, 0, 0))
	const height = Math.round(num(value.height, 0, 0))
	if (!durationInSeconds || !width || !height) return null

	const blobId = typeof value.blobId === 'string' ? value.blobId : null
	const url = typeof value.url === 'string' ? value.url : null
	if (!blobId && !url) return null

	return {
		blobId,
		url,
		name: str(value.name, 'video'),
		kind: value.kind === 'url' ? 'url' : 'file',
		sizeInBytes: Math.round(num(value.sizeInBytes, 0, 0)),
		durationInSeconds,
		width,
		height,
		fps: num(value.fps, 30, 1, 240),
		hasAudio: bool(value.hasAudio, true),
	}
}

function normalizeAnalysis(value: unknown): StoredAnalysis | null {
	if (!isObject(value)) return null
	const frames = Math.round(num(value.frames, 0, 0))
	const frameMs = num(value.frameMs, 10, 1, 100)
	if (frames <= 0) return null
	return {
		frames,
		frameMs,
		durationMs: num(value.durationMs, frames * frameMs, 0),
		peakDb: num(value.peakDb, -100, -200, 20),
		noiseFloorDb: num(value.noiseFloorDb, -60, -200, 20),
		silent: bool(value.silent, false),
		sampleRate: Math.round(num(value.sampleRate, 48_000, 1_000, 384_000)),
		channels: Math.round(num(value.channels, 1, 1, 8)),
	}
}

export function normalizeExportSettings(value: unknown): ExportSettings {
	if (!isObject(value)) return DEFAULT_EXPORT_SETTINGS
	return {
		format: oneOf(value.format, FORMATS, DEFAULT_EXPORT_SETTINGS.format),
		quality: oneOf(value.quality, QUALITIES, DEFAULT_EXPORT_SETTINGS.quality),
		fps: value.fps === null || value.fps === undefined ? null : Math.round(num(value.fps, 30, 1, 120)),
		scale: num(value.scale, 1, 0.25, 1),
		includeAudio: bool(value.includeAudio, true),
	}
}

export function normalizeSilenceSession(value: unknown): SilenceSession | null {
	if (!isObject(value)) return null
	return {
		video: normalizeVideo(value.video),
		analysis: normalizeAnalysis(value.analysis),
		settings: normalizeSettings(value.settings),
		overrides: normalizeOverrides(value.overrides),
		exportSettings: normalizeExportSettings(value.exportSettings),
		positionMs: num(value.positionMs, 0, 0),
		previewOriginal: bool(value.previewOriginal, false),
		tab: oneOf(value.tab, TABS, 'detect'),
	}
}

/* --------------------------------------------------- the level track */

/**
 * The measured levels, as bytes.
 *
 * A Float32Array's own buffer goes straight into a Blob, so a re-read is a
 * single allocation and no parsing at all.
 */
export function levelsToBlob(frameDb: Float32Array): Blob {
	const copy = new Float32Array(frameDb)
	return new Blob([copy.buffer], { type: 'application/octet-stream' })
}

export async function levelsFromBlob(blob: Blob, expectedFrames: number): Promise<Float32Array | null> {
	try {
		const bytes = await blob.arrayBuffer()
		if (bytes.byteLength % 4 !== 0) return null
		const levels = new Float32Array(bytes)
		// A track of the wrong length belongs to some other clip.
		if (expectedFrames > 0 && levels.length !== expectedFrames) return null
		return levels
	} catch {
		return null
	}
}

export function analysisFacts(analysis: AudioAnalysis): StoredAnalysis {
	return {
		frames: analysis.frameDb.length,
		frameMs: analysis.frameMs,
		durationMs: analysis.durationMs,
		peakDb: analysis.peakDb,
		noiseFloorDb: analysis.noiseFloorDb,
		silent: analysis.silent,
		sampleRate: analysis.sampleRate,
		channels: analysis.channels,
	}
}

export function analysisFromFacts(facts: StoredAnalysis, frameDb: Float32Array): AudioAnalysis {
	return {
		frameDb,
		frameMs: facts.frameMs,
		durationMs: facts.durationMs,
		peakDb: facts.peakDb,
		noiseFloorDb: facts.noiseFloorDb,
		silent: facts.silent,
		sampleRate: facts.sampleRate,
		channels: facts.channels,
	}
}
