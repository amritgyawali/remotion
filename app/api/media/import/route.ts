/**
 * Streams a remote video through this origin so the studios can edit it.
 *
 * Every studio here reads its clip in the browser: Mediabunny demuxes it,
 * Whisper decodes it, the silence analyser walks its samples. A pasted address
 * cannot do any of that. Almost no video host sends the CORS headers a browser
 * needs before it will hand a cross-origin body to script, and the ones that do
 * rarely allow the range requests a seekable <video> element depends on. So the
 * bytes come through here instead, from one origin the page is already allowed
 * to read.
 *
 * That makes this endpoint a server that fetches whatever address it is handed,
 * which is the textbook shape of a server-side request forgery. The guard that
 * makes it safe lives in `lib/server/public-fetch.ts` - shared with the image
 * route, because two copies of a security check are one check and one liability
 * - and it vets every hop, pins the socket to an address it has already
 * approved, and forwards nothing from the caller's session.
 *
 * What stays here is the policy that is this route's own: videos and audio
 * only, two gigabytes at most, and range requests passed through untouched in
 * both directions so the proxied URL behaves like a normal seekable source.
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

/** Matches the browser-side cap in lib/captions/video-source.ts. */
const MAX_BYTES = 2 * 1024 * 1024 * 1024
const TOO_LARGE = 'That video is larger than this studio can load.'
const ACCEPT = 'video/*,audio/*,application/octet-stream;q=0.9,*/*;q=0.5'

const ALLOWED_TYPE_PREFIXES = ['video/', 'audio/']
const ALLOWED_TYPES = new Set([
	'application/octet-stream',
	'application/mp4',
	'application/x-matroska',
	'binary/octet-stream',
])

function contentTypeAllowed(value: string | undefined): boolean {
	if (!value) return true // a server that says nothing is judged on its bytes
	const type = value.split(';')[0].trim().toLowerCase()
	if (ALLOWED_TYPES.has(type)) return true
	return ALLOWED_TYPE_PREFIXES.some((prefix) => type.startsWith(prefix))
}

function failure(error: unknown) {
	const status = error instanceof PublicFetchError ? error.status : 502
	const message = error instanceof Error ? error.message : 'That video could not be loaded.'
	return NextResponse.json({ error: message }, { status })
}

/* -------------------------------------------------------------------------- */
/*  Handlers                                                                  */
/* -------------------------------------------------------------------------- */

export async function GET(request: Request) {
	const raw = new URL(request.url).searchParams.get('url')
	if (!raw) return NextResponse.json({ error: 'Paste a video address first.' }, { status: 400 })

	try {
		const target = parsePublicUrl(raw)
		const range = request.headers.get('range')
		const upstream = await fetchPublicUrl(target, { range, accept: ACCEPT })

		if (upstream.status >= 400) {
			upstream.stream.resume()
			const reason =
				upstream.status === 403 || upstream.status === 401
					? 'That video is private, or the host blocks downloads.'
					: upstream.status === 404
						? 'There is no video at that address.'
						: `That server answered ${upstream.status}.`
			return NextResponse.json({ error: reason }, { status: upstream.status === 404 ? 404 : 502 })
		}

		const type = typeof upstream.headers['content-type'] === 'string' ? upstream.headers['content-type'] : undefined
		if (!contentTypeAllowed(type)) {
			upstream.stream.resume()
			const label = (type ?? 'unknown').split(';')[0]
			return NextResponse.json(
				{
					error:
						label.startsWith('text/') || label === 'application/xhtml+xml'
							? 'That address is a web page, not a video file. Use the address of the file itself.'
							: `That address returned ${label}, which is not a video.`,
				},
				{ status: 415 },
			)
		}

		const length = Number(upstream.headers['content-length'] ?? Number.NaN)
		if (Number.isFinite(length) && length > MAX_BYTES) {
			upstream.stream.resume()
			return NextResponse.json({ error: TOO_LARGE }, { status: 413 })
		}

		const headers = new Headers()
		headers.set('content-type', type ?? 'video/mp4')
		if (Number.isFinite(length)) headers.set('content-length', String(length))
		const contentRange = upstream.headers['content-range']
		if (typeof contentRange === 'string') headers.set('content-range', contentRange)
		headers.set('accept-ranges', 'bytes')
		// The proxied bytes are the caller's own request replayed; nothing about
		// them should be cached by a shared cache in between.
		headers.set('cache-control', 'private, no-store')
		headers.set('x-content-type-options', 'nosniff')
		// Same-origin only. The point of the proxy is that the page can read the
		// body; nothing else should be able to.
		headers.set('cross-origin-resource-policy', 'same-origin')

		return new NextResponse(
			cappedBody(upstream.stream, { maxBytes: MAX_BYTES, tooLarge: TOO_LARGE }) as unknown as BodyInit,
			{
				status: upstream.status === 206 ? 206 : 200,
				headers,
			},
		)
	} catch (error) {
		return failure(error)
	}
}

