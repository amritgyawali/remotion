/**
 * Chat -> finished Remotion video.
 *
 * The model is asked for a compact JSON storyboard, never for code. The Studio
 * then composes the TSX itself, so a generation cannot fail on a syntax error,
 * an unsupported import or a truncated file. If every NVIDIA model is slow,
 * rate limited or unusable, the local director uses the request's creative seed
 * and the request still returns a complete, reproducible video.
 */

import { randomUUID } from 'node:crypto'
import { AUTO_MODEL_ORDER, isAiModelId, type AiModelId } from '../../../../lib/ai-models'
import { composeVideoSource } from '../../../../lib/ai/compose'
import { planStoryboard, promptRequestsThreeDimensional } from '../../../../lib/ai/planner'
import { STORYBOARD_SYSTEM_PROMPT, buildUserMessage, extractJsonObject } from '../../../../lib/ai/prompt'
import { normalizeStoryboard, type Storyboard } from '../../../../lib/ai/storyboard'
import { TEMPLATE_IDS, normalizeAvoidFingerprints, type TemplateId } from '../../../../lib/ai/variation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const NVIDIA_ENDPOINT = 'https://integrate.api.nvidia.com/v1/chat/completions'
const MAX_PROMPT_LENGTH = 6_000
const MAX_HISTORY_ITEMS = 6
const MAX_HISTORY_ITEM_LENGTH = 800
const GENERATION_DEADLINE_MS = 150_000

/**
 * A storyboard is ~1.5k output tokens, so every model gets a tight budget. The
 * old full-file contract needed 8k tokens and routinely hit the gateway
 * timeout; these limits leave room for two fallbacks inside one request.
 */
const MODEL_TIMEOUT_MS: Record<Exclude<AiModelId, 'auto'>, number> = {
	'nvidia/nemotron-3.5-lightning-30b-a3b': 40_000,
	'stepfun-ai/step-3.7-flash': 45_000,
	'mistralai/mistral-medium-3.5-128b': 50_000,
	'minimaxai/minimax-m3': 45_000,
	'poolside/laguna-xs-2.1': 40_000,
	'nvidia/nemotron-3-ultra-550b-a55b': 70_000,
}

const MAX_STORYBOARD_TOKENS = 3_000

type HistoryItem = { role?: unknown; text?: unknown }

type GenerateBody = {
	prompt?: unknown
	model?: unknown
	history?: unknown
	creativeSeed?: unknown
	avoidDesignFingerprints?: unknown
	avoidTemplates?: unknown
}

type NvidiaResponse = {
	choices?: Array<{
		finish_reason?: string
		message?: { content?: string | Array<{ type?: string; text?: string }> }
		delta?: { content?: string | Array<{ type?: string; text?: string }> }
	}>
	error?: { message?: string }
}

type Attempt = { model: string; error: string }

function collectHistory(value: unknown): Array<{ role: 'user' | 'assistant'; text: string }> {
	if (!Array.isArray(value)) return []
	return value.slice(-MAX_HISTORY_ITEMS).flatMap((raw: HistoryItem) => {
		const role = raw?.role === 'assistant' ? 'assistant' : raw?.role === 'user' ? 'user' : null
		const text = typeof raw?.text === 'string' ? raw.text.trim().slice(0, MAX_HISTORY_ITEM_LENGTH) : ''
		return role && text ? [{ role, text }] : []
	})
}

/** House styles the caller has already shipped, so none is reused back to back. */
function collectAvoidTemplates(value: unknown): TemplateId[] {
	if (!Array.isArray(value)) return []
	return [
		...new Set(
			value.filter((item): item is TemplateId => typeof item === 'string' && TEMPLATE_IDS.includes(item as TemplateId)),
		),
	].slice(-6)
}

function responseText(content: string | Array<{ type?: string; text?: string }> | undefined): string {
	if (typeof content === 'string') return content
	if (!Array.isArray(content)) return ''
	return content.map((item) => (typeof item?.text === 'string' ? item.text : '')).join('')
}

function requestSettings(model: string): Record<string, unknown> {
	const base = { temperature: 0.55, top_p: 0.9, max_tokens: MAX_STORYBOARD_TOKENS }
	if (model === 'mistralai/mistral-medium-3.5-128b') return { ...base, reasoning_effort: 'none' }
	if (model === 'minimaxai/minimax-m3') {
		return { ...base, temperature: 0.9, chat_template_kwargs: { thinking_mode: 'disabled' } }
	}
	if (model.startsWith('nvidia/nemotron-')) {
		return { ...base, chat_template_kwargs: { enable_thinking: false, force_nonempty_content: true } }
	}
	return base
}

