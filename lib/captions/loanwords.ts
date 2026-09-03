/**
 * English words, written in English.
 *
 * A recogniser told the audio is Nepali writes everything it hears in
 * Devanagari, including the words that were never Nepali in the first place.
 * Nepali speech is heavily code-switched - "तपाईंको bank account update हुँदैछ" -
 * and a transcript that spells those as बैंक एकाउन्ट अपडेट is wrong in the way
 * that matters most: it is not what the speaker said, and no Nepali reader
 * writes them that way either.
 *
 * Three layers deal with it, and this module is the deterministic one:
 *
 *   1. the recogniser is given the common loanwords as phrase hints, so it has
 *      a chance of writing them in Latin itself
 *   2. this module restores the ones it did not, from a lexicon that was
 *      decided word by word
 *   3. the NVIDIA clean-up pass is told, explicitly, that code-switched speech
 *      keeps each word in the script it belongs to - which covers the tail no
 *      lexicon can
 *
 * Precision beats recall here. Converting a genuine Nepali word into an English
 * one is a far worse error than leaving a loanword in Devanagari, so the
 * lexicon is exact-match, the fuzzy fallback is gated three ways, and any word
 * carrying Nepali grammar is left alone on principle: बैंकमा is a Nepali word
 * built on an English stem, and "bankमा" is not an improvement.
 */

import { phoneticKey, romanize, skeletonKey } from './devanagari'

/**
 * English as it should be written, against the Devanagari spellings a
 * recogniser actually produces for it.
 *
 * Every entry was chosen by hand, and the variants are the real ones - a model
 * transcribing Nepali writes "OTP" as ओटिपी, ओटीपी and ओटिवी depending on how
 * clearly it was said. Words that collide with ordinary Nepali are deliberately
 * absent: चेक is both "cheque" and the Nepali "चेक", बस is both "bus" and "sit",
 * and guessing wrong on those is worse than leaving them.
 */
