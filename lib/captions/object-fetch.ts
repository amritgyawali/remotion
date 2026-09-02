'use client'

/**
 * Getting a real picture of a spoken word, from the web into the vault.
 *
 * The search half is a thin wrapper over `/api/captions/images`, which is where
 * the ladder of sources lives - open and freely licensed first, the whole web
 * next where a key is configured, photographs after that. The part worth
 * reading is what happens *after* the download, because "find a PNG" and "find
 * a PNG that can stand behind someone's head" are not the same request and only
 * the pixels can tell them apart.
 *
 * So candidates are tried in order and measured: decoded, checked for real
 * transparency, and where there is none, put through the flood fill at three
 * escalating strengths. The first one that comes out a genuine cut-out wins and
 * the rest are never downloaded.
 *
 * A word that survives all of that with nothing gets one last sweep, and only
 * because the alternative is an empty frame: the caller asks again with
 * `mode: 'photo'`, which sends the route straight to the photograph rung, and
 * `allowPhoto` then keeps the best of those with its background intact and its
 * edge softened into the frame. That picture is flagged all the way back up, so
 * the panel can name the words that got a photograph rather than a cut-out
 * instead of quietly implying they got the same thing as everything else.
 *
 * Two smaller decisions:
 *
 * - **Everything is re-encoded to PNG here, at a bounded size.** What comes
 *   back from the web is any size and any format - a JPEG from the photograph
 *   rung included; what goes into the vault is one predictable thing the sprite
 *   loader can rasterise without a surprise.
 * - **The download goes through this origin.** A cross-origin image taints
 *   every canvas it touches, and a tainted canvas cannot be read back - which
 *   is exactly what compositing does on every frame of the bake.
 */

import { prepareObjectImage, type PreparedImage, type RgbaImage } from './object-cutout'

/** Every provider the route can answer from. Kept in step with its own union. */
export type ImageSource =
	| 'commons'
	| 'openverse'
	| 'google'
	| 'bing'
	| 'pixabay'
	| 'serpapi'
	| 'pexels'
	| 'unsplash'
	| 'iconify'

/**
 * Which rung of the route's ladder a candidate came from.
 *
 * `open` is freely licensed and needs no key, `web` is the whole internet
 * through a keyed search with its transparency filter on, `photo` is a
 * photograph with a background, and `icon` is the pictogram floor.
 */
export type ImageTier = 'open' | 'web' | 'photo' | 'icon'

/** One picture the search offered, as the route describes it. */
export type ImageCandidate = {
	id: string
	title: string
	url: string
	width: number | null
	height: number | null
	mime: string
	source: ImageSource
	tier: ImageTier
	credit: string
	pageUrl: string | null
	alphaHint: number
}

export type ImageSearchResult = {
	query: string
	candidates: ImageCandidate[]
	/** how far up the ladder this word had to go */
	tiers: ImageTier[]
}

export type SearchObjectImagesArgs = {
	queries: string[]
	/** how many candidates to ask for per word */
	perQuery?: number
	/**
	 * `cutout` climbs the ladder from the open sources up; `photo` goes straight
	 * to the photograph rung. The second is the last sweep, and is only ever sent
	 * for words the first one could not illustrate.
	 */
	mode?: 'cutout' | 'photo'
	signal?: AbortSignal
}

export type SearchObjectImagesResult = {
	results: ImageSearchResult[]
	/** which providers this deployment can actually reach, for the panel to explain itself */
	providers: ImageSource[]
	notice: string | null
}

export async function searchObjectImages(
	args: SearchObjectImagesArgs,
): Promise<SearchObjectImagesResult> {
	const response = await fetch('/api/captions/images', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			queries: args.queries,
			perQuery: args.perQuery ?? 4,
			mode: args.mode ?? 'cutout',
		}),
		signal: args.signal,
	})
	const payload = (await response.json()) as {
		results?: ImageSearchResult[]
		providers?: ImageSource[]
		notice?: string
		error?: string
	}
	if (!response.ok) {
		throw new Error(payload?.error ?? `The picture search returned HTTP ${response.status}.`)
	}
	return {
		results: Array.isArray(payload.results) ? payload.results : [],
		providers: Array.isArray(payload.providers) ? payload.providers : [],
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
	/** a PNG, cut out or softened, trimmed, and ready for the vault */
	blob: Blob
	width: number
	height: number
	candidate: ImageCandidate
	prepared: PreparedImage
	/** true when this is a photograph kept with its background, not a cut-out */
	fallback: boolean
}

