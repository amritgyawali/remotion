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
	type CareerArtifact,
	type CareerToolId,
	type ResumeChatMessage,
	type ResumeData,
	type ResumeDesign,
	type ResumeVersion,
} from '../../lib/resume/types'
import {
	dropLegacyDraft,
	importLegacyDraft,
	normalizeResumeSession,
	RESUME_SESSION_KEY,
	RESUME_SESSION_VERSION,
	RESUME_UPLOAD_BLOB_ID,
	type ResumeSession,
	type StoredAnalysis,
	type WorkspaceMode,
} from '../../lib/resume/session'
import { readBlob, removeBlob, writeBlob } from '../../lib/persist/idb'
import { useAutosave, useRestoredSnapshot } from '../../lib/persist/use-vault'
import { RestoreNotice, SaveBadge } from '../SaveState'
import { IconAlert, IconCheck, IconFile, IconSparkle, IconSpinner, IconUpload, IconWand } from '../Icons'
import AtsPanel from './AtsPanel'
import CareerArtifactPreview from './CareerArtifactPreview'
import CareerToolkitPanel from './CareerToolkitPanel'
import ResumeCanvasToolbar from './ResumeCanvasToolbar'
import ResumeHeader from './ResumeHeader'
import ResumePreview from './ResumePreview'
import ResumeTargetPanel from './ResumeTargetPanel'

type AnalyzeResult = StoredAnalysis

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

const DEFAULT_DESIGN_SIGNATURE = JSON.stringify(DEFAULT_RESUME_DESIGN)

