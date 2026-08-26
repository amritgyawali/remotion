'use client'

/**
 * One open mediabunny `Input` per asset, shared by the live preview and the
 * export loop, so a 90-second scrub or a full render never re-parses a
 * container twice. This is the "frame cache / decoder" layer the blueprint's
 * architecture calls for (§3.9) - mediabunny's own `VideoSampleSink.getSample`
 * already does frame-accurate, keyframe-aware seeking internally, so this
 * pool only owns *lifetime*, not decode logic.
 *
 * Callers must not hold on to a `VideoSample`/`AudioSample` past the frame
 * they used it for - every read site here closes its sample before
 * returning, per the platform's own frame-lifetime contract.
 */

import type { Asset } from './types'

type MediabunnyModule = typeof import('mediabunny')
type Input = InstanceType<MediabunnyModule['Input']>
type InputVideoTrack = Awaited<ReturnType<Input['getPrimaryVideoTrack']>>
type InputAudioTrack = Awaited<ReturnType<Input['getPrimaryAudioTrack']>>
type VideoSampleSink = InstanceType<MediabunnyModule['VideoSampleSink']>
type AudioBufferSink = InstanceType<MediabunnyModule['AudioBufferSink']>

export type AssetSink = {
	assetId: string
	input: Input
	videoTrack: InputVideoTrack
	audioTrack: InputAudioTrack
	videoSink: VideoSampleSink | null
	audioSink: AudioBufferSink | null
	naturalWidth: number
	naturalHeight: number
}

let mediabunnyPromise: Promise<MediabunnyModule> | null = null
function mediabunny(): Promise<MediabunnyModule> {
	if (!mediabunnyPromise) mediabunnyPromise = import('mediabunny')
	return mediabunnyPromise
}

export class AssetSinkPool {
	private entries = new Map<string, Promise<AssetSink | null>>()
	private images = new Map<string, Promise<ImageBitmap | null>>()

	/** Images never go through mediabunny - there is no container to demux, just pixels to decode once. */
	async getImage(asset: Asset, blob: Blob): Promise<ImageBitmap | null> {
		const existing = this.images.get(asset.id)
		if (existing) return existing
		const promise = createImageBitmap(blob).catch(() => null)
		this.images.set(asset.id, promise)
		return promise
	}

	/** Opens (or reuses) the sink for `asset`, backed by `blob`. */
	async get(asset: Asset, blob: Blob): Promise<AssetSink | null> {
		const existing = this.entries.get(asset.id)
		if (existing) return existing

		const promise = this.open(asset, blob)
		this.entries.set(asset.id, promise)
		const resolved = await promise
		if (!resolved) this.entries.delete(asset.id)
		return resolved
	}

	private async open(asset: Asset, blob: Blob): Promise<AssetSink | null> {
		try {
			const mb = await mediabunny()
			const input = new mb.Input({ formats: mb.ALL_FORMATS, source: new mb.BlobSource(blob) })
			const videoTrack = asset.kind === 'audio' ? null : await input.getPrimaryVideoTrack()
			const audioTrack = asset.kind === 'image' ? null : await input.getPrimaryAudioTrack()
			const width = videoTrack ? await videoTrack.getDisplayWidth() : asset.width
			const height = videoTrack ? await videoTrack.getDisplayHeight() : asset.height
			return {
				assetId: asset.id,
				input,
				videoTrack,
				audioTrack,
				videoSink: videoTrack ? new mb.VideoSampleSink(videoTrack) : null,
				audioSink: audioTrack ? new mb.AudioBufferSink(audioTrack) : null,
				naturalWidth: width,
				naturalHeight: height,
			}
		} catch {
			return null
		}
	}

	/** Drops one asset's decoder state - called after a relink swaps its bytes, or when it leaves the project. */
	async release(assetId: string): Promise<void> {
		const promise = this.entries.get(assetId)
		this.entries.delete(assetId)
		const sink = await promise?.catch(() => null)
		sink?.input.dispose()

		const imagePromise = this.images.get(assetId)
		this.images.delete(assetId)
		const image = await imagePromise?.catch(() => null)
		image?.close()
	}

	async disposeAll(): Promise<void> {
		const all = Array.from(this.entries.values())
		const images = Array.from(this.images.values())
		this.entries.clear()
		this.images.clear()
		for (const promise of all) {
			const sink = await promise.catch(() => null)
			sink?.input.dispose()
		}
		for (const promise of images) {
			const image = await promise.catch(() => null)
			image?.close()
		}
	}
}