export const ENGLISH_LOANWORDS: Record<string, string[]> = {
	/* ------------------------------------------------------------- banking */
	bank: ['बैंक', 'बैङ्क', 'बैन्क', 'ब्यांक', 'बंैक', 'ब्याङ्क'],
	account: ['एकाउन्ट', 'एकाउन', 'अकाउन्ट', 'एकाउण्ट', 'अकाउण्ट', 'एकाउन्ट्', 'अकाउन्'],
	balance: ['ब्यालेन्स', 'बैलेन्स', 'ब्यालेन्स्', 'बालेन्स'],
	transfer: ['ट्रान्सफर', 'ट्रान्सफर्', 'ट्रान्सफार'],
	transaction: ['ट्रान्जेक्सन', 'ट्रान्ज्याक्सन', 'ट्रान्स्याक्सन', 'ट्रान्जेक्शन'],
	deposit: ['डिपोजिट', 'डिपोजिट्', 'डिपोसिट'],
	statement: ['स्टेटमेन्ट', 'स्टेटमेन्ट्'],
	interest: ['इन्ट्रेस्ट', 'इन्टरेस्ट'],
	branch: ['ब्रान्च', 'ब्रान्च्', 'ब्रान्छ'],
	customer: ['कस्टमर', 'कस्टोमर', 'कस्टमर्'],
	card: ['कार्ड', 'कार्ड्'],
	credit: ['क्रेडिट', 'क्रेडिट्'],
	debit: ['डेबिट', 'डेविट'],
	loan: ['लोन्'],
	payment: ['पेमेन्ट', 'पेमेण्ट'],
	cash: ['क्यास', 'क्यास्', 'क्यास्'],
	wallet: ['वालेट', 'वलेट', 'ह्वालेट'],
	fund: ['फन्ड', 'फण्ड'],
	insurance: ['इन्स्योरेन्स', 'इन्सुरेन्स'],
	policy: ['पोलिसी', 'पलिसी'],
	premium: ['प्रिमियम', 'प्रीमियम'],
	limit: ['लिमिट', 'लिमिट्'],
	charge: ['चार्ज', 'चार्ज्'],
	discount: ['डिस्काउन्ट', 'डिस्काउण्ट'],
	price: ['प्राइस', 'प्राईस'],
	total: ['टोटल'],
	percent: ['परसेन्ट', 'पर्सेन्ट'],

	/* ------------------------------------------------------------ security */
	OTP: ['ओटिपी', 'ओटीपी', 'ओटिपि', 'ओटिवी', 'ओटीपि', 'ओ.टि.पि', 'ओ.टी.पी.'],
	PIN: ['पिन्', 'पीन'],
	ATM: ['एटिएम', 'एटीएम', 'एटिएम्', 'ए.टि.एम.'],
	KYC: ['केवाईसी', 'केवाइसी', 'के.वाई.सी.'],
	password: ['पासवर्ड', 'पास्वर्ड', 'पासवर्ड्'],
	username: ['युजरनेम', 'युसरनेम'],
	login: ['लगिन', 'लोगिन', 'लगइन'],
	verify: ['भेरिफाई', 'भेरिफाइ', 'वेरिफाइ'],
	block: ['ब्लक', 'ब्लक्', 'ब्लोक'],
	fraud: ['फ्रड', 'फ्रड्', 'फ्रोड'],
	scam: ['स्क्याम', 'स्क्याम्'],
	alert: ['अलर्ट', 'अलर्ट्'],
	security: ['सेक्युरिटी', 'सेक्यूरिटी'],
	expire: ['एक्स्पायर', 'एक्सपायर'],
	active: ['एक्टिभ', 'एक्टिव'],

	/* ---------------------------------------------------------- telecom, IT */
	update: ['अपडेट', 'अपडेट्', 'अप्डेट', 'अपडेट्स'],
	SMS: ['एसएमएस', 'एस्एमएस', 'एस.एम.एस.'],
	message: ['मेसेज', 'म्यासेज', 'म्यासेज्', 'मेसेज्'],
	email: ['इमेल', 'इमेल्', 'ईमेल', 'इ-मेल'],
	mobile: ['मोबाइल', 'मोबाईल', 'मोबाइल्'],
	phone: ['फोन', 'फोन्'],
	SIM: ['सिम्'],
	recharge: ['रिचार्ज', 'रिचार्ज्'],
	network: ['नेटवर्क', 'नेटवर्क्'],
	signal: ['सिग्नल', 'सिग्नल्'],
	internet: ['इन्टरनेट', 'इन्टरनेट्', 'इन्टर्नेट'],
	online: ['अनलाइन', 'अनलाईन', 'अनलाइन्', 'अनलाईन्'],
	offline: ['अफलाइन', 'अफलाईन'],
	data: ['डाटा', 'डेटा'],
	app: ['एप्प', 'याप', 'एप्'],
	application: ['एप्लिकेसन', 'एप्लिकेशन', 'एप्लिकेसन्'],
	software: ['सफ्टवेयर', 'सफ्टवेर', 'सफ्टवेयर्'],
	hardware: ['हार्डवेयर', 'हार्डवेर'],
	server: ['सर्भर', 'सर्वर'],
	website: ['वेबसाइट', 'वेब्साइट'],
	link: ['लिंक', 'लिन्क'],
	computer: ['कम्प्युटर', 'कम्प्यूटर', 'कम्प्युटर्', 'कम्प्युटार', 'कम्प्युटर'],
	laptop: ['ल्यापटप', 'ल्यापटप्', 'लैपटप', 'ल्यापटप'],
	keyboard: ['किबोर्ड', 'किबोर्ड्', 'कीबोर्ड'],
	mouse: ['माउस', 'माउस्'],
	screen: ['स्क्रिन', 'स्क्रीन', 'स्क्रिन्'],
	click: ['क्लिक', 'क्लिक्'],
	download: ['डाउनलोड', 'डाउन्लोड'],
	upload: ['अपलोड', 'अप्लोड'],
	file: ['फाइल', 'फाईल'],
	folder: ['फोल्डर', 'फोल्डर्'],
	print: ['प्रिन्ट', 'प्रिण्ट'],
	scan: ['स्क्यान', 'स्क्यान्'],
	copy: ['कपी', 'कपि'],
	PDF: ['पिडिएफ', 'पीडीएफ'],
	ID: ['आइडी', 'आईडी', 'आइडि'],
	QR: ['क्युआर', 'क्यूआर'],

	/* ------------------------------------------------------------- devices */
	video: ['भिडियो', 'विडियो', 'भिडियो्', 'भिडीयो'],
	photo: ['फोटो'],
	camera: ['क्यामेरा', 'कैमरा', 'क्यामरा'],
	battery: ['ब्याट्री', 'बैट्री', 'ब्याट्रि'],
	charger: ['चार्जर', 'चार्जर्'],
	cable: ['केबल', 'केबल्'],
	switch: ['स्विच', 'स्विच्'],
	button: ['बटन्'],
	machine: ['मेसिन', 'मेशिन', 'मेसिन्'],
	engine: ['इन्जिन', 'इन्जिन्'],
	TV: ['टिभी', 'टीभी', 'टिवी', 'टि.भि.'],
	radio: ['रेडियो'],
	power: ['पावर', 'पावर्'],

	/* ------------------------------------------------------------ everyday */
	brush: ['ब्रस', 'ब्रश', 'ब्रस्', 'ब्रश्'],
	car: ['कार्'],
	van: ['भ्यान', 'भ्यान्', 'ब्यान'],
	bike: ['बाइक', 'बाईक', 'बाइक्'],
	truck: ['ट्रक', 'ट्रक्'],
	taxi: ['ट्याक्सी', 'ट्याक्सि'],
	driver: ['ड्राइभर', 'ड्राइवर', 'ड्राईभर'],
	ticket: ['टिकट', 'टिकेट'],
	flight: ['फ्लाइट', 'फ्लाईट'],
	airport: ['एयरपोर्ट', 'एअरपोर्ट'],
	hotel: ['होटल', 'होटेल'],
	restaurant: ['रेस्टुरेन्ट', 'रेष्टुरेन्ट'],
	office: ['अफिस', 'अफिस्', 'अफीस', 'अफिश'],
	table: ['टेबल', 'टेबुल', 'टेबल्'],
	school: ['स्कुल', 'स्कूल', 'स्कुल्'],
	college: ['कलेज', 'कलेज्', 'कलेज'],
	student: ['स्टुडेन्ट', 'स्टुडेण्ट'],
	teacher: ['टिचर', 'टीचर'],
	exam: ['एक्जाम', 'एग्जाम'],
	class: ['क्लास', 'क्लास्'],
	doctor: ['डाक्टर', 'डक्टर', 'डाक्टर्'],
	hospital: ['हस्पिटल', 'हस्पिटल्'],
	medicine: ['मेडिसिन', 'मेडिसिन्'],
	report: ['रिपोर्ट', 'रिपोर्ट्'],
	market: ['मार्केट', 'मार्केट्'],
	passport: ['पासपोर्ट', 'पास्पोर्ट'],
	visa: ['भिसा', 'विसा'],
	license: ['लाइसेन्स', 'लाईसेन्स'],
	address: ['एड्रेस', 'ऐड्रेस', 'एड्रेस्'],
	birthday: ['बर्थडे', 'बर्थ्डे'],
	signature: ['सिग्नेचर', 'सिग्नेचर्'],
	form: ['फारम', 'फर्म्'],

	/* --------------------------------------------------------------- work */
	company: ['कम्पनी', 'कम्पनि'],
	business: ['बिजनेस', 'विजनेस', 'बिजनेस्'],
	manager: ['म्यानेजर', 'मेनेजर', 'म्यानेजर्'],
	staff: ['स्टाफ', 'स्टाफ्'],
	meeting: ['मिटिङ', 'मिटिङ्ग', 'मीटिंग', 'मिटिङ्'],
	project: ['प्रोजेक्ट', 'प्रजेक्ट'],
	plan: ['प्लान', 'प्ल्यान'],
	program: ['प्रोग्राम', 'प्रोग्राम्'],
	system: ['सिस्टम', 'सिस्टम्'],
	process: ['प्रोसेस', 'प्रोसेस्'],
	service: ['सर्भिस', 'सर्विस', 'सर्भिस्'],
	support: ['सपोर्ट', 'सपोर्ट्'],
	problem: ['प्रब्लम', 'प्रोब्लम', 'प्रब्लेम'],
	solution: ['सोलुसन', 'सोल्युसन'],
	request: ['रिक्वेस्ट', 'रिक्वेष्ट'],
	complain: ['कम्प्लेन', 'कम्प्लेन्'],
	confirm: ['कन्फर्म', 'कन्फर्म्'],
	cancel: ['क्यान्सिल', 'क्यान्सल'],
	order: ['अर्डर', 'अर्डर्'],
	delivery: ['डेलिभरी', 'डिलिभरी', 'डेलिवरी'],
	offer: ['अफर्'],
	notice: ['नोटिस', 'नोटिस्'],
	number: ['नम्बर', 'नंबर', 'नम्बर्'],
	code: ['कोड्'],
	test: ['टेस्ट', 'टेष्ट'],
	record: ['रेकर्ड', 'रेकर्ड्'],

	/* -------------------------------------------------------------- social */
	share: ['सेयर', 'शेयर'],
	comment: ['कमेन्ट', 'कमेण्ट'],
	subscribe: ['सब्स्क्राइब', 'सब्स्क्राईब'],
	channel: ['च्यानल', 'चैनल', 'च्यानल्'],
	live: ['लाइभ', 'लाइव', 'लाईभ'],
	music: ['म्युजिक', 'म्यूजिक'],
	game: ['गेम्'],
	news: ['न्युज', 'न्यूज'],
	media: ['मिडिया', 'मीडिया'],
	Facebook: ['फेसबुक', 'फेस्बुक'],
	YouTube: ['युट्युब', 'युट्युब्', 'यूट्यूब'],
	WhatsApp: ['ह्वाट्सएप', 'व्हाट्सएप'],
	Google: ['गुगल', 'गूगल'],
	Instagram: ['इन्स्टाग्राम', 'इन्स्टाग्राम्'],
	content: ['कन्टेन्ट', 'कन्टेण्ट', 'कन्टेन्ट्'],
	// A creator talking about a channel says these in English and the
	// recogniser writes them in Devanagari, where they are neither Nepali
	// words nor searchable ones - "अप्टिमाइज" matches no picture anywhere.
	optimize: ['अप्टिमाइज', 'अप्टिमाईज', 'ओप्टिमाइज', 'अप्टिमाइज्'],
	algorithm: ['एल्गोरिदम', 'एल्गोरिथम', 'अल्गोरिदम', 'एल्गोरिथ्म'],
	thumbnail: ['थम्बनेल', 'थम्बनेल्', 'थम्बनेइल'],
	title: ['टाइटल', 'टाईटल'],
	keyword: ['किवर्ड', 'कीवर्ड'],
	first: ['फर्स्ट', 'फस्ट्'],

	/* ------------------------------------------------------------ courtesy */
	'thank you': ['थ्याङ्क्यू', 'थैंक्यू', 'थ्यांक्यू', 'थ्याङ्कयू', 'थ्याङ्क्यु', 'थ्यांक्यु'],
	thanks: ['थ्याङ्क्स', 'थ्यांक्स', 'थ्याङ्स'],
	please: ['प्लिज', 'प्लीज', 'प्लिज्'],
	sorry: ['सरी', 'सोरी', 'सरि'],
	sir: ['सर्', 'सौर्', 'स्यार'],
	madam: ['म्याडम', 'म्याडम्'],
	hello: ['हेलो', 'हेल्लो'],
	welcome: ['वेलकम', 'वेल्कम'],
	OK: ['ओके', 'ओकेे'],
}

