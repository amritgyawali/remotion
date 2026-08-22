'use client'

import { useMemo, useState } from 'react'
import { countMatches, suggestKeywords, type CaseMode, type FindReplaceOptions } from '../../lib/captions/tools'
import type { CaptionCue, CaptionStyle } from '../../lib/captions/types'
import {
	IconAlert,
	IconCheck,
	IconClock,
	IconCopy,
	IconInfo,
	IconScissors,
	IconSparkle,
	IconType,
	IconWand,
} from '../Icons'

export type ToolsActions = {
	onFindReplace: (options: FindReplaceOptions) => void
	onCase: (mode: CaseMode) => void
	onCleanPunctuation: () => void
	onSplitSpeakers: () => void
	onAlignToSpeech: () => void
	onStretch: (factor: number) => void
	onHoldGaps: (maxHoldMs: number) => void
	onSnapToFrames: () => void
	onSplitLong: (maxMs: number) => void
	onMergeShort: (minMs: number) => void
	onEmphasis: (words: string[]) => void
	onCopyStyle: () => void
	onPasteStyle: (json: string) => void
	onExportAss: () => void
}

/**
 * The bulk editor.
 *
 * Everything in this panel rewrites the whole cue list at once, so every action
 * goes through the studio's undo history rather than asking for confirmation -
 * the fastest way to try "what if every line were title case" is to do it and
 * press undo.
 */
