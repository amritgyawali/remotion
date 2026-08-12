/**
 * EVENT LOOP ORBIT
 * -----------------------------------------------------------------------------
 * Blocking vs non-blocking I/O, told as an orbit. Four requests are scheduled by
 * a real 12-line scheduler (not hand-placed keyframes), so the sync lane and the
 * async lane are guaranteed to be arithmetically honest on screen.
 *
 * Techniques worth stealing:
 *   - `schedule()` returns start/end milliseconds; every card, ring arc and clock
 *     reads from that one source of truth.
 *   - Pending promises ride a polar orbit: angle = base + elapsed * speed.
 *   - The ring progress is an SVG circle with strokeDasharray = circumference.
 *
 * Beat sheet (900 frames @ 30fps = 30s, seamless loop)
 *   Hook    0-65    one blocking call freezes the whole thread
 *   Setup   66-239   sync lane: four requests, strictly one after another
 *   Build   240-464  async lane: all four fire at once and start orbiting
 *   Payoff  465-659  they resolve out of order, fastest first
 *   Detail  660-809  4.8s vs 2.1s, same CPU, same code path
 *   Loop    810-899  the thread parks and the hook returns
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

const BG = '#070B14'
const PANEL = 'rgba(255,255,255,0.035)'
const WHITE = '#EAF2FA'
const MUTED = '#6B7C93'
const CYAN = '#4CC9F0'
const AMBER = '#FFB703'
const RED = '#EF476F'
const GREEN = '#06D6A0'
const VIOLET = '#A78BFA'

const SANS = 'Inter, "Helvetica Neue", Arial, sans-serif'
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'

const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const
const progress = (frame: number, from: number, to: number, easing = Easing.linear) =>
	interpolate(frame, [from, to], [0, 1], { ...CLAMP, easing })

/* ----------------------------------------------------------------- scheduler */

type Request = { label: string; ms: number; color: string }

const REQUESTS: Request[] = [
	{ label: 'GET /user', ms: 1200, color: CYAN },
	{ label: 'GET /cart', ms: 800, color: AMBER },
	{ label: 'GET /feed', ms: 2100, color: VIOLET },
	{ label: 'GET /ads', ms: 700, color: GREEN },
]

type Slot = { start: number; end: number }

/** Sequential: each request waits for the previous one. Parallel: all at zero. */
function schedule(mode: 'sync' | 'async'): { slots: Slot[]; total: number } {
	if (mode === 'async') {
		const slots = REQUESTS.map((request) => ({ start: 0, end: request.ms }))
		return { slots, total: Math.max(...slots.map((slot) => slot.end)) }
	}
	let cursor = 0
	const slots = REQUESTS.map((request) => {
		const slot = { start: cursor, end: cursor + request.ms }
		cursor = slot.end
		return slot
	})
	return { slots, total: cursor }
}

const SYNC = schedule('sync')
const ASYNC = schedule('async')

const formatSeconds = (ms: number) => `${(ms / 1000).toFixed(2)}s`

/* -------------------------------------------------------------------- pieces */

const Backdrop: React.FC<{ frame: number; accent: string }> = ({ frame, accent }) => (
	<AbsoluteFill style={{ backgroundColor: BG }}>
		<AbsoluteFill
			style={{
				background: `radial-gradient(58% 34% at 50% 44%, ${accent}1C 0%, transparent 70%)`,
			}}
		/>
		<AbsoluteFill
			style={{
				backgroundImage:
					'radial-gradient(rgba(255,255,255,0.05) 1px, transparent 1px)',
				backgroundSize: '34px 34px',
				opacity: 0.5,
				transform: `translateY(${(frame * 0.18) % 34}px)`,
			}}
		/>
	</AbsoluteFill>
)

const Header: React.FC<{ title: string; note: string; accent: string; local: number }> = ({
	title,
	note,
	accent,
	local,
}) => {
	const enter = progress(local, 0, 14, Easing.out(Easing.cubic))
	return (
		<>
			<div
				style={{
					position: 'absolute',
					top: 436,
					left: 90,
					width: 900,
					textAlign: 'center',
					fontFamily: SANS,
					fontSize: 72,
					fontWeight: 800,
					letterSpacing: -2.4,
					color: WHITE,
					opacity: enter,
					transform: `translateY(${(1 - enter) * 22}px)`,
				}}
			>
				{title}
			</div>
			<div
				style={{
					position: 'absolute',
					top: 528,
					left: 90,
					width: 900,
					textAlign: 'center',
					fontFamily: MONO,
					fontSize: 23,
					letterSpacing: 3,
					color: accent,
					opacity: progress(local, 8, 22),
				}}
			>
				{note}
			</div>
		</>
	)
}

