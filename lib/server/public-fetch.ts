/**
 * Fetching an address the browser handed us, without becoming a way into this
 * network.
 *
 * Two routes need this: `/api/media/import` streams a remote video through
 * this origin so the studios can decode it, and `/api/captions/images` pulls
 * the pictures that stand behind a speaker. Both take an address chosen by
 * whoever is using the page, which is the textbook shape of a server-side
 * request forgery, so the guard is the point of this file rather than a detail
 * of it - and it lives here, once, because two copies of a security check are
 * one check and one liability.
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
 *
 * What is *allowed back* is deliberately not decided here. A video import and
 * an image search have different size caps and different ideas of an
 * acceptable content type, and folding both into one policy would mean the
 * looser of the two applies to both.
 */

import type { Buffer } from 'node:buffer'
import dns from 'node:dns/promises'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'

const DEFAULT_MAX_REDIRECTS = 4
const CONNECT_TIMEOUT_MS = 15_000
const IDLE_TIMEOUT_MS = 30_000

/** An error carrying the status the route should answer with. */
export class PublicFetchError extends Error {
	status: number
	constructor(message: string, status = 400) {
		super(message)
		this.status = status
	}
}

/* -------------------------------------------------------------------------- */
/*  Address vetting                                                           */
/* -------------------------------------------------------------------------- */

export function ipv4IsPublic(address: string): boolean {
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

export function ipv6IsPublic(address: string): boolean {
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

export function addressIsPublic(address: string): boolean {
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
export async function resolvePublicAddress(hostname: string): Promise<{ address: string; family: number }> {
	if (net.isIP(hostname)) {
		if (!addressIsPublic(hostname)) throw new PublicFetchError('That address is not reachable from here.', 400)
		return { address: hostname, family: net.isIP(hostname) }
	}

	let records: { address: string; family: number }[]
	try {
		records = await dns.lookup(hostname, { all: true, verbatim: true })
	} catch {
		throw new PublicFetchError(`Could not find a server called "${hostname}".`, 400)
	}
	if (records.length === 0) throw new PublicFetchError(`Could not find a server called "${hostname}".`, 400)
	for (const record of records) {
		if (!addressIsPublic(record.address)) {
			throw new PublicFetchError('That address points somewhere private, so it will not be fetched.', 400)
		}
	}
	return records[0]
}

export function parsePublicUrl(raw: string): URL {
	let url: URL
	try {
		url = new URL(raw)
	} catch {
		throw new PublicFetchError('That is not a complete web address. Start it with https://.', 400)
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new PublicFetchError('Only http and https addresses can be loaded.', 400)
	}
	if (url.username || url.password) {
		throw new PublicFetchError('Addresses with a username or password in them are not accepted.', 400)
	}
	return url
}

/* -------------------------------------------------------------------------- */
/*  The fetch itself                                                          */
/* -------------------------------------------------------------------------- */

export type Upstream = {
	status: number
	headers: http.IncomingHttpHeaders
	stream: NodeJS.ReadableStream
	url: URL
}

export type PublicFetchOptions = {
	/** passed straight through, so a proxied media element stays seekable */
	range?: string | null
	/** what this hop says it wants back */
	accept?: string
	userAgent?: string
	maxRedirects?: number
}

const DEFAULT_USER_AGENT = 'Mozilla/5.0 (compatible; RemotionVideoStudio/1.0; +media-import)'

/**
 * One hop, with the socket pinned to an address that has already been vetted.
 *
 * `lookup` is overridden rather than the host being rewritten, so TLS still
 * validates against the real hostname and virtual hosts still resolve - the
 * only thing that changes is which address the socket is allowed to open.
 */
function requestOnce(url: URL, address: string, family: number, options: PublicFetchOptions): Promise<Upstream> {
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
					'user-agent': options.userAgent ?? DEFAULT_USER_AGENT,
					accept: options.accept ?? 'video/*,audio/*,application/octet-stream;q=0.9,*/*;q=0.5',
					'accept-encoding': 'identity',
					...(options.range ? { range: options.range } : {}),
				},
				// Pinned: the name was resolved and vetted once, and this is that
				// answer. A second, different answer cannot be substituted here.
				//
				// Node asks for the whole list when it is picking a family itself
				// (autoSelectFamily, on by default since Node 20), and for a single
				// address otherwise - and the two want different callback shapes. Get
				// that wrong and every request dies on ERR_INVALID_IP_ADDRESS.
				lookup: (_hostname: string, lookupOptions: { all?: boolean }, callback: unknown) => {
					if (lookupOptions && lookupOptions.all) {
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
			request.destroy(new PublicFetchError('That server took too long to answer.', 504))
		})
		request.on('error', (error) => {
			reject(
				error instanceof PublicFetchError
					? error
					: new PublicFetchError('That server could not be reached.', 502),
			)
		})
		request.end()
	})
}

