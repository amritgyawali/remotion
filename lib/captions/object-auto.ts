'use client'

/**
 * One press: read the subtitles, find the words that carry the video, fetch a
 * real picture of each one, cut it out, and put it behind the speaker's head at
 * the moment they say it.
 *
 * The whole flow is here rather than in the panel because it is a *decision
 * procedure*, not a sequence of clicks, and every step of it has to be
 * reproducible and testable without a browser:
 *
 *   1. **How many objects.** One for every five seconds of video. That is not
 *      arbitrary - it is roughly the shortest an image can stay up and still be
 *      looked at, and it makes the density a property of the clip rather than
 *      of how chatty the transcript is.
 *
 *   2. **Which words.** Ranked locally first, always: term frequency against
 *      how many lines the word appears in, so the winner is the word the video
 *      is *about* rather than the word it repeats. A language model is then
 *      asked the same question and its answers are merged over the top, because
 *      it can tell a monastery from a moment and arithmetic cannot. Neither
 *      pass is allowed to be a dependency - no key, no network, no model, and
 *      the local ranking is what ships.
 *
 *   3. **When.** A word said four times gets *one* object, at the occurrence
 *      that is furthest from every object already placed. This is what stops
 *      the plan clumping three pictures into one dense sentence and leaving
 *      forty seconds empty - the spread is the point of counting seconds in
 *      step one.
 *
 *   4. **What picture.** The web is searched per word and the candidates are
 *      tried in order until one is genuinely a cut-out. A word whose every
 *      candidate is a rectangle is not given a white box: it falls to the
 *      studio's own art pack, which is at least transparent, and then to one
 *      last sweep that asks the route for photographs alone and keeps the best
 *      of them with a softened edge. Only a word that fails all three is left
 *      without an object, and it is named rather than quietly dropped - as is
 *      every word that ended up with a photograph, because that looks different
 *      on screen and nobody should have to guess which ones they were.
 *
 *   5. **How big.** Three head widths across, by default. The conversion from
 *      that sentence to the renderer's `scale` is `scaleForHeadMultiple`, and
 *      it cancels the head measurement out - so the multiple holds on a
 *      close-up and on a wide shot without anything being re-measured.
 */

import { scaleForHeadMultiple } from './object-anchor'
import { englishFor } from './loanwords'
import { matchObjectForText, objectAssetSrc, wordsOf } from './object-library'
import {
	DEFAULT_SHOT_LOOK,
	tidyShots,
	type ObjectShot,
} from './object-plan'
import {
	resolveObjectPicture,
	searchObjectImages,
	type DownloadedPicture,
	type ImageCandidate,
	type ImageSearchResult,
} from './object-fetch'
import type { CaptionCue } from './types'

/* ==========================================================================
   How many, and which words.
   ========================================================================== */

/** One object per this many seconds of video, unless the caller says otherwise. */
export const SECONDS_PER_OBJECT = 5

/** Never fewer than one, never more than this - a plan nobody can review. */
const MAX_OBJECTS = 24

export function keywordTargetCount(durationMs: number, secondsPerObject = SECONDS_PER_OBJECT): number {
	const seconds = Math.max(0, durationMs) / 1000
	const per = Math.max(1, secondsPerObject)
	return Math.max(1, Math.min(MAX_OBJECTS, Math.round(seconds / per)))
}

/**
 * Words that are never what a line is about.
 *
 * English plus the Nepali function words this studio meets constantly, because
 * a transcript in Devanagari that ranked "छ" and "मा" at the top would be
 * ranking punctuation. It is deliberately not a full stop-word list: a list
 * long enough to be linguistically respectable also eats "work", "money" and
 * "home", which are exactly the words worth a picture.
 */
