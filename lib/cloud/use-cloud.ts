'use client'

/**
 * The one switch, and what every studio needs to honour it.
 *
 * `useCloud` answers three questions a studio asks on load: is cloud mode
 * configured at all, does this visitor want to use it, and who are they. The
 * preference is per-browser and survives a refresh, because someone who has
 * decided their laptop should stop encoding video has decided it for good, not
 * for one tab.
 *
 * The default is deliberately `device`. Cloud mode uploads the source file to a
 * third party, and that is a choice a person makes, not one a page makes for
 * them on first load.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { fetchCloudStatus } from './client'
import type { CloudStatus, RunLocation } from './types'

const PREFERENCE_KEY = 'rvs:run-location'

function readPreference(): RunLocation {
	if (typeof window === 'undefined') return 'device'
	try {
		return window.localStorage.getItem(PREFERENCE_KEY) === 'cloud' ? 'cloud' : 'device'
	} catch {
		// Private mode, or storage blocked. Device is the safe answer.
		return 'device'
	}
}

export type CloudState = {
	/** null until the probe lands; null forever if the server has no cloud */
	status: CloudStatus | null
	/** true once the probe has answered, whatever it said */
	probed: boolean
	/** cloud mode is configured and reachable */
	available: boolean
	/** what the visitor picked - `cloud` only ever returned when available */
	location: RunLocation
	setLocation: (location: RunLocation) => void
	signedIn: boolean
	email: string | null
}

export function useCloud(): CloudState {
	const [status, setStatus] = useState<CloudStatus | null>(null)
	const [probed, setProbed] = useState(false)
	// The server cannot read localStorage, so the first render must match it.
	// The stored preference is applied after hydration instead.
	const [preference, setPreference] = useState<RunLocation>('device')

	useEffect(() => {
		setPreference(readPreference())
	}, [])

	useEffect(() => {
		let active = true
		void (async () => {
			const result = await fetchCloudStatus()
			if (!active) return
			setStatus(result?.enabled ? result : null)
			setProbed(true)
		})()
		return () => {
			active = false
		}
	}, [])

	const available = Boolean(status?.enabled)

	const setLocation = useCallback((next: RunLocation) => {
		setPreference(next)
		try {
			window.localStorage.setItem(PREFERENCE_KEY, next)
		} catch {
			// The switch still works for this session; it just will not be remembered.
		}
	}, [])

	return useMemo(
		() => ({
			status,
			probed,
			available,
			// A stale `cloud` preference must not send work to a server that has
			// since lost its credentials.
			location: available && preference === 'cloud' ? 'cloud' : 'device',
			setLocation,
			signedIn: Boolean(status?.identity?.signedIn),
			email: status?.identity?.email ?? null,
		}),
		[available, preference, probed, setLocation, status],
	)
}

/** Formats a byte ceiling the way the upload warnings talk about it. */
export function describeLimit(bytes: number): string {
	return bytes >= 1024 * 1024 * 1024
		? `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
		: `${Math.round(bytes / 1024 / 1024)} MB`
}
