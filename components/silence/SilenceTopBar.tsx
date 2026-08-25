'use client'

import { IconCheck, IconScissors, IconTrash } from '../Icons'
import StudioNav from '../StudioNav'
import ThemeToggle from '../ThemeToggle'
import { SaveBadge } from '../SaveState'
import type { VaultStatus } from '../../lib/persist/use-vault'

export type StudioStep = {
	id: string
	label: string
	done: boolean
}

export default function SilenceTopBar({
	steps,
	webCodecs,
	savedLabel,
	save,
	onReset,
	canReset,
}: {
	steps: StudioStep[]
	webCodecs: boolean
	/** "4m 20s saved" - the one number this studio exists to produce */
	savedLabel: string | null
	save: { status: VaultStatus; savedAt: number | null; error: string | null }
	onReset: () => void
	canReset: boolean
}) {
	const activeIndex = steps.findIndex((step) => !step.done)

	return (
		<header className="topbar">
			<div className="brand">
				<span className="brand-mark">
					<IconScissors size={15} />
				</span>
				<span className="brand-text">
					Silence Studio
					<span className="brand-sub">dead air out, everything else untouched</span>
				</span>
			</div>

			<ol className="steps">
				{steps.map((step, index) => (
					<li
						key={step.id}
						className="step"
						data-done={step.done}
						data-active={index === activeIndex}
					>
						<span className="step-dot">{step.done ? <IconCheck size={11} /> : index + 1}</span>
						{step.label}
					</li>
				))}
			</ol>

			<div className="topbar-spacer" />

			{savedLabel ? (
				<span className="badge badge--green" title="How much shorter the finished cut is">
					{savedLabel} shorter
				</span>
			) : null}

			<SaveBadge status={save.status} savedAt={save.savedAt} error={save.error} />

			<span
				className={`badge ${webCodecs ? 'badge--green' : 'badge--red'}`}
				title={
					webCodecs
						? 'This browser can decode and re-encode video locally, so nothing is uploaded'
						: 'This browser has no WebCodecs support, so the cut cannot be exported here'
				}
			>
				{webCodecs ? 'local encoder ready' : 'no local encoder'}
			</span>

			<div className="topbar-actions">
				<StudioNav current="silence" />

				<ThemeToggle />

				<button
					className="icon-btn"
					onClick={onReset}
					disabled={!canReset}
					title="Start over"
					aria-label="Start over"
				>
					<IconTrash size={14} />
				</button>
			</div>
		</header>
	)
}
