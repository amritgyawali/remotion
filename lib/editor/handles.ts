'use client'

/**
 * Remembers a `FileSystemFileHandle` so a picked file can be reopened after a
 * refresh without re-uploading or re-picking it - the browser's actual answer
 * to "save the path" (there is no path API; see the blueprint's Part 4.2).
 *
 * A handle is structured-clonable, so it goes straight into IndexedDB. This
 * is a second, tiny database rather than a new store in `lib/persist/idb.ts`:
 * that module is shared by every studio and its schema is deliberately
 * frozen, so a browser that has no File System Access support (Firefox, iOS
 * Safari) never even opens this database - `handleSupported()` guards every
 * entry point, and those browsers fall back to copying bytes into the shared
 * vault instead (see `lib/editor/persistence.ts`).
 */

const DB_NAME = 'rvs-editor-handles'
const DB_VERSION = 1
const STORE = 'handles'

export type StoredHandle = {
	key: string
	handle: FileSystemFileHandle
	name: string
	size: number
	lastModified: number
	fingerprint: string
}

export function handleSupported(): boolean {
	return typeof window !== 'undefined' && typeof window.showOpenFilePicker === 'function'
}

let dbPromise: Promise<IDBDatabase | null> | null = null

function openDb(): Promise<IDBDatabase | null> {
	if (typeof window === 'undefined' || !window.indexedDB) return Promise.resolve(null)
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
			if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' })
		}
		request.onsuccess = () => {
			const db = request.result
			db.onversionchange = () => {
				db.close()
				dbPromise = null
			}
			resolve(db)
		}
		request.onerror = () => resolve(null)
		request.onblocked = () => resolve(null)
	})
}

function db(): Promise<IDBDatabase | null> {
	if (!dbPromise) {
		dbPromise = openDb().then((instance) => {
			if (!instance) dbPromise = null
			return instance
		})
	}
	return dbPromise
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result)
		request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
	})
}

export async function rememberHandle(key: string, handle: FileSystemFileHandle, file: File, fingerprint: string): Promise<boolean> {
	try {
		const instance = await db()
		if (!instance) return false
		const record: StoredHandle = { key, handle, name: file.name, size: file.size, lastModified: file.lastModified, fingerprint }
		const tx = instance.transaction(STORE, 'readwrite')
		await promisify(tx.objectStore(STORE).put(record))
		await new Promise<void>((resolve, reject) => {
			tx.oncomplete = () => resolve()
			tx.onabort = () => reject(tx.error ?? new Error('aborted'))
			tx.onerror = () => reject(tx.error ?? new Error('failed'))
		})
		return true
	} catch {
		return false
	}
}

export async function recallHandle(key: string): Promise<StoredHandle | null> {
	try {
		const instance = await db()
		if (!instance) return null
		const record = await promisify<StoredHandle | undefined>(instance.transaction(STORE, 'readonly').objectStore(STORE).get(key))
		return record ?? null
	} catch {
		return null
	}
}

export async function forgetHandle(key: string): Promise<void> {
	try {
		const instance = await db()
		if (!instance) return
		await promisify(instance.transaction(STORE, 'readwrite').objectStore(STORE).delete(key))
	} catch {
		/* already gone */
	}
}

export type HandlePermission = 'granted' | 'prompt-needed' | 'denied' | 'missing'

/**
 * Checks (never *requests*) permission for a remembered handle.
 *
 * `requestPermission()` only succeeds inside a user gesture, so callers must
 * split this into "what needs a click" (this function, safe on mount) and
 * "ask for it" (`grantHandlePermission`, called from an onClick).
 */
export async function checkHandlePermission(handle: FileSystemFileHandle): Promise<'granted' | 'prompt'> {
	try {
		const state = await handle.queryPermission({ mode: 'read' })
		return state === 'granted' ? 'granted' : 'prompt'
	} catch {
		return 'prompt'
	}
}

export async function grantHandlePermission(handle: FileSystemFileHandle): Promise<boolean> {
	try {
		const state = await handle.requestPermission({ mode: 'read' })
		return state === 'granted'
	} catch {
		return false
	}
}
