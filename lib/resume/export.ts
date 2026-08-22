'use client'

import { DEFAULT_RESUME_DESIGN, type ResumeData, type ResumeDesign } from './types'

const safeFileName = (resume: ResumeData, extension: string) => {
	const base = resume.contact.name.trim() || 'ATS-Resume'
	return `${base.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'ATS-Resume'}-Resume.${extension}`
}

const asciiPdfText = (value: string): string =>
	value
		.replace(/[–—]/g, '-')
		.replace(/[“”]/g, '"')
		.replace(/[‘’]/g, "'")
		.replace(/…/g, '...')

export async function downloadResumePdf(resume: ResumeData, design: ResumeDesign = DEFAULT_RESUME_DESIGN): Promise<void> {
	const { jsPDF } = await import('jspdf')
	const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: design.pageSize, compress: true })
	const pageWidth = pdf.internal.pageSize.getWidth()
	const pageHeight = pdf.internal.pageSize.getHeight()
	const margin = design.template === 'compact' ? 38 : 46
	const contentWidth = pageWidth - margin * 2
	let y = margin
	const scale = design.fontScale * (design.template === 'compact' ? 0.94 : 1)
	const spacing = design.sectionSpacing * (design.template === 'compact' ? 0.86 : 1)
	const accent = design.accent.match(/[a-f\d]{2}/gi)?.map((value) => Number.parseInt(value, 16)) ?? [55, 65, 81]

	const ensureSpace = (height: number) => {
		if (y + height <= pageHeight - margin) return
		pdf.addPage()
		y = margin
	}
	const writeLines = (
		value: string,
		options: { size?: number; bold?: boolean; indent?: number; leading?: number; align?: 'left' | 'center' } = {},
	) => {
		const size = (options.size ?? 9.5) * scale
		const leading = (options.leading ?? size * 1.35) * spacing
		const indent = options.indent ?? 0
		pdf.setFont('helvetica', options.bold ? 'bold' : 'normal')
		pdf.setFontSize(size)
		pdf.setTextColor(25, 31, 42)
		const safe = asciiPdfText(value)
		const lines = pdf.splitTextToSize(safe, contentWidth - indent) as string[]
		ensureSpace(lines.length * leading + 2)
		for (const line of lines) {
			const x = options.align === 'center' ? pageWidth / 2 : margin + indent
			pdf.text(line, x, y, { align: options.align ?? 'left', baseline: 'top' })
			y += leading
		}
	}
	const section = (title: string) => {
		ensureSpace(30)
		y += 7 * spacing
		writeLines(title.toUpperCase(), { size: 10, bold: true, leading: 13 })
		pdf.setDrawColor(accent[0] ?? 55, accent[1] ?? 65, accent[2] ?? 81)
		pdf.setLineWidth(0.7)
		pdf.line(margin, y - 2, pageWidth - margin, y - 2)
		y += 5
	}
	const bullet = (value: string) => {
		writeLines(`- ${value}`, { size: 9.3, indent: 10, leading: 12.7 })
		y += 1
	}

	pdf.setProperties({
		title: `${resume.contact.name || 'Candidate'} Resume`,
		subject: 'ATS-friendly professional resume',
		creator: 'Resume Studio',
	})
	writeLines(resume.contact.name || 'YOUR NAME', { size: 19, bold: true, leading: 23, align: 'center' })
	if (resume.contact.title) writeLines(resume.contact.title, { size: 11, bold: true, leading: 16, align: 'center' })
	const contact = [
		resume.contact.email,
		resume.contact.phone,
		resume.contact.location,
		resume.contact.linkedin,
		resume.contact.website,
	].filter(Boolean)
	if (contact.length) writeLines(contact.join('  |  '), { size: 8.5, leading: 12, align: 'center' })
	y += 2

	if (resume.summary) {
		section('Professional Summary')
		writeLines(resume.summary)
	}
	if (resume.skills.length) {
		section('Skills')
		writeLines(resume.skills.join('  |  '))
	}
	if (resume.experience.length) {
		section('Professional Experience')
		for (const item of resume.experience) {
			ensureSpace(44)
			writeLines([item.role, item.company].filter(Boolean).join(' — '), { size: 10, bold: true, leading: 14 })
			const meta = [
				item.location,
				[item.startDate, item.endDate].filter(Boolean).join(' - '),
			].filter(Boolean)
			if (meta.length) writeLines(meta.join(' | '), { size: 8.7, leading: 12 })
			for (const value of item.bullets) bullet(value)
			y += 4
		}
	}
	if (resume.projects.length) {
		section('Projects')
		for (const item of resume.projects) {
			writeLines([item.name, item.link].filter(Boolean).join(' | '), { size: 10, bold: true, leading: 14 })
			if (item.description) writeLines(item.description)
			for (const value of item.bullets) bullet(value)
			y += 3
		}
	}
	if (resume.education.length) {
		section('Education')
		for (const item of resume.education) {
			writeLines([item.degree, item.institution].filter(Boolean).join(' — '), { size: 10, bold: true, leading: 14 })
			const meta = [item.location, [item.startDate, item.endDate].filter(Boolean).join(' - ')].filter(Boolean)
			if (meta.length) writeLines(meta.join(' | '), { size: 8.7, leading: 12 })
			if (item.details) writeLines(item.details)
			y += 4
		}
	}
	if (resume.certifications.length) {
		section('Certifications')
		for (const item of resume.certifications) {
			bullet([item.name, item.issuer, item.date].filter(Boolean).join(' — '))
		}
	}

	pdf.save(safeFileName(resume, 'pdf'))
}

