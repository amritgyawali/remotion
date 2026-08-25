'use client'

/**
 * Autosave, restore and the little "saved 4s ago" readout, in one hook.
 *
 * The rule this enforces is simple: nothing a person typed, dragged, timed or
 * uploaded may be lost to a stray refresh. Work is written to the local vault
 * a moment after it stops changing, and again the instant the tab is hidden -
 * which is the last event a browser reliably delivers before a reload.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { readSnapshot, removeSnapshot, storageAvailable, writeSnapshot } from './idb'

export type VaultStatus = 'idle' | 'saving' | 'saved' | 'error' | 'unsupported'

export type VaultState = {
	status: VaultStatus
	/** epoch ms of the last successful write, null until one lands */
	savedAt: number | null
	error: string | null
}

const IDLE_STATE: VaultState = { status: 'idle', savedAt: null, error: null }

export type RestorePhase = 'loading' | 'restored' | 'empty'

/**
 * Reads a snapshot once, on mount.
 *
 * `apply` is held in a ref, so a handler rebuilt on every render cannot make
 * this run twice - restoring a workspace twice would double every list in it.
 */
export function useRestoredSnapshot<T>(options: {
	key: string
	version: number
	apply: (data: T, updatedAt: number) => void | Promise<void>
	/** hold the read until this is true - used when a probe has to finish first */
	ready?: boolean
}): { phase: RestorePhase; updatedAt: number | null } {
	const { key, version, ready = true } = options
	const applyRef = useRef(options.apply)
	applyRef.current = options.apply

	const [phase, setPhase] = useState<RestorePhase>('loading')
	const [updatedAt, setUpdatedAt] = useState<number | null>(null)

	useEffect(() => {
		if (!ready) return

		let active = true
		void (async () => {
			if (!storageAvailable()) {
				if (active) setPhase('empty')
				return
			}
			const record = await readSnapshot<T>(key)
			if (!active) return
			if (!record || record.version !== version || record.data == null) {
				setPhase('empty')
				return
			}
			try {
				await applyRef.current(record.data, record.updatedAt)
				if (!active) return
				setUpdatedAt(record.updatedAt)
				setPhase('restored')
			} catch {
				// A snapshot written by an older build can be structurally wrong in a
				// way the version number did not catch. Starting empty beats crashing.
				if (active) setPhase('empty')
			}
		})()

		return () => {
			active = false
		}
	}, [key, ready, version])

	return { phase, updatedAt }
}

/**
 * Writes `data` to the vault a beat after it settles.
 *
 * `enabled` exists so a studio never saves over a good snapshot with its empty
 * initial state during the frame between mount and restore.
 */
