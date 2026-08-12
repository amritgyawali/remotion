/**
 * PASCAL CASCADE
 * -----------------------------------------------------------------------------
 * The triangle writes itself, then reveals the Sierpinski fractal hiding inside
 * it. Deliberately built on a LIGHT drafting-paper palette so it shares nothing
 * visually with the neon samples - proof that one file fully owns its own look.
 *
 * Techniques worth stealing:
 *   - `pathLength="1"` on every SVG arc, so a parent-to-child curve can be drawn
 *     with strokeDashoffset from 1 -> 0 without measuring anything.
 *   - Values are computed, never hard-coded: the whole triangle comes out of one
 *     reduce, and the row sums are proven to be 2^n on screen.
 *   - A single `camera` transform scales and lifts the whole rig for the pull-back.
 *
 * Beat sheet (900 frames @ 30fps = 30s, seamless loop)
 *   Hook    0-65    a lone 1 drops into the apex and rebounds
 *   Setup   66-239   rows 2-3 write themselves through animated parent arcs
 *   Build   240-464  rows 4-9 cascade in
 *   Payoff  465-659  even values fade out and Sierpinski appears
 *   Detail  660-809  camera pulls back, every row sum prints as 2^n
 *   Loop    810-899  the triangle zips back into the apex
 */

import React from 'react'
import {
	AbsoluteFill,
	Composition,
	Easing,
	interpolate,
	registerRoot,
	spring,
	useCurrentFrame,
	useVideoConfig,
} from 'remotion'

export const WIDTH = 1080
export const HEIGHT = 1920
export const FPS = 30
export const DURATION_IN_FRAMES = 900

const PAPER = '#F3EDE1'
const INK = '#12171C'
const GRID = 'rgba(18,23,28,0.07)'
const RED = '#D7263D'
const BLUE = '#2E6FB7'
const DIM = 'rgba(18,23,28,0.28)'

const SERIF = '"Iowan Old Style", Georgia, "Times New Roman", serif'
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'

const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const
const progress = (frame: number, from: number, to: number, easing = Easing.linear) =>
	interpolate(frame, [from, to], [0, 1], { ...CLAMP, easing })

/* ------------------------------------------------------------------ the maths */

const ROWS = 9

const TRIANGLE: number[][] = Array.from({ length: ROWS }).reduce<number[][]>((rows, _, row) => {
	const previous = rows[row - 1] ?? []
	const next = Array.from({ length: row + 1 }).map((__, column) =>
		column === 0 || column === row ? 1 : previous[column - 1] + previous[column],
	)
	rows.push(next)
	return rows
}, [])

/** Frame at which a given row starts to appear. */
const rowStart = (row: number) => (row === 0 ? 8 : 66 + (row - 1) * 46)

const CELL = 96
const ROW_HEIGHT = 104
const TOP = 560

const cellX = (row: number, column: number) => WIDTH / 2 + (column - row / 2) * CELL
const cellY = (row: number) => TOP + row * ROW_HEIGHT

/* -------------------------------------------------------------------- pieces */

const Paper: React.FC<{ frame: number }> = ({ frame }) => (
	<AbsoluteFill style={{ backgroundColor: PAPER }}>
		<AbsoluteFill
			style={{
				backgroundImage: `linear-gradient(${GRID} 1px, transparent 1px), linear-gradient(90deg, ${GRID} 1px, transparent 1px)`,
				backgroundSize: '48px 48px',
			}}
		/>
		<AbsoluteFill
			style={{
				background: `radial-gradient(74% 48% at 50% ${34 + Math.sin(frame * 0.01) * 2}%, rgba(255,255,255,0.85) 0%, rgba(243,237,225,0) 70%)`,
			}}
		/>
		<AbsoluteFill
			style={{
				boxShadow: 'inset 0 0 240px rgba(18,23,28,0.12)',
			}}
		/>
	</AbsoluteFill>
)

