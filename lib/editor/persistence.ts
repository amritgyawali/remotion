'use client'

/**
 * Wires the editor's `Asset` model to the two storage tiers it actually uses:
 * the shared local vault (`lib/persist/idb.ts`, the same IndexedDB every
 * studio in this app already saves into) for the source bytes and the poster
 * thumbnail, and, when the browser offers it, a remembered
 * `FileSystemFileHandle` (`lib/editor/handles.ts`) purely as a *reconnect*
 * path for later.
 *
 * The vault copy is never optional: it is what makes the project openable
 * offline and on browsers without the File System Access API, and it is
 * what every other studio in this app already relies on. The handle is a
 * bonus - if storage is ever evicted (`§4.6`: browsers are allowed to do
 * this to non-persisted origins), a granted handle lets the bytes be pulled
 * back from disk with one click instead of asking the user to re-import.
 */

import { readBlob, removeBlob, writeBlob } from '../persist/idb'
import { checkHandlePermission, forgetHandle, grantHandlePermission, handleSupported, recallHandle, rememberHandle } from './handles'
import { fingerprintFile, generateThumbnail, probeMediaFile } from './probe'
import { makeId } from './model'
import type { Asset, AssetKind } from './types'

export const blobKeyFor = (assetId: string) => `editor-asset:${assetId}`
export const thumbKeyFor = (assetId: string) => `editor-thumb:${assetId}`

export type ImportedAsset = { asset: Asset; file: File }

/** Reads bytes back for an asset that already resolved once this session, or from the vault on a cold start. */
export async function readAssetBlob(asset: Asset): Promise<Blob | null> {
	const record = await readBlob(asset.blobKey)
	return record?.blob ?? null
}

export async function readAssetThumb(asset: Asset): Promise<Blob | null> {
	if (!asset.thumbKey) return null
	const record = await readBlob(asset.thumbKey)
	return record?.blob ?? null
}

export async function deleteAssetStorage(asset: Asset): Promise<void> {
	await removeBlob(asset.blobKey)
	if (asset.thumbKey) await removeBlob(asset.thumbKey)
	if (asset.handleKey) await forgetHandle(asset.handleKey)
}

/**
 * Probes, fingerprints, thumbnails and vault-copies one file, returning a
 * ready `Asset`. `handle` is stored alongside when the caller obtained the
 * file through `showOpenFilePicker` - see `MediaPool.tsx`.
 */
export async function importMediaFile(file: File, handle: FileSystemFileHandle | null): Promise<ImportedAsset> {
	const assetId = makeId('asset')
	const [probed, fingerprint] = await Promise.all([probeMediaFile(file), fingerprintFile(file)])

	const blobKey = blobKeyFor(assetId)
	const savedToVault = await writeBlob(blobKey, file, file.name)

	let handleKey: string | null = null
	if (handle && handleSupported()) {
		handleKey = `editor-handle:${assetId}`
		const remembered = await rememberHandle(handleKey, handle, file, fingerprint)
		if (!remembered) handleKey = null
	}

	let thumbKey: string | null = null
	const thumb = await generateThumbnail(file, probed.kind, Math.min(0.5, probed.durationSeconds / 2))
	if (thumb) {
		thumbKey = thumbKeyFor(assetId)
		await writeBlob(thumbKey, thumb, `${file.name}.thumb`)
	}

	const asset: Asset = {
		id: assetId,
		kind: probed.kind as AssetKind,
		name: file.name,
		blobKey,
		handleKey,
		thumbKey,
		fingerprint,
		sizeBytes: file.size,
		lastModified: file.lastModified,
		durationSeconds: probed.durationSeconds,
		width: probed.width,
		height: probed.height,
		fps: probed.fps,
		hasAudio: probed.hasAudio,
		// 'ready' as soon as the bytes are usable *this session* (they always are -
		// `file` came straight from the picker). A failed vault write only means a
		// refresh will not bring this clip back; it does not block using it now.
		status: 'ready',
		error: savedToVault ? null : 'Could not be saved for next time - your browser storage may be full. It will still work until you refresh.',
	}
	return { asset, file }
}

export type ReconnectOutcome = { assetId: string; ok: boolean; file: File | null; reason?: string }

/**
 * Re-grants permission for a remembered handle and pulls fresh bytes from
 * disk, re-copying them into the vault. Must be called from inside a click
 * handler - `requestPermission()` throws outside a user gesture.
 */
export async function reconnectAsset(asset: Asset): Promise<ReconnectOutcome> {
	if (!asset.handleKey) return { assetId: asset.id, ok: false, file: null, reason: 'No remembered file handle for this asset.' }
	const stored = await recallHandle(asset.handleKey)
	if (!stored) return { assetId: asset.id, ok: false, file: null, reason: 'The remembered file could not be found.' }

	const granted = await grantHandlePermission(stored.handle)
	if (!granted) return { assetId: asset.id, ok: false, file: null, reason: 'Permission to read this file was not granted.' }

	try {
		const file = await stored.handle.getFile()
		await writeBlob(asset.blobKey, file, file.name)
		return { assetId: asset.id, ok: true, file }
	} catch {
		return { assetId: asset.id, ok: false, file: null, reason: 'That file appears to have been moved or deleted.' }
	}
}

/** Silent check (no permission prompt) used on load to decide whether to show the "Reconnect" banner at all. */
export async function assetsNeedingPermission(assets: Asset[]): Promise<string[]> {
	const needing: string[] = []
	for (const asset of assets) {
		if (!asset.handleKey) continue
		const stored = await recallHandle(asset.handleKey)
		if (!stored) continue
		const state = await checkHandlePermission(stored.handle)
		if (state !== 'granted') needing.push(asset.id)
	}
	return needing
}
