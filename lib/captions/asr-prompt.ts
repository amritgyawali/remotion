/**
 * The prompt that steers Groq's hosted Whisper.
 *
 * The single most misunderstood parameter in the Whisper API. `prompt` is *not*
 * an instruction channel - the model has no instruction tuning at all. Whisper
 * decodes audio conditioned on the previous 224 tokens of transcript, and the
 * API simply lets you supply those tokens yourself. So the prompt is read as
 * "the transcript so far", and the model continues in whatever style it
 * establishes.
 *
 * Two consequences drive everything in this file:
 *
 *   1. An imperative prompt is actively harmful. Send "Transcribe the audio
 *      exactly, do not paraphrase" and Whisper may emit that sentence, or a
 *      paraphrase of it, at the top of the transcript - it looks like context
 *      that was spoken. Style is therefore *demonstrated*, never requested.
 *
 *   2. Only the last 224 tokens survive. Anything earlier is silently dropped,
 *      so the ordering here is deliberate: general style exemplar first,
 *      then the script sample, and the vocabulary the recogniser is most likely
 *      to get wrong last, where it cannot be truncated away.
 *
 * What a prompt can actually buy, and what this file spends it on:
 *
 *   - Spelling of proper nouns and jargon it has never heard ("Remotion", not
 *     "remotion" or "Ree motion").
 *   - Keeping English loanwords in Latin script inside Devanagari speech, which
 *     is how Nepali is really written and the studio's primary case.
 *   - Punctuation and sentence casing, which Whisper drops when the preceding
 *     context is unpunctuated - and which the cue splitter needs to find
 *     sentence ends.
 *   - Verbatim register: an exemplar containing a filler and a false start
 *     nudges the model away from the tidy-up it does by default.
 *
 * What it cannot buy, and is not asked for here: timestamp behaviour. Word
 * timings come from `timestamp_granularities[]=word`, are returned as measured
 * seconds, and are passed through untouched. No prompt text changes them.
 */

import { loanwordHints } from './loanwords'

/** Whisper conditions on 224 tokens; past that the front is dropped silently. */
export const PROMPT_TOKEN_BUDGET = 224
/** Tokens are ~4 characters of Latin text and far denser in Devanagari. */
const CHARS_PER_TOKEN = 4

/**
 * A verbatim exemplar, not an instruction.
 *
 * Every property we want is present as a *demonstration*: real sentence casing,
 * terminal punctuation, a comma, an interruption dash, a filler ("um") and a
 * false start ("we we"). Whisper continues the register it is shown, so showing
 * it disfluency is what stops it from quietly deleting the speaker's.
 */
const VERBATIM_EXEMPLAR =
	'Okay, so - um, the thing I want to show you today is, we we built this in about a week. Right? Let me walk through it properly.'

/**
 * The Devanagari exemplar for Nepali and Nepali/English code-switching.
 *
 * The English words inside it are the point. Left to itself Whisper transcribes
 * a Nepali speaker's "feature" and "update" phonetically into Devanagari, which
 * is not how anyone writes Nepali; one line of mixed script is enough to hold
 * the loanwords in Latin for the rest of the transcript.
 */
const DEVANAGARI_EXEMPLAR =
	'हो त, अब म तपाईंलाई यो feature देखाउँछु। यसको update हामीले गत हप्ता नै release गर्‍यौं, र performance पनि राम्रो छ।'

const LANGUAGE_EXEMPLARS: Record<string, string> = {
	ne: DEVANAGARI_EXEMPLAR,
	hi: 'तो देखिए, यह feature हमने पिछले हफ़्ते ही release किया था, और इसका performance भी अच्छा है।',
}

export type PromptOptions = {
	/** ISO-639-1 code, or null/'auto' when Whisper is detecting the language. */
	language?: string | null
	/** Proper nouns and jargon this clip is likely to contain. */
	vocabulary?: string[]
	/** Whether the transcript is expected to carry Devanagari. */
	devanagari?: boolean
	/**
	 * The tail of the previous chunk's transcript. Real preceding context beats
	 * any synthetic exemplar, so when it exists it takes the budget.
	 */
	previousText?: string | null
}

