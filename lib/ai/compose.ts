/**
 * The composer: storyboard JSON in, a complete Remotion TSX file out.
 *
 * Everything the studio compiles is generated here, from source we control, so
 * the output always has a <Composition>, a hook-free Root, deterministic
 * frame-driven motion, supported imports only and asset paths that exist. The
 * AI decides *what* the video says; this file decides how it is built.
 */

import {
	FONT_KIT,
	GRAIN_KIT,
	ICON_PATHS,
	LEAK_KIT,
	MUSIC_KIT,
	PALETTES,
	SFX_KIT,
	VIGNETTE_TEXTURE,
	type IconId,
} from './kit'
import {
	layoutStoryboard,
	storyboardSummary,
	type Scene,
	type SceneType,
	type Storyboard,
	type StoryboardLayout,
} from './storyboard'

export type ComposedVideo = {
	code: string
	fileName: string
	projectName: string
	compositionId: string
	layout: StoryboardLayout
	summary: string
}

const SCENE_COMPONENT: Record<SceneType, string> = {
	title: 'TitleScene',
	statement: 'StatementScene',
	timeline: 'TimelineScene',
	map: 'MapScene',
	landscape: 'LandscapeScene',
	monument: 'MonumentScene',
	gallery: 'GalleryScene',
	stats: 'StatsScene',
	chart: 'ChartScene',
	process: 'ProcessScene',
	quote: 'QuoteScene',
	cta: 'CtaScene',
}

function json(value: unknown): string {
	return JSON.stringify(value)
}

function pascalCase(value: string): string {
	const cleaned = value
		.replace(/[^A-Za-z0-9\s]/g, ' ')
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, 5)
		.map((word) => word[0].toUpperCase() + word.slice(1).toLowerCase())
		.join('')
	return /^[A-Za-z]/.test(cleaned) ? cleaned : `Ai${cleaned}`
}

function usedIcons(storyboard: Storyboard): IconId[] {
	const icons = new Set<IconId>(['spark', 'arrow'])
	for (const scene of storyboard.scenes) {
		if (scene.type === 'title' || scene.type === 'cta') icons.add(scene.icon)
		if (scene.type === 'gallery') scene.items.forEach((item) => icons.add(item.icon))
		if (scene.type === 'process') scene.steps.forEach((step) => icons.add(step.icon))
		if (scene.type === 'map') icons.add('pin')
		if (scene.type === 'quote') icons.add('star')
		if (scene.type === 'stats' || scene.type === 'chart') icons.add('chart')
	}
	return [...icons]
}

/* -------------------------------------------------------------------------- */
/*  Shared runtime that every generated video gets                            */
/* -------------------------------------------------------------------------- */

const HELPERS = `
const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const
const EASE_OUT = Easing.bezier(0.16, 1, 0.3, 1)

const withAlpha = (hex: string, alpha: number): string => {
	const value = hex.replace('#', '')
	const r = Number.parseInt(value.slice(0, 2), 16)
	const g = Number.parseInt(value.slice(2, 4), 16)
	const b = Number.parseInt(value.slice(4, 6), 16)
	return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + alpha + ')'
}

/** One design unit = 1px at a 1080x1080 frame, so every size scales with format. */
const useUnit = (): number => {
	const { width, height } = useVideoConfig()
	return Math.sqrt(width * height) / 1080
}

const useSpringIn = (delay: number, damping = 190): number => {
	const frame = useCurrentFrame()
	const { fps } = useVideoConfig()
	return spring({ frame: frame - delay, fps, config: { damping, mass: 0.9, stiffness: 120 } })
}

const SceneFrame: React.FC<{
	children: React.ReactNode
	align?: 'center' | 'flex-start'
	justify?: 'center' | 'flex-end' | 'flex-start'
	push?: number
	gap?: number
}> = ({ children, align = 'center', justify = 'center', push = 0.04, gap = 0 }) => {
	const frame = useCurrentFrame()
	const { width, height } = useVideoConfig()
	const scale = interpolate(frame, [0, 260], [1 + push, 1], CLAMP)

	return (
		<AbsoluteFill
			style={{
				paddingLeft: Math.round(width * 0.078),
				paddingRight: Math.round(width * 0.078),
				paddingTop: Math.round(height * 0.095),
				paddingBottom: Math.round(height * 0.095),
				display: 'flex',
				flexDirection: 'column',
				alignItems: align,
				justifyContent: justify,
				textAlign: align === 'center' ? 'center' : 'left',
				gap,
				transform: 'scale(' + scale.toFixed(4) + ')',
			}}
		>
			{children}
		</AbsoluteFill>
	)
}

const VectorIcon: React.FC<{
	name: IconName
	size?: number
	color?: string
	strokeWidth?: number
	glow?: boolean
}> = ({ name, size = 48, color = THEME.ink, strokeWidth = 1.8, glow = false }) => (
	<svg
		width={Math.round(size)}
		height={Math.round(size)}
		viewBox="0 0 24 24"
		fill="none"
		aria-hidden
		style={{
			display: 'block',
			overflow: 'visible',
			filter: glow ? 'drop-shadow(0 0 ' + Math.max(6, size * 0.22).toFixed(1) + 'px ' + withAlpha(color, 0.55) + ')' : undefined,
		}}
	>
		{ICON_PATHS[name].map((path, index) => (
			<path
				key={name + '-' + index}
				d={path}
				stroke={color}
				strokeWidth={strokeWidth}
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		))}
	</svg>
)

const IconBadge: React.FC<{ name: IconName; size?: number; delay?: number; color?: string }> = ({
	name,
	size = 120,
	delay = 0,
	color = THEME.accent,
}) => {
	const frame = useCurrentFrame()
	const enter = useSpringIn(delay, 170)
	const spin = interpolate(frame, [0, 300], [0, 40], { easing: Easing.linear })

	return (
		<div
			style={{
				width: size,
				height: size,
				borderRadius: size,
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				position: 'relative',
				opacity: enter,
				transform: 'scale(' + (0.7 + enter * 0.3).toFixed(4) + ')',
				backgroundColor: withAlpha(color, 0.1),
				border: '1px solid ' + withAlpha(color, 0.4),
			}}
		>
			<div
				style={{
					position: 'absolute',
					inset: -size * 0.09,
					borderRadius: size,
					border: '2px dashed ' + withAlpha(color, 0.34),
					transform: 'rotate(' + spin.toFixed(2) + 'deg)',
				}}
			/>
			<VectorIcon name={name} size={size * 0.44} color={color} strokeWidth={1.6} glow />
		</div>
	)
}

const Kicker: React.FC<{ text: string; delay?: number; color?: string }> = ({
	text,
	delay = 0,
	color = THEME.accent,
}) => {
	const unit = useUnit()
	const enter = useSpringIn(delay, 200)
	if (!text) return null

	return (
		<div
			style={{
				display: 'inline-flex',
				alignItems: 'center',
				gap: unit * 10,
				padding: unit * 9 + 'px ' + unit * 18 + 'px',
				borderRadius: unit * 100,
				border: '1px solid ' + withAlpha(color, 0.45),
				backgroundColor: withAlpha(color, 0.09),
				color,
				fontFamily: TEXT_FONT,
				fontSize: unit * 22,
				fontWeight: 600,
				letterSpacing: unit * 3.4,
				textTransform: 'uppercase',
				opacity: enter,
				transform: 'translateY(' + ((1 - enter) * unit * 14).toFixed(2) + 'px)',
				whiteSpace: 'nowrap',
			}}
		>
			<span
				style={{
					width: unit * 7,
					height: unit * 7,
					borderRadius: unit * 7,
					backgroundColor: color,
					display: 'block',
				}}
			/>
			{text}
		</div>
	)
}

const Word: React.FC<{
	text: string
	delay: number
	size: number
	color: string
	family: string
	weight: number
	tracking: number
	accent?: boolean
}> = ({ text, delay, size, color, family, weight, tracking, accent = false }) => {
	const enter = useSpringIn(delay, 200)
	const blur = (1 - enter) * 10

	return (
		<span
			style={{
				display: 'inline-block',
				fontFamily: family,
				fontSize: size,
				fontWeight: weight,
				letterSpacing: tracking,
				lineHeight: 1.02,
				color: accent ? THEME.accent : color,
				opacity: enter,
				transform:
					'translateY(' + ((1 - enter) * size * 0.42).toFixed(2) + 'px) scale(' + (0.94 + enter * 0.06).toFixed(4) + ')',
				filter: blur > 0.4 ? 'blur(' + blur.toFixed(2) + 'px)' : undefined,
				textShadow: accent ? '0 0 ' + (size * 0.35).toFixed(0) + 'px ' + withAlpha(THEME.glow, 0.4) : undefined,
			}}
		>
			{text}
		</span>
	)
}

const Headline: React.FC<{
	text: string
	size: number
	delay?: number
	stagger?: number
	color?: string
	family?: string
	weight?: number
	tracking?: number
	align?: 'center' | 'flex-start'
	uppercase?: boolean
	highlight?: string
	maxWidth?: number
}> = ({
	text,
	size,
	delay = 0,
	stagger = 3,
	color = THEME.ink,
	family = DISPLAY_FONT,
	weight = 700,
	tracking = -0.5,
	align = 'center',
	uppercase = false,
	highlight = '',
	maxWidth,
}) => {
	const words = text.split(' ').filter(Boolean)
	const accents = highlight
		.toLowerCase()
		.split(' ')
		.filter(Boolean)

	return (
		<div
			style={{
				display: 'flex',
				flexWrap: 'wrap',
				gap: size * 0.24,
				rowGap: size * 0.12,
				justifyContent: align === 'center' ? 'center' : 'flex-start',
				maxWidth,
			}}
		>
			{words.map((word, index) => (
				<Word
					key={word + '-' + index}
					text={uppercase ? word.toUpperCase() : word}
					delay={delay + index * stagger}
					size={size}
					color={color}
					family={family}
					weight={weight}
					tracking={tracking}
					accent={accents.includes(word.toLowerCase().replace(/[^a-z0-9]/g, ''))}
				/>
			))}
		</div>
	)
}

const Copy: React.FC<{
	text: string
	delay?: number
	size?: number
	color?: string
	align?: 'center' | 'left'
	maxWidth?: number
	weight?: number
}> = ({ text, delay = 0, size, color = THEME.muted, align = 'center', maxWidth, weight = 400 }) => {
	const unit = useUnit()
	const enter = useSpringIn(delay, 210)
	if (!text) return null

	return (
		<p
			style={{
				margin: 0,
				fontFamily: TEXT_FONT,
				fontSize: size ?? unit * 30,
				fontWeight: weight,
				lineHeight: 1.45,
				color,
				textAlign: align,
				maxWidth: maxWidth ?? unit * 760,
				opacity: enter,
				transform: 'translateY(' + ((1 - enter) * unit * 18).toFixed(2) + 'px)',
			}}
		>
			{text}
		</p>
	)
}

/** Solid-colour rule that wipes open - safe for every export engine. */
const Rule: React.FC<{ delay?: number; width: number; height?: number; color?: string }> = ({
	delay = 0,
	width,
	height,
	color = THEME.accent,
}) => {
	const unit = useUnit()
	const enter = useSpringIn(delay, 210)
	const thickness = height ?? Math.max(2, unit * 4)

	return (
		<div style={{ width, height: thickness, backgroundColor: withAlpha(color, 0.18), borderRadius: thickness }}>
			<div
				style={{
					width: (enter * 100).toFixed(2) + '%',
					height: '100%',
					backgroundColor: color,
					borderRadius: thickness,
					boxShadow: '0 0 ' + (thickness * 4).toFixed(0) + 'px ' + withAlpha(color, 0.6),
				}}
			/>
		</div>
	)
}

const Backdrop: React.FC<{ seed?: number; intensity?: number }> = ({ seed = 0, intensity = 1 }) => {
	const frame = useCurrentFrame()
	const drift = Math.sin(frame / 110 + seed) * 3
	const lift = Math.cos(frame / 140 + seed) * 2.5

	return (
		<AbsoluteFill style={{ backgroundColor: THEME.background }}>
			<AbsoluteFill
				style={{
					background:
						'radial-gradient(125% 95% at ' + (30 + drift).toFixed(2) + '% ' + (16 + lift).toFixed(2) + '%, ' +
						THEME.backgroundAlt + ' 0%, ' + THEME.background + ' 68%)',
				}}
			/>
			<AbsoluteFill
				style={{
					background:
						'radial-gradient(60% 55% at ' + (76 - drift).toFixed(2) + '% 80%, ' +
						withAlpha(THEME.accentAlt, 0.22 * intensity) + ' 0%, rgba(0,0,0,0) 70%)',
				}}
			/>
			<AbsoluteFill
				style={{
					background:
						'radial-gradient(45% 40% at ' + (18 + drift).toFixed(2) + '% 72%, ' +
						withAlpha(THEME.accent, 0.16 * intensity) + ' 0%, rgba(0,0,0,0) 72%)',
				}}
			/>
		</AbsoluteFill>
	)
}

const ParticleField: React.FC<{ count?: number; color?: string; speed?: number; size?: number }> = ({
	count = 26,
	color = THEME.accent,
	speed = 0.5,
	size = 5,
}) => {
	const frame = useCurrentFrame()
	const { width, height } = useVideoConfig()

	return (
		<AbsoluteFill style={{ overflow: 'hidden' }}>
			{new Array(count).fill(0).map((_, index) => {
				const seedX = random('particle-x-' + index)
				const seedY = random('particle-y-' + index)
				const seedS = random('particle-s-' + index)
				const travel = (seedY * height + frame * speed * (0.35 + seedS)) % (height + 120)
				const dot = size * (0.4 + seedS)

				return (
					<div
						key={'particle-' + index}
						style={{
							position: 'absolute',
							left: seedX * width,
							top: height + 60 - travel,
							width: dot,
							height: dot,
							borderRadius: dot,
							backgroundColor: withAlpha(color, 0.18 + seedS * 0.4),
							boxShadow: '0 0 ' + (dot * 4).toFixed(1) + 'px ' + withAlpha(color, 0.5),
						}}
					/>
				)
			})}
		</AbsoluteFill>
	)
}
`

