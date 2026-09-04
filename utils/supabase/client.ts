'use client'

/**
 * The browser-side Supabase client.
 *
 * Only the publishable key ever reaches this file - it is the key Supabase
 * designs to ship to clients, and every table it can touch is guarded by row
 * level security. The secret key lives on the server and never crosses over.
 *
 * Returns null rather than throwing when cloud mode is not configured, so a
 * checkout with no `.env.local` still renders every studio in device mode.
 */

import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? ''

let cached: SupabaseClient | null = null

export function supabaseConfigured(): boolean {
	return URL.length > 0 && KEY.length > 0
}

export function createClient(): SupabaseClient | null {
	if (!supabaseConfigured()) return null
	// One client per tab: each instance opens its own auth listener and token
	// refresh timer, and two of them race each other over the same session.
	if (!cached) cached = createBrowserClient(URL, KEY)
	return cached
}
