'use client'

/**
 * The waveform, the plan drawn on top of it, and the finished length below.
 *
 * A silence cutter asks a person to trust a machine's opinion about which parts
 * of their own recording do not matter. The only way to earn that is to show
 * the evidence: the level the detector measured, the line it compared against,
 * every stretch it decided against, and - underneath - what the result actually
 * looks like once those stretches are gone. Everything on this canvas is a
 * measurement, nothing is decoration.
 *
 * Two canvases, deliberately. The waveform is expensive and changes only when
 * the data, the view or the plan changes; the playhead is cheap and changes
 * sixty times a second. Keeping them apart is the difference between a smooth
 * scrub and a tab that fans its laptop.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { poolLevels, type AudioAnalysis } from '../../lib/silence/analyze'
import {
	formatTimecode,
	gapsOf,
	sourceToOutput,
	type CutPlan,
	type GapSummary,
	type SilenceAction,
} from '../../lib/silence/plan'
import { IconGauge, IconScissors, IconVolume, IconZoomIn, IconZoomOut } from '../Icons'

/** Levels below this read as pure silence, above as full scale. */
const FLOOR_DB = -68
const CEILING_DB = -4

type Palette = {
	grid: string
	wave: string
	waveQuiet: string
	removeFill: string
	removeEdge: string
	speedFill: string
	speedEdge: string
	keepFill: string
	threshold: string
	playhead: string
	text: string
	selected: string
}

/**
 * Turns a CSS colour expression into something a canvas will actually accept.
 *
 * The design system is built out of `var()` and `color-mix()`, and a canvas
 * context understands neither - handing it one silently keeps the previous
 * fill, which is the worst kind of bug because the drawing still appears. So
 * each expression is resolved by the engine on a throwaway element first, and
 * what reaches the context is always a plain `rgb()`.
 */
function makeResolver(
	element: HTMLElement,
	probe: HTMLSpanElement,
): (expression: string, fallback: string) => string {
	probe.style.display = 'none'
	element.appendChild(probe)
	return (expression, fallback) => {
		probe.style.color = ''
		probe.style.color = expression
		const resolved = getComputedStyle(probe).color
		if (!resolved || resolved === 'rgba(0, 0, 0, 0)') {
			probe.style.color = fallback
			return getComputedStyle(probe).color || fallback
		}
		return resolved
	}
}

function readPalette(element: HTMLElement): Palette {
	const probe = document.createElement('span')
	const resolve = makeResolver(element, probe)
	const mix = (token: string, percent: number, fallback: string) =>
		resolve(`color-mix(in srgb, var(${token}) ${percent}%, transparent)`, fallback)

	const palette: Palette = {
		grid: mix('--border-strong', 70, 'rgba(255,255,255,0.14)'),
		wave: resolve('var(--accent)', '#7d7cff'),
		waveQuiet: mix('--text-tertiary', 55, 'rgba(160,160,180,0.5)'),
		removeFill: mix('--red', 13, 'rgba(255,107,107,0.13)'),
		removeEdge: mix('--red', 55, 'rgba(255,107,107,0.55)'),
		speedFill: mix('--orange', 13, 'rgba(255,180,84,0.13)'),
		speedEdge: mix('--orange', 55, 'rgba(255,180,84,0.55)'),
		keepFill: mix('--green', 9, 'rgba(62,207,142,0.09)'),
		threshold: mix('--green', 60, 'rgba(62,207,142,0.6)'),
		playhead: resolve('var(--text)', '#f4f5f9'),
		text: resolve('var(--text-tertiary)', 'rgba(160,160,180,0.6)'),
		selected: resolve('var(--accent)', '#7d7cff'),
	}

	// One probe served every lookup; it has no business outliving the read.
	probe.remove()
	return palette
}

/** A tick spacing that lands on a round number of seconds at this zoom. */
function tickStepMs(spanMs: number, width: number): number {
	const target = spanMs / Math.max(2, width / 90)
	const steps = [100, 250, 500, 1_000, 2_000, 5_000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000]
	for (const step of steps) if (step >= target) return step
	return 900_000
}

