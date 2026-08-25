'use client'

/**
 * The two pieces of UI that make local persistence believable.
 *
 * A badge that says, at a glance, whether the work is safe - and a notice, on
 * the way back in, that says what was brought back and offers the one thing a
 * returning visitor might actually want instead: a clean slate.
 */

import { useEffect, useState } from 'react'
import { agoLabel, useNow, type VaultStatus } from '../lib/persist/use-vault'
import { IconAlert, IconCheck, IconCloudOff, IconClose, IconHistory, IconSpinner } from './Icons'

export function SaveBadge({
	status,
	savedAt,
	error,
	compact = false,
}: {
	status: VaultStatus
	savedAt: number | null
	error?: string | null
	compact?: boolean
}) {
	// Only ticks while there is a timestamp to age, so an idle tab stays idle.
	const now = useNow(15_000, savedAt !== null)

	if (status === 'unsupported') {
		return (
			<span className="save-badge save-badge--off" title="This browser is not storing the session - private mode, or storage is blocked.">
				<IconCloudOff size={12} />
				{compact ? null : <span>Not saved</span>}
			</span>
		)
	}

	if (status === 'error') {
		return (
			<span className="save-badge save-badge--error" title={error ?? 'The workspace could not be saved.'}>
				<IconAlert size={12} />
				{compact ? null : <span>Save failed</span>}
			</span>
		)
	}

	if (status === 'saving') {
		return (
			<span className="save-badge save-badge--busy" title="Writing this workspace to your browser">
				<IconSpinner size={12} />
				{compact ? null : <span>Saving</span>}
			</span>
		)
	}

	if (status === 'saved' && savedAt) {
		return (
			<span className="save-badge save-badge--ok" title="Saved in this browser - a refresh will bring it all back">
				<IconCheck size={12} />
				{compact ? null : <span>Saved {agoLabel(savedAt, now)}</span>}
			</span>
		)
	}

	return (
		<span className="save-badge" title="Your work is saved to this browser automatically">
			<IconHistory size={12} />
			{compact ? null : <span>Autosave on</span>}
		</span>
	)
}

/**
 * Shown once, after a workspace comes back.
 *
 * It self-dismisses: a persistent bar would be a permanent tax on every visit
 * for a fact that matters for about four seconds.
 */
export function RestoreNotice({
	updatedAt,
	summary,
	warning,
	onDiscard,
	discardLabel = 'Start fresh',
}: {
	updatedAt: number | null
	summary: string
	warning?: string | null
	onDiscard: () => void
	discardLabel?: string
}) {
	const [dismissed, setDismissed] = useState(false)
	const now = useNow(20_000, true)

	useEffect(() => {
		// A warning is worth reading twice; a plain confirmation is not.
		const timer = window.setTimeout(() => setDismissed(true), warning ? 16_000 : 9_000)
		return () => window.clearTimeout(timer)
	}, [warning])

	if (dismissed) return null

	return (
		<div className="restore-notice" data-tone={warning ? 'warn' : 'ok'} role="status">
			<span className="restore-notice-mark">
				{warning ? <IconAlert size={15} /> : <IconHistory size={15} />}
			</span>
			<div className="restore-notice-copy">
				<strong>
					{warning ? 'Session partly restored' : 'Welcome back'}
					{updatedAt ? <em>· last saved {agoLabel(updatedAt, now)}</em> : null}
				</strong>
				<span>{warning ?? summary}</span>
			</div>
			<button
				type="button"
				className="restore-notice-action"
				onClick={() => {
					setDismissed(true)
					onDiscard()
				}}
			>
				{discardLabel}
			</button>
			<button
				type="button"
				className="restore-notice-close"
				aria-label="Dismiss"
				onClick={() => setDismissed(true)}
			>
				<IconClose size={13} />
			</button>
		</div>
	)
}
