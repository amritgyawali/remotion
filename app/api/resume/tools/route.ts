import { requestNvidiaJson } from '../../../../lib/resume/nvidia'
import { normalizeResume, resumeToPlainText, type CareerToolId } from '../../../../lib/resume/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

const TOOL_GUIDANCE: Record<CareerToolId, string> = {
	'cover-letter': 'Write a concise, specific cover letter of 250-380 words with a tailored opening, two evidence-led body paragraphs, and a confident close. Do not repeat the resume line by line.',
	'recruiter-email': 'Write a warm recruiter or hiring-manager outreach email under 150 words. Include a precise subject line, role interest, two relevant proof points, and a low-pressure call to action.',
	'linkedin-profile': 'Write a LinkedIn headline under 220 characters followed by an About section of 120-220 words. Make it searchable, human, and factually grounded.',
	'interview-prep': 'Create 10 likely interview questions tailored to the role and resume. For each, add a short evidence prompt telling the candidate which true example or metric to prepare. Do not write fictional answers.',
}

type ToolBody = {
	tool?: unknown
	resume?: unknown
	jobDescription?: unknown
	targetRole?: unknown
	targetCompany?: unknown
	evidenceNotes?: unknown
}

const clean = (value: unknown, max: number) =>
	typeof value === 'string' ? value.trim().slice(0, max) : ''

const SYSTEM_PROMPT = `You are a senior career strategist. Return JSON only in this exact shape:
{"title":"string","content":"string"}

Use only facts present in the resume, job description, or candidate evidence notes. Never invent qualifications, metrics, names, dates, employers, projects, or claims. If a requested fact is unavailable, write around it naturally instead of inserting a placeholder. Use clear plain text, not Markdown tables. Keep the writing ATS-aware but natural for a human reader. Do not promise hiring outcomes.`

export async function POST(request: Request) {
	let body: ToolBody
	try {
		body = (await request.json()) as ToolBody
	} catch {
		return Response.json({ error: 'Malformed JSON body.' }, { status: 400 })
	}

	const tool = typeof body.tool === 'string' && body.tool in TOOL_GUIDANCE
		? (body.tool as CareerToolId)
		: null
	if (!tool) return Response.json({ error: 'Choose a supported career tool.' }, { status: 400 })

	const resume = normalizeResume(body.resume)
	const resumeText = resumeToPlainText(resume)
	if (resumeText.trim().length < 80) {
		return Response.json({ error: 'Create or import a resume before using the career toolkit.' }, { status: 400 })
	}

	const targetRole = clean(body.targetRole, 180)
	const targetCompany = clean(body.targetCompany, 180)
	const jobDescription = clean(body.jobDescription, 14_000)
	const evidenceNotes = clean(body.evidenceNotes, 8_000)
	const user = [
		`TASK:\n${TOOL_GUIDANCE[tool]}`,
		`TARGET ROLE:\n${targetRole || resume.contact.title || 'Not supplied'}`,
		`TARGET COMPANY:\n${targetCompany || 'Not supplied'}`,
		`JOB DESCRIPTION:\n${jobDescription || 'Not supplied'}`,
		`VERIFIED CANDIDATE EVIDENCE:\n${evidenceNotes || 'No additional evidence supplied'}`,
		`RESUME:\n${resumeText.slice(0, 24_000)}`,
	].join('\n\n')

	try {
		const result = await requestNvidiaJson({ system: SYSTEM_PROMPT, user, maxTokens: 3_000, temperature: 0.25 })
		const title = clean(result.data.title, 180) || 'Career document'
		const content = clean(result.data.content, 20_000)
		if (content.length < 80) throw new Error('NVIDIA returned an incomplete career document. Try again with more resume detail.')
		return Response.json({ title, content, model: result.model }, { headers: { 'cache-control': 'no-store' } })
	} catch (error) {
		return Response.json(
			{ error: error instanceof Error ? error.message : 'Career document generation failed.' },
			{ status: 503, headers: { 'cache-control': 'no-store' } },
		)
	}
}
