'use client'

import { IconCheck, IconChevronLeft, IconChevronRight } from './Icons'

export type WorkflowStep<Id extends string> = {
	id: Id
	label: string
	hint: string
	done?: boolean
	/** Blocks the step until the work it depends on exists. */
	locked?: boolean
	/** Why the step is locked, said in the tooltip rather than in a dialog. */
	lockedHint?: string
}

/**
 * One workflow navigator shared by every video surface.
 *
 * It is a progress rail below the desktop toolbar and a thumb-reachable dock
 * on phones. Keeping one DOM shape for both layouts means keyboard, pointer,
 * and screen-reader users always move through the same ordered steps.
 *
 * The rail is also the wizard's transport: a Back and a Continue button sit at
 * either end so the flow can be walked without aiming at a specific pill, which
 * is what a step-by-step surface is expected to offer. Both skip over locked
 * steps, so "Continue" never lands somewhere with nothing to do.
 */
export default function WorkflowSteps<Id extends string>({
	steps,
	active,
	onStep,
	label,
	nav = true,
	nextLabel,
}: {
	steps: WorkflowStep<Id>[]
	active: Id
	onStep: (id: Id) => void
	label: string
	/** Set false for surfaces whose steps are not meant to be walked in order. */
	nav?: boolean
	/** Overrides the wording on the forward button for the current step. */
	nextLabel?: string
}) {
	// The step you are standing on is never locked, whatever its condition says:
	// a restored session can land on a step whose input has since been cleared,
	// and greying out the pill you are looking at explains nothing.
	const shown = steps.map((step) => (step.id === active ? { ...step, locked: false } : step))
	const index = shown.findIndex((step) => step.id === active)
	const previous = index > 0 ? shown.slice(0, index).reverse().find((step) => !step.locked) : undefined
	const next = index >= 0 ? shown.slice(index + 1).find((step) => !step.locked) : undefined

	return (
		<nav className="mobile-tabs workflow-tabs" aria-label={label}>
			{nav ? (
				<button
					type="button"
					className="workflow-nav"
					disabled={!previous}
					onClick={() => previous && onStep(previous.id)}
					title={previous ? `Back to ${previous.label}` : 'This is the first step'}
					aria-label={previous ? `Back to ${previous.label}` : 'This is the first step'}
				>
					<IconChevronLeft size={14} />
					<span className="workflow-nav-label">Back</span>
				</button>
			) : null}

			<div className="workflow-track">
				{shown.map((step, position) => (
					<button
						type="button"
						key={step.id}
						className="mobile-tab workflow-tab"
						data-active={active === step.id}
						data-done={step.done || undefined}
						data-locked={step.locked || undefined}
						disabled={step.locked}
						title={step.locked ? step.lockedHint || `${step.label} is not ready yet` : step.hint}
						aria-current={active === step.id ? 'step' : undefined}
						aria-label={`${position + 1}. ${step.label}. ${
							step.locked ? step.lockedHint || 'Not ready yet' : step.hint
						}`}
						onClick={() => onStep(step.id)}
					>
						<span className="workflow-step-marker" data-step={position + 1} aria-hidden="true">
							{step.done ? <IconCheck size={12} /> : null}
						</span>
						<span className="workflow-step-copy" data-hint={step.hint}>
							<strong>{step.label}</strong>
						</span>
					</button>
				))}
			</div>

			{nav ? (
				<button
					type="button"
					className="workflow-nav workflow-nav--next"
					disabled={!next}
					onClick={() => next && onStep(next.id)}
					title={next ? `Continue to ${next.label}` : 'This is the last step'}
					aria-label={next ? `Continue to ${next.label}` : 'This is the last step'}
				>
					<span className="workflow-nav-label">{nextLabel || (next ? next.label : 'Done')}</span>
					<IconChevronRight size={14} />
				</button>
			) : null}
		</nav>
	)
}
