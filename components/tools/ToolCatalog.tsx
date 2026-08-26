'use client'

import { useMemo } from 'react'
import { CATEGORIES, TOOLS, type ToolCategory, type ToolDef } from '../../lib/tools/registry'
import { IconSearch } from '../Icons'

export default function ToolCatalog({
	query,
	category,
	onQuery,
	onCategory,
	onSelect,
}: {
	query: string
	category: ToolCategory | null
	onQuery: (value: string) => void
	onCategory: (value: ToolCategory | null) => void
	onSelect: (id: string) => void
}) {
	const filtered = useMemo(() => {
		const needle = query.trim().toLowerCase()
		return TOOLS.filter((tool) => {
			if (category && tool.category !== category) return false
			if (!needle) return true
			return (
				tool.name.toLowerCase().includes(needle) ||
				tool.short.toLowerCase().includes(needle) ||
				tool.id.includes(needle)
			)
		})
	}, [category, query])

	return (
		<div className="tool-catalog">
			<div className="tool-search">
				<IconSearch size={13} />
				<input
					className="tool-search-input"
					type="search"
					placeholder="Search 50+ tools..."
					value={query}
					onChange={(event) => onQuery(event.target.value)}
					aria-label="Search tools"
				/>
			</div>

			<div className="chip-scroll" role="tablist" aria-label="Categories">
				<button className="chip chip--button" data-active={category === null} onClick={() => onCategory(null)}>
					All
				</button>
				{CATEGORIES.map((cat) => (
					<button
						key={cat.id}
						className="chip chip--button"
						data-active={category === cat.id}
						onClick={() => onCategory(cat.id)}
						title={cat.blurb}
					>
						{cat.label}
					</button>
				))}
			</div>

			<div className="tool-grid">
				{filtered.map((tool) => (
					<ToolCard key={tool.id} tool={tool} onSelect={() => onSelect(tool.id)} />
				))}
				{filtered.length === 0 ? <p className="field-hint" style={{ padding: '10px 2px' }}>No tool matches that search.</p> : null}
			</div>
		</div>
	)
}

function ToolCard({ tool, onSelect }: { tool: ToolDef; onSelect: () => void }) {
	const Icon = tool.icon
	return (
		<button className="tool-card" data-status={tool.status} onClick={onSelect} title={tool.short}>
			<span className="tool-card-icon">
				<Icon size={16} />
			</span>
			<span className="tool-card-body">
				<span className="tool-card-name">
					{tool.name}
					{tool.status === 'soon' ? <span className="badge badge--muted tool-card-badge">soon</span> : null}
					{tool.losslessVideo ? (
						<span className="badge badge--accent tool-card-badge" title="The picture is copied byte-for-byte - only the sound changes">
							lossless
						</span>
					) : null}
				</span>
				<span className="tool-card-desc">{tool.short}</span>
			</span>
		</button>
	)
}
