'use client'

/**
 * What the Resume Studio remembers between visits.
 *
 * The document itself was already kept in localStorage; this widens that to
 * everything else a session is made of - the conversation, the half-typed
 * prompt, which tool is open, the uploaded file and its audit - and moves the
 * whole thing into the shared vault, where a PDF can live next to it and the
 * 5 MB string cap no longer applies.
 */

import { normalizeStoredWorkspace, type StoredResumeWorkspace } from './toolkit'
import {
	DEFAULT_RESUME_DESIGN,
	EMPTY_RESUME,
	type AtsReport,
	type ResumeChatMessage,
} from './types'

export const RESUME_SESSION_KEY = 'resume:workspace'
export const RESUME_SESSION_VERSION = 1
/** the blob-store id the uploaded PDF/DOCX is filed under */
export const RESUME_UPLOAD_BLOB_ID = 'resume:upload'
/** the pre-vault draft, imported once and then left alone */
export const LEGACY_RESUME_KEY = 'rvs-resume-draft'

export type WorkspaceMode = 'create' | 'tailor' | 'toolkit' | 'analyze'

export type StoredAnalysis = {
	fileName: string
	extractedText: string
	report: AtsReport
	recommendations: string[]
	strengths: string[]
	model: string | null
	notice: string | null
}

export type ResumeSession = {
	workspace: StoredResumeWorkspace
	mode: WorkspaceMode
	messages: ResumeChatMessage[]
	/** the unsent prompt, so a refresh mid-sentence costs nothing */
	prompt: string
	textView: boolean
	selectedArtifactId: string | null
	analysis: StoredAnalysis | null
	/** set when the uploaded document's bytes are in the blob store */
	uploadBlobId: string | null
	uploadName: string | null
}

const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value)

const text = (value: unknown, max: number): string =>
	typeof value === 'string' ? value.slice(0, max) : ''

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
	return typeof value === 'string' && (allowed as readonly string[]).includes(value)
		? (value as T)
		: fallback
}

const MODES = ['create', 'tailor', 'toolkit', 'analyze'] as const
const ROLES = ['user', 'assistant'] as const
const TONES = ['normal', 'success', 'error', 'note'] as const

export const EMPTY_WORKSPACE: StoredResumeWorkspace = {
	version: 2,
	resume: EMPTY_RESUME,
	jobDescription: '',
	targetRole: '',
	targetCompany: '',
	evidenceNotes: '',
	design: DEFAULT_RESUME_DESIGN,
	versions: [],
	artifacts: [],
}

function normalizeMessages(value: unknown): ResumeChatMessage[] {
	if (!Array.isArray(value)) return []
	const messages: ResumeChatMessage[] = []
	for (const [index, raw] of value.slice(-30).entries()) {
		if (!isObject(raw) || typeof raw.text !== 'string') continue
		messages.push({
			id: typeof raw.id === 'string' ? raw.id : `restored-${index}`,
			role: oneOf(raw.role, ROLES, 'assistant'),
			text: raw.text.slice(0, 20_000),
			tone: raw.tone === undefined ? undefined : oneOf(raw.tone, TONES, 'normal'),
			model: typeof raw.model === 'string' ? raw.model : undefined,
		})
	}
	return messages
}

/**
 * The audit is only re-shown, never re-scored, so it is stored as it was
 * rendered. The report itself is trusted shape-wise but re-checked for the two
 * fields the preview actually reads.
 */
function normalizeAnalysis(value: unknown): StoredAnalysis | null {
	if (!isObject(value)) return null
	const report = value.report
	if (!isObject(report) || typeof report.score !== 'number') return null
	const extractedText = text(value.extractedText, 60_000)
	if (!extractedText) return null
	return {
		fileName: text(value.fileName, 260) || 'resume',
		extractedText,
		report: report as unknown as AtsReport,
		recommendations: Array.isArray(value.recommendations)
			? value.recommendations.filter((item): item is string => typeof item === 'string').slice(0, 20)
			: [],
		strengths: Array.isArray(value.strengths)
			? value.strengths.filter((item): item is string => typeof item === 'string').slice(0, 20)
			: [],
		model: typeof value.model === 'string' ? value.model : null,
		notice: typeof value.notice === 'string' ? value.notice : null,
	}
}

export function normalizeResumeSession(value: unknown): ResumeSession | null {
	if (!isObject(value)) return null
	const workspace = normalizeStoredWorkspace(value.workspace)
	if (!workspace) return null
	return {
		workspace,
		mode: oneOf(value.mode, MODES, 'create'),
		messages: normalizeMessages(value.messages),
		prompt: text(value.prompt, 14_000),
		textView: value.textView === true,
		selectedArtifactId:
			typeof value.selectedArtifactId === 'string' ? value.selectedArtifactId : null,
		analysis: normalizeAnalysis(value.analysis),
		uploadBlobId: typeof value.uploadBlobId === 'string' ? value.uploadBlobId : null,
		uploadName: typeof value.uploadName === 'string' ? value.uploadName : null,
	}
}

/**
 * Reads the pre-vault localStorage draft, once.
 *
 * Someone mid-application when this shipped should not lose their resume to the
 * upgrade, so the old key is imported on first load and then removed.
 */
export function importLegacyDraft(): StoredResumeWorkspace | null {
	if (typeof window === 'undefined') return null
	try {
		const saved = window.localStorage.getItem(LEGACY_RESUME_KEY)
		if (!saved) return null
		const workspace = normalizeStoredWorkspace(JSON.parse(saved) as unknown)
		return workspace
	} catch {
		return null
	}
}

export function dropLegacyDraft(): void {
	if (typeof window === 'undefined') return
	try {
		window.localStorage.removeItem(LEGACY_RESUME_KEY)
	} catch {
		/* storage is blocked; nothing to remove */
	}
}
