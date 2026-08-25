'use client'

import { useCallback, useRef, useState } from 'react'
import { formatBytes, formatSeconds } from '../../lib/format'
import { ACCEPTED_VIDEO_TYPES } from '../../lib/captions/video-source'
import type { CaptionVideoSource } from '../../lib/captions/types'
import type { AnalysisProgress, AudioAnalysis } from '../../lib/silence/analyze'
import {
	CUT_PRESETS,
	SPEED_CHOICES,
	formatSpan,
	type CutPlan,
	type CutSettings,
} from '../../lib/silence/plan'
import {
	IconAlert,
	IconCloudOff,
	IconFilm,
	IconGauge,
	IconInfo,
	IconScissors,
	IconSliders,
	IconSpinner,
	IconStop,
	IconTrash as IconRemove,
	IconUpload,
	IconVault,
	IconWaveform,
} from '../Icons'

const PHASE_LABEL: Record<AnalysisProgress['phase'], string> = {
	decoding: 'Listening to the audio',
	detecting: 'Finding the speech',
}

/** A labelled slider that shows its own value - used for every detector knob. */
function Knob({
	label,
	hint,
	value,
	display,
	min,
	max,
	step,
	disabled,
	onChange,
}: {
	label: string
	hint: string
	value: number
	display: string
	min: number
	max: number
	step: number
	disabled?: boolean
	onChange: (value: number) => void
}) {
	return (
		<div className="field knob">
			<label className="field-label">
				<span>{label}</span>
				<span className="field-value">{display}</span>
			</label>
			<input
				className="range"
				type="range"
				min={min}
				max={max}
				step={step}
				value={value}
				disabled={disabled}
				onChange={(event) => onChange(Number(event.target.value))}
				aria-label={label}
			/>
			<span className="field-hint">{hint}</span>
		</div>
	)
}

