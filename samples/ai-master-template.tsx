/**
 * AI MASTER TEMPLATE - a complete, single-file Remotion handoff.
 *
 * HOW THE USER USES THIS FILE
 * 1. Download this file from Remotion Video Studio.
 * 2. Attach it to an AI coding assistant together with your video idea.
 * 3. Tell the AI your topic, audience, goal, platform, duration, visual style,
 *    exact wording, call to action, assets, and anything to include or avoid.
 * 4. Ask the AI to follow the contract below and return ONE complete .tsx file.
 * 5. Upload the returned file to Remotion Video Studio, preview it, and render.
 *
 * COPY-PASTE PROMPT FOR THE USER
 * "Follow the AI EDITING CONTRACT in the attached file. Build a [duration]
 * [platform/aspect ratio] video about [topic] for [audience]. The goal is
 * [goal]. Use a [tone/style] visual direction. Include [must-haves], avoid
 * [things to avoid], and end with [CTA]. Return one complete runnable .tsx
 * file, not a diff or explanation."
 *
 * --------------------------------------------------------------------------
 * AI EDITING CONTRACT - AI MUST READ BEFORE CHANGING THIS FILE
 * --------------------------------------------------------------------------
 * [AI: EDIT] Treat the user's prompt as the source of truth. Infer tasteful
 * defaults when details are missing instead of stopping at placeholders.
 *
 * [AI: EDIT] Rewrite the WHOLE creative execution for the requested subject:
 * concept, script, scene order, visuals, colors, typography, animation, and
 * timing. Do not only replace the demo text or preserve this look by default.
 *
 * [AI: EDIT] Replace BRIEF, THEME, TIMELINE, and every scene component below.
 * You may add/remove scene components, SVG, charts, diagrams, or CSS artwork.
 * Make the visual language specific to the user's interest and instructions.
 * Use the embedded VISUAL KIT as a reliable starting vocabulary, then extend
 * its inline SVG paths or procedural shapes when the subject needs something
 * more specific. Never settle for text floating on an empty background.
 *
 * [AI: KEEP] Return one self-contained TSX file with no TODOs, pseudocode,
 * missing pieces, diffs, or explanatory prose. Keep every helper in this file.
 *
 * [AI: KEEP] Imports supported by this studio are: react, remotion,
 * @remotion/player, @remotion/shapes, @remotion/paths, @remotion/noise,
 * @remotion/motion-blur, @remotion/transitions and its bundled transitions,
 * @remotion/media, @remotion/media-utils, and @remotion/gif. Do not invent npm
 * packages. Do not use Tailwind, framer-motion, Three.js, or WebGL here.
 *
 * [AI: KEEP] Prefer DOM, CSS, and inline SVG. This studio provides an original
 * built-in pack at /assets/visual/v1/ and /assets/audio/v1/; those URLs remain
 * available after this file is re-uploaded here. A single file does not carry
 * any other public/ folder, so do not invent local asset paths. Use a remote
 * asset only when the user supplied a reliable URL. Do not depend on fetches,
 * downloaded fonts, or browser state.
 *
 * [AI: KEEP] All animation must be deterministic and frame-driven with
 * useCurrentFrame(), interpolate(), spring(), and deterministic math. Never use
 * CSS keyframes/transitions, Date.now(), or Math.random().
 * Use CSS linear gradients or inline SVG for radial/conic artwork and masks so
 * audio-enabled browser exports match the preview in every supported browser.
 *
 * [AI: KEEP] Every completed video must purposefully include all five visual
 * categories: (1) a recognizable topic-specific object or icon, (2) arrows or
 * connectors where they clarify flow, (3) a restrained neon/glow accent,
 * (4) supporting geometry, and (5) visible depth or 3D-like extrusion. Use
 * them to explain the story across the video; do not clutter every frame or
 * repeat the demo arrangement when a subject-specific composition is stronger.
 * Every video also needs intentional sound unless the user explicitly asks for
 * silence: one low music bed plus a small number of beat-synced transitions,
 * impacts, UI sounds, or a closing stinger. Import Audio only from
 * @remotion/media, use the built-in SOUND paths, and keep music under speech.
 *
 * [AI: KEEP] Make scene durations add up exactly to Composition
 * durationInFrames. Keep important text at least 80px from the sides. Use a
 * main headline of roughly 84px or larger in a 1080px-wide composition.
 * Do not add a persistent title/header rail or visible scene numbering such as
 * 01, 02, 03, or 04. Let each scene open directly with its actual content.
 *
 * [AI: KEEP] Preserve a hook-free Root, an explicit <Composition>,
 * registerRoot(Root), and the default export. Update width, height, fps,
 * durationInFrames, and defaultProps to match the user's requested format.
 *
 * FINAL AI CHECK BEFORE RETURNING THE FILE
 * - One complete TSX file; no unsupported imports or missing local files.
 * - The first frames hook attention; every scene has one clear focal point.
 * - Object/icon, arrow, neon, geometry, and depth are all used with purpose.
 * - Music and SFX are timed, balanced, and imported from @remotion/media.
 * - All copy fits, all animations use frames, and the full timeline fits.
 * - The final frame resolves cleanly and the Composition metadata is correct.
 *
 * EDIT MAP
 * 1. BRIEF       -> concept, audience, message, story, CTA
 * 2. THEME       -> colors, fonts, surfaces, visual personality
 * 3. TIMELINE    -> scene starts and durations in frames (30 frames = 1 second)
 * 4. SOUND       -> choose music/SFX and align them to the edited timeline
 * 5. SCENES      -> replace the actual layout and motion for the user's topic
 * 6. COMPOSITION -> set final size, fps, duration, and default props
 */

import React from 'react'
import {
	AbsoluteFill,
	Composition,
	Easing,
	interpolate,
	registerRoot,
	Sequence,
	spring,
	useCurrentFrame,
	useVideoConfig,
} from 'remotion'
import { Audio } from '@remotion/media'

