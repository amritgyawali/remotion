import type { AtsReport, ResumeData } from '../../lib/resume/types'
import { reviewResumeBullets } from '../../lib/resume/toolkit'
import { IconSparkle, IconWand } from '../Icons'

export default function ResumeTargetPanel({
	resume,
	report,
	evidenceNotes,
	onEvidenceNotes,
	onTailor,
	onStrengthen,
	busy,
}: {
	resume: ResumeData
	report: AtsReport
	evidenceNotes: string
	onEvidenceNotes: (value: string) => void
	onTailor: () => void
	onStrengthen: () => void
	busy: boolean
}) {
	const bullets = reviewResumeBullets(resume)
	const weakest = bullets.toSorted((left, right) => left.score - right.score).slice(0, 5)
	const targetCategory = report.categories.find((item) => item.id === 'targeting')

	return (
		<div className="resume-tailor-panel">
			<section className="resume-tailor-hero">
				<div>
					<span>Job alignment</span>
					<strong>{report.stats.keywordCoverage === null ? '--' : `${report.stats.keywordCoverage}%`}</strong>
				</div>
				<p>{targetCategory?.detail}. Add a full job description above for a reliable comparison.</p>
			</section>

			<div className="resume-tool-actions">
				<button className="btn btn--primary" disabled={busy} onClick={onTailor}>
					<IconWand size={13} /> Tailor entire resume
				</button>
				<button className="btn btn--secondary" disabled={busy || bullets.length === 0} onClick={onStrengthen}>
					<IconSparkle size={13} /> Strengthen bullets
				</button>
			</div>

			<label className="resume-field-label" htmlFor="resume-evidence-notes">
				Verified evidence bank <span>never invented</span>
			</label>
			<textarea
				id="resume-evidence-notes"
				className="input textarea"
				rows={5}
				maxLength={8_000}
				value={evidenceNotes}
				placeholder="Add real metrics, team size, revenue, time saved, users served, awards, tools, or project outcomes the AI may use."
				onChange={(event) => onEvidenceNotes(event.target.value)}
			/>

			<section className="resume-mini-section">
				<div className="resume-insight-heading">
					<h3>Keyword map</h3>
					<span>{report.missingKeywords.length} gaps</span>
				</div>
				{report.keywords.length ? (
					<div className="resume-keyword-table">
						{report.keywords.slice(0, 16).map((item) => (
							<div data-matched={item.matched} key={item.keyword}>
								<span>{item.keyword}<small>{item.kind}</small></span>
								<b>{item.resumeMentions}/{item.jobMentions}</b>
							</div>
						))}
					</div>
				) : <p className="resume-muted-copy">Paste the job description to extract priority role terms and skills.</p>}
			</section>

			<section className="resume-mini-section">
				<div className="resume-insight-heading">
					<h3>Bullet lab</h3>
					<span>{report.stats.strongBullets}/{report.stats.bulletCount} strong</span>
				</div>
				{weakest.length ? (
					<div className="resume-bullet-reviews">
						{weakest.map((bullet) => (
							<div data-grade={bullet.grade} key={bullet.id}>
								<span className="resume-bullet-score">{bullet.score}</span>
								<span><strong>{bullet.text}</strong><small>{bullet.suggestion}</small></span>
							</div>
						))}
					</div>
				) : <p className="resume-muted-copy">Add experience bullets to receive action, evidence, length, and outcome checks.</p>}
			</section>
		</div>
	)
}
