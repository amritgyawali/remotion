'use client'

import { useRef } from 'react'
import type { CaptionVideoSource } from '../../lib/captions/types'
import type { ParamSpec, ToolDef } from '../../lib/tools/registry'
import type { RunParams } from '../../lib/tools/runners'
import { formatBytes } from '../../lib/format'
import { IconClose, IconLayers, IconPlus, IconUpload } from '../Icons'

export function resolveMax(spec: Extract<ParamSpec, { type: 'slider' }>, probe: CaptionVideoSource | null): number {
	if (spec.maxFrom === 'durationSeconds') return probe ? Math.max(spec.step, probe.durationInSeconds) : spec.max
	return spec.max
}

export function resolveDefault(spec: Extract<ParamSpec, { type: 'slider' }>, probe: CaptionVideoSource | null): number {
	if (spec.defaultFrom === 'durationSeconds') return probe ? probe.durationInSeconds : spec.default
	if (spec.defaultFrom === 'durationHalf') return probe ? probe.durationInSeconds / 2 : spec.default
	return spec.default
}

/** Fills in every param a tool declares that the stored params object doesn't have yet. */
export function withResolvedDefaults(tool: ToolDef, params: RunParams, probe: CaptionVideoSource | null): RunParams {
	const next: RunParams = { ...params }
	for (const spec of tool.params ?? []) {
		if (next[spec.key] !== undefined) continue
		if (spec.type === 'slider') next[spec.key] = resolveDefault(spec, probe)
		else next[spec.key] = spec.default
	}
	return next
}

function SliderField({
	spec,
	value,
	probe,
	disabled,
	onChange,
}: {
	spec: Extract<ParamSpec, { type: 'slider' }>
	value: number
	probe: CaptionVideoSource | null
	disabled: boolean
	onChange: (value: number) => void
}) {
	const max = resolveMax(spec, probe)
	const display = spec.unit === 's' ? `${value.toFixed(1)}s` : `${Number(value.toFixed(2))}${spec.unit ? ` ${spec.unit}` : ''}`
	return (
		<div className="field">
			<label className="field-label">
				<span>{spec.label}</span>
				<span className="field-value">{display}</span>
			</label>
			<input
				className="range"
				type="range"
				min={spec.min}
				max={max}
				step={spec.step}
				value={Math.min(max, Math.max(spec.min, value))}
				disabled={disabled}
				onChange={(event) => onChange(Number(event.target.value))}
				aria-label={spec.label}
			/>
			{spec.hint ? <span className="field-hint">{spec.hint}</span> : null}
		</div>
	)
}

