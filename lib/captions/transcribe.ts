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

import type { WhisperWebLanguage } from '@remotion/whisper-web'
import { groupWordsIntoCues, type WordTiming } from './cues'
import type {
	CaptionCue,
	CaptionLayoutOptions,
	TranscribeProgress,
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
		const { canUseWhisperWeb } = await import('@remotion/whisper-web')
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
		const { getLoadedModels } = await import('@remotion/whisper-web')
		return (await getLoadedModels()) as WhisperModelId[]
	} catch {
		return []
	}
}

export async function deleteWhisperModel(model: WhisperModelId): Promise<void> {
	const { deleteModel } = await import('@remotion/whisper-web')
	await deleteModel(model)
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

/**
 * Runs the whole pipeline and returns ready-to-edit cues.
 * Word timings come straight from the model, so karaoke highlighting lines up
 * with the speaker without any manual work.
 */
export async function transcribeToCues(args: TranscribeArgs): Promise<CaptionCue[]> {
	const { source, model, language, layout, onProgress, signal } = args
	assertLive(signal)

	const { downloadWhisperModel, resampleTo16Khz, toCaptions, transcribe } = await import(
		'@remotion/whisper-web'
	)

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
	const result = await transcribe({
		channelWaveform,
		model,
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

	const { captions } = toCaptions({ whisperWebOutput: result })
	const words: WordTiming[] = captions
		.map((caption) => ({
			text: caption.text.trim(),
			startMs: caption.startMs,
			endMs: Math.max(caption.startMs + 1, caption.endMs),
		}))
		.filter((word) => word.text.length > 0 && !/^\[.*\]$/.test(word.text))

	if (words.length === 0) {
		throw new Error(
			'No speech was found in that video. Check that it has an audio track, or write the transcript by hand.',
		)
	}

	onProgress({ stage: 'done', progress: 1, message: `${words.length} words transcribed` })
	return groupWordsIntoCues(words, layout)
}
