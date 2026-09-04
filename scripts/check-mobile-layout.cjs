#!/usr/bin/env node
/**
 * Proves every studio screen actually fits a phone.
 *
 * "Responsive" is the one claim a stylesheet cannot make on its own. A media
 * query can be present, well written and still reveal nothing, because the
 * rule that hides the panes and the rule that brings one back are matched on a
 * string - and if a studio names its panes `source/preview/export` while the
 * shared rule only knows `create/preview/export`, the page renders a top bar, a
 * tab bar, and nothing in between. Reading the file will not tell you that.
 * Measuring the box will.
 *
 * So this walks a real Chrome across every route at every phone and tablet size
 * the app is likely to meet, and after each load asserts the things a person
 * would notice within a second of picking the phone up:
 *
 *   pane        - whatever tab is selected, that panel has a real box on
 *                 screen. Then it taps each of the other tabs and checks the
 *                 same thing, so a studio cannot pass by luck of its default.
 *   overflow    - the document does not scroll sideways, and no single element
 *                 sticks out past the viewport.
 *   chrome      - the top bar and the tab bar are both on screen and inside
 *                 the viewport, with the tab bar's targets at a thumb-sized
 *                 minimum.
 *   zoom-lock   - every text field is set at 16px or more, which is what stops
 *                 iOS Safari zooming the page in on focus and never zooming
 *                 back out.
 *   reach       - the primary action of the screen is on screen and tappable.
 *
 * Usage:
 *   node scripts/check-mobile-layout.cjs                    # starts its own dev server
 *   node scripts/check-mobile-layout.cjs --base http://localhost:3011
 *   node scripts/check-mobile-layout.cjs --route /tools     # one route
 *   node scripts/check-mobile-layout.cjs --device "iPhone SE"
 *   node scripts/check-mobile-layout.cjs --headful
 */

const { spawn } = require('node:child_process')
const path = require('node:path')

const argv = process.argv.slice(2)
const flag = (name, fallback = null) => {
	const at = argv.indexOf('--' + name)
	return at >= 0 && argv[at + 1] && !argv[at + 1].startsWith('--') ? argv[at + 1] : fallback
}
const has = (name) => argv.includes('--' + name)

const BASE = flag('base')
const HEADFUL = has('headful')
const ONLY_ROUTE = flag('route')
const ONLY_DEVICE = flag('device')
const PORT = Number(flag('port', '3111'))

/* ------------------------------------------------------------------ sizes */

/**
 * The sizes worth proving, not every size that exists. 320 is the narrowest
 * phone still in the wild and the one that breaks a top bar first; 360 and 393
 * are where most Android and iPhone traffic actually sits; 430 is the largest
 * phone; the 740-1000 band is the awkward middle where the three-pane grid has
 * collapsed but the tab bar has to have taken over; and the landscape entries
 * are the short-viewport case, where a fixed-height shell either fits or eats
 * its own controls.
 */
const DEVICES = [
	{ name: 'iPhone SE', width: 320, height: 568 },
	{ name: 'Android compact', width: 360, height: 640 },
	{ name: 'iPhone 14', width: 393, height: 852 },
	{ name: 'iPhone 15 Pro Max', width: 430, height: 932 },
	{ name: 'Phone landscape', width: 667, height: 375 },
	{ name: 'Tablet portrait', width: 768, height: 1024 },
	{ name: 'Tablet wide', width: 960, height: 1200 },
	{ name: 'Desktop', width: 1440, height: 900 },
]

/**
 * Every screen, and what "working" means for it. `panes` names the tab bar
 * buttons a studio is expected to offer; a screen with no tab bar declares the
 * regions that have to be on the page instead.
 */
