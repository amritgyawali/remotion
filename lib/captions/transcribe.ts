'use client'

/**
 * On-device speech to text with Whisper compiled to WebAssembly.
 *
 * Nothing leaves the machine: the model is downloaded once from the public
 * whisper.cpp mirror into IndexedDB, the audio is decoded and resampled in the
 * browser, and the transcript is produced by WASM in a worker. That needs
 * SharedArrayBuffer, which browsers only hand out to a cross-origin isolated
 * document - /captions ships the COOP/COEP headers for exactly this reason.
 */

import type { TranscriptionItemWithTimestamp, WhisperWebLanguage } from '@remotion/whisper-web'
import { groupWordsIntoCues, type WordTiming } from './cues'
import { alignmentReport, snapWordsToSpeech } from './align'
import { detectSpeech, type SpeechSegment } from './vad'
import type {
	CaptionCue,
	CaptionLayoutOptions,
	CaptionVideoSource,
	TranscribeEngine,
	TranscribeProgress,
	TranscriptOrigin,
	WhisperModelId,
} from './types'

export type WhisperModelInfo = {
	id: WhisperModelId
	label: string
	sizeInBytes: number
	note: string
	englishOnly: boolean
}

/** Sizes match @remotion/whisper-web's own table, shown before any download. */
export const WHISPER_MODELS: WhisperModelInfo[] = [
	{
		id: 'tiny.en',
		label: 'Tiny - English',
		sizeInBytes: 77_704_715,
		note: 'Fastest. Good for clear speech and quick drafts.',
		englishOnly: true,
	},
	{
		id: 'base.en',
		label: 'Base - English',
		sizeInBytes: 147_964_211,
		note: 'The sweet spot for English talking-head video.',
		englishOnly: true,
	},
	{
		id: 'small.en',
		label: 'Small - English',
		sizeInBytes: 487_614_201,
		note: 'Most accurate English. Slower and a bigger download.',
		englishOnly: true,
	},
	{
		id: 'tiny',
		label: 'Tiny - multilingual',
		sizeInBytes: 77_691_713,
		note: 'Fastest multilingual model, 99 languages.',
		englishOnly: false,
	},
	{
		id: 'base',
		label: 'Base - multilingual',
		sizeInBytes: 147_951_465,
		note: 'Balanced multilingual accuracy.',
		englishOnly: false,
	},
	{
		id: 'small',
		label: 'Small - multilingual',
		sizeInBytes: 487_601_967,
		note: 'Best multilingual quality this studio can run on-device.',
		englishOnly: false,
	},
]

/**
 * Speech profiles.
 *
 * Whisper is one model with two very different personalities: the `.en` builds
 * are faster and better at English but cannot produce any other language, and
 * the multilingual builds get dramatically better at low-resource languages as
 * they grow. Nepali is a low-resource language, and Nepali speech in practice
 * is code-switched - "यो feature धेरै राम्रो छ" - so it wants the largest
 * multilingual model this studio can run on-device, told that the base
 * language is Nepali. English words in the audio still come out as English.
 */
export type SpeechProfile = {
	id: 'nepali-english' | 'nepali' | 'english' | 'other'
	label: string
	language: string
	model: WhisperModelId
	note: string
}

export const SPEECH_PROFILES: SpeechProfile[] = [
	{
		id: 'nepali-english',
		label: 'Nepali + English',
		language: 'ne',
		model: 'small',
		note: 'Code-switched speech. Nepali is transcribed in Devanagari, English words stay in Latin - the studio loads a Devanagari face so both render.',
	},
	{
		id: 'nepali',
		label: 'Nepali',
		language: 'ne',
		model: 'small',
		note: 'Nepali throughout, written in Devanagari.',
	},
	{
		id: 'english',
		label: 'English',
		language: 'en',
		model: 'base.en',
		note: 'English-only model: faster, and more accurate on English than a multilingual build of the same size.',
	},
	{
		id: 'other',
		label: 'Other language',
		language: 'auto',
		model: 'base',
		note: 'Pick the spoken language below. Detection also works, but naming the language is more reliable on short or noisy clips.',
	},
]

export function profileById(id: SpeechProfile['id']): SpeechProfile {
	return SPEECH_PROFILES.find((profile) => profile.id === id) ?? SPEECH_PROFILES[0]
}

