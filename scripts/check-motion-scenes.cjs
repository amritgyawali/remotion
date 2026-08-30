/**
 * Renders one still from every scene in the library.
 *
 * The scenes are generated source, so a typo in one of them only surfaces when
 * a browser actually mounts it. This walks the whole library in batches, bundles
 * each batch once and samples a frame in the middle of every scene, which is
 * enough to catch a crash, a missing helper or a scene that renders empty.
 *
 * Both halves of the library are covered: the fifty motion pieces and the
 * sixteen classic scenes, which share the same Headline and Copy and so share
 * the same failure modes. `--scope` narrows to one or the other, and
 * `--no-three` drops the WebGL scenes on a machine without a GL context.
 *
 * A scene that renders is not the same as a scene that fits. One design unit is
 * derived from the square root of the frame area, so a size that sits inside a
 * 16:9 cut is a fifth larger relative to the width of a 9:16 one - the library
 * is therefore swept across more than one aspect, and `--overflow` reports the
 * text that ends up outside the frame in each.
 *
 *   node scripts/check-motion-scenes.cjs
 *   node scripts/check-motion-scenes.cjs --aspects=all
 *   node scripts/check-motion-scenes.cjs --stress --overflow
 *   node scripts/check-motion-scenes.cjs --scope=classic --no-three
 *   node scripts/check-motion-scenes.cjs --only=phone-scroll,price-tiers --keep
 */

require('sucrase/register')

const fs = require('node:fs')
const path = require('node:path')
const { MOTION_SCENE_IDS } = require('../lib/ai/motion-scenes.ts')
const { composeVideoSource } = require('../lib/ai/compose.ts')
const { planStoryboard } = require('../lib/ai/planner.ts')
const { ASPECT_IDS, CLASSIC_SCENE_TYPES, THREE_SCENE_TYPES } = require('../lib/ai/storyboard.ts')

const OUT = path.join("out", "_motion-check")
const BATCH = 9

const flag = (name) => process.argv.some((arg) => arg === '--' + name)
const value = (name) => {
	const hit = process.argv.find((arg) => arg.startsWith('--' + name + '='))
	return hit ? hit.slice(name.length + 3) : ''
}

const keep = flag('keep')
const stress = flag('stress')
const overflow = flag('overflow')

/**
 * 16:9 and 9:16 are the two extremes of the unit scale and between them they
 * catch everything the square and the two in-between cuts would; `--aspects`
 * takes any comma separated list, or `all`.
 */
const aspectArg = value('aspects')
const aspects =
	aspectArg === 'all'
		? ASPECT_IDS
		: aspectArg
			? aspectArg.split(',').map((entry) => entry.trim()).filter((entry) => ASPECT_IDS.includes(entry))
			: ['16:9', '9:16']

/**
 * The fifty motion pieces are only three quarters of the library. The sixteen
 * classic scenes go through the same Headline and Copy, so a bound that fails
 * in one fails in the other, and they were never render-checked at all.
 *
 * The three WebGL scenes are included - headless Chrome does give them a
 * context here - but `--no-three` drops them, since a machine without one
 * would otherwise fail them for a reason that has nothing to do with the scene.
 */
const scope = value('scope') || 'all'
const classicIds = CLASSIC_SCENE_TYPES.filter((id) => !flag('no-three') || !THREE_SCENE_TYPES.includes(id))
const pool =
	scope === 'motion' ? MOTION_SCENE_IDS : scope === 'classic' ? classicIds : [...classicIds, ...MOTION_SCENE_IDS]

const onlyArg = value('only')
const only = onlyArg ? onlyArg.split(',').map((entry) => entry.trim()) : []
const sceneIds = only.length > 0 ? pool.filter((id) => only.includes(id)) : pool

if (aspects.length === 0) {
	console.error('no valid aspect in --aspects; expected some of ' + ASPECT_IDS.join(', '))
	process.exit(1)
}
if (sceneIds.length === 0) {
	console.error('no scene matched --only')
	process.exit(1)
}

/**
 * Copy long enough to push every renderer past the size it was drawn around.
 *
 * The default sample is the copy a good brief produces. The stress sample is
 * the copy a bad one produces, which is what the fit helpers exist for.
 */
const LONG_HEADLINE =
	'The complete operating picture for distributed engineering teams that ship every single day'
const LONG_LINES = [
	'Consolidated reporting across every region',
	'Zero manual reconciliation at month end',
	'Forecasts that survive contact with reality',
	'One number the whole leadership team trusts',
	'Audit trails nobody has to assemble by hand',
	'Onboarding measured in hours, never quarters',
]
const LONG_ITEMS = [
	'Continuous deployment pipeline',
	'Cross-region failover orchestration',
	'Automated compliance evidence',
	'Unified customer identity graph',
	'Real-time anomaly detection',
	'Self-service analytics workspace',
]