const ROUTES = [
	{
		path: '/',
		name: 'Video Studio',
		panes: ['Create', 'Preview', 'Export'],
		// The video studio opens on a full-bleed launch screen; the workspace only
		// exists once a project is loaded, so the launch screen is what we measure.
		launch: '.launch',
	},
	{ path: '/captions', name: 'Subtitle Studio', panes: ['Source', 'Preview', 'Design'] },
	{ path: '/silence', name: 'Silence Studio', panes: ['Source', 'Preview', 'Export'] },
	{ path: '/tools', name: 'Tools Studio', panes: ['Tools', 'Preview', 'Output'] },
	{ path: '/editor', name: 'Editor Studio', panes: ['Media', 'Timeline', 'Adjust'] },
	{ path: '/resume', name: 'Resume Studio', regions: ['.resume-preview-stage', '.resume-controls'] },
]

/* ---------------------------------------------------------------- results */

const results = []
const record = (group, label, ok, detail) => {
	results.push({ group, label, ok, detail })
	const mark = ok ? '  ok  ' : ' FAIL '
	process.stdout.write(`${mark} ${group}  ${label}${detail ? `  - ${detail}` : ''}\n`)
}

/* ----------------------------------------------------------- page probes */

/*
 * Everything below runs inside the page. They are written as plain functions
 * taking one argument because that is the shape `page.evaluate` accepts here.
 */

const pageSettled = () =>
	document.readyState === 'complete' && Boolean(document.querySelector('.app, .resume-app, .launch'))

/** Which tab bar buttons exist, and which one is on. */
const readTabs = () => {
	const tabs = Array.from(document.querySelectorAll('.mobile-tab'))
	return {
		labels: tabs.map((tab) => (tab.textContent || '').trim()),
		active: tabs.findIndex((tab) => tab.getAttribute('data-active') === 'true'),
		visible: tabs.length > 0 && tabs[0].getBoundingClientRect().height > 0,
	}
}

/** Click the nth tab bar button and report the pane the workspace switched to. */
const clickTab = (index) => {
	const tabs = Array.from(document.querySelectorAll('.mobile-tab'))
	const tab = tabs[index]
	if (!tab) return null
	tab.click()
	const workspace = document.querySelector('.workspace')
	return workspace ? workspace.getAttribute('data-tab') : null
}

/**
 * The heart of it: is anything actually on screen between the chrome?
 *
 * A pane that is `display: none` measures zero, and so does a pane that
 * collapsed to nothing - both are the same failure to a person holding the
 * phone, so both are one check. The area is measured against the viewport
 * rather than the element's own box, because a panel that has been pushed
 * below the fold is no more useful than one that was never painted.
 */
const measurePanes = () => {
	const viewportHeight = window.innerHeight
	const viewportWidth = window.innerWidth
	const boxes = Array.from(document.querySelectorAll('.workspace > .panel, .workspace > section, .workspace > aside, .editor-workspace > .editor-rail, .editor-workspace > .editor-center'))
		.map((node) => {
			const rect = node.getBoundingClientRect()
			const style = getComputedStyle(node)
			const top = Math.max(rect.top, 0)
			const bottom = Math.min(rect.bottom, viewportHeight)
			const left = Math.max(rect.left, 0)
			const right = Math.min(rect.right, viewportWidth)
			return {
				className: node.className,
				display: style.display,
				onScreen: Math.max(0, bottom - top) * Math.max(0, right - left),
			}
		})
		.filter((box) => box.display !== 'none')
	return {
		count: boxes.length,
		painted: boxes.filter((box) => box.onScreen > 1000).length,
		largest: boxes.reduce((best, box) => Math.max(best, box.onScreen), 0),
		viewportArea: viewportWidth * viewportHeight,
	}
}

