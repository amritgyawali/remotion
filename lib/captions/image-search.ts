/**
 * Finding a real picture of the thing the speaker just said, on the open web.
 *
 * The studio's own art pack is a few dozen shapes. A transcript is about
 * whatever it is about - a monastery, a mango, a motherboard - and no hand-made
 * pack covers that, so the one-press flow needs somewhere to get an actual
 * photograph or cut-out of the word it picked.
 *
 * The search is a **ladder**, and it climbs only as far as it has to. Each rung
 * is asked for candidates; if that rung produces enough good ones the ladder
 * stops there, and the rungs below it are never queried. That ordering is the
 * whole design:
 *
 *   1. **Free and openly licensed, no key needed.** Wikimedia Commons
 *      restricted to PNGs, and Openverse restricted to PNGs cleared for
 *      commercial reuse. A PNG from either is very often already a cut-out, and
 *      neither ever watermarks. This rung answers for most ordinary nouns, and
 *      it is the only rung that is always available.
 *
 *   2. **The whole web, when a key is configured.** Google Programmable
 *      Search (`fileType=png`, `imgColorType=trans`), Bing
 *      (`imageType=Transparent`), Pixabay (`colors=transparent`) and SerpAPI
 *      (`tbs=ic:trans`) all support "transparent PNG only" natively, so this
 *      rung asks for exactly the thing the feature needs rather than filtering
 *      afterwards. Every one of them is optional: no key, no rung, no error.
 *
 *   3. **Photographs, when nothing transparent exists.** Openverse and Commons
 *      again with the format filter dropped, plus Pexels and Unsplash when
 *      keyed. These are JPEGs. The browser tries to cut the background out of
 *      them and uses them as they are if it cannot, which is the honest
 *      last resort for a word like "monsoon" that no cut-out exists for.
 *
 *      This rung is also reachable on its own: a request carrying
 *      `mode: 'photo'` starts here and skips the two below it. That is the
 *      second sweep the browser makes for the handful of words whose every
 *      candidate turned out to be a rectangle - those words have already been
 *      proven to have no cut-out on the rungs below, so asking them again would
 *      spend the same seconds for the same nothing.
 *
 *   4. **An icon.** Always transparent, always exists for an ordinary noun,
 *      and never what anybody actually wanted - so it is the floor, appended
 *      once, and only ever used if everything above it failed.
 *
 * **Watermarks.** Rungs 1 and 3's own sources never watermark. Rung 2 can
 * reach anything on the web, so the stock agencies and the "free PNG" farms
 * that stamp their logo onto every download are refused by host, and a title
 * that advertises itself as a preview or a sample is refused by name. That is
 * a filter on provenance, not a claim to detect a watermark in the pixels -
 * the honest version of this is to not go to those places at all.
 *
 * Nothing here decides which candidate is *used*. This module returns a ranked
 * list; `/api/captions/images` hands it to the browser, and the browser
 * downloads them in order and measures the alpha it actually got, because
 * whether a file is a cut-out is a fact about its pixels and no amount of
 * reading a title tells you.
 *
 * There is no HTTP anywhere in here: this is a library the route calls, not a
 * route. That split is what lets the offline checks in
 * `scripts/check-caption-objects.cjs` exercise the provenance rules, the
 * ranking and the provider list directly - and it is required as well as
 * convenient, because Next refuses a route file that exports anything but its
 * handlers and its config.
 */

/** The most words one search will accept, and the most candidates per word. */
export const MAX_QUERIES = 24
export const MAX_PER_QUERY = 8
/** How long one rung of the ladder gets before the next one is tried. */
const RUNG_TIMEOUT_MS = 9_000
/** The whole ladder for one word, however many rungs it climbs. */
const QUERY_BUDGET_MS = 22_000

const COMMONS_ENDPOINT = 'https://commons.wikimedia.org/w/api.php'
const OPENVERSE_ENDPOINT = 'https://api.openverse.org/v1/images/'
const ICONIFY_SEARCH = 'https://api.iconify.design/search'
const ICONIFY_FILE = 'https://api.iconify.design'
const GOOGLE_CSE_ENDPOINT = 'https://www.googleapis.com/customsearch/v1'
const BING_ENDPOINT = 'https://api.bing.microsoft.com/v7.0/images/search'
const PIXABAY_ENDPOINT = 'https://pixabay.com/api/'
const PEXELS_ENDPOINT = 'https://api.pexels.com/v1/search'
const UNSPLASH_ENDPOINT = 'https://api.unsplash.com/search/photos'
const SERPAPI_ENDPOINT = 'https://serpapi.com/search.json'

