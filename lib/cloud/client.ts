'use client'

/**
 * The browser half of cloud mode.
 *
 * One rule shapes all of it: bytes go straight to Cloudinary, everything else
 * goes through this app's routes. Uploading through a Next route would mean the
 * file is read into memory here, sent to a server that reads it into memory
 * again, and forwarded - three copies of a clip that was already too big for
 * this machine, which is the exact problem cloud mode is meant to solve.
 *
 * Nothing in this file holds a credential. It asks the server to sign, and the
 * signature it gets back is good for one upload into one folder.
 */

import type {
	CloudAsset,
	CloudAssetKind,
	CloudJob,
	CloudProject,
	CloudProjectSummary,
	CloudResourceType,
	CloudStatus,
	SignedUpload,
	StudioId,
} from './types'

export class CloudError extends Error {
	readonly status: number
	constructor(message: string, status: number) {
		super(message)
		this.name = 'CloudError'
		this.status = status
	}
}

async function api<T>(input: string, init?: RequestInit): Promise<T> {
	const response = await fetch(input, { cache: 'no-store', ...init })
	if (!response.ok) {
		const detail = await response.text().catch(() => '')
		throw new CloudError(detail || `The cloud replied ${response.status}.`, response.status)
	}
	return (await response.json()) as T
}

export async function fetchCloudStatus(): Promise<CloudStatus | null> {
	try {
		return await api<CloudStatus>('/api/cloud/status')
	} catch {
		// A studio whose status probe fails simply stays in device mode.
		return null
	}
}

/* ---------------------------------------------------------------- uploads */

export type UploadProgress = { loaded: number; total: number; ratio: number }

export function resourceTypeFor(file: File): CloudResourceType {
	if (file.type.startsWith('video/') || file.type.startsWith('audio/')) return 'video'
	if (file.type.startsWith('image/')) return 'image'
	return 'raw'
}

/**
 * Posts one file to Cloudinary and returns the row this app wrote for it.
 *
 * XHR rather than fetch, and that is not nostalgia: `fetch` still cannot report
 * upload progress in any shipping browser, and an upload of a few hundred
 * megabytes with no progress bar is indistinguishable from a hang.
 */
export async function uploadToCloud(args: {
	file: File
	kind?: CloudAssetKind
	projectId?: string | null
	signal?: AbortSignal
	onProgress?: (progress: UploadProgress) => void
}): Promise<CloudAsset> {
	const resourceType = resourceTypeFor(args.file)

	const signed = await api<SignedUpload>('/api/cloud/upload', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			fileName: args.file.name,
			resourceType,
			bytes: args.file.size,
		}),
	})

	await new Promise<void>((resolve, reject) => {
		const form = new FormData()
		form.set('file', args.file)
		form.set('api_key', signed.apiKey)
		form.set('timestamp', String(signed.timestamp))
		form.set('public_id', signed.publicId)
		form.set('folder', signed.folder)
		form.set('signature', signed.signature)

		const request = new XMLHttpRequest()
		request.open('POST', signed.uploadUrl, true)

		request.upload.onprogress = (event) => {
			if (!event.lengthComputable) return
			args.onProgress?.({
				loaded: event.loaded,
				total: event.total,
				ratio: event.total > 0 ? event.loaded / event.total : 0,
			})
		}
		request.onload = () => {
			if (request.status >= 200 && request.status < 300) {
				resolve()
				return
			}
			let message = `Cloudinary refused the upload (${request.status}).`
			try {
				const body = JSON.parse(request.responseText) as { error?: { message?: string } }
				if (body?.error?.message) message = body.error.message
			} catch {
				// keep the status line
			}
			reject(new CloudError(message, request.status))
		}
		request.onerror = () =>
			reject(new CloudError('The upload could not reach Cloudinary. Check the connection.', 0))
		request.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'))

		if (args.signal) {
			if (args.signal.aborted) {
				request.abort()
				return
			}
			args.signal.addEventListener('abort', () => request.abort(), { once: true })
		}

		request.send(form)
	})

	// Cloudinary has the bytes; this is what makes them findable again.
	const { asset } = await api<{ asset: CloudAsset }>('/api/cloud/assets', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			publicId: `${signed.folder}/${signed.publicId}`,
			resourceType,
			kind: args.kind ?? 'source',
			originalName: args.file.name,
			projectId: args.projectId ?? null,
		}),
	})
	return asset
}

export async function listCloudAssets(kind?: CloudAssetKind): Promise<CloudAsset[]> {
	const query = kind ? `?kind=${encodeURIComponent(kind)}` : ''
	const { assets } = await api<{ assets: CloudAsset[] }>(`/api/cloud/assets${query}`)
	return assets
}

