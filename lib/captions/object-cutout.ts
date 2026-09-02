'use client'

/**
 * Turning a downloaded picture into something that can stand behind a head.
 *
 * A sprite drawn behind a speaker has one hard requirement: it must not be a
 * rectangle. The web mostly serves rectangles. A PNG from Commons is often
 * already a cut-out, an icon always is, and a photograph almost never is - so
 * this file answers two questions about the pixels that came back, in order:
 *
 *   1. **Is it already cut out?** Measured, not guessed: the share of pixels
 *      that are actually transparent. A file that is already a cut-out is left
 *      completely alone, because every knockout is a chance to eat a highlight
 *      out of something that was fine.
 *
 *   2. **If not, does it have a flat background that can be taken away?** A
 *      product shot on white, a logo on one colour, an illustration on a flat
 *      sky. That is a flood fill inward from the border, not a colour-distance
 *      test over the whole image: the white of a shirt in the middle of a photo
 *      must survive, and it does, because the fill never reaches it.
 *
 * Where the answer to both is no - a busy photograph edge to edge - the picture
 * is reported as still opaque and the caller picks a different candidate. That
 * honesty is the point: silently pasting a rectangle behind someone's head is
 * the failure this whole file exists to avoid.
 *
 * Everything here is a pure function over plain pixel buffers, so the same code
 * runs in the browser and in the offline checks with no canvas at all.
 */

/** A plain RGBA buffer - `ImageData` satisfies this without being required. */
export type RgbaImage = {
	data: Uint8ClampedArray
	width: number
	height: number
}

export type AlphaReport = {
	/** share of pixels that are fully or nearly transparent, 0-1 */
	transparentRatio: number
	/** share that are neither fully opaque nor fully transparent - a soft edge */
	softRatio: number
	/** true when the file arrived as a cut-out rather than a rectangle */
	isCutout: boolean
}

/**
 * How much of the picture is already transparent.
 *
 * The cut-out threshold is deliberately low. A tight cut-out of a wide object -
 * a keyboard, a car - can leave only a fifth of the frame transparent, and
 * demanding more would send a perfectly good cut-out back to be knocked out
 * again. What it has to exclude is a photograph, and a photograph has no
 * transparent pixels at all.
 */
export function alphaReport(image: RgbaImage): AlphaReport {
	const pixels = image.width * image.height
	if (pixels <= 0) return { transparentRatio: 0, softRatio: 0, isCutout: false }

	let clear = 0
	let soft = 0
	// Every fourth pixel in each axis: a hundredth of the work, and the answer
	// is a ratio that never needed to be exact.
	const stride = 4
	let sampled = 0
	for (let y = 0; y < image.height; y += stride) {
		for (let x = 0; x < image.width; x += stride) {
			const alpha = image.data[(y * image.width + x) * 4 + 3]
			sampled++
			if (alpha <= 12) clear++
			else if (alpha < 243) soft++
		}
	}
	if (sampled === 0) return { transparentRatio: 0, softRatio: 0, isCutout: false }

	const transparentRatio = clear / sampled
	return {
		transparentRatio,
		softRatio: soft / sampled,
		isCutout: transparentRatio >= 0.04,
	}
}

/* ==========================================================================
   Knocking a flat background out.
   ========================================================================== */

export type KnockoutOptions = {
	/**
	 * How different from the border colour a pixel may be and still count as
	 * background, 0-100. This is a percentage of the maximum possible RGB
	 * distance, so it means the same thing whatever the picture is.
	 */
	tolerance?: number
	/** how many pixels of soft edge to leave behind, 0 for a hard cut */
	feather?: number
	/** below this share removed, the fill is reported as having failed */
	minRemoved?: number
	/**
	 * Above this share removed, the fill is reported as having failed too.
	 *
	 * A fill that reaches all but a few pixels did not find a background - it
	 * walked through the subject, which happens on a soft gradient. What is left
	 * is a handful of specks, and blown up to three head widths a handful of
	 * specks is worse than nothing.
	 */
	maxRemoved?: number
}

export type KnockoutResult = {
	image: RgbaImage
	/** share of the picture the fill took away, 0-1 */
	removedRatio: number
	/** false when there was no flat background to take - the picture is unchanged */
	knockedOut: boolean
	/** the colour the fill was seeded from, for the panel to explain itself */
	backgroundColor: [number, number, number]
}

const DEFAULTS = { tolerance: 12, feather: 2, minRemoved: 0.08, maxRemoved: 0.99 }

/**
 * The colour the border mostly is.
 *
 * The median of the border pixels rather than the mean: a mean is dragged by
 * the one corner where the subject touches the edge, and seeding a flood fill
 * from a colour that is in the picture nowhere fills nothing.
 */
