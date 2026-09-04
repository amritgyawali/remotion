import 'server-only'

/**
 * Where cloud mode reads its credentials, and what it will admit to the browser.
 *
 * Two rules hold this file together. Secrets are read here and nowhere else, so
 * there is one place to audit. And `publicCloudConfig()` returns the only shape
 * that is ever serialised into a page - a cloud name, some limits, and a pair of
 * booleans - so a refactor cannot leak a key by accident.
 */

export type CloudinaryConfig = {
	cloudName: string
	apiKey: string
	apiSecret: string
	folder: string
}

/**
 * `CLOUDINARY_URL` is the one variable Cloudinary's own dashboard hands out, so
 * it is accepted as a whole and the three separate variables are treated as
 * overrides on top of it. Format: cloudinary://<key>:<secret>@<cloud name>
 */
function fromCloudinaryUrl(): Partial<CloudinaryConfig> {
	const raw = process.env.CLOUDINARY_URL
	if (!raw) return {}
	try {
		const url = new URL(raw)
		if (url.protocol !== 'cloudinary:') return {}
		return {
			apiKey: decodeURIComponent(url.username),
			apiSecret: decodeURIComponent(url.password),
			cloudName: url.hostname,
		}
	} catch {
		return {}
	}
}

let cloudinaryCache: CloudinaryConfig | null | undefined

export function cloudinaryConfig(): CloudinaryConfig | null {
	if (cloudinaryCache !== undefined) return cloudinaryCache

	const parsed = fromCloudinaryUrl()
	const cloudName = process.env.CLOUDINARY_CLOUD_NAME ?? parsed.cloudName ?? ''
	const apiKey = process.env.CLOUDINARY_API_KEY ?? parsed.apiKey ?? ''
	const apiSecret = process.env.CLOUDINARY_API_SECRET ?? parsed.apiSecret ?? ''

	cloudinaryCache =
		cloudName && apiKey && apiSecret
			? {
					cloudName,
					apiKey,
					apiSecret,
					folder: (process.env.CLOUDINARY_FOLDER ?? 'remotion-studio').replace(/^\/+|\/+$/g, ''),
				}
			: null
	return cloudinaryCache
}

export type SupabaseConfig = {
	url: string
	publishableKey: string
	secretKey: string
}

export function supabaseConfig(): SupabaseConfig | null {
	const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
	const publishableKey =
		process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? ''
	const secretKey = process.env.SUPABASE_SECRET_KEY ?? ''
	if (!url || !secretKey) return null
	return { url, publishableKey, secretKey }
}

/** Cloud mode is opt-out, but it can only be on if both halves are configured. */
export function cloudEnabled(): boolean {
	if (process.env.NEXT_PUBLIC_CLOUD_MODE === '0') return false
	return Boolean(cloudinaryConfig()) && Boolean(supabaseConfig())
}

export type PublicCloudConfig = {
	enabled: boolean
	/** the media half: uploads and transformations */
	media: boolean
	/** the record half: saved projects, assets and jobs */
	store: boolean
	cloudName: string
	/** hard per-file ceiling the plan enforces, in bytes */
	maxVideoBytes: number
	maxImageBytes: number
	maxRawBytes: number
}

/**
 * The plan's real limits, asked for once and then remembered.
 *
 * Cloudinary's free tier refuses a video over 100 MB with a 400 and a message
 * nobody reads. Knowing the number up front turns that into a sentence before
 * the upload starts, and the number is per-account so it cannot be hardcoded.
 */
const FALLBACK_LIMITS = {
	video: 100 * 1024 * 1024,
	image: 10 * 1024 * 1024,
	raw: 10 * 1024 * 1024,
}

let limitsCache: { at: number; value: typeof FALLBACK_LIMITS } | null = null
const LIMITS_TTL_MS = 30 * 60 * 1000

export async function mediaLimits(): Promise<typeof FALLBACK_LIMITS> {
	const config = cloudinaryConfig()
	if (!config) return FALLBACK_LIMITS
	if (limitsCache && Date.now() - limitsCache.at < LIMITS_TTL_MS) return limitsCache.value

	try {
		const auth = Buffer.from(`${config.apiKey}:${config.apiSecret}`).toString('base64')
		const response = await fetch(`https://api.cloudinary.com/v1_1/${config.cloudName}/usage`, {
			headers: { authorization: `Basic ${auth}` },
			cache: 'no-store',
			signal: AbortSignal.timeout(8_000),
		})
		if (!response.ok) throw new Error(String(response.status))
		const body = (await response.json()) as {
			media_limits?: {
				video_max_size_bytes?: number
				image_max_size_bytes?: number
				raw_max_size_bytes?: number
			}
		}
		const value = {
			video: body.media_limits?.video_max_size_bytes ?? FALLBACK_LIMITS.video,
			image: body.media_limits?.image_max_size_bytes ?? FALLBACK_LIMITS.image,
			raw: body.media_limits?.raw_max_size_bytes ?? FALLBACK_LIMITS.raw,
		}
		limitsCache = { at: Date.now(), value }
		return value
	} catch {
		// A limits probe that fails must not take cloud mode down with it.
		return limitsCache?.value ?? FALLBACK_LIMITS
	}
}

export async function publicCloudConfig(): Promise<PublicCloudConfig> {
	const media = cloudinaryConfig()
	const store = supabaseConfig()
	const limits = media ? await mediaLimits() : FALLBACK_LIMITS
	return {
		enabled: cloudEnabled(),
		media: Boolean(media),
		store: Boolean(store),
		cloudName: media?.cloudName ?? '',
		maxVideoBytes: limits.video,
		maxImageBytes: limits.image,
		maxRawBytes: limits.raw,
	}
}
