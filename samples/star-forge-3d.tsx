/**
 * STAR FORGE 3D
 * -----------------------------------------------------------------------------
 * Four star patterns forged in real 3D, in ONE file, with ZERO dependencies
 * beyond `remotion` itself.
 *
 * The depth is not a CSS trick: every tile is a point in world space that gets
 * yaw/pitch rotated and perspective-divided by the tiny matrix kernel below,
 * then extruded by stacking shaded copies along the projected view vector.
 * That means it rasterises identically in the Player, in the free browser
 * encoder and in headless Chrome - no WebGL context required.
 *
 * Beat sheet (900 frames @ 30fps = 30s, seamless loop)
 *   Hook    0-59    one tile ignites and the title stamps in
 *   Setup   60-254   a right triangle builds row by row
 *   Build   255-449  a hollow square walks clockwise
 *   Payoff  450-644  mirrored pairs bloom into a diamond
 *   Detail  645-809  butterfly wings fill inward and flap once
 *   Loop    810-899  all four shrink to a contact sheet and dissolve to frame 0
 */

import React from 'react'
import {
	AbsoluteFill,
	Composition,
	Easing,
	interpolate,
	registerRoot,
	useCurrentFrame,
} from 'remotion'

export const WIDTH = 1080
export const HEIGHT = 1920
export const FPS = 30
export const DURATION_IN_FRAMES = 900

const BG = '#08090B'
const GREEN = '#38D77A'
const YELLOW = '#F5D567'
const WHITE = '#F4F5F0'
const MUTED = '#6C7780'

const SANS = 'Inter, "Helvetica Neue", Arial, sans-serif'
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'

const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const

const progress = (frame: number, from: number, to: number, easing = Easing.linear) =>
	interpolate(frame, [from, to], [0, 1], { ...CLAMP, easing })

/* ---------------------------------------------------------------- 3D kernel */

type Vec3 = { x: number; y: number; z: number }
type Projected = { x: number; y: number; scale: number; depth: number }

const CAMERA_DISTANCE = 9.4
const FOCAL = 1150

/** Yaw, then pitch, then a perspective divide. ~15 lines instead of three.js. */
function project(point: Vec3, yaw: number, pitch: number): Projected {
	const cosY = Math.cos(yaw)
	const sinY = Math.sin(yaw)
	const x1 = point.x * cosY + point.z * sinY
	const z1 = point.z * cosY - point.x * sinY

	const cosP = Math.cos(pitch)
	const sinP = Math.sin(pitch)
	const y1 = point.y * cosP - z1 * sinP
	const z2 = point.y * sinP + z1 * cosP

	const depth = CAMERA_DISTANCE + z2
	const scale = FOCAL / Math.max(0.4, depth)
	return { x: x1 * scale, y: -y1 * scale, scale, depth }
}

/** Ten-point star as a clip-path, generated once. */
const STAR_CLIP = (() => {
	const points: string[] = []
	for (let index = 0; index < 10; index++) {
		const radius = index % 2 === 0 ? 50 : 21.5
		const angle = -Math.PI / 2 + (index * Math.PI) / 5
		points.push(
			`${(50 + Math.cos(angle) * radius).toFixed(2)}% ${(50 + Math.sin(angle) * radius).toFixed(2)}%`,
		)
	}
	return `polygon(${points.join(', ')})`
})()

const HEX = /^#([0-9a-f]{6})$/i

function mix(hex: string, target: number, amount: number): string {
	const match = HEX.exec(hex)
	if (!match) return hex
	const value = parseInt(match[1], 16)
	const channel = (shift: number) => {
		const raw = (value >> shift) & 0xff
		return Math.round(raw + (target - raw) * amount)
	}
	const next = (channel(16) << 16) | (channel(8) << 8) | channel(0)
	return `#${next.toString(16).padStart(6, '0')}`
}

const darken = (hex: string, amount: number) => mix(hex, 0, amount)
const lighten = (hex: string, amount: number) => mix(hex, 255, amount)

/* ------------------------------------------------------------------ patterns */

type Tile = {
	x: number
	y: number
	reveal: number
	tone: 'green' | 'yellow' | 'white'
	wing?: 'left' | 'right'
}

const toneColor = (tone: Tile['tone']) =>
	tone === 'yellow' ? YELLOW : tone === 'white' ? WHITE : GREEN

