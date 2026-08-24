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
import { analyzeSources } from './source-audit'
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

export { analyzeSources }

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
