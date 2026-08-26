'use client'

/**
 * The multi-track timeline: a canvas ruler + track lanes, virtualised by
 * hand - the canvas is only ever the size of the viewport, and `ui.scrollFrame`
 * plus `ui.zoom` (pixels per frame) decide what window of the project it
 * currently shows. That is what keeps a two-hour, 500-clip project exactly as
 * cheap to draw as a five-second one (§6.5 of the blueprint): the number of
 * DOM nodes never grows with the project, and the number of canvas draw calls
 * only grows with what is on screen.
 *
 * Track headers (name, mute/lock/hide) are ordinary DOM buttons in a fixed
 * left rail, not drawn on the canvas - they need real hit targets, focus
 * rings and screen-reader labels, which a canvas cannot give them for free.
 */

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { IconEye, IconLock, IconPlus, IconTrash, IconVolume, IconVolumeOff } from '../Icons'
import { clipsOnTrack, snapCandidates } from '../../lib/editor/model'
import { findTrackOverlaps } from '../../lib/editor/compositor'
import type { Clip, ProjectDoc, Track, TrackKind, UiState } from '../../lib/editor/types'
import { clipEndFrame } from '../../lib/editor/types'

const RULER_HEIGHT = 28
const MARKER_HEIGHT = 16
const MIN_ZOOM = 0.5
const MAX_ZOOM = 80
const EDGE_PX = 7

type DragKind = 'move' | 'trim-in' | 'trim-out' | 'scrub' | 'marquee' | 'marker'

type DragState = {
	kind: DragKind
	clipId?: string
	markerId?: string
	pointerId: number
	startClientX: number
	startClientY: number
	originFrame: number
	originTrackId?: string
	originDuration?: number
	originSourceIn?: number
	moved: boolean
}

export type TimelineHandlers = {
	onSeek: (frame: number) => void
	onSelect: (ids: string[]) => void
	onZoom: (zoom: number, anchorFrame?: number) => void
	onScroll: (scrollFrame: number) => void
	onMoveClip: (clipId: string, startFrame: number, trackId: string) => void
	onTrimClip: (clipId: string, edge: 'in' | 'out', toFrame: number) => void
	onAddMarker: (frame: number) => void
	onMoveMarker: (id: string, frame: number) => void
	onRemoveMarker: (id: string) => void
	onAddTrack: (kind: TrackKind) => void
	onRemoveTrack: (id: string) => void
	onUpdateTrack: (id: string, fields: Partial<Track>) => void
	onDropAsset: (assetId: string, trackId: string, frame: number) => void
}

/** What's under a given screen point, right now - used both by the pointer-drag-from-media-pool drop logic and its live hover preview. Neither native HTML5 drag-and-drop nor its `dragstart`/`drop` events exist on touch, so this is deliberately plain geometry EditorStudio.tsx can call from its own pointer handlers instead. */
export type TimelineHandle = {
	hitTest: (clientX: number, clientY: number) => { trackId: string; frame: number } | null
}

/** Where a clip *would* land if the media-pool drag in progress were released right now - drawn as a ghost outline so touch users (who get no native drag affordance at all) can see the target before lifting their finger. */
export type DropPreview = { trackId: string; frame: number; durationFrames: number } | null

const TRACK_COLORS: Record<TrackKind, string> = { video: '#2c6bed', audio: '#17a08a', text: '#b4632f' }

function trackColor(kind: TrackKind, hidden: boolean): string {
	return hidden ? '#3c4150' : TRACK_COLORS[kind]
}