export function borderColor(image: RgbaImage): [number, number, number] {
	const reds: number[] = []
	const greens: number[] = []
	const blues: number[] = []
	const push = (x: number, y: number) => {
		const at = (y * image.width + x) * 4
		if (image.data[at + 3] < 128) return
		reds.push(image.data[at])
		greens.push(image.data[at + 1])
		blues.push(image.data[at + 2])
	}
	for (let x = 0; x < image.width; x++) {
		push(x, 0)
		push(x, image.height - 1)
	}
	for (let y = 0; y < image.height; y++) {
		push(0, y)
		push(image.width - 1, y)
	}
	if (reds.length === 0) return [255, 255, 255]

	const median = (values: number[]): number => {
		values.sort((left, right) => left - right)
		return values[Math.floor(values.length / 2)]
	}
	return [median(reds), median(greens), median(blues)]
}

/**
 * Takes a flat background away, from the edges inward.
 *
 * A flood fill, not a colour key. The difference matters on every real picture:
 * a colour key set loose enough to remove a white background also removes the
 * white of an eye, a page, a cloud. The fill can only reach what is connected
 * to the border, so the inside of the subject is safe however close its colours
 * come to the background's.
 *
 * The scan is a hand-rolled stack rather than recursion because a 2000x2000
 * background is four million pixels deep and would take the call stack with it.
 */
export function knockoutBackground(image: RgbaImage, options: KnockoutOptions = {}): KnockoutResult {
	const tolerance = Math.max(0, Math.min(100, options.tolerance ?? DEFAULTS.tolerance))
	const feather = Math.max(0, Math.min(24, Math.round(options.feather ?? DEFAULTS.feather)))
	const minRemoved = options.minRemoved ?? DEFAULTS.minRemoved

	const { width, height } = image
	const pixels = width * height
	if (pixels === 0) {
		return { image, removedRatio: 0, knockedOut: false, backgroundColor: [255, 255, 255] }
	}

	const seed = borderColor(image)
	// Squared distance, so the comparison never needs a square root. The
	// maximum is 3 * 255^2, and the tolerance is a percentage of its root.
	const limit = ((tolerance / 100) * 441.673) ** 2

	const source = image.data
	const outside = new Uint8Array(pixels)
	const stack = new Int32Array(pixels)
	let top = 0

	const matches = (index: number): boolean => {
		const at = index * 4
		if (source[at + 3] < 8) return true // already transparent, and connected
		const dr = source[at] - seed[0]
		const dg = source[at + 1] - seed[1]
		const db = source[at + 2] - seed[2]
		return dr * dr + dg * dg + db * db <= limit
	}

	const push = (index: number) => {
		if (outside[index] || !matches(index)) return
		outside[index] = 1
		stack[top++] = index
	}

	for (let x = 0; x < width; x++) {
		push(x)
		push((height - 1) * width + x)
	}
	for (let y = 0; y < height; y++) {
		push(y * width)
		push(y * width + width - 1)
	}

	while (top > 0) {
		const index = stack[--top]
		const x = index % width
		const y = (index - x) / width
		if (x > 0) push(index - 1)
		if (x < width - 1) push(index + 1)
		if (y > 0) push(index - width)
		if (y < height - 1) push(index + width)
	}

	let removed = 0
	for (let index = 0; index < pixels; index++) if (outside[index]) removed++
	const removedRatio = removed / pixels

	// Nothing connected to the border matched, so there was no flat background
	// here - or everything did, which means the fill walked through the subject
	// rather than around it. Either way the picture is handed back exactly as it
	// arrived rather than half-eaten, and the caller is told so it can try
	// another candidate.
	const maxRemoved = options.maxRemoved ?? DEFAULTS.maxRemoved
	if (removedRatio < minRemoved || removedRatio > maxRemoved) {
		return { image, removedRatio, knockedOut: false, backgroundColor: seed }
	}

	const data = new Uint8ClampedArray(source)
	if (feather > 0) {
		// A blurred copy of the coverage, so the cut has a soft shoulder instead
		// of a staircase. Blurring coverage rather than alpha keeps a picture
		// that already had soft edges from being hardened by this pass.
		const coverage = new Float32Array(pixels)
		for (let index = 0; index < pixels; index++) coverage[index] = outside[index] ? 0 : 1
		const soft = boxBlur(coverage, width, height, feather)
		for (let index = 0; index < pixels; index++) {
			data[index * 4 + 3] = Math.round(source[index * 4 + 3] * Math.max(0, Math.min(1, soft[index])))
		}
	} else {
		for (let index = 0; index < pixels; index++) {
			if (outside[index]) data[index * 4 + 3] = 0
		}
	}

	return {
		image: { data, width, height },
		removedRatio,
		knockedOut: true,
		backgroundColor: seed,
	}
}

/**
 * Separable box blur over a single channel.
 *
 * Two passes of a running sum, so the cost is the same whatever the radius -
 * which is what lets the feather be a slider rather than a constant chosen to
 * keep the maths cheap.
 */
