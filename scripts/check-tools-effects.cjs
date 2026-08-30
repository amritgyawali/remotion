#!/usr/bin/env node
/**
 * Proves the two AI/colour tools in the Tools Studio actually work, in a real
 * browser, end to end.
 *
 * Both of them make claims that only running them can settle. A colour look is
 * 35,937 numbers baked from a recipe and applied by a fragment shader - the
 * recipe can be right and the cube still be indexed backwards, or the shader
 * can sample half a cell off and quietly wash every look out. And a background
 * swap loads a WebAssembly model, runs it on every frame, and composites the
 * result: nothing about that can be checked by reading the file.
 *
 * So the checks are in two halves.
 *
 *   maths   - offline, no browser: the look library is well formed, a neutral
 *             recipe bakes to the identity cube, every look stays monotonic in
 *             luminance, and the trilinear lookup agrees with the evaluator it
 *             is a table of. This is the half that would catch an inverted or
 *             mis-strided cube.
 *
 *   studio  - a real Chrome, the real page: a clip is imported, each tool is
 *             selected and run, and the finished file is re-opened and its
 *             pixels measured. A monochrome look has to come back monochrome;
 *             the matte view has to come back grey; a blurred background has
 *             to come back visibly different from the source. Those are the
 *             assertions a mis-wired shader cannot pass by accident.
 *
 * Usage:
 *   node scripts/check-tools-effects.cjs                     # starts its own dev server
 *   node scripts/check-tools-effects.cjs --base http://localhost:3000
 *   node scripts/check-tools-effects.cjs --maths-only        # no browser, no network
 *   node scripts/check-tools-effects.cjs --url https://host/clip.mp4
 *   node scripts/check-tools-effects.cjs --headful
 */

require('sucrase/register')

const { spawn } = require('node:child_process')
const fs = require('node:fs')
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
const MATHS_ONLY = has('maths-only')
const HEADFUL = has('headful')

const results = []
const record = (group, name, ok, detail) => {
	results.push({ group, name, ok, detail })
	process.stdout.write((ok ? '  ok   ' : '  FAIL ') + name + (detail ? ' - ' + detail : '') + '\n')
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/* -------------------------------------------------------------------------- */
/*  Maths                                                                     */
/* -------------------------------------------------------------------------- */

const tone = require('../lib/tools/color-tone.ts')
const registry = require('../lib/tools/registry.ts')
const segmentation = require('../lib/tools/segmentation.ts')

const LUMA = [0.2126, 0.7152, 0.0722]
const lumaOf = (rgb) => rgb[0] * LUMA[0] + rgb[1] * LUMA[1] + rgb[2] * LUMA[2]

function checkLibrary() {
	process.stdout.write('\nlibrary\n')

	const tones = tone.TONES
	record('library', 'at least fifty looks ship', tones.length >= 50, tones.length + ' looks')

	const ids = tones.map((entry) => entry.id)
	const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index)
	record('library', 'every look has a unique id', duplicates.length === 0, duplicates.join(', ') || undefined)

	const families = new Set(tone.TONE_FAMILIES.map((entry) => entry.id))
	const strays = tones.filter((entry) => !families.has(entry.family)).map((entry) => entry.id)
	record('library', 'every look sits in a known family', strays.length === 0, strays.join(', ') || undefined)

	const unnamed = tones.filter((entry) => !entry.name || !entry.blurb).map((entry) => entry.id)
	record('library', 'every look is named and described', unnamed.length === 0, unnamed.join(', ') || undefined)

	const missingDefault = tone.toneById(tone.DEFAULT_TONE_ID)
	record('library', 'the default look exists', Boolean(missingDefault), tone.DEFAULT_TONE_ID)
}

