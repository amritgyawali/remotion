'use client'

/**
 * The cut, watched before it is made.
 *
 * Rendering a ten minute clip to find out that a cut clipped a word is a bad
 * trade, so the plan is played rather than encoded: an ordinary `<video>` runs
 * the original file while a loop watches the clock, seeks it over every stretch
 * the plan removes and raises the rate through every stretch it speeds up. What
 * comes out of the speakers and the screen is exactly what the exporter will
 * write, minutes earlier and at no cost.
 *
 * The seek is done a beat early - a browser takes a moment to land on a new
 * position, and jumping at the instant the hole opens lets a frame of it
 * through. Leaving early is invisible; leaving late is a stutter.
 *
 * How early is measured rather than assumed. A seek costs "decode everything
 * since the last key frame", which is a handful of milliseconds on the preview
 * proxy and most of a second on a 4K file whose key frames are five seconds
 * apart. A fixed lookahead can only be right for one of those, so the element
 * is timed as it works - `seeking` to `seeked`, smoothed - and the loop leaves
 * that much ahead of every hole, within sane bounds.
 *
 * The file being played is whatever the studio hands over. That is usually the
 * preview proxy, which is the same footage at preview size with a key frame
 * twice a second; the export always reads the original, so the two never meet.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
	formatTimecode,
	nextKeptSource,
	outputToSource,
	sourceToOutput,
	type CutPlan,
} from '../../lib/silence/plan'
import {
	IconEye,
	IconPause,
	IconPlay,
	IconScissors,
	IconSkipNext,
	IconSkipPrev,
	IconSpinner,
	IconVolume,
	IconVolumeOff,
} from '../Icons'

/** The least notice a seek is ever given, in seconds. */
const MIN_LOOKAHEAD_SECONDS = 0.06

/**
 * The most notice a seek is ever given.
 *
 * Past this the jump starts to cut audible speech off the end of the kept
 * stretch, which is a worse fault than the stutter it would be avoiding.
 */
const MAX_LOOKAHEAD_SECONDS = 0.45

/** Weight of each new measurement in the running estimate of seek cost. */
const SEEK_COST_SMOOTHING = 0.3

