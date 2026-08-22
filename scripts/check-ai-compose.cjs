/**
 * Verifies the AI composer.
 *
 * For a spread of prompts it plans a storyboard locally, composes the TSX and
 * runs the same checks the Studio and the API route apply: sucrase must be able
 * to transpile it, the Remotion contract must be present, and every import and
 * staticFile() path must be one the browser compiler can resolve.
 *
 *   node scripts/check-ai-compose.cjs [--write <dir>]
 */

require('sucrase/register')

const fs = require('node:fs')
const path = require('node:path')
const { transform } = require('sucrase')

const { planStoryboard, promptRequestsThreeDimensional } = require('../lib/ai/planner.ts')
const { composeVideoSource } = require('../lib/ai/compose.ts')
const { DIMENSIONAL_SCENE_TYPES, normalizeStoryboard } = require('../lib/ai/storyboard.ts')
const {
	FONT_KIT,
	SFX_VARIANT_KIT,
	VISUAL_FAMILY_IDS,
	VISUAL_FAMILY_KIT,
	sfxVariantPath,
	visualVariantPath,
} = require('../lib/ai/kit.ts')
const { STORYBOARD_SYSTEM_PROMPT } = require('../lib/ai/prompt.ts')

const PROMPTS = [
	'Create a cinematic 5-second Nepal history video, 16:9, with an animated timeline, maps, monuments, mountain scenery, and elegant historical typography.',
	'Cinematic 20-second history of Nepal, 16:9, animated timeline, mountain scenery, temple architecture and elegant serif typography.',
	'15-second cinematic product launch for a solar-powered camera, warm desert light, bold minimal copy, 9:16, end with "See farther."',
	'30-second explainer showing how the JavaScript event loop works, dark technical style, honest diagrams, 16:9, no voiceover.',
	'Luxury editorial teaser for a Nepali mountain hotel, mist, paper texture, elegant serif typography, 20 seconds, 1:1.',
	'Quarterly growth report: revenue up 42%, 1200 new customers, 18 markets. Corporate blue, 25 seconds, 16:9.',
	'Neon 12 second hype video for a gaming tournament final, punchy, vertical, ends with "Play to win."',
	'Calm 45 second wellness film about morning routines, soft light, friendly typography, 4:5.',
	'hi',
	'3D product turntable for a titanium smart speaker, metallic crystal geometry, wireframe overlay, 18 seconds, 16:9.',
	'Rendered 3D globe showing our offices in Kathmandu, Berlin, Tokyo and Austin, 20 seconds, corporate, 16:9.',
	'Cinematic 3D terrain flyover of the Himalaya with wireframe topography, 16 seconds, 21:9.',
	'Flat 2D typographic manifesto, black and white, 10 seconds, 1:1.',
]

const SUPPORTED_IMPORTS = new Set([
	'react',
	'remotion',
	'@remotion/player',
	'@remotion/shapes',
	'@remotion/paths',
	'@remotion/noise',
	'@remotion/motion-blur',
	'@remotion/transitions',
	'@remotion/media',
	'@remotion/media-utils',
	'@remotion/gif',
	'@remotion/fonts',
	'@remotion/three',
	'@react-three/fiber',
	'three',
	'three/addons/loaders/GLTFLoader.js',
])

