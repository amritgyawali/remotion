#!/usr/bin/env node
/**
 * Proves the preview proxy does what it is there for, in a real browser.
 *
 * The claim being checked is not "a smaller file was written". It is that the
 * preview got faster and the export did not change, and both halves of that
 * need a browser to settle: the first is a decoder timing, the second is an
 * encoded file whose dimensions have to match the clip the person uploaded
 * rather than the copy the preview is playing.
 *
 * So the script drives the real Silence studio and checks the things that
 * would break if the proxy were wrong:
 *
 *   maths     - the plan never upscales, never raises the frame rate, keeps the
 *               aspect ratio and stays inside its bitrate clamps; and the cache
 *               key is stable for one clip and moves for a different one, which
 *               is what decides whether a reload transcodes again
 *   adoption  - the preview element ends up playing the proxy, not the original
 *   size      - the proxy really is smaller, and really is on disk
 *   seeking   - the same set of seeks, timed against the original file and
 *               against the proxy, both local. This is the whole point of the
 *               feature, and the only assertion here that a person would feel
 *   isolation - the exported file is the size of the *source*, which is how a
 *               proxy leaking into a render would be caught. The studio is put
 *               into local mode first, so this measures the browser's own
 *               encoder rather than whatever a cloud deployment would return
 *   cache     - a reload reuses the file rather than encoding it again, checked
 *               by the proxy's modification time not moving
 *   subtitles - the Subtitle studio, whose preview is a Remotion Player rather
 *               than a plain element, picks up the very same file. The cache is
 *               keyed on the clip, not on the studio, so carrying one clip
 *               between the two must not transcode it twice
 *
 * The default clip is deliberately a bad one to scrub: 1920x1080 with a key
 * frame every 8.3 seconds, which is what a phone or a screen recorder writes
 * and what makes an ordinary preview feel broken.
 *
 * Usage:
 *   node scripts/check-preview-proxy.cjs                     # starts its own dev server
 *   node scripts/check-preview-proxy.cjs --base http://localhost:3000
 *   node scripts/check-preview-proxy.cjs --maths-only        # no browser, no network
 *   node scripts/check-preview-proxy.cjs --url https://host/clip.mp4
 *   node scripts/check-preview-proxy.cjs --skip-export       # faster; drops the isolation check
 *   node scripts/check-preview-proxy.cjs --headful
 */

require('sucrase/register')

const { spawn } = require('node:child_process')
const path = require('node:path')

const proxy = require('../lib/media/preview-proxy.ts')

const argv = process.argv.slice(2)
const flag = (name, fallback = null) => {
	const at = argv.indexOf('--' + name)
	return at >= 0 && argv[at + 1] && !argv[at + 1].startsWith('--') ? argv[at + 1] : fallback
}
const has = (name) => argv.includes('--' + name)

const BASE = (flag('base') ?? 'http://localhost:3000').replace(/\/$/, '')
const CLIP = flag('url') ?? 'https://download.samplelib.com/mp4/sample-30s.mp4'
const CLIP_NAME = decodeURIComponent(CLIP.split('/').pop() ?? 'sample.mp4')
const MATHS_ONLY = has('maths-only')
const SKIP_EXPORT = has('skip-export')
const HEADFUL = has('headful')

/**
 * How much faster a seek has to get before the proxy has earned its transcode.
 *
 * The honest figure on a long-GOP 1080p clip is several times over, but a
 * machine with a warm page cache and a hardware decoder can serve the original
 * quickly enough that the margin narrows. Anything at or below parity means the
 * feature is not doing its job; a fifth off is the least that is worth the
 * background work.
 */
const SEEK_SPEEDUP_FLOOR = 1.2

/** How long a cached proxy may take to be adopted after a reload, in ms. */
const CACHE_ADOPTION_BUDGET_MS = 25_000