const USER_AGENT = 'RemotionVideoStudio/1.0 (subtitle object layer; +https://github.com/amritgyawali/remotion)'

export type ImageSource =
	| 'commons'
	| 'openverse'
	| 'google'
	| 'bing'
	| 'pixabay'
	| 'serpapi'
	| 'pexels'
	| 'unsplash'
	| 'iconify'

/** Which rung of the ladder a candidate came from. */
export type ImageTier = 'open' | 'web' | 'photo' | 'icon'

export type ImageCandidate = {
	id: string
	title: string
	/** the address the browser downloads through this route's GET half */
	url: string
	width: number | null
	height: number | null
	mime: string
	source: ImageSource
	tier: ImageTier
	/** shown under the shot, so a reused picture carries its credit */
	credit: string
	pageUrl: string | null
	/**
	 * How likely this file is already a cut-out on transparency, 0-1.
	 *
	 * A guess from the title, the source and the format, used only for
	 * ordering. The browser measures the truth after it downloads.
	 */
	alphaHint: number
}

export type QueryResult = {
	query: string
	candidates: ImageCandidate[]
	/** how far up the ladder this word had to go */
	tiers: ImageTier[]
}

/**
 * How much of the ladder to climb.
 *
 * `cutout` is the ordinary request and starts at the bottom. `photo` is the
 * last sweep, sent only for the words the first pass could not illustrate: it
 * skips straight to the photograph rung, because those words have already been
 * proven to have no cut-out anywhere the rungs below reach, and re-asking the
 * same three providers the same question would cost the same seconds for the
 * same nothing.
 */
export type SearchMode = 'cutout' | 'photo'

/* -------------------------------------------------------------------------- */
/*  Provenance                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Hosts that stamp their own logo across the picture, or sell the clean one.
 *
 * A watermark is not something to detect after the fact - it is something to
 * not go and fetch. Everything here either watermarks its previews (the stock
 * agencies) or re-hosts other people's work under a logo (the "free PNG"
 * farms), and no picture from any of them belongs behind a speaker's head.
 */
export const WATERMARK_HOSTS = [
	'shutterstock',
	'alamy',
	'dreamstime',
	'istockphoto',
	'gettyimages',
	'123rf',
	'depositphotos',
	'stock.adobe',
	'adobestock',
	'fotolia',
	'bigstockphoto',
	'canstockphoto',
	'agefotostock',
	'zoonar',
	'imago-images',
	'picfair',
	'stockfresh',
	'vectorstock',
	'freepik',
	'vecteezy',
	'pngitem',
	'kindpng',
	'pngkey',
	'seekpng',
	'nicepng',
	'pinclipart',
	'clipartmax',
	'jing.fm',
	'toppng',
	'pngfind',
	'pngjoy',
	'pngix',
	'sub.pngsource',
]

/** Words in a title that say "this is the watermarked one". */
const PREVIEW_WORDS = ['watermark', 'watermarked', 'preview image', 'comp image', 'sample image', 'for sale']

function hostOf(url: string): string {
	try {
		return new URL(url).hostname.toLowerCase()
	} catch {
		return ''
	}
}

/** True when this candidate is from somewhere that stamps its pictures. */
export function looksWatermarked(candidate: { url: string; pageUrl: string | null; title: string }): boolean {
	const haystacks = [hostOf(candidate.url), hostOf(candidate.pageUrl ?? '')]
	if (haystacks.some((host) => WATERMARK_HOSTS.some((bad) => host.includes(bad)))) return true
	const title = candidate.title.toLowerCase()
	return PREVIEW_WORDS.some((word) => title.includes(word))
}

/* -------------------------------------------------------------------------- */
/*  Ranking                                                                   */
/* -------------------------------------------------------------------------- */

