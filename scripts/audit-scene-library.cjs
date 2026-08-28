#!/usr/bin/env node
/**
 * Proves the scene library holds no two pieces that are the same piece.
 *
 * A library of a hundred templates is only worth a hundred if no two of them
 * read alike, and that is not something tsc can check: two scenes can have
 * different names, different ids and different props and still be the same
 * composition with the numbers changed. So this checks four separate kinds of
 * sameness, each of which has actually happened at least once while the kit was
 * being written:
 *
 *   identity   - two recipes claiming the same component, label or scene id
 *   wiring     - a recipe naming a component its source never defines, or a
 *                source defining a scene component no recipe points at
 *   surface    - two sources sharing a Backdrop seed, which is the tell for a
 *                scene that began life as a copy of another one
 *   substance  - two sources whose code overlaps above a threshold, measured on
 *                shingles of the normalised token stream, which catches the
 *                copy-paste-and-retune case that renaming hides
 *   concept    - two recipes with the same family, the same need and the same
 *                set of roles, which is duplication at the level the planner
 *                sees even when the drawings differ
 *
 * Exits non-zero on anything in the first four groups. Concept collisions are
 * reported but not fatal: two pieces can honestly serve the same beat if they
 * look nothing alike, and the planner picks between them by seed.
 *
 * Usage:
 *   node scripts/audit-scene-library.cjs
 *   node scripts/audit-scene-library.cjs --json
 *   node scripts/audit-scene-library.cjs --threshold 0.62
 */

require('sucrase/register')

const { MOTION_SCENE_KIT, MOTION_SCENE_IDS, MOTION_SCENE_SOURCE } = require('../lib/ai/motion-scenes.ts')
const { SCENES } = require('../lib/ai/compose.ts')
const { CLASSIC_SCENE_TYPES } = require('../lib/ai/storyboard.ts')

const argv = process.argv.slice(2)
const asJson = argv.includes('--json')
const thresholdArg = argv.indexOf('--threshold')
const SIMILARITY_LIMIT = thresholdArg >= 0 ? Number(argv[thresholdArg + 1]) : 0.58

/* -------------------------------------------------------------------------- */
/*  Normalising a scene down to what it actually does                         */
/* -------------------------------------------------------------------------- */

/**
 * Strips a source string down to its shape.
 *
 * Comments, identifiers and numeric constants are all removed: two scenes that
 * differ only in what they are called, how they are documented and which
 * magic numbers they use are the same scene, and the whole point of the
 * substance check is to say so.
 */
