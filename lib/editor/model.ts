/**
 * Factories and pure queries over a `ProjectDoc`.
 *
 * Nothing here mutates - every function either builds a fresh entity or reads
 * one. Mutation only ever happens through `lib/editor/commands.ts`, so undo
 * stays exhaustive: if a change did not go through a Patch, it did not
 * happen as far as history and autosave are concerned.
 */

import {
	type Asset,
	type AudioClip,
	type Clip,
	type ClipEffects,
	EDITOR_SCHEMA_VERSION,
	type ImageClip,
	type Marker,
	type ProjectDoc,
	type Track,
	type TrackKind,
	type Transform,
	type TextClip,
	type TextStyle,
	type VideoClip,
	clipEndFrame,
} from './types'

let counter = 0
/** Monotonic within a tab, prefixed so ids read like `clip_3`, `asset_1` in the devtools and in bug reports. */
export function makeId(prefix: string): string {
	counter += 1
	return `${prefix}_${Date.now().toString(36)}${(counter % 1296).toString(36)}`
}

export function defaultTransform(overrides: Partial<Transform> = {}): Transform {
	return { x: 0, y: 0, scaleX: 1, scaleY: 1, rotationDeg: 0, opacity: 1, ...overrides }
}

export function defaultClipEffects(overrides: Partial<ClipEffects> = {}): ClipEffects {
	return {
		brightness: 1,
		contrast: 1,
		saturation: 1,
		temperature: 0,
		hueRotateDeg: 0,
		blurPx: 0,
		vignette: 0,
		grayscale: 0,
		sepia: 0,
		invert: 0,
		crop: null,
		chromaKey: null,
		...overrides,
	}
}

export function defaultTextStyle(overrides: Partial<TextStyle> = {}): TextStyle {
	return {
		content: 'Text',
		fontFamily: 'Inter, ui-sans-serif, sans-serif',
		fontSizePx: 64,
		weight: 800,
		color: '#ffffff',
		align: 'center',
		position: 'center',
		backgroundColor: null,
		strokeColor: '#000000',
		strokeWidthPx: 0,
		marginPx: 48,
		animationIn: 'none',
		animationOut: 'none',
		animationFrames: 12,
		...overrides,
	}
}

export function createProject(settings?: Partial<ProjectDoc['settings']>): ProjectDoc {
	const now = Date.now()
	const videoTrack: Track = { id: makeId('track'), kind: 'video', name: 'V1', height: 64, muted: false, locked: false, hidden: false }
	const textTrack: Track = { id: makeId('track'), kind: 'text', name: 'Text', height: 44, muted: false, locked: false, hidden: false }
	return {
		schemaVersion: EDITOR_SCHEMA_VERSION,
		id: makeId('project'),
		name: 'Untitled project',
		createdAt: now,
		updatedAt: now,
		settings: { width: 1920, height: 1080, fps: 30, backgroundColor: '#000000', ...settings },
		trackOrder: [videoTrack.id, textTrack.id],
		tracks: { [videoTrack.id]: videoTrack, [textTrack.id]: textTrack },
		clips: {},
		assets: {},
		markers: [],
	}
}

export function createTrack(kind: TrackKind, name: string): Track {
	return { id: makeId('track'), kind, name, height: kind === 'text' ? 44 : kind === 'audio' ? 56 : 64, muted: false, locked: false, hidden: false }
}

function clipBase(trackId: string, startFrame: number, durationFrames: number, label: string) {
	return {
		id: makeId('clip'),
		trackId,
		startFrame: Math.max(0, Math.round(startFrame)),
		durationFrames: Math.max(1, Math.round(durationFrames)),
		label,
		enabled: true,
		locked: false,
		transform: defaultTransform(),
		audio: { gainDb: 0, muted: false, fadeInFrames: 0, fadeOutFrames: 0 },
		effects: defaultClipEffects(),
	}
}

/** How many project frames a freshly-dropped clip of this asset should span by default - images get a flat 5s, everything else its own natural length. */
export function assetDefaultDurationFrames(asset: Asset, fps: number): number {
	const seconds = asset.kind === 'image' ? 5 : asset.durationSeconds
	return Math.max(1, Math.round(seconds * fps))
}

