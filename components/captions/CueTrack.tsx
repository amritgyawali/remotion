'use client'

import {
	memo,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type CSSProperties,
	type PointerEvent as ReactPointerEvent,
} from 'react'
import type { CaptionCue } from '../../lib/captions/types'
import { hasDevanagariText } from '../../lib/captions/devanagari'
import ScriptInput, { type ScriptMode } from './ScriptInput'
import {
	IconClock,
	IconCopy,
	IconMerge,
	IconPlus,
	IconScissors,
	IconTrash,
} from '../Icons'

const MIN_ZOOM = 1
const MAX_ZOOM = 12
const DRAG_THRESHOLD_PX = 4
const SNAP_THRESHOLD_PX = 8

type CuePatch = { text?: string; startMs?: number; endMs?: number; overwrite?: boolean }
type DragMode = 'move' | 'start' | 'end'

type DragState = {
	id: string
	mode: DragMode
	pointerId: number
	originX: number
	originStartMs: number
	originEndMs: number
	previewStartMs: number
	previewEndMs: number
	playheadMs: number
	dragged: boolean
}

export function formatTimecode(ms: number): string {
	const clamped = Math.max(0, ms)
	const hours = Math.floor(clamped / 3_600_000)
	const minutes = Math.floor((clamped % 3_600_000) / 60_000)
	const seconds = Math.floor((clamped % 60_000) / 1000)
	const hundredths = Math.floor((clamped % 1000) / 10)
	const clock = `${String(minutes).padStart(hours > 0 ? 2 : 1, '0')}:${String(seconds).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}`
	return hours > 0 ? `${hours}:${clock}` : clock
}

/** Accepts "4", "4.25", "1:04.25" or "1:01:04.25". */
export function parseTimecode(input: string, fallbackMs: number): number {
	const value = input.trim()
	if (!value) return fallbackMs
	const parts = value.split(':')
	const seconds = Number(parts.pop())
	if (!Number.isFinite(seconds)) return fallbackMs
	const minutes = parts.length > 0 ? Number(parts.pop()) : 0
	const hours = parts.length > 0 ? Number(parts.pop()) : 0
	if (!Number.isFinite(minutes) || !Number.isFinite(hours)) return fallbackMs
	return Math.max(0, Math.round((hours * 3600 + minutes * 60 + seconds) * 1000))
}

function roundToFrame(ms: number, fps: number): number {
	return Math.round((Math.max(0, ms) * fps) / 1000) * (1000 / fps)
}

function getRulerInterval(durationMs: number, zoom: number): number {
	const visibleSeconds = durationMs / Math.max(1, zoom) / 1000
	const targetSeconds = visibleSeconds / 8
	const choices = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600]
	return (choices.find((choice) => choice >= targetSeconds) ?? 1200) * 1000
}

function closestSnap(value: number, targets: number[], thresholdMs: number) {
	let best = value
	let distance = thresholdMs + 1
	for (const target of targets) {
		const nextDistance = Math.abs(value - target)
		if (nextDistance <= thresholdMs && nextDistance < distance) {
			best = target
			distance = nextDistance
		}
	}
	return { value: best, snapped: distance <= thresholdMs }
}

function isTypingTarget(target: EventTarget | null): boolean {
	return (
		target instanceof HTMLInputElement ||
		target instanceof HTMLTextAreaElement ||
		(target instanceof HTMLElement && target.isContentEditable)
	)
}

