import type {
	CaptionFontId,
	CaptionLayoutOptions,
	CaptionStyle,
	CaptionStylePresetId,
} from './types'

/**
 * The studio ships these families in public/assets/fonts/v1, so a caption looks
 * the same in the preview, in a browser export and on a render host - no font
 * is fetched from the network while frames are being drawn.
 */
export const CAPTION_FONTS: Record<
	CaptionFontId,
	{ family: string; file: string; weight: string; fallback: string; label: string }
> = {
	anton: {
		family: 'Anton',
		file: 'anton/Anton-Regular.ttf',
		weight: '400',
		fallback: 'Impact, Haettenschweiler, sans-serif',
		label: 'Anton - loud social',
	},
	bebasNeue: {
		family: 'Bebas Neue',
		file: 'bebas-neue/BebasNeue-Regular.ttf',
		weight: '400',
		fallback: '"Arial Narrow", sans-serif',
		label: 'Bebas Neue - condensed',
	},
	inter: {
		family: 'Inter',
		file: 'inter/Inter[opsz,wght].ttf',
		weight: '100 900',
		fallback: 'Arial, Helvetica, sans-serif',
		label: 'Inter - neutral',
	},
	archivo: {
		family: 'Archivo',
		file: 'archivo/Archivo[wdth,wght].ttf',
		weight: '100 900',
		fallback: 'Arial, Helvetica, sans-serif',
		label: 'Archivo - editorial',
	},
	oswald: {
		family: 'Oswald',
		file: 'oswald/Oswald[wght].ttf',
		weight: '200 700',
		fallback: '"Arial Narrow", sans-serif',
		label: 'Oswald - news',
	},
	playfairDisplay: {
		family: 'Playfair Display',
		file: 'playfair-display/PlayfairDisplay[wght].ttf',
		weight: '400 900',
		fallback: 'Georgia, "Times New Roman", serif',
		label: 'Playfair - luxury serif',
	},
	spaceGrotesk: {
		family: 'Space Grotesk',
		file: 'space-grotesk/SpaceGrotesk[wght].ttf',
		weight: '300 700',
		fallback: 'Arial, Helvetica, sans-serif',
		label: 'Space Grotesk - technical',
	},
	jetBrainsMono: {
		family: 'JetBrains Mono',
		file: 'jetbrains-mono/JetBrainsMono[wght].ttf',
		weight: '100 800',
		fallback: 'ui-monospace, Consolas, monospace',
		label: 'JetBrains Mono - code',
	},
	nunito: {
		family: 'Nunito',
		file: 'nunito/Nunito[wght].ttf',
		weight: '200 1000',
		fallback: 'Arial, Helvetica, sans-serif',
		label: 'Nunito - friendly',
	},
	caveat: {
		family: 'Caveat',
		file: 'caveat/Caveat[wght].ttf',
		weight: '400 700',
		fallback: '"Comic Sans MS", cursive',
		label: 'Caveat - handwritten',
	},
}

export const CAPTION_FONT_IDS = Object.keys(CAPTION_FONTS) as CaptionFontId[]

export const DEFAULT_LAYOUT: CaptionLayoutOptions = {
	maxWordsPerCue: 4,
	maxCharactersPerCue: 32,
	maxCueDurationMs: 2400,
	splitOnGapMs: 420,
}

const BASE: CaptionStyle = {
	preset: 'tiktok',
	fontId: 'anton',
	fontWeight: 700,
	fontSizePercent: 5.4,
	uppercase: true,
	letterSpacing: 0,
	lineHeight: 1.16,
	textColor: '#ffffff',
	highlight: 'color',
	highlightColor: '#ffe14d',
	highlightTextColor: '#0b0b0b',
	strokeWidth: 10,
	strokeColor: '#000000',
	shadow: 0.55,
	background: 'none',
	backgroundColor: '#000000',
	backgroundOpacity: 0.55,
	placement: 'bottom',
	offsetPercent: 16,
	maxWidthPercent: 82,
	animation: 'pop',
}

export type CaptionPresetDefinition = {
	id: CaptionStylePresetId
	name: string
	tagline: string
	style: CaptionStyle
	layout: CaptionLayoutOptions
}

/**
 * Six finished looks. Every field stays editable afterwards - the preset only
 * decides where the sliders start.
 */
