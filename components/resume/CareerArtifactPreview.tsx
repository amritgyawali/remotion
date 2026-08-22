'use client'

import { useState } from 'react'
import type { CareerArtifact } from '../../lib/resume/types'
import { downloadTextFile, safeDocumentName } from '../../lib/resume/toolkit'
import { IconCopy, IconDownload, IconFile, IconSparkle, IconTrash } from '../Icons'

export default function CareerArtifactPreview({
	artifacts,
	selectedId,
	onSelect,
	onChange,
	onDelete,
}: {
	artifacts: CareerArtifact[]
	selectedId: string | null
	onSelect: (id: string) => void
	onChange: (id: string, content: string) => void
	onDelete: (id: string) => void
}) {
	const [copied, setCopied] = useState(false)
	const artifact = artifacts.find((item) => item.id === selectedId) ?? artifacts[0]

	if (!artifact) {
		return (
			<div className="resume-audit-empty">
				<span><IconSparkle size={25} /></span>
				<h2>Your application kit will appear here</h2>
				<p>Generate a tailored cover letter, recruiter email, LinkedIn profile, or interview preparation guide.</p>
			</div>
		)
	}

	const copy = async () => {
		await navigator.clipboard.writeText(artifact.content)
		setCopied(true)
		window.setTimeout(() => setCopied(false), 1_500)
	}

	return (
		<div className="resume-artifact-workspace">
			<div className="resume-artifact-tabs" role="tablist" aria-label="Generated career documents">
				{artifacts.map((item) => (
					<button role="tab" aria-selected={item.id === artifact.id} data-active={item.id === artifact.id} key={item.id} onClick={() => onSelect(item.id)}>
						<IconFile size={11} /> {item.title}
					</button>
				))}
			</div>
			<article className="resume-artifact-paper">
				<header>
					<div><span>Editable NVIDIA draft</span><h2>{artifact.title}</h2><small>{new Date(artifact.createdAt).toLocaleString()}</small></div>
					<div>
						<button className="btn btn--secondary btn--sm" onClick={() => void copy()}><IconCopy size={12} /> {copied ? 'Copied' : 'Copy'}</button>
						<button className="btn btn--secondary btn--sm" onClick={() => downloadTextFile(`${safeDocumentName(artifact.title)}.txt`, artifact.content)}><IconDownload size={12} /> TXT</button>
						<button className="btn btn--ghost btn--sm" aria-label={`Delete ${artifact.title}`} onClick={() => onDelete(artifact.id)}><IconTrash size={12} /></button>
					</div>
				</header>
				<textarea aria-label={`Edit ${artifact.title}`} spellCheck value={artifact.content} onChange={(event) => onChange(artifact.id, event.target.value)} />
				<footer>{artifact.model ? `Generated with ${artifact.model}` : 'Generated with NVIDIA AI'} · Verify all facts before use.</footer>
			</article>
		</div>
	)
}
