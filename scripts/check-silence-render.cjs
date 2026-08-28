#!/usr/bin/env node
/**
 * Proves a silence cut actually exports, in a real browser, without running the
 * tab out of memory.
 *
 * The export used to build the whole file in RAM: an MP4 with Fast Start keeps
 * every media chunk alive until the moov box can be written first, and the
 * buffer target then asks for the finished file as one contiguous allocation.
 * Past a few minutes of 1080p the browser answers "Array buffer allocation
 * failed" and the wait is wasted. The file is streamed to a private file on
 * disk instead, and that is a claim only a browser can settle - so this drives
 * the real studio and then checks the things that would break if the streaming
 * path were wrong:
 *
 *   maths          - the folded sample mapping and the memory-copy fast path
 *                    agree with the per-sample formula they replaced, to well
 *                    under a sample
 *   cut            - a splice-heavy export: the file opens, seeks, carries
 *                    picture and sound, is exactly as long as the plan
 *                    promised, and lands on disk rather than in the heap
 *   full re-encode - the same, over the whole clip, which is the export that
 *                    used to be asked for as one allocation
 *
 * That a file opens at all is the check on Fast Start being off: an mp4 with
 * its metadata at the end is the one a player might refuse.
 *
 * Usage:
 *   node scripts/check-silence-render.cjs                    # starts its own dev server
 *   node scripts/check-silence-render.cjs --base http://localhost:3000
 *   node scripts/check-silence-render.cjs --maths-only       # no browser, no network
 *   node scripts/check-silence-render.cjs --url https://host/clip.mp4
 *   node scripts/check-silence-render.cjs --headful
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
const CLIP = flag('url') ?? 'https://download.samplelib.com/mp4/sample-30s.mp4'
const CLIP_NAME = decodeURIComponent(CLIP.split('/').pop() ?? 'sample.mp4')
const MATHS_ONLY = has('maths-only')
const HEADFUL = has('headful')

/** A cut of a short clip should never need more than this much extra heap. */
const HEAP_BUDGET_BYTES = 600 * 1024 * 1024

