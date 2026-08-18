/**
 * AI CAPTION TEMPLATE - a complete, single-file handoff for burned-in subtitles.
 *
 * HOW THE USER USES THIS FILE
 * 1. Download this file from Remotion Video Studio's Subtitle Studio
 *    (/captions -> "AI template").
 * 2. Get a transcript with timestamps for your video. The best source is this
 *    studio's own Subtitle Studio: upload your video, use Auto (on-device
 *    Whisper) or Write, then download the .srt. Word-level timing is a plain
 *    .srt does not carry, but the AI EDITING CONTRACT below tells the model
 *    how to add it back deterministically from the text alone.
 * 3. Attach this file AND your transcript to an AI coding assistant, together
 *    with your video's address (a public https:// URL or a staticFile path),
 *    its width/height/fps, and the caption look you want.
 * 4. Ask the AI to follow the contract below and return ONE complete .tsx file.
 * 5. Upload the returned file into Remotion Video Studio, preview it against
 *    your real video, and render.
 *
 * COPY-PASTE PROMPT FOR THE USER
 * "Follow the AI EDITING CONTRACT in the attached ai-caption-template.tsx.
 * My video is at [VIDEO_SRC - a public https:// URL, or staticFile('name.mp4')
 * if I will upload the file alongside], [WIDTH]x[HEIGHT] at [FPS] fps,
 * [DURATION] seconds long. Here is the transcript (paste an .srt/.vtt if you
 * have one - with timestamps - otherwise paste plain text and let the AI time
 * it): [PASTE TRANSCRIPT]. Spoken language(s): [e.g. English / Nepali /
 * Nepali+English code-switched]. Caption style: [e.g. bold social captions
 * with word-by-word highlight in yellow, bottom-third, Anton font / clean
 * broadcast subtitles on a translucent bar, Inter font / karaoke-style with
 * the current word glowing]. Return one complete runnable .tsx file, not a
 * diff or explanation."
 *
 * --------------------------------------------------------------------------
 * AI EDITING CONTRACT - AI MUST READ BEFORE CHANGING THIS FILE
 * --------------------------------------------------------------------------
 * [AI: EDIT] VIDEO_SRC. Use the address the user gave you exactly. If it is a
 * bare filename with no scheme, wrap it in staticFile('...') so it resolves
 * against the uploaded project; if it is a full https:// URL, use it as a
 * plain string. Never invent a placeholder video URL.
 *
 * [AI: EDIT] TIMELINE. Set width, height and fps from what the user told you
 * (default to 1080x1920 @ 30fps - vertical social - only if they gave you
 * nothing). Set durationInFrames = Math.round(videoDurationSeconds * fps),
 * rounding UP by a frame or two rather than down, so the last caption is never
 * truncated a frame early.
 *
 * [AI: EDIT] CAPTIONS - build this array from the user's transcript:
 *   - If they pasted an .srt or .vtt, use its start/end timestamps directly
 *     (convert "00:01:02,340" -> milliseconds) and put the block's full text
 *     in `text`.
 *   - If they pasted plain text with no timestamps, split it into short
 *     phrases (aim for 3-8 words or under ~40 characters per cue - never a
 *     whole sentence in one cue) and spread them across the stated video
 *     duration proportional to each phrase's syllable count, leaving small
 *     gaps between cues. State in your reply that timing is estimated and the
 *     user should nudge it once they see the render.
 *   - ALWAYS fill `tokens`: one entry per word with its own fromMs/toMs inside
 *     the cue's [startMs, endMs) span, proportional to word length (a
 *     Devanagari/Nepali word's *visible* length - see wordWidth() below, not
 *     its raw character count, since combining marks don't take extra room).
 *     Every caption technique in this file (word highlight, balanced line
 *     breaks) depends on tokens existing and being in order.
 *   - Never leave a gap in TIME longer than ~4s with no caption during spoken
 *     audio the user described - if the transcript has a pause, either close
 *     the gap between neighbouring cues' end/start or leave it empty; do not
 *     stretch a cue's text to cover silence it doesn't describe.
 *
 * [AI: EDIT] CAPTION_STYLE - the single object every visual choice reads from.
 * Set it once for the whole video from the user's stated look:
 *   - fontId: pick ONE id from FONT_KIT below that matches the mood (Anton for
 *     loud social hooks, Bebas Neue for condensed titles, Inter/Archivo for
 *     clean broadcast, Oswald for news/documentary, Space Grotesk for tech,
 *     JetBrains Mono only for code/data captions).
 *   - devanagari: true the instant the transcript contains ANY Devanagari
 *     character (Nepali, Hindi, ...) - false only for pure Latin/other-script
 *     transcripts. Getting this wrong renders Nepali words as empty boxes.
 *   - reveal: 'word' for the social/TikTok look (each word pops in on its own
 *     timestamp), 'line' for broadcast/documentary (the whole line arrives at
 *     once, the spoken word is only marked, not separately animated).
 *   - highlight: how the word being spoken is marked - 'color' (recolour),
 *     'scale' (pop bigger), 'box' (solid background block), or 'none'.
 *   - placement + offsetPercent: where the caption sits and how far from that
 *     edge, as a percentage of the frame height. 'bottom' at ~14-18% is the
 *     safe default for vertical video (stays clear of platform UI chrome).
 *   - scrim: 0.15-0.3 for footage with a bright or busy background so white
 *     text stays legible; 0 for footage that is already dark or has its own
 *     lower-third card.
 *   - maxLines: 1 for punchy short phrases, 2 for most social captions, up to
 *     3 for slower broadcast-style lines.
 * Do not invent new CaptionStyle fields; every one already used below is the
 * complete set this rendering engine understands.
 *
 * [AI: KEEP] Return one self-contained TSX file with no TODOs, pseudocode,
 * missing pieces, diffs, or explanatory prose outside code comments.
 *
 * [AI: KEEP] Imports supported by this studio are: react, remotion,
 * @remotion/media, @remotion/fonts, @remotion/captions. Do not invent npm
 * packages, do not import @remotion/player (that is the preview harness, not
 * part of an uploaded composition), and do not use Tailwind or framer-motion.
 *
 * [AI: KEEP] The video layer is <Video src={...} objectFit="cover"> imported
 * from '@remotion/media' - never the legacy remotion <Video>/<OffthreadVideo>,
 * which the browser exporter cannot rasterise reliably.
 *
 * [AI: KEEP] Every family this file can load lives in the self-hosted OFL kit
 * under /assets/fonts/v1/ (see FONT_KIT and DEVANAGARI_FONT_KIT below). Load
 * fonts ONLY with loadFont() from '@remotion/fonts' pointed at staticFile(...)
 * - never a Google Fonts URL or any other network font at render time; a
 * render host without internet access must produce the exact same frame as
 * the preview. loadFont() holds the render open until the face is parsed, so
 * never delete that call for a family you reference in CAPTION_STYLE.
 *
 * [AI: KEEP] Keep balanceLines(), wordWidth(), CaptionScrim, CaptionWord and
 * CueLayer exactly as they are - this is the actual rendering engine (word
 * timing highlight, script-aware balanced line breaking, the legibility
 * scrim, two-layer contact+lift shadow) and reimplementing it from scratch is
 * how captions regress to plain wrapped text with no highlight. Only
 * CAPTIONS, CAPTION_STYLE, VIDEO_SRC and TIMELINE should actually change for
 * a normal request. If the user explicitly asks for a fundamentally different
 * visual system (e.g. a chat-bubble caption card, a typewriter effect with no
 * per-word highlight), you may add a new alternate cue renderer, but keep this
 * one available and keep every deterministic-animation and font-loading rule
 * above.
 *
 * [AI: KEEP] All animation must be deterministic and frame-driven with
 * useCurrentFrame(), interpolate() and spring() - never CSS keyframes or
 * transitions, Date.now(), or Math.random(). The same frame number must always
 * render identical pixels, in the preview and in every render.
 *
 * [AI: KEEP] Preserve the hook-free Root, the explicit <Composition>,
 * registerRoot(Root), and the default export. Update width, height, fps and
 * durationInFrames to match TIMELINE, and keep defaultProps wired to
 * VIDEO_SRC / CAPTIONS / CAPTION_STYLE so the studio preview and a manual
 * Remotion Studio session see the same thing.
 *
 * FINAL AI CHECK BEFORE RETURNING THE FILE
 * - One complete TSX file; only the supported imports are used.
 * - Every cue has non-empty `tokens` covering its full text, in time order,
 *   with no zero-length or overlapping tokens inside one cue.
 * - CAPTION_STYLE.devanagari is true if and only if the transcript actually
 *   contains Devanagari characters.
 * - The chosen fontId (and devanagariFontId, if devanagari is on) is loaded
 *   with loadFont() exactly once each, from FONT_KIT / DEVANAGARI_FONT_KIT.
 * - No caption's text overflows CAPTION_STYLE.maxWidthPercent at
 *   CAPTION_STYLE.maxLines - if it would, either shorten that cue's phrase or
 *   raise maxLines slightly; never let balanceLines() silently overflow.
 * - Composition width/height/fps/durationInFrames match TIMELINE and the
 *   stated video duration; the very last cue ends before durationInFrames.
 *
 * EDIT MAP
 * 0. KIT       -> FONT_KIT, DEVANAGARI_FONT_KIT (what you can load)
 * 1. DATA      -> VIDEO_SRC, TIMELINE, CAPTIONS (the transcript, timed)
 * 2. STYLE     -> CAPTION_STYLE (the one object every visual choice reads)
 * 3. ENGINE    -> balanceLines, CaptionScrim, CaptionWord, CueLayer (keep)
 * 4. RENDER    -> CaptionedVideo, Root, registerRoot, default export
 */

