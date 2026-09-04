/**
 * Session refresh, run before every page render.
 *
 * Supabase access tokens are short-lived. Without a refresh on the way in, a
 * Server Component can read a session that expired a minute ago and decide the
 * visitor is signed out. This reads the user once - which is what triggers the
 * refresh - and copies the rotated cookies onto the outgoing response.
 *
 * Two rules keep this from breaking in subtle ways: always return the same
 * response object the cookie writes went to, and never put logic between
 * creating the client and reading the user.
 */

import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const KEY =
	process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? ''

export async function updateSession(request: NextRequest): Promise<NextResponse> {
	let response = NextResponse.next({ request })

	if (!URL || !KEY) return response

	const supabase = createServerClient(URL, KEY, {
		cookies: {
			getAll() {
				return request.cookies.getAll()
			},
			setAll(cookiesToSet) {
				for (const { name, value } of cookiesToSet) {
					request.cookies.set(name, value)
				}
				response = NextResponse.next({ request })
				for (const { name, value, options } of cookiesToSet) {
					response.cookies.set(name, value, options)
				}
			},
		},
	})

	// Do not remove: this call is the refresh.
	await supabase.auth.getUser()

	return response
}
