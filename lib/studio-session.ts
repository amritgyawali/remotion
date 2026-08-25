'use client'

/**
 * What the Video Studio remembers between visits.
 *
 * A generated composition is the product of a conversation - the prompt, the
 * follow-ups, the file that came back - and all of it is text, so the whole
 * workspace fits in one snapshot with no blob store involved.
 */

import { MAX_FILES } from './project'
import type { AiChatMessage } from '../components/AiCreator'
import type { RenderSettings, SourceFile, VirtualProject } from './types'

export const STUDIO_SESSION_KEY = 'studio:workspace'
export const STUDIO_SESSION_VERSION = 1

export type MobileTab = 'create' | 'preview' | 'export'

export type StudioSession = {
	project: VirtualProject | null
	selectedId: string | null
	messages: AiChatMessage[]
	/** the unsent brief in the composer, saved as it is typed */
	prompt: string
	render: RenderSettings
	mobileTab: MobileTab
}

const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value)

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
	return typeof value === 'string' && (allowed as readonly string[]).includes(value)
		? (value as T)
		: fallback
}

const RENDER_ENGINES = ['browser', 'server'] as const
const PRESETS = ['draft', 'high', 'max'] as const
const FORMATS = ['mp4', 'webm', 'gif', 'prores', 'png'] as const
const TABS = ['create', 'preview', 'export'] as const
const ROLES = ['user', 'assistant'] as const
const TONES = ['normal', 'success', 'error', 'note'] as const

function normalizeFiles(value: unknown): SourceFile[] {
	if (!Array.isArray(value)) return []
	const files: SourceFile[] = []
	for (const raw of value.slice(0, MAX_FILES)) {
		if (!isObject(raw)) continue
		if (typeof raw.path !== 'string' || typeof raw.contents !== 'string') continue
		if (!raw.path) continue
		files.push({ path: raw.path, contents: raw.contents })
	}
	return files
}

export function normalizeStoredProject(value: unknown): VirtualProject | null {
	if (!isObject(value)) return null
	const files = normalizeFiles(value.files)
	if (files.length === 0) return null
	const entry = typeof value.entry === 'string' ? value.entry : ''
	return {
		name: typeof value.name === 'string' ? value.name : 'Restored project',
		// An entry that no longer names a file would compile to nothing at all.
		entry: files.some((file) => file.path === entry) ? entry : files[0].path,
		files,
	}
}

function normalizeMessages(value: unknown): AiChatMessage[] {
	if (!Array.isArray(value)) return []
	const messages: AiChatMessage[] = []
	for (const [index, raw] of value.slice(-40).entries()) {
		if (!isObject(raw)) continue
		if (typeof raw.text !== 'string') continue
		messages.push({
			id: typeof raw.id === 'string' ? raw.id : `restored-${index}`,
			role: oneOf(raw.role, ROLES, 'assistant'),
			text: raw.text,
			tone: raw.tone === undefined ? undefined : oneOf(raw.tone, TONES, 'normal'),
			meta: Array.isArray(raw.meta) ? raw.meta.filter((item) => typeof item === 'string') : undefined,
		})
	}
	return messages
}

export function normalizeStoredRender(value: unknown, fallback: RenderSettings): RenderSettings {
	if (!isObject(value)) return fallback
	const number = (input: unknown, or: number, min: number, max: number) =>
		typeof input === 'number' && Number.isFinite(input) ? Math.min(max, Math.max(min, input)) : or
	return {
		engine: oneOf(value.engine, RENDER_ENGINES, fallback.engine),
		preset: oneOf(value.preset, PRESETS, fallback.preset),
		format: oneOf(value.format, FORMATS, fallback.format),
		audioEnabled: typeof value.audioEnabled === 'boolean' ? value.audioEnabled : fallback.audioEnabled,
		scale: number(value.scale, fallback.scale, 0.25, 4),
		previewSeconds: Math.round(number(value.previewSeconds, fallback.previewSeconds, 0, 3_600)),
	}
}

export function normalizeStudioSession(
	value: unknown,
	defaults: { render: RenderSettings },
): StudioSession | null {
	if (!isObject(value)) return null
	return {
		project: normalizeStoredProject(value.project),
		selectedId: typeof value.selectedId === 'string' ? value.selectedId : null,
		messages: normalizeMessages(value.messages),
		prompt: typeof value.prompt === 'string' ? value.prompt.slice(0, 12_000) : '',
		render: normalizeStoredRender(value.render, defaults.render),
		mobileTab: oneOf(value.mobileTab, TABS, 'preview'),
	}
}