export const STOPWORDS = new Set([
	'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'than', 'so', 'because', 'as', 'of', 'at', 'by',
	'for', 'with', 'about', 'into', 'onto', 'from', 'up', 'down', 'out', 'in', 'on', 'off', 'over',
	'under', 'again', 'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'any', 'both',
	'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same',
	'too', 'very', 'can', 'will', 'just', 'should', 'now', 'this', 'that', 'these', 'those', 'am', 'is',
	'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'having', 'do', 'does', 'did',
	'doing', 'would', 'could', 'shall', 'may', 'might', 'must', 'i', 'you', 'he', 'she', 'it', 'we',
	'they', 'me', 'him', 'her', 'us', 'them', 'my', 'your', 'his', 'its', 'our', 'their', 'what',
	'which', 'who', 'whom', 'like', 'get', 'got', 'go', 'going', 'went', 'know', 'think', 'really',
	'thing', 'things', 'stuff', 'okay', 'yeah', 'yes', 'well', 'right', 'lot', 'kind', 'sort', 'time',
	'way', 'today', 'people', 'guys', 'let', 'make', 'made', 'take', 'took', 'want', 'need', 'said',
	'say', 'says', 'see', 'look', 'looking', 'one', 'two', 'three', 'first', 'next', 'last', 'also',
	'even', 'much', 'many', 'still', 'back', 'good', 'great', 'nice', 'little', 'big',
	'छ', 'हो', 'हुन्', 'थियो', 'भयो', 'गर्न', 'गर्छ', 'मा', 'को', 'का', 'की', 'र', 'तर', 'यो', 'त्यो',
	'म', 'हामी', 'तपाईं', 'उनी', 'पनि', 'नै', 'लाई', 'बाट', 'भन्ने', 'अनि', 'हुन', 'गरे', 'छन्',
	// The words a Nepali sentence is built out of rather than about. Every one
	// of these was picked by the ranking on a real clip and then found no
	// picture anywhere, because there is no picture of "जसले" to find.
	'हजुर', 'जो', 'जस', 'जुन', 'जब', 'तेस', 'त्यस', 'उस', 'यस', 'के', 'किन', 'कसरी', 'कहाँ',
	'अब', 'फेरि', 'साथै', 'तैपनि', 'किनभने', 'गर्ना', 'गर्नु', 'गर्दा', 'गरेको', 'गरेर', 'हुन्छ',
	'हुँदा', 'भने', 'भन्न', 'भन्दै', 'हेर्न', 'हेर्दा', 'जान', 'आउन', 'दिन', 'लिन', 'सक्ने', 'सक्छ',
	'चाहिं', 'चाहिने', 'मात्र', 'सबै', 'केही', 'धेरै', 'थोरै', 'राम्रो', 'नराम्रो', 'ठिक', 'यहाँ',
	'त्यहाँ', 'यसरी', 'त्यसरी', 'यसको', 'अहिले', 'पहिले', 'हामीलाई', 'मलाई',
])

/**
 * The endings a Nepali word takes that do not change what it is about.
 *
 * Longest first, so जसले is not mistaken for जस + ल. Only ever used to ask
 * whether the *root* is a function word - a word is never renamed by this, and
 * never dropped because a suffix happened to be stripped off something real.
 */
const NEPALI_ENDINGS = [
	'हरूलाई', 'हरुलाई', 'हरूको', 'हरुको', 'हरूले', 'हरुले', 'हरूमा', 'हरुमा',
	'लाई', 'हरू', 'हरु', 'बाट', 'सँग', 'संग', 'माथि', 'भन्दा', 'सम्म', 'देखि',
	'को', 'का', 'की', 'ले', 'मा', 'ँ', 'ा', 'ो', 'े',
]

/**
 * A word with its Nepali case marker taken off, when it has one.
 *
 * तपाईंलाई is तपाईं with a dative on it, तेसको is तेस with a genitive, and
 * both are exactly as unpicturable as the bare pronoun - so the stopword list
 * has to be able to see through the ending to refuse them.
 */
export function nepaliRoot(word: string): string {
	for (const ending of NEPALI_ENDINGS) {
		if (word.length > ending.length + 1 && word.endsWith(ending)) {
			return word.slice(0, word.length - ending.length)
		}
	}
	return word
}

/**
 * What to search the web for, given a word as the recogniser wrote it.
 *
 * A Nepali transcript spells its English out in Devanagari - फर्स्ट, अप्टिमाइज,
 * कन्टेन्ट - and no image search on earth has a picture filed under those. The
 * loanword lexicon knows the English they stand for, and the English is what
 * gets searched. A genuinely Nepali word is left exactly as it was said.
 */