const RequestCard: React.FC<{
	request: Request
	slot: Slot
	elapsed: number
	index: number
	top: number
	appear: number
}> = ({ request, slot, elapsed, index, top, appear }) => {
	const state = elapsed >= slot.end ? 'done' : elapsed >= slot.start ? 'running' : 'queued'
	const fill =
		state === 'queued'
			? 0
			: Math.min(1, (elapsed - slot.start) / Math.max(1, slot.end - slot.start))
	const color = state === 'queued' ? MUTED : request.color

	return (
		<div
			style={{
				position: 'absolute',
				left: 120,
				top,
				width: 840,
				height: 92,
				borderRadius: 18,
				border: `1px solid ${state === 'queued' ? 'rgba(255,255,255,0.08)' : `${color}55`}`,
				backgroundColor: PANEL,
				opacity: appear,
				transform: `translateX(${(1 - appear) * -30}px)`,
				overflow: 'hidden',
				boxSizing: 'border-box',
			}}
		>
			<div
				style={{
					position: 'absolute',
					inset: 0,
					width: `${fill * 100}%`,
					background: `linear-gradient(90deg, ${color}30, ${color}12)`,
				}}
			/>
			<div
				style={{
					position: 'absolute',
					left: 26,
					top: 28,
					width: 14,
					height: 14,
					borderRadius: 7,
					backgroundColor: state === 'done' ? GREEN : state === 'running' ? color : '#2A3547',
					marginTop: 8,
				}}
			/>
			<div
				style={{
					position: 'absolute',
					left: 62,
					top: 26,
					fontFamily: MONO,
					fontSize: 28,
					color: state === 'queued' ? MUTED : WHITE,
				}}
			>
				{request.label}
			</div>
			<div
				style={{
					position: 'absolute',
					right: 26,
					top: 26,
					fontFamily: MONO,
					fontSize: 26,
					color: state === 'done' ? GREEN : color,
				}}
			>
				{state === 'done' ? `✓ ${formatSeconds(slot.end)}` : state === 'running' ? '…' : 'queued'}
			</div>
			<div
				style={{
					position: 'absolute',
					left: 62,
					bottom: 16,
					fontFamily: MONO,
					fontSize: 17,
					color: MUTED,
				}}
			>
				{`t+${formatSeconds(slot.start)} → ${formatSeconds(slot.end)}`}
			</div>
		</div>
	)
}

const OrbitRing: React.FC<{ elapsed: number; total: number; frame: number }> = ({
	elapsed,
	total,
	frame,
}) => {
	const centreX = WIDTH / 2
	const centreY = 1108
	const radius = 196
	const circumference = 2 * Math.PI * radius
	const done = Math.min(1, elapsed / total)

	return (
		<>
			<svg
				width={WIDTH}
				height={HEIGHT}
				style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
			>
				<circle
					cx={centreX}
					cy={centreY}
					r={radius}
					fill="none"
					stroke="rgba(255,255,255,0.09)"
					strokeWidth={2}
					strokeDasharray="6 12"
				/>
				<circle
					cx={centreX}
					cy={centreY}
					r={radius}
					fill="none"
					stroke={GREEN}
					strokeWidth={5}
					strokeLinecap="round"
					strokeDasharray={circumference}
					strokeDashoffset={circumference * (1 - done)}
					transform={`rotate(-90 ${centreX} ${centreY})`}
					opacity={0.9}
				/>
			</svg>

			<div
				style={{
					position: 'absolute',
					left: centreX - 118,
					top: centreY - 66,
					width: 236,
					textAlign: 'center',
					fontFamily: MONO,
					fontSize: 18,
					letterSpacing: 4,
					color: MUTED,
				}}
			>
				EVENT LOOP
			</div>
			<div
				style={{
					position: 'absolute',
					left: centreX - 160,
					top: centreY - 34,
					width: 320,
					textAlign: 'center',
					fontFamily: MONO,
					fontSize: 74,
					fontWeight: 700,
					color: WHITE,
				}}
			>
				{formatSeconds(Math.min(elapsed, total))}
			</div>

			{REQUESTS.map((request, index) => {
				const slot = ASYNC.slots[index]
				const resolved = elapsed >= slot.end
				const angle =
					-Math.PI / 2 + index * (Math.PI / 2) + (frame * 0.026) * (resolved ? 0.2 : 1)
				const orbitRadius = resolved ? 92 : radius
				const x = centreX + Math.cos(angle) * orbitRadius
				const y = centreY + Math.sin(angle) * orbitRadius
				const size = resolved ? 30 : 44
				return (
					<div
						key={request.label}
						style={{
							position: 'absolute',
							left: x - size / 2,
							top: y - size / 2,
							width: size,
							height: size,
							borderRadius: size / 2,
							backgroundColor: resolved ? `${request.color}` : 'transparent',
							border: `3px solid ${request.color}`,
							boxShadow: `0 0 ${resolved ? 30 : 18}px ${request.color}66`,
						}}
					/>
				)
			})}
		</>
	)
}