/* -------------------------------------------------------------------------- */
/*  1. NORMALIZED USER BRIEF [AI: EDIT ALL CONTENT]                           */
/* -------------------------------------------------------------------------- */

export const BRIEF = {
	topic: 'Turn one idea into a finished video',
	audience: 'Creators with a story to tell',
	goal: 'Make the next step obvious',
	hook: 'YOUR IDEA\nDESERVES MOTION.',
	subhead: 'One guided file gives an AI the brief, structure, and render rules.',
	storyPoints: [
		{
			title: 'DESCRIBE',
			body: 'Share the topic, audience, goal, style, and exact call to action.',
		},
		{
			title: 'GENERATE',
			body: 'Ask your AI to rewrite the complete file around your unique idea.',
		},
		{
			title: 'RENDER',
			body: 'Upload the returned TSX, preview every frame, and export the result.',
		},
	],
	proof: 'BRIEF + STORY + STYLE + MOTION',
	cta: 'DOWNLOAD. BRIEF. BUILD.',
	ctaDetail: 'Attach this template to your AI and ask for one complete TSX file.',
	mustInclude: ['One clear hook', 'Topic-specific visuals', 'One decisive CTA'],
	avoid: ['Generic stock-template language', 'Unsupported packages', 'Random timing'],
}

/* -------------------------------------------------------------------------- */
/*  2. VISUAL THEME [AI: EDIT OR REPLACE]                                     */
/* -------------------------------------------------------------------------- */

const THEME = {
	background: '#070812',
	surface: '#121527',
	ink: '#F7F7FB',
	muted: '#A8AEC5',
	accent: '#8B7CFF',
	accent2: '#5FF4C6',
	warm: '#FFB86B',
	line: 'rgba(255,255,255,0.10)',
	fontSans: 'Inter, Arial, Helvetica, sans-serif',
	fontMono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
}

/* -------------------------------------------------------------------------- */
/*  3. TIMELINE [AI: EDIT; TOTAL MUST EQUAL 450 FRAMES / 15 SECONDS]          */
/* -------------------------------------------------------------------------- */

const TIMELINE = {
	hook: { from: 0, duration: 105 },
	brief: { from: 105, duration: 120 },
	story: { from: 225, duration: 120 },
	cta: { from: 345, duration: 105 },
}

/* -------------------------------------------------------------------------- */
/*  4. SOUND DESIGN [AI: EDIT PATHS, LEVELS, AND CUE FRAMES]                 */
/* -------------------------------------------------------------------------- */

const AUDIO_ROOT = '/assets/audio/v1'

export const SOUND = {
	music: `${AUDIO_ROOT}/music/neon-pulse-120bpm-loop.wav`,
	click: `${AUDIO_ROOT}/sfx/ui/click-soft.wav`,
	pop: `${AUDIO_ROOT}/sfx/ui/pop-clean.wav`,
	whoosh: `${AUDIO_ROOT}/sfx/transitions/whoosh-fast.wav`,
	riser: `${AUDIO_ROOT}/sfx/transitions/riser-digital.wav`,
	impact: `${AUDIO_ROOT}/sfx/impacts/impact-clean.wav`,
	shimmer: `${AUDIO_ROOT}/sfx/accents/reveal-shimmer.wav`,
	stinger: `${AUDIO_ROOT}/sfx/accents/logo-stinger.wav`,
}

const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const
const EASE_OUT = Easing.bezier(0.16, 1, 0.3, 1)

/* -------------------------------------------------------------------------- */
/*  5. ANIMATION HELPERS [AI: KEEP FRAME-DRIVEN]                              */
/* -------------------------------------------------------------------------- */

const sceneEnvelope = (frame: number, duration: number) =>
	interpolate(frame, [0, 12, duration - 14, duration - 1], [0, 1, 1, 0], {
		...CLAMP,
		easing: EASE_OUT,
	})

const SceneFrame: React.FC<{
	duration: number
	startVisible?: boolean
	children: React.ReactNode
}> = ({ duration, startVisible = false, children }) => {
	const frame = useCurrentFrame()

	return (
		<AbsoluteFill
			style={{
				opacity: startVisible
					? interpolate(frame, [duration - 14, duration - 1], [1, 0], CLAMP)
					: sceneEnvelope(frame, duration),
				padding: '250px 84px 230px',
				fontFamily: THEME.fontSans,
				color: THEME.ink,
			}}
		>
			{children}
		</AbsoluteFill>
	)
}

/* -------------------------------------------------------------------------- */
/*  PROCEDURAL VISUAL KIT [AI: KEEP; USE, RECOLOR, AND EXTEND PURPOSEFULLY]   */
/* -------------------------------------------------------------------------- */

type Point = readonly [number, number]

type IconName =
	| 'spark'
	| 'play'
	| 'bolt'
	| 'target'
	| 'chart'
	| 'layers'
	| 'cube'
	| 'code'
	| 'cursor'
	| 'check'
	| 'rocket'
	| 'sound'
	| 'orbit'
	| 'idea'