const Arc: React.FC<{
	fromRow: number
	fromColumn: number
	toRow: number
	toColumn: number
	draw: number
	color: string
}> = ({ fromRow, fromColumn, toRow, toColumn, draw, color }) => {
	if (draw <= 0.001) return null
	const x1 = cellX(fromRow, fromColumn)
	const y1 = cellY(fromRow) + 30
	const x2 = cellX(toRow, toColumn)
	const y2 = cellY(toRow) - 30
	const midX = (x1 + x2) / 2 + (x2 > x1 ? 16 : -16)
	const midY = (y1 + y2) / 2
	return (
		<path
			d={`M ${x1} ${y1} Q ${midX} ${midY} ${x2} ${y2}`}
			fill="none"
			stroke={color}
			strokeWidth={2.5}
			strokeLinecap="round"
			pathLength={1}
			strokeDasharray={1}
			strokeDashoffset={1 - draw}
			opacity={0.55}
		/>
	)
}

const Cell: React.FC<{
	row: number
	column: number
	value: number
	frame: number
	fps: number
	sierpinski: number
}> = ({ row, column, value, frame, fps, sierpinski }) => {
	const appear = rowStart(row) + column * 5
	const drop = spring({
		frame: frame - appear,
		fps,
		config: { damping: 11, mass: 0.62, stiffness: 132 },
	})
	if (drop <= 0.001) return null

	const isOdd = value % 2 === 1
	const fade = isOdd ? 1 : 1 - sierpinski * 0.86
	const fill = isOdd
		? `rgba(215,38,61,${0.06 + sierpinski * 0.14})`
		: 'rgba(18,23,28,0.03)'
	const border = isOdd ? RED : DIM
	const size = value >= 1000 ? 30 : value >= 100 ? 34 : 38

	return (
		<div
			style={{
				position: 'absolute',
				left: cellX(row, column) - 42,
				top: cellY(row) - 34 + (1 - drop) * -46,
				width: 84,
				height: 68,
				opacity: Math.min(1, drop) * fade,
				transform: `scale(${0.82 + drop * 0.18})`,
				borderRadius: 14,
				border: `1.5px solid ${isOdd ? border : 'rgba(18,23,28,0.14)'}`,
				backgroundColor: fill,
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				boxSizing: 'border-box',
			}}
		>
			<span
				style={{
					fontFamily: SERIF,
					fontSize: size,
					fontWeight: 700,
					color: isOdd ? RED : INK,
					letterSpacing: -0.5,
				}}
			>
				{value}
			</span>
		</div>
	)
}

const RowSum: React.FC<{ row: number; frame: number }> = ({ row, frame }) => {
	const appear = 664 + row * 12
	const show = progress(frame, appear, appear + 14, Easing.out(Easing.cubic))
	if (show <= 0.001) return null
	const sum = TRIANGLE[row].reduce((total, value) => total + value, 0)
	return (
		<div
			style={{
				position: 'absolute',
				left: cellX(row, row) + 74,
				top: cellY(row) - 22,
				opacity: show,
				transform: `translateX(${(1 - show) * -18}px)`,
				fontFamily: MONO,
				fontSize: 26,
				color: BLUE,
				whiteSpace: 'nowrap',
			}}
		>
			{`= ${sum}`}
			<span style={{ color: DIM, marginLeft: 10 }}>{`2^${row}`}</span>
		</div>
	)
}

const Caption: React.FC<{ frame: number }> = ({ frame }) => {
	const beats = [
		{ from: 0, to: 66, title: 'IT STARTS WITH ONE', note: 'Pascal’s triangle' },
		{ from: 66, to: 240, title: 'EVERY NUMBER IS A SUM', note: 'left parent + right parent' },
		{ from: 240, to: 465, title: 'NINE ROWS, NO INPUT', note: 'the rule builds the shape' },
		{ from: 465, to: 660, title: 'DIM THE EVENS', note: 'a fractal was always there' },
		{ from: 660, to: 810, title: 'EACH ROW DOUBLES', note: 'sum of row n = 2ⁿ' },
		{ from: 810, to: 900, title: 'ONE RULE. INFINITE DEPTH.', note: 'written in 300 lines' },
	]
	const beat = beats.find((item) => frame >= item.from && frame < item.to) ?? beats[0]
	const local = frame - beat.from
	const enter = progress(local, 0, 12, Easing.out(Easing.cubic))
	const exit = 1 - progress(frame, beat.to - 10, beat.to, Easing.in(Easing.cubic))
	return (
		<div style={{ opacity: enter * exit }}>
			<div
				style={{
					position: 'absolute',
					top: 424,
					left: 90,
					width: 900,
					textAlign: 'center',
					fontFamily: SERIF,
					fontSize: 62,
					fontWeight: 700,
					color: INK,
					letterSpacing: -1.4,
					transform: `translateY(${(1 - enter) * 18}px)`,
				}}
			>
				{beat.title}
			</div>
			<div
				style={{
					position: 'absolute',
					top: 500,
					left: 90,
					width: 900,
					textAlign: 'center',
					fontFamily: MONO,
					fontSize: 22,
					letterSpacing: 3,
					color: DIM,
				}}
			>
				{beat.note}
			</div>
		</div>
	)
}