import {
	AbsoluteFill,
	Composition,
	Sequence,
	interpolate,
	registerRoot,
	spring,
	staticFile,
	useCurrentFrame,
	useVideoConfig,
} from 'remotion'
import { useMemo } from 'react'
import { Video } from '@remotion/media'
import { loadFont } from '@remotion/fonts'

/* -------------------------------------------------------------------------- */
/*  TYPOGRAPHY KIT [AI: KEEP THE LOADER; PICK ids FOR THE SUBJECT]            */
/* -------------------------------------------------------------------------- */

const fontAsset = (relativePath: string) => staticFile(`assets/fonts/v1/${relativePath}`)

/** Self-hosted SIL Open Font License families - nothing is fetched at render time. */
export const FONT_KIT = {
	anton: { family: 'Anton', file: 'anton/Anton-Regular.ttf', weight: '400', fallback: 'Impact, Haettenschweiler, sans-serif', use: 'loud social hooks, TikTok/Reels captions' },
	bebasNeue: { family: 'Bebas Neue', file: 'bebas-neue/BebasNeue-Regular.ttf', weight: '400', fallback: '"Arial Narrow", sans-serif', use: 'condensed titles and lower thirds' },
	inter: { family: 'Inter', file: 'inter/Inter[opsz,wght].ttf', weight: '100 900', fallback: 'Arial, Helvetica, sans-serif', use: 'clean broadcast and interview subtitles' },
	archivo: { family: 'Archivo', file: 'archivo/Archivo[wdth,wght].ttf', weight: '100 900', fallback: 'Arial, Helvetica, sans-serif', use: 'editorial, minimal captions' },
	oswald: { family: 'Oswald', file: 'oswald/Oswald[wght].ttf', weight: '200 700', fallback: '"Arial Narrow", sans-serif', use: 'news, sport and documentary overlays' },
	spaceGrotesk: { family: 'Space Grotesk', file: 'space-grotesk/SpaceGrotesk[wght].ttf', weight: '300 700', fallback: 'Arial, Helvetica, sans-serif', use: 'technical, gaming, AI and product content' },
	jetBrainsMono: { family: 'JetBrains Mono', file: 'jetbrains-mono/JetBrainsMono[wght].ttf', weight: '100 800', fallback: 'ui-monospace, Consolas, monospace', use: 'code, data or timestamp captions only' },
} as const