/** Words in a file name that almost always mean a cut-out on transparency. */
const CUTOUT_WORDS = [
	'transparent',
	'cutout',
	'cut out',
	'icon',
	'logo',
	'silhouette',
	'clipart',
	'clip art',
	'symbol',
	'sticker',
	'emblem',
	'noun project',
	'(psf)',
	'isolated',
	'no background',
]

/** Words that mean the opposite: a page of text, a chart, a screenshot. */
const FLAT_WORDS = [
	'screenshot',
	'diagram',
	'map of',
	'plan of',
	'chart',
	'graph',
	'scan',
	'page',
	'document',
	'poster',
	'timeline',
]

function alphaHintFor(title: string, source: ImageSource, mime: string, asked: boolean): number {
	if (source === 'iconify') return 1
	// A provider that was *asked* for transparency only returns transparency, so
	// its answer is worth more than any guess made from a file name.
	if (asked) return 0.95
	if (!mime.includes('png') && !mime.includes('svg')) return 0.05
	const lower = title.toLowerCase()
	let hint = source === 'commons' ? 0.4 : 0.3
	if (CUTOUT_WORDS.some((word) => lower.includes(word))) hint += 0.45
	if (FLAT_WORDS.some((word) => lower.includes(word))) hint -= 0.3
	return Math.max(0, Math.min(1, hint))
}

/**
 * Orders the candidates for one word.
 *
 * Transparency first, because a picture that has to have its background
 * guessed at is a worse object than one that arrived cut out. Then a bias
 * towards squarish, sensibly sized files: a 6000px panorama of a mountain
 * range and a 40px favicon are both wrong behind a head, for opposite reasons.
 */
function scoreCandidate(candidate: ImageCandidate): number {
	const width = candidate.width ?? 800
	const height = candidate.height ?? 800
	const aspect = width > 0 && height > 0 ? width / height : 1
	const squareness = 1 / (1 + Math.abs(Math.log(aspect)))
	const size = Math.min(width, height)
	// 400-2400 px on the short side is the band a sprite is drawn from without
	// either softening or wasting a decode.
	const sizeFit = size < 200 ? 0.3 : size > 4000 ? 0.5 : 1
	return candidate.alphaHint * 2.2 + squareness * 0.8 + sizeFit * 0.6
}

/* -------------------------------------------------------------------------- */
/*  Talking to the providers                                                  */
/* -------------------------------------------------------------------------- */

async function readJson(
	url: string,
	signal: AbortSignal,
	headers: Record<string, string> = {},
): Promise<unknown | null> {
	try {
		const response = await fetch(url, {
			headers: { accept: 'application/json', 'user-agent': USER_AGENT, ...headers },
			signal,
			cache: 'no-store',
		})
		if (!response.ok) return null
		return (await response.json()) as unknown
	} catch {
		return null
	}
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
	typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null

const asString = (value: unknown): string => (typeof value === 'string' ? value : '')
const asNumber = (value: unknown): number | null =>
	typeof value === 'number' && Number.isFinite(value) ? value : null

const env = (name: string): string => process.env[name]?.trim() ?? ''

/**
 * Commons, PNG only unless the ladder has come back for photographs.
 *
 * `iiurlwidth` is asked for so what comes back is a thumbnail rather than the
 * original: a Commons PNG can be sixty megabytes, and the sprite is drawn at a
 * few hundred pixels. The thumbnailer keeps the alpha channel, so the cut-out
 * survives the shrink.
 */
async function searchCommons(
	query: string,
	limit: number,
	signal: AbortSignal,
	options: { pngOnly: boolean },
): Promise<ImageCandidate[]> {
	const params = new URLSearchParams({
		action: 'query',
		format: 'json',
		formatversion: '2',
		origin: '*',
		generator: 'search',
		gsrsearch: options.pngOnly ? `${query} filemime:image/png` : `${query} filetype:bitmap`,
		gsrnamespace: '6',
		gsrlimit: String(Math.min(20, limit * 3)),
		prop: 'imageinfo',
		iiprop: 'url|size|mime|extmetadata',
		iiurlwidth: '800',
	})
	const payload = asRecord(await readJson(`${COMMONS_ENDPOINT}?${params.toString()}`, signal))
	const pages = asRecord(payload?.query)?.pages
	if (!Array.isArray(pages)) return []

	return pages.flatMap((raw): ImageCandidate[] => {
		const page = asRecord(raw)
		const info = asRecord(Array.isArray(page?.imageinfo) ? page?.imageinfo[0] : null)
		if (!page || !info) return []
		const url = asString(info.thumburl) || asString(info.url)
		if (!url) return []
		const title = asString(page.title).replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, '')
		const licence = asString(asRecord(asRecord(info.extmetadata)?.LicenseShortName)?.value) || 'see Commons'
		const artist = asString(asRecord(asRecord(info.extmetadata)?.Artist)?.value).replace(/<[^>]*>/g, '').trim()
		const mime = asString(info.mime) || (options.pngOnly ? 'image/png' : 'image/jpeg')
		return [
			{
				id: `commons:${asString(page.pageid) || title}`,
				title,
				url,
				width: asNumber(info.thumbwidth) ?? asNumber(info.width),
				height: asNumber(info.thumbheight) ?? asNumber(info.height),
				mime,
				source: 'commons',
				tier: options.pngOnly ? 'open' : 'photo',
				credit: `${title} · ${artist || 'Wikimedia Commons'} · ${licence}`,
				pageUrl: asString(info.descriptionurl) || null,
				alphaHint: alphaHintFor(title, 'commons', mime, false),
			},
		]
	})
}

