'use client'

/**
 * Getting a real picture of a spoken word, from the web into the vault.
 *
 * The search half is a thin wrapper over `/api/captions/images`. The part worth
 * reading is what happens after the download, because "find a PNG" and "find a
 * PNG that can stand behind someone's head" are not the same request and only
 * the pixels can tell them apart.
 *
 * So candidates are tried in order and *measured*: decoded, checked for real
 * transparency, and where there is none, put through one flood fill from the
 * border. The first one that comes out as a genuine cut-out wins and the rest
 * are never downloaded. A word whose every candidate is a rectangle returns
 * nothing at all, and that word is left without an object and named in the
 * panel - which is the honest answer, because a white rectangle behind a
 * speaker's head is worse than nothing behind it.
 *
 * Two smaller decisions:
 *
 * - **Everything is re-encoded to PNG here, at a bounded size.** What comes
 *   back from the web is any size and any format; what goes into the vault is
 *   one predictable thing the sprite loader can rasterise without a surprise.
 * - **The download goes through this origin.** A cross-origin image taints
 *   every canvas it touches, and a tainted canvas cannot be read back - which
 *   is exactly what compositing does on every frame of the bake.
 */

import { prepareObjectImage, type PreparedImage, type RgbaImage } from './object-cutout'

export type ImageSource = 'commons' | 'openverse' | 'iconify'

/** One picture the search offered, as the route describes it. */
export type ImageCandidate = {
	id: string
	title: string
	url: string
	width: number | null
	height: number | null
	mime: string
	source: ImageSource
	credit: string
	pageUrl: string | null
	alphaHint: number
}

export type ImageSearchResult = { query: string; candidates: ImageCandidate[] }

export type SearchObjectImagesArgs = {
	queries: string[]
	/** how many candidates to ask for per word */
	perQuery?: number
	signal?: AbortSignal
}

export async function searchObjectImages(
	args: SearchObjectImagesArgs,
): Promise<{ results: ImageSearchResult[]; notice: string | null }> {
	const response = await fetch('/api/captions/images', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ queries: args.queries, perQuery: args.perQuery ?? 3 }),
		signal: args.signal,
	})
	const payload = (await response.json()) as {
		results?: ImageSearchResult[]
		notice?: string
		error?: string
	}
	if (!response.ok) {
		throw new Error(payload?.error ?? `The picture search returned HTTP ${response.status}.`)
	}
	return {
		results: Array.isArray(payload.results) ? payload.results : [],
		notice: typeof payload.notice === 'string' ? payload.notice : null,
	}
}

/* ==========================================================================
   Downloading and cutting out.
   ========================================================================== */

type Ctx2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D
type AnyCanvas = OffscreenCanvas | HTMLCanvasElement

function makeCanvas(width: number, height: number): { canvas: AnyCanvas; ctx: Ctx2D } {
	if (typeof OffscreenCanvas !== 'undefined') {
		const canvas = new OffscreenCanvas(width, height)
		const ctx = canvas.getContext('2d', { willReadFrequently: true })
		if (!ctx) throw new Error('This browser has no 2D canvas context to prepare the picture with.')
		return { canvas, ctx }
	}
	const canvas = document.createElement('canvas')
	canvas.width = width
	canvas.height = height
	const ctx = canvas.getContext('2d', { willReadFrequently: true })
	if (!ctx) throw new Error('This browser has no 2D canvas context to prepare the picture with.')
	return { canvas, ctx }
}

async function canvasToPng(canvas: AnyCanvas): Promise<Blob> {
	if ('convertToBlob' in canvas) return canvas.convertToBlob({ type: 'image/png' })
	return new Promise<Blob>((resolve, reject) => {
		;(canvas as HTMLCanvasElement).toBlob((blob) => {
			if (blob) resolve(blob)
			else reject(new Error('The picture could not be re-encoded as a PNG.'))
		}, 'image/png')
	})
}

/**
 * Decodes a downloaded file.
 *
 * An `<img>` rather than `createImageBitmap`, because one of the sources
 * returns SVG - an icon, the candidate that is guaranteed to be transparent -
 * and `createImageBitmap` refuses SVG blobs in more than one browser.
 */
