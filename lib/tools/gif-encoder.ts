/**
 * A real GIF89a writer: median-cut colour quantisation down to a shared
 * palette, then per-frame LZW compression, assembled by hand into the
 * container format. There is no browser API for this - `<canvas>` can only
 * rasterise a GIF, never write one - so this is the one export path in the
 * Tools Studio that isn't built on WebCodecs at all, just bytes assembled
 * to spec (Compuserve's 1989 GIF89a, still exactly what every browser and
 * chat app decodes today).
 *
 * Pure, framework-free, and format-only: it doesn't know or care where the
 * pixels came from, only that every frame is the same width and height.
 */

type Rgb = [number, number, number]

/** Median-cut quantisation: repeatedly splits the color with the widest range in its box, then averages each final box. */
function medianCutQuantize(samples: Rgb[], maxColors: number): Rgb[] {
	if (samples.length === 0) return [[0, 0, 0]]
	const buckets: Rgb[][] = [samples]

	while (buckets.length < maxColors) {
		let targetIndex = -1
		let targetRange = -1
		let targetChannel = 0
		for (let i = 0; i < buckets.length; i++) {
			const bucket = buckets[i]
			if (bucket.length < 2) continue
			for (let channel = 0; channel < 3; channel++) {
				let min = 255
				let max = 0
				for (const pixel of bucket) {
					const value = pixel[channel]
					if (value < min) min = value
					if (value > max) max = value
				}
				const range = max - min
				if (range > targetRange) {
					targetRange = range
					targetIndex = i
					targetChannel = channel
				}
			}
		}
		if (targetIndex === -1) break

		const bucket = buckets[targetIndex]
		bucket.sort((a, b) => a[targetChannel] - b[targetChannel])
		const mid = Math.floor(bucket.length / 2)
		buckets.splice(targetIndex, 1, bucket.slice(0, mid), bucket.slice(mid))
	}

	return buckets.map((bucket) => {
		let r = 0
		let g = 0
		let b = 0
		for (const pixel of bucket) {
			r += pixel[0]
			g += pixel[1]
			b += pixel[2]
		}
		const n = bucket.length || 1
		return [Math.round(r / n), Math.round(g / n), Math.round(b / n)] as Rgb
	})
}

/** Nearest palette entry by squared distance, cached by exact colour - real footage repeats a lot of exact pixels. */
function buildIndexer(palette: Rgb[]): (r: number, g: number, b: number) => number {
	const cache = new Map<number, number>()
	return (r: number, g: number, b: number): number => {
		const key = (r << 16) | (g << 8) | b
		const cached = cache.get(key)
		if (cached !== undefined) return cached
		let best = 0
		let bestDistance = Infinity
		for (let i = 0; i < palette.length; i++) {
			const [pr, pg, pb] = palette[i]
			const dr = pr - r
			const dg = pg - g
			const db = pb - b
			const distance = dr * dr + dg * dg + db * db
			if (distance < bestDistance) {
				bestDistance = distance
				best = i
			}
		}
		cache.set(key, best)
		return best
	}
}

function toSubBlocks(data: Uint8Array): Uint8Array<ArrayBuffer> {
	const chunks: number[] = []
	for (let i = 0; i < data.length; i += 255) {
		const length = Math.min(255, data.length - i)
		chunks.push(length)
		for (let j = 0; j < length; j++) chunks.push(data[i + j])
	}
	chunks.push(0)
	return new Uint8Array(chunks)
}

/** Standard GIF LZW: a growing string table, codes packed LSB-first at a variable bit width. */
function lzwEncode(indices: Uint8Array, minCodeSize: number): Uint8Array<ArrayBuffer> {
	const clearCode = 1 << minCodeSize
	const endCode = clearCode + 1
	let codeSize = minCodeSize + 1
	let nextCode = endCode + 1
	let dictionary = new Map<string, number>()

	const resetDictionary = () => {
		dictionary = new Map()
		for (let i = 0; i < clearCode; i++) dictionary.set(String(i), i)
		nextCode = endCode + 1
		codeSize = minCodeSize + 1
	}
	resetDictionary()

	const bytes: number[] = []
	let bitBuffer = 0
	let bitCount = 0
	const emit = (code: number) => {
		bitBuffer |= code << bitCount
		bitCount += codeSize
		while (bitCount >= 8) {
			bytes.push(bitBuffer & 0xff)
			bitBuffer >>= 8
			bitCount -= 8
		}
	}

	emit(clearCode)
	if (indices.length === 0) {
		emit(endCode)
		if (bitCount > 0) bytes.push(bitBuffer & 0xff)
		return new Uint8Array(bytes)
	}

	let current = String(indices[0])
	for (let i = 1; i < indices.length; i++) {
		const symbol = String(indices[i])
		const combined = current + ',' + symbol
		if (dictionary.has(combined)) {
			current = combined
			continue
		}
		emit(dictionary.get(current)!)
		if (nextCode < 4096) {
			dictionary.set(combined, nextCode)
			nextCode += 1
			if (nextCode > 1 << codeSize && codeSize < 12) codeSize += 1
		} else {
			emit(clearCode)
			resetDictionary()
		}
		current = symbol
	}
	emit(dictionary.get(current)!)
	emit(endCode)
	if (bitCount > 0) bytes.push(bitBuffer & 0xff)
	return new Uint8Array(bytes)
}