export function boxBlur(source: Float32Array, width: number, height: number, radius: number): Float32Array {
	if (radius <= 0) return source
	const span = radius * 2 + 1
	const horizontal = new Float32Array(source.length)
	for (let y = 0; y < height; y++) {
		const row = y * width
		let sum = 0
		for (let x = -radius; x <= radius; x++) sum += source[row + clampIndex(x, width)]
		for (let x = 0; x < width; x++) {
			horizontal[row + x] = sum / span
			sum -= source[row + clampIndex(x - radius, width)]
			sum += source[row + clampIndex(x + radius + 1, width)]
		}
	}

	const vertical = new Float32Array(source.length)
	for (let x = 0; x < width; x++) {
		let sum = 0
		for (let y = -radius; y <= radius; y++) sum += horizontal[clampIndex(y, height) * width + x]
		for (let y = 0; y < height; y++) {
			vertical[y * width + x] = sum / span
			sum -= horizontal[clampIndex(y - radius, height) * width + x]
			sum += horizontal[clampIndex(y + radius + 1, height) * width + x]
		}
	}
	return vertical
}

const clampIndex = (value: number, limit: number): number => (value < 0 ? 0 : value >= limit ? limit - 1 : value)

/* ==========================================================================
   Trimming.
   ========================================================================== */

export type TrimResult = {
	image: RgbaImage
	/** what was cut away, in pixels */
	bounds: { left: number; top: number; right: number; bottom: number }
	trimmed: boolean
}

/**
 * Crops the transparent margin off a cut-out.
 *
 * This is what makes "three times the size of the head" mean anything. A PNG
 * of a rocket with forty per cent empty space around it, sized to three head
 * widths, draws a rocket the size of two - the sprite is the right size and the
 * *picture* is not. Trimming to the content makes the drawn box and the visible
 * object the same thing, so the multiple the user asked for is the multiple
 * they see.
 */
export function trimTransparent(image: RgbaImage, alphaThreshold = 8): TrimResult {
	const { width, height, data } = image
	let left = width
	let top = height
	let right = -1
	let bottom = -1

	for (let y = 0; y < height; y++) {
		const row = y * width
		for (let x = 0; x < width; x++) {
			if (data[(row + x) * 4 + 3] <= alphaThreshold) continue
			if (x < left) left = x
			if (x > right) right = x
			if (y < top) top = y
			if (y > bottom) bottom = y
		}
	}

	if (right < left || bottom < top) {
		return { image, bounds: { left: 0, top: 0, right: width - 1, bottom: height - 1 }, trimmed: false }
	}
	if (left === 0 && top === 0 && right === width - 1 && bottom === height - 1) {
		return { image, bounds: { left, top, right, bottom }, trimmed: false }
	}

	const cropWidth = right - left + 1
	const cropHeight = bottom - top + 1
	const cropped = new Uint8ClampedArray(cropWidth * cropHeight * 4)
	for (let y = 0; y < cropHeight; y++) {
		const from = ((y + top) * width + left) * 4
		cropped.set(data.subarray(from, from + cropWidth * 4), y * cropWidth * 4)
	}

	return {
		image: { data: cropped, width: cropWidth, height: cropHeight },
		bounds: { left, top, right, bottom },
		trimmed: true,
	}
}

/* ==========================================================================
   The whole decision, in one call.
   ========================================================================== */

export type PreparedImage = {
	image: RgbaImage
	/** true when the picture can stand behind a head without looking like a sticker */
	usable: boolean
	/** whether a background had to be taken away */
	knockedOut: boolean
	removedRatio: number
	alpha: AlphaReport
	/** what happened, in one line, for the panel to show */
	note: string
}

/**
 * Prepares one downloaded picture, and says whether it is worth using.
 *
 * The order is the whole logic. A file that arrived cut out is trimmed and
 * returned untouched. Anything else gets one flood fill from its border, and is
 * usable only if that fill actually found a background - because a photograph
 * whose background could not be removed is a rectangle, and a rectangle behind
 * someone's head is the thing this feature is for avoiding.
 */
export function prepareObjectImage(image: RgbaImage, options: KnockoutOptions = {}): PreparedImage {
	const arrived = alphaReport(image)
	if (arrived.isCutout) {
		const trimmed = trimTransparent(image)
		return {
			image: trimmed.image,
			usable: true,
			knockedOut: false,
			removedRatio: 0,
			alpha: arrived,
			note: `arrived cut out (${Math.round(arrived.transparentRatio * 100)}% transparent)`,
		}
	}

	const knocked = knockoutBackground(image, options)
	if (!knocked.knockedOut) {
		return {
			image,
			usable: false,
			knockedOut: false,
			removedRatio: knocked.removedRatio,
			alpha: arrived,
			note:
				knocked.removedRatio > 0.9
					? 'the background fill reached the whole picture - nothing would be left of the object'
					: 'no flat background to remove - this one would be a rectangle',
		}
	}

	const trimmed = trimTransparent(knocked.image)
	return {
		image: trimmed.image,
		usable: true,
		knockedOut: true,
		removedRatio: knocked.removedRatio,
		alpha: alphaReport(trimmed.image),
		note: `background removed (${Math.round(knocked.removedRatio * 100)}% of the picture)`,
	}
}
