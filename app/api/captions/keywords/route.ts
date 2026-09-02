/**
 * Reading a transcript and naming the handful of things worth a picture.
 *
 * The one-press flow needs a fixed, small number of words: one object for every
 * five seconds of video, chosen from everything that was said. That is not the
 * same job as the object director next door, which walks the cues in order and
 * asks "does this line name something in the catalogue" - here there is no
 * catalogue at all, the answer is fetched from the open web afterwards, and the
 * question is which words carry the video.
 *
 * A language model is genuinely better at that than word counting, for one
 * reason: frequency finds the words a transcript repeats, and what a viewer
 * wants illustrated is the word a sentence is *about*. "So the thing is, we
 * moved the whole studio to Pokhara" says "the" three times and "Pokhara" once.
 *
 * It is still only a refinement. The browser ranks the same transcript locally
 * before it asks, keeps that ranking when there is no key or no model answers,
 * and merges whatever comes back over the top - so this route failing costs the
 * user a better word, never the feature.
 *
 * Every field that comes back is checked against the transcript that was sent:
 * a line index that does not exist, or a word that is not in that line, is a
 * model describing rather than reading, and is dropped.
 */

import { AUTO_MODEL_ORDER, isAiModelId, type AiModelId } from '../../../../lib/ai-models'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

const NVIDIA_ENDPOINT = 'https://integrate.api.nvidia.com/v1/chat/completions'
const MAX_LINES = 400
const MAX_LINE_LENGTH = 240
const MAX_KEYWORDS = 40
const MODEL_TIMEOUT_MS = 45_000
const DEADLINE_MS = 100_000
const MAX_TOKENS = 2_000

type KeywordsBody = {
	lines?: unknown
	count?: unknown
	model?: unknown
}

type NvidiaResponse = {
	choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>
	error?: { message?: string }
}

export type KeywordPick = {
	/** index into the lines that were sent */
	line: number
	/** the spoken word, exactly as it appears in that line */
	word: string
	/** what to type into a picture search - English, concrete, one or two words */
	query: string
}

function systemPrompt(count: number): string {
	return [
		`You pick the ${count} words in a video transcript that most deserve a picture behind the speaker's head.`,
		'You are given the subtitle lines in order, numbered from zero.',
		'Rules, all mandatory:',
		'1. Return a JSON array and nothing else - no prose, no markdown fence.',
		'2. Each entry is {"line": <zero-based index>, "word": "<a word from that line>", "query": "<English picture search, one or two words>"}.',
		`3. Return at most ${count} entries, fewer if the transcript does not carry that many ideas.`,
		'4. "word" must appear in that line, in the line\'s own language and script. Copy it, never translate it.',
		'5. Pick concrete things a photograph could show - an object, a place, an animal, a tool, a food, a named brand. Never pick a pronoun, a filler, a number, a greeting or an abstract noun like "thing", "way", "time".',
		'6. Spread the picks across the whole transcript. Never take two entries from the same line, and avoid two entries within a few lines of each other unless the ideas are genuinely different.',
		'7. "query" is what a picture search would need: English, singular, concrete, and specific enough that the first result is the thing itself on a plain background. Add "transparent png" to nothing - the search does that.',
		'8. Keep the array ordered by line.',
	].join('\n')
}

function contentText(content: string | Array<{ text?: string }> | undefined): string {
	if (typeof content === 'string') return content
	if (!Array.isArray(content)) return ''
	return content.map((part) => (typeof part?.text === 'string' ? part.text : '')).join('')
}

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

/**
 * Keeps only the picks that are usable.
 *
 * A word the line does not contain is the model paraphrasing, and a picture
 * chosen from a paraphrase is a picture of something nobody said. The line
 * index and the word are both checked against the transcript that was sent;
 * neither is taken on trust.
 */
function sanitise(picks: unknown[], lines: string[], count: number): KeywordPick[] {
	const seenLines = new Set<number>()
	const seenWords = new Set<string>()
	const kept: KeywordPick[] = []

	for (const raw of picks) {
		if (typeof raw !== 'object' || raw === null) continue
		const pick = raw as Record<string, unknown>
		const line = typeof pick.line === 'number' ? Math.round(pick.line) : -1
		if (line < 0 || line >= lines.length || seenLines.has(line)) continue

		const word = typeof pick.word === 'string' ? pick.word.trim().slice(0, 40) : ''
		if (!word) continue
		const lower = word.toLowerCase()
		if (!lines[line].toLowerCase().includes(lower)) continue
		if (seenWords.has(lower)) continue

		const query = typeof pick.query === 'string' ? pick.query.trim().slice(0, 60) : ''
		seenLines.add(line)
		seenWords.add(lower)
		kept.push({ line, word, query: query || word })
		if (kept.length >= count) break
	}

	return kept.sort((left, right) => left.line - right.line)
}

export async function POST(request: Request) {
	let body: KeywordsBody
	try {
		body = (await request.json()) as KeywordsBody
	} catch {
		return Response.json({ error: 'Malformed JSON body.' }, { status: 400 })
	}

	const lines = Array.isArray(body.lines)
		? body.lines
				.filter((line): line is string => typeof line === 'string')
				.map((line) => line.replace(/\s+/g, ' ').trim().slice(0, MAX_LINE_LENGTH))
		: []
	const count = Math.max(1, Math.min(MAX_KEYWORDS, Math.round(Number(body.count) || 5)))

	if (lines.length === 0) return Response.json({ error: 'Send at least one caption line.' }, { status: 400 })
	if (lines.length > MAX_LINES) {
		return Response.json({ error: `Send at most ${MAX_LINES} lines per request.` }, { status: 400 })
	}

	const requested: AiModelId = isAiModelId(body.model) ? body.model : 'auto'
	const models = requested === 'auto' ? AUTO_MODEL_ORDER : [requested]

	const key = process.env.NVIDIA_API_KEY?.trim()
	if (!key) {
		return Response.json(
			{
				keywords: [],
				model: null,
				notice:
					'NVIDIA_API_KEY is not set, so the words were ranked by the studio’s own transcript analysis rather than a language model.',
			},
			{ headers: { 'cache-control': 'no-store' } },
		)
	}

	const userMessage = JSON.stringify({ count, lines })
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
						{ role: 'system', content: systemPrompt(count) },
						{ role: 'user', content: userMessage },
					],
					temperature: 0.2,
					top_p: 0.9,
					max_tokens: MAX_TOKENS,
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
			if (!parsed) {
				attempts.push({ model, error: 'The model did not return a JSON array of keywords.' })
				continue
			}

			const keywords = sanitise(parsed, lines, count)
			if (keywords.length === 0) {
				attempts.push({ model, error: 'Every keyword named a line that does not exist, or a word nobody said.' })
				continue
			}

			return Response.json({ keywords, model, attempts }, { headers: { 'cache-control': 'no-store' } })
		} catch (error) {
			attempts.push({
				model,
				error: error instanceof Error ? error.message.slice(0, 200) : 'Network request failed.',
			})
		}
	}

	return Response.json(
		{
			keywords: [],
			model: null,
			notice: `The words were ranked by the studio’s own transcript analysis - no NVIDIA model finished the pass. ${attempts
				.map((attempt) => `${attempt.model}: ${attempt.error}`)
				.join(' | ')
				.slice(0, 300)}`,
			attempts,
		},
		{ headers: { 'cache-control': 'no-store' } },
	)
}