/** `.en` builds cannot produce Devanagari - or anything but English. */
export function modelSupportsLanguage(model: WhisperModelId, language: string): boolean {
	if (!model.endsWith('.en')) return true
	return language === 'en'
}

export const WHISPER_LANGUAGES: { value: string; label: string }[] = [
	{ value: 'auto', label: 'Detect automatically' },
	{ value: 'en', label: 'English' },
	{ value: 'es', label: 'Spanish' },
	{ value: 'hi', label: 'Hindi' },
	{ value: 'ne', label: 'Nepali' },
	{ value: 'fr', label: 'French' },
	{ value: 'de', label: 'German' },
	{ value: 'pt', label: 'Portuguese' },
	{ value: 'it', label: 'Italian' },
	{ value: 'nl', label: 'Dutch' },
	{ value: 'ru', label: 'Russian' },
	{ value: 'uk', label: 'Ukrainian' },
	{ value: 'tr', label: 'Turkish' },
	{ value: 'ar', label: 'Arabic' },
	{ value: 'fa', label: 'Persian' },
	{ value: 'ur', label: 'Urdu' },
	{ value: 'bn', label: 'Bengali' },
	{ value: 'ta', label: 'Tamil' },
	{ value: 'te', label: 'Telugu' },
	{ value: 'id', label: 'Indonesian' },
	{ value: 'vi', label: 'Vietnamese' },
	{ value: 'th', label: 'Thai' },
	{ value: 'ja', label: 'Japanese' },
	{ value: 'ko', label: 'Korean' },
	{ value: 'zh', label: 'Chinese' },
	{ value: 'pl', label: 'Polish' },
	{ value: 'sv', label: 'Swedish' },
	{ value: 'da', label: 'Danish' },
	{ value: 'no', label: 'Norwegian' },
	{ value: 'fi', label: 'Finnish' },
	{ value: 'he', label: 'Hebrew' },
	{ value: 'sw', label: 'Swahili' },
]

export class TranscriptionCancelled extends Error {
	constructor() {
		super('Transcription cancelled')
		this.name = 'TranscriptionCancelled'
	}
}

/** Raised when the whisper bundle itself never arrives - see loadWhisperWeb. */
export class WhisperBundleError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'WhisperBundleError'
	}
}

type WhisperWebModule = typeof import('@remotion/whisper-web')

let whisperModule: Promise<WhisperWebModule> | null = null

function isChunkLoadError(error: unknown): boolean {
	if (!(error instanceof Error)) return false
	return (
		error.name === 'ChunkLoadError' ||
		/loading chunk|failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed/i.test(
			error.message,
		)
	)
}

/**
 * Loads the WebAssembly speech bundle, and survives the one failure mode users
 * actually hit: `Loading chunk N failed`.
 *
 * That error means the JavaScript chunk holding the model runtime never
 * arrived - a deploy replaced the file the open tab was told to fetch, a proxy
 * or offline cache served a 404, or the network dropped mid-download. Webpack
 * does not cache the rejected request, so a plain retry usually succeeds; when
 * it does not, the message has to say what to do rather than leak a chunk
 * number, and the studio falls back to cloud transcription.
 */
export async function loadWhisperWeb(): Promise<WhisperWebModule> {
	whisperModule ??= (async () => {
		let lastError: unknown
		for (let attempt = 1; attempt <= 3; attempt++) {
			try {
				return await import('@remotion/whisper-web')
			} catch (error) {
				lastError = error
				if (!isChunkLoadError(error)) break
				await new Promise((resolve) => setTimeout(resolve, 350 * attempt))
			}
		}

		if (isChunkLoadError(lastError)) {
			throw new WhisperBundleError(
				'The on-device speech engine could not be downloaded into this tab - the studio was most likely updated while the page was open. Reload the page (Ctrl+Shift+R / Cmd+Shift+R) and try again, or use NVIDIA cloud transcription, which needs no download.',
			)
		}
		throw lastError instanceof Error
			? new WhisperBundleError(`The on-device speech engine failed to load: ${lastError.message}`)
			: new WhisperBundleError('The on-device speech engine failed to load.')
	})()

	try {
		return await whisperModule
	} catch (error) {
		// A failed load must not poison every later attempt.
		whisperModule = null
		throw error
	}
}

