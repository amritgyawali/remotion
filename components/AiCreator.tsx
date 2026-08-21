'use client'

import { useState } from 'react'
import { AI_MODEL_OPTIONS, type AiModelId } from '../lib/ai-models'
import { IconAlert, IconCheck, IconSparkle, IconSpinner } from './Icons'

export type AiChatMessage = {
	id: string
	role: 'user' | 'assistant'
	text: string
	tone?: 'normal' | 'success' | 'error'
}

export type AiGenerationRequest = {
	prompt: string
	model: AiModelId
	renderAfterGenerate: boolean
	history: Array<Pick<AiChatMessage, 'role' | 'text'>>
}

export type AiGenerationResult = {
	model: string
	compositionId: string
	repaired: boolean
	fallbacks: string[]
	renderQueued: boolean
}

const STARTERS = [
	'15-second cinematic product launch for a solar-powered camera, warm desert light, bold minimal copy, 9:16, end with “See farther.”',
	'30-second explainer showing how the JavaScript event loop works, dark technical style, honest diagrams, 16:9, no voiceover.',
	'Luxury editorial teaser for a Nepali mountain hotel, mist, paper texture, elegant serif typography, 20 seconds, 1:1.',
]

export default function AiCreator({
	busy,
	onGenerate,
}: {
	busy: boolean
	onGenerate: (request: AiGenerationRequest) => Promise<AiGenerationResult>
}) {
	const [prompt, setPrompt] = useState('')
	const [model, setModel] = useState<AiModelId>('auto')
	const [renderAfterGenerate, setRenderAfterGenerate] = useState(true)
	const [messages, setMessages] = useState<AiChatMessage[]>([
		{
			id: 'welcome',
			role: 'assistant',
			text: 'Describe the finished video. NVIDIA writes only the replacement TSX source; this Studio compiles it, repairs one failed draft, loads the preview, and renders the output.',
		},
	])
	const [generating, setGenerating] = useState(false)

	const selected = AI_MODEL_OPTIONS.find((option) => option.id === model) ?? AI_MODEL_OPTIONS[0]
	const disabled = busy || generating

	const submit = async () => {
		const requestText = prompt.trim()
		if (!requestText || disabled) return

		const userMessage: AiChatMessage = {
			id: `user-${Date.now()}`,
			role: 'user',
			text: requestText,
		}
		const history = messages
			.filter((message) => message.id !== 'welcome')
			.slice(-8)
			.map(({ role, text }) => ({ role, text }))
		setMessages((current) => [...current, userMessage])
		setPrompt('')
		setGenerating(true)

		try {
			const result = await onGenerate({
				prompt: requestText,
				model,
				renderAfterGenerate,
				history,
			})
			const fallbackNote = result.fallbacks.length
				? ` after ${result.fallbacks.length} fallback${result.fallbacks.length === 1 ? '' : 's'}`
				: ''
			setMessages((current) => [
				...current,
				{
					id: `assistant-${Date.now()}`,
					role: 'assistant',
					tone: 'success',
					text: `Loaded ${result.compositionId} using ${result.model}${fallbackNote}${result.repaired ? ' and repaired a compile issue automatically' : ''}. ${result.renderQueued ? 'The final output render is starting automatically.' : 'Preview it now, then ask for a revision or render the final video.'}`,
				},
			])
		} catch (error) {
			setMessages((current) => [
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

	return (
		<div className="ai-creator">
			<div className="ai-creator-heading">
				<div>
					<div className="ai-kicker">
						<IconSparkle size={13} /> NVIDIA AI director
					</div>
					<h3>Chat → Remotion video</h3>
				</div>
				<span className="badge badge--green">server key</span>
			</div>

			<div className="ai-chat" aria-live="polite">
				{messages.map((message) => (
					<div
						key={message.id}
						className={`ai-message ai-message--${message.role}`}
						data-tone={message.tone ?? 'normal'}
					>
						{message.tone === 'error' ? <IconAlert size={13} /> : null}
						{message.tone === 'success' ? <IconCheck size={13} /> : null}
						<span>{message.text}</span>
					</div>
				))}
				{generating ? (
					<div className="ai-message ai-message--assistant ai-message--working">
						<IconSpinner size={13} />
						<span>Getting TSX source from NVIDIA, then checking it in this Studio…</span>
					</div>
				) : null}
			</div>

			<div className="field">
				<label className="field-label" htmlFor="ai-model">
					Model
				</label>
				<select
					id="ai-model"
					className="select"
					value={model}
					onChange={(event) => setModel(event.target.value as AiModelId)}
					disabled={disabled}
				>
					{AI_MODEL_OPTIONS.map((option) => (
						<option key={option.id} value={option.id}>
							{option.label}
						</option>
					))}
				</select>
				<span className="field-hint">{selected.description}</span>
			</div>

			<label className="ai-auto-render">
				<input
					type="checkbox"
					checked={renderAfterGenerate}
					disabled={disabled}
					onChange={(event) => setRenderAfterGenerate(event.target.checked)}
				/>
				<span>
					<strong>Render output automatically</strong>
					<small>Uses the current engine, quality, format and audio settings.</small>
				</span>
			</label>

			<div className="ai-prompt-wrap">
				<textarea
					className="input ai-prompt"
					value={prompt}
					placeholder="Describe subject, goal, audience, duration, format, exact copy, visual style, pacing, music and CTA…"
					maxLength={6000}
					disabled={disabled}
					onChange={(event) => setPrompt(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
							event.preventDefault()
							void submit()
						}
					}}
				/>
				<div className="ai-prompt-footer">
					<span>{prompt.length.toLocaleString()} / 6,000 · Ctrl/⌘ + Enter</span>
					<button
						className="btn btn--primary btn--sm"
						disabled={disabled || prompt.trim().length < 3}
						onClick={() => void submit()}
					>
						{generating ? <IconSpinner size={12} /> : <IconSparkle size={12} />}
						{generating ? 'Generating' : 'Generate'}
					</button>
				</div>
			</div>

			<details className="ai-ideas">
				<summary>Prompt examples</summary>
				<div>
					{STARTERS.map((starter) => (
						<button key={starter} type="button" onClick={() => setPrompt(starter)} disabled={disabled}>
							{starter}
						</button>
					))}
				</div>
			</details>
		</div>
	)
}