/** Openverse: PNGs cleared for reuse, or any format once the ladder gives up on alpha. */
async function searchOpenverse(
	query: string,
	limit: number,
	signal: AbortSignal,
	options: { pngOnly: boolean },
): Promise<ImageCandidate[]> {
	const params = new URLSearchParams({
		q: query,
		license_type: 'commercial,modification',
		page_size: String(Math.min(20, limit * 2)),
		mature: 'false',
	})
	if (options.pngOnly) params.set('extension', 'png')
	const payload = asRecord(await readJson(`${OPENVERSE_ENDPOINT}?${params.toString()}`, signal))
	const results = payload?.results
	if (!Array.isArray(results)) return []

	return results.flatMap((raw): ImageCandidate[] => {
		const item = asRecord(raw)
		const url = asString(item?.url)
		if (!item || !url) return []
		const title = asString(item.title) || query
		const mime = options.pngOnly ? 'image/png' : `image/${asString(item.filetype) || 'jpeg'}`
		return [
			{
				id: `openverse:${asString(item.id) || url}`,
				title,
				url,
				width: asNumber(item.width),
				height: asNumber(item.height),
				mime,
				source: 'openverse',
				tier: options.pngOnly ? 'open' : 'photo',
				credit: `${title} · ${asString(item.creator) || 'unknown'} · ${
					asString(item.license).toUpperCase() || 'open licence'
				}`,
				pageUrl: asString(item.foreign_landing_url) || null,
				alphaHint: alphaHintFor(title, 'openverse', mime, false),
			},
		]
	})
}

/**
 * Google Programmable Search, asked for transparent PNGs specifically.
 *
 * `imgColorType=trans` is Google's own "transparent background" filter - the
 * same one behind the "Transparent" chip in image search - so this does not
 * fetch the whole web and hope. Needs GOOGLE_CSE_KEY and GOOGLE_CSE_CX; the
 * search engine behind the cx has to have image search and the whole web
 * turned on.
 */
async function searchGoogle(query: string, limit: number, signal: AbortSignal): Promise<ImageCandidate[]> {
	const key = env('GOOGLE_CSE_KEY')
	const cx = env('GOOGLE_CSE_CX')
	if (!key || !cx) return []

	const params = new URLSearchParams({
		key,
		cx,
		q: `${query} transparent background`,
		searchType: 'image',
		fileType: 'png',
		imgColorType: 'trans',
		safe: 'active',
		num: String(Math.min(10, Math.max(3, limit * 2))),
	})
	const payload = asRecord(await readJson(`${GOOGLE_CSE_ENDPOINT}?${params.toString()}`, signal))
	const items = payload?.items
	if (!Array.isArray(items)) return []

	return items.flatMap((raw): ImageCandidate[] => {
		const item = asRecord(raw)
		const url = asString(item?.link)
		if (!item || !url) return []
		const image = asRecord(item.image)
		const title = asString(item.title) || query
		return [
			{
				id: `google:${url}`,
				title,
				url,
				width: asNumber(image?.width),
				height: asNumber(image?.height),
				mime: asString(item.mime) || 'image/png',
				source: 'google',
				tier: 'web',
				credit: `${title} · via Google image search · check the licence before publishing`,
				pageUrl: asString(image?.contextLink) || null,
				alphaHint: alphaHintFor(title, 'google', 'image/png', true),
			},
		]
	})
}

