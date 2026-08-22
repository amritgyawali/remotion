'use client'

/**
 * A caption text field that can be typed in two scripts.
 *
 * Editing a Nepali transcript on a Latin keyboard is otherwise a dead end: the
 * writer either installs a system keyboard, or leaves the studio to paste from
 * somewhere else, or gives up and accepts whatever the recogniser wrote. The
 * field itself is the right place to fix that, because the alternative is
 * asking someone to switch tools in the middle of a line.
 *
 * In Nepali mode the writer types romanised Nepali and gets Devanagari:
 * "namaste" becomes नमस्ते, "banda" becomes बन्द. The conversion happens when a
 * word is finished - on a space, on punctuation, or on leaving the field -
 * never mid-word, because rewriting the text under someone's caret on every
 * keystroke is unusable. While a word is still being typed its Devanagari is
 * shown underneath as a preview, so there is no guessing.
 *
 * Code-switching is the point rather than an edge case. A word typed in
 * capitals - OTP, ATM, PIN - stays in Latin, Ctrl+Space flips the whole field
 * between scripts mid-sentence, and text that is already Devanagari is left
 * exactly as it is.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
	hasDevanagariText,
	trailingLatinRun,
	transliterateWord,
} from '../../lib/captions/devanagari'

export type ScriptMode = 'en' | 'ne'

/** Characters that end a word, and so trigger the conversion. */
const BOUNDARY = /[\s.,!?;:।॥"'`()[\]{}\-–—/\\]/

type ConversionResult = { text: string; delta: number } | null

/** Converts the Latin run that ends at `end`, leaving the rest untouched. */
function convertRunEndingAt(text: string, end: number): ConversionResult {
	const run = trailingLatinRun(text, end)
	if (!run) return null
	const source = text.slice(run.from, run.to)
	const converted = transliterateWord(source)
	if (converted === source) return null
	return {
		text: text.slice(0, run.from) + converted + text.slice(run.to),
		delta: converted.length - source.length,
	}
}

export default function ScriptInput({
	value,
	mode,
	disabled,
	ariaLabel,
	className,
	onCommit,
	onModeChange,
	onFocus,
}: {
	value: string
	mode: ScriptMode
	disabled: boolean
	ariaLabel: string
	className?: string
	/** called when the writer leaves the field or presses Enter */
	onCommit: (next: string) => void
	/** the field can flip its own script with Ctrl+Space or the chip */
	onModeChange: (mode: ScriptMode) => void
	onFocus?: () => void
}) {
	const inputRef = useRef<HTMLInputElement | null>(null)
	const [draft, setDraft] = useState(value)
	const [preview, setPreview] = useState('')
	const caretRef = useRef<number | null>(null)
	const composingRef = useRef(false)

	// The cue can be rewritten from outside - a bulk tool, an undo - and the
	// field has to follow it rather than hold a stale draft.
	useEffect(() => {
		setDraft(value)
		setPreview('')
	}, [value])

	// A conversion moves every character after the run, so the caret is put back
	// where the writer left it before the browser can paint the shifted text.
	useLayoutEffect(() => {
		const caret = caretRef.current
		caretRef.current = null
		if (caret === null) return
		const node = inputRef.current
		if (node) node.setSelectionRange(caret, caret)
	}, [draft])

	const updatePreview = useCallback(
		(text: string, caret: number, active: boolean) => {
			if (!active) {
				setPreview('')
				return
			}
			const run = trailingLatinRun(text, caret)
			if (!run) {
				setPreview('')
				return
			}
			const source = text.slice(run.from, run.to)
			const converted = transliterateWord(source)
			setPreview(converted === source ? '' : `${source} → ${converted}`)
		},
		[],
	)

	const handleChange = useCallback(
		(event: React.ChangeEvent<HTMLInputElement>) => {
			const next = event.target.value
			const caret = event.target.selectionStart ?? next.length

			if (mode !== 'ne' || composingRef.current) {
				setDraft(next)
				setPreview('')
				return
			}

			// A boundary character was just typed: the word before it is finished.
			const typed = caret > 0 ? next[caret - 1] : ''
			if (typed && BOUNDARY.test(typed)) {
				const converted = convertRunEndingAt(next, caret - 1)
				if (converted) {
					caretRef.current = caret + converted.delta
					setDraft(converted.text)
					setPreview('')
					return
				}
			}

			setDraft(next)
			updatePreview(next, caret, true)
		},
		[mode, updatePreview],
	)

	/** Finishes whatever word is still open, then hands the line back. */
	const commit = useCallback(() => {
		let text = draft
		if (mode === 'ne') {
			const converted = convertRunEndingAt(text, text.length)
			if (converted) text = converted.text
		}
		setPreview('')
		if (text !== draft) setDraft(text)
		if (text !== value) onCommit(text)
	}, [draft, mode, onCommit, value])

	const handleKeyDown = useCallback(
		(event: React.KeyboardEvent<HTMLInputElement>) => {
			// Ctrl+Space is the flip: it is what a bilingual writer reaches for
			// mid-sentence, and it never collides with typing a space.
			if (event.code === 'Space' && (event.ctrlKey || event.metaKey)) {
				event.preventDefault()
				onModeChange(mode === 'ne' ? 'en' : 'ne')
				return
			}
			if (event.key === 'Enter' && !event.shiftKey) {
				event.preventDefault()
				event.currentTarget.blur()
			}
		},
		[mode, onModeChange],
	)

	const devanagari = mode === 'ne' || hasDevanagariText(draft)

	return (
		<div className="script-input">
			<div className="script-input-row">
				<button
					type="button"
					className="script-chip"
					data-mode={mode}
					disabled={disabled}
					title={
						mode === 'ne'
							? 'Typing in Nepali - roman letters become Devanagari. Ctrl+Space for English.'
							: 'Typing in English. Ctrl+Space for Nepali.'
					}
					aria-label={mode === 'ne' ? 'Switch this line to English typing' : 'Switch this line to Nepali typing'}
					aria-pressed={mode === 'ne'}
					onClick={() => onModeChange(mode === 'ne' ? 'en' : 'ne')}
				>
					{mode === 'ne' ? 'ने' : 'EN'}
				</button>
				<input
					ref={inputRef}
					className={`input cue-text${devanagari ? ' devanagari' : ''}${className ? ` ${className}` : ''}`}
					value={draft}
					disabled={disabled}
					aria-label={ariaLabel}
					lang={devanagari ? 'ne' : 'en'}
					spellCheck={false}
					autoComplete="off"
					onFocus={onFocus}
					onChange={handleChange}
					onBlur={commit}
					onKeyDown={handleKeyDown}
					onCompositionStart={() => {
						composingRef.current = true
					}}
					onCompositionEnd={() => {
						composingRef.current = false
					}}
				/>
			</div>
			{preview ? (
				<span className="script-preview devanagari" aria-hidden>
					{preview}
				</span>
			) : null}
		</div>
	)
}