export default function SilencePreview({
	url,
	width,
	height,
	plan,
	sourceMs,
	seekNonce,
	previewOriginal,
	proxyNote,
	proxyBusy = false,
	onSourceMs,
	onPreviewOriginal,
}: {
	/** the file to play - the preview proxy when there is one, else the original */
	url: string | null
	/** the clip's own pixel size, which shapes the frame around it */
	width: number
	height: number
	plan: CutPlan
	sourceMs: number
	/** bumped by the parent whenever it wants the element moved */
	seekNonce: number
	previewOriginal: boolean
	/** one line about the preview copy, shown over the frame */
	proxyNote?: string | null
	/** true while that copy is still being built */
	proxyBusy?: boolean
	onSourceMs: (ms: number) => void
	onPreviewOriginal: (value: boolean) => void
}) {
	const videoRef = useRef<HTMLVideoElement>(null)
	const frameRef = useRef<number | null>(null)
	const [playing, setPlaying] = useState(false)
	const [muted, setMuted] = useState(false)
	const [skipping, setSkipping] = useState(false)
	const skipTimer = useRef<number | null>(null)

	const planRef = useRef(plan)
	planRef.current = plan
	const originalRef = useRef(previewOriginal)
	originalRef.current = previewOriginal
	const emitRef = useRef(onSourceMs)
	emitRef.current = onSourceMs
	const sourceMsRef = useRef(sourceMs)
	sourceMsRef.current = sourceMs
	const playingRef = useRef(playing)
	playingRef.current = playing

	/* ------------------------------------------------ measured seek cost */

	/** Seconds the element has been taking to land a seek, smoothed. */
	const seekCost = useRef(MIN_LOOKAHEAD_SECONDS)
	const seekStartedAt = useRef<number | null>(null)

	const noteSeekStart = useCallback(() => {
		seekStartedAt.current = performance.now()
	}, [])

	const noteSeekEnd = useCallback(() => {
		const started = seekStartedAt.current
		seekStartedAt.current = null
		if (started === null) return
		const measured = (performance.now() - started) / 1000
		// A seek the browser served from what it had already decoded reports a
		// millisecond or less. Folding those in would pull the estimate below
		// what a real jump costs, so the floor does the clamping, not the mean.
		seekCost.current =
			seekCost.current * (1 - SEEK_COST_SMOOTHING) + measured * SEEK_COST_SMOOTHING
	}, [])

	const lookahead = useCallback(
		() => Math.min(MAX_LOOKAHEAD_SECONDS, Math.max(MIN_LOOKAHEAD_SECONDS, seekCost.current * 1.6)),
		[],
	)

	/* --------------------------------------------------- external seeks */

	useEffect(() => {
		const video = videoRef.current
		if (!video) return
		const target = sourceMs / 1000
		if (Math.abs(video.currentTime - target) > 0.04) video.currentTime = target
		// Only when the parent asks: following `sourceMs` itself would fight the
		// loop below, which is the thing moving it in the first place.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [seekNonce])

	/* ------------------------------------------------- swapping the file */

	/**
	 * The proxy usually arrives mid-session, so the element's `src` changes
	 * under a person who is part-way through watching. Where they were and
	 * whether they were playing is restored on the other side of the swap, which
	 * makes the upgrade something you notice only by it suddenly being smooth.
	 */
	const restoreTo = useRef<number | null>(null)
	const resumeAfterLoad = useRef(false)
	const firstLoad = useRef(true)

	useEffect(() => {
		if (!url) return
		if (firstLoad.current) {
			firstLoad.current = false
			return
		}
		restoreTo.current = sourceMsRef.current / 1000
		resumeAfterLoad.current = playingRef.current
	}, [url])

	/* ------------------------------------------------------- the loop */

	const step = useCallback(() => {
		const video = videoRef.current
		if (!video) return
		const currentPlan = planRef.current
		const positionMs = video.currentTime * 1000

		if (!originalRef.current && currentPlan.segments.length > 0) {
			const at = sourceToOutput(currentPlan, positionMs + lookahead() * 1000)
			const segment = at.segment

			if (segment && segment.mode === 'drop') {
				const jumpTo = nextKeptSource(currentPlan, segment.sourceEndMs)
				if (jumpTo === null) {
					video.pause()
					setPlaying(false)
				} else if (jumpTo / 1000 > video.currentTime) {
					video.currentTime = jumpTo / 1000
					setSkipping(true)
					if (skipTimer.current) window.clearTimeout(skipTimer.current)
					skipTimer.current = window.setTimeout(() => setSkipping(false), 420)
				}
			} else {
				const rate = segment && Number.isFinite(segment.speed) ? segment.speed : 1
				const clamped = Math.min(16, Math.max(0.25, rate))
				if (Math.abs(video.playbackRate - clamped) > 0.01) video.playbackRate = clamped
			}
		} else if (originalRef.current && video.playbackRate !== 1) {
			video.playbackRate = 1
		}

		emitRef.current(positionMs)
		frameRef.current = window.requestAnimationFrame(step)
	}, [lookahead])

	useEffect(() => {
		if (!playing) {
			if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current)
			frameRef.current = null
			return
		}
		frameRef.current = window.requestAnimationFrame(step)
		return () => {
			if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current)
			frameRef.current = null
		}
	}, [playing, step])

	useEffect(
		() => () => {
			if (skipTimer.current) window.clearTimeout(skipTimer.current)
		},
		[],
	)

	// Leaving edit mode must not strand the element at a raised rate.
	useEffect(() => {
		const video = videoRef.current
		if (video && previewOriginal) video.playbackRate = 1
	}, [previewOriginal])

	/* ------------------------------------------------------- transport */

	const toggle = useCallback(() => {
		const video = videoRef.current
		if (!video) return
		if (video.paused) {
			void video.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
		} else {
			video.pause()
			setPlaying(false)
		}
	}, [])

	const jumpCut = useCallback(
		(direction: 1 | -1) => {
			const video = videoRef.current
			if (!video) return
			const here = video.currentTime * 1000
			const cuts = plan.segments
				.filter((segment) => segment.kind === 'silence' && segment.mode !== 'keep')
				.map((segment) => segment.sourceStartMs)
			const target =
				direction === 1
					? cuts.find((ms) => ms > here + 120)
					: [...cuts].reverse().find((ms) => ms < here - 120)
			if (target === undefined) return
			video.currentTime = target / 1000
			onSourceMs(target)
		},
		[onSourceMs, plan.segments],
	)

	const outputPosition = sourceToOutput(plan, sourceMs)
	const outputMs = outputPosition.outputMs
	const progress =
		plan.outputDurationMs > 0 ? Math.min(1, Math.max(0, outputMs / plan.outputDurationMs)) : 0

	const portrait = height >= width

	return (
		<div className="cut-preview">
			<div className="cut-stage" data-skipping={skipping}>
				{url ? (
					/*
					 * The frame is shaped to the clip rather than the clip letterboxed
					 * into a full-bleed box: a 9:16 phone clip in a 16:9 stage is
					 * otherwise a narrow strip of picture in 1600px of black.
					 */
					<div
						className="cut-frame"
						style={{
							aspectRatio: `${width || 16} / ${height || 9}`,
							height: portrait ? '100%' : 'auto',
							width: portrait ? 'auto' : '100%',
						}}
					>
						<video
							ref={videoRef}
							className="cut-video"
							src={url}
							playsInline
							muted={muted}
							// The whole point of this panel is scrubbing, and a browser that
							// has only read the headers re-fetches for every jump.
							preload="auto"
							onEnded={() => setPlaying(false)}
							onPause={() => setPlaying(false)}
							onSeeking={noteSeekStart}
							onSeeked={noteSeekEnd}
							onClick={toggle}
							onLoadedMetadata={(event) => {
								const video = event.currentTarget
								const restored = restoreTo.current
								restoreTo.current = null
								const target = restored ?? (sourceMs > 0 ? sourceMs / 1000 : 0)
								const ceiling = Number.isFinite(video.duration) ? video.duration : target
								if (target > 0) video.currentTime = Math.min(target, ceiling)
								if (resumeAfterLoad.current) {
									resumeAfterLoad.current = false
									void video
										.play()
										.then(() => setPlaying(true))
										.catch(() => setPlaying(false))
								}
							}}
						/>
					</div>
				) : (
					<div className="stage-empty">
						<span className="stage-empty-mark">
							<IconScissors size={22} />
						</span>
						<h2>Nothing loaded yet</h2>
						<p>
							Drop a video on the left. Its audio is measured once, and every pause in it becomes
							something you can watch, tune and cut - without uploading a byte.
						</p>
					</div>
				)}

				{url && proxyNote ? (
					<span className="cut-proxy-flag" data-busy={proxyBusy}>
						{proxyBusy ? <IconSpinner size={11} /> : null}
						{proxyNote}
					</span>
				) : null}

				{skipping ? (
					<span className="cut-skip-flash">
						<IconScissors size={13} /> cut
					</span>
				) : null}

				{!previewOriginal && outputPosition.segment?.mode === 'speed' ? (
					<span className="cut-speed-flash">{outputPosition.segment.speed}x</span>
				) : null}
			</div>

			<div className="cut-transport">
				<button
					className="icon-btn"
					onClick={() => jumpCut(-1)}
					disabled={!url || plan.cuts === 0}
					title="Previous cut"
					aria-label="Previous cut"
				>
					<IconSkipPrev size={14} />
				</button>
				<button
					className="btn btn--primary btn--sm"
					onClick={toggle}
					disabled={!url}
					title={playing ? 'Pause' : 'Play the cut'}
				>
					{playing ? <IconPause size={13} /> : <IconPlay size={13} />}
					<span className="btn-label">{playing ? 'Pause' : previewOriginal ? 'Play original' : 'Play the cut'}</span>
				</button>
				<button
					className="icon-btn"
					onClick={() => jumpCut(1)}
					disabled={!url || plan.cuts === 0}
					title="Next cut"
					aria-label="Next cut"
				>
					<IconSkipNext size={14} />
				</button>

				<div
					className="cut-scrub"
					role="slider"
					tabIndex={0}
					aria-label="Position in the finished cut"
					aria-valuemin={0}
					aria-valuemax={Math.round(plan.outputDurationMs)}
					aria-valuenow={Math.round(outputMs)}
					onPointerDown={(event) => {
						const rect = event.currentTarget.getBoundingClientRect()
						const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
						const target = outputToSource(plan, ratio * plan.outputDurationMs)
						const video = videoRef.current
						if (video) video.currentTime = target.sourceMs / 1000
						onSourceMs(target.sourceMs)
					}}
				>
					<div className="cut-scrub-track">
						<div className="cut-scrub-fill" style={{ width: `${progress * 100}%` }} />
						{plan.segments
							.filter((segment) => segment.kind === 'silence' && segment.mode !== 'keep')
							.slice(0, 400)
							.map((segment) => (
								<span
									key={segment.id}
									className="cut-scrub-mark"
									data-mode={segment.mode}
									style={{
										left: `${(segment.outputStartMs / Math.max(1, plan.outputDurationMs)) * 100}%`,
									}}
								/>
							))}
					</div>
					<span className="cut-scrub-time">
						{formatTimecode(outputMs)} / {formatTimecode(plan.outputDurationMs)}
					</span>
				</div>

				<button
					className="icon-btn"
					onClick={() => setMuted((value) => !value)}
					disabled={!url}
					title={muted ? 'Unmute' : 'Mute'}
					aria-label={muted ? 'Unmute' : 'Mute'}
				>
					{muted ? <IconVolumeOff size={14} /> : <IconVolume size={14} />}
				</button>

				<button
					className="btn btn--ghost btn--sm"
					data-active={previewOriginal}
					onClick={() => onPreviewOriginal(!previewOriginal)}
					disabled={!url}
					title="Watch the untouched file, to compare"
				>
					<IconEye size={12} />
					<span className="btn-label">{previewOriginal ? 'Original' : 'Cut'}</span>
				</button>
			</div>
		</div>
	)
}