export type ResolvePictureArgs = {
	candidates: ImageCandidate[]
	/** longest side of the stored PNG - big enough for 4K, small enough to keep */
	maxSide?: number
	/** how many candidates may be downloaded before giving up on this word */
	maxTries?: number
	/** flood-fill tolerance, 0-100; left unset, the escalating attempts are used */
	tolerance?: number
	feather?: number
	/**
	 * Accept a photograph with its background when nothing cuts out.
	 *
	 * The last sweep only. Everything before it would rather return null and let
	 * the word go without a picture than paste a rectangle behind a head.
	 */
	allowPhoto?: boolean
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

const TIER_ORDER: Record<ImageTier, number> = { open: 0, web: 1, photo: 2, icon: 3 }

/**
 * Puts the candidates in the order they should be spent downloads on.
 *
 * The route already answers in this order, so on a normal run this changes
 * nothing. It is here because the ordering is a property of what the caller
 * needs - transparency first, the pictogram floor last - and not something to
 * inherit silently from whatever the network happened to return.
 */
export function orderCandidates(candidates: ImageCandidate[]): ImageCandidate[] {
	return [...candidates].sort((left, right) => {
		const tier = (TIER_ORDER[left.tier] ?? 9) - (TIER_ORDER[right.tier] ?? 9)
		if (tier !== 0) return tier
		return right.alphaHint - left.alphaHint
	})
}

/** Draws a decoded picture into a bounded buffer the cut-out can work over. */
function rasterise(image: HTMLImageElement, maxSide: number): RgbaImage {
	const naturalWidth = image.naturalWidth || 512
	const naturalHeight = image.naturalHeight || 512
	const ratio = Math.min(1, maxSide / Math.max(naturalWidth, naturalHeight))
	const width = Math.max(8, Math.round(naturalWidth * ratio))
	const height = Math.max(8, Math.round(naturalHeight * ratio))

	const { ctx } = makeCanvas(width, height)
	ctx.clearRect(0, 0, width, height)
	ctx.drawImage(image, 0, 0, width, height)
	return ctx.getImageData(0, 0, width, height) as unknown as RgbaImage
}

/** Re-encodes a prepared buffer as the PNG that goes into the vault. */
async function encodePng(prepared: PreparedImage): Promise<Blob> {
	const out = makeCanvas(prepared.image.width, prepared.image.height)
	// Copied into a fresh buffer on the way back to a canvas: the cut-out works
	// over plain typed arrays so it can run with no canvas at all, and
	// `ImageData` will only accept a buffer it knows is its own.
	out.ctx.putImageData(
		new ImageData(new Uint8ClampedArray(prepared.image.data), prepared.image.width, prepared.image.height),
		0,
		0,
	)
	return canvasToPng(out.canvas)
}

/**
 * Walks the candidates until one of them is genuinely a cut-out.
 *
 * Returns null when none of them is and `allowPhoto` was not set. That is a
 * real answer and the caller has to handle it: the alternative - returning the
 * least bad rectangle on the main pass - would put a white box behind a
 * speaker's head and call the feature finished.
 *
 * With `allowPhoto` set, the best of the pictures that failed is kept instead,
 * with its edge softened, and comes back flagged as a fallback. The decode from
 * the strict pass is reused, so the last resort costs no extra download.
 */
export async function resolveObjectPicture(args: ResolvePictureArgs): Promise<DownloadedPicture | null> {
	const maxSide = Math.max(64, Math.min(2048, args.maxSide ?? DEFAULT_MAX_SIDE))
	const maxTries = Math.max(1, Math.min(8, args.maxTries ?? 4))
	const ordered = orderCandidates(args.candidates).slice(0, maxTries)
	let lastError: Error | null = null

	/** The biggest picture that would not cut out, kept for the last resort. */
	let bestRejected: { candidate: ImageCandidate; decoded: RgbaImage; area: number } | null = null

	for (const candidate of ordered) {
		if (args.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
		try {
			const blob = await downloadImage(candidate.url, args.signal)
			const decoded = rasterise(await decodeBlob(blob), maxSide)

			const prepared = prepareObjectImage(decoded, {
				tolerance: args.tolerance,
				feather: args.feather,
			})
			if (prepared.usable) {
				return {
					blob: await encodePng(prepared),
					width: prepared.image.width,
					height: prepared.image.height,
					candidate,
					prepared,
					fallback: false,
				}
			}

			if (args.allowPhoto) {
				// Resolution is what decides this one: a photograph is going to be
				// used as it arrived, so the one with the most pixels behind it is
				// the one that survives being drawn three head widths across.
				const area = decoded.width * decoded.height
				if (!bestRejected || area > bestRejected.area) bestRejected = { candidate, decoded, area }
			}
		} catch (error) {
			if (args.signal?.aborted) throw error
			lastError = error instanceof Error ? error : new Error(String(error))
		}
	}

	if (bestRejected) {
		const prepared = prepareObjectImage(bestRejected.decoded, {
			tolerance: args.tolerance,
			feather: args.feather,
			allowPhoto: true,
		})
		if (prepared.usable) {
			return {
				blob: await encodePng(prepared),
				width: prepared.image.width,
				height: prepared.image.height,
				candidate: bestRejected.candidate,
				prepared,
				fallback: prepared.fallback,
			}
		}
	}

	if (lastError && args.candidates.length > 0) {
		// Reported rather than thrown: one word losing its picture is not a
		// reason to abandon a plan that has fourteen others.
		console.warn('[objects] no usable picture:', lastError.message)
	}
	return null
}