/**
 * Words never to touch, however the fuzzy matcher feels about them.
 *
 * Every one of these is ordinary Nepali that sounds like an English word once
 * its vowels are thrown away - कर against "car", बस against "bus", बन्द against
 * "band". The lexicon above avoids the collision by simply not listing the
 * English side; this list is the second lock on the same door.
 */
const NEVER_CONVERT = new Set([
	'कर', 'करा', 'बस', 'बन्द', 'बन्दा', 'बन्नोस', 'बन्नुहोस', 'मेरो', 'मेरा', 'मेरी',
	'हो', 'होइन', 'छ', 'छन्', 'छु', 'छौं', 'हुन्', 'हुन्छ', 'थियो', 'थिए', 'गर', 'गरे',
	'दिन', 'रात', 'घर', 'पानी', 'खाना', 'मान्छे', 'सुन', 'सुनु', 'भन', 'भने', 'भनि',
	'राम्रो', 'ठूलो', 'सानो', 'धेरै', 'थोरै', 'सबै', 'केही', 'कोही', 'कसरी', 'किन',
	'कहाँ', 'यहाँ', 'त्यहाँ', 'अहिले', 'भोलि', 'हिजो', 'आज', 'फेरि', 'फेरी', 'पछि',
	'अगाडि', 'पछाडि', 'माथि', 'तल', 'भित्र', 'बाहिर', 'सँग', 'संग', 'बिना', 'जस्तो',
	'त्यस्तो', 'यस्तो', 'इस्तो', 'कल', 'हजुर', 'तपाईं', 'तपाई', 'हामी', 'उहाँ', 'उनी',
	'समय', 'काम', 'बाटो', 'देश', 'सहर', 'गाउँ', 'नाम', 'साथी', 'परिवार', 'सरकार',
	'कारण', 'प्रश्न', 'उत्तर', 'शुरु', 'सुरु', 'अन्त', 'बीच', 'सधैं', 'कहिले',
	'मिलेको', 'मिल्छ', 'सक्छ', 'पर्छ', 'लाग्छ', 'जान्छ', 'चाहिन्छ', 'भयो', 'गयो', 'आयो',
])