export function searchTermFor(word: string): string {
	return englishFor(word) ?? word
}

export type KeywordOccurrence = {
	cueIndex: number
	/** when the word itself is spoken, from the cue's own word timings */
	atMs: number
	endMs: number
}

export type RankedKeyword = {
	word: string
	/** what to search for - the model's suggestion, or the word itself */
	query: string
	occurrences: KeywordOccurrence[]
	/** total times the word is spoken */
	count: number
	/** how many cues mention it */
	documents: number
	score: number
	/** true when a language model chose this one */
	fromAi: boolean
}

/** A word's own timing inside its cue, or the cue's, when nothing matches. */
function occurrenceInCue(cue: CaptionCue, word: string, cueIndex: number): KeywordOccurrence {
	const token = cue.tokens?.find((entry) => entry.text.toLowerCase().includes(word))
	const atMs = token ? token.fromMs : cue.startMs
	const endMs = token ? Math.max(token.toMs, atMs + 1) : cue.endMs
	return { cueIndex, atMs, endMs }
}

const isRankable = (word: string): boolean => {
	if (STOPWORDS.has(word)) return false
	if (/^\d+$/.test(word)) return false
	// A Nepali function word wearing a case marker is still a function word,
	// and an English one written in Devanagari is still an English one - both
	// have to be refused through the spelling that was actually said.
	const root = nepaliRoot(word)
	if (root !== word && STOPWORDS.has(root)) return false
	const english = englishFor(word)
	if (english && STOPWORDS.has(english.toLowerCase())) return false
	// Length in code points: Devanagari carries its vowels as combining marks,
	// so `.length` calls a three-letter word eight characters long.
	return [...word].length >= 3
}

/**
 * Ranks every word in the transcript by how much of the video it carries.
 *
 * Term frequency times inverse document frequency, over the cues rather than
 * over a corpus - the corpus that matters is this video. A word said once in
 * forty lines and a word said in all forty are both bad candidates for
 * different reasons, and the product of the two terms is what puts the word
 * said six times across four lines at the top, which is the one a viewer would
 * name if asked what the video was about.
 */
export function rankTranscriptKeywords(cues: CaptionCue[]): RankedKeyword[] {
	const documents = Math.max(1, cues.length)
	const counts = new Map<string, number>()
	const inCues = new Map<string, Set<number>>()
	const occurrences = new Map<string, KeywordOccurrence[]>()

	cues.forEach((cue, cueIndex) => {
		const seen = new Set<string>()
		for (const word of wordsOf(cue.text)) {
			if (!isRankable(word)) continue
			counts.set(word, (counts.get(word) ?? 0) + 1)
			if (seen.has(word)) continue
			seen.add(word)
			const bucket = inCues.get(word) ?? new Set<number>()
			bucket.add(cueIndex)
			inCues.set(word, bucket)
			const list = occurrences.get(word) ?? []
			list.push(occurrenceInCue(cue, word, cueIndex))
			occurrences.set(word, list)
		}
	})

	const ranked: RankedKeyword[] = []
	for (const [word, count] of counts) {
		const documentCount = inCues.get(word)?.size ?? 1
		const idf = Math.log(1 + documents / documentCount)
		// The square root of the count, not the count. Repetition has to matter -
		// the user asked for the *popular* words - but linearly it swamps the
		// second term, and the word said in every line wins every time. Rooted,
		// a word said seven times across seven lines scores just under one said
		// three times across three, which is the ordering a viewer would give:
		// the market is where the video happens, the mango is what it is about.
		const frequency = Math.sqrt(count)
		// A longer word is more often the concrete noun and less often the filler
		// that survived the list. A weak nudge, not a rule.
		const lengthBonus = 1 + Math.min(10, [...word].length) / 40
		ranked.push({
			word,
			query: searchTermFor(word),
			occurrences: occurrences.get(word) ?? [],
			count,
			documents: documentCount,
			score: frequency * idf * lengthBonus,
			fromAi: false,
		})
	}

	return ranked.sort((left, right) => right.score - left.score || left.word.localeCompare(right.word))
}