const results = []
const record = (group, name, ok, detail) => {
	results.push({ group, name, ok, detail })
	process.stdout.write((ok ? '  ok   ' : '  FAIL ') + name + (detail ? ' - ' + detail : '') + '\n')
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/* -------------------------------------------------------------------------- */
/*  Maths                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The sample mapping, before and after.
 *
 * The old loop asked, for every output sample, "what source time is this, and
 * where is that in this buffer?" - four divisions and a subtraction each. The
 * new one folds the same question into `base + position * step`, which is what
 * lets a run of samples be a plain loop instead of a promise per sample. That
 * fold is algebra, and algebra in floating point is where sync quietly dies, so
 * it is checked against the formula it replaced over a spread of rates, speeds
 * and hour-deep offsets. The answer is the worst disagreement, in samples.
 */
function mappingDrift() {
	let seed = 20260828
	const random = () => {
		seed = (seed * 1664525 + 1013904223) >>> 0
		return seed / 4294967296
	}
	const RATES = [44100, 48000, 32000]
	const SPEEDS = [1, 0.75, 1.25, 1.5, 2, 3]
	let worst = 0

	for (let trial = 0; trial < 300; trial += 1) {
		const sampleRate = RATES[Math.floor(random() * RATES.length)]
		const rate = RATES[Math.floor(random() * RATES.length)]
		const speed = SPEEDS[Math.floor(random() * SPEEDS.length)]
		const segStart = random() * 7200
		const outStart = random() * 7200
		const bufferStart = segStart + random() * 0.05

		const step = (speed * rate) / sampleRate
		const base = (segStart - bufferStart - outStart * speed) * rate
		const first = Math.round(outStart * sampleRate)

		for (let n = 0; n < 2048; n += 1) {
			const position = first + n
			const sourceSeconds = segStart + (position / sampleRate - outStart) * speed
			const reference = (sourceSeconds - bufferStart) * rate
			const folded = base + position * step
			const drift = Math.abs(reference - folded)
			if (drift > worst) worst = drift
		}
	}
	return worst
}

/**
 * The memory-copy fast path, against the interpolation it stands in for.
 *
 * When the speed is 1 and the rates match, every output sample lands exactly on
 * a source sample and the whole run is one `set()`. What that replaces is not
 * just the arithmetic but the index clamping at both ends of the buffer, which
 * is where an off-by-one would show up as a click at every splice - so the
 * copy, its head fill and its tail fill are compared with the clamped
 * interpolation over offsets that fall short of, inside and past the buffer.
 */
function fastPathDrift() {
	const lastIndex = 511
	const source = new Float32Array(lastIndex + 1)
	for (let index = 0; index < source.length; index += 1) source[index] = Math.sin(index / 7)

	let worst = 0
	for (const wholeOffset of [-600, -8, 0, 5, 300, 500, 520, 900]) {
		const count = 64
		const first = 3
		const start = wholeOffset + first

		const fast = new Float32Array(count)
		const head = Math.max(0, Math.min(count, -start))
		const tail = Math.max(head, Math.min(count, lastIndex + 1 - start))
		if (head > 0) fast.fill(source[0], 0, head)
		if (tail > head) fast.set(source.subarray(start + head, start + tail), head)
		if (tail < count) fast.fill(source[lastIndex], tail, count)

		for (let n = 0; n < count; n += 1) {
			const exact = wholeOffset + (first + n)
			const left = Math.floor(exact)
			const fraction = exact - left
			const leftIndex = left < 0 ? 0 : left > lastIndex ? lastIndex : left
			const right = left + 1
			const rightIndex = right < 0 ? 0 : right > lastIndex ? lastIndex : right
			const reference = source[leftIndex] * (1 - fraction) + source[rightIndex] * fraction
			const drift = Math.abs(reference - fast[n])
			if (drift > worst) worst = drift
		}
	}
	return worst
}

function runMaths() {
	process.stdout.write('\nmaths\n')
	const mapping = mappingDrift()
	record(
		'maths',
		'folded sample mapping matches the per-sample formula',
		mapping < 1e-4,
		mapping.toExponential(2) + ' samples worst case',
	)
	const fastPath = fastPathDrift()
	record(
		'maths',
		'copy fast path matches clamped interpolation',
		fastPath === 0,
		fastPath === 0 ? undefined : fastPath.toExponential(2) + ' worst case',
	)
}

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
/*  In-page probes                                                            */
/* -------------------------------------------------------------------------- */

function pageSettled() {
	return document.readyState === 'complete'
}

function fieldPresent() {
	return Boolean(document.querySelector('input[aria-label="Video address"]'))
}

/** Types the address and presses its button, re-asserting through hydration. */
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

/**
 * The plan the studio is about to cut, read off its own summary.
 *
 * Checking the finished file against this rather than against a number this
 * script invented is the whole assertion: the plan promises a length, and the
 * file has to be that length or the mapping is wrong.
 */
function planSummary() {
	const span = (text) => {
		const long = /^(\d+)m\s+(\d+)s$/.exec(text)
		if (long) return Number(long[1]) * 60 + Number(long[2])
		const short = /^([\d.]+)s$/.exec(text)
		return short ? Number(short[1]) : null
	}
	const rows = Array.from(document.querySelectorAll('.result-summary-row'))
	const read = (label) => {
		const row = rows.find((node) => (node.textContent || '').trim().startsWith(label))
		if (!row) return null
		const value = row.querySelector('strong')
		return value ? span((value.textContent || '').trim()) : null
	}
	return { original: read('Original'), afterCut: read('After the cut') }
}

/**
 * Whether the studio has finished listening to the clip.
 *
 * The export button enables as soon as a plan exists, and an unanalysed clip
 * has one - an empty one. Pressing it then would export a fraction of a second
 * and call it a pass, so the badge the studio shows while it is still measuring
 * has to be gone first.
 */
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
 * Switches the studio to a named preset, so each pass cuts differently.
 *
 * The pills stay disabled until the studio is ready for them, and the one
 * already in force needs no click, so both are answers to poll through rather
 * than failures.
 */
function choosePreset(label) {
	const wanted = String(label).toLowerCase()
	const button = Array.from(document.querySelectorAll('.preset-pill')).find((node) =>
		(node.textContent || '').toLowerCase().includes(wanted),
	)
	if (!button) return 'missing'
	if (button.dataset.active === 'true') return 'chosen'
	if (button.disabled) return 'disabled'
	button.click()
	return 'chosen'
}

/**
 * Starts the export, and starts watching the heap while it runs.
 *
 * The peak is sampled from inside the page because that is the only place the
 * number exists. It is the whole point of the change: a streamed export should
 * hold a flush window and the muxer's tables, not the video.
 */
function startExport() {
	const button = Array.from(document.querySelectorAll('button')).find((node) =>
		(node.textContent || '').toLowerCase().includes('cut and export'),
	)
	if (!button) return 'no-button'
	if (button.disabled) return 'disabled'

	const memory = performance.memory
	window.__silenceHeap = { start: memory ? memory.usedJSHeapSize : 0, peak: 0, sampled: Boolean(memory) }
	window.__silenceHeapTimer = setInterval(() => {
		const now = performance.memory
		if (!now) return
		const grown = now.usedJSHeapSize - window.__silenceHeap.start
		if (grown > window.__silenceHeap.peak) window.__silenceHeap.peak = grown
	}, 150)

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

/**
 * Everything worth knowing about the finished file, gathered in one round trip.
 *
 * The file is re-opened from its blob rather than trusting the element the app
 * already made: an MP4 whose moov box sits at the end is exactly the file a
 * player might refuse, and refusing it here is the point of the check.
 */
async function inspectExport() {
	clearInterval(window.__silenceHeapTimer)
	const heap = window.__silenceHeap || { peak: 0, sampled: false }

	const media = document.querySelector('video.result-media')
	if (!media || !media.src) return { error: 'no result element' }

	const response = await fetch(media.src)
	const blob = await response.blob()

	const probe = document.createElement('video')
	probe.preload = 'metadata'
	probe.muted = true
	probe.playsInline = true
	const url = URL.createObjectURL(blob)
	probe.src = url

	const settle = (event, timeoutMs) =>
		new Promise((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error(event + ' timed out')), timeoutMs)
			probe.addEventListener(
				event,
				() => {
					clearTimeout(timer)
					resolve()
				},
				{ once: true },
			)
			probe.addEventListener(
				'error',
				() => {
					clearTimeout(timer)
					reject(new Error('the exported file would not open'))
				},
				{ once: true },
			)
		})

	const report = {
		sizeInBytes: blob.size,
		type: blob.type,
		heapPeak: heap.peak,
		heapSampled: heap.sampled,
	}

	try {
		await settle('loadedmetadata', 30000)
		report.duration = probe.duration
		report.width = probe.videoWidth
		report.height = probe.videoHeight

		// Seeking is what needs the sample index, which is the part of the file
		// that moved to the end when Fast Start was turned off.
		probe.currentTime = Math.max(0.1, probe.duration / 2)
		await settle('seeked', 30000)
		report.seekable = true

		await probe.play().catch(() => {})
		await new Promise((resolve) => setTimeout(resolve, 1500))
		report.videoFrames = probe.webkitDecodedFrameCount || 0
		report.audioBytes = probe.webkitAudioDecodedByteCount || 0
		probe.pause()
	} catch (error) {
		report.error = String((error && error.message) || error)
	}

	URL.revokeObjectURL(url)

	// Where the bytes actually went. A streamed export leaves the finished file
	// in the private directory; an in-memory one leaves nothing there at all.
	try {
		const root = await navigator.storage.getDirectory()
		const directory = await root.getDirectoryHandle('studio-exports')
		let count = 0
		let bytes = 0
		let matched = false
		for await (const handle of directory.values()) {
			if (handle.kind !== 'file') continue
			const file = await handle.getFile()
			count += 1
			bytes += file.size
			if (file.size === blob.size) matched = true
		}
		report.onDisk = { count, bytes, matched }
	} catch (error) {
		report.onDisk = { count: 0, bytes: 0, reason: String((error && error.message) || error) }
	}

	return report
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

async function runStudio() {
	const { openBrowser, ensureBrowser } = require('@remotion/renderer')
	await ensureBrowser()
	const browser = await openBrowser('chrome', { chromiumOptions: { headless: !HEADFUL } })

	// Two passes over one clip. The default preset deletes the quiet stretches,
	// which is the short, splice-heavy export. Fast-forward deletes nothing, so
	// the second pass re-encodes the whole clip - the long export, and the one
	// that used to be asked for as a single allocation. Running them back to
	// back also proves a second export leaves the first one's file alone.
	//
	// How much either preset removes depends on the clip, so only the first is
	// required to shorten anything; both are held to the length their own plan
	// promised, which is the assertion that matters.
	//
	// Both presets are chosen explicitly rather than left to the default: the
	// studio restores the last session it saved, so a run started after another
	// run would otherwise inherit whatever that one ended on.
	const PASSES = [
		{ name: 'cut', preset: 'Talking head', mustShorten: true },
		{ name: 'full re-encode', preset: 'Fast-forward', mustShorten: false },
	]

	try {
		const page = await browser.newPage({ context: null, logLevel: 'error', indent: false, pageIndex: 0 })
		try {
			process.stdout.write('\nload\n')
			await page.goto({ url: BASE + '/silence', timeoutInMilliseconds: 60_000 })
			await waitFor(page, pageSettled, undefined, 90_000, 'page load')
			await waitFor(page, fieldPresent, undefined, 90_000, 'the address field')

			const pressed = await waitFor(
				page,
				fillAndSubmit,
				{ value: CLIP },
				30_000,
				'the import button to enable',
				['typed', 'disabled', 'no-field', 'no-button'],
			)
			record('load', 'address submitted', pressed === 'clicked', pressed === 'clicked' ? undefined : pressed)

			const landed = await waitFor(page, clipLoaded, CLIP_NAME, 150_000, 'the clip to load')
			record('load', 'clip loaded', landed === 'named', landed === 'named' ? undefined : landed)

			const measured = await waitFor(page, analysisDone, undefined, 300_000, 'the clip to be analysed', ['listening'])
			record('load', 'clip analysed', measured === 'measured', measured === 'measured' ? undefined : measured)

			for (const pass of PASSES) {
				process.stdout.write('\n' + pass.name + '\n')

				const chosen = await waitFor(
					page,
					choosePreset,
					pass.preset,
					60_000,
					'the ' + pass.preset + ' preset',
					['missing', 'disabled'],
				)
				record(pass.name, 'preset selected', chosen === 'chosen', chosen === 'chosen' ? undefined : chosen)
				await sleep(1500)

				const plan = await page.evaluate(planSummary)
				record(
					pass.name,
					pass.mustShorten ? 'plan removes something' : 'plan is ready to encode',
					plan.original > 0 &&
						plan.afterCut > 0 &&
						(!pass.mustShorten || plan.afterCut < plan.original),
					plan.afterCut + 's kept of ' + plan.original + 's',
				)

				const started = await waitFor(
					page,
					startExport,
					undefined,
					180_000,
					'the export button to enable',
					['disabled', 'no-button'],
				)
				record(pass.name, 'export started', started === 'clicked', started === 'clicked' ? undefined : started)

				const outcome = await waitFor(page, exportOutcome, undefined, 900_000, 'the export to finish')
				record(pass.name, 'export finished', outcome === 'ready', outcome === 'ready' ? undefined : outcome)
				if (outcome !== 'ready') continue

				const report = await page.evaluate(inspectExport)

				record(pass.name, 'file has bytes', report.sizeInBytes > 1024, report.sizeInBytes + ' bytes')
				record(
					pass.name,
					'file opens and reports a duration',
					!report.error && report.duration > 0.05,
					report.error ?? (report.duration ? report.duration.toFixed(2) + 's' : 'no duration'),
				)

				// The plan's own arithmetic, printed before the export started,
				// against what the encoder actually produced. Drift here is the
				// mapping, and it is what would show up as lip-sync in a long clip.
				const promised = plan.afterCut ?? 0
				const tolerance = Math.max(0.5, promised * 0.05)
				record(
					pass.name,
					'file is as long as the plan promised',
					promised > 0 && Math.abs(report.duration - promised) <= tolerance,
					report.duration.toFixed(2) + 's against ' + promised + 's promised',
				)
				record(pass.name, 'file seeks', report.seekable === true)
				record(pass.name, 'picture decodes', (report.videoFrames ?? 0) > 0, String(report.videoFrames ?? 0) + ' frames')
				record(pass.name, 'sound decodes', (report.audioBytes ?? 0) > 0, String(report.audioBytes ?? 0) + ' bytes')

				record(
					pass.name,
					'bytes were written to disk, not grown in memory',
					report.onDisk?.matched === true,
					report.onDisk?.reason ?? report.onDisk.count + ' file(s), ' + report.onDisk.bytes + ' bytes',
				)
				if (report.heapSampled) {
					record(
						pass.name,
						'heap did not grow by the size of the video',
						report.heapPeak < HEAP_BUDGET_BYTES,
						Math.round(report.heapPeak / (1024 * 1024)) + ' MB peak growth',
					)
				} else {
					process.stdout.write('  skip heap growth - performance.memory is not exposed here\n')
				}
			}
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
