'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { formatBytes, formatSeconds } from '../../lib/format'
import {
	modelSupportsLanguage,
	profileById,
	SPEECH_PROFILES,
	WHISPER_LANGUAGES,
	WHISPER_MODELS,
	type SpeechProfile,
	type WhisperSupport,
} from '../../lib/captions/transcribe'
import { ACCEPTED_VIDEO_TYPES } from '../../lib/captions/video-source'
import {
	isRestrictiveFilePicker,
	looksLikeSubtitleFile,
	SUBTITLE_ACCEPT,
	SUBTITLE_EXTENSIONS,
} from '../../lib/captions/subtitle-import'
import {
	CLOUD_ASR_MODELS,
	cloudAsrModelById,
	cloudModelForLanguage,
	cloudModelSupports,
	type CloudAsrStatus,
} from '../../lib/captions/asr-models'
import type {
	CaptionCue,
	CaptionLayoutOptions,
	CaptionVideoSource,
	TranscribeEngine,
	TranscribeProgress,
	TranscriptOrigin,
	WhisperModelId,
} from '../../lib/captions/types'
import {
	IconAlert,
	IconCheck,
	IconClock,
	IconCloudOff,
	IconCopy,
	IconDownload,
	IconFilm,
	IconInfo,
	IconLink,
	IconMic,
	IconScissors,
	IconSparkle,
	IconSpinner,
	IconStop,
	IconTrash,
	IconType,
	IconUpload,
	IconVault,
	IconWand,
} from '../Icons'

export type TranscriptMode = 'auto' | 'write' | 'import'

/**
 * A copy-paste handoff to any AI coding assistant: attach ai-caption-template.tsx
 * (downloadable right below), fill in the brackets, and get back a complete,
 * self-contained captioned-video .tsx built on the exact same rendering engine
 * this studio uses - word timing, balanced line breaks, mixed Devanagari/Latin
 * fonts, the legibility scrim. Useful when a user already has a transcript
 * from elsewhere, or wants a bespoke look the design panel can't produce.
 */
const AI_CAPTION_PROMPT = `You are editing the AI Caption Template for a Remotion video project (ai-caption-template.tsx). Generate a complete, ready-to-render .tsx file that burns subtitles into my video.

My video: [a public https:// URL, or staticFile('your-file.mp4') if you will upload the video file alongside this one]
Dimensions: [WIDTH]x[HEIGHT] at [FPS] fps, [DURATION] seconds long

Transcript (paste an .srt or .vtt with timestamps if you have one - this studio's Auto or Write tab can export one - otherwise paste plain text and time it for me):
[PASTE YOUR TRANSCRIPT HERE]

Spoken language(s): [e.g. English / Nepali / Nepali+English code-switched]
Caption style: [e.g. bold social captions with word-by-word yellow highlight, Anton font, bottom third / clean broadcast subtitles on a translucent bar, Inter font / karaoke-style with the current word glowing]

Follow the AI EDITING CONTRACT in the attached file exactly. Reply with ONE complete, runnable .tsx file - no diff, no explanation.`

const STAGE_LABEL: Record<TranscribeProgress['stage'], string> = {
	idle: 'Ready',
	checking: 'Choosing a speech engine',
	'downloading-model': 'Downloading model',
	'extracting-audio': 'Reading the audio',
	'decoding-audio': 'Decoding audio',
	transcribing: 'Transcribing speech',
	polishing: 'Tidying the transcript',
	done: 'Done',
	error: 'Failed',
	cancelled: 'Cancelled',
}

const ORIGIN_LABEL: Record<TranscriptOrigin, string> = {
	whisper: 'transcribed on-device',
	cloud: 'transcribed in the cloud',
	srt: 'imported subtitles',
	text: 'auto-timed script',
	none: 'no transcript',
}

const ENGINE_OPTIONS: { id: TranscribeEngine; label: string; note: string }[] = [
	{
		id: 'auto',
		label: 'Auto',
		note: 'Groq Whisper first, then NVIDIA if Groq is unset or fails, then this device. The right choice unless you have a reason not to be.',
	},
	{
		id: 'cloud',
		label: 'Cloud (Groq)',
		note: "Groq's hosted Whisper large-v3 leads - it is free, needs no download, writes Devanagari, and returns a real per-word clock. NVIDIA is the automatic fallback. Only the audio is uploaded, as 16 kHz mono, never the video.",
	},
	{
		id: 'device',
		label: 'On this device',
		note: 'Whisper runs inside this tab with WebAssembly and nothing leaves the machine. Needs a one-off model download and a browser that allows SharedArrayBuffer.',
	},
]

