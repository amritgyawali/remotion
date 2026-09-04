import { NextRequest } from 'next/server'
import { uploadFromUrl } from '../../../../lib/cloud/cloudinary'
import { cloudEnabled } from '../../../../lib/cloud/config'
import { resolveIdentity, userIdOf } from '../../../../lib/cloud/owner'
import { recordAsset } from '../../../../lib/cloud/store'
import { hasRenderAccess } from '../../../../lib/render-server-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const allowedBlobUrl = (value: string): boolean => {
	try {
		const url = new URL(value)
		return url.protocol === 'https:' && url.hostname.endsWith('.blob.vercel-storage.com')
	} catch {
		return false
	}
}

/** Moves a detached Vercel render into the same Cloudinary library as Node renders. */
export async function POST(request: NextRequest) {
	if (!hasRenderAccess(request)) return new Response('Invalid or missing render key.', { status: 401 })
	if (!cloudEnabled()) return new Response('Cloudinary and Supabase are not configured.', { status: 503 })

	const body = await request.json().catch(() => null) as {
		url?: string
		fileName?: string
		resourceType?: 'video' | 'image'
		format?: string | null
		size?: number | null
		width?: number | null
		height?: number | null
	} | null
	if (!body?.url || !allowedBlobUrl(body.url)) return new Response('Invalid Vercel Blob URL.', { status: 400 })

	const fileName = String(body.fileName || 'render.mp4').replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 120)
	const resourceType = body.resourceType === 'image' ? 'image' : 'video'
	const identity = await resolveIdentity()
	const uploaded = await uploadFromUrl({ owner: identity.owner, url: body.url, fileName, resourceType })
	await recordAsset({
		owner: identity.owner,
		userId: userIdOf(identity),
		publicId: uploaded.public_id,
		resourceType,
		kind: 'output',
		format: uploaded.format ?? body.format ?? null,
		bytes: uploaded.bytes ?? body.size ?? null,
		duration: uploaded.duration ?? null,
		width: uploaded.width ?? body.width ?? null,
		height: uploaded.height ?? body.height ?? null,
		secureUrl: uploaded.secure_url,
		originalName: fileName,
	})

	return Response.json({ url: uploaded.secure_url, size: uploaded.bytes ?? body.size ?? 0 })
}
