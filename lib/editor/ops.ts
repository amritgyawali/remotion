/**
 * Command constructors: the only place that is allowed to build a `Command`.
 *
 * Every function here reads the document as it stands *before* the edit,
 * which is what makes an exact `backward` patch possible - by the time
 * `Engine.dispatch` runs `forward`, the "before" picture is already frozen
 * into `backward`. Call these, then hand the result to `engine.dispatch()`;
 * never mutate `doc` directly.
 */

import type { Command } from './commands'
import { clipsOnTrack, createMarker as makeMarker, makeId } from './model'
import {
	type Asset,
	type AudioClip,
	type Clip,
	type ImageClip,
	type Marker,
	type ProjectDoc,
	type ProjectSettings,
	type TextClip,
	type Track,
	type TrackKind,
	type Transform,
	type VideoClip,
	clipEndFrame,
	isMediaClip,
} from './types'

/**
 * `Partial<Clip>` only exposes the fields every clip variant shares - a
 * union's `keyof` is the *intersection* of its members' keys, not the union.
 * Field updates here legitimately reach into a specific variant (a video
 * clip's `sourceInSeconds`, a text clip's `text`), so callers that build a
 * field patch use this permissive union-of-partials instead.
 */
type ClipFields = Partial<VideoClip> & Partial<ImageClip> & Partial<AudioClip> & Partial<TextClip>

/* --------------------------------------------------------------- project */

export function renameProject(doc: ProjectDoc, name: string): Command {
	return { label: 'Rename project', forward: { name }, backward: { name: doc.name } }
}

export function setProjectSettings(doc: ProjectDoc, settings: Partial<ProjectSettings>): Command {
	const next = { ...doc.settings, ...settings }
	return { label: 'Change project settings', forward: { settings: next }, backward: { settings: doc.settings } }
}

/* ----------------------------------------------------------------- assets */

export function addAsset(asset: Asset): Command {
	return { label: `Add ${asset.name}`, forward: { assets: { [asset.id]: asset } }, backward: { assets: { [asset.id]: null } } }
}

export function updateAsset(doc: ProjectDoc, assetId: string, fields: Partial<Asset>): Command {
	const before = doc.assets[assetId]
	if (!before) return { label: 'Update asset', forward: {}, backward: {} }
	return {
		label: 'Update asset',
		forward: { assets: { [assetId]: { ...before, ...fields } } },
		backward: { assets: { [assetId]: before } },
	}
}

export function removeAsset(doc: ProjectDoc, assetId: string): Command {
	const before = doc.assets[assetId]
	if (!before) return { label: 'Remove asset', forward: {}, backward: {} }
	// Clips referencing this asset would otherwise point at nothing; they go with it.
	const clipPatch: Record<string, Clip | null> = {}
	const clipBackward: Record<string, Clip | null> = {}
	for (const id in doc.clips) {
		const clip = doc.clips[id]
		if (isMediaClip(clip) && clip.assetId === assetId) {
			clipPatch[id] = null
			clipBackward[id] = clip
		}
	}
	return {
		label: `Remove ${before.name}`,
		forward: { assets: { [assetId]: null }, clips: clipPatch },
		backward: { assets: { [assetId]: before }, clips: clipBackward },
	}
}

/* ----------------------------------------------------------------- tracks */

export function addTrack(track: Track, order: string[]): Command {
	return {
		label: `Add ${track.name} track`,
		forward: { tracks: { [track.id]: track }, trackOrder: order },
		backward: { tracks: { [track.id]: null }, trackOrder: order.filter((id) => id !== track.id) },
	}
}

export function removeTrack(doc: ProjectDoc, trackId: string): Command {
	const before = doc.tracks[trackId]
	if (!before) return { label: 'Remove track', forward: {}, backward: {} }
	const clipPatch: Record<string, Clip | null> = {}
	const clipBackward: Record<string, Clip | null> = {}
	for (const clip of clipsOnTrack(doc, trackId)) {
		clipPatch[clip.id] = null
		clipBackward[clip.id] = clip
	}
	const nextOrder = doc.trackOrder.filter((id) => id !== trackId)
	return {
		label: `Remove ${before.name}`,
		forward: { tracks: { [trackId]: null }, trackOrder: nextOrder, clips: clipPatch },
		backward: { tracks: { [trackId]: before }, trackOrder: doc.trackOrder, clips: clipBackward },
	}
}

export function updateTrack(doc: ProjectDoc, trackId: string, fields: Partial<Track>): Command {
	const before = doc.tracks[trackId]
	if (!before) return { label: 'Update track', forward: {}, backward: {} }
	return {
		label: `Update ${before.name}`,
		forward: { tracks: { [trackId]: { ...before, ...fields } } },
		backward: { tracks: { [trackId]: before } },
	}
}

