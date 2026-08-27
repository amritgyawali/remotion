/**
 * Shared runtime for the motion-graphics scene library.
 *
 * Every scene in `lib/ai/scenes/*` receives the same props, so the planner can
 * put any of them in any slot without knowing what the renderer needs. The
 * renderer takes what it uses and derives the rest: a scene that wants six
 * ranked bars can build them from three lines of copy, and a scene that wants
 * one word can take the first word of the headline.
 *
 * The source strings here are emitted verbatim into the generated TSX, so they
 * must never contain a backtick or a dollar-brace sequence.
 */

export const MOTION_SHELL = `
/* -------------------------------------------------------------------------- */
/*  Motion scene runtime                                                      */
/* -------------------------------------------------------------------------- */

type MotionItem = { title: string; detail: string; icon: IconName }
type MotionStat = { value: number; prefix: string; suffix: string; label: string; decimals: number }

type MotionSceneProps = {
	frames: number
	variant: number
	kicker: string
	headline: string
	caption: string
	lines: string[]
	items: MotionItem[]
	stats: MotionStat[]
	icon: IconName
}

/** Deterministic 0..1 draw for one scene, never Math.random. */
const mrand = (key: string): number => random(CREATIVE_SEED + ':' + key)

/**
 * A darkened stage that still works on light stock.
 *
 * Several pieces - the glyph rain, the spotlight, the neon sign - want a room
 * with the lights off. Taking the same amount out of a paper palette turns the
 * frame grey and the piece reads as a rendering fault, so a light scheme gets a
 * fraction of the same move.
 */
const motionStage = (amount: number): string =>
	shade(THEME.background, THEME.scheme === 'light' ? amount * 0.16 : amount)

/** True when the film is set on light stock, where glow and bloom invert. */
const LIGHT_STOCK = THEME.scheme === 'light'

/** Deterministic integer in [0, span). */
const mpick = (key: string, span: number): number => Math.floor(mrand(key) * span) % Math.max(1, span)

/** Splits a phrase into words without leaving empty strings behind. */
const words = (value: string): string[] => value.split(/\\s+/).filter(Boolean)

/**
 * Guarantees a scene the number of copy lines it was designed around.
 *
 * A renderer built for five bands must not collapse to one when the brief was
 * short: it draws from the explicit lines first, then item titles, then stat
 * labels, then the headline broken at its natural pauses.
 */
const motionLines = (props: MotionSceneProps, want: number): string[] => {
	const headline = props.headline.trim().toLowerCase()
	const pool: string[] = []
	const push = (value: string) => {
		const trimmed = (value || '').trim()
		if (!trimmed) return
		// A line that just restates the headline is not a second idea, and a film
		// that lists its own title four times reads as a bug.
		if (trimmed.toLowerCase() === headline) return
		if (pool.some((item) => item.toLowerCase() === trimmed.toLowerCase())) return
		pool.push(trimmed)
	}
	for (const line of props.lines) push(line)
	for (const item of props.items) push(item.title)
	for (const stat of props.stats) push(stat.label)
	if (pool.length < want) push(props.caption)
	if (pool.length < want) {
		const clauses = props.headline.split(/[,;:]\\s*/).filter((part) => part.trim().length > 2)
		if (clauses.length > 1) for (const clause of clauses) push(clause)
	}
	/**
	 * Last resort only. Splitting a headline into single words produced cards
	 * reading "Running" and "Solar", so it is used just to keep a multi-slot
	 * piece from collapsing to one element, and only from substantial words.
	 */
	if (pool.length === 0) push(props.headline || props.kicker || 'Untitled')
	if (pool.length === 1 && want >= 3) {
		for (const word of words(props.headline)) if (word.length >= 5) push(word)
	}
	return pool.slice(0, Math.max(1, want))
}

/**
 * Item rows a card renderer can rely on.
 *
 * Unlike the copy lines, these are never synthesised out of the headline: a
 * card with a made-up title is worse than one card fewer, so a renderer built
 * for six may legitimately receive two.
 */
const motionItems = (props: MotionSceneProps, want: number): MotionItem[] => {
	if (props.items.length >= want) return props.items.slice(0, want)
	const filled = props.items.slice()
	const spare = props.lines
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.filter((line) => !filled.some((item) => item.title.toLowerCase() === line.toLowerCase()))
	for (let index = filled.length; index < want && spare.length > 0; index += 1) {
		filled.push({ title: spare.shift() as string, detail: '', icon: props.icon })
	}
	if (filled.length === 0) {
		filled.push({ title: props.headline || props.kicker || 'Untitled', detail: props.caption, icon: props.icon })
	}
	return filled.slice(0, Math.max(1, want))
}

/**
 * Weights a scene can chart when the brief carried no numbers.
 *
 * These are shape, not fact: a renderer built on them never prints a unit or a
 * measured quantity, so nothing is asserted that the user did not write.
 */
const motionWeights = (props: MotionSceneProps, count: number): number[] => {
	if (props.stats.length >= count) {
		const values = props.stats.slice(0, count).map((stat) => Math.abs(stat.value) || 1)
		const peak = Math.max(...values)
		return values.map((value) => value / peak)
	}
	const labels = motionLines(props, count)
	return new Array(count).fill(0).map((_, index) => {
		const label = labels[index % labels.length] || 'x'
		return 0.34 + mrand('weight-' + label.length + '-' + index) * 0.62
	})
}

const formatStat = (stat: MotionStat, progress: number): string => {
	const current = stat.value * Math.min(1, Math.max(0, progress))
	const digits = Math.min(3, Math.max(0, Math.round(stat.decimals)))
	return stat.prefix + current.toFixed(digits) + stat.suffix
}

/** The label block every motion scene can hang above or below its figure. */
const MotionCaption: React.FC<{
	kicker?: string
	headline?: string
	caption?: string
	delay?: number
	align?: 'center' | 'flex-start'
	size?: number
}> = ({ kicker = '', headline = '', caption = '', delay = 0, align = 'center', size }) => {
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	if (!kicker && !headline && !caption) return null

	/**
	 * The old block was bounded at 980 design units, which is wider than a
	 * portrait frame once the unit scales up on a 9:16 cut - the headline ran
	 * past both edges. The bound is now the page margin, whatever the format,
	 * and the type is cut to that box so a long brief shrinks instead of
	 * spilling. A short headline measures well under its size and is untouched.
	 */
	const box = Math.min(unit * 980, width * (1 - LAYOUT_INSET * 2))
	const headlineSize = fitBlock(size ?? unit * 60, headline, box, height * 0.34)
	const captionSize = fitBlock(unit * 26, caption, Math.min(unit * 760, box), height * 0.18)

	return (
		<div
			style={{
				display: 'flex',
				flexDirection: 'column',
				alignItems: align,
				gap: unit * 14,
				textAlign: align === 'center' ? 'center' : 'left',
			}}
		>
			{kicker ? <Kicker text={kicker} delay={delay} /> : null}
			{headline ? (
				<Headline
					text={headline}
					size={headlineSize}
					delay={delay + beat(4)}
					stagger={2.6}
					align={align}
					weight={DISPLAY_WEIGHT}
					tracking={-unit * 0.9}
					maxWidth={box}
				/>
			) : null}
			{caption ? (
				<Copy
					text={caption}
					delay={delay + beat(12)}
					align={align === 'center' ? 'center' : 'left'}
					size={captionSize}
					maxWidth={Math.min(unit * 760, box)}
				/>
			) : null}
		</div>
	)
}

/**
 * A panel in the house style.
 *
 * Scenes that need a surface use this rather than inventing their own, so the
 * corner language, border weight and the way glass reads on light stock stay
 * consistent inside one film.
 */
const MotionPanel: React.FC<{
	children: React.ReactNode
	delay?: number
	tone?: 'surface' | 'accent' | 'ink' | 'hollow'
	pad?: number
	grow?: boolean
	radius?: number
}> = ({ children, delay = 0, tone = 'surface', pad, grow = false, radius }) => {
	const unit = useUnit()
	const arrival = useArrival(delay, 0.8)
	const solid =
		tone === 'accent'
			? withAlpha(THEME.accent, 0.16)
			: tone === 'ink'
				? withAlpha(THEME.ink, THEME.scheme === 'light' ? 0.06 : 0.09)
				: tone === 'hollow'
					? 'transparent'
					: withAlpha(THEME.surface, CREATIVE.finish === 'glass' ? 0.5 : 0.82)
	const edge =
		tone === 'accent' ? withAlpha(THEME.accent, 0.5) : withAlpha(THEME.ink, THEME.scheme === 'light' ? 0.16 : 0.14)

	return (
		<div
			style={{
				position: 'relative',
				flex: grow ? 1 : undefined,
				padding: pad ?? unit * 26,
				borderRadius: radius ?? cornerRadius(unit),
				backgroundColor: solid,
				border: Math.max(1, unit * 1.4) + 'px solid ' + edge,
				backdropFilter: CREATIVE.finish === 'glass' ? 'blur(' + unit * 10 + 'px)' : undefined,
				boxShadow:
					tone === 'hollow'
						? undefined
						: '0 ' + unit * 18 + 'px ' + unit * 44 + 'px ' + withAlpha('#000000', THEME.scheme === 'light' ? 0.1 : 0.32),
				opacity: arrival.opacity,
				transform: arrival.transform,
				filter: arrival.filter,
			}}
		>
			{children}
		</div>
	)
}

/** A mark that draws itself on, for scenes that need geometry rather than an icon. */
const MotionGlyph: React.FC<{ index: number; size: number; delay?: number; color?: string }> = ({
	index,
	size,
	delay = 0,
	color = THEME.accent,
}) => {
	const frame = useCurrentFrame()
	const progress = interpolate(frame - delay, [0, 26], [0, 1], { ...CLAMP, easing: EASE_OUT })
	const spin = interpolate(frame, [0, 260], [0, 24], { easing: Easing.linear })
	const shape = index % 6
	const half = size / 2

	return (
		<svg width={size} height={size} viewBox="0 0 100 100" style={{ display: 'block', overflow: 'visible' }} aria-hidden>
			<g
				transform={'rotate(' + (shape === 2 ? spin : 0).toFixed(2) + ' 50 50)'}
				style={{ transformOrigin: half + 'px ' + half + 'px', opacity: progress }}
			>
				{shape === 0 ? (
					<circle cx="50" cy="50" r="34" fill="none" stroke={color} strokeWidth="6" strokeDasharray={214} strokeDashoffset={214 * (1 - progress)} />
				) : null}
				{shape === 1 ? (
					<rect x="18" y="18" width="64" height="64" fill="none" stroke={color} strokeWidth="6" strokeDasharray={256} strokeDashoffset={256 * (1 - progress)} />
				) : null}
				{shape === 2 ? (
					<polygon points="50,14 86,72 14,72" fill="none" stroke={color} strokeWidth="6" strokeDasharray={210} strokeDashoffset={210 * (1 - progress)} />
				) : null}
				{shape === 3 ? (
					<path d="M50 12 L88 50 L50 88 L12 50 Z" fill="none" stroke={color} strokeWidth="6" strokeDasharray={216} strokeDashoffset={216 * (1 - progress)} />
				) : null}
				{shape === 4 ? (
					<path d="M14 70 Q50 6 86 70" fill="none" stroke={color} strokeWidth="6" strokeLinecap="round" strokeDasharray={150} strokeDashoffset={150 * (1 - progress)} />
				) : null}
				{shape === 5 ? (
					<g stroke={color} strokeWidth="6" strokeLinecap="round">
						<line x1="20" y1="50" x2={20 + 60 * progress} y2="50" />
						<line x1="50" y1={80 - 60 * progress} x2="50" y2="80" />
					</g>
				) : null}
			</g>
		</svg>
	)
}
`
