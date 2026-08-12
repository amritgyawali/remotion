/**
 * CODE BECOMES GEOMETRY - flagship sample for Remotion Video Studio.
 *
 * 1080x1920 (9:16) - 30fps - 20s - no assets, no fonts to download, no audio.
 * Everything is drawn with plain DOM + CSS so it rasterises perfectly in the
 * browser renderer AND in headless Chrome on the server.
 *
 * Safe area for essential content: x 100-980, y 330-1430.
 *
 * Upload this single file to the studio, or run it locally:
 *   npx remotion studio samples/code-becomes-geometry.tsx
 *   node scripts/render-local.mjs samples/code-becomes-geometry.tsx --preset max
 */

import React from 'react'
import {
	AbsoluteFill,
	Composition,
	Easing,
	interpolate,
	random,
	registerRoot,
	spring,
	useCurrentFrame,
	useVideoConfig,
} from 'remotion'

/* -------------------------------------------------------------------------- */
/*  Design tokens                                                             */
/* -------------------------------------------------------------------------- */

const COLORS = {
	background: '#05070F',
	ink: '#F2F6FF',
	muted: '#8092AC',
	line: 'rgba(255,255,255,0.08)',
	cyan: '#22D3EE',
	green: '#34E29B',
	violet: '#A78BFA',
	amber: '#FBBF24',
}

const SANS = 'Inter, "Helvetica Neue", Arial, sans-serif'
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace'

export const DURATION_IN_FRAMES = 600
export const FPS = 30
export const WIDTH = 1080
export const HEIGHT = 1920

/* -------------------------------------------------------------------------- */
/*  Pattern definitions - the whole video is driven by these ASCII maps        */
/* -------------------------------------------------------------------------- */

type Phase = {
	id: string
	label: string
	subtitle: string
	color: string
	code: string
	rows: string[]
	start: number
	end: number
}

const PHASES: Phase[] = [
	{
		id: 'triangle',
		label: 'RIGHT TRIANGLE',
		subtitle: 'one nested loop',
		color: COLORS.green,
		code: 'for j in range(i + 1):',
		rows: ['*', '**', '***', '****', '*****'],
		start: 60,
		end: 180,
	},
	{
		id: 'square',
		label: 'HOLLOW SQUARE',
		subtitle: 'edges only',
		color: COLORS.cyan,
		code: 'if i in edge or j in edge:',
		rows: ['*****', '*...*', '*...*', '*...*', '*****'],
		start: 180,
		end: 300,
	},
	{
		id: 'diamond',
		label: 'DIAMOND',
		subtitle: 'mirror the middle',
		color: COLORS.violet,
		code: 'if abs(mid - i) + abs(mid - j) <= mid:',
		rows: ['..*..', '.***.', '*****', '.***.', '..*..'],
		start: 300,
		end: 420,
	},
	{
		id: 'butterfly',
		label: 'BUTTERFLY',
		subtitle: 'two triangles, mirrored',
		color: COLORS.amber,
		code: 'if j < i or j > n - i:',
		rows: [
			'*.....*',
			'**...**',
			'***.***',
			'*******',
			'***.***',
			'**...**',
			'*.....*',
		],
		start: 420,
		end: 520,
	},
]

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const
const EASE_OUT = Easing.bezier(0.16, 1, 0.3, 1)

/* -------------------------------------------------------------------------- */
/*  Background - gradient aurora, grid, grain, vignette                        */
/* -------------------------------------------------------------------------- */