export function reorderTracks(order: string[], previous: string[]): Command {
	return { label: 'Reorder tracks', forward: { trackOrder: order }, backward: { trackOrder: previous } }
}

/* ------------------------------------------------------------------ clips */

export function addClip(clip: Clip): Command {
	return { label: `Add ${clip.label}`, forward: { clips: { [clip.id]: clip } }, backward: { clips: { [clip.id]: null } } }
}

export function removeClip(doc: ProjectDoc, clipId: string): Command {
	const before = doc.clips[clipId]
	if (!before) return { label: 'Remove clip', forward: {}, backward: {} }
	return { label: `Remove ${before.label}`, forward: { clips: { [clipId]: null } }, backward: { clips: { [clipId]: before } } }
}

/** Generic clip field update - the primitive `moveClip`/`trimClip`/`setTransform`/etc are built from. */
export function updateClip(doc: ProjectDoc, clipId: string, fields: ClipFields, label: string, coalesceKey?: string): Command {
	const before = doc.clips[clipId]
	if (!before) return { label, forward: {}, backward: {} }
	const after = { ...before, ...fields } as Clip
	return { label, coalesceKey, forward: { clips: { [clipId]: after } }, backward: { clips: { [clipId]: before } } }
}

export function moveClip(doc: ProjectDoc, clipId: string, startFrame: number, trackId?: string): Command {
	const before = doc.clips[clipId]
	if (!before) return { label: 'Move clip', forward: {}, backward: {} }
	return updateClip(
		doc,
		clipId,
		{ startFrame: Math.max(0, Math.round(startFrame)), trackId: trackId ?? before.trackId },
		'Move clip',
		`move:${clipId}`,
	)
}

export function setTransform(doc: ProjectDoc, clipId: string, transform: Partial<Transform>): Command {
	const before = doc.clips[clipId]
	if (!before) return { label: 'Adjust transform', forward: {}, backward: {} }
	return updateClip(doc, clipId, { transform: { ...before.transform, ...transform } }, 'Adjust transform', `transform:${clipId}`)
}

export function setClipAudio(doc: ProjectDoc, clipId: string, fields: Partial<Clip['audio']>): Command {
	const before = doc.clips[clipId]
	if (!before) return { label: 'Adjust clip audio', forward: {}, backward: {} }
	return updateClip(doc, clipId, { audio: { ...before.audio, ...fields } }, 'Adjust clip audio', `audio:${clipId}`)
}

/** Color grade + stylize filters (§E) - one command per clip so a slider drag coalesces into a single undo step. */
export function setClipEffects(doc: ProjectDoc, clipId: string, fields: Partial<Clip['effects']>): Command {
	const before = doc.clips[clipId]
	if (!before) return { label: 'Adjust effects', forward: {}, backward: {} }
	return updateClip(doc, clipId, { effects: { ...before.effects, ...fields } }, 'Adjust effects', `effects:${clipId}`)
}

export function setClipCrop(doc: ProjectDoc, clipId: string, crop: import('./types').CropRect | null): Command {
	const before = doc.clips[clipId]
	if (!before) return { label: 'Crop clip', forward: {}, backward: {} }
	return updateClip(doc, clipId, { effects: { ...before.effects, crop } }, 'Crop clip', `crop:${clipId}`)
}

export function setChromaKey(doc: ProjectDoc, clipId: string, chromaKey: import('./types').ChromaKeySpec | null): Command {
	const before = doc.clips[clipId]
	if (!before) return { label: 'Chroma key', forward: {}, backward: {} }
	return updateClip(doc, clipId, { effects: { ...before.effects, chromaKey } }, 'Chroma key', `chromakey:${clipId}`)
}

export function setTextStyle(doc: ProjectDoc, clipId: string, fields: Partial<import('./types').TextStyle>): Command {
	const before = doc.clips[clipId]
	if (!before || before.kind !== 'text') return { label: 'Edit text', forward: {}, backward: {} }
	return updateClip(doc, clipId, { text: { ...before.text, ...fields } }, 'Edit text', `text:${clipId}`)
}

export function setClipSpeed(doc: ProjectDoc, clipId: string, speed: number): Command {
	const before = doc.clips[clipId]
	if (!before || (before.kind !== 'video' && before.kind !== 'audio')) return { label: 'Change speed', forward: {}, backward: {} }
	return updateClip(doc, clipId, { speed: Math.max(0.1, Math.min(8, speed)) }, 'Change speed')
}