export default function CaptionToolsPanel({
	cues,
	style,
	fps,
	disabled,
	aligning,
	lastAction,
	actions,
}: {
	cues: CaptionCue[]
	style: CaptionStyle
	fps: number
	disabled: boolean
	/** the align pass has to decode the audio first, which is not instant */
	aligning: boolean
	/** what the previous tool did, echoed back so a bulk edit is never silent */
	lastAction: string | null
	actions: ToolsActions
}) {
	const [find, setFind] = useState('')
	const [replace, setReplace] = useState('')
	const [caseSensitive, setCaseSensitive] = useState(false)
	const [wholeWord, setWholeWord] = useState(true)
	const [stretch, setStretch] = useState(1)
	const [holdMs, setHoldMs] = useState(220)
	const [maxCueSeconds, setMaxCueSeconds] = useState(4)
	const [minCueMs, setMinCueMs] = useState(700)
	const [styleJson, setStyleJson] = useState('')
	const [copied, setCopied] = useState(false)

	const options: FindReplaceOptions = { find, replace, caseSensitive, wholeWord }
	const matches = useMemo(
		() => (find ? countMatches(cues, options) : 0),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[cues, find, caseSensitive, wholeWord],
	)
	const keywords = useMemo(() => suggestKeywords(cues, 14), [cues])

	const totalWords = cues.reduce((sum, cue) => sum + cue.tokens.length, 0)
	const longest = cues.reduce((longestMs, cue) => Math.max(longestMs, cue.endMs - cue.startMs), 0)
	const shortest = cues.reduce(
		(shortestMs, cue) => Math.min(shortestMs, cue.endMs - cue.startMs),
		Number.MAX_SAFE_INTEGER,
	)

	if (cues.length === 0) {
		return (
			<div className="notice notice--info">
				<span className="notice-icon">
					<IconInfo size={14} />
				</span>
				<span>
					These tools work on a finished transcript. Generate, write or import one first and every
					bulk edit here becomes available.
				</span>
			</div>
		)
	}

	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
			<div className="chip-row">
				<span className="chip chip--static">{cues.length} cues</span>
				<span className="chip chip--static">{totalWords} words</span>
				<span className="chip chip--static">longest {(longest / 1000).toFixed(1)}s</span>
				<span className="chip chip--static">shortest {(shortest / 1000).toFixed(1)}s</span>
			</div>

			{lastAction ? (
				<div className="notice notice--info">
					<span className="notice-icon">
						<IconCheck size={14} />
					</span>
					<span>{lastAction} Undo is one press away if it was not what you wanted.</span>
				</div>
			) : null}

			<div>
				<h2 className="section-label">
					Find and replace
					<IconType size={12} />
				</h2>
				<div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
					<input
						className="input"
						placeholder="Find - a word, a name, a mis-heard term"
						value={find}
						disabled={disabled}
						onChange={(event) => setFind(event.target.value)}
					/>
					<input
						className="input"
						placeholder="Replace with"
						value={replace}
						disabled={disabled}
						onChange={(event) => setReplace(event.target.value)}
					/>
					<div className="chip-row">
						<button
							className="chip chip--button"
							data-active={caseSensitive}
							disabled={disabled}
							onClick={() => setCaseSensitive((current) => !current)}
						>
							Match case
						</button>
						<button
							className="chip chip--button"
							data-active={wholeWord}
							disabled={disabled}
							onClick={() => setWholeWord((current) => !current)}
						>
							Whole words
						</button>
						<span className="chip chip--static">
							{find ? `${matches} match${matches === 1 ? '' : 'es'}` : 'type to search'}
						</span>
					</div>
					<button
						className="btn btn--primary btn--block"
						disabled={disabled || matches === 0}
						onClick={() => actions.onFindReplace(options)}
					>
						<IconWand size={13} /> Replace {matches || ''}
					</button>
					<p className="hint-text" style={{ margin: 0 }}>
						A replacement that keeps the word count keeps every original word timing, so karaoke
						styles stay in sync down to the syllable.
					</p>
				</div>
			</div>

			<div>
				<h2 className="section-label">Rewrite the text</h2>
				<div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
					<div className="segmented segmented--wrap" role="group" aria-label="Letter case">
						{(
							[
								['sentence', 'Sentence case'],
								['title', 'Title Case'],
								['upper', 'UPPERCASE'],
								['lower', 'lowercase'],
							] as [CaseMode, string][]
						).map(([mode, label]) => (
							<button key={mode} disabled={disabled} onClick={() => actions.onCase(mode)}>
								{label}
							</button>
						))}
					</div>
					<p className="hint-text" style={{ margin: 0 }}>
						This rewrites the transcript itself, which is what the .srt and .vtt exports carry.
						The Design tab has a separate letter case that only changes how captions are drawn.
					</p>
					<div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
						<button className="btn btn--sm" disabled={disabled} onClick={actions.onCleanPunctuation}>
							<IconSparkle size={12} /> Tidy punctuation
						</button>
						<button className="btn btn--sm" disabled={disabled} onClick={actions.onSplitSpeakers}>
							<IconScissors size={12} /> Split "Name:" lines
						</button>
					</div>
					<p className="hint-text" style={{ margin: 0 }}>
						Tidying collapses double spaces, pulls punctuation back onto the word, turns three
						dots into an ellipsis and keeps the Devanagari danda attached.
					</p>
				</div>
			</div>

			<div>
				<h2 className="section-label">
					Emphasis
					<span className="badge badge--muted">{style.emphasisWords.length} on</span>
				</h2>
				<div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
					<p className="hint-text" style={{ margin: 0 }}>
						The words this transcript leans on. Tap one to paint it in the emphasis colour every
						time it is spoken.
					</p>
					<div className="chip-row">
						{keywords.map((keyword) => {
							const on = style.emphasisWords.includes(keyword.word)
							return (
								<button
									key={keyword.word}
									className="chip chip--button"
									data-active={on}
									disabled={disabled}
									onClick={() =>
										actions.onEmphasis(
											on
												? style.emphasisWords.filter((word) => word !== keyword.word)
												: [...style.emphasisWords, keyword.word],
										)
									}
								>
									{keyword.word} <span style={{ opacity: 0.6 }}>{keyword.count}</span>
								</button>
							)
						})}
					</div>
					{style.emphasisWords.length > 0 ? (
						<button className="btn btn--ghost btn--sm" disabled={disabled} onClick={() => actions.onEmphasis([])}>
							Clear all emphasis
						</button>
					) : null}
				</div>
			</div>

			<div>
				<h2 className="section-label">
					Timing
					<IconClock size={12} />
				</h2>
				<div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
					<div className="field">
						<button className="btn btn--sm" disabled={disabled || aligning} onClick={actions.onAlignToSpeech}>
							{aligning ? 'Listening to the audio...' : 'Align every line to the speech'}
						</button>
						<p className="field-hint">
							Reads the audio, finds where the voice actually is, and moves each word onto
							it - without changing a single line break. This is the fix for a transcript
							that reads correctly but runs ahead of or behind the speaker.
						</p>
					</div>

					<div className="field">
						<label className="field-label" htmlFor="tool-stretch">
							Speed correction
							<span className="field-value">{stretch.toFixed(3)}x</span>
						</label>
						<input
							id="tool-stretch"
							className="range"
							type="range"
							min={0.9}
							max={1.1}
							step={0.001}
							value={stretch}
							disabled={disabled}
							onChange={(event) => setStretch(Number(event.target.value))}
						/>
						<div style={{ display: 'flex', gap: 6 }}>
							<button
								className="btn btn--sm"
								disabled={disabled || stretch === 1}
								onClick={() => actions.onStretch(stretch)}
							>
								Apply to every timestamp
							</button>
							<button className="btn btn--ghost btn--sm" disabled={disabled} onClick={() => setStretch(1)}>
								Reset
							</button>
						</div>
						<p className="hint-text" style={{ margin: 0 }}>
							For a transcript that drifts further out of sync the longer the clip runs - usually
							a transcript timed against a differently-framed export.
						</p>
					</div>

					<div className="field">
						<label className="field-label" htmlFor="tool-hold">
							Hold through short pauses
							<span className="field-value">{holdMs} ms</span>
						</label>
						<input
							id="tool-hold"
							className="range"
							type="range"
							min={0}
							max={800}
							step={20}
							value={holdMs}
							disabled={disabled}
							onChange={(event) => setHoldMs(Number(event.target.value))}
						/>
						<button className="btn btn--sm" disabled={disabled} onClick={() => actions.onHoldGaps(holdMs)}>
							Extend into the silence
						</button>
						<p className="hint-text" style={{ margin: 0 }}>
							Only the end of a caption moves, never its start - so nothing loses sync and the
							captions stop blinking out between sentences.
						</p>
					</div>

					<div className="field">
						<label className="field-label" htmlFor="tool-split">
							Split cues longer than
							<span className="field-value">{maxCueSeconds}s</span>
						</label>
						<input
							id="tool-split"
							className="range"
							type="range"
							min={1.5}
							max={8}
							step={0.5}
							value={maxCueSeconds}
							disabled={disabled}
							onChange={(event) => setMaxCueSeconds(Number(event.target.value))}
						/>
						<button
							className="btn btn--sm"
							disabled={disabled}
							onClick={() => actions.onSplitLong(maxCueSeconds * 1000)}
						>
							<IconScissors size={12} /> Split the long ones
						</button>
					</div>

					<div className="field">
						<label className="field-label" htmlFor="tool-merge">
							Merge cues shorter than
							<span className="field-value">{minCueMs} ms</span>
						</label>
						<input
							id="tool-merge"
							className="range"
							type="range"
							min={200}
							max={1400}
							step={20}
							value={minCueMs}
							disabled={disabled}
							onChange={(event) => setMinCueMs(Number(event.target.value))}
						/>
						<button className="btn btn--sm" disabled={disabled} onClick={() => actions.onMergeShort(minCueMs)}>
							Fold the flashes into their neighbour
						</button>
					</div>

					<button className="btn btn--sm" disabled={disabled} onClick={actions.onSnapToFrames}>
						Snap every timestamp to {fps} fps frames
					</button>
				</div>
			</div>

			<div>
				<h2 className="section-label">Share the look</h2>
				<div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
					<div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
						<button
							className="btn btn--sm"
							disabled={disabled}
							onClick={() => {
								actions.onCopyStyle()
								setCopied(true)
								setTimeout(() => setCopied(false), 2000)
							}}
						>
							{copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
							{copied ? 'Copied' : 'Copy this style'}
						</button>
						<button className="btn btn--sm" disabled={disabled} onClick={actions.onExportAss}>
							Export styled .ass
						</button>
					</div>
					<p className="hint-text" style={{ margin: 0 }}>
						An .ass subtitle keeps the font, colours, outline, margins and per-word karaoke
						timing, so Premiere, Resolve, mpv, VLC and ffmpeg can burn the same look elsewhere.
					</p>
					<textarea
						className="input textarea"
						rows={3}
						placeholder="Paste a copied style here to apply it"
						value={styleJson}
						disabled={disabled}
						onChange={(event) => setStyleJson(event.target.value)}
					/>
					<button
						className="btn btn--sm"
						disabled={disabled || styleJson.trim().length === 0}
						onClick={() => {
							actions.onPasteStyle(styleJson)
							setStyleJson('')
						}}
					>
						Apply pasted style
					</button>
					{style.fill === 'gradient' && style.background !== 'none' ? (
						<div className="notice notice--warn">
							<span className="notice-icon">
								<IconAlert size={14} />
							</span>
							<span>
								A gradient fill on top of a solid backdrop loses contrast quickly. Drop the
								backdrop opacity, or switch the fill back to a solid colour.
							</span>
						</div>
					) : null}
				</div>
			</div>
		</div>
	)
}
