'use client'

/**
 * Removing something from the picture: a burnt-in logo, a timecode, a
 * bystander's face, a competitor's watermark.
 *
 * Three honest options, in order of how hard they try:
 *
 * - **Blur** and **pixelate** do not remove anything, they obscure it. They
 *   are here because that is often what is actually wanted (a number plate, a
 *   screen full of private data) and because they are exact - nothing can go
 *   wrong with them.
 * - **Fill** genuinely reconstructs. It solves Laplace's equation across the
 *   marked region with the surrounding pixels as a fixed boundary, which is
 *   the classical diffusion inpaint: the result is the smoothest surface that
 *   meets the edges of the hole exactly. On the flat backgrounds watermarks
 *   normally sit on - a sky, a wall, a gradient, a blurred plate - it is
 *   indistinguishable from the real thing. Over detailed texture it will
 *   smear, and the UI says so rather than pretending otherwise.
 *
 * The solve runs on a downsampled copy of the region and is upsampled back.
 * That is not a shortcut: a diffusion result is by definition low-frequency,
 * so solving it at full resolution costs a hundred times as much to produce
 * an answer that differs by less than a code value. Grain is added back over
 * the fill afterwards, matched to the surrounding noise level, because a
 * perfectly smooth patch in a grainy frame is the thing the eye actually
 * catches.
 */

import type { FramePass } from './frame-ops'

export type InpaintMode = 'fill' | 'blur' | 'pixelate'

export const INPAINT_MODES: Array<{ id: InpaintMode; label: string; blurb: string }> = [
	{ id: 'fill', label: 'Fill it in', blurb: 'Reconstructs the region from its own edges. Best over flat or soft backgrounds.' },
	{ id: 'blur', label: 'Blur it out', blurb: 'Obscures without reconstructing - exact, and obviously deliberate.' },
	{ id: 'pixelate', label: 'Pixelate it', blurb: 'Blocks the region out. The standard for anything private.' },
]

export type InpaintRegion = {
	/** all four as a fraction of the frame */
	x: number
	y: number
	width: number
	height: number
}

export type InpaintSettings = {
	mode: InpaintMode
	region: InpaintRegion
	/** 0-1; how far the edge of the patch is blended into the picture */
	feather: number
	/** 0-1; strength for blur and pixelate */
	strength: number
	/** puts the grain back over a fill so the patch does not read as glass */
	matchGrain: boolean
}

/** The size the diffusion is solved at - past this, the extra cost buys nothing. */
const SOLVE_MAX = 96
/** Jacobi sweeps. Enough for the residual to fall below a code value at this size. */
const SOLVE_ITERATIONS = 220

function makeCanvas(width: number, height: number): { canvas: OffscreenCanvas; ctx: OffscreenCanvasRenderingContext2D } | null {
	if (typeof OffscreenCanvas === 'undefined') return null
	const canvas = new OffscreenCanvas(Math.max(1, width), Math.max(1, height))
	const ctx = canvas.getContext('2d', { willReadFrequently: true })
	if (!ctx) return null
	return { canvas, ctx }
}

/**
 * Solves the marked pixels of a grid from the unmarked ones around them.
 *
 * `free` is 1 where the picture is being reconstructed and 0 where it is real.
 * Only free pixels are ever written, so every real pixel in the grid acts as a
 * boundary condition - which is the whole point: the fill has to meet the
 * *surrounding picture*, not merely the outermost ring of the buffer. Each
 * sweep replaces a free pixel with the average of its four neighbours, which
 * is a Jacobi relaxation of the Laplace equation. Red-black ordering would
 * converge in half the sweeps; plain Jacobi with a fixed count is easier to
 * reason about and this grid is at most 96 pixels on a side.
 */
function diffuse(grid: Float32Array, free: Uint8Array, width: number, height: number): void {
	const next = new Float32Array(grid.length)
	next.set(grid)
	for (let iteration = 0; iteration < SOLVE_ITERATIONS; iteration++) {
		for (let y = 1; y < height - 1; y++) {
			const row = y * width
			for (let x = 1; x < width - 1; x++) {
				const index = row + x
				if (!free[index]) continue
				next[index] = (grid[index - 1] + grid[index + 1] + grid[index - width] + grid[index + width]) * 0.25
			}
		}
		grid.set(next)
	}
}

