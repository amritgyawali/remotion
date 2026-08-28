require('sucrase/register')
const { planStoryboard } = require('../lib/ai/planner.ts')
const { composeVideoSource } = require('../lib/ai/compose.ts')

const seedFor = (i) => `20000000-0000-4000-8000-${String(i).padStart(12, '0')}`
const PROMPTS = [
	'A short film about street food in Kathmandu',
	'Explain how solar panels turn light into electricity',
	'Launch teaser for a new running shoe',
	'The history of jazz in New Orleans',
	'Why remote teams struggle with handoffs',
]

const seen = { template: new Set(), arc: new Set(), bg: new Set(), motion: new Set(), seq: new Set(), layout: new Set(), finish: new Set(), title: new Set(), palette: new Set(), transition: new Set() }
const recentTemplates = []
const recentArcs = []
let n = 0
for (const prompt of PROMPTS) {
	for (let i = 0; i < 8; i += 1) {
		const sb = planStoryboard(prompt, {
			creativeSeed: seedFor(n++),
			avoidTemplates: recentTemplates.slice(-5),
			avoidArcs: recentArcs.slice(-6),
		})
		const p = sb.creativeProfile
		recentTemplates.push(p.template)
		recentArcs.push(p.arc)
		seen.template.add(p.template); seen.arc.add(p.arc); seen.bg.add(p.background)
		seen.motion.add(p.motionSignature); seen.layout.add(p.layout); seen.finish.add(p.finish)
		seen.title.add(p.titleTreatment); seen.palette.add(sb.palette); seen.transition.add(p.transition)
		seen.seq.add(sb.scenes.map((s) => s.type).join('>') + '|' + p.sceneVariants.join(''))
	}
}
console.log(`${n} generations across ${PROMPTS.length} prompts`)
for (const [k, v] of Object.entries(seen)) console.log(`  distinct ${k}: ${v.size}`)

console.log('\nSame prompt, 6 consecutive turns:')
const rt = [], ra = []
for (let i = 0; i < 6; i += 1) {
	const sb = planStoryboard('Make a video about coffee', { creativeSeed: seedFor(900 + i), avoidTemplates: rt.slice(-5), avoidArcs: ra.slice(-6) })
	rt.push(sb.creativeProfile.template); ra.push(sb.creativeProfile.arc)
	console.log(`  ${sb.creativeProfile.template.padEnd(20)} ${sb.creativeProfile.arc.padEnd(14)} ${sb.creativeProfile.background.padEnd(16)} ${sb.creativeProfile.motionSignature.padEnd(14)} ${sb.scenes.map(s=>s.type).join(' > ')}`)
}