/** Original, dependency-free 24px glyphs. Add a subject-specific path when needed. */
const ICON_PATHS: Record<IconName, readonly string[]> = {
	spark: [
		'M12 2.5L14.3 9.3L21 12L14.3 14.6L12 21.5L9.6 14.6L3 12L9.6 9.3Z',
		'M18.5 3.5V7',
		'M16.75 5.25H20.25',
	],
	play: ['M8 5.5L19 12L8 18.5Z'],
	bolt: ['M13.6 2.5L5.5 13H11L9.8 21.5L18.5 10.2H13Z'],
	target: ['M12 3A9 9 0 1 0 21 12A9 9 0 0 0 12 3Z', 'M12 7A5 5 0 1 0 17 12A5 5 0 0 0 12 7Z', 'M12 10.3A1.7 1.7 0 1 0 13.7 12A1.7 1.7 0 0 0 12 10.3Z'],
	chart: ['M4 19V11', 'M10 19V5', 'M16 19V9', 'M3 19H21', 'M4 8L9 3L14 7L20 2'],
	layers: ['M12 3L21 8L12 13L3 8Z', 'M4.5 12L12 16.2L19.5 12', 'M4.5 16L12 20.2L19.5 16'],
	cube: ['M12 3L20 7.5L12 12L4 7.5Z', 'M4 7.5V16.5L12 21V12', 'M20 7.5V16.5L12 21'],
	code: ['M9 7L4 12L9 17', 'M15 7L20 12L15 17', 'M13.5 4L10.5 20'],
	cursor: ['M5 3L18.5 13L12.2 14.5L9 20.5Z', 'M12.2 14.5L17 20'],
	check: ['M12 3A9 9 0 1 0 21 12A9 9 0 0 0 12 3Z', 'M7.5 12.2L10.5 15.2L16.8 8.8'],
	rocket: ['M8.2 15.8C6.2 15.5 4.8 16.2 3.5 18.5C5.8 19.1 7.5 18.5 8.8 16.8', 'M9 15L6 12L7.8 8.5L12 7C14.7 4.3 17.5 3.2 21 3C20.8 6.5 19.7 9.3 17 12L15.5 16.2L12 18L9 15Z', 'M14.8 8.2A1.8 1.8 0 1 0 18.4 8.2A1.8 1.8 0 0 0 14.8 8.2Z'],
	sound: ['M4 10H8L13 6V18L8 14H4Z', 'M16 9C17.6 10.5 17.6 13.5 16 15', 'M18.8 6.5C22 9.5 22 14.5 18.8 17.5'],
	orbit: ['M5 14.5C2.4 12.8 3.8 9.5 7.8 7.2C11.8 4.9 17.2 4.5 19.6 6.5C22 8.5 19.9 12 16 14.3C12.1 16.6 7.4 17.2 5 14.5Z', 'M12 10.2A1.8 1.8 0 1 0 13.8 12A1.8 1.8 0 0 0 12 10.2Z', 'M4.5 17.5L6.8 15.2'],
	idea: ['M8.5 15.5C6.8 14.3 6 12.6 6 10.5A6 6 0 0 1 18 10.5C18 12.6 17.2 14.3 15.5 15.5L14.5 17H9.5Z', 'M9.5 20H14.5', 'M12 1.5V4', 'M3.5 5L5.4 6.6', 'M20.5 5L18.6 6.6'],
}

const VectorIcon: React.FC<{
	name: IconName
	size?: number
	color?: string
	strokeWidth?: number
	glow?: boolean
}> = ({ name, size = 48, color = THEME.ink, strokeWidth = 1.8, glow = false }) => (
	<svg
		width={size}
		height={size}
		viewBox="0 0 24 24"
		fill="none"
		aria-hidden
		style={{
			display: 'block',
			overflow: 'visible',
			filter: glow ? `drop-shadow(0 0 ${Math.max(8, size * 0.24)}px ${color})` : undefined,
		}}
	>
		{ICON_PATHS[name].map((path, index) => (
			<path
				key={`${name}-${index}`}
				d={path}
				stroke={color}
				strokeWidth={strokeWidth}
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		))}
	</svg>
)

const IconBadge: React.FC<{
	name: IconName
	color: string
	size?: number
	delay?: number
}> = ({ name, color, size = 76, delay = 0 }) => {
	const frame = useCurrentFrame()
	const enter = interpolate(frame, [delay, delay + 18], [0, 1], {
		...CLAMP,
		easing: EASE_OUT,
	})
	const float = Math.sin((frame - delay) * 0.075) * 4
	const pulse = 0.72 + Math.sin((frame - delay) * 0.11) * 0.16

	return (
		<div
			style={{
				width: size,
				height: size,
				borderRadius: size * 0.28,
				border: `1px solid ${color}88`,
				background: `linear-gradient(145deg, ${color}38, rgba(10,12,24,0.94) 72%)`,
				boxShadow: `0 18px 36px rgba(0,0,0,0.34), 0 0 ${24 * pulse}px ${color}66`,
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				opacity: enter,
				scale: interpolate(enter, [0, 1], [0.72, 1]),
				translate: `0 ${interpolate(enter, [0, 1], [24, 0]) + float}px`,
			}}
		>
			<VectorIcon name={name} size={size * 0.47} color={color} glow />
		</div>
	)
}

const FlowArrow: React.FC<{
	from: Point
	to: Point
	color: string
	bend?: number
	startFrame?: number
	drawFrames?: number
	strokeWidth?: number
}> = ({ from, to, color, bend = 0, startFrame = 0, drawFrames = 24, strokeWidth = 5 }) => {
	const frame = useCurrentFrame()
	const { width, height } = useVideoConfig()
	const draw = interpolate(frame, [startFrame, startFrame + drawFrames], [0, 1], {
		...CLAMP,
		easing: EASE_OUT,
	})
	const dx = to[0] - from[0]
	const dy = to[1] - from[1]
	const length = Math.max(1, Math.sqrt(dx * dx + dy * dy))
	const control: Point = [
		(from[0] + to[0]) / 2 - (dy / length) * bend,
		(from[1] + to[1]) / 2 + (dx / length) * bend,
	]
	const path = `M ${from[0]} ${from[1]} Q ${control[0]} ${control[1]} ${to[0]} ${to[1]}`
	const angle = (Math.atan2(to[1] - control[1], to[0] - control[0]) * 180) / Math.PI
	const headScale = interpolate(draw, [0.72, 1], [0, 1], CLAMP)
	const dotX = (1 - draw) * (1 - draw) * from[0] + 2 * (1 - draw) * draw * control[0] + draw * draw * to[0]
	const dotY = (1 - draw) * (1 - draw) * from[1] + 2 * (1 - draw) * draw * control[1] + draw * draw * to[1]

	return (
		<svg
			width="100%"
			height="100%"
			viewBox={`0 0 ${width} ${height}`}
			preserveAspectRatio="none"
			aria-hidden
			style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }}
		>
			<path
				d={path}
				fill="none"
				stroke={color}
				strokeOpacity={0.16}
				strokeWidth={strokeWidth + 7}
				strokeLinecap="round"
			/>
			<path
				d={path}
				fill="none"
				stroke={color}
				strokeWidth={strokeWidth}
				strokeLinecap="round"
				pathLength={1}
				strokeDasharray={1}
				strokeDashoffset={1 - draw}
				style={{ filter: `drop-shadow(0 0 10px ${color})` }}
			/>
			<circle cx={dotX} cy={dotY} r={strokeWidth * 1.45} fill={color} opacity={draw < 0.99 ? 1 : 0} />
			<g
				transform={`translate(${to[0]} ${to[1]}) rotate(${angle}) scale(${headScale})`}
				style={{ filter: `drop-shadow(0 0 10px ${color})` }}
			>
				<path d="M0 0L-28 -14L-21 0L-28 14Z" fill={color} />
			</g>
		</svg>
	)
}