const CueEditorRow = memo(function CueEditorRow({
	cue,
	index,
	active,
	selected,
	disabled,
	canMerge,
	scriptMode,
	onScriptMode,
	onSelect,
	onUpdate,
	onSplit,
	onMerge,
	onDuplicate,
	onDelete,
}: {
	cue: CaptionCue
	index: number
	active: boolean
	selected: boolean
	disabled: boolean
	canMerge: boolean
	/** which script this row types in - the timeline default, or its own override */
	scriptMode: ScriptMode
	onScriptMode: (id: string, mode: ScriptMode) => void
	onSelect: (cue: CaptionCue) => void
	onUpdate: (id: string, patch: CuePatch) => void
	onSplit: (id: string) => void
	onMerge: (id: string) => void
	onDuplicate: (id: string) => void
	onDelete: (id: string) => void
}) {
	return (
		<div
			className="cue-row cue-row--advanced"
			data-cue-id={cue.id}
			data-active={active}
			data-selected={selected}
			onMouseDown={() => onSelect(cue)}
		>
			<button className="cue-index" title="Select and jump to this caption" onClick={() => onSelect(cue)}>
				{index + 1}
			</button>

			<div className="cue-row-content">
				<ScriptInput
					value={cue.text}
					mode={scriptMode}
					disabled={disabled}
					ariaLabel={`Text of caption ${index + 1}`}
					onFocus={() => onSelect(cue)}
					onModeChange={(next) => onScriptMode(cue.id, next)}
					onCommit={(text) => onUpdate(cue.id, { text })}
				/>
				<div className="cue-times cue-times--advanced">
					<IconClock size={11} />
					<input
						className="input input--time"
						defaultValue={formatTimecode(cue.startMs)}
						key={`start-${cue.id}-${cue.startMs}`}
						aria-label={`Start of caption ${index + 1}`}
						disabled={disabled}
						onBlur={(event) =>
							onUpdate(cue.id, { startMs: parseTimecode(event.target.value, cue.startMs) })
						}
						onKeyDown={(event) => {
							if (event.key === 'Enter') event.currentTarget.blur()
						}}
					/>
					<span className="cue-times-dash">→</span>
					<input
						className="input input--time"
						defaultValue={formatTimecode(cue.endMs)}
						key={`end-${cue.id}-${cue.endMs}`}
						aria-label={`End of caption ${index + 1}`}
						disabled={disabled}
						onBlur={(event) =>
							onUpdate(cue.id, { endMs: parseTimecode(event.target.value, cue.endMs) })
						}
						onKeyDown={(event) => {
							if (event.key === 'Enter') event.currentTarget.blur()
						}}
					/>
					<span className="cue-duration">{((cue.endMs - cue.startMs) / 1000).toFixed(2)}s</span>
				</div>
			</div>

			<div className="cue-actions">
				<button
					className="btn btn--ghost btn--sm"
					title="Split caption"
					disabled={disabled || cue.tokens.length < 2}
					onClick={() => onSplit(cue.id)}
				>
					<IconScissors size={12} />
				</button>
				<button
					className="btn btn--ghost btn--sm"
					title="Duplicate caption"
					disabled={disabled}
					onClick={() => onDuplicate(cue.id)}
				>
					<IconCopy size={12} />
				</button>
				<button
					className="btn btn--ghost btn--sm"
					title="Merge with next caption"
					disabled={disabled || !canMerge}
					onClick={() => onMerge(cue.id)}
				>
					<IconMerge size={12} />
				</button>
				<button
					className="btn btn--ghost btn--sm cue-delete"
					title="Delete caption"
					disabled={disabled}
					onClick={() => onDelete(cue.id)}
				>
					<IconTrash size={12} />
				</button>
			</div>
		</div>
	)
})

