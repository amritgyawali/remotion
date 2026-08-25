'use client'

/**
 * The studio's local vault.
 *
 * Everything a session needs in order to survive a refresh lives here: a JSON
 * snapshot per studio, and the actual uploaded bytes. An uploaded video can be
 * a gigabyte, which is three orders of magnitude past what localStorage
 * accepts, so files are kept in IndexedDB as Blobs and only their ids travel in
 * the snapshot.
 *
 * Every call resolves rather than throws when storage is unavailable - a
 * private window, a blocked origin, a browser with IndexedDB switched off. A
 * studio that cannot save is still a studio that works.
 */

const DB_NAME = 'rvs-studio'
const DB_VERSION = 1

export const SNAPSHOTS = 'snapshots'
export const BLOBS = 'blobs'

export type StoredBlob = {
	id: string
	name: string
	type: string
	size: number
	lastModified: number
	updatedAt: number
	blob: Blob
}

export type StoredSnapshot<T = unknown> = {
	key: string
	/** schema version of `data`, so an old snapshot can be rejected not misread */
	version: number
	updatedAt: number
	data: T
}

let databasePromise: Promise<IDBDatabase | null> | null = null

export function storageAvailable(): boolean {
	return typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined'
}

function openDatabase(): Promise<IDBDatabase | null> {
	if (!storageAvailable()) return Promise.resolve(null)

	return new Promise((resolve) => {
		let request: IDBOpenDBRequest
		try {
			request = window.indexedDB.open(DB_NAME, DB_VERSION)
		} catch {
			resolve(null)
			return
		}

		request.onupgradeneeded = () => {
			const db = request.result
			if (!db.objectStoreNames.contains(SNAPSHOTS)) {
				db.createObjectStore(SNAPSHOTS, { keyPath: 'key' })
			}
			if (!db.objectStoreNames.contains(BLOBS)) {
				db.createObjectStore(BLOBS, { keyPath: 'id' })
			}
		}

		request.onsuccess = () => {
			const db = request.result
			// Another tab upgrading the schema must not leave this one holding a
			// connection that blocks it forever.
			db.onversionchange = () => {
				db.close()
				databasePromise = null
			}
			resolve(db)
		}

		request.onerror = () => resolve(null)
		request.onblocked = () => resolve(null)
	})
}

export function database(): Promise<IDBDatabase | null> {
	if (!databasePromise) {
		databasePromise = openDatabase().then((db) => {
			// A failed open is not cached: the next call gets a fresh attempt, which
			// is what makes a first-load race or a transient block recoverable.
			if (!db) databasePromise = null
			return db
		})
	}
	return databasePromise
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result)
		request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
	})
}

/**
 * Runs one transaction and resolves only once it has actually committed.
 *
 * Waiting for `oncomplete` rather than for the request is the whole point: a
 * refresh that lands between "request succeeded" and "transaction committed"
 * would otherwise lose the write it just reported as saved.
 */
async function transact<T>(
	store: string,
	mode: IDBTransactionMode,
	run: (store: IDBObjectStore) => Promise<T> | T,
): Promise<T | null> {
	const db = await database()
	if (!db) return null

	const transaction = db.transaction(store, mode)
	const result = await run(transaction.objectStore(store))
	if (mode === 'readonly') return result
	await new Promise<void>((resolve, reject) => {
		transaction.oncomplete = () => resolve()
		transaction.onabort = () => reject(transaction.error ?? new Error('Transaction aborted'))
		transaction.onerror = () => reject(transaction.error ?? new Error('Transaction failed'))
	})
	return result
}

/* ------------------------------------------------------------- snapshots */

export async function readSnapshot<T>(key: string): Promise<StoredSnapshot<T> | null> {
	try {
		const record = await transact(SNAPSHOTS, 'readonly', (store) =>
			promisify<StoredSnapshot<T> | undefined>(store.get(key)),
		)
		return record ?? null
	} catch {
		return null
	}
}

export async function writeSnapshot<T>(key: string, version: number, data: T): Promise<boolean> {
	try {
		await transact(SNAPSHOTS, 'readwrite', (store) => {
			const record: StoredSnapshot<T> = { key, version, updatedAt: Date.now(), data }
			return promisify(store.put(record))
		})
		return true
	} catch {
		return false
	}
}

export async function removeSnapshot(key: string): Promise<void> {
	try {
		await transact(SNAPSHOTS, 'readwrite', (store) => promisify(store.delete(key)))
	} catch {
		/* nothing to clear */
	}
}

/* ----------------------------------------------------------------- blobs */

export async function readBlob(id: string): Promise<StoredBlob | null> {
	try {
		const record = await transact(BLOBS, 'readonly', (store) =>
			promisify<StoredBlob | undefined>(store.get(id)),
		)
		return record ?? null
	} catch {
		return null
	}
}

/**
 * Stores raw bytes under a caller-chosen id.
 *
 * The boolean is meaningful: a 900 MB upload can exceed the origin quota, and
 * the caller needs to know that the settings were saved but the media was not,
 * so it can say so instead of promising a restore it cannot deliver.
 */
export async function writeBlob(id: string, file: File | Blob, name?: string): Promise<boolean> {
	try {
		await transact(BLOBS, 'readwrite', (store) => {
			const asFile = file as File
			const record: StoredBlob = {
				id,
				name: name ?? asFile.name ?? 'file',
				type: file.type || 'application/octet-stream',
				size: file.size,
				lastModified: typeof asFile.lastModified === 'number' ? asFile.lastModified : Date.now(),
				updatedAt: Date.now(),
				blob: file,
			}
			return promisify(store.put(record))
		})
		return true
	} catch {
		return false
	}
}

export async function removeBlob(id: string): Promise<void> {
	try {
		await transact(BLOBS, 'readwrite', (store) => promisify(store.delete(id)))
	} catch {
		/* nothing to clear */
	}
}

/* ----------------------------------------------------------------- quota */

export type VaultEstimate = {
	usage: number
	quota: number
	/** true once the browser has agreed not to evict this origin under pressure */
	persisted: boolean
}

export async function storageEstimate(): Promise<VaultEstimate | null> {
	if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null
	try {
		const [estimate, persisted] = await Promise.all([
			navigator.storage.estimate(),
			navigator.storage.persisted ? navigator.storage.persisted() : Promise.resolve(false),
		])
		return { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0, persisted }
	} catch {
		return null
	}
}

/**
 * Asks the browser to exempt this origin from storage eviction.
 *
 * Chrome grants it silently for an installed or frequently used site; Firefox
 * prompts. Either way the answer is advisory, so nothing here depends on it.
 */
export async function requestPersistentStorage(): Promise<boolean> {
	if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false
	try {
		if (navigator.storage.persisted && (await navigator.storage.persisted())) return true
		return await navigator.storage.persist()
	} catch {
		return false
	}
}

export async function clearAllStudioStorage(): Promise<void> {
	const db = await database()
	if (!db) return
	try {
		const transaction = db.transaction([SNAPSHOTS, BLOBS], 'readwrite')
		transaction.objectStore(SNAPSHOTS).clear()
		transaction.objectStore(BLOBS).clear()
		await new Promise<void>((resolve) => {
			transaction.oncomplete = () => resolve()
			transaction.onerror = () => resolve()
			transaction.onabort = () => resolve()
		})
	} catch {
		/* already gone */
	}
}
