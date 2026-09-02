/**
 * Verifies the object layer of the Subtitle Studio without touching the
 * network, a GPU, or a video file.
 *
 * Ten things are checked, because these are the parts that fail quietly and
 * come out as a wrong-looking video rather than as an exception:
 *
 *   1. the catalogue        - every asset the matcher can choose exists on
 *                             disk, no id is claimed twice, and a family picks
 *                             the same variant on every run
 *   2. the matcher          - a sentence picks the thing it is about, plurals
 *                             and verb endings reach their root, Devanagari
 *                             survives the tokeniser, a line about nothing
 *                             gets nothing
 *   3. the planner          - consecutive cues about one subject become one
 *                             shot, nothing repeats back to back, a rare word
 *                             outranks a repeated one, dense speech does not
 *                             become a slideshow, and no shot overlaps another
 *                             or outlives the clip
 *   4. the head anchor      - the crown is found on a synthetic silhouette, a
 *                             speck above the head does not become the crown,
 *                             and an empty frame reports no subject
 *   5. the anchor filter    - it removes most of a still speaker’s wobble, and
 *                             then lags less than half as far through a head
 *                             turn as a plain blend tuned to be exactly that
 *                             steady. That comparison is the whole reason the
 *                             filter is not a blend, so it is measured rather
 *                             than asserted
 *   6. placement            - aspect is kept, head-relative and frame-relative
 *                             sizing agree at a normal head, a bad mask cannot
 *                             throw the object across the screen, and nothing
 *                             enters the band the captions own
 *   7. the composited rect  - what one frame repaints covers the object with
 *                             room for its soft edges, never leaves the frame,
 *                             and stays a fraction of the picture, which is the
 *                             claim the whole compositor rests on
 *   8. timing and motion    - the entrance and exit are symmetric, zero outside
 *                             the shot, and every motion is a pure, bounded
 *                             function of elapsed time
 *   9. /api/captions/objects - a malformed request is refused, and a request
 *                             with no key comes back as a usable "plan it
 *                             locally" answer rather than an error
 *  10. the studio itself    - a real browser records a clip, imports subtitles,
 *                             plans the objects, renders a still through the
 *                             bake’s own code path, burns the objects into the
 *                             video, checks from the panel’s own report that
 *                             the model was skipped and only a corner of each
 *                             frame repainted, and puts the original back
 *
 *   node scripts/check-caption-objects.cjs                # everything
 *   node scripts/check-caption-objects.cjs --maths-only   # no browser, no server
 *   node scripts/check-caption-objects.cjs --headful      # watch it happen
 */

require('sucrase/register')

const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')

const MATHS_ONLY = process.argv.includes('--maths-only')
const HEADFUL = process.argv.includes('--headful')
/**
 * A port picked per run rather than a fixed one.
 *
 * These checks are run back to back while a feature is being written, and a
 * server that has not finished dying yet would otherwise fail the next run
 * with EADDRINUSE - a failure about the harness, not about the studio.
 */
const PORT = Number(process.env.PORT || 3300 + Math.floor(Math.random() * 400))
const BASE = `http://localhost:${PORT}`

const library = require('../lib/captions/object-library.ts')
const anchor = require('../lib/captions/object-anchor.ts')
const compositor = require('../lib/captions/object-compositor.ts')
const plan = require('../lib/captions/object-plan.ts')
const sprite = require('../lib/captions/object-sprite.ts')
const session = require('../lib/captions/session.ts')
const objectsRoute = require('../app/api/captions/objects/route.ts')

const PUBLIC_ROOT = path.join(__dirname, '..', 'public')

let checks = 0
let failures = 0

/** Returns the verdict, so a step that cannot continue past a failure can stop. */
function check(label, condition, detail) {
	checks++
	if (condition) {
		console.log(`  ok   ${label}`)
		return true
	}
	failures++
	console.log(`  FAIL ${label}`, detail === undefined ? '' : JSON.stringify(detail))
	return false
}

/** A cue with evenly spread word timings, which is all the planner reads. */
function cue(id, text, startMs, endMs) {
	const words = text.split(/\s+/).filter(Boolean)
	const step = (endMs - startMs) / Math.max(1, words.length)
	return {
		id,
		text,
		startMs,
		endMs,
		tokens: words.map((word, index) => ({
			text: word,
			fromMs: Math.round(startMs + index * step),
			toMs: Math.round(startMs + (index + 1) * step),
		})),
	}
}

/* ========================================================== 1. catalogue */