/* ==========================================================================
   Spreading them across the clip.
   ========================================================================== */

export type PlacedKeyword = RankedKeyword & { atMs: number; endMs: number; cueIndex: number }

/**
 * Takes the best words and gives each one moment, as far apart as they go.
 *
 * A word is placed at whichever of its own occurrences is furthest from
 * everything already placed, and a word with no occurrence far enough from the
 * rest is dropped in favour of the next candidate. Without this the top ten
 * words of a transcript routinely land inside two sentences - they are the top
 * ten *because* that passage is dense - and the video gets a slideshow followed
 * by nothing.
 */
export function spreadKeywords(
	ranked: RankedKeyword[],
	options: { count: number; minGapMs?: number; durationMs?: number },
): PlacedKeyword[] {
	const minGapMs = options.minGapMs ?? 2_200
	const ceiling = options.durationMs && options.durationMs > 0 ? options.durationMs : Infinity
	const placed: PlacedKeyword[] = []

	for (const keyword of ranked) {
		if (placed.length >= options.count) break
		let best: { occurrence: KeywordOccurrence; distance: number } | null = null

		for (const occurrence of keyword.occurrences) {
			if (occurrence.atMs >= ceiling) continue
			const distance = placed.length
				? Math.min(...placed.map((entry) => Math.abs(entry.atMs - occurrence.atMs)))
				: Infinity
			if (distance < minGapMs) continue
			if (!best || distance > best.distance) best = { occurrence, distance }
		}

		if (!best) continue
		placed.push({
			...keyword,
			atMs: best.occurrence.atMs,
			endMs: best.occurrence.endMs,
			cueIndex: best.occurrence.cueIndex,
		})
	}

	return placed.sort((left, right) => left.atMs - right.atMs)
}

/* ==========================================================================
   Asking the model the same question.
   ========================================================================== */

type KeywordPick = { line?: unknown; word?: unknown; query?: unknown }

export type AiKeywordResult = {
	picks: Array<{ line: number; word: string; query: string }>
	model: string | null
	notice: string | null
}

export async function aiKeywords(args: {
	cues: CaptionCue[]
	count: number
	signal?: AbortSignal
}): Promise<AiKeywordResult> {
	try {
		const response = await fetch('/api/captions/keywords', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ lines: args.cues.map((cue) => cue.text), count: args.count }),
			signal: args.signal,
		})
		const payload = (await response.json()) as {
			keywords?: KeywordPick[]
			model?: unknown
			notice?: unknown
			error?: unknown
		}
		if (!response.ok) {
			return {
				picks: [],
				model: null,
				notice: typeof payload?.error === 'string' ? payload.error : `The keyword pass returned HTTP ${response.status}.`,
			}
		}
		const picks = Array.isArray(payload.keywords)
			? payload.keywords.flatMap((pick) => {
					const line = typeof pick.line === 'number' ? Math.round(pick.line) : -1
					const word = typeof pick.word === 'string' ? pick.word.toLowerCase() : ''
					if (line < 0 || line >= args.cues.length || !word) return []
					const query = typeof pick.query === 'string' && pick.query ? pick.query : word
					return [{ line, word, query }]
				})
			: []
		return {
			picks,
			model: typeof payload.model === 'string' ? payload.model : null,
			notice: typeof payload.notice === 'string' ? payload.notice : null,
		}
	} catch (error) {
		if (args.signal?.aborted) throw error
		return {
			picks: [],
			model: null,
			notice: error instanceof Error ? error.message : 'The keyword pass could not be reached.',
		}
	}
}

/**
 * Puts the model's words at the front of the local ranking.
 *
 * Merged rather than substituted, for the same reason the object director
 * merges: the model returns a handful of good words and the ranking has a
 * hundred usable ones, so the model's list decides the *top* of the plan and
 * the local one fills whatever is left. A model word that nobody actually said
 * in that line was already dropped by the route; one that has no timing here is
 * dropped too, because an object with no moment is not an object.
 */
