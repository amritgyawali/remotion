#!/usr/bin/env node

/**
 * Asserts that every face the studio advertises as Devanagari can actually
 * draw Nepali.
 *
 * A font marked `devanagari: true` in the kit is offered to the user as the
 * companion face for Nepali and Hindi, and the generated Remotion file loads it
 * for exactly that job. When such a face turns out to have no Devanagari in its
 * `cmap` - which is easy to get wrong, because superfamilies like Baloo ship
 * Arabic, Tamil and Devanagari siblings under near-identical names - nothing
 * fails loudly. The picker shows the face, the render succeeds, and every
 * Nepali word comes out as a tofu box.
 *
 * So the check reads the real `cmap` table out of each bundled .ttf and looks
 * up the codepoints a Nepali caption cannot do without. It needs no network and
 * no font library.
 *
 * Usage:
 *   node scripts/check-devanagari-glyphs.mjs
 */

import { readFile } from 'node:fs/promises'

// Codepoints a Nepali caption actually needs: consonants, vowels, matras,
// halanta, the danda, and the Devanagari digits.
const SAMPLE = [
	['क', 0x0915], ['ख', 0x0916], ['ज', 0x091c], ['ट', 0x091f], ['ण', 0x0923],
	['त', 0x0924], ['द', 0x0926], ['न', 0x0928], ['प', 0x092a], ['म', 0x092e],
	['य', 0x092f], ['र', 0x0930], ['ल', 0x0932], ['व', 0x0935], ['श', 0x0936],
	['ष', 0x0937], ['स', 0x0938], ['ह', 0x0939], ['ा', 0x093e], ['ि', 0x093f],
	['ी', 0x0940], ['ु', 0x0941], ['ू', 0x0942], ['े', 0x0947], ['ै', 0x0948],
	['ो', 0x094b], ['ौ', 0x094c], ['ं', 0x0902], ['ँ', 0x0901], ['्', 0x094d],
	['।', 0x0964], ['०', 0x0966], ['९', 0x096f],
]

function cmapLookup(buffer) {
	const u16 = (o) => buffer.readUInt16BE(o)
	const u32 = (o) => buffer.readUInt32BE(o)
	const tables = u16(4)
	let cmap = 0
	for (let i = 0; i < tables; i++) {
		const o = 12 + i * 16
		if (buffer.toString('ascii', o, o + 4) === 'cmap') cmap = u32(o + 8)
	}
	if (!cmap) throw new Error('no cmap table')

	// Collect every subtable; a font may express Devanagari only in one of them.
	const subtables = []
	const records = u16(cmap + 2)
	for (let i = 0; i < records; i++) {
		subtables.push(cmap + u32(cmap + 4 + i * 8 + 4))
	}

	return (code) =>
		subtables.some((off) => {
			const format = u16(off)
			if (format === 4) {
				const segX2 = u16(off + 6)
				const ends = off + 14
				const starts = ends + segX2 + 2
				for (let s = 0; s < segX2 / 2; s++) {
					if (u16(starts + s * 2) <= code && code <= u16(ends + s * 2) && u16(ends + s * 2) !== 0xffff) {
						return true
					}
				}
				return false
			}
			if (format === 12) {
				const groups = u32(off + 12)
				for (let g = 0; g < groups; g++) {
					const o = off + 16 + g * 12
					if (u32(o) <= code && code <= u32(o + 4)) return true
				}
			}
			return false
		})
}

const catalog = JSON.parse(await readFile('public/assets/fonts/catalog.json', 'utf8'))
const deva = catalog.families.filter((f) => f.devanagari)

let failed = 0
for (const family of deva) {
	const buffer = await readFile('public' + family.path)
	const has = cmapLookup(buffer)
	const missing = SAMPLE.filter(([, code]) => !has(code)).map(([glyph]) => glyph)
	if (missing.length) {
		failed++
		console.log(`FAIL ${family.family.padEnd(30)} missing ${missing.join(' ')}`)
	} else {
		console.log(`ok   ${family.family.padEnd(30)} ${(family.bytes / 1024).toFixed(0)} KB`)
	}
}

console.log(`\n${deva.length - failed}/${deva.length} Devanagari faces draw the full Nepali sample`)
if (failed) process.exit(1)
