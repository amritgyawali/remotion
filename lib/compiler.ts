'use client'

/**
 * A miniature bundler that turns an uploaded Remotion project into live React
 * components, entirely inside the browser.
 *
 *  1. every .ts/.tsx file is transpiled with sucrase (TypeScript + JSX -> CommonJS)
 *  2. a tiny `require` shim resolves relative imports against the virtual file
 *     system and bare imports against MODULE_REGISTRY
 *  3. `registerRoot()` is intercepted so we can read the <Composition /> metadata
 *     without ever mounting the Root component
 */

import * as React from 'react'
import { moduleRegistryForSource, Remotion, SUPPORTED_MODULES } from './module-registry'
import { dirname, extname, joinPath, normalizePath } from './path-utils'
import type { CompileResult, CompiledComposition, SourceFile, VirtualProject } from './types'

const RESOLVE_SUFFIXES = [
	'',
	'.tsx',
	'.ts',
	'.jsx',
	'.js',
	'.mjs',
	'.cjs',
	'/index.tsx',
	'/index.ts',
	'/index.jsx',
	'/index.js',
]

export class CompileError extends Error {
	readonly file?: string

	constructor(message: string, file?: string) {
		super(message)
		this.name = 'CompileError'
		this.file = file
	}
}

type RawComposition = {
	id?: string
	width?: number
	height?: number
	fps?: number
	durationInFrames?: number
	component?: unknown
	defaultProps?: Record<string, unknown>
	isStill?: boolean
}

const DEFAULTS = { width: 1080, height: 1920, fps: 30, durationInFrames: 300 }

function isComponentLike(value: unknown): boolean {
	if (typeof value === 'function') return true
	if (typeof value === 'object' && value !== null && '$$typeof' in value) return true
	return false
}

/** Walks a React element tree looking for <Composition /> / <Still /> declarations. */
function collectCompositions(node: unknown, out: RawComposition[], depth = 0): void {
	if (node === null || node === undefined || depth > 20) return

	if (Array.isArray(node)) {
		for (const child of node) collectCompositions(child, out, depth + 1)
		return
	}

	if (!React.isValidElement(node)) return

	const element = node as React.ReactElement<Record<string, unknown>>
	const type = element.type as { displayName?: string; name?: string } | string
	const props = (element.props ?? {}) as RawComposition & { children?: unknown }

	const name = typeof type === 'string' ? type : (type?.displayName ?? type?.name)
	const isComposition = type === Remotion.Composition || name === 'Composition'
	const isStill = type === Remotion.Still || name === 'Still'

	if (isComposition || isStill) {
		out.push({ ...props, isStill })
		return
	}

	if (props.children) collectCompositions(props.children, out, depth + 1)

	// <Folder /> or a custom wrapper component: call it once to look inside.
	if (typeof type === 'function' && depth < 6) {
		try {
			const rendered = (type as (p: unknown) => unknown)(props)
			collectCompositions(rendered, out, depth + 1)
		} catch {
			/* wrapper used hooks - ignore, metadata can still be set manually */
		}
	}
}

function toCompiled(
	raw: RawComposition,
	index: number,
	needsWebRenderer: boolean,
): CompiledComposition | null {
	if (!isComponentLike(raw.component)) return null
	const inferred =
		!raw.width || !raw.height || !raw.fps || (!raw.isStill && !raw.durationInFrames)
	return {
		id: raw.id ?? `Composition${index + 1}`,
		width: Math.round(raw.width ?? DEFAULTS.width),
		height: Math.round(raw.height ?? DEFAULTS.height),
		fps: raw.fps ?? DEFAULTS.fps,
		durationInFrames: raw.isStill
			? 1
			: Math.round(raw.durationInFrames ?? DEFAULTS.durationInFrames),
		defaultProps: raw.defaultProps,
		inferred,
		component: raw.component as CompiledComposition['component'],
		needsWebRenderer,
	}
}

