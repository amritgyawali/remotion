'use client'

import { useEffect, useRef } from 'react'
import type { CaptionCue } from '../../lib/captions/types'
import { IconMerge, IconPlus, IconScissors, IconTrash } from '../Icons'

export function formatTimecode(ms: number): string {
	const clamped = Math.max(0, ms)
	const minutes = Math.floor(clamped / 60_000)
	const seconds = Math.floor((clamped % 60_000) / 1000)
	const hundredths = Math.floor((clamped % 1000) / 10)
	return `${minutes}:${String(seconds).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}`
}

/** Accepts "4", "4.25", "1:04.25" - whatever the editor feels like typing. */
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

export default function CueTrack({
	cues,
	currentMs,
	durationMs,
	disabled,
	onSeek,
	onUpdate,
	onSplit,
	onMerge,
	onDelete,
	onAdd,
	onShiftAll,
}: {
	cues: CaptionCue[]
	currentMs: number
	durationMs: number
	disabled: boolean
	onSeek: (ms: number) => void
	onUpdate: (id: string, patch: { text?: string; startMs?: number; endMs?: number }) => void
	onSplit: (id: string) => void
	onMerge: (id: string) => void
	onDelete: (id: string) => void
	onAdd: () => void
	onShiftAll: (deltaMs: number) => void
}) {
	const listRef = useRef<HTMLDivElement>(null)
	const activeCue = cues.find((cue) => currentMs >= cue.startMs && currentMs < cue.endMs) ?? null
	const activeId = activeCue?.id ?? null

	// Follow the playhead, but never fight a scroll the editor just made.
	useEffect(() => {
		if (!activeId || !listRef.current) return
		const row = listRef.current.querySelector<HTMLElement>(`[data-cue-id="${activeId}"]`)
		if (!row) return
		const list = listRef.current
		const top = row.offsetTop - list.offsetTop
		if (top < list.scrollTop || top + row.offsetHeight > list.scrollTop + list.clientHeight) {
			list.scrollTo({ top: top - list.clientHeight / 2 + row.offsetHeight / 2, behavior: 'smooth' })
		}
	}, [activeId])

	const safeDuration = Math.max(1, durationMs)

	return (
		<div className="cue-track">
			<div className="cue-track-bar">
				<span className="section-label" style={{ margin: 0 }}>
					Caption track
				</span>
				<span className="chip chip--static">{formatTimecode(currentMs)}</span>
				<div className="cue-track-spacer" />
				<div className="segmented cue-nudge" role="group" aria-label="Shift every caption">
					<button onClick={() => onShiftAll(-100)} disabled={disabled || cues.length === 0}>
						-0.1s
					</button>
					<button onClick={() => onShiftAll(100)} disabled={disabled || cues.length === 0}>
						+0.1s
					</button>
				</div>
				<button className="btn btn--sm" onClick={onAdd} disabled={disabled}>
					<IconPlus size={12} /> Add line
				</button>
			</div>

			<div
				className="cue-ruler"
				role="presentation"
				onClick={(event) => {
					const rect = event.currentTarget.getBoundingClientRect()
					const ratio = (event.clientX - rect.left) / Math.max(1, rect.width)
					onSeek(Math.round(ratio * safeDuration))
				}}
			>
				{cues.map((cue) => (
					<span
						key={cue.id}
						className="cue-block"
						data-active={cue.id === activeId}
						title={cue.text}
						style={{
							left: `${(cue.startMs / safeDuration) * 100}%`,
							width: `${Math.max(0.4, ((cue.endMs - cue.startMs) / safeDuration) * 100)}%`,
						}}
					/>
				))}
				<span
					className="cue-playhead"
					style={{ left: `${Math.min(100, (currentMs / safeDuration) * 100)}%` }}
				/>
			</div>

			<div className="cue-list" ref={listRef}>
				{cues.length === 0 ? (
					<p className="hint-text" style={{ padding: '10px 12px' }}>
						No captions yet. Generate, write or import a transcript on the left and the lines show
						up here, ready to edit.
					</p>
				) : (
					cues.map((cue, index) => (
						<div
							key={cue.id}
							className="cue-row"
							data-cue-id={cue.id}
							data-active={cue.id === activeId}
						>
							<button
								className="cue-index"
								title="Jump to this line"
								onClick={() => onSeek(cue.startMs)}
							>
								{index + 1}
							</button>

							<div className="cue-times">
								<input
									className="input input--time"
									defaultValue={formatTimecode(cue.startMs)}
									key={`start-${cue.id}-${cue.startMs}`}
									aria-label={`Start of line ${index + 1}`}
									disabled={disabled}
									onBlur={(event) =>
										onUpdate(cue.id, { startMs: parseTimecode(event.target.value, cue.startMs) })
									}
									onKeyDown={(event) => {
										if (event.key === 'Enter') event.currentTarget.blur()
									}}
								/>
								<span className="cue-times-dash">-</span>
								<input
									className="input input--time"
									defaultValue={formatTimecode(cue.endMs)}
									key={`end-${cue.id}-${cue.endMs}`}
									aria-label={`End of line ${index + 1}`}
									disabled={disabled}
									onBlur={(event) =>
										onUpdate(cue.id, { endMs: parseTimecode(event.target.value, cue.endMs) })
									}
									onKeyDown={(event) => {
										if (event.key === 'Enter') event.currentTarget.blur()
									}}
								/>
							</div>

							<input
								className="input cue-text"
								value={cue.text}
								disabled={disabled}
								aria-label={`Text of line ${index + 1}`}
								onChange={(event) => onUpdate(cue.id, { text: event.target.value })}
								onFocus={() => onSeek(cue.startMs)}
							/>

							<div className="cue-actions">
								<button
									className="btn btn--ghost btn--sm"
									title="Split this line in two"
									disabled={disabled || cue.tokens.length < 2}
									onClick={() => onSplit(cue.id)}
								>
									<IconScissors size={12} />
								</button>
								<button
									className="btn btn--ghost btn--sm"
									title="Merge with the next line"
									disabled={disabled || index === cues.length - 1}
									onClick={() => onMerge(cue.id)}
								>
									<IconMerge size={12} />
								</button>
								<button
									className="btn btn--ghost btn--sm"
									title="Delete this line"
									disabled={disabled}
									onClick={() => onDelete(cue.id)}
								>
									<IconTrash size={12} />
								</button>
							</div>
						</div>
					))
				)}
			</div>
		</div>
	)
}
