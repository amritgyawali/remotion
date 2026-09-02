/**
 * Finding a real picture of the thing the speaker just said, on the open web.
 *
 * The studio's own art pack is a few dozen shapes. A transcript is about
 * whatever it is about - a monastery, a mango, a motherboard - and no hand-made
 * pack covers that, so the one-press flow needs somewhere to get an actual
 * photograph or cut-out of the word it picked. This route is that somewhere.
 *
 * Three sources, in the order they are trusted:
 *
 *   1. **Wikimedia Commons**, restricted to PNGs. Free to reuse, no key, and
 *      the PNG restriction is doing real work: a PNG on Commons is far more
 *      often a cut-out on transparency than a JPEG ever is, and transparency is
 *      the whole requirement - a rectangle pasted behind someone's head is a
 *      sticker, not a composite.
 *   2. **Openverse**, the same idea across a much larger index. It is second
 *      because it is rate limited without a token and answers 502 often enough
 *      that it cannot be the thing the feature depends on.
 *   3. **Iconify**, two hundred thousand icon SVGs. Not a photograph, but
 *      guaranteed transparent, guaranteed to exist for an ordinary noun, and
 *      recoloured white so it reads against dark footage. This is the floor
 *      that keeps the button working when the other two find nothing.
 *
 * Nothing here decides which candidate is *used*. The route returns several,
 * ranked, and the browser downloads them in order and measures the alpha it
 * actually got - because whether a file is a cut-out is a fact about its
 * pixels, and no amount of reading a title tells you.
 *
 * The GET half is a download proxy. It exists because a canvas that draws a
 * cross-origin image is tainted and can never be read back, which would break
 * every frame of the bake. It fetches through the same vetted path as the video
 * importer - see `lib/server/public-fetch.ts` - and refuses anything that is
 * not an image.
 */

import { NextResponse } from 'next/server'
import {
	PublicFetchError,
	cappedBody,
	fetchPublicUrl,
	parsePublicUrl,
} from '../../../../lib/server/public-fetch'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** A single picture is never legitimately this big for a sprite behind a head. */
const MAX_IMAGE_BYTES = 24 * 1024 * 1024
const TOO_LARGE = 'That picture is larger than the studio will load for one object.'
const ACCEPT_IMAGES = 'image/png,image/webp,image/svg+xml,image/*;q=0.8'

const MAX_QUERIES = 24
const MAX_PER_QUERY = 6
const SEARCH_TIMEOUT_MS = 12_000

const COMMONS_ENDPOINT = 'https://commons.wikimedia.org/w/api.php'
const OPENVERSE_ENDPOINT = 'https://api.openverse.org/v1/images/'
const ICONIFY_SEARCH = 'https://api.iconify.design/search'
const ICONIFY_FILE = 'https://api.iconify.design'

const USER_AGENT = 'RemotionVideoStudio/1.0 (subtitle object layer; +https://github.com/amritgyawali/remotion)'

export type ImageSource = 'commons' | 'openverse' | 'iconify'

export type ImageCandidate = {
	id: string
	title: string
	/** the address the browser downloads through this route's GET half */
	url: string
	width: number | null
	height: number | null
	mime: string
	source: ImageSource
	/** shown under the shot, so a reused picture carries its credit */
	credit: string
	pageUrl: string | null
	/**
	 * How likely this file is already a cut-out on transparency, 0-1.
	 *
	 * A guess from the title and the source, used only for ordering. The
	 * browser measures the truth after it downloads.
	 */
	alphaHint: number
}

type QueryResult = { query: string; candidates: ImageCandidate[] }

/* -------------------------------------------------------------------------- */
/*  Ranking                                                                   */
/* -------------------------------------------------------------------------- */

/** Words in a file name that almost always mean a cut-out on transparency. */
const CUTOUT_WORDS = [
	'transparent',
	'cutout',
	'cut out',
	'icon',
	'logo',
	'silhouette',
	'clipart',
	'clip art',
	'symbol',
	'sticker',
	'emblem',
	'noun project',
	'(psf)',
	'isolated',
	'no background',
]

/** Words that mean the opposite: a page of text, a chart, a screenshot. */
const FLAT_WORDS = [
	'screenshot',
	'diagram',
	'map of',
	'plan of',
	'chart',
	'graph',
	'scan',
	'page',
	'document',
	'poster',
	'timeline',
]