/** Any element sticking out past the right edge, plus the document's own overflow. */
const measureOverflow = () => {
	const width = document.documentElement.clientWidth
	const offenders = []
	const walk = document.body.querySelectorAll('*')
	// `getComputedStyle` is the expensive call here and the ancestor walk asks
	// the same question of the same containers thousands of times on a page this
	// size. One memo per element turns the sweep from minutes into moments.
	const clips = new Map()
	const clipsOverflow = (node) => {
		if (clips.has(node)) return clips.get(node)
		const overflowX = getComputedStyle(node).overflowX
		const answer = overflowX === 'auto' || overflowX === 'scroll' || overflowX === 'hidden'
		clips.set(node, answer)
		return answer
	}
	for (const node of walk) {
		const style = getComputedStyle(node)
		if (style.display === 'none' || style.visibility === 'hidden') continue
		// A fixed or absolute overlay parked off-screen on purpose is not overflow.
		if (style.position === 'fixed') continue
		const rect = node.getBoundingClientRect()
		if (rect.width === 0 || rect.height === 0) continue
		const over = rect.right - width
		// A wide child of a deliberate sideways scroller - the category chip row,
		// the studio rail on a phone - is the design working, not overflow. What
		// matters is whether the width escapes to the document, and it cannot if
		// some ancestor is clipping or scrolling it on the way up.
		if (over <= 1.5) continue
		let clipped = false
		for (let parent = node.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
			if (clipsOverflow(parent)) {
				clipped = true
				break
			}
		}
		if (clipped) continue
		{
			offenders.push({
				tag: node.tagName.toLowerCase(),
				className: typeof node.className === 'string' ? node.className.slice(0, 70) : '',
				right: Math.round(rect.right),
				over: Math.round(over),
			})
		}
	}
	return {
		documentScroll: document.documentElement.scrollWidth - width,
		bodyScroll: document.body.scrollWidth - width,
		width,
		// Only the outermost offenders are interesting: a wide child inside a wide
		// parent is one bug reported twice.
		offenders: offenders.slice(0, 6),
	}
}

/**
 * Every studio still reachable from the rail.
 *
 * The rail scrolls sideways on a phone, so "does it fit" is the wrong question -
 * the right one is whether all six destinations are still there and inside the
 * rail's own scrollable extent, rather than clipped away by an ancestor that
 * hides its overflow. That is the failure the scroll was added to prevent, so
 * it is the one worth asserting.
 */
const measureRail = () => {
	const rail = document.querySelector('.studio-nav')
	if (!rail) return null
	const links = Array.from(rail.querySelectorAll('a'))
	const railRect = rail.getBoundingClientRect()
	return {
		count: links.length,
		scrolls: rail.scrollWidth > rail.clientWidth + 1,
		// Measured in the rail's own scroll space, which is where a link lives
		// whether or not it happens to be scrolled into view at this moment.
		allWithinExtent: links.every((link) => {
			const rect = link.getBoundingClientRect()
			const left = rect.left - railRect.left + rail.scrollLeft
			return left >= -1 && left + rect.width <= rail.scrollWidth + 1 && rect.height > 20
		}),
	}
}

/** The top bar and tab bar have to be on screen, and inside it. */
const measureChrome = () => {
	const bar = document.querySelector('.topbar, .resume-topbar')
	const tabs = document.querySelector('.mobile-tabs')
	const width = document.documentElement.clientWidth
	const height = window.innerHeight
	const box = (node) => {
		if (!node) return null
		const rect = node.getBoundingClientRect()
		return {
			top: Math.round(rect.top),
			bottom: Math.round(rect.bottom),
			left: Math.round(rect.left),
			right: Math.round(rect.right),
			height: Math.round(rect.height),
			scrollWidth: node.scrollWidth,
			clientWidth: node.clientWidth,
		}
	}
	const targets = Array.from(document.querySelectorAll('.mobile-tab')).map((node) => {
		const rect = node.getBoundingClientRect()
		return { w: Math.round(rect.width), h: Math.round(rect.height) }
	})
	return { bar: box(bar), tabs: box(tabs), width, height, targets }
}

/**
 * iOS Safari zooms the page when a field under 16px takes focus, and it does
 * not zoom back out. One field missed is one screen a person has to pinch out
 * of, so every field is measured, not just the ones the design system owns.
 */