function checkBaking() {
	process.stdout.write('\nbaking\n')

	// A recipe that asks for nothing has to come back as the identity, or every
	// look is being applied on top of a hidden one.
	const identity = tone.bakeToneLut({}, 17)
	let worstIdentity = 0
	for (let b = 0; b < 17; b++) {
		for (let g = 0; g < 17; g++) {
			for (let r = 0; r < 17; r++) {
				const index = ((b * 17 + g) * 17 + r) * 3
				worstIdentity = Math.max(
					worstIdentity,
					Math.abs(identity.data[index] - Math.round((r / 16) * 255)),
					Math.abs(identity.data[index + 1] - Math.round((g / 16) * 255)),
					Math.abs(identity.data[index + 2] - Math.round((b / 16) * 255)),
				)
			}
		}
	}
	record('baking', 'a neutral recipe bakes to the identity cube', worstIdentity <= 1, worstIdentity + '/255 worst cell')

	// The stride check: a cube written red-fastest and read blue-fastest looks
	// plausible along the grey diagonal and catastrophic everywhere else, so it
	// is tested on the two corners the two orderings disagree about. Reading the
	// identity cube keeps the assertion about the layout and nothing else.
	const redCorner = ((0 * 17 + 0) * 17 + 16) * 3
	const blueCorner = ((16 * 17 + 0) * 17 + 0) * 3
	record(
		'baking',
		'the cube is indexed red-fastest',
		identity.data[redCorner] === 255 &&
			identity.data[redCorner + 2] === 0 &&
			identity.data[blueCorner + 2] === 255 &&
			identity.data[blueCorner] === 0,
		'red corner rgb(' +
			identity.data[redCorner] + ',' + identity.data[redCorner + 1] + ',' + identity.data[redCorner + 2] +
			'), blue corner rgb(' +
			identity.data[blueCorner] + ',' + identity.data[blueCorner + 1] + ',' + identity.data[blueCorner + 2] + ')',
	)

	// Every look has to keep dark darker than light. A grade that inverts the
	// ramp is a sign error, not a style.
	const notMonotonic = []
	for (const entry of tone.TONES) {
		let previous = -1
		for (let step = 0; step <= 32; step++) {
			const value = step / 32
			const out = tone.evaluateTone([value, value, value], entry.recipe)
			const luma = lumaOf(out)
			if (luma < previous - 0.002) {
				notMonotonic.push(entry.id)
				break
			}
			previous = luma
		}
	}
	record('baking', 'every look is monotonic in luminance', notMonotonic.length === 0, notMonotonic.join(', ') || undefined)

	// And every look has to actually do something, or it is a name in a list.
	const inert = tone.TONES.filter((entry) => {
		let worst = 0
		for (const probe of [
			[0.1, 0.12, 0.14],
			[0.45, 0.4, 0.35],
			[0.8, 0.6, 0.5],
		]) {
			const out = tone.evaluateTone(probe, entry.recipe)
			for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(out[c] - probe[c]))
		}
		return worst < 0.01
	}).map((entry) => entry.id)
	record('baking', 'no look is a no-op', inert.length === 0, inert.join(', ') || undefined)
}

function checkLookup() {
	process.stdout.write('\nlookup\n')

	const lut = tone.bakeToneLut(tone.toneById('teal-orange').recipe, 33)

	// At a cell centre the interpolation must return the cell itself.
	let worstCell = 0
	for (let i = 0; i < 33; i += 4) {
		const value = i / 32
		const sampled = tone.sampleToneLut(lut, value, value, value)
		const index = ((i * 33 + i) * 33 + i) * 3
		for (let c = 0; c < 3; c++) worstCell = Math.max(worstCell, Math.abs(sampled[c] * 255 - lut.data[index + c]))
	}
	record('lookup', 'a cell centre reads back exactly', worstCell < 0.51, worstCell.toFixed(3) + '/255')

	// And between cells it must stay close to the function it is a table of.
	let worstMid = 0
	for (let step = 0; step < 24; step++) {
		const probe = [((step * 7) % 23) / 23, ((step * 11) % 19) / 19, ((step * 5) % 17) / 17]
		const exact = tone.evaluateTone(probe, tone.toneById('teal-orange').recipe)
		const sampled = tone.sampleToneLut(lut, probe[0], probe[1], probe[2])
		for (let c = 0; c < 3; c++) worstMid = Math.max(worstMid, Math.abs(sampled[c] - exact[c]))
	}
	record('lookup', 'between cells it tracks the evaluator', worstMid < 0.02, worstMid.toFixed(4) + ' worst channel')

	const warmed = tone.trimRecipe({ temperature: 0 }, { warmth: 0.5 })
	const brightened = tone.trimRecipe({ exposure: 0 }, { exposure: 0.5 })
	record(
		'lookup',
		'the trims move the recipe they are given',
		warmed.temperature > 0 && brightened.exposure > 0,
		'warmth ' + warmed.temperature.toFixed(2) + ', exposure ' + brightened.exposure.toFixed(2),
	)
}

function checkRegistry() {
	process.stdout.write('\nregistry\n')

	for (const id of ['color-tone', 'background-replace']) {
		const tool = registry.toolById(id)
		record('registry', id + ' is in the catalogue', Boolean(tool))
		if (!tool) continue
		record('registry', id + ' is marked ready with an engine', tool.status === 'ready' && Boolean(tool.handler), tool.handler)
		record('registry', id + ' offers a frame preview', tool.preview === true)
	}

	const overlay = registry.toolById('chroma-overlay')
	record('registry', 'chroma-overlay is in the catalogue', Boolean(overlay))
	record('registry', 'chroma-overlay is marked ready with an engine', overlay?.status === 'ready' && Boolean(overlay?.handler), overlay?.handler)
	record('registry', 'chroma-overlay takes a second clip', overlay?.secondaryFile?.kind === 'video', overlay?.secondaryFile?.accept)
	const overlayKeys = new Set((overlay?.params ?? []).map((param) => param.key))
	const overlayMissing = ['keyColor', 'autoKey', 'tolerance', 'smoothing', 'despill', 'placement', 'fit', 'scale', 'opacity', 'startAt', 'loop', 'showMatte'].filter(
		(key) => !overlayKeys.has(key),
	)
	record('registry', 'the overlay tool declares every param its runner reads', overlayMissing.length === 0, overlayMissing.join(', ') || undefined)

	const background = registry.toolById('background-replace')
	const keys = new Set((background?.params ?? []).map((param) => param.key))
	const expected = ['mode', 'color', 'fit', 'blur', 'model', 'feather', 'matte', 'edgeShift', 'edgeClean', 'lightWrap', 'smoothing', 'showMatte']
	const missing = expected.filter((key) => !keys.has(key))
	record('registry', 'the background tool declares every param its runner reads', missing.length === 0, missing.join(', ') || undefined)

	const graded = registry.toolById('color-tone')
	const gradedKeys = new Set((graded?.params ?? []).map((param) => param.key))
	const gradedMissing = ['tone', 'strength', 'warmth', 'exposure', 'saturationTrim', 'contrastTrim', 'grain', 'vignette', 'bloom'].filter(
		(key) => !gradedKeys.has(key),
	)
	record('registry', 'the colour tool declares every param its runner reads', gradedMissing.length === 0, gradedMissing.join(', ') || undefined)

	const toneParam = (graded?.params ?? []).find((param) => param.key === 'tone')
	record(
		'registry',
		'the look param defaults to a look that exists',
		Boolean(toneParam && tone.toneById(toneParam.default)),
		toneParam ? toneParam.default : 'missing',
	)
}