const HEX_COLOR = /^#([0-9a-f]{6})$/i

const mixHex = (hex: string, target: number, amount: number) => {
	const match = HEX_COLOR.exec(hex)
	if (!match) return hex
	const value = parseInt(match[1], 16)
	const channel = (shift: number) => {
		const current = (value >> shift) & 0xff
		return Math.round(current + (target - current) * amount)
	}
	const mixed = (channel(16) << 16) | (channel(8) << 8) | channel(0)
	return `#${mixed.toString(16).padStart(6, '0')}`
}

type ShapeKind = 'circle' | 'ring' | 'diamond' | 'hex' | 'triangle' | 'star'
type SolidShapeKind = Exclude<ShapeKind, 'ring'>

const SHAPE_CLIP: Record<SolidShapeKind, string> = {
	circle: 'circle(50% at 50% 50%)',
	diamond: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)',
	hex: 'polygon(25% 6%, 75% 6%, 100% 50%, 75% 94%, 25% 94%, 0% 50%)',
	triangle: 'polygon(50% 2%, 98% 94%, 2% 94%)',
	star: 'polygon(50% 0%, 61% 34%, 98% 35%, 68% 56%, 79% 92%, 50% 71%, 21% 92%, 32% 56%, 2% 35%, 39% 34%)',
}

const GeoShape: React.FC<{
	kind: ShapeKind
	x: number
	y: number
	size: number
	color: string
	delay?: number
	opacity?: number
	spin?: number
}> = ({ kind, x, y, size, color, delay = 0, opacity = 0.3, spin = 0.18 }) => {
	const frame = useCurrentFrame()
	const enter = interpolate(frame, [delay, delay + 20], [0, 1], {
		...CLAMP,
		easing: EASE_OUT,
	})
	const rotation = frame * spin + Math.sin((frame + delay) * 0.025) * 6
	const common: React.CSSProperties = {
		position: 'absolute',
		left: x - size / 2,
		top: y - size / 2,
		width: size,
		height: size,
		opacity: opacity * enter,
		scale: interpolate(enter, [0, 1], [0.62, 1]),
		rotate: `${rotation}deg`,
	}

	if (kind === 'ring') {
		return (
			<div
				style={{
					...common,
					borderRadius: '50%',
					border: `2px solid ${color}`,
					boxShadow: `0 0 24px ${color}55`,
				}}
			/>
		)
	}

	return (
		<div
			style={{
				...common,
				clipPath: SHAPE_CLIP[kind],
				background: `linear-gradient(145deg, ${mixHex(color, 255, 0.28)}, ${color} 50%, ${mixHex(color, 0, 0.28)})`,
				boxShadow: `0 0 28px ${color}44`,
			}}
		/>
	)
}

const DepthShape: React.FC<{
	kind: SolidShapeKind
	x: number
	y: number
	size: number
	color: string
	delay?: number
	depth?: number
	layers?: number
	rotation?: number
}> = ({ kind, x, y, size, color, delay = 0, depth = 24, layers = 8, rotation = -8 }) => {
	const frame = useCurrentFrame()
	const enter = interpolate(frame, [delay, delay + 20], [0, 1], {
		...CLAMP,
		easing: EASE_OUT,
	})
	const bob = Math.sin((frame - delay) * 0.055) * 6
	const pulse = 0.76 + Math.sin((frame - delay) * 0.09) * 0.12

	return (
		<div
			style={{
				position: 'absolute',
				left: x - size / 2,
				top: y - size / 2,
				width: size,
				height: size,
				opacity: enter,
				scale: interpolate(enter, [0, 1], [0.56, 1]),
				translate: `0 ${interpolate(enter, [0, 1], [44, 0]) + bob}px`,
				rotate: `${rotation + Math.sin(frame * 0.025) * 3}deg`,
			}}
		>
			{Array.from({ length: layers }).map((_, index) => {
				const layerDepth = ((layers - index) / layers) * depth
				return (
					<div
						key={index}
						style={{
							position: 'absolute',
							inset: 0,
							translate: `${layerDepth}px ${layerDepth * 0.72}px`,
							clipPath: SHAPE_CLIP[kind],
							backgroundColor: mixHex(color, 0, 0.42 + (layerDepth / depth) * 0.2),
						}}
					/>
				)
			})}
			<div
				style={{
					position: 'absolute',
					inset: 0,
					clipPath: SHAPE_CLIP[kind],
					background: `linear-gradient(142deg, ${mixHex(color, 255, 0.42)} 0%, ${color} 48%, ${mixHex(color, 0, 0.34)} 100%)`,
					boxShadow: `0 28px 54px rgba(0,0,0,0.42), 0 0 ${30 * pulse}px ${color}88`,
				}}
			/>
			<div
				style={{
					position: 'absolute',
					left: '17%',
					top: '12%',
					width: '48%',
					height: '18%',
					borderRadius: 999,
					background: 'linear-gradient(90deg, rgba(255,255,255,0.46), rgba(255,255,255,0))',
					opacity: 0.72,
					rotate: '-18deg',
				}}
			/>
		</div>
	)
}

