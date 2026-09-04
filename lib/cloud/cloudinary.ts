import 'server-only'

/**
 * Everything this app does to Cloudinary, in one file.
 *
 * There is no SDK here on purpose. Cloudinary's REST API is a handful of form
 * posts and one signature rule, and the official package pulls a large Node
 * dependency tree into a route that only ever needs fetch - so the rule is
 * implemented once, below, and the rest is plain requests.
 *
 * The signature rule: take every parameter except `file`, `cloud_name`,
 * `resource_type` and `api_key`, sort by key, join as `k=v&k=v`, append the API
 * secret, and SHA-1 the result. Getting the sort or the exclusions wrong is the
 * only way to fail it, which is why nothing else builds one.
 */

import { createHash } from 'node:crypto'
import { cloudinaryConfig, type CloudinaryConfig } from './config'
import type { CloudResourceType } from './types'

const UNSIGNED_KEYS = new Set(['file', 'cloud_name', 'resource_type', 'api_key', 'signature'])

export type SignableParams = Record<string, string | number | boolean | undefined | null>

export function signParams(params: SignableParams, apiSecret: string): string {
	const canonical = Object.keys(params)
		.filter((key) => !UNSIGNED_KEYS.has(key))
		.filter((key) => params[key] !== undefined && params[key] !== null && params[key] !== '')
		.sort()
		.map((key) => `${key}=${String(params[key])}`)
		.join('&')
	return createHash('sha1').update(`${canonical}${apiSecret}`).digest('hex')
}

export function requireCloudinary(): CloudinaryConfig {
	const config = cloudinaryConfig()
	if (!config) throw new Error('Cloudinary is not configured on this server.')
	return config
}

function basicAuth(config: CloudinaryConfig): string {
	return `Basic ${Buffer.from(`${config.apiKey}:${config.apiSecret}`).toString('base64')}`
}

function apiBase(config: CloudinaryConfig): string {
	return `https://api.cloudinary.com/v1_1/${config.cloudName}`
}

/**
 * A public id that cannot escape this app's folder or confuse a delivery URL.
 *
 * Cloudinary treats a slash as a folder separator and the id ends up in a path,
 * so anything else that is meaningful in a URL is flattened to a hyphen.
 */
export function safePublicId(name: string): string {
	return (
		name
			.replace(/\.[A-Za-z0-9]{1,8}$/, '')
			.replace(/[^A-Za-z0-9._-]+/g, '-')
			.replace(/^[-.]+|[-.]+$/g, '')
			.slice(0, 90) || 'clip'
	)
}

/** Folder for one owner, so two devices never collide on a public id. */
export function ownerFolder(config: CloudinaryConfig, owner: string): string {
	const slug = owner.replace(/[^A-Za-z0-9]+/g, '-').slice(0, 60)
	return `${config.folder}/${slug}`
}

export type SignedUploadFields = {
	uploadUrl: string
	cloudName: string
	apiKey: string
	timestamp: number
	signature: string
	publicId: string
	folder: string
}

/**
 * The fields a browser needs to POST a file straight to Cloudinary.
 *
 * The bytes never touch this server: a 90 MB clip going through a Next route
 * would buffer in a function that has neither the memory nor the body limit for
 * it. Signing here and uploading there costs one round trip and removes the
 * bottleneck entirely.
 */
export function signUpload(args: {
	owner: string
	fileName: string
	resourceType: CloudResourceType
}): SignedUploadFields {
	const config = requireCloudinary()
	const folder = ownerFolder(config, args.owner)
	const publicId = `${safePublicId(args.fileName)}-${Date.now().toString(36)}`
	const timestamp = Math.floor(Date.now() / 1000)

	const params: SignableParams = { folder, public_id: publicId, timestamp }
	return {
		uploadUrl: `${apiBase(config)}/${args.resourceType}/upload`,
		cloudName: config.cloudName,
		apiKey: config.apiKey,
		timestamp,
		signature: signParams(params, config.apiSecret),
		publicId,
		folder,
	}
}

