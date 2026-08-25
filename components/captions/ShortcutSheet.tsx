'use client'

/**
 * The keyboard map, on demand.
 *
 * A subtitle pass is hundreds of small timing corrections, and the difference
 * between a toy and a tool is whether those corrections can be made without
 * reaching for the mouse. The shortcuts already exist - this is what makes them
 * discoverable, which is the half that usually goes missing.
 */

import { useEffect, useRef } from 'react'
import { IconClose, IconKeyboard } from '../Icons'

type Shortcut = { keys: string[]; label: string }

const GROUPS: Array<{ title: string; items: Shortcut[] }> = [
	{
		title: 'Playback',
		items: [
			{ keys: ['Space'], label: 'Play or pause the preview' },
			{ keys: ['J'], label: 'Jump to the previous caption' },
			{ keys: ['L'], label: 'Jump to the next caption' },
		],
	},
	{
		title: 'Captions',
		items: [
			{ keys: ['N'], label: 'New caption at the playhead' },
			{ keys: ['S'], label: 'Split the selected caption at the playhead' },
			{ keys: ['Left', 'Right'], label: 'Nudge the selected caption by one frame' },
			{ keys: ['Shift', 'Left/Right'], label: 'Nudge it by ten frames' },
			{ keys: ['Del'], label: 'Delete the selected caption' },
		],
	},
	{
		title: 'Workspace',
		items: [
			{ keys: ['1'], label: 'Open the Design panel' },
			{ keys: ['2'], label: 'Open the Sound panel' },
			{ keys: ['3'], label: 'Open the Tools panel' },
			{ keys: ['4'], label: 'Open the Render panel' },
			{ keys: ['Ctrl', 'Z'], label: 'Undo the last caption edit' },
			{ keys: ['Ctrl', 'Shift', 'Z'], label: 'Redo' },
			{ keys: ['Ctrl', 'S'], label: 'Save this session to the browser now' },
			{ keys: ['?'], label: 'Show or hide this sheet' },
		],
	},
]

export default function ShortcutSheet({ onClose }: { onClose: () => void }) {
	const closeRef = useRef<HTMLButtonElement>(null)

	useEffect(() => {
		const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
		closeRef.current?.focus()
		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape') onClose()
		}
		window.addEventListener('keydown', onKey)
		return () => {
			window.removeEventListener('keydown', onKey)
			previouslyFocused?.focus()
		}
	}, [onClose])

	return (
		<div className="shortcut-scrim" role="dialog" aria-modal="true" aria-labelledby="shortcut-sheet-title">
			<button type="button" className="shortcut-dismiss" aria-label="Close" onClick={onClose} />
			<div className="shortcut-sheet">
				<header>
					<span className="shortcut-sheet-mark">
						<IconKeyboard size={16} />
					</span>
					<div>
						<strong id="shortcut-sheet-title">Keyboard shortcuts</strong>
						<small>Everything below works while the timeline has focus.</small>
					</div>
					<button ref={closeRef} type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
						<IconClose size={14} />
					</button>
				</header>

				<div className="shortcut-grid">
					{GROUPS.map((group) => (
						<section key={group.title}>
							<h3>{group.title}</h3>
							<ul>
								{group.items.map((item) => (
									<li key={item.label}>
										<span>{item.label}</span>
										<kbd className="shortcut-keys">
											{item.keys.map((key) => (
												<b key={key}>{key}</b>
											))}
										</kbd>
									</li>
								))}
							</ul>
						</section>
					))}
				</div>
			</div>
		</div>
	)
}
