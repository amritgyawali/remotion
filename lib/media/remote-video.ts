'use client'

/**
 * Turning a pasted address into a file the studios can edit.
 *
 * Every studio in this app works on bytes it holds: Mediabunny demuxes them,
 * Whisper decodes them, the silence analyser walks their samples, the renderer
 * ships them. So "import by link" cannot mean pointing a <video> at somebody
 * else's server - it has to mean fetching the clip, and fetching it through
 * /api/media/import, because a cross-origin body is not readable by script
 * without CORS headers that video hosts almost never send.
 *
 * What comes back is an ordinary File, indistinguishable from one the user
 * picked off disk, which is why the four studios needed one handler each rather
 * than a parallel code path.
 */

import { MAX_VIDEO_BYTES } from '../captions/video-source'

export type RemoteProbe = {
	name: string
	contentType: string
	/** null when the host declines to say, which is legal and not fatal */
	sizeInBytes: number | null
	resolvedUrl: string
	acceptsRanges: boolean
}

export type RemoteProgress = {
	receivedBytes: number
	/** null while the total is unknown, so the UI shows motion rather than a lie */
	totalBytes: number | null
	ratio: number | null
}

/** The address as typed, tidied - bare hosts get a scheme, spaces are dropped. */
export function normalizeRemoteUrl(raw: string): string {
	const trimmed = raw.trim().replace(/\s+/g, '')
	if (!trimmed) return ''
	if (/^https?:\/\//i.test(trimmed)) return trimmed
	if (/^\/\//.test(trimmed)) return `https:${trimmed}`
	// A bare "example.com/clip.mp4" is a complete intention, just not a complete
	// address; assume the secure scheme rather than refusing it.
	if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(trimmed)) return `https://${trimmed}`
	return trimmed
}

/** Whether the address is worth sending to the server at all. */
export function looksLikeRemoteVideoUrl(raw: string): boolean {
	const value = normalizeRemoteUrl(raw)
	if (!/^https?:\/\//i.test(value)) return false
	try {
		const url = new URL(value)
		return Boolean(url.hostname) && !url.username && !url.password
	} catch {
		return false
	}
}

/**
 * Hosts whose watch pages are not files.
 *
 * The server refuses these anyway the moment it sees an HTML content type, but
 * saying so before a round trip is both faster and much clearer than
 * "that address returned text/html".
 */
const PAGE_ONLY_HOSTS = [
	'youtube.com',
	'youtu.be',
	'vimeo.com',
	'tiktok.com',
	'instagram.com',
	'facebook.com',
	'x.com',
	'twitter.com',
	'drive.google.com',
	'dropbox.com',
]

export function pageOnlyHostWarning(raw: string): string | null {
	try {
		const url = new URL(normalizeRemoteUrl(raw))
		const host = url.hostname.replace(/^www\./, '').toLowerCase()
		const hit = PAGE_ONLY_HOSTS.find((known) => host === known || host.endsWith(`.${known}`))
		if (!hit) return null
		if (hit === 'dropbox.com' || hit === 'drive.google.com') {
			return `${hit} serves a preview page, not the file. Use its direct-download address instead.`
		}
		return `${hit} pages are players, not files - there is no video address to paste. Download the clip first, then upload it here.`
	} catch {
		return null
	}
}

/** The same-origin address that streams the remote clip. */
export function remoteVideoProxyUrl(url: string): string {
	return `/api/media/import?url=${encodeURIComponent(normalizeRemoteUrl(url))}`
}

async function errorFrom(response: Response, fallback: string): Promise<string> {
	try {
		const body = (await response.json()) as { error?: unknown }
		if (typeof body.error === 'string' && body.error) return body.error
	} catch {
		/* a non-JSON error body is no worse than none */
	}
	return fallback
}

/** Asks what is at the address without downloading it. */
export async function probeRemoteVideo(url: string, signal?: AbortSignal): Promise<RemoteProbe> {
	const response = await fetch('/api/media/import', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ url: normalizeRemoteUrl(url) }),
		signal,
	})
	if (!response.ok) throw new Error(await errorFrom(response, 'That address could not be read.'))
	return (await response.json()) as RemoteProbe
}

function nameFromUrl(url: string): string {
	try {
		const path = new URL(normalizeRemoteUrl(url)).pathname
		const last = decodeURIComponent(path.split('/').filter(Boolean).pop() ?? '')
		return last || 'remote-video.mp4'
	} catch {
		return 'remote-video.mp4'
	}
}

/**
 * Downloads the clip and hands back a File.
 *
 * Progress is reported per chunk rather than per percent, because a host that
 * sends no Content-Length is common enough that a percentage-only API would
 * spend half its life showing nothing.
 */
export async function fetchRemoteVideo(
	url: string,
	options: { signal?: AbortSignal; onProgress?: (progress: RemoteProgress) => void } = {},
): Promise<File> {
	const address = normalizeRemoteUrl(url)
	if (!looksLikeRemoteVideoUrl(address)) {
		throw new Error('That is not a complete web address. It should start with https://.')
	}

	const probe = await probeRemoteVideo(address, options.signal)
	if (probe.sizeInBytes !== null && probe.sizeInBytes > MAX_VIDEO_BYTES) {
		throw new Error('That video is larger than this studio can load.')
	}

	const response = await fetch(remoteVideoProxyUrl(address), { signal: options.signal })
	if (!response.ok) throw new Error(await errorFrom(response, 'That video could not be downloaded.'))
	if (!response.body) throw new Error('This browser cannot stream that download.')

	const declared = Number(response.headers.get('content-length') ?? Number.NaN)
	const totalBytes = Number.isFinite(declared) && declared > 0 ? declared : probe.sizeInBytes
	const reader = response.body.getReader()
	const chunks: Uint8Array[] = []
	let receivedBytes = 0

	options.onProgress?.({ receivedBytes: 0, totalBytes, ratio: totalBytes ? 0 : null })

	try {
		for (;;) {
			const { done, value } = await reader.read()
			if (done) break
			if (!value) continue
			receivedBytes += value.byteLength
			if (receivedBytes > MAX_VIDEO_BYTES) {
				await reader.cancel()
				throw new Error('That video is larger than this studio can load.')
			}
			chunks.push(value)
			options.onProgress?.({
				receivedBytes,
				totalBytes,
				ratio: totalBytes ? Math.min(1, receivedBytes / totalBytes) : null,
			})
		}
	} catch (error) {
		// An abort is the user's own doing, and should read as one.
		if (error instanceof DOMException && error.name === 'AbortError') throw new Error('Import cancelled.')
		throw error
	}

	if (receivedBytes === 0) throw new Error('That address returned an empty file.')

	const name = probe.name || nameFromUrl(address)
	const type = probe.contentType && probe.contentType !== 'application/octet-stream' ? probe.contentType : 'video/mp4'
	// One copy into a contiguous buffer: the reader's chunks may share (and reuse)
	// their backing store between reads, so the Blob cannot be built over them.
	const bytes = new Uint8Array(receivedBytes)
	let offset = 0
	for (const chunk of chunks) {
		bytes.set(chunk, offset)
		offset += chunk.byteLength
	}
	return new File([bytes], name, { type, lastModified: Date.now() })
}