function alphaHintFor(title: string, source: ImageSource): number {
	if (source === 'iconify') return 1
	const lower = title.toLowerCase()
	let hint = source === 'commons' ? 0.4 : 0.3
	if (CUTOUT_WORDS.some((word) => lower.includes(word))) hint += 0.45
	if (FLAT_WORDS.some((word) => lower.includes(word))) hint -= 0.3
	return Math.max(0, Math.min(1, hint))
}

/**
 * Orders the candidates for one word.
 *
 * Transparency first, because a picture that has to have its background
 * guessed at is a worse object than one that arrived cut out. Then a bias
 * towards squarish, sensibly sized files: a 6000px panorama of a mountain
 * range and a 40px favicon are both wrong behind a head, for opposite reasons.
 */
function scoreCandidate(candidate: ImageCandidate): number {
	const width = candidate.width ?? 800
	const height = candidate.height ?? 800
	const aspect = width > 0 && height > 0 ? width / height : 1
	const squareness = 1 / (1 + Math.abs(Math.log(aspect)))
	const size = Math.min(width, height)
	// 400-2400 px on the short side is the band a sprite is drawn from without
	// either softening or wasting a decode.
	const sizeFit = size < 200 ? 0.3 : size > 4000 ? 0.5 : 1
	return candidate.alphaHint * 2.2 + squareness * 0.8 + sizeFit * 0.6
}

/* -------------------------------------------------------------------------- */
/*  Sources                                                                   */
/* -------------------------------------------------------------------------- */

async function readJson(url: string, signal: AbortSignal): Promise<unknown | null> {
	try {
		const response = await fetch(url, {
			headers: { accept: 'application/json', 'user-agent': USER_AGENT },
			signal,
			cache: 'no-store',
		})
		if (!response.ok) return null
		return (await response.json()) as unknown
	} catch {
		return null
	}
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
	typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null

const asString = (value: unknown): string => (typeof value === 'string' ? value : '')
const asNumber = (value: unknown): number | null =>
	typeof value === 'number' && Number.isFinite(value) ? value : null

/**
 * Commons, PNG only.
 *
 * `iiurlwidth` is asked for so what comes back is a thumbnail rather than the
 * original: a Commons PNG can be sixty megabytes, and the sprite is drawn at a
 * few hundred pixels. The thumbnailer keeps the alpha channel, so the cut-out
 * survives the shrink.
 */
async function searchCommons(query: string, limit: number, signal: AbortSignal): Promise<ImageCandidate[]> {
	const params = new URLSearchParams({
		action: 'query',
		format: 'json',
		formatversion: '2',
		origin: '*',
		generator: 'search',
		gsrsearch: `${query} filemime:image/png`,
		gsrnamespace: '6',
		gsrlimit: String(Math.min(20, limit * 3)),
		prop: 'imageinfo',
		iiprop: 'url|size|mime|extmetadata',
		iiurlwidth: '800',
	})
	const payload = asRecord(await readJson(`${COMMONS_ENDPOINT}?${params.toString()}`, signal))
	const pages = asRecord(payload?.query)?.pages
	if (!Array.isArray(pages)) return []

	return pages.flatMap((raw): ImageCandidate[] => {
		const page = asRecord(raw)
		const info = asRecord(Array.isArray(page?.imageinfo) ? page?.imageinfo[0] : null)
		if (!page || !info) return []
		const url = asString(info.thumburl) || asString(info.url)
		if (!url) return []
		const title = asString(page.title).replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, '')
		const licence = asString(asRecord(asRecord(info.extmetadata)?.LicenseShortName)?.value) || 'see Commons'
		const artist = asString(asRecord(asRecord(info.extmetadata)?.Artist)?.value).replace(/<[^>]*>/g, '').trim()
		return [
			{
				id: `commons:${asString(page.pageid) || title}`,
				title,
				url,
				width: asNumber(info.thumbwidth) ?? asNumber(info.width),
				height: asNumber(info.thumbheight) ?? asNumber(info.height),
				mime: asString(info.mime) || 'image/png',
				source: 'commons',
				credit: `${title} · ${artist || 'Wikimedia Commons'} · ${licence}`,
				pageUrl: asString(info.descriptionurl) || null,
				alphaHint: alphaHintFor(title, 'commons'),
			},
		]
	})
}

