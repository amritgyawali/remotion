'use client'

/*
 * The Devanagari faces are self-hosted and declared in
 * public/assets/fonts/v1/fonts.css, which app/layout.tsx links once for the
 * whole app. This file used to import a second, Google-hosted sheet as well;
 * that sheet was deleted when the faces were brought in-house, and the import
 * it left behind failed the production build outright.
 */

import { useMemo, useState } from 'react'
import {
	CAPTION_FONT_CATEGORIES,
	CAPTION_FONT_IDS,
	CAPTION_FONTS,
	DEVANAGARI_FONT_IDS,
	DEVANAGARI_FONTS,
	previewTextFor,
} from '../../lib/captions/fonts'
import { CAPTION_PRESETS } from '../../lib/captions/style-presets'
import type {
	CaptionAlign,
	CaptionAnimation,
	CaptionBackground,
	CaptionDevanagariFontId,
	CaptionFill,
	CaptionFontCategory,
	CaptionFontId,
	CaptionHighlight,
	CaptionPlacement,
	CaptionReveal,
	CaptionStyle,
	CaptionStylePresetId,
	CaptionTextCase,
	CaptionWordEffect,
	ScriptMix,
} from '../../lib/captions/types'
import { IconInfo, IconSearch, IconSparkle, IconType } from '../Icons'
import { ColorField, Segmented, Slider, Toggle } from './controls'

/** The weight slider must not promise a weight a static file cannot draw. */
function weightRange(fontId: CaptionFontId): { min: number; max: number; variable: boolean } {
	const parts = CAPTION_FONTS[fontId].weight.split(' ').map(Number)
	if (parts.length === 1) return { min: parts[0], max: parts[0], variable: false }
	return { min: parts[0], max: parts[1], variable: true }
}

const CASE_OPTIONS: { value: CaptionTextCase; label: string }[] = [
	{ value: 'upper', label: 'UPPER' },
	{ value: 'title', label: 'Title' },
	{ value: 'none', label: 'As typed' },
	{ value: 'lower', label: 'lower' },
]

const ALIGN_OPTIONS: { value: CaptionAlign; label: string }[] = [
	{ value: 'left', label: 'Left' },
	{ value: 'center', label: 'Centre' },
	{ value: 'right', label: 'Right' },
]