const Backdrop: React.FC<{ accent: string }> = ({ accent }) => {
	const frame = useCurrentFrame()
	const { durationInFrames } = useVideoConfig()
	const t = frame / durationInFrames

	const blobA = {
		left: 140 + Math.sin(t * Math.PI * 2) * 90,
		top: 420 + Math.cos(t * Math.PI * 2) * 120,
	}
	const blobB = {
		left: 620 + Math.cos(t * Math.PI * 2 + 1.2) * 120,
		top: 1180 + Math.sin(t * Math.PI * 2 + 0.4) * 140,
	}

	return (
		<AbsoluteFill style={{ backgroundColor: COLORS.background, overflow: 'hidden' }}>
			<div
				style={{
					position: 'absolute',
					...blobA,
					width: 720,
					height: 720,
					borderRadius: '50%',
					background: `radial-gradient(circle, ${accent}2E 0%, transparent 68%)`,
					filter: 'blur(24px)',
				}}
			/>
			<div
				style={{
					position: 'absolute',
					...blobB,
					width: 620,
					height: 620,
					borderRadius: '50%',
					background: `radial-gradient(circle, ${COLORS.violet}22 0%, transparent 70%)`,
					filter: 'blur(30px)',
				}}
			/>

			{/* engineering grid */}
			<AbsoluteFill
				style={{
					backgroundImage: `linear-gradient(${COLORS.line} 1px, transparent 1px), linear-gradient(90deg, ${COLORS.line} 1px, transparent 1px)`,
					backgroundSize: '60px 60px',
					maskImage: 'radial-gradient(ellipse at 50% 45%, black 35%, transparent 78%)',
					WebkitMaskImage: 'radial-gradient(ellipse at 50% 45%, black 35%, transparent 78%)',
					opacity: 0.9,
				}}
			/>

			{/* static star field, deterministic through random(seed) */}
			{new Array(46).fill(true).map((_, index) => {
				const x = random(`x${index}`) * WIDTH
				const y = random(`y${index}`) * HEIGHT
				const size = 1 + random(`s${index}`) * 2
				const twinkle =
					0.25 + 0.45 * (0.5 + 0.5 * Math.sin(frame / 14 + random(`p${index}`) * 8))
				return (
					<div
						key={index}
						style={{
							position: 'absolute',
							left: x,
							top: y,
							width: size,
							height: size,
							borderRadius: '50%',
							backgroundColor: '#FFFFFF',
							opacity: twinkle * 0.5,
						}}
					/>
				)
			})}

			<AbsoluteFill
				style={{
					background:
						'radial-gradient(ellipse at 50% 50%, transparent 42%, rgba(0,0,0,0.55) 100%)',
				}}
			/>
		</AbsoluteFill>
	)
}

/* -------------------------------------------------------------------------- */
/*  Tile - one character of the pattern                                        */
/* -------------------------------------------------------------------------- */

const Tile: React.FC<{
	x: number
	y: number
	size: number
	color: string
	progress: number
	exit: number
	filled: boolean
}> = ({ x, y, size, color, progress, exit, filled }) => {
	const scale = interpolate(progress, [0, 1], [0.35, 1]) * interpolate(exit, [0, 1], [1, 0.7])
	const opacity = progress * (1 - exit)
	const glow = interpolate(progress, [0, 0.55, 1], [0, 1, 0.55], clamp)

	if (!filled) {
		return (
			<div
				style={{
					position: 'absolute',
					left: x - size / 2,
					top: y - size / 2,
					width: size,
					height: size,
					borderRadius: size * 0.22,
					border: '2px dashed rgba(255,255,255,0.07)',
					opacity: 0.7 * (1 - exit),
				}}
			/>
		)
	}

	return (
		<div
			style={{
				position: 'absolute',
				left: x - size / 2,
				top: y - size / 2,
				width: size,
				height: size,
				borderRadius: size * 0.22,
				border: `2px solid ${color}`,
				backgroundColor: `${color}1F`,
				boxShadow: `0 0 ${18 * glow}px ${color}80, inset 0 0 ${10 * glow}px ${color}40`,
				transform: `scale(${scale})`,
				opacity,
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				color,
				fontFamily: MONO,
				fontSize: size * 0.5,
				fontWeight: 700,
				lineHeight: 1,
			}}
		>
			*
		</div>
	)
}

/* -------------------------------------------------------------------------- */
/*  Pattern grid                                                               */
/* -------------------------------------------------------------------------- */

