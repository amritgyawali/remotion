/**
 * Devanagari, in both directions.
 *
 * Two jobs live here, and they are the same table read forwards and backwards.
 *
 * Typing: a phonetic input method, so someone with a Latin keyboard can write
 * Nepali into a caption without installing anything. "namaste" becomes नमस्ते,
 * "banda" becomes बन्द, and a word typed in capitals - OTP, ATM, PIN - is left
 * in Latin, because that is what a bilingual speaker means when they shout an
 * acronym in the middle of a Nepali sentence.
 *
 * Reading: a romaniser, used to recognise the English word hiding inside a
 * Devanagari spelling. A recogniser told the audio is Nepali writes every word
 * it hears in Devanagari, including "computer" and "bank", and getting those
 * back into Latin needs a way to sound out what it wrote.
 *
 * Pure string functions - no React, no browser API, no network - so both the
 * editor and the transcript pipeline can use them, and both can be checked.
 */

/* ------------------------------------------------------------ the alphabet */

const VIRAMA = '्'
const ANUSVARA = 'ं'
const CHANDRABINDU = 'ँ'
const VISARGA = 'ः'
const DANDA = '।'

const DEVANAGARI_RANGE = /[ऀ-ॿ]/

export function hasDevanagariText(text: string): boolean {
	return DEVANAGARI_RANGE.test(text)
}

/**
 * Roman spellings to consonants, longest key first at match time.
 *
 * The capitalised keys are the retroflex series - T D N S - which is the
 * convention every romanised Nepali keyboard uses and the only way to reach
 * ट ड ण ष from a Latin keyboard without a modifier.
 */
const CONSONANTS: Record<string, string> = {
	ksh: 'क्ष', // क्ष
	gy: 'ज्ञ', // ज्ञ
	shr: 'श्र', // श्र
	chh: 'छ',
	Chh: 'छ',
	ch: 'च',
	Ch: 'च',
	kh: 'ख',
	Kh: 'ख',
	gh: 'घ',
	Gh: 'घ',
	ng: 'ङ',
	jh: 'झ',
	Jh: 'झ',
	ny: 'ञ',
	Th: 'ठ',
	Dh: 'ढ',
	th: 'थ',
	dh: 'ध',
	ph: 'फ',
	Ph: 'फ',
	bh: 'भ',
	Bh: 'भ',
	sh: 'श',
	Sh: 'ष',
	k: 'क',
	K: 'क',
	q: 'क',
	c: 'क',
	g: 'ग',
	G: 'ग',
	j: 'ज',
	J: 'ज',
	z: 'ज',
	T: 'ट',
	D: 'ड',
	N: 'ण',
	t: 'त',
	d: 'द',
	n: 'न',
	p: 'प',
	P: 'प',
	f: 'फ',
	F: 'फ',
	b: 'ब',
	B: 'ब',
	m: 'म',
	M: 'म',
	y: 'य',
	Y: 'य',
	r: 'र',
	R: 'र',
	l: 'ल',
	L: 'ल',
	v: 'व',
	V: 'व',
	w: 'व',
	W: 'व',
	s: 'स',
	S: 'ष',
	h: 'ह',
	H: 'ह',
}

type Vowel = { independent: string; matra: string }

/**
 * `a` is the inherent vowel: a consonant already carries it, so it adds no
 * matra. That single rule is what makes "banda" come out as बन्द rather than
 * बअन्दअ, and it is why a doubled "aa" is needed for आ.
 */
const VOWELS: Record<string, Vowel> = {
	ai: { independent: 'ऐ', matra: 'ै' },
	au: { independent: 'औ', matra: 'ौ' },
	ou: { independent: 'औ', matra: 'ौ' },
	ei: { independent: 'ऐ', matra: 'ै' },
	aa: { independent: 'आ', matra: 'ा' },
	ee: { independent: 'ई', matra: 'ी' },
	ii: { independent: 'ई', matra: 'ी' },
	oo: { independent: 'ऊ', matra: 'ू' },
	uu: { independent: 'ऊ', matra: 'ू' },
	A: { independent: 'आ', matra: 'ा' },
	I: { independent: 'ई', matra: 'ी' },
	U: { independent: 'ऊ', matra: 'ू' },
	E: { independent: 'ऐ', matra: 'ै' },
	O: { independent: 'औ', matra: 'ौ' },
	a: { independent: 'अ', matra: '' },
	i: { independent: 'इ', matra: 'ि' },
	u: { independent: 'उ', matra: 'ु' },
	e: { independent: 'ए', matra: 'े' },
	o: { independent: 'ओ', matra: 'ो' },
}

/** Marks that attach to whatever came before them. */
const SIGNS: Record<string, string> = {
	'^': ANUSVARA,
	'~': CHANDRABINDU,
	':': VISARGA,
	'|': DANDA,
	'\\': VIRAMA,
}

