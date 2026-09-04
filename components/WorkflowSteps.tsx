'use client'

import { IconCheck } from './Icons'

export type WorkflowStep<Id extends string> = {
	id: Id
	label: string
	hint: string
	done?: boolean
}

/**
 * One workflow navigator shared by every video surface.
 *
 * It is a progress rail below the desktop toolbar and a thumb-reachable dock
 * on phones. Keeping one DOM shape for both layouts means keyboard, pointer,
 * and screen-reader users always move through the same ordered steps.
 */
export default function WorkflowSteps<Id extends string>({
	steps,
	active,
	onStep,
	label,
}: {
	steps: WorkflowStep<Id>[]
	active: Id
	onStep: (id: Id) => void
	label: string
}) {
	return (
		<nav className="mobile-tabs workflow-tabs" aria-label={label}>
			{steps.map((step, index) => (
				<button
					type="button"
					key={step.id}
					className="mobile-tab workflow-tab"
					data-active={active === step.id}
					data-done={step.done || undefined}
					aria-current={active === step.id ? 'step' : undefined}
					aria-label={`${index + 1}. ${step.label}. ${step.hint}`}
					onClick={() => onStep(step.id)}
				>
					<span className="workflow-step-marker" data-step={index + 1} aria-hidden="true">
						{step.done ? <IconCheck size={12} /> : null}
					</span>
					<span className="workflow-step-copy" data-hint={step.hint}>
						<strong>{step.label}</strong>
					</span>
				</button>
			))}
		</nav>
	)
}
