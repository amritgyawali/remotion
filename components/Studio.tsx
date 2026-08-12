'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { compileProject } from '../lib/compiler'
import { loadSampleProject, projectFromFiles, projectFromZip } from '../lib/project'
import {
	isWebCodecsSupported,
	renderInBrowser,
	renderStillInBrowser,
	RenderCancelled,
} from '../lib/browser-render'
import {
	DEFAULT_CAPABILITIES,
	fetchServerCapabilities,
	renderOnServer,
} from '../lib/server-render-client'
import { FORMAT_INFO } from '../lib/presets'
import { safeFileName } from '../lib/format'
import type { SampleDefinition } from '../lib/samples'
import type {
	CompileResult,
	RenderOutput,
	RenderProgress,
	RenderSettings,
	ServerCapabilities,
	VirtualProject,
} from '../lib/types'
import RenderPanel from './RenderPanel'
import SourcePanel from './SourcePanel'
import StagePanel from './StagePanel'
import TopBar from './TopBar'

const INITIAL_SETTINGS: RenderSettings = {
	engine: 'browser',
	preset: 'high',
	format: 'mp4',
	scale: 1,
	previewSeconds: 0,
}

const IDLE: RenderProgress = { phase: 'idle', progress: 0 }

export default function Studio() {
	const [project, setProject] = useState<VirtualProject | null>(null)
	const [compileResult, setCompileResult] = useState<CompileResult | null>(null)
	const [compileError, setCompileError] = useState<string | null>(null)
	const [compiling, setCompiling] = useState(false)
	const [selectedId, setSelectedId] = useState<string | null>(null)
	const [settings, setSettings] = useState<RenderSettings>(INITIAL_SETTINGS)
	const [capabilities, setCapabilities] = useState<ServerCapabilities>(DEFAULT_CAPABILITIES)
	const [webCodecs, setWebCodecs] = useState(true)
	const [progress, setProgress] = useState<RenderProgress>(IDLE)
	const [output, setOutput] = useState<RenderOutput | null>(null)
	const [renderError, setRenderError] = useState<string | null>(null)
	const [log, setLog] = useState<string[]>([])
	const [accessKey, setAccessKey] = useState('')
	const [rendering, setRendering] = useState(false)

	const abortRef = useRef<AbortController | null>(null)
	const objectUrlRef = useRef<string | null>(null)

	useEffect(() => {
		setWebCodecs(isWebCodecsSupported())
		let active = true
		fetchServerCapabilities().then((next) => {
			if (active) setCapabilities(next)
		})
		return () => {
			active = false
		}
	}, [])

	/** Compile whenever the project or its entry file changes. */
	useEffect(() => {
		if (!project) {
			setCompileResult(null)
			setCompileError(null)
			setSelectedId(null)
			return
		}
		let active = true
		setCompiling(true)
		setCompileError(null)
		compileProject(project)
			.then((result) => {
				if (!active) return
				setCompileResult(result)
				setSelectedId((current) => {
					const stillThere = result.compositions.some((item) => item.id === current)
					return stillThere ? current : (result.compositions[0]?.id ?? null)
				})
			})
			.catch((error: unknown) => {
				if (!active) return
				setCompileResult(null)
				setSelectedId(null)
				setCompileError(error instanceof Error ? error.message : String(error))
			})
			.finally(() => {
				if (active) setCompiling(false)
			})
		return () => {
			active = false
		}
	}, [project])

	const composition = useMemo(() => {
		if (!compileResult) return null
		return (
			compileResult.compositions.find((item) => item.id === selectedId) ??
			compileResult.compositions[0] ??
			null
		)
	}, [compileResult, selectedId])

	const replaceOutput = useCallback((next: RenderOutput | null) => {
		if (objectUrlRef.current) {
			URL.revokeObjectURL(objectUrlRef.current)
			objectUrlRef.current = null
		}
		if (next && next.url.startsWith('blob:')) objectUrlRef.current = next.url
		setOutput(next)
	}, [])

	const adoptProject = useCallback(
		(next: VirtualProject) => {
			replaceOutput(null)
			setRenderError(null)
			setProgress(IDLE)
			setLog([])
			setProject(next)
		},
		[replaceOutput],
	)

	const handleFiles = useCallback(
		async (files: File[]) => {
			try {
				const zip = files.find((file) => file.name.toLowerCase().endsWith('.zip'))
				const next = zip ? await projectFromZip(zip) : await projectFromFiles(files)
				adoptProject(next)
			} catch (error) {
				setProject(null)
				setCompileError(error instanceof Error ? error.message : String(error))
			}
		},
		[adoptProject],
	)

	const handleSample = useCallback(
		async (sample: SampleDefinition) => {
			try {
				const next = await loadSampleProject({ file: sample.file, name: sample.name })
				adoptProject(next)
			} catch (error) {
				setCompileError(error instanceof Error ? error.message : String(error))
			}
		},
		[adoptProject],
	)

	const handleEntryChange = useCallback((path: string) => {
		setProject((current) => (current ? { ...current, entry: path } : current))
	}, [])

	const handleReset = useCallback(() => {
		abortRef.current?.abort()
		replaceOutput(null)
		setProject(null)
		setRenderError(null)
		setProgress(IDLE)
		setLog([])
	}, [replaceOutput])

	const handleSettings = useCallback((patch: Partial<RenderSettings>) => {
		setSettings((current) => {
			const next = { ...current, ...patch }
			// Keep the format valid for the selected engine.
			if (!FORMAT_INFO[next.format].engines.includes(next.engine)) next.format = 'mp4'
			return next
		})
	}, [])

	const handleRender = useCallback(async () => {
		if (!composition || !project) return

		const controller = new AbortController()
		abortRef.current = controller
		setRendering(true)
		setRenderError(null)
		replaceOutput(null)
		setLog([])
		setProgress({ phase: 'preparing', progress: 0.01 })

		const extension = FORMAT_INFO[settings.format].extension
		const fileName = `${safeFileName(composition.id)}-${settings.preset}.${extension}`

		const onProgress = (next: RenderProgress) => {
			setProgress(next)
			if (next.message) {
				setLog((current) => {
					if (current[current.length - 1] === next.message) return current
					return [...current, next.message as string].slice(-60)
				})
			}
		}

		try {
			const result =
				settings.engine === 'server'
					? await renderOnServer({
							project,
							compositionId: composition.id,
							settings,
							fileName,
							accessKey: accessKey || undefined,
							overrides: {
								width: composition.width,
								height: composition.height,
								fps: composition.fps,
								durationInFrames: composition.durationInFrames,
							},
							onProgress,
							signal: controller.signal,
						})
					: settings.format === 'png'
						? await renderStillInBrowser({
								composition,
								settings,
								css: compileResult?.css,
								fileName,
								onProgress,
								signal: controller.signal,
							})
						: await renderInBrowser({
								composition,
								settings,
								css: compileResult?.css,
								fileName,
								onProgress,
								signal: controller.signal,
							})

			replaceOutput(result)
			setProgress({ phase: 'done', progress: 1, message: 'Render complete' })
		} catch (error) {
			if (error instanceof RenderCancelled || controller.signal.aborted) {
				setProgress({ phase: 'cancelled', progress: 0, message: 'Cancelled' })
			} else {
				setRenderError(error instanceof Error ? error.message : String(error))
				setProgress({ phase: 'error', progress: 0 })
			}
		} finally {
			abortRef.current = null
			setRendering(false)
		}
	}, [accessKey, compileResult, composition, project, replaceOutput, settings])

	const handleCancel = useCallback(() => {
		abortRef.current?.abort()
	}, [])

	return (
		<div className="app">
			<TopBar
				project={project}
				engine={settings.engine}
				capabilities={capabilities}
				webCodecs={webCodecs}
				onReset={handleReset}
			/>
			<div className="workspace">
				<SourcePanel
					project={project}
					busy={compiling || rendering}
					warnings={compileResult?.warnings ?? []}
					onFiles={handleFiles}
					onSample={handleSample}
					onEntryChange={handleEntryChange}
				/>
				<StagePanel
					compileResult={compileResult}
					composition={composition}
					selectedId={selectedId}
					onSelect={setSelectedId}
					compiling={compiling}
					error={compileError}
				/>
				<RenderPanel
					composition={composition}
					settings={settings}
					onSettings={handleSettings}
					capabilities={capabilities}
					webCodecs={webCodecs}
					progress={progress}
					output={output}
					error={renderError}
					rendering={rendering}
					onRender={handleRender}
					onCancel={handleCancel}
					accessKey={accessKey}
					onAccessKey={setAccessKey}
					log={log}
				/>
			</div>
		</div>
	)
}
