'use client'

/**
 * Passing a clip from one studio to the next.
 *
 * The two video studios are two halves of one job. Someone captions a talk and
 * then wants the dead air gone; someone tightens a lecture and then wants
 * subtitles on the tightened cut. Making them re-upload a gigabyte in between -
 * and, worse, re-time forty cues by hand - is the difference between a toolkit
 * and two tools that happen to share a stylesheet.
 *
 * So a hand-off is a parcel in the local vault: the bytes in the blob store,
 * the measured facts and any transcript in a snapshot beside them. Nothing
 * leaves the browser, and the receiving studio decides what to do with it - it
 * is offered, never forced, because silently replacing the clip someone is
 * working on would be the rudest possible way to be helpful.
 */

import { useEffect, useState } from 'react'
import { readBlob, readSnapshot, removeBlob, removeSnapshot, writeBlob, writeSnapshot } from './persist/idb'
import type { CaptionCue } from './captions/types'

export type StudioKey = 'captions' | 'silence' | 'tools'

export const HANDOFF_KEY = 'studio:handoff'
export const HANDOFF_VERSION = 1
export const HANDOFF_BLOB_ID = 'studio:handoff-video'

/** A parcel older than this is stale - someone opened the tab a week later. */
const HANDOFF_TTL_MS = 24 * 60 * 60 * 1000

export type HandoffFacts = {
	name: string
	type: string
	sizeInBytes: number
	durationInSeconds: number
	width: number
	height: number
	fps: number
	hasAudio: boolean
}

export type StudioHandoff = HandoffFacts & {
	from: StudioKey
	to: StudioKey
	createdAt: number
	/** one line the receiving studio shows: what this is and where it came from */
	note: string
	/** a transcript travelling with the clip, already on the clip's own clock */
	cues: CaptionCue[]
}

export type IncomingHandoff = {
	handoff: StudioHandoff
	file: File
}

const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value)

function normalize(value: unknown): StudioHandoff | null {
	if (!isObject(value)) return null
	const asKey = (input: unknown): StudioKey | null =>
		input === 'silence' || input === 'captions' || input === 'tools' ? input : null
	const from = asKey(value.from)
	const to = asKey(value.to)
	if (!from || !to) return null

	const number = (input: unknown, fallback: number) =>
		typeof input === 'number' && Number.isFinite(input) ? input : fallback

	const durationInSeconds = number(value.durationInSeconds, 0)
	const width = Math.round(number(value.width, 0))
	const height = Math.round(number(value.height, 0))
	if (!durationInSeconds || !width || !height) return null

	return {
		from,
		to,
		createdAt: number(value.createdAt, 0),
		note: typeof value.note === 'string' ? value.note : '',
		name: typeof value.name === 'string' ? value.name : 'video.mp4',
		type: typeof value.type === 'string' ? value.type : 'video/mp4',
		sizeInBytes: Math.round(number(value.sizeInBytes, 0)),
		durationInSeconds,
		width,
		height,
		fps: number(value.fps, 30),
		hasAudio: value.hasAudio !== false,
		cues: Array.isArray(value.cues) ? (value.cues as CaptionCue[]) : [],
	}
}

/**
 * Files a clip for another studio to pick up.
 *
 * Returns false when the browser refused the bytes - a full origin quota, a
 * private window - so the caller can say the hand-off did not happen instead of
 * sending someone to a studio that will greet them with nothing.
 */
export async function sendToStudio(args: {
	blob: Blob
	from: StudioKey
	to: StudioKey
	facts: HandoffFacts
	note: string
	cues?: CaptionCue[]
}): Promise<boolean> {
	const stored = await writeBlob(HANDOFF_BLOB_ID, args.blob, args.facts.name)
	if (!stored) return false

	const payload: StudioHandoff = {
		...args.facts,
		from: args.from,
		to: args.to,
		createdAt: Date.now(),
		note: args.note,
		cues: args.cues ?? [],
	}
	const written = await writeSnapshot(HANDOFF_KEY, HANDOFF_VERSION, payload)
	if (!written) {
		await removeBlob(HANDOFF_BLOB_ID)
		return false
	}
	return true
}

/** Reads the parcel addressed to `target`, if there is a live one. */
export async function readHandoff(target: StudioKey): Promise<IncomingHandoff | null> {
	const record = await readSnapshot<unknown>(HANDOFF_KEY)
	if (!record || record.version !== HANDOFF_VERSION) return null

	const handoff = normalize(record.data)
	if (!handoff || handoff.to !== target) return null
	if (handoff.createdAt && Date.now() - handoff.createdAt > HANDOFF_TTL_MS) {
		await clearHandoff()
		return null
	}

	const stored = await readBlob(HANDOFF_BLOB_ID)
	if (!stored) {
		await removeSnapshot(HANDOFF_KEY)
		return null
	}

	const file = new File([stored.blob], handoff.name, {
		type: handoff.type || stored.type || 'video/mp4',
		lastModified: stored.lastModified,
	})
	return { handoff, file }
}

export async function clearHandoff(): Promise<void> {
	await Promise.all([removeSnapshot(HANDOFF_KEY), removeBlob(HANDOFF_BLOB_ID)])
}

/**
 * Watches for a parcel addressed to this studio.
 *
 * `ready` holds the read until the studio has finished restoring its own
 * session, so the offer appears next to a workspace that has settled rather
 * than on top of one that is still coming back.
 */
export function useIncomingHandoff(target: StudioKey, ready: boolean): {
	incoming: IncomingHandoff | null
	dismiss: () => void
	accept: () => Promise<IncomingHandoff | null>
} {
	const [incoming, setIncoming] = useState<IncomingHandoff | null>(null)

	useEffect(() => {
		if (!ready) return
		let active = true
		void readHandoff(target).then((found) => {
			if (active) setIncoming(found)
		})
		return () => {
			active = false
		}
	}, [ready, target])

	return {
		incoming,
		dismiss: () => {
			setIncoming(null)
			void clearHandoff()
		},
		accept: async () => {
			const taken = incoming
			setIncoming(null)
			// The parcel is consumed on acceptance: leaving it in the vault would
			// re-offer the same clip on every future visit.
			await clearHandoff()
			return taken
		},
	}
}