const FORBIDDEN = [
	[/\bfetch\s*\(/, 'fetch()'],
	[/\bMath\s*\.\s*random\s*\(/, 'Math.random()'],
	[/\bDate\s*\.\s*now\s*\(/, 'Date.now()'],
	[/\buseFrame\s*\(/, 'useFrame()'],
	[/\beval\s*\(/, 'eval()'],
	[/@keyframes\b|\banimation(?:Name)?\s*:/, 'CSS animation'],
	[/\bdangerouslySetInnerHTML\b/, 'dangerouslySetInnerHTML'],
]

// These patterns target visible background implementations. Do not add a bare
// /grid/ check: CSS Grid is valid layout and chart guide lines carry meaning.
const FORBIDDEN_BACKGROUND_GRIDS = [
	[/\bFloorGrid\b/, 'perspective floor grid'],
	[/\brepeating-linear-gradient\s*\(/, 'repeating gradient grid'],
	[/ai-master-grid/i, 'master-template grid pattern'],
]

const stripComments = (code) =>
	code.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1')

const writeIndex = process.argv.indexOf('--write')
const writeDir = writeIndex === -1 ? null : process.argv[writeIndex + 1]
if (writeDir) fs.mkdirSync(writeDir, { recursive: true })

let failures = 0

const seedFor = (index) => `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`

for (const [index, prompt] of PROMPTS.entries()) {
	const label = prompt.slice(0, 62).replace(/\s+/g, ' ')
	const issues = []

	try {
		// Round-tripping through the normaliser mirrors what an AI answer goes through.
		const creativeSeed = seedFor(index)
		const allowThreeDimensional = promptRequestsThreeDimensional(prompt)
		const fallback = planStoryboard(prompt, { creativeSeed, allowThreeDimensional })
		const storyboard = normalizeStoryboard(fallback, fallback, { allowThreeDimensional })
		const composed = composeVideoSource(storyboard)
		const code = composed.code
		const executable = stripComments(code)

		try {
			transform(code, { transforms: ['typescript', 'jsx'], jsxRuntime: 'automatic', filePath: 'ai.tsx' })
		} catch (error) {
			issues.push(`sucrase: ${error.message.split('\n')[0]}`)
		}

		if (!/<Composition\b/.test(code)) issues.push('no <Composition>')
		if (!/\bregisterRoot\s*\(/.test(code)) issues.push('no registerRoot()')
		if (!/export\s+default\b/.test(code)) issues.push('no default export')
		if (!/\buseCurrentFrame\s*\(/.test(code)) issues.push('no useCurrentFrame()')

		for (const match of code.matchAll(/from\s*['"]([^'"]+)['"]/g)) {
			const moduleName = match[1]
			if (!SUPPORTED_IMPORTS.has(moduleName) && !moduleName.startsWith('@remotion/transitions/')) {
				issues.push(`unsupported import ${moduleName}`)
			}
		}

		for (const [pattern, name] of FORBIDDEN) {
			if (pattern.test(executable)) issues.push(`forbidden ${name}`)
		}
		for (const [pattern, name] of FORBIDDEN_BACKGROUND_GRIDS) {
			if (pattern.test(executable)) issues.push(`forbidden background ${name}`)
		}

		if (!/^design-[a-f0-9]{16}$/.test(storyboard.designFingerprint)) issues.push('invalid design fingerprint')
		if (!code.includes(`id: '${creativeSeed}'`) && !code.includes(`id: "${creativeSeed}"`)) issues.push('creative seed not embedded')
		if (!composed.fileName.startsWith('ai-generated-') || composed.fileName === 'ai-generated-video.tsx') {
			issues.push('generated filename has no seed suffix')
		}
		if (storyboard.displayFont === storyboard.textFont) issues.push('display and body fonts are identical')
		const displayWeight = Number(code.match(/const DISPLAY_WEIGHT = (\d+)/)?.[1])
		const validDisplayWeights = FONT_KIT[storyboard.displayFont].weight.match(/\d+/g).map(Number)
		if (
			!Number.isFinite(displayWeight) ||
			displayWeight < Math.min(...validDisplayWeights) ||
			displayWeight > Math.max(...validDisplayWeights)
		) {
			issues.push(`display weight ${displayWeight} is outside ${FONT_KIT[storyboard.displayFont].weight}`)
		}
		const textWeight = Number(code.match(/const TEXT_WEIGHT = (\d+)/)?.[1])
		const validTextWeights = FONT_KIT[storyboard.textFont].weight.match(/\d+/g).map(Number)
		if (
			!Number.isFinite(textWeight) ||
			textWeight < Math.min(...validTextWeights) ||
			textWeight > Math.max(...validTextWeights)
		) {
			issues.push(`text weight ${textWeight} is outside ${FONT_KIT[storyboard.textFont].weight}`)
		}

		for (const call of code.matchAll(/staticFile\s*\(\s*([^\r\n)]*)\)/g)) {
			const argument = call[1].trim()
			if (!/^'assets\/(?:3d|audio|visual|texture|fonts)\/v1\//.test(argument)) {
				issues.push(`asset outside the kit: ${argument}`)
				continue
			}
			const relative = argument.slice(1, -1)
			if (!fs.existsSync(path.join(__dirname, '..', 'public', relative))) {
				issues.push(`missing asset file: ${relative}`)
			}
		}

		const transitions = [...code.matchAll(/durationInFrames: (\d+) \}\)/g)].length
		if (composed.layout.timings.length > 1 && transitions === 0) issues.push('no transitions emitted')

		if (writeDir) {
			fs.writeFileSync(path.join(writeDir, `ai-${index + 1}.tsx`), code, 'utf8')
		}

		const status = issues.length === 0 ? 'ok  ' : 'FAIL'
		console.log(
			`${status} ${composed.summary.padEnd(58)} ${String(code.split('\n').length).padStart(4)} lines  ${label}`,
		)
	} catch (error) {
		issues.push(`threw: ${error.message}`)
		console.log(`FAIL ${label}`)
	}

	if (issues.length > 0) {
		failures += 1
		for (const issue of issues) console.log(`     - ${issue}`)
	}
}

const regression = (condition, message) => {
	if (condition) {
		console.log(`ok   ${message}`)
		return
	}
	failures += 1
	console.log(`FAIL ${message}`)
}

const visualCatalog = JSON.parse(
	fs.readFileSync(path.join(__dirname, '..', 'public', 'assets', 'visual', 'v1', 'catalog.json'), 'utf8'),
)
const audioCatalog = JSON.parse(
	fs.readFileSync(path.join(__dirname, '..', 'public', 'assets', 'audio', 'catalog.json'), 'utf8'),
)
const visualCatalogFamilies = new Map(visualCatalog.families.map((family) => [family.id, family]))
const audioCatalogFamilies = new Map(audioCatalog.families.map((family) => [family.id, family]))
regression(visualCatalog.assetCount >= 1_000, 'visual catalog keeps at least 1,000 raw assets')
regression(audioCatalog.counts.sfx >= 500, 'audio catalog keeps at least 500 raw SFX')
regression(
	VISUAL_FAMILY_IDS.every((id) => {
		const compact = VISUAL_FAMILY_KIT[id]
		const catalog = visualCatalogFamilies.get(id)
		return catalog && catalog.category === compact.category && catalog.count === 50
	}),
	'compact visual family index matches the generated catalog',
)
regression(
	Object.entries(SFX_VARIANT_KIT).every(([id, compact]) => {
		const catalog = audioCatalogFamilies.get(id)
		return (
			catalog &&
			catalog.category === compact.category &&
			catalog.variantCount === compact.variants &&
			catalog.recommendedVolume === compact.volume
		)
	}),
	'compact SFX family index matches the generated catalog',
)
regression(
	VISUAL_FAMILY_IDS.every((id) =>
		new Array(50).fill(0).every((_, index) =>
			fs.existsSync(path.join(__dirname, '..', 'public', 'assets', 'visual', 'v1', visualVariantPath(id, index))),
		),
	),
	'all 1,200 compact-index visual paths resolve to raw SVG files',
)
regression(
	Object.keys(SFX_VARIANT_KIT).every((id) =>
		new Array(36).fill(0).every((_, index) =>
			fs.existsSync(path.join(__dirname, '..', 'public', 'assets', 'audio', 'v1', sfxVariantPath(id, index))),
		),
	),
	'all 540 compact-index SFX paths resolve to raw WAV files',
)

const variationPrompt = 'A 20-second launch film for a modular solar camera, cinematic but original, 16:9.'
const replaySeed = seedFor(80)
const replayA = planStoryboard(variationPrompt, { creativeSeed: replaySeed })
const replayB = planStoryboard(variationPrompt, { creativeSeed: replaySeed })
const replayCodeA = composeVideoSource(replayA)
const replayCodeB = composeVideoSource(replayB)
regression(JSON.stringify(replayA) === JSON.stringify(replayB), 'same request seed replays the same storyboard')
regression(replayCodeA.code === replayCodeB.code, 'same request seed replays byte-identical Remotion source')

const alternate = planStoryboard(variationPrompt, { creativeSeed: seedFor(81) })
const alternateCode = composeVideoSource(alternate)
regression(replayA.designFingerprint !== alternate.designFingerprint, 'different request seeds select different visible design profiles')
regression(replayCodeA.code !== alternateCode.code, 'different request seeds emit different Remotion source')
regression(replayCodeA.compositionId !== alternateCode.compositionId, 'composition ids carry collision-resistant seed suffixes')
regression(replayCodeA.fileName !== alternateCode.fileName, 'generated filenames carry collision-resistant seed suffixes')

const avoided = planStoryboard(variationPrompt, {
	creativeSeed: replaySeed,
	avoidDesignFingerprints: [replayA.designFingerprint],
})
const avoidedReplay = planStoryboard(variationPrompt, {
	creativeSeed: replaySeed,
	avoidDesignFingerprints: [replayA.designFingerprint],
})
regression(avoided.designFingerprint !== replayA.designFingerprint, 'recent design collision is deterministically rerolled')
regression(JSON.stringify(avoided) === JSON.stringify(avoidedReplay), 'collision reroll remains deterministic')

const profiles = new Array(48).fill(0).map((_, index) =>
	planStoryboard(variationPrompt, { creativeSeed: seedFor(100 + index) }),
)
regression(new Set(profiles.map((item) => item.designFingerprint)).size === profiles.length, '48 seeded generations have unique meaningful fingerprints')
regression(new Set(profiles.map((item) => item.creativeProfile.background)).size >= 5, 'variation covers at least five non-grid backgrounds')
regression(new Set(profiles.map((item) => item.creativeProfile.layout)).size >= 4, 'variation covers at least four layout recipes')
regression(new Set(profiles.map((item) => item.creativeProfile.transition)).size >= 4, 'variation covers all transition recipes')
regression(new Set(profiles.map((item) => item.creativeProfile.sfx)).size >= 4, 'variation covers at least four SFX recipes')
regression(new Set(profiles.map((item) => item.displayFont)).size >= 8, 'variation covers at least eight display families')
regression(
	new Set(profiles.flatMap((item) => item.creativeProfile.visualFamilies)).size >= 10,
	'one repeated brief still rotates across at least ten raw visual families',
)
regression(
	profiles.every((item) => item.creativeProfile.visualVariants.every((variant) => variant >= 0 && variant < 50)),
	'visual profiles address valid raw SVG variants',
)
regression(
	profiles.every((item) => item.creativeProfile.sfxVariantOffset >= 0 && item.creativeProfile.sfxVariantOffset < 36),
	'SFX profiles address valid raw WAV variants',
)
regression(/assets\/visual\/v1\/(?:kinetic|organic|cosmic|frames|data|symbols)\//.test(replayCodeA.code), 'generated source imports seeded raw SVG artwork')
regression(/assets\/audio\/v1\/sfx\/variants\//.test(replayCodeA.code), 'generated source imports seeded raw SFX variants')

const diverseProfiles = PROMPTS.flatMap((prompt, promptIndex) =>
	new Array(8).fill(0).map((_, seedIndex) =>
		planStoryboard(prompt, { creativeSeed: seedFor(400 + promptIndex * 8 + seedIndex) }),
	),
)
regression(
	new Set(diverseProfiles.flatMap((item) => item.creativeProfile.visualFamilies)).size === VISUAL_FAMILY_IDS.length,
	'diverse briefs exercise all 24 generation-eligible visual families',
)

const devanagari = planStoryboard('नेपालको इतिहासबारे १५ सेकेन्डको नेपाली भिडियो बनाउनुहोस्', {
	creativeSeed: seedFor(190),
})
regression(FONT_KIT[devanagari.displayFont].devanagari, 'Devanagari copy selects a script-capable display font')
regression(FONT_KIT[devanagari.textFont].devanagari, 'Devanagari copy selects a script-capable body font')
regression(devanagari.displayFont !== devanagari.textFont, 'Devanagari display and body roles stay distinct')

const poisoned = normalizeStoryboard({ ...replayA, creativeSeed: 'model-controlled-seed' }, replayA)
regression(poisoned.creativeSeed === replaySeed, 'normalization preserves the trusted request seed')
regression(/NO BACKGROUND GRIDS/.test(STORYBOARD_SYSTEM_PROMPT), 'director prompt states the no-background-grid policy')

/* -------------------------------------------------------------------------- */
/*  3D is opt-in                                                              */
/* -------------------------------------------------------------------------- */

const NON_3D_PROMPTS = [
	'Cinematic 20-second history of Nepal, animated timeline, mountain scenery, temple architecture.',
	'15-second product launch for a solar-powered camera, warm desert light, bold minimal copy.',
	'Quarterly growth report: revenue up 42%, 1200 new customers, 18 markets. Corporate blue.',
	'Rotating planet earth documentary about our global crystal glass supply chain, 20 seconds.',
	'Luxury editorial teaser for a mountain hotel, mist, paper texture, 20 seconds.',
	'Neon hype video for a gaming tournament final, punchy, vertical.',
]

const THREE_D_PROMPTS = [
	'3D product turntable for a titanium smart speaker, wireframe overlay, 18 seconds.',
	'Rendered 3D globe showing our offices in Berlin, Tokyo and Austin, 20 seconds.',
	'Cinematic 3D terrain flyover of the Himalaya, 16 seconds.',
	'Make it in WebGL with real geometry and lights, 12 seconds.',
]

const dimensionalScenes = (storyboard) => storyboard.scenes.filter((scene) => DIMENSIONAL_SCENE_TYPES.includes(scene.type))

const unaskedThreeD = NON_3D_PROMPTS.map((prompt, index) => {
	const creativeSeed = seedFor(400 + index)
	const allowThreeDimensional = promptRequestsThreeDimensional(prompt)
	const storyboard = planStoryboard(prompt, { creativeSeed, allowThreeDimensional })
	return { prompt, storyboard, allowThreeDimensional }
})

regression(
	unaskedThreeD.every((item) => item.allowThreeDimensional === false),
	'briefs that never say 3D are not read as 3D requests',
)
regression(
	unaskedThreeD.every((item) => item.storyboard.dimension !== 'three'),
	'briefs that never say 3D never reach WebGL dimension',
)
regression(
	unaskedThreeD.every((item) => dimensionalScenes(item.storyboard).length === 0),
	'briefs that never say 3D get no dimensional scene types',
)

const askedThreeD = THREE_D_PROMPTS.map((prompt, index) => {
	const creativeSeed = seedFor(500 + index)
	const allowThreeDimensional = promptRequestsThreeDimensional(prompt)
	return { prompt, allowThreeDimensional, storyboard: planStoryboard(prompt, { creativeSeed, allowThreeDimensional }) }
})

regression(
	askedThreeD.every((item) => item.allowThreeDimensional && item.storyboard.dimension === 'three'),
	'briefs that ask for 3D get it',
)
regression(
	askedThreeD.every((item) => dimensionalScenes(item.storyboard).length > 0),
	'briefs that ask for 3D get at least one dimensional scene',
)

// A model answer cannot smuggle 3D past the gate.
const smuggled = normalizeStoryboard(
	{
		...replayA,
		dimension: 'three',
		scenes: [
			{ type: 'title', kicker: 'Kicker', headline: 'Headline copy', subline: 'Subline copy', icon: 'spark' },
			{ type: 'object3d', solid: 'crystal', headline: 'Object', caption: 'Caption', wireframe: true },
			{ type: 'carousel3d', headline: 'Cards', items: [
				{ title: 'One', detail: 'First', icon: 'spark' },
				{ title: 'Two', detail: 'Second', icon: 'bolt' },
				{ title: 'Three', detail: 'Third', icon: 'star' },
			] },
		],
	},
	replayA,
	{ allowThreeDimensional: false },
)
regression(smuggled.dimension !== 'three', 'a model cannot force WebGL when the user did not ask')
regression(dimensionalScenes(smuggled).length === 0, 'model-supplied 3D scenes are rewritten as flat scenes')
regression(smuggled.scenes.length === 3, 'flattening a 3D scene keeps the scene, it does not drop it')

/* -------------------------------------------------------------------------- */
/*  Every video is a different design                                         */
/* -------------------------------------------------------------------------- */

const REPEATED_BRIEF = 'Make a short brand film about our new running shoe, 18 seconds, 16:9.'
const repeatedRuns = []
const seenDesigns = []
const seenTemplates = []
for (let index = 0; index < 12; index += 1) {
	const storyboard = planStoryboard(REPEATED_BRIEF, {
		creativeSeed: seedFor(600 + index),
		avoidDesignFingerprints: seenDesigns,
		avoidTemplates: seenTemplates.slice(-5),
	})
	seenDesigns.push(storyboard.designFingerprint)
	seenTemplates.push(storyboard.creativeProfile.template)
	repeatedRuns.push(storyboard)
}

regression(
	new Set(seenDesigns).size === seenDesigns.length,
	'one brief repeated 12 times never repeats a design identity',
)
regression(
	seenTemplates.every((template, index) => index === 0 || template !== seenTemplates[index - 1]),
	'the same house style never runs twice in a row',
)
regression(new Set(seenTemplates).size >= 8, 'a repeated brief rotates through at least eight house styles')
regression(
	new Set(repeatedRuns.map((item) => item.displayFont + '/' + item.textFont)).size >= 8,
	'a repeated brief rotates through at least eight type pairings',
)
regression(new Set(repeatedRuns.map((item) => item.palette)).size >= 3, 'a repeated brief rotates through several palettes')
regression(
	new Set(repeatedRuns.map((item) => item.creativeProfile.layout)).size >= 4,
	'a repeated brief rotates through at least four layouts',
)
regression(
	new Set(repeatedRuns.map((item) => item.creativeProfile.titleTreatment)).size >= 3,
	'a repeated brief rotates through several headline treatments',
)
regression(
	repeatedRuns.every((item) => item.dimension !== 'three'),
	'a repeated brief that never says 3D stays out of WebGL every single time',
)

// Every recipe the profile can emit must be one the composer actually renders.
const composedRepeat = composeVideoSource(repeatedRuns[0]).code
regression(
	repeatedRuns.every((item) => composeVideoSource(item).code !== composedRepeat || item === repeatedRuns[0]),
	'each design identity produces different Remotion source',
)

const masterTemplate = stripComments(
	fs.readFileSync(path.join(__dirname, '..', 'samples', 'ai-master-template.tsx'), 'utf8'),
)
regression(
	FORBIDDEN_BACKGROUND_GRIDS.every(([pattern]) => !pattern.test(masterTemplate)),
	'master template contains no prohibited background grid implementation',
)
regression(
	FORBIDDEN_BACKGROUND_GRIDS.every(([pattern]) => !pattern.test("<div style={{display: 'grid'}} />")),
	'background audit permits CSS Grid as a layout mechanism',
)

const chartStoryboard = planStoryboard(
	'Quarterly chart: revenue 42 percent growth, 1200 customers, and 18 markets, 20 seconds, 16:9.',
	{ creativeSeed: seedFor(210) },
)
const chartExecutable = stripComments(composeVideoSource(chartStoryboard).code)
regression(chartExecutable.includes("key={'grid-' + line}"), 'semantic chart guide lines remain available')
regression(
	FORBIDDEN_BACKGROUND_GRIDS.every(([pattern]) => !pattern.test(chartExecutable)),
	'semantic chart guide lines do not trigger the background-grid audit',
)

if (failures > 0) {
	console.error(`\n${failures} of ${PROMPTS.length} prompts failed.`)
	process.exit(1)
}

console.log(`\nAll ${PROMPTS.length} prompts composed a valid Remotion file.`)
