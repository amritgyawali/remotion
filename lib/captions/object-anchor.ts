'use client'

/**
 * Finding the top of the speaker's head.
 *
 * The segmenter hands back a per-pixel confidence that a pixel is the person.
 * That is enough to cut them out, but not enough to place something *behind*
 * them: an object pinned to the middle of the frame ends up behind a shoulder
 * when the speaker sits off centre, and slides out from behind them the moment
 * they lean. So the mask is read once more, cheaply, for one point - where the
 * head starts and how wide it is.
 *
 * The method is deliberately the simplest one that survives real footage:
 *
 * - **The first row that has enough subject in it is the crown.** A single
 *   stray pixel of confidence sits above almost every real head - hair, a
 *   compression artefact, a mis-segmented lamp - so a row only counts once a
 *   run of pixels crosses the threshold. That run is a fraction of the frame
 *   width rather than a pixel count, which keeps the rule the same at any
 *   mask resolution.
 *
 * - **The centre comes from a band, not from a row.** The crown row alone is
 *   a few pixels wide and its centre jumps around as hair moves. Averaging the
 *   subject's horizontal centre over the top sixth of their height gives a
 *   point that tracks a turning head without chasing a stray curl.
 *
 * - **The point is filtered, never snapped.** Segmentation is independent
 *   frame to frame, so even a still subject's anchor wanders by a pixel or
 *   two. A plain blend can remove that wobble, but only by lagging behind a
 *   real head turn by the same amount - one setting cannot serve both. The
 *   filter below moves its own cutoff with the measured speed instead, so a
 *   still speaker gets a still object and a fast one gets no trailing.
 *
 * Nothing here needs the picture, only the mask, so it runs on 256x144 floats
 * instead of a megapixel frame.
 */

export type HeadAnchor = {
	/** horizontal centre of the head, 0-1 across the frame */
	x: number
	/** top of the head, 0-1 down the frame */
	y: number
	/** how wide the head is, as a fraction of the frame width */
	headWidth: number
	/** share of the frame the whole subject covers, 0-1 */
	coverage: number
	/** false when no subject was found at all - the anchor is then a guess */
	found: boolean
}

/**
 * Where an object goes when there is no one in the frame.
 *
 * Centred, and high enough that a sprite drawn there still reads as "behind
 * the subject" the moment they walk back in.
 */
export const FALLBACK_ANCHOR: HeadAnchor = { x: 0.5, y: 0.24, headWidth: 0.22, coverage: 0, found: false }

export type FindHeadAnchorOptions = {
	/** confidence above which a pixel counts as the person, 0-1 */
	threshold?: number
	/**
	 * How much of a row must be subject before the row counts as the crown, as
	 * a fraction of the mask width. Two percent of a 256-wide mask is five
	 * pixels - narrower than any real head, wider than any speck.
	 */
	minRunFraction?: number
	/** how far below the crown the centring band reaches, as a fraction of the frame height */
	bandFraction?: number
}

/**
 * Reads one mask and returns the head anchor.
 *
 * `data` is row-major single-channel confidence, exactly what
 * `PersonSegmenter.segment()` produces.
 */
export function findHeadAnchor(
	data: Float32Array | number[],
	width: number,
	height: number,
	options: FindHeadAnchorOptions = {},
): HeadAnchor {
	if (width <= 0 || height <= 0 || data.length < width * height) return { ...FALLBACK_ANCHOR }

	const threshold = options.threshold ?? 0.5
	const minRun = Math.max(2, Math.round(width * (options.minRunFraction ?? 0.02)))
	const bandRows = Math.max(1, Math.round(height * (options.bandFraction ?? 0.16)))

	let crownRow = -1
	let subjectPixels = 0
	let bandSumX = 0
	let bandCount = 0
	let bandWidest = 0

	for (let y = 0; y < height; y++) {
		const row = y * width
		let count = 0
		let sumX = 0
		for (let x = 0; x < width; x++) {
			if (data[row + x] > threshold) {
				count++
				sumX += x
			}
		}
		subjectPixels += count

		if (crownRow < 0) {
			if (count >= minRun) crownRow = y
			else continue
		}

		if (y - crownRow < bandRows) {
			bandSumX += sumX
			bandCount += count
			if (count > bandWidest) bandWidest = count
		}
	}

	const coverage = subjectPixels / (width * height)
	if (crownRow < 0 || bandCount === 0) return { ...FALLBACK_ANCHOR, coverage }

	return {
		x: bandSumX / bandCount / width,
		y: crownRow / height,
		headWidth: bandWidest / width,
		coverage,
		found: true,
	}
}

/* ==========================================================================
   Steadying the anchor.
   ========================================================================== */

