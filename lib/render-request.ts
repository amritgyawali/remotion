import path from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import type { ServerRenderRequest } from './types'

export const MAX_UPLOAD_FILES = 200
export const MAX_UPLOAD_FILE_BYTES = 2 * 1024 * 1024
// Leaves room for JSON escaping and request metadata under Vercel's 4.5 MB body cap.
export const MAX_UPLOAD_TOTAL_BYTES = 3 * 1024 * 1024

const ALLOWED_FILE_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.cjs', '.css', '.json']
const ALLOWED_BARE_IMPORTS = new Set([
	'react',
	'react/jsx-runtime',
	'react/jsx-dev-runtime',
	'react-dom',
	'react-dom/client',
	'remotion',
	'@remotion/player',
	'@remotion/shapes',
	'@remotion/paths',
	'@remotion/noise',
	'@remotion/motion-blur',
	'@remotion/transitions',
	'@remotion/transitions/fade',
	'@remotion/transitions/slide',
	'@remotion/transitions/wipe',
	'@remotion/transitions/flip',
	'@remotion/transitions/clock-wipe',
	'@remotion/media-utils',
	'@remotion/media',
	'@remotion/gif',
	'@remotion/three',
	'@react-three/fiber',
	'three',
	'three/addons/loaders/GLTFLoader.js',
])

const IMPORT_SPECIFIER =
	/(?:\bimport\s*(?:[^'";]*?\sfrom\s*)?|\bexport\s+[^'";]*?\sfrom\s*|\brequire\s*\(|\bimport\s*\()\s*['"]([^'"]+)['"]/g

function validateImports(filePath: string, contents: string): void {
	if (/\b(?:require|import)\s*\(\s*(?!['"])/.test(contents)) {
		throw new Error(`${filePath} contains a dynamic module path. Use a literal supported import.`)
	}
	for (const match of contents.matchAll(IMPORT_SPECIFIER)) {
		const specifier = match[1]
		if (specifier.startsWith('./') || specifier.startsWith('../')) continue
		if (!ALLOWED_BARE_IMPORTS.has(specifier)) {
			throw new Error(`${filePath} imports unsupported module "${specifier}".`)
		}
	}
}

/** Blocks absolute paths and `../` escapes before uploaded source touches disk. */
export function sanitizeRelativePath(input: string): string {
	const normalized = path.posix.normalize(input.replace(/\\/g, '/'))
	if (
		normalized === '.' ||
		normalized.startsWith('/') ||
		normalized.startsWith('..') ||
		/^[A-Za-z]:/.test(normalized) ||
		normalized.includes('\0') ||
		path.posix.isAbsolute(normalized)
	) {
		throw new Error(`Refusing to write outside the project: ${input}`)
	}
	return normalized
}

export function validateRenderRequest(body: ServerRenderRequest): void {
	if (!Array.isArray(body.files) || body.files.length === 0) throw new Error('No files were sent.')
	if (body.files.length > MAX_UPLOAD_FILES) {
		throw new Error(`A render can contain at most ${MAX_UPLOAD_FILES} source files.`)
	}
	let totalBytes = 0
	const paths = new Set<string>()
	for (const file of body.files) {
		if (!file || typeof file.path !== 'string' || typeof file.contents !== 'string') {
			throw new Error('Every uploaded source must have a path and text contents.')
		}
		const relativePath = sanitizeRelativePath(file.path)
		if (!ALLOWED_FILE_EXTENSIONS.some((extension) => relativePath.toLowerCase().endsWith(extension))) {
			throw new Error(`${file.path} is not an accepted source-file type.`)
		}
		const pathKey = relativePath.toLowerCase()
		if (paths.has(pathKey)) throw new Error(`Duplicate source path: ${file.path}`)
		paths.add(pathKey)
		const bytes = Buffer.byteLength(file.contents, 'utf8')
		if (bytes > MAX_UPLOAD_FILE_BYTES) throw new Error(`${file.path} is larger than 2 MB.`)
		totalBytes += bytes
		if (/\.(?:tsx?|jsx?|mjs|cjs)$/i.test(relativePath)) validateImports(relativePath, file.contents)
	}
	if (totalBytes > MAX_UPLOAD_TOTAL_BYTES) throw new Error('The uploaded project is larger than 3 MB.')
	if (!body.entry || !body.files.some((file) => sanitizeRelativePath(file.path) === sanitizeRelativePath(body.entry))) {
		throw new Error('The selected project entry is missing.')
	}
}

export async function writeRenderProject(body: ServerRenderRequest, projectDir: string): Promise<string> {
	await mkdir(projectDir, { recursive: true })
	for (const file of body.files) {
		const relative = sanitizeRelativePath(file.path)
		const target = path.join(projectDir, relative)
		await mkdir(path.dirname(target), { recursive: true })
		await writeFile(target, file.contents, 'utf8')
	}

	const entryRelative = sanitizeRelativePath(body.entry)
	const entrySource = body.files.find((file) => sanitizeRelativePath(file.path) === entryRelative)
	let entryPath = path.join(projectDir, entryRelative)

	if (entrySource && !/registerRoot\s*\(/.test(entrySource.contents)) {
		const importSpecifier = `./${entryRelative.replace(/\.(tsx|ts|jsx|js|mjs|cjs)$/i, '')}`
		const meta = body.overrides ?? { width: 1080, height: 1920, fps: 30, durationInFrames: 300 }
		const generated = [
			`import React from 'react';`,
			`import { Composition, registerRoot } from 'remotion';`,
			`import * as Entry from '${importSpecifier}';`,
			`const Component = (Entry.default ?? Object.values(Entry).find((value) => typeof value === 'function'));`,
			`const Root = () => React.createElement(Composition, {`,
			`  id: ${JSON.stringify(body.compositionId || 'Main')},`,
			`  component: Component,`,
			`  width: ${meta.width}, height: ${meta.height}, fps: ${meta.fps},`,
			`  durationInFrames: ${meta.durationInFrames},`,
			`});`,
			`registerRoot(Root);`,
			``,
		].join('\n')
		entryPath = path.join(projectDir, '__studio-entry.tsx')
		await writeFile(entryPath, generated, 'utf8')
	}

	return entryPath
}