const rightTriangle: Tile[] = (() => {
	const tiles: Tile[] = []
	let order = 0
	for (let row = 0; row < 5; row++) {
		for (let column = 0; column <= row; column++) {
			tiles.push({
				x: (column - row / 2) * 0.82,
				y: (2 - row) * 0.68,
				reveal: 12 + order * 4 + row * 5,
				tone: row === 4 ? 'yellow' : 'green',
			})
			order++
		}
	}
	return tiles
})()

const hollowSquare: Tile[] = (() => {
	const cells: Array<{ row: number; column: number }> = []
	for (let column = 0; column < 6; column++) cells.push({ row: 0, column })
	for (let row = 1; row < 6; row++) cells.push({ row, column: 5 })
	for (let column = 4; column >= 0; column--) cells.push({ row: 5, column })
	for (let row = 4; row >= 1; row--) cells.push({ row, column: 0 })
	return cells.map(({ row, column }, index) => ({
		x: (column - 2.5) * 0.72,
		y: (2.5 - row) * 0.6,
		reveal: 8 + index * 3,
		tone: index % 5 === 0 ? 'white' : ('yellow' as const),
	}))
})()

const diamond: Tile[] = (() => {
	const counts = [1, 3, 5, 7, 5, 3, 1]
	const tiles: Tile[] = []
	counts.forEach((count, row) => {
		for (let column = 0; column < count; column++) {
			const mirrored = Math.min(column, count - 1 - column)
			tiles.push({
				x: (column - (count - 1) / 2) * 0.72,
				y: (3 - row) * 0.52,
				reveal: 8 + (row * 4 + mirrored) * 4,
				tone: row === 3 ? 'yellow' : 'white',
			})
		}
	})
	return tiles
})()

const butterfly: Tile[] = (() => {
	const counts = [1, 2, 3, 3, 2, 1]
	const tiles: Tile[] = []
	counts.forEach((count, row) => {
		for (let column = 0; column < count; column++) {
			const reveal = 8 + (column * 6 + row) * 3
			const tone = column === count - 1 ? 'yellow' : ('green' as const)
			const y = (2.5 - row) * 0.56
			tiles.push({ x: -2.1 + column * 0.6, y, reveal, tone, wing: 'left' })
			tiles.push({ x: 2.1 - column * 0.6, y, reveal, tone, wing: 'right' })
		}
	})
	return tiles
})()

type Phase = {
	name: string
	subtitle: string
	code: string
	tiles: Tile[]
	start: number
	end: number
	accent: string
}

const PHASES: Phase[] = [
	{
		name: 'RIGHT TRIANGLE',
		subtitle: 'one nested loop',
		code: 'for j in range(i + 1):',
		tiles: rightTriangle,
		start: 60,
		end: 255,
		accent: GREEN,
	},
	{
		name: 'HOLLOW SQUARE',
		subtitle: 'edges only',
		code: 'if i in edge or j in edge:',
		tiles: hollowSquare,
		start: 255,
		end: 450,
		accent: YELLOW,
	},
	{
		name: 'DIAMOND',
		subtitle: 'mirror the gap',
		code: 'gap = abs(mid - i)',
		tiles: diamond,
		start: 450,
		end: 645,
		accent: WHITE,
	},
	{
		name: 'BUTTERFLY',
		subtitle: 'two wings, mirrored',
		code: 'if j < i or j > n - i:',
		tiles: butterfly,
		start: 645,
		end: 810,
		accent: YELLOW,
	},
]

/* -------------------------------------------------------------------- pieces */

const EXTRUDE_LAYERS = 8

