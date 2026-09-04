'use client'

import type { ReactNode } from 'react'
import { formatBytes, formatSeconds } from '../../lib/format'
import { formatSpan, type CutPlan } from '../../lib/silence/plan'
import type { RenderProgress, SilenceRenderResult } from '../../lib/silence/render'
import type { ExportSettings } from '../../lib/silence/session'
import type { CaptionVideoSource } from '../../lib/captions/types'
import type { CloudState } from '../../lib/cloud/use-cloud'
import { RunLocationNote } from '../cloud/RunLocationToggle'
import {
	IconAlert,
	IconCaptions,
	IconCheck,
	IconDownload,
	IconFilm,
	IconCloud,
	IconDevice,
	IconInfo,
	IconScissors,
	IconSpinner,
	IconStop,
} from '../Icons'

const FPS_CHOICES = [24, 25, 30, 50, 60]

/**
 * Bits per pixel per frame, by quality tier.
 *
 * Deliberately a rule of thumb rather than a promise: the encoder decides the
 * real bitrate from the picture, and a still slide costs a fraction of what a
 * handheld shot does. It is here so nobody starts a ten minute export expecting
 * a file that fits on a floppy.
 */
const BITS_PER_PIXEL = { draft: 0.045, high: 0.09, max: 0.16 } as const

const PHASE_LABEL: Record<RenderProgress['phase'], string> = {
	preparing: 'Setting up the encoder',
	encoding: 'Cutting and encoding',
	finishing: 'Writing the file',
}

