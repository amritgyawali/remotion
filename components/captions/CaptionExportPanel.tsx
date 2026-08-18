'use client'

import { formatBytes, formatSeconds } from '../../lib/format'
import { computeBitrate, evenDimension, FORMAT_INFO, QUALITY_PRESETS, SCALE_OPTIONS } from '../../lib/presets'
import type { RenderController } from '../../lib/use-render-controller'
import type { CompiledComposition, OutputFormat, QualityPresetId } from '../../lib/types'
import type { CaptionVideoSource } from '../../lib/captions/types'
import {
	IconAlert,
	IconBolt,
	IconBrowser,
	IconCheck,
	IconDownload,
	IconFile,
	IconPlay,
	IconServer,
	IconSpinner,
	IconStop,
	IconVolume,
	IconVolumeOff,
} from '../Icons'

const PHASE_LABEL: Record<string, string> = {
	idle: 'Ready',
	preparing: 'Preparing',
	bundling: 'Bundling',
	rendering: 'Burning captions into frames',
	encoding: 'Encoding',
	uploading: 'Finishing',
	done: 'Done',
	error: 'Failed',
	cancelled: 'Cancelled',
}

export default function CaptionExportPanel({
	render,
	composition,
	video,
	cueCount,
	onRender,
	onDownloadSrt,
	onDownloadVtt,
	onDownloadSource,
}: {
	render: RenderController
	composition: CompiledComposition | null
	video: CaptionVideoSource | null
	cueCount: number
	onRender: () => void
	onDownloadSrt: () => void
	onDownloadVtt: () => void
	onDownloadSource: () => void
}) {
	const { settings, capabilities, progress, output, rendering } = render
	const fps = composition?.fps ?? 30
	const totalSeconds = composition ? composition.durationInFrames / fps : 0
	const renderSeconds =
		settings.previewSeconds > 0 ? Math.min(totalSeconds, settings.previewSeconds) : totalSeconds
	const width = composition ? evenDimension(composition.width * settings.scale) : 0
	const height = composition ? evenDimension(composition.height * settings.scale) : 0
	const bitrate = composition ? computeBitrate(width, height, fps, settings.preset) : 0
	const frames = Math.round(renderSeconds * fps)
	const estimatedBytes = (bitrate / 8) * renderSeconds
	const localVideo = video?.kind === 'file'
	const serverBlocked = settings.engine === 'server' && localVideo
	const formats = (Object.keys(FORMAT_INFO) as OutputFormat[]).filter(
		(key) => FORMAT_INFO[key].engines.includes(settings.engine) && key !== 'png',
	)

	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
			<div>
				<h2 className="section-label">
					Original audio
					<span className={`badge ${settings.audioEnabled ? 'badge--green' : 'badge--muted'}`}>
						{settings.audioEnabled ? 'kept' : 'silent'}
					</span>
				</h2>
				<div className="segmented" role="group" aria-label="Audio">
					<button
						data-active={settings.audioEnabled}
						onClick={() => render.updateSettings({ audioEnabled: true })}
						disabled={rendering}
					>
						<IconVolume size={12} /> Keep
					</button>
					<button
						data-active={!settings.audioEnabled}
						onClick={() => render.updateSettings({ audioEnabled: false })}
						disabled={rendering}
					>
						<IconVolumeOff size={12} /> Mute
					</button>
				</div>
				<p className="hint-text">
					The exported file carries the sound from your video unless you mute it here.
				</p>
			</div>

			<div>
				<h2 className="section-label">Render engine</h2>
				<div className="segmented">
					<button
						data-active={settings.engine === 'browser'}
						onClick={() => render.updateSettings({ engine: 'browser', format: 'mp4' })}
						disabled={rendering}
					>
						<IconBrowser size={12} /> This device
					</button>
					<button
						data-active={settings.engine === 'server'}
						onClick={() => render.updateSettings({ engine: 'server' })}
						disabled={rendering || !capabilities.enabled}
						title={
							capabilities.enabled
								? 'Render on the configured server engine'
								: 'Server rendering is not enabled on this deployment'
						}
					>
						<IconServer size={12} /> Server
					</button>
				</div>
				{serverBlocked ? (
					<div className="notice notice--warn" style={{ marginTop: 10 }}>
						<span className="notice-icon">
							<IconAlert size={14} />
						</span>
						<span>
							The server engine cannot read a file that only exists in this tab. Render on this
							device, or load the video from a public URL first.
						</span>
					</div>
				) : null}
				{settings.engine === 'browser' && !render.webCodecs ? (
					<div className="notice notice--error" style={{ marginTop: 10 }}>
						<span className="notice-icon">
							<IconAlert size={14} />
						</span>
						<span>
							This browser has no WebCodecs support. Use Chrome, Edge or Safari 17+ to export the
							subtitled video.
						</span>
					</div>
				) : null}
				{settings.engine === 'server' && capabilities.requiresKey ? (
					<div className="field" style={{ marginTop: 10 }}>
						<label className="field-label" htmlFor="caption-render-key">
							Render key
						</label>
						<input
							id="caption-render-key"
							className="input"
							type="password"
							value={render.accessKey}
							placeholder="RENDER_ACCESS_KEY"
							onChange={(event) => render.setAccessKey(event.target.value)}
						/>
					</div>
				) : null}
			</div>

			<div>
				<h2 className="section-label">Quality</h2>
				<div className="preset-grid">
					{(Object.keys(QUALITY_PRESETS) as QualityPresetId[]).map((id) => {
						const preset = QUALITY_PRESETS[id]
						return (
							<button
								key={id}
								className="preset"
								data-active={settings.preset === id}
								onClick={() => render.updateSettings({ preset: id })}
								disabled={rendering}
							>
								<span className="preset-radio" />
								<span>
									<span className="preset-title">
										{preset.label}
										{id === 'max' ? (
											<span className="badge badge--orange">
												<IconBolt size={10} /> crf {preset.crf}
											</span>
										) : null}
									</span>
									<span className="preset-desc">{preset.tagline}</span>
								</span>
							</button>
						)
					})}
				</div>
			</div>

			<div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
				<div className="field">
					<label className="field-label" htmlFor="caption-format">
						Format
					</label>
					<select
						id="caption-format"
						className="select"
						value={settings.format}
						disabled={rendering}
						onChange={(event) =>
							render.updateSettings({ format: event.target.value as OutputFormat })
						}
					>
						{formats.map((key) => (
							<option key={key} value={key}>
								{FORMAT_INFO[key].label}
							</option>
						))}
					</select>
					<span style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>
						{FORMAT_INFO[settings.format].note}
					</span>
				</div>

				<div className="field">
					<span className="field-label">
						Resolution
						<span className="field-value">{composition ? `${width} x ${height}` : '-'}</span>
					</span>
					<div className="segmented">
						{SCALE_OPTIONS.map((option) => (
							<button
								key={option.value}
								data-active={settings.scale === option.value}
								onClick={() => render.updateSettings({ scale: option.value })}
								disabled={rendering}
							>
								{option.label}
							</button>
						))}
					</div>
				</div>

				<div className="field">
					<label className="field-label" htmlFor="caption-length">
						Length
						<span className="field-value">
							{settings.previewSeconds === 0
								? `full - ${formatSeconds(totalSeconds)}`
								: `first ${formatSeconds(renderSeconds)}`}
						</span>
					</label>
					<input
						id="caption-length"
						className="range"
						type="range"
						min={0}
						max={Math.max(1, Math.ceil(totalSeconds))}
						step={1}
						value={settings.previewSeconds}
						disabled={rendering || !composition}
						onChange={(event) =>
							render.updateSettings({ previewSeconds: Number(event.target.value) })
						}
					/>
					<span style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>
						Render a short slice first to check the caption style, then export the full clip.
					</span>
				</div>
			</div>

			<div className="card">
				<div className="stat-row">
					<span>Frames</span>
					<span className="field-value">{composition ? frames : '-'}</span>
				</div>
				<div className="stat-row">
					<span>Captions burned in</span>
					<span className="field-value">{cueCount}</span>
				</div>
				<div className="stat-row">
					<span>Target bitrate</span>
					<span className="field-value">
						{composition ? `${(bitrate / 1_000_000).toFixed(1)} Mbps` : '-'}
					</span>
				</div>
				<div className="stat-row">
					<span>Estimated size</span>
					<span className="field-value">
						{composition ? `~${formatBytes(estimatedBytes)}` : '-'}
					</span>
				</div>
			</div>

			<div style={{ display: 'flex', gap: 8 }}>
				<button
					className="btn btn--primary btn--block"
					onClick={onRender}
					disabled={!composition || rendering || cueCount === 0 || serverBlocked}
				>
					{rendering ? <IconSpinner size={14} /> : <IconPlay size={14} />}
					{rendering ? 'Rendering...' : 'Render subtitled video'}
				</button>
				{rendering ? (
					<button className="btn btn--danger" onClick={render.cancel} title="Stop the render">
						<IconStop size={13} />
					</button>
				) : null}
			</div>

			{progress.phase !== 'idle' ? (
				<div>
					<div className="progress-track">
						<div
							className="progress-fill"
							data-state={
								progress.phase === 'done' ? 'done' : progress.phase === 'error' ? 'error' : undefined
							}
							style={{ width: `${Math.round(Math.min(1, Math.max(0, progress.progress)) * 100)}%` }}
						/>
					</div>
					<div className="progress-meta">
						<span>{PHASE_LABEL[progress.phase] ?? progress.phase}</span>
						<span className="field-value">
							{progress.renderedFrames !== undefined && progress.totalFrames
								? `${progress.renderedFrames}/${progress.totalFrames}`
								: `${Math.round(progress.progress * 100)}%`}
							{progress.framesPerSecond ? ` - ${progress.framesPerSecond.toFixed(1)} fps` : ''}
							{progress.etaSeconds && progress.etaSeconds > 1
								? ` - ${formatSeconds(progress.etaSeconds)} left`
								: ''}
						</span>
					</div>
					{render.log.length > 0 ? <pre className="log">{render.log.join('\n')}</pre> : null}
				</div>
			) : null}

			{render.error ? (
				<div className="notice notice--error">
					<span className="notice-icon">
						<IconAlert size={14} />
					</span>
					<span>{render.error}</span>
				</div>
			) : null}

			{output ? (
				<div className="result">
					<div className="result-title">
						<IconCheck size={14} /> {output.fileName}
					</div>
					<video
						src={output.url}
						controls
						playsInline
						style={{ width: '100%', borderRadius: 8, background: '#000' }}
					/>
					<div className="result-meta">
						{output.width} x {output.height} - {output.codec} - {formatBytes(output.sizeInBytes)} -{' '}
						{formatSeconds(output.durationMs / 1000)} on the {output.engine}
					</div>
					<a className="btn btn--primary btn--block" href={output.url} download={output.fileName}>
						<IconDownload size={14} /> Download the subtitled video
					</a>
				</div>
			) : null}

			<div>
				<h2 className="section-label">Take the captions with you</h2>
				<div className="chip-row">
					<button className="chip" onClick={onDownloadSrt} disabled={cueCount === 0}>
						<IconDownload size={12} /> .srt
					</button>
					<button className="chip" onClick={onDownloadVtt} disabled={cueCount === 0}>
						<IconDownload size={12} /> .vtt
					</button>
					<button className="chip" onClick={onDownloadSource} disabled={cueCount === 0}>
						<IconFile size={12} /> .tsx composition
					</button>
				</div>
				<p className="hint-text">
					The .tsx file is the exact composition this preview renders - open it in Remotion Studio,
					or upload it to the code studio to keep editing.
				</p>
			</div>
		</div>
	)
}