/**
 * Devanagari companion families - Nepali or Hindi text set only in a Latin
 * face above renders as tofu boxes. Load one of these alongside the chosen
 * FONT_KIT entry whenever CAPTION_STYLE.devanagari is true.
 */
export const DEVANAGARI_FONT_KIT = {
	notoSansDevanagari: { family: 'Noto Sans Devanagari', file: 'noto-sans-devanagari/NotoSansDevanagari[wdth,wght].ttf', weight: '100 900', use: 'complete, highly legible - the default choice' },
	anekDevanagari: { family: 'Anek Devanagari', file: 'anek-devanagari/AnekDevanagari[wdth,wght].ttf', weight: '100 800', use: 'condensed, display-ready - loud Nepali hooks' },
} as const

type FontId = keyof typeof FONT_KIT
type DevanagariFontId = keyof typeof DEVANAGARI_FONT_KIT

/* -------------------------------------------------------------------------- */
/*  DATA [AI: EDIT - VIDEO_SRC, TIMELINE, CAPTIONS]                           */
/* -------------------------------------------------------------------------- */

/**
 * The video being captioned. A bare filename resolves against the uploaded
 * project via staticFile(); a full https:// URL is used as-is. Replace this
 * placeholder with the address the user gave you.
 */
export const VIDEO_SRC = staticFile('your-video.mp4')

