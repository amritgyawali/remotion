'use client'

/**
 * Reads the facts the caption composition needs from an uploaded video:
 * duration, display size, frame rate and whether there is an audio track to
 * transcribe at all.
 *
 * Mediabunny (the demuxer Remotion itself renders with) is asked first because
 * it reports the real average frame rate and the rotation-corrected size. A
 * plain <video> element is the fallback for anything it cannot open.
 */

import type { CaptionVideoSource } from './types'

export const ACCEPTED_VIDEO_TYPES = ['.mp4', '.mov', '.webm', '.m4v', '.mkv', '.avi', '.ogv']

export const MAX_VIDEO_BYTES = 2 * 1024 * 1024 * 1024

export function isVideoFile(file: File): boolean {
	if (file.type.startsWith('video/')) return true
	const name = file.name.toLowerCase()
	return ACCEPTED_VIDEO_TYPES.some((extension) => name.endsWith(extension))
}

function evenSize(value: number): number {
	const rounded = Math.max(2, Math.round(value))
	return rounded % 2 === 0 ? rounded : rounded + 1
}

async function probeWithVideoElement(url: string): Promise<{
	durationInSeconds: number
	width: number
	height: number
}> {
	return new Promise((resolve, reject) => {
		const element = document.createElement('video')
		element.preload = 'metadata'
		element.muted = true
		const cleanup = () => {
			element.removeAttribute('src')
			element.load()
		}
		element.onloadedmetadata = () => {
			const result = {
				durationInSeconds: Number.isFinite(element.duration) ? element.duration : 0,
				width: element.videoWidth,
				height: element.videoHeight,
			}
			cleanup()
			resolve(result)
		}
		element.onerror = () => {
			cleanup()
			reject(new Error('The browser could not read that video. Try an MP4, MOV or WebM file.'))
		}
		element.src = url
	})
}

export async function probeVideo(input: {
	file?: File
	url?: string
	name?: string
}): Promise<CaptionVideoSource> {
	const file = input.file ?? null
	const url = input.file ? URL.createObjectURL(input.file) : (input.url ?? '')
	if (!url) throw new Error('Choose a video file or paste a video URL first.')

	const name = input.name ?? file?.name ?? url.split('/').pop() ?? 'video'

	let durationInSeconds = 0
	let width = 0
	let height = 0
	let fps = 30
	let hasAudio = true
	let parsed = false

	try {
		const { ALL_FORMATS, BlobSource, Input, UrlSource } = await import('mediabunny')
		const media = new Input({
			formats: ALL_FORMATS,
			source: file ? new BlobSource(file) : new UrlSource(url),
		})
		const track = await media.getPrimaryVideoTrack()
		if (track) {
			const [trackWidth, trackHeight, stats, audioTrack, duration] = await Promise.all([
				track.getDisplayWidth(),
				track.getDisplayHeight(),
				track.computePacketStats(120),
				media.getPrimaryAudioTrack(),
				media.computeDuration(),
			])
			width = trackWidth
			height = trackHeight
			durationInSeconds = duration
			hasAudio = audioTrack !== null
			if (stats.averagePacketRate > 0) fps = Math.round(stats.averagePacketRate * 100) / 100
			parsed = true
		}
		media.dispose()
	} catch {
		/* falls back to the <video> element below */
	}

	if (!parsed || !durationInSeconds || !width || !height) {
		const fallback = await probeWithVideoElement(url)
		durationInSeconds = durationInSeconds || fallback.durationInSeconds
		width = width || fallback.width
		height = height || fallback.height
	}

	if (!durationInSeconds || !Number.isFinite(durationInSeconds)) {
		throw new Error('That file has no readable duration. Re-export it as an MP4 and try again.')
	}
	if (!width || !height) {
		throw new Error('That file has no video track - upload a video, not an audio file.')
	}

	return {
		url,
		name,
		kind: file ? 'file' : 'url',
		sizeInBytes: file?.size ?? 0,
		durationInSeconds,
		width: evenSize(width),
		height: evenSize(height),
		fps: fps > 0 && fps <= 120 ? fps : 30,
		hasAudio,
		file,
	}
}

export function releaseVideoSource(source: CaptionVideoSource | null): void {
	if (source && source.kind === 'file' && source.url.startsWith('blob:')) {
		URL.revokeObjectURL(source.url)
	}
}
