'use client'

import {
	CAPTION_FONTS,
	CAPTION_FONT_IDS,
	CAPTION_PRESETS,
	DEVANAGARI_FONTS,
	DEVANAGARI_FONT_IDS,
} from '../../lib/captions/style-presets'
import type {
	CaptionAnimation,
	CaptionBackground,
	CaptionDevanagariFontId,
	CaptionFontId,
	CaptionHighlight,
	CaptionPlacement,
	CaptionReveal,
	CaptionStyle,
	CaptionStylePresetId,
	ScriptMix,
} from '../../lib/captions/types'
import { IconInfo, IconSparkle, IconType } from '../Icons'

/** <input type="color"> only speaks hex, so rgb()/rgba() values are converted. */
function toHexColor(value: string): string {
	const trimmed = value.trim()
	if (trimmed.startsWith('#')) {
		if (trimmed.length === 4) {
			return `#${trimmed
				.slice(1)
				.split('')
				.map((char) => char + char)
				.join('')}`
		}
		return trimmed.slice(0, 7)
	}
	const match = trimmed.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i)
	if (!match) return '#ffffff'
	const hex = match
		.slice(1, 4)
		.map((channel) => Number(channel).toString(16).padStart(2, '0'))
		.join('')
	return `#${hex}`
}

function Slider({
	id,
	label,
	value,
	min,
	max,
	step,
	suffix,
	disabled,
	onChange,
}: {
	id: string
	label: string
	value: number
	min: number
	max: number
	step: number
	suffix?: string
	disabled?: boolean
	onChange: (value: number) => void
}) {
	return (
		<div className="field">
			<label className="field-label" htmlFor={id}>
				{label}
				<span className="field-value">
					{Number.isInteger(value) ? value : value.toFixed(1)}
					{suffix ?? ''}
				</span>
			</label>
			<input
				id={id}
				className="range"
				type="range"
				min={min}
				max={max}
				step={step}
				value={value}
				disabled={disabled}
				onChange={(event) => onChange(Number(event.target.value))}
			/>
		</div>
	)
}

function ColorField({
	id,
	label,
	value,
	disabled,
	onChange,
}: {
	id: string
	label: string
	value: string
	disabled?: boolean
	onChange: (value: string) => void
}) {
	return (
		<label className="color-field" htmlFor={id}>
			<input
				id={id}
				type="color"
				className="color-input"
				value={toHexColor(value)}
				disabled={disabled}
				onChange={(event) => onChange(event.target.value)}
			/>
			<span>{label}</span>
		</label>
	)
}

