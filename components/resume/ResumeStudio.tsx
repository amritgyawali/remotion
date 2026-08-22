'use client'

import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { scoreResume } from '../../lib/resume/ats'
import { downloadTextFile, normalizeStoredWorkspace, safeDocumentName, type StoredResumeWorkspace } from '../../lib/resume/toolkit'
import {
	DEFAULT_RESUME_DESIGN,
	EMPTY_RESUME,
	normalizeResume,
	normalizeResumeDesign,
	resumeToPlainText,
	type AtsReport,
	type CareerArtifact,
	type CareerToolId,
	type ResumeChatMessage,
	type ResumeData,
	type ResumeDesign,
	type ResumeVersion,
} from '../../lib/resume/types'
import { IconAlert, IconCheck, IconFile, IconSparkle, IconSpinner, IconUpload, IconWand } from '../Icons'
import AtsPanel from './AtsPanel'
import CareerArtifactPreview from './CareerArtifactPreview'
import CareerToolkitPanel from './CareerToolkitPanel'
import ResumeCanvasToolbar from './ResumeCanvasToolbar'
import ResumeHeader from './ResumeHeader'
import ResumePreview from './ResumePreview'
import ResumeTargetPanel from './ResumeTargetPanel'

type WorkspaceMode = 'create' | 'tailor' | 'toolkit' | 'analyze'

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
	{ label: 'Software engineer', value: 'Create a software engineer resume. I will paste my contact details, experience, education, skills, and verified results below:\n\n' },
	{ label: 'Career changer', value: 'Create a resume for a career change. Emphasize transferable skills without inventing experience. My background and target role are:\n\n' },
	{ label: 'Improve my draft', value: 'Rewrite this resume to be more concise, achievement-led, and ATS friendly. Preserve every fact and do not invent metrics:\n\n' },
]

const INITIAL_MESSAGE: ResumeChatMessage = {
	id: 'resume-welcome',
	role: 'assistant',
	text: 'Tell me your contact details, target role, experience, education, skills, and real achievements. Paste everything at once or refine the draft with follow-up messages.',
	tone: 'note',
}

const MODE_COPY: Record<WorkspaceMode, { kicker: string; title: string; description: string }> = {
	create: { kicker: 'NVIDIA resume writer', title: 'Turn your facts into a stronger resume.', description: 'Share real details in chat. AI organizes and rewrites them without inventing experience.' },
	tailor: { kicker: 'Job match studio', title: 'Tailor every application with evidence.', description: 'Map job keywords, diagnose weak bullets, and optimize only claims you can support.' },
	toolkit: { kicker: 'Free career toolkit', title: 'Build the rest of your application.', description: 'Create a cover letter, outreach email, LinkedIn profile, and interview plan from the same facts.' },
	analyze: { kicker: 'Resume audit', title: 'See what an ATS can actually read.', description: 'Upload a text-based PDF, DOCX, or TXT for a transparent score, keyword map, and exact fixes.' },
}

const hasResumeContent = (resume: ResumeData) =>
	Boolean(resume.contact.name || resume.summary || resume.experience.length || resume.education.length)

