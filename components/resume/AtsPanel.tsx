'use client'

import { memo, useState } from 'react'
import type { AtsReport, ResumeData } from '../../lib/resume/types'
import { downloadResumeDocx, downloadResumePdf } from '../../lib/resume/export'
import { IconCheck, IconDownload, IconFile, IconInfo, IconSpinner } from '../Icons'

function AtsPanel({
	report,
	resume,
	canDownload,
}: {
	report: AtsReport
	resume: ResumeData
	canDownload: boolean
}) {
	const [exporting, setExporting] = useState<'pdf' | 'docx' | null>(null)
	const [error, setError] = useState('')
	const [showChecks, setShowChecks] = useState(false)

	const download = async (format: 'pdf' | 'docx') => {
		setExporting(format)
		setError('')
		try {
			if (format === 'pdf') await downloadResumePdf(resume)
			else await downloadResumeDocx(resume)
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : 'The download could not be created.')
		} finally {
			setExporting(null)
		}
	}

	return (
		<aside className="resume-insights" aria-label="ATS analysis">
			<div className="resume-insights-scroll">
				<section className="resume-score-card">
					<div className="resume-score-ring" style={{ '--resume-score': `${report.score * 3.6}deg` } as React.CSSProperties}>
						<div>
							<strong>{report.score}</strong>
							<span>/100</span>
						</div>
					</div>
					<div className="resume-score-copy">
						<span className="section-label">ATS readiness</span>
						<h2>{report.grade}</h2>
						<p>{report.summary}</p>
					</div>
				</section>

				<div className="resume-stat-grid">
					<div><strong>{report.stats.wordCount}</strong><span>words</span></div>
					<div><strong>{report.stats.quantifiedBullets}/{report.stats.bulletCount}</strong><span>measured bullets</span></div>
					<div><strong>{report.stats.keywordCoverage === null ? '—' : `${report.stats.keywordCoverage}%`}</strong><span>keyword match</span></div>
				</div>

				<section className="resume-insight-section">
					<div className="resume-insight-heading">
						<h3>Path to 100%</h3>
						<span>{report.improvements.length} fixes</span>
					</div>
					{report.improvements.length ? (
						<ol className="resume-fix-list">
							{report.improvements.slice(0, 8).map((item) => <li key={item}>{item}</li>)}
						</ol>
					) : (
						<div className="resume-perfect"><IconCheck size={15} /> Every measured check passes.</div>
					)}
				</section>

				{report.missingKeywords.length || report.matchedKeywords.length ? (
					<section className="resume-insight-section">
						<h3>Job keywords</h3>
						{report.missingKeywords.length ? (
							<>
								<span className="resume-keyword-label">Missing — add only when truthful</span>
								<div className="resume-keywords resume-keywords--missing">
									{report.missingKeywords.slice(0, 14).map((keyword) => <span key={keyword}>{keyword}</span>)}
								</div>
							</>
						) : null}
						{report.matchedKeywords.length ? (
							<>
								<span className="resume-keyword-label">Matched</span>
								<div className="resume-keywords">
									{report.matchedKeywords.slice(0, 14).map((keyword) => <span key={keyword}>{keyword}</span>)}
								</div>
							</>
						) : null}
					</section>
				) : null}

				<section className="resume-insight-section">
					<button type="button" className="resume-check-toggle" onClick={() => setShowChecks((current) => !current)} aria-expanded={showChecks}>
						<span>All {report.checks.length} scoring checks</span>
						<span>{showChecks ? '−' : '+'}</span>
					</button>
					{showChecks ? (
						<div className="resume-checks">
							{report.checks.map((item) => (
								<div className="resume-check" data-passed={item.passed} key={item.id}>
									<span className="resume-check-icon">{item.passed ? <IconCheck size={11} /> : <IconInfo size={11} />}</span>
									<span><strong>{item.label}</strong><small>{item.detail}</small></span>
									<b>{item.points}/{item.maxPoints}</b>
								</div>
							))}
						</div>
					) : null}
				</section>

				<div className="notice notice--info resume-score-note">
					<IconInfo className="notice-icon" size={13} />
					<span>This is an explainable readiness score, not a promise of acceptance by every ATS or employer.</span>
				</div>
			</div>

			<div className="resume-downloads">
				<div className="resume-download-head"><IconFile size={13} /><span>ATS-safe exports</span></div>
				<div className="resume-download-grid">
					<button className="btn btn--primary" disabled={!canDownload || exporting !== null} onClick={() => void download('pdf')}>
						{exporting === 'pdf' ? <IconSpinner size={13} /> : <IconDownload size={13} />} PDF
					</button>
					<button className="btn btn--secondary" disabled={!canDownload || exporting !== null} onClick={() => void download('docx')}>
						{exporting === 'docx' ? <IconSpinner size={13} /> : <IconDownload size={13} />} DOCX
					</button>
				</div>
				{error ? <span className="resume-export-error">{error}</span> : null}
			</div>
		</aside>
	)
}

export default memo(AtsPanel)
