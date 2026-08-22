import type { AtsCheck, AtsReport, ResumeData } from './types'
import { resumeToPlainText } from './types'

const STOP_WORDS = new Set(
	'the a an and or but if in on at to for of with by from as is are was were be been being this that these those it its their our your you we they will can should must may role work working job team teams years year using use used including include across within into about over under through responsible responsibilities required preferred plus who what when where how'.split(
		' ',
	),
)

const ACTION_VERBS = new Set(
	'achieved accelerated administered advised analyzed architected automated built launched collaborated created decreased delivered designed developed directed drove enabled engineered established executed expanded generated grew implemented improved increased initiated led managed mentored migrated negotiated optimized orchestrated owned planned produced reduced resolved scaled secured simplified spearheaded streamlined strengthened transformed'.split(
		' ',
	),
)

const STANDARD_HEADINGS = [
	'experience',
	'professional experience',
	'work experience',
	'education',
	'skills',
	'projects',
	'certifications',
	'professional summary',
	'summary',
]

const cleanWords = (text: string): string[] =>
	text
		.toLowerCase()
		.replace(/[^a-z0-9+#./-]+/g, ' ')
		.split(/\s+/)
		.map((word) => word.replace(/^[-./]+|[-./]+$/g, ''))
		.filter((word) => word.length > 1)

export function extractJobKeywords(text: string, limit = 24): string[] {
	const words = cleanWords(text)
	const frequency = new Map<string, number>()
	for (const word of words) {
		if (STOP_WORDS.has(word) || /^\d+$/.test(word) || word.length < 3) continue
		frequency.set(word, (frequency.get(word) ?? 0) + 1)
	}

	const phrases: string[] = []
	for (let index = 0; index < words.length - 1; index += 1) {
		const first = words[index]
		const second = words[index + 1]
		if (
			first &&
			second &&
			!STOP_WORDS.has(first) &&
			!STOP_WORDS.has(second) &&
			first.length > 2 &&
			second.length > 2
		) {
			const phrase = `${first} ${second}`
			if (!phrases.includes(phrase) && text.toLowerCase().split(phrase).length > 2) phrases.push(phrase)
		}
	}

	const rankedWords = [...frequency.entries()]
		.sort((left, right) => right[1] - left[1] || right[0].length - left[0].length)
		.map(([word]) => word)
	return [...phrases.slice(0, 6), ...rankedWords].filter(
		(keyword, index, all) => all.indexOf(keyword) === index,
	).slice(0, limit)
}

function check(
	id: string,
	label: string,
	points: number,
	maxPoints: number,
	detail: string,
	fix?: string,
): AtsCheck {
	return { id, label, points, maxPoints, passed: points === maxPoints, detail, fix }
}

const ratioPoints = (count: number, total: number, max: number): number =>
	total === 0 ? 0 : Math.min(max, Math.round((count / total) * max))

function scoreFromText(text: string, jobDescription: string, structured?: ResumeData): AtsReport {
	const normalized = text.toLowerCase()
	const words = cleanWords(text)
	const bullets = structured
		? [
				...structured.experience.flatMap((item) => item.bullets),
				...structured.projects.flatMap((item) => item.bullets),
			]
		: text
				.split(/\r?\n/)
				.map((line) => line.trim())
				.filter((line) => /^(?:[-•*]|\d+[.)])\s+/.test(line))
				.map((line) => line.replace(/^(?:[-•*]|\d+[.)])\s+/, ''))
	const quantified = bullets.filter((bullet) => /(?:\d|%|\$|£|€|₹|₨)\s*/.test(bullet)).length
	const actionLed = bullets.filter((bullet) => {
		const first = cleanWords(bullet)[0]
		return first ? ACTION_VERBS.has(first) : false
	}).length
	const firstPersonCount = (normalized.match(/\b(?:i|me|my|mine|we|our|ours)\b/g) ?? []).length
	const suspiciousFormatting = structured
		? 0
		: (text.match(/\t/g) ?? []).length +
			(text.match(/\|/g) ?? []).length +
			(text.match(/ {4,}/g) ?? []).length
	const headingsFound = STANDARD_HEADINGS.filter((heading) => normalized.includes(heading))
	const hasEmail = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(text)
	const hasPhone = /(?:\+?\d[\d\s().-]{7,}\d)/.test(text)
	const firstReadableLine = text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? ''
	const hasName = structured
		? structured.contact.name.trim().split(/\s+/).length >= 2
		: /^[A-Za-zÀ-ž.' -]{3,80}$/.test(firstReadableLine) && firstReadableLine.trim().split(/\s+/).length >= 2
	const hasLocationOrLink = structured
		? Boolean(structured.contact.location || structured.contact.linkedin || structured.contact.website)
		: /(?:linkedin\.com|github\.com|https?:\/\/|\b[A-Z][a-z]+,\s*[A-Z]{2}\b)/.test(text)
	const hasSummary = structured
		? structured.summary.length >= 45
		: /(?:professional\s+summary|career\s+summary|\bsummary\b|\bprofile\b)/i.test(text)
	const hasExperience = structured
		? structured.experience.length > 0
		: /(?:professional\s+experience|work\s+experience|\bexperience\b|employment)/i.test(text)
	const hasEducation = structured
		? structured.education.length > 0
		: /(?:\beducation\b|university|college|bachelor|master|phd|diploma)/i.test(text)
	const inferredSkillBlock = text.match(
		/(?:^|\n)\s*(?:technical\s+)?(?:skills|core competencies|technologies)\s*:?[ \t]*([^\n]*(?:\n(?![A-Z][A-Z &/-]{2,40}\s*$)[^\n]*){0,2})/i,
	)?.[1]
	const inferredSkills = inferredSkillBlock
		? inferredSkillBlock.split(/[,|•;\n]/).map((item) => item.trim()).filter((item) => item.length >= 2 && item.length <= 60)
		: []
	const skillCount = structured ? structured.skills.length : new Set(inferredSkills.map((item) => item.toLowerCase())).size

	const jobKeywords = extractJobKeywords(jobDescription)
	const matchedKeywords = jobKeywords.filter((keyword) => normalized.includes(keyword.toLowerCase()))
	const missingKeywords = jobKeywords.filter((keyword) => !normalized.includes(keyword.toLowerCase()))
	const keywordCoverage = jobKeywords.length ? matchedKeywords.length / jobKeywords.length : null

	const checks: AtsCheck[] = []
	checks.push(
		check('name', 'Full name', hasName ? 2 : 0, 2, hasName ? 'A clear candidate name is present.' : 'No clear full name was found.', 'Add your full name as the first line.'),
		check('email', 'Email address', hasEmail ? 4 : 0, 4, hasEmail ? 'A parseable email address is present.' : 'No valid email was detected.', 'Add a professional email address in the header.'),
		check('phone', 'Phone number', hasPhone ? 3 : 0, 3, hasPhone ? 'A parseable phone number is present.' : 'No phone number was detected.', 'Add a phone number with country/area code.'),
		check('location-link', 'Location or professional link', hasLocationOrLink ? 3 : 0, 3, hasLocationOrLink ? 'Location or a professional profile is present.' : 'No location or professional URL was found.', 'Add your city/country and LinkedIn or portfolio URL.'),
		check('summary', 'Professional summary', hasSummary ? 4 : 0, 4, hasSummary ? 'The resume has a focused summary.' : 'A clear professional summary was not found.', 'Add a 2–4 line summary aligned with the target role.'),
		check('skills', 'Dedicated skills section', skillCount >= 8 ? 4 : Math.min(3, Math.floor(skillCount / 2)), 4, `${skillCount} explicit skills were detected.`, 'List 8–15 role-relevant hard skills in a standard Skills section.'),
		check('experience', 'Experience section', hasExperience ? 5 : 0, 5, hasExperience ? 'Professional experience is present.' : 'No experience section was detected.', 'Use a standard Professional Experience heading and reverse-chronological roles.'),
		check('education', 'Education section', hasEducation ? 3 : 0, 3, hasEducation ? 'Education is present.' : 'No education section was detected.', 'Add degree, institution, and graduation date under Education.'),
		check('headings', 'Standard headings', headingsFound.length >= 3 ? 2 : headingsFound.length ? 1 : 0, 2, `${headingsFound.length} standard section headings were recognized.`, 'Use headings such as Summary, Skills, Professional Experience, and Education.'),
	)

	if (keywordCoverage === null) {
		checks.push(
			check('keywords', 'Target-job keywords', skillCount >= 8 ? 20 : 12, 25, 'No job description was supplied, so exact keyword alignment cannot be measured.', 'Paste the target job description to measure and improve keyword coverage.'),
		)
	} else {
		const points = Math.min(25, Math.round(keywordCoverage * 25))
		checks.push(
			check('keywords', 'Target-job keywords', points, 25, `${matchedKeywords.length} of ${jobKeywords.length} priority terms appear (${Math.round(keywordCoverage * 100)}%).`, missingKeywords.length ? `Add missing terms truthfully where they match your experience: ${missingKeywords.slice(0, 8).join(', ')}.` : undefined),
		)
	}

	checks.push(
		check('action-verbs', 'Action-led achievements', ratioPoints(actionLed, bullets.length, 8), 8, `${actionLed} of ${bullets.length} bullets begin with a strong action verb.`, 'Begin every achievement with a specific verb such as Built, Led, Improved, or Reduced.'),
		check('metrics', 'Quantified impact', ratioPoints(quantified, bullets.length, 10), 10, `${quantified} of ${bullets.length} bullets include measurable impact.`, 'Add truthful scale, speed, revenue, cost, quality, or percentage outcomes to more bullets.'),
	)

	const wordPoints = words.length >= 350 && words.length <= 750 ? 5 : words.length >= 250 && words.length <= 900 ? 3 : words.length >= 120 ? 1 : 0
	const bulletLengths = bullets.map((bullet) => cleanWords(bullet).length)
	const readableBullets = bulletLengths.filter((length) => length >= 8 && length <= 32).length
	const weakPhrases = (normalized.match(/\b(?:responsible for|helped with|worked on|duties included)\b/g) ?? []).length
	const normalizedBullets = bullets.map((bullet) => cleanWords(bullet).join(' ')).filter(Boolean)
	const uniqueBullets = new Set(normalizedBullets).size
	checks.push(
		check('length', 'Focused length', wordPoints, 5, `${words.length} words detected; 350–750 is a useful target for most experienced candidates.`, 'Keep the resume concise: remove repetition or add evidence where content is thin.'),
		check('bullet-length', 'Readable bullets', ratioPoints(readableBullets, bullets.length, 4), 4, `${readableBullets} of ${bullets.length} bullets are 8–32 words long.`, 'Keep each bullet to one achievement, usually 8–32 words.'),
		check('voice', 'Professional voice', firstPersonCount === 0 ? 3 : Math.max(0, 3 - firstPersonCount), 3, firstPersonCount === 0 ? 'No first-person pronouns were detected.' : `${firstPersonCount} first-person pronouns were found.`, 'Remove I, me, my, we, and our from resume statements.'),
		check('specificity', 'Specific language', weakPhrases === 0 ? 2 : 0, 2, weakPhrases === 0 ? 'No weak responsibility phrases were detected.' : `${weakPhrases} weak phrases were detected.`, 'Replace “responsible for” and “worked on” with actions and outcomes.'),
		check('repetition', 'Unique achievements', bullets.length > 0 && uniqueBullets === bullets.length ? 3 : bullets.length > 0 ? 1 : 0, 3, `${uniqueBullets} of ${bullets.length} bullets are unique.`, 'Remove duplicate achievements and give each bullet a distinct result.'),
		check('text-layer', 'Machine-readable text', text.trim().length >= 120 ? 4 : 0, 4, text.trim().length >= 120 ? 'A usable text layer was extracted.' : 'Very little machine-readable text was extracted.', 'Use a text-based PDF or DOCX, not a scanned image.'),
		check('single-column', 'Parser-safe layout', suspiciousFormatting <= 8 ? 3 : suspiciousFormatting <= 15 ? 1 : 0, 3, suspiciousFormatting <= 8 ? 'No strong multi-column or table signals were found.' : `${suspiciousFormatting} possible table/column separators were found.`, 'Use one column and remove tables, text boxes, tabs, icons, and sidebars.'),
		check('section-labels', 'Parser-friendly labels', headingsFound.length >= 3 ? 3 : headingsFound.length ? 1 : 0, 3, `${headingsFound.length} conventional labels were found.`, 'Use conventional text headings instead of icons or creative labels.'),
	)

	const score = Math.max(0, Math.min(100, checks.reduce((total, item) => total + item.points, 0)))
	const grade: AtsReport['grade'] = score >= 90 ? 'Excellent' : score >= 75 ? 'Strong' : score >= 55 ? 'Developing' : 'Needs work'
	const improvements = checks
		.filter((item) => !item.passed && item.fix)
		.sort((left, right) => right.maxPoints - right.points - (left.maxPoints - left.points))
		.map((item) => item.fix as string)
		.filter((item, index, all) => all.indexOf(item) === index)

	return {
		score,
		grade,
		summary:
			score === 100
				? 'All measured ATS checks pass. Keep every claim accurate and tailor the document for each application.'
				: `${100 - score} measured points remain. Complete the highest-impact fixes below, then recheck.`,
		checks,
		improvements,
		matchedKeywords,
		missingKeywords,
		stats: {
			wordCount: words.length,
			bulletCount: bullets.length,
			quantifiedBullets: quantified,
			actionLedBullets: actionLed,
			keywordCoverage: keywordCoverage === null ? null : Math.round(keywordCoverage * 100),
		},
	}
}

export function scoreResume(resume: ResumeData, jobDescription = ''): AtsReport {
	return scoreFromText(resumeToPlainText(resume), jobDescription, resume)
}

export function scoreUploadedResume(text: string, jobDescription = ''): AtsReport {
	return scoreFromText(text, jobDescription)
}