/** Openverse, PNGs that are cleared for commercial reuse. */
async function searchOpenverse(query: string, limit: number, signal: AbortSignal): Promise<ImageCandidate[]> {
	const params = new URLSearchParams({
		q: query,
		extension: 'png',
		license_type: 'commercial,modification',
		page_size: String(Math.min(20, limit * 2)),
		mature: 'false',
	})
	const payload = asRecord(await readJson(`${OPENVERSE_ENDPOINT}?${params.toString()}`, signal))
	const results = payload?.results
	if (!Array.isArray(results)) return []

	return results.flatMap((raw): ImageCandidate[] => {
		const item = asRecord(raw)
		const url = asString(item?.url)
		if (!item || !url) return []
		const title = asString(item.title) || query
		return [
			{
				id: `openverse:${asString(item.id) || url}`,
				title,
				url,
				width: asNumber(item.width),
				height: asNumber(item.height),
				mime: 'image/png',
				source: 'openverse',
				credit: `${title} · ${asString(item.creator) || 'unknown'} · ${asString(item.license).toUpperCase() || 'open licence'}`,
				pageUrl: asString(item.foreign_landing_url) || null,
				alphaHint: alphaHintFor(title, 'openverse'),
			},
		]
	})
}

/**
 * Iconify, recoloured white.
 *
 * The floor of the whole search: an ordinary noun always has an icon, an icon
 * is always transparent, and white reads against the dark half of almost any
 * frame. It is asked for at 512 so the rasteriser has something to work with.
 */
async function searchIconify(query: string, limit: number, signal: AbortSignal): Promise<ImageCandidate[]> {
	const params = new URLSearchParams({ query, limit: String(Math.min(32, Math.max(8, limit * 4))) })
	const payload = asRecord(await readJson(`${ICONIFY_SEARCH}?${params.toString()}`, signal))
	const icons = payload?.icons
	if (!Array.isArray(icons)) return []

	return icons.slice(0, limit).flatMap((raw): ImageCandidate[] => {
		const name = asString(raw)
		const [prefix, icon] = name.split(':')
		if (!prefix || !icon) return []
		return [
			{
				id: `iconify:${name}`,
				title: icon.replace(/-/g, ' '),
				url: `${ICONIFY_FILE}/${prefix}/${icon}.svg?height=512&color=%23ffffff`,
				width: 512,
				height: 512,
				mime: 'image/svg+xml',
				source: 'iconify',
				credit: `${icon.replace(/-/g, ' ')} · Iconify (${prefix})`,
				pageUrl: `https://icon-sets.iconify.design/${prefix}/${icon}/`,
				alphaHint: 1,
			},
		]
	})
}

/**
 * Everything that answered, best first, one entry per file.
 *
 * The sources run together rather than in sequence: Openverse is the slow one
 * and waiting for it before asking Commons would make the whole flow as slow as
 * its worst source.
 */
async function searchOne(query: string, perQuery: number, signal: AbortSignal): Promise<ImageCandidate[]> {
	const [commons, openverse, iconify] = await Promise.all([
		searchCommons(query, perQuery, signal),
		searchOpenverse(query, perQuery, signal),
		searchIconify(query, 2, signal),
	])

	const seen = new Set<string>()
	const photographs: ImageCandidate[] = []
	for (const candidate of [...commons, ...openverse]) {
		if (seen.has(candidate.url)) continue
		seen.add(candidate.url)
		photographs.push(candidate)
	}
	photographs.sort((left, right) => scoreCandidate(right) - scoreCandidate(left))

	// The icon goes last, always, however transparent it is. It is the floor of
	// the search, not the goal of it: someone who asks for a picture of a mango
	// wants a mango, and gets a pictogram of one only when the web could not
	// supply the real thing in a form that cuts out. The browser walks this list
	// in order and stops at the first one that works, so "last" means "only if
	// nothing above it survived".
	const icon = iconify[0]
	const room = icon ? Math.max(1, perQuery - 1) : perQuery
	const top = photographs.slice(0, room)
	if (icon) top.push(icon)
	return top
}

/* -------------------------------------------------------------------------- */
/*  Handlers                                                                  */
/* -------------------------------------------------------------------------- */

