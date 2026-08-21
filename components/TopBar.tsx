'use client'

import { IconBrowser, IconCaptions, IconLogo, IconServer, IconTrash } from './Icons'
import ThemeToggle from './ThemeToggle'
import type { RenderEngine, ServerCapabilities, VirtualProject } from '../lib/types'

export default function TopBar({
	project,
	engine,
	capabilities,
	webCodecs,
	onReset,
}: {
	project: VirtualProject | null
	engine: RenderEngine
	capabilities: ServerCapabilities
	webCodecs: boolean
	onReset: () => void
}) {
	const engineLabel =
		engine === 'server'
			? capabilities.provider === 'vercel-sandbox'
				? 'Vercel Sandbox'
				: 'Server'
			: 'This device'

	return (
		<header className="topbar">
			<div className="brand">
				<span className="brand-mark">
					<IconLogo size={15} />
				</span>
				<span className="brand-text">
					Remotion Video Studio
					<span className="brand-sub">describe it, watch it, download it</span>
				</span>
			</div>

			<div className="topbar-spacer" />

			{project ? (
				<span className="chip chip--static" title={`Entry file: ${project.entry}`}>
					{project.name}
				</span>
			) : null}

			<span
				className={`badge ${engine === 'server' ? 'badge--orange' : webCodecs ? 'badge--green' : 'badge--red'}`}
				title={
					engine === 'server'
						? capabilities.provider === 'vercel-sandbox'
							? 'Rendering happens in an isolated Vercel Sandbox VM'
							: 'Rendering happens on the configured Node host with headless Chrome'
						: webCodecs
							? 'Rendering happens on this device with WebCodecs - nothing is uploaded'
							: 'This browser has no WebCodecs support'
				}
			>
				{engine === 'server' ? <IconServer size={11} /> : <IconBrowser size={11} />}
				{engineLabel}
			</span>

			<div className="topbar-actions">
				{/* A plain link, not next/link: /captions is served with cross-origin
				    isolation headers that a client-side navigation would not pick up. */}
				<a className="btn btn--ghost btn--sm" href="/captions" title="Add subtitles to a video">
					<IconCaptions size={13} />
					<span className="btn-label">Subtitles</span>
				</a>

				<ThemeToggle />

				<button
					className="icon-btn"
					onClick={onReset}
					disabled={!project}
					title="Start over"
					aria-label="Start over"
				>
					<IconTrash size={14} />
				</button>
			</div>
		</header>
	)
}
