export const AI_MODEL_OPTIONS = [
	{
		id: 'auto',
		label: 'Auto - best available',
		description: 'Starts with NVIDIA\'s fast coding model and preserves time for automatic fallbacks.',
	},
	{
		id: 'stepfun-ai/step-3.7-flash',
		label: 'Step 3.7 Flash',
		description: 'Fast NVIDIA-hosted coding model for complete creative TSX files.',
	},
	{
		id: 'poolside/laguna-xs-2.1',
		label: 'Laguna XS 2.1',
		description: 'Efficient coding specialist and reliable automatic fallback.',
	},
	{
		id: 'mistralai/mistral-medium-3.5-128b',
		label: 'Mistral Medium 3.5',
		description: 'Strong design, instruction-following and frontend coding model.',
	},
	{
		id: 'nvidia/nemotron-3.5-lightning-30b-a3b',
		label: 'Nemotron 3.5 Lightning',
		description: 'Fast long-context coding and iteration.',
	},
	{
		id: 'minimaxai/minimax-m3',
		label: 'MiniMax M3',
		description: 'Creative design and long-horizon coding model hosted by NVIDIA.',
	},
	{
		id: 'nvidia/nemotron-3-ultra-550b-a55b',
		label: 'Nemotron 3 Ultra',
		description: 'Frontier model for manual high-complexity attempts.',
	},
] as const

export type AiModelId = (typeof AI_MODEL_OPTIONS)[number]['id']

export const NVIDIA_MODEL_IDS = AI_MODEL_OPTIONS.filter(
	(option): option is (typeof AI_MODEL_OPTIONS)[number] & { id: Exclude<AiModelId, 'auto'> } =>
		option.id !== 'auto',
).map((option) => option.id)

export const AUTO_MODEL_ORDER: Exclude<AiModelId, 'auto'>[] = [
	'stepfun-ai/step-3.7-flash',
	'poolside/laguna-xs-2.1',
	'nvidia/nemotron-3.5-lightning-30b-a3b',
]

export function isAiModelId(value: unknown): value is AiModelId {
	return AI_MODEL_OPTIONS.some((option) => option.id === value)
}
