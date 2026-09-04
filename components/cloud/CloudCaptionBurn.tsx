'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { formatBytes } from '../../lib/format'
import { runSubtitlesInCloud } from '../../lib/cloud/run-tool'
import { CLOUD_SUBTITLE_FONTS, DEFAULT_CLOUD_SUBTITLE_STYLE } from '../../lib/cloud/transform'
import type { CloudState } from '../../lib/cloud/use-cloud'
import { IconAlert, IconCheck, IconCloud, IconDownload, IconInfo, IconStop } from '../Icons'

/**
 * Burns the caption text into the picture on Cloudinary's hardware.
 *
 * This is deliberately kept apart from the studio's own Render button rather
 * than folded into it. The studio draws captions with its own compositor -
 * per-word timing, the object layer, the animation kit - and none of that
 * exists in a Cloudinary URL. What the cloud can do is the plain version: the
 * words, a font, a box, burnt in. Presenting that as a second, clearly named
 * export is honest; quietly substituting it for the designed one would not be.
 *
 * The reason it earns its place is the machine it rescues. A phone, or a
 * laptop with no WebCodecs encoder, cannot finish the studio's own render at
 * all - and this one it can, because nothing here decodes a frame.
 */
export default function CloudCaptionBurn({
	cloud,
	file,
	srt,
	cueCount,
	format,
}: {
	cloud: CloudState
	/** the original bytes; a pasted URL has none, and cannot be uploaded */
	file: File | null
	/** the caption track, serialised only when it is actually needed */
	srt: () => string
	cueCount: number
	format: 'mp4' | 'webm'
}) {
	const [open, setOpen] = useState(false)
	const [font, setFont] = useState<string>(DEFAULT_CLOUD_SUBTITLE_STYLE.fontFamily)
	const [size, setSize] = useState(DEFAULT_CLOUD_SUBTITLE_STYLE.fontSize)
	const [boxOpacity, setBoxOpacity] = useState(DEFAULT_CLOUD_SUBTITLE_STYLE.boxOpacity)
	const [busy, setBusy] = useState(false)
	const [phase, setPhase] = useState('')
	const [ratio, setRatio] = useState(0)
	const [error, setError] = useState<string | null>(null)
	const [result, setResult] = useState<{ url: string; name: string; bytes: number } | null>(null)

	const abortRef = useRef<AbortController | null>(null)
	const resultRef = useRef<string | null>(null)

	// The finished file is an object URL; leaving the studio must not leak it.
	useEffect(
		() => () => {
			abortRef.current?.abort()
			if (resultRef.current) URL.revokeObjectURL(resultRef.current)
		},
		[],
	)

	const run = useCallback(
		(previewSec?: number) => {
			if (!file) return
			abortRef.current?.abort()
			const controller = new AbortController()
			abortRef.current = controller

			setBusy(true)
			setError(null)
			setRatio(0)
			setPhase('Starting')

			void (async () => {
				try {
					const finished = await runSubtitlesInCloud({
						file,
						srt: srt(),
						output: { format, quality: previewSec ? 'draft' : 'high' },
						style: { fontFamily: font, fontSize: size, boxOpacity },
						previewSec,
						signal: controller.signal,
						onProgress: (progress) => {
							setPhase(progress.phase)
							setRatio(progress.ratio)
						},
					})
					if (controller.signal.aborted) return
					if (resultRef.current) URL.revokeObjectURL(resultRef.current)
					resultRef.current = finished.url
					setResult({ url: finished.url, name: finished.name, bytes: finished.sizeInBytes })
				} catch (caught) {
					if (controller.signal.aborted) return
					setError(caught instanceof Error ? caught.message : String(caught))
				} finally {
					if (abortRef.current === controller) {
						setBusy(false)
						abortRef.current = null
					}
				}
			})()
		},
		[boxOpacity, file, font, format, size, srt],
	)

	if (!cloud.available) return null

	return (
		<div className="cloud-burn">
			<button
				type="button"
				className="cloud-burn-toggle"
				aria-expanded={open}
				onClick={() => setOpen((value) => !value)}
			>
				<IconCloud size={13} />
				<span>Burn plain captions in the cloud</span>
				<span className="cloud-burn-chevron" data-open={open} aria-hidden="true" />
			</button>

			{open ? (
				<div className="cloud-burn-body">
					<p className="field-hint">
						Cloudinary draws the words over the picture on its own hardware, so this export works
						on a phone or in a browser with no encoder. It is the plain version - one font, one
						box, no animation and no object layer - not the design on the left.
					</p>

					{!file ? (
						<div className="notice notice--warn" style={{ marginTop: 10 }}>
							<span className="notice-icon">
								<IconAlert size={14} />
							</span>
							<span>
								This clip came from an address rather than a file, so there are no bytes here to
								upload. Download it, load the file, and this will work.
							</span>
						</div>
					) : cueCount === 0 ? (
						<div className="notice notice--info" style={{ marginTop: 10 }}>
							<span className="notice-icon">
								<IconInfo size={14} />
							</span>
							<span>Write or transcribe some captions first.</span>
						</div>
					) : (
						<>
							<div className="field">
								<label className="field-label" htmlFor="cloud-burn-font">
									<span>Font</span>
								</label>
								<select
									id="cloud-burn-font"
									className="select"
									value={font}
									disabled={busy}
									onChange={(event) => setFont(event.target.value)}
								>
									{CLOUD_SUBTITLE_FONTS.map((name) => (
										<option key={name} value={name}>
											{name}
										</option>
									))}
								</select>
								<span className="field-hint">
									Only fonts Cloudinary hosts itself can be burnt in, so the list is closed rather
									than failing at the end of an upload.
								</span>
							</div>

							<div className="field">
								<label className="field-label" htmlFor="cloud-burn-size">
									<span>Size</span>
									<span className="field-value">{size}px</span>
								</label>
								<input
									id="cloud-burn-size"
									type="range"
									min={14}
									max={96}
									step={2}
									value={size}
									disabled={busy}
									onChange={(event) => setSize(Number(event.target.value))}
								/>
							</div>

							<div className="field">
								<label className="field-label" htmlFor="cloud-burn-box">
									<span>Backing box</span>
									<span className="field-value">{boxOpacity === 0 ? 'off' : `${boxOpacity}%`}</span>
								</label>
								<input
									id="cloud-burn-box"
									type="range"
									min={0}
									max={100}
									step={5}
									value={boxOpacity}
									disabled={busy}
									onChange={(event) => setBoxOpacity(Number(event.target.value))}
								/>
							</div>

							{error ? (
								<div className="notice notice--error">
									<span className="notice-icon">
										<IconAlert size={14} />
									</span>
									<span>{error}</span>
								</div>
							) : null}

							{busy ? (
								<>
									<div className="progress-track">
										<div
											className="progress-fill"
											style={{ width: `${Math.round(ratio * 100)}%` }}
										/>
									</div>
									<div className="progress-meta">
										<span>{phase}</span>
										<span>{Math.round(ratio * 100)}%</span>
									</div>
									<button
										type="button"
										className="btn btn--danger btn--block"
										onClick={() => abortRef.current?.abort()}
									>
										<IconStop size={13} /> Stop
									</button>
								</>
							) : (
								<div className="card-actions" style={{ flexWrap: 'wrap' }}>
									<button type="button" className="btn btn--ghost btn--sm" onClick={() => run(8)}>
										Preview 8s
									</button>
									<button type="button" className="btn btn--primary btn--sm" onClick={() => run()}>
										<IconCloud size={12} /> Burn the whole clip
									</button>
								</div>
							)}

							{result ? (
								<div className="result" style={{ marginTop: 12 }}>
									<div className="result-title">
										<IconCheck size={14} /> Burnt in
									</div>
									<video className="result-media" src={result.url} controls playsInline />
									<div className="result-meta">
										<span title={result.name}>{result.name}</span>
										<span>{formatBytes(result.bytes)}</span>
									</div>
									<a className="btn btn--block" href={result.url} download={result.name}>
										<IconDownload size={13} /> Download
									</a>
								</div>
							) : null}
						</>
					)}
				</div>
			) : null}
		</div>
	)
}