function checkCatalogue() {
	console.log('\nThe object catalogue')

	const ids = library.OBJECT_LIBRARY.map((asset) => asset.id)
	check('every asset id is unique', new Set(ids).size === ids.length)

	const missing = library.OBJECT_LIBRARY.filter((asset) => {
		const src = library.objectAssetSrc(asset, 'seed')
		return !fs.existsSync(path.join(PUBLIC_ROOT, src.replace(/^\//, '')))
	}).map((asset) => asset.id)
	check('every asset resolves to a file in the pack', missing.length === 0, missing)

	const family = library.OBJECT_LIBRARY.find((asset) => asset.variants > 0)
	const first = library.objectAssetSrc(family, 'celebration')
	const again = library.objectAssetSrc(family, 'celebration')
	const other = library.objectAssetSrc(family, 'explosion')
	check('a family picks the same variant for the same word every time', first === again)
	check('and a different word reaches a different variant', first !== other, { first, other })
	check(
		'a variant number is always three digits',
		/-\d{3}\.svg$/.test(first),
		first,
	)

	check(
		'every asset carries at least one spoken keyword',
		library.OBJECT_LIBRARY.every((asset) => asset.keywords.length > 0),
	)
	check(
		'and a sane default size',
		library.OBJECT_LIBRARY.every((asset) => asset.scale > 0.05 && asset.scale <= 1),
	)
}

/* ============================================================ 2. matching */

function checkMatching() {
	console.log('\nMatching a sentence to an object')

	check(
		'a named thing wins',
		library.matchObjectForText('I opened my laptop and started writing')?.asset.id === 'laptop',
	)
	check(
		'a plural reaches its root',
		library.matchObjectForText('we shipped two packages today')?.asset.id === 'package',
	)
	check(
		'a verb ending reaches its root',
		library.matchObjectForText('they are celebrating tonight')?.asset.id === 'confetti',
	)
	check(
		'the concrete noun beats the mood',
		library.matchObjectForText('the laptop made this amazing')?.asset.id === 'laptop',
	)
	check('a line about nothing gets nothing', library.matchObjectForText('and then, you know, anyway') === null)
	check('an empty line gets nothing', library.matchObjectForText('') === null)

	const excluded = library.matchObjectForText('open the laptop', new Set(['laptop']))
	check('an excluded asset is never returned', excluded?.asset.id !== 'laptop')

	const nepali = library.matchObjectForText('मैले कम्प्युटर किनें')
	check('a Devanagari keyword matches too', nepali?.asset.id === 'laptop', nepali?.asset.id)

	check('an exact keyword outscores a stemmed one', library.matchObjectForText('rocket')?.score === 3)
	check(
		'the matched word is echoed back as written',
		library.matchObjectForText('the ROCKET is ready')?.keyword === 'rocket',
	)

	check('a short word is never stemmed', library.stemsOf('bus').length === 0)
	check('a double s is not a plural', !library.stemsOf('business').includes('busines'))
	check('-ies becomes -y', library.stemsOf('stories').includes('story'))
	check('a doubled consonant is undone too', library.stemsOf('shipping').includes('ship'))
}

/* ============================================================= 3. planner */

function checkPlanner() {
	console.log('\nPlanning the shot list')

	const cues = [
		cue('a', 'we built a rocket', 0, 2_000),
		cue('b', 'the rocket took eight months', 2_000, 4_000),
		cue('c', 'and then we opened the laptop', 4_000, 6_000),
		cue('d', 'nothing much happened after that', 6_000, 8_000),
		cue('e', 'time to celebrate', 8_000, 10_000),
	]

	const shots = plan.planObjectsFromCues(cues, { durationMs: 10_000 })
	check('a plan is produced', shots.length > 0, shots.length)

	const rocket = shots.find((shot) => shot.assetId === 'rocket')
	check('two consecutive cues about one thing become one shot', Boolean(rocket))
	check('and that shot spans both of them', rocket && rocket.startMs === 0 && rocket.endMs >= 3_000, rocket)
	check(
		'and is trimmed back to leave a gap before the next object',
		shots.every((shot, index) => index === 0 || shot.startMs >= shots[index - 1].endMs + 699),
		shots.map((shot) => [shot.startMs, shot.endMs]),
	)

	check(
		'shots never overlap',
		shots.every((shot, index) => index === 0 || shot.startMs >= shots[index - 1].endMs),
	)
	check(
		'no shot runs past the end of the clip',
		shots.every((shot) => shot.endMs <= 10_000),
	)
	check(
		'no shot is shorter than the readability floor',
		shots.every((shot) => shot.endMs - shot.startMs >= 800),
	)
	check(
		'no shot outstays the ceiling',
		shots.every((shot) => shot.endMs - shot.startMs <= 5_000),
	)
	check(
		'a cue about nothing gets no object',
		shots.every((shot) => shot.startMs !== 6_000),
	)

	// The repeat guard: the same word twice in a row must not produce two shots
	// of the same object with a blink between them.
	const repeated = plan.planObjectsFromCues(
		[
			cue('a', 'a rocket', 0, 1_500),
			cue('b', 'nothing at all here', 1_500, 3_000),
			cue('c', 'another rocket', 3_000, 4_500),
		],
		{ durationMs: 4_500 },
	)
	check(
		'a repeat inside the avoid window is dropped, not blinked',
		repeated.filter((shot) => shot.assetId === 'rocket').length === 1,
		repeated.map((shot) => shot.assetId),
	)

	const tidied = plan.tidyShots(
		[
			{ ...plan.shotFromAsset(library.objectAssetById('rocket'), { startMs: 0, endMs: 9_000, keyword: 'rocket' }) },
			{ ...plan.shotFromAsset(library.objectAssetById('laptop'), { startMs: 3_000, endMs: 4_000, keyword: 'laptop' }) },
		],
		{ durationMs: 8_000 },
	)
	check('tidying trims a shot back off the next one', tidied[0].endMs <= tidied[1].startMs, tidied)
	check('and never past the clip', tidied.every((shot) => shot.endMs <= 8_000))

	/* --------------------------------------------- salience and spacing */

	// "rocket" in every line is wallpaper; "trophy" said once is the picture
	// worth showing. The plan should end up illustrating the rare word.
	const repetitive = [
		cue('a', 'rocket rocket rocket', 0, 2_000),
		cue('b', 'the rocket again', 2_000, 4_000),
		cue('c', 'rocket and also a trophy', 4_000, 6_000),
		cue('d', 'rocket once more', 6_000, 8_000),
	]
	const salience = plan.keywordSalience(repetitive)
	check(
		'a word in every line scores near nothing',
		salience.get('rocket') < salience.get('trophy'),
		{ rocket: salience.get('rocket'), trophy: salience.get('trophy') },
	)

	const spaced = plan.planObjectsFromCues(
		[
			cue('a', 'a rocket', 0, 900),
			cue('b', 'a laptop', 900, 1_800),
			cue('c', 'a trophy', 1_800, 2_700),
		],
		{ durationMs: 3_000, minGapMs: 700 },
	)
	check(
		'three objects in three seconds do not become a slideshow',
		spaced.length <= 2,
		spaced.map((shot) => shot.assetId),
	)
	check(
		'and the ones that survive keep their quiet',
		spaced.every((shot, index) => index === 0 || shot.startMs >= spaced[index - 1].endMs + 700 - 1),
		spaced.map((shot) => [shot.startMs, shot.endMs]),
	)

	const dense = plan.planObjectsFromCues(
		[
			cue('a', 'a rocket', 0, 900),
			cue('b', 'a laptop', 900, 1_800),
			cue('c', 'a trophy', 1_800, 2_700),
		],
		{ durationMs: 3_000, minGapMs: 0 },
	)
	check('a zero gap lets every one of them through', dense.length === 3, dense.length)

	const restored = plan.normalizeObjectShots([
		{ startMs: 0, endMs: 1_000, kind: 'library', assetId: 'rocket', keyword: 'rocket' },
		{ startMs: 0, endMs: 1_000, kind: 'library', assetId: 'not-a-real-asset' },
		{ startMs: 5, endMs: 3, kind: 'library', assetId: 'rocket' },
	])
	check('a restored plan drops an asset this build no longer has', restored.length === 1, restored.length)
	check('and rebuilds its picture address', typeof restored[0].src === 'string' && restored[0].src.length > 0)

	const settings = plan.normalizeObjectSettings({ matte: 900, model: 'nonsense', followHead: 'yes' })
	check('restored settings are clamped', settings.matte === 100)
	check('an unknown model falls back to the precise one', settings.model === 'precise')
	check('a non-boolean toggle falls back to its default', settings.followHead === true)
	check('the mask skip is on unless a snapshot turned it off', settings.adaptiveMask === true)
	check('and off when it did', plan.normalizeObjectSettings({ adaptiveMask: false }).adaptiveMask === false)
	check('an unknown size mode falls back to head-relative', settings.sizeMode === 'head')
	check('and a known one is kept', plan.normalizeObjectSettings({ sizeMode: 'frame' }).sizeMode === 'frame')
}

/* ========================================================== 4. head anchor */

/**
 * A mask with a head and shoulders in it.
 *
 * Deliberately built from two rectangles rather than from a photograph: the
 * crown row and the head centre are then known exactly, so the assertions are
 * about the algorithm and not about a fixture.
 */
function silhouette({ width, height, headTop, headLeft, headWidth, headHeight, speck }) {
	const data = new Float32Array(width * height)
	for (let y = headTop; y < headTop + headHeight; y++) {
		for (let x = headLeft; x < headLeft + headWidth; x++) data[y * width + x] = 1
	}
	// Shoulders: twice as wide, from the bottom of the head down.
	const shoulderLeft = Math.max(0, headLeft - headWidth / 2)
	const shoulderRight = Math.min(width, headLeft + headWidth * 1.5)
	for (let y = headTop + headHeight; y < height; y++) {
		for (let x = shoulderLeft; x < shoulderRight; x++) data[y * width + x] = 1
	}
	if (speck) data[speck.y * width + speck.x] = 1
	return { data, width, height }
}

function checkAnchor() {
	console.log('\nFinding the head')

	const frame = silhouette({
		width: 256,
		height: 144,
		headTop: 20,
		headLeft: 40,
		headWidth: 40,
		headHeight: 34,
	})

	const found = anchor.findHeadAnchor(frame.data, frame.width, frame.height)
	check('a subject is found', found.found === true)
	check('the crown row is the top of the head', Math.abs(found.y * 144 - 20) <= 1, found.y * 144)
	check(
		'the centre is the middle of the head, not the middle of the frame',
		Math.abs(found.x * 256 - 60) <= 4,
		found.x * 256,
	)
	check('the head width is measured', Math.abs(found.headWidth * 256 - 40) <= 6, found.headWidth * 256)
	check('coverage is a fraction of the frame', found.coverage > 0 && found.coverage < 1)

	const speckled = silhouette({
		width: 256,
		height: 144,
		headTop: 20,
		headLeft: 40,
		headWidth: 40,
		headHeight: 34,
		speck: { x: 200, y: 4 },
	})
	const withSpeck = anchor.findHeadAnchor(speckled.data, speckled.width, speckled.height)
	check(
		'one stray pixel above the head is not the crown',
		Math.abs(withSpeck.y - found.y) < 0.01,
		{ clean: found.y, speckled: withSpeck.y },
	)

	const empty = anchor.findHeadAnchor(new Float32Array(256 * 144), 256, 144)
	check('an empty frame reports no subject', empty.found === false)
	check('and falls back to a usable point', empty.x === 0.5 && empty.y > 0 && empty.y < 0.5)

	const offCentre = silhouette({
		width: 256,
		height: 144,
		headTop: 20,
		headLeft: 150,
		headWidth: 40,
		headHeight: 34,
	})
	const right = anchor.findHeadAnchor(offCentre.data, offCentre.width, offCentre.height)
	check('a speaker sitting right of centre moves the anchor right', right.x > found.x + 0.2, {
		left: found.x,
		right: right.x,
	})

	const held = anchor
		.anchorFilterFor(0.7)
		.push({ ...empty, found: false }, 1 / 30)
	check('a frame with no subject before any measurement is passed through', held.found === false)
}

/* ================================================ 4b. steadying the anchor */

const DT = 1 / 30

/** One anchor measurement, with only x moving - the axis everything reads. */
const at = (x) => ({ x, y: 0.2, headWidth: 0.2, coverage: 0.3, found: true })

/** Total frame-to-frame travel of a filter's output over a signal. */
function travelOf(pushed) {
	let total = 0
	for (let i = 1; i < pushed.length; i++) total += Math.abs(pushed[i] - pushed[i - 1])
	return total
}

/** A plain exponential blend, the thing the one-euro filter replaced. */
function runBlend(signal, keep) {
	let value = null
	return signal.map((x) => {
		value = value === null ? x : value * keep + x * (1 - keep)
		return value
	})
}

function runEuro(signal, damping) {
	const filter = anchor.anchorFilterFor(damping)
	return signal.map((x) => filter.push(at(x), DT).x)
}

function checkAnchorFilter() {
	console.log('\nSteadying the anchor')

	// Deterministic, reproducible "sensor noise": a still speaker whose anchor
	// the model measures a few thousandths differently every frame.
	const jitter = []
	for (let i = 0; i < 90; i++) jitter.push(0.5 + Math.sin(i * 2.399963) * 0.006)

	// A real head turn: a third of the frame in half a second, then still.
	const turn = []
	for (let i = 0; i < 90; i++) turn.push(i < 30 ? 0.3 : i < 45 ? 0.3 + ((i - 30) / 15) * 0.35 : 0.65)

	const euroJitter = runEuro(jitter, 0.7)
	const euroTurn = runEuro(turn, 0.7)
	const rawJitterTravel = travelOf(jitter)
	const euroJitterTravel = travelOf(euroJitter)

	check(
		'the filter removes most of a still speaker\u2019s wobble',
		euroJitterTravel < rawJitterTravel * 0.25,
		{ raw: rawJitterTravel, filtered: euroJitterTravel },
	)

	// The comparison that matters: a plain blend tuned to suppress the same
	// wobble, measured on the same head turn. This is the claim the filter is
	// there to make, so it is the claim that gets tested.
	let bestKeep = 0
	let bestGap = Infinity
	for (let keep = 0.5; keep < 0.995; keep += 0.005) {
		const gap = Math.abs(travelOf(runBlend(jitter, keep)) - euroJitterTravel)
		if (gap < bestGap) {
			bestGap = gap
			bestKeep = keep
		}
	}
	const blendTurn = runBlend(turn, bestKeep)
	/** The worst the filter is wrong by at any point during the move. */
	const peakLag = (filtered) => {
		let worst = 0
		for (let i = 30; i <= 46; i++) worst = Math.max(worst, Math.abs(filtered[i] - turn[i]))
		return worst
	}
	const euroLag = peakLag(euroTurn)
	const blendLag = peakLag(blendTurn)

	check(
		'a plain blend that steady is matched for wobble',
		Math.abs(travelOf(runBlend(jitter, bestKeep)) - euroJitterTravel) < euroJitterTravel * 0.35,
		{ keep: bestKeep.toFixed(3) },
	)
	check('and lags at least twice as far through a head turn', euroLag < blendLag * 0.5, {
		euroLag,
		blendLag,
		keep: bestKeep.toFixed(3),
	})
	check('the filter has caught up by the end of the move', Math.abs(euroTurn[89] - 0.65) < 0.01, euroTurn[89])

	const filter = anchor.anchorFilterFor(0.7)
	filter.push(at(0.4), DT)
	const lost = filter.push({ x: 0.5, y: 0.2, headWidth: 0.2, coverage: 0, found: false }, DT)
	check('a frame with no subject holds the last point', Math.abs(lost.x - 0.4) < 1e-9, lost.x)
	check('and says so', lost.found === false)

	filter.reset()
	const afterReset = filter.push(at(0.9), DT)
	check('a reset starts from the next measurement', afterReset.x === 0.9)
}

/* ============================================================ 5. placement */

function checkPlacement() {
	console.log('\nPlacing the object')

	const head = { x: 0.4, y: 0.2, headWidth: 0.18, coverage: 0.3, found: true }
	const placed = anchor.placeObject({
		anchor: head,
		frameWidth: 1920,
		frameHeight: 1080,
		spriteWidth: 512,
		spriteHeight: 256,
		scale: 0.4,
		offsetX: 0,
		offsetY: -0.1,
		followHead: true,
	})
	check('height is the requested fraction of the frame', Math.abs(placed.height - 432) < 0.5, placed.height)
	check('width keeps the sprite aspect', Math.abs(placed.width - 864) < 0.5, placed.width)
	check('the centre follows the head', Math.abs(placed.centerX - 768) < 0.5, placed.centerX)
	check('the vertical offset lifts it above the crown', Math.abs(placed.centerY - 108) < 0.5, placed.centerY)

	const pinned = anchor.placeObject({
		anchor: head,
		frameWidth: 1920,
		frameHeight: 1080,
		spriteWidth: 512,
		spriteHeight: 512,
		scale: 0.4,
		offsetX: 0,
		offsetY: 0,
		followHead: false,
	})
	check('following off pins the object to the middle', pinned.centerX === 960, pinned.centerX)

	const square = anchor.placeObject({
		anchor: head,
		frameWidth: 1080,
		frameHeight: 1920,
		spriteWidth: 300,
		spriteHeight: 300,
		scale: 0.3,
		offsetX: 0.1,
		offsetY: 0,
		followHead: true,
	})
	check('a portrait frame sizes against its own height', Math.abs(square.height - 576) < 0.5, square.height)
	check('a sideways offset is a fraction of the width', Math.abs(square.centerX - 540) < 0.5, square.centerX)

	/* ------------------------------------------------- sizing by the head */

	const base = {
		frameWidth: 1920,
		frameHeight: 1080,
		spriteWidth: 512,
		spriteHeight: 512,
		scale: 0.4,
		offsetX: 0,
		offsetY: 0,
		followHead: true,
	}
	const reference = { ...head, headWidth: anchor.REFERENCE_HEAD_WIDTH }
	check(
		'at a normal head size the two size modes agree exactly',
		Math.abs(
			anchor.placeObject({ ...base, anchor: reference, sizeMode: 'head' }).height -
				anchor.placeObject({ ...base, anchor: reference, sizeMode: 'frame' }).height,
		) < 1e-9,
	)
	const closeUp = anchor.placeObject({ ...base, anchor: { ...head, headWidth: 0.36 }, sizeMode: 'head' })
	const wide = anchor.placeObject({ ...base, anchor: { ...head, headWidth: 0.09 }, sizeMode: 'head' })
	check('a close-up grows the object', closeUp.height > base.frameHeight * 0.4, closeUp.height)
	check('and a wide shot shrinks it', wide.height < base.frameHeight * 0.4, wide.height)
	const absurd = anchor.placeObject({ ...base, anchor: { ...head, headWidth: 0.98 }, sizeMode: 'head' })
	check(
		'a mask that finds a doorway cannot throw the object across the screen',
		absurd.height <= base.frameHeight * 0.4 * 2.6,
		absurd.height,
	)

	/* ------------------------------------------------------- the safe area */

	const band = { top: 0, right: 0, bottom: 0.3, left: 0 }
	const low = anchor.placeObject({
		...base,
		anchor: { ...head, y: 0.6 },
		scale: 0.3,
		safeArea: band,
	})
	check(
		'an object is kept out of the caption band',
		low.centerY + low.height / 2 <= 1080 * 0.7 + 0.001,
		{ bottom: low.centerY + low.height / 2, limit: 1080 * 0.7 },
	)
	const huge = anchor.placeObject({ ...base, anchor: { ...head, y: 0.6 }, scale: 1.2, safeArea: band })
	check(
		'one too big to fit hangs off the open edge rather than over the captions',
		Math.abs(huge.centerY + huge.height / 2 - 1080 * 0.7) < 0.5,
		{ bottom: huge.centerY + huge.height / 2, limit: 1080 * 0.7 },
	)
	const boxed = anchor.placeObject({
		...base,
		anchor: { ...head, y: 0.6 },
		scale: 1.2,
		safeArea: { top: 0.2, right: 0, bottom: 0.3, left: 0 },
	})
	check(
		'and one boxed in on both sides is centred rather than pinned to an edge',
		Math.abs(boxed.centerY - (1080 * 0.2 + 1080 * 0.7) / 2) < 0.5,
		boxed.centerY,
	)
	const free = anchor.placeObject({ ...base, anchor: { ...head, y: 0.05 }, offsetY: -0.1 })
	check(
		'with nothing reserved, an object may hang off the top of the frame',
		free.centerY - free.height / 2 < 0,
		free.centerY,
	)
	const sideways = anchor.placeObject({
		...base,
		anchor: { ...head, x: 0.02 },
		offsetX: -0.3,
		safeArea: { top: 0, right: 0.05, bottom: 0, left: 0.05 },
	})
	check(
		'and inside the left edge',
		sideways.centerX - sideways.width / 2 >= 1920 * 0.05 - 0.001,
		sideways.centerX - sideways.width / 2,
	)
}

/* ============================================ 5b. the caption safe area */

function checkCaptionSafeArea() {
	console.log('\nThe band the captions own')

	const style = { placement: 'bottom', offsetPercent: 8, fontSizePercent: 6, lineHeight: 1.1, maxLines: 2 }
	const bottom = plan.captionSafeArea(style)
	check('a bottom caption reserves the bottom', bottom.bottom > 0.2 && bottom.top === 0, bottom)
	check(
		'and reserves more for more lines',
		plan.captionSafeArea({ ...style, maxLines: 4 }).bottom > bottom.bottom,
	)
	check(
		'and more for bigger type',
		plan.captionSafeArea({ ...style, fontSizePercent: 10 }).bottom > bottom.bottom,
	)
	const top = plan.captionSafeArea({ ...style, placement: 'top' })
	check('a top caption reserves the top instead', top.top > 0.2 && top.bottom === 0, top)
	const centre = plan.captionSafeArea({ ...style, placement: 'center' })
	check('a centred caption reserves nothing - there is nowhere to go', centre.top === 0 && centre.bottom === 0)
	check(
		'the band can never swallow the frame',
		plan.captionSafeArea({ ...style, fontSizePercent: 12, maxLines: 4, offsetPercent: 40 }).bottom <= 0.45,
	)
}

/* ============================================== 5c. what a frame repaints */

function checkAffectedRect() {
	console.log('\nWhat one frame repaints')

	const settings = { feather: 0.01, matte: 0.6, edgeShift: 0, lightWrap: 0.2, contactShadow: 0.35 }
	const request = { sprite: null, centerX: 960, centerY: 300, width: 400, height: 400, rotation: 0, alpha: 1 }
	const rect = compositor.affectedRect(request, 1920, 1080, settings)

	check('the rectangle covers the object', rect.x < 760 && rect.x + rect.width > 1160, rect)
	check('with room for the soft edge and the shadow', rect.width > 400 && rect.height > 400, rect)
	check(
		'and it is a fraction of the frame, which is the whole point',
		(rect.width * rect.height) / (1920 * 1080) < 0.25,
		((rect.width * rect.height) / (1920 * 1080)).toFixed(3),
	)

	const spun = compositor.affectedRect({ ...request, rotation: Math.PI / 4 }, 1920, 1080, settings)
	check('a rotated object claims its rotated bounds', spun.width > rect.width, {
		flat: rect.width,
		spun: spun.width,
	})

	const offEdge = compositor.affectedRect({ ...request, centerX: 20, centerY: 20 }, 1920, 1080, settings)
	check('a rectangle never leaves the frame', offEdge.x >= 0 && offEdge.y >= 0, offEdge)
	const gone = compositor.affectedRect({ ...request, centerX: -900 }, 1920, 1080, settings)
	check('an object entirely off frame claims nothing', gone === null)

	const bare = compositor.affectedRect(request, 1920, 1080, {
		...settings,
		lightWrap: 0,
		contactShadow: 0,
		feather: 0,
	})
	check('turning the soft parts off shrinks the work', bare.width < rect.width, {
		with: rect.width,
		without: bare.width,
	})
}

/* ====================================================== 6. timing + motion */

function checkTimingAndMotion() {
	console.log('\nTiming and motion')

	const shot = { startMs: 1_000, endMs: 5_000 }
	check('nothing is drawn before the shot', plan.shotFade(shot, 900, 300) === 0)
	check('nothing is drawn after it', plan.shotFade(shot, 5_000, 300) === 0)
	check('the middle is full strength', plan.shotFade(shot, 3_000, 300) === 1)
	const rising = plan.shotFade(shot, 1_150, 300)
	const falling = plan.shotFade(shot, 4_850, 300)
	check('the entrance and the exit are symmetric', Math.abs(rising - falling) < 1e-9, { rising, falling })
	// A quarter of the way in, a linear fade would be at 0.25; the eased one is
	// well below it, which is what makes the object look placed rather than
	// dissolved into the frame.
	const quarter = plan.shotFade(shot, 1_075, 300)
	check('the entrance eases rather than ramping', quarter < 0.2, quarter)

	// A shot shorter than two entrances still reaches a peak instead of
	// crossfading into itself.
	const brief = { startMs: 0, endMs: 400 }
	check('a brief shot still peaks', plan.shotFade(brief, 200, 300) === 1, plan.shotFade(brief, 200, 300))

	const still = sprite.motionAt('none', 1_234)
	check('still means still', still.rotation === 0 && still.scale === 1 && still.driftY === 0)

	for (const motion of ['float', 'spin', 'sway', 'pulse']) {
		const first = sprite.motionAt(motion, 2_500)
		const again = sprite.motionAt(motion, 2_500)
		check(`${motion} is a pure function of time`, JSON.stringify(first) === JSON.stringify(again))
	}

	let maxDrift = 0
	let maxScale = 0
	for (let ms = 0; ms < 10_000; ms += 17) {
		const state = sprite.motionAt('float', ms)
		maxDrift = Math.max(maxDrift, Math.abs(state.driftY))
		maxScale = Math.max(maxScale, Math.abs(sprite.motionAt('pulse', ms).scale - 1))
	}
	check('float never drifts far enough to leave the head', maxDrift < 0.06, maxDrift)
	check('pulse never doubles the object', maxScale < 0.1, maxScale)
	check(
		'spin completes exactly one turn in its period',
		Math.abs(sprite.motionAt('spin', 8_000).rotation - Math.PI * 2) < 1e-9,
		sprite.motionAt('spin', 8_000).rotation,
	)
}

/* ============================================================== 7. session */

function checkSession() {
	console.log('\nWhat survives a refresh')

	const stored = session.normalizeCaptionSession(
		{
			video: null,
			cues: [],
			objects: {
				mode: 'model3d',
				useAi: false,
				shots: [{ startMs: 0, endMs: 2_000, kind: 'library', assetId: 'rocket', keyword: 'rocket' }],
				settings: { feather: 40 },
				baked: true,
				originalBlobId: null,
			},
		},
		{ render: { engine: 'browser', preset: 'high', format: 'mp4', audioEnabled: true, scale: 1, previewSeconds: 0 } },
	)
	check('the plan comes back', stored && stored.objects.shots.length === 1)
	check('with its mode and its settings', stored.objects.mode === 'model3d' && stored.objects.settings.feather === 40)
	check('and the AI toggle as it was left', stored.objects.useAi === false)
	check(
		'"baked" is not believed without an original to restore',
		stored.objects.baked === false,
	)

	const blank = session.normalizeCaptionSession({}, {
		render: { engine: 'browser', preset: 'high', format: 'mp4', audioEnabled: true, scale: 1, previewSeconds: 0 },
	})
	check('a snapshot with no object plan restores the default', blank.objects.shots.length === 0)
	check('and the Objects tab is a valid tab', session.DEFAULT_OBJECT_PLAN.mode === 'flat')
}

/* ================================================== 8. /api/captions/objects */

async function checkRoute() {
	console.log('\n/api/captions/objects')

	const post = (body) =>
		objectsRoute.POST(
			new Request('http://localhost/api/captions/objects', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
			}),
		)

	const noLines = await post({ catalogue: [{ id: 'rocket', label: 'Rocket', about: 'launch' }] })
	check('a request with no lines is refused', noLines.status === 400)

	const noCatalogue = await post({ lines: ['we launched'] })
	check('a request with no catalogue is refused', noCatalogue.status === 400)

	const key = process.env.NVIDIA_API_KEY
	delete process.env.NVIDIA_API_KEY
	const keyless = await post({
		lines: ['we launched the rocket'],
		catalogue: [{ id: 'rocket', label: 'Rocket', about: 'launch' }],
	})
	const body = await keyless.json()
	if (key !== undefined) process.env.NVIDIA_API_KEY = key

	check('with no key the route still answers 200', keyless.status === 200)
	check('with an empty pick list', Array.isArray(body.picks) && body.picks.length === 0)
	check('and says why, so the panel can repeat it', typeof body.notice === 'string' && body.notice.length > 0)
	check('and names no model', body.model === null)
}


/* ============================================== 9. the studio, in a browser */

/**
 * Three lines that between them name three different objects, spaced so all
 * three can be shown - three objects inside four seconds is a slideshow, and the
 * planner refuses it, which would make this leg assert the density rule instead
 * of the thing it is here for. Timings as an .srt would carry them.
 *
 * Imported rather than transcribed: what is being checked here is the object
 * layer, and running speech recognition first would make every failure
 * ambiguous.
 */
const SRT = [
	'1',
	'00:00:00,100 --> 00:00:01,400',
	'we built a rocket this year',
	'',
	'2',
	'00:00:02,000 --> 00:00:03,400',
	'and opened the laptop to ship it',
	'',
	'3',
	'00:00:04,000 --> 00:00:04,900',
	'time to celebrate the money',
	'',
].join('\n')

/** The two colours the synthetic clip is painted in, as the page sees them. */
const BACKDROP = [13, 16, 36]
const SUBJECT = [232, 201, 160]

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function reachable(url, timeoutMs = 4_000) {
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

async function startServer() {
	const child = spawn('npm', ['start', '--', '-p', String(PORT)], {
		cwd: path.resolve(__dirname, '..'),
		stdio: 'ignore',
		shell: process.platform === 'win32',
	})
	for (let attempt = 0; attempt < 150; attempt++) {
		await sleep(1_000)
		if (await reachable(`${BASE}/captions`)) return child
	}
	child.kill()
	throw new Error('The built app never came up. Run "npm run build" first.')
}

/** Polls an in-page probe until it returns something truthy. */
async function until(page, fn, arg, timeoutMs, label) {
	const deadline = Date.now() + timeoutMs
	let last = null
	while (Date.now() < deadline) {
		last = await page.evaluate(fn, arg)
		if (last) return last
		await sleep(400)
	}
	throw new Error(`timed out waiting for ${label} (last saw ${JSON.stringify(last)})`)
}

/* ------------------------------- in-page probes ---------------------------- */

/**
 * Records a clip with a head and shoulders in it and hands it to the studio.
 *
 * A recorder rather than a fixture: a committed video would be a binary in the
 * history that nothing else needs, and the shape matters more than the
 * content. It is painted in exactly two colours, which is what lets the
 * assertions below say "this pixel was not in the footage" without a
 * threshold anyone has to argue about.
 */
async function attachClip() {
	const field = document.querySelector('.panel--left input[type="file"]')
	if (!field) return 'no-input'
	if (typeof MediaRecorder === 'undefined') return 'no-recorder'

	const canvas = document.createElement('canvas')
	canvas.width = 480
	canvas.height = 270
	const ctx = canvas.getContext('2d')
	let frame = 0
	const paint = () => {
		ctx.fillStyle = '#0d1024'
		ctx.fillRect(0, 0, canvas.width, canvas.height)
		// Barely moving, the way a talking head does. The amount matters: this
		// is what the adaptive mask skip is measured against, and a subject
		// lurching across the frame would exercise the opposite path.
		const drift = Math.sin(frame / 60) * 4
		ctx.fillStyle = '#e8c9a0'
		ctx.beginPath()
		ctx.arc(240 + drift, 110, 42, 0, Math.PI * 2)
		ctx.fill()
		ctx.fillRect(190 + drift, 150, 100, 120)
		frame++
	}
	paint()

	const stream = canvas.captureStream(30)
	const chunks = []
	const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' })
	recorder.ondataavailable = (event) => {
		if (event.data && event.data.size > 0) chunks.push(event.data)
	}
	const stopped = new Promise((resolve) => {
		recorder.onstop = resolve
	})
	recorder.start()
	const started = performance.now()
	// Repainting every frame is what makes the recorder produce frames at all:
	// a canvas that never changes may emit one sample and stop.
	await new Promise((resolve) => {
		const tick = () => {
			paint()
			if (performance.now() - started > 5_000) resolve()
			else requestAnimationFrame(tick)
		}
		requestAnimationFrame(tick)
	})
	recorder.stop()
	await stopped
	stream.getTracks().forEach((track) => track.stop())

	const blob = new Blob(chunks, { type: 'video/webm' })
	if (blob.size < 1024) return 'empty-recording'
	const transfer = new DataTransfer()
	transfer.items.add(new File([blob], 'speaker.webm', { type: 'video/webm' }))
	field.files = transfer.files
	field.dispatchEvent(new Event('change', { bubbles: true }))
	return 'attached'
}

function panelError(scope) {
	return Array.from(document.querySelectorAll(`${scope} .notice--error`))
		.map((node) => (node.textContent || '').trim())
		.filter(Boolean)
		.join(' | ')
}

function clickIn(scope, text) {
	const button = Array.from(document.querySelectorAll(`${scope} button`)).find((node) =>
		(node.textContent || '').includes(text),
	)
	if (!button) return 'no-button'
	if (button.disabled) return 'disabled'
	button.click()
	return 'clicked'
}

/**
 * How much of a frame is neither backdrop nor subject.
 *
 * The clip has two colours in it and nothing else, so anything outside those
 * two bands arrived with the object. It is a blunt measure and that is the
 * point: it cannot pass because a slider moved.
 */
function foreignShareOf(image, backdrop, subject) {
	const canvas = document.createElement('canvas')
	canvas.width = image.naturalWidth || image.videoWidth || image.width
	canvas.height = image.naturalHeight || image.videoHeight || image.height
	const ctx = canvas.getContext('2d')
	ctx.drawImage(image, 0, 0)
	const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
	let foreign = 0
	for (let i = 0; i < data.length; i += 4) {
		const near = (target, tolerance) =>
			Math.abs(data[i] - target[0]) < tolerance &&
			Math.abs(data[i + 1] - target[1]) < tolerance &&
			Math.abs(data[i + 2] - target[2]) < tolerance
		if (!near(backdrop, 26) && !near(subject, 34)) foreign++
	}
	return { width: canvas.width, height: canvas.height, share: foreign / (canvas.width * canvas.height) }
}

async function checkStudio() {
	console.log('\nThe studio, in a browser')

	const running = await reachable(`${BASE}/captions`)
	const server = running ? null : await startServer()
	const { openBrowser, ensureBrowser } = require('@remotion/renderer')
	await ensureBrowser()
	const browser = await openBrowser('chrome', { chromiumOptions: { headless: !HEADFUL } })

	try {
		const page = await browser.newPage({ context: null, logLevel: 'error', indent: false, pageIndex: 0 })
		await page.goto({ url: `${BASE}/captions`, timeoutInMilliseconds: 120_000 })
		// The measuring function is written here, beside the assertions that
		// read it, and shipped into the page rather than duplicated in every
		// probe that needs it.
		await page.evaluate((source) => {
			window.__foreignShare = new Function(`return (${source})`)()
		}, foreignShareOf.toString())

		/* -------------------------------------------------------- the clip */

		const attached = await page.evaluate(attachClip)
		check('a clip is recorded and attached', attached === 'attached', attached)

		const adopted = await until(
			page,
			() => {
				const failure = Array.from(document.querySelectorAll('.panel--left .notice--error'))
					.map((node) => (node.textContent || '').trim())
					.filter(Boolean)
					.join(' | ')
				if (failure) return { error: failure }
				return (document.body.innerText || '').includes('speaker.webm') ? { ok: true } : null
			},
			null,
			60_000,
			'the studio to adopt the clip',
		)
		if (!check('the studio adopts it', !adopted.error, adopted.error)) throw new Error(adopted.error)

		/* -------------------------------------------------- the transcript */

		const tabbed = await page.evaluate(() => {
			const group = Array.from(document.querySelectorAll('.segmented')).find(
				(node) => (node.getAttribute('aria-label') || '') === 'Transcript source',
			)
			if (!group) return 'no-group'
			const tab = Array.from(group.querySelectorAll('button')).find((node) =>
				(node.textContent || '').includes('Import'),
			)
			if (!tab) return 'no-import-tab'
			tab.click()
			return 'clicked'
		})
		check('the Import tab opens', tabbed === 'clicked', tabbed)

		await until(
			page,
			() => {
				if (document.querySelectorAll('.panel--left textarea').length > 0) return 'ready'
				const toggle = Array.from(document.querySelectorAll('.panel--left button')).find((node) =>
					/paste the subtitle text/i.test(node.textContent || ''),
				)
				if (toggle) toggle.click()
				return ''
			},
			null,
			30_000,
			'the paste box',
		)

		const pasted = await page.evaluate((srt) => {
			const areas = Array.from(document.querySelectorAll('.panel--left textarea'))
			const area = areas[areas.length - 1]
			if (!area) return 'no-textarea'
			// React listens for the native input event, so the value has to be
			// written through the prototype setter it wraps.
			const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
			setter.call(area, srt)
			area.dispatchEvent(new Event('input', { bubbles: true }))
			return 'filled'
		}, SRT)
		check('the subtitles are pasted in', pasted === 'filled', pasted)

		const importClicked = await until(
			page,
			() => {
				const button = Array.from(document.querySelectorAll('.panel--left button')).find((node) =>
					(node.textContent || '').includes('Import pasted subtitles'),
				)
				if (!button || button.disabled) return ''
				button.click()
				return 'clicked'
			},
			null,
			30_000,
			'the import button',
		)
		check('and imported', importClicked === 'clicked', importClicked)

		const cueCount = await until(
			page,
			() => document.querySelectorAll('.cue-row, .cue, [data-cue-id]').length || 0,
			null,
			30_000,
			'the cues to land on the timeline',
		)
		check('three lines reach the timeline', cueCount >= 3, cueCount)

		/* ----------------------------------------------------- the objects */

		const opened = await page.evaluate(() => {
			const button = Array.from(document.querySelectorAll('.panel-tabs button')).find((node) =>
				(node.textContent || '').includes('Objects'),
			)
			if (!button) return 'no-tab'
			button.click()
			return 'open'
		})
		check('the Objects panel opens', opened === 'open', opened)

		const planned = await page.evaluate(clickIn, '.panel--right', 'Plan objects')
		check('planning starts', planned === 'clicked', planned)

		const shots = await until(
			page,
			() => {
				const failure = Array.from(document.querySelectorAll('.panel--right .notice--error'))
					.map((node) => (node.textContent || '').trim())
					.filter(Boolean)
					.join(' | ')
				if (failure) return { error: failure }
				const rows = Array.from(document.querySelectorAll('.object-shot')).map((node) =>
					(node.querySelector('.object-shot-name')?.textContent || '').trim(),
				)
				if (rows.length > 0) return { rows }
				const notice = Array.from(document.querySelectorAll('.panel--right .notice--info'))
					.map((node) => (node.textContent || '').trim())
					.filter(Boolean)
					.join(' | ')
				return notice ? { error: notice } : null
			},
			null,
			90_000,
			'a shot list',
		)
		if (!check('planning finishes without an error', !shots.error, shots.error)) {
			throw new Error(shots.error)
		}
		check('objects are chosen from the words', shots.rows.length >= 2, shots.rows)
		check(
			'and they are the objects those words name',
			shots.rows.some((label) => /rocket/i.test(label)) &&
				shots.rows.some((label) => /laptop/i.test(label)),
			shots.rows,
		)

		/* ----------------------------------------------------- the preview */

		const previewing = await page.evaluate(clickIn, '.panel--right', 'Preview this frame')
		check('a still preview is requested', previewing === 'clicked', previewing)

		const preview = await until(
			page,
			(colours) => {
				const failure = Array.from(document.querySelectorAll('.panel--right .notice--error'))
					.map((node) => (node.textContent || '').trim())
					.filter(Boolean)
					.join(' | ')
				if (failure) return { error: failure }
				const image = document.querySelector('img.tool-preview-frame')
				if (!image || !image.complete || image.naturalWidth === 0) return null
				return window.__foreignShare(image, colours.backdrop, colours.subject)
			},
			{ backdrop: BACKDROP, subject: SUBJECT },
			240_000,
			'a composited still',
		)
		if (!check('the still renders', !preview.error, preview.error)) throw new Error(preview.error)
		check('at the clip resolution', preview.width === 480 && preview.height === 270, preview)
		check(
			'and carries an object that was never in the footage',
			preview.share > 0.01,
			preview.share,
		)

		/* -------------------------------------------------------- the bake */

		const baking = await page.evaluate(clickIn, '.panel--right', 'Add objects to the video')
		check('the bake starts', baking === 'clicked', baking)

		const baked = await until(
			page,
			() => {
				const failure = Array.from(document.querySelectorAll('.panel--right .notice--error'))
					.map((node) => (node.textContent || '').trim())
					.filter(Boolean)
					.join(' | ')
				if (failure) return { error: failure }
				const note = document.querySelector('.panel--right .notice--success')
				if (!note) return null
				return {
					note: (note.textContent || '').trim(),
					// The studio names the baked file after the original, so the
					// left panel showing the new name is the visible proof that the
					// clip under the captions was swapped.
					name: (document.querySelector('.panel--left')?.innerText || '').includes('speaker-subtitled'),
					badge: (document.querySelector('.panel--right .badge--green')?.textContent || '').trim(),
				}
			},
			null,
			600_000,
			'the bake to finish',
		)
		if (!check('the bake completes', !baked.error, baked.error)) throw new Error(baked.error)
		check('the working clip is replaced by the baked one', baked.name === true)
		// Printed whether or not it passes: the numbers in it are the only
		// measurement of the two optimisations anyone ever sees.
		console.log('    ' + baked.note)
		check('the panel says what it did', baked.note.length > 10, baked.note)
		check('and how long it took', /Baked in \d/.test(baked.note), baked.note)

		// The two optimisations that make this feasible, asserted from the
		// report the user actually sees rather than from a counter nobody
		// reads. A regression that quietly reverts either one shows up here.
		const skipped = /skipped on (\d+)%/.exec(baked.note)
		check('the model was skipped on a still picture', skipped !== null && Number(skipped[1]) > 10, baked.note)
		const repainted = /repainted (\d+)%/.exec(baked.note)
		check(
			'and each frame repainted a corner, not the whole picture',
			repainted !== null && Number(repainted[1]) < 60,
			baked.note,
		)
		check('and the clip is marked as burned in', /burned in/i.test(baked.badge), baked.badge)

		// Clicking a shot parks the playhead in the middle of it, which is both
		// the panel's own behaviour and the only way to see the object on the
		// stage without driving the player's transport.
		const seeked = await page.evaluate(() => {
			const row = document.querySelector('.object-shot')
			if (!row) return 'no-shot'
			row.click()
			return 'clicked'
		})
		check('clicking a shot parks the playhead on it', seeked === 'clicked', seeked)

		const after = await until(
			page,
			(colours) => {
				const surfaces = Array.from(document.querySelectorAll('.stage canvas, .stage video')).filter(
					(node) => (node.videoWidth || node.width || 0) > 80,
				)
				if (surfaces.length === 0) return null
				let best = null
				for (const surface of surfaces) {
					const measured = window.__foreignShare(surface, colours.backdrop, colours.subject)
					if (!best || measured.share > best.share) best = measured
				}
				return best
			},
			{ backdrop: BACKDROP, subject: SUBJECT },
			90_000,
			'a frame of the baked clip on the stage',
		)
		check('the baked clip shows the object on the stage', after.share > 0.005, after.share)

		/* ---------------------------------------------------- the way back */

		const restoring = await page.evaluate(clickIn, '.panel--right', 'Restore the original')
		check('the original can be restored', restoring === 'clicked', restoring)

		const back = await until(
			page,
			() => {
				const note = document.querySelector('.panel--right .notice--success')
				const text = note ? (note.textContent || '').trim() : ''
				return /original clip is back/i.test(text) ? text : ''
			},
			null,
			90_000,
			'the original to come back',
		)
		check('and it comes back', back.length > 0, back)

		const cuesAfter = await page.evaluate(
			() => document.querySelectorAll('.cue-row, .cue, [data-cue-id]').length || 0,
		)
		check('the transcript survives the whole round trip', cuesAfter === cueCount, {
			before: cueCount,
			after: cuesAfter,
		})

		/* --------------------------------------------------- the 3D models */

		// The GLB pack is generated by `npm run assets:3d` and deliberately not
		// committed, so this leg is conditional: on a fresh checkout the right
		// behaviour is the panel saying how to build it, which is checked here
		// too rather than skipped silently.
		const packBuilt = await reachable(`${BASE}/assets/3d/v1/catalog.json`)
		const switched = await page.evaluate(() => {
			const group = Array.from(document.querySelectorAll('.panel--right .segmented')).find(
				(node) => (node.getAttribute('aria-label') || '') === 'Where objects come from',
			)
			if (!group) return 'no-group'
			const button = Array.from(group.querySelectorAll('button')).find((node) =>
				(node.textContent || '').includes('3D'),
			)
			if (!button) return 'no-button'
			button.click()
			return 'clicked'
		})
		check('the 3D source can be chosen', switched === 'clicked', switched)

		if (!packBuilt) {
			const warned = await until(
				page,
				() =>
					Array.from(document.querySelectorAll('.panel--right .notice--warn'))
						.map((node) => (node.textContent || '').trim())
						.find((text) => /assets:3d/.test(text)) || '',
				null,
				20_000,
				'the "build the pack" notice',
			)
			check('an unbuilt 3D pack is explained, not hidden', warned.length > 0, warned)
			return
		}

		const planned3d = await until(
			page,
			() => {
				const button = Array.from(document.querySelectorAll('.panel--right button')).find((node) =>
					/(Re-)?[Pp]lan objects/.test(node.textContent || ''),
				)
				if (!button || button.disabled) return ''
				button.click()
				return 'clicked'
			},
			null,
			30_000,
			'the plan button',
		)
		check('a 3D plan can be requested', planned3d === 'clicked', planned3d)

		// A finished plan clears the still that was on screen, which is the one
		// signal that says the shot list below is the new one and not the old.
		await until(
			page,
			() => (document.querySelector('img.tool-preview-frame') ? '' : 'cleared'),
			null,
			90_000,
			'the flat still to be cleared',
		)

		const modelShots = await until(
			page,
			() => {
				const failure = Array.from(document.querySelectorAll('.panel--right .notice--error'))
					.map((node) => (node.textContent || '').trim())
					.filter(Boolean)
					.join(' | ')
				if (failure) return { error: failure }
				const rows = Array.from(document.querySelectorAll('.object-shot')).map((node) =>
					(node.querySelector('.object-shot-name')?.textContent || '').trim(),
				)
				if (rows.length > 0) return { rows }
				const notice = Array.from(document.querySelectorAll('.panel--right .notice--info'))
					.map((node) => (node.textContent || '').trim())
					.find((text) => /catalogue/i.test(text))
				return notice ? { error: notice } : null
			},
			null,
			90_000,
			'a 3D shot list',
		)
		if (!check('models are chosen from the words', !modelShots.error, modelShots.error)) {
			throw new Error(modelShots.error)
		}
		check('and named after the pack families', modelShots.rows.length >= 1, modelShots.rows)
		const preview3dStarted = await until(
			page,
			() => {
				const button = Array.from(document.querySelectorAll('.panel--right button')).find((node) =>
					(node.textContent || '').includes('Preview this frame'),
				)
				if (!button || button.disabled) return ''
				button.click()
				return 'clicked'
			},
			null,
			60_000,
			'the preview button to come back',
		).catch(async (error) => {
			// A timeout here says only "the button never came back". What is
			// actually wrong is always in the panel beside it - a disabled
			// control, or a notice explaining that nothing was planned - so it
			// is printed rather than left for a second run to discover.
			const state = await page.evaluate(() => ({
				buttons: Array.from(document.querySelectorAll('.panel--right button')).map(
					(node) => `${(node.textContent || '').trim().slice(0, 30)}|${node.disabled}`,
				),
				notices: Array.from(document.querySelectorAll('.panel--right .notice')).map((node) =>
					(node.textContent || '').trim().slice(0, 120),
				),
			}))
			console.log('    panel state:', JSON.stringify(state, null, 1).slice(0, 1600))
			throw error
		})
		check('a 3D still is requested', preview3dStarted === 'clicked', preview3dStarted)

		const preview3d = await until(
			page,
			(colours) => {
				const failure = Array.from(document.querySelectorAll('.panel--right .notice--error'))
					.map((node) => (node.textContent || '').trim())
					.filter(Boolean)
					.join(' | ')
				if (failure) return { error: failure }
				const image = document.querySelector('img.tool-preview-frame')
				if (!image || !image.complete || image.naturalWidth === 0) return null
				return window.__foreignShare(image, colours.backdrop, colours.subject)
			},
			{ backdrop: BACKDROP, subject: SUBJECT },
			240_000,
			'a still with a rendered model in it',
		)
		if (!check('the model renders', !preview3d.error, preview3d.error)) {
			throw new Error(preview3d.error)
		}
		check('and it is composited into the frame', preview3d.share > 0.005, preview3d.share)
	} finally {
		await browser.close({ silent: true }).catch(() => {})
		if (server) server.kill()
	}
}

async function main() {
	checkCatalogue()
	checkMatching()
	checkPlanner()
	checkAnchor()
	checkAnchorFilter()
	checkPlacement()
	checkCaptionSafeArea()
	checkAffectedRect()
	checkTimingAndMotion()
	checkSession()
	await checkRoute()
	if (!MATHS_ONLY) await checkStudio()

	if (failures > 0) {
		console.error(`\n${failures} of ${checks} checks failed.`)
		process.exit(1)
	}
	console.log(`\nAll ${checks} object-layer checks passed.`)
}

main().catch((error) => {
	console.error(error)
	process.exit(1)
})
