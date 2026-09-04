/**
 * Runs before every page request.
 *
 * Next 16 renamed this file convention from `middleware` to `proxy`; the job is
 * the same. All it does here is keep the Supabase session fresh so a Server
 * Component never reads an expired token - see utils/supabase/middleware.ts.
 */

import type { NextRequest } from 'next/server'
import { updateSession } from './utils/supabase/middleware'

export default async function proxy(request: NextRequest) {
	return updateSession(request)
}

export const config = {
	matcher: [
		/*
		 * Everything except the paths that can never carry a session: Next's own
		 * static output, the image optimiser, the favicon, and any plain asset
		 * request. Cloud routes under /api are excluded too - they resolve the
		 * caller themselves and must not pay for a token refresh per upload.
		 */
		'/((?!api|_next/static|_next/image|favicon.ico|mediapipe|models|samples|assets|.*\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?|glb|wasm|mp4|webm)$).*)',
	],
}