const StarTile: React.FC<{
	tile: Tile
	local: number
	index: number
	origin: { x: number; y: number }
	yaw: number
	pitch: number
	size?: number
	force?: boolean
}> = ({ tile, local, index, origin, yaw, pitch, size = 0.78, force = false }) => {
	const wobble = Math.sin((local + index * 9) * 0.035) * 0.06
	const point = project(
		{ x: tile.x, y: tile.y, z: Math.sin(index * 1.73) * 0.16 + wobble },
		yaw,
		pitch,
	)

	const pop = force
		? 1
		: interpolate(local, [tile.reveal, tile.reveal + 3, tile.reveal + 6], [0, 1.16, 1], CLAMP)
	if (pop <= 0.001) return null

	const color = toneColor(tile.tone)
	const pixels = size * point.scale
	const spin = (1 - Math.min(1, pop)) * 62 + Math.sin((local + index * 4) * 0.012) * 3

	// The extrusion offset follows the yaw, so the solid sides face the camera.
	const offsetX = Math.sin(yaw) * 2.3 + 1.1
	const offsetY = Math.sin(pitch) * -2.3 + 1.6

	return (
		<div
			style={{
				position: 'absolute',
				left: origin.x + point.x,
				top: origin.y + point.y,
				width: pixels,
				height: pixels,
				marginLeft: -pixels / 2,
				marginTop: -pixels / 2,
				transform: `scale(${Math.max(0, pop)}) rotate(${spin}deg)`,
				zIndex: Math.round(1000 - point.depth * 40),
			}}
		>
			<div
				style={{
					position: 'absolute',
					inset: '-42%',
					borderRadius: '50%',
					background: `radial-gradient(circle, ${color}2E 0%, ${color}00 68%)`,
				}}
			/>
			{Array.from({ length: EXTRUDE_LAYERS }).map((_, layer) => {
				const depth = (EXTRUDE_LAYERS - layer) / EXTRUDE_LAYERS
				return (
					<div
						key={layer}
						style={{
							position: 'absolute',
							inset: 0,
							transform: `translate(${offsetX * depth * 3}px, ${offsetY * depth * 3}px)`,
							clipPath: STAR_CLIP,
							backgroundColor: darken(color, 0.42 + depth * 0.34),
						}}
					/>
				)
			})}
			<div
				style={{
					position: 'absolute',
					inset: 0,
					clipPath: STAR_CLIP,
					background: `linear-gradient(148deg, ${lighten(color, 0.34)} 0%, ${color} 46%, ${darken(color, 0.24)} 100%)`,
				}}
			/>
		</div>
	)
}

const PatternStage: React.FC<{
	tiles: Tile[]
	local: number
	origin: { x: number; y: number }
	yaw: number
	pitch: number
	flap?: number
	size?: number
	force?: boolean
}> = ({ tiles, local, origin, yaw, pitch, flap = 0, size, force }) => (
	<>
		{tiles.map((tile, index) => (
			<StarTile
				key={index}
				tile={tile}
				local={local}
				index={index}
				origin={origin}
				yaw={yaw + (tile.wing === 'left' ? flap : tile.wing === 'right' ? -flap : 0)}
				pitch={pitch}
				size={size}
				force={force}
			/>
		))}
	</>
)

const Backdrop: React.FC<{ frame: number; accent: string }> = ({ frame, accent }) => (
	<AbsoluteFill style={{ backgroundColor: BG }}>
		<AbsoluteFill
			style={{
				backgroundImage:
					'linear-gradient(rgba(255,255,255,0.028) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.028) 1px, transparent 1px)',
				backgroundSize: '90px 90px',
				transform: `translateY(${(frame * 0.32) % 90}px)`,
			}}
		/>
		<AbsoluteFill
			style={{
				background: `radial-gradient(60% 42% at 50% 54%, ${accent}1A 0%, transparent 72%)`,
			}}
		/>
		<AbsoluteFill
			style={{
				background:
					'radial-gradient(120% 68% at 50% 106%, rgba(0,0,0,0.72) 0%, transparent 62%)',
			}}
		/>
	</AbsoluteFill>
)

const Hook: React.FC<{ frame: number }> = ({ frame }) => {
	const fade = 1 - progress(frame, 48, 60, Easing.in(Easing.cubic))
	const stamp = interpolate(frame, [0, 9], [1.5, 1], {
		...CLAMP,
		easing: Easing.out(Easing.back(1.8)),
	})
	return (
		<AbsoluteFill style={{ opacity: fade }}>
			<div
				style={{
					position: 'absolute',
					top: 520,
					left: 90,
					width: 900,
					textAlign: 'center',
					fontFamily: SANS,
					fontSize: 96,
					fontWeight: 900,
					letterSpacing: -3,
					color: WHITE,
					transform: `scale(${stamp})`,
				}}
			>
				STAR FORGE
			</div>
			<div
				style={{
					position: 'absolute',
					top: 648,
					left: 90,
					width: 900,
					textAlign: 'center',
					fontFamily: MONO,
					fontSize: 26,
					letterSpacing: 8,
					color: GREEN,
					opacity: progress(frame, 10, 20),
				}}
			>
				FOUR LOOPS · FOUR SHAPES
			</div>
		</AbsoluteFill>
	)
}