const NeonRing: React.FC<{
	x: number
	y: number
	size: number
	color: string
	delay?: number
}> = ({ x, y, size, color, delay = 0 }) => {
	const frame = useCurrentFrame()
	const enter = interpolate(frame, [delay, delay + 22], [0, 1], {
		...CLAMP,
		easing: EASE_OUT,
	})
	const angle = (frame - delay) * 0.025
	const radius = size / 2
	const pulse = 0.78 + Math.sin((frame - delay) * 0.08) * 0.14

	return (
		<div
			style={{
				position: 'absolute',
				left: x - radius,
				top: y - radius,
				width: size,
				height: size,
				borderRadius: '50%',
				border: `2px solid ${color}88`,
				boxShadow: `0 0 ${32 * pulse}px ${color}66`,
				opacity: enter,
				scale: interpolate(enter, [0, 1], [0.72, 1]),
			}}
		>
			<div
				style={{
					position: 'absolute',
					left: radius - 8 + Math.cos(angle) * radius,
					top: radius - 8 + Math.sin(angle) * radius,
					width: 16,
					height: 16,
					borderRadius: '50%',
					backgroundColor: color,
					boxShadow: `0 0 22px ${color}`,
				}}
			/>
		</div>
	)
}

const hashValue = (value: number) => {
	const hashed = Math.sin(value * 91.3458) * 47453.5453
	return hashed - Math.floor(hashed)
}

const ParticleField: React.FC<{
	seed: number
	count?: number
	colorA: string
	colorB: string
}> = ({ seed, count = 28, colorA, colorB }) => {
	const frame = useCurrentFrame()
	const { width, height } = useVideoConfig()

	return (
		<AbsoluteFill style={{ overflow: 'hidden', pointerEvents: 'none' }}>
			{Array.from({ length: count }).map((_, index) => {
				const baseX = hashValue(seed * 11 + index * 3.17)
				const baseY = hashValue(seed * 17 + index * 7.31)
				const speed = 0.12 + hashValue(seed + index * 5.9) * 0.34
				const travel = (frame * speed + baseY * (height + 120)) % (height + 120)
				const size = 3 + hashValue(seed * 3 + index * 9.7) * 8
				const color = index % 3 === 0 ? colorB : colorA
				return (
					<div
						key={index}
						style={{
							position: 'absolute',
							left: baseX * width + Math.sin(frame * 0.012 + index) * 18,
							top: travel - 60,
							width: size,
							height: size,
							borderRadius: index % 2 === 0 ? '50%' : 2,
							backgroundColor: color,
							boxShadow: `0 0 ${size * 2}px ${color}`,
							opacity: 0.12 + hashValue(seed + index) * 0.25,
							rotate: `${frame * (index % 2 === 0 ? 0.3 : -0.22) + index * 19}deg`,
						}}
					/>
				)
			})}
		</AbsoluteFill>
	)
}

const VisualCluster: React.FC<{
	x: number
	y: number
	size: number
	color: string
	secondaryColor: string
	icon: IconName
	shape?: SolidShapeKind
	delay?: number
	satellites?: readonly [IconName, IconName]
}> = ({
	x,
	y,
	size,
	color,
	secondaryColor,
	icon,
	shape = 'hex',
	delay = 0,
	satellites = ['spark', 'orbit'],
}) => {
	const frame = useCurrentFrame()
	const enter = interpolate(frame, [delay + 8, delay + 28], [0, 1], {
		...CLAMP,
		easing: EASE_OUT,
	})

	return (
		<>
			<NeonRing x={x} y={y} size={size * 1.42} color={secondaryColor} delay={delay} />
			<GeoShape kind="diamond" x={x - size * 0.74} y={y + size * 0.38} size={size * 0.24} color={color} delay={delay + 8} opacity={0.44} spin={0.42} />
			<GeoShape kind="triangle" x={x + size * 0.72} y={y - size * 0.42} size={size * 0.22} color={secondaryColor} delay={delay + 12} opacity={0.5} spin={-0.34} />
			<DepthShape kind={shape} x={x} y={y} size={size} color={color} delay={delay + 3} depth={size * 0.09} />
			<div
				style={{
					position: 'absolute',
					left: x - size * 0.16,
					top: y - size * 0.16,
					width: size * 0.32,
					height: size * 0.32,
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					opacity: enter,
					scale: interpolate(enter, [0, 1], [0.5, 1]),
					translate: `0 ${Math.sin((frame - delay) * 0.055) * 6}px`,
				}}
			>
				<VectorIcon name={icon} size={size * 0.29} color={THEME.ink} strokeWidth={1.55} glow />
			</div>
			<div style={{ position: 'absolute', left: x - size * 0.88, top: y - size * 0.72 }}>
				<IconBadge name={satellites[0]} color={secondaryColor} size={size * 0.25} delay={delay + 14} />
			</div>
			<div style={{ position: 'absolute', left: x + size * 0.62, top: y + size * 0.48 }}>
				<IconBadge name={satellites[1]} color={color} size={size * 0.22} delay={delay + 20} />
			</div>
		</>
	)
}

/* -------------------------------------------------------------------------- */
/*  SHARED VISUALS [AI: REPLACE TO MATCH THE USER'S SUBJECT]                 */
/* -------------------------------------------------------------------------- */