/** Advanced canvases and media must use Remotion's deterministic web compositor. */
function projectNeedsWebRenderer(files: SourceFile[]): boolean {
	return files
		.filter((file) => ['.ts', '.tsx', '.js', '.jsx'].includes(extname(file.path)))
		.some((file) =>
			/(?:from\s*|require\s*\(\s*)['"](?:@remotion\/(?:media|three|gif)|@react-three\/fiber|three(?:\/addons\/[^'"]+)?)['"]/.test(
				file.contents,
			),
		)
}

/** Optional AI-template manifest audit. Ordinary Remotion uploads need no manifest. */
function auditCreativeManifest(value: unknown, durationInFrames: number): string[] {
	if (value === undefined) return []
	if (typeof value !== 'object' || value === null) {
		return ['CREATIVE_MANIFEST must be an object when provided.']
	}

	const manifest = value as { literalSubjects?: unknown; beats?: unknown }
	const subjects = Array.isArray(manifest.literalSubjects)
		? manifest.literalSubjects.filter((subject): subject is string => typeof subject === 'string')
		: []
	const beats = Array.isArray(manifest.beats) ? manifest.beats : []
	const issues: string[] = []

	if (subjects.length === 0) issues.push('CREATIVE_MANIFEST has no literal subjects.')
	if (beats.length === 0) issues.push('CREATIVE_MANIFEST has no visual proof beats.')

	for (const [index, rawBeat] of beats.entries()) {
		if (typeof rawBeat !== 'object' || rawBeat === null) {
			issues.push(`Visual proof beat ${index + 1} is not an object.`)
			continue
		}
		const beat = rawBeat as {
			id?: unknown
			saying?: unknown
			visibleAction?: unknown
			mustShow?: unknown
			from?: unknown
			durationInFrames?: unknown
		}
		const label = typeof beat.id === 'string' && beat.id ? beat.id : `#${index + 1}`
		if (typeof beat.saying !== 'string' || !beat.saying.trim()) {
			issues.push(`Visual proof beat ${label} has no source saying.`)
		}
		if (typeof beat.visibleAction !== 'string' || !beat.visibleAction.trim()) {
			issues.push(`Visual proof beat ${label} has no visible action.`)
		}
		const mustShow = Array.isArray(beat.mustShow)
			? beat.mustShow.filter((subject): subject is string => typeof subject === 'string')
			: []
		if (mustShow.length === 0) issues.push(`Visual proof beat ${label} has no literal object.`)
		for (const subject of mustShow) {
			if (!subjects.includes(subject)) {
				issues.push(`Visual proof beat ${label} uses undeclared subject "${subject}".`)
			}
		}
		const from = typeof beat.from === 'number' ? beat.from : -1
		const duration = typeof beat.durationInFrames === 'number' ? beat.durationInFrames : 0
		if (from < 0 || duration < 1 || from + duration > durationInFrames) {
			issues.push(`Visual proof beat ${label} falls outside the ${durationInFrames}-frame composition.`)
		}
	}

	return issues.map((issue) => `Creative quality check: ${issue}`)
}

/** Every pack the deployed app serves from public/assets. */
const STUDIO_KIT_PATH = /^[`'"]assets\/(?:3d|audio|visual|texture|fonts)\/v1\//

function staticFileCallsOutsideStudioKit(code: string): boolean {
	const calls = [...code.matchAll(/staticFile\s*\(\s*([^\r\n)]*)\)/g)]
	if (calls.length === 0) return true
	return calls.some((match) => !STUDIO_KIT_PATH.test(match[1].trim()))
}

/**
 * Comments in these files are documentation for the next AI edit and routinely
 * quote the very patterns the checks below look for ("never use useFrame()").
 * Analysing the stripped source keeps every warning about real code.
 */
function stripComments(code: string): string {
	return code.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1')
}

/** Static source analysis - surfaces things the browser engine cannot do. */
export function analyzeSources(files: SourceFile[]): string[] {
	const warnings = new Set<string>()
	const code = stripComments(
		files
			.filter((f) => ['.ts', '.tsx', '.js', '.jsx'].includes(extname(f.path)))
			.map((f) => f.contents)
			.join('\n'),
	)

	const usesStaticFiles = /staticFile\s*\(/.test(code)
	const onlyReferencesStudioKit =
		usesStaticFiles &&
		/staticFile\s*\(\s*[`'"]assets\/(?:3d|audio|visual|texture|fonts)\/v1\//.test(code) &&
		!staticFileCallsOutsideStudioKit(code)
	if (usesStaticFiles && !onlyReferencesStudioKit) {
		warnings.add(
			'This project uses staticFile() outside the built-in asset kit. Files from an uploaded public/ folder are not included, so add those assets to the deployed app or use reachable URLs.',
		)
	}
	if (
		/<\s*(Audio|Html5Audio)[\s/>]/.test(code) &&
		/import\s*{[^}]*\b(?:Audio|Html5Audio)\b[^}]*}\s*from\s*['"]remotion['"]/.test(code)
	) {
		warnings.add(
			'For audio in browser exports, import <Audio> from @remotion/media instead of the legacy remotion Audio/Html5Audio component.',
		)
	}
	// <Video> from @remotion/media is decoded by Remotion's web renderer, which
	// is exactly the supported path - only the legacy remotion/OffthreadVideo
	// tags fall back to the DOM screenshot renderer.
	const mediaVideoImported =
		/import\s*{[^}]*\bVideo\b[^}]*}\s*from\s*['"]@remotion\/media['"]/.test(code)
	if (/<\s*(Video|OffthreadVideo)[\s/>]/.test(code) && !mediaVideoImported) {
		warnings.add(
			'Video layers may not rasterise reliably in the legacy browser path. Use @remotion/media or the server renderer for media-heavy projects.',
		)
	}
	if (/calculateMetadata/.test(code)) {
		warnings.add(
			'calculateMetadata() is not executed in the browser preview. Adjust the size and duration manually if they look wrong.',
		)
	}
	if (/from\s+['"]@remotion\/(three|gif)['"]/.test(code)) {
		warnings.add(
			'Advanced canvas packages are supported by the browser renderer, but 3D and animated GIF layers can be demanding at 2x. Use Max/1x first, then 2x or the server renderer on capable hardware.',
		)
	}
	if (/(?:@remotion\/three|@react-three\/fiber)/.test(code) && /\buseFrame\s*\(/.test(code)) {
		warnings.add(
			'3D animation must use useCurrentFrame(), not React Three Fiber useFrame(), so preview, seeking and exports stay deterministic.',
		)
	}
	if (/GLTFLoader/.test(code) && /\buseLoader\s*\(/.test(code)) {
		warnings.add(
			'Load GLB models through GLTFLoader with delayRender()/continueRender(), not useLoader() alone, so Remotion waits for parsing before it captures a frame.',
		)
	}
	if (/GLTFLoader/.test(code) && (!/\bdelayRender\s*\(/.test(code) || !/\bcontinueRender\s*\(/.test(code))) {
		warnings.add(
			'GLB loading must be wrapped in delayRender()/continueRender() so preview, browser export and server rendering wait for the model.',
		)
	}
	// The browser exporter serialises inline SVG. A tag sized only by CSS has no
	// intrinsic size once serialised and is rasterised at the wrong scale, which
	// silently shifts or crops that layer in the exported file.
	const svgTags = code.match(/<svg\b[^>]*>/g) ?? []
	if (svgTags.some((tag) => !/\bwidth[=\s]/.test(tag) || !/\bheight[=\s]/.test(tag))) {
		warnings.add(
			'Give every inline <svg> explicit width and height attributes (not only CSS). Without them, browser exports rasterise the SVG at the wrong scale.',
		)
	}
	// The browser exporter rasterises <img>/<canvas>/SVG and CSS gradients, but
	// not url() background layers, so those vanish from the file.
	if (/background(?:-image)?\s*:\s*[^;'"`]*url\(/i.test(code) || /backgroundImage\s*:\s*[`'"][^`'"]*url\(/i.test(code)) {
		warnings.add(
			'Images used as CSS background-image: url(...) are not drawn in browser exports. Render them with <Img> from remotion instead, or use the server renderer.',
		)
	}
	// Browser exports copy the WebGL canvas after the frame is composited, which
	// only keeps pixels when the drawing buffer is preserved.
	if (/<\s*ThreeCanvas\b/.test(code) && !/preserveDrawingBuffer\s*:\s*true/.test(code)) {
		warnings.add(
			'Add gl={{preserveDrawingBuffer: true}} to <ThreeCanvas>. Without it, browser exports capture an empty 3D canvas even though the preview looks correct.',
		)
	}
	const threeCanvasTags = code.match(/<\s*ThreeCanvas\b[\s\S]*?>/g) ?? []
	if (threeCanvasTags.some((tag) => !/\bwidth\s*=/.test(tag) || !/\bheight\s*=/.test(tag))) {
		warnings.add(
			'Give every <ThreeCanvas> explicit width and height props from useVideoConfig() so the render surface matches the composition.',
		)
	}
	if (
		threeCanvasTags.length > 0 &&
		!/<\s*(?:ambientLight|directionalLight|hemisphereLight|pointLight|spotLight|rectAreaLight)\b/.test(code)
	) {
		warnings.add(
			'Add intentional lighting inside <ThreeCanvas>; GLB materials may render black without a light source or environment.',
		)
	}
	if (/@react-three\/fiber/.test(code) && /<\s*Canvas\b/.test(code)) {
		warnings.add(
			'Wrap 3D scenes in <ThreeCanvas> from @remotion/three instead of React Three Fiber <Canvas> so frame rendering stays synchronized.',
		)
	}
	return [...warnings]
}

export async function compileProject(project: VirtualProject): Promise<CompileResult> {
	const source = project.files
		.filter((file) => ['.ts', '.tsx', '.js', '.jsx'].includes(extname(file.path)))
		.map((file) => file.contents)
		.join('\n')
	const [{ transform }, moduleRegistry] = await Promise.all([
		import('sucrase'),
		moduleRegistryForSource(source),
	])
	const needsWebRenderer = projectNeedsWebRenderer(project.files)

	const fileMap = new Map<string, string>()
	for (const file of project.files) fileMap.set(normalizePath(file.path), file.contents)

	const entry = normalizePath(project.entry)
	if (!fileMap.has(entry)) {
		throw new CompileError(`Entry file "${entry}" is missing from the upload.`)
	}

	const moduleCache = new Map<string, { exports: Record<string, unknown> }>()
	const cssChunks: string[] = []
	const warnings = analyzeSources(project.files)
	let capturedRoot: unknown = null

	const remotionShim = {
		...(Remotion as unknown as Record<string, unknown>),
		__esModule: true,
		registerRoot: (component: unknown) => {
			capturedRoot = component
		},
	}

	function resolveRelative(specifier: string, importer: string): string | null {
		const base = dirname(importer)
		const target = joinPath(base, specifier)
		for (const suffix of RESOLVE_SUFFIXES) {
			const candidate = normalizePath(`${target}${suffix}`)
			if (fileMap.has(candidate)) return candidate
		}
		return null
	}

	function requireModule(specifier: string, importer: string): unknown {
		if (specifier === 'remotion') return remotionShim

		if (specifier.startsWith('.') || specifier.startsWith('/')) {
			const resolved = resolveRelative(specifier, importer)
			if (!resolved) {
				throw new CompileError(
					`Cannot resolve "${specifier}" imported from "${importer}". Upload the whole project as a .zip so relative imports keep working.`,
					importer,
				)
			}
			return loadFile(resolved)
		}

		// Bare specifier, possibly with a deep path such as `@remotion/transitions/fade`.
		if (specifier in moduleRegistry) return moduleRegistry[specifier]

		throw new CompileError(
			`"${specifier}" is not available in the studio sandbox.\nSupported packages: ${SUPPORTED_MODULES.join(', ')}`,
			importer,
		)
	}

	function loadFile(path: string): Record<string, unknown> {
		const cached = moduleCache.get(path)
		if (cached) return cached.exports

		const source = fileMap.get(path) ?? ''
		const ext = extname(path)

		if (ext === '.css') {
			cssChunks.push(source)
			const empty = { exports: {} }
			moduleCache.set(path, empty)
			return empty.exports
		}

		if (ext === '.json') {
			const parsed = { exports: JSON.parse(source) as Record<string, unknown> }
			moduleCache.set(path, parsed)
			return parsed.exports
		}

		let compiled: string
		try {
			compiled = transform(source, {
				transforms: ['typescript', 'jsx', 'imports'],
				jsxRuntime: 'automatic',
				production: true,
				filePath: path,
			}).code
		} catch (error) {
			throw new CompileError(
				`Syntax error in ${path}\n${error instanceof Error ? error.message : String(error)}`,
				path,
			)
		}

		const module = { exports: {} as Record<string, unknown> }
		moduleCache.set(path, module)

		try {
			const factory = new Function(
				'require',
				'module',
				'exports',
				'__filename',
				'__dirname',
				compiled,
			) as (
				require: (specifier: string) => unknown,
				module: { exports: Record<string, unknown> },
				exports: Record<string, unknown>,
				filename: string,
				dir: string,
			) => void

			factory(
				(specifier: string) => requireModule(specifier, path),
				module,
				module.exports,
				path,
				dirname(path),
			)
		} catch (error) {
			if (error instanceof CompileError) throw error
			throw new CompileError(
				`Error while evaluating ${path}\n${error instanceof Error ? error.message : String(error)}`,
				path,
			)
		}

		return module.exports
	}

	const entryExports = loadFile(entry)
	const raw: RawComposition[] = []
	if (capturedRoot) {
		try {
			const rendered =
				typeof capturedRoot === 'function'
					? (capturedRoot as (props: unknown) => unknown)({})
					: capturedRoot
			collectCompositions(rendered, raw)
		} catch (error) {
			warnings.push(
				`Could not read the composition list automatically (${
					error instanceof Error ? error.message : String(error)
				}). Falling back to the exported component.`,
			)
		}
	}

	let compositions = raw
		.map((composition, index) => toCompiled(composition, index, needsWebRenderer))
		.filter((value): value is CompiledComposition => value !== null)

	// Fallback: a single file that just exports the component.
	if (compositions.length === 0) {
		const config = (entryExports.config ??
			entryExports.videoConfig ??
			entryExports.compositionConfig ??
			{}) as Partial<CompiledComposition>

		const candidate =
			(isComponentLike(entryExports.default) && entryExports.default) ||
			Object.entries(entryExports).find(
				([key, value]) => /^[A-Z]/.test(key) && isComponentLike(value),
			)?.[1]

		if (!candidate) {
			throw new CompileError(
				'No composition found. Export a React component, or register one with registerRoot() and <Composition />.',
				entry,
			)
		}

		compositions = [
			{
				id: config.id ?? 'Video',
				width: config.width ?? DEFAULTS.width,
				height: config.height ?? DEFAULTS.height,
				fps: config.fps ?? DEFAULTS.fps,
				durationInFrames: config.durationInFrames ?? DEFAULTS.durationInFrames,
				inferred: !config.width || !config.height,
				component: candidate as CompiledComposition['component'],
				needsWebRenderer,
			},
		]
		warnings.push(
			'No <Composition /> was registered, so the studio used the exported component with default settings. Fine-tune the size and duration below.',
		)
	}

	const longestComposition = Math.max(...compositions.map((composition) => composition.durationInFrames))
	warnings.push(...auditCreativeManifest(entryExports.CREATIVE_MANIFEST, longestComposition))

	return { compositions, warnings, css: cssChunks.join('\n\n') }
}