export type GifFrame = { data: Uint8ClampedArray; delayMs: number }

export type GifEncodeOptions = {
	frames: GifFrame[]
	width: number
	height: number
	/** 2-256; fewer colours makes a smaller file at a visible quality cost */
	maxColors?: number
	signal?: AbortSignal
}

/**
 * Builds a complete, looping GIF89a file from a stack of same-sized RGBA
 * frames: one shared palette (sampled across every frame, not just the
 * first, so a fade or a scene change doesn't blow the colours out), then one
 * LZW-compressed image block per frame.
 */
export async function encodeGif(options: GifEncodeOptions): Promise<Blob> {
	const { width, height, signal } = options
	const maxColors = Math.max(2, Math.min(256, options.maxColors ?? 200))
	if (options.frames.length === 0) throw new Error('No frames to write into the GIF.')

	// Sample pixels across every frame for the palette - dense enough to catch
	// real colour variation, sparse enough that a hundred frames doesn't mean
	// a hundred times the quantisation cost.
	const samples: Rgb[] = []
	const targetSamples = 20_000
	const totalPixels = width * height * options.frames.length
	const stride = Math.max(1, Math.floor(totalPixels / targetSamples))
	let cursor = 0
	for (const frame of options.frames) {
		if (signal?.aborted) throw new Error('Cancelled')
		for (let p = 0; p < frame.data.length; p += 4) {
			if (cursor % stride === 0) samples.push([frame.data[p], frame.data[p + 1], frame.data[p + 2]])
			cursor += 1
		}
	}

	const palette = medianCutQuantize(samples, maxColors)
	const indexOf = buildIndexer(palette)
	const minCodeSize = Math.max(2, Math.ceil(Math.log2(Math.max(2, palette.length))))
	const tableSize = 1 << minCodeSize

	// Bound to `ArrayBuffer` because these parts go straight into a `Blob`,
	// which will not take a view onto a `SharedArrayBuffer`.
	const parts: Uint8Array<ArrayBuffer>[] = []
	const push = (...bytes: number[]) => parts.push(Uint8Array.from(bytes))
	const pushBytes = (bytes: Uint8Array<ArrayBuffer>) => parts.push(bytes)
	const pushString = (text: string) => parts.push(Uint8Array.from([...text].map((c) => c.charCodeAt(0))))

	pushString('GIF89a')
	push(width & 0xff, (width >> 8) & 0xff, height & 0xff, (height >> 8) & 0xff, 0x80 | ((minCodeSize - 1) & 0x07), 0x00, 0x00)

	const gct = new Uint8Array(tableSize * 3)
	for (let i = 0; i < tableSize; i++) {
		const color = palette[i] ?? [0, 0, 0]
		gct[i * 3] = color[0]
		gct[i * 3 + 1] = color[1]
		gct[i * 3 + 2] = color[2]
	}
	pushBytes(gct)

	// Netscape 2.0 application extension - the de facto standard for "loop forever".
	push(0x21, 0xff, 0x0b)
	pushString('NETSCAPE2.0')
	push(0x03, 0x01, 0x00, 0x00, 0x00)

	for (const frame of options.frames) {
		if (signal?.aborted) throw new Error('Cancelled')
		const indices = new Uint8Array(width * height)
		for (let p = 0, i = 0; p < frame.data.length; p += 4, i++) {
			indices[i] = indexOf(frame.data[p], frame.data[p + 1], frame.data[p + 2])
		}

		const delayCentiseconds = Math.max(2, Math.round(frame.delayMs / 10))
		push(0x21, 0xf9, 0x04, 0x04, delayCentiseconds & 0xff, (delayCentiseconds >> 8) & 0xff, 0x00, 0x00)
		push(0x2c, 0x00, 0x00, 0x00, 0x00, width & 0xff, (width >> 8) & 0xff, height & 0xff, (height >> 8) & 0xff, 0x00)
		push(minCodeSize)
		pushBytes(toSubBlocks(lzwEncode(indices, minCodeSize)))
	}

	push(0x3b)

	return new Blob(parts, { type: 'image/gif' })
}
