'use client'

import { IconBrowser, IconCaptions, IconCheck, IconServer, IconTrash } from '../Icons'
import StudioNav from '../StudioNav'
import ThemeToggle from '../ThemeToggle'
import { SaveBadge } from '../SaveState'
import type { VaultStatus } from '../../lib/persist/use-vault'
import type { RenderEngine, ServerCapabilities } from '../../lib/types'

export type StudioStep = {
	id: string
	label: string
	done: boolean
}

export default function CaptionTopBar({
	steps,
	engine,
	capabilities,
	webCodecs,
	crossOriginIsolated,
	save,
	onReset,
	canReset,
}: {
	steps: StudioStep[]
	engine: RenderEngine
	capabilities: ServerCapabilities
	webCodecs: boolean
	crossOriginIsolated: boolean
	save: { status: VaultStatus; savedAt: number | null; error: string | null }
	onReset: () => void
	canReset: boolean
}) {
	const activeIndex = steps.findIndex((step) => !step.done)

	return (
		<header className="topbar">
			<div className="brand">
				<span className="brand-mark">
					<IconCaptions size={15} />
				</span>
				<span className="brand-text">
					Subtitle Studio
					<span className="brand-sub">video in, captioned video out</span>
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

			<SaveBadge status={save.status} savedAt={save.savedAt} error={save.error} />

			<span
				className={`badge ${crossOriginIsolated ? 'badge--green' : 'badge--muted'}`}
				title={
					crossOriginIsolated
						? 'This page is cross-origin isolated, so on-device speech recognition can run'
						: 'Without cross-origin isolation the browser blocks the speech model - write or import the transcript instead'
				}
			>
				{crossOriginIsolated ? 'on-device speech ready' : 'speech model unavailable'}
			</span>

			<span
				className={`badge ${engine === 'server' ? 'badge--orange' : webCodecs ? 'badge--green' : 'badge--red'}`}
			>
				{engine === 'server' ? <IconServer size={11} /> : <IconBrowser size={11} />}
				{engine === 'server'
					? capabilities.provider === 'vercel-sandbox'
						? 'Vercel Sandbox'
						: 'Server engine'
					: 'Browser engine'}
			</span>

			<div className="topbar-actions">
				<StudioNav current="captions" />

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
