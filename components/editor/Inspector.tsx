'use client'

/**
 * The contextual right-hand panel: project settings when nothing is
 * selected, or the properties of exactly one selected clip. It never shows
 * all forty possible fields at once - only the ones that apply to what is
 * actually selected, which is the "properties panel that shows only what's
 * relevant" idea the blueprint borrows from Premiere (§1.1).
 */

import type { ChromaKeySpec, Clip, ClipEffects, CropRect, ProjectSettings, TextAlign, TextStyle, Transform } from '../../lib/editor/types'

const ANCHORS: Array<{ id: TextStyle['position']; label: string }> = [
	{ id: 'top-left', label: '↖' },
	{ id: 'top-center', label: '↑' },
	{ id: 'top-right', label: '↗' },
	{ id: 'center', label: '•' },
	{ id: 'bottom-left', label: '↙' },
	{ id: 'bottom-center', label: '↓' },
	{ id: 'bottom-right', label: '↘' },
]

function NumberField({ label, value, step = 1, min, max, onChange }: { label: string; value: number; step?: number; min?: number; max?: number; onChange: (value: number) => void }) {
	return (
		<label className="editor-field">
			<span>{label}</span>
			<input
				type="number"
				value={Number.isFinite(value) ? value : 0}
				step={step}
				min={min}
				max={max}
				onChange={(event) => {
					const next = parseFloat(event.target.value)
					if (Number.isFinite(next)) onChange(next)
				}}
			/>
		</label>
	)
}

/** A slider with its live value printed next to the label - every drag reaches the preview on the same frame, so the readout doubles as confirmation the change landed. */
function RangeField({
	label,
	value,
	min,
	max,
	step,
	format,
	onChange,
}: {
	label: string
	value: number
	min: number
	max: number
	step: number
	format?: (value: number) => string
	onChange: (value: number) => void
}) {
	return (
		<label className="editor-field">
			<span>
				{label} <em className="editor-field-value">{format ? format(value) : value.toFixed(2)}</em>
			</span>
			<input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(parseFloat(event.target.value))} />
		</label>
	)
}

const DEFAULT_CROP: CropRect = { x: 0, y: 0, width: 1, height: 1 }
const DEFAULT_CHROMA_KEY: ChromaKeySpec = { enabled: true, keyColor: '#00b140', tolerance: 0.35, softness: 0.25, spill: 0.5 }

