'use client'

/**
 * Running a Tools Studio tool without this machine decoding a single frame.
 *
 * The device path reads every frame through WebCodecs, pushes it through a
 * canvas and re-encodes it - which is why a ten-minute 1080p clip can take
 * longer than the clip itself on a laptop with no headroom. The cloud path
 * sends the file once, hands Cloudinary a transformation string, and waits.
 * The only work left here is a download at the end.
 *
 * The shape it returns is deliberately identical to the device runner's, so the
 * output panel, the download button and "send to another studio" all keep
 * working without knowing which path produced the file.
 */

import {
	awaitCloudJob,
	downloadCloudResult,
	startCloudSplice,
	startCloudSubtitles,
	startCloudTool,
	uploadToCloud,
	type CloudRunOutput,
} from './client'
import { cloudPlanFor } from './transform'
import type { CloudAsset, CloudJob } from './types'

export type CloudRunProgress = { phase: string; ratio: number }

export type CloudRunResult = {
	blob: Blob
	url: string
	name: string
	sizeInBytes: number
	kind: 'video' | 'audio' | 'image' | 'file'
	meta: string
	/** the cloud copy, so a second tool can run on it without uploading again */
	asset: CloudAsset
	job: CloudJob
}

/**
 * Files already in the cloud, so pressing a second tool on the same clip is
 * instant rather than another upload. Weak, so closing the clip lets it go.
 */
const uploaded = new WeakMap<File, CloudAsset>()
const uploadsInFlight = new WeakMap<File, Promise<CloudAsset>>()

/** What the finished file is, judged by the format the plan asked Cloudinary for. */
function kindOf(format: string): CloudRunResult['kind'] {
	if (['mp3', 'aac', 'ogg', 'wav', 'm4a'].includes(format)) return 'audio'
	if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(format)) return 'image'
	if (['mp4', 'webm', 'mov'].includes(format)) return 'video'
	return 'file'
}

export async function ensureUploaded(args: {
	file: File
	kind?: 'source' | 'overlay'
	signal?: AbortSignal
	onProgress?: (progress: CloudRunProgress) => void
}): Promise<CloudAsset> {
	const cached = uploaded.get(args.file)
	if (cached) return cached
	const running = uploadsInFlight.get(args.file)
	if (running) return running

	const request = uploadToCloud({
		file: args.file,
		kind: args.kind ?? 'source',
		signal: args.signal,
		onProgress: ({ ratio }) =>
			args.onProgress?.({ phase: 'Uploading to the cloud', ratio: ratio * 0.5 }),
	}).then((asset) => {
		uploaded.set(args.file, asset)
		return asset
	})
	uploadsInFlight.set(args.file, request)
	try {
		return await request
	} finally {
		uploadsInFlight.delete(args.file)
	}
}

/** True when this tool has a cloud equivalent at all - the UI reads it too. */
export function toolRunsInCloud(
	toolId: string,
	params: Record<string, string | number | boolean>,
	output: CloudRunOutput,
): boolean {
	return cloudPlanFor(toolId, params, output) !== null
}

export async function runToolInCloud(args: {
	toolId: string
	file?: File | null
	asset?: CloudAsset | null
	params: Record<string, string | number | boolean>
	output: CloudRunOutput
	secondaryFile?: File | null
	signal?: AbortSignal
	onProgress?: (progress: CloudRunProgress) => void
}): Promise<CloudRunResult> {
	const plan = cloudPlanFor(args.toolId, args.params, args.output)
	if (!plan) {
		throw new Error(
			'This tool only runs on your device - it needs per-pixel work the cloud transformer cannot express.',
		)
	}

	args.onProgress?.({ phase: 'Uploading to the cloud', ratio: 0.02 })
	const asset = args.asset ?? (args.file ? await ensureUploaded({
		file: args.file,
		signal: args.signal,
		onProgress: args.onProgress,
	}) : null)
	if (!asset) throw new Error('Upload the source video before starting this cloud job.')

	let overlayAssetId: string | null = null
	if (plan.overlay) {
		if (!args.secondaryFile) {
			throw new Error(`This tool needs its ${plan.overlay.label.toLowerCase()} before it can run.`)
		}
		args.onProgress?.({ phase: `Uploading the ${plan.overlay.label.toLowerCase()}`, ratio: 0.5 })
		const overlay = await ensureUploaded({
			file: args.secondaryFile,
			kind: 'overlay',
			signal: args.signal,
		})
		overlayAssetId = overlay.id
	}

	args.onProgress?.({ phase: 'Handing the job to the cloud', ratio: 0.55 })
	const { job: started } = await startCloudTool({
		assetId: asset.id,
		tool: args.toolId,
		params: args.params,
		output: args.output,
		overlayAssetId,
	})

	const finished = await awaitCloudJob({
		id: started.id,
		signal: args.signal,
		onProgress: (job) =>
			args.onProgress?.({
				phase: 'Processing in the cloud',
				// The cloud half of the bar spans 0.55 to 0.9; the download closes it.
				ratio: 0.55 + job.progress * 0.35,
			}),
	})

	if (finished.status === 'failed' || !finished.result) {
		throw new Error(finished.error ?? 'The cloud could not finish that job.')
	}

	args.onProgress?.({ phase: 'Fetching the finished file', ratio: 0.92 })
	const base = (asset.originalName ?? 'clip').replace(/\.[A-Za-z0-9]{1,8}$/, '')
	const name = `${base}-${plan.label}.${plan.format}`
	const file = await downloadCloudResult({
		url: finished.result.url,
		fileName: name,
		signal: args.signal,
	})

	args.onProgress?.({ phase: 'Done', ratio: 1 })

	return {
		blob: file,
		url: URL.createObjectURL(file),
		name,
		sizeInBytes: file.size,
		kind: kindOf(plan.format),
		meta: `Processed in the cloud${plan.note ? ` - ${plan.note}` : ''}`,
		asset,
		job: finished,
	}
}

