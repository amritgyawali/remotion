import type { CareerArtifact, CareerToolId } from '../../lib/resume/types'
import { IconFile, IconSparkle, IconSpinner, IconWand } from '../Icons'

const TOOLS: Array<{ id: CareerToolId; title: string; description: string; badge: string }> = [
	{ id: 'cover-letter', title: 'Targeted cover letter', description: 'A concise letter grounded in your resume and the role.', badge: '250-380 words' },
	{ id: 'recruiter-email', title: 'Recruiter outreach', description: 'A short subject line and evidence-led introduction.', badge: '< 150 words' },
	{ id: 'linkedin-profile', title: 'LinkedIn profile', description: 'Searchable headline and a human, keyword-aware About section.', badge: 'Headline + About' },
	{ id: 'interview-prep', title: 'Interview prep', description: 'Role-specific questions with prompts for your real examples.', badge: '10 questions' },
]

export default function CareerToolkitPanel({
	activeTool,
	artifacts,
	canGenerate,
	onGenerate,
}: {
	activeTool: CareerToolId | null
	artifacts: CareerArtifact[]
	canGenerate: boolean
	onGenerate: (tool: CareerToolId) => void
}) {
	return (
		<div className="resume-career-tools">
			<div className="resume-career-callout">
				<span><IconSparkle size={15} /></span>
				<div><strong>One resume, a complete application kit</strong><small>Every output uses the same verified facts and target job.</small></div>
			</div>
			<div className="resume-tool-card-grid">
				{TOOLS.map((tool) => {
					const count = artifacts.filter((item) => item.tool === tool.id).length
					const loading = activeTool === tool.id
					return (
						<button key={tool.id} disabled={!canGenerate || activeTool !== null} onClick={() => onGenerate(tool.id)}>
							<span className="resume-tool-card-icon">{loading ? <IconSpinner size={15} /> : tool.id === 'cover-letter' ? <IconFile size={15} /> : <IconWand size={15} />}</span>
							<span><strong>{tool.title}</strong><small>{tool.description}</small></span>
							<b>{loading ? 'Creating...' : count ? `${count} saved` : tool.badge}</b>
						</button>
					)
				})}
			</div>
			{!canGenerate ? <div className="notice notice--info">Create or import a resume first. Add a target job for the strongest results.</div> : null}
			<div className="resume-privacy-note">Career documents are generated with NVIDIA AI. Review every statement before sending; no output guarantees an interview.</div>
		</div>
	)
}