export async function POST(request: Request) {
	let body: { queries?: unknown; perQuery?: unknown }
	try {
		body = (await request.json()) as { queries?: unknown; perQuery?: unknown }
	} catch {
		return NextResponse.json({ error: 'Malformed JSON body.' }, { status: 400 })
	}

	const queries = Array.isArray(body.queries)
		? body.queries
				.filter((query): query is string => typeof query === 'string')
				.map((query) => query.replace(/[^\p{L}\p{N}\s'-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 60))
				.filter((query) => query.length > 1)
		: []

	if (queries.length === 0) {
		return NextResponse.json({ error: 'Send at least one word to search for.' }, { status: 400 })
	}
	if (queries.length > MAX_QUERIES) {
		return NextResponse.json({ error: `Send at most ${MAX_QUERIES} words per request.` }, { status: 400 })
	}

	const perQuery = Math.max(1, Math.min(MAX_PER_QUERY, Number(body.perQuery) || 3))

	try {
		const results: QueryResult[] = []
		// Four words at a time: enough to hide the latency of a slow source,
		// few enough that Commons starts refusing the burst.
		//
		// The timeout is per batch rather than per request. Shared, a slow first
		// batch would spend the whole budget and every word after it would come
		// back empty - which reads to the user as "the web has no picture of a
		// mango" when what happened was that Commons was busy.
		for (let at = 0; at < queries.length; at += 4) {
			const batch = queries.slice(at, at + 4)
			const controller = new AbortController()
			const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS)
			try {
				const found = await Promise.all(
					batch.map(async (query) => ({
						query,
						candidates: await searchOne(query, perQuery, controller.signal),
					})),
				)
				results.push(...found)
			} finally {
				clearTimeout(timer)
			}
		}

		const empty = results.filter((result) => result.candidates.length === 0).map((result) => result.query)
		return NextResponse.json(
			{
				results,
				notice:
					empty.length > 0
						? `No picture was found for ${empty.slice(0, 6).join(', ')}. Those words are left without an object rather than given an unrelated one.`
						: null,
			},
			{ headers: { 'cache-control': 'no-store' } },
		)
	} catch (error) {
		const message = error instanceof Error ? error.message : 'The picture search failed.'
		return NextResponse.json({ error: message, results: [] }, { status: 502 })
	}
}

/**
 * Downloads one picture through this origin.
 *
 * Same-origin is the entire point: an <img> from another host taints every
 * canvas it is drawn into, and a tainted canvas cannot be read back - which is
 * exactly what compositing an object behind a person does, every frame.
 */
export async function GET(request: Request) {
	const raw = new URL(request.url).searchParams.get('url')
	if (!raw) return NextResponse.json({ error: 'Send the address of a picture.' }, { status: 400 })

	try {
		const upstream = await fetchPublicUrl(parsePublicUrl(raw), {
			accept: ACCEPT_IMAGES,
			userAgent: USER_AGENT,
		})

		if (upstream.status >= 400) {
			upstream.stream.resume()
			return NextResponse.json(
				{ error: `That picture host answered ${upstream.status}.` },
				{ status: upstream.status === 404 ? 404 : 502 },
			)
		}

		const header = upstream.headers['content-type']
		const type = (typeof header === 'string' ? header.split(';')[0].trim().toLowerCase() : '') || 'image/png'
		if (!type.startsWith('image/')) {
			upstream.stream.resume()
			return NextResponse.json({ error: `That address returned ${type}, which is not a picture.` }, { status: 415 })
		}

		const length = Number(upstream.headers['content-length'] ?? Number.NaN)
		if (Number.isFinite(length) && length > MAX_IMAGE_BYTES) {
			upstream.stream.resume()
			return NextResponse.json({ error: TOO_LARGE }, { status: 413 })
		}

		const headers = new Headers()
		headers.set('content-type', type)
		if (Number.isFinite(length)) headers.set('content-length', String(length))
		headers.set('cache-control', 'private, max-age=600')
		headers.set('x-content-type-options', 'nosniff')
		headers.set('cross-origin-resource-policy', 'same-origin')
		// An SVG served from this origin would otherwise be a same-origin
		// document if it were ever navigated to; nothing in it may run.
		headers.set('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox")

		return new NextResponse(
			cappedBody(upstream.stream, { maxBytes: MAX_IMAGE_BYTES, tooLarge: TOO_LARGE }) as unknown as BodyInit,
			{ status: 200, headers },
		)
	} catch (error) {
		const status = error instanceof PublicFetchError ? error.status : 502
		const message = error instanceof Error ? error.message : 'That picture could not be loaded.'
		return NextResponse.json({ error: message }, { status })
	}
}
