'use client'

/**
 * The media bin: import a file (picker, or drag-and-drop - both capture a
 * reusable `FileSystemFileHandle` when the browser offers one), see what is
 * in the project, drag a clip onto the timeline or tap "+" to drop it at the
 * playhead.
 *
 * The pool-item-to-timeline drag is built on Pointer Events, not HTML5 drag
 * and drop: `draggable`/`dragstart`/`drop` simply do not exist on touch
 * browsers, so a phone user would have no way to drag a clip onto the
 * timeline at all. Pointer Events unify mouse, pen and touch into one API,
 * so the exact same gesture works everywhere - `EditorStudio.tsx` owns the
 * actual drag state (it needs to draw the floating thumbnail and ask the
 * timeline what is under the pointer), this component only reports the raw
 * pointer lifecycle for the thumbnail that started it.
 */

import { useCallback, useRef } from 'react'
import { IconAlert, IconFile, IconLink, IconPlus, IconTrash, IconUpload } from '../Icons'
import { formatBytes, formatSeconds } from '../../lib/format'
import { handleSupported } from '../../lib/editor/handles'
import type { Asset } from '../../lib/editor/types'

export type PickedFile = { file: File; handle: FileSystemFileHandle | null }

const ACCEPT = 'video/*,image/*,audio/*,.mp4,.mov,.webm,.mkv,.m4v,.mp3,.wav,.m4a,.ogg,.png,.jpg,.jpeg,.webp,.gif'

async function pickWithFileSystemAccess(): Promise<PickedFile[]> {
	const handles = await window.showOpenFilePicker!({
		multiple: true,
		excludeAcceptAllOption: false,
		types: [{ description: 'Media', accept: { 'video/*': ['.mp4', '.mov', '.webm', '.mkv', '.m4v'], 'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.gif'], 'audio/*': ['.mp3', '.wav', '.m4a', '.ogg', '.flac'] } }],
	})
	const results: PickedFile[] = []
	for (const handle of handles) {
		try {
			results.push({ file: await handle.getFile(), handle })
		} catch {
			/* skip a file that vanished between pick and read */
		}
	}
	return results
}

async function filesFromDrop(event: React.DragEvent): Promise<PickedFile[]> {
	const items = Array.from(event.dataTransfer.items)
	const results: PickedFile[] = []
	for (const item of items) {
		if (item.kind !== 'file') continue
		const getAsHandle = (item as DataTransferItem & { getAsFileSystemHandle?: () => Promise<FileSystemHandle> }).getAsFileSystemHandle
		if (getAsHandle) {
			try {
				const handle = await getAsHandle.call(item)
				if (handle.kind === 'file') {
					const fileHandle = handle as FileSystemFileHandle
					results.push({ file: await fileHandle.getFile(), handle: fileHandle })
					continue
				}
			} catch {
				/* fall through to the plain File path below */
			}
		}
		const file = item.getAsFile()
		if (file) results.push({ file, handle: null })
	}
	return results
}

function kindLabel(asset: Asset): string {
	return asset.kind === 'video' ? formatSeconds(asset.durationSeconds) : asset.kind === 'audio' ? formatSeconds(asset.durationSeconds) : `${asset.width}×${asset.height}`
}

export default function MediaPool({
	assets,
	thumbUrls,
	needsReconnect,
	onImport,
	onAddToTimeline,
	onRemoveAsset,
	onReconnect,
	onDragStart,
	onDragMove,
	onDragEnd,
}: {
	assets: Asset[]
	thumbUrls: Record<string, string>
	needsReconnect: Set<string>
	onImport: (files: PickedFile[]) => void
	onAddToTimeline: (assetId: string) => void
	onRemoveAsset: (assetId: string) => void
	onReconnect: (assetId: string) => void
	onDragStart: (assetId: string, clientX: number, clientY: number) => void
	onDragMove: (clientX: number, clientY: number) => void
	onDragEnd: (clientX: number, clientY: number) => void
}) {
	const inputRef = useRef<HTMLInputElement>(null)

	const openPicker = useCallback(async () => {
		if (handleSupported()) {
			try {
				const picked = await pickWithFileSystemAccess()
				if (picked.length) onImport(picked)
				return
			} catch {
				// AbortError (user cancelled) or a permission quirk - fall through to
				// the plain input so the import is never a dead end.
			}
		}
		inputRef.current?.click()
	}, [onImport])

	const onInputChange = useCallback(
		(event: React.ChangeEvent<HTMLInputElement>) => {
			const files = Array.from(event.target.files ?? [])
			if (files.length) onImport(files.map((file) => ({ file, handle: null })))
			event.target.value = ''
		},
		[onImport],
	)

	const onDrop = useCallback(
		async (event: React.DragEvent<HTMLDivElement>) => {
			event.preventDefault()
			const picked = await filesFromDrop(event)
			if (picked.length) onImport(picked)
		},
		[onImport],
	)

	return (
		<div className="editor-media-pool" onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
			<input ref={inputRef} type="file" multiple accept={ACCEPT} className="sr-only" onChange={onInputChange} />
			<button type="button" className="btn btn--primary editor-import-btn" onClick={openPicker}>
				<IconUpload size={14} /> Import media
			</button>

			{assets.length === 0 ? (
				<div className="editor-media-empty">
					<IconFile size={22} />
					<span>Drop video, image or audio files here</span>
				</div>
			) : (
				<ul className="editor-media-list">
					{assets.map((asset) => (
						<li key={asset.id} className="editor-media-item" data-status={asset.status}>
							<div
								className="editor-media-thumb"
								title="Drag onto the timeline"
								onPointerDown={(event) => {
									if (event.pointerType === 'mouse' && event.button !== 0) return
									event.currentTarget.setPointerCapture(event.pointerId)
									onDragStart(asset.id, event.clientX, event.clientY)
								}}
								onPointerMove={(event) => {
									if (event.currentTarget.hasPointerCapture(event.pointerId)) onDragMove(event.clientX, event.clientY)
								}}
								onPointerUp={(event) => {
									if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
									event.currentTarget.releasePointerCapture(event.pointerId)
									onDragEnd(event.clientX, event.clientY)
								}}
								onPointerCancel={(event) => {
									if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
									event.currentTarget.releasePointerCapture(event.pointerId)
									onDragEnd(-1, -1)
								}}
							>
								{thumbUrls[asset.id] ? (
									// eslint-disable-next-line @next/next/no-img-element
									<img src={thumbUrls[asset.id]} alt="" />
								) : (
									<IconFile size={16} />
								)}
							</div>
							<div className="editor-media-meta">
								<span className="editor-media-name" title={asset.name}>
									{asset.name}
								</span>
								<span className="editor-media-sub">
									{kindLabel(asset)} · {formatBytes(asset.sizeBytes)}
								</span>
								{asset.error ? (
									<span className="editor-media-warning">
										<IconAlert size={11} /> {asset.error}
									</span>
								) : null}
							</div>
							<div className="editor-media-actions">
								{needsReconnect.has(asset.id) ? (
									<button type="button" className="editor-track-btn" title="Reconnect this file" onClick={() => onReconnect(asset.id)}>
										<IconLink size={12} />
									</button>
								) : null}
								<button type="button" className="editor-track-btn" title="Add to timeline" onClick={() => onAddToTimeline(asset.id)}>
									<IconPlus size={12} />
								</button>
								<button type="button" className="editor-track-btn" title="Remove from project" onClick={() => onRemoveAsset(asset.id)}>
									<IconTrash size={12} />
								</button>
							</div>
						</li>
					))}
				</ul>
			)}
		</div>
	)
}
