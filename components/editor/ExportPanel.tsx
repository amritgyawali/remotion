'use client'

/**
 * The export dialog: format/quality/resolution, a progress readout with a
 * real phase label, cancel, and - once finished - a download link. Rendering
 * happens entirely on this device (`lib/editor/export.ts`), so there is no
 * queue and no upload bar to wait behind.
 */

import { IconClose, IconDownload, IconSpinner } from '../Icons'
import { formatBytes, formatSeconds } from '../../lib/format'
import type { ExportFormat, ExportProgress, ExportQuality, ExportResult } from '../../lib/editor/export'
import type { RunLocation } from '../../lib/cloud/types'

export type ExportSettings = { format: ExportFormat; quality: ExportQuality; scale: number; includeAudio: boolean }

const PHASE_LABEL: Record<ExportProgress['phase'], string> = {
	preparing: 'Preparing',
	rendering: 'Rendering frames',
	mixing: 'Mixing audio',
	finishing: 'Finishing file',
}

export default function ExportPanel({
	open,
	settings,
	onSettings,
	rendering,
	progress,
	result,
	error,
	durationLabel,
	onStart,
	onCancel,
	onClose,
	onDownload,
	location,
	serverReady,
	requiresKey,
	accessKey,
	onAccessKey,
}: {
	open: boolean
	settings: ExportSettings
	onSettings: (fields: Partial<ExportSettings>) => void
	rendering: boolean
	progress: ExportProgress | null
	result: ExportResult | null
	error: string | null
	durationLabel: string
	onStart: () => void
	onCancel: () => void
	onClose: () => void
	onDownload: () => void
	location: RunLocation
	serverReady: boolean
	requiresKey: boolean
	accessKey: string
	onAccessKey: (value: string) => void
}) {
	if (!open) return null

	return (
		<div className="editor-modal-backdrop" role="dialog" aria-modal="true" aria-label="Export">
			<div className="editor-modal">
				<div className="editor-modal-header">
					<h3>Export video</h3>
					<button type="button" className="icon-btn" onClick={onClose} aria-label="Close" disabled={rendering}>
						<IconClose size={14} />
					</button>
				</div>

				{!rendering && !result ? (
					<div className="editor-modal-body">
						<p className="editor-hint">
							{location === 'cloud'
								? serverReady
									? 'The timeline renders online and the finished video is saved to Cloudinary.'
									: 'Cloud rendering is not configured. Switch to Local to render on this machine.'
								: 'The timeline renders on this machine and is downloaded locally.'}
						</p>
						{location === 'cloud' && requiresKey ? (
							<label className="editor-field">
								<span>Render access key</span>
								<input type="password" value={accessKey} onChange={(event) => onAccessKey(event.target.value)} autoComplete="off" />
							</label>
						) : null}
						<div className="segmented" role="group" aria-label="Format">
							{(['mp4', 'webm'] as ExportFormat[]).map((format) => (
								<button key={format} type="button" data-active={settings.format === format} onClick={() => onSettings({ format })}>
									{format.toUpperCase()}
								</button>
							))}
						</div>
						<div className="segmented" role="group" aria-label="Quality">
							{(['draft', 'high', 'max'] as ExportQuality[]).map((quality) => (
								<button key={quality} type="button" data-active={settings.quality === quality} onClick={() => onSettings({ quality })}>
									{quality}
								</button>
							))}
						</div>
						<div className="segmented" role="group" aria-label="Resolution">
							{[0.5, 1, 2].map((scale) => (
								<button key={scale} type="button" data-active={settings.scale === scale} onClick={() => onSettings({ scale })}>
									{scale === 1 ? 'Source' : `${scale}x`}
								</button>
							))}
						</div>
						<label className="editor-field editor-field--checkbox">
							<input type="checkbox" checked={settings.includeAudio} onChange={(event) => onSettings({ includeAudio: event.target.checked })} />
							<span>Include audio</span>
						</label>
						<p className="editor-hint">{durationLabel}</p>
						{error ? <p className="notice notice--error">{error}</p> : null}
						<button type="button" className="btn btn--primary btn--block" onClick={onStart} disabled={location === 'cloud' && !serverReady}>
							<IconDownload size={14} /> {location === 'cloud' ? 'Render and save in cloud' : 'Render and download'}
						</button>
					</div>
				) : null}

				{rendering && progress ? (
					<div className="editor-modal-body">
						<div className="editor-export-progress">
							<IconSpinner size={16} />
							<div>
								<strong>{PHASE_LABEL[progress.phase]}</strong>
								<span>
									{progress.framesDone} / {progress.framesTotal} frames
								</span>
							</div>
						</div>
						<div className="progress-track">
							<div className="progress-fill" style={{ width: `${Math.round(progress.ratio * 100)}%` }} />
						</div>
						<button type="button" className="btn btn--danger btn--block" onClick={onCancel}>
							Cancel
						</button>
					</div>
				) : null}

				{result ? (
					<div className="editor-modal-body">
						<p className="editor-hint">
							{result.format.toUpperCase()} · {result.width}×{result.height} · {formatSeconds(result.durationSeconds)} · {formatBytes(result.sizeInBytes)}
						</p>
						{result.offlineAssetCount > 0 ? (
							<p className="notice notice--error">{result.offlineAssetCount} clip(s) rendered as an offline slate - reconnect their media and export again for the real picture.</p>
						) : null}
						<button type="button" className="btn btn--primary btn--block" onClick={onDownload}>
							<IconDownload size={14} /> Download
						</button>
					</div>
				) : null}
			</div>
		</div>
	)
}
