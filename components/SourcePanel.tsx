'use client'

import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { SAMPLES, type SampleDefinition } from '../lib/samples'
import { CODE_EXTENSIONS } from '../lib/project'
import type { VirtualProject } from '../lib/types'
import AiCreator, {
	type AiChatMessage,
	type AiGenerationRequest,
	type AiGenerationResult,
} from './AiCreator'
import {
	IconAlert,
	IconCaptions,
	IconDownload,
	IconFile,
	IconGrid,
	IconSparkle,
	IconUpload,
} from './Icons'

const ACCEPT = [...CODE_EXTENSIONS, '.zip'].join(',')

const BADGE_CLASS: Record<string, string> = {
	'ai-starter': 'badge--accent',
	flagship: 'badge--accent',
	'3d': 'badge--accent',
	showcase: 'badge--green',
	'data-viz': 'badge--green',
	systems: 'badge--orange',
	'multi-file': 'badge--muted',
}

const COMPILES = [
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
]

export default function SourcePanel({
	project,
	busy,
	warnings,
	error,
	variant = 'panel',
	messages,
	onMessages,
	onFiles,
	onSample,
	onEntryChange,
	onAiGenerate,
}: {
	project: VirtualProject | null
	busy: boolean
	warnings: string[]
	error?: string | null
	variant?: 'hero' | 'panel'
	messages: AiChatMessage[]
	onMessages: Dispatch<SetStateAction<AiChatMessage[]>>
	onFiles: (files: File[]) => void
	onSample: (sample: SampleDefinition) => void
	onEntryChange: (path: string) => void
	onAiGenerate: (request: AiGenerationRequest) => Promise<AiGenerationResult>
}) {
	const inputRef = useRef<HTMLInputElement>(null)
	const [dragging, setDragging] = useState(false)
	const [showSamples, setShowSamples] = useState(false)

	const handleDrop = useCallback(
		(event: React.DragEvent<HTMLElement>) => {
			event.preventDefault()
			setDragging(false)
			const files = Array.from(event.dataTransfer.files ?? [])
			if (files.length > 0) onFiles(files)
		},
		[onFiles],
	)

	const filePicker = (
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
	)

	const dropzone = (
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
			<span className="dropzone-icon">
				<IconUpload size={20} />
			</span>
			<span className="dropzone-title">Drop a .tsx file or a .zip project</span>
			<span className="dropzone-hint">or click to browse - it compiles here, never uploaded</span>
		</div>
	)

	const sampleCards = SAMPLES.map((sample) => (
		<article key={sample.id} className="sample-card">
			<div className="card-head">
				<strong className="card-title">{sample.name}</strong>
				<span className={`badge ${BADGE_CLASS[sample.badge] ?? 'badge--muted'}`}>
					{sample.badge}
				</span>
			</div>
			<p className="card-text">{sample.description}</p>
			<p className="sample-tech">{sample.technique}</p>
			<div className="card-actions">
				<button className="btn btn--sm" disabled={busy} onClick={() => onSample(sample)}>
					Open
				</button>
				<a
					className="btn btn--ghost btn--sm"
					href={`/samples/${sample.file}`}
					download
					title={
						sample.badge === 'ai-starter'
							? 'Download this template, give it to your AI, then upload the finished file'
							: 'Download this sample to edit and re-upload'
					}
				>
					<IconDownload size={12} />
					{sample.badge === 'ai-starter' ? 'Template' : 'File'}
				</a>
			</div>
		</article>
	))

	const assetKit = (
		<div className="card">
			<div className="card-head">
				<strong className="card-title">Production asset kit</strong>
				<span className="badge badge--green">OPEN</span>
			</div>
			<p className="card-text">
				1,241 editable SVGs, production textures, 102 self-hosted creative fonts, 8 music loops and
				560 motion-ready sound effects. Every raw file is saved locally for reliable future renders.
			</p>
			<div className="card-actions">
				<a className="btn btn--sm" href="/assets/index.html" target="_blank" rel="noreferrer">
					Browse
				</a>
				<a className="btn btn--ghost btn--sm" href="/assets/production-asset-kit.zip" download>
					<IconDownload size={12} />
					Download kit
				</a>
			</div>
		</div>
	)

	/* ------------------------------------------------------------- hero view */

	if (variant === 'hero') {
		return (
			<section
				className="launch"
				onDragOver={(event) => {
					event.preventDefault()
					setDragging(true)
				}}
				onDragLeave={() => setDragging(false)}
				onDrop={handleDrop}
			>
				<div className="launch-inner">
					<div className="hero-head">
						<span className="hero-eyebrow">
							<IconSparkle size={13} /> AI video director
						</span>
						<h1 className="hero-title">What video should we make?</h1>
						<p className="hero-sub">
							Describe it in your own words. The studio writes the scenes, builds the Remotion
							file, shows you a live preview and renders the finished video - in one step.
						</p>
					</div>

					<AiCreator
						busy={busy}
						variant="hero"
						messages={messages}
						onMessages={onMessages}
						onGenerate={onAiGenerate}
					/>

					{error ? (
						<div className="notice notice--error">
							<span className="notice-icon">
								<IconAlert size={14} />
							</span>
							<span>{error}</span>
						</div>
					) : null}

					<div className="divider-row">or start another way</div>

					<div className="start-grid">
						<button
							type="button"
							className="start-card"
							data-active={dragging}
							onClick={() => inputRef.current?.click()}
						>
							<span className="start-card-icon">
								<IconUpload size={17} />
							</span>
							<span>
								<strong>Upload a file</strong>
								<small>Drop a .tsx composition or a zipped project anywhere on this page.</small>
							</span>
						</button>

						<button
							type="button"
							className="start-card"
							data-active={showSamples}
							onClick={() => setShowSamples((current) => !current)}
						>
							<span className="start-card-icon">
								<IconGrid size={17} />
							</span>
							<span>
								<strong>{showSamples ? 'Hide examples' : 'Open an example'}</strong>
								<small>{SAMPLES.length} finished videos you can play, edit and render.</small>
							</span>
						</button>

						{/* A plain link, not next/link: /captions is served with cross-origin
						    isolation headers a client-side navigation would not pick up. */}
						<a className="start-card" href="/captions">
							<span className="start-card-icon">
								<IconCaptions size={17} />
							</span>
							<span>
								<strong>Subtitle a video</strong>
								<small>Upload a video, transcribe on device and burn in captions.</small>
							</span>
						</a>

						<a className="start-card" href="/resume">
							<span className="start-card-icon">
								<IconFile size={17} />
							</span>
							<span>
								<strong>Write a resume</strong>
								<small>Draft it, tailor it to a job and check it against an ATS parser.</small>
							</span>
						</a>
					</div>

					{showSamples ? <div className="sample-grid">{sampleCards}</div> : null}

					{assetKit}
				</div>
				{filePicker}
			</section>
		)
	}

	/* ------------------------------------------------------------ panel view */

	return (
		<aside className="panel panel--left">
			<div className="panel-scroll">
				<div>
					<h2 className="section-label">
						Ask for a change
						<IconSparkle size={12} />
					</h2>
					<AiCreator
						busy={busy}
						variant="dock"
						messages={messages}
						onMessages={onMessages}
						onGenerate={onAiGenerate}
					/>
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

				<details className="disclosure">
					<summary>Upload your own file</summary>
					<div className="disclosure-body">{dropzone}</div>
				</details>

				<details className="disclosure">
					<summary>Examples · {SAMPLES.length}</summary>
					<div className="disclosure-body">
						<div className="sample-grid">{sampleCards}</div>
					</div>
				</details>

				<details className="disclosure">
					<summary>Free asset kit</summary>
					<div className="disclosure-body">{assetKit}</div>
				</details>

				<details className="disclosure">
					<summary>What compiles here</summary>
					<div className="disclosure-body">
						<div className="chip-row">
							{COMPILES.map((name) => (
								<span key={name} className="chip chip--static">
									{name}
								</span>
							))}
						</div>
					</div>
				</details>
			</div>
			{filePicker}
		</aside>
	)
}