async function decodeBlob(blob: Blob): Promise<HTMLImageElement> {
	const url = URL.createObjectURL(blob)
	try {
		const image = new Image()
		image.decoding = 'async'
		image.src = url
		await image.decode().catch(() => {
			throw new Error('That file could not be read as a picture.')
		})
		return image
	} finally {
		// The bitmap is already decoded into the element by the time `decode()`
		// resolves, so the address can go immediately.
		setTimeout(() => URL.revokeObjectURL(url), 0)
	}
}

export type DownloadedPicture = {
	/** a PNG, cut out, trimmed, and ready for the vault */
	blob: Blob
	width: number
	height: number
	candidate: ImageCandidate
	prepared: PreparedImage
}

export type ResolvePictureArgs = {
	candidates: ImageCandidate[]
	/** longest side of the stored PNG - big enough for 4K, small enough to keep */
	maxSide?: number
	/** how many candidates may be downloaded before giving up on this word */
	maxTries?: number
	/** flood-fill tolerance, 0-100 */
	tolerance?: number
	feather?: number
	signal?: AbortSignal
}

const DEFAULT_MAX_SIDE = 900

/** Downloads one picture through this origin and hands back its bytes. */
export async function downloadImage(url: string, signal?: AbortSignal): Promise<Blob> {
	const response = await fetch(`/api/captions/images?url=${encodeURIComponent(url)}`, { signal })
	if (!response.ok) {
		const payload = (await response.json().catch(() => null)) as { error?: string } | null
		throw new Error(payload?.error ?? `That picture host answered ${response.status}.`)
	}
	return response.blob()
}

/**
 * Walks the candidates until one of them is genuinely a cut-out.
 *
 * Returns null when none of them is. That is a real answer and the caller has
 * to handle it: the alternative - returning the least bad rectangle - would put
 * a white box behind a speaker's head and call the feature finished.
 */
export async function resolveObjectPicture(args: ResolvePictureArgs): Promise<DownloadedPicture | null> {
	const maxSide = Math.max(64, Math.min(2048, args.maxSide ?? DEFAULT_MAX_SIDE))
	const maxTries = Math.max(1, Math.min(6, args.maxTries ?? 3))
	let lastError: Error | null = null

	for (const candidate of args.candidates.slice(0, maxTries)) {
		if (args.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
		try {
			const blob = await downloadImage(candidate.url, args.signal)
			const image = await decodeBlob(blob)

			const naturalWidth = image.naturalWidth || 512
			const naturalHeight = image.naturalHeight || 512
			const ratio = Math.min(1, maxSide / Math.max(naturalWidth, naturalHeight))
			const width = Math.max(8, Math.round(naturalWidth * ratio))
			const height = Math.max(8, Math.round(naturalHeight * ratio))

			const { ctx } = makeCanvas(width, height)
			ctx.clearRect(0, 0, width, height)
			ctx.drawImage(image, 0, 0, width, height)
			const decoded = ctx.getImageData(0, 0, width, height) as unknown as RgbaImage

			const prepared = prepareObjectImage(decoded, {
				tolerance: args.tolerance,
				feather: args.feather,
			})
			if (!prepared.usable) continue

			const out = makeCanvas(prepared.image.width, prepared.image.height)
			// Copied into a fresh buffer on the way back to a canvas: the cut-out
			// works over plain typed arrays so it can run with no canvas at all,
			// and `ImageData` will only accept a buffer it knows is its own.
			out.ctx.putImageData(
				new ImageData(
					new Uint8ClampedArray(prepared.image.data),
					prepared.image.width,
					prepared.image.height,
				),
				0,
				0,
			)
			return {
				blob: await canvasToPng(out.canvas),
				width: prepared.image.width,
				height: prepared.image.height,
				candidate,
				prepared,
			}
		} catch (error) {
			if (args.signal?.aborted) throw error
			lastError = error instanceof Error ? error : new Error(String(error))
		}
	}

	if (lastError && args.candidates.length > 0) {
		// Reported rather than thrown: one word losing its picture is not a
		// reason to abandon a plan that has fourteen others.
		console.warn('[objects] no usable picture:', lastError.message)
	}
	return null
}