/* ========================================================================== *
 *  The two studio-shaped runs
 * ========================================================================== */

/**
 * Exports a silence cut without decoding a frame here.
 *
 * The cut list is the same one the on-device renderer walks; the only
 * difference is that the joining happens on Cloudinary's hardware. That makes
 * this the one export in the studio that a phone can finish.
 */
export async function runSpliceInCloud(args: {
	file?: File | null
	asset?: CloudAsset | null
	segments: Array<{ startSec: number; endSec: number; speed: number }>
	output: CloudRunOutput
	includeAudio?: boolean
	signal?: AbortSignal
	onProgress?: (progress: CloudRunProgress) => void
}): Promise<CloudRunResult> {
	args.onProgress?.({ phase: 'Uploading to the cloud', ratio: 0.02 })
	const asset = args.asset ?? (args.file ? await ensureUploaded({
		file: args.file,
		signal: args.signal,
		onProgress: args.onProgress,
	}) : null)
	if (!asset) throw new Error('Upload the source video before starting this cloud cut.')

	args.onProgress?.({ phase: 'Handing the cut to the cloud', ratio: 0.55 })
	const { job: started } = await startCloudSplice({
		assetId: asset.id,
		segments: args.segments,
		output: args.output,
		includeAudio: args.includeAudio,
	})

	return finishCloudJob({
		started,
		asset,
		format: args.output.format,
		label: 'silence-cut',
		signal: args.signal,
		onProgress: args.onProgress,
	})
}

/**
 * Burns a caption track into the picture in the cloud.
 *
 * The track goes up as a raw SRT, which is why this takes text rather than the
 * studio's cue objects: whatever the studio believes a caption looks like, the
 * cloud only ever sees an SRT and a style.
 */
export async function runSubtitlesInCloud(args: {
	file?: File | null
	asset?: CloudAsset | null
	srt: string
	output: CloudRunOutput
	style?: Record<string, string | number>
	previewSec?: number
	signal?: AbortSignal
	onProgress?: (progress: CloudRunProgress) => void
}): Promise<CloudRunResult> {
	args.onProgress?.({ phase: 'Uploading to the cloud', ratio: 0.02 })
	const asset = args.asset ?? (args.file ? await ensureUploaded({
		file: args.file,
		signal: args.signal,
		onProgress: args.onProgress,
	}) : null)
	if (!asset) throw new Error('Upload the source video before starting this cloud caption job.')

	args.onProgress?.({ phase: 'Uploading the caption track', ratio: 0.5 })
	const base = (asset.originalName ?? 'captions').replace(/\.[A-Za-z0-9]{1,8}$/, '')
	// Cloudinary reads the burn-in format from the extension, so the name is not
	// cosmetic - an SRT called .txt is silently ignored by `l_subtitles`.
	const track = new File([args.srt], `${base}.srt`, { type: 'text/plain' })
	const overlay = await uploadToCloud({ file: track, kind: 'overlay', signal: args.signal })

	args.onProgress?.({ phase: 'Handing the burn-in to the cloud', ratio: 0.6 })
	const { job: started } = await startCloudSubtitles({
		assetId: asset.id,
		overlayAssetId: overlay.id,
		output: args.output,
		style: args.style,
		previewSec: args.previewSec,
	})

	return finishCloudJob({
		started,
		asset,
		format: args.output.format,
		label: args.previewSec ? 'captions-preview' : 'captions',
		signal: args.signal,
		onProgress: args.onProgress,
	})
}

/** The waiting-and-fetching half both studio runs share with the tool run. */
async function finishCloudJob(args: {
	started: CloudJob
	asset: CloudAsset
	format: string
	label: string
	signal?: AbortSignal
	onProgress?: (progress: CloudRunProgress) => void
}): Promise<CloudRunResult> {
	const finished = await awaitCloudJob({
		id: args.started.id,
		signal: args.signal,
		onProgress: (job) =>
			args.onProgress?.({ phase: 'Processing in the cloud', ratio: 0.6 + job.progress * 0.32 }),
	})

	if (finished.status === 'failed' || !finished.result) {
		throw new Error(finished.error ?? 'The cloud could not finish that job.')
	}

	args.onProgress?.({ phase: 'Fetching the finished file', ratio: 0.94 })
	const base = (args.asset.originalName ?? 'clip').replace(/\.[A-Za-z0-9]{1,8}$/, '')
	const name = `${base}-${args.label}.${args.format}`
	const file = await downloadCloudResult({ url: finished.result.url, fileName: name, signal: args.signal })

	args.onProgress?.({ phase: 'Done', ratio: 1 })

	return {
		blob: file,
		url: URL.createObjectURL(file),
		name,
		sizeInBytes: file.size,
		kind: kindOf(args.format),
		meta: 'Processed in the cloud',
		asset: args.asset,
		job: finished,
	}
}
