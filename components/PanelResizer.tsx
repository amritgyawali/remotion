'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * The drag handle between a side rail and the preview.
 *
 * Every studio's rails are sized by the step you are on, which is right until
 * it is not: a long tool form wants more room than a preview does, and the one
 * width that suits a 1280px laptop is not the one that suits an ultrawide. This
 * is the escape hatch - grab the edge and set it yourself.
 *
 * It is a `separator`, which is what the role is for, and it is operated by
 * keyboard as well as pointer: a handle you can only drag is a handle a good
 * number of people cannot use at all. Arrow keys move it a step, Shift makes
 * the step large, Home and End go to the limits, and Enter or a double-click
 * hands the width back to the stylesheet.
 *
 * The width is written to the workspace as a custom property rather than to the
 * panel, because the panels are grid columns: the grid has to be told, not the
 * child. Each step's rule keeps its own default in the `var()` fallback, so a
 * rail the user has never touched still narrows and widens per step, and one
 * they have set stays where they put it.
 */

/** How far the handle moves per key press, and per press with Shift held. */
const STEP = 16
const BIG_STEP = 64

export type PanelSide = 'left' | 'right'

export default function PanelResizer({
	side,
	storageKey,
	min = 240,
	max = 720,
	label,
}: {
	side: PanelSide
	/** Distinguishes one studio's rails from another's in storage. */
	storageKey: string
	min?: number
	max?: number
	label: string
}) {
	const handleRef = useRef<HTMLDivElement>(null)
	const [width, setWidth] = useState<number | null>(null)
	/** Where the handle sits, measured from the rail it belongs to. */
	const [offset, setOffset] = useState<number | null>(null)
	const [dragging, setDragging] = useState(false)

	const property = side === 'left' ? '--rail-left' : '--rail-right'
	// The editor lays its rails out in its own grid with its own class names;
	// everything else shares the studio workspace. Both are named here so the
	// handle does not need to be told which kind of page it is on.
	const panelSelector =
		side === 'left' ? '.panel--left, .editor-rail--left' : '.panel--right, .editor-rail--right'
	const memory = `studio:rail:${storageKey}:${side}`

	const workspace = useCallback(
		() => handleRef.current?.closest<HTMLElement>('.workspace, .editor-workspace') ?? null,
		[],
	)

	/** Writes the width to the grid, or hands the column back to the stylesheet. */
	const apply = useCallback(
		(next: number | null) => {
			const host = workspace()
			if (!host) return
			if (next === null) host.style.removeProperty(property)
			else host.style.setProperty(property, `${Math.round(next)}px`)
		},
		[property, workspace],
	)

	// A width the user set in an earlier visit, restored before first paint of
	// the rail rather than after, so the panel does not visibly jump.
	useEffect(() => {
		let saved: number | null = null
		try {
			const raw = window.localStorage.getItem(memory)
			const parsed = raw === null ? Number.NaN : Number(raw)
			if (Number.isFinite(parsed)) saved = Math.min(max, Math.max(min, parsed))
		} catch {
			// A browser refusing storage is not a reason to refuse the handle.
		}
		if (saved !== null) {
			setWidth(saved)
			apply(saved)
		}
	}, [apply, max, memory, min])

	/**
	 * Follows the rail's real edge.
	 *
	 * The handle cannot be a grid child - it would need a column of its own - so
	 * it is positioned over the workspace at whatever width the rail currently
	 * has. That width changes for reasons this component does not control: the
	 * step changed, the window resized, the rail was hidden entirely. Measuring
	 * it covers all three without knowing about any of them.
	 */
	useEffect(() => {
		const host = workspace()
		const panel = host?.querySelector<HTMLElement>(panelSelector)
		if (!host || !panel) {
			setOffset(null)
			return
		}

		const measure = () => {
			const hidden = getComputedStyle(panel).display === 'none'
			const rect = panel.getBoundingClientRect()
			if (hidden || rect.width === 0) {
				setOffset(null)
				return
			}
			setOffset(rect.width)
		}

		measure()
		const observer = new ResizeObserver(measure)
		observer.observe(panel)
		observer.observe(host)
		return () => observer.disconnect()
	}, [panelSelector, workspace])

	const commit = useCallback(
		(next: number | null) => {
			setWidth(next)
			apply(next)
			try {
				if (next === null) window.localStorage.removeItem(memory)
				else window.localStorage.setItem(memory, String(Math.round(next)))
			} catch {
				// The width still applies for this visit; only remembering it fails.
			}
		},
		[apply, memory],
	)

	/** The rail's width right now, whether the stylesheet or the user set it. */
	const current = useCallback((): number => {
		if (width !== null) return width
		const panel = workspace()?.querySelector<HTMLElement>(panelSelector)
		return panel ? panel.getBoundingClientRect().width : min
	}, [min, panelSelector, width, workspace])

	const onPointerDown = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			if (event.button !== 0) return
			event.preventDefault()
			const startX = event.clientX
			const startWidth = current()
			setDragging(true)
			event.currentTarget.setPointerCapture(event.pointerId)

			// The drag's own copy of the width. Reading it back out of state at
			// the end would race the last move, and writing storage from inside a
			// state updater would fire twice under StrictMode.
			let latest = startWidth

			const move = (moveEvent: PointerEvent) => {
				// A right-hand rail grows as the pointer travels left, so the delta
				// is signed by which edge of the window the rail is on.
				const delta = (moveEvent.clientX - startX) * (side === 'left' ? 1 : -1)
				latest = Math.min(max, Math.max(min, startWidth + delta))
				setWidth(latest)
				apply(latest)
			}
			const up = () => {
				setDragging(false)
				window.removeEventListener('pointermove', move)
				window.removeEventListener('pointerup', up)
				window.removeEventListener('pointercancel', up)
				// Only the resting width is worth remembering, not every frame of
				// the drag - one storage write per gesture.
				try {
					window.localStorage.setItem(memory, String(Math.round(latest)))
				} catch {
					/* remembering is optional */
				}
			}
			window.addEventListener('pointermove', move)
			window.addEventListener('pointerup', up)
			window.addEventListener('pointercancel', up)
		},
		[apply, current, max, memory, min, side],
	)

	const onKeyDown = useCallback(
		(event: React.KeyboardEvent<HTMLDivElement>) => {
			const step = event.shiftKey ? BIG_STEP : STEP
			// Left and right mean the same thing on screen whichever rail this is,
			// so a right-hand rail inverts them: pressing Left always makes the
			// preview wider, on both edges.
			const grow = side === 'left' ? 'ArrowRight' : 'ArrowLeft'
			const shrink = side === 'left' ? 'ArrowLeft' : 'ArrowRight'

			if (event.key === grow) {
				event.preventDefault()
				commit(Math.min(max, current() + step))
			} else if (event.key === shrink) {
				event.preventDefault()
				commit(Math.max(min, current() - step))
			} else if (event.key === 'Home') {
				event.preventDefault()
				commit(min)
			} else if (event.key === 'End') {
				event.preventDefault()
				commit(max)
			} else if (event.key === 'Enter' || event.key === 'Escape') {
				event.preventDefault()
				commit(null)
			}
		},
		[commit, current, max, min, side],
	)

	/*
	 * The element is always mounted, and hidden by an attribute when there is no
	 * rail beside it.
	 *
	 * Returning null instead is a deadlock: the ref below is what finds the
	 * workspace to measure, and a component that renders nothing never attaches
	 * its ref, so `offset` could never stop being null and the handle could
	 * never appear. Mounting it and hiding it in CSS lets the measurement run.
	 */
	const idle = offset === null
	const rounded = Math.round(width ?? offset ?? min)

	return (
		<div
			ref={handleRef}
			className="panel-resizer"
			data-side={side}
			data-idle={idle || undefined}
			data-dragging={dragging || undefined}
			style={idle ? undefined : side === 'left' ? { left: offset } : { right: offset }}
			role={idle ? undefined : 'separator'}
			aria-orientation={idle ? undefined : 'vertical'}
			aria-label={idle ? undefined : label}
			aria-valuenow={idle ? undefined : rounded}
			aria-valuemin={idle ? undefined : min}
			aria-valuemax={idle ? undefined : max}
			aria-valuetext={idle ? undefined : `${rounded} pixels`}
			aria-hidden={idle || undefined}
			tabIndex={idle ? -1 : 0}
			onPointerDown={idle ? undefined : onPointerDown}
			onKeyDown={idle ? undefined : onKeyDown}
			onDoubleClick={idle ? undefined : () => commit(null)}
			title={idle ? undefined : `${label}. Drag, or use the arrow keys. Enter restores the default width.`}
		>
			<span className="panel-resizer-grip" aria-hidden="true" />
		</div>
	)
}