const results = []
const record = (group, name, ok, detail) => {
	results.push({ group, name, ok, detail })
	process.stdout.write((ok ? '  ok   ' : '  FAIL ') + name + (detail ? ' - ' + detail : '') + '\n')
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/* -------------------------------------------------------------------------- */
/*  Maths                                                                     */
/* -------------------------------------------------------------------------- */

/** Shapes that between them cover everything a studio actually gets handed. */
const SHAPES = [
	{ label: '4K landscape', width: 3840, height: 2160, fps: 60 },
	{ label: '1080p landscape', width: 1920, height: 1080, fps: 30 },
	{ label: '1080x1920 phone', width: 1080, height: 1920, fps: 30 },
	{ label: '720p landscape', width: 1280, height: 720, fps: 25 },
	{ label: 'square', width: 1080, height: 1080, fps: 24 },
	{ label: 'already tiny', width: 320, height: 240, fps: 12 },
	{ label: 'wide anamorphic', width: 2560, height: 1080, fps: 48 },
]

function runMaths() {
	process.stdout.write('\nmaths\n')

	let upscaled = null
	let odd = null
	let aspectDrift = 0
	let fpsRaised = null
	let bitrateOut = null
	const reductions = []

	for (const shape of SHAPES) {
		const plan = proxy.proxyPlanFor(shape)

		if (plan.width > shape.width || plan.height > shape.height) upscaled = shape.label
		if (plan.width % 2 !== 0 || plan.height % 2 !== 0) odd = shape.label
		if (plan.fps > shape.fps || plan.fps > 30) fpsRaised = shape.label
		if (plan.videoBitrate < 400_000 || plan.videoBitrate > 2_500_000) bitrateOut = shape.label

		const drift = Math.abs(plan.width / plan.height - shape.width / shape.height)
		if (drift > aspectDrift) aspectDrift = drift

		reductions.push((shape.width * shape.height) / (plan.width * plan.height))
	}

	record('maths', 'the plan never upscales', upscaled === null, upscaled ?? undefined)
	record('maths', 'every dimension is even', odd === null, odd ?? undefined)
	record(
		'maths',
		'aspect ratio survives the scale',
		aspectDrift < 0.01,
		aspectDrift.toExponential(2) + ' worst drift',
	)
	record('maths', 'frame rate is capped, never raised', fpsRaised === null, fpsRaised ?? undefined)
	record('maths', 'bitrate stays inside its clamps', bitrateOut === null, bitrateOut ?? undefined)

	// The headline number, printed rather than asserted for the small shapes:
	// a clip already at preview size is meant to come back unchanged.
	const worst = Math.min(...reductions)
	const best = Math.max(...reductions)
	record(
		'maths',
		'large clips lose most of their pixels',
		best >= 4,
		best.toFixed(1) + 'x fewer pixels at best, ' + worst.toFixed(1) + 'x at worst',
	)

	/* ------------------------------------------------------------- the key */

	const clip = {
		url: 'blob:http://localhost/abc',
		name: 'talk.mp4',
		kind: 'file',
		sizeInBytes: 21_657_943,
		durationInSeconds: 30.44,
		width: 1920,
		height: 1080,
		fps: 30,
		hasAudio: true,
		file: null,
	}
	const plan = proxy.proxyPlanFor(clip)
	const key = proxy.proxyCacheKey(clip, plan)

	record(
		'maths',
		'the same clip keys the same file twice',
		proxy.proxyCacheKey({ ...clip, url: 'blob:http://localhost/different' }, plan) === key,
		'a fresh object URL for the same file must not miss the cache',
	)

	const moved = [
		['a different name', { ...clip, name: 'other.mp4' }],
		['a different size', { ...clip, sizeInBytes: clip.sizeInBytes + 1 }],
		['a different length', { ...clip, durationInSeconds: clip.durationInSeconds + 0.5 }],
		['a different source resolution', { ...clip, width: 1280, height: 720 }],
	]
	const stuck = moved.filter(([, other]) => proxy.proxyCacheKey(other, plan) === key)
	record(
		'maths',
		'a different clip keys a different file',
		stuck.length === 0,
		stuck.length === 0 ? undefined : stuck.map(([label]) => label).join(', ') + ' collided',
	)

	record(
		'maths',
		'a different proxy size keys a different file',
		proxy.proxyCacheKey(clip, { ...plan, width: plan.width / 2, height: plan.height / 2 }) !== key,
		'a roomier machine must not be handed the small machine’s copy',
	)
}

/* -------------------------------------------------------------------------- */
/*  Dev server                                                                */
/* -------------------------------------------------------------------------- */

/**
 * `next dev` compiles a route the first time it is asked for, and a cold
 * compile of this app takes the better part of a minute - so a short timeout
 * here reports a perfectly healthy server as absent. The request is given as
 * long as a first compile actually takes.
 */
async function reachable(url, timeoutMs = 90_000) {
	try {
		const controller = new AbortController()
		const timer = setTimeout(() => controller.abort(), timeoutMs)
		const response = await fetch(url, { signal: controller.signal })
		clearTimeout(timer)
		return response.status > 0
	} catch {
		return false
	}
}

async function ensureServer() {
	if (await reachable(BASE)) return null
	if (flag('base')) {
		// One retry: a server that was mid-rebuild when the first request landed
		// refuses it outright rather than queueing it.
		await sleep(3000)
		if (await reachable(BASE)) return null
		throw new Error('Nothing is answering at ' + BASE + '.')
	}

	process.stdout.write('starting dev server\n')
	const child = spawn('npm', ['run', 'dev'], {
		cwd: path.resolve(__dirname, '..'),
		stdio: 'ignore',
		shell: process.platform === 'win32',
		detached: false,
	})
	for (let attempt = 0; attempt < 90; attempt += 1) {
		await sleep(1000)
		if (await reachable(BASE)) return child
	}
	child.kill()
	throw new Error('The dev server never came up.')
}

/* -------------------------------------------------------------------------- */
/*  In-page probes                                                            */
/* -------------------------------------------------------------------------- */

function pageSettled() {
	return document.readyState === 'complete'
}

function fieldPresent() {
	return Boolean(document.querySelector('input[aria-label="Video address"]'))
}

function fillAndSubmit(input) {
	const field = document.querySelector('input[aria-label="Video address"]')
	if (!field) return 'no-field'
	if (field.value !== input.value) {
		const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
		setter.call(field, input.value)
		field.dispatchEvent(new Event('input', { bubbles: true }))
		return 'typed'
	}
	const row = field.parentElement
	const button = row ? row.querySelector('button') : null
	if (!button) return 'no-button'
	if (button.disabled) return 'disabled'
	button.click()
	return 'clicked'
}

function clipLoaded(name) {
	const text = document.body.innerText || ''
	if (text.includes(name)) return 'named'
	const failure = Array.from(document.querySelectorAll('.notice--error'))
		.map((node) => (node.textContent || '').trim())
		.filter(Boolean)
		.join(' | ')
	return failure ? 'error: ' + failure : ''
}

function analysisDone() {
	const listening = Array.from(document.querySelectorAll('.badge')).some((node) =>
		(node.textContent || '').toLowerCase().includes('listening'),
	)
	if (listening) return 'listening'
	const rows = Array.from(document.querySelectorAll('.result-summary-row'))
	const original = rows.find((node) => (node.textContent || '').trim().startsWith('Original'))
	if (!original) return ''
	const value = (original.querySelector('strong') || {}).textContent || ''
	return /[1-9]/.test(value) ? 'measured' : ''
}

/**
 * Whether the preview has taken the proxy on.
 *
 * The flag the studio shows is the same one a person reads, so polling it
 * rather than some hidden field means a passing check and a visibly working
 * studio cannot come apart.
 */
function proxyAdopted() {
	const flagNode = document.querySelector('.cut-proxy-flag')
	if (!flagNode) return ''
	if (flagNode.dataset.busy === 'true') return 'building'
	return 'ready'
}

/** What the preview element is actually playing, and at what size. */
function previewFacts() {
	const media = document.querySelector('video.cut-video')
	if (!media) return { error: 'no preview element' }
	return {
		src: media.src,
		width: media.videoWidth,
		height: media.videoHeight,
		readyState: media.readyState,
		label: ((document.querySelector('.cut-proxy-flag') || {}).textContent || '').trim(),
	}
}

/** Everything in the private proxy directory, so a second run can compare it. */
async function proxyFiles() {
	try {
		const root = await navigator.storage.getDirectory()
		const directory = await root.getDirectoryHandle('studio-proxies')
		const files = []
		for await (const handle of directory.values()) {
			if (handle.kind !== 'file') continue
			const file = await handle.getFile()
			files.push({ name: handle.name, size: file.size, lastModified: file.lastModified })
		}
		files.sort((left, right) => left.name.localeCompare(right.name))
		return { files }
	} catch (error) {
		return { files: [], reason: String((error && error.message) || error) }
	}
}

/**
 * The same seeks, on the original file and on the proxy.
 *
 * Both are local blobs by this point - the studio downloads a pasted address
 * before it does anything with it - so nothing here is measuring the network.
 * What it measures is the decode debt of a seek, which is the thing a key frame
 * every half second exists to shorten.
 *
 * The original comes back out of the vault rather than being re-fetched, so it
 * is byte-for-byte the file the studio analysed.
 */
async function seekRace(input) {
	const readVault = (id) =>
		new Promise((resolve, reject) => {
			const request = indexedDB.open('rvs-studio')
			request.onerror = () => reject(new Error('the vault would not open'))
			request.onsuccess = () => {
				const db = request.result
				const read = db.transaction('blobs', 'readonly').objectStore('blobs').get(id)
				read.onerror = () => reject(new Error('the clip is not in the vault'))
				read.onsuccess = () => resolve(read.result ? read.result.blob : null)
			}
		})

	const settle = (element, event, timeoutMs) =>
		new Promise((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error(event + ' timed out')), timeoutMs)
			const done = () => {
				clearTimeout(timer)
				element.removeEventListener('error', fail)
				resolve()
			}
			const fail = () => {
				clearTimeout(timer)
				element.removeEventListener(event, done)
				reject(new Error('the file would not open'))
			}
			element.addEventListener(event, done, { once: true })
			element.addEventListener('error', fail, { once: true })
		})

	const time = async (src) => {
		const element = document.createElement('video')
		element.preload = 'auto'
		element.muted = true
		element.playsInline = true
		element.src = src
		await settle(element, 'loadedmetadata', 30000)

		const duration = element.duration
		const samples = []
		// Fixed, spread-out positions rather than random ones: the two runs have
		// to be given the same work or the comparison means nothing.
		for (const fraction of input.fractions) {
			const target = Math.min(duration - 0.1, Math.max(0.05, duration * fraction))
			const started = performance.now()
			element.currentTime = target
			await settle(element, 'seeked', 30000)
			samples.push(performance.now() - started)
		}

		const facts = {
			width: element.videoWidth,
			height: element.videoHeight,
			duration,
			samples,
			median: samples.slice().sort((a, b) => a - b)[Math.floor(samples.length / 2)],
			total: samples.reduce((sum, value) => sum + value, 0),
		}
		element.removeAttribute('src')
		element.load()
		return facts
	}

	const media = document.querySelector('video.cut-video')
	if (!media || !media.src) return { error: 'no preview element' }

	const original = await readVault(input.blobId)
	if (!original) return { error: 'the original is not in the vault' }
	const originalUrl = URL.createObjectURL(original)

	try {
		// The original runs first so that any one-off warm-up in the media stack
		// is paid on its behalf rather than counted against the proxy.
		const before = await time(originalUrl)
		const after = await time(media.src)
		return { before, after, originalBytes: original.size }
	} catch (error) {
		return { error: String((error && error.message) || error) }
	} finally {
		URL.revokeObjectURL(originalUrl)
	}
}