const sampleScene = (type, index) => ({
	type,
	seconds: 3,
	kicker: stress ? 'Chapter ' + (index + 1) + ' of the annual review' : 'Chapter ' + (index + 1),
	headline: stress ? LONG_HEADLINE : 'The ' + type.replace(/-/g, ' ') + ' scene',
	caption: stress
		? 'A caption that keeps going well past the point any layout was drawn around it, which is the point.'
		: 'A caption that runs a little longer so wrapping is exercised.',
	lines: stress ? LONG_LINES : ['First idea', 'Second idea', 'Third idea', 'Fourth idea', 'Fifth idea', 'Sixth idea'],
	items: (stress ? LONG_ITEMS : ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta']).map((title, itemIndex) => ({
		title,
		detail: stress
			? 'A supporting detail for ' + title.toLowerCase() + ' that runs to a second line on any narrow card'
			: 'Detail line for ' + title,
		icon: ['spark', 'layers', 'target', 'bolt', 'globe', 'check'][itemIndex % 6],
	})),
	stats: [
		{ value: 62, prefix: '', suffix: '%', label: stress ? 'Coverage across every region' : 'Coverage', decimals: 0 },
		{ value: stress ? 18420 : 18, prefix: '$', suffix: 'k', label: stress ? 'Sessions per working day' : 'Sessions', decimals: 0 },
		{ value: 4.5, prefix: '', suffix: 'x', label: stress ? 'Faster than the previous stack' : 'Faster', decimals: 1 },
		{ value: 240, prefix: '', suffix: '', label: stress ? 'Cities with a live deployment' : 'Cities', decimals: 0 },
	],
	icon: 'spark',
})

/**
 * One sample per classic scene type.
 *
 * These carry their own shapes rather than the one shape every motion piece
 * takes, so each is built explicitly. Everything text-bearing draws from the
 * same copy the motion samples use, which is what makes the stress run mean
 * the same thing on both halves of the library.
 */
const ICONS = ['spark', 'layers', 'target', 'bolt', 'globe', 'check']

const classicScene = (type, index) => {
	const headline = stress ? LONG_HEADLINE : 'The ' + type + ' scene'
	const caption = stress
		? 'A caption that keeps going well past the point any layout was drawn around it, which is the point.'
		: 'A caption that runs a little longer so wrapping is exercised.'
	const lines = stress ? LONG_LINES : ['First idea', 'Second idea', 'Third idea', 'Fourth idea']
	const items = (stress ? LONG_ITEMS : ['Alpha', 'Beta', 'Gamma', 'Delta']).map((title, itemIndex) => ({
		title,
		detail: stress
			? 'A supporting detail for ' + title.toLowerCase() + ' that runs to a second line on any narrow card'
			: 'Detail line for ' + title,
		icon: ICONS[itemIndex % ICONS.length],
	}))
	const base = { type, seconds: 3 }

	switch (type) {
		case 'title':
			return { ...base, kicker: 'Chapter ' + (index + 1), headline, subline: caption, icon: 'spark' }
		case 'statement':
			return { ...base, text: headline, highlight: 'operating', footnote: caption }
		case 'timeline':
			return {
				...base,
				headline,
				events: lines.slice(0, 4).map((line, at) => ({
					marker: String(2021 + at),
					title: line,
					detail: stress ? 'What actually changed in the quarter that followed' : 'Detail for ' + line,
				})),
			}
		case 'map':
			return {
				...base,
				headline,
				caption,
				connect: true,
				places: lines.slice(0, 4).map((line, at) => ({
					name: line,
					detail: stress ? 'Regional headquarters and primary data residency' : 'Detail',
					x: 0.2 + at * 0.2,
					y: 0.3 + (at % 2) * 0.3,
				})),
			}
		case 'landscape':
			return { ...base, terrain: 'mountain', timeOfDay: 'dusk', headline, caption }
		case 'monument':
			return { ...base, structure: 'tower', headline, caption }
		case 'gallery':
			return { ...base, headline, items }
		case 'stats':
			return {
				...base,
				headline,
				stats: [
					{ value: 62, prefix: '', suffix: '%', label: stress ? 'Coverage across every region' : 'Coverage', decimals: 0 },
					{ value: stress ? 18420 : 18, prefix: '$', suffix: 'k', label: stress ? 'Sessions per working day' : 'Sessions', decimals: 0 },
					{ value: 4.5, prefix: '', suffix: 'x', label: stress ? 'Faster than the previous stack' : 'Faster', decimals: 1 },
				],
			}
		case 'chart':
			return {
				...base,
				headline,
				unit: stress ? 'thousand sessions' : '%',
				bars: lines.slice(0, 4).map((line, at) => ({ label: line, value: 20 + at * 18 })),
			}
		case 'process':
			return { ...base, headline, steps: items }
		case 'quote':
			return {
				...base,
				quote: stress
					? 'We stopped arguing about the numbers the week we could all see the same ones, and the arguing never came back'
					: 'A short line worth repeating',
				attribution: stress ? 'Head of Platform Engineering, a company with a long name' : 'Someone',
			}
		case 'cta':
			return { ...base, headline, subline: caption, tagline: stress ? 'Start the pilot this quarter' : 'Start now', icon: 'bolt' }
		case 'object3d':
			return { ...base, solid: 'crystal', headline, caption, wireframe: false }
		case 'globe3d':
			return {
				...base,
				headline,
				caption,
				places: lines.slice(0, 4).map((line, at) => ({ name: line, detail: 'Detail', x: 0.2 + at * 0.2, y: 0.4 })),
			}
		case 'terrain3d':
			return { ...base, terrain: 'valley', headline, caption }
		case 'carousel3d':
			return { ...base, headline, items }
		default:
			return sampleScene(type, index)
	}
}