/**
 * A one-euro filter over the anchor.
 *
 * An exponential blend - the obvious way to stop a per-frame anchor
 * wobbling - has one setting and two jobs, and it cannot do both. Damp it
 * enough to kill the wobble on a still speaker and the object visibly trails
 * behind a fast head turn; damp it little enough to keep up with the turn and
 * the wobble comes back. The two cases are not the same signal, and the
 * difference between them is speed.
 *
 * So the cutoff moves with the measured speed: nearly still means a very low
 * cutoff and no jitter, moving fast means a high cutoff and almost no lag.
 * `beta` is how hard speed opens the filter up, `minCutoff` is the floor it
 * relaxes back to. This is Casiez, Roussel and Vogel's one-euro filter, which
 * exists for exactly this problem and is four lines of arithmetic.
 */
export type AnchorFilter = {
	/** Feeds one measurement in and returns the steadied anchor. */
	push(next: HeadAnchor, dtSeconds: number): HeadAnchor
	reset(): void
}

export type AnchorFilterOptions = {
	/** cutoff at a standstill, in hertz - lower is steadier and laggier */
	minCutoff?: number
	/** how much speed raises the cutoff */
	beta?: number
	/** cutoff of the speed estimate itself */
	derivativeCutoff?: number
}

const lowPassAlpha = (cutoff: number, dt: number): number => {
	const tau = 1 / (2 * Math.PI * Math.max(1e-4, cutoff))
	return 1 / (1 + tau / Math.max(1e-4, dt))
}

/**
 * Maps the panel's single 0-1 "damping" slider onto the filter.
 *
 * One slider, because two would be two sliders nobody can reason about. All
 * the way down is a filter that follows the model exactly; all the way up is
 * one that only moves for real motion. `beta` runs the other way, so a heavily
 * damped filter still opens up when the speaker actually turns - which is the
 * whole reason for using this filter rather than a blend.
 */
export function anchorFilterFor(damping: number): AnchorFilter {
	const amount = Math.min(1, Math.max(0, damping))
	// `beta` is in frame-widths per second, because that is the unit the anchor
	// is measured in. A value tuned for pixels would be three orders of
	// magnitude too small here, and the filter would quietly degrade into the
	// plain low-pass it exists to beat - which is exactly the kind of bug that
	// never throws, so `objects:check` measures the difference rather than
	// trusting it.
	return createAnchorFilter({
		minCutoff: 4.5 - amount * 3.9,
		beta: 2 + amount * 8,
	})
}

export function createAnchorFilter(options: AnchorFilterOptions = {}): AnchorFilter {
	const minCutoff = options.minCutoff ?? 1.2
	const beta = options.beta ?? 0.2
	const derivativeCutoff = options.derivativeCutoff ?? 1

	let previous: HeadAnchor | null = null
	let rawX = 0
	let rawY = 0
	let speedX = 0
	let speedY = 0

	const axis = (
		raw: number,
		previousRaw: number,
		hat: number,
		speed: number,
		dt: number,
	): { value: number; speed: number } => {
		const derivative = (raw - previousRaw) / dt
		const smoothedSpeed = speed + lowPassAlpha(derivativeCutoff, dt) * (derivative - speed)
		const cutoff = minCutoff + beta * Math.abs(smoothedSpeed)
		return { value: hat + lowPassAlpha(cutoff, dt) * (raw - hat), speed: smoothedSpeed }
	}

	return {
		reset() {
			previous = null
			speedX = 0
			speedY = 0
		},
		push(next, dtSeconds) {
			const dt = dtSeconds > 0 ? dtSeconds : 1 / 30
			if (!next.found) {
				// A frame with no subject holds the last point rather than
				// snapping to the centre: a speaker who turns fully away for
				// half a second should not send the object across the screen
				// and back.
				return previous
					? { ...previous, coverage: next.coverage, found: false }
					: { ...next }
			}
			if (!previous) {
				previous = { ...next }
				rawX = next.x
				rawY = next.y
				speedX = 0
				speedY = 0
				return { ...next }
			}

			const x = axis(next.x, rawX, previous.x, speedX, dt)
			const y = axis(next.y, rawY, previous.y, speedY, dt)
			rawX = next.x
			rawY = next.y
			speedX = x.speed
			speedY = y.speed

			previous = {
				x: x.value,
				y: y.value,
				// The head width only changes when the shot does, so it gets a
				// plain, heavy low-pass: nothing here needs it to be responsive,
				// and everything needs it not to breathe.
				headWidth: previous.headWidth + 0.08 * (next.headWidth - previous.headWidth),
				coverage: next.coverage,
				found: true,
			}
			return { ...previous }
		},
	}
}

/* ==========================================================================
   Placing the object.
   ========================================================================== */

