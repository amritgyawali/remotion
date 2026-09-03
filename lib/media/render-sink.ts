'use client'

/**
 * Where an encoded file goes while it is being written.
 *
 * Mediabunny will happily build a whole video in RAM - `BufferTarget` keeps the
 * file in one ArrayBuffer, and an MP4 with `fastStart: 'in-memory'` keeps every
 * media chunk alive on top of that until the moov box can be written first. A
 * few minutes of 1080p is enough for the pair to ask the browser for a
 * contiguous gigabyte and be told "Array buffer allocation failed", which ends
 * the export with nothing to show for the wait.
 *
 * So the file is streamed to a private file on disk instead, through the Origin
 * Private File System. The heap then only ever holds the muxer's sample tables
 * and one flush-sized window of bytes, no matter how long the clip is, and the
 * finished file comes back as a disk-backed `File` that costs nothing to hold,
 * download or hand to another studio.
 *
 * Browsers without a writable OPFS fall back to the in-memory target, which is
 * the old behaviour and still fine for short clips.
 */

import type { StreamTargetChunk, Target } from 'mediabunny'

export type RenderSink = {
	/** Hand this to `new Output({ target })`. */
	target: Target
	/**
	 * True when bytes land on disk as they are encoded. Formats that can place
	 * their metadata first only by hoarding the media must not do so here: pass
	 * `fastStart: false` and let the moov box go at the end of the file.
	 */
	streaming: boolean
	/** The finished file. Disk-backed when `streaming`, so it costs no heap. */
	finish(mimeType: string): Promise<Blob>
	/** Throws the half-written file away after a cancel or a failure. */
	discard(): Promise<void>
}

/** Exports live together so a stale one is easy to recognise and sweep. */
const EXPORT_DIRECTORY = 'studio-exports'

/**
 * How much is held before a write reaches the disk. Small enough to stay
 * invisible in memory, large enough that a long export is not thousands of
 * separate writes.
 */
const FLUSH_BYTES = 4 * 1024 * 1024

/** Files this tab is still using, and so must not sweep. */
const inUse = new Set<string>()

/**
 * How many finished exports stay protected. The caller is still holding a
 * `File` over each one, so they cannot be swept the moment they are done - but
 * a session that exports fifty times should not leave fifty files on disk
 * either, and by then nobody is looking at the first one.
 */
const RETAINED_EXPORTS = 8
const retained: string[] = []

function retain(name: string): void {
	retained.push(name)
	while (retained.length > RETAINED_EXPORTS) {
		const evicted = retained.shift()
		if (evicted) inUse.delete(evicted)
	}
}

async function openExportDirectory(): Promise<FileSystemDirectoryHandle | null> {
	try {
		if (typeof navigator === 'undefined') return null
		const root = await navigator.storage?.getDirectory?.()
		if (!root) return null
		return await root.getDirectoryHandle(EXPORT_DIRECTORY, { create: true })
	} catch {
		// No OPFS, no quota, or a private window that refuses it.
		return null
	}
}

/**
 * Removes exports left behind by a crash or a reload.
 *
 * A finished export is still referenced by the `File` the caller is holding, so
 * only files this tab has forgotten about are swept - and a tab that reloads
 * has forgotten all of them, which is exactly when the space should come back.
 */
async function sweep(directory: FileSystemDirectoryHandle): Promise<void> {
	try {
		for await (const name of (directory as unknown as { keys(): AsyncIterable<string> }).keys()) {
			if (inUse.has(name)) continue
			await directory.removeEntry(name).catch(() => {})
		}
	} catch {
		// A browser without directory iteration just keeps its files; they are
		// overwritten by name on the next export rather than accumulating.
	}
}

function safeName(base: string): string {
	return base.replace(/[^a-z0-9._-]+/gi, '-').slice(-60) || 'export'
}

export async function createRenderSink(baseName: string): Promise<RenderSink> {
	const { BufferTarget, StreamTarget } = await import('mediabunny')

	const directory = await openExportDirectory()
	if (directory) {
		try {
			await sweep(directory)
			const name = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}-${safeName(baseName)}`
			const handle = await directory.getFileHandle(name, { create: true })
			const writable = await handle.createWritable({ keepExistingData: false })
			inUse.add(name)

			let released = false
			const release = async () => {
				if (released) return
				released = true
				inUse.delete(name)
				await writable.abort().catch(() => {})
				await directory.removeEntry(name).catch(() => {})
			}

			return {
				// A `FileSystemWritableFileStream` takes exactly the positioned
				// `{ type: 'write', data, position }` records the target emits.
				target: new StreamTarget(writable as unknown as WritableStream<StreamTargetChunk>, {
					chunked: true,
					chunkSize: FLUSH_BYTES,
				}),
				streaming: true,
				async finish(mimeType) {
					// Mediabunny closed the stream when it finalised the output, so the
					// bytes are committed and this read is a handle, not a copy.
					const file = await handle.getFile()
					retain(name)
					return file.type === mimeType ? file : file.slice(0, file.size, mimeType)
				},
				discard: release,
			}
		} catch {
			// Fall through: an unwritable OPFS is not worth failing the export over.
		}
	}

	const target = new BufferTarget()
	return {
		target,
		streaming: false,
		async finish(mimeType) {
			const buffer = target.buffer
			if (!buffer) throw new Error('The encoder produced no file.')
			return new Blob([buffer], { type: mimeType })
		},
		async discard() {},
	}
}

/**
 * Turns the browser's out-of-memory shorthand into something a person can act
 * on. `RangeError: Array buffer allocation failed` says nothing about video.
 */
export function describeRenderFailure(error: unknown): Error {
	const message = error instanceof Error ? error.message : String(error)
	if (/array buffer allocation failed|out of memory|allocation size overflow/i.test(message)) {
		return new Error(
			'The browser ran out of memory for this export. Try a lower quality or a smaller scale, ' +
				'export in halves, or close other tabs and try again.',
		)
	}
	// What Chromium says when a canvas can no longer produce an image: the GPU
	// dropped its context, which on a long export means it ran out of room. The
	// export retries the frame on a fresh canvas before it ever gets here, so
	// reaching this point means even a new canvas could not be painted - and
	// the only thing that helps then is asking for fewer pixels.
	if (/invalid source state|context(?: is)? lost|contextlost/i.test(message)) {
		return new Error(
			'The browser’s graphics memory ran out part-way through this export, so a frame could not be ' +
				'handed to the encoder. Ask for a smaller output size and run it again - fewer pixels is the ' +
				'one thing that reliably fixes this - or close other tabs first. A draft-sized render of the ' +
				'same clip will go through whatever the machine.',
		)
	}
	// The muxer's own words for a track that starts before zero. Every export
	// path trims the encoder priming that causes it (see tools/packet-timing.ts),
	// so reaching here means one of them was missed - and the person reading it
	// should be told that, not handed the muxer's sentence.
	if (/timestamps? must be non-negative/i.test(message)) {
		return new Error(
			'This clip’s audio starts a few milliseconds before the video does - the encoder’s priming delay - ' +
				'and this export path did not trim it. Re-encoding the audio first (Tools › Convert) gets around ' +
				'it, and it is worth reporting: every other export here handles that automatically.',
		)
	}
	return error instanceof Error ? error : new Error(message)
}
