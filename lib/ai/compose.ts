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
	SFX_LEGACY_FAMILY,
	VIGNETTE_TEXTURE,
	sfxVariantPath,
	visualVariantPath,
	type IconId,
	type Palette,
	type SfxId,
	type SfxVariantFamilyId,
} from './kit'
import {
	THREE_SCENE_TYPES,
	layoutStoryboard,
	storyboardSummary,
	type Scene,
	type SceneType,
	type Storyboard,
	type StoryboardLayout,
} from './storyboard'
import { creativeSeedSuffix, seededIndex, type CreativeProfile } from './variation'

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
	object3d: 'Object3dScene',
	globe3d: 'Globe3dScene',
	terrain3d: 'Terrain3dScene',
	carousel3d: 'Carousel3dScene',
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

/**
 * Rotates a hex colour around the colour wheel, keeping its saturation and
 * lightness. The twelve palettes are hand-tuned for contrast, so shifting only
 * the hue of the accents multiplies the colour worlds available without ever
 * producing an unreadable pairing.
 */
function rotateHue(hex: string, degrees: number): string {
	const value = hex.replace('#', '')
	const r = Number.parseInt(value.slice(0, 2), 16) / 255
	const g = Number.parseInt(value.slice(2, 4), 16) / 255
	const b = Number.parseInt(value.slice(4, 6), 16) / 255
	const max = Math.max(r, g, b)
	const min = Math.min(r, g, b)
	const lightness = (max + min) / 2
	const delta = max - min
	if (delta === 0 || degrees % 360 === 0) return hex.toUpperCase()

	const saturation = delta / (1 - Math.abs(2 * lightness - 1))
	let hue: number
	if (max === r) hue = ((g - b) / delta) % 6
	else if (max === g) hue = (b - r) / delta + 2
	else hue = (r - g) / delta + 4
	hue = (((hue * 60 + degrees) % 360) + 360) % 360

	const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation
	const second = chroma * (1 - Math.abs(((hue / 60) % 2) - 1))
	const match = lightness - chroma / 2
	const [rp, gp, bp] =
		hue < 60
			? [chroma, second, 0]
			: hue < 120
				? [second, chroma, 0]
				: hue < 180
					? [0, chroma, second]
					: hue < 240
						? [0, second, chroma]
						: hue < 300
							? [second, 0, chroma]
							: [chroma, 0, second]
	const channel = (part: number) =>
		Math.round(Math.min(255, Math.max(0, (part + match) * 255)))
			.toString(16)
			.padStart(2, '0')
	return `#${channel(rp)}${channel(gp)}${channel(bp)}`.toUpperCase()
}

/**
 * The palette as this generation actually uses it: the accent hues rotated by
 * the creative profile, and optionally swapped so the same base palette leads
 * with its secondary colour.
 */
function themeFor(palette: Palette, profile: CreativeProfile): Palette {
	const accent = rotateHue(palette.accent, profile.paletteShift)
	const accentAlt = rotateHue(palette.accentAlt, profile.paletteShift)
	return {
		...palette,
		accent: profile.accentSwap ? accentAlt : accent,
		accentAlt: profile.accentSwap ? accent : accentAlt,
		glow: rotateHue(palette.glow, profile.paletteShift),
	}
}