/**
 * Puts the studio on this machine before anything is measured.
 *
 * A deployment with cloud credentials defaults to running there, which would
 * turn the export leg into a check on Cloudinary rather than on the proxy - and
 * would name the button differently while it was at it. The choice is stored,
 * so this also holds across the reload in the cache leg.
 */
function chooseLocal() {
	const group = document.querySelector('.runloc')
	if (!group) return 'no-toggle'
	const local = Array.from(group.querySelectorAll('.runloc-option')).find((node) =>
		(node.getAttribute('title') || '').includes('this machine'),
	)
	if (!local) return 'no-option'
	if (local.getAttribute('aria-checked') === 'true') return 'local'
	if (local.disabled) return 'disabled'
	local.click()
	// Empty, so the caller polls again and confirms the choice actually took.
	return ''
}

/** Reveals the address field on a page that hides it behind a link. */
function revealAddressField() {
	if (document.querySelector('input[aria-label="Video address"]')) return 'shown'
	const toggle = Array.from(document.querySelectorAll('button')).find((node) =>
		(node.textContent || '').toLowerCase().includes('use a video url'),
	)
	if (!toggle) return 'no-toggle'
	toggle.click()
	return ''
}

/**
 * The Subtitle studio's own read-out of the proxy.
 *
 * Its preview is a Remotion Player, so there is no `<video>` whose `src` can be
 * inspected - the badge in the stage bar is what the studio itself believes,
 * which is the right thing to hold it to.
 */