export type CloudinaryResource = {
	public_id: string
	resource_type: CloudResourceType
	format?: string
	bytes?: number
	duration?: number
	width?: number
	height?: number
	secure_url: string
	derived?: Array<{ transformation?: string; secure_url?: string; bytes?: number; status?: string }>
}

async function cloudinaryFetch(
	url: string,
	init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
	const { timeoutMs = 30_000, ...rest } = init
	return fetch(url, { ...rest, cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) })
}

async function readError(response: Response): Promise<string> {
	try {
		const body = (await response.json()) as { error?: { message?: string } }
		if (body?.error?.message) return body.error.message
	} catch {
		// fall through to the status line
	}
	return `Cloudinary replied ${response.status}.`
}

/** Uploads bytes this server already holds - a finished render, a subtitle file. */
export async function uploadBuffer(args: {
	owner: string
	data: Blob | Uint8Array
	fileName: string
	resourceType: CloudResourceType
}): Promise<CloudinaryResource> {
	const config = requireCloudinary()
	const folder = ownerFolder(config, args.owner)
	const publicId = `${safePublicId(args.fileName)}-${Date.now().toString(36)}`
	const timestamp = Math.floor(Date.now() / 1000)
	const signature = signParams({ folder, public_id: publicId, timestamp }, config.apiSecret)

	const blob =
		args.data instanceof Blob
			? args.data
			: // A Uint8Array over a SharedArrayBuffer is not a BlobPart, and Node's
				// readFile can hand back either. Copying into a plain buffer is one
				// allocation and removes the whole question.
				new Blob([new Uint8Array(args.data).slice().buffer], {
					type: 'application/octet-stream',
				})

	const form = new FormData()
	form.set('file', blob, args.fileName)
	form.set('api_key', config.apiKey)
	form.set('timestamp', String(timestamp))
	form.set('public_id', publicId)
	form.set('folder', folder)
	form.set('signature', signature)

	const response = await cloudinaryFetch(`${apiBase(config)}/${args.resourceType}/upload`, {
		method: 'POST',
		body: form,
		timeoutMs: 120_000,
	})
	if (!response.ok) throw new Error(await readError(response))
	return (await response.json()) as CloudinaryResource
}

/** Pulls a remote URL into the account, which is how a render lands without a round trip. */
export async function uploadFromUrl(args: {
	owner: string
	url: string
	fileName: string
	resourceType: CloudResourceType
}): Promise<CloudinaryResource> {
	const config = requireCloudinary()
	const folder = ownerFolder(config, args.owner)
	const publicId = `${safePublicId(args.fileName)}-${Date.now().toString(36)}`
	const timestamp = Math.floor(Date.now() / 1000)
	const signature = signParams({ folder, public_id: publicId, timestamp }, config.apiSecret)

	const form = new FormData()
	form.set('file', args.url)
	form.set('api_key', config.apiKey)
	form.set('timestamp', String(timestamp))
	form.set('public_id', publicId)
	form.set('folder', folder)
	form.set('signature', signature)

	const response = await cloudinaryFetch(`${apiBase(config)}/${args.resourceType}/upload`, {
		method: 'POST',
		body: form,
		timeoutMs: 180_000,
	})
	if (!response.ok) throw new Error(await readError(response))
	return (await response.json()) as CloudinaryResource
}

/**
 * Asks Cloudinary to start building a derived asset, without waiting for it.
 *
 * `eager_async` is the difference between a route that answers in 300 ms and one
 * that holds a connection open for four minutes while a 1080p clip is graded.
 * The job row polls `transformState` afterwards.
 */
