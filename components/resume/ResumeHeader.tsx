import Link from 'next/link'
import { IconFile, IconLogo } from '../Icons'
import StudioNav from '../StudioNav'
import ThemeToggle from '../ThemeToggle'

export default function ResumeHeader() {
	return (
		<header className="topbar resume-topbar">
			<Link className="brand resume-brand" href="/" aria-label="Remotion Video Studio home">
				<span className="brand-mark">
					<IconLogo size={15} />
				</span>
				<span className="brand-text">
					Resume Studio
					<span className="brand-sub">create, optimize, edit, download</span>
				</span>
			</Link>
			<div className="topbar-spacer" />
			<span className="badge badge--green resume-secure-badge">
				<IconFile size={12} /> ATS-safe editor
			</span>
			<div className="topbar-actions">
				<StudioNav current="resume" />
				<ThemeToggle />
			</div>
		</header>
	)
}
