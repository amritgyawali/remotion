'use client'

import { IconBrowser, IconCaptions, IconCheck, IconServer, IconTrash } from '../Icons'
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
	onReset,
	canReset,
}: {
	steps: StudioStep[]
	engine: RenderEngine
	capabilities: ServerCapabilities
	webCodecs: boolean
	crossOriginIsolated: boolean
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
				Subtitle Studio
				<span className="brand-sub">video in, captioned video out</span>
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

			{/* A full page load on purpose: the cross-origin isolation that the
			    speech model needs is granted per document, not per client-side route. */}
			<a className="btn btn--ghost btn--sm" href="/">
				Code studio
			</a>

			<button className="btn btn--ghost btn--sm" onClick={onReset} disabled={!canReset}>
				<IconTrash size={13} />
				Reset
			</button>
		</header>
	)
}