export default function SilenceSourcePanel({
	video,
	videoBanked,
	busy,
	analysis,
	analyzing,
	analysisProgress,
	analysisError,
	speechRatio,
	settings,
	plan,
	activePreset,
	onVideoFiles,
	onClearVideo,
	onSettings,
	onPreset,
	onReanalyze,
	onCancelAnalysis,
}: {
	video: CaptionVideoSource | null
	videoBanked: boolean
	busy: boolean
	analysis: AudioAnalysis | null
	analyzing: boolean
	analysisProgress: AnalysisProgress | null
	analysisError: string | null
	speechRatio: number
	settings: CutSettings
	plan: CutPlan
	activePreset: string | null
	onVideoFiles: (files: File[]) => void
	onClearVideo: () => void
	onSettings: (patch: Partial<CutSettings>) => void
	onPreset: (id: string) => void
	onReanalyze: () => void
	onCancelAnalysis: () => void
}) {
	const inputRef = useRef<HTMLInputElement>(null)
	const [dragging, setDragging] = useState(false)

	const handleDrop = useCallback(
		(event: React.DragEvent<HTMLDivElement>) => {
			event.preventDefault()
			setDragging(false)
			const files = Array.from(event.dataTransfer.files ?? [])
			if (files.length > 0) onVideoFiles(files)
		},
		[onVideoFiles],
	)

	const ready = analysis !== null

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
								<span className={`badge ${video.hasAudio ? 'badge--green' : 'badge--red'}`}>
									{video.hasAudio ? 'audio track found' : 'no audio track'}
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
									onClick={() => inputRef.current?.click()}
								>
									<IconUpload size={12} /> Replace
								</button>
								<button className="btn btn--ghost btn--sm" disabled={busy} onClick={onClearVideo}>
									<IconRemove size={12} /> Remove
								</button>
							</div>
						</div>
					) : (
						<div
							className="dropzone"
							data-active={dragging}
							role="button"
							tabIndex={0}
							onClick={() => inputRef.current?.click()}
							onKeyDown={(event) => {
								if (event.key === 'Enter' || event.key === ' ') inputRef.current?.click()
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
							<div className="dropzone-title">Drop a video to de-silence</div>
							<div className="dropzone-hint">
								MP4, MOV or WebM. It is read, cut and re-encoded here in the tab - nothing is
								uploaded.
							</div>
						</div>
					)}

					{analysisError ? (
						<div className="notice notice--error" style={{ marginTop: 10 }}>
							<span className="notice-icon">
								<IconAlert size={14} />
							</span>
							<span>{analysisError}</span>
						</div>
					) : null}

					<input
						ref={inputRef}
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

				{/* ------------------------------------------------------ analysis */}

				<div>
					<h2 className="section-label">
						<span>
							<IconWaveform size={12} /> 2 - Analysis
						</span>
						{ready ? <span className="badge badge--green">measured</span> : null}
					</h2>

					{analyzing ? (
						<div className="analysis-live">
							<div className="progress-track">
								<div
									className="progress-fill"
									style={{ width: `${Math.round((analysisProgress?.ratio ?? 0) * 100)}%` }}
								/>
							</div>
							<div className="progress-meta">
								<span>
									<IconSpinner size={11} className="spin" />{' '}
									{PHASE_LABEL[analysisProgress?.phase ?? 'decoding']}
								</span>
								<span>{formatSeconds(analysisProgress?.secondsDone ?? 0)} read</span>
							</div>
							<button className="btn btn--ghost btn--sm" onClick={onCancelAnalysis}>
								<IconStop size={12} /> Stop
							</button>
						</div>
					) : ready && analysis ? (
						<>
							<div className="stat-grid">
								<div className="stat">
									<span className="stat-value">{Math.round(speechRatio * 100)}%</span>
									<span className="stat-label">speech</span>
								</div>
								<div className="stat">
									<span className="stat-value">{formatSpan(plan.silenceMs)}</span>
									<span className="stat-label">quiet</span>
								</div>
								<div className="stat">
									<span className="stat-value">{plan.silenceCount}</span>
									<span className="stat-label">pauses</span>
								</div>
							</div>
							<div className="chip-row" style={{ marginTop: 10 }}>
								<span className="chip chip--static" title="Loudest frame in the clip">
									peak {analysis.peakDb.toFixed(1)} dB
								</span>
								<span className="chip chip--static" title="Where the detector put the noise floor">
									floor {analysis.noiseFloorDb.toFixed(1)} dB
								</span>
								<button className="chip" onClick={onReanalyze} disabled={busy}>
									<IconWaveform size={11} /> Re-measure
								</button>
							</div>
							{analysis.silent ? (
								<div className="notice notice--warn" style={{ marginTop: 10 }}>
									<span className="notice-icon">
										<IconAlert size={14} />
									</span>
									<span>
										This track is almost entirely silent, so nearly all of it will be treated as
										dead air. Check that the right audio track was exported.
									</span>
								</div>
							) : null}
						</>
					) : (
						<div className="notice notice--info">
							<span className="notice-icon">
								<IconInfo size={14} />
							</span>
							<span>
								Drop a clip above and its audio is measured once, ten milliseconds at a time. Every
								setting below then re-cuts instantly, without reading the file again.
							</span>
						</div>
					)}
				</div>

				{/* ------------------------------------------------------ detector */}

				<div>
					<h2 className="section-label">
						<span>
							<IconSliders size={12} /> 3 - What counts as silence
						</span>
					</h2>

					<div className="preset-row">
						{CUT_PRESETS.map((preset) => (
							<button
								key={preset.id}
								className="preset-pill"
								data-active={activePreset === preset.id}
								disabled={!ready}
								title={preset.note}
								onClick={() => onPreset(preset.id)}
							>
								{preset.label}
							</button>
						))}
					</div>

					<div className="stack" style={{ marginTop: 14 }}>
						<Knob
							label="Sensitivity"
							hint="How far above the room's own noise a sound must sit to count as speech. Raise it if quiet breaths are being kept; lower it if soft words are being cut."
							value={settings.sensitivityDb}
							display={`${settings.sensitivityDb.toFixed(1)} dB`}
							min={1}
							max={16}
							step={0.5}
							disabled={!ready}
							onChange={(value) => onSettings({ sensitivityDb: value })}
						/>

						<Knob
							label="Shortest pause to cut"
							hint="Gaps briefer than this are left completely alone - they are the breaths inside a sentence."
							value={settings.minSilenceMs}
							display={`${(settings.minSilenceMs / 1000).toFixed(2)}s`}
							min={150}
							max={3000}
							step={10}
							disabled={!ready}
							onChange={(value) => onSettings({ minSilenceMs: value })}
						/>

						<Knob
							label="Padding"
							hint="Speech kept on each side of every cut. This is the setting that stops a cut from clipping the start of a word."
							value={settings.paddingMs}
							display={`${settings.paddingMs} ms`}
							min={0}
							max={400}
							step={5}
							disabled={!ready}
							onChange={(value) => onSettings({ paddingMs: value })}
						/>

						<Knob
							label="Ignore blips shorter than"
							hint="A cough, a chair or a click this brief is not treated as speech, so the pause around it stays one pause."
							value={settings.minSpeechMs}
							display={`${settings.minSpeechMs} ms`}
							min={0}
							max={800}
							step={10}
							disabled={!ready}
							onChange={(value) => onSettings({ minSpeechMs: value })}
						/>
					</div>
				</div>

				{/* -------------------------------------------------------- action */}

				<div>
					<h2 className="section-label">
						<span>
							<IconScissors size={12} /> 4 - What to do with it
						</span>
					</h2>

					<div className="segmented" role="group" aria-label="Silence treatment">
						<button
							data-active={settings.action === 'remove'}
							disabled={!ready}
							onClick={() => onSettings({ action: 'remove' })}
						>
							<IconScissors size={12} /> Remove it
						</button>
						<button
							data-active={settings.action === 'speed'}
							disabled={!ready}
							onClick={() => onSettings({ action: 'speed' })}
						>
							<IconGauge size={12} /> Run it fast
						</button>
					</div>

					{settings.action === 'speed' ? (
						<div className="field" style={{ marginTop: 12 }}>
							<label className="field-label">
								<span>Speed through silence</span>
								<span className="field-value">{settings.speed}x</span>
							</label>
							<div className="chip-row">
								{SPEED_CHOICES.map((speed) => (
									<button
										key={speed}
										className="chip"
										data-active={settings.speed === speed}
										disabled={!ready}
										onClick={() => onSettings({ speed })}
									>
										{speed}x
									</button>
								))}
							</div>
							<span className="field-hint">
								The picture keeps running, so nothing is lost - a five second pause becomes
								{` ${(5 / settings.speed).toFixed(1)}`} seconds of fast-forward. Best when the quiet
								stretches still have something to look at.
							</span>
						</div>
					) : (
						<div style={{ marginTop: 12 }}>
							<Knob
								label="Beat left behind"
								hint="A hard splice sounds mechanical. Keeping a fraction of a second of the room on each side of the cut is what makes an edit sound like speech."
								value={settings.keepBeatMs}
								display={`${settings.keepBeatMs} ms`}
								min={0}
								max={600}
								step={10}
								disabled={!ready}
								onChange={(value) => onSettings({ keepBeatMs: value })}
							/>
						</div>
					)}

					<div className="notice notice--info" style={{ marginTop: 12 }}>
						<span className="notice-icon">
							<IconInfo size={14} />
						</span>
						<span>
							Speech is never touched, at either setting. Click any pause on the timeline to give it
							its own treatment - a hand decision always wins over these sliders.
						</span>
					</div>
				</div>
			</div>
		</aside>
	)
}