export default function CueTrack({
	cues,
	currentMs,
	durationMs,
	fps,
	disabled,
	canUndo,
	canRedo,
	onSeek,
	onUpdate,
	onSplit,
	onMerge,
	onDuplicate,
	onDelete,
	onAdd,
	onShiftAll,
	onUndo,
	onRedo,
}: {
	cues: CaptionCue[]
	currentMs: number
	durationMs: number
	fps: number
	disabled: boolean
	canUndo: boolean
	canRedo: boolean
	onSeek: (ms: number) => void
	onUpdate: (id: string, patch: CuePatch) => void
	onSplit: (id: string, atMs?: number) => void
	onMerge: (id: string) => void
	onDuplicate: (id: string) => void
	onDelete: (id: string) => void
	onAdd: (atMs?: number) => void
	onShiftAll: (deltaMs: number) => void
	onUndo: () => void
	onRedo: () => void
}) {
	const listRef = useRef<HTMLDivElement>(null)
	const timelineRef = useRef<HTMLDivElement>(null)
	const scrollRef = useRef<HTMLDivElement>(null)
	const dragRef = useRef<DragState | null>(null)
	const suppressClickRef = useRef(false)
	const [selectedId, setSelectedId] = useState<string | null>(null)
	/**
	 * Which script the rows type in.
	 *
	 * The default follows the transcript rather than the interface: a Nepali
	 * caption list opens ready to type Nepali, an English one ready to type
	 * English, and a single row can disagree with both. `null` means the default
	 * has never been decided, so it can still follow the first transcript that
	 * arrives without overriding a choice the writer has already made.
	 */
	const [scriptMode, setScriptMode] = useState<ScriptMode | null>(null)
	const [scriptOverrides, setScriptOverrides] = useState<Record<string, ScriptMode>>({})
	const [drag, setDrag] = useState<DragState | null>(null)
	const [zoom, setZoom] = useState(1)
	const [snapping, setSnapping] = useState(true)
	const [followPlayhead, setFollowPlayhead] = useState(true)
	const [snapGuideMs, setSnapGuideMs] = useState<number | null>(null)

	const safeDuration = Math.max(1, durationMs)
	const frameMs = 1000 / Math.max(1, fps)
	const activeCue = cues.find((cue) => currentMs >= cue.startMs && currentMs < cue.endMs) ?? null
	const activeId = activeCue?.id ?? null
	const selectedCue = cues.find((cue) => cue.id === selectedId) ?? null

	/** What the transcript is written in, measured rather than assumed. */
	const looksNepali = useMemo(() => {
		let devanagari = 0
		let counted = 0
		for (const cue of cues) {
			for (const token of cue.tokens) {
				counted++
				if (hasDevanagariText(token.text)) devanagari++
			}
			if (counted > 200) break
		}
		return counted > 0 && devanagari / counted >= 0.3
	}, [cues])

	const effectiveMode: ScriptMode = scriptMode ?? (looksNepali ? 'ne' : 'en')

	const handleScriptMode = useCallback((id: string, mode: ScriptMode) => {
		setScriptOverrides((current) => ({ ...current, [id]: mode }))
	}, [])
	const rulerInterval = getRulerInterval(safeDuration, zoom)
	const rulerMarks = useMemo(() => {
		const marks: number[] = []
		for (let value = 0; value <= safeDuration; value += rulerInterval) marks.push(value)
		if (marks.at(-1) !== safeDuration) marks.push(safeDuration)
		return marks
	}, [rulerInterval, safeDuration])

	useEffect(() => {
		if (selectedId && !cues.some((cue) => cue.id === selectedId)) setSelectedId(null)
	}, [cues, selectedId])

	// Keep the active/selected caption visible without interrupting manual timeline edits.
	useEffect(() => {
		const focusId = selectedId ?? activeId
		if (!followPlayhead || !focusId || !listRef.current || dragRef.current) return
		const row = listRef.current.querySelector<HTMLElement>(`[data-cue-id="${focusId}"]`)
		if (!row) return
		const list = listRef.current
		const top = row.offsetTop - list.offsetTop
		if (top < list.scrollTop || top + row.offsetHeight > list.scrollTop + list.clientHeight) {
			list.scrollTo({ top: top - list.clientHeight / 2 + row.offsetHeight / 2, behavior: 'smooth' })
		}
	}, [activeId, followPlayhead, selectedId])

	useEffect(() => {
		if (!followPlayhead || !scrollRef.current || dragRef.current) return
		const scroller = scrollRef.current
		const playheadX = (currentMs / safeDuration) * scroller.scrollWidth
		const padding = Math.min(120, scroller.clientWidth * 0.18)
		if (playheadX < scroller.scrollLeft + padding) {
			scroller.scrollTo({ left: Math.max(0, playheadX - padding), behavior: 'smooth' })
		} else if (playheadX > scroller.scrollLeft + scroller.clientWidth - padding) {
			scroller.scrollTo({
				left: playheadX - scroller.clientWidth + padding,
				behavior: 'smooth',
			})
		}
	}, [currentMs, followPlayhead, safeDuration, zoom])

	const selectCue = useCallback(
		(cue: CaptionCue) => {
			setSelectedId(cue.id)
			onSeek(cue.startMs)
		},
		[onSeek],
	)

	const getTimelineMs = useCallback(
		(clientX: number) => {
			const rect = timelineRef.current?.getBoundingClientRect()
			if (!rect) return 0
			return Math.max(0, Math.min(safeDuration, ((clientX - rect.left) / rect.width) * safeDuration))
		},
		[safeDuration],
	)

	const beginCueDrag = useCallback(
		(event: ReactPointerEvent<HTMLElement>, cue: CaptionCue, mode: DragMode) => {
			if (disabled || event.button !== 0) return
			event.preventDefault()
			event.stopPropagation()
			event.currentTarget.setPointerCapture(event.pointerId)
			setSelectedId(cue.id)
			const next: DragState = {
				id: cue.id,
				mode,
				pointerId: event.pointerId,
				originX: event.clientX,
				originStartMs: cue.startMs,
				originEndMs: cue.endMs,
				previewStartMs: cue.startMs,
				previewEndMs: cue.endMs,
				playheadMs: currentMs,
				dragged: false,
			}
			dragRef.current = next
			setDrag(next)
		},
		[currentMs, disabled],
	)

	const moveCueDrag = useCallback(
		(event: ReactPointerEvent<HTMLElement>) => {
			event.stopPropagation()
			const current = dragRef.current
			const rect = timelineRef.current?.getBoundingClientRect()
			if (!current || !rect || current.pointerId !== event.pointerId) return
			const distancePx = event.clientX - current.originX
			const dragged = current.dragged || Math.abs(distancePx) >= DRAG_THRESHOLD_PX
			if (!dragged) return

			const cueIndex = cues.findIndex((cue) => cue.id === current.id)
			if (cueIndex < 0) return
			const cueDuration = current.originEndMs - current.originStartMs
			const minGap = frameMs
			const previousEnd = cueIndex > 0 ? cues[cueIndex - 1].endMs + minGap : 0
			const nextStart = cueIndex < cues.length - 1 ? cues[cueIndex + 1].startMs - minGap : safeDuration
			const deltaMs = (distancePx / rect.width) * safeDuration
			const snapTargets = [0, safeDuration, current.playheadMs]
			for (const cue of cues) {
				if (cue.id !== current.id) snapTargets.push(cue.startMs, cue.endMs)
			}
			const thresholdMs = (SNAP_THRESHOLD_PX / rect.width) * safeDuration
			let startMs = current.originStartMs
			let endMs = current.originEndMs
			let guide: number | null = null

			if (current.mode === 'move') {
				startMs = Math.max(0, Math.min(safeDuration - cueDuration, current.originStartMs + deltaMs))
				endMs = startMs + cueDuration
				if (snapping) {
					const startSnap = closestSnap(startMs, snapTargets, thresholdMs)
					const endSnap = closestSnap(endMs, snapTargets, thresholdMs)
					if (startSnap.snapped || endSnap.snapped) {
						const useStart = startSnap.snapped && (!endSnap.snapped || Math.abs(startSnap.value - startMs) <= Math.abs(endSnap.value - endMs))
						const snappedStart = useStart ? startSnap.value : endSnap.value - cueDuration
						startMs = Math.max(0, Math.min(safeDuration - cueDuration, snappedStart))
						endMs = startMs + cueDuration
						guide = useStart ? startMs : endMs
					}
				}
				startMs = Math.max(0, Math.min(safeDuration - cueDuration, roundToFrame(startMs, fps)))
				endMs = startMs + cueDuration
			} else if (current.mode === 'start') {
				startMs = Math.max(previousEnd, Math.min(current.originEndMs - frameMs, current.originStartMs + deltaMs))
				if (snapping) {
					const result = closestSnap(startMs, snapTargets, thresholdMs)
					startMs = Math.max(previousEnd, Math.min(current.originEndMs - frameMs, result.value))
					if (result.snapped) guide = startMs
				}
				startMs = Math.max(previousEnd, Math.min(current.originEndMs - frameMs, roundToFrame(startMs, fps)))
			} else {
				endMs = Math.max(current.originStartMs + frameMs, Math.min(nextStart, current.originEndMs + deltaMs))
				if (snapping) {
					const result = closestSnap(endMs, snapTargets, thresholdMs)
					endMs = Math.max(current.originStartMs + frameMs, Math.min(nextStart, result.value))
					if (result.snapped) guide = endMs
				}
				endMs = Math.max(current.originStartMs + frameMs, Math.min(nextStart, roundToFrame(endMs, fps)))
			}

			const next = { ...current, previewStartMs: startMs, previewEndMs: endMs, dragged: true }
			dragRef.current = next
			setDrag(next)
			setSnapGuideMs(guide)
		},
		[cues, fps, frameMs, safeDuration, snapping],
	)

	const finishCueDrag = useCallback(
		(event: ReactPointerEvent<HTMLElement>) => {
			event.stopPropagation()
			const current = dragRef.current
			if (!current || current.pointerId !== event.pointerId) return
			if (event.currentTarget.hasPointerCapture(event.pointerId)) {
				event.currentTarget.releasePointerCapture(event.pointerId)
			}
			dragRef.current = null
			setDrag(null)
			setSnapGuideMs(null)
			suppressClickRef.current = current.dragged
			if (current.dragged) {
				onUpdate(current.id, {
					startMs: Math.round(current.previewStartMs),
					endMs: Math.round(current.previewEndMs),
					overwrite: current.mode === 'move',
				})
			} else {
				onSeek(current.originStartMs)
			}
		},
		[onSeek, onUpdate],
	)

	const seekFromPointer = useCallback(
		(event: ReactPointerEvent<HTMLElement>) => {
			event.preventDefault()
			event.stopPropagation()
			event.currentTarget.setPointerCapture(event.pointerId)
			onSeek(roundToFrame(getTimelineMs(event.clientX), fps))
		},
		[fps, getTimelineMs, onSeek],
	)

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (isTypingTarget(event.target)) return
			const command = event.ctrlKey || event.metaKey
			if (command && event.key.toLowerCase() === 'z') {
				event.preventDefault()
				if (event.shiftKey) onRedo()
				else onUndo()
				return
			}
			if (command && event.key.toLowerCase() === 'y') {
				event.preventDefault()
				onRedo()
				return
			}
			if (!selectedCue || disabled) return
			if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
				event.preventDefault()
				const direction = event.key === 'ArrowLeft' ? -1 : 1
				const amount = frameMs * (event.shiftKey ? 10 : 1) * direction
				const index = cues.findIndex((cue) => cue.id === selectedCue.id)
				const duration = selectedCue.endMs - selectedCue.startMs
				const previousEnd = index > 0 ? cues[index - 1].endMs + frameMs : 0
				const nextStart = index < cues.length - 1 ? cues[index + 1].startMs - frameMs : safeDuration
				const startMs = Math.max(
					previousEnd,
					Math.min(nextStart - duration, selectedCue.startMs + amount),
				)
				onUpdate(selectedCue.id, {
					startMs,
					endMs: startMs + duration,
				})
			} else if (event.key.toLowerCase() === 's') {
				event.preventDefault()
				onSplit(selectedCue.id, currentMs)
			} else if (event.key === 'Delete' || event.key === 'Backspace') {
				event.preventDefault()
				onDelete(selectedCue.id)
			}
		}
		window.addEventListener('keydown', onKeyDown)
		return () => window.removeEventListener('keydown', onKeyDown)
	}, [cues, currentMs, disabled, frameMs, onDelete, onRedo, onSplit, onUndo, onUpdate, safeDuration, selectedCue])

	const clipStyle = (cue: CaptionCue): CSSProperties => {
		const preview = drag?.id === cue.id ? drag : null
		const startMs = preview?.previewStartMs ?? cue.startMs
		const endMs = preview?.previewEndMs ?? cue.endMs
		return {
			left: `${(startMs / safeDuration) * 100}%`,
			width: `${Math.max(0.08, ((endMs - startMs) / safeDuration) * 100)}%`,
		}
	}

	return (
		<section className="cue-track cue-track--advanced" aria-label="Advanced caption timeline">
			<div className="cue-track-bar cue-track-bar--advanced">
				<div className="cue-track-title">
					<span className="section-label">Caption timeline</span>
					<span className="chip chip--static">{formatTimecode(currentMs)}</span>
				</div>
				<div className="cue-track-spacer" />
				<div className="cue-history" role="group" aria-label="Caption history">
					<button className="btn btn--ghost btn--sm" onClick={onUndo} disabled={!canUndo} title="Undo (Ctrl/Cmd + Z)" aria-label="Undo caption edit">
						↶
					</button>
					<button className="btn btn--ghost btn--sm" onClick={onRedo} disabled={!canRedo} title="Redo (Ctrl/Cmd + Shift + Z)" aria-label="Redo caption edit">
						↷
					</button>
				</div>
				<button className="btn btn--sm btn--primary" onClick={() => onAdd(currentMs)} disabled={disabled}>
					<IconPlus size={12} /> Add at playhead
				</button>
			</div>

			<div className="cue-timeline-tools">
				<div className="segmented cue-nudge" role="group" aria-label="Shift every caption">
					<button onClick={() => onShiftAll(-100)} disabled={disabled || cues.length === 0} title="Shift all captions earlier">
						−0.1s
					</button>
					<button onClick={() => onShiftAll(100)} disabled={disabled || cues.length === 0} title="Shift all captions later">
						+0.1s
					</button>
				</div>
				<button className="cue-tool-toggle" data-active={snapping} onClick={() => setSnapping((value) => !value)} title="Snap clips to nearby edges and the playhead">
					<span aria-hidden>⌁</span> Snap
				</button>
				<button className="cue-tool-toggle" data-active={followPlayhead} onClick={() => setFollowPlayhead((value) => !value)} title="Keep the current caption visible">
					<span aria-hidden>◎</span> Follow
				</button>
				<div className="segmented cue-script" role="group" aria-label="Typing script for caption text">
					<button
						data-active={effectiveMode === 'en'}
						aria-pressed={effectiveMode === 'en'}
						onClick={() => {
							setScriptMode('en')
							setScriptOverrides({})
						}}
						title="Type caption text in English"
					>
						EN
					</button>
					<button
						data-active={effectiveMode === 'ne'}
						aria-pressed={effectiveMode === 'ne'}
						onClick={() => {
							setScriptMode('ne')
							setScriptOverrides({})
						}}
						title="Type caption text in Nepali - roman letters become Devanagari as you finish each word"
						className="devanagari"
					>
						नेपाली
					</button>
				</div>
				<div className="cue-zoom-control">
					<span>Zoom</span>
					<input
						type="range"
						min={MIN_ZOOM}
						max={MAX_ZOOM}
						step={0.25}
						value={zoom}
						onChange={(event) => setZoom(Number(event.target.value))}
						aria-label="Timeline zoom"
					/>
					<button onClick={() => setZoom(1)} disabled={zoom === 1}>Fit</button>
					<strong>{zoom.toFixed(zoom % 1 === 0 ? 0 : 1)}×</strong>
				</div>
			</div>

			<div className="cue-timeline-shell">
				<div
					className="cue-timeline-scroll"
					ref={scrollRef}
					onWheel={(event) => {
						if (!event.ctrlKey && !event.metaKey) return
						event.preventDefault()
						setZoom((value) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value + (event.deltaY < 0 ? 0.5 : -0.5))))
					}}
				>
					<div
						className="cue-timeline"
						ref={timelineRef}
						style={{ width: `${zoom * 100}%` }}
						onClick={(event) => {
							if (suppressClickRef.current) {
								suppressClickRef.current = false
								return
							}
							if (event.target !== event.currentTarget) return
							onSeek(roundToFrame(getTimelineMs(event.clientX), fps))
						}}
						onDoubleClick={(event) => {
							if (event.target !== event.currentTarget || disabled) return
							onAdd(roundToFrame(getTimelineMs(event.clientX), fps))
						}}
					>
						<div className="cue-ruler-labels" aria-hidden>
							{rulerMarks.map((mark) => (
								<span key={mark} style={{ left: `${(mark / safeDuration) * 100}%` }}>
									{formatTimecode(mark)}
								</span>
							))}
						</div>
						<span className="cue-lane-label" aria-hidden>CAPTIONS</span>
						{cues.map((cue, index) => {
							const preview = drag?.id === cue.id ? drag : null
							return (
								<div
									key={cue.id}
									className="cue-timeline-clip"
									data-active={cue.id === activeId}
									data-selected={cue.id === selectedId}
									data-dragging={preview?.dragged ?? false}
									style={clipStyle(cue)}
									title={`${formatTimecode(cue.startMs)} — ${formatTimecode(cue.endMs)}\nDrag to move · drag edges to trim`}
									onPointerDown={(event) => beginCueDrag(event, cue, 'move')}
									onPointerMove={moveCueDrag}
									onPointerUp={finishCueDrag}
									onPointerCancel={finishCueDrag}
								>
									<span
										className="cue-trim-handle cue-trim-handle--start"
										aria-hidden="true"
										onPointerDown={(event) => beginCueDrag(event, cue, 'start')}
										onPointerMove={moveCueDrag}
										onPointerUp={finishCueDrag}
										onPointerCancel={finishCueDrag}
									/>
									<span className="cue-clip-number">{index + 1}</span>
									<span className="cue-clip-text">{cue.text || 'Empty caption'}</span>
									<span className="cue-clip-duration">
										{(((preview?.previewEndMs ?? cue.endMs) - (preview?.previewStartMs ?? cue.startMs)) / 1000).toFixed(1)}s
									</span>
									<span
										className="cue-trim-handle cue-trim-handle--end"
										aria-hidden="true"
										onPointerDown={(event) => beginCueDrag(event, cue, 'end')}
										onPointerMove={moveCueDrag}
										onPointerUp={finishCueDrag}
										onPointerCancel={finishCueDrag}
									/>
								</div>
							)
						})}
						{snapGuideMs !== null ? (
							<span className="cue-snap-guide" style={{ left: `${(snapGuideMs / safeDuration) * 100}%` }} />
						) : null}
						<button
							className="cue-playhead cue-playhead--interactive"
							style={{ left: `${Math.min(100, (currentMs / safeDuration) * 100)}%` }}
							aria-label={`Playhead at ${formatTimecode(currentMs)}. Drag to seek.`}
							onPointerDown={seekFromPointer}
							onPointerMove={(event) => {
								if (event.currentTarget.hasPointerCapture(event.pointerId)) seekFromPointer(event)
							}}
							onPointerUp={(event) => {
								if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
							}}
						>
							<span />
						</button>
					</div>
				</div>
				<p className="cue-timeline-help">
					Drag to move (overlapping edges trim automatically) · drag white handles to trim · double-click empty space to add · Ctrl/Cmd + wheel to zoom
					{effectiveMode === 'ne' ? (
						<>
							{' '}
							· typing <strong>Nepali</strong>: roman letters become Devanagari when you finish a word
							(namaste → <span className="devanagari">नमस्ते</span>), CAPITALS stay English, Ctrl/Cmd +
							Space flips one line
						</>
					) : (
						<>
							{' '}
							· typing <strong>English</strong> · switch to <span className="devanagari">नेपाली</span>{' '}
							above, or press Ctrl/Cmd + Space inside a line
						</>
					)}
				</p>
			</div>

			{selectedCue ? (
				<div className="cue-selection-bar">
					<span><strong>Caption {cues.findIndex((cue) => cue.id === selectedCue.id) + 1}</strong> selected</span>
					<button onClick={() => onUpdate(selectedCue.id, { startMs: currentMs })} disabled={disabled || currentMs >= selectedCue.endMs - frameMs}>Set start here</button>
					<button onClick={() => onUpdate(selectedCue.id, { endMs: currentMs })} disabled={disabled || currentMs <= selectedCue.startMs + frameMs}>Set end here</button>
					<button onClick={() => onSplit(selectedCue.id, currentMs)} disabled={disabled || selectedCue.tokens.length < 2}>
						<IconScissors size={11} /> Split here
					</button>
					<button onClick={() => onDuplicate(selectedCue.id)} disabled={disabled}>
						<IconCopy size={11} /> Duplicate
					</button>
					<button className="cue-selection-delete" onClick={() => onDelete(selectedCue.id)} disabled={disabled}>
						<IconTrash size={11} /> Delete
					</button>
				</div>
			) : (
				<div className="cue-selection-bar cue-selection-bar--empty">
					Select a caption clip to edit it. Arrow keys move it by one frame; Shift + Arrow moves ten frames.
				</div>
			)}

			<div className="cue-list cue-list--advanced" ref={listRef}>
				{cues.length === 0 ? (
					<div className="cue-empty-state">
						<IconPlus size={18} />
						<p>No captions yet.</p>
						<span>Add one at the playhead, generate captions, or import a subtitle file.</span>
					</div>
				) : (
					cues.map((cue, index) => (
						<CueEditorRow
							key={cue.id}
							cue={cue}
							index={index}
							active={cue.id === activeId}
							selected={cue.id === selectedId}
							disabled={disabled}
							canMerge={index < cues.length - 1}
							scriptMode={scriptOverrides[cue.id] ?? effectiveMode}
							onScriptMode={handleScriptMode}
							onSelect={selectCue}
							onUpdate={onUpdate}
							onSplit={onSplit}
							onMerge={onMerge}
							onDuplicate={onDuplicate}
							onDelete={onDelete}
						/>
					))
				)}
			</div>
		</section>
	)
}
