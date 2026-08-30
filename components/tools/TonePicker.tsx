'use client'

/**
 * Choosing a look.
 *
 * Seventy-nine graded looks in a dropdown would be seventy-nine names, and a
 * name is not a grade - nobody can tell "Portra 400" from "Vision3 250D" by
 * reading them. So every look is shown applied, to a frame of the clip that
 * is actually loaded, at the moment the picker opens.
 *
 * The thumbnails are made on the CPU on purpose. Each one is a 17-cell cube
 * over a 140-pixel-wide still - about four thousand evaluations and ten
 * thousand lookups - which is far below the cost of setting up, uploading to
 * and reading back from a GPU pass seventy-nine times. They are also built in
 * small batches with a yield between each, so a picker over eighty looks
 * never blocks the main thread long enough to drop a frame of scrolling.
 *
 * With no clip loaded yet the same grades are shown over a reference frame -
 * a luminance ramp, a sky, a skin patch and a foliage patch - which is enough
 * to tell warm from cool and contrasty from flat before committing to a file.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { CaptionVideoSource } from '../../lib/captions/types'
import {
	applyToneLutToImageData,
	bakeToneLut,
	TONE_FAMILIES,
	TONES,
	type ToneDef,
	type ToneFamily,
} from '../../lib/tools/color-tone'
import { extractThumbnail } from '../../lib/tools/video-filter'
import { IconSearch } from '../Icons'

const THUMB_WIDTH = 140
const THUMB_HEIGHT = 79
/** Small enough to bake in a millisecond, large enough that no look is misread. */
const THUMB_LUT_SIZE = 17
/** How many thumbnails are painted before yielding back to the browser. */
const BATCH_SIZE = 6

/**
 * The stand-in frame: a luminance ramp under four patches chosen because they
 * are what a grade is usually judged on - sky, skin, foliage and a warm
 * highlight.
 */
function drawReferenceFrame(ctx: CanvasRenderingContext2D, width: number, height: number): void {
	const ramp = ctx.createLinearGradient(0, 0, width, 0)
	ramp.addColorStop(0, '#000000')
	ramp.addColorStop(0.5, '#7a7a7a')
	ramp.addColorStop(1, '#ffffff')
	ctx.fillStyle = ramp
	ctx.fillRect(0, 0, width, height)

	const patches = ['#4a76b8', '#e0ac81', '#4f7a3a', '#f2d08a']
	const patchWidth = width / patches.length
	patches.forEach((colour, index) => {
		ctx.fillStyle = colour
		ctx.fillRect(index * patchWidth, height * 0.45, patchWidth, height * 0.55)
	})
}

/** One decoded frame of the clip, as pixels the thumbnails can be graded from. */
function useSourcePixels(probe: CaptionVideoSource | null): ImageData | null {
	const [pixels, setPixels] = useState<ImageData | null>(null)

	useEffect(() => {
		let cancelled = false
		const controller = new AbortController()

		const canvas = document.createElement('canvas')
		canvas.width = THUMB_WIDTH
		canvas.height = THUMB_HEIGHT
		const ctx = canvas.getContext('2d', { willReadFrequently: true })
		if (!ctx) return

		const useReference = () => {
			if (cancelled) return
			drawReferenceFrame(ctx, THUMB_WIDTH, THUMB_HEIGHT)
			setPixels(ctx.getImageData(0, 0, THUMB_WIDTH, THUMB_HEIGHT))
		}

		const file = probe?.file ?? null
		if (!file) {
			useReference()
			return () => {
				cancelled = true
			}
		}

		void (async () => {
			try {
				// A third of the way in: past any fade from black, before any credits.
				const still = await extractThumbnail({
					source: file,
					atSeconds: Math.min(probe!.durationInSeconds * 0.33, Math.max(0, probe!.durationInSeconds - 0.1)),
					params: { targetWidth: THUMB_WIDTH * 2 },
					signal: controller.signal,
				})
				const bitmap = await createImageBitmap(still.blob)
				URL.revokeObjectURL(still.url)
				if (cancelled) {
					bitmap.close()
					return
				}
				ctx.drawImage(bitmap, 0, 0, THUMB_WIDTH, THUMB_HEIGHT)
				bitmap.close()
				setPixels(ctx.getImageData(0, 0, THUMB_WIDTH, THUMB_HEIGHT))
			} catch {
				// A clip whose first frames will not decode still deserves a picker.
				useReference()
			}
		})()

		return () => {
			cancelled = true
			controller.abort()
		}
	}, [probe])

	return pixels
}

