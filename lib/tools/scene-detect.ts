'use client'

/**
 * Scene-cut detection.
 *
 * A hard cut is a sudden jump in what's on screen, and that shows up as a
 * spike in frame-to-frame pixel difference even in a tiny, cheap-to-decode
 * thumbnail - no need for the full frame. This decodes the clip once,
 * measures that one number per frame, and returns the timestamps where it
 * spikes well past its own recent average. It is the video equivalent of how
 * `lib/silence/analyze.ts` measures level once and lets every silence
 * setting re-detect from the measurement for free.
 */

export type SceneCut = { atMs: number }

export class SceneDetectCancelled extends Error {
	constructor() {
		super('Cancelled')
		this.name = 'SceneDetectCancelled'
	}
}

/**
 * `sensitivity` is 0-1: higher finds more (and softer) cuts, lower holds out
 * for only the most obvious ones. Cuts closer together than 500 ms are
 * folded into one - a whip-pan or a flash can spike the score twice in a row
 * for what is, editorially, a single moment.
 */
export async function detectSceneCuts(source: Blob, signal: AbortSignal, sensitivity = 0.5): Promise<SceneCut[]> {
	const mediabunny = await import('mediabunny')
	const { ALL_FORMATS, BlobSource, Input, VideoSampleSink } = mediabunny
	const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(source) })
	try {
		const videoTrack = await input.getPrimaryVideoTrack()
		if (!videoTrack) return []
		const sink = new VideoSampleSink(videoTrack)

		const width = 48
		const height = 27
		const canvas = new OffscreenCanvas(width, height)
		const ctx = canvas.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D

		let previous: Uint8ClampedArray | null = null
		const scores: number[] = []
		const timestamps: number[] = []

		for await (const sample of sink.samples()) {
			if (signal.aborted) throw new SceneDetectCancelled()
			ctx.clearRect(0, 0, width, height)
			sample.draw(ctx, 0, 0, width, height)
			const timestampSeconds = sample.timestamp
			sample.close()

			const data = ctx.getImageData(0, 0, width, height).data
			const gray = new Uint8ClampedArray(width * height)
			for (let p = 0, i = 0; p < data.length; p += 4, i++) {
				gray[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]
			}
			if (previous) {
				let diff = 0
				for (let i = 0; i < gray.length; i++) diff += Math.abs(gray[i] - previous[i])
				scores.push(diff / gray.length)
				timestamps.push(timestampSeconds)
			}
			previous = gray
		}
		if (scores.length === 0) return []

		const mean = scores.reduce((a, b) => a + b, 0) / scores.length
		const variance = scores.reduce((a, b) => a + (b - mean) ** 2, 0) / scores.length
		const stdDev = Math.sqrt(variance)
		const multiplier = Math.max(0.8, 3.2 - Math.max(0, Math.min(1, sensitivity)) * 2.4)
		const threshold = mean + stdDev * multiplier

		const cuts: SceneCut[] = []
		let lastCutMs = -Infinity
		for (let i = 0; i < scores.length; i++) {
			if (scores[i] <= threshold) continue
			const atMs = timestamps[i] * 1000
			if (atMs - lastCutMs < 500) continue
			cuts.push({ atMs })
			lastCutMs = atMs
		}
		return cuts
	} finally {
		input.dispose()
	}
}
