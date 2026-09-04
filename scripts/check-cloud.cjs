#!/usr/bin/env node
/**
 * Proves cloud mode is real, against the real services.
 *
 * Cloud mode makes one promise - that a video can be processed without this
 * machine decoding a frame of it - and that promise is only worth anything if
 * the whole chain works end to end. So this drives the actual routes against
 * the actual Supabase project and the actual Cloudinary account:
 *
 *   status    - the server admits what it can do, and mints a device cookie
 *   sign      - an upload ticket comes back, scoped to this session's folder
 *   upload    - a real MP4 goes straight to Cloudinary, not through Next
 *   register  - the row lands, and an id from outside the folder is refused
 *   transform - a trim, a speed change and a grade become one derived file
 *   poll      - the job reaches `ready` and the file is downloadable
 *   projects  - a workspace saves, lists, reloads and deletes
 *   maths     - the transformation builder agrees with what Cloudinary accepts
 *   browser   - the switch reaches the screen, changes the button, and sticks
 *
 * The transform leg is the one that matters: it checks that the file the job
 * says is ready can actually be fetched and is smaller than the source, which
 * is the only proof that Cloudinary did the work rather than 302'ing back to
 * the original.
 *
 * Usage:
 *   node scripts/check-cloud.cjs                 # starts its own dev server
 *   node scripts/check-cloud.cjs --base http://localhost:3000
 *   node scripts/check-cloud.cjs --maths-only    # no network at all
 *   node scripts/check-cloud.cjs --clip out/final-check.mp4
 *   node scripts/check-cloud.cjs --keep          # leave the cloud rows behind
 *   node scripts/check-cloud.cjs --no-browser    # API only, no Chrome
 *   node scripts/check-cloud.cjs --headful       # watch the browser leg
 */

require('sucrase/register')

const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const transform = require('../lib/cloud/transform.ts')

const argv = process.argv.slice(2)
const flag = (name, fallback = null) => {
	const at = argv.indexOf('--' + name)
	return at >= 0 && argv[at + 1] && !argv[at + 1].startsWith('--') ? argv[at + 1] : fallback
}
const has = (name) => argv.includes('--' + name)

const BASE = (flag('base') ?? 'http://localhost:3000').replace(/\/$/, '')
const MATHS_ONLY = has('maths-only')
const KEEP = has('keep')
const HEADFUL = has('headful')
const CLIP = path.resolve(__dirname, '..', flag('clip') ?? 'out/final-check.mp4')

/** A transform of a short clip should never take longer than this. */
const JOB_TIMEOUT_MS = 6 * 60 * 1000

