/**
 * Transcript clean-up on NVIDIA's language models.
 *
 * Speech recognition gets the words right far more often than it gets the
 * writing right: missing sentence punctuation, lowercase proper nouns, English
 * loanwords spelled phonetically in Devanagari, "gonna" where the speaker said
 * "going to". A language model fixes exactly that class of error, and because
 * it is asked for one rewritten line per input line - never a re-segmentation -
 * the studio can keep every word timing the recogniser produced.
 *
 * The contract is deliberately unforgiving: same number of lines, same
 * language, same script, no translation, no commentary. Anything else is
 * rejected and the original transcript is returned untouched.
 */

import { AUTO_MODEL_ORDER, isAiModelId, type AiModelId } from '../../../../lib/ai-models'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

const NVIDIA_ENDPOINT = 'https://integrate.api.nvidia.com/v1/chat/completions'
const MAX_LINES = 120
const MAX_LINE_LENGTH = 400
const MAX_TOTAL_CHARACTERS = 12_000
const MODEL_TIMEOUT_MS = 45_000
const DEADLINE_MS = 100_000

const LANGUAGE_LABEL: Record<string, string> = {
	auto: 'the language already used in the lines',
	en: 'English',
	ne: 'Nepali (Devanagari), with English loanwords left in Latin script',
	hi: 'Hindi (Devanagari)',
	es: 'Spanish',
	fr: 'French',
	de: 'German',
	pt: 'Portuguese',
	ja: 'Japanese',
	ko: 'Korean',
	zh: 'Chinese',
	ar: 'Arabic',
	ur: 'Urdu',
	bn: 'Bengali',
}

function systemPrompt(language: string): string {
	const label = LANGUAGE_LABEL[language] ?? LANGUAGE_LABEL.auto
	return [
		'You are a subtitle editor. You are given the raw output of a speech recogniser, one caption line per array entry.',
		`Rewrite each line in ${label}.`,
		'Rules, all mandatory:',
		'1. Return a JSON array of strings and nothing else - no prose, no markdown fence, no keys.',
		'2. The array must have exactly the same number of entries as the input, in the same order.',
		'3. Never translate. Never change the language or the script of a word. Code-switched speech stays code-switched.',
		'4. Only fix what the recogniser got wrong: punctuation, capitalisation, obvious misheard words, spacing, and numerals.',
		'5. Never merge, split, reorder or reword a line beyond those fixes. Keep the wording and the word order.',
		'6. If a line is already correct, return it unchanged. If a line is unintelligible, return it unchanged.',
	].join('\n')
}

type NvidiaResponse = {
	choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>
	error?: { message?: string }
}

type RefineBody = {
	lines?: unknown
	language?: unknown
	model?: unknown
}

function contentText(content: string | Array<{ text?: string }> | undefined): string {
	if (typeof content === 'string') return content
	if (!Array.isArray(content)) return ''
	return content.map((part) => (typeof part?.text === 'string' ? part.text : '')).join('')
}

/** Pulls the first JSON array out of a reply that may still carry a fence. */
function extractJsonArray(raw: string): unknown[] | null {
	const trimmed = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '')
	const start = trimmed.indexOf('[')
	const end = trimmed.lastIndexOf(']')
	if (start === -1 || end <= start) return null
	try {
		const parsed = JSON.parse(trimmed.slice(start, end + 1)) as unknown
		return Array.isArray(parsed) ? parsed : null
	} catch {
		return null
	}
}

function sameShape(original: string[], refined: unknown[]): refined is string[] {
	if (refined.length !== original.length) return false
	return refined.every((line) => typeof line === 'string')
}

/**
 * A model that "cleans up" a line into something three times as long has
 * summarised or hallucinated it. Keep the original for those, keep the fix for
 * the rest - a partial improvement is still an improvement.
 */
function mergeLines(original: string[], refined: string[]): { lines: string[]; changed: number } {
	let changed = 0
	const lines = original.map((line, index) => {
		const candidate = refined[index]?.trim()
		if (!candidate) return line
		if (candidate === line) return line
		const ratio = candidate.length / Math.max(1, line.length)
		if (ratio > 2.2 || ratio < 0.45) return line
		changed++
		return candidate
	})
	return { lines, changed }
}

