'use client'

import { basename, normalizePath, stripCommonRoot } from './path-utils'
import type { SourceFile, VirtualProject } from './types'

export const CODE_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.cjs', '.css', '.json']

/**
 * Types a picker might report for a source file. A `.tsx` has no registered
 * type anywhere, so browsers hand back `text/plain`, an empty string, or
 * `application/octet-stream` depending on the platform and the provider.
 */
export const CODE_MIME_TYPES = [
	'text/plain',
	'text/javascript',
	'application/javascript',
	'application/json',
	'text/css',
]

/** Types that are definitely not source, whatever the filename says. */
const BINARY_TYPE_PREFIXES = ['image/', 'video/', 'audio/', 'font/']
const BINARY_TYPES = ['application/pdf', 'application/zip', 'application/x-zip-compressed']
export const MAX_FILE_BYTES = 2 * 1024 * 1024
export const MAX_FILES = 200

const IGNORED = [
	'node_modules/',
	'.git/',
	'__MACOSX/',
	'.next/',
	'dist/',
	'build/',
	'.DS_Store',
]

function isIgnored(path: string): boolean {
	if (IGNORED.some((prefix) => path.startsWith(prefix) || path.includes(`/${prefix}`))) return true
	return basename(path).startsWith('.')
}

function isCodeFile(path: string): boolean {
	return CODE_EXTENSIONS.some((extension) => path.toLowerCase().endsWith(extension))
}

/**
 * Entry point heuristics, in order of confidence:
 * an explicit remotion entry -> a Root file -> the only component file -> the biggest file.
 */
export function pickEntry(files: SourceFile[]): string {
	const paths = files.map((f) => f.path)
	const preferred = [
		'src/index.ts',
		'src/index.tsx',
		'index.ts',
		'index.tsx',
		'remotion/index.ts',
		'src/Root.tsx',
		'Root.tsx',
		'src/Video.tsx',
		'Video.tsx',
	]
	for (const candidate of preferred) {
		if (paths.includes(candidate)) return candidate
	}

	const withRegisterRoot = files.find((f) => /registerRoot\s*\(/.test(f.contents))
	if (withRegisterRoot) return withRegisterRoot.path

	const components = files.filter((f) => f.path.endsWith('.tsx') || f.path.endsWith('.jsx'))
	if (components.length === 1) return components[0].path
	if (components.length > 1) {
		return [...components].sort((a, b) => b.contents.length - a.contents.length)[0].path
	}

	return files[0]?.path ?? ''
}

function finalize(name: string, rawFiles: SourceFile[]): VirtualProject {
	const usable = rawFiles.filter((file) => isCodeFile(file.path) && !isIgnored(file.path))
	if (usable.length === 0) {
		throw new Error(
			'No TypeScript or JavaScript files found. Upload a .tsx/.jsx file, or a .zip that contains one.',
		)
	}
	if (usable.length > MAX_FILES) {
		throw new Error(`That project has ${usable.length} files - the studio accepts up to ${MAX_FILES}.`)
	}

	const strip = stripCommonRoot(usable.map((f) => f.path))
	const files = usable.map((file) => ({ ...file, path: normalizePath(strip(file.path)) }))
	return { name, entry: pickEntry(files), files }
}

/**
 * Bytes that decoded as text rather than as a mislabelled binary. `File.text()`
 * always decodes UTF-8 and substitutes U+FFFD for what it cannot read, so a
 * dense run of replacement characters - or any NUL - means this was never
 * source code.
 */
function looksLikeSourceText(contents: string): boolean {
	if (contents.trim().length === 0) return false
	if (contents.includes('\u0000')) return false
	const replacements = contents.split('\uFFFD').length - 1
	return replacements / contents.length < 0.01
}

/**
 * The name to file recovered bytes under. A share sheet that renames
 * `Video.tsx` to `Video.tsx.txt` gets the suffix taken back off; one that drops
 * the extension entirely gets `.tsx`, which is what an unlabelled Remotion
 * composition almost always is.
 */
function recoveredPath(path: string): string {
	const withoutTxt = path.replace(/\.txt$/i, '')
	if (isCodeFile(withoutTxt)) return withoutTxt
	return `${withoutTxt || 'composition'}.tsx`
}

/**
 * A single picked file whose extension did not survive the trip. Android's
 * Storage Access Framework, iOS share sheets and cloud providers all rename or
 * strip a `.tsx` on the way through, which would otherwise fail as "no code
 * files found" even though the bytes are a perfectly good composition. Obvious
 * binaries are refused on their reported type; everything else has to decode as
 * text before it is accepted.
 */
async function recoverSourceFile(file: File): Promise<SourceFile | null> {
	const type = (file.type || '').toLowerCase()
	if (BINARY_TYPE_PREFIXES.some((prefix) => type.startsWith(prefix))) return null
	if (BINARY_TYPES.includes(type)) return null

	const source = await readTextFile(file)
	if (!looksLikeSourceText(source.contents)) return null
	return { ...source, path: recoveredPath(source.path) }
}

async function readTextFile(file: File): Promise<SourceFile> {
	if (file.size > MAX_FILE_BYTES) {
		throw new Error(`${file.name} is larger than 2 MB.`)
	}
	return { path: normalizePath((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name), contents: await file.text() }
}

export async function projectFromZip(file: File): Promise<VirtualProject> {
	const JSZip = (await import('jszip')).default
	const zip = await JSZip.loadAsync(await file.arrayBuffer())
	const entries = Object.values(zip.files).filter((entry) => !entry.dir)

	const files: SourceFile[] = []
	for (const entry of entries) {
		const path = normalizePath(entry.name)
		if (!isCodeFile(path) || isIgnored(path)) continue
		files.push({ path, contents: await entry.async('string') })
	}

	return finalize(file.name.replace(/\.zip$/i, ''), files)
}

export async function projectFromFiles(fileList: File[]): Promise<VirtualProject> {
	const zip = fileList.find((file) => file.name.toLowerCase().endsWith('.zip'))
	if (zip) return projectFromZip(zip)

	const files: SourceFile[] = []
	for (const file of fileList) {
		if (!isCodeFile(file.name)) continue
		files.push(await readTextFile(file))
	}

	// Nothing matched by name: one file, picked on a phone, whose extension the
	// picker rewrote. Read it and let the contents decide.
	if (files.length === 0 && fileList.length === 1) {
		const recovered = await recoverSourceFile(fileList[0])
		if (recovered) files.push(recovered)
	}

	const name =
		fileList.length === 1
			? fileList[0].name.replace(/\.[a-z]+$/i, '')
			: `${fileList.length} files`
	return finalize(name, files)
}

/** Loads one of the bundled samples from /public/samples. */
export async function loadSampleProject(sample: {
	file: string
	name: string
}): Promise<VirtualProject> {
	const response = await fetch(`/samples/${sample.file}`, { cache: 'no-store' })
	if (!response.ok) {
		throw new Error(
			`Could not load the sample (${response.status}). Run \`npm run samples\` to regenerate public/samples.`,
		)
	}

	if (sample.file.endsWith('.zip')) {
		const blob = await response.blob()
		return projectFromZip(new File([blob], sample.file, { type: 'application/zip' }))
	}

	const contents = await response.text()
	return finalize(sample.name, [{ path: sample.file, contents }])
}