export const TIMELINE = {
	id: 'CaptionedVideo',
	width: 1080,
	height: 1920,
	fps: 30,
	durationInFrames: 300, // 10s example - replace with the real video length in frames
}

export type CaptionToken = { text: string; fromMs: number; toMs: number }
export type CaptionCue = { id: string; text: string; startMs: number; endMs: number; tokens: CaptionToken[] }

/**
 * DEMO DATA - replace entirely with cues built from the user's transcript,
 * following the AI EDITING CONTRACT above. This shows the required shape: one
 * object per on-screen line, word-level `tokens` covering the whole span.
 */
export const CAPTIONS: CaptionCue[] = [
	{
		id: 'cue-1',
		text: 'Welcome to the video',
		startMs: 200,
		endMs: 1700,
		tokens: [
			{ text: 'Welcome', fromMs: 200, toMs: 700 },
			{ text: 'to', fromMs: 700, toMs: 900 },
			{ text: 'the', fromMs: 900, toMs: 1100 },
			{ text: 'video', fromMs: 1100, toMs: 1700 },
		],
	},
	{
		id: 'cue-2',
		text: 'नमस्ते! यो caption को demo हो',
		startMs: 1900,
		endMs: 3800,
		tokens: [
			{ text: 'नमस्ते!', fromMs: 1900, toMs: 2400 },
			{ text: 'यो', fromMs: 2400, toMs: 2650 },
			{ text: 'caption', fromMs: 2650, toMs: 3150 },
			{ text: 'को', fromMs: 3150, toMs: 3350 },
			{ text: 'demo', fromMs: 3350, toMs: 3600 },
			{ text: 'हो', fromMs: 3600, toMs: 3800 },
		],
	},
]

export type CaptionStyle = {
	fontId: FontId
	fontWeight: number
	/** cap height as a percentage of the composition height, 2 - 12 */
	fontSizePercent: number
	uppercase: boolean
	letterSpacing: number
	lineHeight: number
	textColor: string
	highlight: 'color' | 'scale' | 'box' | 'none'
	highlightColor: string
	/** text colour inside the highlight box, box mode only */
	highlightTextColor: string
	/** outline thickness as a percentage of the font size, 0 - 20 */
	strokeWidth: number
	strokeColor: string
	/** drop shadow strength, 0 - 1 */
	shadow: number
	background: 'none' | 'pill' | 'block'
	backgroundColor: string
	backgroundOpacity: number
	placement: 'top' | 'center' | 'bottom'
	/** distance from the chosen edge, percentage of composition height */
	offsetPercent: number
	/** caption block width, percentage of composition width */
	maxWidthPercent: number
	animation: 'pop' | 'fade' | 'slide' | 'none'
	/** 'word' pops each word in on its own timestamp; 'line' reveals the whole line at once */
	reveal: 'word' | 'line'
	/** how many balanced lines one caption may occupy, 1 - 3 */
	maxLines: number
	/** darkening behind the caption zone for legibility on bright footage, 0 - 1 */
	scrim: number
	/** load a Devanagari companion face - turn on when the transcript contains Devanagari */
	devanagari: boolean
	devanagariFontId: DevanagariFontId
}

/**
 * DEMO STYLE - a bold social-caption look. Replace every field from the
 * user's description; every field here is read by CueLayer/CaptionWord below.
 */
export const CAPTION_STYLE: CaptionStyle = {
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
	reveal: 'word',
	maxLines: 2,
	scrim: 0.18,
	devanagari: true,
	devanagariFontId: 'notoSansDevanagari',
}

/* -------------------------------------------------------------------------- */
/*  ENGINE [AI: KEEP - this is what makes captions read well, not plain text] */
/* -------------------------------------------------------------------------- */

const font = FONT_KIT[CAPTION_STYLE.fontId]
loadFont({ family: font.family, url: fontAsset(font.file), weight: font.weight })

const devanagariFont = CAPTION_STYLE.devanagari ? DEVANAGARI_FONT_KIT[CAPTION_STYLE.devanagariFontId] : null
if (devanagariFont) {
	loadFont({ family: devanagariFont.family, url: fontAsset(devanagariFont.file), weight: devanagariFont.weight })
}