export default function CaptionDesignPanel({
	style,
	disabled,
	scriptMix,
	onStyle,
	onPreset,
}: {
	style: CaptionStyle
	disabled: boolean
	scriptMix: ScriptMix
	onStyle: (patch: Partial<CaptionStyle>) => void
	onPreset: (id: CaptionStylePresetId) => void
}) {
	const mixed = scriptMix.devanagari && scriptMix.latin

	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
			<div>
				<h2 className="section-label">
					Caption look
					<IconSparkle size={12} />
				</h2>
				<div className="preset-grid">
					{CAPTION_PRESETS.map((preset) => (
						<button
							key={preset.id}
							className="preset"
							data-active={style.preset === preset.id}
							disabled={disabled}
							onClick={() => onPreset(preset.id)}
						>
							<span className="preset-radio" />
							<span>
								<span className="preset-title">{preset.name}</span>
								<span className="preset-desc">{preset.tagline}</span>
							</span>
						</button>
					))}
				</div>
			</div>

			<div>
				<h2 className="section-label">
					Script
					<span className={`badge ${style.devanagari ? 'badge--green' : 'badge--muted'}`}>
						{mixed
							? 'Devanagari + Latin'
							: scriptMix.devanagari
								? 'Devanagari'
								: scriptMix.latin
									? 'Latin'
									: 'no text yet'}
					</span>
				</h2>
				<div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
					<div className="segmented" role="group" aria-label="Devanagari support">
						<button
							data-active={style.devanagari}
							disabled={disabled}
							onClick={() => onStyle({ devanagari: true })}
						>
							<IconType size={12} /> Devanagari on
						</button>
						<button
							data-active={!style.devanagari}
							disabled={disabled}
							onClick={() => onStyle({ devanagari: false })}
						>
							Latin only
						</button>
					</div>

					{style.devanagari ? (
						<div className="field">
							<label className="field-label" htmlFor="caption-devanagari-font">
								Devanagari face
							</label>
							<select
								id="caption-devanagari-font"
								className="select"
								value={style.devanagariFontId}
								disabled={disabled}
								onChange={(event) =>
									onStyle({ devanagariFontId: event.target.value as CaptionDevanagariFontId })
								}
							>
								{DEVANAGARI_FONT_IDS.map((id) => (
									<option key={id} value={id}>
										{DEVANAGARI_FONTS[id].label}
									</option>
								))}
							</select>
						</div>
					) : null}

					{scriptMix.devanagari && !style.devanagari ? (
						<div className="notice notice--warn">
							<span className="notice-icon">
								<IconInfo size={14} />
							</span>
							<span>
								This transcript contains Devanagari. With the companion face off, those words
								render as empty boxes in the export.
							</span>
						</div>
					) : (
						<p className="hint-text" style={{ margin: 0 }}>
							The Latin face below draws English words and the Devanagari face draws Nepali ones,
							chosen per character - so a mixed line stays in one visual voice.
						</p>
					)}
				</div>
			</div>

			<div>
				<h2 className="section-label">Typography</h2>
				<div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
					<div className="field">
						<label className="field-label" htmlFor="caption-font">
							{style.devanagari ? 'Latin font' : 'Font'}
						</label>
						<select
							id="caption-font"
							className="select"
							value={style.fontId}
							disabled={disabled}
							onChange={(event) => onStyle({ fontId: event.target.value as CaptionFontId })}
						>
							{CAPTION_FONT_IDS.map((id) => (
								<option key={id} value={id}>
									{CAPTION_FONTS[id].label}
								</option>
							))}
						</select>
					</div>

					<Slider
						id="caption-size"
						label="Size"
						value={style.fontSizePercent}
						min={2}
						max={12}
						step={0.1}
						suffix="% of height"
						disabled={disabled}
						onChange={(value) => onStyle({ fontSizePercent: value })}
					/>
					<Slider
						id="caption-weight"
						label="Weight"
						value={style.fontWeight}
						min={300}
						max={900}
						step={100}
						disabled={disabled}
						onChange={(value) => onStyle({ fontWeight: value })}
					/>
					<Slider
						id="caption-tracking"
						label="Letter spacing"
						value={style.letterSpacing}
						min={-2}
						max={10}
						step={0.5}
						suffix="px"
						disabled={disabled}
						onChange={(value) => onStyle({ letterSpacing: value })}
					/>
					<Slider
						id="caption-leading"
						label="Line height"
						value={style.lineHeight}
						min={1}
						max={1.8}
						step={0.02}
						disabled={disabled}
						onChange={(value) => onStyle({ lineHeight: value })}
					/>

					<div className="segmented" role="group" aria-label="Letter case">
						<button
							data-active={style.uppercase}
							disabled={disabled}
							onClick={() => onStyle({ uppercase: true })}
						>
							UPPERCASE
						</button>
						<button
							data-active={!style.uppercase}
							disabled={disabled}
							onClick={() => onStyle({ uppercase: false })}
						>
							Sentence case
						</button>
					</div>
				</div>
			</div>

			<div>
				<h2 className="section-label">Colour &amp; highlight</h2>
				<div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
					<div className="color-row">
						<ColorField
							id="caption-color"
							label="Text"
							value={style.textColor}
							disabled={disabled}
							onChange={(value) => onStyle({ textColor: value })}
						/>
						<ColorField
							id="caption-highlight-color"
							label="Spoken word"
							value={style.highlightColor}
							disabled={disabled || style.highlight === 'none'}
							onChange={(value) => onStyle({ highlightColor: value })}
						/>
						{style.highlight === 'box' ? (
							<ColorField
								id="caption-highlight-text"
								label="On the box"
								value={style.highlightTextColor}
								disabled={disabled}
								onChange={(value) => onStyle({ highlightTextColor: value })}
							/>
						) : null}
					</div>

					<div className="field">
						<span className="field-label">Highlight the word being spoken</span>
						<div className="segmented segmented--wrap" role="group" aria-label="Highlight style">
							{(['color', 'scale', 'box', 'none'] as CaptionHighlight[]).map((option) => (
								<button
									key={option}
									data-active={style.highlight === option}
									disabled={disabled}
									onClick={() => onStyle({ highlight: option })}
								>
									{option === 'color'
										? 'Colour'
										: option === 'scale'
											? 'Pop'
											: option === 'box'
												? 'Box'
												: 'Off'}
								</button>
							))}
						</div>
					</div>

					<Slider
						id="caption-stroke"
						label="Outline"
						value={style.strokeWidth}
						min={0}
						max={20}
						step={0.5}
						suffix="%"
						disabled={disabled}
						onChange={(value) => onStyle({ strokeWidth: value })}
					/>
					{style.strokeWidth > 0 ? (
						<div className="color-row">
							<ColorField
								id="caption-stroke-color"
								label="Outline colour"
								value={style.strokeColor}
								disabled={disabled}
								onChange={(value) => onStyle({ strokeColor: value })}
							/>
						</div>
					) : null}
					<Slider
						id="caption-shadow"
						label="Drop shadow"
						value={style.shadow}
						min={0}
						max={1}
						step={0.05}
						disabled={disabled}
						onChange={(value) => onStyle({ shadow: value })}
					/>
				</div>
			</div>

			<div>
				<h2 className="section-label">Backdrop</h2>
				<div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
					<div className="segmented" role="group" aria-label="Backdrop">
						{(['none', 'pill', 'block'] as CaptionBackground[]).map((option) => (
							<button
								key={option}
								data-active={style.background === option}
								disabled={disabled}
								onClick={() => onStyle({ background: option })}
							>
								{option === 'none' ? 'None' : option === 'pill' ? 'Pill' : 'Bar'}
							</button>
						))}
					</div>
					{style.background !== 'none' ? (
						<>
							<div className="color-row">
								<ColorField
									id="caption-bg-color"
									label="Backdrop"
									value={style.backgroundColor}
									disabled={disabled}
									onChange={(value) => onStyle({ backgroundColor: value })}
								/>
							</div>
							<Slider
								id="caption-bg-opacity"
								label="Backdrop opacity"
								value={style.backgroundOpacity}
								min={0}
								max={1}
								step={0.05}
								disabled={disabled}
								onChange={(value) => onStyle({ backgroundOpacity: value })}
							/>
						</>
					) : null}
				</div>
			</div>

			<div>
				<h2 className="section-label">Placement &amp; motion</h2>
				<div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
					<div className="field">
						<span className="field-label">Word reveal</span>
						<div className="segmented" role="group" aria-label="Reveal mode">
							{(['word', 'line'] as CaptionReveal[]).map((option) => (
								<button
									key={option}
									data-active={style.reveal === option}
									disabled={disabled}
									onClick={() => onStyle({ reveal: option })}
								>
									{option === 'word' ? 'Word by word' : 'Whole line'}
								</button>
							))}
						</div>
						<p className="hint-text" style={{ margin: 0 }}>
							{style.reveal === 'word'
								? 'Each word pops in on its own timestamp - the social-caption look.'
								: 'The full line arrives at once, then the spoken word is marked - the broadcast look.'}
						</p>
					</div>
					<Slider
						id="caption-max-lines"
						label="Lines per caption"
						value={style.maxLines}
						min={1}
						max={3}
						step={1}
						disabled={disabled}
						onChange={(value) => onStyle({ maxLines: value })}
					/>
					<Slider
						id="caption-scrim"
						label="Legibility scrim"
						value={style.scrim}
						min={0}
						max={0.6}
						step={0.02}
						disabled={disabled}
						onChange={(value) => onStyle({ scrim: value })}
					/>
					<p className="hint-text" style={{ margin: 0 }}>
						A gradient wash that fades in behind the caption zone - the fix for white type
						disappearing over sky, snow or a bright background.
					</p>
					<div className="segmented" role="group" aria-label="Placement">
						{(['top', 'center', 'bottom'] as CaptionPlacement[]).map((option) => (
							<button
								key={option}
								data-active={style.placement === option}
								disabled={disabled}
								onClick={() => onStyle({ placement: option })}
							>
								{option === 'top' ? 'Top' : option === 'center' ? 'Middle' : 'Bottom'}
							</button>
						))}
					</div>
					<Slider
						id="caption-offset"
						label={style.placement === 'center' ? 'Offset (middle ignores this)' : 'Distance from edge'}
						value={style.offsetPercent}
						min={0}
						max={45}
						step={0.5}
						suffix="%"
						disabled={disabled || style.placement === 'center'}
						onChange={(value) => onStyle({ offsetPercent: value })}
					/>
					<Slider
						id="caption-width"
						label="Block width"
						value={style.maxWidthPercent}
						min={40}
						max={96}
						step={1}
						suffix="%"
						disabled={disabled}
						onChange={(value) => onStyle({ maxWidthPercent: value })}
					/>
					<div className="field">
						<span className="field-label">Entrance</span>
						<div className="segmented segmented--wrap" role="group" aria-label="Entrance animation">
							{(['pop', 'fade', 'slide', 'none'] as CaptionAnimation[]).map((option) => (
								<button
									key={option}
									data-active={style.animation === option}
									disabled={disabled}
									onClick={() => onStyle({ animation: option })}
								>
									{option === 'pop'
										? 'Pop'
										: option === 'fade'
											? 'Fade'
											: option === 'slide'
												? 'Slide'
												: 'Cut'}
								</button>
							))}
						</div>
					</div>
				</div>
			</div>
		</div>
	)
}
