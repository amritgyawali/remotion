'use client'

/**
 * "Give me the frame at this time" for a clip that is being read strictly
 * forwards.
 *
 * Two tools need to sample several clips at once - a transition, which
 * overlaps two, and a split screen, which shows up to four side by side - and
 * both walk time forwards from zero. The obvious way to serve them is a seek
 * per frame, and it is a trap: `getSample` has to decode from the nearest
 * keyframe every time it is called, so a clip with two-second GOPs decodes
 * something like sixty times more frames than it contains.
 *
 * A forward reader instead holds one async iterator over the clip's own
 * frames and advances it until the frame covering the requested time has been
 * drawn. Every frame is decoded exactly once, in the direction codecs are
 * built for, and the whole thing is three pieces of state: the iterator, the
 * frame that has been pulled but is not due yet, and the canvas the last due
 * frame was drawn into.
 *
 * The one rule is in the name: `at()` must be called with non-decreasing
 * times. Asking for an earlier time returns the frame that is already there,
 * which is the right answer for a paused or held clip and the wrong answer
 * for a seek - so callers that need to seek should not be using this.
 */

import { drawFrame, type FrameOpsDims, type FrameOpsParams } from './frame-ops'

/** The slice of mediabunny's `VideoSample` this needs, so nothing here imports it. */
export type ReadableSample = {
	timestamp: number
	draw(
		context: CanvasRenderingContext2D,
		sx: number,
		sy: number,
		sw: number,
		sh: number,
		dx: number,
		dy: number,
		dw: number,
		dh: number,
	): void
	close(): void
}

export type ForwardFrameReader = {
	/** The frame covering `time`, or null before the clip's first frame. */
	at(time: number): Promise<OffscreenCanvas | null>
	/** True once the clip has run out of frames - the last one is still returned. */
	readonly ended: boolean
	dispose(): void
}

export function createForwardFrameReader(
	samples: AsyncIterable<ReadableSample>,
	params: FrameOpsParams,
	dims: FrameOpsDims,
): ForwardFrameReader {
	const canvas = new OffscreenCanvas(dims.width, dims.height)
	const context = canvas.getContext('2d')
	if (!context) throw new Error('This browser has no 2D canvas context to draw frames with.')

	const iterator = samples[Symbol.asyncIterator]()
	let pending: ReadableSample | null = null
	let exhausted = false
	let hasDrawn = false

	return {
		get ended() {
			return exhausted
		},
		async at(time: number) {
			while (!exhausted) {
				if (!pending) {
					const next = await iterator.next()
					if (next.done || !next.value) {
						exhausted = true
						break
					}
					pending = next.value
				}
				// Everything at or before `time` is consumed, so the frame left
				// standing is the last one whose presentation time has arrived -
				// which is exactly what a player would be showing.
				if (pending.timestamp > time) break
				const sample = pending
				drawFrame(
					context,
					(target, sx, sy, sw, sh, dx, dy, dw, dh) => sample.draw(target as CanvasRenderingContext2D, sx, sy, sw, sh, dx, dy, dw, dh),
					params,
					dims,
				)
				sample.close()
				pending = null
				hasDrawn = true
			}
			return hasDrawn ? canvas : null
		},
		dispose() {
			pending?.close()
			pending = null
			void iterator.return?.(undefined)
		},
	}
}
