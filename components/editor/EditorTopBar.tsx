'use client'

import { IconDownload, IconHistory, IconLogo, IconTrash } from '../Icons'
import StudioNav from '../StudioNav'
import ThemeToggle from '../ThemeToggle'
import { SaveBadge } from '../SaveState'
import type { VaultStatus } from '../../lib/persist/use-vault'
import type { CloudState } from '../../lib/cloud/use-cloud'
import RunLocationToggle from '../cloud/RunLocationToggle'

export default function EditorTopBar({
	projectName,
	save,
	canUndo,
	canRedo,
	onUndo,
	onRedo,
	onExport,
	onReset,
	standalone = false,
	cloud,
}: {
	projectName: string
	save: { status: VaultStatus; savedAt: number | null; error: string | null }
	canUndo: boolean
	canRedo: boolean
	onUndo: () => void
	onRedo: () => void
	onExport: () => void
	onReset: () => void
	/** true in the native desktop/mobile shell (`apps/editor-native`), which has no other studios to link to */
	standalone?: boolean
	cloud: CloudState
}) {
	return (
		<header className="topbar">
			<div className="brand">
				<span className="brand-mark">
					<IconLogo size={15} />
				</span>
				<span className="brand-text">
					Editor Studio
					<span className="brand-sub">multi-track editing and rendering, in cloud or local mode</span>
				</span>
			</div>

			<div className="topbar-spacer" />

			<span className="chip chip--static" title="Project name">
				{projectName}
			</span>

			<div className="editor-history-controls" role="group" aria-label="History">
				<button type="button" className="icon-btn" title="Undo (Ctrl+Z)" onClick={onUndo} disabled={!canUndo}>
					<IconHistory size={14} style={{ transform: 'scaleX(-1)' }} />
				</button>
				<button type="button" className="icon-btn" title="Redo (Ctrl+Shift+Z)" onClick={onRedo} disabled={!canRedo}>
					<IconHistory size={14} />
				</button>
			</div>

			<SaveBadge status={save.status} savedAt={save.savedAt} error={save.error} />
			<RunLocationToggle cloud={cloud} />

			<div className="topbar-actions">
				<button type="button" className="btn btn--primary btn--sm" onClick={onExport}>
					<IconDownload size={13} /> Export
				</button>

				{standalone ? null : <StudioNav current="editor" />}

				<ThemeToggle />

				<button type="button" className="icon-btn" onClick={onReset} title="Start a new project" aria-label="Start a new project">
					<IconTrash size={14} />
				</button>
			</div>
		</header>
	)
}
