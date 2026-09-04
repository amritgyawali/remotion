import 'server-only'

/**
 * Who owns the rows this request is about.
 *
 * Cloud mode has to be useful before anyone signs up, so ownership has two
 * forms. A signed-in visitor owns `user:<uid>`, checked against Supabase Auth.
 * Everyone else owns `device:<id>`, where the id lives in an httpOnly cookie
 * this file mints and signs with `CLOUD_DEVICE_SECRET`.
 *
 * The signature is what makes the anonymous half safe: the cookie is the only
 * proof of ownership the routes accept, and a forged one fails the HMAC, so a
 * visitor can never read another device's projects by guessing an id. The rows
 * themselves sit behind row level security that grants nothing to anonymous
 * callers - the service key reaches them, and only after this check has run.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'
import { createClient } from '../../utils/supabase/server'
import type { CloudIdentity } from './types'

const COOKIE = 'rvs_device'
const MAX_AGE_SECONDS = 400 * 24 * 60 * 60

/**
 * A missing secret must not silently degrade into unsigned cookies, but it must
 * also not break a dev machine that has not set one. A per-process random
 * fallback does both: it works, and it invalidates on restart, which is loud
 * enough to notice and harmless in development.
 */
const SECRET = process.env.CLOUD_DEVICE_SECRET || randomBytes(32).toString('hex')

function sign(id: string): string {
	return createHmac('sha256', SECRET).update(id).digest('base64url')
}

function verify(token: string): string | null {
	const cut = token.lastIndexOf('.')
	if (cut <= 0) return null
	const id = token.slice(0, cut)
	const signature = token.slice(cut + 1)
	if (!/^[0-9a-f]{32}$/.test(id)) return null

	const expected = Buffer.from(sign(id))
	const given = Buffer.from(signature)
	// Length has to match before timingSafeEqual will look at the bytes at all.
	if (expected.length !== given.length) return null
	return timingSafeEqual(expected, given) ? id : null
}

/**
 * Resolves the caller, minting and setting a device cookie when there is none.
 *
 * Route handlers may write cookies, so the mint lands on this response and the
 * next request already carries it. A Server Component cannot, and there the set
 * is swallowed - which is why nothing that renders on the server depends on the
 * id existing yet.
 */
export async function resolveIdentity(): Promise<CloudIdentity> {
	const supabase = await createClient()
	if (supabase) {
		const { data } = await supabase.auth.getUser()
		if (data.user) {
			return { owner: `user:${data.user.id}`, signedIn: true, email: data.user.email ?? null }
		}
	}

	const jar = await cookies()
	const existing = jar.get(COOKIE)?.value
	const verified = existing ? verify(existing) : null
	if (verified) return { owner: `device:${verified}`, signedIn: false, email: null }

	const id = randomBytes(16).toString('hex')
	try {
		jar.set(COOKIE, `${id}.${sign(id)}`, {
			httpOnly: true,
			sameSite: 'lax',
			secure: process.env.NODE_ENV === 'production',
			path: '/',
			maxAge: MAX_AGE_SECONDS,
		})
	} catch {
		// Read-only cookie store (a Server Component). The caller still gets a
		// usable owner for this request; the next write-capable route persists one.
	}
	return { owner: `device:${id}`, signedIn: false, email: null }
}

/** The `user_id` column, which is null for a device owner. */
export function userIdOf(identity: CloudIdentity): string | null {
	return identity.owner.startsWith('user:') ? identity.owner.slice(5) : null
}