export type WhisperSupport = {
	supported: boolean
	reason?: string
	/** true when the page is not cross-origin isolated, which we can explain precisely */
	needsIsolation: boolean
}

export async function checkWhisperSupport(model: WhisperModelId): Promise<WhisperSupport> {
	if (typeof window === 'undefined') {
		return { supported: false, reason: 'Not available during server rendering.', needsIsolation: false }
	}
	try {
		const { canUseWhisperWeb } = await loadWhisperWeb()
		const result = await canUseWhisperWeb(model)
		const needsIsolation = result.reason === 'not-cross-origin-isolated'
		return {
			supported: result.supported,
			reason: result.detailedReason,
			needsIsolation,
		}
	} catch (error) {
		return {
			supported: false,
			reason: error instanceof Error ? error.message : String(error),
			needsIsolation: false,
		}
	}
}

/** Models already sitting in IndexedDB, so the UI can say "ready" instead of "244 MB". */
export async function loadedWhisperModels(): Promise<WhisperModelId[]> {
	try {
		const { getLoadedModels } = await loadWhisperWeb()
		return (await getLoadedModels()) as WhisperModelId[]
	} catch {
		return []
	}
}

export async function deleteWhisperModel(model: WhisperModelId): Promise<void> {
	const { deleteModel } = await loadWhisperWeb()
	await deleteModel(model)
}

/* ------------------------------------------------------- transcript hygiene */

/** Bracketed sound events: [Music], (applause), ♪ ... ♪, 【音楽】. */
const NON_SPEECH_SEGMENT = /^\s*[[(♪【][^\])♪】]*[\])♪】]?\s*$/

/**
 * Whisper fills silence with whatever its training data put after silence:
 * subtitle credits, channel sign-offs and translation-site plugs. They arrive
 * as complete segments, which is exactly where they are cheapest to drop.
 */
const CREDIT_SEGMENT =
	/(subtitle[sd]?\s+by|subtitling by|transcription by|amara\.org|subscribe|thanks for watching|उपशीर्षक|अनुवाद\s*:|सदस्यता)/i

function isJunkSegment(text: string): boolean {
	const trimmed = text.trim()
	if (trimmed.length === 0) return true
	if (NON_SPEECH_SEGMENT.test(trimmed)) return true
	if (CREDIT_SEGMENT.test(trimmed)) return true
	// A segment of pure punctuation carries no words to caption.
	return !/[\p{L}\p{N}]/u.test(trimmed)
}

/**
 * Cleans the raw model output before it becomes captions: drops non-speech and
 * credit segments, and collapses the repeat loops Whisper falls into on music
 * or long silence (the same line emitted five times in a row).
 */
export function cleanTranscription(
	segments: TranscriptionItemWithTimestamp[],
): TranscriptionItemWithTimestamp[] {
	const kept: TranscriptionItemWithTimestamp[] = []
	let repeats = 0

	for (const segment of segments) {
		if (isJunkSegment(segment.text)) continue
		if (segment.offsets.to <= segment.offsets.from) continue

		const previous = kept[kept.length - 1]
		const sameAsPrevious =
			previous !== undefined && previous.text.trim() === segment.text.trim()
		if (sameAsPrevious) {
			repeats++
			// One repetition can be real speech; three in a row is the model looping.
			if (repeats >= 2) continue
		} else {
			repeats = 0
		}

		kept.push(segment)
	}

	return kept
}

export type TranscribeArgs = {
	/** the uploaded video, or any blob holding the audio to read */
	source: Blob
	model: WhisperModelId
	language: string
	layout: CaptionLayoutOptions
	onProgress: (progress: TranscribeProgress) => void
	signal: AbortSignal
}

function assertLive(signal: AbortSignal): void {
	if (signal.aborted) throw new TranscriptionCancelled()
}

export type DeviceTranscription = {
	words: WordTiming[]
	/** where speech actually is, measured from the same waveform Whisper heard */
	speech: SpeechSegment[]
	/** constant offset removed from the model's timings, ms */
	offsetMs: number
	/** words that had to be pulled out of a silence */
	rescued: number
}