export async function downloadResumeDocx(resume: ResumeData, design: ResumeDesign = DEFAULT_RESUME_DESIGN): Promise<void> {
	const {
		AlignmentType,
		Document,
		HeadingLevel,
		Packer,
		Paragraph,
		TextRun,
	} = await import('docx')

	const paragraphs: InstanceType<typeof Paragraph>[] = []
	const scale = design.fontScale * (design.template === 'compact' ? 0.94 : 1)
	const spacing = design.sectionSpacing * (design.template === 'compact' ? 0.86 : 1)
	const text = (value: string, bold = false, size = 20) => new TextRun({ text: value, bold, size: Math.round(size * scale), font: 'Arial' })
	const standard = (value: string, options: { bold?: boolean; center?: boolean; after?: number } = {}) =>
		new Paragraph({
			alignment: options.center ? AlignmentType.CENTER : AlignmentType.LEFT,
			spacing: { after: Math.round((options.after ?? 80) * spacing), line: Math.round(260 * spacing) },
			children: [text(value, options.bold)],
		})
	const heading = (value: string) =>
		new Paragraph({
			heading: HeadingLevel.HEADING_2,
			spacing: { before: Math.round(180 * spacing), after: Math.round(80 * spacing) },
			border: { bottom: { color: '374151', size: 5, space: 2, style: 'single' } },
			children: [text(value.toUpperCase(), true, 21)],
		})
	const bullet = (value: string) =>
		new Paragraph({
			bullet: { level: 0 },
			indent: { left: 300, hanging: 180 },
			spacing: { after: Math.round(55 * spacing), line: Math.round(250 * spacing) },
			children: [text(value, false, 19)],
		})

	paragraphs.push(
		new Paragraph({
			alignment: AlignmentType.CENTER,
			spacing: { after: 60 },
			children: [text(resume.contact.name || 'YOUR NAME', true, 34)],
		}),
	)
	if (resume.contact.title) paragraphs.push(standard(resume.contact.title, { bold: true, center: true, after: 50 }))
	const contact = [
		resume.contact.email,
		resume.contact.phone,
		resume.contact.location,
		resume.contact.linkedin,
		resume.contact.website,
	].filter(Boolean)
	if (contact.length) paragraphs.push(standard(contact.join(' | '), { center: true, after: 100 }))

	if (resume.summary) paragraphs.push(heading('Professional Summary'), standard(resume.summary))
	if (resume.skills.length) paragraphs.push(heading('Skills'), standard(resume.skills.join(' | ')))
	if (resume.experience.length) {
		paragraphs.push(heading('Professional Experience'))
		for (const item of resume.experience) {
			paragraphs.push(standard([item.role, item.company].filter(Boolean).join(' — '), { bold: true, after: 20 }))
			const meta = [item.location, [item.startDate, item.endDate].filter(Boolean).join(' - ')].filter(Boolean)
			if (meta.length) paragraphs.push(standard(meta.join(' | '), { after: 55 }))
			paragraphs.push(...item.bullets.map(bullet))
		}
	}
	if (resume.projects.length) {
		paragraphs.push(heading('Projects'))
		for (const item of resume.projects) {
			paragraphs.push(standard([item.name, item.link].filter(Boolean).join(' | '), { bold: true, after: 25 }))
			if (item.description) paragraphs.push(standard(item.description, { after: 50 }))
			paragraphs.push(...item.bullets.map(bullet))
		}
	}
	if (resume.education.length) {
		paragraphs.push(heading('Education'))
		for (const item of resume.education) {
			paragraphs.push(standard([item.degree, item.institution].filter(Boolean).join(' — '), { bold: true, after: 25 }))
			const meta = [item.location, [item.startDate, item.endDate].filter(Boolean).join(' - ')].filter(Boolean)
			if (meta.length) paragraphs.push(standard(meta.join(' | '), { after: 35 }))
			if (item.details) paragraphs.push(standard(item.details))
		}
	}
	if (resume.certifications.length) {
		paragraphs.push(heading('Certifications'))
		paragraphs.push(...resume.certifications.map((item) => bullet([item.name, item.issuer, item.date].filter(Boolean).join(' — '))))
	}

	const document = new Document({
		creator: 'Resume Studio',
		title: `${resume.contact.name || 'Candidate'} Resume`,
		description: 'ATS-friendly professional resume',
		styles: {
			default: {
				document: { run: { font: 'Arial', size: 20, color: '1F2937' }, paragraph: { spacing: { line: 260 } } },
			},
		},
		sections: [
			{
				properties: {
					page: {
						size: design.pageSize === 'a4' ? { width: 11906, height: 16838 } : { width: 12240, height: 15840 },
						margin: design.template === 'compact'
							? { top: 520, right: 600, bottom: 520, left: 600 }
							: { top: 650, right: 720, bottom: 650, left: 720 },
					},
				},
				children: paragraphs,
			},
		],
	})
	const blob = await Packer.toBlob(document)
	const url = URL.createObjectURL(blob)
	const anchor = window.document.createElement('a')
	anchor.href = url
	anchor.download = safeFileName(resume, 'docx')
	anchor.click()
	window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
}
