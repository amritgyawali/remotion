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
 *      must survive, and it does, because the fill never reaches it. The fill
 *      walks a gradient as well as a flat colour, and is tried at three
 *      strengths, gentlest first, so one code path serves a logo on white and a
 *      bottle on a lit studio sweep without ruining either.
 *
 * Where the answer to both is no - a busy photograph edge to edge - the picture
 * is reported as still opaque and the caller picks a different candidate. That
 * honesty is the point: silently pasting a rectangle behind someone's head is
 * the failure this whole file exists to avoid.
 *
 * There is one deliberate exception, and it has to be asked for by name. On the
 * last sweep of a word the web had no cut-out of *anywhere*, `allowPhoto` keeps
 * the photograph, softens its edge into the frame, and flags it - because at
 * that point the choice is no longer between a photograph and a cut-out, it is
 * between a photograph and an empty frame, and the photograph is of the right
 * thing. Nothing turns that on by default.
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
	/**
	 * How different a pixel may be **from its own neighbour** and still be
	 * background, 0-100.
	 *
	 * This is what lets the fill walk a gradient. A studio backdrop is never one
	 * colour: it is a soft ramp from grey to white, or a sky that goes from pale
	 * at the horizon to deep at the top, and a fill that only compares against
	 * the colour it started at stops halfway up and leaves a band. Comparing
	 * each pixel against the one the fill arrived from instead follows the ramp
	 * all the way - and because the step allowed is small, it still cannot climb
	 * over the edge of the subject, where the colour changes all at once.
	 *
	 * The global tolerance stays in force as a leash: a gradient may wander, but
	 * never more than a few times the distance it started from.
	 */
	stepTolerance?: number
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
	/**
	 * How much of the *border* the fill has to have taken, 0-1.
	 *
	 * The share-of-the-picture tests above cannot tell a cut-out from a band. A
	 * photograph that is one smooth gradient edge to edge lets the fill walk out
	 * from the middle of each side until the leash stops it, and what is left is
	 * two stripes along the top and bottom - half the picture removed, which
	 * every other test here calls a success, and a subject nowhere in it.
	 *
	 * What separates the two is where the survivors are. A real background
	 * surrounds the object, so taking it away clears the border; a band still
	 * runs along two whole edges. Requiring most of the border to be gone
	 * refuses the band while still allowing the ordinary case of a subject that
	 * bleeds off one side of the frame.
	 */
	minBorderRemoved?: number
}

export type KnockoutResult = {
	image: RgbaImage
	/** share of the picture the fill took away, 0-1 */
	removedRatio: number
	/** share of the border pixels it took, 0-1 - see `minBorderRemoved` */
	borderRemovedRatio: number
	/** false when there was no flat background to take - the picture is unchanged */
	knockedOut: boolean
	/** the colour the fill was seeded from, for the panel to explain itself */
	backgroundColor: [number, number, number]
}

const DEFAULTS = {
	tolerance: 12,
	stepTolerance: 7,
	feather: 2,
	minRemoved: 0.08,
	maxRemoved: 0.99,
	// One whole side of the frame is 25% of its border, so 0.6 leaves room for a
	// subject that bleeds off an edge - the common case in a tightly cropped
	// product shot - while refusing anything still running along two of them.
	minBorderRemoved: 0.6,
}

/**
 * The attempts `prepareObjectImage` makes, gentlest first.
 *
 * One tolerance cannot serve a logo on flat white and a bottle on a lit studio
 * sweep: the first needs almost none and the second needs enough to climb a
 * ramp. Rather than pick a number that is wrong for both, the fill is tried
 * three times and the first result that takes a believable share of the
 * picture is kept - so an easy image is cut with the gentlest setting that
 * works, and a hard one still gets its chance.
 */