function usedIcons(storyboard: Storyboard): IconId[] {
	const icons = new Set<IconId>(['spark', 'arrow'])
	for (const scene of storyboard.scenes) {
		if (scene.type === 'title' || scene.type === 'cta') icons.add(scene.icon)
		if (scene.type === 'gallery' || scene.type === 'carousel3d') {
			scene.items.forEach((item) => icons.add(item.icon))
		}
		if (scene.type === 'globe3d') icons.add('globe')
		if (scene.type === 'terrain3d') icons.add('mountain')
		if (scene.type === 'object3d') icons.add('cube')
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

const safeTextWeight = (desired: number): number =>
	Math.round(Math.min(TEXT_WEIGHT_MAX, Math.max(TEXT_WEIGHT_MIN, desired)))

/* ---------------------------------------------------------------------- */
/*  Design tokens for this generation's house style                       */
/* ---------------------------------------------------------------------- */

/** Corner radius in design units. 'sharp' means genuinely square. */
const cornerRadius = (unit: number, scale = 1): number =>
	CREATIVE.cornerStyle === 'sharp' ? 0 : CREATIVE.cornerStyle === 'pill' ? unit * 100 : unit * 14 * scale

/** Extra letter-spacing the type recipe wants, as a fraction of the size. */
const trackingFor = (size: number): number =>
	CREATIVE.typography === 'technical' || CREATIVE.typography === 'mono-terminal'
		? size * 0.018
		: CREATIVE.typography === 'condensed-stack'
			? size * 0.008
			: CREATIVE.typography === 'editorial' || CREATIVE.typography === 'serif-luxe'
				? -size * 0.012
				: CREATIVE.typography === 'brutalist'
					? -size * 0.02
					: 0

/** Type recipes that read wrong in italics or with an extruded side. */
const TYPE_IS_FLAT =
	CREATIVE.typography === 'editorial' ||
	CREATIVE.typography === 'friendly' ||
	CREATIVE.typography === 'serif-luxe' ||
	CREATIVE.typography === 'handwritten' ||
	CREATIVE.typography === 'mono-terminal'

/** Type recipes that must never be shouted in capitals. */
const TYPE_KEEPS_CASE =
	CREATIVE.typography === 'editorial' ||
	CREATIVE.typography === 'friendly' ||
	CREATIVE.typography === 'serif-luxe' ||
	CREATIVE.typography === 'handwritten'

/** Applies the house style's casing to one piece of copy. */
const casedText = (value: string, uppercase: boolean): string => {
	if (TYPE_KEEPS_CASE) return value
	if (CREATIVE.textCase === 'upper' || uppercase) return value.toUpperCase()
	if (CREATIVE.textCase === 'sentence') {
		return value.length > 1 ? value[0].toUpperCase() + value.slice(1).toLowerCase() : value.toUpperCase()
	}
	return value
}

/** Mixes a colour toward black, used for the shaded sides of extruded type. */
const shade = (hex: string, amount: number): string => {
	const value = hex.replace('#', '')
	const channel = (start: number) =>
		Math.round(Number.parseInt(value.slice(start, start + 2), 16) * (1 - amount))
	return 'rgb(' + channel(0) + ', ' + channel(2) + ', ' + channel(4) + ')'
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

/**
 * The page geometry for this generation's house style.
 *
 * Every component reads these three constants rather than testing the layout id
 * itself, so the headline, the artwork and the stage can never disagree about
 * which edge the film is composed against.
 */
const LAYOUT_LEFT =
	CREATIVE.layout === 'editorial-left' ||
	CREATIVE.layout === 'offset-stack' ||
	CREATIVE.layout === 'banner-top' ||
	CREATIVE.layout === 'corner-anchor' ||
	CREATIVE.layout === 'split-vertical'
const LAYOUT_RIGHT = CREATIVE.layout === 'column-right'
/** Fraction of the frame kept as breathing room on each side. */
const LAYOUT_INSET =
	CREATIVE.layout === 'full-bleed'
		? 0.038
		: CREATIVE.layout === 'poster'
			? 0.105
			: CREATIVE.layout === 'wide-stage'
				? 0.06
				: 0.078

/**
 * The camera. In depth and three modes the whole layout lives on a perspective
 * stage that dollies in and drifts a couple of degrees, so flat elements pick
 * up parallax instead of sitting on glass. In flat mode the same component
 * still owns the page geometry, minus the perspective.
 */
const SceneFrame: React.FC<{
	children: React.ReactNode
	align?: 'center' | 'flex-start'
	justify?: 'center' | 'flex-end' | 'flex-start'
	push?: number
	gap?: number
	tilt?: number
}> = ({ children, align = 'center', justify = 'center', push = 0.04, gap = 0, tilt = DEPTH }) => {
	const frame = useCurrentFrame()
	const { width, height } = useVideoConfig()
	const cameraAmount = CREATIVE.camera === 'still' ? 0.18 : CREATIVE.camera === 'drift' ? 0.65 : CREATIVE.camera === 'orbit' ? 1.25 : 0.9
	const scale = interpolate(frame, [0, 260], [1 + push * cameraAmount, 1], CLAMP)
	const yaw = Math.sin(frame / (CREATIVE.camera === 'orbit' ? 86 : 130)) * 2.6 * tilt * cameraAmount
	const pitch = interpolate(frame, [0, 200], [3.4 * tilt * cameraAmount, 0.5 * tilt], CLAMP)
	const resolvedAlign = align === 'center' && (LAYOUT_LEFT || LAYOUT_RIGHT) ? 'flex-start' : align
	const resolvedJustify =
		justify === 'center' && CREATIVE.layout === 'banner-top'
			? 'flex-start'
			: justify === 'center' && CREATIVE.layout === 'corner-anchor'
				? 'flex-end'
				: justify
	const offsetX =
		CREATIVE.layout === 'offset-stack'
			? width * 0.045
			: CREATIVE.layout === 'wide-stage'
				? -width * 0.025
				: CREATIVE.layout === 'column-right'
					? width * 0.185
					: CREATIVE.layout === 'split-vertical'
						? -width * 0.14
						: 0
	const perspectiveOrigin = LAYOUT_RIGHT ? '64% 44%' : LAYOUT_LEFT ? '38% 44%' : '50% 44%'
	const inset = Math.round(width * LAYOUT_INSET)

	return (
		<AbsoluteFill style={{ perspective: tilt > 0 ? width * 1.35 : undefined, perspectiveOrigin }}>
			<AbsoluteFill
				style={{
					paddingLeft: inset,
					paddingRight: inset,
					paddingTop: Math.round(height * (CREATIVE.layout === 'banner-top' ? 0.13 : 0.095)),
					paddingBottom: Math.round(height * (CREATIVE.layout === 'corner-anchor' ? 0.125 : 0.095)),
					display: 'flex',
					flexDirection: 'column',
					alignItems: resolvedAlign,
					justifyContent: resolvedJustify,
					textAlign: resolvedAlign === 'center' ? 'center' : 'left',
					gap,
					transformStyle: 'preserve-3d',
					transform:
						'translateX(' + offsetX.toFixed(2) + 'px) scale(' + scale.toFixed(4) + ') rotateX(' + pitch.toFixed(3) + 'deg) rotateY(' + yaw.toFixed(3) + 'deg)',
				}}
			>
				{children}
			</AbsoluteFill>
		</AbsoluteFill>
	)
}

/** Gives a flat card a physical tilt and a cast shadow on the depth stage. */
const DepthTilt: React.FC<{ children: React.ReactNode; index?: number; lift?: number }> = ({
	children,
	index = 0,
	lift = 1,
}) => {
	const frame = useCurrentFrame()
	if (DEPTH === 0) return <>{children}</>
	const yaw = Math.sin(frame / 90 + index * 0.7) * 3.4
	const push = Math.cos(frame / 110 + index) * 6 * lift

	return (
		<div
			style={{
				display: 'flex',
				flex: 1,
				minWidth: 0,
				transformStyle: 'preserve-3d',
				transform: 'rotateY(' + yaw.toFixed(2) + 'deg) translateZ(' + push.toFixed(2) + 'px)',
			}}
		>
			{children}
		</div>
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
				borderRadius: cornerRadius(unit),
				border: '1px solid ' + withAlpha(color, 0.45),
				backgroundColor: withAlpha(color, 0.09),
				color,
				fontFamily: TEXT_FONT,
				fontSize: unit * 22,
				fontWeight: safeTextWeight(600),
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
					borderRadius: CREATIVE.cornerStyle === 'sharp' ? 0 : unit * 7,
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
	extrude?: number
}> = ({ text, delay, size, color, family, weight, tracking, accent = false, extrude = 0 }) => {
	const enter = useSpringIn(delay, 200)
	const blur = (1 - enter) * 10
	const face = accent ? THEME.accent : color
	const step = size * 0.022
	const layers = extrude > 0 ? new Array(extrude).fill(0) : []

	return (
		<span
			style={{
				position: 'relative',
				display: 'inline-block',
				fontFamily: family,
				fontSize: size,
				fontWeight: family === DISPLAY_FONT ? DISPLAY_WEIGHT : weight,
				letterSpacing: tracking,
				lineHeight: 1.02,
				color: face,
				fontStyle:
					(CREATIVE.typography === 'editorial' || CREATIVE.typography === 'handwritten') && family === DISPLAY_FONT
						? 'italic'
						: undefined,
				WebkitTextStroke:
					(CREATIVE.typography === 'poster' || CREATIVE.typography === 'brutalist') && family === DISPLAY_FONT && !accent
						? Math.max(1, size * (CREATIVE.typography === 'brutalist' ? 0.02 : 0.012)).toFixed(1) + 'px ' + withAlpha(THEME.ink, CREATIVE.typography === 'brutalist' ? 0.32 : 0.16)
						: undefined,
				opacity: enter,
				transform:
					'translateY(' + ((1 - enter) * size * 0.42).toFixed(2) + 'px) scale(' + (0.94 + enter * 0.06).toFixed(4) + ')',
				filter: blur > 0.4 ? 'blur(' + blur.toFixed(2) + 'px)' : undefined,
				textShadow: accent ? '0 0 ' + (size * 0.35).toFixed(0) + 'px ' + withAlpha(THEME.glow, 0.4) : undefined,
			}}
		>
			{/* Solid extruded sides, drawn away from the key light. */}
			{layers.map((_, index) => (
				<span
					key={'extrude-' + index}
					aria-hidden
					style={{
						position: 'absolute',
						left: (index + 1) * step,
						top: (index + 1) * step,
						color: shade(face, 0.45 + (index / Math.max(1, extrude)) * 0.4),
						whiteSpace: 'pre',
					}}
				>
					{text}
				</span>
			))}
			<span style={{ position: 'relative' }}>{text}</span>
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
	extrude?: number
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
	extrude = DEPTH * 5,
}) => {
	const words = text.split(' ').filter(Boolean)
	const accents = highlight
		.toLowerCase()
		.split(' ')
		.filter(Boolean)
	const leftBiased = LAYOUT_LEFT
	const effectiveAlign = align === 'center' && leftBiased ? 'flex-start' : align
	const creativeTracking = tracking + trackingFor(size)
	const creativeExtrude = TYPE_IS_FLAT ? 0 : extrude
	// 'condensed-stack' sets each word on its own line, which is the whole point
	// of the recipe; every other recipe wraps normally.
	const stacked = CREATIVE.typography === 'condensed-stack' && words.length > 1 && words.length <= 5

	return (
		<div
			style={{
				display: 'flex',
				flexWrap: 'wrap',
				flexDirection: stacked ? 'column' : 'row',
				alignItems: stacked ? (effectiveAlign === 'center' ? 'center' : 'flex-start') : undefined,
				gap: stacked ? size * 0.02 : size * 0.24,
				rowGap: stacked ? size * 0.02 : size * 0.12,
				justifyContent: effectiveAlign === 'center' ? 'center' : 'flex-start',
				maxWidth,
			}}
		>
			{words.map((word, index) => (
				<Word
					key={word + '-' + index}
					text={casedText(word, uppercase)}
					delay={delay + index * stagger}
					size={size}
					color={color}
					family={family}
					weight={weight}
					tracking={creativeTracking}
					accent={accents.includes(word.toLowerCase().replace(/[^a-z0-9]/g, ''))}
					extrude={creativeExtrude}
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
				fontWeight: safeTextWeight(weight),
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

/**
 * The divider under a headline, drawn in the house style's rule language.
 * It wipes open from a solid colour, which every export engine renders
 * identically - no gradients, no masks.
 */
const Rule: React.FC<{ delay?: number; width: number; height?: number; color?: string }> = ({
	delay = 0,
	width,
	height,
	color = THEME.accent,
}) => {
	const unit = useUnit()
	const enter = useSpringIn(delay, 210)
	if (CREATIVE.ruleStyle === 'none') return null

	const thickness =
		height ?? Math.max(CREATIVE.ruleStyle === 'thin' ? 1 : 2, unit * (CREATIVE.ruleStyle === 'thin' ? 1.6 : 4))
	const radius = CREATIVE.cornerStyle === 'sharp' ? 0 : thickness
	const glow = CREATIVE.finish === 'luminous' || CREATIVE.finish === 'film'

	if (CREATIVE.ruleStyle === 'dotted') {
		const dots = 24
		return (
			<div style={{ width, height: thickness * 2, display: 'flex', gap: thickness * 1.6, alignItems: 'center' }}>
				{new Array(dots).fill(null).map((_, index) => (
					<div
						key={'rule-dot-' + index}
						style={{
							width: thickness * 1.4,
							height: thickness * 1.4,
							borderRadius: thickness * 2,
							backgroundColor: index / dots <= enter ? color : withAlpha(color, 0.18),
						}}
					/>
				))}
			</div>
		)
	}

	const line = (
		<div style={{ width, height: thickness, backgroundColor: withAlpha(color, 0.18), borderRadius: radius }}>
			<div
				style={{
					width: (enter * 100).toFixed(2) + '%',
					height: '100%',
					backgroundColor: color,
					borderRadius: radius,
					boxShadow: glow ? '0 0 ' + (thickness * 4).toFixed(0) + 'px ' + withAlpha(color, 0.6) : undefined,
				}}
			/>
		</div>
	)

	if (CREATIVE.ruleStyle === 'double') {
		return (
			<div style={{ display: 'flex', flexDirection: 'column', gap: thickness * 1.8 }}>
				{line}
				<div style={{ width: width * 0.42, height: thickness, backgroundColor: withAlpha(color, 0.18), borderRadius: radius }}>
					<div style={{ width: (enter * 100).toFixed(2) + '%', height: '100%', backgroundColor: color, borderRadius: radius }} />
				</div>
			</div>
		)
	}

	return line
}

/**
 * The signature treatment around a scene's main headline.
 *
 * Each house style decorates its headline differently - a printed plate, a
 * drawn box, a heavy underline, a margin bar - which is the single loudest
 * difference a viewer reads between two videos built from the same scenes.
 */
const TitlePlate: React.FC<{ children: React.ReactNode; delay?: number }> = ({ children, delay = 0 }) => {
	const unit = useUnit()
	const enter = useSpringIn(delay, 200)
	const treatment = CREATIVE.titleTreatment

	if (treatment === 'stack' || treatment === 'inline') return <>{children}</>

	if (treatment === 'sidebar') {
		return (
			<div style={{ display: 'flex', alignItems: 'stretch', gap: unit * 26 }}>
				<div
					style={{
						width: Math.max(3, unit * 7),
						borderRadius: cornerRadius(unit, 0.4),
						backgroundColor: THEME.accent,
						transformOrigin: 'top',
						transform: 'scaleY(' + enter.toFixed(4) + ')',
					}}
				/>
				<div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>{children}</div>
			</div>
		)
	}

	if (treatment === 'underline') {
		return (
			<div style={{ display: 'inline-flex', flexDirection: 'column', gap: unit * 14 }}>
				{children}
				<div
					style={{
						height: Math.max(4, unit * 12),
						borderRadius: cornerRadius(unit, 0.3),
						backgroundColor: withAlpha(THEME.accent, 0.85),
						transformOrigin: LAYOUT_LEFT ? 'left' : 'center',
						transform: 'scaleX(' + enter.toFixed(4) + ')',
					}}
				/>
			</div>
		)
	}

	const boxed = treatment === 'boxed'
	return (
		<div
			style={{
				display: 'inline-flex',
				padding: unit * (boxed ? 28 : 24) + 'px ' + unit * (boxed ? 40 : 34) + 'px',
				borderRadius: cornerRadius(unit, 1.6),
				backgroundColor: boxed ? withAlpha(THEME.accent, 0.12) : 'transparent',
				border: Math.max(2, unit * (boxed ? 2.5 : 3.5)) + 'px solid ' + withAlpha(boxed ? THEME.accent : THEME.ink, boxed ? 0.42 : 0.3),
				opacity: enter,
				transform: 'scale(' + (0.96 + enter * 0.04).toFixed(4) + ')',
			}}
		>
			{children}
		</div>
	)
}

const Backdrop: React.FC<{ seed?: number; intensity?: number }> = ({ seed = 0, intensity = 1 }) => {
	const frame = useCurrentFrame()
	const { width, height } = useVideoConfig()
	const seedKey = CREATIVE_SEED + ':backdrop:' + seed
	const originX = 18 + random(seedKey + ':x') * 64
	const originY = 12 + random(seedKey + ':y') * 70
	const drift = Math.sin(frame / 110 + seed) * (2 + random(seedKey + ':drift') * 4)
	const lift = Math.cos(frame / 140 + seed) * (1.5 + random(seedKey + ':lift') * 3)
	const accent = withAlpha(THEME.accent, 0.12 * intensity)
	const accentAlt = withAlpha(THEME.accentAlt, 0.17 * intensity)
	let background =
		'radial-gradient(125% 95% at ' + (originX + drift).toFixed(2) + '% ' + (originY + lift).toFixed(2) + '%, ' +
		THEME.backgroundAlt + ' 0%, ' + THEME.background + ' 68%)'

	if (CREATIVE.background === 'spotlight') {
		background =
			'radial-gradient(42% 70% at ' + (originX + drift).toFixed(2) + '% -4%, ' + accent + ' 0%, rgba(0,0,0,0) 74%), ' +
			'linear-gradient(155deg, ' + THEME.backgroundAlt + ' 0%, ' + THEME.background + ' 72%)'
	} else if (CREATIVE.background === 'paper-wash') {
		background =
			'radial-gradient(85% 68% at ' + (originX + drift).toFixed(2) + '% ' + (originY + lift).toFixed(2) + '%, ' + accent + ' 0%, rgba(0,0,0,0) 72%), ' +
			'linear-gradient(128deg, ' + THEME.background + ' 0%, ' + THEME.backgroundAlt + ' 100%)'
	} else if (CREATIVE.background === 'soft-orbits') {
		background =
			'radial-gradient(38% 48% at ' + (originX + drift).toFixed(2) + '% ' + (originY + lift).toFixed(2) + '%, ' + accentAlt + ' 0%, rgba(0,0,0,0) 76%), ' +
			'radial-gradient(54% 44% at ' + (100 - originX - drift).toFixed(2) + '% 82%, ' + accent + ' 0%, rgba(0,0,0,0) 72%), ' + THEME.background
	} else if (CREATIVE.background === 'cinematic-bands') {
		background =
			'linear-gradient(116deg, ' + THEME.background + ' 0%, ' + THEME.background + ' 28%, ' + accentAlt + ' 54%, ' + THEME.backgroundAlt + ' 76%, ' + THEME.background + ' 100%)'
	} else if (CREATIVE.background === 'ink-bloom') {
		background =
			'radial-gradient(70% 88% at ' + (originX + drift).toFixed(2) + '% ' + (originY + lift).toFixed(2) + '%, ' + THEME.backgroundAlt + ' 0%, ' + accentAlt + ' 42%, rgba(0,0,0,0) 75%), ' + THEME.background
	} else if (CREATIVE.background === 'duotone-split') {
		/* Two flat fields meeting on a hard diagonal, with no gradient haze. */
		const cut = (52 + drift * 0.8).toFixed(2)
		background =
			'linear-gradient(' + (108 + lift).toFixed(2) + 'deg, ' + THEME.backgroundAlt + ' 0%, ' + THEME.backgroundAlt + ' ' + cut + '%, ' +
			THEME.background + ' ' + cut + '%, ' + THEME.background + ' 100%)'
	} else if (CREATIVE.background === 'halo-sweep') {
		background =
			'radial-gradient(closest-side circle at ' + (originX + drift).toFixed(2) + '% ' + (originY + lift).toFixed(2) + '%, rgba(0,0,0,0) 46%, ' +
			accent + ' 52%, rgba(0,0,0,0) 60%), ' +
			'linear-gradient(200deg, ' + THEME.backgroundAlt + ' 0%, ' + THEME.background + ' 78%)'
	} else if (CREATIVE.background === 'noir-fade') {
		background =
			'radial-gradient(120% 120% at 50% 42%, ' + THEME.backgroundAlt + ' 0%, ' + THEME.background + ' 52%, #000000 132%)'
	} else if (CREATIVE.background === 'gradient-mesh') {
		background =
			'radial-gradient(34% 42% at ' + (originX + drift).toFixed(2) + '% 22%, ' + accent + ' 0%, rgba(0,0,0,0) 70%), ' +
			'radial-gradient(30% 38% at ' + (100 - originX).toFixed(2) + '% 68%, ' + accentAlt + ' 0%, rgba(0,0,0,0) 70%), ' +
			'radial-gradient(46% 52% at 50% ' + (100 - originY + lift).toFixed(2) + '%, ' + THEME.backgroundAlt + ' 0%, rgba(0,0,0,0) 74%), ' + THEME.background
	} else if (CREATIVE.background === 'vertical-fade') {
		background = 'linear-gradient(180deg, ' + THEME.backgroundAlt + ' 0%, ' + THEME.background + ' 62%, ' + THEME.backgroundAlt + ' 100%)'
	} else if (CREATIVE.background === 'corner-glow') {
		background =
			'radial-gradient(64% 58% at 102% -2%, ' + accentAlt + ' 0%, rgba(0,0,0,0) 68%), ' +
			'radial-gradient(52% 48% at -4% 104%, ' + accent + ' 0%, rgba(0,0,0,0) 66%), ' + THEME.background
	} else if (CREATIVE.background === 'editorial-slab') {
		/* A printed colour block holding one third of the page. */
		background =
			'linear-gradient(90deg, ' + THEME.backgroundAlt + ' 0%, ' + THEME.backgroundAlt + ' 34%, ' +
			THEME.background + ' 34%, ' + THEME.background + ' 100%)'
	} else if (CREATIVE.background === 'flat-field') {
		background = THEME.background
	}

	return (
		<AbsoluteFill style={{ backgroundColor: THEME.background, background, overflow: 'hidden' }}>
			{CREATIVE.accentShape === 'rings' ? (
				<div style={{ position: 'absolute', width: width * 0.58, height: width * 0.58, borderRadius: width, border: Math.max(2, width * 0.002) + 'px solid ' + withAlpha(THEME.accent, 0.14), left: -width * 0.18 + drift * 4, top: height * 0.5 + lift * 5 }} />
			) : null}
			{CREATIVE.accentShape === 'ribbons' ? (
				<div style={{ position: 'absolute', width: width * 1.4, height: height * 0.13, backgroundColor: withAlpha(THEME.accentAlt, 0.08), left: -width * 0.2, top: height * 0.62 + lift * 4, rotate: '-11deg', borderRadius: height }} />
			) : null}
			{CREATIVE.accentShape === 'discs' ? (
				<div style={{ position: 'absolute', width: width * 0.34, height: width * 0.34, borderRadius: width, backgroundColor: withAlpha(THEME.accent, 0.09), right: -width * 0.08 + drift * 3, top: height * 0.12 }} />
			) : null}
			{CREATIVE.accentShape === 'frames' ? (
				<div style={{ position: 'absolute', inset: Math.min(width, height) * 0.045, border: Math.max(1, width * 0.0015) + 'px solid ' + withAlpha(THEME.accentAlt, 0.13), borderRadius: Math.min(width, height) * 0.04 }} />
			) : null}
			{CREATIVE.accentShape === 'arcs' ? (
				<div aria-hidden style={{ position: 'absolute', width: width * 0.86, height: width * 0.86, borderRadius: width, border: Math.max(2, width * 0.0026) + 'px solid ' + withAlpha(THEME.accentAlt, 0.16), borderRightColor: 'transparent', borderTopColor: 'transparent', left: width * 0.2 + drift * 3, top: -width * 0.3 + lift * 4, transform: 'rotate(' + (18 + drift).toFixed(2) + 'deg)' }} />
			) : null}
			{CREATIVE.accentShape === 'slashes'
				? new Array(4).fill(null).map((_, index) => (
						<div
							key={seedKey + ':slash:' + index}
							aria-hidden
							style={{
								position: 'absolute',
								width: Math.max(3, width * 0.004),
								height: height * 1.6,
								backgroundColor: withAlpha(index % 2 === 0 ? THEME.accent : THEME.accentAlt, 0.11),
								left: width * (0.08 + index * 0.27) + drift * 2,
								top: -height * 0.3,
								transform: 'rotate(16deg)',
							}}
						/>
					))
				: null}
			{CREATIVE.accentShape === 'blocks'
				? new Array(3).fill(null).map((_, index) => (
						<div
							key={seedKey + ':block:' + index}
							aria-hidden
							style={{
								position: 'absolute',
								width: width * (0.16 + index * 0.05),
								height: width * (0.16 + index * 0.05),
								backgroundColor: withAlpha(index === 1 ? THEME.accentAlt : THEME.accent, 0.085),
								left: index % 2 === 0 ? width * (0.03 + index * 0.06) + drift : undefined,
								right: index % 2 === 0 ? undefined : width * 0.04 - drift,
								top: height * (0.1 + index * 0.28) + lift * 2,
							}}
						/>
					))
				: null}
			{CREATIVE.accentShape === 'halo' ? (
				<div aria-hidden style={{ position: 'absolute', width: width * 0.62, height: width * 0.62, borderRadius: width, background: 'radial-gradient(circle, ' + withAlpha(THEME.glow, 0.16) + ' 0%, rgba(0,0,0,0) 68%)', left: width * 0.19 + drift * 2, top: height * 0.5 - width * 0.31 + lift * 3 }} />
			) : null}
			{CREATIVE.accentShape === 'sparks'
				? new Array(9).fill(null).map((_, index) => {
						const sparkKey = seedKey + ':spark:' + index
						const diameter = Math.max(2, width * (0.002 + random(sparkKey + ':size') * 0.005))
						return (
							<div
								key={sparkKey}
								style={{
									position: 'absolute',
									width: diameter,
									height: diameter,
									borderRadius: diameter,
									backgroundColor: index % 2 === 0 ? accent : accentAlt,
									left: width * (0.08 + random(sparkKey + ':x') * 0.84) + drift * (index % 3),
									top: height * (0.08 + random(sparkKey + ':y') * 0.8) + lift * (index % 4),
									boxShadow: '0 0 ' + (diameter * 5).toFixed(1) + 'px ' + accent,
								}}
							/>
						)
				  })
				: null}
		</AbsoluteFill>
	)
}

const SceneArtwork: React.FC<{ src: string; variant: number }> = ({ src, variant }) => {
	const frame = useCurrentFrame()
	const { width, height } = useVideoConfig()
	const enter = interpolate(frame, [0, 20], [0, 1], CLAMP)
	const leftBiased = LAYOUT_LEFT
	const placeRight = leftBiased || variant % 2 === 0
	const driftX = Math.sin(frame / (82 + variant * 5) + variant) * width * 0.008
	const driftY = Math.cos(frame / (96 + variant * 7) + variant) * height * 0.012
	const size = Math.min(width, height) * (variant === 3 ? 0.66 : 0.52)
	const opacity =
		(CREATIVE.finish === 'clean' || CREATIVE.finish === 'matte'
			? 0.13
			: CREATIVE.finish === 'luminous'
				? 0.22
				: CREATIVE.finish === 'print'
					? 0.2
					: 0.17) * enter

	return (
		<Img
			aria-hidden
			src={src}
			style={{
				position: 'absolute',
				width: size,
				height: size,
				objectFit: 'contain',
				pointerEvents: 'none',
				opacity,
				left: placeRight ? undefined : -size * 0.2 + driftX,
				right: placeRight ? -size * 0.18 - driftX : undefined,
				top: height * (variant === 1 ? 0.06 : 0.24) + driftY,
				transform: 'rotate(' + (-9 + variant * 5) + 'deg) scale(' + (0.9 + enter * 0.1).toFixed(3) + ')',
				filter: 'saturate(1.08) drop-shadow(0 ' + (height * 0.018).toFixed(1) + 'px ' + (height * 0.045).toFixed(1) + 'px rgba(0,0,0,.24))',
				mixBlendMode: CREATIVE.finish === 'paper' || CREATIVE.finish === 'print' ? 'multiply' : 'screen',
				maskImage: 'radial-gradient(circle, black 48%, transparent 78%)',
				WebkitMaskImage: 'radial-gradient(circle, black 48%, transparent 78%)',
			}}
		/>
	)
}

const CreativeSceneShell: React.FC<{ variant: number; artworkSrc: string; children: React.ReactNode }> = ({ variant, artworkSrc, children }) => {
	const frame = useCurrentFrame()
	const { width, height } = useVideoConfig()
	const breathe = 0.82 + Math.sin(frame / 72 + variant) * 0.12
	return (
		<AbsoluteFill>
			{children}
			<SceneArtwork src={artworkSrc} variant={variant} />
			{variant === 0 ? <div aria-hidden style={{ position: 'absolute', width: width * 0.44, height: width * 0.44, borderRadius: width, border: Math.max(1, width * 0.0014) + 'px solid ' + withAlpha(THEME.accent, 0.12 * breathe), right: -width * 0.2, top: height * 0.08, pointerEvents: 'none' }} /> : null}
			{variant === 1 ? <div aria-hidden style={{ position: 'absolute', width: width * 0.9, height: height * 0.055, borderRadius: height, backgroundColor: withAlpha(THEME.accentAlt, 0.07 * breathe), left: -width * 0.24, bottom: height * 0.12, rotate: '18deg', pointerEvents: 'none' }} /> : null}
			{variant === 2 ? <div aria-hidden style={{ position: 'absolute', width: width * 0.2, height: width * 0.2, borderRadius: width, backgroundColor: withAlpha(THEME.accent, 0.065 * breathe), left: width * 0.055, bottom: height * 0.09, pointerEvents: 'none' }} /> : null}
			{variant === 3 ? <div aria-hidden style={{ position: 'absolute', width: width * 0.26, height: height * 0.22, borderLeft: Math.max(2, width * 0.002) + 'px solid ' + withAlpha(THEME.accentAlt, 0.16 * breathe), borderTop: Math.max(2, width * 0.002) + 'px solid ' + withAlpha(THEME.accentAlt, 0.16 * breathe), left: width * 0.035, top: height * 0.045, pointerEvents: 'none' }} /> : null}
			{variant === 4 ? <div aria-hidden style={{ position: 'absolute', width: width * 0.08, height: height * 0.72, borderRadius: width, backgroundColor: withAlpha(THEME.accent, 0.045 * breathe), right: width * 0.05, top: height * 0.14, rotate: '8deg', pointerEvents: 'none' }} /> : null}
		</AbsoluteFill>
	)
}

const ParticleField: React.FC<{ count?: number; color?: string; speed?: number; size?: number; sceneSeed?: number }> = ({
	count = 26,
	color = THEME.accent,
	speed = 0.5,
	size = 5,
	sceneSeed = 0,
}) => {
	const frame = useCurrentFrame()
	const { width, height } = useVideoConfig()

	return (
		<AbsoluteFill style={{ overflow: 'hidden' }}>
			{new Array(count).fill(0).map((_, index) => {
				const seedX = random(CREATIVE_SEED + ':particle-' + sceneSeed + '-x-' + index)
				const seedY = random(CREATIVE_SEED + ':particle-' + sceneSeed + '-y-' + index)
				const seedS = random(CREATIVE_SEED + ':particle-' + sceneSeed + '-s-' + index)
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
			<ParticleField count={30} speed={0.45} sceneSeed={1} />
			<SceneFrame gap={unit * 26} push={0.06}>
				<IconBadge name={icon} size={unit * 118} delay={2} />
				<Kicker text={kicker} delay={8} />
				<TitlePlate delay={10}>
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
				</TitlePlate>
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
						fontWeight: DISPLAY_WEIGHT,
						color: THEME.accent,
						letterSpacing: -unit * 0.5,
					}}
				>
					{event.marker}
				</span>
				<span style={{ fontFamily: TEXT_FONT, fontSize: unit * 30, fontWeight: safeTextWeight(700), color: THEME.ink, lineHeight: 1.25 }}>
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

	const landmass = new Array(3).fill(0).map((_, index) => {
		const cx = 260 + random(CREATIVE_SEED + ':land-x-' + index) * 480
		const cy = 260 + random(CREATIVE_SEED + ':land-y-' + index) * 460
		const rx = 150 + random(CREATIVE_SEED + ':land-rx-' + index) * 190
		const ry = 110 + random(CREATIVE_SEED + ':land-ry-' + index) * 150
		return { cx, cy, rx, ry }
	})

	return (
		<AbsoluteFill>
			<Backdrop seed={4} intensity={0.7} />
			<div style={{ position: 'absolute', left, top, width: board, height: board }}>
				<svg width={Math.round(board)} height={Math.round(board)} viewBox="0 0 1000 1000" style={{ display: 'block' }}>
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
		const noise = random(CREATIVE_SEED + ':ridge-' + seed + '-' + index)
		let y = baseY

		if (terrain === 'mountain') {
			// A few peaks of different heights read as a range; a fast sine reads
			// as a saw blade, so each peak gets its own seeded height and shoulder.
			const peaks = 3 + seed
			const phase = (index / steps) * peaks
			const slot = Math.floor(phase)
			const local = phase - slot
			const peakHeight = amplitude * (0.42 + random(CREATIVE_SEED + ':peak-' + seed + '-' + slot) * 0.85)
			const apex = 0.3 + random(CREATIVE_SEED + ':apex-' + seed + '-' + slot) * 0.4
			const rise = local < apex ? local / apex : (1 - local) / (1 - apex)
			const shoulder = Math.pow(Math.max(0, rise), 0.6)
			const foot = amplitude * 0.14 * random(CREATIVE_SEED + ':foot-' + seed + '-' + slot)
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
							const starX = random(CREATIVE_SEED + ':star-x-' + index) * width
							const starY = random(CREATIVE_SEED + ':star-y-' + index) * height * 0.55
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
			<ParticleField count={22} speed={0.28} color={THEME.accentAlt} size={4} sceneSeed={5} />
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
						<DepthTilt key={item.title + '-' + index} index={index}>
							<GalleryCard item={item} delay={12 + index * 7} />
						</DepthTilt>
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
				width: '100%',
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
			<span style={{ fontFamily: DISPLAY_FONT, fontSize: unit * 34, fontWeight: DISPLAY_WEIGHT, color: THEME.ink, lineHeight: 1.15 }}>
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
					fontWeight: DISPLAY_WEIGHT,
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
									<span style={{ fontFamily: DISPLAY_FONT, fontSize: u * 30, fontWeight: DISPLAY_WEIGHT, color: THEME.ink, opacity: grow }}>
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
							<DepthTilt index={index} lift={0.7}>
								<ProcessCard step={step} index={index} delay={12 + index * 9} />
							</DepthTilt>
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
						fontWeight: DISPLAY_WEIGHT,
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
			<span style={{ fontFamily: DISPLAY_FONT, fontSize: unit * 32, fontWeight: DISPLAY_WEIGHT, color: THEME.ink, lineHeight: 1.15 }}>
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
			<ParticleField count={34} speed={0.6} color={THEME.accentAlt} sceneSeed={11} />
			<SceneFrame gap={unit * 26} push={0.05}>
				<IconBadge name={icon} size={unit * 104} delay={2} color={THEME.accentAlt} />
				<TitlePlate delay={6}>
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
				</TitlePlate>
				<Rule delay={22} width={Math.min(width * 0.4, unit * 480)} />
				<Copy text={subline} delay={26} size={unit * 30} />
				{tagline ? (
					<div
						style={{
							marginTop: unit * 12,
							padding: unit * 12 + 'px ' + unit * 26 + 'px',
							borderRadius: cornerRadius(unit),
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
	object3d: `
const Object3dScene: React.FC<{
	frames: number
	solid: string
	headline: string
	caption: string
	wireframe: boolean
}> = ({ frames, solid, headline, caption, wireframe }) => {
	const frame = useCurrentFrame()
	const enter = useSpringIn(2, 160)
	const spin = frame * 0.0115
	const bob = Math.sin(frame / 34) * 0.17
	const distance = interpolate(frame, [0, frames], [8.6, 6.7], CLAMP)
	const orbit = Math.sin(frame / 150) * 0.42

	return (
		<AbsoluteFill>
			<Backdrop seed={12} intensity={1.15} />
			<ThreeStage distance={distance} yaw={orbit} pitch={0.2}>
				<group position={[0, bob, 0]} rotation={[spin * 0.45, spin, spin * 0.12]} scale={0.25 + enter * 0.75}>
					<mesh castShadow receiveShadow>
						<Solid solid={solid} />
						{/* Clearcoat gives a lacquered highlight without an environment map,
						    which a metal-heavy material cannot produce on its own. */}
						<meshPhysicalMaterial
							color={THEME.accent}
							metalness={0.35}
							roughness={0.26}
							clearcoat={1}
							clearcoatRoughness={0.14}
							reflectivity={0.7}
							emissive={THEME.accent}
							emissiveIntensity={0.06}
						/>
					</mesh>
					{wireframe ? (
						<mesh scale={1.07}>
							<Solid solid={solid} />
							<meshBasicMaterial color={THEME.accentAlt} wireframe transparent opacity={0.32} />
						</mesh>
					) : null}
				</group>

				{/* Satellites give the turntable a sense of scale and speed. */}
				{new Array(4).fill(0).map((_, index) => {
					const angle = spin * (1.4 + index * 0.35) + index * 1.7
					const radius = 2.9 + index * 0.5
					return (
						<mesh
							key={'satellite-' + index}
							castShadow
							position={[
								Math.cos(angle) * radius,
								Math.sin(angle * 0.8 + index) * 1.05,
								Math.sin(angle) * radius,
							]}
							scale={0.1 + index * 0.028}
						>
							<sphereGeometry args={[1, 18, 18]} />
							<meshStandardMaterial
								color={THEME.accentAlt}
								emissive={THEME.accentAlt}
								emissiveIntensity={0.75}
								roughness={0.3}
							/>
						</mesh>
					)
				})}

				<mesh position={[0, 0, -4.5]}>
					<ringGeometry args={[3.3, 3.36, 96]} />
					<meshBasicMaterial color={THEME.accentAlt} transparent opacity={0.45} />
				</mesh>
				<mesh receiveShadow position={[0, -2.25, 0]} rotation={[-Math.PI / 2, 0, 0]}>
					<circleGeometry args={[8, 72]} />
					<meshStandardMaterial color={THEME.surface} roughness={0.94} metalness={0.06} />
				</mesh>
			</ThreeStage>
			<StageCaption headline={headline} caption={caption} delay={14} />
			<SceneEdge frames={frames} />
		</AbsoluteFill>
	)
}
`,
	globe3d: `
type GlobePlaceData = { name: string; detail: string; x: number; y: number }

const Globe3dScene: React.FC<{
	frames: number
	headline: string
	caption: string
	places: GlobePlaceData[]
}> = ({ frames, headline, caption, places }) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const enter = useSpringIn(2, 170)
	const spin = frame * 0.0075
	const distance = interpolate(frame, [0, frames], [7.4, 6.2], CLAMP)

	return (
		<AbsoluteFill>
			<Backdrop seed={13} intensity={1} />
			<ParticleField count={40} speed={0.22} color={THEME.accentAlt} size={4} sceneSeed={13} />
			<ThreeStage distance={distance} yaw={Math.sin(frame / 200) * 0.22} pitch={0.16} fov={36}>
				<group rotation={[0.32, spin, 0.06]} scale={0.4 + enter * 0.6}>
					<mesh castShadow receiveShadow>
						<sphereGeometry args={[1.75, 64, 48]} />
						<meshStandardMaterial color={THEME.surface} roughness={0.75} metalness={0.25} />
					</mesh>
					{/* Graticule: the classic latitude/longitude cage. */}
					<mesh scale={1.012}>
						<sphereGeometry args={[1.75, 32, 20]} />
						<meshBasicMaterial color={THEME.accent} wireframe transparent opacity={0.28} />
					</mesh>
					{/* Atmosphere shell, lit from inside. */}
					<mesh scale={1.14}>
						<sphereGeometry args={[1.75, 48, 32]} />
						<meshBasicMaterial color={THEME.accent} transparent opacity={0.09} side={BackSide} />
					</mesh>

					{places.map((place, index) => {
						const longitude = (place.x - 0.5) * Math.PI * 2
						const latitude = (0.5 - place.y) * Math.PI
						const radius = 1.79
						const pop = interpolate(frame, [16 + index * 6, 34 + index * 6], [0, 1], { ...CLAMP, easing: EASE_OUT })
						const position: [number, number, number] = [
							radius * Math.cos(latitude) * Math.sin(longitude),
							radius * Math.sin(latitude),
							radius * Math.cos(latitude) * Math.cos(longitude),
						]
						return (
							<group key={place.name + '-' + index} position={position} scale={pop}>
								<mesh>
									<sphereGeometry args={[0.075, 16, 16]} />
									<meshStandardMaterial
										color={THEME.accentAlt}
										emissive={THEME.accentAlt}
										emissiveIntensity={1.1}
									/>
								</mesh>
								<mesh position={[0, 0.16, 0]}>
									<cylinderGeometry args={[0.008, 0.008, 0.32, 8]} />
									<meshBasicMaterial color={THEME.accentAlt} transparent opacity={0.7} />
								</mesh>
							</group>
						)
					})}
				</group>

				<mesh rotation={[-Math.PI / 2.1, 0, spin * 0.4]}>
					<ringGeometry args={[2.55, 2.6, 128]} />
					<meshBasicMaterial color={THEME.accent} transparent opacity={0.35} />
				</mesh>
			</ThreeStage>

			<AbsoluteFill
				style={{
					flexDirection: 'column',
					alignItems: 'flex-start',
					justifyContent: 'flex-start',
					paddingLeft: width * 0.078,
					paddingTop: height * 0.095,
					gap: unit * 14,
					pointerEvents: 'none',
				}}
			>
				<Kicker text="Global" delay={0} />
				<Headline
					text={headline}
					size={unit * 56}
					delay={6}
					align="flex-start"
					uppercase
					weight={800}
					maxWidth={unit * 620}
				/>
			</AbsoluteFill>

			<AbsoluteFill
				style={{
					flexDirection: 'column',
					alignItems: 'center',
					justifyContent: 'flex-end',
					paddingBottom: height * 0.08,
					gap: unit * 12,
					pointerEvents: 'none',
				}}
			>
				<div style={{ display: 'flex', flexWrap: 'wrap', gap: unit * 10, justifyContent: 'center' }}>
					{places.map((place, index) => (
						<GlobeChip key={'chip-' + index} name={place.name} delay={18 + index * 6} />
					))}
				</div>
				<Copy text={caption} delay={26} size={unit * 26} maxWidth={unit * 720} />
			</AbsoluteFill>
			<SceneEdge frames={frames} />
		</AbsoluteFill>
	)
}

const GlobeChip: React.FC<{ name: string; delay: number }> = ({ name, delay }) => {
	const unit = useUnit()
	const enter = useSpringIn(delay, 200)

	return (
		<span
			style={{
				display: 'inline-flex',
				alignItems: 'center',
				gap: unit * 8,
				padding: unit * 8 + 'px ' + unit * 16 + 'px',
				borderRadius: unit * 100,
				border: '1px solid ' + withAlpha(THEME.accentAlt, 0.45),
				backgroundColor: withAlpha(THEME.surface, 0.6),
				color: THEME.ink,
				fontFamily: TEXT_FONT,
				fontSize: unit * 22,
				opacity: enter,
				transform: 'translateY(' + ((1 - enter) * unit * 12).toFixed(1) + 'px)',
			}}
		>
			<span
				style={{
					width: unit * 8,
					height: unit * 8,
					borderRadius: unit * 8,
					backgroundColor: THEME.accentAlt,
					display: 'block',
				}}
			/>
			{name}
		</span>
	)
}
`,
	terrain3d: `
/** Deterministic height field - the same seed always builds the same range. */
const terrainHeight = (x: number, y: number, profile: string): number => {
	const phase = random(CREATIVE_SEED + ':terrain-phase') * Math.PI * 2
	const ridge = Math.sin(x * 0.52 + 1.3 + phase) * Math.cos(y * 0.44 - phase * 0.4)
	const detail = Math.sin(x * 1.7 + y * 0.9 + phase * 0.7) * 0.32 + Math.cos(x * 2.6 - y * 1.4 - phase) * 0.19
	if (profile === 'desert') return (Math.abs(ridge) * 0.85 + detail * 0.2) * 1.15
	if (profile === 'ocean') return Math.sin(x * 0.85 + y * 0.55) * 0.34 + detail * 0.12
	if (profile === 'valley') return Math.min(2.6, Math.abs(x) * 0.34) + ridge * 0.42
	if (profile === 'forest') return Math.max(0, ridge * 1.1) + Math.abs(detail) * 0.9
	if (profile === 'city') return Math.round(Math.abs(ridge) * 3) * 0.42
	return Math.max(0, ridge * 2.2 + detail) * 1.4
}

const Terrain3dScene: React.FC<{
	frames: number
	terrain: string
	headline: string
	caption: string
}> = ({ frames, terrain, headline, caption }) => {
	const frame = useCurrentFrame()
	const travel = interpolate(frame, [0, frames], [0, 6.5], CLAMP)
	const distance = interpolate(frame, [0, frames], [10.5, 8.2], CLAMP)
	const pitch = interpolate(frame, [0, frames], [0.42, 0.22], CLAMP)

	const geometry = React.useMemo(() => {
		const geo = new PlaneGeometry(46, 30, 90, 60)
		const position = geo.attributes.position
		for (let index = 0; index < position.count; index += 1) {
			position.setZ(index, terrainHeight(position.getX(index), position.getY(index), terrain))
		}
		position.needsUpdate = true
		geo.computeVertexNormals()
		return geo
	}, [terrain])

	return (
		<AbsoluteFill>
			<Backdrop seed={14} intensity={0.9} />
			<ThreeStage distance={distance} yaw={Math.sin(frame / 190) * 0.16} pitch={pitch} fov={44} fog={[9, 34]}>
				<group position={[0, -1.6, travel]}>
					<mesh geometry={geometry} rotation={[-Math.PI / 2, 0, 0]} castShadow receiveShadow>
						<meshStandardMaterial color={THEME.surface} roughness={0.92} metalness={0.05} flatShading />
					</mesh>
					<mesh geometry={geometry} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 0]}>
						<meshBasicMaterial color={THEME.accent} wireframe transparent opacity={0.16} />
					</mesh>
				</group>
				{/* Sun disc on the horizon. fog={false} keeps it bright instead of
				    letting the depth fog wash it into the background plate. */}
				<mesh position={[3.4, 2.6, -17]}>
					<circleGeometry args={[2, 64]} />
					<meshBasicMaterial color={THEME.accent} transparent opacity={0.9} fog={false} />
				</mesh>
				<mesh position={[3.4, 2.6, -17.4]}>
					<ringGeometry args={[2.1, 3.4, 64]} />
					<meshBasicMaterial color={THEME.accent} transparent opacity={0.14} fog={false} />
				</mesh>
			</ThreeStage>
			<StageCaption headline={headline} caption={caption} delay={12} />
			<SceneEdge frames={frames} />
		</AbsoluteFill>
	)
}
`,
	carousel3d: `
type CarouselItemData = { title: string; detail: string; icon: IconName }

const Carousel3dScene: React.FC<{ frames: number; headline: string; items: CarouselItemData[] }> = ({
	frames,
	headline,
	items,
}) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	// A shallow arc keeps the neighbouring cards visible at an angle; a full
	// 360-degree ring would turn them edge-on and leave the frame empty.
	const step = Math.min(360 / items.length, 58)
	const radius = Math.min(width * 0.34, unit * 500)
	const spin = interpolate(frame, [10, frames - 6], [0, -step * (items.length - 1)], {
		...CLAMP,
		easing: EASE_OUT,
	})

	return (
		<AbsoluteFill>
			<Backdrop seed={15} intensity={1.2} />
			<AbsoluteFill
				style={{
					alignItems: 'center',
					justifyContent: 'center',
					perspective: width * 1.1,
					perspectiveOrigin: '50% 48%',
				}}
			>
				<div
					style={{
						position: 'relative',
						width: unit * 360,
						height: unit * 300,
						transformStyle: 'preserve-3d',
						transform: 'rotateX(-7deg) rotateY(' + spin.toFixed(2) + 'deg)',
					}}
				>
					{items.map((item, index) => (
						<CarouselCard
							key={item.title + '-' + index}
							item={item}
							angle={index * step}
							facing={Math.cos(((index * step + spin) * Math.PI) / 180)}
							radius={radius}
							delay={8 + index * 5}
						/>
					))}
				</div>
			</AbsoluteFill>
			<AbsoluteFill
				style={{
					flexDirection: 'column',
					alignItems: 'center',
					justifyContent: 'flex-start',
					paddingTop: height * 0.09,
					pointerEvents: 'none',
				}}
			>
				<Headline text={headline} size={unit * 56} delay={2} uppercase weight={800} maxWidth={unit * 900} />
			</AbsoluteFill>
			<SceneEdge frames={frames} />
		</AbsoluteFill>
	)
}

const CarouselCard: React.FC<{
	item: CarouselItemData
	angle: number
	facing: number
	radius: number
	delay: number
}> = ({ item, angle, facing, radius, delay }) => {
	const unit = useUnit()
	const enter = useSpringIn(delay, 180)
	const front = Math.max(0, facing)

	return (
		<div
			style={{
				position: 'absolute',
				left: 0,
				top: 0,
				width: '100%',
				height: '100%',
				display: 'flex',
				flexDirection: 'column',
				gap: unit * 14,
				justifyContent: 'center',
				padding: unit * 28,
				borderRadius: unit * 24,
				backgroundColor: withAlpha(THEME.surface, 0.82),
				border: '1px solid ' + withAlpha(THEME.accent, 0.34),
				boxShadow: '0 ' + (unit * 26).toFixed(0) + 'px ' + (unit * 60).toFixed(0) + 'px ' + withAlpha('#000000', 0.45),
				transform:
					'rotateY(' + angle + 'deg) translateZ(' + radius.toFixed(1) + 'px) scale(' +
					(0.86 + enter * 0.14 * (0.7 + front * 0.3)).toFixed(3) + ')',
				opacity: enter * (0.3 + front * 0.7),
				backfaceVisibility: 'hidden',
			}}
		>
			<VectorIcon name={item.icon} size={unit * 52} color={THEME.accent} strokeWidth={1.7} glow />
			<span style={{ fontFamily: DISPLAY_FONT, fontSize: unit * 38, fontWeight: DISPLAY_WEIGHT, color: THEME.ink, lineHeight: 1.12 }}>
				{item.title}
			</span>
			{item.detail ? (
				<span style={{ fontFamily: TEXT_FONT, fontSize: unit * 24, color: THEME.muted, lineHeight: 1.4 }}>
					{item.detail}
				</span>
			) : null}
		</div>
	)
}
`,
}

/**
 * The WebGL stage. Emitted only when a storyboard uses a three scene, because
 * it pulls three.js into the compile.
 */
const THREE_STAGE = `
/**
 * Camera, lights and atmosphere for every WebGL scene.
 *
 * preserveDrawingBuffer is mandatory: without it a browser export captures an
 * empty canvas. Every value below is derived from useCurrentFrame() by the
 * caller, so the render is deterministic and useFrame() is never needed.
 */
const ThreeStage: React.FC<{
	children: React.ReactNode
	distance?: number
	yaw?: number
	pitch?: number
	fov?: number
	fog?: [number, number] | null
}> = ({ children, distance = 7.4, yaw = 0, pitch = 0.24, fov = 38, fog = null }) => {
	const { width, height } = useVideoConfig()
	const x = Math.sin(yaw) * distance * Math.cos(pitch)
	const y = Math.sin(pitch) * distance
	const z = Math.cos(yaw) * distance * Math.cos(pitch)

	return (
		<ThreeCanvas
			width={width}
			height={height}
			dpr={2}
			shadows="basic"
			gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}
			camera={{ fov, near: 0.1, far: 160, position: [x, y, z] }}
			style={{ position: 'absolute', inset: 0 }}
		>
			{fog ? <fog attach="fog" args={[THEME.background, fog[0], fog[1]]} /> : null}
			<ambientLight color={THEME.ink} intensity={0.5} />
			<hemisphereLight color={THEME.accent} groundColor={THEME.background} intensity={0.75} />
			<directionalLight
				castShadow
				color="#FFFFFF"
				intensity={2.3}
				position={[5.5, 8.5, 6]}
				shadow-mapSize-width={1024}
				shadow-mapSize-height={1024}
			/>
			{/* Rim light in the accent colour separates the subject from the plate. */}
			<pointLight color={THEME.accentAlt} intensity={45} distance={30} decay={2} position={[-5.5, 2.6, 3.6]} />
			{/* Cool fill from below stops the underside going to pure black. */}
			<pointLight color={THEME.accent} intensity={22} distance={26} decay={2} position={[2.4, -3.2, 4.2]} />
			{children}
		</ThreeCanvas>
	)
}

const Solid: React.FC<{ solid: string }> = ({ solid }) => {
	if (solid === 'sphere') return <icosahedronGeometry args={[1.5, 4]} />
	if (solid === 'torus') return <torusKnotGeometry args={[1, 0.33, 180, 26]} />
	if (solid === 'cube') return <boxGeometry args={[2, 2, 2]} />
	if (solid === 'prism') return <cylinderGeometry args={[1.3, 1.3, 2.2, 6]} />
	if (solid === 'capsule') return <capsuleGeometry args={[0.8, 1.5, 12, 28]} />
	if (solid === 'ring') return <torusGeometry args={[1.5, 0.32, 30, 120]} />
	return <octahedronGeometry args={[1.7, 0]} />
}

/** Caption plate used under every WebGL scene so type stays crisp DOM text. */
const StageCaption: React.FC<{ headline: string; caption: string; delay?: number }> = ({
	headline,
	caption,
	delay = 12,
}) => {
	const unit = useUnit()
	const { height } = useVideoConfig()

	return (
		<AbsoluteFill
			style={{
				justifyContent: 'flex-end',
				alignItems: 'center',
				paddingBottom: height * 0.085,
				gap: unit * 14,
				flexDirection: 'column',
				pointerEvents: 'none',
			}}
		>
			<Headline text={headline} size={unit * 66} delay={delay} uppercase weight={800} maxWidth={unit * 940} />
			<Copy text={caption} delay={delay + 10} size={unit * 27} maxWidth={unit * 720} />
		</AbsoluteFill>
	)
}
`

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
		case 'object3d':
			return `${common} solid={${json(scene.solid)}} headline={${json(scene.headline)}} caption={${json(scene.caption)}} wireframe={${scene.wireframe}}`
		case 'globe3d':
			return `${common} headline={${json(scene.headline)}} caption={${json(scene.caption)}} places={${json(scene.places)}}`
		case 'terrain3d':
			return `${common} terrain={${json(scene.terrain)}} headline={${json(scene.headline)}} caption={${json(scene.caption)}}`
		case 'carousel3d':
			return `${common} headline={${json(scene.headline)}} items={${json(scene.items)}}`
		default:
			return common
	}
}

type Presentation = 'fade' | 'slide' | 'wipe'

function presentationFor(storyboard: Storyboard, index: number, next: Scene): Presentation {
	const recipe = storyboard.creativeProfile.transition
	if (recipe === 'dissolve') return 'fade'
	if (recipe === 'directional') return next.type === 'quote' ? 'fade' : 'slide'
	if (recipe === 'graphic-wipe') return next.type === 'landscape' ? 'fade' : 'wipe'
	// 'kinetic' alternates a hard wipe with a directional push, never a dissolve,
	// so cuts land on the beat instead of melting into one another.
	if (recipe === 'kinetic') return index % 2 === 0 ? 'wipe' : 'slide'
	const choices: Presentation[] = storyboard.motion === 'calm' ? ['fade', 'fade', 'slide'] : ['fade', 'slide', 'wipe']
	return choices[seededIndex(storyboard.creativeSeed, `transition-${index}-${next.type}`, choices.length)]
}

function presentationCall(presentation: Presentation, index: number, storyboard: Storyboard): string {
	if (presentation === 'slide') {
		const directions = ['from-right', 'from-bottom', 'from-left', 'from-top'] as const
		const direction = directions[seededIndex(storyboard.creativeSeed, `slide-direction-${index}`, directions.length)]
		return `slide({ direction: '${direction}' })`
	}
	if (presentation === 'wipe') {
		const directions = ['from-left', 'from-top', 'from-right', 'from-bottom'] as const
		const direction = directions[seededIndex(storyboard.creativeSeed, `wipe-direction-${index}`, directions.length)]
		return `wipe({ direction: '${direction}' })`
	}
	return 'fade()'
}

type SoundCue = { id: string; asset: string; from: number; durationInFrames: number; volume: number }

function variantSfxAsset(storyboard: Storyboard, family: SfxVariantFamilyId, ordinal: number): string {
	const sceneNudge = storyboard.creativeProfile.sceneVariants[
		ordinal % Math.max(1, storyboard.creativeProfile.sceneVariants.length)
	] ?? 0
	return sfxVariantPath(family, storyboard.creativeProfile.sfxVariantOffset + ordinal * 7 + sceneNudge)
}

function legacyVariantSfxAsset(storyboard: Storyboard, id: SfxId, ordinal: number): string {
	return variantSfxAsset(storyboard, SFX_LEGACY_FAMILY[id], ordinal)
}

function soundCues(storyboard: Storyboard, layout: StoryboardLayout): SoundCue[] {
	const cues: SoundCue[] = []
	const fps = layout.fps
	const punchy = storyboard.motion === 'punchy'
	const recipe = storyboard.creativeProfile.sfx
	const tempo = storyboard.creativeProfile.tempoScale
	const openId: SfxId =
		recipe === 'cinematic'
			? 'impactBoom'
			: recipe === 'crisp'
				? 'impactSnap'
				: recipe === 'organic'
					? 'impactClean'
					: recipe === 'digital'
						? 'glitch'
						: 'impactDeep'
	const transitionId: SfxId =
		recipe === 'organic'
			? 'riserOrganic'
			: recipe === 'digital'
				? 'riserDigital'
				: recipe === 'crisp'
					? 'swipe'
					: punchy
						? 'whooshFast'
						: 'whooshDeep'

	cues.push({
		id: 'open-impact',
		asset: legacyVariantSfxAsset(storyboard, openId, cues.length),
		from: 2,
		durationInFrames: Math.round((fps * 2) / tempo),
		volume: recipe === 'minimal' ? 0.38 : 0.55,
	})

	for (const [index, timing] of layout.timings.entries()) {
		if (index > 0 && (recipe !== 'minimal' || index % 2 === 1)) {
			cues.push({
				id: `cut-${index}`,
				asset: legacyVariantSfxAsset(storyboard, transitionId, cues.length),
				from: Math.max(0, timing.from - Math.round(fps * 0.2)),
				durationInFrames: Math.round((fps * 1.2) / tempo),
				volume: 0.4,
			})
		}

		const scene = timing.scene
		if (scene.type === 'stats' || scene.type === 'chart') {
			const id: SfxId = recipe === 'crisp' ? 'notification' : recipe === 'organic' ? 'chimeSparkle' : 'powerUp'
			cues.push({
				id: `data-${index}`,
				asset: legacyVariantSfxAsset(storyboard, id, cues.length),
				from: timing.from + 8,
				durationInFrames: Math.round(fps * 1.6),
				volume: 0.34,
			})
		}
		if (scene.type === 'gallery' || scene.type === 'process' || scene.type === 'timeline') {
			const id: SfxId = recipe === 'digital' ? 'typewriter' : recipe === 'organic' ? 'clickSoft' : 'popClean'
			cues.push({
				id: `list-${index}`,
				asset:
					recipe === 'minimal'
						? variantSfxAsset(storyboard, 'foley-touch', cues.length)
						: legacyVariantSfxAsset(storyboard, id, cues.length),
				from: timing.from + 10,
				durationInFrames: Math.round(fps * 1),
				volume: 0.3,
			})
		}
		if (scene.type === 'monument' || scene.type === 'landscape') {
			const id: SfxId = recipe === 'cinematic' ? 'riserOrganic' : recipe === 'digital' ? 'powerUp' : 'revealShimmer'
			cues.push({
				id: `reveal-${index}`,
				asset: legacyVariantSfxAsset(storyboard, id, cues.length),
				from: timing.from + 6,
				durationInFrames: Math.round(fps * 2),
				volume: 0.3,
			})
		}
		if (scene.type === 'cta') {
			const id: SfxId = recipe === 'minimal' ? 'chimeSparkle' : recipe === 'digital' ? 'powerUp' : 'logoStinger'
			cues.push({
				id: `stinger-${index}`,
				asset: legacyVariantSfxAsset(storyboard, id, cues.length),
				from: timing.from + 4,
				durationInFrames: Math.round(fps * 2.4),
				volume: 0.42,
			})
		}
	}

	return cues.filter((cue) => cue.from < layout.durationInFrames)
}

function selectedFontWeight(weight: string, desired: number): number {
	const values = weight.match(/\d+/g)?.map(Number).filter(Number.isFinite) ?? []
	if (values.length === 0) return desired
	if (values.length === 1) return values[0]
	return Math.round(Math.min(Math.max(desired, Math.min(...values)), Math.max(...values)))
}

/** Builds the complete TSX file for a storyboard. */
export function composeVideoSource(storyboard: Storyboard): ComposedVideo {
	const layout = layoutStoryboard(storyboard)
	const palette = themeFor(PALETTES[storyboard.palette], storyboard.creativeProfile)
	const display = FONT_KIT[storyboard.displayFont]
	const body = FONT_KIT[storyboard.textFont]
	const icons = usedIcons(storyboard)
	const types = [...new Set(layout.timings.map((timing) => timing.scene.type))]
	const seedSuffix = creativeSeedSuffix(storyboard.creativeSeed)
	const compositionBase = pascalCase(storyboard.title || storyboard.subject || 'AiVideo') || 'AiVideo'
	const compositionId = `${compositionBase}V${seedSuffix}`
	const cues = soundCues(storyboard, layout)
	const summary = storyboardSummary(storyboard, layout)
	const desiredDisplayWeight =
		storyboard.creativeProfile.typography === 'editorial'
			? 650
			: storyboard.creativeProfile.typography === 'friendly'
				? 700
				: storyboard.creativeProfile.typography === 'technical'
					? 720
					: 820
	const displayWeight = selectedFontWeight(display.weight, desiredDisplayWeight)
	const textWeight = selectedFontWeight(body.weight, 450)
	const bodyWeightValues = body.weight.match(/\d+/g)?.map(Number).filter(Number.isFinite) ?? [textWeight]
	const textWeightMin = Math.min(...bodyWeightValues)
	const textWeightMax = Math.max(...bodyWeightValues)

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

	const usesThree = types.some((type) => THREE_SCENE_TYPES.includes(type))
	if (usesThree) {
		out.push(`import { ThreeCanvas } from '@remotion/three'`)
		out.push(`import { BackSide, PlaneGeometry } from 'three'`)
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

export const GENERATION = {
	id: ${json(storyboard.creativeSeed)},
	designFingerprint: ${json(storyboard.designFingerprint)},
} as const

export const CREATIVE = ${json(storyboard.creativeProfile)} as const
const CREATIVE_SEED = GENERATION.id

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
const DISPLAY_WEIGHT = ${displayWeight}
const TEXT_WEIGHT = ${textWeight}
const TEXT_WEIGHT_MIN = ${textWeightMin}
const TEXT_WEIGHT_MAX = ${textWeightMax}

/**
 * How dimensional this film is: 'flat' keeps everything on one plane, 'depth'
 * adds a perspective stage with extruded type, and 'three' also mounts real
 * WebGL scenes. DEPTH scales every pseudo-3D effect from one place.
 */
export const DIMENSION = '${storyboard.dimension}'

/** 0 disables every pseudo-3D effect, 1 enables the perspective stage. */
const DEPTH: number = ${storyboard.dimension === 'flat' ? 0 : 1}

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
	if (usesThree) out.push(THREE_STAGE)

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
	/**
	 * How heavily the frame is finished. 'matte' is the flattest of the set - it
	 * keeps the vignette faint and drops the light leak entirely - while 'print'
	 * leans on stock texture instead of light.
	 */
	const vignetteOpacity =
		CREATIVE.finish === 'matte'
			? 0.18
			: CREATIVE.finish === 'clean'
				? 0.28
				: CREATIVE.finish === 'luminous'
					? 0.38
					: CREATIVE.finish === 'print'
						? 0.34
						: 0.55
	const grainOpacity =
		CREATIVE.finish === 'clean'
			? 0.07
			: CREATIVE.finish === 'matte'
				? 0.09
				: CREATIVE.finish === 'paper'
					? 0.2
					: CREATIVE.finish === 'print'
						? 0.26
						: 0.14
	const leakOpacity =
		CREATIVE.finish === 'matte' || CREATIVE.finish === 'print'
			? 0
			: CREATIVE.finish === 'luminous'
				? 0.3
				: CREATIVE.finish === 'clean'
					? 0.1
					: 0.2

	return (
		<AbsoluteFill style={{ pointerEvents: 'none' }}>
			<Img
				src={VIGNETTE_SRC}
				style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: vignetteOpacity }}
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
					opacity: leakOpacity,
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
					opacity: grainOpacity,
					mixBlendMode: CREATIVE.finish === 'paper' || CREATIVE.finish === 'print' ? 'multiply' : 'overlay',
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
	<AbsoluteFill style={{ backgroundColor: THEME.background, fontFamily: TEXT_FONT, fontWeight: TEXT_WEIGHT, fontSynthesis: 'none' }}>
		<TransitionSeries>`)

	for (const [index, timing] of layout.timings.entries()) {
		const component = SCENE_COMPONENT[timing.scene.type]
		const creativeVariant = storyboard.creativeProfile.sceneVariants[index] ?? 0
		const visualFamily = storyboard.creativeProfile.visualFamilies[index] ?? 'burst'
		const visualVariant = storyboard.creativeProfile.visualVariants[index] ?? 0
		const artworkPath = visualVariantPath(visualFamily, visualVariant)
		out.push(`			<TransitionSeries.Sequence durationInFrames={${timing.durationInFrames}}>
				<CreativeSceneShell variant={${creativeVariant}} artworkSrc={staticFile('assets/visual/v1/${artworkPath}')}>
					<${component} ${sceneProps(timing.scene, timing.durationInFrames)} />
				</CreativeSceneShell>
			</TransitionSeries.Sequence>`)
		if (index < layout.timings.length - 1 && timing.transitionOut > 0) {
			const presentation = presentationFor(storyboard, index, layout.timings[index + 1].scene)
			out.push(`			<TransitionSeries.Transition
				presentation={${presentationCall(presentation, index, storyboard)}}
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
		fileName: `ai-generated-${seedSuffix}.tsx`,
		projectName: storyboard.title || storyboard.subject || 'AI generated video',
		compositionId,
		layout,
		summary,
	}
}
