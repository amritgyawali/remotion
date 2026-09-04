/**
 * What cloud mode can actually do on this deployment, right now.
 *
 * Every studio asks this once on load and shows or hides its Cloud switch from
 * the answer, so a checkout with no credentials never offers a button that
 * cannot work. It also mints the anonymous device cookie on the way past, which
 * is why it is a route handler and not a Server Component read.
 */

import { publicCloudConfig } from '../../../../lib/cloud/config'
import { resolveIdentity } from '../../../../lib/cloud/owner'
import type { CloudStatus } from '../../../../lib/cloud/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
	const config = await publicCloudConfig()

	// The identity probe touches Supabase Auth; if that is down, cloud media is
	// still worth offering, so a failure degrades to "signed out" not "off".
	let identity: CloudStatus['identity'] = null
	if (config.enabled) {
		try {
			identity = await resolveIdentity()
		} catch {
			identity = null
		}
	}

	const status: CloudStatus = {
		...config,
		identity,
		serverRender: process.env.ENABLE_SERVER_RENDER === '1',
	}

	return Response.json(status, { headers: { 'cache-control': 'no-store' } })
}
