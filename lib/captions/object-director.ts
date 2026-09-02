'use client'

/**
 * Deciding the objects, with the language model when there is one.
 *
 * The keyword matcher in `object-library.ts` is the floor: it is instant, it
 * works offline, and for a sentence that names its object it is already the
 * right answer. What it cannot do is read an implication - "we finally shipped
 * it", "that number doubled", "eight months of work" - because none of those
 * lines contains a keyword, and inventing one would be worse than saying
 * nothing.
 *
 * So this is a two-pass director. The local pass always runs and always
 * produces a usable plan. The model pass, when a key is configured, is handed
 * the same catalogue and asked for at most one asset per line; whatever it
 * returns is merged over the local choices and everything else is kept. If the
 * request fails, is rate limited, or answers with nonsense, the local plan is
 * what ships - the caller is told which of the two it got, and never left
 * without one.
 */

import { OBJECT_LIBRARY, objectAssetById, objectAssetSrc, hashSeed } from './object-library'
import {
	choicesFromCues,
	keywordSalience,
	shotsFromChoices,
	type ChoiceEntry,
	type ObjectChoice,
	type ObjectPlanMode,
	type ObjectShot,
	type PlanObjectsOptions,
} from './object-plan'
import {
	MODEL_KEYWORDS,
	loadModelCatalog,
	matchModelForText,
	modelAssetId,
	type ModelCatalog,
} from './object-models'
import type { CaptionCue } from './types'

export type { ObjectPlanMode } from './object-plan'

export type DirectObjectsArgs = {
	cues: CaptionCue[]
	/** where the clip ends, so nothing is planned past it */
	durationMs: number
	mode: ObjectPlanMode
	/** false skips the model pass entirely - the keyword matcher only */
	useAi: boolean
	signal?: AbortSignal
	look?: PlanObjectsOptions['look']
}

export type DirectObjectsResult = {
	shots: ObjectShot[]
	/** which pass actually chose the objects */
	director: 'ai' | 'local'
	/** the NVIDIA model that answered, when one did */
	model: string | null
	/** why it fell back, when it did - shown in the panel, never swallowed */
	notice: string | null
	/** how many lines the model changed or added on top of the local plan */
	refined: number
}

type PickResponse = {
	picks?: Array<{ line?: unknown; asset?: unknown; word?: unknown }>
	model?: unknown
	notice?: unknown
	error?: unknown
}

/** The catalogue sent to the model: an id, what it is, and the words it means. */
function flatCatalogue(): Array<{ id: string; label: string; about: string }> {
	return OBJECT_LIBRARY.map((asset) => ({
		id: asset.id,
		label: asset.label,
		about: asset.keywords.slice(0, 8).join(', '),
	}))
}

function modelCatalogue(catalog: ModelCatalog): Array<{ id: string; label: string; about: string }> {
	return catalog.families.map((family) => ({
		id: family.id,
		label: family.name,
		about: [...(MODEL_KEYWORDS[family.id] ?? []), ...family.tags].slice(0, 8).join(', '),
	}))
}

function choiceForModelFamily(
	catalog: ModelCatalog,
	familyId: string,
	keyword: string,
	score: number,
): ObjectChoice | null {
	const family = catalog.families.find((entry) => entry.id === familyId)
	if (!family) return null
	const variant = (hashSeed(`${family.id}:${keyword}`) % family.variantCount) + 1
	return {
		kind: 'model3d',
		assetId: modelAssetId(family.id, variant),
		label: family.name,
		keyword,
		src: null,
		// A model is rendered on a square canvas with air around it, so it needs
		// a little more height than a flat sprite to read at the same size.
		scale: 0.46,
		score,
	}
}

