import { hasRenderAccess, isValidVercelJobId } from '../../../../lib/render-server-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const noStore = { 'cache-control': 'no-store' }

export async function GET(request: Request) {
	if (
		!process.env.VERCEL ||
		process.env.ENABLE_SERVER_RENDER !== '1' ||
		!process.env.RENDER_ACCESS_KEY?.trim() ||
		!process.env.BLOB_READ_WRITE_TOKEN
	) {
		return Response.json({ message: 'Vercel Sandbox rendering is unavailable.' }, { status: 503 })
	}
	if (!hasRenderAccess(request)) {
		return Response.json({ message: 'Invalid or missing render key.' }, { status: 401 })
	}

	const { searchParams } = new URL(request.url)
	const sandboxId = searchParams.get('sandboxId')
	const commandId = searchParams.get('commandId')
	if (!isValidVercelJobId(sandboxId) || !isValidVercelJobId(commandId)) {
		return Response.json({ message: 'Invalid render job.' }, { status: 400 })
	}

	try {
		const { getRenderProgress } = await import('@remotion/vercel')
		const progress = await getRenderProgress({ sandboxId, cmdId: commandId })
		return Response.json(progress, { headers: noStore })
	} catch (error) {
		return Response.json(
			{
				stage: 'error',
				overallProgress: 1,
				message: error instanceof Error ? error.message : 'Could not read render progress.',
			},
			{ status: 502, headers: noStore },
		)
	}
}