const PatternGrid: React.FC<{ phase: Phase; local: number; centerY: number }> = ({
	phase,
	local,
	centerY,
}) => {
	const { fps } = useVideoConfig()
	// widest row drives the grid so every pattern stays optically centred
	const columns = Math.max(...phase.rows.map((row) => row.length))
	const rows = phase.rows.length
	const size = columns > 5 ? 78 : 96
	const gap = columns > 5 ? 6 : 8
	const step = size + gap
	const gridWidth = columns * step - gap
	const gridHeight = rows * step - gap
	const originX = WIDTH / 2 - gridWidth / 2 + size / 2
	const originY = centerY - gridHeight / 2 + size / 2

	const length = phase.end - phase.start
	const exit = interpolate(local, [length - 14, length - 2], [0, 1], clamp)
	const float = Math.sin(local / 22) * 6

	return (
		<div style={{ position: 'absolute', inset: 0, transform: `translateY(${float}px)` }}>
			{phase.rows.map((row, rowIndex) =>
				row
					.padEnd(columns, '.')
					.split('')
					.map((cell, columnIndex) => {
					const filled = cell === '*'
					const delay = 16 + rowIndex * 7 + columnIndex * 3
					const progress = filled
						? spring({
								frame: local - delay,
								fps,
								config: { damping: 13, stiffness: 140, mass: 0.55 },
							})
						: 0
					return (
						<Tile
							key={`${phase.id}-${rowIndex}-${columnIndex}`}
							x={originX + columnIndex * step}
							y={originY + rowIndex * step}
							size={size}
							color={phase.color}
							progress={progress}
							exit={exit}
							filled={filled}
						/>
						)
					}),
			)}
		</div>
	)
}

/* -------------------------------------------------------------------------- */
/*  Code card with a typing caret                                              */
/* -------------------------------------------------------------------------- */

const CodeCard: React.FC<{ code: string; color: string; local: number }> = ({
	code,
	color,
	local,
}) => {
	const visible = Math.round(interpolate(local, [6, 34], [0, code.length], clamp))
	const appear = interpolate(local, [0, 12], [0, 1], { ...clamp, easing: EASE_OUT })
	const caret = Math.floor(local / 8) % 2 === 0 ? 1 : 0.15

	return (
		<div
			style={{
				position: 'absolute',
				left: 110,
				width: 860,
				top: 560,
				padding: '26px 30px',
				borderRadius: 20,
				border: `1px solid ${color}59`,
				backgroundColor: 'rgba(9,14,26,0.82)',
				boxShadow: `0 18px 44px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.03) inset`,
				opacity: appear,
				transform: `translateY(${interpolate(appear, [0, 1], [16, 0])}px)`,
			}}
		>
			<div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
				{[COLORS.amber, COLORS.green, COLORS.cyan].map((dot) => (
					<div
						key={dot}
						style={{ width: 11, height: 11, borderRadius: '50%', backgroundColor: `${dot}CC` }}
					/>
				))}
				<div
					style={{
						marginLeft: 10,
						fontFamily: MONO,
						fontSize: 19,
						color: COLORS.muted,
						letterSpacing: 0.4,
					}}
				>
					pattern.py
				</div>
			</div>
			<div
				style={{
					fontFamily: MONO,
					fontSize: 31,
					lineHeight: 1.35,
					color: COLORS.ink,
					whiteSpace: 'pre-wrap',
					wordBreak: 'break-word',
				}}
			>
				<span style={{ color: COLORS.muted }}>&gt;&nbsp;</span>
				<span style={{ color }}>{code.slice(0, visible)}</span>
				<span style={{ color, opacity: caret }}>▍</span>
			</div>
		</div>
	)
}

/* -------------------------------------------------------------------------- */
/*  Intro + outro                                                              */
/* -------------------------------------------------------------------------- */