export default function ToolParamForm({
	tool,
	params,
	probe,
	disabled,
	secondaryFile,
	batchFiles,
	onChange,
	onSecondaryFile,
	onBatchFiles,
}: {
	tool: ToolDef
	params: RunParams
	probe: CaptionVideoSource | null
	disabled: boolean
	secondaryFile: File | null
	batchFiles: File[]
	onChange: (key: string, value: string | number | boolean) => void
	onSecondaryFile: (file: File | null) => void
	onBatchFiles: (files: File[]) => void
}) {
	const fileRef = useRef<HTMLInputElement>(null)
	const batchRef = useRef<HTMLInputElement>(null)

	if ((!tool.params || tool.params.length === 0) && !tool.secondaryFile && !tool.multiFile) return null

	return (
		<div className="stack" style={{ marginTop: 4 }}>
			{tool.secondaryFile ? (
				<div className="field">
					<label className="field-label">
						<span>{tool.secondaryFile.label}</span>
					</label>
					{secondaryFile ? (
						<div className="media-card-head" style={{ marginTop: 2 }}>
							<span className="media-card-icon">
								<IconUpload size={14} />
							</span>
							<div style={{ minWidth: 0 }}>
								<strong className="media-card-title" title={secondaryFile.name}>
									{secondaryFile.name}
								</strong>
								<span className="media-card-sub">{formatBytes(secondaryFile.size)}</span>
							</div>
							<button className="btn btn--ghost btn--sm" disabled={disabled} onClick={() => onSecondaryFile(null)}>
								Change
							</button>
						</div>
					) : (
						<button className="btn btn--sm" disabled={disabled} onClick={() => fileRef.current?.click()}>
							<IconUpload size={12} /> Choose file
						</button>
					)}
					<input
						ref={fileRef}
						type="file"
						className="sr-only"
						accept={tool.secondaryFile.accept}
						onChange={(event) => {
							const file = event.target.files?.[0] ?? null
							if (file) onSecondaryFile(file)
							event.target.value = ''
						}}
					/>
					<span className="field-hint">{tool.secondaryFile.hint}</span>
				</div>
			) : null}

			{tool.multiFile ? (
				<div className="field">
					<label className="field-label">
						<span>{tool.multiFile.label}</span>
						{batchFiles.length > 0 ? (
							<span className="field-value">
								{batchFiles.length} {batchFiles.length === 1 ? 'file' : 'files'} -{' '}
								{formatBytes(batchFiles.reduce((sum, file) => sum + file.size, 0))}
							</span>
						) : null}
					</label>

					{batchFiles.length > 0 ? (
						<div className="stack" style={{ gap: 4, marginTop: 2 }}>
							{batchFiles.map((file, index) => (
								<div className="media-card-head" key={`${file.name}-${file.size}-${file.lastModified}`}>
									<span className="media-card-icon">
										<IconLayers size={14} />
									</span>
									<div style={{ minWidth: 0 }}>
										<strong className="media-card-title" title={file.name}>
											{index + 1}. {file.name}
										</strong>
										<span className="media-card-sub">{formatBytes(file.size)}</span>
									</div>
									<button
										className="btn btn--ghost btn--sm"
										disabled={disabled}
										aria-label={`Remove ${file.name} from the batch`}
										onClick={() => onBatchFiles(batchFiles.filter((_, other) => other !== index))}
									>
										<IconClose size={12} />
									</button>
								</div>
							))}
						</div>
					) : null}

					<div style={{ display: 'flex', gap: 6, marginTop: batchFiles.length > 0 ? 8 : 2 }}>
						<button className="btn btn--sm" disabled={disabled} onClick={() => batchRef.current?.click()}>
							<IconPlus size={12} /> {batchFiles.length > 0 ? 'Add more' : 'Add files'}
						</button>
						{batchFiles.length > 0 ? (
							<button className="btn btn--ghost btn--sm" disabled={disabled} onClick={() => onBatchFiles([])}>
								Clear
							</button>
						) : null}
					</div>

					<input
						ref={batchRef}
						type="file"
						multiple
						className="sr-only"
						accept={tool.multiFile.accept}
						onChange={(event) => {
							const picked = Array.from(event.target.files ?? [])
							if (picked.length > 0) {
								// Re-picking the same file should not queue it twice - the identity
								// that matters is the file itself, not the order it arrived in.
								const seen = new Set(batchFiles.map((file) => `${file.name}:${file.size}:${file.lastModified}`))
								const fresh = picked.filter((file) => !seen.has(`${file.name}:${file.size}:${file.lastModified}`))
								if (fresh.length > 0) onBatchFiles([...batchFiles, ...fresh])
							}
							event.target.value = ''
						}}
					/>
					<span className="field-hint">{tool.multiFile.hint}</span>
				</div>
			) : null}

			{(tool.params ?? []).map((spec) => {
				const value = params[spec.key]
				if (spec.type === 'slider') {
					return (
						<SliderField
							key={spec.key}
							spec={spec}
							value={typeof value === 'number' ? value : resolveDefault(spec, probe)}
							probe={probe}
							disabled={disabled}
							onChange={(next) => onChange(spec.key, next)}
						/>
					)
				}
				if (spec.type === 'select') {
					return (
						<div className="field" key={spec.key}>
							<label className="field-label">
								<span>{spec.label}</span>
							</label>
							<select
								className="select"
								disabled={disabled}
								value={typeof value === 'string' ? value : spec.default}
								onChange={(event) => onChange(spec.key, event.target.value)}
							>
								{spec.options.map((option) => (
									<option key={option.value} value={option.value}>
										{option.label}
									</option>
								))}
							</select>
							{spec.hint ? <span className="field-hint">{spec.hint}</span> : null}
						</div>
					)
				}
				if (spec.type === 'toggle') {
					return (
						<label className="field-label" key={spec.key} style={{ cursor: disabled ? 'default' : 'pointer' }}>
							<span>{spec.label}</span>
							<input
								type="checkbox"
								disabled={disabled}
								checked={typeof value === 'boolean' ? value : spec.default}
								onChange={(event) => onChange(spec.key, event.target.checked)}
							/>
						</label>
					)
				}
				if (spec.type === 'color') {
					return (
						<div className="field" key={spec.key}>
							<label className="field-label">
								<span>{spec.label}</span>
							</label>
							<input
								type="color"
								disabled={disabled}
								value={typeof value === 'string' ? value : spec.default}
								onChange={(event) => onChange(spec.key, event.target.value)}
								style={{ width: '100%', height: 'var(--h-md)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-strong)', background: 'var(--surface-2)', cursor: disabled ? 'default' : 'pointer' }}
							/>
						</div>
					)
				}
				// text
				return (
					<div className="field" key={spec.key}>
						<label className="field-label">
							<span>{spec.label}</span>
						</label>
						<input
							className="input"
							type="text"
							disabled={disabled}
							placeholder={spec.placeholder}
							value={typeof value === 'string' ? value : spec.default}
							onChange={(event) => onChange(spec.key, event.target.value)}
						/>
						{spec.hint ? <span className="field-hint">{spec.hint}</span> : null}
					</div>
				)
			})}
		</div>
	)
}
