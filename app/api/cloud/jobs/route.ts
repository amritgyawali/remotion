/**
 * Where a cloud job is up to.
 *
 * Cloudinary has no callback this app can rely on in development, so readiness
 * is asked of the delivery URL itself: 200 means the derived file exists, 423
 * means it is still being built. That check is cheap, needs no Admin API quota,
 * and is the same question the browser would ask when it downloads the result.
 *
 * The poll is server-side rather than in the page so the browser never has to
 * fight a CORS preflight against res.cloudinary.com, and so the job row ends up
 * with a truthful status even if the tab is closed mid-render.
 */

import { cloudEnabled } from '../../../../lib/cloud/config'
import { resourceInfo, transformState } from '../../../../lib/cloud/cloudinary'
import { resolveIdentity } from '../../../../lib/cloud/owner'
import { listJobs, readJob, updateJob } from '../../../../lib/cloud/store'
import type { CloudJob } from '../../../../lib/cloud/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * A transform that has not appeared after this long is treated as failed.
 *
 * Cloudinary keeps answering 423 for a transformation it has quietly given up
 * on, so without a ceiling the browser would poll forever showing progress that
 * never moves. Twelve minutes is past any transform this app can express.
 */
const JOB_TIMEOUT_MS = 12 * 60 * 1000

/** Progress nobody can measure, made to feel measured: asymptotic to 95%. */
function elapsedProgress(startedAt: string): number {
	const seconds = (Date.now() - new Date(startedAt).getTime()) / 1000
	return Math.min(0.95, 0.15 + (seconds / (seconds + 25)) * 0.8)
}

async function refresh(owner: string, job: CloudJob): Promise<CloudJob> {
	if (job.status !== 'running' && job.status !== 'queued') return job
	if (job.kind !== 'transform' || !job.result?.url) return job

	const { state, reason } = await transformState(job.result.url)

	if (state === 'pending') {
		if (Date.now() - new Date(job.createdAt).getTime() > JOB_TIMEOUT_MS) {
			return (
				(await updateJob({
					owner,
					id: job.id,
					status: 'failed',
					error: 'Cloudinary is still building this after twelve minutes. Try a shorter clip, or run it on your device.',
				})) ?? job
			)
		}
		return (
			(await updateJob({ owner, id: job.id, progress: elapsedProgress(job.createdAt) })) ?? job
		)
	}

	if (state === 'failed') {
		return (
			(await updateJob({
				owner,
				id: job.id,
				status: 'failed',
				error: reason ?? 'Cloudinary could not build that transformation.',
			})) ?? job
		)
	}

	// Ready. The byte count is worth one Admin API call - it is the number the
	// output panel shows, and a "done" with no size reads as a half-finished job.
	let bytes = job.result.bytes
	if (bytes == null && job.sourcePublicId) {
		try {
			const info = await resourceInfo({
				publicId: job.sourcePublicId,
				resourceType: job.result.resourceType,
			})
			const derived = info?.derived?.find((entry) => entry.secure_url === job.result?.url)
			bytes = derived?.bytes ?? null
		} catch {
			bytes = null
		}
	}

	return (
		(await updateJob({
			owner,
			id: job.id,
			status: 'ready',
			progress: 1,
			result: { ...job.result, bytes },
		})) ?? job
	)
}

export async function GET(request: Request) {
	if (!cloudEnabled()) {
		return new Response('Cloud mode is not configured on this server.', { status: 503 })
	}

	const id = new URL(request.url).searchParams.get('id')
	const identity = await resolveIdentity()

	try {
		if (!id) {
			const jobs = await listJobs({ owner: identity.owner })
			return Response.json({ jobs }, { headers: { 'cache-control': 'no-store' } })
		}

		const job = await readJob({ owner: identity.owner, id })
		if (!job) return new Response('No such job.', { status: 404 })

		return Response.json({ job: await refresh(identity.owner, job) }, {
			headers: { 'cache-control': 'no-store' },
		})
	} catch (error) {
		return new Response(error instanceof Error ? error.message : 'Could not read that job.', {
			status: 502,
		})
	}
}