const BlockedHook: React.FC<{ frame: number }> = ({ frame }) => {
	const shake = frame > 20 ? Math.sin(frame * 1.5) * (frame > 46 ? 0 : 4) : 0
	const fade = 1 - progress(frame, 52, 66, Easing.in(Easing.cubic))
	return (
		<AbsoluteFill style={{ opacity: fade }}>
			<div
				style={{
					position: 'absolute',
					top: 470,
					left: 90,
					width: 900,
					textAlign: 'center',
					fontFamily: SANS,
					fontSize: 92,
					fontWeight: 900,
					letterSpacing: -3,
					color: WHITE,
					transform: `translateX(${shake}px) scale(${interpolate(frame, [0, 10], [1.35, 1], {
						...CLAMP,
						easing: Easing.out(Easing.back(1.7)),
					})})`,
				}}
			>
				ONE LINE
				<br />
				<span style={{ color: RED }}>FROZE THE APP</span>
			</div>
			<div
				style={{
					position: 'absolute',
					left: 180,
					top: 1010,
					width: 720,
					height: 96,
					borderRadius: 18,
					border: `1px solid ${RED}66`,
					backgroundColor: 'rgba(239,71,111,0.1)',
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					fontFamily: MONO,
					fontSize: 30,
					color: RED,
					opacity: progress(frame, 14, 26),
				}}
			>
				const data = fetchSync(url)
			</div>
			<div
				style={{
					position: 'absolute',
					left: 180,
					top: 1136,
					width: 720,
					height: 10,
					borderRadius: 5,
					backgroundColor: 'rgba(255,255,255,0.08)',
					overflow: 'hidden',
					opacity: progress(frame, 20, 30),
				}}
			>
				<div
					style={{
						width: `${progress(frame, 22, 44) * 100}%`,
						height: '100%',
						backgroundColor: RED,
					}}
				/>
			</div>
			<div
				style={{
					position: 'absolute',
					left: 90,
					top: 1180,
					width: 900,
					textAlign: 'center',
					fontFamily: MONO,
					fontSize: 22,
					letterSpacing: 4,
					color: MUTED,
					opacity: progress(frame, 30, 42),
				}}
			>
				UI THREAD · NOT RESPONDING
			</div>
		</AbsoluteFill>
	)
}

const Verdict: React.FC<{ frame: number }> = ({ frame }) => {
	const rows = [
		{ label: 'SYNCHRONOUS', ms: SYNC.total, color: RED },
		{ label: 'ASYNCHRONOUS', ms: ASYNC.total, color: GREEN },
	]
	const longest = Math.max(...rows.map((row) => row.ms))
	return (
		<>
			{rows.map((row, index) => {
				const grow = progress(frame, 690 + index * 26, 760 + index * 26, Easing.out(Easing.cubic))
				const width = 760 * (row.ms / longest) * grow
				return (
					<div key={row.label}>
						<div
							style={{
								position: 'absolute',
								left: 140,
								top: 940 + index * 168,
								fontFamily: MONO,
								fontSize: 24,
								letterSpacing: 4,
								color: MUTED,
							}}
						>
							{row.label}
						</div>
						<div
							style={{
								position: 'absolute',
								left: 140,
								top: 980 + index * 168,
								width,
								height: 74,
								borderRadius: 14,
								background: `linear-gradient(90deg, ${row.color}, ${row.color}55)`,
							}}
						/>
						<div
							style={{
								position: 'absolute',
								left: 152 + width,
								top: 992 + index * 168,
								fontFamily: MONO,
								fontSize: 40,
								fontWeight: 700,
								color: row.color,
								opacity: grow,
							}}
						>
							{formatSeconds(row.ms)}
						</div>
					</div>
				)
			})}
			<div
				style={{
					position: 'absolute',
					top: 1300,
					left: 90,
					width: 900,
					textAlign: 'center',
					fontFamily: SANS,
					fontSize: 34,
					fontWeight: 700,
					color: WHITE,
					opacity: progress(frame, 770, 790),
				}}
			>
				Same CPU. Same requests.{' '}
				<span style={{ color: GREEN }}>
					{`${(SYNC.total / ASYNC.total).toFixed(1)}x faster.`}
				</span>
			</div>
		</>
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
				border: `2px dashed ${CYAN}80`,
			}}
		/>
	</AbsoluteFill>
)

/* ---------------------------------------------------------------- composition */