/** Follows redirects by hand so every hop is vetted like the first one. */
export async function fetchPublicUrl(start: URL, options: PublicFetchOptions = {}): Promise<Upstream> {
	const limit = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS
	let target = start
	for (let hop = 0; hop <= limit; hop += 1) {
		const { address, family } = await resolvePublicAddress(target.hostname)
		const upstream = await requestOnce(target, address, family, options)
		const location = upstream.headers.location
		const redirecting = upstream.status >= 300 && upstream.status < 400 && typeof location === 'string'
		if (!redirecting) return upstream

		upstream.stream.resume() // drain the body of the redirect itself
		let next: URL
		try {
			next = new URL(location, target)
		} catch {
			throw new PublicFetchError('That server redirected somewhere unreadable.', 502)
		}
		if (next.protocol !== 'http:' && next.protocol !== 'https:') {
			throw new PublicFetchError('That server redirected to an address that is not http or https.', 502)
		}
		target = next
	}
	throw new PublicFetchError('That address redirects too many times.', 502)
}

/* -------------------------------------------------------------------------- */
/*  Reading the body back                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Re-emits the upstream body, refusing to pass on more than the cap.
 *
 * The cap matters even with a Content-Length check in front of it: a server can
 * understate the length, or send none at all, and the browser would happily
 * keep buffering either way.
 */
export function cappedBody(
	stream: NodeJS.ReadableStream,
	options: { maxBytes: number; tooLarge?: string },
): ReadableStream<Uint8Array> {
	const tooLarge = options.tooLarge ?? 'That file is larger than this studio can load.'
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
				if (sent > options.maxBytes) {
					done()
					;(stream as unknown as { destroy: (error?: Error) => void }).destroy()
					controller.error(new Error(tooLarge))
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

/**
 * Buffers a capped body in memory.
 *
 * Only for things that are read rather than streamed - a search answer, a
 * picture small enough to hand to a canvas. Anything video-shaped keeps
 * streaming through `cappedBody`.
 */
export async function readCapped(
	stream: NodeJS.ReadableStream,
	options: { maxBytes: number; tooLarge?: string },
): Promise<Uint8Array> {
	const chunks: Uint8Array[] = []
	let total = 0
	await new Promise<void>((resolve, reject) => {
		const idle = setTimeout(() => {
			;(stream as unknown as { destroy: () => void }).destroy()
			reject(new PublicFetchError('The download stalled.', 504))
		}, IDLE_TIMEOUT_MS)
		stream.on('data', (chunk: Buffer) => {
			total += chunk.byteLength
			if (total > options.maxBytes) {
				clearTimeout(idle)
				;(stream as unknown as { destroy: () => void }).destroy()
				reject(new PublicFetchError(options.tooLarge ?? 'That file is too large.', 413))
				return
			}
			chunks.push(new Uint8Array(chunk))
		})
		stream.on('end', () => {
			clearTimeout(idle)
			resolve()
		})
		stream.on('error', (error: Error) => {
			clearTimeout(idle)
			reject(error)
		})
	})

	const merged = new Uint8Array(total)
	let at = 0
	for (const chunk of chunks) {
		merged.set(chunk, at)
		at += chunk.byteLength
	}
	return merged
}

/** Fetches an address and returns its bytes, with every hop vetted. */
export async function fetchPublicBytes(
	raw: string,
	options: PublicFetchOptions & { maxBytes: number; tooLarge?: string },
): Promise<{ bytes: Uint8Array; contentType: string; url: URL }> {
	const upstream = await fetchPublicUrl(parsePublicUrl(raw), options)
	if (upstream.status >= 400) {
		upstream.stream.resume()
		throw new PublicFetchError(`That server answered ${upstream.status}.`, upstream.status === 404 ? 404 : 502)
	}
	const bytes = await readCapped(upstream.stream, options)
	const header = upstream.headers['content-type']
	return {
		bytes,
		contentType: (typeof header === 'string' ? header.split(';')[0].trim().toLowerCase() : '') || '',
		url: upstream.url,
	}
}