const CONSONANT_KEYS = Object.keys(CONSONANTS).sort((left, right) => right.length - left.length)
const VOWEL_KEYS = Object.keys(VOWELS).sort((left, right) => right.length - left.length)

function matchAt(keys: string[], text: string, index: number): string | null {
	for (const key of keys) {
		if (text.startsWith(key, index)) return key
	}
	return null
}

/* --------------------------------------------------------------- typing */

/**
 * A word written entirely in capitals is an acronym the speaker said in
 * English - OTP, ATM, PIN, SMS, CEO - and transliterating it produces nonsense
 * no Nepali reader wants. It passes straight through.
 */
export function isAcronym(word: string): boolean {
	return /^[A-Z0-9][A-Z0-9./-]*$/.test(word) && /[A-Z]/.test(word) && word.length >= 2
}

/**
 * Romanised Nepali to Devanagari, one word at a time.
 *
 * The state machine has exactly one variable: whether the last thing written
 * was a consonant still waiting to find out which vowel follows it. A vowel
 * then lands as a matra, another consonant forces a virama between them, and
 * anything else lets the inherent `a` stand.
 */
export function transliterateWord(word: string): string {
	if (!word) return word
	if (isAcronym(word)) return word
	// Nothing to do for text that is already Devanagari, or holds no letters.
	if (!/[A-Za-z]/.test(word)) return word

	let out = ''
	let awaitingVowel = false
	let index = 0

	while (index < word.length) {
		const consonant = matchAt(CONSONANT_KEYS, word, index)
		const vowel = matchAt(VOWEL_KEYS, word, index)

		// A vowel key that is also the start of a longer consonant key never wins,
		// and vice versa: the longer match is always the intended one.
		const useConsonant =
			consonant !== null && (vowel === null || consonant.length >= vowel.length)

		if (useConsonant && consonant) {
			if (awaitingVowel) out += VIRAMA
			out += CONSONANTS[consonant]
			awaitingVowel = true
			index += consonant.length
			continue
		}

		if (vowel) {
			const entry = VOWELS[vowel]
			out += awaitingVowel ? entry.matra : entry.independent
			awaitingVowel = false
			index += vowel.length
			continue
		}

		const sign = SIGNS[word[index]]
		if (sign) {
			// A virama typed by hand means "no vowel here", so the pending
			// consonant is closed rather than left with its inherent `a`.
			out += sign
			awaitingVowel = false
			index += 1
			continue
		}

		// Digits, punctuation and anything else: written through untouched.
		out += word[index]
		awaitingVowel = false
		index += 1
	}

	return out
}

/** Splits on whitespace, transliterates every word, keeps the spacing exactly. */
export function transliterateToDevanagari(text: string): string {
	return text.replace(/[^\s]+/g, (word) => transliterateWord(word))
}

/**
 * The run of Latin the caret is sitting at the end of.
 *
 * The editor converts a word only once the writer has finished it - on a space,
 * on punctuation, or on leaving the field - because converting mid-word would
 * rewrite the text under the caret on every keystroke.
 */
export function trailingLatinRun(text: string, caret: number): { from: number; to: number } | null {
	let from = Math.max(0, Math.min(caret, text.length))
	const to = from
	while (from > 0 && /[A-Za-z^~\\:|]/.test(text[from - 1])) from--
	if (to <= from) return null
	if (!/[A-Za-z]/.test(text.slice(from, to))) return null
	return { from, to }
}

/* ------------------------------------------------------------- romanising */

/** Consonant to its plain roman sound, for reading a spelling back. */
const ROMAN_CONSONANTS: Record<string, string> = {
	'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'ng',
	'च': 'ch', 'छ': 'chh', 'ज': 'j', 'झ': 'jh', 'ञ': 'ny',
	'ट': 't', 'ठ': 'th', 'ड': 'd', 'ढ': 'dh', 'ण': 'n',
	'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n',
	'प': 'p', 'फ': 'ph', 'ब': 'b', 'भ': 'bh', 'म': 'm',
	'य': 'y', 'र': 'r', 'ल': 'l', 'ळ': 'l', 'व': 'v',
	'श': 'sh', 'ष': 'sh', 'स': 's', 'ह': 'h',
	// Nukta forms, which is how Nepali writes the sounds Devanagari lacks.
	'क़': 'q', 'ख़': 'kh', 'ग़': 'g', 'ज़': 'z', 'ड़': 'r',
	'ढ़': 'rh', 'फ़': 'f', 'य़': 'y',
}

const ROMAN_MATRAS: Record<string, string> = {
	'ा': 'aa', 'ि': 'i', 'ी': 'ee', 'ु': 'u', 'ू': 'oo',
	'ृ': 'ri', 'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au',
	'ॅ': 'e', 'ॉ': 'o',
}

const ROMAN_VOWELS: Record<string, string> = {
	'अ': 'a', 'आ': 'aa', 'इ': 'i', 'ई': 'ee', 'उ': 'u',
	'ऊ': 'oo', 'ऋ': 'ri', 'ए': 'e', 'ऐ': 'ai', 'ओ': 'o',
	'औ': 'au', 'ऍ': 'e', 'ऑ': 'o',
}

