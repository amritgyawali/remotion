/**
 * Saved workspaces, kept on the server instead of in this browser.
 *
 * The local vault already knows how to turn a studio into one JSON snapshot;
 * this stores exactly that shape, so "Save to cloud" and "restore after a
 * refresh" carry the same data and a project saved on a laptop opens on a
 * phone. Uploaded video is not in the snapshot - it lives in Cloudinary and the
 * snapshot names it, which is what keeps a row small enough to be a row.
 */

import { cloudEnabled } from '../../../../lib/cloud/config'
import { resolveIdentity, userIdOf } from '../../../../lib/cloud/owner'
import { deleteProject, listProjects, readProject, writeProject } from '../../../../lib/cloud/store'
import type { StudioId } from '../../../../lib/cloud/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const STUDIOS: StudioId[] = ['video', 'captions', 'silence', 'tools', 'editor', 'resume']

/** Postgres takes a jsonb column happily; a 30 MB one is still a mistake. */
const MAX_SNAPSHOT_BYTES = 4 * 1024 * 1024

function offline() {
	return new Response('Cloud mode is not configured on this server.', { status: 503 })
}

export async function GET(request: Request) {
	if (!cloudEnabled()) return offline()

	const url = new URL(request.url)
	const id = url.searchParams.get('id')
	const studioParam = url.searchParams.get('studio')
	const studio = STUDIOS.includes(studioParam as StudioId) ? (studioParam as StudioId) : undefined

	const identity = await resolveIdentity()
	try {
		if (id) {
			const project = await readProject({ owner: identity.owner, id })
			if (!project) return new Response('No such project.', { status: 404 })
			return Response.json({ project }, { headers: { 'cache-control': 'no-store' } })
		}
		const projects = await listProjects({ owner: identity.owner, studio })
		return Response.json({ projects }, { headers: { 'cache-control': 'no-store' } })
	} catch (error) {
		return new Response(error instanceof Error ? error.message : 'Cloud projects unavailable.', {
			status: 502,
		})
	}
}

export async function POST(request: Request) {
	if (!cloudEnabled()) return offline()

	let body: {
		id?: string | null
		studio?: string
		name?: string
		version?: number
		data?: unknown
		posterUrl?: string | null
	}
	try {
		body = (await request.json()) as typeof body
	} catch {
		return new Response('Malformed JSON body.', { status: 400 })
	}

	if (!STUDIOS.includes(body.studio as StudioId)) {
		return new Response('Unknown studio.', { status: 400 })
	}

	const serialised = JSON.stringify(body.data ?? {})
	if (serialised.length > MAX_SNAPSHOT_BYTES) {
		return new Response(
			'This workspace is too large to save to the cloud. Media belongs in the cloud library, not in the snapshot.',
			{ status: 413 },
		)
	}

	const identity = await resolveIdentity()
	try {
		const project = await writeProject({
			owner: identity.owner,
			userId: userIdOf(identity),
			id: body.id ?? null,
			studio: body.studio as StudioId,
			name: (body.name ?? 'Untitled').trim() || 'Untitled',
			version: Number.isInteger(body.version) ? Number(body.version) : 1,
			data: body.data ?? {},
			posterUrl: body.posterUrl ?? null,
		})
		return Response.json({ project }, { headers: { 'cache-control': 'no-store' } })
	} catch (error) {
		return new Response(error instanceof Error ? error.message : 'Could not save to the cloud.', {
			status: 502,
		})
	}
}

export async function DELETE(request: Request) {
	if (!cloudEnabled()) return offline()

	const id = new URL(request.url).searchParams.get('id')
	if (!id) return new Response('A project id is required.', { status: 400 })

	const identity = await resolveIdentity()
	try {
		await deleteProject({ owner: identity.owner, id })
		return Response.json({ deleted: id })
	} catch (error) {
		return new Response(error instanceof Error ? error.message : 'Could not delete that project.', {
			status: 502,
		})
	}
}