export default function Inspector({
	selectedClip,
	selectionCount,
	projectName,
	settings,
	clipCount,
	onRenameProject,
	onSettings,
	onTransform,
	onAudio,
	onText,
	onSpeed,
	onEffects,
	onCrop,
	onChromaKey,
}: {
	selectedClip: Clip | null
	selectionCount: number
	projectName: string
	settings: ProjectSettings
	clipCount: number
	onRenameProject: (name: string) => void
	onSettings: (fields: Partial<ProjectSettings>) => void
	onTransform: (fields: Partial<Transform>) => void
	onAudio: (fields: Partial<Clip['audio']>) => void
	onText: (fields: Partial<TextStyle>) => void
	onSpeed: (speed: number) => void
	onEffects: (fields: Partial<ClipEffects>) => void
	onCrop: (crop: CropRect | null) => void
	onChromaKey: (chromaKey: ChromaKeySpec | null) => void
}) {
	if (selectionCount > 1) {
		return (
			<div className="editor-inspector">
				<h3>{selectionCount} clips selected</h3>
				<p className="editor-hint">Select a single clip to edit its properties.</p>
			</div>
		)
	}

	if (!selectedClip) {
		return (
			<div className="editor-inspector">
				<h3>Project</h3>
				<label className="editor-field">
					<span>Name</span>
					<input type="text" value={projectName} onChange={(event) => onRenameProject(event.target.value)} />
				</label>
				<div className="editor-field-row">
					<NumberField label="Width" value={settings.width} step={2} min={2} onChange={(width) => onSettings({ width: Math.round(width) })} />
					<NumberField label="Height" value={settings.height} step={2} min={2} onChange={(height) => onSettings({ height: Math.round(height) })} />
				</div>
				<div className="editor-field-row">
					<NumberField label="FPS" value={settings.fps} step={1} min={1} max={240} onChange={(fps) => onSettings({ fps })} />
					<label className="editor-field">
						<span>Background</span>
						<input type="color" value={settings.backgroundColor} onChange={(event) => onSettings({ backgroundColor: event.target.value })} />
					</label>
				</div>
				<p className="editor-hint">{clipCount === 0 ? 'Import media and drop it on the timeline to begin.' : 'Select a clip on the timeline to edit it.'}</p>
			</div>
		)
	}

	const t = selectedClip.transform
	return (
		<div className="editor-inspector">
			<h3>{selectedClip.label}</h3>

			<h4>Transform</h4>
			<div className="editor-field-row">
				<NumberField label="X" value={t.x} onChange={(x) => onTransform({ x })} />
				<NumberField label="Y" value={t.y} onChange={(y) => onTransform({ y })} />
			</div>
			<div className="editor-field-row">
				<NumberField label="Scale X" value={t.scaleX} step={0.05} onChange={(scaleX) => onTransform({ scaleX })} />
				<NumberField label="Scale Y" value={t.scaleY} step={0.05} onChange={(scaleY) => onTransform({ scaleY })} />
			</div>
			<div className="editor-field-row">
				<NumberField label="Rotation" value={t.rotationDeg} step={1} onChange={(rotationDeg) => onTransform({ rotationDeg })} />
				<label className="editor-field">
					<span>Opacity</span>
					<input type="range" min={0} max={1} step={0.01} value={t.opacity} onChange={(event) => onTransform({ opacity: parseFloat(event.target.value) })} />
				</label>
			</div>

			{selectedClip.kind === 'video' || selectedClip.kind === 'audio' ? (
				<>
					<h4>Speed</h4>
					<label className="editor-field">
						<span>Playback rate</span>
						<input type="range" min={0.25} max={4} step={0.05} value={selectedClip.speed} onChange={(event) => onSpeed(parseFloat(event.target.value))} />
					</label>
					<span className="editor-hint">{selectedClip.speed.toFixed(2)}x</span>
				</>
			) : null}

			{selectedClip.kind === 'video' || selectedClip.kind === 'image' ? (
				<>
					<h4>Color &amp; effects</h4>
					<div className="editor-field-row">
						<RangeField label="Brightness" value={selectedClip.effects.brightness} min={0} max={2} step={0.02} onChange={(brightness) => onEffects({ brightness })} />
						<RangeField label="Contrast" value={selectedClip.effects.contrast} min={0} max={2} step={0.02} onChange={(contrast) => onEffects({ contrast })} />
					</div>
					<div className="editor-field-row">
						<RangeField label="Saturation" value={selectedClip.effects.saturation} min={0} max={2} step={0.02} onChange={(saturation) => onEffects({ saturation })} />
						<RangeField
							label="Temperature"
							value={selectedClip.effects.temperature}
							min={-100}
							max={100}
							step={1}
							format={(v) => v.toFixed(0)}
							onChange={(temperature) => onEffects({ temperature })}
						/>
					</div>
					<div className="editor-field-row">
						<RangeField
							label="Hue"
							value={selectedClip.effects.hueRotateDeg}
							min={-180}
							max={180}
							step={1}
							format={(v) => `${v.toFixed(0)}°`}
							onChange={(hueRotateDeg) => onEffects({ hueRotateDeg })}
						/>
						<RangeField label="Blur" value={selectedClip.effects.blurPx} min={0} max={20} step={0.5} format={(v) => `${v.toFixed(1)}px`} onChange={(blurPx) => onEffects({ blurPx })} />
					</div>
					<div className="editor-field-row">
						<RangeField label="Vignette" value={selectedClip.effects.vignette} min={0} max={1} step={0.02} onChange={(vignette) => onEffects({ vignette })} />
						<RangeField label="Grayscale" value={selectedClip.effects.grayscale} min={0} max={1} step={0.02} onChange={(grayscale) => onEffects({ grayscale })} />
					</div>
					<div className="editor-field-row">
						<RangeField label="Sepia" value={selectedClip.effects.sepia} min={0} max={1} step={0.02} onChange={(sepia) => onEffects({ sepia })} />
						<RangeField label="Invert" value={selectedClip.effects.invert} min={0} max={1} step={0.02} onChange={(invert) => onEffects({ invert })} />
					</div>
					{selectedClip.effects.brightness !== 1 ||
					selectedClip.effects.contrast !== 1 ||
					selectedClip.effects.saturation !== 1 ||
					selectedClip.effects.temperature !== 0 ||
					selectedClip.effects.hueRotateDeg !== 0 ||
					selectedClip.effects.blurPx !== 0 ||
					selectedClip.effects.vignette !== 0 ||
					selectedClip.effects.grayscale !== 0 ||
					selectedClip.effects.sepia !== 0 ||
					selectedClip.effects.invert !== 0 ? (
						<button
							type="button"
							className="btn btn--ghost btn--sm"
							onClick={() => onEffects({ brightness: 1, contrast: 1, saturation: 1, temperature: 0, hueRotateDeg: 0, blurPx: 0, vignette: 0, grayscale: 0, sepia: 0, invert: 0 })}
						>
							Reset color &amp; effects
						</button>
					) : null}

					<h4>Crop</h4>
					<label className="editor-field editor-field--checkbox">
						<input type="checkbox" checked={selectedClip.effects.crop !== null} onChange={(event) => onCrop(event.target.checked ? DEFAULT_CROP : null)} />
						<span>Crop this clip</span>
					</label>
					{selectedClip.effects.crop ? (
						<>
							<div className="editor-field-row">
								<RangeField label="Left" value={selectedClip.effects.crop.x} min={0} max={0.9} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(x) => onCrop({ ...selectedClip.effects.crop!, x })} />
								<RangeField label="Top" value={selectedClip.effects.crop.y} min={0} max={0.9} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(y) => onCrop({ ...selectedClip.effects.crop!, y })} />
							</div>
							<div className="editor-field-row">
								<RangeField
									label="Width"
									value={selectedClip.effects.crop.width}
									min={0.1}
									max={1}
									step={0.01}
									format={(v) => `${Math.round(v * 100)}%`}
									onChange={(width) => onCrop({ ...selectedClip.effects.crop!, width })}
								/>
								<RangeField
									label="Height"
									value={selectedClip.effects.crop.height}
									min={0.1}
									max={1}
									step={0.01}
									format={(v) => `${Math.round(v * 100)}%`}
									onChange={(height) => onCrop({ ...selectedClip.effects.crop!, height })}
								/>
							</div>
						</>
					) : null}

					{selectedClip.kind === 'video' ? (
						<>
							<h4>Chroma key</h4>
							<label className="editor-field editor-field--checkbox">
								<input
									type="checkbox"
									checked={selectedClip.effects.chromaKey?.enabled ?? false}
									onChange={(event) =>
										onChromaKey(event.target.checked ? { ...(selectedClip.effects.chromaKey ?? DEFAULT_CHROMA_KEY), enabled: true } : { ...(selectedClip.effects.chromaKey ?? DEFAULT_CHROMA_KEY), enabled: false })
									}
								/>
								<span>Remove background (green/blue screen)</span>
							</label>
							{selectedClip.effects.chromaKey?.enabled ? (
								<>
									<label className="editor-field">
										<span>Key colour</span>
										<input type="color" value={selectedClip.effects.chromaKey.keyColor} onChange={(event) => onChromaKey({ ...selectedClip.effects.chromaKey!, keyColor: event.target.value })} />
									</label>
									<div className="editor-field-row">
										<RangeField label="Tolerance" value={selectedClip.effects.chromaKey.tolerance} min={0} max={1} step={0.01} onChange={(tolerance) => onChromaKey({ ...selectedClip.effects.chromaKey!, tolerance })} />
										<RangeField label="Softness" value={selectedClip.effects.chromaKey.softness} min={0} max={1} step={0.01} onChange={(softness) => onChromaKey({ ...selectedClip.effects.chromaKey!, softness })} />
									</div>
									<RangeField label="Spill suppress" value={selectedClip.effects.chromaKey.spill} min={0} max={1} step={0.01} onChange={(spill) => onChromaKey({ ...selectedClip.effects.chromaKey!, spill })} />
								</>
							) : null}
						</>
					) : null}
				</>
			) : null}

			{selectedClip.kind !== 'text' ? (
				<>
					<h4>Audio</h4>
					<div className="editor-field-row">
						<NumberField label="Gain (dB)" value={selectedClip.audio.gainDb} step={0.5} min={-48} max={24} onChange={(gainDb) => onAudio({ gainDb })} />
						<label className="editor-field editor-field--checkbox">
							<input type="checkbox" checked={selectedClip.audio.muted} onChange={(event) => onAudio({ muted: event.target.checked })} />
							<span>Muted</span>
						</label>
					</div>
					<div className="editor-field-row">
						<NumberField label="Fade in (fr)" value={selectedClip.audio.fadeInFrames} min={0} onChange={(fadeInFrames) => onAudio({ fadeInFrames: Math.round(fadeInFrames) })} />
						<NumberField label="Fade out (fr)" value={selectedClip.audio.fadeOutFrames} min={0} onChange={(fadeOutFrames) => onAudio({ fadeOutFrames: Math.round(fadeOutFrames) })} />
					</div>
				</>
			) : null}

			{selectedClip.kind === 'text' ? (
				<>
					<h4>Text</h4>
					<label className="editor-field">
						<span>Content</span>
						<textarea rows={3} value={selectedClip.text.content} onChange={(event) => onText({ content: event.target.value })} />
					</label>
					<div className="editor-field-row">
						<NumberField label="Size" value={selectedClip.text.fontSizePx} min={8} max={480} onChange={(fontSizePx) => onText({ fontSizePx: Math.round(fontSizePx) })} />
						<label className="editor-field">
							<span>Color</span>
							<input type="color" value={selectedClip.text.color} onChange={(event) => onText({ color: event.target.value })} />
						</label>
					</div>
					<label className="editor-field">
						<span>Align</span>
						<select value={selectedClip.text.align} onChange={(event) => onText({ align: event.target.value as TextAlign })}>
							<option value="left">Left</option>
							<option value="center">Center</option>
							<option value="right">Right</option>
						</select>
					</label>
					<div className="editor-anchor-grid" role="group" aria-label="Text position">
						{ANCHORS.map((anchor) => (
							<button key={anchor.id} type="button" data-active={selectedClip.text.position === anchor.id} onClick={() => onText({ position: anchor.id })}>
								{anchor.label}
							</button>
						))}
					</div>
					<label className="editor-field editor-field--checkbox">
						<input
							type="checkbox"
							checked={selectedClip.text.backgroundColor !== null}
							onChange={(event) => onText({ backgroundColor: event.target.checked ? 'rgba(0,0,0,0.55)' : null })}
						/>
						<span>Background box</span>
					</label>
				</>
			) : null}
		</div>
	)
}