/** Bing, with its own native "Transparent" image type. Needs BING_IMAGE_KEY. */
async function searchBing(query: string, limit: number, signal: AbortSignal): Promise<ImageCandidate[]> {
	const key = env('BING_IMAGE_KEY')
	if (!key) return []

	const params = new URLSearchParams({
		q: query,
		imageType: 'Transparent',
		safeSearch: 'Strict',
		count: String(Math.min(20, Math.max(5, limit * 3))),
	})
	const payload = asRecord(
		await readJson(`${BING_ENDPOINT}?${params.toString()}`, signal, { 'Ocp-Apim-Subscription-Key': key }),
	)
	const values = payload?.value
	if (!Array.isArray(values)) return []

	return values.flatMap((raw): ImageCandidate[] => {
		const item = asRecord(raw)
		const url = asString(item?.contentUrl)
		if (!item || !url) return []
		const title = asString(item.name) || query
		return [
			{
				id: `bing:${url}`,
				title,
				url,
				width: asNumber(item.width),
				height: asNumber(item.height),
				mime: `image/${(asString(item.encodingFormat) || 'png').toLowerCase()}`,
				source: 'bing',
				tier: 'web',
				credit: `${title} · via Bing image search · check the licence before publishing`,
				pageUrl: asString(item.hostPageUrl) || null,
				alphaHint: alphaHintFor(title, 'bing', 'image/png', true),
			},
		]
	})
}

/**
 * Pixabay, filtered to images that actually carry an alpha channel.
 *
 * `colors=transparent` is a real filter on their side, and everything on
 * Pixabay is licensed for reuse without attribution, so this is the best of
 * the keyed rungs when it has an answer. Needs PIXABAY_API_KEY.
 */
async function searchPixabay(query: string, limit: number, signal: AbortSignal): Promise<ImageCandidate[]> {
	const key = env('PIXABAY_API_KEY')
	if (!key) return []

	const params = new URLSearchParams({
		key,
		q: query,
		image_type: 'all',
		colors: 'transparent',
		safesearch: 'true',
		per_page: String(Math.min(20, Math.max(3, limit * 3))),
	})
	const payload = asRecord(await readJson(`${PIXABAY_ENDPOINT}?${params.toString()}`, signal))
	const hits = payload?.hits
	if (!Array.isArray(hits)) return []

	return hits.flatMap((raw): ImageCandidate[] => {
		const item = asRecord(raw)
		const url = asString(item?.largeImageURL) || asString(item?.webformatURL)
		if (!item || !url) return []
		const title = asString(item.tags) || query
		return [
			{
				id: `pixabay:${asString(item.id) || url}`,
				title,
				url,
				width: asNumber(item.imageWidth),
				height: asNumber(item.imageHeight),
				mime: url.endsWith('.png') ? 'image/png' : 'image/jpeg',
				source: 'pixabay',
				tier: 'web',
				credit: `${title} · ${asString(item.user) || 'Pixabay'} · Pixabay licence`,
				pageUrl: asString(item.pageURL) || null,
				alphaHint: alphaHintFor(title, 'pixabay', 'image/png', true),
			},
		]
	})
}