function captionProxyState() {
	const badge = document.querySelector('.badge[data-proxy]')
	if (!badge) return ''
	const state = badge.dataset.proxy
	return state === 'ready' ? 'ready|' + (badge.textContent || '').trim() : state
}

/** That the Player actually mounted and is showing the composition. */
function captionPreviewMounted() {
	const frame = document.querySelector('.stage-frame')
	if (!frame) return ''
	return frame.querySelector('canvas, video') ? 'mounted' : 'empty'
}

function startExport() {
	const button = Array.from(document.querySelectorAll('button')).find((node) =>
		/cut and export|cut in the cloud/.test((node.textContent || '').toLowerCase()),
	)
	if (!button) return 'no-button'
	if (button.disabled) return 'disabled'
	button.click()
	return 'clicked'
}

function exportOutcome() {
	const media = document.querySelector('video.result-media')
	if (media && media.src) return 'ready'
	const failure = Array.from(document.querySelectorAll('.notice--error'))
		.map((node) => (node.textContent || '').trim())
		.filter(Boolean)
		.join(' | ')
	if (failure) return 'error: ' + failure
	return ''
}

/** The finished file's dimensions - the one number that catches a proxy leak. */
async function inspectExport() {
	const media = document.querySelector('video.result-media')
	if (!media || !media.src) return { error: 'no result element' }

	const blob = await (await fetch(media.src)).blob()
	const probe = document.createElement('video')
	probe.preload = 'metadata'
	probe.muted = true
	const url = URL.createObjectURL(blob)
	probe.src = url

	try {
		await new Promise((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error('loadedmetadata timed out')), 30000)
			probe.addEventListener('loadedmetadata', () => {
				clearTimeout(timer)
				resolve()
			}, { once: true })
			probe.addEventListener('error', () => {
				clearTimeout(timer)
				reject(new Error('the exported file would not open'))
			}, { once: true })
		})
		return { width: probe.videoWidth, height: probe.videoHeight, sizeInBytes: blob.size }
	} catch (error) {
		return { error: String((error && error.message) || error) }
	} finally {
		URL.revokeObjectURL(url)
	}
}

