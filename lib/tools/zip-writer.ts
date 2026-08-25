/**
 * A minimal ZIP writer - just enough of the format for "bundle these result
 * files into one download". Every entry is stored, not compressed: the
 * payloads here are already-encoded video, audio and image files, which
 * gain nothing from a second compression pass and would only cost CPU for
 * it. What's implemented is exactly PKZIP's APPNOTE structure - local file
 * headers, a central directory, the end-of-central-directory record - which
 * is why the output opens in Explorer, Archive Utility and every unzip tool
 * without needing a library on either end.
 */

const CRC_TABLE = (() => {
	const table = new Uint32Array(256)
	for (let n = 0; n < 256; n++) {
		let c = n
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
		table[n] = c >>> 0
	}
	return table
})()

function crc32(data: Uint8Array): number {
	let crc = 0xffffffff
	for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8)
	return (crc ^ 0xffffffff) >>> 0
}

/** ZIP stores timestamps as DOS date/time - two bitpacked 16-bit values. */
function dosDateTime(date: Date): { time: number; date: number } {
	const time = ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | ((date.getSeconds() >> 1) & 0x1f)
	const dosValue =
		((Math.max(0, date.getFullYear() - 1980) & 0x7f) << 9) | (((date.getMonth() + 1) & 0x0f) << 5) | (date.getDate() & 0x1f)
	return { time, date: dosValue }
}

export type ZipEntry = { name: string; data: Uint8Array }

/** Builds a complete `.zip` file, uncompressed, from a list of named byte arrays. */
export function buildZip(entries: ZipEntry[]): Blob {
	const { time, date } = dosDateTime(new Date())
	const localParts: Uint8Array[] = []
	const centralParts: Uint8Array[] = []
	let offset = 0

	for (const entry of entries) {
		const nameBytes = new TextEncoder().encode(entry.name)
		const crc = crc32(entry.data)
		const size = entry.data.length

		const local = new DataView(new ArrayBuffer(30))
		local.setUint32(0, 0x04034b50, true)
		local.setUint16(4, 20, true)
		local.setUint16(6, 0, true)
		local.setUint16(8, 0, true)
		local.setUint16(10, time, true)
		local.setUint16(12, date, true)
		local.setUint32(14, crc, true)
		local.setUint32(18, size, true)
		local.setUint32(22, size, true)
		local.setUint16(26, nameBytes.length, true)
		local.setUint16(28, 0, true)
		localParts.push(new Uint8Array(local.buffer), nameBytes, entry.data)

		const central = new DataView(new ArrayBuffer(46))
		central.setUint32(0, 0x02014b50, true)
		central.setUint16(4, 20, true)
		central.setUint16(6, 20, true)
		central.setUint16(8, 0, true)
		central.setUint16(10, 0, true)
		central.setUint16(12, time, true)
		central.setUint16(14, date, true)
		central.setUint32(16, crc, true)
		central.setUint32(20, size, true)
		central.setUint32(24, size, true)
		central.setUint16(28, nameBytes.length, true)
		central.setUint16(30, 0, true)
		central.setUint16(32, 0, true)
		central.setUint16(34, 0, true)
		central.setUint16(36, 0, true)
		central.setUint32(38, 0, true)
		central.setUint32(42, offset, true)
		centralParts.push(new Uint8Array(central.buffer), nameBytes)

		offset += 30 + nameBytes.length + size
	}

	const centralStart = offset
	const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0)

	const end = new DataView(new ArrayBuffer(22))
	end.setUint32(0, 0x06054b50, true)
	end.setUint16(4, 0, true)
	end.setUint16(6, 0, true)
	end.setUint16(8, entries.length, true)
	end.setUint16(10, entries.length, true)
	end.setUint32(12, centralSize, true)
	end.setUint32(16, centralStart, true)
	end.setUint16(20, 0, true)

	return new Blob([...localParts, ...centralParts, new Uint8Array(end.buffer)], { type: 'application/zip' })
}