const CodeLine: React.FC<{ code: string; accent: string; local: number }> = ({
	code,
	accent,
	local,
}) => {
	const typed = Math.round(interpolate(local, [6, 34], [0, code.length], CLAMP))
	const caret = Math.floor(local / 8) % 2 === 0
	return (
		<div
			style={{
				position: 'absolute',
				left: 120,
				top: 700,
				width: 840,
				height: 96,
				borderRadius: 20,
				border: `1px solid ${accent}38`,
				backgroundColor: 'rgba(12,16,20,0.82)',
				display: 'flex',
				alignItems: 'center',
				padding: '0 30px',
				boxSizing: 'border-box',
				opacity: progress(local, 2, 12),
			}}
		>
			<span style={{ fontFamily: MONO, fontSize: 30, color: MUTED, marginRight: 16 }}>&gt;</span>
			<span style={{ fontFamily: MONO, fontSize: 30, color: accent, letterSpacing: 0.5 }}>
				{code.slice(0, typed)}
			</span>
			<span
				style={{
					display: 'inline-block',
					width: 14,
					height: 34,
					marginLeft: 4,
					backgroundColor: caret ? accent : 'transparent',
				}}
			/>
		</div>
	)
}

const Title: React.FC<{ phase: Phase; local: number }> = ({ phase, local }) => {
	const enter = progress(local, 0, 12, Easing.out(Easing.cubic))
	return (
		<>
			<div
				style={{
					position: 'absolute',
					top: 470,
					left: 90,
					width: 900,
					textAlign: 'center',
					fontFamily: SANS,
					fontSize: 78,
					fontWeight: 900,
					letterSpacing: -2,
					color: WHITE,
					opacity: enter,
					transform: `translateY(${(1 - enter) * 26}px)`,
				}}
			>
				{phase.name}
			</div>
			<div
				style={{
					position: 'absolute',
					top: 578,
					left: 90,
					width: 900,
					textAlign: 'center',
					fontFamily: SANS,
					fontSize: 32,
					fontWeight: 600,
					color: MUTED,
					opacity: progress(local, 6, 18),
				}}
			>
				{phase.subtitle}
			</div>
		</>
	)
}

const ContactSheet: React.FC<{ frame: number }> = ({ frame }) => {
	const enter = progress(frame, 810, 838, Easing.out(Easing.cubic))
	const exit = progress(frame, 872, 899, Easing.in(Easing.cubic))
	const cells: Array<{ tiles: Tile[]; x: number; y: number; label: string }> = [
		{ tiles: rightTriangle, x: 336, y: 812, label: 'TRIANGLE' },
		{ tiles: hollowSquare, x: 744, y: 812, label: 'SQUARE' },
		{ tiles: diamond, x: 336, y: 1188, label: 'DIAMOND' },
		{ tiles: butterfly, x: 744, y: 1188, label: 'BUTTERFLY' },
	]
	return (
		<AbsoluteFill style={{ opacity: enter * (1 - exit) }}>
			<div
				style={{
					position: 'absolute',
					top: 500,
					left: 90,
					width: 900,
					textAlign: 'center',
					fontFamily: SANS,
					fontSize: 74,
					fontWeight: 900,
					letterSpacing: -2,
					color: WHITE,
				}}
			>
				FOUR LOOPS
				<span style={{ color: GREEN }}> ONE FILE</span>
			</div>
			{cells.map((cell, index) => {
				const pop = progress(frame, 816 + index * 6, 840 + index * 6, Easing.out(Easing.cubic))
				return (
					<div key={cell.label}>
						<div
							style={{
								position: 'absolute',
								left: cell.x - 178,
								top: cell.y - 150,
								width: 356,
								height: 320,
								borderRadius: 26,
								border: '1px solid rgba(255,255,255,0.09)',
								backgroundColor: 'rgba(255,255,255,0.02)',
								opacity: pop,
								transform: `scale(${0.9 + pop * 0.1})`,
							}}
						/>
						<div style={{ opacity: pop }}>
							<PatternStage
								tiles={cell.tiles}
								local={frame - 810}
								origin={{ x: cell.x, y: cell.y - 26 }}
								yaw={Math.sin(frame * 0.02) * 0.14}
								pitch={-0.1}
								size={0.3}
								force
							/>
						</div>
						<div
							style={{
								position: 'absolute',
								left: cell.x - 178,
								top: cell.y + 118,
								width: 356,
								textAlign: 'center',
								fontFamily: MONO,
								fontSize: 20,
								letterSpacing: 4,
								color: MUTED,
								opacity: pop,
							}}
						>
							{cell.label}
						</div>
					</div>
				)
			})}
		</AbsoluteFill>
	)
}