const buildScene = (type, index) =>
	MOTION_SCENE_IDS.includes(type) ? sampleScene(type, index) : classicScene(type, index)

/**
 * A module appended to the bundled entry that measures the mounted frame.
 *
 * It has to run inside the browser, after layout and before the still is taken,
 * which is what delayRender is for. Only leaf text nodes are measured: a parent
 * that is deliberately larger than the frame - a travelling panel, a rain
 * column - is not a fault, but the words inside it leaving the frame usually
 * are. Some scenes do carry copy off frame on purpose, so this reports rather
 * than fails.
 */
const OVERFLOW_PROBE = `
import { delayRender as __probeDelay, continueRender as __probeContinue } from 'remotion'

if (typeof window !== 'undefined' && !window.__motionOverflowProbe) {
	window.__motionOverflowProbe = true
	const __probeHandle = __probeDelay('motion-overflow-probe')

	/**
	 * What the viewer actually sees of one node.
	 *
	 * A phone mock-up clips its own feed and a window mock-up clips its own
	 * page, so the raw bounding box of a row inside one of them sits outside the
	 * frame while nothing is visibly wrong. Intersecting the node with every
	 * ancestor that clips gives the box that really reaches the screen.
	 */
	const __probeVisible = (node) => {
		let box = node.getBoundingClientRect()
		let parent = node.parentElement
		while (parent) {
			const style = window.getComputedStyle(parent)
			if (style.overflow !== 'visible' || style.overflowX !== 'visible' || style.overflowY !== 'visible') {
				const clip = parent.getBoundingClientRect()
				box = {
					left: Math.max(box.left, clip.left),
					top: Math.max(box.top, clip.top),
					right: Math.min(box.right, clip.right),
					bottom: Math.min(box.bottom, clip.bottom),
				}
				if (box.right <= box.left || box.bottom <= box.top) return null
			}
			parent = parent.parentElement
		}
		return box
	}

	const __probeMeasure = () => {
		try {
			const seen = new Set()
			for (const node of Array.from(document.querySelectorAll('*'))) {
				if (node.children.length > 0) continue
				const text = (node.textContent || '').trim()
				if (!text) continue
				const style = window.getComputedStyle(node)
				if (style.opacity === '0' || style.visibility === 'hidden') continue
				const box = __probeVisible(node)
				if (!box) continue
				if (box.right - box.left < 1 || box.bottom - box.top < 1) continue
				const out = Math.max(-box.left, -box.top, box.right - window.innerWidth, box.bottom - window.innerHeight)
				if (out <= 1) continue
				const key = text.slice(0, 40)
				if (seen.has(key)) continue
				seen.add(key)
				console.log('MOTION_OVERFLOW ' + Math.round(out) + ' :: ' + text.slice(0, 64).replace(/\s+/g, ' '))
			}
		} catch (error) {
			console.log('MOTION_OVERFLOW_PROBE_FAILED :: ' + String(error).slice(0, 120))
		}
		__probeContinue(__probeHandle)
	}
	requestAnimationFrame(() => requestAnimationFrame(__probeMeasure))
}
`