const Guides: React.FC = () => (
	<AbsoluteFill style={{ pointerEvents: 'none' }}>
		<div
			style={{
				position: 'absolute',
				left: 90,
				top: 420,
				width: 900,
				height: 1080,
				border: `2px dashed ${RED}80`,
			}}
		/>
	</AbsoluteFill>
)

/* ---------------------------------------------------------------- composition */

export const PascalCascade: React.FC<{ showGuides?: boolean }> = ({ showGuides = false }) => {
	const frame = useCurrentFrame()
	const { fps } = useVideoConfig()

	const sierpinski = progress(frame, 470, 620, Easing.inOut(Easing.cubic))

	// Camera: hold, then pull back for the row sums, then zip into the apex.
	const pullBack = progress(frame, 660, 700, Easing.inOut(Easing.cubic))
	const zip = progress(frame, 812, 872, Easing.in(Easing.cubic))
	const cameraScale = 1 - pullBack * 0.16 - zip * 0.82
	const cameraY = pullBack * -26 + zip * -220
	const loopFade = progress(frame, 884, 899, Easing.in(Easing.quad))

	return (
		<AbsoluteFill style={{ backgroundColor: PAPER }}>
			<Paper frame={frame} />
			<Caption frame={frame} />

			<AbsoluteFill
				style={{
					transform: `translateY(${cameraY}px) scale(${cameraScale})`,
					transformOrigin: '50% 620px',
				}}
			>
				<svg width={WIDTH} height={HEIGHT} style={{ position: 'absolute', inset: 0 }}>
					{TRIANGLE.map((values, row) =>
						row === 0
							? null
							: values.map((_, column) => {
									const appear = rowStart(row) + column * 5
									const draw = progress(frame, appear - 12, appear + 4, Easing.out(Easing.cubic))
									const fade = 1 - progress(frame, 470, 560, Easing.inOut(Easing.cubic))
									if (fade <= 0.01) return null
									return (
										<g key={`${row}-${column}`} opacity={fade}>
											{column > 0 ? (
												<Arc
													fromRow={row - 1}
													fromColumn={column - 1}
													toRow={row}
													toColumn={column}
													draw={draw}
													color={BLUE}
												/>
											) : null}
											{column < row ? (
												<Arc
													fromRow={row - 1}
													fromColumn={column}
													toRow={row}
													toColumn={column}
													draw={draw}
													color={RED}
												/>
											) : null}
										</g>
									)
								}),
					)}
				</svg>

				{TRIANGLE.map((values, row) =>
					values.map((value, column) => (
						<Cell
							key={`${row}-${column}`}
							row={row}
							column={column}
							value={value}
							frame={frame}
							fps={fps}
							sierpinski={sierpinski}
						/>
					)),
				)}

				{frame >= 660
					? TRIANGLE.map((_, row) => <RowSum key={row} row={row} frame={frame} />)
					: null}
			</AbsoluteFill>

			<div
				style={{
					position: 'absolute',
					top: 1444,
					left: 90,
					width: 900,
					textAlign: 'center',
					fontFamily: MONO,
					fontSize: 19,
					letterSpacing: 6,
					color: DIM,
				}}
			>
				C(n, k) = C(n-1, k-1) + C(n-1, k)
			</div>

			<AbsoluteFill style={{ backgroundColor: PAPER, opacity: loopFade }} />
			{showGuides ? <Guides /> : null}
		</AbsoluteFill>
	)
}

export const Root: React.FC = () => (
	<Composition
		id="PascalCascade"
		component={PascalCascade}
		durationInFrames={DURATION_IN_FRAMES}
		fps={FPS}
		width={WIDTH}
		height={HEIGHT}
		defaultProps={{ showGuides: false }}
	/>
)

registerRoot(Root)

export default PascalCascade