const Intro: React.FC = () => {
	const frame = useCurrentFrame()
	const { fps } = useVideoConfig()
	const words = ['CODE', 'BECOMES', 'GEOMETRY']
	const out = interpolate(frame, [48, 60], [1, 0], clamp)

	return (
		<div style={{ position: 'absolute', inset: 0, opacity: out }}>
			<div
				style={{
					position: 'absolute',
					left: 100,
					width: 880,
					top: 760,
					textAlign: 'center',
				}}
			>
				{words.map((word, index) => {
					const enter = spring({
						frame: frame - index * 6,
						fps,
						config: { damping: 14, stiffness: 120, mass: 0.7 },
					})
					return (
						<div
							key={word}
							style={{
								fontFamily: SANS,
								fontSize: 96,
								fontWeight: 900,
								letterSpacing: -3,
								lineHeight: 1.02,
								color: index === 2 ? COLORS.cyan : COLORS.ink,
								opacity: enter,
								transform: `translateY(${interpolate(enter, [0, 1], [40, 0])}px)`,
							}}
						>
							{word}
						</div>
					)
				})}
				<div
					style={{
						marginTop: 26,
						fontFamily: MONO,
						fontSize: 28,
						color: COLORS.muted,
						opacity: interpolate(frame, [18, 30], [0, 1], clamp),
					}}
				>
					four loops → four shapes
				</div>
			</div>
		</div>
	)
}

const MiniShape: React.FC<{ phase: Phase; delay: number; x: number; y: number }> = ({
	phase,
	delay,
	x,
	y,
}) => {
	const frame = useCurrentFrame()
	const { fps } = useVideoConfig()
	const enter = spring({ frame: frame - 520 - delay, fps, config: { damping: 14, stiffness: 110 } })
	const dot = 15
	const columns = Math.max(...phase.rows.map((row) => row.length))

	return (
		<div
			style={{
				position: 'absolute',
				left: x,
				top: y,
				width: 330,
				height: 260,
				borderRadius: 22,
				border: `1px solid ${phase.color}3D`,
				backgroundColor: 'rgba(255,255,255,0.03)',
				opacity: enter,
				transform: `scale(${interpolate(enter, [0, 1], [0.86, 1])})`,
				display: 'flex',
				flexDirection: 'column',
				alignItems: 'center',
				justifyContent: 'center',
				gap: 16,
			}}
		>
			<div style={{ width: columns * dot, position: 'relative' }}>
				{phase.rows.map((row, rowIndex) => (
					<div key={rowIndex} style={{ display: 'flex', justifyContent: 'center' }}>
						{row
							.padEnd(columns, '.')
							.split('')
							.map((cell, columnIndex) => (
							<div
								key={columnIndex}
								style={{
									width: dot,
									height: dot,
									margin: 1,
									borderRadius: 3,
									backgroundColor: cell === '*' ? phase.color : 'transparent',
									boxShadow: cell === '*' ? `0 0 8px ${phase.color}66` : 'none',
								}}
								/>
							))}
					</div>
				))}
			</div>
			<div
				style={{
					fontFamily: SANS,
					fontSize: 21,
					fontWeight: 700,
					letterSpacing: 1.2,
					color: phase.color,
				}}
			>
				{phase.label}
			</div>
		</div>
	)
}

const Outro: React.FC = () => {
	const frame = useCurrentFrame()
	const enter = interpolate(frame, [520, 540], [0, 1], { ...clamp, easing: EASE_OUT })

	return (
		<div style={{ position: 'absolute', inset: 0, opacity: enter }}>
			<div
				style={{
					position: 'absolute',
					left: 100,
					width: 880,
					top: 430,
					textAlign: 'center',
					fontFamily: SANS,
					fontSize: 74,
					fontWeight: 900,
					letterSpacing: -2,
					color: COLORS.ink,
				}}
			>
				FOUR PATTERNS
				<div style={{ color: COLORS.cyan }}>ONE LOOP</div>
			</div>

			<MiniShape phase={PHASES[0]} delay={4} x={130} y={700} />
			<MiniShape phase={PHASES[1]} delay={8} x={620} y={700} />
			<MiniShape phase={PHASES[2]} delay={12} x={130} y={1000} />
			<MiniShape phase={PHASES[3]} delay={16} x={620} y={1000} />

			<div
				style={{
					position: 'absolute',
					left: 100,
					width: 880,
					top: 1310,
					textAlign: 'center',
					fontFamily: MONO,
					fontSize: 30,
					color: COLORS.muted,
				}}
			>
				write the rule → watch the shape
			</div>
		</div>
	)
}

/* -------------------------------------------------------------------------- */
/*  HUD - phase chips + progress bar                                           */
/* -------------------------------------------------------------------------- */

