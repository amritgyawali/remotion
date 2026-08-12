'use client'

import { basename, normalizePath, stripCommonRoot } from './path-utils'
import type { SourceFile, VirtualProject } from './types'

export const CODE_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.cjs', '.css', '.json']
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
