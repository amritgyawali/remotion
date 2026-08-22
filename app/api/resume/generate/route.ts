import { scoreResume } from '../../../../lib/resume/ats'
import { requestNvidiaJson } from '../../../../lib/resume/nvidia'
import { normalizeResume, type ResumeData } from '../../../../lib/resume/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 180

const MAX_PROMPT = 14_000
const MAX_JOB_DESCRIPTION = 14_000

type GenerateBody = {
	prompt?: unknown
	jobDescription?: unknown
	targetRole?: unknown
	targetCompany?: unknown
	evidenceNotes?: unknown
	history?: unknown
	currentResume?: unknown
}

const SYSTEM_PROMPT = `You are an elite resume writer and ATS optimization specialist. Return JSON only.

Build or revise a truthful, ATS-friendly resume from the candidate's information. Never invent an employer, title, date, degree, certification, technology, metric, or achievement. Omit unavailable facts. Do not add placeholders. Rewrite supplied facts for clarity and impact without changing their meaning.

Rules:
1. Use a conventional one-column structure: contact, Professional Summary, Skills, Professional Experience, Projects when relevant, Education, Certifications when relevant.
2. The summary must be 45-80 words, specific to the candidate and target role, with no first-person pronouns or clichés.
3. Put 8-20 relevant hard skills in skills. Include target-job keywords only when supported by the candidate's facts.
4. Write 3-6 concise bullets per role where evidence exists. Each bullet should begin with a varied action verb, state the work and its result, and use a truthful metric only if one was provided.
5. Keep bullets around 8-32 words. Avoid “responsible for”, “worked on”, “helped with”, keyword stuffing, tables, columns, icons, photos, graphics, ratings, references, and an objective statement.
6. Preserve names, dates, contact details, organizations, credentials, and numbers exactly. Use reverse chronological order where dates make that possible.
7. If the user asks for a revision, update the supplied current resume instead of discarding unrelated verified facts.
8. The assistantMessage should briefly say what was created or changed and mention any critical missing facts the user should provide next.
9. Treat candidate evidence notes as the only source for new metrics or proof. Never infer a metric from a job description.
10. Prefer the XYZ/CAR pattern for bullets: action and task, truthful scope or method, then result. Vary verbs and remove filler.
11. Tailor for the named role and employer where supplied, but never copy requirements the candidate has not demonstrated.

Return exactly this shape:
{
  "assistantMessage": "string",
  "resume": {
    "contact": {"name":"","title":"","email":"","phone":"","location":"","linkedin":"","website":""},
    "summary": "",
    "skills": [""],
    "experience": [{"id":"experience-1","company":"","role":"","location":"","startDate":"","endDate":"","bullets":[""]}],
    "education": [{"id":"education-1","institution":"","degree":"","location":"","startDate":"","endDate":"","details":""}],
    "projects": [{"id":"project-1","name":"","link":"","description":"","bullets":[""]}],
    "certifications": [{"id":"certification-1","name":"","issuer":"","date":""}]
  }
}`

function cleanText(value: unknown, max: number): string {
	return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function cleanHistory(value: unknown): Array<{ role: 'user' | 'assistant'; text: string }> {
	if (!Array.isArray(value)) return []
	return value.slice(-8).flatMap((item) => {
		if (!item || typeof item !== 'object') return []
		const row = item as Record<string, unknown>
		const role = row.role === 'assistant' ? 'assistant' : row.role === 'user' ? 'user' : null
		const text = cleanText(row.text, 1_500)
		return role && text ? [{ role, text }] : []
	})
}

export async function POST(request: Request) {
	let body: GenerateBody
	try {
		body = (await request.json()) as GenerateBody
	} catch {
		return Response.json({ error: 'Malformed JSON body.' }, { status: 400 })
	}

	const prompt = cleanText(body.prompt, MAX_PROMPT)
	const jobDescription = cleanText(body.jobDescription, MAX_JOB_DESCRIPTION)
	const targetRole = cleanText(body.targetRole, 180)
	const targetCompany = cleanText(body.targetCompany, 180)
	const evidenceNotes = cleanText(body.evidenceNotes, 8_000)
	if (prompt.length < 10) {
		return Response.json({ error: 'Please provide at least 10 characters about your background or requested change.' }, { status: 400 })
	}

	const history = cleanHistory(body.history)
	const currentResume = body.currentResume ? normalizeResume(body.currentResume) : null
	const userMessage = [
		'CANDIDATE REQUEST AND FACTS:',
		prompt,
		`\nTARGET ROLE: ${targetRole || 'Not supplied.'}`,
		`TARGET COMPANY: ${targetCompany || 'Not supplied.'}`,
		jobDescription ? `\nTARGET JOB DESCRIPTION:\n${jobDescription}` : '\nTARGET JOB DESCRIPTION: Not supplied.',
		evidenceNotes ? `\nVERIFIED EVIDENCE BANK:\n${evidenceNotes}` : '\nVERIFIED EVIDENCE BANK: Not supplied.',
		history.length ? `\nRECENT CONVERSATION:\n${JSON.stringify(history)}` : '',
		currentResume ? `\nCURRENT RESUME TO REVISE:\n${JSON.stringify(currentResume)}` : '',
	].join('\n')

	try {
		const result = await requestNvidiaJson({ system: SYSTEM_PROMPT, user: userMessage })
		const resume: ResumeData = normalizeResume(result.data.resume)
		if (!resume.contact.name && !resume.summary && resume.experience.length === 0) {
			throw new Error('NVIDIA returned an empty resume. Add more concrete candidate details and try again.')
		}
		const assistantMessage = cleanText(result.data.assistantMessage, 1_000) || 'Your ATS-friendly resume draft is ready. Review every fact before downloading.'
		return Response.json(
			{
				assistantMessage,
				resume,
				report: scoreResume(resume, jobDescription),
				model: result.model,
			},
			{ headers: { 'cache-control': 'no-store' } },
		)
	} catch (error) {
		return Response.json(
			{ error: error instanceof Error ? error.message : 'Resume generation failed.' },
			{ status: 503, headers: { 'cache-control': 'no-store' } },
		)
	}
}
