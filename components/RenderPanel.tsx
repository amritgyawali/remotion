'use client'

import { computeBitrate, evenDimension, FORMAT_INFO, QUALITY_PRESETS, SCALE_OPTIONS } from '../lib/presets'
import { formatBytes, formatSeconds } from '../lib/format'
import type {
	CompiledComposition,
	OutputFormat,
	QualityPresetId,
	RenderOutput,
	RenderProgress,
	RenderSettings,
	ServerCapabilities,
} from '../lib/types'
import {
	IconAlert,
	IconBolt,
	IconBrowser,
	IconCheck,
	IconDownload,
	IconInfo,
	IconPlay,
	IconServer,
	IconSpinner,
	IconStop,
} from './Icons'

const PHASE_LABEL: Record<RenderProgress['phase'], string> = {
	idle: 'Ready',
	preparing: 'Preparing',
	bundling: 'Bundling',
	rendering: 'Rendering frames',
	encoding: 'Encoding',
	uploading: 'Finishing',
	done: 'Done',
	error: 'Failed',
	cancelled: 'Cancelled',
}

export default function RenderPanel({
	composition,
	settings,
	onSettings,
	capabilities,
	webCodecs,
	progress,
	output,
	error,
	rendering,
	onRender,
	onCancel,
	accessKey,
	onAccessKey,
	log,
}: {
	composition: CompiledComposition | null
	settings: RenderSettings
	onSettings: (patch: Partial<RenderSettings>) => void
	capabilities: ServerCapabilities
	webCodecs: boolean
	progress: RenderProgress
	output: RenderOutput | null
	error: string | null
	rendering: boolean
	onRender: () => void
	onCancel: () => void
	accessKey: string
	onAccessKey: (value: string) => void
	log: string[]
}) {
	const fps = composition?.fps ?? 30
	const totalSeconds = composition ? composition.durationInFrames / fps : 0
	const renderSeconds =
		settings.previewSeconds > 0 ? Math.min(totalSeconds, settings.previewSeconds) : totalSeconds
	const width = composition ? evenDimension(composition.width * settings.scale) : 0
	const height = composition ? evenDimension(composition.height * settings.scale) : 0
	const bitrate = composition ? computeBitrate(width, height, fps, settings.preset) : 0
	const estimatedBytes = (bitrate / 8) * renderSeconds
	const frames = Math.round(renderSeconds * fps)
	const overFrameLimit = settings.engine === 'server' && frames > capabilities.maxFrames
	const formats = (Object.keys(FORMAT_INFO) as OutputFormat[]).filter((key) =>
		FORMAT_INFO[key].engines.includes(settings.engine),
	)
	const blocked = !composition || rendering || overFrameLimit

	return (
		<aside className="panel panel--right">
			<div className="panel-scroll">
				<div>
					<h2 className="section-label">2 - Render engine</h2>
					<div className="segmented">
						<button
							data-active={settings.engine === 'browser'}
							onClick={() => onSettings({ engine: 'browser', format: 'mp4' })}
							disabled={rendering}
						>
							<IconBrowser size={12} /> Browser - free
						</button>
						<button
							data-active={settings.engine === 'server'}
							onClick={() => onSettings({ engine: 'server' })}
							disabled={rendering || !capabilities.enabled}
							title={
								capabilities.enabled
									? 'Headless Chrome on the server - every core, every codec'
									: 'Set ENABLE_SERVER_RENDER=1 to unlock server rendering'
							}
						>
							<IconServer size={12} /> Server - max
						</button>
					</div>

					{settings.engine === 'browser' && !webCodecs ? (
						<div className="notice notice--error" style={{ marginTop: 10 }}>
							<span className="notice-icon">
								<IconAlert size={14} />
							</span>
							<span>
								This browser has no WebCodecs support. Use Chrome, Edge or Safari 16.4+, or switch
								to the server engine.
							</span>
						</div>
					) : null}

					{settings.engine === 'browser' ? (
						<div className="notice notice--info" style={{ marginTop: 10 }}>
							<span className="notice-icon">
								<IconInfo size={14} />
							</span>
							<span>
								Frames are drawn and encoded on your GPU. No upload, no server cost, no time limit -
								perfect for Vercel&apos;s free tier.
							</span>
						</div>
					) : null}

					{settings.engine === 'server' && capabilities.requiresKey ? (
						<div className="field" style={{ marginTop: 10 }}>
							<label className="field-label" htmlFor="render-key">
								Render key
							</label>
							<input
								id="render-key"
								className="input"
								type="password"
								value={accessKey}
								placeholder="RENDER_ACCESS_KEY"
								onChange={(event) => onAccessKey(event.target.value)}
							/>
						</div>
					) : null}
				</div>

				<div>
					<h2 className="section-label">3 - Quality</h2>
					<div className="preset-grid">
						{(Object.keys(QUALITY_PRESETS) as QualityPresetId[]).map((id) => {
							const preset = QUALITY_PRESETS[id]
							return (
								<button
									key={id}
									className="preset"
									data-active={settings.preset === id}
									onClick={() => onSettings({ preset: id })}
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
						<label className="field-label" htmlFor="format">
							Format
						</label>
						<select
							id="format"
							className="select"
							value={settings.format}
							disabled={rendering}
							onChange={(event) => onSettings({ format: event.target.value as OutputFormat })}
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
							<span className="field-value">
								{composition ? `${width} x ${height}` : '-'}
							</span>
						</span>
						<div className="segmented">
							{SCALE_OPTIONS.map((option) => (
								<button
									key={option.value}
									data-active={settings.scale === option.value}
									onClick={() => onSettings({ scale: option.value })}
									disabled={rendering}
								>
									{option.label}
								</button>
							))}
						</div>
					</div>

					<div className="field">
						<label className="field-label" htmlFor="preview-seconds">
							Length
							<span className="field-value">
								{settings.previewSeconds === 0
									? `full - ${formatSeconds(totalSeconds)}`
									: `first ${formatSeconds(renderSeconds)}`}
							</span>
						</label>
						<input
							id="preview-seconds"
							className="range"
							type="range"
							min={0}
							max={Math.max(1, Math.ceil(totalSeconds))}
							step={1}
							value={settings.previewSeconds}
							disabled={rendering || !composition}
							onChange={(event) => onSettings({ previewSeconds: Number(event.target.value) })}
						/>
					</div>
				</div>

				<div className="card">
					<div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
						<span style={{ color: 'var(--text-secondary)' }}>Frames</span>
						<span className="field-value">{composition ? frames : '-'}</span>
					</div>
					<div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginTop: 6 }}>
						<span style={{ color: 'var(--text-secondary)' }}>Target bitrate</span>
						<span className="field-value">
							{composition ? `${(bitrate / 1_000_000).toFixed(1)} Mbps` : '-'}
						</span>
					</div>
					<div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginTop: 6 }}>
						<span style={{ color: 'var(--text-secondary)' }}>Estimated size</span>
						<span className="field-value">
							{composition ? `~${formatBytes(estimatedBytes)}` : '-'}
						</span>
					</div>
				</div>

				{overFrameLimit ? (
					<div className="notice notice--warn">
						<span className="notice-icon">
							<IconAlert size={14} />
						</span>
						<span>
							{frames} frames is over the server limit of {capabilities.maxFrames}. Shorten the render
							or use the browser engine, which has no limit.
						</span>
					</div>
				) : null}

				<div style={{ display: 'flex', gap: 8 }}>
					<button className="btn btn--primary btn--block" onClick={onRender} disabled={blocked}>
						{rendering ? <IconSpinner size={14} /> : <IconPlay size={14} />}
						{rendering ? 'Rendering...' : 'Render video'}
					</button>
					{rendering ? (
						<button className="btn btn--danger" onClick={onCancel} title="Stop the render">
							<IconStop size={13} />
						</button>
					) : null}
				</div>

				{progress.phase !== 'idle' ? (
					<div>
						<div className="progress-track">
							<div
								className="progress-fill"
								data-state={progress.phase === 'done' ? 'done' : progress.phase === 'error' ? 'error' : undefined}
								style={{ width: `${Math.round(Math.min(1, Math.max(0, progress.progress)) * 100)}%` }}
							/>
						</div>
						<div className="progress-meta">
							<span>{PHASE_LABEL[progress.phase]}</span>
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
						{log.length > 0 ? <pre className="log">{log.join('\n')}</pre> : null}
					</div>
				) : null}

				{error ? (
					<div className="notice notice--error">
						<span className="notice-icon">
							<IconAlert size={14} />
						</span>
						<span>{error}</span>
					</div>
				) : null}

				{output ? (
					<div className="result">
						<div className="result-title">
							<IconCheck size={14} /> {output.fileName}
						</div>
						{output.mimeType.startsWith('video/') ? (
							<video
								src={output.url}
								controls
								playsInline
								style={{ width: '100%', borderRadius: 8, background: '#000' }}
							/>
						) : (
							// eslint-disable-next-line @next/next/no-img-element
							<img
								src={output.url}
								alt="Rendered still"
								style={{ width: '100%', borderRadius: 8, background: '#000' }}
							/>
						)}
						<div className="result-meta">
							{output.width} x {output.height} - {output.codec} - {formatBytes(output.sizeInBytes)} -{' '}
							{formatSeconds(output.durationMs / 1000)} on the {output.engine}
						</div>
						<a className="btn btn--primary btn--block" href={output.url} download={output.fileName}>
							<IconDownload size={14} /> Download
						</a>
					</div>
				) : null}
			</div>
		</aside>
	)
}
