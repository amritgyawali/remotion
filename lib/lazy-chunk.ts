'use client'

/**
 * Reliable dynamic imports for the heavy render chunks.
 *
 * The encoder lives in a code-split chunk that is only fetched when a render
 * starts. On a phone that fetch happens over whatever the network is doing at
 * that moment, and webpack gives a chunk 120 seconds before it rejects with
 *
 *   Loading chunk 4882 failed. (timeout: /_next/static/chunks/a9a36fa4….js)
 *
 * which surfaced as a render that died at 0% on "Checking video and audio
 * codecs". A single slow fetch should never end a render, so every heavy import
 * goes through here:
 *
 *   - the timeout itself is raised in next.config.mjs (webpack chunkLoadTimeout)
 *   - a failed fetch is retried with backoff instead of failing the render
 *   - an offline device waits for the connection to come back rather than
 *     burning its retries against an interface that cannot send a packet
 *   - `prefetchChunk` warms the chunk while the user is still editing, so the
 *     render usually starts with the code already in the HTTP cache
 *
 * Webpack drops a failed chunk from its installed-chunks map, so re-calling the
 * same `import()` genuinely refetches rather than replaying the cached rejection.
 */

export class ChunkLoadFailure extends Error {
	readonly chunk: string
	readonly attempts: number

	constructor(chunk: string, attempts: number, cause: unknown) {
		super(
			`Could not download the ${chunk} after ${attempts} attempt${attempts === 1 ? '' : 's'}. ` +
				'This is a network problem, not a problem with your video - check the connection and start ' +
				'the render again. On a phone, staying on this tab while it loads helps.',
		)
		this.name = 'ChunkLoadFailure'
		this.chunk = chunk
		this.attempts = attempts
		this.cause = cause
	}
}

/** Chunk failures are the retryable ones; a genuine module error is not. */
export function isChunkLoadError(error: unknown): boolean {
	if (!error) return false
	const name = (error as { name?: string }).name ?? ''
	const message = (error as { message?: string }).message ?? String(error)
	return (
		name === 'ChunkLoadError' ||
		/Loading chunk \S+ failed/i.test(message) ||
		/Loading CSS chunk/i.test(message) ||
		/importing a module script failed/i.test(message) ||
		/dynamically imported module/i.test(message) ||
		/error loading dynamically imported/i.test(message)
	)
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(signal.reason ?? new Error('Aborted'))
			return
		}
		const timer = setTimeout(() => {
			signal?.removeEventListener('abort', onAbort)
			resolve()
		}, ms)
		const onAbort = () => {
			clearTimeout(timer)
			reject(signal?.reason ?? new Error('Aborted'))
		}
		signal?.addEventListener('abort', onAbort, { once: true })
	})
}

/** Resolves as soon as the device claims to be online again, or after `timeoutMs`. */
function whenOnline(timeoutMs: number, signal?: AbortSignal): Promise<void> {
	if (typeof navigator === 'undefined' || navigator.onLine !== false) return Promise.resolve()
	return new Promise((resolve) => {
		const done = () => {
			clearTimeout(timer)
			window.removeEventListener('online', done)
			signal?.removeEventListener('abort', done)
			resolve()
		}
		const timer = setTimeout(done, timeoutMs)
		window.addEventListener('online', done, { once: true })
		signal?.addEventListener('abort', done, { once: true })
	})
}

export type LoadChunkOptions = {
	/** human name used in progress messages and in the final error */
	label: string
	/** total attempts, including the first one */
	attempts?: number
	signal?: AbortSignal
	/** called before every retry so a render can say what it is waiting for */
	onRetry?: (attempt: number, attempts: number) => void
}

/**
 * A module cache keyed by label. Two callers asking for the same chunk share
 * one in-flight request, and a resolved module is handed back immediately - the
 * prefetch below is exactly this, started early and left to finish on its own.
 */
const inFlight = new Map<string, Promise<unknown>>()

export function loadChunk<T>(
	loader: () => Promise<T>,
	{ label, attempts = 4, signal, onRetry }: LoadChunkOptions,
): Promise<T> {
	const existing = inFlight.get(label) as Promise<T> | undefined
	if (existing) return existing

	const run = async (): Promise<T> => {
		let lastError: unknown = null
		for (let attempt = 1; attempt <= attempts; attempt++) {
			if (signal?.aborted) throw signal.reason ?? new Error('Aborted')
			try {
				return await loader()
			} catch (error) {
				lastError = error
				// A real error inside the module (a bad export, a thrown import-time
				// side effect) will fail identically every time - only retry network.
				if (!isChunkLoadError(error) || attempt === attempts) break
				onRetry?.(attempt, attempts)
				await whenOnline(15_000, signal)
				await wait(Math.min(8_000, 800 * 2 ** (attempt - 1)), signal)
			}
		}
		throw isChunkLoadError(lastError)
			? new ChunkLoadFailure(label, attempts, lastError)
			: lastError
	}

	const promise = run().catch((error: unknown) => {
		// Only a resolved module is worth caching; a failure must be retryable
		// the next time the user presses Render.
		inFlight.delete(label)
		throw error
	})
	inFlight.set(label, promise)
	return promise
}

/**
 * Starts downloading a chunk in the background and swallows any failure.
 *
 * Called while the studio is idle, so the bytes are usually already in the HTTP
 * cache by the time a render needs them. If it fails here nothing is lost - the
 * render path retries with real error reporting.
 */
export function prefetchChunk<T>(loader: () => Promise<T>, label: string): void {
	if (typeof window === 'undefined') return
	if (inFlight.has(label)) return

	const start = () => {
		void loadChunk(loader, { label, attempts: 2 }).catch(() => undefined)
	}

	const idle = (window as unknown as {
		requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number
	}).requestIdleCallback

	if (idle) idle(start, { timeout: 4000 })
	else window.setTimeout(start, 1200)
}

/** True once the chunk has been requested in this tab (resolved or in flight). */
export function chunkRequested(label: string): boolean {
	return inFlight.has(label)
}

export const WEB_RENDERER_CHUNK = 'video encoder'

/** The single import site for Remotion's web renderer, shared by every caller. */
export function loadWebRenderer(options?: Omit<LoadChunkOptions, 'label'>) {
	return loadChunk(() => import('@remotion/web-renderer'), {
		label: WEB_RENDERER_CHUNK,
		...options,
	})
}

export function prefetchWebRenderer(): void {
	prefetchChunk(() => import('@remotion/web-renderer'), WEB_RENDERER_CHUNK)
}