export const EventLoopOrbit: React.FC<{ showGuides?: boolean }> = ({ showGuides = false }) => {
	const frame = useCurrentFrame()

	const syncElapsed = interpolate(frame, [80, 232], [0, SYNC.total], CLAMP)
	const asyncElapsed = interpolate(frame, [258, 640], [0, ASYNC.total * 1.02], CLAMP)

	const accent =
		frame < 66 ? RED : frame < 240 ? AMBER : frame < 660 ? GREEN : frame < 810 ? CYAN : VIOLET
	const loopFade = progress(frame, 886, 899, Easing.in(Easing.quad))

	return (
		<AbsoluteFill style={{ backgroundColor: BG }}>
			<Backdrop frame={frame} accent={accent} />

			{frame < 66 ? <BlockedHook frame={frame} /> : null}

			{frame >= 66 && frame < 240 ? (
				<>
					<Header
						title="ONE AT A TIME"
						note="await fetch(a); await fetch(b); …"
						accent={AMBER}
						local={frame - 66}
					/>
					{REQUESTS.map((request, index) => (
						<RequestCard
							key={request.label}
							request={request}
							slot={SYNC.slots[index]}
							elapsed={syncElapsed}
							index={index}
							top={636 + index * 110}
							appear={progress(frame, 72 + index * 7, 90 + index * 7, Easing.out(Easing.cubic))}
						/>
					))}
					<div
						style={{
							position: 'absolute',
							top: 1130,
							left: 90,
							width: 900,
							textAlign: 'center',
							fontFamily: MONO,
							fontSize: 84,
							fontWeight: 700,
							color: RED,
						}}
					>
						{formatSeconds(syncElapsed)}
					</div>
					<div
						style={{
							position: 'absolute',
							top: 1236,
							left: 90,
							width: 900,
							textAlign: 'center',
							fontFamily: MONO,
							fontSize: 22,
							letterSpacing: 5,
							color: MUTED,
						}}
					>
						TOTAL WALL CLOCK
					</div>
				</>
			) : null}

			{frame >= 240 && frame < 660 ? (
				<>
					<Header
						title={frame < 465 ? 'FIRE ALL FOUR' : 'RESOLVE OUT OF ORDER'}
						note={frame < 465 ? 'await Promise.all([…])' : 'fastest wins, nobody waits'}
						accent={GREEN}
						local={frame - (frame < 465 ? 240 : 465)}
					/>
					<OrbitRing elapsed={asyncElapsed} total={ASYNC.total} frame={frame} />
					{REQUESTS.map((request, index) => {
						const resolved = asyncElapsed >= ASYNC.slots[index].end
						return (
							<div
								key={request.label}
								style={{
									position: 'absolute',
									left: 150 + (index % 2) * 400,
									top: 1372 + Math.floor(index / 2) * 74,
									width: 380,
									height: 58,
									borderRadius: 12,
									border: `1px solid ${resolved ? `${request.color}66` : 'rgba(255,255,255,0.08)'}`,
									backgroundColor: resolved ? `${request.color}14` : 'transparent',
									display: 'flex',
									alignItems: 'center',
									justifyContent: 'space-between',
									padding: '0 18px',
									boxSizing: 'border-box',
									fontFamily: MONO,
									fontSize: 20,
									color: resolved ? WHITE : MUTED,
									opacity: progress(frame, 250 + index * 6, 268 + index * 6),
								}}
							>
								<span>{request.label}</span>
								<span style={{ color: resolved ? request.color : MUTED }}>
									{resolved ? formatSeconds(ASYNC.slots[index].end) : 'pending'}
								</span>
							</div>
						)
					})}
				</>
			) : null}

			{frame >= 660 && frame < 810 ? (
				<>
					<Header
						title="THE RECEIPT"
						note="blocking is a choice"
						accent={CYAN}
						local={frame - 660}
					/>
					<Verdict frame={frame} />
				</>
			) : null}

			{frame >= 810 ? (
				<AbsoluteFill
					style={{
						opacity: progress(frame, 812, 836, Easing.out(Easing.cubic)),
					}}
				>
					<div
						style={{
							position: 'absolute',
							top: 860,
							left: 90,
							width: 900,
							textAlign: 'center',
							fontFamily: SANS,
							fontSize: 80,
							fontWeight: 900,
							letterSpacing: -2.6,
							color: WHITE,
						}}
					>
						DON’T BLOCK
						<br />
						<span style={{ color: GREEN }}>THE LOOP</span>
					</div>
				</AbsoluteFill>
			) : null}

			<AbsoluteFill style={{ backgroundColor: BG, opacity: loopFade }} />
			{showGuides ? <Guides /> : null}
		</AbsoluteFill>
	)
}

export const Root: React.FC = () => (
	<Composition
		id="EventLoopOrbit"
		component={EventLoopOrbit}
		durationInFrames={DURATION_IN_FRAMES}
		fps={FPS}
		width={WIDTH}
		height={HEIGHT}
		defaultProps={{ showGuides: false }}
	/>
)

registerRoot(Root)

export default EventLoopOrbit