export function mergeKeywords(
	local: RankedKeyword[],
	picks: AiKeywordResult['picks'],
	cues: CaptionCue[],
): RankedKeyword[] {
	if (picks.length === 0) return local
	const byWord = new Map(local.map((keyword) => [keyword.word, keyword]))
	const top: RankedKeyword[] = []

	for (const pick of picks) {
		const cue = cues[pick.line]
		if (!cue) continue
		// The word has to be in the line the model said it was in. The route
		// checks this too, and it is checked again here because this function is
		// the only thing that turns a pick into a moment: a word nobody said has
		// no moment, and an object placed at one would appear over a sentence
		// that has nothing to do with it.
		if (!cue.text.toLowerCase().includes(pick.word)) continue
		const existing = byWord.get(pick.word)
		const occurrence = occurrenceInCue(cue, pick.word, pick.line)
		if (existing) {
			byWord.delete(pick.word)
			top.push({
				...existing,
				query: pick.query,
				fromAi: true,
				// The model chose the line as well as the word, so its occurrence
				// leads: the picture appears where the sentence needed it.
				occurrences: [occurrence, ...existing.occurrences.filter((entry) => entry.cueIndex !== pick.line)],
			})
			continue
		}
		top.push({
			word: pick.word,
			query: pick.query,
			occurrences: [occurrence],
			count: 1,
			documents: 1,
			score: 0,
			fromAi: true,
		})
	}

	return [...top, ...local.filter((keyword) => byWord.has(keyword.word))]
}

/* ==========================================================================
   The whole plan.
   ========================================================================== */

export type AutoObjectStage = 'keywords' | 'search' | 'pictures' | 'photos' | 'plan'

export type AutoObjectProgress = { stage: AutoObjectStage; ratio: number; message: string }

export type PlanWebObjectsArgs = {
	cues: CaptionCue[]
	durationMs: number
	/** the clip's pixel size, which decides what "three heads wide" means */
	frameWidth: number
	frameHeight: number
	/** how many head widths across each picture is drawn */
	headMultiple: number
	/** false skips the language model and ranks the words locally */
	useAi: boolean
	secondsPerObject?: number
	/** how long one object stays up */
	shotMs?: number
	signal?: AbortSignal
	onProgress?: (progress: AutoObjectProgress) => void
	/**
	 * Parks a downloaded picture in the vault and returns its id.
	 *
	 * Passed in rather than imported so this module never touches storage
	 * itself: the studio owns the vault, knows the id scheme, and is the only
	 * thing that can clean up after a plan is thrown away.
	 */
	storePicture: (shotId: string, blob: Blob, name: string) => Promise<string | null>
}

export type PlanWebObjectsResult = {
	shots: ObjectShot[]
	/** the words that were looked for, in the order they are spoken */
	keywords: PlacedKeyword[]
	/** words that found nothing usable anywhere - not a cut-out, not the pack, not a photograph */
	misses: string[]
	/** words the web could not illustrate that the studio's own pack could */
	fromLibrary: string[]
	/**
	 * Words that got a photograph with its background rather than a cut-out.
	 *
	 * Reported separately because they look different on screen - a softened
	 * inset rather than an object standing in the frame - and somebody reviewing
	 * the plan should not have to guess which ones those are.
	 */
	photos: string[]
	/**
	 * Shots that were downloaded and then dropped by the tidy pass.
	 *
	 * Their pictures are already in the vault with nothing pointing at them, so
	 * the caller has to delete them - this module never touches storage itself.
	 */
	discarded: string[]
	director: 'ai' | 'local'
	model: string | null
	notice: string | null
}

const DEFAULT_SHOT_MS = 3_200

/**
 * The same tidy the search applies before it looks anything up.
 *
 * Deliberately a copy of `tidyQuery` in `lib/captions/image-search.ts` rather
 * than an import of it: that module reads `process.env` and talks to eight
 * providers, and none of that belongs in the browser bundle for the sake of one
 * regular expression. The two must not drift - the route answers under the
 * tidied spelling, so a mismatch here would look to the user like the web
 * having no picture of anything.
 */
