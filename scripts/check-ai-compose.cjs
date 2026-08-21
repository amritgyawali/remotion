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

const { planStoryboard } = require('../lib/ai/planner.ts')
const { composeVideoSource } = require('../lib/ai/compose.ts')
const { normalizeStoryboard } = require('../lib/ai/storyboard.ts')

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

const stripComments = (code) =>
	code.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1')

const writeIndex = process.argv.indexOf('--write')
const writeDir = writeIndex === -1 ? null : process.argv[writeIndex + 1]
if (writeDir) fs.mkdirSync(writeDir, { recursive: true })

let failures = 0

for (const [index, prompt] of PROMPTS.entries()) {
	const label = prompt.slice(0, 62).replace(/\s+/g, ' ')
	const issues = []

	try {
		// Round-tripping through the normaliser mirrors what an AI answer goes through.
		const storyboard = normalizeStoryboard(planStoryboard(prompt), planStoryboard(prompt))
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

		for (const call of code.matchAll(/staticFile\s*\(\s*([^\r\n)]*)\)/g)) {
			const argument = call[1].trim()
			if (!/^'assets\/(?:audio|visual|texture|fonts)\/v1\//.test(argument)) {
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

if (failures > 0) {
	console.error(`\n${failures} of ${PROMPTS.length} prompts failed.`)
	process.exit(1)
}

console.log(`\nAll ${PROMPTS.length} prompts composed a valid Remotion file.`)