const ATTEMPTS: Array<{ tolerance: number; stepTolerance: number }> = [
	{ tolerance: 9, stepTolerance: 5 },
	{ tolerance: 15, stepTolerance: 8 },
	{ tolerance: 24, stepTolerance: 12 },
]

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
	const stepTolerance = Math.max(0, Math.min(100, options.stepTolerance ?? DEFAULTS.stepTolerance))
	const feather = Math.max(0, Math.min(24, Math.round(options.feather ?? DEFAULTS.feather)))
	const minRemoved = options.minRemoved ?? DEFAULTS.minRemoved

	const { width, height } = image
	const pixels = width * height
	if (pixels === 0) {
		return {
			image,
			removedRatio: 0,
			borderRemovedRatio: 0,
			knockedOut: false,
			backgroundColor: [255, 255, 255],
		}
	}

	const seed = borderColor(image)
	// Squared distances, so no comparison ever needs a square root. The maximum
	// is 3 * 255^2, and a tolerance is a percentage of its root.
	const limit = ((tolerance / 100) * 441.673) ** 2
	const stepLimit = ((stepTolerance / 100) * 441.673) ** 2
	// How far a gradient may wander from where it started before it stops being
	// the same background. Without this leash a chain of small steps walks
	// across a whole photograph one shade at a time.
	const wanderLimit = Math.min(((60 / 100) * 441.673) ** 2, limit * 9)

	const source = image.data
	const outside = new Uint8Array(pixels)
	const stack = new Int32Array(pixels)
	let top = 0

	const distanceTo = (index: number, red: number, green: number, blue: number): number => {
		const at = index * 4
		const dr = source[at] - red
		const dg = source[at + 1] - green
		const db = source[at + 2] - blue
		return dr * dr + dg * dg + db * db
	}

	/** A pixel the fill can reach from nowhere in particular - a border seed. */
	const seeds = (index: number): boolean => {
		if (source[index * 4 + 3] < 8) return true // already transparent, and connected
		return distanceTo(index, seed[0], seed[1], seed[2]) <= limit
	}

	/**
	 * A pixel the fill can reach *from another pixel*.
	 *
	 * Either it looks like the background it started from, or it looks like the
	 * pixel it arrived from and has not wandered too far from that start. The
	 * second clause is what follows a gradient; the third is what stops it
	 * following one all the way into the subject.
	 */
	const spreads = (index: number, from: number): boolean => {
		if (source[index * 4 + 3] < 8) return true
		if (distanceTo(index, seed[0], seed[1], seed[2]) <= limit) return true
		if (stepLimit <= 0) return false
		const at = from * 4
		if (distanceTo(index, source[at], source[at + 1], source[at + 2]) > stepLimit) return false
		return distanceTo(index, seed[0], seed[1], seed[2]) <= wanderLimit
	}

	const pushSeed = (index: number) => {
		if (outside[index] || !seeds(index)) return
		outside[index] = 1
		stack[top++] = index
	}

	const pushFrom = (index: number, from: number) => {
		if (outside[index] || !spreads(index, from)) return
		outside[index] = 1
		stack[top++] = index
	}

	for (let x = 0; x < width; x++) {
		pushSeed(x)
		pushSeed((height - 1) * width + x)
	}
	for (let y = 0; y < height; y++) {
		pushSeed(y * width)
		pushSeed(y * width + width - 1)
	}

	while (top > 0) {
		const index = stack[--top]
		const x = index % width
		const y = (index - x) / width
		if (x > 0) pushFrom(index - 1, index)
		if (x < width - 1) pushFrom(index + 1, index)
		if (y > 0) pushFrom(index - width, index)
		if (y < height - 1) pushFrom(index + width, index)
	}

	let removed = 0
	for (let index = 0; index < pixels; index++) if (outside[index]) removed++
	const removedRatio = removed / pixels

	let borderPixels = 0
	let borderRemoved = 0
	const countBorder = (index: number) => {
		borderPixels++
		if (outside[index]) borderRemoved++
	}
	for (let x = 0; x < width; x++) {
		countBorder(x)
		if (height > 1) countBorder((height - 1) * width + x)
	}
	for (let y = 1; y < height - 1; y++) {
		countBorder(y * width)
		if (width > 1) countBorder(y * width + width - 1)
	}
	const borderRemovedRatio = borderPixels === 0 ? 0 : borderRemoved / borderPixels

	// Three ways this can have failed, and the picture is handed back exactly as
	// it arrived for all of them rather than half-eaten, with the caller told so
	// it can try another candidate:
	//
	//  - nothing connected to the border matched, so there was no background;
	//  - everything did, so the fill walked through the subject rather than
	//    around it, which is what a soft gradient does;
	//  - enough of the border survived that what is left is a band along it,
	//    not an object standing in the middle of it.
	const maxRemoved = options.maxRemoved ?? DEFAULTS.maxRemoved
	const minBorderRemoved = options.minBorderRemoved ?? DEFAULTS.minBorderRemoved
	if (removedRatio < minRemoved || removedRatio > maxRemoved || borderRemovedRatio < minBorderRemoved) {
		return { image, removedRatio, borderRemovedRatio, knockedOut: false, backgroundColor: seed }
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
		borderRemovedRatio,
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

export type PrepareOptions = KnockoutOptions & {
	/**
	 * Accept a picture whose background could not be removed.
	 *
	 * Off by default, and deliberately so: the whole point of this file is that
	 * a rectangle behind a speaker's head is worse than nothing there. It is
	 * turned on only for the last sweep of a word the web had no cut-out of
	 * anywhere, where the honest choice is between a photograph and no picture
	 * at all - and a photograph of the right thing beats an empty frame.
	 */
	allowPhoto?: boolean
	/** how wide the soft edge on that last resort is, as a share of the short side */
	photoFeather?: number
}

/** How a picture ended up usable, which is not the same question as whether it is. */
export type PrepareRoute = 'arrived-cutout' | 'knockout' | 'photo' | 'none'

export type PreparedImage = {
	image: RgbaImage
	/** true when the picture can stand behind a head without looking like a sticker */
	usable: boolean
	/** whether a background had to be taken away */
	knockedOut: boolean
	removedRatio: number
	alpha: AlphaReport
	/** how it got here - the field the caller should branch on */
	route: PrepareRoute
	/** true for a photograph kept with its background, so the caller can say so */
	fallback: boolean
	/** which of the escalating attempts cut it out, for the panel and the checks */
	attempt: { tolerance: number; stepTolerance: number } | null
	/** what happened, in one line, for the panel to show */
	note: string
}

/**
 * A fill that took this little did not find a background - it found the corners.
 *
 * Above this share the escalation stops and keeps what it has; below it, the
 * next attempt is tried and the biggest believable result is kept. Without the
 * threshold the gentlest setting always wins by removing the four corners of a
 * photograph, which is the one outcome that looks like damage rather than a
 * cut-out.
 */
const CONFIDENT_REMOVED = 0.15

/**
 * Softens a rectangle's edge into the frame.
 *
 * Only ever used on the last resort - a photograph nothing could cut out. A
 * hard-edged photo behind a head reads as a screenshot pasted into the video;
 * the same photo with its border ramped to nothing and its corners rounded
 * reads as an inset, which is a deliberate-looking thing rather than a mistake.
 *
 * The ramp is a smoothstep over the distance to the nearest edge, so there is
 * no visible band where it starts.
 */
export function softenEdges(image: RgbaImage, radius: number): RgbaImage {
	const { width, height } = image
	const ramp = Math.max(1, Math.min(Math.floor(Math.min(width, height) / 2), Math.round(radius)))
	const data = new Uint8ClampedArray(image.data)

	for (let y = 0; y < height; y++) {
		const dy = Math.min(y, height - 1 - y)
		for (let x = 0; x < width; x++) {
			const dx = Math.min(x, width - 1 - x)
			// Inside a corner both distances are small at once, and taking the
			// smaller of the two would chamfer it. Measuring from the centre of
			// the corner's arc instead rounds it properly.
			const distance =
				dx < ramp && dy < ramp ? ramp - Math.hypot(ramp - dx, ramp - dy) : Math.min(dx, dy)
			if (distance >= ramp) continue
			const t = Math.max(0, Math.min(1, distance / ramp))
			const eased = t * t * (3 - 2 * t)
			const at = (y * width + x) * 4
			data[at + 3] = Math.round(image.data[at + 3] * eased)
		}
	}

	return { data, width, height }
}

/**
 * Prepares one downloaded picture, and says whether it is worth using.
 *
 * The order is the whole logic, and each step exists because the one before it
 * failed:
 *
 *   1. **It arrived cut out.** Trimmed and handed back untouched - every
 *      knockout is a chance to eat a highlight out of something that was fine.
 *
 *   2. **It has a background that can be taken away.** The fill is tried up to
 *      three times, gentlest first, and stops at the first setting that takes a
 *      believable share of the picture. That escalation is what lets one code
 *      path serve a logo on flat white and a bottle on a lit studio sweep: the
 *      first is cut with almost no tolerance, the second gets enough to climb
 *      the ramp, and neither setting is applied to the picture it would ruin.
 *
 *   3. **Neither, and the caller said a photograph will do.** Kept as it is
 *      with a soft edge, and flagged, so the panel can say which words got a
 *      photograph rather than a cut-out. Only the last sweep asks for this.
 *
 * With `allowPhoto` off - the default, and what the main pass uses - step three
 * is a refusal instead, and the caller moves to the next candidate.
 */
export function prepareObjectImage(image: RgbaImage, options: PrepareOptions = {}): PreparedImage {
	const arrived = alphaReport(image)
	if (arrived.isCutout) {
		const trimmed = trimTransparent(image)
		return {
			image: trimmed.image,
			usable: true,
			knockedOut: false,
			removedRatio: 0,
			alpha: arrived,
			route: 'arrived-cutout',
			fallback: false,
			attempt: null,
			note: `arrived cut out (${Math.round(arrived.transparentRatio * 100)}% transparent)`,
		}
	}

	// A caller that named a tolerance gets that tolerance and nothing else: the
	// escalation is a default, not an override of somebody's slider.
	const attempts =
		options.tolerance === undefined
			? ATTEMPTS
			: [
					{
						tolerance: options.tolerance,
						stepTolerance: options.stepTolerance ?? DEFAULTS.stepTolerance,
					},
				]

	let best: { knocked: KnockoutResult; attempt: { tolerance: number; stepTolerance: number } } | null = null
	/**
	 * The gentlest attempt's result, kept for the explanation if they all fail.
	 *
	 * It is the one that describes the picture rather than the setting: run wide
	 * enough, *every* picture eventually reports that the fill reached all of it,
	 * which says something about the tolerance and nothing about the file.
	 */
	let firstFailure: KnockoutResult | null = null
	for (const attempt of attempts) {
		const knocked = knockoutBackground(image, { ...options, ...attempt })
		if (!knocked.knockedOut) {
			if (!firstFailure) firstFailure = knocked
			continue
		}
		if (!best || knocked.removedRatio > best.knocked.removedRatio) best = { knocked, attempt }
		if (knocked.removedRatio >= CONFIDENT_REMOVED) break
	}

	if (best) {
		const trimmed = trimTransparent(best.knocked.image)
		return {
			image: trimmed.image,
			usable: true,
			knockedOut: true,
			removedRatio: best.knocked.removedRatio,
			alpha: alphaReport(trimmed.image),
			route: 'knockout',
			fallback: false,
			attempt: best.attempt,
			note: `background removed (${Math.round(best.knocked.removedRatio * 100)}% of the picture, tolerance ${
				best.attempt.tolerance
			})`,
		}
	}

	if (options.allowPhoto) {
		const short = Math.min(image.width, image.height)
		const softened = softenEdges(image, Math.max(4, Math.round(short * (options.photoFeather ?? 0.06))))
		return {
			image: softened,
			usable: true,
			knockedOut: false,
			removedRatio: 0,
			alpha: alphaReport(softened),
			route: 'photo',
			fallback: true,
			attempt: null,
			note: 'no background could be removed - used as a photograph with a soft edge',
		}
	}

	// Nothing worked and no photograph was asked for. The picture is handed back
	// exactly as it arrived, and the caller is told, so it can try the next
	// candidate rather than paste a rectangle behind someone's head.
	const failed = firstFailure
	return {
		image,
		usable: false,
		knockedOut: false,
		removedRatio: failed?.removedRatio ?? 0,
		alpha: arrived,
		route: 'none',
		fallback: false,
		attempt: null,
		note:
			!failed || failed.removedRatio < (options.minRemoved ?? DEFAULTS.minRemoved)
				? 'no flat background to remove - this one would be a rectangle'
				: failed.removedRatio > (options.maxRemoved ?? DEFAULTS.maxRemoved)
					? 'the background fill reached the whole picture - nothing would be left of the object'
					: 'the background runs off the edge of the frame - what is left would be a band, not an object',
	}
}