/**
 * Runs the on-device pipeline and returns one timed word per entry.
 *
 * Whisper's word timings come from its own attention, not from a forced
 * aligner, so they drift on long segments and sit slightly late after a pause.
 * The waveform is right here, so it is measured too, and the timings are put
 * back on the speech before anything downstream sees them - which is what makes
 * a karaoke highlight land on the syllable rather than near it.
 */
export async function transcribeOnDevice(
	args: Omit<TranscribeArgs, 'layout'>,
): Promise<DeviceTranscription> {
	const { source, model, language, onProgress, signal } = args
	assertLive(signal)

	const { downloadWhisperModel, resampleTo16Khz, toCaptions, transcribe } = await loadWhisperWeb()

	onProgress({ stage: 'downloading-model', progress: 0, message: `Preparing the ${model} model` })
	const { alreadyDownloaded } = await downloadWhisperModel({
		model,
		onProgress: ({ progress }) => {
			if (signal.aborted) return
			onProgress({
				stage: 'downloading-model',
				progress,
				message: `Downloading the ${model} model - ${Math.round(progress * 100)}%`,
			})
		},
	}).catch((error: unknown) => {
		if (signal.aborted) throw new TranscriptionCancelled()
		// The model is a one-off fetch from the public whisper.cpp mirror, so a
		// blocked network reads as a bare "Failed to fetch" without this.
		throw new Error(
			`Could not download the ${model} speech model from huggingface.co (${
				error instanceof Error ? error.message : String(error)
			}). Check the connection or a network policy that blocks it - or write the transcript by hand instead.`,
		)
	})
	assertLive(signal)
	onProgress({
		stage: 'decoding-audio',
		progress: 0,
		message: alreadyDownloaded
			? 'Model ready on this device - decoding audio'
			: 'Model stored for next time - decoding audio',
	})

	const channelWaveform = await resampleTo16Khz({
		file: source,
		onProgress: (progress) => {
			if (signal.aborted) return
			onProgress({
				stage: 'decoding-audio',
				progress,
				message: `Decoding audio - ${Math.round(progress * 100)}%`,
			})
		},
	})
	assertLive(signal)

	onProgress({ stage: 'transcribing', progress: 0, message: 'Listening to the audio' })
	let heard = 0
	// Whisper.cpp scales well across cores but pays for oversubscription; the
	// browser also needs a core left over to keep painting the progress bar.
	const threads = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1))
	const result = await transcribe({
		channelWaveform,
		model,
		threads,
		language: language === 'auto' ? undefined : (language as WhisperWebLanguage),
		onProgress: (progress) => {
			if (signal.aborted) return
			onProgress({
				stage: 'transcribing',
				progress,
				message: `Transcribing - ${Math.round(progress * 100)}%${heard ? ` - ${heard} segments` : ''}`,
			})
		},
		onTranscriptionChunk: (chunk) => {
			heard += chunk.length
		},
	})
	assertLive(signal)

	const segments = cleanTranscription(result.transcription)
	const { captions } = toCaptions({ whisperWebOutput: segments })
	const words: WordTiming[] = captions
		.map((caption) => ({
			text: caption.text.trim(),
			startMs: caption.startMs,
			endMs: Math.max(caption.startMs + 1, caption.endMs),
		}))
		.filter((word) => word.text.length > 0 && /[\p{L}\p{N}]/u.test(word.text))

	if (words.length === 0) {
		throw new Error(
			result.transcription.length > 0
				? 'Only music or silence was recognised in that video. Try a larger model, or write the transcript by hand.'
				: 'No speech was found in that video. Check that it has an audio track, or write the transcript by hand.',
		)
	}

	// Whisper heard exactly this waveform, so measuring it here is the closest
	// thing to a forced alignment the on-device path can get.
	const speech = detectSpeech(channelWaveform, { sampleRate: 16_000 }).segments
	const snapped = snapWordsToSpeech(words, speech, { maxShiftMs: 1_200 })

	onProgress({ stage: 'transcribing', progress: 1, message: `${words.length} words transcribed` })
	return {
		words: snapped.words,
		speech,
		offsetMs: snapped.offsetMs,
		rescued: snapped.rescued,
	}
}

/** Kept for callers that only want cues from the on-device engine. */
export async function transcribeToCues(args: TranscribeArgs): Promise<CaptionCue[]> {
	const { words, speech } = await transcribeOnDevice(args)
	return groupWordsIntoCues(words, args.layout, { speech })
}

