'use client'

/**
 * Bridges the subtitle tool to the studio's compiler: the generated source is
 * handed over as an ordinary one-file project, so captions ride the exact same
 * compile -> preview -> render path as an uploaded composition.
 */

import { buildCaptionSource, CAPTION_ENTRY_FILE, type CompositionPlan } from './composition-source'
import type {
	CaptionCue,
	CaptionSound,
	CaptionStyle,
	CaptionVideoSource,
	TranscriptOrigin,
} from './types'
import { deviceProfile } from '../device'
import type { VirtualProject } from '../types'

const ORIGIN_LABEL: Record<TranscriptOrigin, string> = {
	whisper: 'transcribed on-device with Whisper',
	cloud: 'transcribed with hosted speech recognition',
	srt: 'imported from a subtitle file',
	text: 'written by hand and auto-timed',
	none: 'no transcript yet',
}

function evenSize(value: number): number {
	const rounded = Math.max(2, Math.round(value))
	return rounded % 2 === 0 ? rounded : rounded + 1
}

/**
 * Keeps the source framing but caps absurd sizes so browsers can still encode.
 *
 * The ceiling comes from the device, not from a constant: a desktop keeps the
 * full 4K path, while a phone plans at 1080p or 1440p. A 4K clip shot on that
 * same phone would otherwise be encoded at its native size in one browser tab,
 * and the tab is killed rather than told it ran out of memory - a render that
 * "just stops" with no error at all.
 */
export function planComposition(
	video: CaptionVideoSource,
	fps: number,
	maxDimension = deviceProfile().maxDimension,
): CompositionPlan {
	const scale = Math.min(1, maxDimension / Math.max(video.width, video.height))
	return {
		id: 'CaptionedVideo',
		width: evenSize(video.width * scale),
		height: evenSize(video.height * scale),
		fps,
		durationInFrames: Math.max(1, Math.round(video.durationInSeconds * fps)),
	}
}

export function captionSourceFor(args: {
	video: CaptionVideoSource
	cues: CaptionCue[]
	style: CaptionStyle
	sound: CaptionSound
	plan: CompositionPlan
	origin: TranscriptOrigin
}): string {
	return buildCaptionSource({
		videoSrc: args.video.url,
		videoName: args.video.name,
		cues: args.cues,
		style: args.style,
		sound: args.sound,
		plan: args.plan,
		origin: ORIGIN_LABEL[args.origin],
	})
}

export function captionProject(source: string, name: string): VirtualProject {
	return {
		name,
		entry: CAPTION_ENTRY_FILE,
		files: [{ path: CAPTION_ENTRY_FILE, contents: source }],
	}
}

export function downloadFileName(video: CaptionVideoSource, extension: string): string {
	const base = video.name.replace(/\.[a-z0-9]+$/i, '').replace(/[^a-z0-9-_]+/gi, '-') || 'video'
	return `${base}-subtitled.${extension}`
}