const Background: React.FC = () => {
	const frame = useCurrentFrame()
	const { durationInFrames, width, height } = useVideoConfig()
	const phase = (frame / Math.max(1, durationInFrames - 1)) * Math.PI * 2

	return (
		<AbsoluteFill style={{ backgroundColor: THEME.background, overflow: 'hidden' }}>
			<svg
				aria-hidden="true"
				viewBox={`0 0 ${width} ${height}`}
				preserveAspectRatio="none"
				style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
			>
				<defs>
					<radialGradient id="ai-master-accent-glow">
						<stop offset="0%" stopColor={THEME.accent} stopOpacity={0.32} />
						<stop offset="68%" stopColor={THEME.accent} stopOpacity={0} />
					</radialGradient>
					<radialGradient id="ai-master-secondary-glow">
						<stop offset="0%" stopColor={THEME.accent2} stopOpacity={0.2} />
						<stop offset="70%" stopColor={THEME.accent2} stopOpacity={0} />
					</radialGradient>
					<radialGradient id="ai-master-vignette" cx="50%" cy="45%" r="72%">
						<stop offset="35%" stopColor="#04050c" stopOpacity={0} />
						<stop offset="100%" stopColor="#04050c" stopOpacity={0.74} />
					</radialGradient>
					<pattern id="ai-master-grid" width="72" height="72" patternUnits="userSpaceOnUse">
						<path d="M 72 0 L 0 0 0 72" fill="none" stroke={THEME.line} strokeWidth="1" />
					</pattern>
				</defs>
				<circle
					cx={160 + Math.cos(phase) * 80}
					cy={530 + Math.sin(phase) * 100}
					r="400"
					fill="url(#ai-master-accent-glow)"
				/>
				<circle
					cx={1230 - Math.sin(phase) * 90}
					cy={1310 - Math.cos(phase) * 120}
					r="430"
					fill="url(#ai-master-secondary-glow)"
				/>
				<rect width={width} height={height} fill="url(#ai-master-grid)" opacity={0.28} />
				<rect width={width} height={height} fill="url(#ai-master-vignette)" />
			</svg>
			<ParticleField seed={17} count={30} colorA={THEME.accent} colorB={THEME.accent2} />
			<GeoShape kind="ring" x={916} y={314} size={180} color={THEME.accent} opacity={0.12} spin={0.08} />
			<GeoShape kind="hex" x={104} y={1450} size={112} color={THEME.accent2} opacity={0.1} spin={-0.12} />
		</AbsoluteFill>
	)
}

const ProgressRail: React.FC = () => {
	const frame = useCurrentFrame()
	const { durationInFrames } = useVideoConfig()
	const progress = interpolate(frame, [0, durationInFrames - 1], [0, 1], CLAMP)

	return (
		<div
			style={{
				position: 'absolute',
				left: 84,
				right: 84,
				bottom: 92,
				height: 4,
				borderRadius: 99,
				backgroundColor: THEME.line,
				overflow: 'hidden',
			}}
		>
			<div
				style={{
					width: `${progress * 100}%`,
					height: '100%',
					borderRadius: 99,
					background: `linear-gradient(90deg, ${THEME.accent}, ${THEME.accent2})`,
				}}
			/>
		</div>
	)
}

const SafeAreaGuides: React.FC = () => (
	<div
		style={{
			position: 'absolute',
			left: 84,
			right: 84,
			top: 190,
			bottom: 190,
			border: `2px dashed ${THEME.warm}`,
			borderRadius: 28,
		pointerEvents: 'none',
			opacity: 0.7,
		}}
	>
		<div
			style={{
				position: 'absolute',
				left: 18,
				top: 14,
				fontFamily: THEME.fontMono,
				fontSize: 16,
				letterSpacing: 2,
				color: THEME.warm,
			}}
		>
			SAFE AREA - turn showGuides off before rendering
		</div>
	</div>
)

/* -------------------------------------------------------------------------- */
/*  SCENE 1: HOOK [AI: REPLACE WITH THE STRONGEST OPENING]                   */
/* -------------------------------------------------------------------------- */

const HookScene: React.FC = () => {
	const frame = useCurrentFrame()
	const { fps } = useVideoConfig()
	const entrance = spring({
		frame: frame + 8,
		fps,
		config: { damping: 18, stiffness: 95, mass: 0.9 },
	})

	return (
		<SceneFrame duration={TIMELINE.hook.duration} startVisible>
			<div
				style={{
					marginTop: 170,
					fontSize: 126,
					fontWeight: 950,
					lineHeight: 0.92,
					letterSpacing: -6,
					whiteSpace: 'pre-line',
					opacity: entrance,
					translate: `0 ${interpolate(entrance, [0, 1], [90, 0])}px`,
					scale: interpolate(entrance, [0, 1], [0.92, 1]),
				}}
			>
				{BRIEF.hook}
			</div>
			<div
				style={{
					marginTop: 42,
					width: interpolate(frame, [18, 52], [0, 720], {
						...CLAMP,
						easing: EASE_OUT,
					}),
					height: 12,
					borderRadius: 99,
					background: `linear-gradient(90deg, ${THEME.accent}, ${THEME.accent2})`,
				}}
			/>
			<div
				style={{
					marginTop: 54,
					maxWidth: 830,
					fontSize: 42,
					fontWeight: 520,
					lineHeight: 1.35,
					color: THEME.muted,
					opacity: interpolate(frame, [34, 58], [0, 1], CLAMP),
				}}
			>
				{BRIEF.subhead}
			</div>
			<FlowArrow
				from={[238, 1270]}
				to={[602, 1235]}
				bend={-82}
				color={THEME.accent2}
				startFrame={38}
				drawFrames={28}
			/>
			<VisualCluster
				x={760}
				y={1235}
				size={238}
				color={THEME.accent}
				secondaryColor={THEME.accent2}
				icon="idea"
				shape="diamond"
				delay={22}
				satellites={['code', 'spark']}
			/>
			<div
				style={{
					position: 'absolute',
					left: 84,
					bottom: 270,
					display: 'flex',
					gap: 14,
					opacity: interpolate(frame, [54, 72], [0, 1], CLAMP),
				}}
			>
				{['BRIEF', 'STORY', 'STYLE', 'MOTION'].map((item, index) => (
					<div
						key={item}
						style={{
							padding: '14px 20px',
							borderRadius: 999,
							border: `1px solid ${index === 0 ? THEME.accent : THEME.line}`,
							backgroundColor: index === 0 ? `${THEME.accent}24` : THEME.surface,
							fontFamily: THEME.fontMono,
							fontSize: 17,
							fontWeight: 800,
							letterSpacing: 2,
							color: index === 0 ? THEME.ink : THEME.muted,
						}}
					>
						{item}
					</div>
				))}
			</div>
		</SceneFrame>
	)
}