/**
 * Nepali grammar, glued to the end of a word.
 *
 * A loanword that has taken a Nepali case marker or verb ending has stopped
 * being a foreign word in that sentence - बैंकमा, एकाउन्टलाई, अपडेटहरू - and
 * splitting it across two scripts reads worse than leaving it whole. Ordered
 * longest first so the check is not fooled by a shorter ending inside a longer
 * one.
 */
const NEPALI_SUFFIXES = [
	'हरूलाई', 'हरुलाई', 'हरूको', 'हरुको', 'हरूमा', 'हरुमा', 'हरूले', 'हरुले',
	'बाटको', 'सँगको', 'संगको', 'माथिको', 'हरू', 'हरु', 'लाई', 'बाट', 'सँग', 'संग',
	'मा', 'को', 'का', 'की', 'ले', 'सम्म', 'देखि', 'तिर', 'भन्दा', 'पछि', 'अघि',
	'नोस्', 'न्छ', 'न्छु', 'न्छन्', 'दै', 'एको', 'एका', 'एकी', 'यो', 'छ', 'छु', 'छन्',
]

/**
 * Punctuation that may sit around a word without being part of it.
 *
 * Combining marks are explicitly inside the word: a matra or a virama is the
 * second half of the letter before it, and treating the final ा of थैंक्यू as
 * trailing punctuation is how "thank youू" happens.
 */
