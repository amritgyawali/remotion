export function formatBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
	const units = ['B', 'KB', 'MB', 'GB']
	const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
	const value = bytes / 1024 ** exponent
	return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`
}

export function formatSeconds(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds < 0) return '--'
	if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`
	const minutes = Math.floor(seconds / 60)
	const rest = Math.round(seconds % 60)
	return `${minutes}m ${String(rest).padStart(2, '0')}s`
}

export function formatDuration(frames: number, fps: number): string {
	return formatSeconds(frames / fps)
}

export function classNames(...values: Array<string | false | null | undefined>): string {
	return values.filter(Boolean).join(' ')
}

export function aspectLabel(width: number, height: number): string {
	const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))
	const divisor = gcd(width, height) || 1
	const w = width / divisor
	const h = height / divisor
	if (w > 40 || h > 40) return `${(width / height).toFixed(2)}:1`
	return `${w}:${h}`
}

export function downloadBlobUrl(url: string, fileName: string): void {
	const anchor = document.createElement('a')
	anchor.href = url
	anchor.download = fileName
	document.body.appendChild(anchor)
	anchor.click()
	anchor.remove()
}

export function safeFileName(input: string): string {
	return (
		input
			.replace(/[^a-z0-9-_]+/gi, '-')
			.replace(/-+/g, '-')
			.replace(/^-|-$/g, '')
			.toLowerCase() || 'remotion-video'
	)
}