// Latin face first, Devanagari companion second: the browser resolves the
// family per character, so a mixed line stays in one visual voice.
const FONT_STACK = [
	`'${font.family}'`,
	...(devanagariFont ? [`'${devanagariFont.family}'`] : []),
	font.fallback,
].join(', ')

const withAlpha = (color: string, alpha: number): string => {
	const hex = color.trim()
	if (!hex.startsWith('#')) return hex
	const value = hex.length === 4 ? hex.slice(1).split('').map((c) => c + c).join('') : hex.slice(1)
	const int = parseInt(value, 16)
	return `rgba(${(int >> 16) & 255}, ${(int >> 8) & 255}, ${int & 255}, ${alpha})`
}

const justifyFor = (placement: CaptionStyle['placement']): 'flex-start' | 'center' | 'flex-end' =>
	placement === 'top' ? 'flex-start' : placement === 'center' ? 'center' : 'flex-end'

/**
 * Devanagari matras, anusvara, virama and joiners stack on the consonant they
 * belong to instead of taking their own horizontal room. Counting them as
 * characters would make "छेउ" look as wide as a five-letter English word and
 * leave Nepali captions ragged - this strips them before measuring.
 */
const DEVANAGARI_COMBINING = /[\u0900-\u0902\u093A-\u094F\u0951-\u0957\u0962\u0963\u200C\u200D]/g
const wordWidth = (text: string): number => text.replace(DEVANAGARI_COMBINING, '').length

/**
 * Balanced line breaking. Plain wrapping fills the first row and drops
 * whatever's left onto the second, which is how captions end up as five words
 * above one lonely word. This binary-searches the narrowest "widest row" that
 * still fits the caption in maxLines, then packs greedily at that width - the
 * classic linear partition, and what a typesetter does by eye.
 */
const balanceLines = (tokens: CaptionToken[], maxLines: number): CaptionToken[][] => {
	const limit = Math.max(1, Math.min(3, Math.round(maxLines)))
	if (limit === 1 || tokens.length < 2) return [tokens]

	const widths = tokens.map((token) => wordWidth(token.text))

	const pack = (maxWidth: number): CaptionToken[][] | null => {
		const lines: CaptionToken[][] = []
		let current: CaptionToken[] = []
		let used = 0
		for (let index = 0; index < tokens.length; index++) {
			const cost = widths[index] + (current.length > 0 ? 1 : 0)
			if (current.length > 0 && used + cost > maxWidth) {
				lines.push(current)
				current = []
				used = 0
			}
			used += widths[index] + (current.length > 0 ? 1 : 0)
			current.push(tokens[index])
		}
		if (current.length > 0) lines.push(current)
		return lines.length <= limit ? lines : null
	}

	let low = Math.max(...widths)
	let high = widths.reduce((sum, width) => sum + width + 1, 0)
	let best = pack(high) ?? [tokens]
	while (low <= high) {
		const middle = Math.floor((low + high) / 2)
		const attempt = pack(middle)
		if (attempt) {
			best = attempt
			high = middle - 1
		} else {
			low = middle + 1
		}
	}
	return best
}

/**
 * A gradient wash under the caption zone that fades in with the captions
 * rather than sitting on the footage the whole time - the fix for white type
 * disappearing over sky, snow or a bright, busy background.
 */
