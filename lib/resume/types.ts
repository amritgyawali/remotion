export type ResumeContact = {
	name: string
	title: string
	email: string
	phone: string
	location: string
	linkedin: string
	website: string
}

export type ResumeExperience = {
	id: string
	company: string
	role: string
	location: string
	startDate: string
	endDate: string
	bullets: string[]
}

export type ResumeEducation = {
	id: string
	institution: string
	degree: string
	location: string
	startDate: string
	endDate: string
	details: string
}

export type ResumeProject = {
	id: string
	name: string
	link: string
	description: string
	bullets: string[]
}

export type ResumeCertification = {
	id: string
	name: string
	issuer: string
	date: string
}

export type ResumeData = {
	contact: ResumeContact
	summary: string
	skills: string[]
	experience: ResumeExperience[]
	education: ResumeEducation[]
	projects: ResumeProject[]
	certifications: ResumeCertification[]
}

export type AtsCheck = {
	id: string
	label: string
	points: number
	maxPoints: number
	passed: boolean
	detail: string
	fix?: string
}

export type AtsCategory = {
	id: 'contact' | 'structure' | 'targeting' | 'impact' | 'writing' | 'parsing'
	label: string
	points: number
	maxPoints: number
	percentage: number
	detail: string
}

export type AtsKeyword = {
	keyword: string
	kind: 'hard skill' | 'soft skill' | 'role term'
	jobMentions: number
	resumeMentions: number
	matched: boolean
}

export type AtsReport = {
	score: number
	grade: 'Excellent' | 'Strong' | 'Developing' | 'Needs work'
	summary: string
	checks: AtsCheck[]
	improvements: string[]
	matchedKeywords: string[]
	missingKeywords: string[]
	categories: AtsCategory[]
	keywords: AtsKeyword[]
	stats: {
		wordCount: number
		bulletCount: number
		quantifiedBullets: number
		actionLedBullets: number
		strongBullets: number
		weakBullets: number
		keywordCoverage: number | null
	}
}

export type ResumeTemplate = 'classic' | 'modern' | 'compact'
export type ResumePageSize = 'letter' | 'a4'

export type ResumeDesign = {
	template: ResumeTemplate
	pageSize: ResumePageSize
	accent: string
	fontScale: number
	sectionSpacing: number
}

export type ResumeVersion = {
	id: string
	name: string
	createdAt: string
	resume: ResumeData
	jobDescription: string
	targetRole: string
	targetCompany: string
	design: ResumeDesign
}

export type CareerToolId = 'cover-letter' | 'recruiter-email' | 'linkedin-profile' | 'interview-prep'

export type CareerArtifact = {
	id: string
	tool: CareerToolId
	title: string
	content: string
	createdAt: string
	model: string | null
}

export type ResumeChatMessage = {
	id: string
	role: 'user' | 'assistant'
	text: string
	tone?: 'normal' | 'success' | 'error' | 'note'
	model?: string
}

export const EMPTY_RESUME: ResumeData = {
	contact: {
		name: '',
		title: '',
		email: '',
		phone: '',
		location: '',
		linkedin: '',
		website: '',
	},
	summary: '',
	skills: [],
	experience: [],
	education: [],
	projects: [],
	certifications: [],
}

export const DEFAULT_RESUME_DESIGN: ResumeDesign = {
	template: 'classic',
	pageSize: 'letter',
	accent: '#334155',
	fontScale: 1,
	sectionSpacing: 1,
}

export function normalizeResumeDesign(value: unknown): ResumeDesign {
	const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
	const template: ResumeTemplate = raw.template === 'modern' || raw.template === 'compact' ? raw.template : 'classic'
	const pageSize: ResumePageSize = raw.pageSize === 'a4' ? 'a4' : 'letter'
	const accent = typeof raw.accent === 'string' && /^#[0-9a-f]{6}$/i.test(raw.accent) ? raw.accent : DEFAULT_RESUME_DESIGN.accent
	const fontScale = typeof raw.fontScale === 'number' ? Math.min(1.12, Math.max(0.88, raw.fontScale)) : 1
	const sectionSpacing = typeof raw.sectionSpacing === 'number' ? Math.min(1.2, Math.max(0.78, raw.sectionSpacing)) : 1
	return { template, pageSize, accent, fontScale, sectionSpacing }
}

const clean = (value: unknown, max = 500): string =>
	typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : ''

