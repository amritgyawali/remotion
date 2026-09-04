import 'server-only'

/**
 * Supabase clients for anything that runs on the server.
 *
 * Two of them, and the difference matters:
 *
 * - `createClient()` speaks as the signed-in visitor. It carries their session
 *   cookie, so row level security applies and it can only see their own rows.
 * - `createServiceClient()` speaks as the project. It uses the secret key,
 *   bypasses row level security entirely, and is what the cloud routes use
 *   after they have worked out who the caller is themselves. Never hand its
 *   result to a client component.
 */

import { createServerClient } from '@supabase/ssr'
import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

const URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const PUBLISHABLE =
	process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? ''
const SECRET = process.env.SUPABASE_SECRET_KEY ?? ''

export function supabaseConfigured(): boolean {
	return URL.length > 0 && PUBLISHABLE.length > 0
}

export function supabaseServiceConfigured(): boolean {
	return URL.length > 0 && SECRET.length > 0
}

export async function createClient(): Promise<SupabaseClient | null> {
	if (!supabaseConfigured()) return null
	const cookieStore = await cookies()

	return createServerClient(URL, PUBLISHABLE, {
		cookies: {
			getAll() {
				return cookieStore.getAll()
			},
			setAll(cookiesToSet) {
				try {
					for (const { name, value, options } of cookiesToSet) {
						cookieStore.set(name, value, options)
					}
				} catch {
					// Called from a Server Component, where the response headers are
					// already sealed. proxy.ts refreshes the session on every request,
					// so the write this drops has already happened there.
				}
			},
		},
	})
}

let service: SupabaseClient | null = null

export function createServiceClient(): SupabaseClient | null {
	if (!supabaseServiceConfigured()) return null
	if (!service) {
		service = createSupabaseClient(URL, SECRET, {
			auth: { persistSession: false, autoRefreshToken: false },
		})
	}
	return service
}