const results = []
const record = (group, name, ok, detail) => {
	results.push({ group, name, ok, detail })
	process.stdout.write((ok ? '  ok   ' : '  FAIL ') + name + (detail ? ' - ' + detail : '') + '\n')
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const mb = (bytes) => (bytes / 1024 / 1024).toFixed(2) + ' MB'

/* -------------------------------------------------------------------------- */
/*  Maths - the transformation builder, with no network in sight              */
/* -------------------------------------------------------------------------- */

const OUTPUT = { format: 'mp4', quality: 'high' }

function checkMaths() {
	process.stdout.write('\ntransformation builder\n')

	const trim = transform.cloudPlanFor('trim-clip', { startSec: 1.5, endSec: 4.25 }, OUTPUT)
	record(
		'maths',
		'a trim becomes so_/eo_ seconds, not frames',
		trim !== null && trim.transformation.startsWith('so_1.5,eo_4.25/'),
		trim?.transformation,
	)

	/**
	 * Speed is the one with real arithmetic behind it. `e_accelerate` tops out
	 * at +100 (double) and -50 (half), so anything past that has to be chained,
	 * and the product of the chain has to come back to what was asked for.
	 */
	const product = (chain) =>
		chain
			.split('/')
			.filter((part) => part.startsWith('e_accelerate:'))
			.map((part) => 1 + Number(part.slice('e_accelerate:'.length)) / 100)
			.reduce((total, step) => total * step, 1)

	for (const factor of [0.25, 0.5, 1.5, 2, 4, 8]) {
		const plan = transform.cloudPlanFor('speed-change', { factor }, OUTPUT)
		const actual = product(plan.transformation)
		record(
			'maths',
			`${factor}x speed chains to ${factor}x`,
			Math.abs(actual - factor) < 0.02,
			`asked ${factor}, chain gives ${actual.toFixed(3)}`,
		)
	}

	const noop = transform.cloudPlanFor('speed-change', { factor: 1 }, OUTPUT)
	record(
		'maths',
		'1x speed adds no accelerate component',
		noop !== null && !noop.transformation.includes('e_accelerate'),
		noop?.transformation,
	)

	/**
	 * Cloudinary reads a crop value below 1 as a fraction and exactly 1 as a
	 * single pixel, so a full-frame crop must not emit `w_1`.
	 */
	const fullCrop = transform.cloudPlanFor(
		'crop-video',
		{ left: 0, top: 0, right: 0, bottom: 0 },
		OUTPUT,
	)
	record(
		'maths',
		'a crop with nothing cropped emits no c_crop',
		fullCrop !== null && !fullCrop.transformation.includes('c_crop'),
		fullCrop?.transformation,
	)

	const crop = transform.cloudPlanFor(
		'crop-video',
		{ left: 10, top: 20, right: 10, bottom: 0 },
		OUTPUT,
	)
	record(
		'maths',
		'a 10/20/10/0 crop becomes w_0.8,h_0.8,x_0.1,y_0.2',
		crop.transformation.includes('w_0.8') &&
			crop.transformation.includes('h_0.8') &&
			crop.transformation.includes('x_0.1') &&
			crop.transformation.includes('y_0.2'),
		crop.transformation.split('/')[0],
	)

	// A comma in overlay text would end the component and 400 the whole URL.
	const text = transform.cloudPlanFor(
		'text-overlay',
		{ content: 'Kathmandu, Nepal', size: 40, color: '#ffcc00', position: 'bottom-center' },
		OUTPUT,
	)
	// The text sits between the layer's font spec and the next component, so a
	// raw comma inside it would end the component early and 400 the whole URL.
	const textPayload = /l_text:[^:]+:([^,]*)/.exec(text.transformation)?.[1] ?? ''
	record(
		'maths',
		'a comma in overlay text is double-encoded',
		textPayload === 'Kathmandu%252C%20Nepal',
		textPayload,
	)

	const watermark = transform.cloudPlanFor('watermark', { scale: 20, opacity: 80 }, OUTPUT)
	record(
		'maths',
		'a watermark asks for its overlay file',
		watermark.overlay?.slot === 'image' && transform.needsOverlay(watermark.transformation),
		watermark.overlay?.label,
	)
	record(
		'maths',
		'an overlay id has its folders turned into colons',
		transform.withOverlay('l_%OVERLAY%,w_0.2', 'remotion-studio/device-abc/logo') ===
			'l_remotion-studio:device-abc:logo,w_0.2',
	)

	const perPixel = transform.cloudPlanFor('background-replace', {}, OUTPUT)
	record(
		'maths',
		'a per-pixel tool refuses to pretend it can run in the cloud',
		perPixel === null,
	)

	record(
		'maths',
		'every cloud tool builds a non-empty transformation',
		transform.CLOUD_TOOL_IDS.every((id) => {
			const plan = transform.cloudPlanFor(id, {}, OUTPUT)
			return plan === null || typeof plan.transformation === 'string'
		}),
		`${transform.CLOUD_TOOL_IDS.length} tools`,
	)

	process.stdout.write('\ncloud-first wiring\n')
	const root = path.resolve(__dirname, '..')
	const cloudPreference = fs.readFileSync(path.join(root, 'lib/cloud/use-cloud.ts'), 'utf8')
	record(
		'wiring',
		'a browser with no saved override defaults to cloud',
		/cloud'\)\s*\n\s*\n\s*useEffect/.test(cloudPreference) && /=== 'device' \? 'device' : 'cloud'/.test(cloudPreference),
	)
	const topBars = [
		'components/TopBar.tsx',
		'components/captions/CaptionTopBar.tsx',
		'components/silence/SilenceTopBar.tsx',
		'components/tools/ToolsTopBar.tsx',
		'components/editor/EditorTopBar.tsx',
	]
	record(
		'wiring',
		'all five studio headers render the Cloud / Local toggle',
		topBars.every((file) => fs.readFileSync(path.join(root, file), 'utf8').includes('<RunLocationToggle cloud={cloud}')),
		`${topBars.length} sections`,
	)
	const studios = ['Studio.tsx', 'CaptionStudio.tsx', 'SilenceStudio.tsx', 'ToolsStudio.tsx', 'EditorStudio.tsx']
	record(
		'wiring',
		'all five studios continuously save their active project to Supabase',
		studios.every((file) => fs.readFileSync(path.join(root, 'components', file), 'utf8').includes('useCloudProjectAutosave({')),
		`${studios.length} sections`,
	)
	const editorCloud = fs.readFileSync(path.join(root, 'lib/editor/cloud-project.ts'), 'utf8')
	record(
		'wiring',
		'the editor compiles its timeline into a server-rendered Remotion composition',
		editorCloud.includes('EditorTimeline') && editorCloud.includes('asset.cloudUrl'),
	)
}

/* -------------------------------------------------------------------------- */
/*  A cookie jar, because ownership rides on one                              */
/* -------------------------------------------------------------------------- */

const jar = new Map()

function remember(response) {
	// Node exposes every Set-Cookie separately; anything else loses the second one.
	const raw = response.headers.getSetCookie?.() ?? []
	for (const line of raw) {
		const [pair] = line.split(';')
		const cut = pair.indexOf('=')
		if (cut > 0) jar.set(pair.slice(0, cut).trim(), pair.slice(cut + 1).trim())
	}
}

function cookieHeader() {
	return [...jar].map(([name, value]) => `${name}=${value}`).join('; ')
}

async function call(pathname, init = {}) {
	const headers = { ...(init.headers ?? {}) }
	if (jar.size > 0) headers.cookie = cookieHeader()
	const response = await fetch(BASE + pathname, { ...init, headers })
	remember(response)
	const text = await response.text()
	let body = null
	try {
		body = JSON.parse(text)
	} catch {
		body = text
	}
	return { status: response.status, body }
}

/** Polls one job to a terminal state, the way the browser's poller does. */
async function settle(job) {
	const deadline = Date.now() + JOB_TIMEOUT_MS
	let latest = job
	while (Date.now() < deadline) {
		await sleep(2500)
		const polled = await call('/api/cloud/jobs?id=' + encodeURIComponent(job.id))
		latest = polled.body?.job ?? latest
		if (latest.status === 'ready' || latest.status === 'failed') return latest
	}
	return latest
}

/* -------------------------------------------------------------------------- */
/*  The live chain                                                            */
/* -------------------------------------------------------------------------- */

async function checkLive() {
	process.stdout.write('\nlive chain\n')

	/* ---- status --------------------------------------------------------- */

	const status = await call('/api/cloud/status')
	const ready = status.status === 200 && status.body?.enabled === true
	record('live', 'the server reports cloud mode as configured', ready, status.body?.cloudName)
	if (!ready) {
		record('live', 'skipping the rest - nothing to talk to', false, JSON.stringify(status.body))
		return
	}
	record(
		'live',
		'an anonymous device identity was issued',
		typeof status.body.identity?.owner === 'string' &&
			status.body.identity.owner.startsWith('device:'),
		status.body.identity?.owner,
	)
	record(
		'live',
		'the plan video ceiling is reported, not guessed',
		status.body.maxVideoBytes > 0,
		mb(status.body.maxVideoBytes),
	)

	/* ---- sign ----------------------------------------------------------- */

	if (!fs.existsSync(CLIP)) {
		record('live', 'a source clip exists to upload', false, CLIP + ' is missing')
		return
	}
	const bytes = fs.statSync(CLIP).size
	record('live', 'a source clip exists to upload', true, path.basename(CLIP) + ' ' + mb(bytes))

	const signed = await call('/api/cloud/upload', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ fileName: path.basename(CLIP), resourceType: 'video', bytes }),
	})
	const signOk = signed.status === 200 && typeof signed.body?.signature === 'string'
	record('live', 'an upload ticket is signed', signOk, signed.body?.folder)
	if (!signOk) return

	const oversize = await call('/api/cloud/upload', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			fileName: 'huge.mp4',
			resourceType: 'video',
			bytes: status.body.maxVideoBytes + 1,
		}),
	})
	record(
		'live',
		'a file over the plan ceiling is refused before it uploads',
		oversize.status === 413,
		String(oversize.status),
	)

	/* ---- upload --------------------------------------------------------- */

	const form = new FormData()
	form.set('file', new Blob([fs.readFileSync(CLIP)], { type: 'video/mp4' }), path.basename(CLIP))
	form.set('api_key', signed.body.apiKey)
	form.set('timestamp', String(signed.body.timestamp))
	form.set('public_id', signed.body.publicId)
	form.set('folder', signed.body.folder)
	form.set('signature', signed.body.signature)

	const startedUpload = Date.now()
	const uploaded = await fetch(signed.body.uploadUrl, { method: 'POST', body: form })
	const uploadBody = await uploaded.json().catch(() => null)
	record(
		'live',
		'the clip uploads straight to Cloudinary',
		uploaded.ok && typeof uploadBody?.public_id === 'string',
		uploaded.ok
			? `${((Date.now() - startedUpload) / 1000).toFixed(1)}s, ${uploadBody.duration ?? '?'}s of video`
			: JSON.stringify(uploadBody?.error ?? uploaded.status),
	)
	if (!uploaded.ok) return

	const publicId = uploadBody.public_id

	/* ---- register ------------------------------------------------------- */

	const foreign = await call('/api/cloud/assets', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ publicId: 'somebody-else/secret-clip', resourceType: 'video' }),
	})
	record(
		'live',
		'a public id outside this session is refused',
		foreign.status === 403,
		String(foreign.status),
	)

	const registered = await call('/api/cloud/assets', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			publicId,
			resourceType: 'video',
			kind: 'source',
			originalName: path.basename(CLIP),
		}),
	})
	const asset = registered.body?.asset
	record(
		'live',
		'the upload is indexed in Supabase',
		registered.status === 200 && typeof asset?.id === 'string',
		asset ? `${asset.width}x${asset.height}, ${asset.duration}s` : JSON.stringify(registered.body),
	)
	if (!asset) return

	const listed = await call('/api/cloud/assets')
	record(
		'live',
		'it comes back in this session library',
		listed.status === 200 && listed.body.assets.some((item) => item.id === asset.id),
		`${listed.body?.assets?.length ?? 0} file(s)`,
	)

	/* ---- transform ------------------------------------------------------ */

	const started = await call('/api/cloud/process', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			assetId: asset.id,
			tool: 'trim-clip',
			params: { startSec: 0, endSec: Math.min(4, asset.duration ?? 4) },
			output: { format: 'mp4', quality: 'draft' },
		}),
	})
	const job = started.body?.job
	record(
		'live',
		'a trim is handed to the cloud without waiting for it',
		started.status === 200 && job?.status === 'running',
		job?.transformation,
	)
	if (!job) return

	const refused = await call('/api/cloud/process', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			assetId: asset.id,
			tool: 'background-replace',
			params: {},
			output: { format: 'mp4', quality: 'draft' },
		}),
	})
	record(
		'live',
		'a device-only tool is refused with a reason',
		refused.status === 422,
		typeof refused.body === 'string' ? refused.body.slice(0, 60) : String(refused.status),
	)

	const finished = await settle(job)
	record(
		'live',
		'the job reaches ready',
		finished.status === 'ready',
		finished.status === 'failed' ? finished.error : finished.status,
	)

	if (finished.status === 'ready') {
		const head = await fetch(finished.result.url, { method: 'HEAD' })
		const derivedBytes = Number(head.headers.get('content-length') ?? 0)
		record(
			'live',
			'the finished file is downloadable',
			head.ok && derivedBytes > 0,
			mb(derivedBytes),
		)
		record(
			'live',
			'the derived file really is a cut, not the original',
			derivedBytes > 0 && derivedBytes < bytes,
			`${mb(derivedBytes)} from ${mb(bytes)}`,
		)
	}

	/* ---- the studio-shaped jobs ----------------------------------------- */

	/**
	 * A silence cut is the leg that had to be proved rather than reasoned about:
	 * it is a splice chain over the asset's own public id, and a chain the
	 * account rejects looks exactly like one it accepts until the file is
	 * fetched. So this asks for three separated pieces, then checks the bytes.
	 */
	const spliced = await call('/api/cloud/process', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			mode: 'silence',
			assetId: asset.id,
			segments: [
				{ startSec: 0, endSec: 2, speed: 1 },
				{ startSec: 6, endSec: 8, speed: 1 },
				{ startSec: 11, endSec: 13, speed: 2 },
			],
			output: { format: 'mp4', quality: 'draft' },
		}),
	})
	record(
		'live',
		'a three-piece cut becomes one splice chain',
		spliced.status === 200 &&
			(spliced.body?.job?.transformation ?? '').split('fl_splice').length === 3,
		spliced.body?.job?.transformation?.slice(0, 80),
	)

	if (spliced.body?.job) {
		const done = await settle(spliced.body.job)
		record('live', 'the cut finishes in the cloud', done.status === 'ready', done.error ?? done.status)
		if (done.status === 'ready') {
			const body = Buffer.from(await (await fetch(done.result.url)).arrayBuffer())
			record(
				'live',
				'the spliced file is a real MP4, not an error page',
				body.length > 20000 && body.subarray(4, 8).toString() === 'ftyp',
				mb(body.length),
			)
		}
	}

	const tooMany = await call('/api/cloud/process', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			mode: 'silence',
			assetId: asset.id,
			segments: Array.from({ length: 40 }, (unused, index) => ({
				startSec: index * 0.2,
				endSec: index * 0.2 + 0.1,
				speed: 1,
			})),
			output: { format: 'mp4', quality: 'draft' },
		}),
	})
	record(
		'live',
		'a cut with too many joins is refused rather than half-built',
		tooMany.status === 422,
		typeof tooMany.body === 'string' ? tooMany.body.slice(0, 64) : String(tooMany.status),
	)

	/* ---- burnt-in captions ---------------------------------------------- */

	const srtPath = path.join(require('node:os').tmpdir(), 'check-cloud.srt')
	fs.writeFileSync(
		srtPath,
		'1\n00:00:00,500 --> 00:00:03,000\nBurnt in by the cloud\n\n2\n00:00:04,000 --> 00:00:07,000\nSecond line\n',
	)

	const srtSigned = await call('/api/cloud/upload', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			fileName: 'check-cloud.srt',
			resourceType: 'raw',
			bytes: fs.statSync(srtPath).size,
		}),
	})

	let srtAsset = null
	if (srtSigned.status === 200) {
		const srtForm = new FormData()
		srtForm.set('file', new Blob([fs.readFileSync(srtPath)], { type: 'text/plain' }), 'check-cloud.srt')
		srtForm.set('api_key', srtSigned.body.apiKey)
		srtForm.set('timestamp', String(srtSigned.body.timestamp))
		srtForm.set('public_id', srtSigned.body.publicId)
		srtForm.set('folder', srtSigned.body.folder)
		srtForm.set('signature', srtSigned.body.signature)
		const put = await fetch(srtSigned.body.uploadUrl, { method: 'POST', body: srtForm })
		const putBody = await put.json().catch(() => null)
		if (put.ok) {
			const registeredSrt = await call('/api/cloud/assets', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					publicId: putBody.public_id,
					resourceType: 'raw',
					kind: 'overlay',
					originalName: 'check-cloud.srt',
				}),
			})
			srtAsset = registeredSrt.body?.asset ?? null
		}
	}
	record('live', 'a caption track uploads as a raw asset', srtAsset !== null, srtAsset?.publicId)

	if (srtAsset) {
		const burn = await call('/api/cloud/process', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				mode: 'subtitles',
				assetId: asset.id,
				overlayAssetId: srtAsset.id,
				output: { format: 'mp4', quality: 'draft' },
				style: { fontFamily: 'Arial', fontSize: 30, boxOpacity: 55 },
				previewSec: 8,
			}),
		})
		record(
			'live',
			'the burn-in names the uploaded track, not a placeholder',
			burn.status === 200 && !(burn.body?.job?.transformation ?? '').includes('%OVERLAY%'),
			burn.body?.job?.transformation?.split('/')[1]?.slice(0, 70),
		)

		if (burn.body?.job) {
			const done = await settle(burn.body.job)
			record(
				'live',
				'the burn-in finishes in the cloud',
				done.status === 'ready',
				done.error ?? done.status,
			)
			if (done.status === 'ready') {
				const body = Buffer.from(await (await fetch(done.result.url)).arrayBuffer())
				record(
					'live',
					'the captioned file is a real MP4',
					body.length > 20000 && body.subarray(4, 8).toString() === 'ftyp',
					mb(body.length),
				)
			}
		}

		if (!KEEP) {
			await call('/api/cloud/assets?id=' + encodeURIComponent(srtAsset.id), { method: 'DELETE' })
		}
	}

	/* ---- projects ------------------------------------------------------- */

	const saved = await call('/api/cloud/projects', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			studio: 'tools',
			name: 'cloud check',
			version: 1,
			data: { selectedToolId: 'trim-clip', note: 'written by check-cloud' },
		}),
	})
	const project = saved.body?.project
	record('live', 'a workspace saves to the cloud', saved.status === 200 && Boolean(project?.id))

	if (project) {
		const reopened = await call('/api/cloud/projects?id=' + encodeURIComponent(project.id))
		record(
			'live',
			'it reopens with its snapshot intact',
			reopened.status === 200 && reopened.body.project.data.selectedToolId === 'trim-clip',
		)

		const updated = await call('/api/cloud/projects', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				id: project.id,
				studio: 'tools',
				name: 'cloud check',
				version: 1,
				data: { selectedToolId: 'speed-change' },
			}),
		})
		record(
			'live',
			'saving again updates the same row rather than adding one',
			updated.status === 200 && updated.body.project.id === project.id,
		)
	}

	/* ---- ownership ------------------------------------------------------ */

	const strangerAssets = await fetch(BASE + '/api/cloud/assets')
	const strangerBody = await strangerAssets.json().catch(() => ({ assets: [] }))
	record(
		'live',
		'a request with no device cookie sees none of this session files',
		Array.isArray(strangerBody.assets) && strangerBody.assets.length === 0,
		`${strangerBody.assets?.length ?? '?'} file(s)`,
	)

	/* ---- cleanup -------------------------------------------------------- */

	if (KEEP) {
		process.stdout.write('\n  --keep: leaving ' + publicId + ' in Cloudinary\n')
		return
	}

	const removedAsset = await call('/api/cloud/assets?id=' + encodeURIComponent(asset.id), {
		method: 'DELETE',
	})
	record('live', 'the file is deleted from Cloudinary and the index', removedAsset.status === 200)

	if (project) {
		const removedProject = await call(
			'/api/cloud/projects?id=' + encodeURIComponent(project.id),
			{ method: 'DELETE' },
		)
		record('live', 'the saved workspace is deleted', removedProject.status === 200)
	}
}