const cleanList = (value: unknown, maxItems: number, maxLength = 300): string[] =>
	Array.isArray(value)
		? value.map((item) => clean(item, maxLength)).filter(Boolean).slice(0, maxItems)
		: []

const identifier = (prefix: string, index: number, raw?: unknown): string => {
	const supplied = clean(raw, 80).replace(/[^a-zA-Z0-9_-]/g, '')
	return supplied || `${prefix}-${index + 1}`
}

/** Treat model output as untrusted input and narrow it into the editor contract. */
export function normalizeResume(value: unknown): ResumeData {
	const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
	const contact =
		raw.contact && typeof raw.contact === 'object'
			? (raw.contact as Record<string, unknown>)
			: {}
	const experience = Array.isArray(raw.experience) ? raw.experience : []
	const education = Array.isArray(raw.education) ? raw.education : []
	const projects = Array.isArray(raw.projects) ? raw.projects : []
	const certifications = Array.isArray(raw.certifications) ? raw.certifications : []

	return {
		contact: {
			name: clean(contact.name, 120),
			title: clean(contact.title, 140),
			email: clean(contact.email, 180),
			phone: clean(contact.phone, 80),
			location: clean(contact.location, 160),
			linkedin: clean(contact.linkedin, 240),
			website: clean(contact.website, 240),
		},
		summary: clean(raw.summary, 1_200),
		skills: cleanList(raw.skills, 40, 80),
		experience: experience.slice(0, 12).map((item, index) => {
			const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : {}
			return {
				id: identifier('experience', index, row.id),
				company: clean(row.company, 180),
				role: clean(row.role, 180),
				location: clean(row.location, 140),
				startDate: clean(row.startDate, 60),
				endDate: clean(row.endDate, 60),
				bullets: cleanList(row.bullets, 10, 500),
			}
		}),
		education: education.slice(0, 8).map((item, index) => {
			const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : {}
			return {
				id: identifier('education', index, row.id),
				institution: clean(row.institution, 180),
				degree: clean(row.degree, 220),
				location: clean(row.location, 140),
				startDate: clean(row.startDate, 60),
				endDate: clean(row.endDate, 60),
				details: clean(row.details, 500),
			}
		}),
		projects: projects.slice(0, 10).map((item, index) => {
			const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : {}
			return {
				id: identifier('project', index, row.id),
				name: clean(row.name, 180),
				link: clean(row.link, 240),
				description: clean(row.description, 500),
				bullets: cleanList(row.bullets, 8, 500),
			}
		}),
		certifications: certifications.slice(0, 12).map((item, index) => {
			const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : {}
			return {
				id: identifier('certification', index, row.id),
				name: clean(row.name, 180),
				issuer: clean(row.issuer, 180),
				date: clean(row.date, 60),
			}
		}),
	}
}

export function resumeToPlainText(resume: ResumeData): string {
	const lines: string[] = []
	const add = (...values: string[]) => lines.push(...values.filter(Boolean))
	add(resume.contact.name, resume.contact.title)
	add(
		[
			resume.contact.email,
			resume.contact.phone,
			resume.contact.location,
			resume.contact.linkedin,
			resume.contact.website,
		]
			.filter(Boolean)
			.join(' | '),
	)
	if (resume.summary) add('PROFESSIONAL SUMMARY', resume.summary)
	if (resume.skills.length) add('SKILLS', resume.skills.join(', '))
	if (resume.experience.length) {
		add('PROFESSIONAL EXPERIENCE')
		for (const item of resume.experience) {
			add(
				[item.role, item.company, item.location].filter(Boolean).join(' | '),
				[item.startDate, item.endDate].filter(Boolean).join(' - '),
				...item.bullets.map((bullet) => `- ${bullet}`),
			)
		}
	}
	if (resume.projects.length) {
		add('PROJECTS')
		for (const item of resume.projects) {
			add([item.name, item.link].filter(Boolean).join(' | '), item.description)
			add(...item.bullets.map((bullet) => `- ${bullet}`))
		}
	}
	if (resume.education.length) {
		add('EDUCATION')
		for (const item of resume.education) {
			add(
				[item.degree, item.institution].filter(Boolean).join(' | '),
				[item.startDate, item.endDate].filter(Boolean).join(' - '),
				item.details,
			)
		}
	}
	if (resume.certifications.length) {
		add('CERTIFICATIONS')
		for (const item of resume.certifications) {
			add([item.name, item.issuer, item.date].filter(Boolean).join(' | '))
		}
	}
	return lines.join('\n')
}