/* -------------------------------------------------------------------------- */
/*  Scene library - only the scenes a storyboard uses are emitted             */
/* -------------------------------------------------------------------------- */

const SCENES: Record<SceneType, string> = {
	title: `
const TitleScene: React.FC<{
	frames: number
	kicker: string
	headline: string
	subline: string
	icon: IconName
}> = ({ frames, kicker, headline, subline, icon }) => {
	const unit = useUnit()
	const { width } = useVideoConfig()
	const ruleWidth = Math.min(width * 0.42, unit * 520)

	return (
		<AbsoluteFill>
			<Backdrop seed={1} />
			<ParticleField count={30} speed={0.45} />
			<SceneFrame gap={unit * 26} push={0.06}>
				<IconBadge name={icon} size={unit * 118} delay={2} />
				<Kicker text={kicker} delay={8} />
				<Headline
					text={headline}
					size={unit * 104}
					delay={12}
					stagger={4}
					uppercase
					weight={800}
					tracking={-unit * 1.5}
					maxWidth={unit * 980}
				/>
				<Rule delay={26} width={ruleWidth} />
				<Copy text={subline} delay={30} size={unit * 32} maxWidth={unit * 820} />
			</SceneFrame>
			<SceneEdge frames={frames} />
		</AbsoluteFill>
	)
}
`,
	statement: `
const StatementScene: React.FC<{
	frames: number
	text: string
	highlight: string
	footnote: string
}> = ({ frames, text, highlight, footnote }) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width } = useVideoConfig()
	const sweep = interpolate(frame, [0, 34], [-1, 0], { ...CLAMP, easing: EASE_OUT })

	return (
		<AbsoluteFill>
			<Backdrop seed={2} intensity={1.25} />
			<AbsoluteFill
				style={{
					transform: 'translateX(' + (sweep * width * 0.6).toFixed(1) + 'px)',
					opacity: 0.16,
				}}
			>
				<div
					style={{
						position: 'absolute',
						left: 0,
						top: '38%',
						width: '100%',
						height: unit * 220,
						backgroundColor: THEME.accent,
					}}
				/>
			</AbsoluteFill>
			<SceneFrame align="flex-start" justify="center" gap={unit * 30} push={0.05}>
				<Headline
					text={text}
					size={unit * 92}
					delay={4}
					stagger={3.4}
					align="flex-start"
					highlight={highlight}
					weight={800}
					uppercase
					tracking={-unit * 1.4}
				/>
				<Rule delay={22} width={unit * 260} />
				<Copy text={footnote} delay={26} align="left" size={unit * 30} />
			</SceneFrame>
			<SceneEdge frames={frames} />
		</AbsoluteFill>
	)
}
`,
	timeline: `
type TimelineEventData = { marker: string; title: string; detail: string }

const TimelineScene: React.FC<{ frames: number; headline: string; events: TimelineEventData[] }> = ({
	frames,
	headline,
	events,
}) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const horizontal = width >= height
	const lead = 12
	const step = Math.max(10, (frames - lead - 16) / events.length)
	const railProgress = interpolate(frame, [lead, lead + step * events.length], [0, 1], CLAMP)

	return (
		<AbsoluteFill>
			<Backdrop seed={3} intensity={0.85} />
			<SceneFrame align="flex-start" justify={horizontal ? 'center' : 'flex-start'} gap={unit * 42}>
				<div style={{ display: 'flex', flexDirection: 'column', gap: unit * 14, alignItems: 'flex-start' }}>
					<Kicker text="Timeline" delay={0} />
					<Headline
						text={headline}
						size={unit * 58}
						delay={4}
						align="flex-start"
						uppercase
						weight={800}
						tracking={-unit * 0.8}
					/>
				</div>

				<div
					style={{
						position: 'relative',
						width: '100%',
						display: 'flex',
						flexDirection: horizontal ? 'row' : 'column',
						gap: horizontal ? unit * 26 : unit * 26,
						paddingTop: horizontal ? unit * 46 : 0,
						paddingLeft: horizontal ? 0 : unit * 46,
					}}
				>
					<div
						style={{
							position: 'absolute',
							left: horizontal ? 0 : unit * 13,
							top: horizontal ? unit * 13 : 0,
							width: horizontal ? '100%' : unit * 3,
							height: horizontal ? unit * 3 : '100%',
							backgroundColor: withAlpha(THEME.ink, 0.16),
						}}
					/>
					<div
						style={{
							position: 'absolute',
							left: horizontal ? 0 : unit * 13,
							top: horizontal ? unit * 13 : 0,
							width: horizontal ? (railProgress * 100).toFixed(2) + '%' : unit * 3,
							height: horizontal ? unit * 3 : (railProgress * 100).toFixed(2) + '%',
							backgroundColor: THEME.accent,
							boxShadow: '0 0 ' + (unit * 16).toFixed(0) + 'px ' + withAlpha(THEME.glow, 0.55),
						}}
					/>

					{events.map((event, index) => (
						<TimelineEntry
							key={event.marker + '-' + index}
							event={event}
							delay={lead + index * step}
							horizontal={horizontal}
							flex={1 / events.length}
						/>
					))}
				</div>
			</SceneFrame>
			<SceneEdge frames={frames} />
		</AbsoluteFill>
	)
}

const TimelineEntry: React.FC<{
	event: TimelineEventData
	delay: number
	horizontal: boolean
	flex: number
}> = ({ event, delay, horizontal, flex }) => {
	const unit = useUnit()
	const enter = useSpringIn(delay, 180)

	return (
		<div
			style={{
				flex: horizontal ? flex : undefined,
				display: 'flex',
				flexDirection: horizontal ? 'column' : 'row',
				alignItems: horizontal ? 'flex-start' : 'flex-start',
				gap: unit * 16,
				opacity: enter,
				transform: horizontal
					? 'translateY(' + ((1 - enter) * unit * 26).toFixed(2) + 'px)'
					: 'translateX(' + ((1 - enter) * unit * 26).toFixed(2) + 'px)',
				position: 'relative',
			}}
		>
			<div
				style={{
					position: 'absolute',
					left: horizontal ? 0 : -unit * 46 + unit * 6,
					top: horizontal ? -unit * 46 + unit * 6 : 0,
					width: unit * 18,
					height: unit * 18,
					borderRadius: unit * 18,
					backgroundColor: THEME.accent,
					border: '3px solid ' + THEME.background,
					boxShadow: '0 0 ' + (unit * 18).toFixed(0) + 'px ' + withAlpha(THEME.glow, 0.7),
					transform: 'scale(' + (0.4 + enter * 0.6).toFixed(3) + ')',
				}}
			/>
			<div style={{ display: 'flex', flexDirection: 'column', gap: unit * 8, paddingRight: unit * 18 }}>
				<span
					style={{
						fontFamily: DISPLAY_FONT,
						fontSize: unit * 44,
						fontWeight: 800,
						color: THEME.accent,
						letterSpacing: -unit * 0.5,
					}}
				>
					{event.marker}
				</span>
				<span style={{ fontFamily: TEXT_FONT, fontSize: unit * 30, fontWeight: 700, color: THEME.ink, lineHeight: 1.25 }}>
					{event.title}
				</span>
				{event.detail ? (
					<span style={{ fontFamily: TEXT_FONT, fontSize: unit * 23, color: THEME.muted, lineHeight: 1.4 }}>
						{event.detail}
					</span>
				) : null}
			</div>
		</div>
	)
}
`,
	map: `
type MapPlaceData = { name: string; detail: string; x: number; y: number }

const MapScene: React.FC<{
	frames: number
	headline: string
	caption: string
	places: MapPlaceData[]
	connect: boolean
}> = ({ frames, headline, caption, places, connect }) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const board = Math.min(width * 0.82, height * 0.62)
	const left = (width - board) / 2
	const top = (height - board) / 2 + unit * 20
	const lead = 16
	const step = Math.max(8, (frames - lead - 14) / places.length)

	const grid = new Array(9).fill(0)
	const landmass = new Array(3).fill(0).map((_, index) => {
		const cx = 260 + random('land-x-' + index) * 480
		const cy = 260 + random('land-y-' + index) * 460
		const rx = 150 + random('land-rx-' + index) * 190
		const ry = 110 + random('land-ry-' + index) * 150
		return { cx, cy, rx, ry }
	})

	return (
		<AbsoluteFill>
			<Backdrop seed={4} intensity={0.7} />
			<div style={{ position: 'absolute', left, top, width: board, height: board }}>
				<svg width={Math.round(board)} height={Math.round(board)} viewBox="0 0 1000 1000" style={{ display: 'block' }}>
					{grid.map((_, index) => (
						<line
							key={'v-' + index}
							x1={index * 125}
							y1={0}
							x2={index * 125}
							y2={1000}
							stroke={withAlpha(THEME.ink, 0.09)}
							strokeWidth={1.4}
						/>
					))}
					{grid.map((_, index) => (
						<line
							key={'h-' + index}
							x1={0}
							y1={index * 125}
							x2={1000}
							y2={index * 125}
							stroke={withAlpha(THEME.ink, 0.09)}
							strokeWidth={1.4}
						/>
					))}
					{landmass.map((blob, index) => {
						const grow = interpolate(frame, [index * 6, 26 + index * 6], [0, 1], { ...CLAMP, easing: EASE_OUT })
						return (
							<ellipse
								key={'blob-' + index}
								cx={blob.cx}
								cy={blob.cy}
								rx={blob.rx * grow}
								ry={blob.ry * grow}
								fill={withAlpha(THEME.surface, 0.85)}
								stroke={withAlpha(THEME.accent, 0.35)}
								strokeWidth={2}
							/>
						)
					})}
					{connect
						? places.slice(1).map((place, index) => {
								const previous = places[index]
								const progress = interpolate(
									frame,
									[lead + index * step + 6, lead + (index + 1) * step + 6],
									[0, 1],
									CLAMP,
								)
								const x1 = previous.x * 1000
								const y1 = previous.y * 1000
								const x2 = place.x * 1000
								const y2 = place.y * 1000
								const mx = (x1 + x2) / 2
								const my = (y1 + y2) / 2 - Math.abs(x2 - x1) * 0.35
								const length = Math.hypot(x2 - x1, y2 - y1) * 1.35
								return (
									<path
										key={'arc-' + index}
										d={'M ' + x1 + ' ' + y1 + ' Q ' + mx + ' ' + my + ' ' + x2 + ' ' + y2}
										fill="none"
										stroke={THEME.accentAlt}
										strokeWidth={3}
										strokeLinecap="round"
										strokeDasharray={length}
										strokeDashoffset={length * (1 - progress)}
									/>
								)
							})
						: null}
					{places.map((place, index) => {
						const pop = interpolate(frame, [lead + index * step, lead + index * step + 14], [0, 1], {
							...CLAMP,
							easing: EASE_OUT,
						})
						const pulse = ((frame - lead - index * step) % 45) / 45
						const cx = place.x * 1000
						const cy = place.y * 1000
						return (
							<g key={'place-' + index} opacity={pop}>
								{pop > 0.2 ? (
									<circle
										cx={cx}
										cy={cy}
										r={16 + pulse * 44}
										fill="none"
										stroke={withAlpha(THEME.accent, (1 - pulse) * 0.6)}
										strokeWidth={3}
									/>
								) : null}
								<circle cx={cx} cy={cy} r={13 * pop} fill={THEME.accent} />
								<text
									x={cx + 26}
									y={cy + 9}
									fill={THEME.ink}
									fontFamily={TEXT_FONT}
									fontSize={30}
									fontWeight={700}
								>
									{place.name}
								</text>
								{place.detail ? (
									<text x={cx + 26} y={cy + 44} fill={THEME.muted} fontFamily={TEXT_FONT} fontSize={22}>
										{place.detail}
									</text>
								) : null}
							</g>
						)
					})}
				</svg>
			</div>
			<SceneFrame align="flex-start" justify="flex-start" gap={unit * 14} push={0.02}>
				<Kicker text="Where" delay={0} />
				<Headline
					text={headline}
					size={unit * 54}
					delay={4}
					align="flex-start"
					uppercase
					weight={800}
					maxWidth={unit * 640}
				/>
			</SceneFrame>
			<AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', paddingBottom: height * 0.09 }}>
				<Copy text={caption} delay={20} size={unit * 27} maxWidth={unit * 700} />
			</AbsoluteFill>
			<SceneEdge frames={frames} />
		</AbsoluteFill>
	)
}
`,
	landscape: `
const SKY: Record<string, [string, string]> = {
	dawn: ['#F7C9A0', '#5C6E9E'],
	day: ['#BFE2F7', '#5C93C4'],
	dusk: ['#F09A6B', '#3A2B57'],
	night: ['#1B2445', '#05070F'],
}

const ridgePath = (
	terrain: string,
	seed: number,
	width: number,
	height: number,
	baseY: number,
	amplitude: number,
): string => {
	const steps = terrain === 'city' ? 24 : 64
	const points: string[] = ['M -60 ' + (height + 60).toFixed(1)]
	let previousY = baseY

	for (let index = 0; index <= steps; index += 1) {
		const x = -60 + ((width + 120) * index) / steps
		const noise = random('ridge-' + seed + '-' + index)
		let y = baseY

		if (terrain === 'mountain') {
			// A few peaks of different heights read as a range; a fast sine reads
			// as a saw blade, so each peak gets its own seeded height and shoulder.
			const peaks = 3 + seed
			const phase = (index / steps) * peaks
			const slot = Math.floor(phase)
			const local = phase - slot
			const peakHeight = amplitude * (0.42 + random('peak-' + seed + '-' + slot) * 0.85)
			const apex = 0.3 + random('apex-' + seed + '-' + slot) * 0.4
			const rise = local < apex ? local / apex : (1 - local) / (1 - apex)
			const shoulder = Math.pow(Math.max(0, rise), 0.6)
			const foot = amplitude * 0.14 * random('foot-' + seed + '-' + slot)
			y = baseY + foot - peakHeight * shoulder - (noise - 0.5) * amplitude * 0.04
		} else if (terrain === 'desert') {
			y = baseY - (Math.sin(index * 0.5 + seed * 1.7) * 0.5 + 0.5) * amplitude * (0.45 + noise * 0.35)
		} else if (terrain === 'city') {
			y = baseY - Math.round((0.25 + noise * 0.75) * amplitude * 0.9)
		} else if (terrain === 'forest') {
			y = baseY - (index % 2 === 0 ? amplitude * (0.4 + noise * 0.5) : amplitude * 0.18)
		} else if (terrain === 'ocean') {
			y = baseY - Math.sin(index * 0.9 + seed * 2.4) * amplitude * 0.22
		} else {
			y = baseY - (Math.sin(index * 0.35 + seed) * 0.5 + 0.5) * amplitude * 0.5
		}

		if (terrain === 'city') {
			points.push('L ' + x.toFixed(1) + ' ' + previousY.toFixed(1))
			points.push('L ' + x.toFixed(1) + ' ' + y.toFixed(1))
			previousY = y
		} else {
			points.push('L ' + x.toFixed(1) + ' ' + y.toFixed(1))
		}
	}

	points.push('L ' + (width + 60).toFixed(1) + ' ' + (height + 60).toFixed(1))
	points.push('Z')
	return points.join(' ')
}

const LandscapeScene: React.FC<{
	frames: number
	terrain: string
	timeOfDay: string
	headline: string
	caption: string
}> = ({ frames, terrain, timeOfDay, headline, caption }) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const uid = React.useId().replace(/:/g, '')
	const sky = SKY[timeOfDay] ?? SKY.dawn
	const sunRise = interpolate(frame, [0, 120], [0.62, 0.44], { ...CLAMP, easing: EASE_OUT })
	const sunX = width * 0.68
	const sunY = height * sunRise
	const layers = [
		{ base: 0.98, amplitude: 0.1, alpha: 0.35, drift: 0.16 },
		{ base: 0.92, amplitude: 0.2, alpha: 0.55, drift: 0.3 },
		{ base: 0.86, amplitude: 0.32, alpha: 0.78, drift: 0.5 },
		{ base: 0.8, amplitude: 0.46, alpha: 1, drift: 0.82 },
	]

	return (
		<AbsoluteFill style={{ backgroundColor: THEME.background }}>
			<AbsoluteFill
				style={{ background: 'linear-gradient(180deg, ' + sky[1] + ' 0%, ' + sky[0] + ' 78%, ' + THEME.background + ' 100%)' }}
			/>
			<svg width={width} height={height} viewBox={'0 0 ' + width + ' ' + height} style={{ position: 'absolute', inset: 0 }}>
				<defs>
					<radialGradient id={uid + '-sun'}>
						<stop offset="0" stopColor={withAlpha(THEME.accent, 0.95)} />
						<stop offset="0.4" stopColor={withAlpha(THEME.accent, 0.35)} />
						<stop offset="1" stopColor={withAlpha(THEME.accent, 0)} />
					</radialGradient>
					<linearGradient id={uid + '-scrim'} x1="0" y1="0" x2="0" y2="1">
						<stop offset="0" stopColor={withAlpha(THEME.background, 0)} />
						<stop offset="1" stopColor={withAlpha(THEME.background, 0.94)} />
					</linearGradient>
				</defs>
				<circle cx={sunX} cy={sunY} r={unit * 240} fill={'url(#' + uid + '-sun)'} />
				<circle cx={sunX} cy={sunY} r={unit * 62} fill={timeOfDay === 'night' ? '#E8EEFF' : '#FFF3D6'} />
				{new Array(4).fill(0).map((_, index) => {
					const y = height * (0.3 + index * 0.05)
					const shift = ((frame * (0.35 + index * 0.2)) % (width + 400)) - 200
					return (
						<ellipse
							key={'haze-' + index}
							cx={shift}
							cy={y}
							rx={width * 0.34}
							ry={unit * (16 + index * 6)}
							fill={withAlpha('#FFFFFF', 0.07)}
						/>
					)
				})}
				{layers.map((layer, index) => {
					const enter = interpolate(frame, [index * 4, 24 + index * 4], [1, 0], { ...CLAMP, easing: EASE_OUT })
					const drift = Math.sin(frame / 150 + index) * unit * 8 * layer.drift
					return (
						<path
							key={'ridge-' + index}
							d={ridgePath(terrain, index + 1, width, height, height * layer.base, height * layer.amplitude)}
							fill={withAlpha(index === layers.length - 1 ? THEME.background : THEME.surface, layer.alpha)}
							transform={
								'translate(' + drift.toFixed(1) + ', ' + (enter * height * 0.06 * (index + 1)).toFixed(1) + ')'
							}
						/>
					)
				})}
				<rect
					x={0}
					y={height * 0.5}
					width={width}
					height={height * 0.5}
					fill={'url(#' + uid + '-scrim)'}
				/>
				{timeOfDay === 'night'
					? new Array(40).fill(0).map((_, index) => {
							const starX = random('star-x-' + index) * width
							const starY = random('star-y-' + index) * height * 0.55
							const twinkle = 0.35 + Math.abs(Math.sin(frame / 22 + index)) * 0.5
							return <circle key={'star-' + index} cx={starX} cy={starY} r={unit * 2} fill={withAlpha('#FFFFFF', twinkle)} />
						})
					: null}
			</svg>
			<AbsoluteFill
				style={{
					justifyContent: 'flex-end',
					alignItems: 'flex-start',
					paddingLeft: width * 0.078,
					paddingRight: width * 0.078,
					paddingBottom: height * 0.1,
					gap: unit * 18,
					flexDirection: 'column',
				}}
			>
				<Headline
					text={headline}
					size={unit * 76}
					delay={10}
					align="flex-start"
					uppercase
					weight={800}
					maxWidth={unit * 900}
				/>
				<Rule delay={24} width={unit * 220} />
				<Copy text={caption} delay={28} align="left" size={unit * 28} maxWidth={unit * 720} />
			</AbsoluteFill>
			<SceneEdge frames={frames} />
		</AbsoluteFill>
	)
}
`,
	monument: `
const monumentShapes = (structure: string, size: number): React.ReactNode => {
	const s = size
	const stroke = withAlpha(THEME.accent, 0.55)
	const fill = THEME.surface

	if (structure === 'stupa') {
		return (
			<g>
				<rect x={s * 0.18} y={s * 0.78} width={s * 0.64} height={s * 0.08} fill={fill} stroke={stroke} strokeWidth={2} />
				<path d={'M ' + s * 0.22 + ' ' + s * 0.78 + ' A ' + s * 0.28 + ' ' + s * 0.3 + ' 0 0 1 ' + s * 0.78 + ' ' + s * 0.78 + ' Z'} fill={fill} stroke={stroke} strokeWidth={2} />
				<rect x={s * 0.42} y={s * 0.32} width={s * 0.16} height={s * 0.16} fill={fill} stroke={stroke} strokeWidth={2} />
				<path d={'M ' + s * 0.46 + ' ' + s * 0.32 + ' L ' + s * 0.5 + ' ' + s * 0.12 + ' L ' + s * 0.54 + ' ' + s * 0.32 + ' Z'} fill={THEME.accent} />
				<circle cx={s * 0.5} cy={s * 0.1} r={s * 0.03} fill={THEME.accent} />
			</g>
		)
	}
	if (structure === 'tower') {
		return (
			<g>
				<path d={'M ' + s * 0.38 + ' ' + s * 0.86 + ' L ' + s * 0.43 + ' ' + s * 0.2 + ' L ' + s * 0.57 + ' ' + s * 0.2 + ' L ' + s * 0.62 + ' ' + s * 0.86 + ' Z'} fill={fill} stroke={stroke} strokeWidth={2} />
				<rect x={s * 0.4} y={s * 0.52} width={s * 0.2} height={s * 0.04} fill={THEME.accent} />
				<rect x={s * 0.41} y={s * 0.34} width={s * 0.18} height={s * 0.03} fill={withAlpha(THEME.accent, 0.7)} />
				<path d={'M ' + s * 0.5 + ' ' + s * 0.2 + ' L ' + s * 0.5 + ' ' + s * 0.06} stroke={THEME.accent} strokeWidth={3} />
			</g>
		)
	}
	if (structure === 'arch') {
		return (
			<g>
				<path d={'M ' + s * 0.2 + ' ' + s * 0.86 + ' L ' + s * 0.2 + ' ' + s * 0.4 + ' A ' + s * 0.3 + ' ' + s * 0.3 + ' 0 0 1 ' + s * 0.8 + ' ' + s * 0.4 + ' L ' + s * 0.8 + ' ' + s * 0.86 + ' L ' + s * 0.66 + ' ' + s * 0.86 + ' L ' + s * 0.66 + ' ' + s * 0.46 + ' A ' + s * 0.16 + ' ' + s * 0.16 + ' 0 0 0 ' + s * 0.34 + ' ' + s * 0.46 + ' L ' + s * 0.34 + ' ' + s * 0.86 + ' Z'} fill={fill} stroke={stroke} strokeWidth={2} />
			</g>
		)
	}
	if (structure === 'dome') {
		return (
			<g>
				<rect x={s * 0.16} y={s * 0.72} width={s * 0.68} height={s * 0.14} fill={fill} stroke={stroke} strokeWidth={2} />
				<path d={'M ' + s * 0.24 + ' ' + s * 0.72 + ' A ' + s * 0.26 + ' ' + s * 0.34 + ' 0 0 1 ' + s * 0.76 + ' ' + s * 0.72 + ' Z'} fill={fill} stroke={stroke} strokeWidth={2} />
				<circle cx={s * 0.5} cy={s * 0.3} r={s * 0.035} fill={THEME.accent} />
				<rect x={s * 0.26} y={s * 0.58} width={s * 0.06} height={s * 0.14} fill={withAlpha(THEME.accent, 0.5)} />
				<rect x={s * 0.68} y={s * 0.58} width={s * 0.06} height={s * 0.14} fill={withAlpha(THEME.accent, 0.5)} />
			</g>
		)
	}
	if (structure === 'monolith') {
		return (
			<g>
				<rect x={s * 0.42} y={s * 0.16} width={s * 0.16} height={s * 0.7} fill={fill} stroke={stroke} strokeWidth={2} />
				<rect x={s * 0.3} y={s * 0.84} width={s * 0.4} height={s * 0.05} fill={withAlpha(THEME.accent, 0.5)} />
			</g>
		)
	}
	if (structure === 'bridge') {
		return (
			<g>
				<path d={'M ' + s * 0.08 + ' ' + s * 0.62 + ' L ' + s * 0.92 + ' ' + s * 0.62} stroke={THEME.accent} strokeWidth={4} />
				<path d={'M ' + s * 0.08 + ' ' + s * 0.62 + ' Q ' + s * 0.5 + ' ' + s * 0.2 + ' ' + s * 0.92 + ' ' + s * 0.62} fill="none" stroke={stroke} strokeWidth={3} />
				{new Array(7).fill(0).map((_, index) => {
					const x = s * (0.16 + index * 0.115)
					const t = (x / s - 0.08) / 0.84
					const y = s * (0.62 - Math.sin(Math.PI * t) * 0.34)
					return <line key={'cable-' + index} x1={x} y1={y} x2={x} y2={s * 0.62} stroke={withAlpha(THEME.accent, 0.55)} strokeWidth={2} />
				})}
				<rect x={s * 0.06} y={s * 0.62} width={s * 0.88} height={s * 0.05} fill={fill} stroke={stroke} strokeWidth={2} />
			</g>
		)
	}
	return (
		<g>
			<rect x={s * 0.16} y={s * 0.8} width={s * 0.68} height={s * 0.07} fill={fill} stroke={stroke} strokeWidth={2} />
			<rect x={s * 0.24} y={s * 0.56} width={s * 0.52} height={s * 0.24} fill={fill} stroke={stroke} strokeWidth={2} />
			<path d={'M ' + s * 0.16 + ' ' + s * 0.56 + ' L ' + s * 0.5 + ' ' + s * 0.4 + ' L ' + s * 0.84 + ' ' + s * 0.56 + ' Z'} fill={fill} stroke={stroke} strokeWidth={2} />
			<rect x={s * 0.34} y={s * 0.3} width={s * 0.32} height={s * 0.12} fill={fill} stroke={stroke} strokeWidth={2} />
			<path d={'M ' + s * 0.28 + ' ' + s * 0.3 + ' L ' + s * 0.5 + ' ' + s * 0.16 + ' L ' + s * 0.72 + ' ' + s * 0.3 + ' Z'} fill={fill} stroke={stroke} strokeWidth={2} />
			<rect x={s * 0.46} y={s * 0.62} width={s * 0.08} height={s * 0.18} fill={withAlpha(THEME.accent, 0.6)} />
			<circle cx={s * 0.5} cy={s * 0.12} r={s * 0.025} fill={THEME.accent} />
		</g>
	)
}

const MonumentScene: React.FC<{ frames: number; structure: string; headline: string; caption: string }> = ({
	frames,
	structure,
	headline,
	caption,
}) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const size = Math.min(width * 0.62, height * 0.66)
	const reveal = interpolate(frame, [4, 40], [0, 1], { ...CLAMP, easing: EASE_OUT })
	const sweep = interpolate(frame, [10, 70], [-0.4, 1.4], CLAMP)

	return (
		<AbsoluteFill>
			<Backdrop seed={5} intensity={0.9} />
			<ParticleField count={22} speed={0.28} color={THEME.accentAlt} size={4} />
			<AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
				<div
					style={{
						width: size,
						height: size,
						position: 'relative',
						opacity: reveal,
						transform: 'translateY(' + ((1 - reveal) * unit * 40).toFixed(1) + 'px)',
					}}
				>
					<svg width={Math.round(size)} height={Math.round(size)} viewBox={'0 0 ' + Math.round(size) + ' ' + Math.round(size)}>
						{monumentShapes(structure, size)}
					</svg>
					<div
						style={{
							position: 'absolute',
							top: 0,
							left: (sweep * size).toFixed(1) + 'px',
							width: size * 0.14,
							height: '100%',
							backgroundColor: withAlpha(THEME.glow, 0.18),
							filter: 'blur(' + (unit * 18).toFixed(0) + 'px)',
						}}
					/>
					<div
						style={{
							position: 'absolute',
							bottom: -unit * 10,
							left: '10%',
							width: '80%',
							height: unit * 16,
							borderRadius: '50%',
							backgroundColor: withAlpha('#000000', 0.45),
							filter: 'blur(' + (unit * 14).toFixed(0) + 'px)',
						}}
					/>
				</div>
			</AbsoluteFill>
			<AbsoluteFill
				style={{
					justifyContent: 'flex-end',
					alignItems: 'center',
					paddingBottom: height * 0.085,
					gap: unit * 16,
					flexDirection: 'column',
				}}
			>
				<Headline text={headline} size={unit * 62} delay={16} uppercase weight={800} maxWidth={unit * 900} />
				<Copy text={caption} delay={26} size={unit * 27} maxWidth={unit * 700} />
			</AbsoluteFill>
			<SceneEdge frames={frames} />
		</AbsoluteFill>
	)
}
`,
	gallery: `
type GalleryItemData = { title: string; detail: string; icon: IconName }

const GalleryScene: React.FC<{ frames: number; headline: string; items: GalleryItemData[] }> = ({
	frames,
	headline,
	items,
}) => {
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const columns = width >= height ? Math.min(items.length, 4) : Math.min(items.length, 2)

	return (
		<AbsoluteFill>
			<Backdrop seed={6} intensity={0.8} />
			<SceneFrame gap={unit * 40} push={0.03}>
				<Headline text={headline} size={unit * 62} delay={2} uppercase weight={800} maxWidth={unit * 1000} />
				<div
					style={{
						display: 'grid',
						gridTemplateColumns: 'repeat(' + columns + ', 1fr)',
						gap: unit * 24,
						width: '100%',
					}}
				>
					{items.map((item, index) => (
						<GalleryCard key={item.title + '-' + index} item={item} delay={12 + index * 7} />
					))}
				</div>
			</SceneFrame>
			<SceneEdge frames={frames} />
		</AbsoluteFill>
	)
}

const GalleryCard: React.FC<{ item: GalleryItemData; delay: number }> = ({ item, delay }) => {
	const unit = useUnit()
	const enter = useSpringIn(delay, 175)

	return (
		<div
			style={{
				display: 'flex',
				flexDirection: 'column',
				gap: unit * 14,
				padding: unit * 26,
				borderRadius: unit * 22,
				backgroundColor: withAlpha(THEME.surface, 0.72),
				border: '1px solid ' + withAlpha(THEME.ink, 0.1),
				textAlign: 'left',
				opacity: enter,
				transform: 'translateY(' + ((1 - enter) * unit * 32).toFixed(1) + 'px) scale(' + (0.95 + enter * 0.05).toFixed(3) + ')',
				boxShadow: '0 ' + (unit * 18).toFixed(0) + 'px ' + (unit * 40).toFixed(0) + 'px ' + withAlpha('#000000', 0.28),
			}}
		>
			<VectorIcon name={item.icon} size={unit * 46} color={THEME.accent} strokeWidth={1.7} glow />
			<span style={{ fontFamily: DISPLAY_FONT, fontSize: unit * 34, fontWeight: 800, color: THEME.ink, lineHeight: 1.15 }}>
				{item.title}
			</span>
			{item.detail ? (
				<span style={{ fontFamily: TEXT_FONT, fontSize: unit * 23, color: THEME.muted, lineHeight: 1.4 }}>
					{item.detail}
				</span>
			) : null}
		</div>
	)
}
`,
	stats: `
type StatData = { value: number; prefix: string; suffix: string; label: string; decimals: number }

const StatsScene: React.FC<{ frames: number; headline: string; stats: StatData[] }> = ({ frames, headline, stats }) => {
	const unit = useUnit()
	const { width, height } = useVideoConfig()

	return (
		<AbsoluteFill>
			<Backdrop seed={7} intensity={1.1} />
			<SceneFrame gap={unit * 46} push={0.03}>
				<Headline text={headline} size={unit * 58} delay={2} uppercase weight={800} maxWidth={unit * 1000} />
				<div
					style={{
						display: 'flex',
						flexDirection: width >= height ? 'row' : 'column',
						gap: unit * 34,
						width: '100%',
						justifyContent: 'center',
						alignItems: width >= height ? 'flex-start' : 'center',
					}}
				>
					{stats.map((stat, index) => (
						<StatCounter key={stat.label + '-' + index} stat={stat} delay={12 + index * 8} />
					))}
				</div>
			</SceneFrame>
			<SceneEdge frames={frames} />
		</AbsoluteFill>
	)
}

const StatCounter: React.FC<{ stat: StatData; delay: number }> = ({ stat, delay }) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const enter = useSpringIn(delay, 190)
	const count = interpolate(frame, [delay, delay + 34], [0, stat.value], { ...CLAMP, easing: EASE_OUT })

	return (
		<div
			style={{
				flex: 1,
				display: 'flex',
				flexDirection: 'column',
				alignItems: 'center',
				gap: unit * 10,
				opacity: enter,
				transform: 'translateY(' + ((1 - enter) * unit * 26).toFixed(1) + 'px)',
			}}
		>
			<span
				style={{
					fontFamily: DISPLAY_FONT,
					fontSize: unit * 112,
					fontWeight: 800,
					color: THEME.accent,
					letterSpacing: -unit * 2,
					lineHeight: 1,
					textShadow: '0 0 ' + (unit * 40).toFixed(0) + 'px ' + withAlpha(THEME.glow, 0.35),
				}}
			>
				{stat.prefix + count.toFixed(stat.decimals) + stat.suffix}
			</span>
			<div style={{ width: unit * 90, height: unit * 3, backgroundColor: withAlpha(THEME.ink, 0.22) }} />
			<span
				style={{
					fontFamily: TEXT_FONT,
					fontSize: unit * 26,
					color: THEME.muted,
					textAlign: 'center',
					maxWidth: unit * 320,
					lineHeight: 1.35,
				}}
			>
				{stat.label}
			</span>
		</div>
	)
}
`,
	chart: `
type ChartBarData = { label: string; value: number }

const ChartScene: React.FC<{ frames: number; headline: string; unit: string; bars: ChartBarData[] }> = ({
	frames,
	headline,
	unit: valueUnit,
	bars,
}) => {
	const frame = useCurrentFrame()
	const u = useUnit()
	const { width, height } = useVideoConfig()
	const plotHeight = height * 0.4
	const max = Math.max(...bars.map((bar) => bar.value), 1)

	return (
		<AbsoluteFill>
			<Backdrop seed={8} intensity={0.75} />
			<SceneFrame gap={u * 40} push={0.02}>
				<Headline text={headline} size={u * 56} delay={2} uppercase weight={800} maxWidth={u * 1000} />
				<div style={{ width: '100%', position: 'relative', height: plotHeight }}>
					{[0, 0.25, 0.5, 0.75, 1].map((line) => (
						<div
							key={'grid-' + line}
							style={{
								position: 'absolute',
								left: 0,
								right: 0,
								bottom: line * plotHeight,
								height: 1,
								backgroundColor: withAlpha(THEME.ink, line === 0 ? 0.28 : 0.09),
							}}
						/>
					))}
					<div
						style={{
							position: 'absolute',
							inset: 0,
							display: 'flex',
							alignItems: 'flex-end',
							justifyContent: 'space-between',
							gap: u * 18,
						}}
					>
						{bars.map((bar, index) => {
							const delay = 14 + index * 6
							const grow = interpolate(frame, [delay, delay + 30], [0, 1], { ...CLAMP, easing: EASE_OUT })
							const value = bar.value * grow
							return (
								<div
									key={bar.label + '-' + index}
									style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: u * 10 }}
								>
									<span style={{ fontFamily: DISPLAY_FONT, fontSize: u * 30, fontWeight: 800, color: THEME.ink, opacity: grow }}>
										{value.toFixed(value >= 100 ? 0 : 1) + valueUnit}
									</span>
									<div
										style={{
											width: '100%',
											height: (bar.value / max) * (plotHeight - u * 70) * grow,
											borderRadius: u * 10,
											backgroundColor: index % 2 === 0 ? THEME.accent : THEME.accentAlt,
											boxShadow: '0 0 ' + (u * 28).toFixed(0) + 'px ' + withAlpha(THEME.glow, 0.3),
										}}
									/>
								</div>
							)
						})}
					</div>
				</div>
				<div style={{ width: '100%', display: 'flex', justifyContent: 'space-between', gap: u * 18 }}>
					{bars.map((bar, index) => (
						<span
							key={'label-' + index}
							style={{
								flex: 1,
								textAlign: 'center',
								fontFamily: TEXT_FONT,
								fontSize: u * 24,
								color: THEME.muted,
							}}
						>
							{bar.label}
						</span>
					))}
				</div>
			</SceneFrame>
			<SceneEdge frames={frames} />
		</AbsoluteFill>
	)
}
`,
	process: `
type ProcessStepData = { title: string; detail: string; icon: IconName }

const ProcessScene: React.FC<{ frames: number; headline: string; steps: ProcessStepData[] }> = ({
	frames,
	headline,
	steps,
}) => {
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const row = width >= height

	return (
		<AbsoluteFill>
			<Backdrop seed={9} intensity={0.85} />
			<SceneFrame gap={unit * 44} push={0.03}>
				<Headline text={headline} size={unit * 56} delay={2} uppercase weight={800} maxWidth={unit * 1000} />
				<div
					style={{
						display: 'flex',
						flexDirection: row ? 'row' : 'column',
						alignItems: row ? 'flex-start' : 'stretch',
						gap: unit * 20,
						width: '100%',
					}}
				>
					{steps.map((step, index) => (
						<React.Fragment key={step.title + '-' + index}>
							<ProcessCard step={step} index={index} delay={12 + index * 9} />
							{index < steps.length - 1 ? <ProcessLink delay={17 + index * 9} row={row} /> : null}
						</React.Fragment>
					))}
				</div>
			</SceneFrame>
			<SceneEdge frames={frames} />
		</AbsoluteFill>
	)
}

const ProcessCard: React.FC<{ step: ProcessStepData; index: number; delay: number }> = ({ step, index, delay }) => {
	const unit = useUnit()
	const enter = useSpringIn(delay, 180)

	return (
		<div
			style={{
				flex: 1,
				display: 'flex',
				flexDirection: 'column',
				gap: unit * 12,
				padding: unit * 24,
				borderRadius: unit * 20,
				backgroundColor: withAlpha(THEME.surface, 0.7),
				border: '1px solid ' + withAlpha(THEME.accent, 0.22),
				textAlign: 'left',
				opacity: enter,
				transform: 'translateY(' + ((1 - enter) * unit * 28).toFixed(1) + 'px)',
			}}
		>
			<div style={{ display: 'flex', alignItems: 'center', gap: unit * 12 }}>
				<span
					style={{
						fontFamily: DISPLAY_FONT,
						fontSize: unit * 30,
						fontWeight: 800,
						color: THEME.background,
						backgroundColor: THEME.accent,
						width: unit * 46,
						height: unit * 46,
						borderRadius: unit * 46,
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
					}}
				>
					{index + 1}
				</span>
				<VectorIcon name={step.icon} size={unit * 32} color={THEME.accentAlt} strokeWidth={1.7} />
			</div>
			<span style={{ fontFamily: DISPLAY_FONT, fontSize: unit * 32, fontWeight: 800, color: THEME.ink, lineHeight: 1.15 }}>
				{step.title}
			</span>
			{step.detail ? (
				<span style={{ fontFamily: TEXT_FONT, fontSize: unit * 22, color: THEME.muted, lineHeight: 1.4 }}>
					{step.detail}
				</span>
			) : null}
		</div>
	)
}

const ProcessLink: React.FC<{ delay: number; row: boolean }> = ({ delay, row }) => {
	const unit = useUnit()
	const enter = useSpringIn(delay, 200)

	return (
		<div
			style={{
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				width: row ? unit * 44 : '100%',
				height: row ? '100%' : unit * 34,
				opacity: enter,
				transform: row
					? 'translateX(' + ((1 - enter) * -unit * 14).toFixed(1) + 'px)'
					: 'translateY(' + ((1 - enter) * -unit * 14).toFixed(1) + 'px) rotate(90deg)',
			}}
		>
			<VectorIcon name="arrow" size={unit * 32} color={THEME.accent} strokeWidth={2} />
		</div>
	)
}
`,
	quote: `
const QuoteScene: React.FC<{ frames: number; quote: string; attribution: string }> = ({
	frames,
	quote,
	attribution,
}) => {
	const unit = useUnit()

	return (
		<AbsoluteFill>
			<Backdrop seed={10} intensity={0.7} />
			<SceneFrame gap={unit * 26} push={0.04}>
				<span
					style={{
						fontFamily: DISPLAY_FONT,
						fontSize: unit * 150,
						lineHeight: 0.7,
						color: withAlpha(THEME.accent, 0.5),
					}}
				>
					&ldquo;
				</span>
				<Headline
					text={quote}
					size={unit * 62}
					delay={6}
					stagger={2.4}
					weight={600}
					tracking={-unit * 0.4}
					maxWidth={unit * 980}
				/>
				<Rule delay={26} width={unit * 160} />
				<Copy text={attribution} delay={30} size={unit * 28} weight={600} />
			</SceneFrame>
			<SceneEdge frames={frames} />
		</AbsoluteFill>
	)
}
`,
	cta: `
const CtaScene: React.FC<{
	frames: number
	headline: string
	subline: string
	tagline: string
	icon: IconName
}> = ({ frames, headline, subline, tagline, icon }) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width } = useVideoConfig()
	const settle = interpolate(frame, [0, 40], [0, 1], { ...CLAMP, easing: EASE_OUT })

	return (
		<AbsoluteFill>
			<Backdrop seed={11} intensity={1.3} />
			<ParticleField count={34} speed={0.6} color={THEME.accentAlt} />
			<SceneFrame gap={unit * 26} push={0.05}>
				<IconBadge name={icon} size={unit * 104} delay={2} color={THEME.accentAlt} />
				<Headline
					text={headline}
					size={unit * 96}
					delay={8}
					stagger={3.5}
					uppercase
					weight={800}
					tracking={-unit * 1.4}
					maxWidth={unit * 1000}
				/>
				<Rule delay={22} width={Math.min(width * 0.4, unit * 480)} />
				<Copy text={subline} delay={26} size={unit * 30} />
				{tagline ? (
					<div
						style={{
							marginTop: unit * 12,
							padding: unit * 12 + 'px ' + unit * 26 + 'px',
							borderRadius: unit * 100,
							backgroundColor: withAlpha(THEME.accent, 0.14),
							border: '1px solid ' + withAlpha(THEME.accent, 0.4),
							fontFamily: TEXT_FONT,
							fontSize: unit * 24,
							letterSpacing: unit * 3,
							textTransform: 'uppercase',
							color: THEME.accent,
							opacity: settle,
						}}
					>
						{tagline}
					</div>
				) : null}
			</SceneFrame>
			<SceneEdge frames={frames} />
		</AbsoluteFill>
	)
}
`,
}