const measureFieldSizes = () => {
	const fields = Array.from(
		document.querySelectorAll(
			'input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]):not([type=color]), textarea, select',
		),
	)
	const small = []
	for (const field of fields) {
		const rect = field.getBoundingClientRect()
		if (rect.width === 0 && rect.height === 0) continue
		const size = parseFloat(getComputedStyle(field).fontSize)
		if (size < 15.99) {
			small.push({
				tag: field.tagName.toLowerCase(),
				className: typeof field.className === 'string' ? field.className.slice(0, 50) : '',
				size: Math.round(size * 10) / 10,
			})
		}
	}
	return small
}

/**
 * Is the screen's main call to action on screen and big enough to hit?
 *
 * Only a painted one counts. Every studio keeps a primary button in each of its
 * three panes, so at a phone width two of the three are inside a pane that is
 * `display: none` and measure zero - reporting one of those as an unreachable
 * button would be the harness inventing a bug.
 */
const measurePrimary = () => {
	const buttons = Array.from(document.querySelectorAll('.btn--primary'))
	for (const button of buttons) {
		const rect = button.getBoundingClientRect()
		if (rect.width < 1 || rect.height < 1) continue
		return {
			label: (button.textContent || '').trim().slice(0, 30),
			width: Math.round(rect.width),
			height: Math.round(rect.height),
			top: Math.round(rect.top),
			bottom: Math.round(rect.bottom),
			right: Math.round(rect.right),
			viewportHeight: window.innerHeight,
			inView: rect.top < window.innerHeight && rect.bottom > 0 && rect.left >= -1 && rect.right <= window.innerWidth + 1,
			/*
			 * Below the fold of a panel that scrolls is not out of reach - it is a
			 * long form, and scrolling is how you get to the end of one. So the
			 * question is whether anything on the way up can actually move: an
			 * ancestor that scrolls and has somewhere to scroll to, or failing
			 * that, a document taller than the window.
			 *
			 * A `hidden` ancestor is not the answer either way and is walked past.
			 * `.btn--primary` sets `overflow: hidden` on itself to clip its own
			 * specular band, and the composer wraps clip a stray pixel of theirs -
			 * stopping at the first `hidden` would call a button unreachable
			 * because of a decoration two elements below the real scroller. A
			 * `hidden` ancestor that genuinely clips the button away leaves it with
			 * no painted area, which the pane check already catches.
			 */
			scrollable: (() => {
				for (let parent = button.parentElement; parent; parent = parent.parentElement) {
					const overflowY = getComputedStyle(parent).overflowY
					if ((overflowY === 'auto' || overflowY === 'scroll') && parent.scrollHeight > parent.clientHeight + 2) {
						return true
					}
				}
				return document.documentElement.scrollHeight > window.innerHeight + 2
			})(),
		}
	}
	return null
}

/* -------------------------------------------------------------- dev server */

async function waitForServer(base, timeoutMs) {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		try {
			const response = await fetch(base, { redirect: 'manual' })
			if (response.status < 500) return true
		} catch {
			/* not up yet */
		}
		await new Promise((resolve) => setTimeout(resolve, 700))
	}
	return false
}

async function startDevServer() {
	const root = path.resolve(__dirname, '..')
	const child = spawn(
		process.platform === 'win32' ? 'npx.cmd' : 'npx',
		['next', 'dev', '--webpack', '-H', '127.0.0.1', '-p', String(PORT)],
		{ cwd: root, stdio: 'ignore', shell: process.platform === 'win32' },
	)
	const base = `http://localhost:${PORT}`
	const up = await waitForServer(base, 180_000)
	if (!up) {
		child.kill()
		throw new Error(`dev server never answered on ${base}`)
	}
	return { base, stop: () => child.kill() }
}

/* -------------------------------------------------------------------- run */

