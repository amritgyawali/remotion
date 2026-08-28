const fs=require('fs')
const p='lib/ai/planner.ts'
let s=fs.readFileSync(p,'utf8')
const old = "\tconst nouns = properNouns(raw).map((noun) => noun.toLowerCase())"
const neu = "\t// Names are grouped (\"New Orleans\"); membership here is per word.\n\tconst nouns = properNouns(raw).flatMap((noun) => noun.toLowerCase().split(' '))"
if (!s.includes(old)) throw new Error('anchor missing')
s = s.replace(old, neu)
fs.writeFileSync(p, s)
console.log('ok')
