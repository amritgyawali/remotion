'use client'

import { useCallback, useRef, useState } from 'react'
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
import type {
	CaptionCue,
	CaptionLayoutOptions,
	CaptionVideoSource,
	TranscribeProgress,
	TranscriptOrigin,
	WhisperModelId,
} from '../../lib/captions/types'
import {
	IconAlert,
	IconClock,
	IconFilm,
	IconInfo,
	IconLink,
	IconMic,
	IconScissors,
	IconSpinner,
	IconStop,
	IconTrash,
	IconType,
	IconUpload,
	IconWand,
} from '../Icons'

export type TranscriptMode = 'auto' | 'write' | 'import'

const STAGE_LABEL: Record<TranscribeProgress['stage'], string> = {
	idle: 'Ready',
	checking: 'Checking this browser',
	'downloading-model': 'Downloading model',
	'decoding-audio': 'Decoding audio',
	transcribing: 'Transcribing speech',
	done: 'Done',
	error: 'Failed',
	cancelled: 'Cancelled',
}

const ORIGIN_LABEL: Record<TranscriptOrigin, string> = {
	whisper: 'transcribed on-device',
	srt: 'imported subtitles',
	text: 'auto-timed script',
	none: 'no transcript',
}

export default function CaptionSourcePanel({
	video,
	busy,
	cues,
	origin,
	layout,
	mode,
	transcriptText,
	speechProfile,
	whisperModel,
	whisperLanguage,
	whisperSupport,
	loadedModels,
	transcribing,
	transcribeProgress,
	transcribeError,
	videoError,
	onVideoFiles,
	onVideoUrl,
	onClearVideo,
	onMode,
	onTranscriptText,
	onAutoTime,
	onImportSubtitles,
	onSpeechProfile,
	onWhisperModel,
	onWhisperLanguage,
	onTranscribe,
	onCancelTranscribe,
	onLayout,
	onRegroup,
}: {
	video: CaptionVideoSource | null
	busy: boolean
	cues: CaptionCue[]
	origin: TranscriptOrigin
	layout: CaptionLayoutOptions
	mode: TranscriptMode
	transcriptText: string
	speechProfile: SpeechProfile['id']
	whisperModel: WhisperModelId
	whisperLanguage: string
	whisperSupport: WhisperSupport | null
	loadedModels: WhisperModelId[]
	transcribing: boolean
	transcribeProgress: TranscribeProgress
	transcribeError: string | null
	videoError: string | null
	onVideoFiles: (files: File[]) => void
	onVideoUrl: (url: string) => void
	onClearVideo: () => void
	onMode: (mode: TranscriptMode) => void
	onTranscriptText: (value: string) => void
	onAutoTime: () => void
	onImportSubtitles: (file: File) => void
	onSpeechProfile: (profile: SpeechProfile['id']) => void
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
	const effectiveLanguage = model.englishOnly ? 'en' : whisperLanguage
	const languageMismatch = !modelSupportsLanguage(whisperModel, profile.language)
	const words = cues.reduce((sum, cue) => sum + cue.tokens.length, 0)

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
											{loadedModels.includes(entry.id) ? ' - ready' : ` - ${formatBytes(entry.sizeInBytes)}`}
										</option>
									))}
								</select>
								<span style={{ fontSize: 11.5, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
									{model.note} Downloaded once, then kept in this browser.
								</span>
							</div>

							<div className="field">
								<label className="field-label" htmlFor="whisper-language">
									Spoken language
								</label>
								<select
									id="whisper-language"
									className="select"
									value={effectiveLanguage}
									disabled={transcribing || model.englishOnly}
									onChange={(event) => onWhisperLanguage(event.target.value)}
								>
									{model.englishOnly ? (
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

							{whisperSupport && !whisperSupport.supported ? (
								<div className="notice notice--warn">
									<span className="notice-icon">
										<IconAlert size={14} />
									</span>
									<span>
										{whisperSupport.needsIsolation
											? 'On-device speech recognition needs a cross-origin isolated page. Reload this tab - if it still fails, your browser blocks SharedArrayBuffer. Write or import the transcript instead.'
											: (whisperSupport.reason ??
												'On-device speech recognition is not available in this browser.')}
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
									disabled={!video || transcribing || (whisperSupport ? !whisperSupport.supported : false)}
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

							<div className="notice notice--info">
								<span className="notice-icon">
									<IconInfo size={14} />
								</span>
								<span>
									Whisper runs inside this tab with WebAssembly. The audio never leaves the
									machine, and every word gets its own timestamp for karaoke styles.
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
							<button
								className="btn btn--block"
								disabled={!video}
								onClick={() => subtitleInputRef.current?.click()}
							>
								<IconUpload size={14} /> Choose a .srt or .vtt file
							</button>
							<input
								ref={subtitleInputRef}
								type="file"
								className="sr-only"
								accept=".srt,.vtt,text/vtt,application/x-subrip"
								onChange={(event) => {
									const file = event.target.files?.[0]
									if (file) onImportSubtitles(file)
									event.target.value = ''
								}}
							/>
							<p className="hint-text">
								Existing subtitles keep their timings. Word timing is filled in so the karaoke
								styles still work.
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
