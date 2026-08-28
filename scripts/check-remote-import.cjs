#!/usr/bin/env node
/**
 * Proves that importing a video by link actually works, in the real app.
 *
 * The feature spans a server route, a client downloader and four studios, and
 * every part of it can fail in a way the type checker cannot see: a DNS shim
 * with the wrong callback shape, a host that redirects, a panel wired to the
 * wrong handler. So this drives the running app the way a person would - opens
 * the page, pastes an address, presses the button, waits for the clip to appear
 * - and separately hammers the route with the addresses an attacker would try.
 *
 * Two groups of checks:
 *
 *   guard  - the import route refuses loopback, link-local metadata, private
 *            space, non-http schemes and web pages, and accepts a real file
 *   studio - captions, silence, tools and the editor each accept a pasted
 *            address and end up holding the clip
 *
 * Usage:
 *   node scripts/check-remote-import.cjs                 # starts its own dev server
 *   node scripts/check-remote-import.cjs --base http://localhost:3000
 *   node scripts/check-remote-import.cjs --guards-only   # no browser needed
 *   node scripts/check-remote-import.cjs --url https://host/clip.mp4
 */

const { spawn } = require('node:child_process')
const path = require('node:path')

const argv = process.argv.slice(2)
const flag = (name, fallback = null) => {
	const at = argv.indexOf('--' + name)
	return at >= 0 && argv[at + 1] && !argv[at + 1].startsWith('--') ? argv[at + 1] : fallback
}
const has = (name) => argv.includes('--' + name)

const BASE = (flag('base') ?? 'http://localhost:3000').replace(/\/$/, '')
const CLIP = flag('url') ?? 'https://download.samplelib.com/mp4/sample-5s.mp4'
const CLIP_NAME = decodeURIComponent(CLIP.split('/').pop() ?? 'sample.mp4')
const GUARDS_ONLY = has('guards-only')
const HEADFUL = has('headful')

const results = []
const record = (group, name, ok, detail) => {
	results.push({ group, name, ok, detail })
	process.stdout.write((ok ? '  ok   ' : '  FAIL ') + name + (detail ? ' - ' + detail : '') + '\n')
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/* -------------------------------------------------------------------------- */
/*  Dev server                                                                */
/* -------------------------------------------------------------------------- */

async function reachable(url, timeoutMs = 2000) {
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
	if (flag('base')) throw new Error('Nothing is answering at ' + BASE + '.')

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
/*  Guards                                                                    */
/* -------------------------------------------------------------------------- */

async function probe(url) {
	const response = await fetch(BASE + '/api/media/import', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ url }),
	})
	let body = null
	try {
		body = await response.json()
	} catch {
		/* an unreadable body is reported as null */
	}
	return { status: response.status, body }
}

async function runGuards() {
	process.stdout.write('\nguards\n')

	const refusals = [
		['loopback by address', 'http://127.0.0.1:3000/'],
		['loopback by name', 'http://localhost:3000/'],
		['cloud metadata', 'http://169.254.169.254/latest/meta-data/'],
		['private space', 'http://10.0.0.1/'],
		['private space (172.16)', 'http://172.16.5.4/'],
		['unique local v6', 'http://[fd00::1]/'],
		['file scheme', 'file:///etc/passwd'],
		['gopher scheme', 'gopher://example.com/'],
		['credentials in address', 'https://user:pass@example.com/clip.mp4'],
	]
	for (const [name, url] of refusals) {
		try {
			const { status, body } = await probe(url)
			const refused = status >= 400 && Boolean(body && body.error)
			record('guard', name + ' refused', refused, refused ? undefined : 'status ' + status)
		} catch (error) {
			record('guard', name + ' refused', false, error.message)
		}
	}

	try {
		const { status, body } = await probe('https://example.com/')
		record('guard', 'web page refused as not-a-video', status === 415, 'status ' + status + (body && body.error ? ' - ' + body.error : ''))
	} catch (error) {
		record('guard', 'web page refused as not-a-video', false, error.message)
	}

	try {
		const { status, body } = await probe(CLIP)
		const ok = status === 200 && body && body.ok === true && typeof body.name === 'string'
		record('guard', 'real video accepted', Boolean(ok), ok ? body.name + ', ' + body.sizeInBytes + ' bytes' : 'status ' + status)
	} catch (error) {
		record('guard', 'real video accepted', false, error.message)
	}

	try {
		const response = await fetch(BASE + '/api/media/import?url=' + encodeURIComponent(CLIP))
		const buffer = await response.arrayBuffer()
		// Every ISO base media file carries its brand at byte four.
		const brand = Buffer.from(buffer.slice(4, 8)).toString('latin1')
		const ok = response.ok && buffer.byteLength > 1000 && brand === 'ftyp'
		record('guard', 'stream returns real mp4 bytes', ok, buffer.byteLength + ' bytes, brand ' + JSON.stringify(brand))
	} catch (error) {
		record('guard', 'stream returns real mp4 bytes', false, error.message)
	}
}

/* -------------------------------------------------------------------------- */
/*  Studios                                                                   */
/* -------------------------------------------------------------------------- */

