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
 * which is the textbook shape of a server-side request forgery. The guard below
 * is therefore the point of the file, not a detail of it:
 *
 *   - only http and https, and no credentials embedded in the address
 *   - the hostname is resolved here, and every address it resolves to must be
 *     public - loopback, link-local, private, carrier-grade NAT, multicast and
 *     the reserved ranges are all refused, in v4 and v6
 *   - the socket is pinned to the address that was checked, so a name that
 *     resolves publicly on the first lookup and privately on the second (DNS
 *     rebinding) cannot be used to reach the network this runs on
 *   - redirects are followed by hand, at most four, each hop re-checked
 *   - nothing from the caller's session travels outward: no cookies, no
 *     authorization header, no referer
 *   - the response must look like media, and is cut off at the size cap
 *
 * Range requests pass through untouched in both directions, so the proxied URL
 * behaves like a normal seekable video source.
 */

import { Buffer } from 'node:buffer'
import dns from 'node:dns/promises'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Matches the browser-side cap in lib/captions/video-source.ts. */
const MAX_BYTES = 2 * 1024 * 1024 * 1024
const MAX_REDIRECTS = 4
const CONNECT_TIMEOUT_MS = 15_000
const IDLE_TIMEOUT_MS = 30_000

const ALLOWED_TYPE_PREFIXES = ['video/', 'audio/']
const ALLOWED_TYPES = new Set([
	'application/octet-stream',
	'application/mp4',
	'application/x-matroska',
	'binary/octet-stream',
])

/* -------------------------------------------------------------------------- */
/*  Address vetting                                                           */
/* -------------------------------------------------------------------------- */

function ipv4IsPublic(address: string): boolean {
	const parts = address.split('.').map((part) => Number(part))
	if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false
	const [a, b] = parts
	if (a === 0) return false // "this network"
	if (a === 10) return false // private
	if (a === 127) return false // loopback
	if (a === 169 && b === 254) return false // link-local, and the cloud metadata endpoint
	if (a === 172 && b >= 16 && b <= 31) return false // private
	if (a === 192 && b === 168) return false // private
	if (a === 192 && b === 0) return false // protocol assignments
	if (a === 100 && b >= 64 && b <= 127) return false // carrier-grade NAT
	if (a === 198 && (b === 18 || b === 19)) return false // benchmarking
	if (a >= 224) return false // multicast, reserved, broadcast
	return true
}

function ipv6IsPublic(address: string): boolean {
	const value = address.toLowerCase().split('%')[0]
	if (value === '::' || value === '::1') return false // unspecified, loopback
	// An address that carries an embedded v4 address is only as safe as that one.
	const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(value)
	if (mapped) return ipv4IsPublic(mapped[1])
	if (value.startsWith('fe8') || value.startsWith('fe9') || value.startsWith('fea') || value.startsWith('feb')) {
		return false // link-local
	}
	if (value.startsWith('fc') || value.startsWith('fd')) return false // unique local
	if (value.startsWith('ff')) return false // multicast
	if (value.startsWith('2001:db8')) return false // documentation
	if (value.startsWith('64:ff9b')) return false // NAT64, which can carry a private v4
	return true
}

function addressIsPublic(address: string): boolean {
	const family = net.isIP(address)
	if (family === 4) return ipv4IsPublic(address)
	if (family === 6) return ipv6IsPublic(address)
	return false
}

/**
 * Resolves a hostname and returns the one address the request may use.
 *
 * Every address the name resolves to has to pass, not just the one that gets
 * used: a host that answers with both a public and a private address is a host
 * being used to smuggle a request inward.
 */
async function resolvePublicAddress(hostname: string): Promise<{ address: string; family: number }> {
	if (net.isIP(hostname)) {
		if (!addressIsPublic(hostname)) throw new ImportError('That address is not reachable from here.', 400)
		return { address: hostname, family: net.isIP(hostname) }
	}

	let records: { address: string; family: number }[]
	try {
		records = await dns.lookup(hostname, { all: true, verbatim: true })
	} catch {
		throw new ImportError(`Could not find a server called "${hostname}".`, 400)
	}
	if (records.length === 0) throw new ImportError(`Could not find a server called "${hostname}".`, 400)
	for (const record of records) {
		if (!addressIsPublic(record.address)) {
			throw new ImportError('That address points somewhere private, so it will not be fetched.', 400)
		}
	}
	return records[0]
}

class ImportError extends Error {
	status: number
	constructor(message: string, status = 400) {
		super(message)
		this.status = status
	}
}

function parseTarget(raw: string): URL {
	let url: URL
	try {
		url = new URL(raw)
	} catch {
		throw new ImportError('That is not a complete web address. Start it with https://.', 400)
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new ImportError('Only http and https addresses can be loaded.', 400)
	}
	if (url.username || url.password) {
		throw new ImportError('Addresses with a username or password in them are not accepted.', 400)
	}
	return url
}

/* -------------------------------------------------------------------------- */
/*  The fetch itself                                                          */
/* -------------------------------------------------------------------------- */

type Upstream = {
	status: number
	headers: http.IncomingHttpHeaders
	stream: NodeJS.ReadableStream
	url: URL
}

/**
 * One hop, with the socket pinned to an address that has already been vetted.
 *
 * `lookup` is overridden rather than the host being rewritten, so TLS still
 * validates against the real hostname and virtual hosts still resolve - the
 * only thing that changes is which address the socket is allowed to open.
 */