/* --------------------------------------------------------- engine routing */

export type TranscriptionOutcome = {
	cues: CaptionCue[]
	origin: TranscriptOrigin
	engine: 'nvidia' | 'device'
	/** the recogniser that produced the words, for the UI and the .tsx header */
	model: string
	/** anything the user should know that is not an outright failure */
	notice?: string
	/** where speech is, so a later re-cut can still break on real pauses */
	speech?: SpeechSegment[]
	/** share of words that landed on measured speech, 0 - 1 */
	onSpeech?: number
	/** constant offset the aligner took out of the transcript, ms */
	offsetMs?: number
}

export type RunTranscriptionArgs = {
	video: CaptionVideoSource
	engine: TranscribeEngine
	language: string
	whisperModel: WhisperModelId
	/** null lets the server pick the cloud model that fits the language */
	cloudModel: string | null
	layout: CaptionLayoutOptions
	/** run the NVIDIA punctuation and spelling pass over the finished cues */
	polish: boolean
	onProgress: (progress: TranscribeProgress) => void
	signal: AbortSignal
}

/** The bytes to transcribe: the upload itself, or the remote clip fetched once. */
async function sourceBlob(video: CaptionVideoSource): Promise<Blob> {
	if (video.file) return video.file
	const response = await fetch(video.url).catch(() => {
		throw new Error(
			'That video URL cannot be read by this page (the server did not allow a cross-origin read). Download the file and upload it instead.',
		)
	})
	if (!response.ok) throw new Error(`Could not read the video (HTTP ${response.status}).`)
	return response.blob()
}

function describeError(error: unknown): string {
	if (error instanceof Error) return error.message
	return String(error)
}

/**
 * The one entry point the studio calls.
 *
 * It picks a recogniser, runs it, and - when the choice was `auto` - falls back
 * to the other one rather than handing the user an error they cannot act on.
 * The two engines fail for completely unrelated reasons (a missing server key
 * versus a browser that will not give the tab a SharedArrayBuffer), so the
 * second attempt genuinely tends to succeed where the first did not.
 */
