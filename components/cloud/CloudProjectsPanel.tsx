'use client'

/**
 * Saved workspaces that live on the server rather than in this browser.
 *
 * Every studio already writes a JSON snapshot to the local vault on a timer.
 * Cloud mode sends that same snapshot to Supabase on a debounce. This panel
 * also supports an immediate save and lists what
 * came back - so the work survives a cleared browser, a different machine, or a
 * phone picking up where a laptop stopped.
 *
 * The active row is shared with the autosave hook so opening a workspace makes
 * subsequent edits update that workspace rather than creating duplicates.
 */

import { useCallback, useEffect, useState } from 'react'
import {
	deleteCloudProject,
	listCloudProjects,
	readCloudProject,
	saveCloudProject,
} from '../../lib/cloud/client'
import type { CloudProjectSummary, StudioId } from '../../lib/cloud/types'
import type { CloudState } from '../../lib/cloud/use-cloud'
import { agoLabel, useNow } from '../../lib/persist/use-vault'
import { IconCheck, IconCloudUp, IconHistory, IconSpinner, IconTrash } from '../Icons'
import { CLOUD_PROJECT_EVENT, readActiveCloudProject, rememberActiveCloudProject } from '../../lib/cloud/use-project-autosave'

export type CloudSnapshot = {
	name: string
	version: number
	data: unknown
	posterUrl?: string | null
}

export default function CloudProjectsPanel({
	studio,
	cloud,
	snapshot,
	onOpen,
	note = null,
	title = 'Cloud projects',
}: {
	studio: StudioId
	cloud: CloudState
	/** what to save right now, or null when there is nothing worth saving */
	snapshot: () => CloudSnapshot | null
	/** hand a restored snapshot back to the studio that owns it */
	onOpen: (data: unknown, project: CloudProjectSummary) => void | Promise<void>
	/** a line the studio wants shown here, usually what an open just changed */
	note?: string | null
	title?: string
}) {
	const [projects, setProjects] = useState<CloudProjectSummary[]>([])
	const [loading, setLoading] = useState(false)
	const [busyId, setBusyId] = useState<string | null>(null)
	const [saving, setSaving] = useState(false)
	const [savedId, setSavedId] = useState<string | null>(null)
	const [error, setError] = useState<string | null>(null)
	const now = useNow(30_000, projects.length > 0)

	useEffect(() => {
		setSavedId(readActiveCloudProject(studio))
	}, [studio])

	const refresh = useCallback(async () => {
		if (!cloud.available || cloud.location !== 'cloud') return
		setLoading(true)
		try {
			setProjects(await listCloudProjects(studio))
			setError(null)
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : 'Could not list cloud projects.')
		} finally {
			setLoading(false)
		}
	}, [cloud.available, cloud.location, studio])

	useEffect(() => {
		const changed = (event: Event) => {
			const detail = (event as CustomEvent<{ studio: StudioId; id: string | null }>).detail
			if (detail?.studio !== studio) return
			setSavedId(detail.id)
			void refresh()
		}
		window.addEventListener(CLOUD_PROJECT_EVENT, changed)
		return () => window.removeEventListener(CLOUD_PROJECT_EVENT, changed)
	}, [refresh, studio])

	useEffect(() => {
		void refresh()
	}, [refresh])

	if (!cloud.available || cloud.location !== 'cloud') return null

	const save = async () => {
		const payload = snapshot()
		if (!payload) {
			setError('There is nothing in this studio to save yet.')
			return
		}
		setSaving(true)
		setError(null)
		try {
			// Saving over the project this session last saved keeps one row per
			// workspace instead of a new one on every press.
			const project = await saveCloudProject({ id: readActiveCloudProject(studio) ?? savedId, studio, ...payload })
			setSavedId(project.id)
			rememberActiveCloudProject(studio, project.id)
			await refresh()
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : 'Could not save to the cloud.')
		} finally {
			setSaving(false)
		}
	}

	const open = async (summary: CloudProjectSummary) => {
		setBusyId(summary.id)
		setError(null)
		try {
			const project = await readCloudProject(summary.id)
			setSavedId(project.id)
			rememberActiveCloudProject(studio, project.id)
			await onOpen(project.data, project)
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : 'Could not open that project.')
		} finally {
			setBusyId(null)
		}
	}

	const remove = async (summary: CloudProjectSummary) => {
		setBusyId(summary.id)
		try {
			await deleteCloudProject(summary.id)
			if (savedId === summary.id) {
				setSavedId(null)
				rememberActiveCloudProject(studio, null)
			}
			await refresh()
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : 'Could not delete that project.')
		} finally {
			setBusyId(null)
		}
	}

	return (
		<section className="cloud-projects">
			<header className="cloud-projects-head">
				<h3>{title}</h3>
				<button type="button" className="btn btn--ghost btn--sm" onClick={save} disabled={saving}>
					{saving ? <IconSpinner size={13} /> : <IconCloudUp size={13} />}
					{saving ? 'Saving' : 'Save now'}
				</button>
			</header>

			<p className="cloud-projects-hint">
				{cloud.signedIn
					? `Autosaving to Supabase as ${cloud.email ?? 'your account'} - these follow you to any browser.`
					: 'Autosaving to Supabase for this browser. Sign in to use the same workspace on every device.'}
			</p>

			{note ? <p className="cloud-projects-hint">{note}</p> : null}

			{error ? <p className="cloud-projects-error">{error}</p> : null}

			{loading && projects.length === 0 ? (
				<p className="cloud-projects-empty">
					<IconSpinner size={13} /> Looking for saved work
				</p>
			) : projects.length === 0 ? (
				<p className="cloud-projects-empty">
					<IconHistory size={13} /> Nothing saved yet.
				</p>
			) : (
				<ul className="cloud-projects-list">
					{projects.map((project) => (
						<li key={project.id} data-current={project.id === savedId || undefined}>
							<button
								type="button"
								className="cloud-project-open"
								onClick={() => void open(project)}
								disabled={busyId === project.id}
								title="Load this workspace into the studio"
							>
								<strong>{project.name}</strong>
								<em>
									{project.id === savedId ? (
										<>
											<IconCheck size={11} /> saved{' '}
										</>
									) : null}
									{agoLabel(new Date(project.updatedAt).getTime(), now)}
								</em>
							</button>
							<button
								type="button"
								className="icon-btn icon-btn--sm"
								onClick={() => void remove(project)}
								disabled={busyId === project.id}
								aria-label={`Delete ${project.name}`}
								title="Delete from the cloud"
							>
								<IconTrash size={13} />
							</button>
						</li>
					))}
				</ul>
			)}
		</section>
	)
}