/** A per-scene edge treatment: keeps the first frames of every cut readable. */
const SCENE_EDGE = `
const SceneEdge: React.FC<{ frames: number }> = ({ frames }) => {
	const frame = useCurrentFrame()
	const shade = interpolate(frame, [0, 10, frames - 8, frames], [0.5, 0, 0, 0.35], CLAMP)

	return <AbsoluteFill style={{ backgroundColor: withAlpha(THEME.background, shade), pointerEvents: 'none' }} />
}
`

function sceneProps(scene: Scene, frames: number): string {
	const common = `frames={${frames}}`
	switch (scene.type) {
		case 'title':
			return `${common} kicker={${json(scene.kicker)}} headline={${json(scene.headline)}} subline={${json(scene.subline)}} icon={${json(scene.icon)}}`
		case 'statement':
			return `${common} text={${json(scene.text)}} highlight={${json(scene.highlight)}} footnote={${json(scene.footnote)}}`
		case 'timeline':
			return `${common} headline={${json(scene.headline)}} events={${json(scene.events)}}`
		case 'map':
			return `${common} headline={${json(scene.headline)}} caption={${json(scene.caption)}} places={${json(scene.places)}} connect={${scene.connect}}`
		case 'landscape':
			return `${common} terrain={${json(scene.terrain)}} timeOfDay={${json(scene.timeOfDay)}} headline={${json(scene.headline)}} caption={${json(scene.caption)}}`
		case 'monument':
			return `${common} structure={${json(scene.structure)}} headline={${json(scene.headline)}} caption={${json(scene.caption)}}`
		case 'gallery':
			return `${common} headline={${json(scene.headline)}} items={${json(scene.items)}}`
		case 'stats':
			return `${common} headline={${json(scene.headline)}} stats={${json(scene.stats)}}`
		case 'chart':
			return `${common} headline={${json(scene.headline)}} unit={${json(scene.unit)}} bars={${json(scene.bars)}}`
		case 'process':
			return `${common} headline={${json(scene.headline)}} steps={${json(scene.steps)}}`
		case 'quote':
			return `${common} quote={${json(scene.quote)}} attribution={${json(scene.attribution)}}`
		case 'cta':
			return `${common} headline={${json(scene.headline)}} subline={${json(scene.subline)}} tagline={${json(scene.tagline)}} icon={${json(scene.icon)}}`
		default:
			return common
	}
}

