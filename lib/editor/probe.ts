'use client'

/**
 * Turns a raw `File` into the facts `lib/editor/model.ts`'s `Asset` needs:
 * kind, duration, dimensions, frame rate, whether it carries audio, and a
 * fingerprint stable enough to re-identify the same file after a refresh or
 * a move on disk. Video probing goes through mediabunny first (it reports
 * rotation-corrected size and the real average frame rate); images and plain
 * audio use the platform's own decoders, which are simpler and sufficient.
 */

export type ProbedMedia = {
	kind: 'video' | 'image' | 'audio'
	durationSeconds: number
	width: number
	height: number
	fps: number
	hasAudio: boolean
}

function evenSize(value: number): number {
	const rounded = Math.max(2, Math.round(value))
	return rounded % 2 === 0 ? rounded : rounded + 1
}

export function looksLikeVideo(file: File): boolean {
	return file.type.startsWith('video/') || /\.(mp4|mov|webm|m4v|mkv|avi|ogv)$/i.test(file.name)
}

export function looksLikeImage(file: File): boolean {
	return file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|avif|bmp)$/i.test(file.name)
}

export function looksLikeAudio(file: File): boolean {
	return file.type.startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg|flac|opus)$/i.test(file.name)
}

async function probeVideoFile(file: File): Promise<ProbedMedia> {
	const { ALL_FORMATS, BlobSource, Input } = await import('mediabunny')
	const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) })
	try {
		const videoTrack = await input.getPrimaryVideoTrack()
		if (!videoTrack) throw new Error('That file has no video track - upload a video, not another kind of file.')
		const [width, height, stats, audioTrack, duration] = await Promise.all([
			videoTrack.getDisplayWidth(),
			videoTrack.getDisplayHeight(),
			videoTrack.computePacketStats(120),
			input.getPrimaryAudioTrack(),
			input.computeDuration(),
		])
		if (!duration || !Number.isFinite(duration)) throw new Error('That file has no readable duration.')
		return {
			kind: 'video',
			durationSeconds: duration,
			width: evenSize(width),
			height: evenSize(height),
			fps: stats.averagePacketRate > 0 && stats.averagePacketRate <= 240 ? stats.averagePacketRate : 30,
			hasAudio: audioTrack !== null,
		}
	} finally {
		input.dispose()
	}
}

async function probeAudioFile(file: File): Promise<ProbedMedia> {
	const { ALL_FORMATS, BlobSource, Input } = await import('mediabunny')
	const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) })
	try {
		const duration = await input.computeDuration()
		if (!duration || !Number.isFinite(duration)) throw new Error('That file has no readable duration.')
		return { kind: 'audio', durationSeconds: duration, width: 0, height: 0, fps: 1, hasAudio: true }
	} finally {
		input.dispose()
	}
}

async function probeImageFile(file: File): Promise<ProbedMedia> {
	const bitmap = await createImageBitmap(file)
	try {
		return { kind: 'image', durationSeconds: 5, width: evenSize(bitmap.width), height: evenSize(bitmap.height), fps: 1, hasAudio: false }
	} finally {
		bitmap.close()
	}
}

export async function probeMediaFile(file: File): Promise<ProbedMedia> {
	if (looksLikeImage(file)) return probeImageFile(file)
	if (looksLikeAudio(file) && !looksLikeVideo(file)) return probeAudioFile(file)
	return probeVideoFile(file)
}

/** `${size}_${lastModified}_${sha256-of-first-and-last-1MB}` - cheap, but strong enough to re-identify a file. */
export async function fingerprintFile(file: File): Promise<string> {
	try {
		const chunk = 1_048_576
		const head = await file.slice(0, chunk).arrayBuffer()
		const tail = file.size > chunk ? await file.slice(Math.max(0, file.size - chunk)).arrayBuffer() : new ArrayBuffer(0)
		const combined = new Uint8Array(head.byteLength + tail.byteLength)
		combined.set(new Uint8Array(head), 0)
		combined.set(new Uint8Array(tail), head.byteLength)
		const digest = await crypto.subtle.digest('SHA-256', combined)
		const hex = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
		return `${file.size}_${file.lastModified}_${hex.slice(0, 24)}`
	} catch {
		return `${file.size}_${file.lastModified}`
	}
}

/** Grabs one frame/the image itself and returns it as a small WebP poster. */
export async function generateThumbnail(file: File, kind: ProbedMedia['kind'], atSeconds: number): Promise<Blob | null> {
	try {
		if (kind === 'image') {
			const bitmap = await createImageBitmap(file)
			const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
			const ctx = canvas.getContext('2d')
			if (!ctx) return null
			ctx.drawImage(bitmap, 0, 0)
			bitmap.close()
			return canvas.convertToBlob({ type: 'image/webp', quality: 0.82 })
		}
		if (kind === 'audio') return null

		const { ALL_FORMATS, BlobSource, Input, VideoSampleSink } = await import('mediabunny')
		const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) })
		try {
			const track = await input.getPrimaryVideoTrack()
			if (!track) return null
			const width = await track.getDisplayWidth()
			const height = await track.getDisplayHeight()
			const outWidth = Math.min(320, width) || 320
			const outHeight = Math.max(2, Math.round(outWidth * (height / (width || 1))))

			const sink = new VideoSampleSink(track)
			const sample = await sink.getSample(Math.max(0, atSeconds))
			if (!sample) return null
			const canvas = new OffscreenCanvas(outWidth, outHeight)
			const ctx = canvas.getContext('2d')
			if (!ctx) {
				sample.close()
				return null
			}
			sample.draw(ctx, 0, 0, outWidth, outHeight)
			sample.close()
			return canvas.convertToBlob({ type: 'image/webp', quality: 0.82 })
		} finally {
			input.dispose()
		}
	} catch {
		return null
	}
}