async function readNvidiaText(response: Response): Promise<string> {
	const contentType = response.headers.get('content-type') ?? ''
	if (!contentType.toLowerCase().includes('text/event-stream')) {
		const data = (await response.json()) as NvidiaResponse
		if (data.error?.message) throw new Error(data.error.message)
		return responseText(data.choices?.[0]?.message?.content)
	}

	if (!response.body) throw new Error('NVIDIA returned an empty event stream.')
	const reader = response.body.getReader()
	const decoder = new TextDecoder()
	let buffer = ''
	let raw = ''
	let done = false

	const consume = (line: string) => {
		const trimmed = line.trim()
		if (!trimmed.startsWith('data:')) return
		const payload = trimmed.slice(5).trim()
		if (!payload) return
		if (payload === '[DONE]') {
			done = true
			return
		}
		let data: NvidiaResponse
		try {
			data = JSON.parse(payload) as NvidiaResponse
		} catch {
			return
		}
		if (data.error?.message) throw new Error(data.error.message)
		for (const choice of data.choices ?? []) raw += responseText(choice.delta?.content)
	}

	while (!done) {
		const chunk = await reader.read()
		buffer += decoder.decode(chunk.value, { stream: !chunk.done })
		const lines = buffer.split(/\r?\n/)
		buffer = chunk.done ? '' : (lines.pop() ?? '')
		for (const line of lines) consume(line)
		if (chunk.done) {
			if (buffer) consume(buffer)
			break
		}
	}

	return raw
}

async function readUpstreamError(response: Response): Promise<string> {
	try {
		const data = (await response.json()) as NvidiaResponse
		return data.error?.message?.slice(0, 300) || `NVIDIA returned HTTP ${response.status}.`
	} catch {
		return `NVIDIA returned HTTP ${response.status}.`
	}
}

