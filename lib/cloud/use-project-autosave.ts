'use client'

import { useEffect, useRef, useState } from 'react'
import { saveCloudProject } from './client'
import type { StudioId } from './types'
import type { CloudState } from './use-cloud'
import type { CloudSnapshot } from '../../components/cloud/CloudProjectsPanel'

const activeKey = (studio: StudioId) => `rvs:cloud-project:${studio}`
export const CLOUD_PROJECT_EVENT = 'rvs:cloud-project-changed'

export function readActiveCloudProject(studio: StudioId): string | null {
	if (typeof window === 'undefined') return null
	try {
		return window.localStorage.getItem(activeKey(studio))
	} catch {
		return null
	}
}

export function rememberActiveCloudProject(studio: StudioId, id: string | null): void {
	if (typeof window === 'undefined') return
	const previous = readActiveCloudProject(studio)
	try {
		if (id) window.localStorage.setItem(activeKey(studio), id)
		else window.localStorage.removeItem(activeKey(studio))
	} catch {
		// Autosave still works for this tab when storage is blocked.
	}
	if (previous !== id) {
		window.dispatchEvent(new CustomEvent(CLOUD_PROJECT_EVENT, { detail: { studio, id } }))
	}
}

/** Debounced and serialized, so a slower request can never overwrite a newer edit. */
export function useCloudProjectAutosave(args: {
	studio: StudioId
	cloud: CloudState
	snapshot: CloudSnapshot | null
	delayMs?: number
}): { saving: boolean; error: string | null; projectId: string | null } {
	const [projectId, setProjectId] = useState<string | null>(null)
	const [saving, setSaving] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const latest = useRef(args.snapshot)
	const queued = useRef(false)
	const running = useRef(false)
	const projectIdRef = useRef<string | null>(null)
	latest.current = args.snapshot

	useEffect(() => {
		const stored = readActiveCloudProject(args.studio)
		projectIdRef.current = stored
		setProjectId(stored)
	}, [args.studio])

	useEffect(() => {
		if (!args.cloud.available || args.cloud.location !== 'cloud' || !args.snapshot) return
		queued.current = true
		const flush = async () => {
			if (running.current) return
			running.current = true
			setSaving(true)
			try {
				while (queued.current) {
					queued.current = false
					const payload = latest.current
					if (!payload) break
					const saved = await saveCloudProject({ id: projectIdRef.current, studio: args.studio, ...payload })
					projectIdRef.current = saved.id
					setProjectId(saved.id)
					rememberActiveCloudProject(args.studio, saved.id)
					setError(null)
				}
			} catch (failure) {
				setError(failure instanceof Error ? failure.message : 'Cloud autosave failed.')
			} finally {
				running.current = false
				setSaving(false)
			}
		}
		const timer = window.setTimeout(() => void flush(), args.delayMs ?? 1500)
		return () => window.clearTimeout(timer)
	}, [args.cloud.available, args.cloud.location, args.delayMs, args.snapshot, args.studio])

	return { saving, error, projectId }
}
