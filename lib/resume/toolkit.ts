import type { CareerArtifact, ResumeData, ResumeDesign, ResumeVersion } from './types'
import { DEFAULT_RESUME_DESIGN, normalizeResume, normalizeResumeDesign } from './types'

const STRONG_ACTION_VERBS = new Set(
	'achieved accelerated analyzed architected automated built delivered designed developed directed drove enabled engineered established executed expanded generated grew implemented improved increased launched led managed mentored migrated optimized orchestrated owned produced reduced resolved scaled secured simplified spearheaded streamlined strengthened transformed'.split(' '),
)

const WEAK_PHRASES = ['responsible for', 'worked on', 'helped with', 'duties included', 'tasked with', 'participated in']

export type BulletReview = {
	id: string
	text: string
	score: number
	grade: 'strong' | 'developing' | 'weak'
	checks: Array<{ label: string; passed: boolean }>
	suggestion: string
}

export type StoredResumeWorkspace = {
	version: 2
	resume: ResumeData
	jobDescription: string
	targetRole: string
	targetCompany: string
	evidenceNotes: string
	design: ResumeDesign
	versions: ResumeVersion[]
	artifacts: CareerArtifact[]
}

const cleanText = (value: unknown, max: number) =>
	typeof value === 'string' ? value.trim().slice(0, max) : ''

export function reviewResumeBullets(resume: ResumeData): BulletReview[] {
	const rows = [
		...resume.experience.flatMap((item) => item.bullets.map((text, index) => ({ id: `${item.id}-experience-${index}`, text }))),
		...resume.projects.flatMap((item) => item.bullets.map((text, index) => ({ id: `${item.id}-project-${index}`, text }))),
	]

	return rows.map(({ id, text }) => {
		const words = text.trim().split(/\s+/).filter(Boolean)
		const first = words[0]?.toLowerCase().replace(/[^a-z-]/g, '') ?? ''
		const action = STRONG_ACTION_VERBS.has(first)
		const evidence = /(?:\d|%|\$|£|€|₹|₨|users?|customers?|hours?|days?|weeks?|months?)/i.test(text)
		const focused = words.length >= 8 && words.length <= 32
		const direct = !WEAK_PHRASES.some((phrase) => text.toLowerCase().includes(phrase))
		const result = /\b(?:increasing|decreasing|reducing|improving|saving|growing|resulting|leading to|which|by)\b/i.test(text) || evidence
		const checks = [
			{ label: 'Strong opening verb', passed: action },
			{ label: 'Specific evidence or scale', passed: evidence },
			{ label: '8-32 focused words', passed: focused },
			{ label: 'No weak responsibility phrase', passed: direct },
			{ label: 'Outcome is clear', passed: result },
		]
		const score = checks.reduce((total, item) => total + (item.passed ? 20 : 0), 0)
		const missing = checks.filter((item) => !item.passed).map((item) => item.label.toLowerCase())
		return {
			id,
			text,
			score,
			grade: score >= 80 ? 'strong' : score >= 50 ? 'developing' : 'weak',
			checks,
			suggestion: missing.length
				? `Improve ${missing.slice(0, 2).join(' and ')}. Add only evidence you can verify.`
				: 'This bullet has a clear action, scope, and result.',
		}
	})
}

function normalizeVersion(value: unknown, index: number): ResumeVersion | null {
	if (!value || typeof value !== 'object') return null
	const raw = value as Record<string, unknown>
	const createdAt = cleanText(raw.createdAt, 80) || new Date(0).toISOString()
	return {
		id: cleanText(raw.id, 100) || `version-${index}`,
		name: cleanText(raw.name, 100) || `Resume version ${index + 1}`,
		createdAt,
		resume: normalizeResume(raw.resume),
		jobDescription: cleanText(raw.jobDescription, 14_000),
		targetRole: cleanText(raw.targetRole, 180),
		targetCompany: cleanText(raw.targetCompany, 180),
		design: normalizeResumeDesign(raw.design),
	}
}

function normalizeArtifact(value: unknown, index: number): CareerArtifact | null {
	if (!value || typeof value !== 'object') return null
	const raw = value as Record<string, unknown>
	const allowed = new Set(['cover-letter', 'recruiter-email', 'linkedin-profile', 'interview-prep'])
	if (typeof raw.tool !== 'string' || !allowed.has(raw.tool)) return null
	return {
		id: cleanText(raw.id, 100) || `artifact-${index}`,
		tool: raw.tool as CareerArtifact['tool'],
		title: cleanText(raw.title, 180) || 'Career document',
		content: cleanText(raw.content, 20_000),
		createdAt: cleanText(raw.createdAt, 80) || new Date(0).toISOString(),
		model: cleanText(raw.model, 180) || null,
	}
}

export function normalizeStoredWorkspace(value: unknown): StoredResumeWorkspace | null {
	if (!value || typeof value !== 'object') return null
	const raw = value as Record<string, unknown>
	if (raw.version !== 2) return null
	return {
		version: 2,
		resume: normalizeResume(raw.resume),
		jobDescription: cleanText(raw.jobDescription, 14_000),
		targetRole: cleanText(raw.targetRole, 180),
		targetCompany: cleanText(raw.targetCompany, 180),
		evidenceNotes: cleanText(raw.evidenceNotes, 8_000),
		design: normalizeResumeDesign(raw.design ?? DEFAULT_RESUME_DESIGN),
		versions: Array.isArray(raw.versions)
			? raw.versions.map(normalizeVersion).filter((item): item is ResumeVersion => Boolean(item)).slice(0, 20)
			: [],
		artifacts: Array.isArray(raw.artifacts)
			? raw.artifacts.map(normalizeArtifact).filter((item): item is CareerArtifact => Boolean(item)).slice(0, 20)
			: [],
	}
}

export function safeDocumentName(value: string, fallback = 'career-document'): string {
	return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || fallback
}

export function downloadTextFile(name: string, content: string, mime = 'text/plain;charset=utf-8'): void {
	const blob = new Blob([content], { type: mime })
	const url = URL.createObjectURL(blob)
	const anchor = window.document.createElement('a')
	anchor.href = url
	anchor.download = name
	anchor.click()
	window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
}