type Presentation = 'fade' | 'slide' | 'wipe'

function presentationFor(storyboard: Storyboard, index: number, next: Scene): Presentation {
	if (storyboard.motion === 'calm') return 'fade'
	if (next.type === 'landscape' || next.type === 'monument' || next.type === 'quote') return 'fade'
	if (storyboard.motion === 'punchy') return index % 2 === 0 ? 'slide' : 'wipe'
	return index % 3 === 1 ? 'slide' : 'fade'
}

function presentationCall(presentation: Presentation, index: number): string {
	if (presentation === 'slide') {
		return `slide({ direction: '${index % 4 === 0 ? 'from-right' : 'from-bottom'}' })`
	}
	if (presentation === 'wipe') {
		return `wipe({ direction: '${index % 4 === 1 ? 'from-left' : 'from-top'}' })`
	}
	return 'fade()'
}

type SoundCue = { id: string; asset: string; from: number; durationInFrames: number; volume: number }

function soundCues(storyboard: Storyboard, layout: StoryboardLayout): SoundCue[] {
	const cues: SoundCue[] = []
	const fps = layout.fps
	const punchy = storyboard.motion === 'punchy'

	cues.push({
		id: 'open-impact',
		asset: SFX_KIT[punchy ? 'impactSnap' : 'impactDeep'],
		from: 2,
		durationInFrames: Math.round(fps * 2),
		volume: 0.55,
	})

	for (const [index, timing] of layout.timings.entries()) {
		if (index > 0) {
			cues.push({
				id: `cut-${index}`,
				asset: SFX_KIT[punchy ? 'whooshFast' : 'whooshDeep'],
				from: Math.max(0, timing.from - Math.round(fps * 0.2)),
				durationInFrames: Math.round(fps * 1.2),
				volume: 0.4,
			})
		}

		const scene = timing.scene
		if (scene.type === 'stats' || scene.type === 'chart') {
			cues.push({
				id: `data-${index}`,
				asset: SFX_KIT.powerUp,
				from: timing.from + 8,
				durationInFrames: Math.round(fps * 1.6),
				volume: 0.34,
			})
		}
		if (scene.type === 'gallery' || scene.type === 'process' || scene.type === 'timeline') {
			cues.push({
				id: `list-${index}`,
				asset: SFX_KIT.popClean,
				from: timing.from + 10,
				durationInFrames: Math.round(fps * 1),
				volume: 0.3,
			})
		}
		if (scene.type === 'monument' || scene.type === 'landscape') {
			cues.push({
				id: `reveal-${index}`,
				asset: SFX_KIT.revealShimmer,
				from: timing.from + 6,
				durationInFrames: Math.round(fps * 2),
				volume: 0.3,
			})
		}
		if (scene.type === 'cta') {
			cues.push({
				id: `stinger-${index}`,
				asset: SFX_KIT.logoStinger,
				from: timing.from + 4,
				durationInFrames: Math.round(fps * 2.4),
				volume: 0.42,
			})
		}
	}

	return cues.filter((cue) => cue.from < layout.durationInFrames)
}