function shapeOf(source) {
	return source
		.replace(/\/\*[\s\S]*?\*\//g, ' ')
		.replace(/\/\/[^\n]*/g, ' ')
		.replace(/'[^']*'/g, "''")
		.replace(/-?\d+(\.\d+)?/g, '0')
		.replace(/\b[A-Za-z_$][\w$]*\b/g, (word) => (KEYWORDS.has(word) ? word : 'x'))
		.replace(/\s+/g, ' ')
		.trim()
}

/**
 * The words that carry structure rather than naming.
 *
 * Everything else collapses to a placeholder, so `const bars = ...` and
 * `const rings = ...` compare equal while `map` versus `reduce` does not.
 */
const KEYWORDS = new Set([
	'const', 'let', 'return', 'if', 'else', 'for', 'while', 'function', 'new', 'null', 'undefined',
	'true', 'false', 'map', 'filter', 'reduce', 'slice', 'fill', 'Array', 'Math', 'min', 'max', 'abs',
	'sin', 'cos', 'sqrt', 'round', 'floor', 'ceil', 'pow', 'toFixed', 'interpolate', 'spring',
	'useCurrentFrame', 'useVideoConfig', 'useUnit', 'AbsoluteFill', 'div', 'span', 'svg', 'circle',
	'line', 'path', 'style', 'position', 'absolute', 'relative', 'display', 'flex', 'grid', 'column',
	'row', 'transform', 'translate', 'translateX', 'translateY', 'translateZ', 'rotate', 'rotateX',
	'rotateY', 'rotateZ', 'scale', 'scaleX', 'scaleY', 'skewY', 'opacity', 'clipPath', 'borderRadius',
	'backgroundColor', 'boxShadow', 'perspective', 'preserve', 'fitLine', 'fitStack', 'fitBlock',
])

function shingles(shape, size = 7) {
	const tokens = shape.split(' ')
	const set = new Set()
	for (let index = 0; index + size <= tokens.length; index += 1) {
		set.add(tokens.slice(index, index + size).join(' '))
	}
	return set
}

function jaccard(left, right) {
	if (left.size === 0 || right.size === 0) return 0
	let shared = 0
	const [small, large] = left.size <= right.size ? [left, right] : [right, left]
	for (const item of small) if (large.has(item)) shared += 1
	return shared / (left.size + right.size - shared)
}

/* -------------------------------------------------------------------------- */
/*  The checks                                                                */
/* -------------------------------------------------------------------------- */

const failures = []
const notes = []

function fail(kind, message) {
	failures.push({ kind, message })
}

/* identity ---------------------------------------------------------------- */
const byComponent = new Map()
const byLabel = new Map()

for (const id of MOTION_SCENE_IDS) {
	const recipe = MOTION_SCENE_KIT[id]
	const componentSeen = byComponent.get(recipe.component)
	if (componentSeen) fail('identity', 'component ' + recipe.component + ' claimed by both ' + componentSeen + ' and ' + id)
	byComponent.set(recipe.component, id)

	const labelKey = recipe.label.toLowerCase()
	const labelSeen = byLabel.get(labelKey)
	if (labelSeen) fail('identity', 'label "' + recipe.label + '" used by both ' + labelSeen + ' and ' + id)
	byLabel.set(labelKey, id)
}

/* wiring ------------------------------------------------------------------ */
for (const id of MOTION_SCENE_IDS) {
	const recipe = MOTION_SCENE_KIT[id]
	const source = MOTION_SCENE_SOURCE[id]
	if (!source) {
		fail('wiring', id + ' has a recipe but no emitted source')
		continue
	}
	if (!source.includes('const ' + recipe.component + ':')) {
		fail('wiring', id + ' names component ' + recipe.component + ' that its source never defines')
	}
	if (!source.includes('<SceneEdge frames={props.frames} />')) {
		fail('wiring', id + ' never draws its scene edge, so it will not cut cleanly')
	}
	if (source.includes('${') || source.includes('`')) {
		fail('wiring', id + ' contains a template-literal marker, which cannot survive emission')
	}
}

for (const id of Object.keys(MOTION_SCENE_SOURCE)) {
	if (!MOTION_SCENE_KIT[id]) fail('wiring', id + ' has emitted source but no recipe, so the planner can never reach it')
}

/* surface ----------------------------------------------------------------- */
const bySeed = new Map()
for (const id of MOTION_SCENE_IDS) {
	const match = /<Backdrop seed=\{(\d+)\}/.exec(MOTION_SCENE_SOURCE[id] ?? '')
	if (!match) continue
	const seed = match[1]
	const seen = bySeed.get(seed)
	if (seen) fail('surface', 'backdrop seed ' + seed + ' shared by ' + seen + ' and ' + id)
	bySeed.set(seed, id)
}

/* substance --------------------------------------------------------------- */
// The classic half is measured against the motion half as well: a classic scene
// that draws the same composition as a motion one is just as much a repeat.
const ALL_IDS = [...MOTION_SCENE_IDS, ...CLASSIC_SCENE_TYPES]
const sourceOf = (id) => MOTION_SCENE_SOURCE[id] ?? SCENES[id] ?? ''
const fingerprints = ALL_IDS.map((id) => ({ id, shingles: shingles(shapeOf(sourceOf(id))) }))
const pairs = []
for (let left = 0; left < fingerprints.length; left += 1) {
	for (let right = left + 1; right < fingerprints.length; right += 1) {
		const score = jaccard(fingerprints[left].shingles, fingerprints[right].shingles)
		if (score >= SIMILARITY_LIMIT) pairs.push({ a: fingerprints[left].id, b: fingerprints[right].id, score })
	}
}
pairs.sort((one, two) => two.score - one.score)
for (const pair of pairs) {
	fail('substance', pair.a + ' and ' + pair.b + ' share ' + Math.round(pair.score * 100) + '% of their structure')
}

/* concept ----------------------------------------------------------------- */
const byConcept = new Map()
for (const id of MOTION_SCENE_IDS) {
	const recipe = MOTION_SCENE_KIT[id]
	const key = recipe.family + '|' + recipe.needs + '|' + [...recipe.roles].sort().join(',')
	const bucket = byConcept.get(key) ?? []
	bucket.push(id)
	byConcept.set(key, bucket)
}
for (const [key, bucket] of byConcept) {
	if (bucket.length > 1) notes.push('same planner signature (' + key + '): ' + bucket.join(', '))
}

/* -------------------------------------------------------------------------- */
/*  Report                                                                    */
/* -------------------------------------------------------------------------- */

const closest = fingerprints.length > 1 ? pairs[0] ?? null : null
const summary = {
	scenes: ALL_IDS.length,
	motionScenes: MOTION_SCENE_IDS.length,
	classicScenes: CLASSIC_SCENE_TYPES.length,
	families: new Set(MOTION_SCENE_IDS.map((id) => MOTION_SCENE_KIT[id].family)).size,
	similarityLimit: SIMILARITY_LIMIT,
	closestPair: closest,
	failures,
	notes,
}

if (asJson) {
	process.stdout.write(JSON.stringify(summary, null, 2) + '\n')
} else {
	const line = (text) => process.stdout.write(text + '\n')
	line('')
	line(
		summary.scenes + ' scene templates (' + summary.motionScenes + ' motion across ' + summary.families +
			' families, ' + summary.classicScenes + ' classic)',
	)
	if (failures.length === 0) {
		line('no duplicate identity, wiring, surface or structure')
	} else {
		line('')
		line('FAILURES')
		for (const failure of failures) line('  [' + failure.kind + '] ' + failure.message)
	}
	if (notes.length > 0) {
		line('')
		line('shared planner signatures (not fatal - the planner picks between them by seed)')
		for (const note of notes) line('  ' + note)
	}
	line('')
}

process.exitCode = failures.length > 0 ? 1 : 0