const Hud: React.FC<{ activeIndex: number; accent: string }> = ({ activeIndex, accent }) => {
	const frame = useCurrentFrame()
	const { durationInFrames } = useVideoConfig()
	const progress = frame / (durationInFrames - 1)

	return (
		<>
			<div
				style={{
					position: 'absolute',
					left: 100,
					width: 880,
					top: 340,
					display: 'flex',
					justifyContent: 'center',
					gap: 10,
				}}
			>
				{PHASES.map((phase, index) => {
					const active = index === activeIndex
					return (
						<div
							key={phase.id}
							style={{
								padding: '10px 18px',
								borderRadius: 999,
								fontFamily: MONO,
								fontSize: 19,
								letterSpacing: 0.6,
								border: `1px solid ${active ? `${phase.color}80` : 'rgba(255,255,255,0.10)'}`,
								backgroundColor: active ? `${phase.color}1A` : 'rgba(255,255,255,0.02)',
								color: active ? phase.color : COLORS.muted,
								transition: 'none',
							}}
						>
							<span
								style={{
									display: 'block',
									width: active ? 38 : 16,
									height: 6,
									borderRadius: 99,
									backgroundColor: active ? phase.color : COLORS.muted,
								}}
							/>
						</div>
					)
				})}
			</div>

			<div
				style={{
					position: 'absolute',
					left: 270,
					width: 540,
					top: 1360,
					height: 8,
					borderRadius: 4,
					backgroundColor: 'rgba(255,255,255,0.10)',
					overflow: 'hidden',
				}}
			>
				<div
					style={{
						width: `${progress * 100}%`,
						height: '100%',
						borderRadius: 4,
						backgroundColor: accent,
						boxShadow: `0 0 14px ${accent}AA`,
					}}
				/>
			</div>
			<div
				style={{
					position: 'absolute',
					left: 100,
					width: 880,
					top: 1392,
					textAlign: 'center',
					fontFamily: MONO,
					fontSize: 21,
					letterSpacing: 3,
					color: COLORS.muted,
				}}
			>
				CODE → SHAPE
			</div>
		</>
	)
}

/* -------------------------------------------------------------------------- */
/*  Composition                                                                */
/* -------------------------------------------------------------------------- */

export const CodeBecomesGeometry: React.FC = () => {
	const frame = useCurrentFrame()
	const activeIndex = PHASES.findIndex((phase) => frame >= phase.start && frame < phase.end)
	const phase = activeIndex >= 0 ? PHASES[activeIndex] : null
	const accent = phase?.color ?? COLORS.cyan
	const local = phase ? frame - phase.start : 0

	return (
		<AbsoluteFill style={{ backgroundColor: COLORS.background }}>
			<Backdrop accent={accent} />

			{frame < 62 ? <Intro /> : null}

			{phase ? (
				<>
					<div
						style={{
							position: 'absolute',
							left: 100,
							width: 880,
							top: 420,
							textAlign: 'center',
							opacity: interpolate(local, [0, 10], [0, 1], clamp),
						}}
					>
						<div
							style={{
								fontFamily: SANS,
								fontSize: 62,
								fontWeight: 900,
								letterSpacing: -1.6,
								color: COLORS.ink,
							}}
						>
							{phase.label}
						</div>
						<div
							style={{
								marginTop: 8,
								fontFamily: SANS,
								fontSize: 26,
								fontWeight: 500,
								color: COLORS.muted,
							}}
						>
							{phase.subtitle}
						</div>
					</div>

					<CodeCard code={phase.code} color={phase.color} local={local} />
					<PatternGrid phase={phase} local={local} centerY={1030} />
				</>
			) : null}

			{frame >= 518 ? <Outro /> : null}

			<Hud activeIndex={activeIndex} accent={accent} />
		</AbsoluteFill>
	)
}

export const Root: React.FC = () => (
	<Composition
		id="CodeBecomesGeometry"
		component={CodeBecomesGeometry}
		durationInFrames={DURATION_IN_FRAMES}
		fps={FPS}
		width={WIDTH}
		height={HEIGHT}
	/>
)

registerRoot(Root)

export default CodeBecomesGeometry