/** SerpAPI's view of Google Images, with the transparent filter. Needs SERPAPI_KEY. */
async function searchSerpApi(query: string, limit: number, signal: AbortSignal): Promise<ImageCandidate[]> {
	const key = env('SERPAPI_KEY')
	if (!key) return []

	const params = new URLSearchParams({
		engine: 'google_images',
		q: `${query} transparent png`,
		tbs: 'ic:trans',
		safe: 'active',
		num: String(Math.min(20, Math.max(5, limit * 3))),
		api_key: key,
	})
	const payload = asRecord(await readJson(`${SERPAPI_ENDPOINT}?${params.toString()}`, signal))
	const results = payload?.images_results
	if (!Array.isArray(results)) return []

	return results.flatMap((raw): ImageCandidate[] => {
		const item = asRecord(raw)
		const url = asString(item?.original)
		if (!item || !url) return []
		const title = asString(item.title) || query
		return [
			{
				id: `serpapi:${url}`,
				title,
				url,
				width: asNumber(item.original_width),
				height: asNumber(item.original_height),
				mime: url.toLowerCase().includes('.png') ? 'image/png' : 'image/jpeg',
				source: 'serpapi',
				tier: 'web',
				credit: `${title} · ${asString(item.source) || 'via Google Images'} · check the licence before publishing`,
				pageUrl: asString(item.link) || null,
				alphaHint: alphaHintFor(title, 'serpapi', 'image/png', true),
			},
		]
	})
}

/** Pexels: photographs, no alpha, so only ever the last rung. Needs PEXELS_API_KEY. */
async function searchPexels(query: string, limit: number, signal: AbortSignal): Promise<ImageCandidate[]> {
	const key = env('PEXELS_API_KEY')
	if (!key) return []

	const params = new URLSearchParams({ query, per_page: String(Math.min(15, Math.max(3, limit * 2))) })
	const payload = asRecord(await readJson(`${PEXELS_ENDPOINT}?${params.toString()}`, signal, { Authorization: key }))
	const photos = payload?.photos
	if (!Array.isArray(photos)) return []

	return photos.flatMap((raw): ImageCandidate[] => {
		const item = asRecord(raw)
		const src = asRecord(item?.src)
		const url = asString(src?.large) || asString(src?.medium)
		if (!item || !url) return []
		const title = asString(item.alt) || query
		return [
			{
				id: `pexels:${asString(item.id) || url}`,
				title,
				url,
				width: asNumber(item.width),
				height: asNumber(item.height),
				mime: 'image/jpeg',
				source: 'pexels',
				tier: 'photo',
				credit: `${title} · ${asString(item.photographer) || 'Pexels'} · Pexels licence`,
				pageUrl: asString(item.url) || null,
				alphaHint: 0.05,
			},
		]
	})
}

/** Unsplash: the same, for the same rung. Needs UNSPLASH_ACCESS_KEY. */
async function searchUnsplash(query: string, limit: number, signal: AbortSignal): Promise<ImageCandidate[]> {
	const key = env('UNSPLASH_ACCESS_KEY')
	if (!key) return []

	const params = new URLSearchParams({ query, per_page: String(Math.min(15, Math.max(3, limit * 2))) })
	const payload = asRecord(
		await readJson(`${UNSPLASH_ENDPOINT}?${params.toString()}`, signal, { Authorization: `Client-ID ${key}` }),
	)
	const results = payload?.results
	if (!Array.isArray(results)) return []

	return results.flatMap((raw): ImageCandidate[] => {
		const item = asRecord(raw)
		const urls = asRecord(item?.urls)
		const url = asString(urls?.regular) || asString(urls?.small)
		if (!item || !url) return []
		const title = asString(item.alt_description) || query
		return [
			{
				id: `unsplash:${asString(item.id) || url}`,
				title,
				url,
				width: asNumber(item.width),
				height: asNumber(item.height),
				mime: 'image/jpeg',
				source: 'unsplash',
				tier: 'photo',
				credit: `${title} · ${asString(asRecord(item.user)?.name) || 'Unsplash'} · Unsplash licence`,
				pageUrl: asString(asRecord(item.links)?.html) || null,
				alphaHint: 0.05,
			},
		]
	})
}

/**
 * Iconify, recoloured white.
 *
 * The floor of the whole ladder: an ordinary noun always has an icon, an icon
 * is always transparent, and white reads against the dark half of almost any
 * frame. It is asked for at 512 so the rasteriser has something to work with.
 */
