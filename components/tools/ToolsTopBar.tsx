'use client'

import { IconTools, IconTrash } from '../Icons'
import StudioNav from '../StudioNav'
import ThemeToggle from '../ThemeToggle'
import { SaveBadge } from '../SaveState'
import type { VaultStatus } from '../../lib/persist/use-vault'
import { READY_COUNT, TOTAL_COUNT } from '../../lib/tools/registry'

export default function ToolsTopBar({
	webCodecs,
	save,
	onReset,
	canReset,
}: {
	webCodecs: boolean
	save: { status: VaultStatus; savedAt: number | null; error: string | null }
	onReset: () => void
	canReset: boolean
}) {
	return (
		<header className="topbar">
			<div className="brand">
				<span className="brand-mark">
					<IconTools size={15} />
				</span>
				<span className="brand-text">
					Tools Studio
					<span className="brand-sub">{READY_COUNT} working tools, {TOTAL_COUNT - READY_COUNT} more on the way</span>
				</span>
			</div>

			<div className="topbar-spacer" />

			<SaveBadge status={save.status} savedAt={save.savedAt} error={save.error} />

			<span
				className={`badge ${webCodecs ? 'badge--green' : 'badge--red'}`}
				title={
					webCodecs
						? 'This browser can decode and re-encode video locally, so nothing is uploaded'
						: 'This browser has no WebCodecs support, so tools cannot export here'
				}
			>
				{webCodecs ? 'local encoder ready' : 'no local encoder'}
			</span>

			<div className="topbar-actions">
				<StudioNav current="tools" />

				<ThemeToggle />

				<button className="icon-btn" onClick={onReset} disabled={!canReset} title="Start over" aria-label="Start over">
					<IconTrash size={14} />
				</button>
			</div>
		</header>
	)
}
