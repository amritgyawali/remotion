'use client'

/**
 * Paste an address, get a clip.
 *
 * One control shared by the caption, silence, tools and editor studios, so
 * importing by link behaves identically in all four: the same validation, the
 * same warnings about player pages, the same progress, the same cancel. Each
 * studio only has to say what to do with the File that comes back.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { formatBytes } from '../lib/format'
import {
	fetchRemoteVideo,
	looksLikeRemoteVideoUrl,
	pageOnlyHostWarning,
	type RemoteProgress,
} from '../lib/media/remote-video'
import { IconAlert, IconLink, IconSpinner } from './Icons'

export default function RemoteVideoField({
	onFile,
	disabled = false,
	placeholder = 'https://example.com/clip.mp4',
	label = 'Load',
	compact = false,
}: {
	/** Called once with the downloaded clip. Throwing here surfaces in the field. */
	onFile: (file: File) => void | Promise<void>
	disabled?: boolean
	placeholder?: string
	label?: string
	compact?: boolean
}) {
	const [value, setValue] = useState('')
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [progress, setProgress] = useState<RemoteProgress | null>(null)
	const abortRef = useRef<AbortController | null>(null)
	const liveRef = useRef(true)

	useEffect(() => {
		liveRef.current = true
		return () => {
			liveRef.current = false
			abortRef.current?.abort()
		}
	}, [])

	const warning = value.trim() ? pageOnlyHostWarning(value) : null
	const ready = looksLikeRemoteVideoUrl(value) && !disabled && !busy

	const run = useCallback(async () => {
		if (!ready) return
		const controller = new AbortController()
		abortRef.current = controller
		setBusy(true)
		setError(null)
		setProgress({ receivedBytes: 0, totalBytes: null, ratio: null })
		try {
			const file = await fetchRemoteVideo(value, {
				signal: controller.signal,
				onProgress: (next) => {
					if (liveRef.current) setProgress(next)
				},
			})
			await onFile(file)
			if (liveRef.current) setValue('')
		} catch (importError) {
			if (liveRef.current) setError(importError instanceof Error ? importError.message : String(importError))
		} finally {
			if (liveRef.current) {
				setBusy(false)
				setProgress(null)
			}
			abortRef.current = null
		}
	}, [onFile, ready, value])

	const cancel = useCallback(() => {
		abortRef.current?.abort()
	}, [])

	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: compact ? 6 : 8 }}>
			<div style={{ display: 'flex', gap: 6 }}>
				<input
					className="input"
					type="url"
					inputMode="url"
					spellCheck={false}
					placeholder={placeholder}
					value={value}
					disabled={disabled || busy}
					onChange={(event) => {
						setValue(event.target.value)
						setError(null)
					}}
					onKeyDown={(event) => {
						if (event.key === 'Enter') {
							event.preventDefault()
							void run()
						}
					}}
					aria-label="Video address"
				/>
				{busy ? (
					<button className="btn btn--sm" onClick={cancel} type="button">
						Cancel
					</button>
				) : (
					<button className="btn btn--sm" type="button" disabled={!ready} onClick={() => void run()}>
						<IconLink size={12} /> {label}
					</button>
				)}
			</div>

			{busy ? (
				<div className="notice" style={{ alignItems: 'center' }}>
					<span className="notice-icon">
						<IconSpinner size={14} />
					</span>
					<span>
						{progress && progress.ratio !== null
							? `Downloading - ${Math.round(progress.ratio * 100)}%`
							: progress && progress.receivedBytes > 0
								? `Downloading - ${formatBytes(progress.receivedBytes)}`
								: 'Contacting that server...'}
					</span>
				</div>
			) : null}

			{!busy && warning ? (
				<div className="notice" style={{ alignItems: 'flex-start' }}>
					<span className="notice-icon">
						<IconAlert size={14} />
					</span>
					<span>{warning}</span>
				</div>
			) : null}

			{error ? (
				<div className="notice notice--error" style={{ alignItems: 'flex-start' }}>
					<span className="notice-icon">
						<IconAlert size={14} />
					</span>
					<span>{error}</span>
				</div>
			) : null}
		</div>
	)
}