/** How much noise the ring around the hole has, so the fill can be given the same. */
function measureGrain(data: Uint8ClampedArray, width: number, height: number): number {
	let sum = 0
	let count = 0
	for (let y = 1; y < height - 1; y++) {
		for (let x = 1; x < width - 1; x++) {
			// Only the border ring is real picture; the middle is the thing being
			// removed and would poison the estimate.
			const onRing = x < 3 || y < 3 || x > width - 4 || y > height - 4
			if (!onRing) continue
			const index = (y * width + x) * 4
			const centre = data[index]
			const neighbours = (data[index - 4] + data[index + 4] + data[index - width * 4] + data[index + width * 4]) * 0.25
			sum += Math.abs(centre - neighbours)
			count++
		}
	}
	return count > 0 ? sum / count : 0
}

export type InpaintPass = FramePass & { dispose(): void }

export function createInpaintPass(settings: InpaintSettings): InpaintPass {
	let patch = makeCanvas(2, 2)
	let solveScratch = makeCanvas(2, 2)

	return {
		apply(ctx, width, height, frameIndex) {
			const rx = Math.round(settings.region.x * width)
			const ry = Math.round(settings.region.y * height)
			const rw = Math.max(2, Math.round(settings.region.width * width))
			const rh = Math.max(2, Math.round(settings.region.height * height))
			// The margin is the boundary the fill reads from and the band the
			// feather blends across, so both modes need it.
			const margin = Math.max(2, Math.round(Math.min(rw, rh) * 0.25))
			const bx = Math.max(0, rx - margin)
			const by = Math.max(0, ry - margin)
			const bw = Math.min(width - bx, rw + margin * 2)
			const bh = Math.min(height - by, rh + margin * 2)
			if (bw < 4 || bh < 4 || !patch || !solveScratch) return

			if (patch.canvas.width !== bw || patch.canvas.height !== bh) {
				patch.canvas.width = bw
				patch.canvas.height = bh
			}
			patch.ctx.setTransform(1, 0, 0, 1, 0, 0)
			patch.ctx.filter = 'none'
			patch.ctx.clearRect(0, 0, bw, bh)
			patch.ctx.drawImage(ctx.canvas as unknown as CanvasImageSource, bx, by, bw, bh, 0, 0, bw, bh)

			if (settings.mode === 'blur') {
				// The scratch is reused rather than reallocated: a fresh canvas per
				// frame is thousands of allocations over a clip, and the GPU-backed
				// ones are not cheap to make.
				const radius = Math.max(2, Math.round(Math.min(rw, rh) * 0.35 * settings.strength))
				if (solveScratch.canvas.width !== bw || solveScratch.canvas.height !== bh) {
					solveScratch.canvas.width = bw
					solveScratch.canvas.height = bh
				}
				solveScratch.ctx.filter = `blur(${radius}px)`
				solveScratch.ctx.clearRect(0, 0, bw, bh)
				solveScratch.ctx.drawImage(patch.canvas, 0, 0)
				solveScratch.ctx.filter = 'none'
				patch.ctx.drawImage(solveScratch.canvas, 0, 0)
			} else if (settings.mode === 'pixelate') {
				const blocks = Math.max(3, Math.round(28 - settings.strength * 24))
				const blockHeight = Math.max(2, Math.round((bh / bw) * blocks))
				if (solveScratch.canvas.width !== blocks || solveScratch.canvas.height !== blockHeight) {
					solveScratch.canvas.width = blocks
					solveScratch.canvas.height = blockHeight
				}
				solveScratch.ctx.clearRect(0, 0, blocks, blockHeight)
				solveScratch.ctx.drawImage(patch.canvas, 0, 0, blocks, blockHeight)
				patch.ctx.imageSmoothingEnabled = false
				patch.ctx.drawImage(solveScratch.canvas, 0, 0, bw, bh)
				patch.ctx.imageSmoothingEnabled = true
			} else {
				// --- the diffusion fill -----------------------------------------
				const scale = Math.min(1, SOLVE_MAX / Math.max(bw, bh))
				const sw = Math.max(4, Math.round(bw * scale))
				const sh = Math.max(4, Math.round(bh * scale))
				if (solveScratch.canvas.width !== sw || solveScratch.canvas.height !== sh) {
					solveScratch.canvas.width = sw
					solveScratch.canvas.height = sh
				}
				solveScratch.ctx.clearRect(0, 0, sw, sh)
				solveScratch.ctx.drawImage(patch.canvas, 0, 0, sw, sh)
				const small = solveScratch.ctx.getImageData(0, 0, sw, sh)
				const grain = settings.matchGrain ? measureGrain(small.data, sw, sh) : 0

				// The hole in solve-space: the original region, shrunk by the same
				// factor, and never touching the outermost ring.
				const holeX = Math.max(1, Math.round((rx - bx) * scale))
				const holeY = Math.max(1, Math.round((ry - by) * scale))
				const holeW = Math.min(sw - holeX - 1, Math.max(1, Math.round(rw * scale)))
				const holeH = Math.min(sh - holeY - 1, Math.max(1, Math.round(rh * scale)))

				// One mask for all three channels: the pixels being reconstructed.
				const free = new Uint8Array(sw * sh)
				for (let y = holeY; y < holeY + holeH; y++) {
					for (let x = holeX; x < holeX + holeW; x++) free[y * sw + x] = 1
				}

				for (let channel = 0; channel < 3; channel++) {
					const grid = new Float32Array(sw * sh)
					for (let i = 0; i < sw * sh; i++) grid[i] = small.data[i * 4 + channel]
					// Seed the hole with the mean of its own boundary. A better start
					// is fewer sweeps to the same answer.
					let seed = 0
					let seedCount = 0
					for (let x = holeX; x < holeX + holeW; x++) {
						seed += grid[(holeY - 1) * sw + x] + grid[(holeY + holeH) * sw + x]
						seedCount += 2
					}
					for (let y = holeY; y < holeY + holeH; y++) {
						seed += grid[y * sw + holeX - 1] + grid[y * sw + holeX + holeW]
						seedCount += 2
					}
					const mean = seedCount > 0 ? seed / seedCount : 128
					for (let y = holeY; y < holeY + holeH; y++) {
						for (let x = holeX; x < holeX + holeW; x++) grid[y * sw + x] = mean
					}

					diffuse(grid, free, sw, sh)
					for (let y = holeY; y < holeY + holeH; y++) {
						for (let x = holeX; x < holeX + holeW; x++) {
							const index = y * sw + x
							small.data[index * 4 + channel] = grid[index]
						}
					}
				}

				if (grain > 0.5) {
					// A deterministic noise keyed on the frame index, so the grain
					// moves the way real grain does instead of sitting still.
					let seed = (frameIndex * 2654435761) >>> 0
					for (let y = holeY; y < holeY + holeH; y++) {
						for (let x = holeX; x < holeX + holeW; x++) {
							seed = (seed * 1664525 + 1013904223) >>> 0
							const noise = (seed / 0xffffffff - 0.5) * grain * 2
							const index = (y * sw + x) * 4
							small.data[index] += noise
							small.data[index + 1] += noise
							small.data[index + 2] += noise
						}
					}
				}

				solveScratch.ctx.putImageData(small, 0, 0)
				patch.ctx.imageSmoothingEnabled = true
				patch.ctx.drawImage(solveScratch.canvas, 0, 0, bw, bh)
			}

			// Feather the patch back in: a radial alpha ramp cut out of the patch
			// means the join is a gradient rather than a rectangle of new pixels.
			const feather = Math.max(0, Math.min(1, settings.feather))
			if (feather > 0.01) {
				const inner = 1 - feather * 0.55
				const gradient = patch.ctx.createRadialGradient(bw / 2, bh / 2, (Math.min(bw, bh) / 2) * inner, bw / 2, bh / 2, Math.max(bw, bh) / 2)
				gradient.addColorStop(0, 'rgba(0,0,0,1)')
				gradient.addColorStop(1, 'rgba(0,0,0,0)')
				patch.ctx.save()
				patch.ctx.globalCompositeOperation = 'destination-in'
				patch.ctx.fillStyle = gradient
				patch.ctx.fillRect(0, 0, bw, bh)
				patch.ctx.restore()
			}

			ctx.save()
			ctx.filter = 'none'
			ctx.globalCompositeOperation = 'source-over'
			ctx.drawImage(patch.canvas as unknown as CanvasImageSource, bx, by)
			ctx.restore()
		},
		dispose() {
			patch = null
			solveScratch = null
		},
	}
}