export default function SilenceExportPanel({
	video,
	plan,
	settings,
	webCodecs,
	rendering,
	progress,
	result,
	error,
	sendState,
	hasCues,
	onSettings,
	onRender,
	onCancel,
	onDownload,
	onSendToCaptions,
	cloud,
	cloudRefusal,
	cloudNote,
	children,
}: {
	video: CaptionVideoSource | null
	plan: CutPlan
	settings: ExportSettings
	webCodecs: boolean
	cloud: CloudState
	/** why this cut cannot go to the cloud, or null when it can */
	cloudRefusal: string | null
	cloudNote: string | null
	children?: ReactNode
	rendering: boolean
	progress: RenderProgress | null
	result: SilenceRenderResult | null
	error: string | null
	sendState: 'idle' | 'sending' | 'sent' | 'failed'
	hasCues: boolean
	onSettings: (patch: Partial<ExportSettings>) => void
	onRender: () => void
	onCancel: () => void
	onDownload: () => void
	onSendToCaptions: () => void
}) {
	const fps = settings.fps ?? Math.round(video?.fps ?? 30)
	const width = Math.round((video?.width ?? 0) * settings.scale)
	const height = Math.round((video?.height ?? 0) * settings.scale)
	const estimatedBytes =
		width > 0 && height > 0
			? ((width * height * fps * BITS_PER_PIXEL[settings.quality]) / 8) *
				(plan.outputDurationMs / 1000)
			: 0

	const usingCloud = cloud.location === 'cloud' && cloudRefusal === null
	// Cloud mode is the only way this studio works at all in a browser with no
	// WebCodecs encoder, so the encoder is not a requirement when it is on.
	const ready = video !== null && plan.outputDurationMs > 0 && (webCodecs || usingCloud)

	return (
		<aside className="panel panel--right">
			<div className="panel-scroll">
				<div>
					<h2 className="section-label">
						<span>
							<IconScissors size={12} /> The edit
						</span>
					</h2>

					<div className="result-summary">
						<div className="result-summary-row">
							<span>Original</span>
							<strong>{formatSpan(plan.sourceDurationMs)}</strong>
						</div>
						<div className="result-summary-row result-summary-row--strong">
							<span>After the cut</span>
							<strong>{formatSpan(plan.outputDurationMs)}</strong>
						</div>
						<div className="result-summary-row">
							<span>Saved</span>
							<strong className="result-summary-win">
								{formatSpan(plan.savedMs)}
								{plan.sourceDurationMs > 0
									? ` (${Math.round((plan.savedMs / plan.sourceDurationMs) * 100)}%)`
									: ''}
							</strong>
						</div>
						<div className="result-summary-row">
							<span>Splices</span>
							<strong>{plan.cuts}</strong>
						</div>
					</div>

					{plan.spedSourceMs > 0 ? (
						<div className="chip-row" style={{ marginTop: 10 }}>
							<span className="chip chip--static">
								{formatSpan(plan.spedSourceMs)} run fast
							</span>
							{plan.droppedMs > 0 ? (
								<span className="chip chip--static">{formatSpan(plan.droppedMs)} removed</span>
							) : null}
						</div>
					) : null}
				</div>

				{/* -------------------------------------------------------- output */}

				<div>
					<h2 className="section-label">
						<span>
							<IconFilm size={12} /> Output
						</span>
					</h2>

					<div className="field">
						<label className="field-label">
							<span>Container</span>
						</label>
						<div className="segmented" role="group" aria-label="Container">
							<button
								data-active={settings.format === 'mp4'}
								disabled={rendering}
								onClick={() => onSettings({ format: 'mp4' })}
							>
								MP4
							</button>
							<button
								data-active={settings.format === 'webm'}
								disabled={rendering}
								onClick={() => onSettings({ format: 'webm' })}
							>
								WebM
							</button>
						</div>
						<span className="field-hint">
							MP4 with H.264 plays everywhere and is what every editor and phone expects. WebM is
							smaller at the same quality but is not accepted by some social uploads.
						</span>
					</div>

					<div className="field">
						<label className="field-label">
							<span>Quality</span>
						</label>
						<div className="segmented" role="group" aria-label="Quality">
							<button
								data-active={settings.quality === 'draft'}
								disabled={rendering}
								onClick={() => onSettings({ quality: 'draft' })}
							>
								Draft
							</button>
							<button
								data-active={settings.quality === 'high'}
								disabled={rendering}
								onClick={() => onSettings({ quality: 'high' })}
							>
								High
							</button>
							<button
								data-active={settings.quality === 'max'}
								disabled={rendering}
								onClick={() => onSettings({ quality: 'max' })}
							>
								Max
							</button>
						</div>
					</div>

					<div className="field">
						<label className="field-label">
							<span>Frame rate</span>
							<span className="field-value">{fps} fps</span>
						</label>
						<div className="chip-row">
							<button
								className="chip"
								data-active={settings.fps === null}
								disabled={rendering}
								onClick={() => onSettings({ fps: null })}
							>
								Match source
							</button>
							{FPS_CHOICES.map((choice) => (
								<button
									key={choice}
									className="chip"
									data-active={settings.fps === choice}
									disabled={rendering}
									onClick={() => onSettings({ fps: choice })}
								>
									{choice}
								</button>
							))}
						</div>
					</div>

					<div className="field">
						<label className="field-label">
							<span>Resolution</span>
							<span className="field-value">
								{width > 0 ? `${width} x ${height}` : '--'}
							</span>
						</label>
						<div className="chip-row">
							{[1, 0.75, 0.5].map((scale) => (
								<button
									key={scale}
									className="chip"
									data-active={Math.abs(settings.scale - scale) < 0.01}
									disabled={rendering}
									onClick={() => onSettings({ scale })}
								>
									{scale === 1 ? 'Full' : `${Math.round(scale * 100)}%`}
								</button>
							))}
						</div>
					</div>

					<label className="field-label" style={{ cursor: 'pointer' }}>
						<span>Keep the audio</span>
						<input
							type="checkbox"
							checked={settings.includeAudio}
							disabled={rendering}
							onChange={(event) => onSettings({ includeAudio: event.target.checked })}
						/>
					</label>

					{estimatedBytes > 0 ? (
						<span className="field-hint">
							Roughly {formatBytes(estimatedBytes)} at these settings - the encoder decides the real
							number from the picture.
						</span>
					) : null}
				</div>

				{/* ------------------------------------------------------- handoff */}

				<div>
					<h2 className="section-label">
						<span>
							<IconCaptions size={12} /> Then what
						</span>
					</h2>
					<div className="card">
						<div className="card-head">
							<strong className="card-title">Subtitle the cut</strong>
						</div>
						<p className="card-text">
							Send the finished file straight to the Subtitle Studio - no second upload, and the
							transcript is generated against the tightened cut, so every caption lands on the right
							word.
							{hasCues
								? ' The transcript that came with this clip travels too, already re-timed through the edit.'
								: ''}
						</p>
						<div className="card-actions">
							<button
								className="btn btn--sm"
								disabled={!result || sendState === 'sending'}
								onClick={onSendToCaptions}
							>
								{sendState === 'sending' ? (
									<IconSpinner size={12} className="spin" />
								) : sendState === 'sent' ? (
									<IconCheck size={12} />
								) : (
									<IconCaptions size={12} />
								)}
								{sendState === 'sent' ? 'Waiting in Subtitles' : 'Send to Subtitle Studio'}
							</button>
							{sendState === 'sent' ? (
								<a className="btn btn--ghost btn--sm" href="/captions">
									Open it
								</a>
							) : null}
						</div>
						{sendState === 'failed' ? (
							<div className="notice notice--error" style={{ marginTop: 10 }}>
								<span className="notice-icon">
									<IconAlert size={14} />
								</span>
								<span>
									The browser refused to store the hand-off - it may be out of space. Download the
									file and upload it there instead.
								</span>
							</div>
						) : null}
					</div>
				</div>
			</div>

			{/* --------------------------------------------------------- actions */}

			<div className="panel-actions">
				{error ? (
					<div className="notice notice--error">
						<span className="notice-icon">
							<IconAlert size={14} />
						</span>
						<span>{error}</span>
					</div>
				) : null}

				{!webCodecs && !usingCloud ? (
					<div className="notice notice--warn">
						<span className="notice-icon">
							<IconAlert size={14} />
						</span>
						<span>
							This browser has no WebCodecs video encoder, so the cut cannot be written here.
							{cloud.available
								? ' Switch the run location to Cloud in the header and the splice happens there instead.'
								: ' Chrome or Edge on a desktop will do it.'}
						</span>
					</div>
				) : null}

				{cloudNote ? (
					<div className="notice notice--info">
						<span className="notice-icon">
							<IconCloud size={14} />
						</span>
						<span>{cloudNote}</span>
					</div>
				) : null}

				{cloud.location === 'cloud' && cloudRefusal && video ? (
					<div className="notice notice--warn">
						<span className="notice-icon">
							<IconDevice size={14} />
						</span>
						<span>{cloudRefusal}</span>
					</div>
				) : null}

				{rendering ? (
					<>
						<div className="progress-track">
							<div
								className="progress-fill"
								style={{ width: `${Math.round((progress?.ratio ?? 0) * 100)}%` }}
							/>
						</div>
						<div className="progress-meta">
							<span>{PHASE_LABEL[progress?.phase ?? 'preparing']}</span>
							<span>
								{progress ? `${progress.framesDone} / ${progress.framesTotal} frames` : ''}
							</span>
						</div>
						<button className="btn btn--danger btn--block" onClick={onCancel}>
							<IconStop size={13} /> Stop
						</button>
					</>
				) : (
					<>
						<button className="btn btn--primary btn--block btn--lg" disabled={!ready} onClick={onRender}>
							{usingCloud ? <IconCloud size={14} /> : <IconScissors size={14} />}{' '}
							{usingCloud ? 'Cut in the cloud' : 'Cut and export'}
						</button>
						<RunLocationNote cloud={cloud} />
					</>
				)}

				{result ? (
					<div className="result">
						<div className="result-title">
							<IconCheck size={14} /> Your cut is ready
						</div>
						<video className="result-media" src={result.url} controls playsInline />
						<div className="result-meta">
							<span>
								{result.width} x {result.height} - {result.fps} fps
							</span>
							<span>
								{formatSeconds(result.durationSeconds)} - {formatBytes(result.sizeInBytes)}
							</span>
						</div>
						<div className="result-meta">
							<span>
								{result.videoCodec}
								{result.audioCodec ? ` + ${result.audioCodec}` : ' - no audio'}
							</span>
						</div>
						<button className="btn btn--block" onClick={onDownload}>
							<IconDownload size={13} /> Download
						</button>
					</div>
				) : plan.cuts === 0 && plan.sourceDurationMs > 0 ? (
					<div className="notice notice--info">
						<span className="notice-icon">
							<IconInfo size={14} />
						</span>
						<span>
							Nothing is being cut at these settings. Lower the shortest pause, or raise the
							sensitivity, until the timeline shows shaded stretches.
						</span>
					</div>
				) : null}

				{children}
			</div>
		</aside>
	)
}
