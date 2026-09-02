/**
 * Choosing what to put behind the speaker, with a language model.
 *
 * The studio can already do this without a model: `object-library.ts` matches
 * the spoken words against a keyword index, and for "we launched the rocket"
 * that is exactly as good as anything a model would say. Where it falls down
 * is everything implied rather than named - "we finally shipped it", "that
 * number doubled", "it took eight months" - because no word in those lines is
 * a keyword, and the honest local answer is no object at all.
 *
 * So this route is a *refinement*, never a dependency. It is handed the same
 * catalogue the client holds and asked for at most one asset per line, chosen
 * only from that catalogue. Anything it invents is dropped, anything it
 * returns for a line that already had a local match is preferred, and when
 * there is no key or no model answers, the response says so and the client
 * keeps the plan it made itself. A caption studio that cannot place an object
 * because a third party is rate limited would be a worse tool than one that
 * never asked.
 */

import { AUTO_MODEL_ORDER, isAiModelId, type AiModelId } from '../../../../lib/ai-models'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

const NVIDIA_ENDPOINT = 'https://integrate.api.nvidia.com/v1/chat/completions'
const MAX_LINES = 120
const MAX_LINE_LENGTH = 240
const MAX_CATALOGUE = 200
const MODEL_TIMEOUT_MS = 45_000
const DEADLINE_MS = 100_000
const MAX_TOKENS = 2_400

type CatalogueEntry = { id: string; label: string; about: string }

type ObjectsBody = {
	lines?: unknown
	catalogue?: unknown
	model?: unknown
}

type NvidiaResponse = {
	choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>
	error?: { message?: string }
}

export type ObjectPick = {
	/** index into the lines that were sent */
	line: number
	/** an id from the catalogue that was sent */
	asset: string
	/** the word in that line the object illustrates */
	word: string
}

function systemPrompt(): string {
	return [
		'You choose one illustrative object to appear behind a speaker in a subtitled video.',
		'You are given the subtitle lines in order, and a catalogue of the only objects that exist.',
		'Rules, all mandatory:',
		'1. Return a JSON array and nothing else - no prose, no markdown fence.',
		'2. Each entry is {"line": <zero-based index>, "asset": "<id from the catalogue>", "word": "<one word from that line>"}.',
		'3. Never invent an asset id. Only ids from the catalogue are allowed.',
		'4. Cover at most half the lines. A line whose meaning no catalogue object illustrates gets no entry at all - an empty frame is better than an unrelated shape.',
		'5. Never choose the same asset for two lines that are next to each other.',
		'6. Prefer the concrete thing the line is about over the mood it has. "We shipped it" is a package, not a spark.',
		'7. "word" must appear in that line, in the line\'s own language and script. If no single word fits, skip the line.',
		'8. Keep the order of the array the same as the order of the lines.',
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

function readCatalogue(value: unknown): CatalogueEntry[] {
	if (!Array.isArray(value)) return []
	return value
		.slice(0, MAX_CATALOGUE)
		.flatMap((raw): CatalogueEntry[] => {
			if (typeof raw !== 'object' || raw === null) return []
			const entry = raw as Record<string, unknown>
			const id = typeof entry.id === 'string' ? entry.id.slice(0, 60) : ''
			if (!id) return []
			return [
				{
					id,
					label: typeof entry.label === 'string' ? entry.label.slice(0, 60) : id,
					about: typeof entry.about === 'string' ? entry.about.slice(0, 160) : '',
				},
			]
		})
}

/**
 * Keeps only the picks that are usable: a real line, a real asset, and no two
 * neighbours showing the same thing. The model is asked for all three; none of
 * them is taken on trust.
 */
function sanitise(picks: unknown[], lines: string[], catalogue: CatalogueEntry[]): ObjectPick[] {
	const ids = new Set(catalogue.map((entry) => entry.id))
	const seenLines = new Set<number>()
	const kept: ObjectPick[] = []

	for (const raw of picks) {
		if (typeof raw !== 'object' || raw === null) continue
		const pick = raw as Record<string, unknown>
		const line = typeof pick.line === 'number' ? Math.round(pick.line) : -1
		const asset = typeof pick.asset === 'string' ? pick.asset : ''
		if (line < 0 || line >= lines.length || seenLines.has(line)) continue
		if (!ids.has(asset)) continue
		if (kept[kept.length - 1]?.asset === asset && kept[kept.length - 1]?.line === line - 1) continue

		const word = typeof pick.word === 'string' ? pick.word.trim().slice(0, 40) : ''
		// A word the line does not contain means the model was describing rather
		// than reading; the pick can stay, the invented word cannot.
		const inLine = word && lines[line].toLowerCase().includes(word.toLowerCase()) ? word : ''
		seenLines.add(line)
		kept.push({ line, asset, word: inLine })
	}

	return kept.sort((left, right) => left.line - right.line)
}

export async function POST(request: Request) {
	let body: ObjectsBody
	try {
		body = (await request.json()) as ObjectsBody
	} catch {
		return Response.json({ error: 'Malformed JSON body.' }, { status: 400 })
	}

	const lines = Array.isArray(body.lines)
		? body.lines
				.filter((line): line is string => typeof line === 'string')
				.map((line) => line.replace(/\s+/g, ' ').trim().slice(0, MAX_LINE_LENGTH))
		: []
	const catalogue = readCatalogue(body.catalogue)

	if (lines.length === 0) return Response.json({ error: 'Send at least one caption line.' }, { status: 400 })
	if (lines.length > MAX_LINES) {
		return Response.json({ error: `Send at most ${MAX_LINES} lines per request.` }, { status: 400 })
	}
	if (catalogue.length === 0) {
		return Response.json({ error: 'Send the object catalogue to choose from.' }, { status: 400 })
	}

	const requested: AiModelId = isAiModelId(body.model) ? body.model : 'auto'
	const models = requested === 'auto' ? AUTO_MODEL_ORDER : [requested]

	const key = process.env.NVIDIA_API_KEY?.trim()
	if (!key) {
		return Response.json(
			{
				picks: [],
				model: null,
				notice:
					'NVIDIA_API_KEY is not set, so the objects were chosen by the studio’s own keyword matcher rather than a language model.',
			},
			{ headers: { 'cache-control': 'no-store' } },
		)
	}

	const userMessage = JSON.stringify({
		catalogue: catalogue.map((entry) => ({ id: entry.id, is: entry.label, about: entry.about })),
		lines,
	})

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
						{ role: 'system', content: systemPrompt() },
						{ role: 'user', content: userMessage },
					],
					temperature: 0.3,
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
				attempts.push({ model, error: 'The model did not return a JSON array of picks.' })
				continue
			}

			const picks = sanitise(parsed, lines, catalogue)
			if (picks.length === 0) {
				attempts.push({ model, error: 'Every pick named a line or an asset that does not exist.' })
				continue
			}

			return Response.json({ picks, model, attempts }, { headers: { 'cache-control': 'no-store' } })
		} catch (error) {
			attempts.push({
				model,
				error: error instanceof Error ? error.message.slice(0, 200) : 'Network request failed.',
			})
		}
	}

	// Same contract as the transcript clean-up: a failed bonus pass costs the
	// user nothing, because the local plan is already good enough to bake.
	return Response.json(
		{
			picks: [],
			model: null,
			notice: `The objects were chosen by the studio’s own keyword matcher - no NVIDIA model finished the pass. ${attempts
				.map((attempt) => `${attempt.model}: ${attempt.error}`)
				.join(' | ')
				.slice(0, 300)}`,
			attempts,
		},
		{ headers: { 'cache-control': 'no-store' } },
	)
}
