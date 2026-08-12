/**
 * Tiny POSIX path helpers. The studio never touches the real filesystem in the
 * browser, so we ship our own instead of polyfilling node's `path`.
 */

export function normalizePath(input: string): string {
	const cleaned = input.replace(/\\/g, '/').replace(/^\.\//, '')
	const segments: string[] = []
	for (const segment of cleaned.split('/')) {
		if (segment === '' || segment === '.') continue
		if (segment === '..') {
			segments.pop()
			continue
		}
		segments.push(segment)
	}
	return segments.join('/')
}

export function dirname(filePath: string): string {
	const normalized = normalizePath(filePath)
	const index = normalized.lastIndexOf('/')
	return index === -1 ? '' : normalized.slice(0, index)
}

export function basename(filePath: string): string {
	const normalized = normalizePath(filePath)
	const index = normalized.lastIndexOf('/')
	return index === -1 ? normalized : normalized.slice(index + 1)
}

export function extname(filePath: string): string {
	const name = basename(filePath)
	const index = name.lastIndexOf('.')
	return index <= 0 ? '' : name.slice(index)
}

export function joinPath(base: string, relative: string): string {
	if (relative.startsWith('/')) return normalizePath(relative)
	return normalizePath(`${base ? `${base}/` : ''}${relative}`)
}

/** Strips a shared top-level folder, e.g. `my-project/src/Root.tsx` -> `src/Root.tsx`. */
export function stripCommonRoot(paths: string[]): (path: string) => string {
	if (paths.length === 0) return (p) => p
	const firstSegments = paths.map((p) => p.split('/')[0])
	const allSame = firstSegments.every((segment) => segment === firstSegments[0])
	const hasNesting = paths.every((p) => p.includes('/'))
	if (!allSame || !hasNesting) return (p) => p
	const prefix = `${firstSegments[0]}/`
	return (p) => (p.startsWith(prefix) ? p.slice(prefix.length) : p)
}