const WORD_EFFECTS: { value: CaptionWordEffect; label: string; hint: string }[] = [
	{ value: 'none', label: 'Still', hint: 'The spoken word only changes colour or scale.' },
	{ value: 'bounce', label: 'Bounce', hint: 'The spoken word hops on the beat of the syllable.' },
	{ value: 'wave', label: 'Wave', hint: 'A slow rolling motion, phased along the line.' },
	{ value: 'pulse', label: 'Pulse', hint: 'A steady breathe in and out - subtle at any size.' },
	{ value: 'jitter', label: 'Jitter', hint: 'Frame-by-frame shake. Loud, comic, deliberate.' },
	{ value: 'flip', label: 'Flip', hint: 'Each word flips in on its X axis as it arrives.' },
]

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
	const [fontQuery, setFontQuery] = useState('')
	const [fontCategory, setFontCategory] = useState<CaptionFontCategory | 'all'>('all')

	const face = CAPTION_FONTS[style.fontId]
	const weights = weightRange(style.fontId)

	const fonts = useMemo(() => {
		const query = fontQuery.trim().toLowerCase()
		return CAPTION_FONT_IDS.filter((id) => {
			const entry = CAPTION_FONTS[id]
			if (fontCategory !== 'all' && entry.category !== fontCategory) return false
			if (!query) return true
			// "देवनागरी" and "nepali" are how a Nepali editor looks for this shelf,
			// so both find every face that can actually draw the script.
			const script = entry.devanagari ? 'devanagari देवनागरी nepali hindi नेपाली' : 'latin'
			return `${entry.family} ${entry.mood} ${entry.useFor} ${entry.category} ${script}`
				.toLowerCase()
				.includes(query)
		})
	}, [fontCategory, fontQuery])

	const emphasisValue = style.emphasisWords.join(', ')

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
							<span className="preset-radio" style={{ color: preset.accent }} />
							<span>
								<span className="preset-title">{preset.name}</span>
								<span className="preset-desc">{preset.tagline}</span>
								<span className="preset-tag">{preset.bestFor}</span>
							</span>
						</button>
					))}
				</div>
			</div>

			<div>
				<h2 className="section-label">
					Font
					<span className="badge badge--muted">{fonts.length} of {CAPTION_FONT_IDS.length}</span>
				</h2>
				<div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
					<div className="search-field">
						<IconSearch size={13} />
						<input
							className="input"
							placeholder={`Search ${CAPTION_FONT_IDS.length} faces - try neon, pixel, serif, Nepali`}
							value={fontQuery}
							disabled={disabled}
							onChange={(event) => setFontQuery(event.target.value)}
						/>
					</div>

					<div className="chip-scroll">
						{CAPTION_FONT_CATEGORIES.map((category) => (
							<button
								key={category.id}
								className="chip chip--button"
								data-active={fontCategory === category.id}
								disabled={disabled}
								onClick={() => setFontCategory(category.id)}
							>
								{category.label}
							</button>
						))}
					</div>

					<div className="font-grid">
						{fonts.map((id) => {
							const entry = CAPTION_FONTS[id]
							return (
								<button
									key={id}
									className="font-card"
									data-active={style.fontId === id}
									disabled={disabled}
									title={`${entry.mood} - ${entry.useFor}`}
									onClick={() =>
										onStyle({ fontId: id, fontWeight: entry.defaultWeight })
									}
								>
									<span
										className="font-card-sample"
										style={{ fontFamily: `'${entry.family}', ${entry.fallback}` }}
									>
										{previewTextFor(entry)}
									</span>
									<span className="font-card-name">{entry.family}</span>
									<span className="font-card-meta">
										{entry.category}
										{entry.devanagari ? ' - देवनागरी' : ''}
										{entry.variable ? ' - variable' : ''}
									</span>
								</button>
							)
						})}
					</div>
					<p className="hint-text" style={{ margin: 0 }}>
						{face.mood}. Good for {face.useFor}.
					</p>
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
								<span className="field-value">{DEVANAGARI_FONT_IDS.length} faces</span>
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
							<span
								className="font-card-sample"
								style={{
									fontFamily: `'${DEVANAGARI_FONTS[style.devanagariFontId].family}', sans-serif`,
									fontSize: 22,
									padding: '6px 0',
								}}
							>
								नमस्ते - यो feature राम्रो छ
							</span>
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
							The Latin face draws English words and the Devanagari face draws Nepali ones, chosen
							per character - so a mixed line stays in one visual voice.
						</p>
					)}
				</div>
			</div>

			<div>
				<h2 className="section-label">Typography</h2>
				<div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
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
						label={weights.variable ? 'Weight' : `Weight (${face.family} has one)`}
						value={weights.variable ? style.fontWeight : weights.min}
						min={weights.min}
						max={weights.max}
						step={100}
						disabled={disabled || !weights.variable}
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
					<Segmented
						label="Letter case"
						value={style.textCase}
						options={CASE_OPTIONS}
						disabled={disabled}
						wrap
						onChange={(value) => onStyle({ textCase: value })}
					/>
					<Segmented
						label="Alignment"
						value={style.align}
						options={ALIGN_OPTIONS}
						disabled={disabled}
						onChange={(value) => onStyle({ align: value })}
					/>
					<Slider
						id="caption-max-lines"
						label="Lines per caption"
						value={style.maxLines}
						min={1}
						max={4}
						step={1}
						disabled={disabled}
						onChange={(value) => onStyle({ maxLines: value })}
					/>
				</div>
			</div>

			<div>
				<h2 className="section-label">Fill</h2>
				<div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
					<Segmented
						label="Text fill"
						value={style.fill}
						options={[
							{ value: 'solid' as CaptionFill, label: 'Solid colour' },
							{ value: 'gradient' as CaptionFill, label: 'Gradient' },
						]}
						disabled={disabled}
						onChange={(value) => onStyle({ fill: value })}
					/>

					{style.fill === 'gradient' ? (
						<>
							<div className="color-row">
								<ColorField
									id="caption-gradient-from"
									label="From"
									value={style.gradientFrom}
									disabled={disabled}
									onChange={(value) => onStyle({ gradientFrom: value })}
								/>
								<ColorField
									id="caption-gradient-to"
									label="To"
									value={style.gradientTo}
									disabled={disabled}
									onChange={(value) => onStyle({ gradientTo: value })}
								/>
							</div>
							<Slider
								id="caption-gradient-angle"
								label="Gradient angle"
								value={style.gradientAngle}
								min={0}
								max={360}
								step={5}
								suffix="deg"
								disabled={disabled}
								onChange={(value) => onStyle({ gradientAngle: value })}
							/>
							<p className="hint-text" style={{ margin: 0 }}>
								The gradient is clipped to the letterforms, so it travels across the whole
								caption rather than repeating inside each word.
							</p>
						</>
					) : (
						<div className="color-row">
							<ColorField
								id="caption-color"
								label="Text"
								value={style.textColor}
								disabled={disabled}
								onChange={(value) => onStyle({ textColor: value })}
							/>
						</div>
					)}
				</div>
			</div>

			<div>
				<h2 className="section-label">Spoken word</h2>
				<div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
					<Segmented
						label="Highlight the word being spoken"
						value={style.highlight}
						options={[
							{ value: 'color' as CaptionHighlight, label: 'Colour' },
							{ value: 'scale' as CaptionHighlight, label: 'Pop' },
							{ value: 'box' as CaptionHighlight, label: 'Box' },
							{ value: 'none' as CaptionHighlight, label: 'Off' },
						]}
						disabled={disabled}
						wrap
						onChange={(value) => onStyle({ highlight: value })}
					/>

					<div className="color-row">
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

					<Toggle
						label="Karaoke wipe"
						hint="The spoken word fills left to right across its own timing instead of switching colour on one frame."
						checked={style.karaokeFill}
						disabled={disabled || style.highlight === 'none' || style.highlight === 'box'}
						onChange={(checked) => onStyle({ karaokeFill: checked })}
					/>

					<Segmented
						label="Motion on the spoken word"
						value={style.wordEffect}
						options={WORD_EFFECTS.map((effect) => ({ value: effect.value, label: effect.label }))}
						disabled={disabled}
						wrap
						onChange={(value) => onStyle({ wordEffect: value })}
					/>
					<p className="hint-text" style={{ margin: 0 }}>
						{WORD_EFFECTS.find((effect) => effect.value === style.wordEffect)?.hint}
					</p>

					<div className="field">
						<label className="field-label" htmlFor="caption-emphasis">
							Always emphasise
							<span className="field-value">{style.emphasisWords.length} words</span>
						</label>
						<input
							id="caption-emphasis"
							className="input"
							placeholder="free, today, 50% - comma separated"
							value={emphasisValue}
							disabled={disabled}
							onChange={(event) =>
								onStyle({
									emphasisWords: [
										...new Set(
											event.target.value
												.split(',')
												.map((word) => word.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ''))
												.filter(Boolean),
										),
									],
								})
							}
						/>
						<div className="color-row" style={{ marginTop: 8 }}>
							<ColorField
								id="caption-emphasis-color"
								label="Emphasis"
								value={style.emphasisColor}
								disabled={disabled || style.emphasisWords.length === 0}
								onChange={(value) => onStyle({ emphasisColor: value })}
							/>
						</div>
						<p className="hint-text" style={{ margin: 0 }}>
							These words keep the emphasis colour every time they appear - the offer, the price,
							the brand name - matched without case or punctuation.
						</p>
					</div>
				</div>
			</div>

			<div>
				<h2 className="section-label">Effects</h2>
				<div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
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
					{style.shadow > 0 ? (
						<div className="color-row">
							<ColorField
								id="caption-shadow-color"
								label="Shadow colour"
								value={style.shadowColor}
								disabled={disabled}
								onChange={(value) => onStyle({ shadowColor: value })}
							/>
						</div>
					) : null}

					<Slider
						id="caption-glow"
						label="Glow"
						value={style.glow}
						min={0}
						max={1}
						step={0.05}
						disabled={disabled}
						onChange={(value) => onStyle({ glow: value })}
					/>
					{style.glow > 0 ? (
						<div className="color-row">
							<ColorField
								id="caption-glow-color"
								label="Glow colour"
								value={style.glowColor}
								disabled={disabled}
								onChange={(value) => onStyle({ glowColor: value })}
							/>
						</div>
					) : null}

					<Slider
						id="caption-extrude"
						label="3D depth"
						value={style.extrude}
						min={0}
						max={1}
						step={0.05}
						disabled={disabled}
						onChange={(value) => onStyle({ extrude: value })}
					/>
					{style.extrude > 0 ? (
						<div className="color-row">
							<ColorField
								id="caption-extrude-color"
								label="Depth colour"
								value={style.extrudeColor}
								disabled={disabled}
								onChange={(value) => onStyle({ extrudeColor: value })}
							/>
						</div>
					) : null}

					<Slider
						id="caption-tilt"
						label="Tilt"
						value={style.tilt}
						min={-10}
						max={10}
						step={0.5}
						suffix="deg"
						disabled={disabled}
						onChange={(value) => onStyle({ tilt: value })}
					/>
					<p className="hint-text" style={{ margin: 0 }}>
						A hard-edged depth stack instead of a blur: it stays crisp when the video is scaled,
						which is what makes chrome, comic and retro looks read on a phone.
					</p>
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
							<Slider
								id="caption-bg-blur"
								label="Frosted blur"
								value={style.backdropBlur}
								min={0}
								max={40}
								step={1}
								suffix="px"
								disabled={disabled}
								onChange={(value) => onStyle({ backdropBlur: value })}
							/>
						</>
					) : null}
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
				</div>
			</div>

			<div>
				<h2 className="section-label">Placement &amp; motion</h2>
				<div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
					<Segmented
						label="Reveal"
						value={style.reveal}
						options={[
							{ value: 'word' as CaptionReveal, label: 'Word by word' },
							{ value: 'line' as CaptionReveal, label: 'Whole line' },
							{ value: 'typewriter' as CaptionReveal, label: 'Typewriter' },
						]}
						disabled={disabled}
						wrap
						onChange={(value) => onStyle({ reveal: value })}
					/>
					<p className="hint-text" style={{ margin: 0 }}>
						{style.reveal === 'word'
							? 'Each word pops in on its own timestamp - the social-caption look.'
							: style.reveal === 'line'
								? 'The full line arrives at once, then the spoken word is marked - the broadcast look.'
								: 'Characters type out across each word timing, cursor and all, without the line ever reflowing.'}
					</p>

					<Segmented
						label="Entrance"
						value={style.animation}
						options={[
							{ value: 'pop' as CaptionAnimation, label: 'Pop' },
							{ value: 'stamp' as CaptionAnimation, label: 'Stamp' },
							{ value: 'whoosh' as CaptionAnimation, label: 'Whoosh' },
							{ value: 'glitch' as CaptionAnimation, label: 'Glitch' },
							{ value: 'fade' as CaptionAnimation, label: 'Fade' },
							{ value: 'slide' as CaptionAnimation, label: 'Slide' },
							{ value: 'rise' as CaptionAnimation, label: 'Rise' },
							{ value: 'blur' as CaptionAnimation, label: 'Blur' },
							{ value: 'none' as CaptionAnimation, label: 'Cut' },
						]}
						disabled={disabled}
						wrap
						onChange={(value) => onStyle({ animation: value })}
					/>
					<p className="hint-text" style={{ margin: 0 }}>
						{style.animation === 'stamp'
							? 'The line lands from oversize and settles with a shake - the loudest of the nine.'
							: style.animation === 'whoosh'
								? 'The line flies in from the side under motion blur, in the direction it is aligned.'
								: style.animation === 'glitch'
									? 'Two frames of RGB tearing before the line resolves. Deterministic, so every render tears identically.'
									: 'Stamp, Whoosh and Glitch also work with the word-by-word reveal - and the Sound tab can match an effect to whichever one you pick.'}
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
				</div>
			</div>
		</div>
	)
}