const Hud: React.FC<{ frame: number; index: number; accent: string }> = ({
	frame,
	index,
	accent,
}) => (
	<>
		<div style={{ position: 'absolute', top: 392, left: 0, width: WIDTH, display: 'flex', justifyContent: 'center', gap: 14 }}>
			{PHASES.map((phase, pip) => (
				<div
					key={phase.name}
					style={{
						width: 56,
						height: 34,
						borderRadius: 17,
						border: `1px solid ${pip === index ? accent : 'rgba(255,255,255,0.12)'}`,
						backgroundColor: pip === index ? `${accent}22` : 'transparent',
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
						fontFamily: MONO,
						fontSize: 16,
						color: pip === index ? accent : MUTED,
					}}
				>
					<span
						style={{
							display: 'block',
							width: pip === index ? 26 : 10,
							height: 5,
							borderRadius: 99,
							backgroundColor: pip === index ? accent : MUTED,
						}}
					/>
				</div>
			))}
		</div>
		<div style={{ position: 'absolute', top: 1418, left: 270, width: 540, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.1)' }}>
			<div
				style={{
					width: `${(frame / DURATION_IN_FRAMES) * 100}%`,
					height: '100%',
					borderRadius: 3,
					backgroundColor: accent,
				}}
			/>
		</div>
		<div
			style={{
				position: 'absolute',
				top: 1448,
				left: 90,
				width: 900,
				textAlign: 'center',
				fontFamily: MONO,
				fontSize: 19,
				letterSpacing: 7,
				color: MUTED,
			}}
		>
			LOOP → SHAPE
		</div>
	</>
)

const Guides: React.FC = () => (
	<AbsoluteFill style={{ pointerEvents: 'none' }}>
		<div
			style={{
				position: 'absolute',
				left: 90,
				top: 420,
				width: 900,
				height: 1080,
				border: '2px dashed rgba(56,215,122,0.5)',
			}}
		/>
	</AbsoluteFill>
)

/* ---------------------------------------------------------------- composition */

export const StarForge3D: React.FC<{ showGuides?: boolean }> = ({ showGuides = false }) => {
	const frame = useCurrentFrame()

	const phaseIndex = Math.max(
		0,
		PHASES.findIndex((phase) => frame >= phase.start && frame < phase.end),
	)
	const phase = PHASES[phaseIndex]
	const inPattern = frame >= 60 && frame < 810
	const local = frame - phase.start

	// Slow camera drift, plus one wing flap during the butterfly beat.
	const yaw = Math.sin(frame * 0.0165) * 0.2
	const pitch = -0.12 + Math.sin(frame * 0.011) * 0.03
	const flapWindow = frame >= 742 && frame <= 758
	const flap = flapWindow ? Math.sin(progress(frame, 742, 758) * Math.PI * 2) * 0.42 : 0

	// The loop: the last 12 frames fade to exactly what frame 0 looks like.
	const loopFade = progress(frame, 888, 899, Easing.in(Easing.quad))

	return (
		<AbsoluteFill style={{ backgroundColor: BG }}>
			<Backdrop frame={frame} accent={frame < 60 ? GREEN : phase.accent} />

			{frame < 60 ? (
				<>
					<Hook frame={frame} />
					<StarTile
						tile={{ x: 0, y: 0, reveal: 14, tone: 'green' }}
						local={frame}
						index={0}
						origin={{ x: WIDTH / 2, y: 1030 }}
						yaw={yaw}
						pitch={pitch}
						size={1.5}
					/>
				</>
			) : null}

			{inPattern ? (
				<>
					<Title phase={phase} local={local} />
					<CodeLine code={phase.code} accent={phase.accent} local={local} />
					<PatternStage
						tiles={phase.tiles}
						local={local}
						origin={{ x: WIDTH / 2, y: 1090 }}
						yaw={yaw}
						pitch={pitch}
						flap={flap}
					/>
				</>
			) : null}

			{frame >= 810 ? <ContactSheet frame={frame} /> : null}

			<Hud frame={frame} index={phaseIndex} accent={frame < 60 ? GREEN : phase.accent} />

			<AbsoluteFill style={{ backgroundColor: BG, opacity: loopFade }} />
			{showGuides ? <Guides /> : null}
		</AbsoluteFill>
	)
}

export const Root: React.FC = () => (
	<Composition
		id="StarForge3D"
		component={StarForge3D}
		durationInFrames={DURATION_IN_FRAMES}
		fps={FPS}
		width={WIDTH}
		height={HEIGHT}
		defaultProps={{ showGuides: false }}
	/>
)

registerRoot(Root)

export default StarForge3D