export default function CaptionSourcePanel({
	video,
	videoBanked,
	busy,
	cues,
	origin,
	layout,
	mode,
	transcriptText,
	speechProfile,
	engine,
	cloudStatus,
	cloudModel,
	polish,
	restoreEnglish,
	whisperModel,
	whisperLanguage,
	whisperSupport,
	loadedModels,
	transcribing,
	transcribeProgress,
	transcribeError,
	transcribeNotice,
	engineUsed,
	videoError,
	onVideoFiles,
	onVideoUrl,
	onClearVideo,
	onMode,
	onTranscriptText,
	onAutoTime,
	onImportSubtitles,
	onImportSubtitleText,
	importNotice,
	onSpeechProfile,
	onEngine,
	onCloudModel,
	onPolish,
	onRestoreEnglish,
	onWhisperModel,
	onWhisperLanguage,
	onTranscribe,
	onCancelTranscribe,
	onLayout,
	onRegroup,
}: {
	video: CaptionVideoSource | null
	/** true once the clip's bytes are safely in this browser's local vault */
	videoBanked: boolean
	busy: boolean
	cues: CaptionCue[]
	origin: TranscriptOrigin
	layout: CaptionLayoutOptions
	mode: TranscriptMode
	transcriptText: string
	speechProfile: SpeechProfile['id']
	engine: TranscribeEngine
	cloudStatus: CloudAsrStatus | null
	/** null means "let the server pick for the spoken language" */
	cloudModel: string | null
	polish: boolean
	restoreEnglish: boolean
	whisperModel: WhisperModelId
	whisperLanguage: string
	whisperSupport: WhisperSupport | null
	loadedModels: WhisperModelId[]
	transcribing: boolean
	transcribeProgress: TranscribeProgress
	transcribeError: string | null
	transcribeNotice: string | null
	engineUsed: 'cloud' | 'device' | null
	videoError: string | null
	onVideoFiles: (files: File[]) => void
	onVideoUrl: (url: string) => void
	onClearVideo: () => void
	onMode: (mode: TranscriptMode) => void
	onTranscriptText: (value: string) => void
	onAutoTime: () => void
	onImportSubtitles: (file: File) => void
	onImportSubtitleText: (text: string) => void
	/** What the last import produced - cue count, format, encoding, warnings. */
	importNotice: string | null
	onSpeechProfile: (profile: SpeechProfile['id']) => void
	onEngine: (engine: TranscribeEngine) => void
	onCloudModel: (model: string | null) => void
	onPolish: (polish: boolean) => void
	onRestoreEnglish: (restore: boolean) => void
	onWhisperModel: (model: WhisperModelId) => void
	onWhisperLanguage: (language: string) => void
	onTranscribe: () => void
	onCancelTranscribe: () => void
	onLayout: (patch: Partial<CaptionLayoutOptions>) => void
	onRegroup: () => void
}) {
	const videoInputRef = useRef<HTMLInputElement>(null)
	const subtitleInputRef = useRef<HTMLInputElement>(null)
	const [dragging, setDragging] = useState(false)
	const [showUrl, setShowUrl] = useState(false)
	const [urlValue, setUrlValue] = useState('')
	const [promptCopied, setPromptCopied] = useState(false)
	const [subtitleDragging, setSubtitleDragging] = useState(false)
	const [pasteOpen, setPasteOpen] = useState(false)
	const [pasteValue, setPasteValue] = useState('')
	/**
	 * Phones and tablets filter the picker by system type, and no mobile OS has
	 * a type for .srt or .vtt - so an `accept` list that helps on desktop greys
	 * out every file there. Start with the desktop filter, which is what the
	 * server renders, and drop it after hydration on the platforms that need it.
	 */
	const [subtitleAccept, setSubtitleAccept] = useState<string | undefined>(SUBTITLE_ACCEPT)

	useEffect(() => {
		if (isRestrictiveFilePicker()) setSubtitleAccept(undefined)
	}, [])

	const handleSubtitleDrop = useCallback(
		(event: React.DragEvent<HTMLDivElement>) => {
			event.preventDefault()
			setSubtitleDragging(false)
			const files = Array.from(event.dataTransfer.files ?? [])
			const file = files.find(looksLikeSubtitleFile) ?? files[0]
			if (file) onImportSubtitles(file)
		},
		[onImportSubtitles],
	)

	const copyPrompt = useCallback(() => {
		navigator.clipboard.writeText(AI_CAPTION_PROMPT).then(() => {
			setPromptCopied(true)
			setTimeout(() => setPromptCopied(false), 2000)
		})
	}, [])

	const handleDrop = useCallback(
		(event: React.DragEvent<HTMLDivElement>) => {
			event.preventDefault()
			setDragging(false)
			const files = Array.from(event.dataTransfer.files ?? [])
			if (files.length > 0) onVideoFiles(files)
		},
		[onVideoFiles],
	)

	const model = WHISPER_MODELS.find((entry) => entry.id === whisperModel) ?? WHISPER_MODELS[0]
	const modelReady = loadedModels.includes(whisperModel)
	const profile = profileById(speechProfile)
	const languageMismatch = !modelSupportsLanguage(whisperModel, profile.language)
	const words = cues.reduce((sum, cue) => sum + cue.tokens.length, 0)

	const cloudReady = cloudStatus?.configured === true
	// What "Auto" would actually do right now, so every hint below is about the
	// engine that will really run rather than about the one that was picked.
	const resolvedEngine: 'cloud' | 'device' =
		engine === 'auto' ? (cloudReady ? 'cloud' : 'device') : engine
	const engineNote = ENGINE_OPTIONS.find((option) => option.id === engine)?.note ?? ''
	// English-only Whisper builds pin the language; no cloud model does.
	const englishPinned = resolvedEngine === 'device' && model.englishOnly
	const effectiveLanguage = englishPinned ? 'en' : whisperLanguage
	const autoCloudModel = cloudModelForLanguage(whisperLanguage)
	const resolvedCloudModel = cloudAsrModelById(cloudModel ?? autoCloudModel)
	const cloudLanguageMismatch =
		resolvedCloudModel !== null && !cloudModelSupports(resolvedCloudModel, whisperLanguage)
	const deviceUnavailable = whisperSupport !== null && !whisperSupport.supported
	const blockedEngine =
		(resolvedEngine === 'device' && deviceUnavailable && engine === 'device') ||
		(resolvedEngine === 'cloud' && engine === 'cloud' && cloudStatus !== null && !cloudReady)

	return (
		<aside className="panel panel--left">
			<div className="panel-scroll">
				<div>
					<h2 className="section-label">
						1 - Your video
						{video ? <span className="badge badge--green">loaded</span> : null}
					</h2>

					{video ? (
						<div className="card">
							<div className="media-card-head">
								<span className="media-card-icon">
									<IconFilm size={16} />
								</span>
								<div style={{ minWidth: 0 }}>
									<strong className="media-card-title" title={video.name}>
										{video.name}
									</strong>
									<span className="media-card-sub">
										{video.width} x {video.height} - {video.fps} fps -{' '}
										{formatSeconds(video.durationInSeconds)}
										{video.sizeInBytes > 0 ? ` - ${formatBytes(video.sizeInBytes)}` : ''}
									</span>
								</div>
							</div>
							<div className="chip-row" style={{ marginTop: 10 }}>
								<span className={`badge ${video.hasAudio ? 'badge--green' : 'badge--orange'}`}>
									{video.hasAudio ? 'audio track found' : 'no audio track'}
								</span>
								<span className="badge badge--muted">
									{video.kind === 'file' ? 'on this device' : 'remote URL'}
								</span>
								<span
									className={`badge ${videoBanked ? 'badge--accent' : 'badge--orange'}`}
									title={
										videoBanked
											? 'This clip is kept in your browser, so a refresh brings it straight back'
											: 'This clip is not kept in your browser - after a refresh you would pick the file again'
									}
								>
									{videoBanked ? <IconVault size={11} /> : <IconCloudOff size={11} />}
									{videoBanked ? 'kept for next time' : 'not kept'}
								</span>
							</div>
							<div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
								<button
									className="btn btn--sm"
									disabled={busy}
									onClick={() => videoInputRef.current?.click()}
								>
									<IconUpload size={12} /> Replace
								</button>
								<button className="btn btn--ghost btn--sm" disabled={busy} onClick={onClearVideo}>
									<IconTrash size={12} /> Remove
								</button>
							</div>
						</div>
					) : (
						<>
							<div
								className="dropzone"
								data-active={dragging}
								role="button"
								tabIndex={0}
								onClick={() => videoInputRef.current?.click()}
								onKeyDown={(event) => {
									if (event.key === 'Enter' || event.key === ' ') videoInputRef.current?.click()
								}}
								onDragOver={(event) => {
									event.preventDefault()
									setDragging(true)
								}}
								onDragLeave={() => setDragging(false)}
								onDrop={handleDrop}
							>
								<div className="dropzone-icon">
									<IconUpload size={22} />
								</div>
								<div className="dropzone-title">Drop your video here</div>
								<div className="dropzone-hint">
									MP4, MOV or WebM - it stays on this device, nothing is uploaded
								</div>
							</div>

							<button
								className="btn btn--ghost btn--sm"
								style={{ marginTop: 8 }}
								onClick={() => setShowUrl((current) => !current)}
							>
								<IconLink size={12} /> Use a video URL instead
							</button>

							{showUrl ? (
								<div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
									<input
										className="input"
										placeholder="https://example.com/clip.mp4"
										value={urlValue}
										onChange={(event) => setUrlValue(event.target.value)}
									/>
									<button
										className="btn btn--sm"
										disabled={!urlValue.trim() || busy}
										onClick={() => onVideoUrl(urlValue.trim())}
									>
										Load
									</button>
								</div>
							) : null}
						</>
					)}

					{videoError ? (
						<div className="notice notice--error" style={{ marginTop: 10 }}>
							<span className="notice-icon">
								<IconAlert size={14} />
							</span>
							<span>{videoError}</span>
						</div>
					) : null}

					<input
						ref={videoInputRef}
						type="file"
						className="sr-only"
						accept={[...ACCEPTED_VIDEO_TYPES, 'video/*'].join(',')}
						onChange={(event) => {
							const files = Array.from(event.target.files ?? [])
							if (files.length > 0) onVideoFiles(files)
							event.target.value = ''
						}}
					/>
				</div>

				<div>
					<h2 className="section-label">
						2 - Transcript
						{cues.length > 0 ? (
							<span className="badge badge--green">{ORIGIN_LABEL[origin]}</span>
						) : null}
					</h2>

					<div className="segmented" role="group" aria-label="Transcript source">
						<button data-active={mode === 'auto'} onClick={() => onMode('auto')} disabled={busy}>
							<IconMic size={12} /> Auto
						</button>
						<button data-active={mode === 'write'} onClick={() => onMode('write')} disabled={busy}>
							<IconType size={12} /> Write
						</button>
						<button data-active={mode === 'import'} onClick={() => onMode('import')} disabled={busy}>
							<IconUpload size={12} /> Import
						</button>
					</div>

					{mode === 'auto' ? (
						<div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
							<div className="field">
								<span className="field-label">
									What is spoken
									<span className="field-value">{profile.language}</span>
								</span>
								<div className="segmented segmented--wrap" role="group" aria-label="Speech profile">
									{SPEECH_PROFILES.map((entry) => (
										<button
											key={entry.id}
											data-active={speechProfile === entry.id}
											disabled={transcribing}
											onClick={() => onSpeechProfile(entry.id)}
										>
											{entry.label}
										</button>
									))}
								</div>
								<span style={{ fontSize: 11.5, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
									{profile.note}
								</span>
							</div>

							<div className="field">
								<span className="field-label">
									Speech engine
									<span className="field-value">
										{engine === 'auto'
											? resolvedEngine === 'cloud'
												? 'auto - cloud'
												: 'auto - this device'
											: resolvedEngine === 'cloud'
												? 'cloud'
												: 'this device'}
									</span>
								</span>
								<div className="segmented segmented--wrap" role="group" aria-label="Speech engine">
									{ENGINE_OPTIONS.map((entry) => (
										<button
											key={entry.id}
											data-active={engine === entry.id}
											disabled={transcribing}
											onClick={() => onEngine(entry.id)}
										>
											{entry.label}
										</button>
									))}
								</div>
								<span style={{ fontSize: 11.5, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
									{engineNote}
								</span>
							</div>

							{resolvedEngine === 'cloud' ? (
								<div className="field">
									<label className="field-label" htmlFor="cloud-model">
										Fallback model
										<span className="badge badge--muted">
											{cloudStatus === null
												? 'checking'
												: cloudReady
													? 'server key found'
													: 'no server key'}
										</span>
									</label>
									<select
										id="cloud-model"
										className="select"
										value={cloudModel ?? ''}
										disabled={transcribing}
										onChange={(event) => onCloudModel(event.target.value || null)}
									>
										<option value="">
											Automatic - best model for {effectiveLanguage === 'auto' ? 'the detected language' : effectiveLanguage}
										</option>
										{CLOUD_ASR_MODELS.map((entry) => (
											<option key={entry.id} value={entry.id}>
												{entry.label}
												{cloudModelSupports(entry, whisperLanguage) ? '' : ' - other languages'}
											</option>
										))}
									</select>
									<span style={{ fontSize: 11.5, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
										{resolvedCloudModel?.note ??
											'The server picks the model that fits the spoken language.'}
									</span>
								</div>
							) : (
								<>
									{languageMismatch ? (
										<div className="notice notice--warn">
											<span className="notice-icon">
												<IconAlert size={14} />
											</span>
											<span>
												The {model.label} model only writes English. Choose a multilingual model
												below, or this profile will transcribe {profile.label} as English.
											</span>
										</div>
									) : null}

									<div className="field">
										<label className="field-label" htmlFor="whisper-model">
											Speech model
											<span className="field-value">
												{modelReady ? 'on this device' : formatBytes(model.sizeInBytes)}
											</span>
										</label>
										<select
											id="whisper-model"
											className="select"
											value={whisperModel}
											disabled={transcribing}
											onChange={(event) => onWhisperModel(event.target.value as WhisperModelId)}
										>
											{WHISPER_MODELS.map((entry) => (
												<option key={entry.id} value={entry.id}>
													{entry.label}
													{loadedModels.includes(entry.id)
														? ' - ready'
														: ` - ${formatBytes(entry.sizeInBytes)}`}
												</option>
											))}
										</select>
										<span style={{ fontSize: 11.5, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
											{model.note} Downloaded once, then kept in this browser.
										</span>
									</div>
								</>
							)}

							{cloudLanguageMismatch ? (
								<div className="notice notice--warn">
									<span className="notice-icon">
										<IconAlert size={14} />
									</span>
									<span>
										{resolvedCloudModel?.label} does not transcribe {effectiveLanguage}. Leave the
										model on Automatic, or pick Whisper large-v3, which covers every language this
										studio offers.
									</span>
								</div>
							) : null}

							<div className="field">
								<label className="field-label" htmlFor="whisper-language">
									Spoken language
								</label>
								<select
									id="whisper-language"
									className="select"
									value={effectiveLanguage}
									disabled={transcribing || englishPinned}
									onChange={(event) => onWhisperLanguage(event.target.value)}
								>
									{englishPinned ? (
										<option value="en">English (this model is English-only)</option>
									) : (
										WHISPER_LANGUAGES.map((language) => (
											<option key={language.value} value={language.value}>
												{language.label}
											</option>
										))
									)}
								</select>
							</div>

							<label className="field" style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
								<input
									type="checkbox"
									checked={polish}
									disabled={transcribing}
									onChange={(event) => onPolish(event.target.checked)}
									style={{ marginTop: 2 }}
								/>
								<span>
									<span className="field-label" style={{ display: 'block' }}>
										Tidy the transcript with NVIDIA AI
									</span>
									<span style={{ fontSize: 11.5, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
										A language model fixes punctuation, capitalisation and misheard words line by
										line. It never translates, and every word keeps the timing the recogniser gave
										it. Only the text is sent - never the audio.
									</span>
								</span>
							</label>

							<label className="field" style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
								<input
									type="checkbox"
									checked={restoreEnglish}
									disabled={transcribing}
									onChange={(event) => onRestoreEnglish(event.target.checked)}
									style={{ marginTop: 2 }}
								/>
								<span>
									<span className="field-label" style={{ display: 'block' }}>
										Keep English words in English
									</span>
									<span style={{ fontSize: 11.5, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
										Nepali speech is code-switched, and a recogniser told the language is Nepali
										writes the English it hears in Devanagari anyway - कम्प्युटर for computer,
										बैंक for bank, ओटिपी for OTP. Those go back into Latin; a Nepali word never
										does, and a word carrying a Nepali ending is left alone.
									</span>
								</span>
							</label>

							{deviceUnavailable ? (
								<div className={`notice ${engine === 'device' ? 'notice--warn' : 'notice--info'}`}>
									<span className="notice-icon">
										{engine === 'device' ? <IconAlert size={14} /> : <IconInfo size={14} />}
									</span>
									<span>
										{whisperSupport?.needsIsolation
											? 'On-device speech recognition needs a cross-origin isolated page, which this browser is not giving the tab.'
											: (whisperSupport?.reason ??
												'On-device speech recognition is not available in this browser.')}{' '}
										{engine === 'device'
											? 'Switch the engine to Cloud (Groq), or write the transcript by hand.'
											: 'Cloud transcription is used instead - it needs nothing from the browser.'}
									</span>
								</div>
							) : null}

							{cloudStatus !== null && !cloudReady && engine !== 'device' ? (
								<div className={`notice ${engine === 'cloud' ? 'notice--warn' : 'notice--info'}`}>
									<span className="notice-icon">
										{engine === 'cloud' ? <IconAlert size={14} /> : <IconInfo size={14} />}
									</span>
									<span>
										{cloudStatus.reason ??
											'Cloud transcription is not configured on this server.'}
									</span>
								</div>
							) : null}

							{video && !video.hasAudio ? (
								<div className="notice notice--warn">
									<span className="notice-icon">
										<IconAlert size={14} />
									</span>
									<span>
										This file has no audio track, so there is nothing to transcribe. Use Write or
										Import to add the subtitles.
									</span>
								</div>
							) : null}

							<div style={{ display: 'flex', gap: 8 }}>
								<button
									className="btn btn--primary btn--block"
									disabled={!video || transcribing || blockedEngine}
									onClick={onTranscribe}
								>
									{transcribing ? <IconSpinner size={14} /> : <IconWand size={14} />}
									{transcribing ? 'Working...' : 'Generate subtitles'}
								</button>
								{transcribing ? (
									<button className="btn btn--danger" onClick={onCancelTranscribe} title="Stop">
										<IconStop size={13} />
									</button>
								) : null}
							</div>

							{transcribeProgress.stage !== 'idle' ? (
								<div>
									<div className="progress-track">
										<div
											className="progress-fill"
											data-state={
												transcribeProgress.stage === 'done'
													? 'done'
													: transcribeProgress.stage === 'error'
														? 'error'
														: undefined
											}
											style={{
												width: `${Math.round(Math.min(1, Math.max(0, transcribeProgress.progress)) * 100)}%`,
											}}
										/>
									</div>
									<div className="progress-meta">
										<span>{STAGE_LABEL[transcribeProgress.stage]}</span>
										<span className="field-value">
											{Math.round(transcribeProgress.progress * 100)}%
										</span>
									</div>
									{transcribeProgress.message ? (
										<p className="hint-text">{transcribeProgress.message}</p>
									) : null}
								</div>
							) : null}

							{transcribeNotice ? (
								<div className="notice notice--info">
									<span className="notice-icon">
										<IconInfo size={14} />
									</span>
									<span>{transcribeNotice}</span>
								</div>
							) : null}

							<div className="notice notice--info">
								<span className="notice-icon">
									<IconInfo size={14} />
								</span>
								<span>
									{engineUsed === 'cloud'
										? 'Transcribed in the cloud - Groq\'s Whisper large-v3 unless it was unavailable, in which case NVIDIA answered. The studio decoded the audio here and sent it as 16 kHz mono; every word came back on its own measured timestamp, which is what the karaoke styles ride on.'
										: engineUsed === 'device'
											? 'Transcribed inside this tab with WebAssembly - the audio never left the machine, and every word carries its own timestamp.'
											: resolvedEngine === 'cloud'
												? "The studio decodes the audio here and uploads it as 16 kHz mono - the video itself never leaves this device. Groq's Whisper large-v3 goes first and returns a measured timestamp per word, which is what the karaoke styles ride on."
												: 'Whisper runs inside this tab with WebAssembly. The audio never leaves the machine, and every word gets its own timestamp for karaoke styles.'}
								</span>
							</div>
						</div>
					) : null}

					{mode === 'write' ? (
						<div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
							<textarea
								className="input textarea"
								rows={9}
								placeholder={
									'Paste or type what is said in the video.\n\nLeave a blank line between paragraphs - each one is timed as its own block.'
								}
								value={transcriptText}
								onChange={(event) => onTranscriptText(event.target.value)}
							/>
							<button
								className="btn btn--primary btn--block"
								disabled={!video || transcriptText.trim().length === 0}
								onClick={onAutoTime}
							>
								<IconClock size={14} /> Time it across the video
							</button>
							<p className="hint-text">
								Words are spread across the clip by length, then you nudge the lines that need it
								in the track below the preview.
							</p>
						</div>
					) : null}

					{mode === 'import' ? (
						<div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
							<div
								className="dropzone dropzone--compact"
								data-active={subtitleDragging}
								role="button"
								tabIndex={0}
								onClick={() => subtitleInputRef.current?.click()}
								onKeyDown={(event) => {
									if (event.key === 'Enter' || event.key === ' ') {
										event.preventDefault()
										subtitleInputRef.current?.click()
									}
								}}
								onDragOver={(event) => {
									event.preventDefault()
									setSubtitleDragging(true)
								}}
								onDragLeave={() => setSubtitleDragging(false)}
								onDrop={handleSubtitleDrop}
							>
								<div className="dropzone-icon">
									<IconUpload size={20} />
								</div>
								<div className="dropzone-title">Choose a subtitle file</div>
								<div className="dropzone-hint">
									{SUBTITLE_EXTENSIONS.slice(0, 4).join(', ')} - tap to browse, or drop one here
								</div>
							</div>
							{/*
							 * Kept out of the layout rather than display:none - iOS Safari
							 * ignores a programmatic click on an input it considers hidden.
							 * No `capture` attribute either: it forces the camera on Android
							 * and there is no camera that produces a subtitle file.
							 */}
							<input
								ref={subtitleInputRef}
								type="file"
								className="sr-only"
								accept={subtitleAccept}
								onChange={(event) => {
									const file = event.target.files?.[0]
									if (file) onImportSubtitles(file)
									// Cleared so picking the same file twice fires onChange again.
									event.target.value = ''
								}}
							/>

							<button
								className="btn btn--ghost btn--sm"
								onClick={() => setPasteOpen((current) => !current)}
								aria-expanded={pasteOpen}
							>
								<IconType size={12} />
								{pasteOpen ? 'Hide the paste box' : 'Or paste the subtitle text'}
							</button>

							{pasteOpen ? (
								<>
									<textarea
										className="input textarea"
										rows={7}
										inputMode="text"
										autoCapitalize="off"
										autoCorrect="off"
										spellCheck={false}
										placeholder={
											'1\n00:00:01,000 --> 00:00:03,000\nPaste the whole .srt or .vtt here'
										}
										value={pasteValue}
										onChange={(event) => setPasteValue(event.target.value)}
									/>
									<button
										className="btn btn--primary btn--block"
										disabled={pasteValue.trim().length === 0}
										onClick={() => onImportSubtitleText(pasteValue)}
									>
										<IconUpload size={14} /> Import pasted subtitles
									</button>
									<p className="hint-text">
										The reliable route on a phone: open the .srt in any text or files app,
										select all, and paste it here. Timestamps in either format are read.
									</p>
								</>
							) : null}

							{importNotice ? (
								<div className="notice notice--info">
									<span className="notice-icon">
										<IconCheck size={14} />
									</span>
									<span>{importNotice}</span>
								</div>
							) : null}

							{!video ? (
								<div className="notice notice--info">
									<span className="notice-icon">
										<IconInfo size={14} />
									</span>
									<span>
										Subtitles import without a video, and the preview and export unlock once
										you add one in step 1.
									</span>
								</div>
							) : null}

							<p className="hint-text">
								Existing subtitles keep their timings. SubRip, WebVTT and SubViewer are all read,
								in any text encoding, and word timing is filled in - or lifted straight out of a
								WebVTT that carries it - so the karaoke styles still work.
							</p>
						</div>
					) : null}

					{transcribeError ? (
						<div className="notice notice--error" style={{ marginTop: 12 }}>
							<span className="notice-icon">
								<IconAlert size={14} />
							</span>
							<span>{transcribeError}</span>
						</div>
					) : null}
				</div>

				<div>
					<h2 className="section-label">
						AI shortcut
						<IconSparkle size={12} />
					</h2>
					<div className="card">
						<div
							style={{
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'space-between',
								gap: 8,
							}}
						>
							<strong style={{ fontSize: 13 }}>AI Caption Template</strong>
							<span className="badge badge--accent">copy &amp; use</span>
						</div>
						<p
							style={{
								margin: '6px 0 10px',
								fontSize: 11.5,
								color: 'var(--text-tertiary)',
								lineHeight: 1.5,
							}}
						>
							Already have a transcript, or want a bespoke look the panels below can't produce?
							Download this template, paste it and your transcript into an AI, and upload the
							.tsx it returns. It runs the same rendering engine as this studio - word timing,
							balanced line breaks, mixed Devanagari/Latin fonts, the legibility scrim - so the
							result looks and behaves exactly like a caption built here.
						</p>
						<pre
							style={{
								margin: '0 0 10px',
								padding: 10,
								fontSize: 11,
								lineHeight: 1.5,
								whiteSpace: 'pre-wrap',
								wordBreak: 'break-word',
								background: 'var(--surface-2, rgba(127,127,127,0.08))',
								border: '1px solid var(--border, rgba(127,127,127,0.2))',
								borderRadius: 8,
								maxHeight: 200,
								overflowY: 'auto',
							}}
						>
							{AI_CAPTION_PROMPT}
						</pre>
						<div style={{ display: 'flex', gap: 6 }}>
							<button className="btn btn--sm" onClick={copyPrompt}>
								{promptCopied ? <IconCheck size={12} /> : <IconCopy size={12} />}
								{promptCopied ? 'Copied' : 'Copy prompt'}
							</button>
							<a className="btn btn--ghost btn--sm" href="/samples/ai-caption-template.tsx" download>
								<IconDownload size={12} />
								Template
							</a>
						</div>
					</div>
				</div>

				{cues.length > 0 ? (
					<div>
						<h2 className="section-label">
							Line length
							<IconScissors size={12} />
						</h2>
						<div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
							<div className="chip-row">
								<span className="chip chip--static">{cues.length} cues</span>
								<span className="chip chip--static">{words} words</span>
							</div>
							<div className="field">
								<label className="field-label" htmlFor="words-per-cue">
									Words per line
									<span className="field-value">{layout.maxWordsPerCue}</span>
								</label>
								<input
									id="words-per-cue"
									className="range"
									type="range"
									min={1}
									max={12}
									step={1}
									value={layout.maxWordsPerCue}
									onChange={(event) => onLayout({ maxWordsPerCue: Number(event.target.value) })}
								/>
							</div>
							<div className="field">
								<label className="field-label" htmlFor="chars-per-cue">
									Characters per line
									<span className="field-value">{layout.maxCharactersPerCue}</span>
								</label>
								<input
									id="chars-per-cue"
									className="range"
									type="range"
									min={12}
									max={72}
									step={2}
									value={layout.maxCharactersPerCue}
									onChange={(event) =>
										onLayout({ maxCharactersPerCue: Number(event.target.value) })
									}
								/>
							</div>
							<button className="btn btn--sm" onClick={onRegroup}>
								<IconScissors size={12} /> Re-cut the lines
							</button>
							<p className="hint-text">
								Re-cutting keeps every word timing and only changes where the lines break.
							</p>
						</div>
					</div>
				) : null}
			</div>
		</aside>
	)
}