const Timeline = forwardRef<TimelineHandle, { doc: ProjectDoc; ui: UiState; fps: number; handlers: TimelineHandlers; dropPreview: DropPreview }>(function Timeline(
	{ doc, ui, fps, handlers, dropPreview },
	ref,
) {
	const canvasRef = useRef<HTMLCanvasElement>(null)
	const containerRef = useRef<HTMLDivElement>(null)
	const dragRef = useRef<DragState | null>(null)
	const [viewport, setViewport] = useState({ width: 800, height: 320 })

	useEffect(() => {
		const el = containerRef.current
		if (!el) return
		const observer = new ResizeObserver((entries) => {
			const entry = entries[0]
			if (!entry) return
			setViewport({ width: Math.round(entry.contentRect.width), height: Math.round(entry.contentRect.height) })
		})
		observer.observe(el)
		return () => observer.disconnect()
	}, [])

	const trackTops = useMemo(() => {
		const tops = new Map<string, number>()
		let y = RULER_HEIGHT + MARKER_HEIGHT
		for (const id of doc.trackOrder) {
			tops.set(id, y)
			y += (doc.tracks[id]?.height ?? 56) + 2
		}
		return tops
	}, [doc.trackOrder, doc.tracks])

	const frameToX = useCallback((frame: number) => (frame - ui.scrollFrame) * ui.zoom, [ui.scrollFrame, ui.zoom])
	const xToFrame = useCallback((x: number) => ui.scrollFrame + x / ui.zoom, [ui.scrollFrame, ui.zoom])

	const trackAtY = useCallback(
		(y: number): string | null => {
			for (const id of doc.trackOrder) {
				const top = trackTops.get(id) ?? 0
				const height = doc.tracks[id]?.height ?? 56
				if (y >= top && y < top + height) return id
			}
			return null
		},
		[doc.trackOrder, doc.tracks, trackTops],
	)

	useImperativeHandle(
		ref,
		() => ({
			hitTest(clientX: number, clientY: number) {
				const canvas = canvasRef.current
				if (!canvas) return null
				const rect = canvas.getBoundingClientRect()
				const x = clientX - rect.left
				const y = clientY - rect.top
				if (x < 0 || y < RULER_HEIGHT + MARKER_HEIGHT || x > rect.width || y > rect.height) return null
				const trackId = trackAtY(y)
				if (!trackId) return null
				return { trackId, frame: Math.max(0, Math.round(xToFrame(x))) }
			},
		}),
		[trackAtY, xToFrame],
	)

	const clipAt = useCallback(
		(trackId: string, frame: number): Clip | null => {
			// Later-starting clips paint over earlier ones in an overlap (the
			// crossfade zone), so hit-testing walks back-to-front too - clicking
			// there must select whichever clip is actually on top.
			const clips = clipsOnTrack(doc, trackId)
			for (let i = clips.length - 1; i >= 0; i--) {
				const clip = clips[i]
				if (frame >= clip.startFrame && frame < clipEndFrame(clip)) return clip
			}
			return null
		},
		[doc],
	)

	/* --------------------------------------------------------------- draw */

	const draw = useCallback(() => {
		const canvas = canvasRef.current
		if (!canvas) return
		const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
		const width = viewport.width
		const height = viewport.height
		if (canvas.width !== Math.round(width * dpr)) canvas.width = Math.round(width * dpr)
		if (canvas.height !== Math.round(height * dpr)) canvas.height = Math.round(height * dpr)
		canvas.style.width = `${width}px`
		canvas.style.height = `${height}px`
		const ctx = canvas.getContext('2d')
		if (!ctx) return
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

		const style = getComputedStyle(canvas)
		const colors = {
			bg: style.getPropertyValue('--surface').trim() || '#0e1017',
			lane: style.getPropertyValue('--raised').trim() || '#232838',
			border: style.getPropertyValue('--border').trim() || 'rgba(255,255,255,0.07)',
			text: style.getPropertyValue('--text').trim() || '#f4f5f9',
			textDim: style.getPropertyValue('--text-secondary').trim() || 'rgba(244,245,249,0.66)',
			accent: style.getPropertyValue('--accent').trim() || '#7d7cff',
		}

		ctx.fillStyle = colors.bg
		ctx.fillRect(0, 0, width, height)

		// Ruler.
		ctx.fillStyle = colors.lane
		ctx.fillRect(0, 0, width, RULER_HEIGHT)
		ctx.strokeStyle = colors.border
		ctx.beginPath()
		ctx.moveTo(0, RULER_HEIGHT + 0.5)
		ctx.lineTo(width, RULER_HEIGHT + 0.5)
		ctx.stroke()

		const step = niceFrameStep(ui.zoom, fps)
		const firstTick = Math.floor(ui.scrollFrame / step) * step
		ctx.fillStyle = colors.textDim
		ctx.font = '11px Inter, sans-serif'
		ctx.textBaseline = 'middle'
		for (let frame = firstTick; frame < ui.scrollFrame + width / ui.zoom + step; frame += step) {
			const x = frameToX(frame)
			ctx.strokeStyle = colors.border
			ctx.beginPath()
			ctx.moveTo(x + 0.5, RULER_HEIGHT - 8)
			ctx.lineTo(x + 0.5, RULER_HEIGHT)
			ctx.stroke()
			ctx.fillText(timecodeLabel(frame, fps), x + 4, RULER_HEIGHT - 12)
		}

		// Markers.
		for (const marker of doc.markers) {
			const x = frameToX(marker.frame)
			if (x < -20 || x > width + 20) continue
			ctx.fillStyle = marker.color
			ctx.beginPath()
			ctx.moveTo(x, RULER_HEIGHT)
			ctx.lineTo(x + 5, RULER_HEIGHT + MARKER_HEIGHT / 2)
			ctx.lineTo(x, RULER_HEIGHT + MARKER_HEIGHT)
			ctx.lineTo(x - 5, RULER_HEIGHT + MARKER_HEIGHT / 2)
			ctx.closePath()
			ctx.fill()
		}

		// Tracks + clips.
		for (const trackId of doc.trackOrder) {
			const track = doc.tracks[trackId]
			if (!track) continue
			const top = trackTops.get(trackId) ?? 0
			ctx.fillStyle = colors.lane
			ctx.fillRect(0, top, width, track.height)
			ctx.strokeStyle = colors.border
			ctx.beginPath()
			ctx.moveTo(0, top + track.height + 0.5)
			ctx.lineTo(width, top + track.height + 0.5)
			ctx.stroke()

			for (const clip of clipsOnTrack(doc, trackId)) {
				const x1 = frameToX(clip.startFrame)
				const x2 = frameToX(clipEndFrame(clip))
				if (x2 < 0 || x1 > width) continue
				const selected = ui.selection.includes(clip.id)
				const baseColor = trackColor(track.kind, track.hidden || !clip.enabled)
				ctx.fillStyle = baseColor
				ctx.globalAlpha = clip.enabled ? 1 : 0.45
				roundRect(ctx, Math.max(x1, 0), top + 3, Math.min(x2, width) - Math.max(x1, 0), track.height - 6, 5)
				ctx.fill()
				ctx.globalAlpha = 1
				if (selected) {
					ctx.strokeStyle = colors.accent
					ctx.lineWidth = 2
					roundRect(ctx, Math.max(x1, 1), top + 4, Math.min(x2, width - 1) - Math.max(x1, 1), track.height - 8, 4)
					ctx.stroke()
				}
				if (x2 - x1 > 26) {
					ctx.save()
					ctx.beginPath()
					ctx.rect(Math.max(x1, 0), top, Math.min(x2, width) - Math.max(x1, 0), track.height)
					ctx.clip()
					ctx.fillStyle = 'rgba(255,255,255,0.92)'
					ctx.font = '600 11px Inter, sans-serif'
					ctx.textBaseline = 'middle'
					ctx.fillText(clip.label, x1 + 8, top + track.height / 2, Math.max(10, x2 - x1 - 16))
					ctx.restore()
				}
			}

			if (track.kind === 'video') {
				for (const overlap of findTrackOverlaps(doc, trackId)) {
					const ox1 = Math.max(0, frameToX(overlap.startFrame))
					const ox2 = Math.min(width, frameToX(overlap.endFrame))
					if (ox2 <= ox1) continue
					ctx.save()
					ctx.beginPath()
					ctx.rect(ox1, top + 3, ox2 - ox1, track.height - 6)
					ctx.clip()
					ctx.fillStyle = 'rgba(255,255,255,0.16)'
					const stripe = 7
					for (let sx = ox1 - track.height; sx < ox2 + track.height; sx += stripe * 2) {
						ctx.beginPath()
						ctx.moveTo(sx, top + track.height)
						ctx.lineTo(sx + track.height, top)
						ctx.lineTo(sx + track.height + stripe, top)
						ctx.lineTo(sx + stripe, top + track.height)
						ctx.closePath()
						ctx.fill()
					}
					ctx.restore()
				}
			}
		}

		// Drop preview: where a clip dragged from the media pool would land if
		// released right now - the only affordance touch users get, since there
		// is no native drag cursor to look at on a phone.
		if (dropPreview) {
			const top = trackTops.get(dropPreview.trackId)
			const track = doc.tracks[dropPreview.trackId]
			if (top !== undefined && track) {
				const x1 = frameToX(dropPreview.frame)
				const x2 = frameToX(dropPreview.frame + dropPreview.durationFrames)
				ctx.save()
				ctx.setLineDash([6, 4])
				ctx.strokeStyle = colors.accent
				ctx.lineWidth = 2
				ctx.fillStyle = 'rgba(125,124,255,0.18)'
				roundRect(ctx, Math.max(x1, 0), top + 3, Math.min(x2, width) - Math.max(x1, 0), track.height - 6, 5)
				ctx.fill()
				ctx.stroke()
				ctx.restore()
			}
		}

		// Playhead.
		const playX = frameToX(ui.playheadFrame)
		if (playX >= -2 && playX <= width + 2) {
			ctx.strokeStyle = colors.accent
			ctx.lineWidth = 1.5
			ctx.beginPath()
			ctx.moveTo(playX + 0.5, 0)
			ctx.lineTo(playX + 0.5, height)
			ctx.stroke()
			ctx.fillStyle = colors.accent
			ctx.beginPath()
			ctx.moveTo(playX - 5, 0)
			ctx.lineTo(playX + 5, 0)
			ctx.lineTo(playX, 8)
			ctx.closePath()
			ctx.fill()
		}
	}, [doc, ui, fps, viewport, frameToX, trackTops, dropPreview])

	useEffect(() => {
		draw()
	}, [draw])

	/* ---------------------------------------------------------- pointer io */

	const onPointerDown = useCallback(
		(event: React.PointerEvent<HTMLCanvasElement>) => {
			const rect = event.currentTarget.getBoundingClientRect()
			const x = event.clientX - rect.left
			const y = event.clientY - rect.top
			const frame = Math.max(0, Math.round(xToFrame(x)))
			event.currentTarget.setPointerCapture(event.pointerId)

			if (y < RULER_HEIGHT) {
				handlers.onSeek(frame)
				dragRef.current = { kind: 'scrub', pointerId: event.pointerId, startClientX: event.clientX, startClientY: event.clientY, originFrame: frame, moved: false }
				return
			}
			if (y < RULER_HEIGHT + MARKER_HEIGHT) {
				const hit = doc.markers.find((m) => Math.abs(frameToX(m.frame) - x) < 6)
				if (hit) {
					dragRef.current = { kind: 'marker', markerId: hit.id, pointerId: event.pointerId, startClientX: event.clientX, startClientY: event.clientY, originFrame: hit.frame, moved: false }
				} else {
					handlers.onAddMarker(frame)
				}
				return
			}

			const trackId = trackAtY(y)
			if (!trackId) {
				handlers.onSelect([])
				return
			}
			const clip = clipAt(trackId, frame)
			if (!clip) {
				handlers.onSelect([])
				return
			}
			handlers.onSelect(event.shiftKey ? Array.from(new Set([...ui.selection, clip.id])) : [clip.id])
			if (clip.locked || doc.tracks[trackId]?.locked) return
			const x1 = frameToX(clip.startFrame)
			const x2 = frameToX(clipEndFrame(clip))
			const kind: DragKind = Math.abs(x - x1) <= EDGE_PX ? 'trim-in' : Math.abs(x - x2) <= EDGE_PX ? 'trim-out' : 'move'
			dragRef.current = {
				kind,
				clipId: clip.id,
				pointerId: event.pointerId,
				startClientX: event.clientX,
				startClientY: event.clientY,
				originFrame: clip.startFrame,
				originTrackId: clip.trackId,
				originDuration: clip.durationFrames,
				moved: false,
			}
		},
		[clipAt, doc.markers, frameToX, handlers, trackAtY, ui.selection, xToFrame],
	)

	const SNAP_TOLERANCE_PX = 8

	/** Nudges `frame` onto the nearest clip edge/playhead/marker within a pixel tolerance - hold Shift to disable. */
	const snapFrame = useCallback(
		(frame: number, excludeClipId: string | null, shiftHeld: boolean): number => {
			if (shiftHeld) return frame
			const toleranceFrames = SNAP_TOLERANCE_PX / ui.zoom
			let best = frame
			let bestDist = toleranceFrames
			for (const candidate of snapCandidates(doc, excludeClipId)) {
				const dist = Math.abs(candidate - frame)
				if (dist < bestDist) {
					bestDist = dist
					best = candidate
				}
			}
			return best
		},
		[doc, ui.zoom],
	)

	const onPointerMove = useCallback(
		(event: React.PointerEvent<HTMLCanvasElement>) => {
			const drag = dragRef.current
			if (!drag) return
			const rect = event.currentTarget.getBoundingClientRect()
			const x = event.clientX - rect.left
			const y = event.clientY - rect.top
			const dxFrames = Math.round((event.clientX - drag.startClientX) / ui.zoom)
			if (Math.abs(event.clientX - drag.startClientX) > 2 || Math.abs(event.clientY - drag.startClientY) > 2) drag.moved = true

			if (drag.kind === 'scrub') {
				handlers.onSeek(Math.max(0, Math.round(xToFrame(x))))
				return
			}
			if (drag.kind === 'marker' && drag.markerId) {
				handlers.onMoveMarker(drag.markerId, Math.max(0, drag.originFrame + dxFrames))
				return
			}
			if (!drag.clipId) return
			if (drag.kind === 'move') {
				const targetTrack = trackAtY(y) ?? drag.originTrackId ?? doc.clips[drag.clipId]?.trackId
				const duration = drag.originDuration ?? 0
				const rawStart = Math.max(0, drag.originFrame + dxFrames)
				// Snap whichever edge (start or end) lands closer to a candidate, then
				// carry that same correction over to the other edge.
				const snappedByStart = snapFrame(rawStart, drag.clipId, event.shiftKey)
				const snappedByEnd = snapFrame(rawStart + duration, drag.clipId, event.shiftKey) - duration
				const startFrame =
					Math.abs(snappedByStart - rawStart) <= Math.abs(snappedByEnd - rawStart) ? snappedByStart : snappedByEnd
				handlers.onMoveClip(drag.clipId, Math.max(0, startFrame), targetTrack ?? drag.originTrackId!)
			} else if (drag.kind === 'trim-in') {
				handlers.onTrimClip(drag.clipId, 'in', snapFrame(drag.originFrame + dxFrames, drag.clipId, event.shiftKey))
			} else if (drag.kind === 'trim-out') {
				const raw = drag.originFrame + (drag.originDuration ?? 0) + dxFrames
				handlers.onTrimClip(drag.clipId, 'out', snapFrame(raw, drag.clipId, event.shiftKey))
			}
		},
		[doc.clips, handlers, snapFrame, trackAtY, ui.zoom, xToFrame],
	)

	const onPointerUp = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
		if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
		dragRef.current = null
	}, [])

	const onWheel = useCallback(
		(event: React.WheelEvent<HTMLCanvasElement>) => {
			if (event.ctrlKey || event.metaKey) {
				event.preventDefault()
				const rect = event.currentTarget.getBoundingClientRect()
				const anchorFrame = xToFrame(event.clientX - rect.left)
				const factor = Math.exp(-event.deltaY * 0.0015)
				handlers.onZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, ui.zoom * factor)), anchorFrame)
				return
			}
			const delta = event.shiftKey ? event.deltaY : event.deltaX || event.deltaY
			handlers.onScroll(Math.max(0, ui.scrollFrame + delta / ui.zoom))
		},
		[handlers, ui.scrollFrame, ui.zoom, xToFrame],
	)

	/* -------------------------------------------------------------- render */

	return (
		<div className="editor-timeline">
			<div className="editor-timeline-headers">
				<div className="editor-timeline-headers-spacer" style={{ height: RULER_HEIGHT + MARKER_HEIGHT }} />
				{doc.trackOrder.map((trackId) => {
					const track = doc.tracks[trackId]
					if (!track) return null
					return (
						<div key={trackId} className="editor-track-header" style={{ height: track.height }} data-kind={track.kind}>
							<span className="editor-track-dot" style={{ background: trackColor(track.kind, false) }} />
							<span className="editor-track-name" title={track.name}>
								{track.name}
							</span>
							<span className="editor-track-actions">
								<button type="button" className="editor-track-btn" data-active={!track.hidden} title={track.hidden ? 'Hidden' : 'Visible'} onClick={() => handlers.onUpdateTrack(trackId, { hidden: !track.hidden })}>
									<IconEye size={12} />
								</button>
								<button type="button" className="editor-track-btn" data-active={!track.muted} title={track.muted ? 'Muted' : 'Sound on'} onClick={() => handlers.onUpdateTrack(trackId, { muted: !track.muted })}>
									{track.muted ? <IconVolumeOff size={12} /> : <IconVolume size={12} />}
								</button>
								<button type="button" className="editor-track-btn" data-active={track.locked} title={track.locked ? 'Locked' : 'Unlocked'} onClick={() => handlers.onUpdateTrack(trackId, { locked: !track.locked })}>
									<IconLock size={12} />
								</button>
								<button type="button" className="editor-track-btn" title="Remove track" onClick={() => handlers.onRemoveTrack(trackId)}>
									<IconTrash size={12} />
								</button>
							</span>
						</div>
					)
				})}
				<div className="editor-track-add">
					<button type="button" className="editor-track-btn" title="Add video track" onClick={() => handlers.onAddTrack('video')}>
						<IconPlus size={12} /> Video
					</button>
					<button type="button" className="editor-track-btn" title="Add text track" onClick={() => handlers.onAddTrack('text')}>
						<IconPlus size={12} /> Text
					</button>
					<button type="button" className="editor-track-btn" title="Add audio track" onClick={() => handlers.onAddTrack('audio')}>
						<IconPlus size={12} /> Audio
					</button>
				</div>
			</div>
			<div className="editor-timeline-canvas" ref={containerRef}>
				<canvas
					ref={canvasRef}
					role="application"
					aria-label="Timeline"
					onPointerDown={onPointerDown}
					onPointerMove={onPointerMove}
					onPointerUp={onPointerUp}
					onPointerCancel={onPointerUp}
					onWheel={onWheel}
				/>
			</div>
		</div>
	)
},
)

export default Timeline

/* ------------------------------------------------------------------ utils */

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
	const r = Math.min(radius, width / 2, height / 2)
	if (width <= 0 || height <= 0) return
	ctx.beginPath()
	ctx.moveTo(x + r, y)
	ctx.arcTo(x + width, y, x + width, y + height, r)
	ctx.arcTo(x + width, y + height, x, y + height, r)
	ctx.arcTo(x, y + height, x, y, r)
	ctx.arcTo(x, y, x + width, y, r)
	ctx.closePath()
}

function niceFrameStep(zoom: number, fps: number): number {
	const targetPx = 90
	const rawSeconds = targetPx / zoom / fps
	const steps = [1 / fps, 0.5, 1, 2, 5, 10, 30, 60, 120, 300, 600, 1800]
	for (const s of steps) if (s >= rawSeconds) return Math.max(1, Math.round(s * fps))
	return Math.round(3600 * fps)
}

function timecodeLabel(frame: number, fps: number): string {
	const totalSeconds = Math.floor(frame / fps)
	const h = Math.floor(totalSeconds / 3600)
	const m = Math.floor((totalSeconds % 3600) / 60)
	const s = totalSeconds % 60
	if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
	return `${m}:${String(s).padStart(2, '0')}`
}