export async function POST(request: Request) {
	let body: RefineBody
	try {
		body = (await request.json()) as RefineBody
	} catch {
		return Response.json({ error: 'Malformed JSON body.' }, { status: 400 })
	}

	const lines = Array.isArray(body.lines)
		? body.lines
				.filter((line): line is string => typeof line === 'string')
				.map((line) => line.replace(/\s+/g, ' ').trim().slice(0, MAX_LINE_LENGTH))
		: []

	if (lines.length === 0) {
		return Response.json({ error: 'Send at least one caption line.' }, { status: 400 })
	}
	if (lines.length > MAX_LINES) {
		return Response.json({ error: `Send at most ${MAX_LINES} lines per request.` }, { status: 400 })
	}
	if (lines.join('').length > MAX_TOTAL_CHARACTERS) {
		return Response.json({ error: 'That batch of lines is too long.' }, { status: 400 })
	}

	const language = typeof body.language === 'string' ? body.language : 'auto'
	const requested: AiModelId = isAiModelId(body.model) ? body.model : 'auto'
	const models = requested === 'auto' ? AUTO_MODEL_ORDER : [requested]

	const key = process.env.NVIDIA_API_KEY?.trim()
	if (!key) {
		return Response.json(
			{
				lines,
				changed: 0,
				model: null,
				notice: 'NVIDIA_API_KEY is not set, so the transcript was left exactly as the recogniser wrote it.',
			},
			{ headers: { 'cache-control': 'no-store' } },
		)
	}

	const deadline = Date.now() + DEADLINE_MS
	const attempts: { model: string; error: string }[] = []

	for (const model of models) {
		const remaining = deadline - Date.now()
		if (remaining < 8_000) break

		try {
			const response = await fetch(NVIDIA_ENDPOINT, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${key}`,
					'Content-Type': 'application/json',
					Accept: 'application/json',
				},
				body: JSON.stringify({
					model,
					messages: [
						{ role: 'system', content: systemPrompt(language) },
						{ role: 'user', content: JSON.stringify(lines) },
					],
					temperature: 0.2,
					top_p: 0.9,
					max_tokens: 2_600,
					...(model.startsWith('nvidia/nemotron-')
						? { chat_template_kwargs: { enable_thinking: false, force_nonempty_content: true } }
						: {}),
				}),
				signal: AbortSignal.timeout(Math.min(MODEL_TIMEOUT_MS, remaining)),
			})

			if (!response.ok) {
				const data = (await response.json().catch(() => null)) as NvidiaResponse | null
				const message = data?.error?.message ?? `NVIDIA returned HTTP ${response.status}.`
				attempts.push({ model, error: message.slice(0, 200) })
				if (response.status === 401 || response.status === 403) break
				continue
			}

			const data = (await response.json()) as NvidiaResponse
			if (data.error?.message) {
				attempts.push({ model, error: data.error.message.slice(0, 200) })
				continue
			}

			const parsed = extractJsonArray(contentText(data.choices?.[0]?.message?.content))
			if (!parsed || !sameShape(lines, parsed)) {
				attempts.push({ model, error: 'The model did not return one clean line per input line.' })
				continue
			}

			const merged = mergeLines(lines, parsed)
			return Response.json(
				{ lines: merged.lines, changed: merged.changed, model, attempts },
				{ headers: { 'cache-control': 'no-store' } },
			)
		} catch (error) {
			attempts.push({
				model,
				error: error instanceof Error ? error.message.slice(0, 200) : 'Network request failed.',
			})
		}
	}

	// Clean-up is a bonus pass: failing it must never cost the user the transcript.
	return Response.json(
		{
			lines,
			changed: 0,
			model: null,
			notice: `The transcript was kept exactly as recognised - no NVIDIA model finished the clean-up pass. ${attempts
				.map((attempt) => `${attempt.model}: ${attempt.error}`)
				.join(' | ')
				.slice(0, 300)}`,
			attempts,
		},
		{ headers: { 'cache-control': 'no-store' } },
	)
}