const ROMAN_DIGITS: Record<string, string> = {
	'०': '0', '१': '1', '२': '2', '३': '3', '४': '4',
	'५': '5', '६': '6', '७': '7', '८': '8', '९': '9',
}

/**
 * Sounds a Devanagari word out in Latin.
 *
 * Deliberately phonetic rather than a reversible transliteration scheme: the
 * point is to end up close enough to an English spelling that a lexicon lookup
 * can recognise "कम्प्युटर" as "computer", not to be able to get back to the
 * exact Devanagari afterwards.
 */
export function romanize(word: string): string {
	let out = ''
	let pendingInherent = false

	const closeInherent = () => {
		if (pendingInherent) out += 'a'
		pendingInherent = false
	}

	for (const character of word) {
		const consonant = ROMAN_CONSONANTS[character]
		if (consonant) {
			closeInherent()
			out += consonant
			pendingInherent = true
			continue
		}

		const matra = ROMAN_MATRAS[character]
		if (matra) {
			pendingInherent = false
			out += matra
			continue
		}

		if (character === VIRAMA) {
			pendingInherent = false
			continue
		}
		if (character === ANUSVARA || character === CHANDRABINDU) {
			closeInherent()
			out += 'n'
			continue
		}
		if (character === VISARGA) {
			closeInherent()
			out += 'h'
			continue
		}
		if (character === '़') continue // bare nukta: already folded above

		const vowel = ROMAN_VOWELS[character]
		if (vowel) {
			closeInherent()
			out += vowel
			continue
		}

		const digit = ROMAN_DIGITS[character]
		if (digit) {
			closeInherent()
			out += digit
			continue
		}

		closeInherent()
		out += character
	}

	closeInherent()
	return out
}

/**
 * A spelling-insensitive key for matching a sounded-out word against a word
 * list. Everything that Devanagari and English disagree about - aspiration,
 * v against w, c against k, doubled letters, the inherent `a` on the end -
 * is folded away, while the vowels themselves are kept, because dropping them
 * turns half the Nepali language into an English word.
 */
export function phoneticKey(latin: string): string {
	let key = latin.toLowerCase().replace(/[^a-z]/g, '')
	if (!key) return ''

	// The ch sound is parked on an uppercase C, so that the bare `c` left over -
	// which in an English word is nearly always /k/, as in "computer" and "car" -
	// can be folded into k without the two colliding.
	key = key
		.replace(/chh/g, 'C')
		.replace(/ch/g, 'C')
		.replace(/sh/g, 's')
		.replace(/kh/g, 'k')
		.replace(/gh/g, 'g')
		.replace(/th/g, 't')
		.replace(/dh/g, 'd')
		.replace(/bh/g, 'b')
		.replace(/ph/g, 'f')
		.replace(/jh/g, 'j')
		.replace(/ck/g, 'k')
		.replace(/qu/g, 'kv')
		.replace(/wh/g, 'v')
		.replace(/ng/g, 'n')
		.replace(/ny/g, 'n')
		.replace(/x/g, 'ks')
		.replace(/q/g, 'k')
		.replace(/c/g, 'k')
		.replace(/z/g, 'j')
		.replace(/w/g, 'v')
		.replace(/y/g, 'i')

	key = key
		.replace(/aa/g, 'a')
		.replace(/ee/g, 'i')
		.replace(/ea/g, 'i')
		.replace(/ie/g, 'i')
		.replace(/oo/g, 'u')
		.replace(/ou/g, 'u')
		.replace(/ue/g, 'u')
		.replace(/au/g, 'o')
		.replace(/ai/g, 'e')
		.replace(/oa/g, 'o')
		.replace(/ii/g, 'i')

	key = key.replace(/(.)\1+/g, '$1')
	// The inherent vowel Devanagari puts on every final consonant is noise.
	key = key.replace(/a$/, '')
	// The parked ch sound comes back as an ordinary letter on the way out.
	return key.replace(/C/g, 'c')
}

/**
 * The consonant skeleton of a sounded-out word, with the classes Devanagari
 * and English disagree about folded together.
 *
 * Vowels are what a recogniser gets wrong when it writes an English word in
 * Devanagari - "computer" comes back as कम्प्युटर, which sounds out as
 * "kmpyutara" - so a key that ignores them recognises the word where a
 * vowel-preserving one cannot. It is also lossy enough to turn ordinary Nepali
 * into English if used carelessly: कर and "car" share a skeleton. Callers must
 * gate it, which `loanwords.ts` does on length, morphology and a blocklist.
 */
export function skeletonKey(latin: string): string {
	const folded = phoneticKey(latin)
	if (!folded) return ''
	return folded
		.replace(/[aeiou]/g, '')
		.replace(/(.)\1+/g, '$1')
}