function hasResumeSessionWork(session: ResumeSession): boolean {
	const { workspace } = session
	const conversationChanged =
		session.messages.length !== 1 ||
		session.messages[0]?.id !== INITIAL_MESSAGE.id ||
		session.messages[0]?.text !== INITIAL_MESSAGE.text

	return Boolean(
		hasResumeContent(workspace.resume) ||
			workspace.jobDescription.trim() ||
			workspace.targetRole.trim() ||
			workspace.targetCompany.trim() ||
			workspace.evidenceNotes.trim() ||
			workspace.versions.length > 0 ||
			workspace.artifacts.length > 0 ||
			JSON.stringify(workspace.design) !== DEFAULT_DESIGN_SIGNATURE ||
			session.mode !== 'create' ||
			conversationChanged ||
			session.prompt.trim() ||
			session.textView ||
			session.analysis ||
			session.uploadBlobId ||
			session.uploadName,
	)
}

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
	const [historyRevision, setHistoryRevision] = useState(0)
	const [restoredAt, setRestoredAt] = useState<number | null>(null)
	const [restoreSummary, setRestoreSummary] = useState<string | null>(null)
	const chatRef = useRef<HTMLDivElement>(null)
	const undoStack = useRef<ResumeData[]>([])
	const redoStack = useRef<ResumeData[]>([])
	/** set while the uploaded document's bytes are banked in the vault */
	const [uploadBlobId, setUploadBlobId] = useState<string | null>(null)
	const legacyCheckedRef = useRef(false)

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

	/* --------------------------------------------------------- persistence */

	const applyWorkspace = (workspace: StoredResumeWorkspace, selectFirstArtifact = true) => {
		setResume(workspace.resume)
		setDesign(workspace.design)
		setJobDescription(workspace.jobDescription)
		setTargetRole(workspace.targetRole)
		setTargetCompany(workspace.targetCompany)
		setEvidenceNotes(workspace.evidenceNotes)
		setVersions(workspace.versions)
		setArtifacts(workspace.artifacts)
		if (selectFirstArtifact) setSelectedArtifactId(workspace.artifacts[0]?.id ?? null)
	}

	/**
	 * Brings the last session back - the document, the conversation, the
	 * half-typed prompt, the uploaded file and its audit.
	 *
	 * A draft written by the pre-vault build is imported on the way past, so an
	 * application in progress survives the upgrade rather than the upgrade.
	 */
	const restore = useRestoredSnapshot<ResumeSession>({
		key: RESUME_SESSION_KEY,
		version: RESUME_SESSION_VERSION,
		apply: async (raw, updatedAt) => {
			const session = normalizeResumeSession(raw)
			if (!session) return

			applyWorkspace(session.workspace, session.selectedArtifactId === null)
			if (session.selectedArtifactId) setSelectedArtifactId(session.selectedArtifactId)
			setMode(session.mode)
			if (session.messages.length > 0) setMessages(session.messages)
			setPrompt(session.prompt)
			setTextView(session.textView)
			setAnalysis(session.analysis)

			if (session.uploadBlobId) {
				const stored = await readBlob(session.uploadBlobId)
				if (stored) {
					setUploadBlobId(session.uploadBlobId)
					setSelectedFile(
						new File([stored.blob], stored.name, {
							type: stored.type,
							lastModified: stored.lastModified,
						}),
					)
				} else if (session.uploadName) {
					setUploadError(
						`"${session.uploadName}" is no longer stored in this browser. Choose the file again to re-run the check.`,
					)
				}
			}

			setRestoredAt(updatedAt)
			const named = session.workspace.resume.contact.name
			setRestoreSummary(
				named
					? `${named}'s resume, ${session.workspace.versions.length} saved version${session.workspace.versions.length === 1 ? '' : 's'} and your conversation are back.`
					: 'Your draft, target job and conversation are back.',
			)
		},
	})

	const restoring = restore.phase === 'loading'

	// The pre-vault key is read exactly once, and only when the vault came back
	// empty - otherwise a stale localStorage draft would overwrite newer work.
	useEffect(() => {
		if (restore.phase !== 'empty' || legacyCheckedRef.current) return
		legacyCheckedRef.current = true
		const legacy = importLegacyDraft()
		if (legacy) {
			applyWorkspace(legacy)
			setRestoredAt(Date.now())
			setRestoreSummary('Your earlier resume draft has been moved into this browser’s new local vault.')
		}
		dropLegacyDraft()
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [restore.phase])

	const workspace = useMemo<StoredResumeWorkspace>(
		() => ({ version: 2, resume, jobDescription, targetRole, targetCompany, evidenceNotes, design, versions, artifacts }),
		[artifacts, design, evidenceNotes, jobDescription, resume, targetCompany, targetRole, versions],
	)

	const session = useMemo<ResumeSession | null>(() => {
		if (restoring) return null
		const next: ResumeSession = {
			workspace,
			mode,
			messages,
			prompt,
			textView,
			selectedArtifactId,
			analysis,
			uploadBlobId,
			uploadName: selectedFile?.name ?? null,
		}
		return hasResumeSessionWork(next) ? next : null
	}, [analysis, messages, mode, prompt, restoring, selectedArtifactId, selectedFile, textView, uploadBlobId, workspace])

	const vault = useAutosave<ResumeSession>({
		key: RESUME_SESSION_KEY,
		version: RESUME_SESSION_VERSION,
		data: session,
		enabled: !restoring,
	})

	/** Keeps the chosen document's bytes so an ATS check survives a refresh. */
	const adoptUpload = (file: File | null) => {
		setSelectedFile(file)
		setAnalysis(null)
		setUploadError('')
		if (!file) {
			setUploadBlobId(null)
			void removeBlob(RESUME_UPLOAD_BLOB_ID)
			return
		}
		setUploadBlobId(null)
		void writeBlob(RESUME_UPLOAD_BLOB_ID, file, file.name).then((stored) => {
			setUploadBlobId(stored ? RESUME_UPLOAD_BLOB_ID : null)
		})
	}

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
		setMode('create')
		setTextView(false)
		setUploadError('')
		setRestoredAt(null)
		setRestoreSummary(null)
		undoStack.current = []
		redoStack.current = []
		setUploadBlobId(null)
		setHistoryRevision((value) => value + 1)
		void vault.forget()
		void removeBlob(RESUME_UPLOAD_BLOB_ID)
		dropLegacyDraft()
	}

	const stages = ['Reading your facts', 'Matching the target role', 'Writing achievement bullets', 'Running ATS checks']
	const intro = MODE_COPY[mode]

	return (
		<div className="app resume-app">
			<ResumeHeader />
			{restore.phase !== 'loading' && restoreSummary ? (
				<RestoreNotice updatedAt={restoredAt} summary={restoreSummary} onDiscard={resetDraft} discardLabel="Clear workspace" />
			) : null}
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
								<label className="resume-dropzone" data-selected={Boolean(selectedFile)}><input type="file" accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" onChange={(event) => adoptUpload(event.target.files?.[0] ?? null)} /><span className="resume-drop-icon"><IconUpload size={20} /></span><strong>{selectedFile ? selectedFile.name : 'Choose your resume'}</strong><small>{selectedFile ? `${(selectedFile.size / 1024).toFixed(0)} KB · click to replace` : 'PDF, DOCX, or TXT · maximum 6 MB'}</small></label>
								<button className="btn btn--primary btn--lg" disabled={!selectedFile || analyzing} onClick={() => void analyze()}>{analyzing ? <IconSpinner size={14} /> : <IconFile size={14} />}{analyzing ? 'Reading and scoring...' : 'Check ATS score'}</button>
								{uploadError ? <div className="notice notice--error"><IconAlert className="notice-icon" size={13} /><span>{uploadError}</span></div> : null}
								<div className="resume-privacy-note">Your document stays on this device - kept in this browser so a refresh does not lose it, and never stored on a server. Resume text is sent to NVIDIA only for qualitative recommendations.</div>
								{analysis ? <button className="btn btn--secondary resume-improve-button" disabled={generating} onClick={improveUploaded}><IconWand size={13} /> Rebuild in editable studio</button> : null}
							</div>
						)}
					</div>
					<div className="resume-control-footer">
						<SaveBadge status={vault.status} savedAt={vault.savedAt} error={vault.error} />
						<button type="button" onClick={resetDraft}>Clear workspace</button>
					</div>
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
