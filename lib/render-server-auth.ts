import { timingSafeEqual } from 'node:crypto'

const JOB_ID_PATTERN = /^[A-Za-z0-9_-]{1,200}$/

export function getRenderAccessKey(): string {
	return process.env.RENDER_ACCESS_KEY?.trim() ?? ''
}

export function hasRenderAccess(request: Request): boolean {
	const expected = getRenderAccessKey()
	const received = request.headers.get('x-render-key') ?? ''
	const expectedBytes = Buffer.from(expected)
	const receivedBytes = Buffer.from(received)
	if (!expected || expectedBytes.length !== receivedBytes.length) return false
	return timingSafeEqual(expectedBytes, receivedBytes)
}

export function isValidVercelJobId(value: unknown): value is string {
	return typeof value === 'string' && JOB_ID_PATTERN.test(value)
}

export function isStoppedSandboxError(error: unknown): boolean {
	if (typeof error === 'object' && error !== null && 'code' in error) {
		const code = String(error.code)
		if (code === 'sandbox_stopped' || code === 'not_found') return true
	}
	if (!(error instanceof Error)) return false
	return /sandbox_stopped|not found|has stopped|no longer available|expired/i.test(error.message)
}