/** Toggles freeze-frame; `atSourceSeconds`, when given, also moves the held frame there ("freeze on this frame"). */
export function setFreezeFrame(doc: ProjectDoc, clipId: string, freezeFrame: boolean, atSourceSeconds?: number): Command {
	const before = doc.clips[clipId]
	if (!before || before.kind !== 'video') return { label: 'Freeze frame', forward: {}, backward: {} }
	return updateClip(doc, clipId, { freezeFrame, sourceInSeconds: atSourceSeconds ?? before.sourceInSeconds }, 'Freeze frame')
}

/**
 * Trims an edge in place: the *other* edge stays put. Trimming the left edge
 * also slides the source in-point so the picture does not jump; trimming the
 * right edge only changes duration.
 */
export function trimClip(doc: ProjectDoc, clipId: string, edge: 'in' | 'out', toFrame: number, fps: number): Command {
	const before = doc.clips[clipId]
	if (!before) return { label: 'Trim clip', forward: {}, backward: {} }
	const end = clipEndFrame(before)

	if (edge === 'out') {
		const duration = Math.max(1, Math.round(toFrame) - before.startFrame)
		return updateClip(doc, clipId, { durationFrames: duration }, 'Trim clip', `trim-out:${clipId}`)
	}

	const start = Math.max(0, Math.min(Math.round(toFrame), end - 1))
	const duration = end - start
	const fields: ClipFields = { startFrame: start, durationFrames: duration }
	if (isMediaClip(before) && before.kind !== 'image') {
		const deltaSeconds = ((start - before.startFrame) / fps) * before.speed
		fields.sourceInSeconds = Math.max(0, before.sourceInSeconds + deltaSeconds)
	}
	return updateClip(doc, clipId, fields, 'Trim clip', `trim-in:${clipId}`)
}

/** Splits one clip into two at `atFrame` (a project frame strictly inside the clip). */
export function splitClip(doc: ProjectDoc, clipId: string, atFrame: number, fps: number): Command {
	const before = doc.clips[clipId]
	if (!before) return { label: 'Split clip', forward: {}, backward: {} }
	const end = clipEndFrame(before)
	const cut = Math.round(atFrame)
	if (cut <= before.startFrame || cut >= end) return { label: 'Split clip', forward: {}, backward: {} }

	const leftDuration = cut - before.startFrame
	const rightId = makeId('clip')
	const left: Clip = { ...before, durationFrames: leftDuration }
	const right: Clip = { ...before, id: rightId, startFrame: cut, durationFrames: end - cut }
	if (isMediaClip(right) && right.kind !== 'image') {
		right.sourceInSeconds = right.sourceInSeconds + (leftDuration / fps) * right.speed
	}

	return {
		label: 'Split clip',
		forward: { clips: { [clipId]: left, [rightId]: right } },
		backward: { clips: { [clipId]: before, [rightId]: null } },
	}
}

/** Removes a clip and closes the gap it leaves by shifting every later clip on the same track left. */
export function rippleDelete(doc: ProjectDoc, clipId: string): Command {
	const before = doc.clips[clipId]
	if (!before) return { label: 'Ripple delete', forward: {}, backward: {} }
	const gap = before.durationFrames
	const forward: Record<string, Clip | null> = { [clipId]: null }
	const backward: Record<string, Clip | null> = { [clipId]: before }
	for (const clip of clipsOnTrack(doc, before.trackId)) {
		if (clip.id === clipId || clip.startFrame < before.startFrame) continue
		forward[clip.id] = { ...clip, startFrame: clip.startFrame - gap }
		backward[clip.id] = clip
	}
	return { label: 'Ripple delete', forward: { clips: forward }, backward: { clips: backward } }
}

/* ---------------------------------------------------------------- markers */

export function addMarker(doc: ProjectDoc, frame: number, label?: string, color?: string): Command {
	const marker = makeMarker(frame, label, color)
	return { label: 'Add marker', forward: { markers: [...doc.markers, marker] }, backward: { markers: doc.markers } }
}

export function removeMarker(doc: ProjectDoc, markerId: string): Command {
	return {
		label: 'Remove marker',
		forward: { markers: doc.markers.filter((m) => m.id !== markerId) },
		backward: { markers: doc.markers },
	}
}

export function moveMarker(doc: ProjectDoc, markerId: string, frame: number): Command {
	return {
		label: 'Move marker',
		coalesceKey: `marker:${markerId}`,
		forward: { markers: doc.markers.map((m) => (m.id === markerId ? { ...m, frame: Math.max(0, Math.round(frame)) } : m)) },
		backward: { markers: doc.markers },
	}
}

export function nextTrackKindName(kind: TrackKind): string {
	return kind === 'video' ? 'Video' : kind === 'audio' ? 'Audio' : 'Text'
}