/** Last line of defence: the composer output must satisfy the Studio contract. */
function auditComposedCode(code: string): string[] {
	const issues: string[] = []
	const executable = code.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1')
	if (code.length < 1_200) issues.push('The composed file is too short.')
	if (!/<Composition\b/.test(code)) issues.push('The composed file has no <Composition>.')
	if (!/\bregisterRoot\s*\(/.test(code)) issues.push('The composed file does not call registerRoot().')
	if (!/\buseCurrentFrame\s*\(/.test(code)) issues.push('The composed file has no frame-driven animation.')
	if (!/export\s+default\b/.test(code)) issues.push('The composed file has no default export.')
	if (/\bFloorGrid\b/.test(executable) || /\brepeating-linear-gradient\s*\(/.test(executable) || /ai-master-grid/i.test(executable)) {
		issues.push('The composed file contains a prohibited background grid.')
	}
	for (const call of code.matchAll(/staticFile\s*\(\s*([^\r\n)]*)\)/g)) {
		if (!/^['"`]assets\/(?:3d|audio|visual|texture|fonts)\/v1\//.test(call[1].trim())) {
			issues.push('The composed file references an asset outside the built-in kit.')
			break
		}
	}
	return issues
}

function payloadFor(
	storyboard: Storyboard,
	model: string,
	source: 'nvidia' | 'studio',
	attempts: Attempt[],
	notice?: string,
) {
	const composed = composeVideoSource(storyboard)
	const issues = auditComposedCode(composed.code)
	if (issues.length > 0) throw new Error(issues.join(' '))

	return {
		code: composed.code,
		fileName: composed.fileName,
		projectName: composed.projectName,
		compositionId: composed.compositionId,
		model,
		source,
		summary: composed.summary,
		title: storyboard.title,
		aspect: storyboard.aspect,
		seconds: Number((composed.layout.durationInFrames / composed.layout.fps).toFixed(1)),
		scenes: composed.layout.timings.map((timing) => timing.scene.type),
		palette: storyboard.palette,
		music: storyboard.music,
		generationId: storyboard.creativeSeed,
		designFingerprint: storyboard.designFingerprint,
		template: storyboard.creativeProfile.template,
		dimension: storyboard.dimension,
		creativeProfile: storyboard.creativeProfile,
		attempts,
		notice,
	}
}

export async function POST(request: Request) {
	let body: GenerateBody
	try {
		body = (await request.json()) as GenerateBody
	} catch {
		return Response.json({ error: 'Malformed JSON body.' }, { status: 400 })
	}

	const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
	if (prompt.length < 3 || prompt.length > MAX_PROMPT_LENGTH) {
		return Response.json(
			{ error: `Describe the video in 3-${MAX_PROMPT_LENGTH.toLocaleString()} characters.` },
			{ status: 400 },
		)
	}

	const requestedModel: AiModelId = isAiModelId(body.model) ? body.model : 'auto'
	const history = collectHistory(body.history)
	const suppliedSeed = typeof body.creativeSeed === 'string' ? body.creativeSeed.trim().toLowerCase() : ''
	const creativeSeed = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(suppliedSeed)
		? suppliedSeed
		: randomUUID()
	const avoidDesignFingerprints = normalizeAvoidFingerprints(body.avoidDesignFingerprints)
	const avoidTemplates = collectAvoidTemplates(body.avoidTemplates)

	/**
	 * Three-dimensional treatment is opt-in for the whole chat, not just the
	 * latest line: asking for "a 3D product turntable" and then saying "now make
	 * it 20 seconds" should stay 3D.
	 */
	const allowThreeDimensional = [prompt, ...history.filter((item) => item.role === 'user').map((item) => item.text)].some(
		(text) => promptRequestsThreeDimensional(text),
	)

	const localPlan = planStoryboard(prompt, {
		creativeSeed,
		avoidDesignFingerprints,
		avoidTemplates,
		allowThreeDimensional,
	})
	const attempts: Attempt[] = []

	const apiKey = process.env.NVIDIA_API_KEY?.trim()
	if (!apiKey) {
		return Response.json(
			payloadFor(
				localPlan,
				'studio-director',
				'studio',
				attempts,
				'NVIDIA_API_KEY is not set, so the Studio director planned this video locally. Add a generated nvapi-… key to .env.local for AI-written scripts.',
			),
			{ headers: { 'cache-control': 'no-store' } },
		)
	}

	const models = requestedModel === 'auto' ? AUTO_MODEL_ORDER : [requestedModel]
	const deadline = Date.now() + GENERATION_DEADLINE_MS

	for (const model of models) {
		const remainingMs = deadline - Date.now()
		if (remainingMs < 10_000) {
			attempts.push({ model, error: 'The generation deadline was reached before this fallback.' })
			break
		}

		const timeoutMs = Math.min(MODEL_TIMEOUT_MS[model], remainingMs)
		const startedAt = Date.now()
		let response: Response

		try {
			response = await fetch(NVIDIA_ENDPOINT, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${apiKey}`,
					'Content-Type': 'application/json',
					Accept: 'text/event-stream',
				},
				body: JSON.stringify({
					model,
					messages: [
						{ role: 'system', content: STORYBOARD_SYSTEM_PROMPT },
						{
							role: 'user',
							content: buildUserMessage(prompt, history, attempts.at(-1)?.error, {
								generationId: creativeSeed,
								profile: localPlan.creativeProfile,
								avoidDesignFingerprints,
								allowThreeDimensional,
							}),
						},
					],
					stream: true,
					...requestSettings(model),
				}),
				signal: AbortSignal.timeout(timeoutMs),
			})
		} catch (error) {
			const message = error instanceof Error ? error.message.slice(0, 300) : 'Network request failed.'
			console.warn('[api/ai/generate] attempt failed', { model, durationMs: Date.now() - startedAt, error: message })
			attempts.push({ model, error: message })
			continue
		}

		if (!response.ok) {
			const error = await readUpstreamError(response)
			console.warn('[api/ai/generate] rejected', { model, status: response.status, error })
			attempts.push({ model, error })
			if (response.status === 401 || response.status === 403) break
			continue
		}

		let raw: string
		try {
			raw = await readNvidiaText(response)
		} catch (error) {
			const message = error instanceof Error ? error.message.slice(0, 300) : 'NVIDIA stream failed.'
			console.warn('[api/ai/generate] stream failed', { model, error: message })
			attempts.push({ model, error: message })
			continue
		}

		const parsed = extractJsonObject(raw)
		if (!parsed) {
			attempts.push({ model, error: 'The model did not return a JSON storyboard.' })
			continue
		}

		const storyboard = normalizeStoryboard(parsed, localPlan, {
			avoidDesignFingerprints,
			avoidTemplates,
			allowThreeDimensional,
		})
		try {
			const payload = payloadFor(storyboard, model, 'nvidia', attempts)
			console.info('[api/ai/generate] storyboard accepted', {
				model,
				durationMs: Date.now() - startedAt,
				scenes: payload.scenes.length,
				seconds: payload.seconds,
				designFingerprint: payload.designFingerprint,
			})
			return Response.json(payload, { headers: { 'cache-control': 'no-store' } })
		} catch (error) {
			const message = error instanceof Error ? error.message.slice(0, 300) : 'Composition failed.'
			console.warn('[api/ai/generate] compose failed', { model, error: message })
			attempts.push({ model, error: message })
		}
	}

	const credentialProblem = attempts.some((attempt) =>
		/authorization|api key|unauthorized|forbidden|invalid.*key/i.test(attempt.error),
	)
	const notice = credentialProblem
		? 'NVIDIA rejected the credential, so the Studio director planned this video locally. NVIDIA keys start with nvapi-; update NVIDIA_API_KEY and restart the server.'
		: `No NVIDIA model answered in time, so the Studio director planned this video locally. ${attempts
				.map((attempt) => `${attempt.model}: ${attempt.error}`)
				.join(' | ')
				.slice(0, 400)}`

	try {
		return Response.json(payloadFor(localPlan, 'studio-director', 'studio', attempts, notice), {
			headers: { 'cache-control': 'no-store' },
		})
	} catch (error) {
		return Response.json(
			{
				error: error instanceof Error ? error.message : 'The Studio director could not compose a video.',
				attempts,
			},
			{ status: 500 },
		)
	}
}
