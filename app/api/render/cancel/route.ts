import {
	hasRenderAccess,
	isStoppedSandboxError,
	isValidVercelJobId,
} from '../../../../lib/render-server-auth'
import type { Sandbox as VercelSandbox } from '@vercel/sandbox'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

type CancelRequest = {
	sandboxId?: unknown
	commandId?: unknown
}

export async function POST(request: Request) {
	if (
		!process.env.VERCEL ||
		process.env.ENABLE_SERVER_RENDER !== '1' ||
		!process.env.RENDER_ACCESS_KEY?.trim()
	) {
		return Response.json({ message: 'Vercel Sandbox rendering is unavailable.' }, { status: 503 })
	}
	if (!hasRenderAccess(request)) {
		return Response.json({ message: 'Invalid or missing render key.' }, { status: 401 })
	}

	let body: CancelRequest
	try {
		body = (await request.json()) as CancelRequest
	} catch {
		return Response.json({ message: 'Malformed JSON body.' }, { status: 400 })
	}
	if (!isValidVercelJobId(body.sandboxId) || !isValidVercelJobId(body.commandId)) {
		return Response.json({ message: 'Invalid render job.' }, { status: 400 })
	}

	let sandbox: VercelSandbox | null = null
	try {
		const { Sandbox } = await import('@vercel/sandbox')
		sandbox = await Sandbox.get({ sandboxId: body.sandboxId })
		try {
			const command = await sandbox.getCommand(body.commandId)
			if (command.exitCode === null) await command.kill('SIGTERM')
		} catch {
			// Stopping the VM below is the authoritative cancellation and also
			// handles a command that finished between the progress poll and here.
		}
		await sandbox.stop()
		return Response.json(
			{ cancelled: true },
			{ headers: { 'cache-control': 'no-store' } },
		)
	} catch (error) {
		await sandbox?.stop().catch(() => undefined)
		if (isStoppedSandboxError(error)) {
			return Response.json(
				{ cancelled: true, alreadyStopped: true },
				{ headers: { 'cache-control': 'no-store' } },
			)
		}
		return Response.json(
			{ message: error instanceof Error ? error.message : 'Could not stop the render.' },
			{ status: 502, headers: { 'cache-control': 'no-store' } },
		)
	}
}