const EDGE = /^([^\p{L}\p{N}\p{M}]*)(.*?)([^\p{L}\p{N}\p{M}]*)$/u

const DEVANAGARI = /[ऀ-ॿ]/

/** The exact spellings, inverted once so a lookup is a single Map hit. */
const BY_SPELLING = new Map<string, string>()
for (const [english, spellings] of Object.entries(ENGLISH_LOANWORDS)) {
	for (const spelling of spellings) {
		if (!BY_SPELLING.has(spelling)) BY_SPELLING.set(spelling, english)
	}
	// The bare English word may itself come back in Devanagari-adjacent form.
	BY_SPELLING.set(english, english)
}

/**
 * The fuzzy index, and the collisions dropped out of it.
 *
 * Two English words that sound the same once their vowels are gone - "card"
 * and "crowd", "form" and "firm" - cannot be told apart from a Devanagari
 * spelling, so neither is offered. Silence is the right answer when the
 * evidence does not decide.
 */
const BY_SKELETON = new Map<string, string>()
{
	const seen = new Map<string, number>()
	for (const english of Object.keys(ENGLISH_LOANWORDS)) {
		const key = skeletonKey(english)
		if (!key) continue
		seen.set(key, (seen.get(key) ?? 0) + 1)
	}
	for (const english of Object.keys(ENGLISH_LOANWORDS)) {
		const key = skeletonKey(english)
		// Three consonants is the shortest skeleton that is not routinely shared
		// with ordinary Nepali; anything shorter must be spelled out above.
		if (!key || key.length < 3 || (seen.get(key) ?? 0) > 1) continue
		BY_SKELETON.set(key, english)
	}
}

