'use client'

import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { scoreResume } from '../../lib/resume/ats'
import { EMPTY_RESUME, normalizeResume, type AtsReport, type ResumeChatMessage, type ResumeData } from '../../lib/resume/types'
import { IconAlert, IconCheck, IconFile, IconSparkle, IconSpinner, IconUpload, IconWand } from '../Icons'
import AtsPanel from './AtsPanel'
import ResumeHeader from './ResumeHeader'
import ResumePreview from './ResumePreview'

type WorkspaceMode = 'create' | 'analyze'

type AnalyzeResult = {
	fileName: string
	extractedText: string
	report: AtsReport
	recommendations: string[]
	strengths: string[]
	model: string | null
	notice: string | null
}

const STARTERS = [
	{
		label: 'Software engineer',
		value: 'Create a software engineer resume. I will paste my contact details, experience, education, skills, and verified results below:\n\n',
	},
	{
		label: 'Career changer',
		value: 'Create a resume for a career change. Emphasize transferable skills without inventing experience. My background and target role are:\n\n',
	},
	{
		label: 'Improve my draft',
		value: 'Rewrite this resume to be more concise, achievement-led, and ATS friendly. Preserve every fact and do not invent metrics:\n\n',
	},
]

const INITIAL_MESSAGE: ResumeChatMessage = {
	id: 'resume-welcome',
	role: 'assistant',
	text: 'Tell me your contact details, target role, experience, education, skills, and real achievements. Paste everything at once or refine the draft with follow-up messages.',
	tone: 'note',
}

const hasResumeContent = (resume: ResumeData) =>
	Boolean(resume.contact.name || resume.summary || resume.experience.length || resume.education.length)

