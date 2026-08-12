'use client'

import { useCallback, useRef, useState } from 'react'
import { SAMPLES, type SampleDefinition } from '../lib/samples'
import { CODE_EXTENSIONS } from '../lib/project'
import type { VirtualProject } from '../lib/types'
import { IconAlert, IconCheck, IconCopy, IconDownload, IconFile, IconSparkle, IconUpload } from './Icons'

const ACCEPT = [...CODE_EXTENSIONS, '.zip'].join(',')

const AI_MASTER_PROMPT = `You are editing the AI Master Template for a Remotion video project (ai-master-template.tsx). Generate a brand-new, complete .tsx file for the following video idea:

I want to create a video for photography - there should be a cameraman and cameras, [describe the rest of your idea here: setting, mood, lighting, on-screen text, colors, pacing, music style, etc].

Requirements:
- Reuse the exact same file structure, composition metadata (fps, width, height, durationInFrames), export pattern, and animation timing approach as ai-master-template.tsx.
- Keep the same procedural 3D (ThreeCanvas) technique, camera movement style, and audio/SFX sync logic - just swap the subjects, text, colors and motion to match my concept above.
- Do not add new npm dependencies beyond what the template already imports.
- Output ONE complete, self-contained .tsx file, ready to be uploaded back into the studio.

Reply with the full code only.`

export default function SourcePanel({
	project,
	busy,
	warnings,
	onFiles,
	onSample,
	onEntryChange,
}: {
	project: VirtualProject | null
	busy: boolean
	warnings: string[]
	onFiles: (files: File[]) => void
	onSample: (sample: SampleDefinition) => void
	onEntryChange: (path: string) => void
}) {
	const inputRef = useRef<HTMLInputElement>(null)
	const [dragging, setDragging] = useState(false)
	const [promptCopied, setPromptCopied] = useState(false)

	const copyPrompt = useCallback(() => {
		navigator.clipboard.writeText(AI_MASTER_PROMPT).then(() => {
			setPromptCopied(true)
			setTimeout(() => setPromptCopied(false), 2000)
		})
	}, [])

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
					<h2 className="section-label">1 - Your code file</h2>
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

					<div className="card" style={{ marginTop: 8 }}>
						<div
							style={{
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'space-between',
								gap: 8,
							}}
						>
							<strong style={{ fontSize: 13 }}>AI prompt for the master template</strong>
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
							Download the AI Master Template above, paste this prompt into your AI with the
							file attached, swap the bracketed idea for your own, then upload the .tsx it
							returns back into the studio.
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
								maxHeight: 220,
								overflowY: 'auto',
							}}
						>
							{AI_MASTER_PROMPT}
						</pre>
						<button className="btn btn--sm" onClick={copyPrompt}>
							{promptCopied ? <IconCheck size={12} /> : <IconCopy size={12} />}
							{promptCopied ? 'Copied' : 'Copy prompt'}
						</button>
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