function requestOnce(url: URL, address: string, family: number, range: string | null): Promise<Upstream> {
	const transport = url.protocol === 'https:' ? https : http
	return new Promise((resolve, reject) => {
		const request = transport.request(
			{
				protocol: url.protocol,
				hostname: url.hostname,
				port: url.port || (url.protocol === 'https:' ? 443 : 80),
				path: url.pathname + url.search,
				method: 'GET',
				headers: {
					// A plain browser-shaped request. Nothing from the caller's session
					// is forwarded - no cookie, no authorization, no referer.
					'user-agent': 'Mozilla/5.0 (compatible; RemotionVideoStudio/1.0; +media-import)',
					accept: 'video/*,audio/*,application/octet-stream;q=0.9,*/*;q=0.5',
					'accept-encoding': 'identity',
					...(range ? { range } : {}),
				},
				// Pinned: the name was resolved and vetted once, and this is that
				// answer. A second, different answer cannot be substituted here.
				//
				// Node asks for the whole list when it is picking a family itself
				// (autoSelectFamily, on by default since Node 20), and for a single
				// address otherwise - and the two want different callback shapes. Get
				// that wrong and every request dies on ERR_INVALID_IP_ADDRESS.
				lookup: (_hostname: string, options: { all?: boolean }, callback: unknown) => {
					if (options && options.all) {
						;(callback as (error: null, addresses: { address: string; family: number }[]) => void)(null, [
							{ address, family },
						])
						return
					}
					;(callback as (error: null, address: string, family: number) => void)(null, address, family)
				},
				timeout: CONNECT_TIMEOUT_MS,
			},
			(response) => {
				resolve({ status: response.statusCode ?? 502, headers: response.headers, stream: response, url })
			},
		)
		request.on('timeout', () => {
			request.destroy(new ImportError('That server took too long to answer.', 504))
		})
		request.on('error', (error) => {
			reject(error instanceof ImportError ? error : new ImportError('That server could not be reached.', 502))
		})
		request.end()
	})
}

/** Follows redirects by hand so every hop is vetted like the first one. */
async function fetchUpstream(start: URL, range: string | null): Promise<Upstream> {
	let target = start
	for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
		const { address, family } = await resolvePublicAddress(target.hostname)
		const upstream = await requestOnce(target, address, family, range)
		const location = upstream.headers.location
		const redirecting = upstream.status >= 300 && upstream.status < 400 && typeof location === 'string'
		if (!redirecting) return upstream

		upstream.stream.resume() // drain the body of the redirect itself
		let next: URL
		try {
			next = new URL(location, target)
		} catch {
			throw new ImportError('That server redirected somewhere unreadable.', 502)
		}
		if (next.protocol !== 'http:' && next.protocol !== 'https:') {
			throw new ImportError('That server redirected to an address that is not http or https.', 502)
		}
		target = next
	}
	throw new ImportError('That address redirects too many times.', 502)
}

function contentTypeAllowed(value: string | undefined): boolean {
	if (!value) return true // a server that says nothing is judged on its bytes
	const type = value.split(';')[0].trim().toLowerCase()
	if (ALLOWED_TYPES.has(type)) return true
	return ALLOWED_TYPE_PREFIXES.some((prefix) => type.startsWith(prefix))
}

/**
 * Re-emits the upstream body, refusing to pass on more than the cap.
 *
 * The cap matters even with a Content-Length check in front of it: a server can
 * understate the length, or send none at all, and the browser would happily
 * keep buffering either way.
 */
function cappedBody(stream: NodeJS.ReadableStream): ReadableStream<Uint8Array> {
	let sent = 0
	let idle: NodeJS.Timeout | null = null
	return new ReadableStream<Uint8Array>({
		start(controller) {
			const bump = () => {
				if (idle) clearTimeout(idle)
				idle = setTimeout(() => {
					;(stream as unknown as { destroy: (error?: Error) => void }).destroy()
					controller.error(new Error('The download stalled.'))
				}, IDLE_TIMEOUT_MS)
			}
			const done = () => {
				if (idle) clearTimeout(idle)
				idle = null
			}
			bump()
			stream.on('data', (chunk: Buffer) => {
				sent += chunk.byteLength
				if (sent > MAX_BYTES) {
					done()
					;(stream as unknown as { destroy: (error?: Error) => void }).destroy()
					controller.error(new Error('That video is larger than this studio can load.'))
					return
				}
				bump()
				controller.enqueue(new Uint8Array(chunk))
			})
			stream.on('end', () => {
				done()
				controller.close()
			})
			stream.on('error', (error: Error) => {
				done()
				controller.error(error)
			})
		},
		cancel() {
			if (idle) clearTimeout(idle)
			;(stream as unknown as { destroy: (error?: Error) => void }).destroy()
		},
	})
}

function failure(error: unknown) {
	const status = error instanceof ImportError ? error.status : 502
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
		const target = parseTarget(raw)
		const range = request.headers.get('range')
		const upstream = await fetchUpstream(target, range)

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
			return NextResponse.json({ error: 'That video is larger than this studio can load.' }, { status: 413 })
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

		return new NextResponse(cappedBody(upstream.stream) as unknown as BodyInit, {
			status: upstream.status === 206 ? 206 : 200,
			headers,
		})
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
		const target = parseTarget(raw)
		// Asked for as a range so a server that would otherwise start sending the
		// whole file only sends the first byte of it.
		const upstream = await fetchUpstream(target, 'bytes=0-0')
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
			return NextResponse.json({ error: 'That video is larger than this studio can load.' }, { status: 413 })
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