export function useAutosave<T>(options: {
	key: string
	version: number
	data: T | null
	enabled: boolean
	delayMs?: number
}): VaultState & { saveNow: () => Promise<void>; forget: () => Promise<void> } {
	const { key, version, data, enabled, delayMs = 700 } = options

	// The server cannot see IndexedDB, so capability detection during render
	// would produce different HTML on the server and browser. Start from the
	// same neutral state everywhere, then refine it after hydration.
	const [state, setState] = useState<VaultState>(IDLE_STATE)

	useEffect(() => {
		if (!storageAvailable()) {
			setState({ status: 'unsupported', savedAt: null, error: null })
		}
	}, [])

	const dataRef = useRef<T | null>(data)
	dataRef.current = data
	const lastWrittenRef = useRef<string | null>(null)
	const timerRef = useRef<number | null>(null)
	const inFlightRef = useRef<Promise<void> | null>(null)
	/** Invalidates a write loop before `forget()` removes its final record. */
	const epochRef = useRef(0)

	const flush = useCallback(async () => {
		if (!storageAvailable()) return
		// A caller arriving while a write is underway joins that write. The loop
		// below re-reads `dataRef` after every commit, so the newest edit is still
		// written even when it landed halfway through the previous transaction.
		if (inFlightRef.current) return inFlightRef.current

		const epoch = epochRef.current
		const task = (async () => {
			while (epoch === epochRef.current) {
				const current = dataRef.current

				// A null snapshot means the workspace is genuinely empty. Removing the
				// old record here makes Start fresh stay fresh after another reload.
				if (current == null) {
					await removeSnapshot(key)
					if (epoch === epochRef.current) {
						lastWrittenRef.current = null
						setState(storageAvailable() ? IDLE_STATE : { status: 'unsupported', savedAt: null, error: null })
					}
					return
				}

				let serialized: string
				try {
					serialized = JSON.stringify(current)
				} catch {
					// Something unserializable slipped into the snapshot - a File, a ref,
					// a cycle. Say so rather than silently never saving again.
					setState({ status: 'error', savedAt: null, error: 'This workspace could not be serialized.' })
					return
				}

				if (serialized === lastWrittenRef.current) return
				setState((previous) => ({ ...previous, status: 'saving' }))
				const ok = await writeSnapshot(key, version, current)
				if (epoch !== epochRef.current) return

				if (!ok) {
					setState((previous) => ({
						status: 'error',
						savedAt: previous.savedAt,
						error: 'The browser refused to store this workspace - it may be out of space.',
					}))
					return
				}

				lastWrittenRef.current = serialized
				setState({ status: 'saved', savedAt: Date.now(), error: null })
				// Loop once more. If an edit arrived during the transaction its JSON no
				// longer matches `lastWrittenRef`, so it receives its own commit now.
			}
		})()

		inFlightRef.current = task
		try {
			await task
		} finally {
			if (inFlightRef.current === task) inFlightRef.current = null
		}
	}, [key, version])

	useEffect(() => {
		if (!enabled) return
		if (timerRef.current !== null) window.clearTimeout(timerRef.current)
		timerRef.current = window.setTimeout(() => {
			timerRef.current = null
			void flush()
		}, delayMs)
		return () => {
			if (timerRef.current !== null) window.clearTimeout(timerRef.current)
		}
	}, [data, delayMs, enabled, flush])

	/**
	 * The refresh guard.
	 *
	 * `visibilitychange` to hidden and `pagehide` are the two events that still
	 * fire when a tab is reloaded, closed or backgrounded on mobile - so the
	 * pending debounce is cashed in there rather than hoped for.
	 */
	useEffect(() => {
		if (!enabled) return
		const onHide = () => {
			if (document.visibilityState === 'hidden') void flush()
		}
		const onPageHide = () => {
			void flush()
		}
		document.addEventListener('visibilitychange', onHide)
		window.addEventListener('pagehide', onPageHide)
		return () => {
			document.removeEventListener('visibilitychange', onHide)
			window.removeEventListener('pagehide', onPageHide)
		}
	}, [enabled, flush])

	const forget = useCallback(async () => {
		epochRef.current += 1
		lastWrittenRef.current = null
		// Let a transaction already handed to IndexedDB settle, then delete the
		// record it may have committed. The epoch prevents its loop from starting
		// a follow-up write with stale data.
		if (inFlightRef.current) await inFlightRef.current
		await removeSnapshot(key)
		setState(storageAvailable() ? IDLE_STATE : { status: 'unsupported', savedAt: null, error: null })
	}, [key])

	return { ...state, saveNow: flush, forget }
}

/** "just now" / "2m ago" - re-rendered by the caller on a timer, not here. */
export function agoLabel(timestamp: number | null, now: number = Date.now()): string {
	if (!timestamp) return ''
	const seconds = Math.max(0, Math.round((now - timestamp) / 1000))
	if (seconds < 5) return 'just now'
	if (seconds < 60) return `${seconds}s ago`
	const minutes = Math.round(seconds / 60)
	if (minutes < 60) return `${minutes}m ago`
	const hours = Math.round(minutes / 60)
	if (hours < 24) return `${hours}h ago`
	return `${Math.round(hours / 24)}d ago`
}

/** A ticking clock for the readout, so "saved just now" ages without a re-save. */
export function useNow(intervalMs = 15_000, active = true): number {
	const [now, setNow] = useState(() => Date.now())
	useEffect(() => {
		if (!active) return
		const timer = window.setInterval(() => setNow(Date.now()), intervalMs)
		return () => window.clearInterval(timer)
	}, [active, intervalMs])
	return now
}

export function formatBytes(bytes: number): string {
	if (!bytes || bytes < 0) return '0 B'
	const units = ['B', 'KB', 'MB', 'GB', 'TB']
	const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
	const value = bytes / 1024 ** index
	return `${value >= 10 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`
}
