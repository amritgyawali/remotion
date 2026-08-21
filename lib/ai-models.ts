export const AI_MODEL_OPTIONS = [
	{
		id: 'auto',
		label: 'Auto - best available',
		description: 'Starts with NVIDIA\'s fast coding model and preserves time for automatic fallbacks.',
	},
	{
		id: 'nvidia/nemotron-3-ultra-550b-a55b',
		label: 'Nemotron 3 Ultra',
		description: 'Frontier reasoning for the most ambitious creative builds.',
	},
	{
		id: 'nvidia/nemotron-3-super-120b-a12b',
		label: 'Nemotron 3 Super',
		description: 'Strong coding, planning and instruction following.',
	},
	{
		id: 'openai/gpt-oss-120b',
		label: 'GPT-OSS 120B',
		description: 'Open reasoning model hosted by NVIDIA NIM.',
	},
	{
		id: 'nvidia/nemotron-3.5-lightning-30b-a3b',
		label: 'Nemotron 3.5 Lightning',
		description: 'Fast long-context coding and iteration.',
	},
	{
		id: 'nvidia/nemotron-3-nano-30b-a3b',
		label: 'Nemotron 3 Nano',
		description: 'Efficient fallback for quick revisions.',
	},
] as const

export type AiModelId = (typeof AI_MODEL_OPTIONS)[number]['id']

export const NVIDIA_MODEL_IDS = AI_MODEL_OPTIONS.filter(
	(option): option is (typeof AI_MODEL_OPTIONS)[number] & { id: Exclude<AiModelId, 'auto'> } =>
		option.id !== 'auto',
).map((option) => option.id)

export const AUTO_MODEL_ORDER: Exclude<AiModelId, 'auto'>[] = [
	'nvidia/nemotron-3.5-lightning-30b-a3b',
	'nvidia/nemotron-3-super-120b-a12b',
	'nvidia/nemotron-3-ultra-550b-a55b',
	'nvidia/nemotron-3-nano-30b-a3b',
	'openai/gpt-oss-120b',
]

export function isAiModelId(value: unknown): value is AiModelId {
	return AI_MODEL_OPTIONS.some((option) => option.id === value)
}
