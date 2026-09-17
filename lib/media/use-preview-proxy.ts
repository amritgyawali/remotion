'use client'

/**
 * The proxy, wired to a component's lifetime.
 *
 * The rule the hook enforces is that the preview is never worse for having
 * asked: the original URL is returned immediately, the transcode runs behind
 * it, and the proxy only replaces the original once it is a complete, playable
 * file. Nothing waits, nothing blanks, and a machine that cannot build one
 * carries on exactly as it did before.
 *
 * Two smaller decisions matter as much as that one:
 *
 *   - The build starts a beat late, when the browser is next idle. The moment a
 *     clip is dropped is the moment it is being probed, drawn and often
 *     transcribed, and joining that scramble would make the first ten seconds
 *     worse in order to make the next ten minutes better.
 *   - Exactly one place revokes an object URL. A leaked one pins the whole file
 *     in memory, which on the machines this feature exists for is the bug it
 *     was meant to fix; a double revoke silently blanks a preview that is still
 *     on screen.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CaptionVideoSource } from '../captions/types'
import { ProxyCancelled, buildPreviewProxy, type PreviewProxy } from './preview-proxy'

export type PreviewProxyStatus =
	/** no clip, or proxying switched off by the caller */
	| 'idle'
	/** waiting for the browser to go quiet before starting */
	| 'queued'
	| 'building'
	| 'ready'
	/** the original is already fine to play */
	| 'not-needed'
	| 'unavailable'

export type PreviewProxyState = {
	status: PreviewProxyStatus
	/** 0 - 1 while building */
	progress: number
	/** what the preview should play: the proxy when there is one, else the original */
	url: string | null
	proxy: PreviewProxy | null
	/** why there is no proxy, when that is worth saying; null otherwise */
	note: string | null
}

/** How long the tab has to be quiet before a transcode starts. */
const START_DELAY_MS = 600

type IdleWindow = Window & {
	requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number
	cancelIdleCallback?: (handle: number) => void
}

/** Runs `task` when the browser next has room for it, or after `timeout`. */
function whenIdle(task: () => void, timeout: number): () => void {
	if (typeof window === 'undefined') return () => {}
	const idle = window as IdleWindow
	if (typeof idle.requestIdleCallback === 'function') {
		const handle = idle.requestIdleCallback(task, { timeout })
		return () => idle.cancelIdleCallback?.(handle)
	}
	const handle = window.setTimeout(task, timeout)
	return () => window.clearTimeout(handle)
}

export function usePreviewProxy(
	video: CaptionVideoSource | null,
	options: { enabled?: boolean } = {},
): PreviewProxyState {
	const enabled = options.enabled ?? true

	const [proxy, setProxy] = useState<PreviewProxy | null>(null)
	const [status, setStatus] = useState<PreviewProxyStatus>('idle')
	const [progress, setProgress] = useState(0)
	const [note, setNote] = useState<string | null>(null)

	// The single owner of the live object URL. State mirrors it for rendering;
	// this is what decides whether a revoke is safe.
	const held = useRef<PreviewProxy | null>(null)

	const adopt = useCallback((next: PreviewProxy | null) => {
		const previous = held.current
		if (previous && previous.url !== next?.url) URL.revokeObjectURL(previous.url)
		held.current = next
		setProxy(next)
	}, [])

	// A clip is the same clip while these hold. Object identity is not usable:
	// every panel that touches the source rebuilds the descriptor.
	const identity = video
		? [
				video.url,
				video.width,
				video.height,
				video.fps,
				Math.round(video.durationInSeconds * 1000),
			].join('|')
		: ''

	useEffect(() => {
		if (!identity || !video) {
			setStatus('idle')
			setProgress(0)
			setNote(null)
			return
		}
		// Already holding one for this clip: nothing to do, and re-running the
		// build would churn the cache for a file that is already smooth.
		if (held.current) return
		if (!enabled) {
			setStatus('queued')
			return
		}

		const controller = new AbortController()
		let active = true

		setStatus('queued')
		setProgress(0)

		const cancelIdle = whenIdle(() => {
			if (!active) return
			setStatus('building')

			buildPreviewProxy({
				video,
				signal: controller.signal,
				onProgress: (ratio) => {
					if (active) setProgress(ratio)
				},
			})
				.then((outcome) => {
					if (!active) {
						// A result that lands after teardown still owns an object URL.
						if (outcome.status === 'ready') URL.revokeObjectURL(outcome.proxy.url)
						return
					}
					if (outcome.status === 'ready') {
						adopt(outcome.proxy)
						setStatus('ready')
						setProgress(1)
						setNote(null)
					} else {
						setStatus(outcome.status)
						setNote(outcome.reason)
					}
				})
				.catch((error: unknown) => {
					if (!active || error instanceof ProxyCancelled) return
					setStatus('unavailable')
					setNote(error instanceof Error ? error.message : String(error))
				})
		}, START_DELAY_MS)

		return () => {
			active = false
			cancelIdle()
			controller.abort()
		}
		// `video` is rebuilt on every render of its owner; `identity` is what
		// actually decides whether this is a different clip.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [adopt, enabled, identity])

	// A different clip - or none - means the proxy in hand is dead weight. This
	// also covers unmount, which is the only other way the URL can be orphaned.
	useEffect(() => () => adopt(null), [adopt, identity])

	return useMemo(
		() => ({
			status,
			progress,
			proxy,
			url: proxy?.url ?? video?.url ?? null,
			note,
		}),
		[note, progress, proxy, status, video?.url],
	)
}

/** One short line for a badge, or null when there is nothing worth saying. */
export function describeProxy(state: PreviewProxyState): string | null {
	switch (state.status) {
		case 'queued':
			return 'Preparing smooth preview'
		case 'building':
			return `Preparing smooth preview ${Math.round(state.progress * 100)}%`
		case 'ready':
			// Named by the short edge, which is what "480p" means for a landscape
			// clip and the only reading that is not nonsense for a vertical one.
			return state.proxy
				? `Smooth preview ${Math.min(state.proxy.width, state.proxy.height)}p`
				: null
		default:
			return null
	}
}