export default function ResumeStudio() {
	const [mode, setMode] = useState<WorkspaceMode>('create')
	const [resume, setResume] = useState<ResumeData>(EMPTY_RESUME)
	const [design, setDesign] = useState<ResumeDesign>(DEFAULT_RESUME_DESIGN)
	const [messages, setMessages] = useState<ResumeChatMessage[]>([INITIAL_MESSAGE])
	const [prompt, setPrompt] = useState('')
	const [targetRole, setTargetRole] = useState('')
	const [targetCompany, setTargetCompany] = useState('')
	const [jobDescription, setJobDescription] = useState('')
	const [evidenceNotes, setEvidenceNotes] = useState('')
	const [versions, setVersions] = useState<ResumeVersion[]>([])
	const [artifacts, setArtifacts] = useState<CareerArtifact[]>([])
	const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null)
	const [textView, setTextView] = useState(false)
	const [generating, setGenerating] = useState(false)
	const [activeCareerTool, setActiveCareerTool] = useState<CareerToolId | null>(null)
	const [careerError, setCareerError] = useState('')
	const [generationStage, setGenerationStage] = useState(0)
	const [selectedFile, setSelectedFile] = useState<File | null>(null)
	const [analyzing, setAnalyzing] = useState(false)
	const [analysis, setAnalysis] = useState<AnalyzeResult | null>(null)
	const [uploadError, setUploadError] = useState('')
	const [restored, setRestored] = useState(false)
	const [historyRevision, setHistoryRevision] = useState(0)
	const chatRef = useRef<HTMLDivElement>(null)
	const undoStack = useRef<ResumeData[]>([])
	const redoStack = useRef<ResumeData[]>([])

	const deferredJobDescription = useDeferredValue(jobDescription)
	const report = useMemo(() => scoreResume(resume, deferredJobDescription), [resume, deferredJobDescription])
	const displayedReport = mode === 'analyze' && analysis ? analysis.report : report
	const plainText = useMemo(() => resumeToPlainText(resume), [resume])
	const canDownload = hasResumeContent(resume)
	const canUndo = historyRevision >= 0 && undoStack.current.length > 0
	const canRedo = historyRevision >= 0 && redoStack.current.length > 0

	const commitResume = (next: ResumeData) => {
		if (JSON.stringify(next) === JSON.stringify(resume)) return
		undoStack.current.push(resume)
		if (undoStack.current.length > 50) undoStack.current.shift()
		redoStack.current = []
		setResume(next)
		setHistoryRevision((value) => value + 1)
	}

	useEffect(() => {
		try {
			const saved = window.localStorage.getItem('rvs-resume-draft')
			if (saved) {
				const parsed = JSON.parse(saved) as unknown
				const workspace = normalizeStoredWorkspace(parsed)
				if (workspace) {
					setResume(workspace.resume)
					setDesign(workspace.design)
					setJobDescription(workspace.jobDescription)
					setTargetRole(workspace.targetRole)
					setTargetCompany(workspace.targetCompany)
					setEvidenceNotes(workspace.evidenceNotes)
					setVersions(workspace.versions)
					setArtifacts(workspace.artifacts)
					setSelectedArtifactId(workspace.artifacts[0]?.id ?? null)
				} else if (parsed && typeof parsed === 'object' && (parsed as { version?: unknown }).version === 1) {
					const legacy = parsed as { resume?: unknown; jobDescription?: unknown }
					setResume(normalizeResume(legacy.resume))
					if (typeof legacy.jobDescription === 'string') setJobDescription(legacy.jobDescription.slice(0, 14_000))
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
			const workspace: StoredResumeWorkspace = { version: 2, resume, jobDescription, targetRole, targetCompany, evidenceNotes, design, versions, artifacts }
			window.localStorage.setItem('rvs-resume-draft', JSON.stringify(workspace))
		} catch {
			// Private browsing can deny storage; the live editor remains functional.
		}
	}, [artifacts, design, evidenceNotes, jobDescription, restored, resume, targetCompany, targetRole, versions])

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

	const generate = async ({ instruction, includeCurrentResume = true, messageLabel }: { instruction?: string; includeCurrentResume?: boolean; messageLabel?: string } = {}) => {
		const requestText = (instruction ?? prompt).trim()
		if (requestText.length < 10 || generating) return
		const userMessage: ResumeChatMessage = { id: `resume-user-${Date.now()}`, role: 'user', text: messageLabel || requestText }
		const history = messages.slice(-8).map(({ role, text }) => ({ role, text }))
		setMessages((current) => [...current, userMessage])
		if (!instruction) setPrompt('')
		setGenerating(true)
		try {
			const response = await fetch('/api/resume/generate', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ prompt: requestText, jobDescription, targetRole, targetCompany, evidenceNotes, history, currentResume: includeCurrentResume && hasResumeContent(resume) ? resume : undefined }),
			})
			const data = (await response.json().catch(() => ({}))) as { error?: string; assistantMessage?: string; resume?: unknown; model?: string }
			if (!response.ok || !data.resume) throw new Error(data.error || `Resume generation returned HTTP ${response.status}.`)
			commitResume(normalizeResume(data.resume))
			setMessages((current) => [...current, { id: `resume-assistant-${Date.now()}`, role: 'assistant', text: data.assistantMessage || 'Your ATS-friendly resume is ready. Click any preview text to edit it.', tone: 'success', model: data.model }])
		} catch (error) {
			setMessages((current) => [...current, { id: `resume-error-${Date.now()}`, role: 'assistant', text: error instanceof Error ? error.message : 'Resume generation failed.', tone: 'error' }])
		} finally {
			setGenerating(false)
		}
	}

	const tailorResume = () => void generate({ instruction: 'Tailor the current resume to the target role and job description. Preserve every verified fact, prioritize demonstrated requirements, improve the summary and skill ordering, and never add an unsupported keyword.', messageLabel: 'Tailor my resume to this job without inventing qualifications.' })
	const strengthenBullets = () => void generate({ instruction: 'Improve every weak experience and project bullet using concise action + scope + result writing. Use only verified metrics from the resume or evidence bank. Preserve bullets that are already strong and vary action verbs.', messageLabel: 'Strengthen my achievement bullets using only verified evidence.' })

	const generateCareerArtifact = async (tool: CareerToolId) => {
		if (!canDownload || activeCareerTool) return
		setActiveCareerTool(tool)
		setCareerError('')
		try {
			const response = await fetch('/api/resume/tools', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tool, resume, jobDescription, targetRole, targetCompany, evidenceNotes }) })
			const data = (await response.json().catch(() => ({}))) as { error?: string; title?: string; content?: string; model?: string }
			if (!response.ok || !data.content) throw new Error(data.error || `Career tool returned HTTP ${response.status}.`)
			const artifact: CareerArtifact = { id: `artifact-${Date.now()}`, tool, title: data.title || 'Career document', content: data.content, createdAt: new Date().toISOString(), model: data.model || null }
			setArtifacts((current) => [artifact, ...current].slice(0, 20))
			setSelectedArtifactId(artifact.id)
		} catch (error) {
			setCareerError(error instanceof Error ? error.message : 'The career document could not be generated.')
		} finally {
			setActiveCareerTool(null)
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
			setAnalysis({ fileName: data.fileName || selectedFile.name, extractedText: data.extractedText, report: data.report, recommendations: data.recommendations ?? [], strengths: data.strengths ?? [], model: data.model ?? null, notice: data.notice ?? null })
		} catch (error) {
			setUploadError(error instanceof Error ? error.message : 'The resume could not be analyzed.')
		} finally {
			setAnalyzing(false)
		}
	}

	const improveUploaded = () => {
		if (!analysis || generating) return
		void generate({
			instruction: ['Rebuild the uploaded resume below as a truthful ATS-friendly resume. Preserve every supplied fact. Apply the audit fixes, but never invent missing metrics or experience.', `AUDIT FIXES:\n${[...analysis.report.improvements, ...analysis.recommendations].slice(0, 10).join('\n')}`, `UPLOADED RESUME:\n${analysis.extractedText.slice(0, 11_500)}`].join('\n\n'),
			includeCurrentResume: false,
			messageLabel: 'Rebuild my uploaded resume using the audit findings.',
		})
		setMode('create')
	}

	const undo = () => {
		const previous = undoStack.current.pop()
		if (!previous) return
		redoStack.current.push(resume)
		setResume(previous)
		setHistoryRevision((value) => value + 1)
	}

	const redo = () => {
		const next = redoStack.current.pop()
		if (!next) return
		undoStack.current.push(resume)
		setResume(next)
		setHistoryRevision((value) => value + 1)
	}

	const saveVersion = () => {
		if (!canDownload) return
		const suggested = targetRole ? `${targetRole}${targetCompany ? ` · ${targetCompany}` : ''}` : `Resume version ${versions.length + 1}`
		const name = window.prompt('Name this resume version', suggested)?.trim()
		if (!name) return
		const version: ResumeVersion = { id: `version-${Date.now()}`, name: name.slice(0, 100), createdAt: new Date().toISOString(), resume, jobDescription, targetRole, targetCompany, design }
		setVersions((current) => [version, ...current].slice(0, 20))
	}

	const restoreVersion = (id: string) => {
		const version = versions.find((item) => item.id === id)
		if (!version) return
		commitResume(normalizeResume(version.resume))
		setDesign(normalizeResumeDesign(version.design))
		setJobDescription(version.jobDescription)
		setTargetRole(version.targetRole)
		setTargetCompany(version.targetCompany)
	}

	const exportBackup = () => {
		const workspace: StoredResumeWorkspace = { version: 2, resume, jobDescription, targetRole, targetCompany, evidenceNotes, design, versions, artifacts }
		downloadTextFile(`${safeDocumentName(resume.contact.name || 'resume-studio')}-backup.json`, JSON.stringify(workspace, null, 2), 'application/json')
	}

	const importBackup = (value: unknown) => {
		const workspace = normalizeStoredWorkspace(value)
		if (!workspace) throw new Error('This is not a Resume Studio backup (version 2).')
		commitResume(workspace.resume)
		setJobDescription(workspace.jobDescription)
		setTargetRole(workspace.targetRole)
		setTargetCompany(workspace.targetCompany)
		setEvidenceNotes(workspace.evidenceNotes)
		setDesign(workspace.design)
		setVersions(workspace.versions)
		setArtifacts(workspace.artifacts)
		setSelectedArtifactId(workspace.artifacts[0]?.id ?? null)
	}

	const resetDraft = () => {
		if (!window.confirm('Clear the saved resume, versions, application documents, and conversation from this browser?')) return
		setResume(EMPTY_RESUME)
		setDesign(DEFAULT_RESUME_DESIGN)
		setMessages([INITIAL_MESSAGE])
		setPrompt('')
		setTargetRole('')
		setTargetCompany('')
		setJobDescription('')
		setEvidenceNotes('')
		setVersions([])
		setArtifacts([])
		setSelectedArtifactId(null)
		setAnalysis(null)
		setSelectedFile(null)
		undoStack.current = []
		redoStack.current = []
		setHistoryRevision((value) => value + 1)
		window.localStorage.removeItem('rvs-resume-draft')
	}

	const stages = ['Reading your facts', 'Matching the target role', 'Writing achievement bullets', 'Running ATS checks']
	const intro = MODE_COPY[mode]

	return (
		<div className="app resume-app">
			<ResumeHeader />
			<div className="resume-workspace">
				<aside className="resume-controls">
					<div className="resume-mode-tabs resume-mode-tabs--advanced" role="tablist" aria-label="Resume tools">
						<button role="tab" aria-selected={mode === 'create'} data-active={mode === 'create'} onClick={() => setMode('create')}><IconSparkle size={13} /> Build</button>
						<button role="tab" aria-selected={mode === 'tailor'} data-active={mode === 'tailor'} onClick={() => setMode('tailor')}><IconWand size={13} /> Tailor</button>
						<button role="tab" aria-selected={mode === 'toolkit'} data-active={mode === 'toolkit'} onClick={() => setMode('toolkit')}><IconFile size={13} /> Career kit</button>
						<button role="tab" aria-selected={mode === 'analyze'} data-active={mode === 'analyze'} onClick={() => setMode('analyze')}><IconUpload size={13} /> ATS check</button>
					</div>

					<div className="resume-controls-scroll">
						<div className="resume-section-intro"><span className="resume-kicker">{intro.kicker}</span><h1>{intro.title}</h1><p>{intro.description}</p></div>

						<details className="resume-job-target" open={mode === 'tailor'}>
							<summary><span><IconWand size={12} /> Target job</span><b>{jobDescription ? 'Ready' : 'Add details'}</b></summary>
							<div>
								<div className="resume-target-grid">
									<label>Role<input className="input" value={targetRole} maxLength={180} placeholder="Senior Product Designer" onChange={(event) => setTargetRole(event.target.value)} /></label>
									<label>Company<input className="input" value={targetCompany} maxLength={180} placeholder="Company name" onChange={(event) => setTargetCompany(event.target.value)} /></label>
								</div>
								<label className="resume-field-label" htmlFor="resume-job-description">Full job description <span>best match</span></label>
								<textarea id="resume-job-description" className="input textarea resume-job-description" value={jobDescription} maxLength={14_000} rows={6} placeholder="Paste the complete job description for keyword matching and tailored writing..." onChange={(event) => { setJobDescription(event.target.value); if (analysis) setAnalysis(null) }} />
							</div>
						</details>

						{mode === 'create' ? (
							<>
								<div className="resume-chat" ref={chatRef} aria-live="polite">
									{messages.map((message) => <div className={`resume-message resume-message--${message.role}`} data-tone={message.tone ?? 'normal'} key={message.id}>{message.tone === 'success' ? <IconCheck size={12} /> : message.tone === 'error' ? <IconAlert size={12} /> : null}<span>{message.text}{message.model ? <small>Written with {message.model}</small> : null}</span></div>)}
									{generating ? <div className="resume-ai-working"><span><IconSparkle size={13} /></span><div><strong>{stages[generationStage]}...</strong><small>NVIDIA is preserving facts while optimizing the structure.</small></div></div> : null}
								</div>
								<div className="resume-prompt-box">
									<label className="sr-only" htmlFor="resume-prompt">Tell the resume writer about your experience</label>
									<textarea id="resume-prompt" value={prompt} rows={6} maxLength={14_000} disabled={generating} placeholder="Example: I’m Maya Shah, a product designer with 5 years... Include employers, dates, skills, education, and real results." onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void generate() } }} />
									<div className="resume-prompt-footer"><span><b>Ctrl/⌘ Enter</b> to send</span><button className="btn btn--primary" disabled={generating || prompt.trim().length < 10} onClick={() => void generate()}>{generating ? <IconSpinner size={13} /> : <IconWand size={13} />}{canDownload ? 'Update resume' : 'Create resume'}</button></div>
								</div>
								{!canDownload && messages.length === 1 ? <div className="resume-starters">{STARTERS.map((starter) => <button key={starter.label} onClick={() => setPrompt(starter.value)}><IconSparkle size={11} />{starter.label}</button>)}</div> : null}
							</>
						) : mode === 'tailor' ? (
							<ResumeTargetPanel resume={resume} report={report} evidenceNotes={evidenceNotes} onEvidenceNotes={setEvidenceNotes} onTailor={tailorResume} onStrengthen={strengthenBullets} busy={generating || !canDownload} />
						) : mode === 'toolkit' ? (
							<><CareerToolkitPanel activeTool={activeCareerTool} artifacts={artifacts} canGenerate={canDownload} onGenerate={(tool) => void generateCareerArtifact(tool)} />{careerError ? <div className="notice notice--error"><IconAlert className="notice-icon" size={13} /><span>{careerError}</span></div> : null}</>
						) : (
							<div className="resume-upload-flow">
								<label className="resume-dropzone" data-selected={Boolean(selectedFile)}><input type="file" accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" onChange={(event) => { setSelectedFile(event.target.files?.[0] ?? null); setAnalysis(null); setUploadError('') }} /><span className="resume-drop-icon"><IconUpload size={20} /></span><strong>{selectedFile ? selectedFile.name : 'Choose your resume'}</strong><small>{selectedFile ? `${(selectedFile.size / 1024).toFixed(0)} KB · click to replace` : 'PDF, DOCX, or TXT · maximum 6 MB'}</small></label>
								<button className="btn btn--primary btn--lg" disabled={!selectedFile || analyzing} onClick={() => void analyze()}>{analyzing ? <IconSpinner size={14} /> : <IconFile size={14} />}{analyzing ? 'Reading and scoring...' : 'Check ATS score'}</button>
								{uploadError ? <div className="notice notice--error"><IconAlert className="notice-icon" size={13} /><span>{uploadError}</span></div> : null}
								<div className="resume-privacy-note">Your document is processed for this request and is not stored by this app. Resume text is sent to NVIDIA only for qualitative recommendations.</div>
								{analysis ? <button className="btn btn--secondary resume-improve-button" disabled={generating} onClick={improveUploaded}><IconWand size={13} /> Rebuild in editable studio</button> : null}
							</div>
						)}
					</div>
					<div className="resume-control-footer"><span>Auto-saved locally · free tools</span><button type="button" onClick={resetDraft}>Clear workspace</button></div>
				</aside>

				<main className="resume-preview-stage">
					{mode === 'analyze' && analysis ? (
						<div className="resume-audit-preview"><div className="resume-audit-heading"><div><span>Analysis complete</span><h2>{analysis.fileName}</h2></div><strong>{analysis.report.score}<small>/100</small></strong></div>{analysis.strengths.length ? <section><h3>What is working</h3><ul>{analysis.strengths.map((item) => <li key={item}>{item}</li>)}</ul></section> : null}{analysis.recommendations.length ? <section><h3>NVIDIA recommendations</h3><ol>{analysis.recommendations.map((item) => <li key={item}>{item}</li>)}</ol></section> : null}{analysis.notice ? <div className="notice notice--warn"><IconAlert className="notice-icon" size={13} /><span>The deterministic score is complete. AI recommendations were unavailable: {analysis.notice}</span></div> : null}<section className="resume-extracted-text"><h3>ATS parse preview</h3><pre>{analysis.extractedText}</pre></section></div>
					) : mode === 'analyze' ? (
						<div className="resume-audit-empty"><span><IconFile size={25} /></span><h2>Your audit will appear here</h2><p>Upload a resume to inspect its text layer, ATS score, keyword coverage, strengths, and prioritized fixes.</p></div>
					) : mode === 'toolkit' ? (
						<CareerArtifactPreview artifacts={artifacts} selectedId={selectedArtifactId} onSelect={setSelectedArtifactId} onChange={(id, content) => setArtifacts((current) => current.map((item) => item.id === id ? { ...item, content } : item))} onDelete={(id) => { setArtifacts((current) => current.filter((item) => item.id !== id)); if (selectedArtifactId === id) setSelectedArtifactId(null) }} />
					) : (
						<div className="resume-builder-canvas">
							<ResumeCanvasToolbar design={design} textView={textView} versions={versions} canUndo={canUndo} canRedo={canRedo} onDesign={setDesign} onTextView={setTextView} onUndo={undo} onRedo={redo} onSaveVersion={saveVersion} onRestoreVersion={restoreVersion} onDeleteVersion={(id) => setVersions((current) => current.filter((item) => item.id !== id))} onExportBackup={exportBackup} onImportBackup={importBackup} />
							{textView ? <div className="resume-ats-text-view"><div><span><IconFile size={13} /> ATS parse preview</span><small>This is the plain-text order an ATS receives from exports.</small></div><pre>{plainText || 'Create a resume to preview its machine-readable text.'}</pre></div> : <ResumePreview resume={resume} onResume={commitResume} design={design} />}
						</div>
					)}
				</main>

				<AtsPanel report={displayedReport} resume={resume} design={design} canDownload={canDownload && mode !== 'analyze'} />
			</div>
		</div>
	)
}