function clickByText(text) {
	const wanted = String(text).toLowerCase()
	const buttons = Array.from(document.querySelectorAll('button'))
	const hit = buttons.find((button) => {
		if (button.disabled) return false
		return (button.textContent || '').trim().toLowerCase().includes(wanted)
	})
	if (!hit) return false
	hit.click()
	return true
}

/**
 * Fills the address in and presses its button, in one poll-able step.
 *
 * Typing and clicking cannot be two steps here. A page whose readyState is
 * complete has not necessarily hydrated, and when React does hydrate it
 * replaces the DOM value with its own empty state - so an address typed a
 * moment too early disappears, and the button never enables. Re-asserting the
 * value on every poll survives that, and costs nothing once it has taken.
 *
 * The button is found by walking up from the input rather than by its label:
 * the editor page has several other buttons whose text contains "add".
 */
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

function fieldPresent() {
	return Boolean(document.querySelector('input[aria-label="Video address"]'))
}

function pageSettled() {
	return document.readyState === 'complete'
}

/**
 * The one signal every studio shares once it holds a clip: it prints its name.
 *
 * Errors are reported rather than waited out, so a refused import fails in a
 * second with the reason instead of after the whole timeout.
 */
function importOutcome(name) {
	const text = document.body.innerText || ''
	if (text.includes(name)) return 'named'
	const failure = Array.from(document.querySelectorAll('.notice--error'))
		.map((node) => (node.textContent || '').trim())
		.filter(Boolean)
		.join(' | ')
	return failure ? 'error: ' + failure : ''
}

/**
 * Polls the page until the probe reports something worth acting on.
 *
 * `pending` values are the ones that mean "not yet" rather than "no": an
 * import button that exists but is still disabled is not a failure, it is a
 * state to wait through.
 */
async function waitFor(page, fn, arg, timeoutMs, label, pending = []) {
	const started = Date.now()
	for (;;) {
		const value = await page.evaluate(fn, arg)
		if (value && !pending.includes(value)) return value
		if (Date.now() - started > timeoutMs) throw new Error('timed out waiting for ' + label + (value ? ' (' + value + ')' : ''))
		await sleep(500)
	}
}

const STUDIOS = [
	{
		name: 'captions',
		route: '/captions',
		// The field is behind a disclosure in this panel only.
		reveal: 'Use a video URL',
		button: 'Load',
	},
	{ name: 'silence', route: '/silence', reveal: null, button: 'Load' },
	{ name: 'tools', route: '/tools', reveal: null, button: 'Load' },
	{ name: 'editor', route: '/editor', reveal: null, button: 'Add' },
]

async function runStudios() {
	const { openBrowser, ensureBrowser } = require('@remotion/renderer')
	await ensureBrowser()
	const browser = await openBrowser('chrome', { chromiumOptions: { headless: !HEADFUL } })

	try {
		for (const [index, studio] of STUDIOS.entries()) {
			process.stdout.write('\n' + studio.name + '\n')
			// A distinct index per studio: pages are addressed by it, and reusing
			// zero after a close can leave evaluate talking to the old target.
			const page = await browser.newPage({ context: null, logLevel: 'error', indent: false, pageIndex: index })
			try {
				await page.goto({ url: BASE + studio.route, timeoutInMilliseconds: 60_000 })
				await waitFor(page, pageSettled, undefined, 90_000, 'page load')

				if (studio.reveal) {
					const revealed = await page.evaluate(clickByText, studio.reveal)
					record(studio.name, 'url field can be revealed', revealed === true)
					await sleep(400)
				}

				const present = await waitFor(page, fieldPresent, undefined, 90_000, 'the address field')
				record(studio.name, 'address field present', present === true)

				const pressed = await waitFor(
					page,
					fillAndSubmit,
					{ value: CLIP },
					30_000,
					'the import button to enable',
					['typed', 'disabled', 'no-field', 'no-button'],
				).catch((error) => error.message)
				record(studio.name, 'address entered and submitted', pressed === 'clicked', pressed === 'clicked' ? undefined : String(pressed))

				const landed = await waitFor(page, importOutcome, CLIP_NAME, 150_000, 'the clip to load')
				record(studio.name, 'clip loaded from link', landed === 'named', landed === 'named' ? undefined : String(landed))
			} catch (error) {
				record(studio.name, 'clip loaded from link', false, error.message)
			} finally {
				await page.close().catch(() => {})
			}
		}
	} finally {
		await browser.close({ silent: true }).catch(() => {})
	}
}

/* -------------------------------------------------------------------------- */

async function main() {
	let child = null
	try {
		child = await ensureServer()
		await runGuards()
		if (!GUARDS_ONLY) await runStudios()
	} finally {
		if (child) child.kill('SIGTERM')
	}

	const failed = results.filter((result) => !result.ok)
	process.stdout.write('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed\n')
	if (failed.length > 0) {
		process.stdout.write('\nFAILURES\n')
		for (const failure of failed) process.stdout.write('  ' + failure.group + ': ' + failure.name + (failure.detail ? ' - ' + failure.detail : '') + '\n')
	}
	process.exitCode = failed.length > 0 ? 1 : 0
}

main().catch((error) => {
	process.stderr.write(String(error && error.stack ? error.stack : error) + '\n')
	process.exitCode = 1
})
