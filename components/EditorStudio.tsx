'use client'

/**
 * The Editor Studio: a real multi-track, non-linear editor - timeline,
 * layers, transforms, text, undo/redo, crash-proof autosave and a local GPU
 * export - built from the pieces in `lib/editor/*`. It is the vertical slice
 * of `video-editor-blueprint-2026.md`'s architecture: one project document
 * (`lib/editor/types.ts`), one patch-based command bus with real undo
 * (`lib/editor/commands.ts` + `lib/editor/ops.ts`), one render graph shared
 * by preview and export (`lib/editor/compositor.ts`), and the same local
 * vault every other studio in this app already trusts
 * (`lib/persist/idb.ts`) for "a refresh never costs you the edit".
 *
 * Two things this file is honest about *not* doing yet (see
 * `VIDEO_EDITOR_CHECKLIST.md`): the live preview's audio uses a best-effort
 * per-clip scheduler rather than one master audio clock, and there is one
 * current project per browser rather than a project library. Export is
 * always deterministic and always mixes the full timeline down offline,
 * regardless of what the preview's audio was doing.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import EditorTopBar from './editor/EditorTopBar'
import MediaPool, { type PickedFile } from './editor/MediaPool'
import PreviewStage from './editor/PreviewStage'
import Timeline, { type DropPreview, type TimelineHandle, type TimelineHandlers } from './editor/Timeline'
import Inspector from './editor/Inspector'
import ExportPanel, { type ExportSettings } from './editor/ExportPanel'
import { RestoreNotice } from './SaveState'
import { IconAlert } from './Icons'
import { useAutosave, useRestoredSnapshot } from '../lib/persist/use-vault'
import { AssetSinkPool } from '../lib/editor/sinks'
import { Player } from '../lib/editor/player'
import { useEngine, useEngineState } from '../lib/editor/use-engine'
import { activeClipsAtFrame, assetDefaultDurationFrames, clipsOnTrack, createTrack, createAudioClip, createImageClip, createTextClip, createVideoClip, createProject, nextTrackName, projectDurationFrames } from '../lib/editor/model'
import * as ops from '../lib/editor/ops'
import { assetsNeedingPermission, deleteAssetStorage, importMediaFile, reconnectAsset, readAssetBlob, readAssetThumb } from '../lib/editor/persistence'
import { renderEditorExport, ExportCancelled, type ExportProgress, type ExportResult } from '../lib/editor/export'
import { EDITOR_SCHEMA_VERSION, clipEndFrame, type Asset, type ChromaKeySpec, type Clip, type CropRect, type ProjectDoc, type TextStyle, type Track, type TrackKind, type UiState } from '../lib/editor/types'
import type { HistoryEntry } from '../lib/editor/commands'
import { formatSeconds } from '../lib/format'
import { isTauriNative } from '../lib/device'

const SESSION_KEY = 'editor-studio'

type EditorSnapshot = { doc: ProjectDoc; undo: HistoryEntry[]; redo: HistoryEntry[]; ui: UiState }

function defaultUi(): UiState {
	return { playheadFrame: 0, zoom: 6, scrollFrame: 0, selection: [], selectedTrackId: null }
}

export default function EditorStudio({ standalone = false }: { standalone?: boolean } = {}) {
	const engine = useEngine(useMemo(() => createProject(), []))
	const state = useEngineState(engine)
	const doc = state.doc

	const [ui, setUi] = useState<UiState>(defaultUi)
	const [playing, setPlaying] = useState(false)
	const [muted, setMuted] = useState(false)
	const [offlineIds, setOfflineIds] = useState<Set<string>>(new Set())
	const [needsReconnect, setNeedsReconnect] = useState<Set<string>>(new Set())
	const [thumbUrls, setThumbUrls] = useState<Record<string, string>>({})
	const [importError, setImportError] = useState<string | null>(null)
	const [exportOpen, setExportOpen] = useState(false)
	const [exportSettings, setExportSettings] = useState<ExportSettings>({ format: 'mp4', quality: 'high', scale: 1, includeAudio: true })
	const [exportRendering, setExportRendering] = useState(false)
	const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null)
	const [exportResult, setExportResult] = useState<ExportResult | null>(null)
	const [exportError, setExportError] = useState<string | null>(null)

	const poolRef = useRef<AssetSinkPool>(new AssetSinkPool())
	const blobsRef = useRef<Map<string, Blob>>(new Map())
	const thumbUrlsRef = useRef<Record<string, string>>({})
	thumbUrlsRef.current = thumbUrls
	const playerRef = useRef<Player | null>(null)
	const canvasRef = useRef<HTMLCanvasElement>(null)
	const exportAbortRef = useRef<AbortController | null>(null)
	const resolveBlob = useCallback((assetId: string) => blobsRef.current.get(assetId) ?? null, [])

	/* ------------------------------------------------------------- restore */

	const restore = useRestoredSnapshot<EditorSnapshot>({
		key: SESSION_KEY,
		version: EDITOR_SCHEMA_VERSION,
		apply: async (data) => {
			engine.hydrate(data.doc, data.undo ?? [], data.redo ?? [])
			setUi({ ...defaultUi(), ...data.ui })
			await resolveAssetBlobs(Object.values(data.doc.assets))
			const needing = await assetsNeedingPermission(Object.values(data.doc.assets))
			setNeedsReconnect(new Set(needing))
		},
	})
	const hydrated = restore.phase !== 'loading'

	const resolveAssetBlobs = useCallback(async (assets: Asset[]) => {
		let changed = false
		await Promise.all(
			assets.map(async (asset) => {
				if (blobsRef.current.has(asset.id)) return
				const blob = await readAssetBlob(asset)
				if (blob) {
					blobsRef.current.set(asset.id, blob)
					changed = true
				}
				const thumb = await readAssetThumb(asset)
				if (thumb) setThumbUrls((prev) => (prev[asset.id] ? prev : { ...prev, [asset.id]: URL.createObjectURL(thumb) }))
			}),
		)
		if (changed) playerRef.current?.setDoc(engine.getDoc())
	}, [engine])

	/* -------------------------------------------------------------- vault */

	const snapshot: EditorSnapshot | null = useMemo(() => (hydrated ? { doc, undo: state.undo, redo: state.redo, ui } : null), [hydrated, doc, state.undo, state.redo, ui])
	const vault = useAutosave({ key: SESSION_KEY, version: EDITOR_SCHEMA_VERSION, data: snapshot, enabled: hydrated })

	/* -------------------------------------------------------------- player */

	useEffect(() => {
		if (!hydrated || !canvasRef.current) return
		const player = new Player(canvasRef.current, engine.getDoc(), poolRef.current, resolveBlob)
		playerRef.current = player
		const unsubscribe = player.subscribe((next) => {
			setUi((prev) => (prev.playheadFrame === next.frame ? prev : { ...prev, playheadFrame: next.frame }))
			setPlaying(next.playing)
			setOfflineIds(next.offlineAssetIds)
		})
		void player.seek(ui.playheadFrame)
		return () => {
			unsubscribe()
			player.dispose()
			playerRef.current = null
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [hydrated])

	useEffect(() => {
		playerRef.current?.setDoc(doc)
	}, [doc])

	useEffect(() => {
		playerRef.current?.setMuted(muted)
	}, [muted])

	useEffect(() => {
		return () => {
			void poolRef.current.disposeAll()
			// Read through the ref, not the `thumbUrls` closed over at mount: this
			// cleanup must see whatever the map holds at the moment of unmount, not
			// the empty object it started as.
			for (const url of Object.values(thumbUrlsRef.current)) URL.revokeObjectURL(url)
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [])

	/* -------------------------------------------------------------- import */

	const handleImport = useCallback(
		async (picked: PickedFile[]) => {
			setImportError(null)
			for (const { file, handle } of picked) {
				try {
					const { asset } = await importMediaFile(file, handle)
					blobsRef.current.set(asset.id, file)

					// Match the project canvas to the very first clip dropped into an
					// otherwise-empty project - the same "sequence settings from the
					// first clip" convention Premiere/Resolve default to. This is what
					// keeps the preview showing the source at its own real resolution
					// instead of letterboxed inside a generic 1920x1080 canvas; it never
					// fires again once the project already has media, so it can't yank
					// the canvas out from under work already in progress.
					const before = engine.getDoc()
					const isEmptyProject = Object.keys(before.assets).length === 0 && Object.keys(before.clips).length === 0
					if (isEmptyProject && (asset.kind === 'video' || asset.kind === 'image') && asset.width > 0 && asset.height > 0) {
						engine.dispatch(
							ops.setProjectSettings(before, {
								width: asset.width,
								height: asset.height,
								fps: asset.kind === 'video' && asset.fps > 0 ? asset.fps : before.settings.fps,
							}),
						)
					}

					engine.dispatch(ops.addAsset(asset))
					if (asset.thumbKey) {
						const thumb = await readAssetThumb(asset)
						if (thumb) setThumbUrls((prev) => ({ ...prev, [asset.id]: URL.createObjectURL(thumb) }))
					}
				} catch (error) {
					setImportError(error instanceof Error ? error.message : 'That file could not be imported.')
				}
			}
			playerRef.current?.setDoc(engine.getDoc())
		},
		[engine],
	)

	const handleReconnect = useCallback(
		async (assetId: string) => {
			const asset = engine.getDoc().assets[assetId]
			if (!asset) return
			const outcome = await reconnectAsset(asset)
			if (outcome.ok && outcome.file) {
				blobsRef.current.set(assetId, outcome.file)
				await poolRef.current.release(assetId)
				setNeedsReconnect((prev) => {
					const next = new Set(prev)
					next.delete(assetId)
					return next
				})
				playerRef.current?.setDoc(engine.getDoc())
			} else {
				setImportError(outcome.reason ?? 'Could not reconnect that file.')
			}
		},
		[engine],
	)

	const handleRemoveAsset = useCallback(
		async (assetId: string) => {
			const asset = engine.getDoc().assets[assetId]
			engine.dispatch(ops.removeAsset(engine.getDoc(), assetId))
			blobsRef.current.delete(assetId)
			await poolRef.current.release(assetId)
			setThumbUrls((prev) => {
				const url = prev[assetId]
				if (url) URL.revokeObjectURL(url)
				const { [assetId]: _drop, ...rest } = prev
				return rest
			})
			if (asset) void deleteAssetStorage(asset)
		},
		[engine],
	)

	/* ------------------------------------------------------- timeline ops */

	const buildClipForAsset = useCallback(
		(asset: Asset, trackId: string, startFrame: number): Clip => {
			const durationFrames = assetDefaultDurationFrames(asset, doc.settings.fps)
			if (asset.kind === 'image') return createImageClip({ trackId, assetId: asset.id, startFrame, durationFrames, label: asset.name })
			if (asset.kind === 'audio') return createAudioClip({ trackId, assetId: asset.id, startFrame, durationFrames, label: asset.name })
			return createVideoClip({ trackId, assetId: asset.id, startFrame, durationFrames, label: asset.name })
		},
		[doc.settings.fps],
	)

	const handleAddAssetToTimeline = useCallback(
		(assetId: string, atFrame?: number) => {
			const asset = doc.assets[assetId]
			if (!asset) return
			const wantKind: TrackKind = asset.kind === 'audio' ? 'audio' : 'video'
			let track = doc.trackOrder.map((id) => doc.tracks[id]).find((t): t is Track => !!t && t.kind === wantKind && !t.locked) ?? null
			if (!track) {
				track = createTrack(wantKind, nextTrackName(doc, wantKind))
				engine.dispatch(ops.addTrack(track, [...doc.trackOrder, track.id]))
			}
			const existing = clipsOnTrack(doc, track.id)
			const lastEnd = existing.reduce((max, clip) => Math.max(max, clipEndFrame(clip)), 0)
			const startFrame = atFrame ?? Math.max(lastEnd, ui.playheadFrame)
			const clip = buildClipForAsset(asset, track.id, startFrame)
			engine.dispatch(ops.addClip(clip))
			setUi((prev) => ({ ...prev, selection: [clip.id] }))
		},
		[buildClipForAsset, doc, engine, ui.playheadFrame],
	)

	const handleAddTextClip = useCallback(() => {
		const track = doc.trackOrder.map((id) => doc.tracks[id]).find((t): t is Track => !!t && t.kind === 'text' && !t.locked)
		const targetTrack = track ?? (() => {
			const created = createTrack('text', nextTrackName(doc, 'text'))
			engine.dispatch(ops.addTrack(created, [...doc.trackOrder, created.id]))
			return created
		})()
		const clip = createTextClip({ trackId: targetTrack.id, startFrame: ui.playheadFrame, durationFrames: Math.round(4 * doc.settings.fps) })
		engine.dispatch(ops.addClip(clip))
		setUi((prev) => ({ ...prev, selection: [clip.id] }))
	}, [doc, engine, ui.playheadFrame])

	const handleSeek = useCallback((frame: number) => {
		setUi((prev) => ({ ...prev, playheadFrame: Math.max(0, frame) }))
		void playerRef.current?.seek(Math.max(0, frame))
	}, [])

	const stepFrame = useCallback(
		(delta: number) => {
			handleSeek(ui.playheadFrame + delta)
		},
		[handleSeek, ui.playheadFrame],
	)

	const handlePlayPause = useCallback(() => {
		if (playing) playerRef.current?.pause()
		else playerRef.current?.play()
	}, [playing])

	const handleSplit = useCallback(() => {
		const current = engine.getDoc()
		const targets = ui.selection.length ? ui.selection : activeClipsAtFrame(current, ui.playheadFrame).map((c) => c.id)
		for (const clipId of targets) engine.dispatch(ops.splitClip(engine.getDoc(), clipId, ui.playheadFrame, current.settings.fps))
	}, [engine, ui.playheadFrame, ui.selection])

	const handleDeleteSelected = useCallback(
		(ripple: boolean) => {
			for (const clipId of ui.selection) {
				engine.dispatch(ripple ? ops.rippleDelete(engine.getDoc(), clipId) : ops.removeClip(engine.getDoc(), clipId))
			}
			setUi((prev) => ({ ...prev, selection: [] }))
		},
		[engine, ui.selection],
	)

	const timelineHandlers: TimelineHandlers = useMemo(
		() => ({
			onSeek: handleSeek,
			onSelect: (ids) => setUi((prev) => ({ ...prev, selection: ids })),
			onZoom: (zoom, anchorFrame) =>
				setUi((prev) => {
					if (anchorFrame === undefined) return { ...prev, zoom }
					const anchorX = (anchorFrame - prev.scrollFrame) * prev.zoom
					return { ...prev, zoom, scrollFrame: Math.max(0, anchorFrame - anchorX / zoom) }
				}),
			onScroll: (scrollFrame) => setUi((prev) => ({ ...prev, scrollFrame: Math.max(0, scrollFrame) })),
			onMoveClip: (clipId, startFrame, trackId) => engine.dispatch(ops.moveClip(engine.getDoc(), clipId, startFrame, trackId)),
			onTrimClip: (clipId, edge, toFrame) => engine.dispatch(ops.trimClip(engine.getDoc(), clipId, edge, toFrame, engine.getDoc().settings.fps)),
			onAddMarker: (frame) => engine.dispatch(ops.addMarker(engine.getDoc(), frame)),
			onMoveMarker: (id, frame) => engine.dispatch(ops.moveMarker(engine.getDoc(), id, frame)),
			onRemoveMarker: (id) => engine.dispatch(ops.removeMarker(engine.getDoc(), id)),
			onAddTrack: (kind) => {
				const current = engine.getDoc()
				const track = createTrack(kind, nextTrackName(current, kind))
				engine.dispatch(ops.addTrack(track, [...current.trackOrder, track.id]))
			},
			onRemoveTrack: (id) => engine.dispatch(ops.removeTrack(engine.getDoc(), id)),
			onUpdateTrack: (id, fields) => engine.dispatch(ops.updateTrack(engine.getDoc(), id, fields)),
			onDropAsset: (assetId, trackId, frame) => {
				const current = engine.getDoc()
				const asset = current.assets[assetId]
				if (!asset) return
				const clip = buildClipForAsset(asset, trackId, frame)
				engine.dispatch(ops.addClip(clip))
				setUi((prev) => ({ ...prev, selection: [clip.id] }))
			},
		}),
		[buildClipForAsset, engine, handleSeek],
	)

	/* -------------------------------------------------- media pool drag/drop */

	const timelineRef = useRef<TimelineHandle>(null)
	const ghostRef = useRef<HTMLDivElement>(null)
	const poolDragRef = useRef<{ assetId: string; pointerActive: boolean; startX: number; startY: number } | null>(null)
	const poolDragRaf = useRef<number | null>(null)
	const pendingDragPos = useRef<{ x: number; y: number } | null>(null)
	const [dragAssetId, setDragAssetId] = useState<string | null>(null)
	const [dropPreview, setDropPreview] = useState<DropPreview>(null)

	const positionGhost = useCallback((x: number, y: number) => {
		if (ghostRef.current) ghostRef.current.style.transform = `translate(${x + 14}px, ${y + 14}px)`
	}, [])

	const handleDragAssetStart = useCallback((assetId: string, x: number, y: number) => {
		poolDragRef.current = { assetId, pointerActive: false, startX: x, startY: y }
	}, [])

	/** Promotes a plain tap into a real drag only past a small movement threshold, then follows the pointer via a ref-mutated ghost (not React state) so 60 pointermove events a second never re-render the whole studio. */
	const handleDragAssetMove = useCallback(
		(x: number, y: number) => {
			const drag = poolDragRef.current
			if (!drag) return
			pendingDragPos.current = { x, y }
			if (!drag.pointerActive) {
				if (Math.hypot(x - drag.startX, y - drag.startY) < 5) return
				drag.pointerActive = true
				setDragAssetId(drag.assetId)
				positionGhost(x, y)
			}
			if (poolDragRaf.current !== null) return
			poolDragRaf.current = requestAnimationFrame(() => {
				poolDragRaf.current = null
				const pos = pendingDragPos.current
				if (!pos || !poolDragRef.current?.pointerActive) return
				positionGhost(pos.x, pos.y)
				const hit = timelineRef.current?.hitTest(pos.x, pos.y) ?? null
				if (!hit) {
					setDropPreview(null)
					return
				}
				const asset = doc.assets[poolDragRef.current.assetId]
				setDropPreview(asset ? { trackId: hit.trackId, frame: hit.frame, durationFrames: assetDefaultDurationFrames(asset, doc.settings.fps) } : null)
			})
		},
		[doc.assets, doc.settings.fps, positionGhost],
	)

	const handleDragAssetEnd = useCallback(
		(x: number, y: number) => {
			const drag = poolDragRef.current
			poolDragRef.current = null
			if (poolDragRaf.current !== null) {
				cancelAnimationFrame(poolDragRaf.current)
				poolDragRaf.current = null
			}
			if (drag?.pointerActive) {
				const hit = x >= 0 ? (timelineRef.current?.hitTest(x, y) ?? null) : null
				if (hit) {
					const asset = engine.getDoc().assets[drag.assetId]
					if (asset) {
						const clip = buildClipForAsset(asset, hit.trackId, hit.frame)
						engine.dispatch(ops.addClip(clip))
						setUi((prev) => ({ ...prev, selection: [clip.id] }))
					}
				}
			}
			setDragAssetId(null)
			setDropPreview(null)
		},
		[buildClipForAsset, engine],
	)

	/* ---------------------------------------------------------- inspector */

	const selectedClip = ui.selection.length === 1 ? doc.clips[ui.selection[0]] ?? null : null

	const inspectorHandlers = useMemo(
		() => ({
			onRenameProject: (name: string) => engine.dispatch(ops.renameProject(engine.getDoc(), name)),
			onSettings: (fields: Partial<ProjectDoc['settings']>) => engine.dispatch(ops.setProjectSettings(engine.getDoc(), fields)),
			onTransform: (fields: Partial<Clip['transform']>) => {
				if (selectedClip) engine.dispatch(ops.setTransform(engine.getDoc(), selectedClip.id, fields))
			},
			onAudio: (fields: Partial<Clip['audio']>) => {
				if (selectedClip) engine.dispatch(ops.setClipAudio(engine.getDoc(), selectedClip.id, fields))
			},
			onText: (fields: Partial<TextStyle>) => {
				if (selectedClip) engine.dispatch(ops.setTextStyle(engine.getDoc(), selectedClip.id, fields))
			},
			onSpeed: (speed: number) => {
				if (selectedClip) engine.dispatch(ops.setClipSpeed(engine.getDoc(), selectedClip.id, speed))
			},
			onEffects: (fields: Partial<Clip['effects']>) => {
				if (selectedClip) engine.dispatch(ops.setClipEffects(engine.getDoc(), selectedClip.id, fields))
			},
			onCrop: (crop: CropRect | null) => {
				if (selectedClip) engine.dispatch(ops.setClipCrop(engine.getDoc(), selectedClip.id, crop))
			},
			onChromaKey: (chromaKey: ChromaKeySpec | null) => {
				if (selectedClip) engine.dispatch(ops.setChromaKey(engine.getDoc(), selectedClip.id, chromaKey))
			},
			onFreezeFrame: (freeze: boolean, atSourceSeconds?: number) => {
				if (selectedClip) engine.dispatch(ops.setFreezeFrame(engine.getDoc(), selectedClip.id, freeze, atSourceSeconds))
			},
		}),
		[engine, selectedClip],
	)

	/** Where the playhead currently sits inside the selected clip's own source, in seconds - what "freeze on this frame" captures. */
	const currentSourceSeconds = useMemo(() => {
		if (!selectedClip || selectedClip.kind !== 'video') return 0
		return selectedClip.sourceInSeconds + ((ui.playheadFrame - selectedClip.startFrame) / doc.settings.fps) * selectedClip.speed
	}, [doc.settings.fps, selectedClip, ui.playheadFrame])

	/* --------------------------------------------------------------- keys */

	const shortcutState = useRef({ doc, ui, playing })
	shortcutState.current = { doc, ui, playing }

	useEffect(() => {
		function onKeyDown(event: KeyboardEvent) {
			const target = event.target as HTMLElement | null
			if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
			const { playing: isPlaying } = shortcutState.current
			const meta = event.ctrlKey || event.metaKey

			if (event.code === 'Space') {
				event.preventDefault()
				if (isPlaying) playerRef.current?.pause()
				else playerRef.current?.play()
			} else if (event.key === 'ArrowLeft') {
				event.preventDefault()
				stepFrame(event.shiftKey ? -5 : -1)
			} else if (event.key === 'ArrowRight') {
				event.preventDefault()
				stepFrame(event.shiftKey ? 5 : 1)
			} else if (event.key === 'Home') {
				handleSeek(0)
			} else if (event.key === 'End') {
				handleSeek(projectDurationFrames(shortcutState.current.doc))
			} else if (meta && event.key.toLowerCase() === 'z' && !event.shiftKey) {
				event.preventDefault()
				engine.undo()
			} else if (meta && (event.key.toLowerCase() === 'y' || (event.shiftKey && event.key.toLowerCase() === 'z'))) {
				event.preventDefault()
				engine.redo()
			} else if (meta && event.key.toLowerCase() === 's') {
				event.preventDefault()
				void vault.saveNow()
			} else if (!meta && event.key.toLowerCase() === 's') {
				handleSplit()
			} else if (event.key === 'Delete' || event.key === 'Backspace') {
				handleDeleteSelected(event.altKey)
			}
		}
		window.addEventListener('keydown', onKeyDown)
		return () => window.removeEventListener('keydown', onKeyDown)
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [])

	/* ------------------------------------------------------------- export */

	const handleStartExport = useCallback(async () => {
		setExportError(null)
		setExportResult(null)
		setExportRendering(true)
		const controller = new AbortController()
		exportAbortRef.current = controller
		try {
			const result = await renderEditorExport(engine.getDoc(), poolRef.current, resolveBlob, { ...exportSettings, signal: controller.signal }, setExportProgress)
			setExportResult(result)
		} catch (error) {
			if (!(error instanceof ExportCancelled)) setExportError(error instanceof Error ? error.message : 'Export failed.')
		} finally {
			setExportRendering(false)
			exportAbortRef.current = null
		}
	}, [engine, exportSettings, resolveBlob])

	/**
	 * A browser can only ever "download" a file - into whatever folder the OS
	 * picked once, years ago, with no format/location choice per-save. Native
	 * gets the real thing: an OS save dialog and an unrestricted filesystem
	 * write, which is exactly the kind of native-shell upgrade `isTauriNative()`
	 * exists for (see `lib/device.ts`). Falls back to the browser path if the
	 * native dialog throws for any reason, so a save is never a dead end.
	 */
	const handleDownloadExport = useCallback(async () => {
		if (!exportResult) return
		const filename = `${doc.name || 'export'}.${exportResult.format}`
		if (isTauriNative()) {
			try {
				const [{ save }, { writeFile }] = await Promise.all([import('@tauri-apps/plugin-dialog'), import('@tauri-apps/plugin-fs')])
				const path = await save({ defaultPath: filename, filters: [{ name: exportResult.format.toUpperCase(), extensions: [exportResult.format] }] })
				if (path === null) return // the user cancelled the dialog - not an error
				const bytes = new Uint8Array(await exportResult.blob.arrayBuffer())
				await writeFile(path, bytes)
				return
			} catch (error) {
				setExportError(error instanceof Error ? `Native save failed: ${error.message}` : 'Native save failed.')
				// fall through to the browser download path below as a backstop
			}
		}
		const anchor = document.createElement('a')
		anchor.href = exportResult.url
		anchor.download = filename
		document.body.appendChild(anchor)
		anchor.click()
		anchor.remove()
	}, [doc.name, exportResult])

	const handleReset = useCallback(() => {
		if (!window.confirm('Start a new project? This clears the current one from this browser.')) return
		void vault.forget()
		void poolRef.current.disposeAll()
		blobsRef.current.clear()
		setThumbUrls((prev) => {
			for (const url of Object.values(prev)) URL.revokeObjectURL(url)
			return {}
		})
		engine.hydrate(createProject(), [], [])
		setUi(defaultUi())
	}, [engine, vault])

	/* ------------------------------------------------------------- render */

	const durationFrames = projectDurationFrames(doc)
	const durationLabel = `${formatSeconds(durationFrames / doc.settings.fps)} at ${doc.settings.fps}fps, ${doc.settings.width}×${doc.settings.height}`

	return (
		<div className="app editor-app">
			<EditorTopBar
				projectName={doc.name}
				save={{ status: vault.status, savedAt: vault.savedAt, error: vault.error }}
				canUndo={engine.canUndo()}
				canRedo={engine.canRedo()}
				onUndo={() => engine.undo()}
				onRedo={() => engine.redo()}
				onExport={() => setExportOpen(true)}
				onReset={handleReset}
				standalone={standalone}
			/>

			{restore.phase === 'restored' ? (
				<RestoreNotice updatedAt={restore.updatedAt} summary="Your last editing session was restored." onDiscard={handleReset} />
			) : null}
			{importError ? (
				<div className="notice notice--error" style={{ margin: '8px 16px' }}>
					<IconAlert size={13} /> {importError}
				</div>
			) : null}

			<div className="editor-workspace">
				<aside className="editor-rail editor-rail--left">
					<MediaPool
						assets={Object.values(doc.assets)}
						thumbUrls={thumbUrls}
						needsReconnect={needsReconnect}
						onImport={handleImport}
						onAddToTimeline={(id) => handleAddAssetToTimeline(id)}
						onRemoveAsset={handleRemoveAsset}
						onReconnect={handleReconnect}
						onDragStart={handleDragAssetStart}
						onDragMove={handleDragAssetMove}
						onDragEnd={handleDragAssetEnd}
					/>
					<button type="button" className="btn btn--sm editor-add-text-btn" onClick={handleAddTextClip}>
						+ Text clip
					</button>
				</aside>

				<div className="editor-center">
					<PreviewStage
						ref={canvasRef}
						doc={doc}
						frame={ui.playheadFrame}
						playing={playing}
						muted={muted}
						offlineCount={offlineIds.size}
						onPlayPause={handlePlayPause}
						onStepFrame={stepFrame}
						onJumpStart={() => handleSeek(0)}
						onJumpEnd={() => handleSeek(durationFrames)}
						onToggleMute={() => setMuted((m) => !m)}
						fitScale={1}
						onZoomIn={() => timelineHandlers.onZoom(Math.min(80, ui.zoom * 1.4))}
						onZoomOut={() => timelineHandlers.onZoom(Math.max(0.5, ui.zoom / 1.4))}
					/>
					<Timeline ref={timelineRef} doc={doc} ui={ui} fps={doc.settings.fps} handlers={timelineHandlers} dropPreview={dropPreview} />
				</div>

				<aside className="editor-rail editor-rail--right">
					<Inspector
						selectedClip={selectedClip}
						selectionCount={ui.selection.length}
						projectName={doc.name}
						settings={doc.settings}
						clipCount={Object.keys(doc.clips).length}
						currentSourceSeconds={currentSourceSeconds}
						{...inspectorHandlers}
					/>
				</aside>
			</div>

			{dragAssetId ? (
				<div ref={ghostRef} className="editor-drag-ghost" aria-hidden="true">
					{thumbUrls[dragAssetId] ? (
						// eslint-disable-next-line @next/next/no-img-element
						<img src={thumbUrls[dragAssetId]} alt="" />
					) : null}
					<span>{doc.assets[dragAssetId]?.name ?? 'Clip'}</span>
				</div>
			) : null}

			<ExportPanel
				open={exportOpen}
				settings={exportSettings}
				onSettings={(fields) => setExportSettings((prev) => ({ ...prev, ...fields }))}
				rendering={exportRendering}
				progress={exportProgress}
				result={exportResult}
				error={exportError}
				durationLabel={durationLabel}
				onStart={handleStartExport}
				onCancel={() => exportAbortRef.current?.abort()}
				onClose={() => {
					if (exportRendering) return
					setExportOpen(false)
					setExportResult(null)
					setExportError(null)
				}}
				onDownload={handleDownloadExport}
			/>
		</div>
	)
}
