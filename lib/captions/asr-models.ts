/**
 * NVIDIA-hosted speech recognition, described once for both sides of the wire.
 *
 * The Subtitle Studio can transcribe two ways: inside the tab with Whisper
 * compiled to WebAssembly, or on NVIDIA's hosted speech endpoints. The cloud
 * path exists because the on-device one is fragile in ways a user cannot fix -
 * it needs a cross-origin isolated document for SharedArrayBuffer, a ~500 MB
 * model download for usable Nepali, and enough memory to run it - while an
 * upload of 16 kHz mono audio works in every browser on every device.
 *
 * This module is imported by the client and by the route handler, so it must
 * stay free of browser and Node APIs alike.
 */

export type CloudAsrModelId =
	| 'openai/whisper-large-v3'
	| 'nvidia/parakeet-tdt-0.6b-v3'
	| 'nvidia/parakeet-tdt-0.6b-v2'

export type CloudAsrModel = {
	id: CloudAsrModelId
	label: string
	note: string
	/** ISO-639-1 codes the model actually transcribes, or `all` for Whisper's 99. */
	languages: 'all' | string[]
}

/**
 * Ordered by how widely each one applies. Whisper large-v3 leads because it is
 * the only hosted model that writes Devanagari, which is this studio's primary
 * case; the Parakeet models are dramatically faster where they apply.
 */
export const CLOUD_ASR_MODELS: CloudAsrModel[] = [
	{
		id: 'openai/whisper-large-v3',
		label: 'Whisper large-v3',
		note: '99 languages including Nepali, and the only cloud model here that writes Devanagari. Best accuracy on code-switched speech.',
		languages: 'all',
	},
	{
		id: 'nvidia/parakeet-tdt-0.6b-v3',
		label: 'Parakeet TDT 0.6B v3',
		note: 'NVIDIA multilingual model, 25 European languages. Much faster than Whisper where it applies.',
		languages: [
			'bg', 'cs', 'da', 'de', 'el', 'en', 'es', 'et', 'fi', 'fr', 'hr', 'hu', 'it', 'lt', 'lv',
			'mt', 'nl', 'pl', 'pt', 'ro', 'ru', 'sk', 'sl', 'sv', 'uk',
		],
	},
	{
		id: 'nvidia/parakeet-tdt-0.6b-v2',
		label: 'Parakeet TDT 0.6B v2',
		note: 'English only, with punctuation and capitalisation. The fastest option for English footage.',
		languages: ['en'],
	},
]

export function isCloudAsrModel(value: unknown): value is CloudAsrModelId {
	return CLOUD_ASR_MODELS.some((model) => model.id === value)
}

export function cloudAsrModelById(id: string): CloudAsrModel | null {
	return CLOUD_ASR_MODELS.find((model) => model.id === id) ?? null
}

export function cloudModelSupports(model: CloudAsrModel, language: string): boolean {
	if (model.languages === 'all') return true
	if (language === 'auto') return false
	return model.languages.includes(language)
}

/**
 * The cheapest model that can actually produce the requested language.
 * `auto` means "let the model detect it", which only Whisper does here.
 */
export function cloudModelForLanguage(language: string): CloudAsrModelId {
	if (language === 'en') return 'nvidia/parakeet-tdt-0.6b-v2'
	const parakeet = CLOUD_ASR_MODELS[1]
	if (cloudModelSupports(parakeet, language)) return parakeet.id
	return 'openai/whisper-large-v3'
}

/**
 * Riva-flavoured endpoints want a BCP-47 tag, OpenAI-flavoured ones want the
 * bare ISO-639-1 code. Anything unmapped falls back to `xx-XX`, which Riva
 * accepts for the many locales that follow that pattern.
 */
const RIVA_LOCALES: Record<string, string> = {
	ar: 'ar-AR', bn: 'bn-IN', cs: 'cs-CZ', da: 'da-DK', de: 'de-DE', el: 'el-GR', en: 'en-US',
	es: 'es-ES', fa: 'fa-IR', fi: 'fi-FI', fr: 'fr-FR', he: 'he-IL', hi: 'hi-IN', hr: 'hr-HR',
	hu: 'hu-HU', id: 'id-ID', it: 'it-IT', ja: 'ja-JP', ko: 'ko-KR', nl: 'nl-NL', ne: 'ne-NP',
	no: 'nb-NO', pl: 'pl-PL', pt: 'pt-BR', ro: 'ro-RO', ru: 'ru-RU', sk: 'sk-SK', sv: 'sv-SE',
	sw: 'sw-KE', ta: 'ta-IN', te: 'te-IN', th: 'th-TH', tr: 'tr-TR', uk: 'uk-UA', ur: 'ur-PK',
	vi: 'vi-VN', zh: 'zh-CN',
}

export function rivaLocale(language: string): string {
	if (!language || language === 'auto') return 'multi'
	if (language.includes('-')) return language
	return RIVA_LOCALES[language] ?? `${language}-${language.toUpperCase()}`
}

/** One recognised word with timings relative to the start of the clip. */
export type CloudWord = {
	text: string
	startMs: number
	endMs: number
}

export type CloudTranscribeResponse = {
	text: string
	words: CloudWord[]
	model: string
	/** which endpoint answered, so the UI can say where the audio went */
	endpoint: string
	/** true when the endpoint returned text but no usable word timings */
	estimatedTimings: boolean
}

export type CloudAsrStatus = {
	configured: boolean
	/** why the cloud path is unavailable, when it is */
	reason?: string
	endpoints: string[]
	models: CloudAsrModel[]
	/** the endpoint/model pair that answered last, once one has */
	verified?: { endpoint: string; model: string } | null
}

/** Hard ceilings shared by the uploader and the route that receives it. */
export const CLOUD_ASR_LIMITS = {
	/** one request must stay under the 4.5 MB body limit a Vercel Function enforces */
	maxChunkBytes: 4 * 1024 * 1024,
	/** 16 kHz mono 16-bit PCM: 32 kB per second, so 100s ≈ 3.2 MB */
	chunkSeconds: 100,
	/** how far the cutter may move a boundary to land it in silence */
	chunkSlackSeconds: 4,
	sampleRate: 16_000,
} as const