/** The vowel-preserving index, tried before the skeleton because it is surer. */
const BY_PHONETIC = new Map<string, string>()
{
	const seen = new Map<string, number>()
	const keysOf = (english: string) => [
		phoneticKey(english),
		...(ENGLISH_LOANWORDS[english] ?? []).map((spelling) => phoneticKey(romanize(spelling))),
	]
	for (const english of Object.keys(ENGLISH_LOANWORDS)) {
		for (const key of new Set(keysOf(english))) {
			if (key) seen.set(key, (seen.get(key) ?? 0) + 1)
		}
	}
	for (const english of Object.keys(ENGLISH_LOANWORDS)) {
		for (const key of new Set(keysOf(english))) {
			if (!key || key.length < 3 || (seen.get(key) ?? 0) > 1) continue
			if (!BY_PHONETIC.has(key)) BY_PHONETIC.set(key, english)
		}
	}
}

function carriesNepaliGrammar(word: string): boolean {
	for (const suffix of NEPALI_SUFFIXES) {
		// A word that is only its own suffix is not an inflected loanword.
		if (word.length > suffix.length + 1 && word.endsWith(suffix)) return true
	}
	return false
}

/**
 * The English word a Devanagari spelling is standing in for, or null.
 *
 * Exact lexicon first, then the vowel-preserving key, then the consonant
 * skeleton - each one less certain than the last, and each one refused
 * outright for a word that is blocklisted or carries Nepali grammar.
 */
export function englishFor(word: string): string | null {
	const core = word.trim()
	if (!core || !DEVANAGARI.test(core)) return null

	const exact = BY_SPELLING.get(core)
	if (exact) return exact

	if (NEVER_CONVERT.has(core)) return null
	if (carriesNepaliGrammar(core)) return null

	const latin = romanize(core)
	const phonetic = BY_PHONETIC.get(phoneticKey(latin))
	if (phonetic) return phonetic

	const skeleton = skeletonKey(latin)
	// Two consonants is "car" and "bus" and half the Nepali language at once.
	if (skeleton.length < 3) return null
	return BY_SKELETON.get(skeleton) ?? null
}

export type RestoreResult = {
	text: string
	/** how many words changed script */
	changed: number
}

/**
 * Rewrites the English inside one line of Devanagari back into English.
 *
 * Whatever punctuation surrounded a word is put back around it, so a sentence
 * keeps its danda, its comma and its question mark exactly where they were.
 */
export function restoreEnglishInText(text: string): RestoreResult {
	let changed = 0
	const out = text.replace(/[^\s]+/g, (token) => {
		const match = EDGE.exec(token)
		if (!match) return token
		const [, before, core, after] = match
		const english = englishFor(core)
		if (!english) return token
		changed++
		return `${before}${english}${after}`
	})
	return { text: out, changed }
}

/**
 * The loanwords worth telling the recogniser about up front.
 *
 * Riva raises the probability of a phrase it has been given, so handing it the
 * English a Nepali speaker is most likely to code-switch into is the cheapest
 * chance of getting "bank" written as "bank" in the first place - which is
 * always better than restoring it afterwards from a spelling that has already
 * lost information.
 */
export function loanwordHints(limit = 80): string[] {
	return Object.keys(ENGLISH_LOANWORDS)
		.filter((word) => !word.includes(' '))
		.slice(0, limit)
}