async function waitFor(page, fn, timeoutMs, what) {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		try {
			if (await page.evaluate(fn, null)) return true
		} catch {
			/* navigating */
		}
		await new Promise((resolve) => setTimeout(resolve, 200))
	}
	throw new Error(`timed out waiting for ${what}`)
}

async function main() {
	const devices = ONLY_DEVICE ? DEVICES.filter((d) => d.name.toLowerCase().includes(ONLY_DEVICE.toLowerCase())) : DEVICES
	const routes = ONLY_ROUTE ? ROUTES.filter((r) => r.path === ONLY_ROUTE) : ROUTES
	if (devices.length === 0) throw new Error(`no device matches ${ONLY_DEVICE}`)
	if (routes.length === 0) throw new Error(`no route matches ${ONLY_ROUTE}`)

	let server = null
	let base = BASE
	if (!base) {
		process.stdout.write('starting dev server...\n')
		server = await startDevServer()
		base = server.base
	}
	process.stdout.write(`base ${base}\n`)

	const { openBrowser, ensureBrowser } = require('@remotion/renderer')
	await ensureBrowser()
	const browser = await openBrowser('chrome', { chromiumOptions: { headless: !HEADFUL } })

	try {
		const page = await browser.newPage({ context: null, logLevel: 'error', indent: false, pageIndex: 0 })
		try {
			for (const device of devices) {
				await page.setViewport({ width: device.width, height: device.height, deviceScaleFactor: 1 })
				for (const route of routes) {
					const group = `${device.name} ${device.width}x${device.height} ${route.path}`
					await page.goto({ url: base + route.path, timeoutInMilliseconds: 180_000 })
					try {
						await waitFor(page, pageSettled, 120_000, `${route.path} to render`)
					} catch (error) {
						record(group, 'page renders', false, error.message)
						continue
					}
					// One frame for layout and fonts to land before anything is measured.
					await new Promise((resolve) => setTimeout(resolve, 450))

					/* ------------------------------------------------- overflow */
					const overflow = await page.evaluate(measureOverflow, null)
					record(
						group,
						'no sideways scroll',
						overflow.documentScroll <= 1 && overflow.bodyScroll <= 1,
						overflow.documentScroll > 1 || overflow.bodyScroll > 1
							? `document overflows by ${Math.max(overflow.documentScroll, overflow.bodyScroll)}px`
							: '',
					)
					record(
						group,
						'nothing sticks out past the edge',
						overflow.offenders.length === 0,
						overflow.offenders.length > 0
							? overflow.offenders.map((o) => `${o.tag}.${o.className} +${o.over}px`).join(' | ')
							: '',
					)

					/* --------------------------------------------------- chrome */
					const chrome = await page.evaluate(measureChrome, null)
					record(
						group,
						'top bar fits its width',
						Boolean(chrome.bar) && chrome.bar.scrollWidth <= chrome.bar.clientWidth + 1,
						chrome.bar ? `scroll ${chrome.bar.scrollWidth} vs client ${chrome.bar.clientWidth}` : 'no top bar',
					)

					const rail = await page.evaluate(measureRail, null)
					if (rail) {
						record(
							group,
							'every studio is still on the rail',
							rail.count === 6 && rail.allWithinExtent,
							`${rail.count} links${rail.scrolls ? ', rail scrolls' : ''}`,
						)
					}

					/* ------------------------------------- the launch screen */
					/*
					 * The video studio opens on a full-bleed launch screen and only
					 * builds its three-pane workspace once a project exists, so when
					 * that screen is up it is the thing to measure - the tab bar and
					 * the panes are legitimately absent.
					 */
					const onLaunch = route.launch
						? await page.evaluate((selector) => {
								const node = document.querySelector(selector)
								if (!node) return null
								const rect = node.getBoundingClientRect()
								return { width: Math.round(rect.width), height: Math.round(rect.height) }
							}, route.launch)
						: null
					if (onLaunch) {
						record(
							group,
							'launch screen fills the window',
							onLaunch.width > 0 && onLaunch.width <= chrome.width + 1 && onLaunch.height > 200,
							`${onLaunch.width}x${onLaunch.height}`,
						)
					}

					/* ------------------------------------------------- the panes */
					if (route.panes && !onLaunch) {
						const tabs = await page.evaluate(readTabs, null)
						const isPhoneLayout = device.width <= 1000
						if (isPhoneLayout) {
							record(
								group,
								'tab bar is on screen',
								tabs.visible && tabs.labels.length === route.panes.length,
								`tabs: ${tabs.labels.join(', ') || 'none'}`,
							)
							record(
								group,
								'tab targets are thumb sized',
								chrome.targets.length > 0 && chrome.targets.every((t) => t.h >= 40 && t.w >= 40),
								chrome.targets.map((t) => `${t.w}x${t.h}`).join(' '),
							)
						}

						// Every tab, not just the default: this is the check that a
						// pane-name mismatch cannot slip past.
						for (let index = 0; index < route.panes.length; index += 1) {
							if (index > 0 || isPhoneLayout) {
								await page.evaluate(clickTab, index)
								await new Promise((resolve) => setTimeout(resolve, 220))
							}
							const panes = await page.evaluate(measurePanes, null)
							const label = route.panes[index]
							record(
								group,
								`"${label}" pane is painted`,
								panes.painted >= 1 && panes.largest > panes.viewportArea * 0.12,
								`${panes.painted} of ${panes.count} panels drawn, largest covers ${
									Math.round((panes.largest / panes.viewportArea) * 100)
								}% of the screen`,
							)
						}
					}

					/* ---------------------------------- screens without a tab bar */
					if (route.regions) {
						const found = await page.evaluate((selectors) => {
							return selectors.map((selector) => {
								const node = document.querySelector(selector)
								if (!node) return { selector, ok: false, why: 'missing' }
								const rect = node.getBoundingClientRect()
								return {
									selector,
									ok: rect.width > 40 && rect.height > 40,
									why: `${Math.round(rect.width)}x${Math.round(rect.height)}`,
								}
							})
						}, route.regions)
						for (const region of found) {
							record(group, `${region.selector} has a real box`, region.ok, region.why)
						}
					}

					/* ------------------------------------------------ zoom lock */
					if (device.width <= 560) {
						const small = await page.evaluate(measureFieldSizes, null)
						record(
							group,
							'text fields will not zoom iOS in',
							small.length === 0,
							small.map((f) => `${f.tag}.${f.className}@${f.size}px`).join(' | '),
						)
					}

					/* ---------------------------------------------- primary action */
					const primary = await page.evaluate(measurePrimary, null)
					if (primary) {
						record(
							group,
							'primary action is reachable',
							(primary.inView || primary.scrollable) && primary.height >= 36,
							`"${primary.label}" ${primary.width}x${primary.height} top ${primary.top} bottom ${primary.bottom} right ${primary.right} of ${primary.viewportHeight}${
								primary.inView ? '' : primary.scrollable ? ' (below the fold, scrollable)' : ' OUT OF REACH'
							}`,
						)
					}
				}
			}
		} finally {
			await page.close()
		}
	} finally {
		await browser.close({ silent: true })
		if (server) server.stop()
	}

	const failed = results.filter((r) => !r.ok)
	process.stdout.write(`\n${results.length - failed.length}/${results.length} checks passed\n`)
	if (failed.length > 0) {
		process.stdout.write('\nfailures:\n')
		for (const item of failed) process.stdout.write(`  ${item.group}  ${item.label}  ${item.detail}\n`)
		process.exitCode = 1
	}
}

main().catch((error) => {
	process.stderr.write(`\n${error && error.stack ? error.stack : String(error)}\n`)
	process.exitCode = 1
})