export async function runTranscription(args: RunTranscriptionArgs): Promise<TranscriptionOutcome> {
	const { video, engine, language, whisperModel, cloudModel, layout, polish, onProgress, signal } =
		args
	assertLive(signal)

	onProgress({ stage: 'checking', progress: 0, message: 'Choosing a speech engine' })
	const { cloudAsrStatus, refineCues, transcribeInCloud } = await import('./cloud-transcribe')

	const status = engine === 'device' ? null : await cloudAsrStatus()
	assertLive(signal)

	const order: Array<'nvidia' | 'device'> =
		engine === 'nvidia'
			? ['nvidia']
			: engine === 'device'
				? ['device']
				: status?.configured
					? ['nvidia', 'device']
					: ['device', 'nvidia']

	const blob = await sourceBlob(video)
	assertLive(signal)

	const failures: string[] = []

	for (const attempt of order) {
		try {
			if (attempt === 'nvidia') {
				if (status && !status.configured && engine !== 'nvidia') {
					throw new Error(status.reason ?? 'Cloud transcription is not configured on this server.')
				}
				const result = await transcribeInCloud({
					source: blob,
					language,
					model: cloudModel,
					durationSeconds: video.durationInSeconds,
					onProgress,
					signal,
				})
				assertLive(signal)

				if (result.words.length === 0) {
					throw new Error(
						result.silent
							? 'That video has an audio track, but it is silent from start to finish.'
							: 'NVIDIA returned no words for that audio. Try the on-device engine, or write the transcript by hand.',
					)
				}

				const notices: string[] = []
				if (failures.length > 0) notices.push(failures[failures.length - 1])
				if (result.failedChunks > 0) {
					notices.push(
						`${result.failedChunks} of ${result.chunks} audio chunks could not be transcribed, so a few seconds may be missing.`,
					)
				}
				// Say what actually happened to the clock. "Estimated" used to mean
				// "spread evenly and probably wrong"; it now means "aligned to the
				// speech in your audio", which is a different promise entirely.
				if (result.timing === 'aligned') {
					notices.push(
						'That model returns text without word timings, so each word was aligned to the speech measured in your audio rather than spread across the clip.',
					)
				} else if (result.timing === 'spread') {
					notices.push(
						'That model returned no word timings and no speech could be measured in parts of the audio, so some word timing is an estimate from word length.',
					)
				}
				if (Math.abs(result.alignment.offsetMs) >= 120) {
					notices.push(
						`The recogniser ran ${Math.abs(result.alignment.offsetMs)}ms ${
							result.alignment.offsetMs > 0 ? 'early' : 'late'
						}; the transcript was shifted onto the speech.`,
					)
				}
				if (result.alignment.onSpeech < 0.75) {
					notices.push(
						`Only ${Math.round(result.alignment.onSpeech * 100)}% of words landed on detected speech - check the timing on a noisy or music-heavy clip.`,
					)
				}

				let cues = groupWordsIntoCues(result.words, layout, { speech: result.speech })
				if (polish) {
					onProgress({
						stage: 'polishing',
						progress: 0.99,
						message: 'Tidying punctuation with NVIDIA',
					})
					const refined = await refineCues(cues, { language, signal })
					cues = refined.cues
					if (refined.notice) notices.push(refined.notice)
				}

				onProgress({ stage: 'done', progress: 1, message: `${result.words.length} words transcribed` })
				return {
					cues,
					origin: 'nvidia',
					engine: 'nvidia',
					model: result.model || 'NVIDIA',
					notice: notices.length > 0 ? notices.join(' ') : undefined,
					speech: result.speech,
					onSpeech: result.alignment.onSpeech,
					offsetMs: result.alignment.offsetMs,
				}
			}

			const support = await checkWhisperSupport(whisperModel)
			if (!support.supported) {
				throw new Error(
					support.needsIsolation
						? 'This browser will not give the page a SharedArrayBuffer, which the on-device model needs.'
						: (support.reason ?? 'On-device speech recognition is unavailable here.'),
				)
			}

			const device = await transcribeOnDevice({
				source: blob,
				model: whisperModel,
				language,
				onProgress,
				signal,
			})
			assertLive(signal)

			const words = device.words
			let cues = groupWordsIntoCues(words, layout, { speech: device.speech })
			const notices = failures.length > 0 ? [failures[failures.length - 1]] : []
			if (Math.abs(device.offsetMs) >= 120) {
				notices.push(
					`Whisper ran ${Math.abs(device.offsetMs)}ms ${
						device.offsetMs > 0 ? 'early' : 'late'
					}; the transcript was shifted onto the speech.`,
				)
			}
			if (polish) {
				onProgress({ stage: 'polishing', progress: 0.99, message: 'Tidying punctuation with NVIDIA' })
				const refined = await refineCues(cues, { language, signal })
				cues = refined.cues
				if (refined.notice) notices.push(refined.notice)
			}

			onProgress({ stage: 'done', progress: 1, message: `${words.length} words transcribed` })
			const report = alignmentReport(words, device.speech, device)
			return {
				cues,
				origin: 'whisper',
				engine: 'device',
				model: whisperModel,
				notice: notices.length > 0 ? notices.join(' ') : undefined,
				speech: device.speech,
				onSpeech: report.onSpeech,
				offsetMs: device.offsetMs,
			}
		} catch (error) {
			if (error instanceof TranscriptionCancelled || signal.aborted) throw new TranscriptionCancelled()
			const label = attempt === 'nvidia' ? 'NVIDIA cloud transcription' : 'On-device transcription'
			failures.push(`${label} failed: ${describeError(error)}`)
			// A single-engine run has nowhere to fall back to, so the error says
			// which other engine is still worth trying rather than dead-ending.
			if (order.length === 1 || attempt === order[order.length - 1]) {
				const hint =
					order.length === 1
						? attempt === 'nvidia'
							? ' Set the speech engine to Auto or On this device to transcribe without NVIDIA.'
							: ' Set the speech engine to Auto or NVIDIA cloud to transcribe without a model download.'
						: ''
				throw new Error(`${failures.join(' Then ')}${hint}`)
			}
			onProgress({
				stage: 'checking',
				progress: 0,
				message: `${label} failed - trying the other engine`,
			})
		}
	}

	throw new Error(failures.join(' Then ') || 'No speech engine was available.')
}
