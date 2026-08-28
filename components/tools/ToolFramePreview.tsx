'use client'

/**
 * One frame, run through the real engine, before committing to the clip.
 *
 * The background remover and the colour grader are the two tools whose result
 * cannot be guessed from their controls, and both are also the two most
 * expensive to render - so getting them wrong costs the most and is the
 * easiest to do. A still costs one decode and one pass of the same shader the
 * export uses, which makes "is the edge right?" a two-second question instead
 * of a two-minute one.
 *
 * The frame is chosen with a scrubber rather than fixed at the start, because
 * the start of a clip is the least representative part of it: the subject is
 * often not in shot yet, and a matte that holds on a static opening frame can
 * still fall apart the moment anyone moves.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { CaptionVideoSource } from '../../lib/captions/types'
import type { ToolDef } from '../../lib/tools/registry'
import { previewTool, type RunParams, type RunProgress } from '../../lib/tools/runners'
import { formatSeconds } from '../../lib/format'
import { IconEye, IconSpinner } from '../Icons'

export default function ToolFramePreview({
	tool,
	params,
	probe,
	secondaryFile,
	disabled,
}: {
	tool: ToolDef
	params: RunParams
	probe: CaptionVideoSource | null
	secondaryFile: File | null
	disabled: boolean
}) {
	const [atSeconds, setAtSeconds] = useState(0)
	const [url, setUrl] = useState<string | null>(null)
	const [busy, setBusy] = useState(false)
	const [progress, setProgress] = useState<RunProgress | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [note, setNote] = useState<string | null>(null)
	const abortRef = useRef<AbortController | null>(null)
	const urlRef = useRef<string | null>(null)

	const duration = probe?.durationInSeconds ?? 0

	// A new clip invalidates whatever is on screen, and the object URL with it.
	useEffect(() => {
		setUrl((current) => {
			if (current) URL.revokeObjectURL(current)
			return null
		})
		setError(null)
		setNote(null)
		setAtSeconds(Math.min(1, duration / 3))
	}, [duration, probe?.name])

	useEffect(() => {
		urlRef.current = url
	}, [url])

	useEffect(
		() => () => {
			abortRef.current?.abort()
			if (urlRef.current) URL.revokeObjectURL(urlRef.current)
		},
		[],
	)

	const run = useCallback(async () => {
		const file = probe?.file
		if (!file || !probe) {
			setError('Load a clip first.')
			return
		}
		abortRef.current?.abort()
		const controller = new AbortController()
		abortRef.current = controller
		setBusy(true)
		setError(null)
		setNote(null)
		setProgress(null)
		try {
			const result = await previewTool(tool, {
				file,
				probe,
				params,
				secondaryFile,
				atSeconds,
				signal: controller.signal,
				onProgress: setProgress,
			})
			if (controller.signal.aborted) {
				URL.revokeObjectURL(result.url)
				return
			}
			setUrl((current) => {
				if (current) URL.revokeObjectURL(current)
				return result.url
			})
			setNote(result.note ?? null)
		} catch (caught) {
			if (!controller.signal.aborted) {
				setError(caught instanceof Error ? caught.message : String(caught))
			}
		} finally {
			if (abortRef.current === controller) {
				abortRef.current = null
				setBusy(false)
				setProgress(null)
			}
		}
	}, [atSeconds, params, probe, secondaryFile, tool])

	if (!probe) return null

	return (
		<div className="field" style={{ marginTop: 4 }}>
			<label className="field-label">
				<span>Preview one frame</span>
				<span className="field-value">{formatSeconds(atSeconds)}</span>
			</label>

			<input
				className="range"
				type="range"
				min={0}
				max={Math.max(0.1, duration)}
				step={0.1}
				value={Math.min(atSeconds, duration)}
				disabled={disabled || busy || duration <= 0}
				onChange={(event) => setAtSeconds(Number(event.target.value))}
				aria-label="Which frame to preview"
			/>

			<div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
				<button className="btn btn--sm" disabled={disabled || busy} onClick={() => void run()}>
					{busy ? <IconSpinner size={12} /> : <IconEye size={12} />}
					{busy ? (progress ? progress.phase : 'Working...') : url ? 'Update preview' : 'Preview this frame'}
				</button>
				{url ? (
					<button
						className="btn btn--ghost btn--sm"
						disabled={busy}
						onClick={() =>
							setUrl((current) => {
								if (current) URL.revokeObjectURL(current)
								return null
							})
						}
					>
						Clear
					</button>
				) : null}
			</div>

			{busy && progress ? (
				<div className="progress-track" style={{ marginTop: 8 }}>
					<div className="progress-fill" style={{ width: `${Math.round(progress.ratio * 100)}%` }} />
				</div>
			) : null}

			{url ? (
				// eslint-disable-next-line @next/next/no-img-element -- a blob URL of a frame this tab just rendered
				<img className="tool-preview-frame" src={url} alt={`${tool.name} preview at ${formatSeconds(atSeconds)}`} />
			) : null}

			{note ? <span className="field-hint">{note}</span> : null}
			{error ? (
				<div className="notice notice--warn" style={{ marginTop: 8 }}>
					<span>{error}</span>
				</div>
			) : null}
		</div>
	)
}
