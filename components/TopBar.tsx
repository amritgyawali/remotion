'use client'

import { IconBolt, IconBrowser, IconLogo, IconServer, IconTrash } from './Icons'
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
	return (
		<header className="topbar">
			<div className="brand">
				<span className="brand-mark">
					<IconLogo size={15} />
				</span>
				Remotion Video Studio
				<span className="brand-sub">code file in, rendered video out</span>
			</div>

			<div className="topbar-spacer" />

			{project ? (
				<span className="chip chip--static" title={`Entry: ${project.entry}`}>
					{project.name} - {project.files.length} file{project.files.length === 1 ? '' : 's'}
				</span>
			) : null}

			<span
				className={`badge ${engine === 'server' ? 'badge--orange' : webCodecs ? 'badge--green' : 'badge--red'}`}
				title={
					engine === 'server'
						? 'Rendering happens in a serverless function with headless Chrome'
						: webCodecs
							? 'Rendering happens on your GPU with WebCodecs - free and unlimited'
							: 'This browser has no WebCodecs support'
				}
			>
				{engine === 'server' ? <IconServer size={11} /> : <IconBrowser size={11} />}
				{engine === 'server' ? 'Server engine' : 'Browser engine'}
			</span>

			{capabilities.enabled ? (
				<span className="badge badge--muted" title="Server rendering is enabled on this deployment">
					<IconBolt size={11} />
					max power ready
				</span>
			) : null}

			<button className="btn btn--ghost btn--sm" onClick={onReset} disabled={!project}>
				<IconTrash size={13} />
				Reset
			</button>
		</header>
	)
}