export const CAPTION_PRESETS: CaptionPresetDefinition[] = [
	{
		id: 'tiktok',
		name: 'Social pop',
		tagline: 'Big Anton caps, word pops in, thick outline. Made for 9:16 feeds.',
		style: {
			...BASE,
			preset: 'tiktok',
			fontId: 'anton',
			fontSizePercent: 5.6,
			uppercase: true,
			textColor: '#ffffff',
			highlight: 'scale',
			highlightColor: '#ffe14d',
			strokeWidth: 11,
			strokeColor: '#000000',
			shadow: 0.6,
			animation: 'pop',
			offsetPercent: 17,
		},
		layout: { maxWordsPerCue: 3, maxCharactersPerCue: 24, maxCueDurationMs: 1800, splitOnGapMs: 380 },
	},
	{
		id: 'karaoke',
		name: 'Karaoke fill',
		tagline: 'Whole line stays up, the spoken word lights up in the accent colour.',
		style: {
			...BASE,
			preset: 'karaoke',
			fontId: 'bebasNeue',
			fontWeight: 400,
			fontSizePercent: 5.2,
			uppercase: true,
			letterSpacing: 1,
			highlight: 'color',
			highlightColor: '#4ad4ff',
			strokeWidth: 8,
			shadow: 0.45,
			animation: 'fade',
			offsetPercent: 14,
		},
		layout: { maxWordsPerCue: 6, maxCharactersPerCue: 38, maxCueDurationMs: 2800, splitOnGapMs: 500 },
	},
	{
		id: 'broadcast',
		name: 'Broadcast bar',
		tagline: 'Readable Inter on a translucent bar - documentaries, interviews, ads.',
		style: {
			...BASE,
			preset: 'broadcast',
			fontId: 'inter',
			fontWeight: 600,
			fontSizePercent: 3.9,
			uppercase: false,
			lineHeight: 1.32,
			highlight: 'none',
			highlightColor: '#ffffff',
			strokeWidth: 0,
			shadow: 0.3,
			background: 'block',
			backgroundColor: '#000000',
			backgroundOpacity: 0.62,
			animation: 'fade',
			offsetPercent: 9,
			maxWidthPercent: 76,
		},
		layout: { maxWordsPerCue: 9, maxCharactersPerCue: 46, maxCueDurationMs: 3600, splitOnGapMs: 600 },
	},
	{
		id: 'minimal',
		name: 'Clean minimal',
		tagline: 'No box, no outline. Soft shadow only - product and lifestyle footage.',
		style: {
			...BASE,
			preset: 'minimal',
			fontId: 'archivo',
			fontWeight: 600,
			fontSizePercent: 4.1,
			uppercase: false,
			lineHeight: 1.28,
			highlight: 'color',
			highlightColor: '#ffffff',
			textColor: 'rgba(255,255,255,0.74)',
			strokeWidth: 0,
			shadow: 0.5,
			animation: 'slide',
			offsetPercent: 11,
			maxWidthPercent: 74,
		},
		layout: { maxWordsPerCue: 6, maxCharactersPerCue: 40, maxCueDurationMs: 3000, splitOnGapMs: 520 },
	},
	{
		id: 'neon',
		name: 'Neon glow',
		tagline: 'Space Grotesk with a coloured glow - music, gaming and tech edits.',
		style: {
			...BASE,
			preset: 'neon',
			fontId: 'spaceGrotesk',
			fontWeight: 700,
			fontSizePercent: 4.8,
			uppercase: true,
			letterSpacing: 2,
			textColor: '#ffffff',
			highlight: 'color',
			highlightColor: '#ff5cf0',
			strokeWidth: 4,
			strokeColor: '#2a0044',
			shadow: 1,
			animation: 'pop',
			offsetPercent: 15,
		},
		layout: { maxWordsPerCue: 4, maxCharactersPerCue: 28, maxCueDurationMs: 2000, splitOnGapMs: 420 },
	},
	{
		id: 'boxed',
		name: 'Accent box',
		tagline: 'Each spoken word gets a solid accent block behind it.',
		style: {
			...BASE,
			preset: 'boxed',
			fontId: 'oswald',
			fontWeight: 600,
			fontSizePercent: 4.9,
			uppercase: true,
			highlight: 'box',
			highlightColor: '#ff4d4d',
			highlightTextColor: '#ffffff',
			strokeWidth: 0,
			shadow: 0.4,
			animation: 'slide',
			offsetPercent: 15,
		},
		layout: { maxWordsPerCue: 4, maxCharactersPerCue: 30, maxCueDurationMs: 2200, splitOnGapMs: 440 },
	},
]

export const DEFAULT_CAPTION_STYLE: CaptionStyle = CAPTION_PRESETS[0].style

export function presetById(id: CaptionStylePresetId): CaptionPresetDefinition {
	return CAPTION_PRESETS.find((preset) => preset.id === id) ?? CAPTION_PRESETS[0]
}
