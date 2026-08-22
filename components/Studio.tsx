'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { composeVideoSource } from '../lib/ai/compose'
import { planStoryboard, promptRequestsThreeDimensional } from '../lib/ai/planner'
import type { TemplateId } from '../lib/ai/variation'
import { compileProject } from '../lib/compiler'
import { loadSampleProject, projectFromFiles, projectFromZip } from '../lib/project'
import { useRenderController } from '../lib/use-render-controller'
import type { SampleDefinition } from '../lib/samples'
import type { CompileResult, RenderSettings, VirtualProject } from '../lib/types'
import RenderPanel from './RenderPanel'
import SourcePanel from './SourcePanel'
import StagePanel from './StagePanel'
import TopBar from './TopBar'
import { IconFilm, IconSliders, IconSparkle } from './Icons'
import type { AiChatMessage, AiGenerationRequest, AiGenerationResult } from './AiCreator'

/** Which single pane a phone shows; the tab bar under the workspace switches it. */
type MobileTab = 'create' | 'preview' | 'export'

const MOBILE_TABS: Array<{ id: MobileTab; label: string; icon: typeof IconFilm }> = [
	{ id: 'create', label: 'Create', icon: IconSparkle },
	{ id: 'preview', label: 'Preview', icon: IconFilm },
	{ id: 'export', label: 'Export', icon: IconSliders },
]

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
	const [mobileTab, setMobileTab] = useState<MobileTab>('preview')
	// Held here, not in the composer: the composer is remounted when the opening
	// screen gives way to the three-pane studio, and the transcript must survive it.
	const [aiMessages, setAiMessages] = useState<AiChatMessage[]>([])

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
			// A phone shows one pane at a time: land on the video, not the form.
			setMobileTab('preview')
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

	/**
	 * One click, one video.
	 *
	 * The server plans the storyboard with NVIDIA and composes the TSX. If the
	 * request fails, the browser runs the very same composer on a locally planned
	 * storyboard, so the studio still loads a finished, renderable composition.
	 */
	const handleAiGenerate = useCallback(
		async (request: AiGenerationRequest): Promise<AiGenerationResult> => {
			type Candidate = {
				code: string
				fileName: string
				projectName: string
				model: string
				source: 'nvidia' | 'studio'
				summary: string
				scenes: string[]
				seconds: number
				aspect: string
				title: string
				generationId: string
				designFingerprint: string
				template?: string
				notice?: string
			}

			const candidates: Candidate[] = []
			let transportError = ''

			try {
				const response = await fetch('/api/ai/generate', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						prompt: request.prompt,
						model: request.model,
						history: request.history,
						creativeSeed: request.creativeSeed,
						avoidDesignFingerprints: request.avoidDesignFingerprints,
						avoidTemplates: request.avoidTemplates,
					}),
				})
				const data = (await response.json().catch(() => ({}))) as Partial<Candidate> & {
					error?: string
					attempts?: Array<{ model?: string; error?: string }>
				}

				if (response.ok && data.code) {
					candidates.push({
						code: data.code,
						fileName: data.fileName || 'ai-generated-video.tsx',
						projectName: data.projectName || 'AI generated video',
						model: data.model || request.model,
						source: data.source === 'studio' ? 'studio' : 'nvidia',
						summary: data.summary ?? '',
						scenes: data.scenes ?? [],
						seconds: data.seconds ?? 0,
						aspect: data.aspect ?? '',
						title: data.title ?? '',
						generationId: data.generationId || request.creativeSeed,
						designFingerprint: data.designFingerprint || '',
						template: data.template,
						notice: data.notice,
					})
				} else {
					transportError =
						data.error ||
						data.attempts?.map((item) => `${item.model}: ${item.error}`).join(' | ') ||
						`The AI service returned ${response.status}.`
				}
			} catch (error) {
				transportError = error instanceof Error ? error.message : String(error)
			}

			// The browser fallback reads the same whole-chat 3D rule the API uses,
			// so an offline generation cannot quietly reintroduce WebGL scenes.
			const allowThreeDimensional = [
				request.prompt,
				...request.history.filter((item) => item.role === 'user').map((item) => item.text),
			].some((text) => promptRequestsThreeDimensional(text))
			const localStoryboard = planStoryboard(request.prompt, {
				creativeSeed: request.creativeSeed,
				avoidDesignFingerprints: request.avoidDesignFingerprints,
				avoidTemplates: request.avoidTemplates as TemplateId[],
				allowThreeDimensional,
			})
			const local = composeVideoSource(localStoryboard)
			candidates.push({
				code: local.code,
				fileName: local.fileName,
				projectName: local.projectName,
				model: 'studio-director',
				source: 'studio',
				summary: local.summary,
				scenes: local.layout.timings.map((timing) => timing.scene.type),
				seconds: Number((local.layout.durationInFrames / local.layout.fps).toFixed(1)),
				aspect: `${local.layout.width}x${local.layout.height}`,
				title: local.projectName,
				generationId: localStoryboard.creativeSeed,
				designFingerprint: localStoryboard.designFingerprint,
				template: localStoryboard.creativeProfile.template,
				notice: transportError
					? `The AI service was unavailable, so the Studio director planned this video in your browser. ${transportError}`
					: 'The Studio director planned this video in your browser.',
			})

			let lastError: unknown = null
			for (const candidate of candidates) {
				const nextProject: VirtualProject = {
					name: candidate.projectName,
					entry: candidate.fileName,
					files: [{ path: candidate.fileName, contents: candidate.code }],
				}

				try {
					const checked = await compileProject(nextProject)
					const first = checked.compositions[0]
					if (!first) throw new Error('The generated file did not register a composition.')
					adoptProject(nextProject)
					if (request.renderAfterGenerate) setAutoRenderEntry(nextProject.entry)
					return {
						model: candidate.model,
						source: candidate.source,
						compositionId: first.id,
						summary: candidate.summary || `${first.width}x${first.height}`,
						scenes: candidate.scenes,
						seconds: candidate.seconds || Math.round(first.durationInFrames / first.fps),
						title: candidate.title || candidate.projectName,
						generationId: candidate.generationId,
						designFingerprint: candidate.designFingerprint,
						template: candidate.template,
						notice: candidate.notice,
						renderQueued: request.renderAfterGenerate,
					}
				} catch (error) {
					lastError = error
					setCompileError(error instanceof Error ? error.message : String(error))
				}
			}

			throw lastError instanceof Error
				? lastError
				: new Error('AI generation stopped before a valid composition was produced.')
		},
		[adoptProject],
	)

	const handleReset = useCallback(() => {
		resetRender()
		setAutoRenderEntry(null)
		setProject(null)
		setAiMessages([])
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

	/** A finished file is the point of the visit, so a phone jumps to it. */
	useEffect(() => {
		if (render.output) setMobileTab('export')
	}, [render.output])

	return (
		<div className="app">
			<TopBar
				project={project}
				engine={render.settings.engine}
				capabilities={render.capabilities}
				webCodecs={render.webCodecs}
				onReset={handleReset}
			/>
			{!project ? (
				/* Nothing loaded yet: one prompt box, full width, no panels to read first. */
				<SourcePanel
					project={null}
					busy={compiling || render.rendering}
					warnings={compileResult?.warnings ?? []}
					error={compileError}
					variant="hero"
					messages={aiMessages}
					onMessages={setAiMessages}
					onFiles={handleFiles}
					onSample={handleSample}
					onEntryChange={handleEntryChange}
					onAiGenerate={handleAiGenerate}
				/>
			) : (
				<>
				<div className="workspace" data-tab={mobileTab}>
					<SourcePanel
						project={project}
						busy={compiling || render.rendering}
						warnings={compileResult?.warnings ?? []}
						variant="panel"
						messages={aiMessages}
						onMessages={setAiMessages}
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
					<nav className="mobile-tabs" aria-label="Studio sections">
						{MOBILE_TABS.map((tab) => {
							const Icon = tab.icon
							return (
								<button
									key={tab.id}
									className="mobile-tab"
									data-active={mobileTab === tab.id}
									aria-current={mobileTab === tab.id}
									onClick={() => setMobileTab(tab.id)}
								>
									<Icon size={17} />
									{tab.label}
								</button>
							)
						})}
					</nav>
				</>
			)}
		</div>
	)
}
