'use client'

import { useRef, useState } from 'react'
import type { ResumeDesign, ResumeVersion } from '../../lib/resume/types'
import { IconAlert, IconCopy, IconDownload, IconFile, IconSliders } from '../Icons'

const ACCENTS = ['#334155', '#1d4ed8', '#047857', '#7c3aed', '#b45309']

export default function ResumeCanvasToolbar({
	design,
	textView,
	versions,
	canUndo,
	canRedo,
	onDesign,
	onTextView,
	onUndo,
	onRedo,
	onSaveVersion,
	onRestoreVersion,
	onDeleteVersion,
	onExportBackup,
	onImportBackup,
}: {
	design: ResumeDesign
	textView: boolean
	versions: ResumeVersion[]
	canUndo: boolean
	canRedo: boolean
	onDesign: (design: ResumeDesign) => void
	onTextView: (value: boolean) => void
	onUndo: () => void
	onRedo: () => void
	onSaveVersion: () => void
	onRestoreVersion: (id: string) => void
	onDeleteVersion: (id: string) => void
	onExportBackup: () => void
	onImportBackup: (value: unknown) => void
}) {
	const [open, setOpen] = useState<'design' | 'versions' | null>(null)
	const [importError, setImportError] = useState('')
	const inputRef = useRef<HTMLInputElement>(null)

	const importFile = async (file: File | null) => {
		if (!file) return
		setImportError('')
		try {
			onImportBackup(JSON.parse(await file.text()) as unknown)
			setOpen(null)
		} catch (error) {
			setImportError(error instanceof Error ? error.message : 'The backup file is not valid JSON.')
		} finally {
			if (inputRef.current) inputRef.current.value = ''
		}
	}

	return (
		<div className="resume-canvas-toolbar">
			<div className="resume-toolbar-group">
				<button disabled={!canUndo} aria-label="Undo resume edit" title="Undo" onClick={onUndo}>↶</button>
				<button disabled={!canRedo} aria-label="Redo resume edit" title="Redo" onClick={onRedo}>↷</button>
			</div>
			<div className="resume-toolbar-group">
				<button data-active={open === 'design'} onClick={() => setOpen((value) => value === 'design' ? null : 'design')}><IconSliders size={12} /> Design</button>
				<button data-active={textView} onClick={() => onTextView(!textView)}><IconFile size={12} /> ATS text</button>
			</div>
			<div className="resume-toolbar-spacer" />
			<div className="resume-toolbar-group">
				<button onClick={onSaveVersion}><IconCopy size={12} /> Save version</button>
				<button data-active={open === 'versions'} onClick={() => setOpen((value) => value === 'versions' ? null : 'versions')}>Versions <b>{versions.length}</b></button>
			</div>

			{open === 'design' ? (
				<div className="resume-toolbar-popover resume-design-popover">
					<label>ATS-safe template</label>
					<div className="resume-template-options">
						{(['classic', 'modern', 'compact'] as const).map((template) => <button data-active={design.template === template} key={template} onClick={() => onDesign({ ...design, template })}>{template}</button>)}
					</div>
					<label>Accent color</label>
					<div className="resume-accent-options">
						{ACCENTS.map((accent) => <button aria-label={`Use ${accent} accent`} data-active={design.accent === accent} key={accent} style={{ background: accent }} onClick={() => onDesign({ ...design, accent })} />)}
					</div>
					<label htmlFor="resume-font-scale">Text size <span>{Math.round(design.fontScale * 100)}%</span></label>
					<input id="resume-font-scale" type="range" min="0.88" max="1.12" step="0.02" value={design.fontScale} onChange={(event) => onDesign({ ...design, fontScale: Number(event.target.value) })} />
					<label htmlFor="resume-section-spacing">Section spacing <span>{Math.round(design.sectionSpacing * 100)}%</span></label>
					<input id="resume-section-spacing" type="range" min="0.78" max="1.2" step="0.02" value={design.sectionSpacing} onChange={(event) => onDesign({ ...design, sectionSpacing: Number(event.target.value) })} />
					<label>Page size</label>
					<div className="resume-template-options">
						{(['letter', 'a4'] as const).map((pageSize) => <button data-active={design.pageSize === pageSize} key={pageSize} onClick={() => onDesign({ ...design, pageSize })}>{pageSize.toUpperCase()}</button>)}
					</div>
				</div>
			) : null}

			{open === 'versions' ? (
				<div className="resume-toolbar-popover resume-version-popover">
					<div className="resume-popover-heading"><strong>Local versions</strong><small>Stored only on this device</small></div>
					{versions.length ? <div className="resume-version-list">{versions.map((version) => (
						<div key={version.id}>
							<span><strong>{version.name}</strong><small>{new Date(version.createdAt).toLocaleString()}</small></span>
							<button onClick={() => onRestoreVersion(version.id)}>Restore</button>
							<button aria-label={`Delete ${version.name}`} onClick={() => onDeleteVersion(version.id)}>×</button>
						</div>
					))}</div> : <p>No saved versions yet.</p>}
					<div className="resume-backup-actions">
						<button onClick={onExportBackup}><IconDownload size={11} /> Export JSON backup</button>
						<button onClick={() => inputRef.current?.click()}><IconFile size={11} /> Import backup</button>
						<input ref={inputRef} type="file" accept="application/json,.json" onChange={(event) => void importFile(event.target.files?.[0] ?? null)} />
					</div>
					{importError ? <span className="resume-import-error"><IconAlert size={11} /> {importError}</span> : null}
				</div>
			) : null}
		</div>
	)
}
