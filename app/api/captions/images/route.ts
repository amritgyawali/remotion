/**
 * The two HTTP verbs over the picture search.
 *
 * All the thinking - which sources, in what order, what counts as a watermark,
 * how a candidate is ranked - is in `lib/captions/image-search.ts`. What is
 * left here is the shell: validate a request, call the search, and stream one
 * picture back through this origin.
 *
 * The GET half is a download proxy. It exists because a canvas that draws a
 * cross-origin image is tainted and can never be read back, which would break
 * every frame of the bake. It fetches through the same vetted path as the video
 * importer - see `lib/server/public-fetch.ts` - and refuses anything that is
 * not an image.
 */

import { NextResponse } from 'next/server'
import {
	KEYLESS,
	MAX_PER_QUERY,
	MAX_QUERIES,
	WATERMARK_HOSTS,
	configuredProviders,
	searchImages,
	tidyQuery,
	type QueryResult,
	type SearchMode,
} from '../../../../lib/captions/image-search'
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

const USER_AGENT = 'RemotionVideoStudio/1.0 (subtitle object layer; +https://github.com/amritgyawali/remotion)'


export async function POST(request: Request) {
	let body: { queries?: unknown; perQuery?: unknown; mode?: unknown }
	try {
		body = (await request.json()) as { queries?: unknown; perQuery?: unknown; mode?: unknown }
	} catch {
		return NextResponse.json({ error: 'Malformed JSON body.' }, { status: 400 })
	}

	const queries = Array.isArray(body.queries)
		? body.queries
				.filter((query): query is string => typeof query === 'string')
				.map(tidyQuery)
				.filter((query) => query.length > 1)
		: []

	if (queries.length === 0) {
		return NextResponse.json({ error: 'Send at least one word to search for.' }, { status: 400 })
	}
	if (queries.length > MAX_QUERIES) {
		return NextResponse.json({ error: `Send at most ${MAX_QUERIES} words per request.` }, { status: 400 })
	}

	const perQuery = Math.max(1, Math.min(MAX_PER_QUERY, Number(body.perQuery) || 4))
	// Anything but the word "photo" is the ordinary climb, so an old client, a
	// typo or a missing field all mean the same safe thing.
	const mode: SearchMode = body.mode === 'photo' ? 'photo' : 'cutout'

	try {
		const results: QueryResult[] = await searchImages(queries, perQuery, mode)

		const empty = results.filter((result) => result.candidates.length === 0).map((result) => result.query)
		const providers = configuredProviders()
		const keyed = providers.filter((source) => !KEYLESS.includes(source))
		return NextResponse.json(
			{
				results,
				providers,
				mode,
				notice:
					empty.length > 0
						? `${
								mode === 'photo' ? 'Not even a photograph was found for' : 'No picture was found for'
							} ${empty.slice(0, 6).join(', ')}. Those words are left without an object rather than given an unrelated one.${
								keyed.length === 0
									? ' Setting GOOGLE_CSE_KEY + GOOGLE_CSE_CX, BING_IMAGE_KEY or PIXABAY_API_KEY widens the search to the whole web.'
									: ''
							}`
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
		const target = parsePublicUrl(raw)
		// The same refusal the search applies, applied again at the door: a
		// candidate list is data, and nothing stops a caller from asking for an
		// address the search would never have offered.
		if (WATERMARK_HOSTS.some((bad) => target.hostname.toLowerCase().includes(bad))) {
			return NextResponse.json(
				{ error: 'That host stamps its pictures with a watermark, so the studio will not fetch from it.' },
				{ status: 403 },
			)
		}

		const upstream = await fetchPublicUrl(target, {
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