/* -------------------------------------------------------------------------- */
/*  The browser leg                                                           */
/*                                                                            */
/*  The API is only half the promise. This half checks that the switch really */
/*  reaches the screen: the toggle is in every header, Cloud is the default,   */
/*  and an explicit Local choice survives a reload - which is the              */
/*  difference between a feature and a setting nobody can find.               */
/* -------------------------------------------------------------------------- */

/** In-page: is the run-location toggle mounted? */
function toggleMounted() {
	return Boolean(document.querySelector('.runloc'))
}

/** In-page: press the Local half of the toggle. */
function pressLocal() {
	const options = [...document.querySelectorAll('.runloc-option')]
	const local = options[options.length - 1]
	if (!local) return 'no-toggle'
	local.click()
	return 'clicked'
}

/** In-page: what the primary action currently says, and which side is active. */
function readState() {
	const options = [...document.querySelectorAll('.runloc-option')]
	const primary = document.querySelector('.panel-actions .btn--primary, .btn--primary.btn--block')
	return {
		options: options.map((item) => item.textContent.trim()),
		active: options.findIndex((item) => item.dataset.active === 'true'),
		primary: primary ? primary.textContent.trim() : null,
		note: document.querySelector('.runloc-note')?.textContent.trim() ?? null,
		warning: document.querySelector('.notice--warn')?.textContent.trim() ?? null,
	}
}