/**
 * How wide a head is in a shot the studio treats as normal.
 *
 * `head` sizing multiplies the object by how far this shot departs from that,
 * so the same slider produces the same object at a mid shot in either mode and
 * only diverges as the framing does. Without a reference the two modes would
 * be different scales wearing the same label.
 */
export const REFERENCE_HEAD_WIDTH = 0.18

/** Fractions of the frame that the object must stay out of. */
export type SafeArea = { top: number; right: number; bottom: number; left: number }

export const NO_SAFE_AREA: SafeArea = { top: 0, right: 0, bottom: 0, left: 0 }

/**
 * `frame` sizes the object against the picture, `head` against the speaker.
 *
 * Frame sizing is right when the framing is fixed; head sizing is what keeps a
 * cut between a wide shot and a close-up from changing how big the object
 * looks next to the person it belongs to.
 */
export type ObjectSizeMode = 'frame' | 'head'

export type PlacementInput = {
	anchor: HeadAnchor
	/** output frame size, in pixels */
	frameWidth: number
	frameHeight: number
	/** the sprite's own pixel size, used for its aspect ratio */
	spriteWidth: number
	spriteHeight: number
	/** height of the drawn object, as a fraction of the frame height */
	scale: number
	offsetX: number
	offsetY: number
	/** false pins the object to the middle of the frame instead of the head */
	followHead: boolean
	/** `frame` sizes against the picture, `head` against the speaker */
	sizeMode?: ObjectSizeMode
	/** edges the object may not cross - the caption band lives in `bottom` */
	safeArea?: SafeArea
}

export type Placement = {
	/** centre of the drawn object, in pixels */
	centerX: number
	centerY: number
	width: number
	height: number
}

/**
 * Turns an anchor and a look into the rectangle the sprite is drawn into.
 *
 * Two things happen here that the caller should not have to think about.
 *
 * The head measurement is clamped before it can scale anything. A mask that
 * briefly finds a doorway instead of a person reports an enormous head, and
 * without a ceiling that one frame throws a two-metre rocket across the
 * picture - a single bad frame is a flash, and a flash is what people notice.
 *
 * And the object is kept inside its safe area. The caption band is the case
 * that matters: an object that drifts down over the subtitles has broken the
 * one thing this studio exists to do. Where the object is simply larger than
 * the safe box it is centred in it rather than clamped, because clamping
 * something that cannot fit just pins it to an edge and makes it jitter
 * against the boundary.
 */
export function placeObject(input: PlacementInput): Placement {
	const aspect =
		input.spriteWidth > 0 && input.spriteHeight > 0 ? input.spriteWidth / input.spriteHeight : 1

	const headFactor =
		input.sizeMode === 'head'
			? clamp(input.anchor.headWidth, 0.06, 0.45) / REFERENCE_HEAD_WIDTH
			: 1
	const height = Math.max(2, input.frameHeight * input.scale * headFactor)
	const width = Math.max(2, height * aspect)

	const anchorX = input.followHead ? input.anchor.x : 0.5
	const anchorY = input.followHead ? input.anchor.y : 0.24

	// Only a *reserved* edge constrains anything. The frame's own edges do not:
	// a big object peeking out from behind a head is a deliberate look, and
	// forcing every object fully into frame would silently overrule the size
	// and offset the user just set. An edge with nothing reserved is left open.
	const safe = input.safeArea ?? NO_SAFE_AREA
	const bounds = {
		left: safe.left > 0 ? safe.left * input.frameWidth : -Infinity,
		right: safe.right > 0 ? input.frameWidth - safe.right * input.frameWidth : Infinity,
		top: safe.top > 0 ? safe.top * input.frameHeight : -Infinity,
		bottom: safe.bottom > 0 ? input.frameHeight - safe.bottom * input.frameHeight : Infinity,
	}

	return {
		centerX: fit(
			(anchorX + input.offsetX) * input.frameWidth,
			width,
			bounds.left,
			bounds.right,
		),
		centerY: fit(
			(anchorY + input.offsetY) * input.frameHeight,
			height,
			bounds.top,
			bounds.bottom,
		),
		width,
		height,
	}
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))

/**
 * Keeps a centred span inside a range, or centres it when it cannot fit.
 *
 * An open side is `Infinity`, and the arithmetic handles it: an object with
 * one reserved edge is pushed off it and left alone in the other direction.
 * Only when *both* sides are reserved and the object is bigger than the gap
 * between them does it get centred instead of clamped - pinning something that
 * cannot fit just makes it jitter against a boundary.
 */
function fit(center: number, span: number, min: number, max: number): number {
	if (min === -Infinity && max === Infinity) return center
	if (max - min <= span) {
		if (min === -Infinity) return max - span / 2
		if (max === Infinity) return min + span / 2
		return (min + max) / 2
	}
	return clamp(center, min + span / 2, max - span / 2)
}