/** Trim to the last `budget` tokens' worth, on a word boundary. */
function clampToBudget(text: string, budget = PROMPT_TOKEN_BUDGET): string {
	const limit = budget * CHARS_PER_TOKEN
	if (text.length <= limit) return text
	// Keep the END: that is the part Whisper conditions on most strongly, and
	// the part this file deliberately loads with vocabulary.
	const tail = text.slice(text.length - limit)
	const boundary = tail.search(/\s/)
	return (boundary > 0 ? tail.slice(boundary + 1) : tail).trim()
}

function cleanVocabulary(entries: string[]): string[] {
	const seen = new Set<string>()
	const out: string[] = []
	for (const raw of entries) {
		const term = raw.trim().replace(/\s+/g, ' ')
		if (term.length === 0 || term.length > 40) continue
		const key = term.toLowerCase()
		if (seen.has(key)) continue
		seen.add(key)
		out.push(term)
	}
	return out
}

/**
 * Build the prompt for one chunk.
 *
 * Ordering is the whole design: least important first, because the front is
 * what gets truncated. A caller that supplies real previous text gets that
 * instead of the exemplar - continuing a genuine transcript is strictly better
 * conditioning than continuing an invented one, and it is what keeps spelling
 * and speaker style consistent across a long clip's chunk boundaries.
 */
export function buildWhisperPrompt(options: PromptOptions = {}): string {
	const language = (options.language ?? '').split('-')[0].toLowerCase()
	const wantsDevanagari = options.devanagari === true || language === 'ne' || language === 'hi'

	const parts: string[] = []

	// 1. Style. Dropped first if the budget runs out, and the cheapest to lose.
	parts.push(VERBATIM_EXEMPLAR)

	// 2. Script. A Devanagari clip needs the mixed-script sample more than it
	//    needs the English exemplar above.
	const exemplar = LANGUAGE_EXEMPLARS[language]
	if (exemplar) parts.push(exemplar)
	else if (wantsDevanagari) parts.push(DEVANAGARI_EXEMPLAR)

	// 3. Real context, when there is any. Whisper is built to continue this.
	const previous = options.previousText?.trim()
	if (previous) parts.push(clampToBudget(previous, Math.round(PROMPT_TOKEN_BUDGET / 2)))

	// 4. Vocabulary, last, so truncation can never reach it. Written as a
	//    sentence rather than a bare list: Whisper conditions on transcript-
	//    shaped text, and a comma-separated dump reads as a list to be continued.
	//
	//    Within the list the ordering is deliberate too. The generic Nepali
	//    code-switch loanwords go first and the caller's own terms last, because
	//    clamping eats the front: a name this clip actually contains must outlive
	//    a word Whisper already knows how to spell.
	const vocabulary = cleanVocabulary([
		...(wantsDevanagari ? loanwordHints(24) : []),
		...(options.vocabulary ?? []),
	])
	if (vocabulary.length > 0) {
		// Keep the tail, for the same reason: it is the end that survives.
		parts.push(`Terms used: ${vocabulary.slice(-60).join(', ')}.`)
	}

	return clampToBudget(parts.join(' ').replace(/\s+/g, ' ').trim())
}

/**
 * Whisper wants a bare ISO-639-1 code and nothing else.
 *
 * `en-US` is a Riva spelling and Groq rejects it; `multi` and `auto` are this
 * studio's own words for "detect it". Returning null in those cases is not a
 * fallback, it is the better answer - a declared language that disagrees with
 * the audio measurably degrades the transcript, while detection on a clean
 * 16 kHz mono chunk is close to free.
 */
export function whisperLanguage(language: string | null | undefined): string | null {
	if (!language) return null
	const code = language.trim().toLowerCase().split(/[-_]/)[0]
	if (!code || code === 'auto' || code === 'multi') return null
	if (!/^[a-z]{2,3}$/.test(code)) return null
	return code
}
