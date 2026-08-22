import { scoreUploadedResume } from '../../../../lib/resume/ats'
import { requestNvidiaJson } from '../../../../lib/resume/nvidia'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

const MAX_FILE_BYTES = 6 * 1024 * 1024
const MAX_TEXT_LENGTH = 40_000

async function extractPdf(buffer: ArrayBuffer): Promise<string> {
	// PDF.js disables real workers in Node and otherwise tries to import a worker
	// relative to Next's vendor chunk. Register the bundled worker handler on the
	// global hook PDF.js explicitly so extraction also works after bundling.
	// @ts-expect-error pdfjs-dist does not publish declarations for its worker entry.
	const worker = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs')) as {
		WorkerMessageHandler: unknown
	}
	const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
	;(globalThis as typeof globalThis & { pdfjsWorker?: { WorkerMessageHandler: unknown } }).pdfjsWorker = {
		WorkerMessageHandler: worker.WorkerMessageHandler,
	}
	const loadingTask = getDocument({
		data: new Uint8Array(buffer),
		useWorkerFetch: false,
		isEvalSupported: false,
		useSystemFonts: true,
	})
	const pdf = await loadingTask.promise
	const pages: string[] = []
	try {
		for (let pageNumber = 1; pageNumber <= Math.min(pdf.numPages, 10); pageNumber += 1) {
			const page = await pdf.getPage(pageNumber)
			const content = await page.getTextContent()
			const lines: string[] = []
			let current = ''
			for (const item of content.items) {
				if (!('str' in item)) continue
				current += `${current ? ' ' : ''}${item.str}`
				if (item.hasEOL) {
					lines.push(current.trim())
					current = ''
				}
			}
			if (current.trim()) lines.push(current.trim())
			pages.push(lines.filter(Boolean).join('\n'))
		}
	} finally {
		await pdf.destroy()
	}
	return pages.join('\n\n')
}

async function extractDocx(buffer: ArrayBuffer): Promise<string> {
	const mammoth = await import('mammoth')
	const result = await mammoth.extractRawText({ buffer: Buffer.from(buffer) })
	return result.value
}

async function fileText(file: File): Promise<string> {
	const extension = file.name.toLowerCase().split('.').pop()
	const buffer = await file.arrayBuffer()
	if (extension === 'pdf' || file.type === 'application/pdf') return extractPdf(buffer)
	if (
		extension === 'docx' ||
		file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
	) {
		return extractDocx(buffer)
	}
	if (extension === 'txt' || file.type.startsWith('text/')) return new TextDecoder().decode(buffer)
	throw new Error('Unsupported file type. Upload a text-based PDF, DOCX, or TXT resume.')
}

const ANALYSIS_SYSTEM_PROMPT = `You are a senior resume reviewer. Return JSON only with this shape:
{"recommendations":["string"],"strengths":["string"]}
Review the resume against the supplied job description. Give at most 6 prioritized, specific recommendations and at most 3 concise strengths. Never invent candidate facts. Never claim a guaranteed interview or universal ATS acceptance. Focus on truthful keyword alignment, quantified outcomes, action language, clarity, missing standard sections, and role relevance. Do not provide a score; the application calculates its score deterministically.`

export async function POST(request: Request) {
	let form: FormData
	try {
		form = await request.formData()
	} catch {
		return Response.json({ error: 'Malformed upload.' }, { status: 400 })
	}
	const candidate = form.get('resume')
	if (!(candidate instanceof File)) {
		return Response.json({ error: 'Choose a PDF, DOCX, or TXT resume.' }, { status: 400 })
	}
	if (candidate.size === 0 || candidate.size > MAX_FILE_BYTES) {
		return Response.json({ error: 'Resume files must be between 1 byte and 6 MB.' }, { status: 400 })
	}

	const jobDescription = String(form.get('jobDescription') ?? '').trim().slice(0, 14_000)
	try {
		const extractedText = (await fileText(candidate)).replace(/\u0000/g, '').trim().slice(0, MAX_TEXT_LENGTH)
		if (extractedText.length < 80) {
			throw new Error('Almost no text could be read. Use a text-based PDF or DOCX instead of a scan or image.')
		}
		const report = scoreUploadedResume(extractedText, jobDescription)
		let recommendations: string[] = []
		let strengths: string[] = []
		let model: string | null = null
		let notice: string | null = null

		try {
			const result = await requestNvidiaJson({
				system: ANALYSIS_SYSTEM_PROMPT,
				user: `RESUME TEXT:\n${extractedText.slice(0, 24_000)}\n\nTARGET JOB DESCRIPTION:\n${jobDescription || 'Not supplied.'}\n\nDETERMINISTIC FAILED CHECKS:\n${report.improvements.join('\n')}`,
				maxTokens: 1_600,
				temperature: 0.15,
			})
			const cleanList = (value: unknown, limit: number) =>
				Array.isArray(value)
					? value.map((item) => (typeof item === 'string' ? item.trim().slice(0, 400) : '')).filter(Boolean).slice(0, limit)
					: []
			recommendations = cleanList(result.data.recommendations, 6)
			strengths = cleanList(result.data.strengths, 3)
			model = result.model
		} catch (error) {
			notice = error instanceof Error ? error.message : 'NVIDIA analysis was unavailable.'
		}

		return Response.json(
			{
				fileName: candidate.name,
				extractedText,
				report,
				recommendations,
				strengths,
				model,
				notice,
			},
			{ headers: { 'cache-control': 'no-store' } },
		)
	} catch (error) {
		return Response.json(
			{ error: error instanceof Error ? error.message : 'The resume could not be analyzed.' },
			{ status: 422, headers: { 'cache-control': 'no-store' } },
		)
	}
}