export async function deleteCloudAsset(id: string): Promise<void> {
	await api(`/api/cloud/assets?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
}

/* ------------------------------------------------------------- processing */

export type CloudRunOutput = { format: 'mp4' | 'webm'; quality: 'draft' | 'high' | 'max' }

export async function startCloudTool(args: {
	assetId: string
	tool: string
	params: Record<string, string | number | boolean>
	output: CloudRunOutput
	overlayAssetId?: string | null
	projectId?: string | null
}): Promise<{ job: CloudJob; note: string | null }> {
	return api<{ job: CloudJob; note: string | null }>('/api/cloud/process', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(args),
	})
}

/**
 * A silence cut, spliced together by the cloud.
 *
 * The segments are source seconds, not frames, because a Cloudinary splice is
 * expressed in seconds and rounding them here rather than at the edge keeps
 * the join in one place.
 */
export async function startCloudSplice(args: {
	assetId: string
	segments: Array<{ startSec: number; endSec: number; speed: number }>
	output: CloudRunOutput
	includeAudio?: boolean
	projectId?: string | null
}): Promise<{ job: CloudJob; note: string | null }> {
	return api<{ job: CloudJob; note: string | null }>('/api/cloud/process', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ mode: 'silence', ...args }),
	})
}

/** Captions burnt into the picture by the cloud, from an uploaded SRT. */
export async function startCloudSubtitles(args: {
	assetId: string
	overlayAssetId: string
	output: CloudRunOutput
	style?: Record<string, string | number>
	previewSec?: number
	projectId?: string | null
}): Promise<{ job: CloudJob; note: string | null }> {
	return api<{ job: CloudJob; note: string | null }>('/api/cloud/process', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ mode: 'subtitles', ...args }),
	})
}

export async function readCloudJob(id: string): Promise<CloudJob> {
	const { job } = await api<{ job: CloudJob }>(`/api/cloud/jobs?id=${encodeURIComponent(id)}`)
	return job
}

/**
 * Waits for a cloud job, reporting as it goes.
 *
 * The interval widens with age. A trim finishes in a couple of seconds and
 * should feel instant; a ten-minute grade should not be asked about two hundred
 * times, which is a rate limit waiting to happen.
 */
export async function awaitCloudJob(args: {
	id: string
	signal?: AbortSignal
	onProgress?: (job: CloudJob) => void
}): Promise<CloudJob> {
	let waitMs = 1_200
	const started = Date.now()

	for (;;) {
		if (args.signal?.aborted) throw new DOMException('Cancelled', 'AbortError')

		const job = await readCloudJob(args.id)
		args.onProgress?.(job)
		if (job.status === 'ready' || job.status === 'failed') return job

		await new Promise((resolve) => setTimeout(resolve, waitMs))
		const age = Date.now() - started
		waitMs = age > 120_000 ? 8_000 : age > 30_000 ? 4_000 : 1_500
	}
}

/* --------------------------------------------------------------- projects */

export async function listCloudProjects(studio?: StudioId): Promise<CloudProjectSummary[]> {
	const query = studio ? `?studio=${encodeURIComponent(studio)}` : ''
	const { projects } = await api<{ projects: CloudProjectSummary[] }>(`/api/cloud/projects${query}`)
	return projects
}

export async function readCloudProject<T = unknown>(id: string): Promise<CloudProject<T>> {
	const { project } = await api<{ project: CloudProject<T> }>(
		`/api/cloud/projects?id=${encodeURIComponent(id)}`,
	)
	return project
}

export async function saveCloudProject(args: {
	id?: string | null
	studio: StudioId
	name: string
	version: number
	data: unknown
	posterUrl?: string | null
}): Promise<CloudProjectSummary> {
	const { project } = await api<{ project: CloudProjectSummary }>('/api/cloud/projects', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(args),
	})
	return project
}

export async function deleteCloudProject(id: string): Promise<void> {
	await api(`/api/cloud/projects?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
}

/* ----------------------------------------------------------------- output */

/**
 * Brings a finished cloud file back as a `File`, so the rest of a studio can
 * treat it exactly like something the device encoded.
 *
 * This is the only place a cloud result is downloaded, and it is deliberately
 * opt-in: the point of cloud mode is that a 200 MB export can stay on the
 * server until someone actually wants it locally.
 */
export async function downloadCloudResult(args: {
	url: string
	fileName: string
	signal?: AbortSignal
}): Promise<File> {
	const response = await fetch(args.url, { signal: args.signal })
	if (!response.ok) {
		throw new CloudError(`Could not download the finished file (${response.status}).`, response.status)
	}
	const blob = await response.blob()
	return new File([blob], args.fileName, { type: blob.type || 'application/octet-stream' })
}