const CaptionScrim = ({ captions, style }: { captions: CaptionCue[]; style: CaptionStyle }) => {
	const frame = useCurrentFrame()
	const { fps } = useVideoConfig()
	const timeMs = (frame / fps) * 1000

	let distance = 100000
	for (const cue of captions) {
		const gap = timeMs < cue.startMs ? cue.startMs - timeMs : timeMs > cue.endMs ? timeMs - cue.endMs : 0
		if (gap < distance) distance = gap
		if (distance === 0) break
	}

	const opacity = interpolate(distance, [0, 260], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
	if (opacity <= 0) return null

	const full = withAlpha('#000000', style.scrim)
	const soft = withAlpha('#000000', style.scrim * 0.72)
	const clear = 'rgba(0, 0, 0, 0)'
	const gradient =
		style.placement === 'center'
			? `linear-gradient(to top, ${clear} 16%, ${full} 42%, ${full} 58%, ${clear} 84%)`
			: `linear-gradient(to ${style.placement === 'top' ? 'bottom' : 'top'}, ${full} 0%, ${soft} 18%, ${clear} 48%)`

	return <AbsoluteFill style={{ background: gradient, opacity }} />
}

type WordMetrics = { fontSize: number; strokeWidth: number; dropShadow: string }

const CaptionWord = ({
	token,
	cueStartMs,
	timeMs,
	lineEntrance,
	style,
	metrics,
}: {
	token: CaptionToken
	cueStartMs: number
	timeMs: number
	lineEntrance: number
	style: CaptionStyle
	metrics: WordMetrics
}) => {
	const frame = useCurrentFrame()
	const { fps } = useVideoConfig()

	// Word reveal: each word arrives on its own timestamp while the row keeps
	// its full layout, so the line never re-centres itself mid-sentence.
	const byWord = style.reveal === 'word'
	const startFrame = Math.round(((token.fromMs - cueStartMs) / 1000) * fps)
	const wordFrame = frame - startFrame
	const entrance = byWord
		? wordFrame < 0
			? 0
			: spring({ frame: wordFrame, fps, config: { damping: 200, mass: 0.4, stiffness: 220 }, durationInFrames: 7 })
		: lineEntrance

	const active = timeMs >= token.fromMs && timeMs < token.toMs
	const marked = active && style.highlight !== 'none'
	const boxed = marked && style.highlight === 'box'
	const popped = marked && style.highlight === 'scale'

	const scale = (byWord ? 0.86 + entrance * 0.14 : 1) * (popped ? 1.11 : 1)
	const rise = byWord ? (1 - entrance) * metrics.fontSize * 0.28 : 0

	return (
		<span
			style={{
				display: 'inline-block',
				opacity: byWord ? entrance : 1,
				color: boxed ? style.highlightTextColor : marked ? style.highlightColor : style.textColor,
				backgroundColor: boxed ? style.highlightColor : 'transparent',
				padding: boxed ? `0 ${metrics.fontSize * 0.16}px` : 0,
				borderRadius: metrics.fontSize * 0.16,
				transform: `translateY(${rise.toFixed(2)}px) scale(${scale.toFixed(3)})`,
				WebkitTextStroke: metrics.strokeWidth > 0 ? `${metrics.strokeWidth.toFixed(2)}px ${style.strokeColor}` : undefined,
				// Stroke under fill: the default paint order eats into the letterform
				// and thins out every glyph at social-video outline weights.
				paintOrder: 'stroke fill',
				textShadow: metrics.dropShadow || 'none',
			}}
		>
			{token.text}
		</span>
	)
}

const CueLayer = ({ cue, style }: { cue: CaptionCue; style: CaptionStyle }) => {
	const frame = useCurrentFrame()
	const { fps, height } = useVideoConfig()

	// Inside a <Sequence> the frame is cue-relative, so the absolute media time
	// is the cue start plus however far we are into the cue.
	const timeMs = cue.startMs + (frame / fps) * 1000
	const cueFrames = Math.max(1, Math.round(((cue.endMs - cue.startMs) / 1000) * fps))
	const lines = useMemo(() => balanceLines(cue.tokens, style.maxLines), [cue.tokens, style.maxLines])

	const entrance = spring({ frame, fps, config: { damping: 200, mass: 0.5, stiffness: 180 }, durationInFrames: Math.min(9, cueFrames) })
	const exitFrom = Math.max(1, cueFrames - 4)
	const exitTo = Math.max(exitFrom + 1, cueFrames)
	const exit = interpolate(frame, [exitFrom, exitTo], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })

	// With a word reveal the words carry their own entrance; the block only
	// handles the exit, otherwise every word would fade in twice.
	const byWord = style.reveal === 'word'
	const animated = style.animation !== 'none'
	// The fade starts at 0.35, not 0: a caption that is fully transparent on
	// its own first frame reads as a flicker, or as missing when the preview
	// is parked on that exact frame.
	const fadeIn = interpolate(frame, [0, Math.min(3, cueFrames)], [0.35, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
	const opacity = byWord ? exit : animated ? Math.min(fadeIn, exit) : 1
	const scale = !byWord && style.animation === 'pop' ? 0.82 + entrance * 0.18 : 1
	const translateY = !byWord && style.animation === 'slide' ? (1 - entrance) * height * 0.045 : 0

	const fontSize = (height * style.fontSizePercent) / 100
	const metrics: WordMetrics = {
		fontSize,
		strokeWidth: (fontSize * style.strokeWidth) / 100,
		// Two shadows, not one: the tight contact shadow anchors the type to the
		// picture, the wide one lifts it off whatever is moving behind it.
		dropShadow:
			style.shadow > 0
				? `0 ${(fontSize * 0.035).toFixed(1)}px ${(fontSize * 0.07).toFixed(1)}px ${withAlpha('#000000', Math.min(1, style.shadow * 1.1))}, 0 ${(fontSize * 0.09).toFixed(1)}px ${(fontSize * 0.3).toFixed(1)}px ${withAlpha('#000000', style.shadow * 0.7)}`
				: '',
	}

	return (
		<AbsoluteFill
			style={{
				display: 'flex',
				flexDirection: 'column',
				alignItems: 'center',
				justifyContent: justifyFor(style.placement),
				paddingTop: style.placement === 'top' ? (height * style.offsetPercent) / 100 : 0,
				paddingBottom: style.placement === 'bottom' ? (height * style.offsetPercent) / 100 : 0,
			}}
		>
			<div
				style={{
					display: 'flex',
					flexDirection: 'column',
					alignItems: 'center',
					rowGap: fontSize * (style.lineHeight - 1),
					maxWidth: `${style.maxWidthPercent}%`,
					padding: style.background === 'none' ? 0 : `${fontSize * 0.26}px ${fontSize * 0.5}px`,
					borderRadius: style.background === 'pill' ? fontSize * 1.2 : fontSize * 0.2,
					backgroundColor: style.background === 'none' ? 'transparent' : withAlpha(style.backgroundColor, style.backgroundOpacity),
					opacity,
					transform: `translateY(${translateY.toFixed(2)}px) scale(${scale.toFixed(3)})`,
					fontFamily: FONT_STACK,
					fontWeight: style.fontWeight,
					fontSize,
					lineHeight: style.lineHeight,
					letterSpacing: style.letterSpacing,
					textTransform: style.uppercase ? 'uppercase' : 'none',
					textAlign: 'center',
				}}
			>
				{lines.map((line, lineIndex) => (
					<div
						key={`${cue.id}-line-${lineIndex}`}
						style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', columnGap: fontSize * 0.24, rowGap: fontSize * 0.1 }}
					>
						{line.map((token, tokenIndex) => (
							<CaptionWord
								key={`${cue.id}-${lineIndex}-${tokenIndex}`}
								token={token}
								cueStartMs={cue.startMs}
								timeMs={timeMs}
								lineEntrance={entrance}
								style={style}
								metrics={metrics}
							/>
						))}
					</div>
				))}
			</div>
		</AbsoluteFill>
	)
}

/* -------------------------------------------------------------------------- */
/*  RENDER [AI: KEEP the shape; TIMELINE/CAPTIONS/CAPTION_STYLE drive it all] */
/* -------------------------------------------------------------------------- */

export const CaptionedVideo = ({
	src = VIDEO_SRC,
	captions = CAPTIONS,
	captionStyle = CAPTION_STYLE,
}: {
	src?: string
	captions?: CaptionCue[]
	captionStyle?: CaptionStyle
}) => {
	const { fps } = useVideoConfig()

	return (
		<AbsoluteFill style={{ backgroundColor: '#000000' }}>
			<Video src={src} objectFit="cover" style={{ width: '100%', height: '100%' }} />

			{captionStyle.scrim > 0 && captions.length > 0 ? (
				<CaptionScrim captions={captions} style={captionStyle} />
			) : null}

			{captions.map((cue) => {
				const from = Math.max(0, Math.round((cue.startMs / 1000) * fps))
				const durationInFrames = Math.max(1, Math.round((cue.endMs / 1000) * fps) - from)
				return (
					<Sequence key={cue.id} from={from} durationInFrames={durationInFrames} name={cue.text.slice(0, 24)} layout="none">
						<CueLayer cue={cue} style={captionStyle} />
					</Sequence>
				)
			})}
		</AbsoluteFill>
	)
}

const Root = () => (
	<Composition
		id={TIMELINE.id}
		component={CaptionedVideo}
		width={TIMELINE.width}
		height={TIMELINE.height}
		fps={TIMELINE.fps}
		durationInFrames={TIMELINE.durationInFrames}
		defaultProps={{ src: VIDEO_SRC, captions: CAPTIONS, captionStyle: CAPTION_STYLE }}
	/>
)

registerRoot(Root)

export default CaptionedVideo
