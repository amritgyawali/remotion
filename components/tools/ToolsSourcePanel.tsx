'use client'

import { useCallback, useRef, useState } from 'react'
import { formatBytes, formatSeconds } from '../../lib/format'
import { ACCEPTED_VIDEO_TYPES } from '../../lib/captions/video-source'
import type { CaptionVideoSource } from '../../lib/captions/types'
import { toolById, type ToolCategory, type ToolDef } from '../../lib/tools/registry'
import type { RunParams } from '../../lib/tools/runners'
import ToolCatalog from './ToolCatalog'
import ToolParamForm from './ToolParamForm'
import { IconCloudOff, IconFilm, IconLink, IconTools, IconTrash, IconUpload, IconVault } from '../Icons'

export default function ToolsSourcePanel({
	video,
	videoBanked,
	busy,
	selectedTool,
	query,
	category,
	params,
	secondaryFile,
	batchFiles,
	onVideoFiles,
	onClearVideo,
	onQuery,
	onCategory,
	onSelectTool,
	onBackToCatalog,
	onParamChange,
	onSecondaryFile,
	onBatchFiles,
}: {
	video: CaptionVideoSource | null
	videoBanked: boolean
	busy: boolean
	selectedTool: ToolDef | null
	query: string
	category: ToolCategory | null
	params: RunParams
	secondaryFile: File | null
	batchFiles: File[]
	onVideoFiles: (files: File[]) => void
	onClearVideo: () => void
	onQuery: (value: string) => void
	onCategory: (value: ToolCategory | null) => void
	onSelectTool: (id: string) => void
	onBackToCatalog: () => void
	onParamChange: (key: string, value: string | number | boolean) => void
	onSecondaryFile: (file: File | null) => void
	onBatchFiles: (files: File[]) => void
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
										{video.width} x {video.height} - {video.fps} fps - {formatSeconds(video.durationInSeconds)}
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
											: 'This clip is not kept in your browser'
									}
								>
									{videoBanked ? <IconVault size={11} /> : <IconCloudOff size={11} />}
									{videoBanked ? 'kept for next time' : 'not kept'}
								</span>
							</div>
							<div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
								<button className="btn btn--sm" disabled={busy} onClick={() => inputRef.current?.click()}>
									<IconUpload size={12} /> Replace
								</button>
								<button className="btn btn--ghost btn--sm" disabled={busy} onClick={onClearVideo}>
									<IconTrash size={12} /> Remove
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
							<div className="dropzone-title">Drop a video to work on</div>
							<div className="dropzone-hint">
								MP4, MOV or WebM. Everything runs in the tab - nothing is uploaded anywhere.
							</div>
						</div>
					)}

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

				{/* --------------------------------------------------------- tool */}

				<div>
					<h2 className="section-label">
						<span>
							<IconTools size={12} /> 2 - Choose a tool
						</span>
						{selectedTool ? (
							<button className="chip" onClick={onBackToCatalog}>
								All tools
							</button>
						) : null}
					</h2>

					{selectedTool ? (
						<SelectedToolPanel
							tool={selectedTool}
							params={params}
							video={video}
							secondaryFile={secondaryFile}
							batchFiles={batchFiles}
							disabled={busy}
							onParamChange={onParamChange}
							onSecondaryFile={onSecondaryFile}
							onBatchFiles={onBatchFiles}
						/>
					) : (
						<ToolCatalog query={query} category={category} onQuery={onQuery} onCategory={onCategory} onSelect={onSelectTool} />
					)}
				</div>
			</div>
		</aside>
	)
}

function SelectedToolPanel({
	tool,
	params,
	video,
	secondaryFile,
	batchFiles,
	disabled,
	onParamChange,
	onSecondaryFile,
	onBatchFiles,
}: {
	tool: ToolDef
	params: RunParams
	video: CaptionVideoSource | null
	secondaryFile: File | null
	batchFiles: File[]
	disabled: boolean
	onParamChange: (key: string, value: string | number | boolean) => void
	onSecondaryFile: (file: File | null) => void
	onBatchFiles: (files: File[]) => void
}) {
	const Icon = tool.icon
	return (
		<div className="card">
			<div className="card-head">
				<span className="media-card-icon">
					<Icon size={16} />
				</span>
				<strong className="card-title">{tool.name}</strong>
			</div>
			<p className="card-text">{tool.short}</p>

			{tool.status === 'soon' ? (
				<div className="notice notice--info" style={{ marginTop: 10 }}>
					<span>This one is on the roadmap and not wired up yet - pick a ready tool to actually run something.</span>
				</div>
			) : tool.link ? (
				<div className="card-actions" style={{ marginTop: 10 }}>
					<a className="btn btn--primary btn--sm" href={tool.link.href}>
						<IconLink size={12} /> {tool.link.label}
					</a>
				</div>
			) : (
				<ToolParamForm
					tool={tool}
					params={params}
					probe={video}
					disabled={disabled}
					secondaryFile={secondaryFile}
					batchFiles={batchFiles}
					onChange={onParamChange}
					onSecondaryFile={onSecondaryFile}
					onBatchFiles={onBatchFiles}
				/>
			)}
		</div>
	)
}
