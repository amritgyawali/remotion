'use client'

import { createElement, memo, type KeyboardEvent } from 'react'
import type { ResumeData } from '../../lib/resume/types'
import { IconPlus, IconTrash } from '../Icons'

function Editable({
	value,
	placeholder,
	onChange,
	className = '',
	as = 'span',
	multiline = false,
}: {
	value: string
	placeholder: string
	onChange: (value: string) => void
	className?: string
	as?: 'span' | 'p' | 'h1'
	multiline?: boolean
}) {
	const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
		if (event.key === 'Enter' && !multiline) {
			event.preventDefault()
			event.currentTarget.blur()
		}
	}
	return createElement(
		as,
		{
			className: `resume-editable ${className}`.trim(),
			contentEditable: true,
			suppressContentEditableWarning: true,
			'data-placeholder': placeholder,
			spellCheck: true,
			onKeyDown: handleKeyDown,
			onBlur: (event: { currentTarget: HTMLElement }) =>
				onChange(event.currentTarget.innerText.replace(/\s+/g, ' ').trim()),
		},
		value,
	)
}

function ResumePreview({
	resume,
	onResume,
}: {
	resume: ResumeData
	onResume: (resume: ResumeData) => void
}) {
	const contact = (key: keyof ResumeData['contact'], value: string) =>
		onResume({ ...resume, contact: { ...resume.contact, [key]: value } })
	const changeExperience = (index: number, patch: Partial<ResumeData['experience'][number]>) =>
		onResume({
			...resume,
			experience: resume.experience.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)),
		})
	const changeProject = (index: number, patch: Partial<ResumeData['projects'][number]>) =>
		onResume({
			...resume,
			projects: resume.projects.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)),
		})
	const changeEducation = (index: number, patch: Partial<ResumeData['education'][number]>) =>
		onResume({
			...resume,
			education: resume.education.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)),
		})
	const changeCertification = (index: number, patch: Partial<ResumeData['certifications'][number]>) =>
		onResume({
			...resume,
			certifications: resume.certifications.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)),
		})

	return (
		<div className="resume-paper-wrap">
			<div className="resume-edit-hint">Click any text on the page to edit it</div>
			<article className="resume-paper" aria-label="Editable resume preview">
				<header className="resume-document-header">
					<Editable
						as="h1"
						className="resume-document-name"
						value={resume.contact.name}
						placeholder="YOUR FULL NAME"
						onChange={(value) => contact('name', value)}
					/>
					<Editable
						as="p"
						className="resume-document-title"
						value={resume.contact.title}
						placeholder="Target professional title"
						onChange={(value) => contact('title', value)}
					/>
					<div className="resume-contact-line">
						<Editable value={resume.contact.email} placeholder="email@example.com" onChange={(value) => contact('email', value)} />
						<span>•</span>
						<Editable value={resume.contact.phone} placeholder="Phone" onChange={(value) => contact('phone', value)} />
						<span>•</span>
						<Editable value={resume.contact.location} placeholder="City, Country" onChange={(value) => contact('location', value)} />
					</div>
					<div className="resume-contact-line">
						<Editable value={resume.contact.linkedin} placeholder="LinkedIn URL" onChange={(value) => contact('linkedin', value)} />
						<span>•</span>
						<Editable value={resume.contact.website} placeholder="Portfolio URL" onChange={(value) => contact('website', value)} />
					</div>
				</header>

				<section className="resume-document-section">
					<h2>Professional Summary</h2>
					<Editable
						as="p"
						multiline
						value={resume.summary}
						placeholder="Your focused 2–4 line professional summary will appear here."
						onChange={(summary) => onResume({ ...resume, summary })}
					/>
				</section>

				<section className="resume-document-section">
					<h2>Skills</h2>
					<div className="resume-skill-list">
						{resume.skills.map((skill, index) => (
							<span className="resume-skill" key={`${skill}-${index}`}>
								<Editable
									value={skill}
									placeholder="Skill"
									onChange={(value) =>
										onResume({ ...resume, skills: resume.skills.map((item, itemIndex) => (itemIndex === index ? value : item)).filter(Boolean) })
									}
								/>
								<button
									type="button"
									className="resume-inline-remove"
									aria-label={`Remove ${skill}`}
									onClick={() => onResume({ ...resume, skills: resume.skills.filter((_, itemIndex) => itemIndex !== index) })}
								>
									×
								</button>
							</span>
						))}
						<button type="button" className="resume-add-inline" onClick={() => onResume({ ...resume, skills: [...resume.skills, 'New skill'] })}>
							<IconPlus size={11} /> Add skill
						</button>
					</div>
				</section>

				<section className="resume-document-section">
					<h2>Professional Experience</h2>
					{resume.experience.map((item, index) => (
						<div className="resume-entry" key={item.id}>
							<button
								type="button"
								className="resume-entry-remove"
								aria-label={`Remove ${item.role || 'experience'}`}
								onClick={() => onResume({ ...resume, experience: resume.experience.filter((_, itemIndex) => itemIndex !== index) })}
							>
								<IconTrash size={12} />
							</button>
							<div className="resume-entry-title-row">
								<div>
									<Editable className="resume-entry-title" value={item.role} placeholder="Role title" onChange={(role) => changeExperience(index, { role })} />
									<span> — </span>
									<Editable className="resume-entry-title" value={item.company} placeholder="Company" onChange={(company) => changeExperience(index, { company })} />
								</div>
								<div className="resume-entry-dates">
									<Editable value={item.startDate} placeholder="Start" onChange={(startDate) => changeExperience(index, { startDate })} />
									<span> – </span>
									<Editable value={item.endDate} placeholder="End" onChange={(endDate) => changeExperience(index, { endDate })} />
								</div>
							</div>
							<Editable className="resume-entry-meta" value={item.location} placeholder="Location" onChange={(location) => changeExperience(index, { location })} />
							<ul>
								{item.bullets.map((bullet, bulletIndex) => (
									<li key={`${item.id}-bullet-${bulletIndex}`}>
										<Editable
											multiline
											value={bullet}
											placeholder="Action + work + measurable result"
											onChange={(value) =>
												changeExperience(index, { bullets: item.bullets.map((entry, entryIndex) => (entryIndex === bulletIndex ? value : entry)).filter(Boolean) })
											}
										/>
										<button type="button" className="resume-inline-remove" aria-label="Remove bullet" onClick={() => changeExperience(index, { bullets: item.bullets.filter((_, entryIndex) => entryIndex !== bulletIndex) })}>×</button>
									</li>
								))}
							</ul>
							<button type="button" className="resume-add-inline" onClick={() => changeExperience(index, { bullets: [...item.bullets, 'New achievement'] })}>
								<IconPlus size={11} /> Add achievement
							</button>
						</div>
					))}
					<button
						type="button"
						className="resume-add-block"
						onClick={() =>
							onResume({
								...resume,
								experience: [
									...resume.experience,
									{ id: `experience-${Date.now()}`, company: 'Company', role: 'Role title', location: '', startDate: '', endDate: '', bullets: ['New achievement'] },
								],
							})
						}
					>
						<IconPlus size={12} /> Add experience
					</button>
				</section>

				<section className="resume-document-section">
					<h2>Projects</h2>
					{resume.projects.map((item, index) => (
						<div className="resume-entry" key={item.id}>
							<button type="button" className="resume-entry-remove" aria-label={`Remove ${item.name || 'project'}`} onClick={() => onResume({ ...resume, projects: resume.projects.filter((_, itemIndex) => itemIndex !== index) })}>
								<IconTrash size={12} />
							</button>
							<div className="resume-entry-title-row">
								<Editable className="resume-entry-title" value={item.name} placeholder="Project name" onChange={(name) => changeProject(index, { name })} />
								<Editable className="resume-entry-meta" value={item.link} placeholder="Project URL" onChange={(link) => changeProject(index, { link })} />
							</div>
							<Editable as="p" multiline value={item.description} placeholder="Short project context" onChange={(description) => changeProject(index, { description })} />
							<ul>
								{item.bullets.map((bullet, bulletIndex) => (
									<li key={`${item.id}-bullet-${bulletIndex}`}>
										<Editable multiline value={bullet} placeholder="Project achievement" onChange={(value) => changeProject(index, { bullets: item.bullets.map((entry, entryIndex) => (entryIndex === bulletIndex ? value : entry)).filter(Boolean) })} />
										<button type="button" className="resume-inline-remove" aria-label="Remove bullet" onClick={() => changeProject(index, { bullets: item.bullets.filter((_, entryIndex) => entryIndex !== bulletIndex) })}>×</button>
									</li>
								))}
							</ul>
							<button type="button" className="resume-add-inline" onClick={() => changeProject(index, { bullets: [...item.bullets, 'New project achievement'] })}>
								<IconPlus size={11} /> Add achievement
							</button>
						</div>
					))}
					<button type="button" className="resume-add-block" onClick={() => onResume({ ...resume, projects: [...resume.projects, { id: `project-${Date.now()}`, name: 'Project name', link: '', description: '', bullets: ['New project achievement'] }] })}>
						<IconPlus size={12} /> Add project
					</button>
				</section>

				<section className="resume-document-section">
					<h2>Education</h2>
					{resume.education.map((item, index) => (
						<div className="resume-entry" key={item.id}>
							<button type="button" className="resume-entry-remove" aria-label={`Remove ${item.degree || 'education'}`} onClick={() => onResume({ ...resume, education: resume.education.filter((_, itemIndex) => itemIndex !== index) })}>
								<IconTrash size={12} />
							</button>
							<div className="resume-entry-title-row">
								<div>
									<Editable className="resume-entry-title" value={item.degree} placeholder="Degree" onChange={(degree) => changeEducation(index, { degree })} />
									<span> — </span>
									<Editable className="resume-entry-title" value={item.institution} placeholder="Institution" onChange={(institution) => changeEducation(index, { institution })} />
								</div>
								<div className="resume-entry-dates">
									<Editable value={item.startDate} placeholder="Start" onChange={(startDate) => changeEducation(index, { startDate })} />
									<span> – </span>
									<Editable value={item.endDate} placeholder="End" onChange={(endDate) => changeEducation(index, { endDate })} />
								</div>
							</div>
							<Editable className="resume-entry-meta" value={item.location} placeholder="Location" onChange={(location) => changeEducation(index, { location })} />
							<Editable as="p" multiline value={item.details} placeholder="Honors, coursework, or details (optional)" onChange={(details) => changeEducation(index, { details })} />
						</div>
					))}
					<button type="button" className="resume-add-block" onClick={() => onResume({ ...resume, education: [...resume.education, { id: `education-${Date.now()}`, institution: 'Institution', degree: 'Degree', location: '', startDate: '', endDate: '', details: '' }] })}>
						<IconPlus size={12} /> Add education
					</button>
				</section>

				<section className="resume-document-section">
					<h2>Certifications</h2>
					{resume.certifications.map((item, index) => (
						<div className="resume-entry resume-certification-entry" key={item.id}>
							<button type="button" className="resume-entry-remove" aria-label={`Remove ${item.name || 'certification'}`} onClick={() => onResume({ ...resume, certifications: resume.certifications.filter((_, itemIndex) => itemIndex !== index) })}>
								<IconTrash size={12} />
							</button>
							<div className="resume-entry-title-row">
								<div>
									<Editable className="resume-entry-title" value={item.name} placeholder="Certification" onChange={(name) => changeCertification(index, { name })} />
									<span> — </span>
									<Editable value={item.issuer} placeholder="Issuer" onChange={(issuer) => changeCertification(index, { issuer })} />
								</div>
								<Editable className="resume-entry-meta" value={item.date} placeholder="Date" onChange={(date) => changeCertification(index, { date })} />
							</div>
						</div>
					))}
					<button type="button" className="resume-add-block" onClick={() => onResume({ ...resume, certifications: [...resume.certifications, { id: `certification-${Date.now()}`, name: 'Certification', issuer: 'Issuer', date: '' }] })}>
						<IconPlus size={12} /> Add certification
					</button>
				</section>
			</article>
		</div>
	)
}

export default memo(ResumePreview)
