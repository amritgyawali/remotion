'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { compileProject } from '../lib/compiler'
import { loadSampleProject, projectFromFiles, projectFromZip } from '../lib/project'
import { useRenderController } from '../lib/use-render-controller'
import type { SampleDefinition } from '../lib/samples'
import type { CompileResult, RenderSettings, VirtualProject } from '../lib/types'
import RenderPanel from './RenderPanel'
import SourcePanel from './SourcePanel'
import StagePanel from './StagePanel'
import TopBar from './TopBar'
import type { AiGenerationRequest, AiGenerationResult } from './AiCreator'

const INITIAL_SETTINGS: RenderSettings = {
	engine: 'browser',
	preset: 'max',
	format: 'mp4',
	audioEnabled: true,
	scale: 1,
	previewSeconds: 0,
}

export default function Studio() {
	const [project, setProject] = useState<VirtualProject | null>(null)
	const [compileResult, setCompileResult] = useState<CompileResult | null>(null)
	const [compileError, setCompileError] = useState<string | null>(null)
	const [compiling, setCompiling] = useState(false)
	const [selectedId, setSelectedId] = useState<string | null>(null)
	const [autoRenderEntry, setAutoRenderEntry] = useState<string | null>(null)

	const render = useRenderController(INITIAL_SETTINGS)
	const { reset: resetRender, startRender } = render

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

	const adoptProject = useCallback(
		(next: VirtualProject) => {
			resetRender()
			setAutoRenderEntry(null)
			setCompileResult(null)
			setCompileError(null)
			setSelectedId(null)
			setProject(next)
		},
		[resetRender],
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

	const handleAiGenerate = useCallback(
		async (request: AiGenerationRequest): Promise<AiGenerationResult> => {
			const masterSample = {
				file: 'ai-master-template.tsx',
				name: 'AI Master Template',
			}
			let sourceProject = project ?? (await loadSampleProject(masterSample))
			let repaired = false
			let fallbacks: string[] = []
			let usedModel = ''
			let repairError = ''

			for (let pass = 0; pass < 2; pass += 1) {
				const response = await fetch('/api/ai/generate', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						prompt:
							pass === 0
								? request.prompt
								: `Repair the current generated file so it compiles in this studio. Keep the requested creative direction. The compiler error is: ${repairError || 'Unknown compile failure.'}`,
						model: request.model,
						history: request.history,
						files: sourceProject.files,
						entry: sourceProject.entry,
					}),
				})

				const data = (await response.json().catch(() => ({}))) as {
					code?: string
					fileName?: string
					projectName?: string
					model?: string
					fallbacks?: string[]
					error?: string
					attempts?: Array<{ model?: string; error?: string }>
				}
				if (!response.ok || !data.code) {
					const details = data.attempts?.map((item) => `${item.model}: ${item.error}`).join(' | ')
					throw new Error([data.error || `AI generation failed (${response.status}).`, details].filter(Boolean).join(' '))
				}

				const fileName = data.fileName || 'ai-generated-video.tsx'
				const nextProject: VirtualProject = {
					name: data.projectName || 'AI generated video',
					entry: fileName,
					files: [{ path: fileName, contents: data.code }],
				}
				usedModel = data.model || request.model
				fallbacks = [...fallbacks, ...(data.fallbacks ?? [])]

				try {
					const checked = await compileProject(nextProject)
					const first = checked.compositions[0]
					if (!first) throw new Error('The generated file did not register a composition.')
					adoptProject(nextProject)
					if (request.renderAfterGenerate) setAutoRenderEntry(nextProject.entry)
					return {
						model: usedModel,
						compositionId: first.id,
						repaired,
						fallbacks,
						renderQueued: request.renderAfterGenerate,
					}
				} catch (error) {
					if (pass === 1) throw error
					repaired = true
					sourceProject = nextProject
					repairError = error instanceof Error ? error.message : String(error)
					setCompileError(repairError)
				}
			}

			throw new Error('AI generation stopped before a valid composition was produced.')
		},
		[adoptProject, project],
	)

	const handleReset = useCallback(() => {
		resetRender()
		setAutoRenderEntry(null)
		setProject(null)
	}, [resetRender])

	const handleRender = useCallback(() => {
		if (!composition || !project) return
		void startRender({ project, composition, css: compileResult?.css })
	}, [compileResult, composition, project, startRender])

	useEffect(() => {
		if (
			!autoRenderEntry ||
			compiling ||
			render.rendering ||
			!composition ||
			project?.entry !== autoRenderEntry
		) {
			return
		}
		setAutoRenderEntry(null)
		void handleRender()
	}, [autoRenderEntry, compiling, composition, handleRender, project, render.rendering])

	return (
		<div className="app">
			<TopBar
				project={project}
				engine={render.settings.engine}
				capabilities={render.capabilities}
				webCodecs={render.webCodecs}
				onReset={handleReset}
			/>
			<div className="workspace">
				<SourcePanel
					project={project}
					busy={compiling || render.rendering}
					warnings={compileResult?.warnings ?? []}
					onFiles={handleFiles}
					onSample={handleSample}
					onEntryChange={handleEntryChange}
					onAiGenerate={handleAiGenerate}
				/>
				<StagePanel
					compileResult={compileResult}
					composition={composition}
					audioEnabled={render.settings.audioEnabled}
					selectedId={selectedId}
					onSelect={setSelectedId}
					compiling={compiling}
					error={compileError}
				/>
				<RenderPanel
					composition={composition}
					settings={render.settings}
					onSettings={render.updateSettings}
					capabilities={render.capabilities}
					webCodecs={render.webCodecs}
					progress={render.progress}
					output={render.output}
					error={render.error}
					rendering={render.rendering}
					onRender={handleRender}
					onCancel={render.cancel}
					accessKey={render.accessKey}
					onAccessKey={render.setAccessKey}
					log={render.log}
				/>
			</div>
		</div>
	)
}
