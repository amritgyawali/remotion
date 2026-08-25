'use client'

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { AiModelId } from '../lib/ai-models'
import { IconAlert, IconArrowUp, IconCheck, IconSparkle, IconSpinner } from './Icons'

export type AiChatMessage = {
	id: string
	role: 'user' | 'assistant'
	text: string
	tone?: 'normal' | 'success' | 'error' | 'note'
	meta?: string[]
}

export type AiGenerationRequest = {
	prompt: string
	model: AiModelId
	renderAfterGenerate: boolean
	history: Array<Pick<AiChatMessage, 'role' | 'text'>>
	creativeSeed: string
	avoidDesignFingerprints: string[]
	/** House styles of the caller's recent videos, so none repeats back to back. */
	avoidTemplates: string[]
}

export type AiGenerationResult = {
	model: string
	source: 'nvidia' | 'studio'
	compositionId: string
	summary: string
	scenes: string[]
	seconds: number
	title: string
	generationId: string
	designFingerprint: string
	template?: string
	notice?: string
	renderQueued: boolean
}

/**
 * The model choice and the render-after-generate switch are deliberate defaults
 * rather than questions: "auto" already walks the fastest planner first and
 * falls back on its own, and a finished file is what people came for. Both stay
 * here as constants so the behaviour is unchanged while the UI stays a single
 * box with a single button.
 */
const MODEL: AiModelId = 'auto'
const RENDER_AFTER_GENERATE = true
const DESIGN_HISTORY_KEY = 'remotion-video-studio:recent-design-fingerprints:v1'
const TEMPLATE_HISTORY_KEY = 'remotion-video-studio:recent-templates:v1'
const MAX_RECENT_DESIGNS = 32
/**
 * Only the last few house styles are withheld. Blocking more of them would
 * shrink the pool faster than it refills and force the resolver into repeats.
 */
const MAX_RECENT_TEMPLATES = 5

const STARTERS: Array<{ label: string; prompt: string }> = [
	{
		label: 'History of Nepal',
		prompt:
			'Cinematic 20-second history of Nepal, 16:9, animated timeline, mountain scenery, temple architecture and elegant serif typography.',
	},
	{
		label: 'Product launch',
		prompt:
			'15-second product launch for a solar-powered camera, warm desert light, bold minimal copy, 9:16, end with "See farther."',
	},
	{
		label: 'Explainer',
		prompt:
			'30-second explainer showing how the JavaScript event loop works, dark technical style, honest diagrams, 16:9, no voiceover.',
	},
	{
		label: 'Luxury teaser',
		prompt:
			'Luxury editorial teaser for a Nepali mountain hotel, mist, paper texture, elegant serif typography, 20 seconds, 1:1.',
	},
]

const SCENE_LABELS: Record<string, string> = {
	title: 'Title',
	statement: 'Statement',
	timeline: 'Timeline',
	map: 'Map',
	landscape: 'Landscape',
	monument: 'Monument',
	gallery: 'Gallery',
	stats: 'Stats',
	chart: 'Chart',
	process: 'Process',
	quote: 'Quote',
	cta: 'Call to action',
}

/** Shown one after another while a request is in flight, so the wait reads as progress. */
const WORKING_STAGES = [
	'Planning the storyboard',
	'Writing the scenes and on-screen copy',
	'Composing the Remotion file',
	'Compiling the preview',
]

