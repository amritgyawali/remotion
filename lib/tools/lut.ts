'use client'

/**
 * Reading a colourist's `.cube` file and turning it into the same lookup
 * table the built-in looks bake down to.
 *
 * A `.cube` is the interchange format for colour grades - it is what comes
 * out of Resolve, what film-emulation packs are sold as, and what a client
 * hands over when they say "here is the show LUT". Supporting it means the
 * eighty looks in `color-tone.ts` stop being a ceiling: anything anyone has
 * ever graded can be applied here, at the same cost, through the same shader.
 *
 * The format is small but has three real traps, and all three are handled:
 *
 * - **Row order is red-fastest.** The spec writes the red index varying most
 *   quickly, then green, then blue. Reading it in the natural nesting order of
 *   most parsers gets a file that looks *almost* right - hues rotated - which
 *   is worse than one that looks obviously wrong.
 * - **`DOMAIN_MIN`/`DOMAIN_MAX` are not always 0 and 1.** A log-space LUT
 *   frequently has a wider domain, and ignoring it silently clips the ends.
 * - **1D LUTs exist.** `LUT_1D_SIZE` files hold a per-channel curve, not a
 *   cube. Rather than reject them, they are expanded into a 3D cube, which is
 *   exactly equivalent and keeps one code path downstream.
 *
 * Values are stored as RGB8 to match `ToneLut`. That is a real quantisation,
 * and for a normal display-referred grade it is imperceptible - the cube is
 * interpolated in hardware, so the error is a fraction of a code value rather
 * than a visible step.
 */

import type { ToneLut } from './color-tone'

export type ParsedLut = {
	lut: ToneLut
	title: string
	/** 1 for a 1D curve that was expanded, 3 for a genuine cube */
	sourceDimensions: 1 | 3
	domainMin: [number, number, number]
	domainMax: [number, number, number]
}

export class LutParseError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'LutParseError'
	}
}

/** The largest cube worth accepting: 64^3 is already 786k entries. */
const MAX_SIZE = 64

export function parseCubeLut(text: string): ParsedLut {
	let size = 0
	let dimensions: 1 | 3 = 3
	let title = ''
	let domainMin: [number, number, number] = [0, 0, 0]
	let domainMax: [number, number, number] = [1, 1, 1]
	const entries: number[] = []

	const lines = text.split(/\r?\n/)
	for (const rawLine of lines) {
		const line = rawLine.trim()
		if (!line || line.startsWith('#')) continue

		const upper = line.toUpperCase()
		if (upper.startsWith('TITLE')) {
			title = line.slice(5).trim().replace(/^"|"$/g, '')
			continue
		}
		if (upper.startsWith('LUT_3D_SIZE')) {
			size = Number.parseInt(line.split(/\s+/)[1], 10)
			dimensions = 3
			continue
		}
		if (upper.startsWith('LUT_1D_SIZE')) {
			size = Number.parseInt(line.split(/\s+/)[1], 10)
			dimensions = 1
			continue
		}
		if (upper.startsWith('DOMAIN_MIN')) {
			const parts = line.split(/\s+/).slice(1).map(Number)
			if (parts.length === 3 && parts.every(Number.isFinite)) domainMin = [parts[0], parts[1], parts[2]]
			continue
		}
		if (upper.startsWith('DOMAIN_MAX')) {
			const parts = line.split(/\s+/).slice(1).map(Number)
			if (parts.length === 3 && parts.every(Number.isFinite)) domainMax = [parts[0], parts[1], parts[2]]
			continue
		}
		// Anything else that starts with a number is data. Keywords this parser
		// does not know are skipped rather than treated as an error - the format
		// has vendor extensions, and none of them change the table.
		if (!/^[-+.\d]/.test(line)) continue

		const values = line.split(/\s+/).map(Number)
		if (values.length < 3 || !values.slice(0, 3).every(Number.isFinite)) continue
		entries.push(values[0], values[1], values[2])
	}

	if (!size || !Number.isFinite(size) || size < 2) {
		throw new LutParseError('That file has no LUT_3D_SIZE or LUT_1D_SIZE line, so it is not a .cube LUT.')
	}
	if (size > MAX_SIZE) {
		throw new LutParseError(`That LUT is ${size} points per axis; ${MAX_SIZE} is the largest this can load.`)
	}

	const expected = dimensions === 3 ? size * size * size * 3 : size * 3
	if (entries.length < expected) {
		throw new LutParseError(
			`That LUT says it is ${size} points but only ${entries.length / 3} of the ${expected / 3} rows are present - the file looks truncated.`,
		)
	}

	const data = new Uint8Array(size * size * size * 3)
	const encode = (value: number, channel: number): number => {
		const min = domainMin[channel]
		const max = domainMax[channel]
		const span = max - min || 1
		const normalised = (value - min) / span
		return Math.max(0, Math.min(255, Math.round(normalised * 255)))
	}

	if (dimensions === 3) {
		// Both the file and `ToneLut` order red fastest, so this is a straight
		// copy - but it is worth being explicit about, because it is the one
		// place the whole grade can silently come out wrong.
		for (let i = 0; i < size * size * size; i++) {
			data[i * 3] = encode(entries[i * 3], 0)
			data[i * 3 + 1] = encode(entries[i * 3 + 1], 1)
			data[i * 3 + 2] = encode(entries[i * 3 + 2], 2)
		}
	} else {
		// A 1D curve applied per channel: cell (r, g, b) takes red from the
		// curve at r, green from the curve at g, and blue from the curve at b.
		let index = 0
		for (let b = 0; b < size; b++) {
			for (let g = 0; g < size; g++) {
				for (let r = 0; r < size; r++) {
					data[index++] = encode(entries[r * 3], 0)
					data[index++] = encode(entries[g * 3 + 1], 1)
					data[index++] = encode(entries[b * 3 + 2], 2)
				}
			}
		}
	}

	return {
		lut: { size, data },
		title: title || 'Imported LUT',
		sourceDimensions: dimensions,
		domainMin,
		domainMax,
	}
}

export async function readCubeLutFile(file: File): Promise<ParsedLut> {
	if (file.size > 64 * 1024 * 1024) {
		throw new LutParseError('That file is over 64MB, which is far larger than any real .cube LUT.')
	}
	const text = await file.text()
	return parseCubeLut(text)
}

/**
 * Blends a loaded cube toward the identity, so an imported LUT gets the same
 * strength slider the built-in looks have.
 *
 * Done on the table rather than in the shader because the shader's strength
 * uniform already means "how much of the graded colour to keep", and a LUT
 * that has been pre-blended composes correctly with it instead of applying
 * the fade twice.
 */
export function blendLutTowardIdentity(lut: ToneLut, strength: number): ToneLut {
	const amount = Math.min(1, Math.max(0, strength))
	if (amount >= 1) return lut
	const { size } = lut
	const data = new Uint8Array(lut.data.length)
	const step = 255 / (size - 1)
	let index = 0
	for (let b = 0; b < size; b++) {
		for (let g = 0; g < size; g++) {
			for (let r = 0; r < size; r++) {
				const identity = [r * step, g * step, b * step]
				for (let channel = 0; channel < 3; channel++) {
					data[index] = Math.round(identity[channel] + (lut.data[index] - identity[channel]) * amount)
					index++
				}
			}
		}
	}
	return { size, data }
}