async function searchIconify(query: string, limit: number, signal: AbortSignal): Promise<ImageCandidate[]> {
	const params = new URLSearchParams({ query, limit: String(Math.min(32, Math.max(8, limit * 4))) })
	const payload = asRecord(await readJson(`${ICONIFY_SEARCH}?${params.toString()}`, signal))
	const icons = payload?.icons
	if (!Array.isArray(icons)) return []

	return icons.slice(0, limit).flatMap((raw): ImageCandidate[] => {
		const name = asString(raw)
		const [prefix, icon] = name.split(':')
		if (!prefix || !icon) return []
		return [
			{
				id: `iconify:${name}`,
				title: icon.replace(/-/g, ' '),
				url: `${ICONIFY_FILE}/${prefix}/${icon}.svg?height=512&color=%23ffffff`,
				width: 512,
				height: 512,
				mime: 'image/svg+xml',
				source: 'iconify',
				tier: 'icon',
				credit: `${icon.replace(/-/g, ' ')} · Iconify (${prefix})`,
				pageUrl: `https://icon-sets.iconify.design/${prefix}/${icon}/`,
				alphaHint: 1,
			},
		]
	})
}

/* -------------------------------------------------------------------------- */
/*  The ladder                                                                */
/* -------------------------------------------------------------------------- */

/** The providers that need no key, and are therefore always part of the ladder. */
export const KEYLESS: ImageSource[] = ['commons', 'openverse', 'iconify']

/** Which providers this deployment can actually reach, keyed ones included. */
export function configuredProviders(): ImageSource[] {
	const available: ImageSource[] = [...KEYLESS]
	if (env('GOOGLE_CSE_KEY') && env('GOOGLE_CSE_CX')) available.push('google')
	if (env('BING_IMAGE_KEY')) available.push('bing')
	if (env('PIXABAY_API_KEY')) available.push('pixabay')
	if (env('SERPAPI_KEY')) available.push('serpapi')
	if (env('PEXELS_API_KEY')) available.push('pexels')
	if (env('UNSPLASH_ACCESS_KEY')) available.push('unsplash')
	return available
}

/** Removes duplicates and anything from a host that stamps its pictures. */
function admit(candidates: ImageCandidate[], seen: Set<string>): ImageCandidate[] {
	const kept: ImageCandidate[] = []
	for (const candidate of candidates) {
		if (seen.has(candidate.url)) continue
		if (looksWatermarked(candidate)) continue
		seen.add(candidate.url)
		kept.push(candidate)
	}
	return kept
}

type Rung = { tier: ImageTier; run: (signal: AbortSignal) => Promise<ImageCandidate[]>[] }

/**
 * Climbs the ladder for one word, and stops as soon as it has enough.
 *
 * "Enough" is deliberately generous - the browser will discard candidates that
 * turn out not to be cut-outs, so a rung that produces three plausible answers
 * is worth stopping on, and one that produces one is not.
 */