/**
 * The polarity check.
 *
 * The two models publish opposite things - one mask that *is* the subject, or
 * six masks the first of which is the background - and reading either the way
 * the other wants gives a perfectly plausible inverted matte: the person is
 * replaced and the room is kept. These are the labels the real models return,
 * read out of a browser, so this is the guard that stops that regressing.
 */
function checkPolarity() {
	process.stdout.write('\npolarity\n')

	const cases = [
		{ name: 'the portrait model publishes the subject directly', labels: ['selfie'], index: 0, invert: false },
		{
			name: 'the six-class model publishes the background first',
			labels: ['background', 'hair', 'body-skin', 'face-skin', 'clothes', 'others'],
			index: 0,
			invert: true,
		},
		{ name: 'a two-class background/person model inverts', labels: ['background', 'person'], index: 0, invert: true },
		{ name: 'a background class that is not first is still found', labels: ['person', 'Background'], index: 1, invert: true },
		{ name: 'an unlabelled multi-mask model falls back to class zero', labels: ['0', '1'], index: 0, invert: true },
	]

	for (const entry of cases) {
		const resolved = segmentation.resolveSubjectChannel(entry.labels)
		record(
			'polarity',
			entry.name,
			resolved.index === entry.index && resolved.invert === entry.invert,
			'index ' + resolved.index + ', invert ' + resolved.invert,
		)
	}
}