export default function SilenceTimeline({
	analysis,
	plan,
	sourceMs,
	selectedGap,
	sensitivityDb,
	onSeekSource,
	onSelectGap,
	onGapAction,
}: {
	analysis: AudioAnalysis | null
	plan: CutPlan
	/** playhead, in source milliseconds */
	sourceMs: number
	selectedGap: number | null
	sensitivityDb: number
	onSeekSource: (ms: number) => void
	onSelectGap: (key: number | null) => void
	onGapAction: (key: number, action: SilenceAction) => void
}) {
	const wrapRef = useRef<HTMLDivElement>(null)
	const waveRef = useRef<HTMLCanvasElement>(null)
	const headRef = useRef<HTMLCanvasElement>(null)
	const [size, setSize] = useState({ width: 0, height: 0 })
	const [themeTick, setThemeTick] = useState(0)
	const [view, setView] = useState({ startMs: 0, spanMs: 0 })
	const [hover, setHover] = useState<{ x: number; ms: number } | null>(null)

	const durationMs = plan.sourceDurationMs || analysis?.durationMs || 0
	const gaps = useMemo(() => gapsOf(plan), [plan])

	/* ------------------------------------------------------------- sizing */

	useEffect(() => {
		const element = wrapRef.current
		if (!element) return
		const observer = new ResizeObserver((entries) => {
			const box = entries[0]?.contentRect
			if (box) setSize({ width: Math.round(box.width), height: Math.round(box.height) })
		})
		observer.observe(element)
		return () => observer.disconnect()
	}, [])

	// A theme swap changes every colour on the canvas, and a canvas does not
	// inherit CSS - so the palette is re-read whenever the attribute flips.
	useEffect(() => {
		const observer = new MutationObserver(() => setThemeTick((tick) => tick + 1))
		observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
		return () => observer.disconnect()
	}, [])

	// The view starts fitted to the clip, and refits whenever a new clip lands.
	useEffect(() => {
		setView({ startMs: 0, spanMs: durationMs })
	}, [durationMs])

	const spanMs = view.spanMs > 0 ? Math.min(view.spanMs, durationMs) : durationMs
	const startMs = Math.max(0, Math.min(view.startMs, Math.max(0, durationMs - spanMs)))
	const zoom = durationMs > 0 && spanMs > 0 ? durationMs / spanMs : 1

	const msToX = useCallback(
		(ms: number) => ((ms - startMs) / Math.max(1, spanMs)) * size.width,
		[size.width, spanMs, startMs],
	)
	const xToMs = useCallback(
		(x: number) => startMs + (x / Math.max(1, size.width)) * spanMs,
		[size.width, spanMs, startMs],
	)

	const setZoom = useCallback(
		(next: number, anchorMs?: number) => {
			if (durationMs <= 0) return
			const clamped = Math.min(400, Math.max(1, next))
			const nextSpan = durationMs / clamped
			const anchor = anchorMs ?? startMs + spanMs / 2
			setView({
				startMs: Math.max(0, Math.min(durationMs - nextSpan, anchor - nextSpan / 2)),
				spanMs: nextSpan,
			})
		},
		[durationMs, spanMs, startMs],
	)

	// Keep the playhead on screen while the preview runs.
	useEffect(() => {
		if (zoom <= 1.01 || durationMs <= 0) return
		if (sourceMs >= startMs && sourceMs <= startMs + spanMs) return
		setView((current) => ({
			startMs: Math.max(0, Math.min(durationMs - spanMs, sourceMs - spanMs * 0.35)),
			spanMs: current.spanMs,
		}))
	}, [durationMs, sourceMs, spanMs, startMs, zoom])

	/* ------------------------------------------------------- the waveform */

	useEffect(() => {
		const canvas = waveRef.current
		const wrap = wrapRef.current
		if (!canvas || !wrap || size.width === 0 || size.height === 0) return

		const dpr = Math.min(3, window.devicePixelRatio || 1)
		canvas.width = Math.max(1, Math.round(size.width * dpr))
		canvas.height = Math.max(1, Math.round(size.height * dpr))
		const context = canvas.getContext('2d')
		if (!context) return
		context.setTransform(dpr, 0, 0, dpr, 0, 0)
		context.clearRect(0, 0, size.width, size.height)

		const palette = readPalette(wrap)
		const waveTop = 18
		const waveHeight = Math.max(20, size.height - waveTop - 26)
		const midline = waveTop + waveHeight / 2

		/* --- the plan, painted behind everything as bands ------------------ */
		for (const segment of plan.segments) {
			if (segment.kind !== 'silence') continue
			const left = msToX(segment.sourceStartMs)
			const right = msToX(segment.sourceEndMs)
			if (right < 0 || left > size.width) continue
			const width = Math.max(1, right - left)

			if (segment.mode === 'drop') {
				context.fillStyle = palette.removeFill
				context.fillRect(left, waveTop - 6, width, waveHeight + 12)
				context.strokeStyle = palette.removeEdge
				context.setLineDash([3, 3])
				context.lineWidth = 1
				context.beginPath()
				context.moveTo(left + 0.5, waveTop - 6)
				context.lineTo(left + 0.5, waveTop + waveHeight + 6)
				context.moveTo(right - 0.5, waveTop - 6)
				context.lineTo(right - 0.5, waveTop + waveHeight + 6)
				context.stroke()
				context.setLineDash([])
				continue
			}

			if (segment.mode === 'speed') {
				context.fillStyle = palette.speedFill
				context.fillRect(left, waveTop - 6, width, waveHeight + 12)
				// Chevrons, so a fast stretch is recognisable without the legend.
				context.strokeStyle = palette.speedEdge
				context.lineWidth = 1.4
				for (let x = left + 6; x < right - 4; x += 11) {
					context.beginPath()
					context.moveTo(x, midline - 5)
					context.lineTo(x + 4, midline)
					context.lineTo(x, midline + 5)
					context.stroke()
				}
				continue
			}

			context.fillStyle = palette.keepFill
			context.fillRect(left, waveTop - 6, width, waveHeight + 12)
		}

		/* --- selection ---------------------------------------------------- */
		if (selectedGap !== null) {
			const gap = gaps.find((entry) => entry.key === selectedGap)
			if (gap) {
				const left = msToX(gap.startMs)
				const right = msToX(gap.endMs)
				context.strokeStyle = palette.selected
				context.lineWidth = 1.5
				context.strokeRect(left, waveTop - 7, Math.max(2, right - left), waveHeight + 14)
			}
		}

		/* --- the levels themselves ---------------------------------------- */
		if (analysis) {
			const fromFrame = startMs / analysis.frameMs
			const toFrame = (startMs + spanMs) / analysis.frameMs
			const columns = Math.max(1, Math.round(size.width))
			const levels = poolLevels(analysis.frameDb, fromFrame, toFrame, columns)
			const scale = (db: number) =>
				Math.max(0, Math.min(1, (db - FLOOR_DB) / (CEILING_DB - FLOOR_DB)))

			context.fillStyle = palette.wave
			const quiet: number[] = []
			// Columns are drawn left to right and the gaps are sorted, so one
			// forward-only cursor answers "is this column inside a pause?" in
			// constant time instead of scanning every gap for every pixel.
			let cursor = 0
			for (let column = 0; column < columns; column++) {
				const ms = startMs + (column / columns) * spanMs
				while (cursor < gaps.length && gaps[cursor].endMs <= ms) cursor += 1
				const height = Math.max(1, scale(levels[column]) * waveHeight)
				const gap = gaps[cursor]
				if (gap && ms >= gap.startMs) {
					quiet.push(column)
					continue
				}
				context.fillRect(column, midline - height / 2, 1, height)
			}

			context.fillStyle = palette.waveQuiet
			for (const column of quiet) {
				const height = Math.max(1, scale(levels[column]) * waveHeight)
				context.fillRect(column, midline - height / 2, 1, height)
			}

			/* --- the line the detector is comparing against ----------------- */
			const thresholdDb = analysis.noiseFloorDb + sensitivityDb
			const y = midline - (scale(thresholdDb) * waveHeight) / 2
			context.strokeStyle = palette.threshold
			context.lineWidth = 1
			context.setLineDash([5, 4])
			context.beginPath()
			context.moveTo(0, y)
			context.lineTo(size.width, y)
			context.moveTo(0, midline + (midline - y))
			context.lineTo(size.width, midline + (midline - y))
			context.stroke()
			context.setLineDash([])
		}

		/* --- ruler --------------------------------------------------------- */
		const step = tickStepMs(spanMs, size.width)
		context.fillStyle = palette.text
		context.font = '10px ui-sans-serif, system-ui, sans-serif'
		context.textBaseline = 'top'
		context.strokeStyle = palette.grid
		context.lineWidth = 1
		for (let ms = Math.ceil(startMs / step) * step; ms <= startMs + spanMs; ms += step) {
			const x = Math.round(msToX(ms)) + 0.5
			context.beginPath()
			context.moveTo(x, 0)
			context.lineTo(x, 9)
			context.stroke()
			context.fillText(formatTimecode(ms), x + 4, 1)
		}

		/* --- the finished length, drawn underneath ------------------------- */
		const stripTop = waveTop + waveHeight + 10
		const stripHeight = 10
		context.fillStyle = palette.grid
		context.fillRect(0, stripTop, size.width, stripHeight)
		for (const segment of plan.segments) {
			if (segment.mode === 'drop') continue
			// The strip is drawn on the *output* clock: this is what makes the
			// squeeze visible rather than merely stated in a number above.
			const left = (segment.outputStartMs / Math.max(1, plan.outputDurationMs)) * size.width
			const right = (segment.outputEndMs / Math.max(1, plan.outputDurationMs)) * size.width
			context.fillStyle =
				segment.mode === 'speed'
					? palette.speedEdge
					: segment.kind === 'speech'
						? palette.wave
						: palette.waveQuiet
			context.fillRect(left, stripTop, Math.max(1, right - left), stripHeight)
		}
	}, [analysis, gaps, msToX, plan, selectedGap, sensitivityDb, size, spanMs, startMs, themeTick])

	/* ------------------------------------------------------- the playhead */

	useEffect(() => {
		const canvas = headRef.current
		const wrap = wrapRef.current
		if (!canvas || !wrap || size.width === 0 || size.height === 0) return

		const dpr = Math.min(3, window.devicePixelRatio || 1)
		if (canvas.width !== Math.round(size.width * dpr)) {
			canvas.width = Math.max(1, Math.round(size.width * dpr))
			canvas.height = Math.max(1, Math.round(size.height * dpr))
		}
		const context = canvas.getContext('2d')
		if (!context) return
		context.setTransform(dpr, 0, 0, dpr, 0, 0)
		context.clearRect(0, 0, size.width, size.height)

		const palette = readPalette(wrap)
		const x = Math.round(msToX(sourceMs)) + 0.5
		if (x >= -1 && x <= size.width + 1) {
			context.strokeStyle = palette.playhead
			context.lineWidth = 1.4
			context.beginPath()
			context.moveTo(x, 10)
			context.lineTo(x, size.height - 14)
			context.stroke()
			context.fillStyle = palette.playhead
			context.beginPath()
			context.moveTo(x - 4, 10)
			context.lineTo(x + 4, 10)
			context.lineTo(x, 15)
			context.closePath()
			context.fill()
		}

		// Where that same instant lands in the finished file.
		const mapped = sourceToOutput(plan, sourceMs)
		if (!mapped.dropped && plan.outputDurationMs > 0) {
			const outX =
				Math.round((mapped.outputMs / plan.outputDurationMs) * size.width) + 0.5
			context.fillStyle = palette.playhead
			context.fillRect(outX - 1, size.height - 16, 2, 12)
		}

		if (hover) {
			context.strokeStyle = palette.grid
			context.lineWidth = 1
			context.beginPath()
			context.moveTo(Math.round(hover.x) + 0.5, 10)
			context.lineTo(Math.round(hover.x) + 0.5, size.height - 14)
			context.stroke()
		}
	}, [hover, msToX, plan, size, sourceMs, themeTick])

	/* ---------------------------------------------------------- pointing */

	const gapAt = useCallback(
		(ms: number): GapSummary | null =>
			gaps.find((gap) => ms >= gap.startMs && ms < gap.endMs) ?? null,
		[gaps],
	)

	const handlePointerDown = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			const rect = event.currentTarget.getBoundingClientRect()
			const ms = xToMs(event.clientX - rect.left)
			const gap = gapAt(ms)
			onSelectGap(gap ? gap.key : null)
			onSeekSource(Math.max(0, Math.min(durationMs, ms)))
		},
		[durationMs, gapAt, onSeekSource, onSelectGap, xToMs],
	)

	const handleMove = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			const rect = event.currentTarget.getBoundingClientRect()
			const x = event.clientX - rect.left
			setHover({ x, ms: xToMs(x) })
		},
		[xToMs],
	)

	const handleWheel = useCallback(
		(event: React.WheelEvent<HTMLDivElement>) => {
			if (durationMs <= 0) return
			const rect = event.currentTarget.getBoundingClientRect()
			const anchor = xToMs(event.clientX - rect.left)
			if (event.ctrlKey || event.metaKey || event.shiftKey) {
				setZoom(zoom * (event.deltaY > 0 ? 0.82 : 1.22), anchor)
				return
			}
			const delta = (event.deltaX || event.deltaY) / 400
			setView({
				startMs: Math.max(0, Math.min(durationMs - spanMs, startMs + delta * spanMs)),
				spanMs,
			})
		},
		[durationMs, setZoom, spanMs, startMs, xToMs, zoom],
	)

	const selected = selectedGap === null ? null : gaps.find((gap) => gap.key === selectedGap) ?? null

	return (
		<div className="cut-timeline">
			<div className="cut-timeline-bar">
				<div className="cut-legend">
					<span className="cut-legend-item" data-kind="speech">
						speech
					</span>
					<span className="cut-legend-item" data-kind="remove">
						removed
					</span>
					<span className="cut-legend-item" data-kind="speed">
						fast
					</span>
					<span className="cut-legend-item" data-kind="keep">
						kept
					</span>
				</div>

				<div className="cut-timeline-tools">
					<span className="chip chip--static" title="Playhead, on the original clock">
						{formatTimecode(sourceMs)}
					</span>
					<button
						className="icon-btn"
						title="Zoom out"
						aria-label="Zoom out"
						disabled={zoom <= 1.01}
						onClick={() => setZoom(zoom / 1.8, sourceMs)}
					>
						<IconZoomOut size={13} />
					</button>
					<span className="chip chip--static" style={{ minWidth: 44, justifyContent: 'center' }}>
						{zoom < 10 ? zoom.toFixed(1) : Math.round(zoom)}x
					</span>
					<button
						className="icon-btn"
						title="Zoom in"
						aria-label="Zoom in"
						disabled={zoom >= 399}
						onClick={() => setZoom(zoom * 1.8, sourceMs)}
					>
						<IconZoomIn size={13} />
					</button>
					<button className="btn btn--ghost btn--sm" onClick={() => setZoom(1)} disabled={zoom <= 1.01}>
						Fit
					</button>
				</div>
			</div>

			<div
				ref={wrapRef}
				className="cut-canvas"
				role="slider"
				tabIndex={0}
				aria-label="Timeline"
				aria-valuemin={0}
				aria-valuemax={Math.round(durationMs)}
				aria-valuenow={Math.round(sourceMs)}
				aria-valuetext={formatTimecode(sourceMs)}
				onPointerDown={handlePointerDown}
				onPointerMove={handleMove}
				onPointerLeave={() => setHover(null)}
				onWheel={handleWheel}
				onKeyDown={(event) => {
					const step = event.shiftKey ? 5_000 : 1_000
					if (event.key === 'ArrowLeft') {
						event.preventDefault()
						onSeekSource(Math.max(0, sourceMs - step))
					}
					if (event.key === 'ArrowRight') {
						event.preventDefault()
						onSeekSource(Math.min(durationMs, sourceMs + step))
					}
				}}
			>
				<canvas ref={waveRef} className="cut-canvas-layer" style={{ width: '100%', height: '100%' }} />
				<canvas
					ref={headRef}
					className="cut-canvas-layer cut-canvas-layer--head"
					style={{ width: '100%', height: '100%' }}
				/>
				{hover ? (
					<span
						className="cut-hover"
						style={{ left: Math.min(Math.max(hover.x, 30), Math.max(30, size.width - 30)) }}
					>
						{formatTimecode(hover.ms)}
					</span>
				) : null}
				{!analysis ? <span className="cut-canvas-empty">The waveform appears once a clip is measured</span> : null}
			</div>

			<div className="cut-inspector" data-open={selected !== null}>
				{selected ? (
					<>
						<span className="cut-inspector-title">
							Pause at {formatTimecode(selected.startMs)}
							<em>{(selected.lengthMs / 1000).toFixed(2)}s long</em>
						</span>
						<div className="segmented segmented--sm" role="group" aria-label="What to do with this pause">
							<button
								data-active={selected.action === 'remove'}
								onClick={() => onGapAction(selected.key, 'remove')}
							>
								<IconScissors size={11} /> Remove
							</button>
							<button
								data-active={selected.action === 'speed'}
								onClick={() => onGapAction(selected.key, 'speed')}
							>
								<IconGauge size={11} /> Fast
							</button>
							<button
								data-active={selected.action === 'keep'}
								onClick={() => onGapAction(selected.key, 'keep')}
							>
								<IconVolume size={11} /> Keep
							</button>
						</div>
						<button className="btn btn--ghost btn--sm" onClick={() => onSelectGap(null)}>
							Done
						</button>
					</>
				) : (
					<span className="cut-inspector-hint">
						Click a shaded stretch to decide that one pause by hand. Scroll to pan, shift-scroll to
						zoom.
					</span>
				)}
			</div>
		</div>
	)
}