async function searchOne(
	query: string,
	perQuery: number,
	deadline: number,
	mode: SearchMode = 'cutout',
): Promise<QueryResult> {
	const photoRung: Rung = {
		tier: 'photo',
		run: (signal) => [
			searchOpenverse(query, perQuery, signal, { pngOnly: false }),
			searchCommons(query, perQuery, signal, { pngOnly: false }),
			searchPexels(query, perQuery, signal),
			searchUnsplash(query, perQuery, signal),
		],
	}

	const rungs: Rung[] =
		mode === 'photo'
			? [photoRung]
			: [
					{
						tier: 'open',
						run: (signal) => [
							searchCommons(query, perQuery, signal, { pngOnly: true }),
							searchOpenverse(query, perQuery, signal, { pngOnly: true }),
						],
					},
					{
						tier: 'web',
						run: (signal) => [
							searchPixabay(query, perQuery, signal),
							searchGoogle(query, perQuery, signal),
							searchBing(query, perQuery, signal),
							searchSerpApi(query, perQuery, signal),
						],
					},
					photoRung,
				]

	const seen = new Set<string>()
	const found: ImageCandidate[] = []
	const tiers: ImageTier[] = []

	for (const rung of rungs) {
		if (found.length >= perQuery) break
		if (Date.now() > deadline) break

		const controller = new AbortController()
		const timer = setTimeout(() => controller.abort(), Math.min(RUNG_TIMEOUT_MS, Math.max(1_000, deadline - Date.now())))
		let harvest: ImageCandidate[] = []
		try {
			// Settled rather than all: four providers are asked at once and one of
			// them throwing - a malformed body, a host that hangs up mid-JSON -
			// must cost that provider's answers and nothing else. `Promise.all`
			// here would lose the whole word to one bad response.
			const answers = await Promise.allSettled(rung.run(controller.signal))
			harvest = admit(
				answers.flatMap((answer) => (answer.status === 'fulfilled' ? answer.value : [])),
				seen,
			)
		} finally {
			clearTimeout(timer)
		}

		if (harvest.length > 0) {
			harvest.sort((left, right) => scoreCandidate(right) - scoreCandidate(left))
			found.push(...harvest)
			tiers.push(rung.tier)
		}
	}

	// The icon is fetched only when it might be needed, and always goes last:
	// someone who asks for a mango wants a mango, and gets a pictogram of one
	// only when the web could not supply the real thing. The photograph sweep
	// never asks for one - it is reached only by a word that was already offered
	// an icon on the pass before and could not use it.
	let icon: ImageCandidate | null = null
	if (mode === 'cutout' && found.length < perQuery) {
		const controller = new AbortController()
		const timer = setTimeout(() => controller.abort(), 4_000)
		try {
			icon = (await searchIconify(query, 2, controller.signal))[0] ?? null
		} catch {
			icon = null
		} finally {
			clearTimeout(timer)
		}
	}

	const room = icon ? Math.max(1, perQuery - 1) : perQuery
	const candidates = found.slice(0, room)
	if (icon) {
		candidates.push(icon)
		tiers.push('icon')
	}
	return { query, candidates, tiers }
}

/* -------------------------------------------------------------------------- */
/*  Caching                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The same word, searched again, costs nothing.
 *
 * Two things make this worth having rather than clever: a re-plan of the same
 * clip asks for the same dozen words, and a transcript about mangoes asks for
 * "mango" more than once. Entries are small - a few hundred bytes each - so the
 * cap is about tidiness rather than memory.
 */
const CACHE_TTL_MS = 15 * 60 * 1000
const CACHE_MAX = 300
const cache = new Map<string, { at: number; result: QueryResult }>()

function cacheKey(query: string, perQuery: number, mode: SearchMode): string {
	return `${mode}:${perQuery}:${query.toLowerCase()}`
}

function readCache(key: string): QueryResult | null {
	const entry = cache.get(key)
	if (!entry) return null
	if (Date.now() - entry.at > CACHE_TTL_MS) {
		cache.delete(key)
		return null
	}
	// Re-inserted so the map stays in least-recently-used order.
	cache.delete(key)
	cache.set(key, entry)
	return entry.result
}

function writeCache(key: string, result: QueryResult): void {
	cache.set(key, { at: Date.now(), result })
	while (cache.size > CACHE_MAX) {
		const oldest = cache.keys().next().value
		if (oldest === undefined) break
		cache.delete(oldest)
	}
}


/**
 * Searches for a list of words, in small parallel batches.
 *
 * Three at a time: enough to hide the latency of a slow provider, few enough
 * that Commons does not start refusing the burst. Each word is cached under the
 * mode it was asked in, so a re-plan of the same clip costs nothing and the two
 * sweeps never answer each other's question.
 */
export async function searchImages(
	queries: string[],
	perQuery: number,
	mode: SearchMode,
): Promise<QueryResult[]> {
	const results: QueryResult[] = []
	for (let at = 0; at < queries.length; at += 3) {
		const batch = queries.slice(at, at + 3)
		const found = await Promise.all(
			batch.map(async (query) => {
				const key = cacheKey(query, perQuery, mode)
				const cached = readCache(key)
				if (cached) return cached
				const result = await searchOne(query, perQuery, Date.now() + QUERY_BUDGET_MS, mode)
				if (result.candidates.length > 0) writeCache(key, result)
				return result
			}),
		)
		results.push(...found)
	}
	return results
}

/**
 * The tidy a query gets before it is searched for.
 *
 * Punctuation out, whitespace collapsed, sixty characters. Exported because the
 * browser looks its results up by the tidied spelling and the two must not be
 * able to drift apart.
 */
export function tidyQuery(query: string): string {
	return query
		.replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 60)
}