/* -------------------------------------------------------------------------- */
/*  SCENE 2: BRIEF [AI: SHOW THE PROBLEM, AUDIENCE, OR CONTEXT]               */
/* -------------------------------------------------------------------------- */

const BriefScene: React.FC = () => {
	const frame = useCurrentFrame()
	const { fps } = useVideoConfig()
	const rows: Array<{ key: string; value: string; color: string; icon: IconName }> = [
		{ key: 'TOPIC', value: BRIEF.topic, color: THEME.accent, icon: 'idea' },
		{ key: 'AUDIENCE', value: BRIEF.audience, color: THEME.accent2, icon: 'layers' },
		{ key: 'GOAL', value: BRIEF.goal, color: THEME.warm, icon: 'target' },
	]

	return (
		<SceneFrame duration={TIMELINE.brief.duration}>
			<div
				style={{
					marginTop: 80,
					fontSize: 94,
					fontWeight: 930,
					lineHeight: 1,
					letterSpacing: -4,
				}}
			>
				Tell the AI what
				<br />
				<span style={{ color: THEME.accent2 }}>success looks like.</span>
			</div>
			<FlowArrow
				from={[1012, 688]}
				to={[1012, 1045]}
				bend={-58}
				color={THEME.accent2}
				startFrame={22}
				drawFrames={44}
				strokeWidth={4}
			/>
			<div style={{ marginTop: 72, display: 'flex', flexDirection: 'column', gap: 22 }}>
				{rows.map((row, index) => {
					const enter = spring({
						frame: frame - index * 9,
						fps,
						config: { damping: 18, stiffness: 105 },
					})
					return (
						<div
							key={row.key}
							style={{
								display: 'grid',
								gridTemplateColumns: '86px 1fr',
								alignItems: 'center',
								gap: 24,
								minHeight: 154,
								padding: '28px 30px',
								borderRadius: 28,
								border: `1px solid ${THEME.line}`,
								backgroundColor: 'rgba(18,21,39,0.82)',
								opacity: enter,
								translate: `${interpolate(enter, [0, 1], [70, 0])}px 0`,
							}}
						>
							<IconBadge name={row.icon} color={row.color} size={64} delay={index * 9 + 4} />
							<div>
								<div
									style={{
										fontFamily: THEME.fontMono,
										fontSize: 16,
										fontWeight: 800,
										letterSpacing: 3,
										color: row.color,
										marginBottom: 9,
									}}
								>
									{row.key}
								</div>
								<div style={{ fontSize: 36, fontWeight: 750, lineHeight: 1.16 }}>{row.value}</div>
							</div>
						</div>
					)
				})}
			</div>
			<div
				style={{
					marginTop: 42,
					fontFamily: THEME.fontMono,
					fontSize: 22,
					lineHeight: 1.55,
					color: THEME.muted,
					opacity: interpolate(frame, [54, 78], [0, 1], CLAMP),
				}}
			>
				User prompt = source of truth. Missing detail = tasteful AI inference.
			</div>
		</SceneFrame>
	)
}

/* -------------------------------------------------------------------------- */
/*  SCENE 3: STORY / PROOF [AI: BUILD TOPIC-SPECIFIC VISUAL EVIDENCE]         */
/* -------------------------------------------------------------------------- */

const StoryScene: React.FC = () => {
	const frame = useCurrentFrame()
	const { fps } = useVideoConfig()
	const storyIcons: IconName[] = ['cursor', 'spark', 'play']

	return (
		<SceneFrame duration={TIMELINE.story.duration}>
			<div
				style={{
					marginTop: 40,
					fontFamily: THEME.fontMono,
					fontSize: 24,
					fontWeight: 800,
					letterSpacing: 4,
					color: THEME.muted,
				}}
			>
				{BRIEF.proof}
			</div>
			<div
				style={{
					marginTop: 26,
					fontSize: 100,
					fontWeight: 940,
					lineHeight: 0.98,
					letterSpacing: -4,
				}}
			>
				One file.
				<br />
				<span style={{ color: THEME.accent }}>Three clear moves.</span>
			</div>
			<FlowArrow
				from={[62, 700]}
				to={[62, 1112]}
				bend={64}
				color={THEME.accent}
				startFrame={18}
				drawFrames={54}
				strokeWidth={4}
			/>
			<div style={{ marginTop: 68, display: 'flex', flexDirection: 'column', gap: 18 }}>
				{BRIEF.storyPoints.map((point, index) => {
					const enter = spring({
						frame: frame - 12 - index * 10,
						fps,
						config: { damping: 20, stiffness: 120 },
					})
					return (
						<div
							key={point.title}
							style={{
								display: 'grid',
								gridTemplateColumns: '72px 158px 1fr',
								alignItems: 'center',
								gap: 22,
								padding: '28px 30px',
								borderRadius: 26,
								border: `1px solid ${index === 1 ? `${THEME.accent}88` : THEME.line}`,
								backgroundColor: index === 1 ? `${THEME.accent}18` : THEME.surface,
								opacity: enter,
								translate: `0 ${interpolate(enter, [0, 1], [64, 0])}px`,
							}}
						>
							<IconBadge
								name={storyIcons[index] ?? 'spark'}
								color={index === 1 ? THEME.accent2 : THEME.accent}
								size={56}
								delay={12 + index * 10}
							/>
							<div
								style={{
									fontSize: 29,
									fontWeight: 900,
									letterSpacing: 1,
									color: index === 1 ? THEME.accent2 : THEME.ink,
								}}
							>
								{point.title}
							</div>
							<div style={{ fontSize: 25, lineHeight: 1.35, color: THEME.muted }}>{point.body}</div>
						</div>
					)
				})}
			</div>
			<div
				style={{
					position: 'absolute',
					left: 84,
					right: 84,
					bottom: 250,
					display: 'flex',
					justifyContent: 'space-between',
					fontFamily: THEME.fontMono,
					fontSize: 17,
					letterSpacing: 2,
					color: THEME.muted,
					opacity: interpolate(frame, [64, 84], [0, 1], CLAMP),
				}}
			>
				<span>DETERMINISTIC FRAMES</span>
				<span>SUBJECT-SPECIFIC VISUALS</span>
			</div>
		</SceneFrame>
	)
}

