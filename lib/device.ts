'use client'

import { useEffect, useState } from 'react'

/**
 * What this device can realistically encode.
 *
 * A browser render holds decoded frames, an encoder queue and the muxed output
 * in the memory of one tab. A laptop shrugs that off; a phone with 3 GB of RAM
 * and a browser that hands a tab a fraction of it does not, and the failure
 * arrives as a killed tab rather than as an error a render can report.
 *
 * So the studio measures the device once and lowers its own ceilings to match:
 * a smaller maximum canvas, a capped resolution multiplier, and a shorter
 * encoder queue. Everything here is a hint from the browser, so each value has
 * a conservative fallback and none of them ever blocks a render - a phone that
 * wants 4K can still ask for it, it is just not what the studio proposes.
 */

export type DeviceProfile = {
	mobile: boolean
	ios: boolean
	/** navigator.deviceMemory in GB, or null when the browser will not say */
	memoryGb: number | null
	cores: number
	/** longest edge the studio will plan a composition at on this device */
	maxDimension: number
	/** largest resolution multiplier offered in the export panel */
	maxScale: number
	/** how many frames may sit in the encoder queue before rendering waits */
	encoderQueueDepth: number
	/** true when a long render on this device is worth warning about */
	constrained: boolean
}

const DESKTOP: DeviceProfile = {
	mobile: false,
	ios: false,
	memoryGb: null,
	cores: 4,
	maxDimension: 3840,
	maxScale: 2,
	encoderQueueDepth: 8,
	constrained: false,
}

let cached: DeviceProfile | null = null

function detectIos(): boolean {
	if (typeof navigator === 'undefined') return false
	const ua = navigator.userAgent
	// iPadOS reports itself as a Mac, and the touch point count is the only
	// reliable way to tell one from a desktop Safari that has none.
	const iPadOS = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1
	return /iPad|iPhone|iPod/.test(ua) || iPadOS
}

export function deviceProfile(): DeviceProfile {
	if (cached) return cached
	if (typeof window === 'undefined' || typeof navigator === 'undefined') return DESKTOP

	const coarse =
		typeof window.matchMedia === 'function' &&
		window.matchMedia('(pointer: coarse)').matches &&
		window.matchMedia('(hover: none)').matches
	const smallScreen = Math.min(window.screen?.width ?? 1920, window.screen?.height ?? 1080) <= 820
	const ios = detectIos()
	const mobile = ios || (coarse && smallScreen) || /Android|Mobile/i.test(navigator.userAgent)

	const memoryGb =
		typeof (navigator as { deviceMemory?: number }).deviceMemory === 'number'
			? (navigator as { deviceMemory?: number }).deviceMemory!
			: null
	const cores = Math.max(1, navigator.hardwareConcurrency || (mobile ? 4 : 4))

	// Two ceilings, whichever is lower: what the form factor can hold, and what
	// the reported memory can hold. 1440p is the highest a 4 GB phone finishes
	// reliably; 8 GB tablets and laptops keep the full 4K path.
	const byForm = mobile ? 1920 : 3840
	const byMemory =
		memoryGb === null ? (mobile ? 1920 : 3840) : memoryGb <= 2 ? 1280 : memoryGb <= 4 ? 1920 : 3840
	const maxDimension = Math.min(byForm, byMemory)

	cached = {
		mobile,
		ios,
		memoryGb,
		cores,
		maxDimension,
		maxScale: mobile || maxDimension <= 1920 ? 1 : 2,
		// A deep queue is throughput on a desktop and a memory spike on a phone.
		encoderQueueDepth: mobile ? 3 : cores >= 8 ? 8 : 6,
		constrained: mobile || maxDimension < 3840 || cores <= 4,
	}
	return cached
}

/** Server-safe read for code that may run during SSR. */
export function isMobileDevice(): boolean {
	return deviceProfile().mobile
}

/**
 * The profile, read after mount.
 *
 * A client component still renders once on the server, where there is no
 * screen to measure. Reading the real profile in an effect keeps the first
 * paint identical on both sides and avoids a hydration mismatch on the one
 * piece of UI whose whole job is to describe the device.
 */
export function useDeviceProfile(): DeviceProfile {
	const [profile, setProfile] = useState<DeviceProfile>(DESKTOP)
	useEffect(() => {
		setProfile(deviceProfile())
	}, [])
	return profile
}

/**
 * Holds the screen awake for the duration of a render.
 *
 * A phone that locks its screen suspends the tab, and a suspended tab stops
 * feeding the encoder - the render appears to hang and then dies. The lock is
 * re-taken when the tab comes back, because the browser drops it on every
 * visibility change. Unsupported browsers get a no-op release function.
 */
export async function keepScreenAwake(): Promise<() => void> {
	type Sentinel = { release: () => Promise<void>; released: boolean }
	const api = (navigator as unknown as {
		wakeLock?: { request: (type: 'screen') => Promise<Sentinel> }
	}).wakeLock
	if (!api) return () => undefined

	let sentinel: Sentinel | null = null
	let live = true

	const acquire = async () => {
		if (!live || document.visibilityState !== 'visible') return
		try {
			sentinel = await api.request('screen')
		} catch {
			/* denied, low battery, or not allowed in this context - render anyway */
		}
	}

	const onVisibility = () => {
		if (document.visibilityState === 'visible' && (!sentinel || sentinel.released)) void acquire()
	}

	await acquire()
	document.addEventListener('visibilitychange', onVisibility)

	return () => {
		live = false
		document.removeEventListener('visibilitychange', onVisibility)
		void sentinel?.release().catch(() => undefined)
		sentinel = null
	}
}