export default function AiCreator({
	busy,
	variant = 'dock',
	messages,
	onMessages,
	prompt,
	onPrompt,
	onGenerate,
}: {
	busy: boolean
	variant?: 'hero' | 'dock'
	/**
	 * The transcript lives in the studio, not here: the composer is remounted
	 * when the layout switches from the opening screen to the side panel, and a
	 * reply that arrived during that switch must survive it.
	 */
	messages: AiChatMessage[]
	onMessages: Dispatch<SetStateAction<AiChatMessage[]>>
	/**
	 * The unsent draft, for the same reason - and one more: a half-written brief
	 * is often the most valuable thing on screen, so the studio owns it and
	 * writes it to the local vault as it is typed.
	 */
	prompt: string
	onPrompt: Dispatch<SetStateAction<string>>
	onGenerate: (request: AiGenerationRequest) => Promise<AiGenerationResult>
}) {
	const setPrompt = onPrompt
	const [generating, setGenerating] = useState(false)
	const [stage, setStage] = useState(0)
	const chatRef = useRef<HTMLDivElement>(null)
	const recentDesignsRef = useRef<string[]>([])
	const recentTemplatesRef = useRef<string[]>([])

	const disabled = busy || generating

	useEffect(() => {
		try {
			const stored = JSON.parse(window.localStorage.getItem(DESIGN_HISTORY_KEY) ?? '[]') as unknown
			recentDesignsRef.current = Array.isArray(stored)
				? stored.filter((item): item is string => typeof item === 'string').slice(-MAX_RECENT_DESIGNS)
				: []
		} catch {
			recentDesignsRef.current = []
		}
		try {
			const stored = JSON.parse(window.localStorage.getItem(TEMPLATE_HISTORY_KEY) ?? '[]') as unknown
			recentTemplatesRef.current = Array.isArray(stored)
				? stored.filter((item): item is string => typeof item === 'string').slice(-MAX_RECENT_TEMPLATES)
				: []
		} catch {
			recentTemplatesRef.current = []
		}
	}, [])

	useEffect(() => {
		if (!generating) {
			setStage(0)
			return
		}
		const timer = window.setInterval(
			() => setStage((current) => Math.min(current + 1, WORKING_STAGES.length - 1)),
			2600,
		)
		return () => window.clearInterval(timer)
	}, [generating])

	// Keep the newest reply in view without yanking the whole page around.
	useEffect(() => {
		const node = chatRef.current
		if (node) node.scrollTop = node.scrollHeight
	}, [messages, generating])

	const submit = async () => {
		const requestText = prompt.trim()
		if (requestText.length < 3 || disabled) return

		const userMessage: AiChatMessage = {
			id: `user-${Date.now()}`,
			role: 'user',
			text: requestText,
		}
		const history = messages.slice(-8).map(({ role, text }) => ({ role, text }))
		const creativeSeed = window.crypto.randomUUID()
		onMessages((current) => [...current, userMessage])
		setPrompt('')
		setGenerating(true)

		try {
			const result = await onGenerate({
				prompt: requestText,
				model: MODEL,
				renderAfterGenerate: RENDER_AFTER_GENERATE,
				history,
				creativeSeed,
				avoidDesignFingerprints: recentDesignsRef.current,
				avoidTemplates: recentTemplatesRef.current,
			})
			if (result.designFingerprint) {
				const nextDesigns = [
					...recentDesignsRef.current.filter((item) => item !== result.designFingerprint),
					result.designFingerprint,
				].slice(-MAX_RECENT_DESIGNS)
				recentDesignsRef.current = nextDesigns
				try {
					window.localStorage.setItem(DESIGN_HISTORY_KEY, JSON.stringify(nextDesigns))
				} catch {
					// Storage may be disabled; variation still works for the current request.
				}
			}
			if (result.template) {
				const nextTemplates = [
					...recentTemplatesRef.current.filter((item) => item !== result.template),
					result.template,
				].slice(-MAX_RECENT_TEMPLATES)
				recentTemplatesRef.current = nextTemplates
				try {
					window.localStorage.setItem(TEMPLATE_HISTORY_KEY, JSON.stringify(nextTemplates))
				} catch {
					// Storage may be disabled; variation still works for the current request.
				}
			}

			const director = result.source === 'nvidia' ? result.model : 'the Studio director'
			const scenes = result.scenes.map((scene) => SCENE_LABELS[scene] ?? scene)
			const next: AiChatMessage[] = [
				{
					id: `assistant-${Date.now()}`,
					role: 'assistant',
					tone: 'success',
					text: `Built “${result.title || result.compositionId}” with ${director} - ${result.seconds}s, ${scenes.length} scenes. ${
						result.renderQueued
							? 'The final render is starting automatically.'
							: 'Preview it now, then ask for a revision or render it.'
					}`,
					meta: [
						...scenes,
						`Design ${result.designFingerprint.replace(/^design-/, '').slice(0, 8)}`,
						`Generation ${result.generationId.slice(0, 8)}`,
					],
				},
			]
			if (result.notice) {
				next.push({
					id: `assistant-note-${Date.now()}`,
					role: 'assistant',
					tone: 'note',
					text: result.notice,
				})
			}
			onMessages((current) => [...current, ...next])
		} catch (error) {
			onMessages((current) => [
				...current,
				{
					id: `assistant-error-${Date.now()}`,
					role: 'assistant',
					tone: 'error',
					text: error instanceof Error ? error.message : String(error),
				},
			])
		} finally {
			setGenerating(false)
		}
	}

	const showChat = messages.length > 0 || generating

	return (
		<div className={`composer composer--${variant}`}>
			{showChat ? (
				<div className="ai-chat" ref={chatRef} aria-live="polite">
					{messages.map((message) => (
						<div
							key={message.id}
							className={`ai-message ai-message--${message.role}`}
							data-tone={message.tone ?? 'normal'}
						>
							{message.tone === 'error' ? <IconAlert size={13} /> : null}
							{message.tone === 'success' ? <IconCheck size={13} /> : null}
							<span>
								{message.text}
								{message.meta && message.meta.length > 0 ? (
									<span className="ai-scene-chips">
										{message.meta.map((item, index) => (
											<span key={`${message.id}-${item}-${index}`}>{item}</span>
										))}
									</span>
								) : null}
							</span>
						</div>
					))}
					{generating ? (
						<div className="ai-working">
							<span className="ai-working-dot">
								<IconSparkle size={12} />
							</span>
							<span className="ai-working-copy">
								<strong>{WORKING_STAGES[stage]}…</strong>
								<small>Usually 10-40 seconds. The preview loads by itself.</small>
							</span>
						</div>
					) : null}
				</div>
			) : null}

			<div className="ai-prompt-wrap">
				<label className="sr-only" htmlFor="ai-prompt">
					Describe the video you want
				</label>
				<textarea
					id="ai-prompt"
					className="input ai-prompt"
					value={prompt}
					placeholder={
						variant === 'hero'
							? 'A 20-second launch video for my coffee brand - warm morning light, bold copy, vertical for Reels…'
							: 'Ask for a change, or describe a new video…'
					}
					maxLength={6000}
					disabled={disabled}
					rows={variant === 'hero' ? 4 : 3}
					onChange={(event) => setPrompt(event.target.value)}
					onKeyDown={(event) => {
						if (event.key !== 'Enter') return
						if (event.shiftKey) return
						event.preventDefault()
						void submit()
					}}
				/>
				<div className="ai-prompt-footer">
					<span className="ai-prompt-hint">
						<span className="kbd">Enter</span>
						to create
						{prompt.length > 2000 ? <span>· {prompt.length.toLocaleString()} / 6,000</span> : null}
					</span>
					<button
						className={`btn btn--primary ${variant === 'hero' ? 'btn--lg' : 'btn--sm'}`}
						disabled={disabled || prompt.trim().length < 3}
						onClick={() => void submit()}
					>
						{generating ? (
							<IconSpinner size={14} />
						) : variant === 'hero' ? (
							<IconSparkle size={14} />
						) : (
							<IconArrowUp size={14} />
						)}
						{generating ? 'Creating' : variant === 'hero' ? 'Create my video' : 'Send'}
					</button>
				</div>
			</div>

			{/* Idea chips are a first-run nudge; once a video exists the panel stays quiet. */}
			{variant === 'hero' ? (
				<div className="prompt-chips">
					{STARTERS.map((starter) => (
						<button
							key={starter.label}
							type="button"
							className="prompt-chip"
							disabled={disabled}
							onClick={() => setPrompt(starter.prompt)}
						>
							<IconSparkle size={12} />
							{starter.label}
						</button>
					))}
				</div>
			) : null}
		</div>
	)
}