export async function startTransform(args: {
	publicId: string
	resourceType: CloudResourceType
	transformation: string
	format?: string
}): Promise<void> {
	const config = requireCloudinary()
	const timestamp = Math.floor(Date.now() / 1000)
	// Cloudinary's eager syntax puts the delivery format last, as a bare
	// extension after a slash. Writing it as `f_mp4` inside the chain instead
	// builds a *different* derived asset from the one the delivery URL asks for,
	// and the poll below would then wait for a file nobody is making.
	const eager = args.format ? `${args.transformation}/${args.format}` : args.transformation
	const params: SignableParams = {
		eager,
		eager_async: true,
		public_id: args.publicId,
		timestamp,
		type: 'upload',
	}

	const form = new FormData()
	form.set('public_id', args.publicId)
	form.set('type', 'upload')
	form.set('eager', eager)
	form.set('eager_async', 'true')
	form.set('timestamp', String(timestamp))
	form.set('api_key', config.apiKey)
	form.set('signature', signParams(params, config.apiSecret))

	const response = await cloudinaryFetch(`${apiBase(config)}/${args.resourceType}/explicit`, {
		method: 'POST',
		body: form,
		timeoutMs: 60_000,
	})
	if (!response.ok) throw new Error(await readError(response))
}

export function deliveryUrl(args: {
	publicId: string
	resourceType: CloudResourceType
	transformation?: string
	format?: string
}): string {
	const config = requireCloudinary()
	const path = args.publicId
		.split('/')
		.map((segment) => encodeURIComponent(segment))
		.join('/')
	const parts = [
		`https://res.cloudinary.com/${config.cloudName}`,
		args.resourceType,
		'upload',
		args.transformation && args.transformation.length > 0 ? args.transformation : null,
		args.format ? `${path}.${args.format}` : path,
	].filter(Boolean)
	return parts.join('/')
}

export type TransformState = 'ready' | 'pending' | 'failed'

/**
 * Is the derived asset there yet?
 *
 * Cloudinary answers this honestly over HTTP: 200 once the file exists, 423
 * while it is still being built, and a 4xx for a transformation it refused.
 * Asking the delivery URL rather than the Admin API also means the check costs
 * nothing against the API rate limit.
 */
export async function transformState(
	url: string,
): Promise<{ state: TransformState; reason?: string }> {
	try {
		const response = await cloudinaryFetch(url, { method: 'HEAD', timeoutMs: 20_000 })
		if (response.ok) return { state: 'ready' }
		if (response.status === 423 || response.status === 420) return { state: 'pending' }
		return {
			state: 'failed',
			reason: response.headers.get('x-cld-error') ?? `Cloudinary replied ${response.status}.`,
		}
	} catch {
		// A dropped connection is not a failed transformation; let the poll retry.
		return { state: 'pending' }
	}
}

export async function resourceInfo(args: {
	publicId: string
	resourceType: CloudResourceType
}): Promise<CloudinaryResource | null> {
	const config = requireCloudinary()
	const path = args.publicId
		.split('/')
		.map((segment) => encodeURIComponent(segment))
		.join('/')
	// Without `media_metadata` the Admin API answers a video with width, height
	// and bytes but no duration at all - and a clip whose length is unknown
	// cannot be trimmed, previewed or shown in a library with any honesty.
	const response = await cloudinaryFetch(
		`${apiBase(config)}/resources/${args.resourceType}/upload/${path}?media_metadata=true`,
		{ headers: { authorization: basicAuth(config) } },
	)
	if (response.status === 404) return null
	if (!response.ok) throw new Error(await readError(response))
	return (await response.json()) as CloudinaryResource
}

export async function destroyResource(args: {
	publicId: string
	resourceType: CloudResourceType
}): Promise<void> {
	const config = requireCloudinary()
	const timestamp = Math.floor(Date.now() / 1000)
	const params: SignableParams = { invalidate: true, public_id: args.publicId, timestamp }

	const form = new FormData()
	form.set('public_id', args.publicId)
	form.set('invalidate', 'true')
	form.set('timestamp', String(timestamp))
	form.set('api_key', config.apiKey)
	form.set('signature', signParams(params, config.apiSecret))

	const response = await cloudinaryFetch(`${apiBase(config)}/${args.resourceType}/destroy`, {
		method: 'POST',
		body: form,
	})
	if (!response.ok) throw new Error(await readError(response))
}
