/** Server-side Gemini speech recognition. Never import this module from client code. */
import { GoogleGenAI } from '@google/genai'
import { setTimeout as sleep } from 'node:timers/promises'
import { rivaLocale, type CloudWord } from './asr-models'

export const GEMINI_TRANSCRIBE_MODEL = 'gemini-3.5-transcribe'

export function geminiApiKey(): string | null {
	return process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim() || null
}

export class GeminiTranscriptionError extends Error {
	constructor(message: string, readonly code: string, readonly retryable = false) {
		super(message)
	}
}

function record(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === 'object' ? value as Record<string, unknown> : null
}

/** Google Duration strings are seconds, including fractional seconds. */
function offsetMs(value: unknown): number {
	if (typeof value !== 'string' || !/^\d+(?:\.\d+)?s$/.test(value)) return NaN
	return Math.round(Number(value.slice(0, -1)) * 1000)
}

/** Reject a damaged answer as a whole; filtering bad words silently loses speech. */
export function parseGeminiTranscript(payload: unknown, durationMs: number, allowZeroDuration = false): {
	text: string; words: CloudWord[]; estimated: false; timingWarnings: string[]
} {
	const response = record(payload)
	const invalid = () => new GeminiTranscriptionError(
		'Gemini returned incomplete text or invalid word timestamps. Please retry transcription.',
		'invalid-transcript', true,
	)
	if (!response || response.status !== 'completed' || !Array.isArray(response.steps)) throw invalid()
	const words: CloudWord[] = []
	const texts: string[] = []
	const timingWarnings: string[] = []
	for (const step of response.steps) {
		const output = record(step)
		if (output?.type !== 'model_output' || !Array.isArray(output.content)) continue
		for (const entry of output.content) {
			const content = record(entry)
			if (content?.type !== 'text') continue
			if (typeof content.text === 'string') texts.push(content.text)
			for (const annotation of Array.isArray(content.annotations) ? content.annotations : []) {
				const word = record(annotation)
				if (word?.type !== 'word_info') continue
				const text = typeof word.text === 'string' ? word.text.trim() : ''
				const startMs = offsetMs(word.start_offset)
				let endMs = offsetMs(word.end_offset)
				if (allowZeroDuration && endMs === startMs && Number.isFinite(startMs) && startMs < durationMs) {
					// Some short words collapse onto one timestamp. Preserve the onset
					// and neighboring clocks; this is a display span, not measured duration.
					endMs = startMs + 1
					timingWarnings.push(`Review "${text}" at ${(startMs / 1000).toFixed(3)}s: Gemini returned zero duration; a 1 ms display span was added.`)
				}
				if (!text || !Number.isFinite(startMs) || !Number.isFinite(endMs) ||
					endMs <= startMs || endMs > durationMs ||
					(words.length > 0 && startMs < words[words.length - 1].startMs)) throw invalid()
				words.push({ text, startMs, endMs })
			}
		}
	}
	const text = (typeof response.output_text === 'string' ? response.output_text : texts.join(' ')).trim()
	// Punctuation/spacing can differ from annotations; spoken characters cannot.
	const spoken = (value: string) => value.normalize('NFC').replace(/[\p{P}\p{Z}\s]/gu, '')
	if (spoken(text) !== spoken(words.map(word => word.text).join(' '))) throw invalid()
	return { text, words, estimated: false, timingWarnings }
}

export async function callGemini(args: {
	audio: Blob; key: string; language: string; durationMs: number; signal: AbortSignal
}): Promise<{ text: string; words: CloudWord[]; estimated: false; timingWarnings: string[] }> {
	const client = new GoogleGenAI({ apiKey: args.key })
	const data = Buffer.from(await args.audio.arrayBuffer()).toString('base64')
	const signal = AbortSignal.any([args.signal, AbortSignal.timeout(90_000)])
	// Dedicated ASR uses transcription controls instead of an instruction prompt.
	// Smart mode and custom vocabulary are incompatible with word timestamps.
	const languageCodes = args.language === 'auto' ? [] : [rivaLocale(args.language)]
	let invalidResponses = 0
	for (let attempt = 0; ; attempt++) {
		signal.throwIfAborted()
		try {
			const response = await client.interactions.create({
				model: GEMINI_TRANSCRIBE_MODEL,
				store: false,
				input: [{ type: 'audio', data, mime_type: 'audio/wav' }],
				generation_config: {
					transcription_config: {
						language_codes: languageCodes,
						mode: { type: 'verbatim', timestamp_granularities: ['word'] },
					},
				},
			}, { signal, retries: { strategy: 'none' } })
			return parseGeminiTranscript(response, args.durationMs, invalidResponses > 0)
		} catch (error) {
			if (signal.aborted) throw signal.reason
			const info = record(error)
			const status = Number(info?.statusCode ?? info?.status ?? record(info?.response)?.status)
			const retryable = error instanceof GeminiTranscriptionError ? error.retryable : status === 429 || status >= 500
			if (error instanceof GeminiTranscriptionError) invalidResponses++
			if (retryable && attempt < 2 && (!(error instanceof GeminiTranscriptionError) || invalidResponses <= 1)) {
				await sleep(500 * 2 ** attempt + Math.floor(Math.random() * 250), undefined, { signal })
				continue
			}
			if (error instanceof GeminiTranscriptionError) throw error
			// Never echo SDK errors: they can contain request headers or audio data.
			throw new GeminiTranscriptionError(
				`Gemini transcription failed${Number.isFinite(status) ? ` (HTTP ${status})` : ''}. Check the server key, model access, and quota.`,
				status === 401 || status === 403 || status === 400 ? 'credentials' : status === 429 ? 'rate-limit' : 'upstream',
			)
		}
	}
}