/** Builds the complete TSX file for a storyboard. */
export function composeVideoSource(storyboard: Storyboard): ComposedVideo {
	const layout = layoutStoryboard(storyboard)
	const palette = PALETTES[storyboard.palette]
	const display = FONT_KIT[storyboard.displayFont]
	const body = FONT_KIT[storyboard.textFont]
	const icons = usedIcons(storyboard)
	const types = [...new Set(layout.timings.map((timing) => timing.scene.type))]
	const compositionId = pascalCase(storyboard.title || storyboard.subject || 'AiVideo') || 'AiVideo'
	const cues = soundCues(storyboard, layout)
	const summary = storyboardSummary(storyboard, layout)

	const presentations = new Set<Presentation>()
	for (const [index, timing] of layout.timings.entries()) {
		if (index < layout.timings.length - 1) {
			presentations.add(presentationFor(storyboard, index, layout.timings[index + 1].scene))
		}
	}

	const transitionImports = ['fade', 'slide', 'wipe'].filter((name) =>
		presentations.has(name as Presentation),
	)

	const out: string[] = []

	out.push(`/**
 * ${storyboard.title}
 *
 * Generated by Remotion Video Studio - AI director.
 * Brief   : ${storyboard.concept.replace(/\*\//g, '*')}
 * Plan    : ${summary}
 * Palette : ${storyboard.palette} · Type: ${display.family} / ${body.family} · Music: ${storyboard.music}
 *
 * Everything animates from useCurrentFrame(), so preview, browser export and
 * server render produce identical frames. Edit any constant below and the
 * Studio recompiles instantly.
 */

import React from 'react'
import {
	AbsoluteFill,
	Composition,
	Easing,
	Img,
	Sequence,
	interpolate,
	random,
	registerRoot,
	spring,
	staticFile,
	useCurrentFrame,
	useVideoConfig,
} from 'remotion'
import { Audio } from '@remotion/media'
import { loadFont } from '@remotion/fonts'
import { TransitionSeries, linearTiming } from '@remotion/transitions'`)

	for (const name of transitionImports) {
		out.push(`import { ${name} } from '@remotion/transitions/${name}'`)
	}

	out.push(`
/* -------------------------------------------------------------------------- */
/*  Format                                                                    */
/* -------------------------------------------------------------------------- */

export const VIDEO = {
	id: '${compositionId}',
	width: ${layout.width},
	height: ${layout.height},
	fps: ${layout.fps},
	durationInFrames: ${layout.durationInFrames},
} as const

/* -------------------------------------------------------------------------- */
/*  Theme                                                                     */
/* -------------------------------------------------------------------------- */

export const THEME = {
	background: '${palette.background}',
	backgroundAlt: '${palette.backgroundAlt}',
	surface: '${palette.surface}',
	ink: '${palette.ink}',
	muted: '${palette.muted}',
	accent: '${palette.accent}',
	accentAlt: '${palette.accentAlt}',
	glow: '${palette.glow}',
} as const

loadFont({
	family: '${display.family}',
	url: staticFile('assets/fonts/v1/${display.file}'),
	weight: '${display.weight}',
})
loadFont({
	family: '${body.family}',
	url: staticFile('assets/fonts/v1/${body.file}'),
	weight: '${body.weight}',
})

const DISPLAY_FONT = "'${display.family}', ${display.fallback}"
const TEXT_FONT = "'${body.family}', ${body.fallback}"

/* -------------------------------------------------------------------------- */
/*  Iconography                                                               */
/* -------------------------------------------------------------------------- */

const ICON_PATHS = {`)

	for (const icon of icons) {
		out.push(`\t${icon}: ${json(ICON_PATHS[icon])},`)
	}

	out.push(`} as const

type IconName = keyof typeof ICON_PATHS
`)

	out.push(HELPERS)
	out.push(SCENE_EDGE)

	for (const type of types) {
		out.push(SCENES[type])
	}

	/* Finishing layer ------------------------------------------------------- */
	const grainSource =
		storyboard.grain === 'none' ? null : `staticFile('assets/texture/v1/${GRAIN_KIT[storyboard.grain]}')`
	const leakSource =
		storyboard.leak === 'none' ? null : `staticFile('assets/texture/v1/${LEAK_KIT[storyboard.leak]}')`

	out.push(`
/* -------------------------------------------------------------------------- */
/*  Finishing layer                                                           */
/* -------------------------------------------------------------------------- */

const VIGNETTE_SRC = staticFile('assets/texture/v1/${VIGNETTE_TEXTURE}')
${grainSource ? `const GRAIN_SRC = ${grainSource}` : ''}
${leakSource ? `const LEAK_SRC = ${leakSource}` : ''}

const FilmLayer: React.FC = () => {
	const frame = useCurrentFrame()
	const drift = (frame % 12) - 6
	const leakShift = interpolate(frame, [0, VIDEO.durationInFrames], [-8, 8])

	return (
		<AbsoluteFill style={{ pointerEvents: 'none' }}>
			<Img
				src={VIGNETTE_SRC}
				style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: 0.55 }}
			/>${
				leakSource
					? `
			<Img
				src={LEAK_SRC}
				style={{
					position: 'absolute',
					inset: '-6%',
					width: '112%',
					height: '112%',
					objectFit: 'cover',
					opacity: 0.22,
					mixBlendMode: 'screen',
					transform: 'translateX(' + leakShift.toFixed(2) + 'px)',
				}}
			/>`
					: ''
			}${
				grainSource
					? `
			<Img
				src={GRAIN_SRC}
				style={{
					position: 'absolute',
					inset: '-4%',
					width: '108%',
					height: '108%',
					objectFit: 'cover',
					opacity: 0.17,
					mixBlendMode: 'overlay',
					transform: 'translate(' + drift + 'px, ' + -drift + 'px)',
				}}
			/>`
					: ''
			}
		</AbsoluteFill>
	)
}

const Curtain: React.FC = () => {
	const frame = useCurrentFrame()
	const opacity = interpolate(
		frame,
		[0, ${Math.round(layout.fps * 0.5)}, ${Math.max(1, layout.durationInFrames - Math.round(layout.fps * 0.7))}, ${layout.durationInFrames}],
		[1, 0, 0, 1],
		CLAMP,
	)

	return <AbsoluteFill style={{ backgroundColor: THEME.background, opacity, pointerEvents: 'none' }} />
}

/* -------------------------------------------------------------------------- */
/*  Soundtrack                                                                */
/* -------------------------------------------------------------------------- */

type SoundCue = { id: string; src: string; from: number; durationInFrames: number; volume: number }

const MUSIC_SRC = staticFile('assets/audio/v1/${MUSIC_KIT[storyboard.music].file}')

const SOUND_CUES: SoundCue[] = [`)

	for (const cue of cues) {
		out.push(
			`\t{ id: '${cue.id}', src: staticFile('assets/audio/v1/${cue.asset}'), from: ${cue.from}, durationInFrames: ${cue.durationInFrames}, volume: ${cue.volume} },`,
		)
	}

	out.push(`]

const Soundtrack: React.FC = () => (
	<>
		<Audio
			src={MUSIC_SRC}
			loop
			loopVolumeCurveBehavior="extend"
			volume={(frame) =>
				interpolate(
					frame,
					[0, ${Math.round(layout.fps * 1.2)}, ${Math.max(2, layout.durationInFrames - Math.round(layout.fps * 1.4))}, ${layout.durationInFrames}],
					[0, ${storyboard.motion === 'punchy' ? 0.42 : 0.32}, ${storyboard.motion === 'punchy' ? 0.42 : 0.32}, 0],
					CLAMP,
				)
			}
		/>
		{SOUND_CUES.map((cue) => (
			<Sequence key={cue.id} name={'SFX - ' + cue.id} from={cue.from} durationInFrames={cue.durationInFrames} layout="none">
				<Audio src={cue.src} volume={cue.volume} />
			</Sequence>
		))}
	</>
)

/* -------------------------------------------------------------------------- */
/*  Edit                                                                      */
/* -------------------------------------------------------------------------- */

export const ${compositionId}Video: React.FC = () => (
	<AbsoluteFill style={{ backgroundColor: THEME.background, fontFamily: TEXT_FONT }}>
		<TransitionSeries>`)

	for (const [index, timing] of layout.timings.entries()) {
		const component = SCENE_COMPONENT[timing.scene.type]
		out.push(`			<TransitionSeries.Sequence durationInFrames={${timing.durationInFrames}}>
				<${component} ${sceneProps(timing.scene, timing.durationInFrames)} />
			</TransitionSeries.Sequence>`)
		if (index < layout.timings.length - 1 && timing.transitionOut > 0) {
			const presentation = presentationFor(storyboard, index, layout.timings[index + 1].scene)
			out.push(`			<TransitionSeries.Transition
				presentation={${presentationCall(presentation, index)}}
				timing={linearTiming({ durationInFrames: ${timing.transitionOut} })}
			/>`)
		}
	}

	out.push(`		</TransitionSeries>
		<FilmLayer />
		<Curtain />
		<Soundtrack />
	</AbsoluteFill>
)

export const Root: React.FC = () => (
	<Composition
		id={VIDEO.id}
		component={${compositionId}Video}
		durationInFrames={VIDEO.durationInFrames}
		fps={VIDEO.fps}
		width={VIDEO.width}
		height={VIDEO.height}
	/>
)

registerRoot(Root)

export default ${compositionId}Video
`)

	return {
		code: out.join('\n'),
		fileName: 'ai-generated-video.tsx',
		projectName: storyboard.title || storyboard.subject || 'AI generated video',
		compositionId,
		layout,
		summary,
	}
}