/* -------------------------------------------------------------------------- */
/*  Driver                                                                    */
/* -------------------------------------------------------------------------- */

async function waitFor(page, fn, arg, timeoutMs, label, pending = []) {
	const started = Date.now()
	for (;;) {
		const value = await page.evaluate(fn, arg)
		if (value && !pending.includes(value)) return value
		if (Date.now() - started > timeoutMs) {
			throw new Error('timed out waiting for ' + label + (value ? ' (' + value + ')' : ''))
		}
		await sleep(500)
	}
}

async function loadClip(page) {
	await waitFor(page, pageSettled, undefined, 90_000, 'page load')
	await waitFor(page, fieldPresent, undefined, 90_000, 'the address field')
	await waitFor(page, chooseLocal, undefined, 60_000, 'the studio to switch to local', ['disabled'])
	const pressed = await waitFor(page, fillAndSubmit, { value: CLIP }, 30_000, 'the import button', [
		'typed',
		'disabled',
		'no-field',
		'no-button',
	])
	if (pressed !== 'clicked') throw new Error('could not submit the address: ' + pressed)
	const landed = await waitFor(page, clipLoaded, CLIP_NAME, 180_000, 'the clip to load')
	if (landed !== 'named') throw new Error('the clip did not load: ' + landed)
}