/* -------------------------------------------------------------------------- */
/*  SCENE 4: CTA [AI: END WITH THE USER'S ONE DESIRED ACTION]                 */
/* -------------------------------------------------------------------------- */

const CtaScene: React.FC = () => {
	const frame = useCurrentFrame()
	const { fps } = useVideoConfig()
	const enter = spring({
		frame,
		fps,
		config: { damping: 16, stiffness: 88, mass: 0.95 },
	})

	return (
		<SceneFrame duration={TIMELINE.cta.duration}>
			<VisualCluster
				x={540}
				y={560}
				size={278}
				color={THEME.accent2}
				secondaryColor={THEME.accent}
				icon="rocket"
				shape="hex"
				delay={2}
				satellites={['check', 'orbit']}
			/>
			<div
				style={{
					position: 'absolute',
					left: 84,
					right: 84,
					top: 875,
					textAlign: 'center',
					opacity: enter,
					translate: `0 ${interpolate(enter, [0, 1], [54, 0])}px`,
				}}
			>
				<div
					style={{
						fontSize: 104,
						fontWeight: 950,
						lineHeight: 0.96,
						letterSpacing: -5,
					}}
				>
					{BRIEF.cta}
				</div>
				<div
					style={{
						margin: '42px auto 0',
						maxWidth: 760,
						fontSize: 36,
						fontWeight: 560,
						lineHeight: 1.4,
						color: THEME.muted,
					}}
				>
					{BRIEF.ctaDetail}
				</div>
				<div
					style={{
						display: 'inline-flex',
						alignItems: 'center',
						gap: 16,
						marginTop: 50,
						padding: '20px 28px',
						borderRadius: 999,
						backgroundColor: THEME.ink,
						fontFamily: THEME.fontMono,
						fontSize: 20,
						fontWeight: 900,
						letterSpacing: 2,
						color: THEME.background,
					}}
				>
					<span style={{ color: THEME.accent }}>AI MASTER TEMPLATE</span>
					<VectorIcon name="play" size={20} color={THEME.background} strokeWidth={2.2} />
					<span>YOUR VIDEO</span>
				</div>
			</div>
		</SceneFrame>
	)
}

/* -------------------------------------------------------------------------- */
/*  SOUNDTRACK [AI: RETIME CUES AFTER EDITING THE SCENE TIMELINE]             */
/* -------------------------------------------------------------------------- */

const Soundtrack: React.FC = () => (
	<>
		<Audio
			src={SOUND.music}
			loop
			volume={(frame) =>
				interpolate(frame, [0, 24, 416, 449], [0, 0.14, 0.14, 0], CLAMP)
			}
		/>

		{/* Hook emphasis. */}
		<Sequence from={8} durationInFrames={32}>
			<Audio src={SOUND.impact} volume={0.34} />
		</Sequence>
		<Sequence from={56} durationInFrames={24}>
			<Audio src={SOUND.shimmer} volume={0.2} />
		</Sequence>

		{/* Scene transitions. */}
		{[98, 218, 338].map((from) => (
			<Sequence key={from} from={from} durationInFrames={24}>
				<Audio src={SOUND.whoosh} volume={0.24} />
			</Sequence>
		))}

		{/* Brief/story beats and the final payoff. */}
		{[122, 151, 180, 248, 280, 312].map((from) => (
			<Sequence key={from} from={from} durationInFrames={12}>
				<Audio src={SOUND.pop} volume={0.18} />
			</Sequence>
		))}
		<Sequence from={330} durationInFrames={48}>
			<Audio src={SOUND.riser} volume={0.18} />
		</Sequence>
		<Sequence from={349} durationInFrames={30}>
			<Audio src={SOUND.impact} volume={0.3} />
		</Sequence>
		<Sequence from={405} durationInFrames={40}>
			<Audio src={SOUND.stinger} volume={0.22} />
		</Sequence>
	</>
)

/* -------------------------------------------------------------------------- */
/*  6. MASTER COMPOSITION [AI: ASSEMBLE ALL SCENES HERE]                      */
/* -------------------------------------------------------------------------- */

export type AiMasterTemplateProps = {
	showGuides: boolean
}

export const AiMasterTemplate: React.FC<AiMasterTemplateProps> = ({ showGuides }) => (
	<AbsoluteFill style={{ backgroundColor: THEME.background }}>
		<Soundtrack />
		<Background />

		<Sequence name="Scene 1 - Hook" from={TIMELINE.hook.from} durationInFrames={TIMELINE.hook.duration}>
			<HookScene />
		</Sequence>
		<Sequence name="Scene 2 - Brief" from={TIMELINE.brief.from} durationInFrames={TIMELINE.brief.duration}>
			<BriefScene />
		</Sequence>
		<Sequence name="Scene 3 - Story" from={TIMELINE.story.from} durationInFrames={TIMELINE.story.duration}>
			<StoryScene />
		</Sequence>
		<Sequence name="Scene 4 - CTA" from={TIMELINE.cta.from} durationInFrames={TIMELINE.cta.duration}>
			<CtaScene />
		</Sequence>

		<ProgressRail />
		{showGuides ? <SafeAreaGuides /> : null}
	</AbsoluteFill>
)

/* -------------------------------------------------------------------------- */
/*  7. ROOT REGISTRATION [AI: KEEP; EDIT INLINE VIDEO METADATA AS REQUESTED]  */
/* -------------------------------------------------------------------------- */

export const Root: React.FC = () => (
	<Composition
		id="AiMasterTemplate"
		component={AiMasterTemplate}
		durationInFrames={450}
		fps={30}
		width={1080}
		height={1920}
		defaultProps={{ showGuides: false }}
	/>
)

registerRoot(Root)

export default AiMasterTemplate