function ToneCard({
	tone,
	pixels,
	selected,
	disabled,
	onSelect,
	onPainted,
	shouldPaint,
}: {
	tone: ToneDef
	pixels: ImageData | null
	selected: boolean
	disabled: boolean
	onSelect: () => void
	onPainted: () => void
	shouldPaint: boolean
}) {
	const canvasRef = useRef<HTMLCanvasElement>(null)
	const painted = useRef(false)

	useEffect(() => {
		painted.current = false
	}, [pixels])

	useEffect(() => {
		if (!shouldPaint || painted.current || !pixels) return
		const canvas = canvasRef.current
		const ctx = canvas?.getContext('2d')
		if (!canvas || !ctx) return

		const graded = new ImageData(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height)
		applyToneLutToImageData(graded, bakeToneLut(tone.recipe, THUMB_LUT_SIZE), 1)
		ctx.putImageData(graded, 0, 0)
		painted.current = true
		onPainted()
	}, [onPainted, pixels, shouldPaint, tone])

	return (
		<button
			type="button"
			className="tone-card"
			data-selected={selected}
			disabled={disabled}
			onClick={onSelect}
			title={tone.blurb}
			aria-pressed={selected}
		>
			<canvas ref={canvasRef} width={THUMB_WIDTH} height={THUMB_HEIGHT} className="tone-card-thumb" />
			<span className="tone-card-name">{tone.name}</span>
		</button>
	)
}

export default function TonePicker({
	value,
	probe,
	disabled,
	onChange,
}: {
	value: string
	probe: CaptionVideoSource | null
	disabled: boolean
	onChange: (id: string) => void
}) {
	const [query, setQuery] = useState('')
	const [family, setFamily] = useState<ToneFamily | null>(null)
	const [painted, setPainted] = useState(0)
	const pixels = useSourcePixels(probe)

	const filtered = useMemo(() => {
		const needle = query.trim().toLowerCase()
		return TONES.filter((tone) => {
			if (family && tone.family !== family) return false
			if (!needle) return true
			return (
				tone.name.toLowerCase().includes(needle) ||
				tone.blurb.toLowerCase().includes(needle) ||
				tone.family.includes(needle)
			)
		})
	}, [family, query])

	// Reset the paint budget whenever the visible set or the source frame
	// changes, so a search never leaves half the grid blank.
	useEffect(() => {
		setPainted(0)
	}, [filtered, pixels])

	const selected = useMemo(() => TONES.find((tone) => tone.id === value) ?? null, [value])

	return (
		<div className="field">
			<label className="field-label">
				<span>Look</span>
				{selected ? <span className="field-value">{selected.name}</span> : null}
			</label>

			<div className="tool-search" style={{ marginTop: 2 }}>
				<IconSearch size={13} />
				<input
					className="tool-search-input"
					type="search"
					placeholder={`Search ${TONES.length} looks...`}
					value={query}
					disabled={disabled}
					onChange={(event) => setQuery(event.target.value)}
					aria-label="Search colour looks"
				/>
			</div>

			<div className="chip-scroll" role="tablist" aria-label="Look families">
				<button className="chip chip--button" data-active={family === null} onClick={() => setFamily(null)} disabled={disabled}>
					All
				</button>
				{TONE_FAMILIES.map((entry) => (
					<button
						key={entry.id}
						className="chip chip--button"
						data-active={family === entry.id}
						onClick={() => setFamily(entry.id)}
						disabled={disabled}
					>
						{entry.label}
					</button>
				))}
			</div>

			<div className="tone-grid">
				{filtered.map((tone, index) => (
					<ToneCard
						key={tone.id}
						tone={tone}
						pixels={pixels}
						selected={tone.id === value}
						disabled={disabled}
						shouldPaint={index < painted + BATCH_SIZE}
						onPainted={() => setPainted((count) => Math.max(count, index + 1))}
						onSelect={() => onChange(tone.id)}
					/>
				))}
				{filtered.length === 0 ? (
					<p className="field-hint" style={{ padding: '8px 2px' }}>
						No look matches that search.
					</p>
				) : null}
			</div>

			{selected ? <span className="field-hint">{selected.blurb}</span> : null}
		</div>
	)
}
