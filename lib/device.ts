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

/** True when running inside the Tauri desktop/mobile shell (`apps/editor-native`) rather than a plain browser tab. `window.__TAURI_INTERNALS__` is the IPC bridge every Tauri v2 webview sets, regardless of config. */
export function isTauriNative(): boolean {
	return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export type NativeSystemInfo = { totalMemoryBytes: number; availableMemoryBytes: number; cpuCores: number; os: string }

/**
 * Asks the native shell for the real amount of system RAM.
 * `navigator.deviceMemory` caps at 8 and rounds down for privacy, which is
 * exactly backwards from what a desktop editor with 32-128 GB actually wants
 * to know. Resolves null in a plain browser tab, or if the call fails.
 *
 * Dynamically imported so the web build never needs `@tauri-apps/api` in its
 * main bundle - the import only executes (and only then gets fetched) once
 * `isTauriNative()` is already true.
 */
export async function nativeSystemInfo(): Promise<NativeSystemInfo | null> {
	if (!isTauriNative()) return null
	try {
		const { invoke } = await import('@tauri-apps/api/core')
		const info = await invoke<{ total_memory_bytes: number; available_memory_bytes: number; cpu_cores: number; os: string }>('system_info')
		return { totalMemoryBytes: info.total_memory_bytes, availableMemoryBytes: info.available_memory_bytes, cpuCores: info.cpu_cores, os: info.os }
	} catch {
		return null
	}
}

/**
 * Recomputes the device profile from real system RAM/CPU instead of the
 * browser's capped, rounded heuristic, and raises the ceilings to match -
 * this is the concrete "use system RAM" promise: an 8 GB browser tab ceiling
 * versus this machine's actual 32-128 GB. Updates the module cache too, so a
 * later plain `deviceProfile()` call outside a hook also sees it.
 */
export async function refineDeviceProfileForNative(): Promise<DeviceProfile | null> {
	const info = await nativeSystemInfo()
	if (!info) return null
	const memoryGb = info.totalMemoryBytes / 1024 ** 3
	const cores = info.cpuCores
	const maxDimension = memoryGb >= 16 ? 7680 : memoryGb >= 8 ? 3840 : memoryGb >= 4 ? 1920 : 1280
	const profile: DeviceProfile = {
		mobile: info.os === 'android' || info.os === 'ios',
		ios: info.os === 'ios',
		memoryGb: Math.round(memoryGb * 10) / 10,
		cores,
		maxDimension,
		maxScale: maxDimension >= 3840 ? 4 : maxDimension >= 1920 ? 2 : 1,
		encoderQueueDepth: Math.min(16, Math.max(6, cores)),
		constrained: memoryGb < 4,
	}
	cached = profile
	return profile
}

/**
 * The profile, read after mount.
 *
 * A client component still renders once on the server, where there is no
 * screen to measure. Reading the real profile in an effect keeps the first
 * paint identical on both sides and avoids a hydration mismatch on the one
 * piece of UI whose whole job is to describe the device. A second effect
 * then asks the native shell (if any) for the machine's real specs and
 * upgrades the profile again - two steps, because the native check is async
 * and must never block or alter the first, SSR-safe paint.
 */
export function useDeviceProfile(): DeviceProfile {
	const [profile, setProfile] = useState<DeviceProfile>(DESKTOP)
	useEffect(() => {
		setProfile(deviceProfile())
	}, [])
	useEffect(() => {
		let active = true
		void refineDeviceProfileForNative().then((native) => {
			if (active && native) setProfile(native)
		})
		return () => {
			active = false
		}
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