export default function ResumeStudio() {
	const [mode, setMode] = useState<WorkspaceMode>('create')
	const [resume, setResume] = useState<ResumeData>(EMPTY_RESUME)
	const [messages, setMessages] = useState<ResumeChatMessage[]>([INITIAL_MESSAGE])
	const [prompt, setPrompt] = useState('')
	const [jobDescription, setJobDescription] = useState('')
	const [generating, setGenerating] = useState(false)
	const [generationStage, setGenerationStage] = useState(0)
	const [selectedFile, setSelectedFile] = useState<File | null>(null)
	const [analyzing, setAnalyzing] = useState(false)
	const [analysis, setAnalysis] = useState<AnalyzeResult | null>(null)
	const [uploadError, setUploadError] = useState('')
	const [restored, setRestored] = useState(false)
	const chatRef = useRef<HTMLDivElement>(null)

	const deferredJobDescription = useDeferredValue(jobDescription)
	const report = useMemo(() => scoreResume(resume, deferredJobDescription), [resume, deferredJobDescription])
	const displayedReport = mode === 'analyze' && analysis ? analysis.report : report
	const canDownload = hasResumeContent(resume)

	useEffect(() => {
		try {
			const saved = window.localStorage.getItem('rvs-resume-draft')
			if (saved) {
				const parsed = JSON.parse(saved) as { version?: unknown; resume?: unknown; jobDescription?: unknown }
				if (parsed.version === 1) {
					setResume(normalizeResume(parsed.resume))
					if (typeof parsed.jobDescription === 'string') setJobDescription(parsed.jobDescription.slice(0, 14_000))
				}
			}
		} catch {
			// A malformed or blocked local draft should never stop the editor.
		} finally {
			setRestored(true)
		}
	}, [])

	useEffect(() => {
		if (!restored) return
		try {
			window.localStorage.setItem('rvs-resume-draft', JSON.stringify({ version: 1, resume, jobDescription }))
		} catch {
			// Private browsing can deny storage; the live editor remains functional.
		}
	}, [jobDescription, restored, resume])

	useEffect(() => {
		if (!generating) {
			setGenerationStage(0)
			return
		}
		const timer = window.setInterval(() => setGenerationStage((current) => Math.min(current + 1, 3)), 2_300)
		return () => window.clearInterval(timer)
	}, [generating])

	useEffect(() => {
		if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight
	}, [generating, messages])

	const generate = async (override?: string, includeCurrentResume = true) => {
		const requestText = (override ?? prompt).trim()
		if (requestText.length < 10 || generating) return
		const userMessage: ResumeChatMessage = { id: `resume-user-${Date.now()}`, role: 'user', text: override ? 'Improve the uploaded resume using the ATS findings.' : requestText }
		const history = messages.slice(-8).map(({ role, text }) => ({ role, text }))
		setMessages((current) => [...current, userMessage])
		setPrompt('')
		setGenerating(true)
		setMode('create')
		try {
			const response = await fetch('/api/resume/generate', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					prompt: requestText,
					jobDescription,
					history,
					currentResume: includeCurrentResume && hasResumeContent(resume) ? resume : undefined,
				}),
			})
			const data = (await response.json().catch(() => ({}))) as {
				error?: string
				assistantMessage?: string
				resume?: unknown
				model?: string
			}
			if (!response.ok || !data.resume) throw new Error(data.error || `Resume generation returned HTTP ${response.status}.`)
			const next = normalizeResume(data.resume)
			setResume(next)
			setMessages((current) => [
				...current,
				{
					id: `resume-assistant-${Date.now()}`,
					role: 'assistant',
					text: data.assistantMessage || 'Your ATS-friendly resume is ready. Click any preview text to edit it.',
					tone: 'success',
					model: data.model,
				},
			])
		} catch (error) {
			setMessages((current) => [
				...current,
				{
					id: `resume-error-${Date.now()}`,
					role: 'assistant',
					text: error instanceof Error ? error.message : 'Resume generation failed.',
					tone: 'error',
				},
			])
		} finally {
			setGenerating(false)
		}
	}

	const analyze = async () => {
		if (!selectedFile || analyzing) return
		setAnalyzing(true)
		setUploadError('')
		setAnalysis(null)
		try {
			const form = new FormData()
			form.set('resume', selectedFile)
			form.set('jobDescription', jobDescription)
			const response = await fetch('/api/resume/analyze', { method: 'POST', body: form })
			const data = (await response.json().catch(() => ({}))) as Partial<AnalyzeResult> & { error?: string }
			if (!response.ok || !data.report || !data.extractedText) throw new Error(data.error || `Analysis returned HTTP ${response.status}.`)
			setAnalysis({
				fileName: data.fileName || selectedFile.name,
				extractedText: data.extractedText,
				report: data.report,
				recommendations: data.recommendations ?? [],
				strengths: data.strengths ?? [],
				model: data.model ?? null,
				notice: data.notice ?? null,
			})
		} catch (error) {
			setUploadError(error instanceof Error ? error.message : 'The resume could not be analyzed.')
		} finally {
			setAnalyzing(false)
		}
	}

	const improveUploaded = () => {
		if (!analysis || generating) return
		const instruction = [
			'Rebuild the uploaded resume below as a truthful ATS-friendly resume. Preserve every supplied fact. Apply the audit fixes, but never invent missing metrics or experience.',
			`AUDIT FIXES:\n${[...analysis.report.improvements, ...analysis.recommendations].slice(0, 10).join('\n')}`,
			`UPLOADED RESUME:\n${analysis.extractedText.slice(0, 11_500)}`,
		].join('\n\n')
		void generate(instruction, false)
	}

	const resetDraft = () => {
		if (!window.confirm('Clear the saved resume draft and conversation from this browser?')) return
		setResume(EMPTY_RESUME)
		setMessages([INITIAL_MESSAGE])
		setPrompt('')
		setJobDescription('')
		setAnalysis(null)
		setSelectedFile(null)
		window.localStorage.removeItem('rvs-resume-draft')
	}

	const stages = ['Reading your facts', 'Matching the target role', 'Writing achievement bullets', 'Running ATS checks']

	return (
		<div className="app resume-app">
			<ResumeHeader />
			<div className="resume-workspace">
				<aside className="resume-controls">
					<div className="resume-mode-tabs" role="tablist" aria-label="Resume tools">
						<button role="tab" aria-selected={mode === 'create'} data-active={mode === 'create'} onClick={() => setMode('create')}>
							<IconSparkle size={13} /> Create
						</button>
						<button role="tab" aria-selected={mode === 'analyze'} data-active={mode === 'analyze'} onClick={() => setMode('analyze')}>
							<IconFile size={13} /> ATS Check
						</button>
					</div>

					<div className="resume-controls-scroll">
						<div className="resume-section-intro">
							<span className="resume-kicker">{mode === 'create' ? 'NVIDIA resume writer' : 'Resume audit'}</span>
							<h1>{mode === 'create' ? 'Turn your facts into a stronger resume.' : 'See what an ATS can actually read.'}</h1>
							<p>{mode === 'create' ? 'Share real details in chat. The AI rewrites and organizes them without inventing experience.' : 'Upload a text-based PDF, DOCX, or TXT. You will get a transparent score and exact fixes.'}</p>
						</div>

						<label className="resume-field-label" htmlFor="resume-job-description">
							Target job description <span>recommended</span>
						</label>
						<textarea
							id="resume-job-description"
							className="input textarea resume-job-description"
							value={jobDescription}
							maxLength={14_000}
							rows={5}
							placeholder="Paste the full job description for keyword matching and tailored writing…"
							onChange={(event) => {
								setJobDescription(event.target.value)
								if (analysis) setAnalysis(null)
							}}
						/>

						{mode === 'create' ? (
							<>
								<div className="resume-chat" ref={chatRef} aria-live="polite">
									{messages.map((message) => (
										<div className={`resume-message resume-message--${message.role}`} data-tone={message.tone ?? 'normal'} key={message.id}>
											{message.tone === 'success' ? <IconCheck size={12} /> : message.tone === 'error' ? <IconAlert size={12} /> : null}
											<span>{message.text}{message.model ? <small>Written with {message.model}</small> : null}</span>
										</div>
									))}
									{generating ? (
										<div className="resume-ai-working">
											<span><IconSparkle size={13} /></span>
											<div><strong>{stages[generationStage]}…</strong><small>NVIDIA is preserving your facts while optimizing the structure.</small></div>
										</div>
									) : null}
								</div>

								<div className="resume-prompt-box">
									<label className="sr-only" htmlFor="resume-prompt">Tell the resume writer about your experience</label>
									<textarea
										id="resume-prompt"
										value={prompt}
										rows={6}
										maxLength={14_000}
										disabled={generating}
										placeholder="Example: I’m Maya Shah, a product designer with 5 years… Include employers, dates, skills, education, and real results."
										onChange={(event) => setPrompt(event.target.value)}
										onKeyDown={(event) => {
											if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
												event.preventDefault()
												void generate()
											}
										}}
									/>
									<div className="resume-prompt-footer">
										<span><b>⌘/Ctrl Enter</b> to send</span>
										<button className="btn btn--primary" disabled={generating || prompt.trim().length < 10} onClick={() => void generate()}>
											{generating ? <IconSpinner size={13} /> : <IconWand size={13} />}
											{canDownload ? 'Update resume' : 'Create resume'}
										</button>
									</div>
								</div>
								{!canDownload && messages.length === 1 ? (
									<div className="resume-starters">
										{STARTERS.map((starter) => <button key={starter.label} onClick={() => setPrompt(starter.value)}><IconSparkle size={11} />{starter.label}</button>)}
									</div>
								) : null}
							</>
						) : (
							<div className="resume-upload-flow">
								<label className="resume-dropzone" data-selected={Boolean(selectedFile)}>
									<input
										type="file"
										accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
										onChange={(event) => {
											setSelectedFile(event.target.files?.[0] ?? null)
											setAnalysis(null)
											setUploadError('')
										}}
									/>
									<span className="resume-drop-icon"><IconUpload size={20} /></span>
									<strong>{selectedFile ? selectedFile.name : 'Choose your resume'}</strong>
									<small>{selectedFile ? `${(selectedFile.size / 1024).toFixed(0)} KB · click to replace` : 'PDF, DOCX, or TXT · maximum 6 MB'}</small>
								</label>
								<button className="btn btn--primary btn--lg" disabled={!selectedFile || analyzing} onClick={() => void analyze()}>
									{analyzing ? <IconSpinner size={14} /> : <IconFile size={14} />}
									{analyzing ? 'Reading and scoring…' : 'Check ATS score'}
								</button>
								{uploadError ? <div className="notice notice--error"><IconAlert className="notice-icon" size={13} /><span>{uploadError}</span></div> : null}
								<div className="resume-privacy-note">Your document is processed for this request and is not stored by this app. Resume text is sent to NVIDIA for qualitative recommendations.</div>
								{analysis ? (
									<button className="btn btn--secondary resume-improve-button" disabled={generating} onClick={improveUploaded}>
										<IconWand size={13} /> Improve this resume with AI
									</button>
								) : null}
							</div>
						)}
					</div>
					<div className="resume-control-footer">
						<span>Draft auto-saved on this device</span>
						<button type="button" onClick={resetDraft}>Clear draft</button>
					</div>
				</aside>

				<main className="resume-preview-stage">
					{mode === 'analyze' && analysis ? (
						<div className="resume-audit-preview">
							<div className="resume-audit-heading">
								<div><span>Analysis complete</span><h2>{analysis.fileName}</h2></div>
								<strong>{analysis.report.score}<small>/100</small></strong>
							</div>
							{analysis.strengths.length ? <section><h3>What is working</h3><ul>{analysis.strengths.map((item) => <li key={item}>{item}</li>)}</ul></section> : null}
							{analysis.recommendations.length ? <section><h3>NVIDIA recommendations</h3><ol>{analysis.recommendations.map((item) => <li key={item}>{item}</li>)}</ol></section> : null}
							{analysis.notice ? <div className="notice notice--warn"><IconAlert className="notice-icon" size={13} /><span>The deterministic score is complete. AI recommendations were unavailable: {analysis.notice}</span></div> : null}
							<section className="resume-extracted-text"><h3>Extracted text</h3><pre>{analysis.extractedText}</pre></section>
						</div>
					) : mode === 'analyze' ? (
						<div className="resume-audit-empty">
							<span><IconFile size={25} /></span>
							<h2>Your audit will appear here</h2>
							<p>Upload a resume to inspect its text layer, ATS score, keyword coverage, strengths, and prioritized fixes.</p>
						</div>
					) : (
						<ResumePreview resume={resume} onResume={setResume} />
					)}
				</main>

				<AtsPanel report={displayedReport} resume={resume} canDownload={canDownload && mode === 'create'} />
			</div>
		</div>
	)
}
