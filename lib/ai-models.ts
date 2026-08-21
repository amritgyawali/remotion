/**
 * NVIDIA-hosted models the AI director can use.
 *
 * They plan a compact JSON storyboard - the Studio composes the Remotion TSX
 * itself - so speed and instruction following matter far more than raw coding
 * ability, and every model here can answer well inside one request.
 */

export const AI_MODEL_OPTIONS = [
	{
		id: 'auto',
		label: 'Auto - best available',
		description: 'Fastest planner first, then automatic fallbacks, then the local Studio director.',
	},
	{
		id: 'nvidia/nemotron-3.5-lightning-30b-a3b',
		label: 'Nemotron 3.5 Lightning',
		description: 'Quickest storyboards. Best default for iterating on an idea.',
	},
	{
		id: 'stepfun-ai/step-3.7-flash',
		label: 'Step 3.7 Flash',
		description: 'Fast and structured. Strong at scene breakdowns and copywriting.',
	},
	{
		id: 'mistralai/mistral-medium-3.5-128b',
		label: 'Mistral Medium 3.5',
		description: 'Richer art direction and sharper on-screen copy.',
	},
	{
		id: 'minimaxai/minimax-m3',
		label: 'MiniMax M3',
		description: 'Creative concepts and unusual scene orders.',
	},
	{
		id: 'poolside/laguna-xs-2.1',
		label: 'Laguna XS 2.1',
		description: 'Efficient specialist. Occasionally rate limited on the free tier.',
	},
	{
		id: 'nvidia/nemotron-3-ultra-550b-a55b',
		label: 'Nemotron 3 Ultra',
		description: 'Frontier model for the most demanding briefs. Slowest option.',
	},
] as const

export type AiModelId = (typeof AI_MODEL_OPTIONS)[number]['id']

export const NVIDIA_MODEL_IDS = AI_MODEL_OPTIONS.filter(
	(option): option is (typeof AI_MODEL_OPTIONS)[number] & { id: Exclude<AiModelId, 'auto'> } =>
		option.id !== 'auto',
).map((option) => option.id)

/** Ordered fastest-first so the automatic fallbacks all fit in one request. */
export const AUTO_MODEL_ORDER: Exclude<AiModelId, 'auto'>[] = [
	'nvidia/nemotron-3.5-lightning-30b-a3b',
	'stepfun-ai/step-3.7-flash',
	'mistralai/mistral-medium-3.5-128b',
]

export function isAiModelId(value: unknown): value is AiModelId {
	return AI_MODEL_OPTIONS.some((option) => option.id === value)
}
