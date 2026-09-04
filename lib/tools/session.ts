'use client'

/**
 * What the Tools Studio remembers between visits: the clip, which tool was
 * open, and the knobs every tool was left at - so switching from "Rotate" to
 * "Mono to Stereo" and back doesn't reset either one's sliders.
 */

import type { OutputSettings, RunParams } from './runners'
import { normalizeCloudAsset, type CloudAsset } from '../cloud/types'

export const TOOLS_SESSION_KEY = 'tools:workspace'
export const TOOLS_SESSION_VERSION = 1
export const TOOLS_VIDEO_BLOB_ID = 'tools:video'

export type StoredToolsVideo = {
	blobId: string | null
	name: string
	sizeInBytes: number
	durationInSeconds: number
	width: number
	height: number
	fps: number
	hasAudio: boolean
	cloudAsset: CloudAsset | null
}

export type ToolsSession = {
	video: StoredToolsVideo | null
	selectedToolId: string | null
	paramsByTool: Record<string, RunParams>
	output: OutputSettings
	activeCategory: string | null
	query: string
}

export const DEFAULT_OUTPUT_SETTINGS: OutputSettings = { format: 'mp4', quality: 'high' }

const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value)

const str = (value: unknown, fallback: string): string => (typeof value === 'string' ? value : fallback)
const bool = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback)
const num = (value: unknown, fallback: number, min = -Infinity, max = Infinity): number =>
	typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
	return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback
}

const FORMATS = ['mp4', 'webm'] as const
const QUALITIES = ['draft', 'high', 'max'] as const

function normalizeVideo(value: unknown): StoredToolsVideo | null {
	if (!isObject(value)) return null
	const durationInSeconds = num(value.durationInSeconds, 0, 0)
	const width = Math.round(num(value.width, 0, 0))
	const height = Math.round(num(value.height, 0, 0))
	if (!durationInSeconds || !width || !height) return null
	const blobId = typeof value.blobId === 'string' ? value.blobId : null
	const cloudAsset = normalizeCloudAsset(value.cloudAsset)
	if (!blobId && !cloudAsset) return null
	return {
		blobId,
		name: str(value.name, 'video'),
		sizeInBytes: Math.round(num(value.sizeInBytes, 0, 0)),
		durationInSeconds,
		width,
		height,
		fps: num(value.fps, 30, 1, 240),
		hasAudio: bool(value.hasAudio, true),
		cloudAsset,
	}
}

/** Keeps a params object down to the JSON-safe primitives a tool ever writes into it. */
function normalizeParams(value: unknown): RunParams {
	if (!isObject(value)) return {}
	const out: RunParams = {}
	for (const [key, entry] of Object.entries(value).slice(0, 64)) {
		if (typeof entry === 'string' || typeof entry === 'boolean') out[key] = entry
		else if (typeof entry === 'number' && Number.isFinite(entry)) out[key] = entry
	}
	return out
}

function normalizeParamsByTool(value: unknown): Record<string, RunParams> {
	if (!isObject(value)) return {}
	const out: Record<string, RunParams> = {}
	for (const [toolId, params] of Object.entries(value).slice(0, 128)) {
		out[toolId] = normalizeParams(params)
	}
	return out
}

function normalizeOutput(value: unknown): OutputSettings {
	if (!isObject(value)) return DEFAULT_OUTPUT_SETTINGS
	return {
		format: oneOf(value.format, FORMATS, DEFAULT_OUTPUT_SETTINGS.format),
		quality: oneOf(value.quality, QUALITIES, DEFAULT_OUTPUT_SETTINGS.quality),
	}
}

export function normalizeToolsSession(value: unknown): ToolsSession | null {
	if (!isObject(value)) return null
	return {
		video: normalizeVideo(value.video),
		selectedToolId: typeof value.selectedToolId === 'string' ? value.selectedToolId : null,
		paramsByTool: normalizeParamsByTool(value.paramsByTool),
		output: normalizeOutput(value.output),
		activeCategory: typeof value.activeCategory === 'string' ? value.activeCategory : null,
		query: str(value.query, ''),
	}
}