/**
 * Reports what is at an address without downloading it.
 *
 * The panels call this first so a wrong paste - a YouTube watch page, a file
 * that is far too big - is refused in a second rather than after a long
 * download that was never going to work.
 */
export async function POST(request: Request) {
	let body: { url?: unknown }
	try {
		body = await request.json()
	} catch {
		return NextResponse.json({ error: 'Send a JSON body with a url.' }, { status: 400 })
	}
	const raw = typeof body.url === 'string' ? body.url.trim() : ''
	if (!raw) return NextResponse.json({ error: 'Paste a video address first.' }, { status: 400 })

	try {
		const target = parsePublicUrl(raw)
		// Asked for as a range so a server that would otherwise start sending the
		// whole file only sends the first byte of it.
		const upstream = await fetchPublicUrl(target, { range: 'bytes=0-0', accept: ACCEPT })
		upstream.stream.resume()

		if (upstream.status >= 400) {
			return NextResponse.json(
				{ error: upstream.status === 404 ? 'There is no video at that address.' : `That server answered ${upstream.status}.` },
				{ status: upstream.status === 404 ? 404 : 502 },
			)
		}

		const type = typeof upstream.headers['content-type'] === 'string' ? upstream.headers['content-type'] : undefined
		if (!contentTypeAllowed(type)) {
			const label = (type ?? 'unknown').split(';')[0]
			return NextResponse.json(
				{
					error:
						label.startsWith('text/') || label === 'application/xhtml+xml'
							? 'That address is a web page, not a video file. Use the address of the file itself - on YouTube and similar sites there is no such address.'
							: `That address returned ${label}, which is not a video.`,
				},
				{ status: 415 },
			)
		}

		// With a one-byte range the total is in content-range; without one it is
		// in content-length.
		const contentRange = typeof upstream.headers['content-range'] === 'string' ? upstream.headers['content-range'] : ''
		const total = /\/(\d+)\s*$/.exec(contentRange)
		const sizeInBytes = total
			? Number(total[1])
			: Number(upstream.headers['content-length'] ?? Number.NaN)

		if (Number.isFinite(sizeInBytes) && sizeInBytes > MAX_BYTES) {
			return NextResponse.json({ error: TOO_LARGE }, { status: 413 })
		}

		const name = decodeURIComponent(upstream.url.pathname.split('/').filter(Boolean).pop() ?? 'video')
		return NextResponse.json({
			ok: true,
			name: name.includes('.') ? name : `${name}.mp4`,
			contentType: type ?? 'video/mp4',
			sizeInBytes: Number.isFinite(sizeInBytes) ? sizeInBytes : null,
			resolvedUrl: upstream.url.toString(),
			acceptsRanges: upstream.status === 206 || upstream.headers['accept-ranges'] === 'bytes',
		})
	} catch (error) {
		return failure(error)
	}
}
