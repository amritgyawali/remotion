/**
 * Hands the browser a signed ticket to upload straight to Cloudinary.
 *
 * The file itself never comes here. A route that accepted a 90 MB clip would
 * have to hold it in memory before it could forward it, which is exactly the
 * local overload cloud mode exists to remove - and on a serverless host it
 * would hit the body limit long before that. So this signs, and the browser
 * posts the bytes to Cloudinary directly.
 *
 * The size check is done here rather than left to Cloudinary because the plan's
 * refusal arrives as a bare 400 after the whole file has already been sent.
 */

import { cloudEnabled, mediaLimits } from '../../../../lib/cloud/config'
import { signUpload } from '../../../../lib/cloud/cloudinary'
import { resolveIdentity } from '../../../../lib/cloud/owner'
import type { CloudResourceType, SignedUpload } from '../../../../lib/cloud/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const RESOURCE_TYPES: CloudResourceType[] = ['video', 'image', 'raw']

function formatBytes(bytes: number): string {
	return bytes >= 1024 * 1024 * 1024
		? `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
		: `${Math.round(bytes / 1024 / 1024)} MB`
}

export async function POST(request: Request) {
	if (!cloudEnabled()) {
		return new Response('Cloud mode is not configured on this server.', { status: 503 })
	}

	let body: { fileName?: string; resourceType?: string; bytes?: number }
	try {
		body = (await request.json()) as typeof body
	} catch {
		return new Response('Malformed JSON body.', { status: 400 })
	}

	const resourceType = (
		RESOURCE_TYPES.includes(body.resourceType as CloudResourceType) ? body.resourceType : 'video'
	) as CloudResourceType
	const fileName = (body.fileName ?? 'clip').slice(0, 200)
	const bytes = Number.isFinite(body.bytes) ? Number(body.bytes) : 0

	const limits = await mediaLimits()
	const maxBytes =
		resourceType === 'video' ? limits.video : resourceType === 'image' ? limits.image : limits.raw

	if (bytes > maxBytes) {
		return new Response(
			`That file is ${formatBytes(bytes)}. This Cloudinary plan accepts up to ${formatBytes(maxBytes)} per ${resourceType}. Trim it first, or keep this one on your device.`,
			{ status: 413 },
		)
	}

	const identity = await resolveIdentity()
	const signed = signUpload({ owner: identity.owner, fileName, resourceType })

	const payload: SignedUpload = { ...signed, resourceType, maxBytes }
	return Response.json(payload, { headers: { 'cache-control': 'no-store' } })
}