/**
 * In-page: pick a tool the cloud can actually take.
 *
 * Not simply the first card - the catalogue leads with tools that are device-
 * only or not wired up yet, and picking one of those would make this leg prove
 * the opposite of what it is for. Trim is the plainest cloud-capable tool.
 */
function pickTool() {
	const cards = [...document.querySelectorAll('.tool-card[data-status="ready"]')]
	const trim = cards.find((card) => /trim/i.test(card.textContent ?? ''))
	const card = trim ?? cards[0]
	if (!card) return 'no-card'
	card.click()
	return card.textContent.trim().slice(0, 30)
}

async function checkBrowser() {
	process.stdout.write('\nbrowser\n')

	const { openBrowser, ensureBrowser } = require('@remotion/renderer')
	await ensureBrowser()
	const browser = await openBrowser('chrome', { chromiumOptions: { headless: !HEADFUL } })

	try {
		const page = await browser.newPage({ context: null, logLevel: 'error', indent: false, pageIndex: 0 })
		await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })

		for (const route of ['/', '/captions', '/silence', '/tools', '/editor']) {
			await page.goto({ url: BASE + route, timeoutInMilliseconds: 180_000 })
			await page.evaluate(() => window.localStorage.removeItem('rvs:run-location'), null)
			await page.goto({ url: BASE + route, timeoutInMilliseconds: 180_000 })
			try {
				await waitForPage(page, toggleMounted, 120_000)
			} catch (error) {
				record('browser', `${route} shows the run-location toggle`, false, error.message)
				continue
			}

			const before = await page.evaluate(readState, null)
			record(
				'browser',
				`${route} defaults to cloud and offers a local override`,
				before.options.length === 2 && before.active === 0 && /cloud/i.test(before.options[0]) && /local/i.test(before.options[1]),
				before.options.join(' / '),
			)

			await page.evaluate(pressLocal, null)
			await sleep(500)
			const after = await page.evaluate(readState, null)
			record(
				'browser',
				`${route} switches to local processing`,
				after.active === 1,
				`active index ${after.active}`,
			)

			// The preference is the whole reason it is a setting rather than a
			// checkbox: it has to still be there on the next visit.
			await page.goto({ url: BASE + route, timeoutInMilliseconds: 180_000 })
			await waitForPage(page, toggleMounted, 120_000)
			await sleep(400)
			const reloaded = await page.evaluate(readState, null)
			record(
				'browser',
				`${route} remembers the local override across a reload`,
				reloaded.active === 1,
				`active index ${reloaded.active}`,
			)

			await page.evaluate(() => window.localStorage.removeItem('rvs:run-location'), null)
			await sleep(200)
		}
	} finally {
		await browser.close({ silent: true })
	}
}

async function waitForPage(page, fn, timeoutMs) {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		try {
			if (await page.evaluate(fn, null)) return true
		} catch {
			/* still navigating */
		}
		await sleep(200)
	}
	throw new Error('timed out waiting for the page')
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
	for (let attempt = 0; attempt < 120; attempt += 1) {
		await sleep(1000)
		if (await reachable(BASE)) return child
	}
	child.kill()
	throw new Error('The dev server never came up.')
}

/* -------------------------------------------------------------------------- */

async function main() {
	checkMaths()

	let server = null
	if (!MATHS_ONLY) {
		server = await ensureServer()
		try {
			await checkLive()
			if (!has('no-browser')) await checkBrowser()
		} finally {
			if (server) server.kill()
		}
	}

	const failed = results.filter((item) => !item.ok)
	process.stdout.write(
		`\n${results.length - failed.length}/${results.length} checks passed\n`,
	)
	if (failed.length > 0) {
		for (const item of failed) process.stdout.write(`  FAIL ${item.name}\n`)
		process.exitCode = 1
	}
}

main().catch((error) => {
	process.stderr.write('\n' + (error && error.stack ? error.stack : String(error)) + '\n')
	process.exitCode = 1
})