export function createVideoClip(args: {
	trackId: string
	assetId: string
	startFrame: number
	durationFrames: number
	sourceInSeconds?: number
	speed?: number
	label: string
}): VideoClip {
	return {
		...clipBase(args.trackId, args.startFrame, args.durationFrames, args.label),
		kind: 'video',
		assetId: args.assetId,
		sourceInSeconds: args.sourceInSeconds ?? 0,
		speed: args.speed ?? 1,
		freezeFrame: false,
	}
}

export function createImageClip(args: { trackId: string; assetId: string; startFrame: number; durationFrames: number; label: string }): ImageClip {
	return { ...clipBase(args.trackId, args.startFrame, args.durationFrames, args.label), kind: 'image', assetId: args.assetId }
}

export function createAudioClip(args: {
	trackId: string
	assetId: string
	startFrame: number
	durationFrames: number
	sourceInSeconds?: number
	speed?: number
	label: string
}): AudioClip {
	return {
		...clipBase(args.trackId, args.startFrame, args.durationFrames, args.label),
		kind: 'audio',
		assetId: args.assetId,
		sourceInSeconds: args.sourceInSeconds ?? 0,
		speed: args.speed ?? 1,
	}
}

export function createTextClip(args: { trackId: string; startFrame: number; durationFrames: number; text?: Partial<TextStyle> }): TextClip {
	return {
		...clipBase(args.trackId, args.startFrame, args.durationFrames, args.text?.content ?? 'Text'),
		kind: 'text',
		assetId: null,
		text: defaultTextStyle(args.text),
	}
}

export function createMarker(frame: number, label = 'Marker', color = '#7d7cff'): Marker {
	return { id: makeId('marker'), frame: Math.max(0, Math.round(frame)), label, color }
}

/* ------------------------------------------------------------------ queries */

export function clipsOnTrack(doc: ProjectDoc, trackId: string): Clip[] {
	const list: Clip[] = []
	for (const id in doc.clips) {
		const clip = doc.clips[id]
		if (clip.trackId === trackId) list.push(clip)
	}
	return list.sort((a, b) => a.startFrame - b.startFrame)
}

export function allClipsSorted(doc: ProjectDoc): Clip[] {
	return Object.values(doc.clips).sort((a, b) => a.startFrame - b.startFrame)
}

/** Clips whose [start, end) range covers `frame`, bottom track first (paint order). */
export function activeClipsAtFrame(doc: ProjectDoc, frame: number): Clip[] {
	const result: Clip[] = []
	for (const trackId of doc.trackOrder) {
		const track = doc.tracks[trackId]
		if (!track || track.hidden) continue
		for (const clip of clipsOnTrack(doc, trackId)) {
			if (!clip.enabled) continue
			if (frame >= clip.startFrame && frame < clipEndFrame(clip)) result.push(clip)
		}
	}
	return result
}

export function projectDurationFrames(doc: ProjectDoc): number {
	let max = 0
	for (const id in doc.clips) max = Math.max(max, clipEndFrame(doc.clips[id]))
	for (const marker of doc.markers) max = Math.max(max, marker.frame)
	return max
}

/** Snap candidates near `frame`, in project frames: other clip edges, the playhead, and markers. */
export function snapCandidates(doc: ProjectDoc, excludeClipId: string | null): number[] {
	const points = new Set<number>([0])
	for (const id in doc.clips) {
		if (id === excludeClipId) continue
		const clip = doc.clips[id]
		points.add(clip.startFrame)
		points.add(clipEndFrame(clip))
	}
	for (const marker of doc.markers) points.add(marker.frame)
	return Array.from(points)
}

export function findAsset(doc: ProjectDoc, id: string | null): Asset | null {
	return id ? (doc.assets[id] ?? null) : null
}

export function nextTrackName(doc: ProjectDoc, kind: TrackKind): string {
	const prefix = kind === 'video' ? 'V' : kind === 'audio' ? 'A' : 'Text'
	let n = 1
	const taken = new Set(doc.trackOrder.map((id) => doc.tracks[id]?.name))
	while (taken.has(`${prefix}${n}`)) n += 1
	return `${prefix}${n}`
}
