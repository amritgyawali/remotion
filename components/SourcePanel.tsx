'use client'

import { useCallback, useRef, useState } from 'react'
import { SAMPLES, type SampleDefinition } from '../lib/samples'
import { CODE_EXTENSIONS } from '../lib/project'
import type { VirtualProject } from '../lib/types'
import AiCreator, { type AiGenerationRequest, type AiGenerationResult } from './AiCreator'
import { IconAlert, IconDownload, IconFile, IconSparkle, IconUpload } from './Icons'

const ACCEPT = [...CODE_EXTENSIONS, '.zip'].join(',')

export default function SourcePanel({
	project,
	busy,
	warnings,
	onFiles,
	onSample,
	onEntryChange,
	onAiGenerate,
}: {
	project: VirtualProject | null
	busy: boolean
	warnings: string[]
	onFiles: (files: File[]) => void
	onSample: (sample: SampleDefinition) => void
	onEntryChange: (path: string) => void
	onAiGenerate: (request: AiGenerationRequest) => Promise<AiGenerationResult>
}) {
	const inputRef = useRef<HTMLInputElement>(null)
	const [dragging, setDragging] = useState(false)

	const handleDrop = useCallback(
		(event: React.DragEvent<HTMLDivElement>) => {
			event.preventDefault()
			setDragging(false)
			const files = Array.from(event.dataTransfer.files ?? [])
			if (files.length > 0) onFiles(files)
		},
		[onFiles],
	)

	return (
		<aside className="panel panel--left">
			<div className="panel-scroll">
				<div>
					<h2 className="section-label">1 - Create with AI</h2>
					<AiCreator busy={busy} onGenerate={onAiGenerate} />
				</div>

				<div>
					<h2 className="section-label">Or use your code file</h2>
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
						<div className="dropzone-title">Drop a .tsx file or a .zip project</div>
						<div className="dropzone-hint">
							or click to browse - compiled locally, never uploaded
						</div>
					</div>
					<input
						ref={inputRef}
						type="file"
						className="sr-only"
						accept={ACCEPT}
						multiple
						onChange={(event) => {
							const files = Array.from(event.target.files ?? [])
							if (files.length > 0) onFiles(files)
							event.target.value = ''
						}}
					/>
				</div>

				<div>
					<h2 className="section-label">
						Sample projects
						<IconSparkle size={12} />
					</h2>
					<div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
						{SAMPLES.map((sample) => (
							<div key={sample.id} className="card">
								<div
									style={{
										display: 'flex',
										alignItems: 'center',
										justifyContent: 'space-between',
										gap: 8,
									}}
								>
									<strong style={{ fontSize: 13 }}>{sample.name}</strong>
									<span
										className={`badge ${
										sample.badge === 'ai-starter' ||
										sample.badge === 'flagship' ||
										sample.badge === '3d'
												? 'badge--accent'
												: sample.badge === 'showcase' || sample.badge === 'data-viz'
													? 'badge--green'
													: sample.badge === 'systems'
														? 'badge--orange'
														: 'badge--muted'
										}`}
									>
										{sample.badge}
									</span>
								</div>
								<p
									style={{
										margin: '6px 0 10px',
										fontSize: 11.5,
										color: 'var(--text-tertiary)',
										lineHeight: 1.5,
									}}
								>
									{sample.description}
								</p>
								<p
									style={{
										margin: '-4px 0 10px',
										fontSize: 11,
										color: 'var(--text-tertiary)',
										opacity: 0.72,
										lineHeight: 1.45,
									}}
								>
									{sample.technique}
								</p>
								<div style={{ display: 'flex', gap: 6 }}>
									<button
										className="btn btn--sm"
										disabled={busy}
										onClick={() => onSample(sample)}
									>
										Load
									</button>
									<a
										className="btn btn--ghost btn--sm"
										href={`/samples/${sample.file}`}
										download
										title={
											sample.badge === 'ai-starter'
												? 'Download this template, give it to your AI, then upload the completed file'
												: 'Download this sample to edit and re-upload'
										}
									>
										<IconDownload size={12} />
										{sample.badge === 'ai-starter' ? 'Template' : 'File'}
									</a>
								</div>
							</div>
						))}
					</div>

				</div>

				<div>
					<h2 className="section-label">
						Production asset kit
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
							<strong style={{ fontSize: 13 }}>Original visuals + sound</strong>
							<span className="badge badge--green">CC0</span>
						</div>
						<p
							style={{
								margin: '6px 0 10px',
								fontSize: 11.5,
								color: 'var(--text-tertiary)',
								lineHeight: 1.5,
							}}
						>
							41 editable SVGs, 20 textures (grain, matcaps, 3D environment maps), 10
							 self-hosted fonts, 8 music loops and 20 sound effects.
						</p>
						<div style={{ display: 'flex', gap: 6 }}>
							<a className="btn btn--sm" href="/assets/index.html" target="_blank" rel="noreferrer">
								Browse
							</a>
							<a
								className="btn btn--ghost btn--sm"
								href="/assets/production-asset-kit.zip"
								download
							>
								<IconDownload size={12} />
								Download kit
							</a>
						</div>
					</div>
				</div>

				{project ? (
					<div>
						<h2 className="section-label">
							Files
							<span style={{ textTransform: 'none', letterSpacing: 0 }}>click to set entry</span>
						</h2>
						<div className="file-list">
							{project.files.map((file) => (
								<button
									key={file.path}
									className="file-row"
									data-entry={file.path === project.entry}
									onClick={() => onEntryChange(file.path)}
									title={file.path}
								>
									<IconFile size={13} />
									<span className="file-row-name">{file.path}</span>
									{file.path === project.entry ? (
										<span className="file-row-tag">entry</span>
									) : null}
								</button>
							))}
						</div>
					</div>
				) : null}

				{warnings.length > 0 ? (
					<div className="notice notice--warn">
						<span className="notice-icon">
							<IconAlert size={14} />
						</span>
						<span>
							{warnings.map((warning) => (
								<span key={warning} style={{ display: 'block' }}>
									{warning}
								</span>
							))}
						</span>
					</div>
				) : null}

				<div>
					<h2 className="section-label">What compiles here</h2>
					<div className="chip-row">
						{[
							'remotion',
							'@remotion/shapes',
							'@remotion/paths',
							'@remotion/noise',
							'@remotion/transitions',
							'@remotion/motion-blur',
							'@remotion/media',
							'@remotion/gif',
							'@remotion/fonts',
							'@remotion/three',
							'three',
							'react',
						].map((name) => (
							<span key={name} className="chip chip--static">
								{name}
							</span>
						))}
					</div>
				</div>
			</div>
		</aside>
	)
}