export function searchableQuery(query: string): string {
	return query
		.replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 60)
}

let sequence = 0
const nextId = (): string => `web-${Date.now().toString(36)}-${(sequence++).toString(36)}`

/**
 * The one-press plan: words, pictures, sizes and timings.
 *
 * Everything that can fail for one word fails only for that word. A picture
 * that will not cut out, a host that answers 500, a search that returns
 * nothing - each of those costs one object out of a dozen and is reported by
 * name, because a flow that silently returns four objects where the user
 * expected twelve is a flow nobody can debug.
 */
export async function planWebObjects(args: PlanWebObjectsArgs): Promise<PlanWebObjectsResult> {
	const report = (stage: AutoObjectStage, ratio: number, message: string) =>
		args.onProgress?.({ stage, ratio, message })

	const count = keywordTargetCount(args.durationMs, args.secondsPerObject)
	report('keywords', 0.02, `Reading ${args.cues.length} lines for ${count} keywords`)

	const local = rankTranscriptKeywords(args.cues)
	let merged = local
	let model: string | null = null
	let notice: string | null = null

	if (args.useAi) {
		const ai = await aiKeywords({ cues: args.cues, count, signal: args.signal })
		merged = mergeKeywords(local, ai.picks, args.cues)
		model = ai.model
		notice = ai.notice
	}

	const keywords = spreadKeywords(merged, {
		count,
		durationMs: args.durationMs,
		// Two objects closer together than one shot's length would overlap, and
		// `tidyShots` would then throw one of them away after it had been
		// downloaded. Spending the constraint here costs nothing.
		minGapMs: Math.max(1_500, (args.shotMs ?? DEFAULT_SHOT_MS) * 0.7),
	})

	if (keywords.length === 0) {
		return {
			shots: [],
			keywords: [],
			misses: [],
			fromLibrary: [],
			photos: [],
			discarded: [],
			director: 'local',
			model,
			notice,
		}
	}

	report('search', 0.12, `Searching the web for ${keywords.length} pictures`)
	let found: ImageSearchResult[] = []
	try {
		const search = await searchObjectImages({
			queries: keywords.map((keyword) => keyword.query),
			perQuery: 4,
			signal: args.signal,
		})
		found = search.results
		if (search.notice) notice = notice ? `${notice} ${search.notice}` : search.notice
	} catch (error) {
		if (args.signal?.aborted) throw error
		throw new Error(
			`The picture search failed: ${error instanceof Error ? error.message : String(error)}. The objects cannot be fetched without it.`,
		)
	}

	// The route tidies a query before it searches - punctuation out, whitespace
	// collapsed, sixty characters - and answers under the tidied spelling. Looking
	// the results up by the word we *sent* would therefore miss every query that
	// needed tidying, and the user would be told the web had no picture of
	// anything. The same tidy is applied here, and the raw spelling is kept as a
	// fallback so the two can never silently disagree.
	const candidatesFor = new Map<string, typeof found[number]['candidates']>()
	for (const result of found) {
		candidatesFor.set(result.query, result.candidates)
		candidatesFor.set(searchableQuery(result.query), result.candidates)
	}
	const shots: ObjectShot[] = []
	const misses: string[] = []
	const fromLibrary: string[] = []
	const photos: string[] = []
	const shotMs = Math.max(600, args.shotMs ?? DEFAULT_SHOT_MS)

	/** Where a shot starts, and how long it stays, given the word's own timing. */
	const windowFor = (atMs: number) => {
		const startMs = Math.max(0, Math.min(atMs, Math.max(0, args.durationMs - 400)))
		return { startMs, endMs: Math.min(startMs + shotMs, args.durationMs || startMs + shotMs) }
	}

	/** Three head widths across, for a sprite of this shape. */
	const scaleFor = (spriteAspect: number) =>
		Math.min(
			1.4,
			Math.max(
				0.05,
				scaleForHeadMultiple({
					multiple: args.headMultiple,
					frameWidth: args.frameWidth,
					frameHeight: args.frameHeight,
					spriteAspect,
				}),
			),
		)

	/** Parks a fetched picture in the vault and puts its shot on the list. */
	const placePicture = async (keyword: PlacedKeyword, picture: DownloadedPicture) => {
		const id = nextId()
		const blobId = await args.storePicture(id, picture.blob, `${keyword.word}.png`)
		const { startMs, endMs } = windowFor(keyword.atMs)

		shots.push({
			id,
			startMs,
			endMs,
			keyword: keyword.word,
			label: picture.candidate.title || keyword.word,
			kind: 'web',
			assetId: null,
			src: URL.createObjectURL(picture.blob),
			blobId,
			credit: picture.candidate.credit,
			sourceUrl: picture.candidate.pageUrl ?? picture.candidate.url,
			scale: scaleFor(picture.width / Math.max(1, picture.height)),
			offsetX: DEFAULT_SHOT_LOOK.offsetX,
			offsetY: DEFAULT_SHOT_LOOK.offsetY,
			opacity: 1,
			motion: DEFAULT_SHOT_LOOK.motion,
		})
		if (picture.fallback) photos.push(keyword.word)
	}

	/** Puts a shape from the studio's own pack on the list, when it has one. */
	const placeFromPack = (keyword: PlacedKeyword): boolean => {
		// Asked twice when the two spellings differ: the pack holds a laptop
		// under "laptop", and a transcript that said ल्यापटप would otherwise be
		// told the studio has no picture of one.
		const pack =
			matchObjectForText(keyword.word) ??
			(keyword.query !== keyword.word ? matchObjectForText(keyword.query) : null)
		if (!pack) return false
		const { startMs, endMs } = windowFor(keyword.atMs)
		shots.push({
			id: nextId(),
			startMs,
			endMs,
			keyword: keyword.word,
			label: pack.asset.label,
			kind: 'library',
			assetId: pack.asset.id,
			src: objectAssetSrc(pack.asset, keyword.word),
			blobId: null,
			credit: null,
			sourceUrl: null,
			// Every file in the pack is a square 512 viewBox.
			scale: scaleFor(1),
			offsetX: DEFAULT_SHOT_LOOK.offsetX,
			offsetY: DEFAULT_SHOT_LOOK.offsetY,
			opacity: 1,
			motion: DEFAULT_SHOT_LOOK.motion,
		})
		fromLibrary.push(keyword.word)
		return true
	}

	/** Words the cut-out pass could not illustrate, kept for the photograph sweep. */
	const pending: PlacedKeyword[] = []

	for (const [index, keyword] of keywords.entries()) {
		if (args.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
		report(
			'pictures',
			0.15 + (index / keywords.length) * 0.63,
			`Fetching “${keyword.word}” (${index + 1} of ${keywords.length})`,
		)

		const candidates =
			candidatesFor.get(keyword.query) ?? candidatesFor.get(searchableQuery(keyword.query)) ?? []
		const picture = await resolveObjectPicture({ candidates, signal: args.signal })
		if (picture) {
			await placePicture(keyword, picture)
			continue
		}

		// The web had no cut-out for this word. Before spending a second search on
		// it, the studio's own pack gets a turn: it only ever matches a word it
		// actually holds a picture of, so a rocket still gets a rocket, and what
		// it holds is already transparent - which is the thing a photograph is
		// not. This is a smaller answer than a photograph, not a wrong one, and it
		// is reported separately so nobody has to guess which they got.
		if (placeFromPack(keyword)) continue
		pending.push(keyword)
	}

	// The last sweep. Every word here has been proven to have no cut-out on any
	// rung of the ladder and no shape in the pack, so the choice left is between
	// a photograph of the right thing and an empty frame - and the photograph
	// wins. It is asked for in one request for all of them, straight at the
	// photograph rung, and `allowPhoto` keeps the best of what comes back with
	// its background and a softened edge. A word that fails even this is a real
	// miss and is named as one.
	if (pending.length > 0 && !args.signal?.aborted) {
		report(
			'photos',
			0.8,
			`Looking for a photograph of ${pending.length} word${pending.length === 1 ? '' : 's'} nothing could cut out`,
		)
		let sweep: ImageSearchResult[] = []
		try {
			const search = await searchObjectImages({
				queries: pending.map((keyword) => keyword.query),
				perQuery: 3,
				mode: 'photo',
				signal: args.signal,
			})
			sweep = search.results
		} catch (error) {
			// A failed last resort is not a failed plan: the words it was for had
			// nothing anyway, and the dozen pictures already fetched are still good.
			if (args.signal?.aborted) throw error
			console.warn('[objects] the photograph sweep failed:', error instanceof Error ? error.message : error)
		}

		const photoCandidatesFor = new Map<string, ImageCandidate[]>()
		for (const result of sweep) {
			photoCandidatesFor.set(result.query, result.candidates)
			photoCandidatesFor.set(searchableQuery(result.query), result.candidates)
		}

		for (const [index, keyword] of pending.entries()) {
			if (args.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
			report(
				'photos',
				0.8 + (index / pending.length) * 0.12,
				`Fetching a photograph of “${keyword.word}” (${index + 1} of ${pending.length})`,
			)
			const candidates =
				photoCandidatesFor.get(keyword.query) ??
				photoCandidatesFor.get(searchableQuery(keyword.query)) ??
				[]
			const picture = candidates.length
				? await resolveObjectPicture({ candidates, allowPhoto: true, signal: args.signal })
				: null
			if (picture) {
				await placePicture(keyword, picture)
				continue
			}
			misses.push(keyword.word)
		}
	} else {
		for (const keyword of pending) misses.push(keyword.word)
	}

	report('plan', 0.95, `Placing ${shots.length} objects`)
	const tidied = tidyShots(shots, {
		minShotMs: 700,
		maxShotMs: Math.max(shotMs, 5_000),
		minGapMs: 300,
		durationMs: args.durationMs,
	})

	// A shot dropped by the tidy pass leaves a picture in the vault with nothing
	// pointing at it. Its address is released here and its id is handed back, so
	// the caller can free the bytes as well.
	const kept = new Set(tidied.map((shot) => shot.id))
	const discarded: string[] = []
	for (const shot of shots) {
		if (kept.has(shot.id)) continue
		discarded.push(shot.id)
		if (shot.src) URL.revokeObjectURL(shot.src)
	}

	return {
		shots: tidied,
		keywords,
		misses,
		fromLibrary,
		photos,
		discarded,
		director: keywords.some((keyword) => keyword.fromAi) && model ? 'ai' : 'local',
		model,
		notice,
	}
}

/** One line describing what the automatic pass did, for the panel to show. */
export function describeAutoPlan(result: PlanWebObjectsResult): string {
	// Counted off the shots that survived the tidy pass rather than off the words
	// that were looked for: a shot dropped for being too short should not be
	// reported as a picture the viewer will see.
	const web = result.shots.filter((shot) => shot.kind === 'web').length
	const pack = result.shots.filter((shot) => shot.kind === 'library').length
	// A photograph is one of the web pictures, so it is named rather than added:
	// counting it twice would make the numbers not add up to the shot list.
	const kept = new Set(result.shots.map((shot) => shot.keyword))
	const asPhotos = result.photos.filter((word) => kept.has(word))
	const parts = [
		`${web} picture${web === 1 ? '' : 's'} from the web`,
		result.director === 'ai' && result.model
			? `keywords by ${result.model.split('/').pop()}`
			: 'keywords ranked locally',
	]
	if (pack > 0) {
		parts.push(
			`${pack} from the studio's own art pack (${result.fromLibrary
				.slice(0, 4)
				.join(', ')})`,
		)
	}
	if (asPhotos.length > 0) {
		parts.push(
			`${asPhotos.length} of them ${
				asPhotos.length === 1 ? 'is a photograph' : 'are photographs'
			} rather than a cut-out (${asPhotos.slice(0, 4).join(', ')}) - nothing transparent exists for ${
				asPhotos.length === 1 ? 'that word' : 'those words'
			}`,
		)
	}
	if (result.misses.length > 0) {
		parts.push(`no picture found at all for ${result.misses.slice(0, 4).join(', ')}`)
	}
	return parts.join(' · ')
}
