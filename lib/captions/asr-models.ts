/**
 * NVIDIA-hosted speech recognition, described once for both sides of the wire.
 *
 * The Subtitle Studio can transcribe two ways: inside the tab with Whisper
 * compiled to WebAssembly, or on NVIDIA's hosted speech models. The cloud path
 * exists because the on-device one is fragile in ways a user cannot fix - it
 * needs a cross-origin isolated document for SharedArrayBuffer, a ~500 MB model
 * download for usable Nepali, and enough memory to run it - while an upload of
 * 16 kHz mono audio works in every browser on every device.
 *
 * Each hosted model is an NVIDIA Cloud Function, addressed by the function id
 * recorded here and reached over gRPC at grpc.nvcf.nvidia.com:443. Those ids
 * come from the "API" tab of each model on build.nvidia.com; they are public
 * routing identifiers, not secrets, and the `nvapi-` key stays on the server.
 *
 * This module is imported by the client and by the route handler, so it must
 * stay free of browser and Node APIs alike.
 */

export type CloudAsrModelId =
	| 'openai/whisper-large-v3'
	| 'nvidia/parakeet-1.1b-rnnt-multilingual-asr'
	| 'nvidia/canary-1b-asr'
	| 'nvidia/parakeet-tdt-0.6b-v2'
	| 'nvidia/parakeet-ctc-1.1b-asr'

export type CloudAsrModel = {
	id: CloudAsrModelId
	label: string
	note: string
	/** NVCF function id from the model's API tab on build.nvidia.com */
	functionId: string
	/** ISO-639-1 codes the model actually transcribes, or `all` for Whisper's 99 */
	languages: 'all' | string[]
	/**
	 * Whisper NIM takes bare ISO codes and the special value `multi` for
	 * detection; the Riva models want a BCP-47 locale such as `en-US`.
	 */
	languageStyle: 'iso' | 'locale'
}

/**
 * Ordered by how widely each one applies. Whisper large-v3 leads because it is
 * the only hosted model that writes Devanagari, which is this studio's primary
 * case; the Parakeet and Canary models are dramatically faster where they apply.
 */
export const CLOUD_ASR_MODELS: CloudAsrModel[] = [
	{
		id: 'openai/whisper-large-v3',
		label: 'Whisper large-v3',
		note: '99 languages including Nepali, and the only cloud model here that writes Devanagari. Best accuracy on code-switched speech.',
		functionId: 'b702f636-f60c-4a3d-a6f4-f3568c13bd7d',
		languages: 'all',
		languageStyle: 'iso',
	},
	{
		id: 'nvidia/parakeet-1.1b-rnnt-multilingual-asr',
		label: 'Parakeet 1.1B multilingual',
		note: 'NVIDIA multilingual model for English, Spanish, German, French, Italian and Portuguese. Much faster than Whisper where it applies.',
		functionId: '71203149-d3b7-4460-8231-1be2543a1fca',
		languages: ['en', 'es', 'de', 'fr', 'it', 'pt'],
		languageStyle: 'locale',
	},
	{
		id: 'nvidia/canary-1b-asr',
		label: 'Canary 1B',
		note: 'English, German, Spanish and French with strong punctuation. Handles accented speech well.',
		functionId: 'b0e8b4a5-217c-40b7-9b96-17d84e666317',
		languages: ['en', 'de', 'es', 'fr'],
		languageStyle: 'locale',
	},
	{
		id: 'nvidia/parakeet-tdt-0.6b-v2',
		label: 'Parakeet TDT 0.6B v2',
		note: 'English only, with punctuation and capitalisation. The fastest option for English footage.',
		functionId: 'd3fe9151-442b-4204-a70d-5fcc597fd610',
		languages: ['en'],
		languageStyle: 'locale',
	},
	{
		id: 'nvidia/parakeet-ctc-1.1b-asr',
		label: 'Parakeet CTC 1.1B',
		note: 'English, larger and steadier than the 0.6B model on noisy or far-field audio.',
		functionId: '1598d209-5e27-4d3c-8079-4751568b1081',
		languages: ['en'],
		languageStyle: 'locale',
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
 * The fastest model that can actually produce the requested language. `auto`
 * means "let the model detect it", which only Whisper does here.
 */
export function cloudModelForLanguage(language: string): CloudAsrModelId {
	if (language === 'en') return 'nvidia/parakeet-tdt-0.6b-v2'
	const multilingual = CLOUD_ASR_MODELS[1]
	if (cloudModelSupports(multilingual, language)) return multilingual.id
	return 'openai/whisper-large-v3'
}

/**
 * Riva-flavoured models want a BCP-47 tag, Whisper wants the bare ISO-639-1
 * code. Anything unmapped falls back to `xx-XX`, which Riva accepts for the
 * many locales that follow that pattern.
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

/**
 * The language codes to try for one model, in order. Whisper accepts `ne`,
 * refuses `ne-NP`, and treats `multi` as "detect it"; the Riva models are the
 * other way round. Trying both, cheapest first, means a language the studio
 * offers can never be rejected purely over its spelling.
 */
export function languageCandidates(model: CloudAsrModel, language: string): string[] {
	if (!language || language === 'auto') return ['multi']
	const iso = language.split('-')[0]
	const locale = rivaLocale(iso)
	const ordered = model.languageStyle === 'iso' ? [iso, locale, 'multi'] : [locale, iso, 'multi']
	return [...new Set(ordered)]
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
	/** which transport answered, so the UI can say where the audio went */
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
	/** the transport/model pair that answered last, once one has */
	verified?: { endpoint: string; model: string } | null
}

/** Hard ceilings shared by the uploader and the route that receives it. */
export const CLOUD_ASR_LIMITS = {
	/** one request must stay under the 4.5 MB body limit a Vercel Function enforces */
	maxChunkBytes: 4 * 1024 * 1024,
	/**
	 * 16 kHz mono 16-bit PCM is 32 kB per second, so 60s ≈ 1.9 MB. Riva's hosted
	 * functions are happiest with a minute or so of offline audio at a time, and
	 * the smaller chunk also keeps a retry cheap.
	 */
	chunkSeconds: 60,
	/** how far the cutter may move a boundary to land it in silence */
	chunkSlackSeconds: 4,
	sampleRate: 16_000,
} as const
