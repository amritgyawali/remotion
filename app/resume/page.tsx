import type { Metadata } from 'next'
import ResumeStudio from '../../components/resume/ResumeStudio'

export const metadata: Metadata = {
	title: 'AI Resume Studio — create, edit and check ATS readiness',
	description: 'Create an ATS-friendly resume with NVIDIA AI, edit it in your browser, audit an existing resume, and download parser-safe PDF or DOCX files.',
}

export default function ResumePage() {
	return <ResumeStudio />
}
