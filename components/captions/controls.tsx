'use client'

/**
 * The four controls every subtitle panel is built from.
 *
 * They started out inside the design panel and moved here when the sound panel
 * needed the same sliders and switches: one definition means a slider behaves,
 * reads and is labelled identically wherever it appears, including the 16px
 * font size that stops iOS zooming the viewport on focus.
 */

/** <input type="color"> only speaks hex, so rgb()/rgba() values are converted. */
export function toHexColor(value: string): string {
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

export function Slider({
	id,
	label,
	value,
	min,
	max,
	step,
	suffix,
	disabled,
	format,
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
	/** overrides the printed value - used for "off", percentages and ms */
	format?: (value: number) => string
	onChange: (value: number) => void
}) {
	return (
		<div className="field">
			<label className="field-label" htmlFor={id}>
				{label}
				<span className="field-value">
					{format
						? format(value)
						: `${Number.isInteger(value) ? value : value.toFixed(1)}${suffix ?? ''}`}
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

export function ColorField({
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

export function Segmented<Value extends string>({
	label,
	value,
	options,
	disabled,
	wrap,
	onChange,
}: {
	label: string
	value: Value
	options: { value: Value; label: string }[]
	disabled?: boolean
	wrap?: boolean
	onChange: (value: Value) => void
}) {
	return (
		<div className="field">
			<span className="field-label">{label}</span>
			<div className={`segmented${wrap ? ' segmented--wrap' : ''}`} role="group" aria-label={label}>
				{options.map((option) => (
					<button
						key={option.value}
						data-active={value === option.value}
						disabled={disabled}
						onClick={() => onChange(option.value)}
					>
						{option.label}
					</button>
				))}
			</div>
		</div>
	)
}

export function Toggle({
	label,
	hint,
	checked,
	disabled,
	onChange,
}: {
	label: string
	hint?: string
	checked: boolean
	disabled?: boolean
	onChange: (checked: boolean) => void
}) {
	return (
		<label className="switch-field">
			<input
				type="checkbox"
				checked={checked}
				disabled={disabled}
				onChange={(event) => onChange(event.target.checked)}
			/>
			<span>
				<span className="field-label" style={{ display: 'block' }}>
					{label}
				</span>
				{hint ? <span className="switch-hint">{hint}</span> : null}
			</span>
		</label>
	)
}
