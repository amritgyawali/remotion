/**
 * Runs one tool on Cloudinary's hardware instead of on the visitor's.
 *
 * The whole point of the route is what it does *not* do: no decoding, no
 * encoding, no frames. It turns a tool press into a transformation string,
 * asks Cloudinary to start building the derived file asynchronously, writes a
 * job row, and answers in a few hundred milliseconds. The browser then polls
 * /api/cloud/jobs, which is where the waiting happens - so nothing here holds a
 * connection open for the length of a render.
 */

import { cloudEnabled } from '../../../../lib/cloud/config'
import { deliveryUrl, startTransform } from '../../../../lib/cloud/cloudinary'
import { resolveIdentity, userIdOf } from '../../../../lib/cloud/owner'
import { createJob, readAsset } from '../../../../lib/cloud/store'
import {
	cloudPlanFor,
	cloudSpliceLimitReason,
	cloudSplicePlan,
	cloudSubtitlePlan,
	needsOverlay,
	withOverlay,
} from '../../../../lib/cloud/transform'
import type {
	CloudOutput,
	CloudSpliceSegment,
	CloudSubtitleStyle,
	CloudTransformPlan,
} from '../../../../lib/cloud/transform'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const FORMATS = ['mp4', 'webm'] as const
const QUALITIES = ['draft', 'high', 'max'] as const

export async function POST(request: Request) {
	if (!cloudEnabled()) {
		return new Response('Cloud mode is not configured on this server.', { status: 503 })
	}

	let body: {
		/** 'tool' (the default), 'silence' for a cut list, 'subtitles' for burn-in */
		mode?: 'tool' | 'silence' | 'subtitles'
		assetId?: string
		tool?: string
		params?: Record<string, string | number | boolean>
		output?: { format?: string; quality?: string }
		overlayAssetId?: string | null
		projectId?: string | null
		/** silence mode: the stretches to keep, in source seconds */
		segments?: CloudSpliceSegment[]
		includeAudio?: boolean
		/** subtitles mode */
		style?: Partial<CloudSubtitleStyle>
		previewSec?: number
	}
	try {
		body = (await request.json()) as typeof body
	} catch {
		return new Response('Malformed JSON body.', { status: 400 })
	}

	const mode = body.mode ?? 'tool'
	const tool = (body.tool ?? '').trim()
	const assetId = (body.assetId ?? '').trim()
	if (!assetId) return new Response('A source file is required.', { status: 400 })
	if (mode === 'tool' && !tool) return new Response('A tool is required.', { status: 400 })

	const output: CloudOutput = {
		format: (FORMATS as readonly string[]).includes(body.output?.format ?? '')
			? (body.output!.format as CloudOutput['format'])
			: 'mp4',
		quality: (QUALITIES as readonly string[]).includes(body.output?.quality ?? '')
			? (body.output!.quality as CloudOutput['quality'])
			: 'high',
	}

	const identity = await resolveIdentity()

	try {
		const asset = await readAsset({ owner: identity.owner, id: assetId })
		if (!asset) return new Response('That source file is not in your cloud library.', { status: 404 })

		/*
		 * The plan is built here rather than above because a splice chain has to
		 * name the very asset it is splicing - the source's own public id - and
		 * that is not known until the library row has been read and its owner
		 * checked. Building it earlier would mean trusting an id from the body.
		 */
		let plan: CloudTransformPlan | null
		if (mode === 'silence') {
			const segments = Array.isArray(body.segments) ? body.segments : []
			const refusal = cloudSpliceLimitReason(segments.length)
			if (refusal) return new Response(refusal, { status: 422 })
			plan = cloudSplicePlan({
				publicId: asset.publicId,
				segments,
				output,
				includeAudio: body.includeAudio !== false,
			})
			if (!plan) return new Response('That cut has nothing the cloud can splice.', { status: 422 })
		} else if (mode === 'subtitles') {
			plan = cloudSubtitlePlan({ style: body.style, output, previewSec: body.previewSec })
		} else {
			plan = cloudPlanFor(tool, body.params ?? {}, output)
			if (!plan) {
				return new Response(
					`"${tool}" runs on your device. It needs per-pixel work the cloud transformer cannot express, so switch the run location back to Device for this one.`,
					{ status: 422 },
				)
			}
		}

		let transformation = plan.transformation
		if (needsOverlay(transformation)) {
			if (!body.overlayAssetId) {
				return new Response(
					`This tool needs its ${plan.overlay?.label ?? 'second file'} uploaded to the cloud first.`,
					{ status: 400 },
				)
			}
			const overlay = await readAsset({ owner: identity.owner, id: body.overlayAssetId })
			if (!overlay) return new Response('That overlay file is not in your cloud library.', { status: 404 })
			transformation = withOverlay(transformation, overlay.publicId)
		}

		const url = deliveryUrl({
			publicId: asset.publicId,
			resourceType: plan.resourceType,
			transformation,
			format: plan.format,
		})

		await startTransform({
			publicId: asset.publicId,
			resourceType: plan.resourceType,
			transformation,
			format: plan.format,
		})

		const job = await createJob({
			owner: identity.owner,
			userId: userIdOf(identity),
			projectId: body.projectId ?? null,
			kind: 'transform',
			label: `${plan.label}-${asset.originalName ?? asset.publicId.split('/').pop()}`,
			tool: mode === 'tool' ? tool : mode,
			params: mode === 'silence' ? { segments: (body.segments ?? []).length } : (body.params ?? {}),
			sourcePublicId: asset.publicId,
			transformation,
			status: 'running',
			result: {
				url,
				publicId: asset.publicId,
				resourceType: plan.resourceType,
				format: plan.format,
				bytes: null,
				duration: asset.duration,
				width: asset.width,
				height: asset.height,
				derived: true,
			},
		})

		return Response.json({ job, note: plan.note ?? null }, { headers: { 'cache-control': 'no-store' } })
	} catch (error) {
		return new Response(error instanceof Error ? error.message : 'The cloud refused that job.', {
			status: 502,
		})
	}
}
