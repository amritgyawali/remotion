import 'server-only'

import { AUTO_MODEL_ORDER } from '../ai-models'

const NVIDIA_ENDPOINT = 'https://integrate.api.nvidia.com/v1/chat/completions'

type NvidiaResponse = {
	choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>
	error?: { message?: string }
}

export type NvidiaJsonResult = {
	data: Record<string, unknown>
	model: string
}

function responseText(content: string | Array<{ type?: string; text?: string }> | undefined): string {
	if (typeof content === 'string') return content
	if (!Array.isArray(content)) return ''
	return content.map((item) => (typeof item.text === 'string' ? item.text : '')).join('')
}

function extractJson(raw: string): Record<string, unknown> | null {
	const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
	const source = fenced ?? raw
	const first = source.indexOf('{')
	const last = source.lastIndexOf('}')
	if (first < 0 || last <= first) return null
	try {
		const parsed = JSON.parse(source.slice(first, last + 1)) as unknown
		return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: null
	} catch {
		return null
	}
}

export async function requestNvidiaJson({
	system,
	user,
	maxTokens = 5_000,
	temperature = 0.25,
}: {
	system: string
	user: string
	maxTokens?: number
	temperature?: number
}): Promise<NvidiaJsonResult> {
	const apiKey = process.env.NVIDIA_API_KEY?.trim()
	if (!apiKey) {
		throw new Error('NVIDIA_API_KEY is not configured. Add the same NVIDIA key used by the video creator.')
	}

	const failures: string[] = []
	for (const model of AUTO_MODEL_ORDER) {
		try {
			const response = await fetch(NVIDIA_ENDPOINT, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${apiKey}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					model,
					messages: [
						{ role: 'system', content: system },
						{ role: 'user', content: user },
					],
					stream: false,
					temperature,
					top_p: 0.9,
					max_tokens: maxTokens,
					...(model.startsWith('nvidia/nemotron-')
						? { chat_template_kwargs: { enable_thinking: false, force_nonempty_content: true } }
						: {}),
				}),
				signal: AbortSignal.timeout(55_000),
			})

			const payload = (await response.json().catch(() => ({}))) as NvidiaResponse
			if (!response.ok) {
				throw new Error(payload.error?.message || `HTTP ${response.status}`)
			}
			const data = extractJson(responseText(payload.choices?.[0]?.message?.content))
			if (!data) throw new Error('The model response did not contain valid JSON.')
			return { data, model }
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			failures.push(`${model}: ${message.slice(0, 180)}`)
		}
	}

	throw new Error(`NVIDIA models did not return a usable response. ${failures.join(' | ').slice(0, 650)}`)
}