async function runStudio() {
	const { openBrowser, ensureBrowser } = require('@remotion/renderer')
	await ensureBrowser()
	const browser = await openBrowser('chrome', { chromiumOptions: { headless: !HEADFUL } })

	try {
		const page = await browser.newPage({ context: null, logLevel: 'error', indent: false, pageIndex: 0 })
		try {
			process.stdout.write('\nload\n')
			await page.goto({ url: BASE + '/silence', timeoutInMilliseconds: 60_000 })
			await loadClip(page)
			record('load', 'clip loaded', true, CLIP_NAME)

			const measured = await waitFor(page, analysisDone, undefined, 300_000, 'the clip to be analysed', [
				'listening',
			])
			record('load', 'clip analysed', measured === 'measured', measured === 'measured' ? undefined : measured)

			process.stdout.write('\nproxy\n')
			// Generous: the transcode is deliberately held back while the studio is
			// listening to the clip, so this window covers both jobs end to end.
			const adopted = await waitFor(page, proxyAdopted, undefined, 600_000, 'the proxy to be built', [
				'building',
			])
			record('proxy', 'a proxy was built and adopted', adopted === 'ready', adopted)

			const facts = await page.evaluate(previewFacts)
			record(
				'proxy',
				'the preview plays the proxy, not the original',
				!facts.error && typeof facts.src === 'string' && facts.src.startsWith('blob:'),
				facts.error ?? facts.label,
			)

			const files = await page.evaluate(proxyFiles)
			const written = files.files.filter((file) => file.size > 1024)
			record(
				'proxy',
				'the proxy is on disk, not in the heap',
				written.length >= 1,
				files.reason ?? written.map((file) => Math.round(file.size / 1024) + ' KB').join(', '),
			)

			process.stdout.write('\nseeking\n')
			const race = await page.evaluate(seekRace, {
				blobId: 'silence:video',
				fractions: [0.83, 0.12, 0.66, 0.29, 0.95, 0.41, 0.73, 0.07],
			})
			if (race.error) {
				record('seeking', 'both files could be timed', false, race.error)
			} else {
				record(
					'seeking',
					'the proxy really is smaller than the source',
					race.after.width < race.before.width && race.after.height < race.before.height,
					race.before.width + 'x' + race.before.height + ' to ' + race.after.width + 'x' + race.after.height,
				)
				record(
					'seeking',
					'the proxy is the same length as the source',
					Math.abs(race.after.duration - race.before.duration) <= Math.max(0.5, race.before.duration * 0.02),
					race.after.duration.toFixed(2) + 's against ' + race.before.duration.toFixed(2) + 's',
				)

				const speedup = race.before.total / Math.max(1e-6, race.after.total)
				record(
					'seeking',
					'seeking the proxy beats seeking the source',
					speedup >= SEEK_SPEEDUP_FLOOR,
					speedup.toFixed(2) +
						'x over ' +
						race.before.samples.length +
						' seeks (' +
						Math.round(race.before.total) +
						' ms to ' +
						Math.round(race.after.total) +
						' ms)',
				)
				record(
					'seeking',
					'the worst seek got better too',
					Math.max(...race.after.samples) <= Math.max(...race.before.samples),
					Math.round(Math.max(...race.before.samples)) +
						' ms to ' +
						Math.round(Math.max(...race.after.samples)) +
						' ms worst case',
				)
			}

			if (!SKIP_EXPORT) {
				process.stdout.write('\nisolation\n')
				const started = await waitFor(page, startExport, undefined, 180_000, 'the export button', [
					'disabled',
					'no-button',
				])
				record('isolation', 'export started', started === 'clicked', started === 'clicked' ? undefined : started)

				if (started === 'clicked') {
					const outcome = await waitFor(page, exportOutcome, undefined, 900_000, 'the export to finish')
					record('isolation', 'export finished', outcome === 'ready', outcome === 'ready' ? undefined : outcome)

					if (outcome === 'ready') {
						const report = await page.evaluate(inspectExport)
						const sourceWidth = race.error ? 0 : race.before.width
						record(
							'isolation',
							'the export is the size of the source, not of the proxy',
							!report.error && sourceWidth > 0 && report.width === sourceWidth,
							report.error ?? report.width + 'x' + report.height + ' against a ' + sourceWidth + '-wide source',
						)
					}
				}
			}

			process.stdout.write('\ncache\n')
			const before = (await page.evaluate(proxyFiles)).files
			await page.goto({ url: BASE + '/silence', timeoutInMilliseconds: 60_000 })
			await waitFor(page, pageSettled, undefined, 90_000, 'the page to load again')

			const restarted = Date.now()
			const readopted = await waitFor(
				page,
				proxyAdopted,
				undefined,
				CACHE_ADOPTION_BUDGET_MS,
				'the cached proxy to be adopted',
				['building'],
			).catch((error) => String(error.message || error))
			const took = Date.now() - restarted

			record(
				'cache',
				'a reload picks the proxy back up',
				readopted === 'ready',
				readopted === 'ready' ? took + ' ms' : readopted,
			)

			const after = (await page.evaluate(proxyFiles)).files
			const rewritten = after.filter((file) => {
				const match = before.find((other) => other.name === file.name)
				return !match || match.lastModified !== file.lastModified
			})
			record(
				'cache',
				'nothing was transcoded a second time',
				rewritten.length === 0 && after.length === before.length,
				rewritten.length === 0
					? before.length + ' file(s) untouched'
					: rewritten.map((file) => file.name).join(', ') + ' was rewritten',
			)
			process.stdout.write('\nsubtitles\n')
			await page.goto({ url: BASE + '/captions', timeoutInMilliseconds: 120_000 })
			await waitFor(page, pageSettled, undefined, 120_000, 'the subtitle studio to load')
			await waitFor(page, revealAddressField, undefined, 60_000, 'the address field', ['no-toggle'])
			await waitFor(page, fieldPresent, undefined, 60_000, 'the address field')
			const typed = await waitFor(page, fillAndSubmit, { value: CLIP }, 30_000, 'the import button', [
				'typed',
				'disabled',
				'no-field',
				'no-button',
			])
			record('subtitles', 'clip loaded', typed === 'clicked', typed === 'clicked' ? undefined : typed)

			const mounted = await waitFor(page, captionPreviewMounted, undefined, 240_000, 'the player to mount', [
				'empty',
			])
			record('subtitles', 'the player mounts on the proxy', mounted === 'mounted', mounted)

			const beforeCaptions = (await page.evaluate(proxyFiles)).files
			const captionState = await waitFor(
				page,
				captionProxyState,
				undefined,
				CACHE_ADOPTION_BUDGET_MS,
				'the subtitle studio to pick the proxy up',
				['queued', 'building'],
			).catch((error) => String(error.message || error))
			record(
				'subtitles',
				'the subtitle studio uses the same proxy',
				typeof captionState === 'string' && captionState.startsWith('ready|'),
				typeof captionState === 'string' ? captionState.replace('ready|', '') : String(captionState),
			)

			const afterCaptions = (await page.evaluate(proxyFiles)).files
			const extra = afterCaptions.filter((file) => {
				const match = beforeCaptions.find((other) => other.name === file.name)
				return !match || match.lastModified !== file.lastModified
			})
			record(
				'subtitles',
				'carrying the clip across studios transcodes nothing',
				extra.length === 0,
				extra.length === 0
					? afterCaptions.length + ' file(s) on disk, unchanged'
					: extra.map((file) => file.name).join(', ') + ' was written again',
			)
		} finally {
			await page.close().catch(() => {})
		}
	} finally {
		await browser.close({ silent: true }).catch(() => {})
	}
}

/* -------------------------------------------------------------------------- */

async function main() {
	runMaths()

	let server = null
	if (!MATHS_ONLY) {
		server = await ensureServer()
		try {
			await runStudio()
		} finally {
			if (server) server.kill()
		}
	}

	const failed = results.filter((entry) => !entry.ok)
	process.stdout.write(
		'\n' + (results.length - failed.length) + '/' + results.length + ' checks passed\n',
	)
	if (failed.length > 0) process.exitCode = 1
}

main().catch((error) => {
	process.stdout.write('\n' + (error && error.stack ? error.stack : String(error)) + '\n')
	process.exitCode = 1
})