async function main() {
	const { bundle } = await import('@remotion/bundler')
	const { ensureBrowser, renderStill, selectComposition } = await import('@remotion/renderer')

	fs.rmSync(OUT, { recursive: true, force: true })
	fs.mkdirSync(OUT, { recursive: true })

	/**
	 * Bundle beside the output rather than in the system temp directory.
	 *
	 * On Windows os.tmpdir() is on the system drive, and one sweep across five
	 * aspects leaves a bundle per batch per aspect there. A full system drive
	 * then fails the run for a reason that has nothing to do with the scenes,
	 * so the bundles are kept on whatever drive the project lives on and are
	 * cleared with the rest of the output.
	 */
	const scratch = path.resolve(OUT, '_tmp')
	fs.mkdirSync(scratch, { recursive: true })
	process.env.TMPDIR = scratch
	process.env.TEMP = scratch
	process.env.TMP = scratch

	await ensureBrowser()

	const base = planStoryboard('A reference film for the motion scene library', {
		creativeSeed: '90000000-0000-4000-8000-000000000001',
	})

	const failures = []
	const spills = []
	let checked = 0
	let expected = 0

	for (const aspect of aspects) {
		const tag = aspect.replace(':', 'x')
		process.stdout.write('\n' + aspect + (stress ? ' (stress copy)' : '') + '\n')

		for (let start = 0; start < sceneIds.length; start += BATCH) {
			const batch = sceneIds.slice(start, start + BATCH)
			expected += batch.length
			const storyboard = {
				...base,
				aspect,
				dimension: batch.some((type) => THREE_SCENE_TYPES.includes(type)) ? 'three' : base.dimension,
				title: 'Motion Check ' + tag + ' ' + (start / BATCH + 1),
				seconds: batch.length * 3,
				scenes: batch.map((type, index) => buildScene(type, index)),
			}

			const composed = composeVideoSource(storyboard)
			const entry = path.join(OUT, 'batch-' + tag + '-' + start + '.tsx')
			fs.writeFileSync(entry, overflow ? composed.code + OVERFLOW_PROBE : composed.code)

			let serveUrl
			try {
				serveUrl = await bundle({ entryPoint: path.resolve(entry) })
			} catch (error) {
				for (const type of batch) failures.push({ aspect, type, error: 'bundle: ' + String(error).slice(0, 200) })
				continue
			}

			const composition = await selectComposition({ serveUrl, id: composed.compositionId })

			for (const [index, timing] of composed.layout.timings.entries()) {
				const frame = Math.min(
					composition.durationInFrames - 1,
					timing.from + Math.floor(timing.durationInFrames * 0.55),
				)
				const output = path.join(OUT, batch[index] + '-' + tag + '.png')
				const seen = []
				try {
					await renderStill({
						serveUrl,
						composition,
						frame,
						output,
						scale: 0.3,
						imageFormat: 'png',
						onBrowserLog: overflow
							? (log) => {
									const text = log.text || ''
									if (text.startsWith('MOTION_OVERFLOW')) seen.push(text.replace('MOTION_OVERFLOW ', ''))
								}
							: null,
					})
					const size = fs.statSync(output).size
					if (size < 3_000) failures.push({ aspect, type: batch[index], error: 'frame is suspiciously empty (' + size + ' bytes)' })
					if (seen.length > 0) spills.push({ aspect, type: batch[index], lines: seen })
					checked += 1
				} catch (error) {
					failures.push({ aspect, type: batch[index], error: String(error).slice(0, 240) })
				}
			}
			process.stdout.write('  batch ' + (start / BATCH + 1) + ' done\n')
		}
	}

	console.log('\nchecked ' + checked + '/' + expected + ' scene renders across ' + aspects.join(', '))

	if (overflow) {
		if (spills.length === 0) {
			console.log('no text measured outside the frame')
		} else {
			console.log(
				'\nTEXT OUTSIDE THE FRAME (' + spills.length + ' scene renders) - review, some scenes carry copy off frame on purpose',
			)
			for (const spill of spills) {
				console.log('  ' + spill.type + ' @ ' + spill.aspect)
				for (const line of spill.lines.slice(0, 4)) console.log('    ' + line)
				if (spill.lines.length > 4) console.log('    ...and ' + (spill.lines.length - 4) + ' more')
			}
		}
	}

	if (failures.length > 0) {
		console.log('\nFAILURES')
		for (const failure of failures) console.log('  ' + failure.type + ' @ ' + failure.aspect + ': ' + failure.error)
	} else {
		console.log('every scene rendered')
	}

	if (!keep) {
		for (const file of fs.readdirSync(OUT)) {
			if (file.endsWith('.tsx')) fs.rmSync(path.join(OUT, file))
		}
		// The browser can still hold a handle to a bundle it served, so a scratch
		// directory that refuses to go is left for the next run to clear.
		try {
			fs.rmSync(scratch, { recursive: true, force: true })
		} catch {}
	}
	process.exitCode = failures.length > 0 ? 1 : 0
}

main().catch((error) => {
	console.error(error)
	process.exitCode = 1
})