/** The local pass for the 3D pack: the same matcher, over the model families. */
function modelChoicesFromCues(cues: CaptionCue[], catalog: ModelCatalog): ChoiceEntry[] {
	const ordered = [...cues].sort((left, right) => left.startMs - right.startMs)
	const salience = keywordSalience(ordered)
	const recent: string[] = []
	return ordered.map((cue) => {
		const match = matchModelForText(cue.text, catalog, new Set(recent.slice(-2)))
		if (!match) return { cue, choice: null }
		recent.push(match.familyId)
		return {
			cue,
			choice: choiceForModelFamily(
				catalog,
				match.familyId,
				match.keyword,
				match.score * (salience.get(match.keyword) ?? 1),
			),
		}
	})
}

/**
 * What a model's pick is worth against a keyword match.
 *
 * A shade above a perfect local match, because the model read the sentence and
 * the matcher only read its words - but multiplied by the same salience, so a
 * pick for a word the video repeats forty times still loses to a pick for one
 * it says once. The model gets the benefit of the doubt, not a free pass.
 */
const AI_CONFIDENCE = 3.5

/**
 * Plans the objects for a transcript.
 *
 * Throws only for a state the user has to fix - asking for 3D models in a
 * checkout where the pack has not been built. Every other failure degrades to
 * the local plan and is reported in `notice`.
 */
export async function directObjects(args: DirectObjectsArgs): Promise<DirectObjectsResult> {
	const catalog = args.mode === 'model3d' ? await loadModelCatalog(args.signal) : null
	if (args.mode === 'model3d' && !catalog) {
		throw new Error(
			'The 3D model pack has not been built in this checkout. Run "npm run assets:3d" to generate it, or plan with the flat object pack instead.',
		)
	}

	const entries = catalog ? modelChoicesFromCues(args.cues, catalog) : choicesFromCues(args.cues)
	const planOptions: PlanObjectsOptions = { durationMs: args.durationMs, look: args.look }

	if (!args.useAi || entries.length === 0) {
		return {
			shots: shotsFromChoices(entries, planOptions),
			director: 'local',
			model: null,
			notice: null,
			refined: 0,
		}
	}

	const lines = entries.map((entry) => entry.cue.text)
	let response: PickResponse | null = null
	let failure: string | null = null

	try {
		const request = await fetch('/api/captions/objects', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				lines,
				catalogue: catalog ? modelCatalogue(catalog) : flatCatalogue(),
			}),
			signal: args.signal,
		})
		response = (await request.json()) as PickResponse
		if (!request.ok) {
			failure = typeof response?.error === 'string' ? response.error : `The planner returned HTTP ${request.status}.`
			response = null
		}
	} catch (error) {
		if (args.signal?.aborted) throw error
		failure = error instanceof Error ? error.message : 'The object planner could not be reached.'
	}

	const picks = Array.isArray(response?.picks) ? response.picks : []
	const salience = keywordSalience(entries.map((entry) => entry.cue))
	let refined = 0

	for (const pick of picks) {
		const index = typeof pick.line === 'number' ? Math.round(pick.line) : -1
		const assetId = typeof pick.asset === 'string' ? pick.asset : ''
		const entry = entries[index]
		if (!entry || !assetId) continue

		const keyword = typeof pick.word === 'string' && pick.word ? pick.word : entry.cue.text.split(/\s+/)[0] ?? ''
		const score = AI_CONFIDENCE * (salience.get(keyword.toLowerCase()) ?? 1)
		const choice = catalog
			? choiceForModelFamily(catalog, assetId, keyword, score)
			: (() => {
					const asset = objectAssetById(assetId)
					return asset
						? {
								kind: 'library' as const,
								assetId: asset.id,
								label: asset.label,
								keyword,
								src: objectAssetSrc(asset, keyword),
								scale: asset.scale,
								score,
							}
						: null
				})()
		if (!choice) continue

		if (entry.choice?.assetId !== choice.assetId) refined++
		entry.choice = choice
	}

	const notice = typeof response?.notice === 'string' ? response.notice : failure
	const model = typeof response?.model === 'string' ? response.model : null

	return {
		shots: shotsFromChoices(entries, planOptions),
		director: refined > 0 && model ? 'ai' : 'local',
		model,
		notice,
		refined,
	}
}