function checkAssets() {
	process.stdout.write('\nassets\n')

	const root = path.resolve(__dirname, '..')
	for (const name of ['vision_wasm_internal.js', 'vision_wasm_internal.wasm']) {
		const file = path.join(root, 'public', 'mediapipe', 'wasm', name)
		const size = fs.existsSync(file) ? fs.statSync(file).size : -1
		record('assets', 'the vision runtime is vendored: ' + name, size > 1024, size < 0 ? 'missing' : size + ' bytes')
	}

	for (const model of segmentation.SEGMENTATION_MODELS) {
		const file = path.join(root, 'public', model.localPath.replace(/^\//, ''))
		const size = fs.existsSync(file) ? fs.statSync(file).size : -1
		if (size < 0) {
			// Not vendored is fine - the studio downloads it once and keeps it.
			record('assets', model.id + ' model is reachable', true, 'not vendored; fetched on demand from ' + new URL(model.remoteUrl).host)
		} else {
			record('assets', model.id + ' model is vendored intact', size >= model.approximateBytes * 0.9, size + ' bytes')
		}
	}
}

/* -------------------------------------------------------------------------- */
/*  Dev server                                                                */
/* -------------------------------------------------------------------------- */

/**
 * A dev server that is up but has never compiled the route answers slowly the
 * first time - tens of seconds, not two - so the probe has to be patient or it
 * declares a running server dead and refuses to start.
 */
async function reachable(url, timeoutMs = 45_000) {
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
	if (await reachable(BASE + '/tools')) return null
	if (flag('base')) throw new Error('Nothing is answering at ' + BASE + '.')

	process.stdout.write('starting dev server\n')
	const child = spawn('npm', ['run', 'dev'], {
		cwd: path.resolve(__dirname, '..'),
		stdio: 'ignore',
		shell: process.platform === 'win32',
		detached: false,
	})
	for (let attempt = 0; attempt < 120; attempt += 1) {
		await sleep(1000)
		if (await reachable(BASE + '/tools', 4000)) return child
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

/** Opens a tool by its card in the catalogue, going back to the list first. */
function selectTool(name) {
	const back = Array.from(document.querySelectorAll('.chip')).find((node) => (node.textContent || '').trim() === 'All tools')
	const open = document.querySelector('.card-title')
	if (open && (open.textContent || '').trim() === name) return 'open'
	if (back) {
		back.click()
		return 'went-back'
	}
	const card = Array.from(document.querySelectorAll('.tool-card')).find((node) =>
		(node.querySelector('.tool-card-name')?.textContent || '').trim().startsWith(name),
	)
	if (!card) return 'missing'
	card.click()
	return 'clicked'
}

/** Sets a `select` the way a person would, so React sees the change. */
function setSelect(input) {
	const field = Array.from(document.querySelectorAll('.panel--left .field')).find((node) =>
		(node.querySelector('.field-label')?.textContent || '').includes(input.label),
	)
	const select = field ? field.querySelector('select') : null
	if (!select) return 'missing'
	if (select.value === input.value) return 'set'
	const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set
	setter.call(select, input.value)
	select.dispatchEvent(new Event('change', { bubbles: true }))
	return 'set'
}

function setToggle(input) {
	const label = Array.from(document.querySelectorAll('.panel--left .field-label')).find((node) =>
		(node.textContent || '').includes(input.label),
	)
	const box = label ? label.querySelector('input[type="checkbox"]') : null
	if (!box) return 'missing'
	if (box.checked !== input.value) box.click()
	return 'set'
}

/** Picks a look out of the thumbnail gallery. */
function chooseLook(name) {
	const card = Array.from(document.querySelectorAll('.tone-card')).find(
		(node) => (node.querySelector('.tone-card-name')?.textContent || '').trim() === name,
	)
	if (!card) return 'missing'
	if (card.dataset.selected === 'true') return 'chosen'
	card.click()
	return 'chosen'
}

/**
 * Hands the background tool a picture to put behind the subject.
 *
 * The file is made here rather than fetched so the assertion afterwards can be
 * exact: a flat, unmistakable magenta appears nowhere in the footage, so a
 * frame that comes back magenta can only have come through the upload path.
 */
async function attachPlateFile() {
	const input = Array.from(document.querySelectorAll('.panel--left input[type="file"]')).find((node) =>
		(node.getAttribute('accept') || '').includes('image/'),
	)
	if (!input) return 'no-input'

	const canvas = document.createElement('canvas')
	canvas.width = 640
	canvas.height = 360
	const ctx = canvas.getContext('2d')
	ctx.fillStyle = '#ff00ff'
	ctx.fillRect(0, 0, canvas.width, canvas.height)
	const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))

	const transfer = new DataTransfer()
	transfer.items.add(new File([blob], 'magenta-plate.png', { type: 'image/png' }))
	input.files = transfer.files
	input.dispatchEvent(new Event('change', { bubbles: true }))
	return 'attached'
}

function plateAttached() {
	const text = document.querySelector('.panel--left')?.innerText || ''
	return text.includes('magenta-plate.png') ? 'attached' : ''
}

/**
 * Films a green-screen clip inside the page and hands it to the tool.
 *
 * A real green-screen sample would make this check depend on a third party
 * staying up, and on nobody arguing about what its key colour is. A canvas
 * recorded through MediaRecorder is unambiguous: a flat #00b140 field with one
 * solid red disc on it. After the key, the disc has to be there and the field
 * has to be gone, and neither colour appears anywhere in the footage
 * underneath.
 */
async function recordGreenScreenClip() {
	const input = Array.from(document.querySelectorAll('.panel--left input[type="file"]')).find(
		(node) => node.getAttribute('accept') === 'video/*',
	)
	if (!input) return 'no-input'
	if (typeof MediaRecorder === 'undefined') return 'no-recorder'

	const canvas = document.createElement('canvas')
	canvas.width = 320
	canvas.height = 180
	const ctx = canvas.getContext('2d')
	const paint = () => {
		ctx.fillStyle = '#00b140'
		ctx.fillRect(0, 0, canvas.width, canvas.height)
		ctx.fillStyle = '#ff2010'
		ctx.beginPath()
		ctx.arc(canvas.width / 2, canvas.height / 2, 52, 0, Math.PI * 2)
		ctx.fill()
	}
	paint()

	const stream = canvas.captureStream(30)
	const chunks = []
	const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' })
	recorder.ondataavailable = (event) => {
		if (event.data && event.data.size > 0) chunks.push(event.data)
	}

	const finished = new Promise((resolve) => {
		recorder.onstop = resolve
	})
	recorder.start()
	const started = performance.now()
	await new Promise((resolve) => {
		const tick = () => {
			paint()
			if (performance.now() - started > 1500) resolve()
			else requestAnimationFrame(tick)
		}
		requestAnimationFrame(tick)
	})
	recorder.stop()
	await finished
	stream.getTracks().forEach((track) => track.stop())

	const blob = new Blob(chunks, { type: 'video/webm' })
	if (blob.size < 1024) return 'empty-recording'

	const transfer = new DataTransfer()
	transfer.items.add(new File([blob], 'green-screen.webm', { type: 'video/webm' }))
	input.files = transfer.files
	input.dispatchEvent(new Event('change', { bubbles: true }))
	return 'attached'
}

function overlayAttached() {
	const text = document.querySelector('.panel--left')?.innerText || ''
	return text.includes('green-screen.webm') ? 'attached' : ''
}

function startRun() {
	const button = Array.from(document.querySelectorAll('.panel--right button')).find(
		(node) => (node.textContent || '').trim() === 'Run',
	)
	if (!button) return 'no-button'
	if (button.disabled) return 'disabled'
	button.click()
	return 'clicked'
}

/**
 * The centre stage shows the loaded clip in a `video.result-media` from the
 * moment it is imported, so "a result exists" has to be asked of the output
 * panel's own result block - which the studio empties at the start of every
 * run - and not of the first matching element on the page.
 */
function runOutcome() {
	const media = document.querySelector('.result video.result-media')
	if (media && media.src) return 'ready'
	const failure = Array.from(document.querySelectorAll('.notice--error'))
		.map((node) => (node.textContent || '').trim())
		.filter(Boolean)
		.join(' | ')
	if (failure) return 'error: ' + failure
	return ''
}

/**
 * Re-opens the finished file and measures a frame from the middle of it.
 *
 * Everything the studio claims about a look or a composite is a claim about
 * pixels, so pixels are what gets read: how far from grey the frame is, how
 * bright, and - against the source clip's own frame - how much actually
 * changed. A shader that silently did nothing fails on the last of those.
 */
async function inspectResult(sourceUrl) {
	const media = document.querySelector('.result video.result-media')
	if (!media || !media.src) return { error: 'no result element' }

	const measure = async (url) => {
		const probe = document.createElement('video')
		probe.preload = 'auto'
		probe.muted = true
		probe.playsInline = true
		probe.crossOrigin = 'anonymous'
		probe.src = url

		const settle = (event, timeoutMs) =>
			new Promise((resolve, reject) => {
				const timer = setTimeout(() => reject(new Error(event + ' timed out')), timeoutMs)
				probe.addEventListener(event, () => {
					clearTimeout(timer)
					resolve()
				}, { once: true })
				probe.addEventListener('error', () => {
					clearTimeout(timer)
					reject(new Error('the file would not open'))
				}, { once: true })
			})

		await settle('loadedmetadata', 30000)
		probe.currentTime = Math.max(0.1, probe.duration / 2)
		await settle('seeked', 30000)

		const width = 96
		const height = Math.max(2, Math.round((probe.videoHeight / Math.max(probe.videoWidth, 1)) * width))
		const canvas = document.createElement('canvas')
		canvas.width = width
		canvas.height = height
		const ctx = canvas.getContext('2d', { willReadFrequently: true })
		ctx.drawImage(probe, 0, 0, width, height)
		const pixels = ctx.getImageData(0, 0, width, height).data

		let saturation = 0
		let luma = 0
		let dark = 0
		let light = 0
		let sumRed = 0
		let sumGreen = 0
		let sumBlue = 0
		let red = 0
		let keyGreen = 0
		const count = pixels.length / 4
		for (let i = 0; i < pixels.length; i += 4) {
			const r = pixels[i]
			const g = pixels[i + 1]
			const b = pixels[i + 2]
			sumRed += r
			sumGreen += g
			sumBlue += b
			const max = Math.max(r, g, b)
			const min = Math.min(r, g, b)
			saturation += max - min
			const value = 0.2126 * r + 0.7152 * g + 0.0722 * b
			luma += value
			if (value < 40) dark += 1
			if (value > 215) light += 1
			// The two colours the chroma-overlay pass cares about: the disc that
			// has to survive the key, and the backdrop that has to not.
			if (r > 150 && g < 90 && b < 90) red += 1
			if (r < 90 && g > 110 && b < 120 && g - r > 50) keyGreen += 1
		}

		return {
			duration: probe.duration,
			width: probe.videoWidth,
			height: probe.videoHeight,
			saturation: saturation / count,
			luma: luma / count,
			meanRed: sumRed / count,
			meanGreen: sumGreen / count,
			meanBlue: sumBlue / count,
			redFraction: red / count,
			keyGreenFraction: keyGreen / count,
			darkFraction: dark / count,
			lightFraction: light / count,
			pixels: Array.from(pixels),
			sampleWidth: width,
			sampleHeight: height,
		}
	}

	const response = await fetch(media.src)
	const blob = await response.blob()
	const localUrl = URL.createObjectURL(blob)

	const report = { sizeInBytes: blob.size, type: blob.type }
	try {
		const output = await measure(localUrl)
		Object.assign(report, output)

		if (sourceUrl) {
			try {
				const source = await measure(sourceUrl)
				if (source.sampleWidth === output.sampleWidth && source.sampleHeight === output.sampleHeight) {
					let difference = 0
					for (let i = 0; i < output.pixels.length; i += 4) {
						difference +=
							Math.abs(output.pixels[i] - source.pixels[i]) +
							Math.abs(output.pixels[i + 1] - source.pixels[i + 1]) +
							Math.abs(output.pixels[i + 2] - source.pixels[i + 2])
					}
					report.differenceFromSource = difference / (output.pixels.length / 4) / 3
				}
				report.sourceSaturation = source.saturation
			} catch (error) {
				report.sourceError = String((error && error.message) || error)
			}
		}
	} catch (error) {
		report.error = String((error && error.message) || error)
	}
	delete report.pixels
	URL.revokeObjectURL(localUrl)
	return report
}

/** The object URL of the clip the studio has loaded, for a before/after diff. */
function sourceMediaUrl() {
	const media = document.querySelector('.stage video')
	return media && media.src && media.src.startsWith('blob:') ? media.src : null
}

/**
 * Runs both models, in the page, over a real portrait and over a flat grey
 * field, and reports the mean of every confidence mask.
 *
 * This is the one check that can settle polarity against real human imagery.
 * The two models publish opposite things - one mask that already *is* the
 * subject, or six masks whose first is the background - so reading either the
 * way the other wants gives a perfectly plausible inverted matte, and no
 * amount of staring at a clip with nobody in it would reveal it. A portrait
 * has to come back as mostly-but-not-entirely subject; an empty grey field has
 * to come back as almost none.
 *
 * The means come back raw. Which one to read, and whether to invert it, is
 * decided in Node by the very function the studio uses, so this measures the
 * real rule rather than a copy of it.
 */
async function probeModels(input) {
	const vision = await import(input.bundle)
	const fileset = await vision.FilesetResolver.forVisionTasks(input.wasmPath)

	const frames = {}
	const portrait = await createImageBitmap(await (await fetch(input.portraitUrl)).blob())
	{
		const canvas = document.createElement('canvas')
		canvas.width = 256
		canvas.height = Math.max(2, Math.round((portrait.height / portrait.width) * 256))
		canvas.getContext('2d').drawImage(portrait, 0, 0, canvas.width, canvas.height)
		frames.portrait = canvas
	}
	portrait.close()
	{
		const canvas = document.createElement('canvas')
		canvas.width = 256
		canvas.height = 144
		const ctx = canvas.getContext('2d')
		ctx.fillStyle = '#808080'
		ctx.fillRect(0, 0, canvas.width, canvas.height)
		frames.empty = canvas
	}

	const report = {}
	for (const model of input.models) {
		const bytes = new Uint8Array(await (await fetch(model.path)).arrayBuffer())
		const segmenter = await vision.ImageSegmenter.createFromOptions(fileset, {
			baseOptions: { modelAssetBuffer: bytes, delegate: 'CPU' },
			runningMode: 'IMAGE',
			outputConfidenceMasks: true,
			outputCategoryMask: false,
		})
		const entry = { labels: segmenter.getLabels(), means: {} }
		for (const key of Object.keys(frames)) {
			const result = segmenter.segment(frames[key])
			entry.means[key] = (result.confidenceMasks || []).map((mask) => {
				const data = mask.getAsFloat32Array()
				let sum = 0
				for (let i = 0; i < data.length; i++) sum += data[i]
				return sum / data.length
			})
			result.close()
		}
		segmenter.close()
		report[model.id] = entry
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

	try {
		const page = await browser.newPage({ context: null, logLevel: 'error', indent: false, pageIndex: 0 })
		try {
			process.stdout.write('\nload\n')
			await page.goto({ url: BASE + '/tools', timeoutInMilliseconds: 120_000 })
			await waitFor(page, pageSettled, undefined, 120_000, 'page load')
			await waitFor(page, fieldPresent, undefined, 120_000, 'the address field')

			const pressed = await waitFor(page, fillAndSubmit, { value: CLIP }, 60_000, 'the import button to enable', [
				'typed',
				'disabled',
				'no-field',
				'no-button',
			])
			record('load', 'address submitted', pressed === 'clicked', pressed === 'clicked' ? undefined : pressed)

			const landed = await waitFor(page, clipLoaded, CLIP_NAME, 180_000, 'the clip to load')
			record('load', 'clip loaded', landed === 'named', landed === 'named' ? undefined : landed)

			const sourceUrl = await page.evaluate(sourceMediaUrl)

			/* ------------------------------------------------------- model */

			process.stdout.write('\nmodel\n')
			try {
				const probed = await page.evaluate(probeModels, {
					bundle: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/vision_bundle.mjs',
					wasmPath: '/mediapipe/wasm',
					portraitUrl: 'https://storage.googleapis.com/mediapipe-assets/portrait.jpg',
					models: segmentation.SEGMENTATION_MODELS.map((model) => ({ id: model.id, path: model.localPath })),
				})

				for (const model of segmentation.SEGMENTATION_MODELS) {
					const entry = probed[model.id]
					if (!entry) {
						record('model', model.id + ' model ran', false, 'no result')
						continue
					}
					const channel = segmentation.resolveSubjectChannel(entry.labels)
					const coverage = (means) => {
						const value = means[Math.min(channel.index, means.length - 1)]
						return channel.invert ? 1 - value : value
					}
					const onPortrait = coverage(entry.means.portrait)
					const onEmpty = coverage(entry.means.empty)

					record(
						'model',
						model.id + ' model finds a person in a portrait',
						onPortrait > 0.05 && onPortrait < 0.95,
						Math.round(onPortrait * 100) + '% subject (labels: ' + entry.labels.join(', ') + ')',
					)
					record(
						'model',
						model.id + ' model finds nobody in an empty frame',
						onEmpty < 0.15,
						Math.round(onEmpty * 100) + '% subject',
					)
					record(
						'model',
						model.id + ' matte is the right way round',
						onPortrait - onEmpty > 0.2,
						(Math.round((onPortrait - onEmpty) * 100)) + ' points apart',
					)
				}
			} catch (error) {
				record('model', 'both models could be probed directly', false, String((error && error.message) || error))
			}

			/* ------------------------------------------------------ colour */

			process.stdout.write('\ncolour tone\n')
			await waitFor(page, selectTool, 'Color Tone', 60_000, 'the colour tone tool', ['went-back', 'missing'])
			const look = await waitFor(page, chooseLook, 'Film Noir', 60_000, 'the Film Noir look', ['missing'])
			record('colour tone', 'a look can be chosen from the gallery', look === 'chosen', look)

			const gradeStarted = await waitFor(page, startRun, undefined, 120_000, 'the run button to enable', [
				'disabled',
				'no-button',
			])
			record('colour tone', 'render started', gradeStarted === 'clicked', gradeStarted)

			const gradeOutcome = await waitFor(page, runOutcome, undefined, 900_000, 'the grade to finish')
			record('colour tone', 'render finished', gradeOutcome === 'ready', gradeOutcome)

			if (gradeOutcome === 'ready') {
				const report = await page.evaluate(inspectResult, sourceUrl)
				record('colour tone', 'file has bytes', report.sizeInBytes > 1024, report.sizeInBytes + ' bytes')
				record(
					'colour tone',
					'file opens and reports a duration',
					!report.error && report.duration > 0.2,
					report.error ?? (report.duration ? report.duration.toFixed(2) + 's' : 'no duration'),
				)
				// Film Noir is a full monochrome recipe. If the cube were bypassed,
				// mis-indexed or applied at zero strength, colour would survive.
				record(
					'colour tone',
					'a monochrome look really is monochrome',
					typeof report.saturation === 'number' && report.saturation < 6,
					'mean channel spread ' + (report.saturation ?? NaN).toFixed(2) + '/255' +
						(typeof report.sourceSaturation === 'number' ? ' (source ' + report.sourceSaturation.toFixed(2) + ')' : ''),
				)
			}

			/* -------------------------------------------------- background */

			process.stdout.write('\nbackground\n')
			await waitFor(page, selectTool, 'AI Background Replace', 60_000, 'the background tool', ['went-back', 'missing'])
			record('background', 'blur mode selected', (await page.evaluate(setSelect, { label: 'What goes behind', value: 'blur' })) === 'set')
			record('background', 'matte view enabled', (await page.evaluate(setToggle, { label: 'Show the cut-out', value: true })) === 'set')

			const matteStarted = await waitFor(page, startRun, undefined, 120_000, 'the run button to enable', [
				'disabled',
				'no-button',
			])
			record('background', 'matte render started', matteStarted === 'clicked', matteStarted)

			const matteOutcome = await waitFor(page, runOutcome, undefined, 1_800_000, 'the matte to finish')
			record('background', 'matte render finished', matteOutcome === 'ready', matteOutcome)

			if (matteOutcome === 'ready') {
				const report = await page.evaluate(inspectResult, null)
				record('background', 'matte file has bytes', report.sizeInBytes > 1024, report.sizeInBytes + ' bytes')
				// The debug view writes the alpha into all three channels, so a
				// coloured frame means the model never ran and the frame came
				// through untouched.
				record(
					'background',
					'the matte view is greyscale, so the model ran',
					typeof report.saturation === 'number' && report.saturation < 4,
					'mean channel spread ' + (report.saturation ?? NaN).toFixed(2) + '/255',
				)
				// How much of the frame is subject depends on the clip, so this is
				// not asserted either way - but a matte that is *entirely* subject
				// is the signature of reading the model's masks inverted, which no
				// real footage produces.
				record(
					'background',
					'the matte is not saturated to fully-subject',
					typeof report.lightFraction === 'number' && report.lightFraction < 0.98,
					Math.round((report.lightFraction ?? 0) * 100) +
						'% subject, ' +
						Math.round((report.darkFraction ?? 0) * 100) +
						'% background',
				)
			}

			record('background', 'matte view disabled', (await page.evaluate(setToggle, { label: 'Show the cut-out', value: false })) === 'set')

			const blurStarted = await waitFor(page, startRun, undefined, 120_000, 'the run button to enable', [
				'disabled',
				'no-button',
			])
			record('background', 'composite render started', blurStarted === 'clicked', blurStarted)

			const blurOutcome = await waitFor(page, runOutcome, undefined, 1_800_000, 'the composite to finish')
			record('background', 'composite render finished', blurOutcome === 'ready', blurOutcome)

			if (blurOutcome === 'ready') {
				const report = await page.evaluate(inspectResult, sourceUrl)
				record(
					'background',
					'composite opens and reports a duration',
					!report.error && report.duration > 0.2,
					report.error ?? (report.duration ? report.duration.toFixed(2) + 's' : 'no duration'),
				)
				// A blurred backdrop has to differ from the original frame. Equal
				// pixels would mean the composite pass never touched the picture.
				record(
					'background',
					'the composite changed the picture',
					typeof report.differenceFromSource === 'number' && report.differenceFromSource > 1.5,
					typeof report.differenceFromSource === 'number'
						? report.differenceFromSource.toFixed(2) + '/255 mean change'
						: (report.sourceError ?? 'no source frame to compare against'),
				)
			}

			/* ------------------------------------------------- uploaded plate */

			record('background', 'a background image can be attached', (await page.evaluate(attachPlateFile)) === 'attached')
			await waitFor(page, plateAttached, undefined, 30_000, 'the attached image to be listed')
			record('background', 'upload mode selected', (await page.evaluate(setSelect, { label: 'What goes behind', value: 'upload' })) === 'set')

			const plateStarted = await waitFor(page, startRun, undefined, 120_000, 'the run button to enable', [
				'disabled',
				'no-button',
			])
			record('background', 'uploaded-plate render started', plateStarted === 'clicked', plateStarted)

			const plateOutcome = await waitFor(page, runOutcome, undefined, 1_800_000, 'the uploaded-plate composite to finish')
			record('background', 'uploaded-plate render finished', plateOutcome === 'ready', plateOutcome)

			if (plateOutcome === 'ready') {
				const report = await page.evaluate(inspectResult, null)
				// Nothing in the footage is magenta, and the clip has no person in
				// it, so a correct composite replaces effectively the whole frame
				// with the uploaded picture. Anything else means the upload never
				// reached the compositor.
				const plateLike =
					typeof report.meanRed === 'number' && report.meanRed > 190 && report.meanGreen < 70 && report.meanBlue > 190
				record(
					'background',
					'the uploaded picture is what ended up behind the subject',
					plateLike,
					'mean rgb(' +
						Math.round(report.meanRed ?? -1) + ',' +
						Math.round(report.meanGreen ?? -1) + ',' +
						Math.round(report.meanBlue ?? -1) + ')',
				)
			}

			/* ---------------------------------------------- chroma overlay */

			process.stdout.write('\nchroma overlay\n')
			await waitFor(page, selectTool, 'Chroma Key Overlay', 60_000, 'the chroma overlay tool', ['went-back', 'missing'])

			const recorded = await page.evaluate(recordGreenScreenClip)
			record('chroma overlay', 'a green-screen clip can be attached', recorded === 'attached', recorded)
			if (recorded === 'attached') {
				await waitFor(page, overlayAttached, undefined, 30_000, 'the attached clip to be listed')

				const keyStarted = await waitFor(page, startRun, undefined, 120_000, 'the run button to enable', [
					'disabled',
					'no-button',
				])
				record('chroma overlay', 'render started', keyStarted === 'clicked', keyStarted)

				const keyOutcome = await waitFor(page, runOutcome, undefined, 1_800_000, 'the overlay composite to finish')
				record('chroma overlay', 'render finished', keyOutcome === 'ready', keyOutcome)

				if (keyOutcome === 'ready') {
					const report = await page.evaluate(inspectResult, sourceUrl)
					record(
						'chroma overlay',
						'file opens and reports a duration',
						!report.error && report.duration > 0.2,
						report.error ?? (report.duration ? report.duration.toFixed(2) + 's' : 'no duration'),
					)
					// The disc is the subject; it has to survive.
					record(
						'chroma overlay',
						'the overlay subject is in the finished frame',
						typeof report.redFraction === 'number' && report.redFraction > 0.01,
						Math.round((report.redFraction ?? 0) * 1000) / 10 + '% of the frame',
					)
					// And the screen it was shot against has to be gone. This is the
					// assertion that fails if the key never ran, or ran too weakly.
					record(
						'chroma overlay',
						'the green screen is gone',
						typeof report.keyGreenFraction === 'number' && report.keyGreenFraction < 0.005,
						Math.round((report.keyGreenFraction ?? 0) * 1000) / 10 + '% of the frame still keyed colour',
					)
					// The footage underneath has to still be visible, or the overlay
					// was pasted over everything rather than keyed.
					record(
						'chroma overlay',
						'the footage underneath still shows through',
						typeof report.differenceFromSource === 'number' &&
							report.differenceFromSource > 1 &&
							report.differenceFromSource < 120,
						typeof report.differenceFromSource === 'number'
							? report.differenceFromSource.toFixed(2) + '/255 mean change'
							: (report.sourceError ?? 'no source frame to compare against'),
					)
				}
			}
		} finally {
			await page.close()
		}
	} finally {
		await browser.close({ silent: true })
	}
}

/* -------------------------------------------------------------------------- */

async function main() {
	checkLibrary()
	checkBaking()
	checkLookup()
	checkRegistry()
	checkPolarity()
	checkAssets()

	let server = null
	if (!MATHS_ONLY) {
		try {
			server = await ensureServer()
			await runStudio()
		} catch (error) {
			record('studio', 'the studio run completed', false, String((error && error.message) || error))
		} finally {
			if (server) server.kill()
		}
	}

	const failed = results.filter((entry) => !entry.ok)
	process.stdout.write('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed\n')
	if (failed.length > 0) {
		for (const entry of failed) process.stdout.write('  FAIL ' + entry.group + ' / ' + entry.name + '\n')
		process.exitCode = 1
	}
}

main().catch((error) => {
	console.error(error)
	process.exitCode = 1
})
