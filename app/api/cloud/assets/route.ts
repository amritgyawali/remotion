/**
 * The index over what this visitor has in Cloudinary.
 *
 * A direct-to-Cloudinary upload finishes without this server hearing about it,
 * so the browser posts back what landed and this route writes the row. It does
 * not take the browser's word for it: the public id is re-read from Cloudinary
 * and checked against the caller's own folder, because a registration route
 * that trusted its input would let anyone claim any asset in the account.
 */

import { cloudEnabled, cloudinaryConfig } from '../../../../lib/cloud/config'
import { destroyResource, ownerFolder, resourceInfo } from '../../../../lib/cloud/cloudinary'
import { resolveIdentity, userIdOf } from '../../../../lib/cloud/owner'
import { forgetAsset, listAssets, recordAsset } from '../../../../lib/cloud/store'
import type { CloudAssetKind, CloudResourceType } from '../../../../lib/cloud/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const KINDS: CloudAssetKind[] = ['source', 'output', 'overlay', 'subtitle', 'poster']
const RESOURCE_TYPES: CloudResourceType[] = ['video', 'image', 'raw']

function offline() {
	return new Response('Cloud mode is not configured on this server.', { status: 503 })
}

export async function GET(request: Request) {
	if (!cloudEnabled()) return offline()

	const url = new URL(request.url)
	const kindParam = url.searchParams.get('kind')
	const kind = KINDS.includes(kindParam as CloudAssetKind)
		? (kindParam as CloudAssetKind)
		: undefined

	const identity = await resolveIdentity()
	try {
		const assets = await listAssets({ owner: identity.owner, kind })
		return Response.json({ assets }, { headers: { 'cache-control': 'no-store' } })
	} catch (error) {
		return new Response(error instanceof Error ? error.message : 'Cloud media unavailable.', {
			status: 502,
		})
	}
}

export async function POST(request: Request) {
	if (!cloudEnabled()) return offline()

	let body: {
		publicId?: string
		resourceType?: string
		kind?: string
		originalName?: string
		projectId?: string | null
	}
	try {
		body = (await request.json()) as typeof body
	} catch {
		return new Response('Malformed JSON body.', { status: 400 })
	}

	const publicId = (body.publicId ?? '').trim()
	if (!publicId) return new Response('A public id is required.', { status: 400 })

	const resourceType = (
		RESOURCE_TYPES.includes(body.resourceType as CloudResourceType) ? body.resourceType : 'video'
	) as CloudResourceType
	const kind = (KINDS.includes(body.kind as CloudAssetKind) ? body.kind : 'source') as CloudAssetKind

	const identity = await resolveIdentity()
	const config = cloudinaryConfig()
	if (!config) return offline()

	// The folder is the ownership proof. Every signed upload is issued into it,
	// so an id outside it was not created by this visitor.
	const folder = ownerFolder(config, identity.owner)
	if (!publicId.startsWith(`${folder}/`)) {
		return new Response('That file does not belong to this session.', { status: 403 })
	}

	try {
		const resource = await resourceInfo({ publicId, resourceType })
		if (!resource) return new Response('Cloudinary has no such file yet.', { status: 404 })

		const asset = await recordAsset({
			owner: identity.owner,
			userId: userIdOf(identity),
			projectId: body.projectId ?? null,
			publicId: resource.public_id,
			resourceType,
			kind,
			format: resource.format ?? null,
			bytes: resource.bytes ?? null,
			duration: resource.duration ?? null,
			width: resource.width ?? null,
			height: resource.height ?? null,
			secureUrl: resource.secure_url,
			originalName: body.originalName?.slice(0, 200) ?? null,
		})
		return Response.json({ asset }, { headers: { 'cache-control': 'no-store' } })
	} catch (error) {
		return new Response(error instanceof Error ? error.message : 'Could not record that upload.', {
			status: 502,
		})
	}
}

export async function DELETE(request: Request) {
	if (!cloudEnabled()) return offline()

	const id = new URL(request.url).searchParams.get('id')
	if (!id) return new Response('An asset id is required.', { status: 400 })

	const identity = await resolveIdentity()
	try {
		const asset = await forgetAsset({ owner: identity.owner, id })
		if (!asset) return new Response('No such file.', { status: 404 })
		// The row is already gone; a Cloudinary failure here would only leave an
		// orphaned file, which is better than a row pointing at nothing.
		await destroyResource({ publicId: asset.publicId, resourceType: asset.resourceType }).catch(
			() => undefined,
		)
		return Response.json({ deleted: asset.id })
	} catch (error) {
		return new Response(error instanceof Error ? error.message : 'Could not delete that file.', {
			status: 502,
		})
	}
}
