/**
 * THREAD RACE
 * -----------------------------------------------------------------------------
 * Concurrency (one core, time-sliced) against parallelism (four cores, at once).
 * The stripes on screen are emitted by an actual round-robin scheduler, so the
 * interleaving pattern is derived, never drawn by hand.
 *
 * Techniques worth stealing:
 *   - `roundRobin()` returns a segment list; the lane, the per-task progress bars
 *     and the finish times all read from it.
 *   - A single `simTime` value drives a playhead across both lanes so the two
 *     strategies stay frame-locked to each other.
 *   - Cores glow from a derived activity value, not from a separate animation.
 *
 * Beat sheet (900 frames @ 30fps = 30s, seamless loop)
 *   Hook    0-65    four jobs, one core, a question
 *   Setup   66-239   round-robin slicing: everything moves, nothing finishes
 *   Build   240-464  the same jobs dealt to four cores
 *   Payoff  465-659  both playheads run, the parallel lane finishes first
 *   Detail  660-809  66 slices vs 22 ticks, and the Amdahl caveat
 *   Loop    810-899  the tape rewinds to the start
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

const BG = '#090612'
const WHITE = '#F2ECFF'
const MUTED = '#7C6E9A'
const MAGENTA = '#FF3D9A'
const LIME = '#B8FF3D'
const VIOLET = '#8B5CF6'
const CYAN = '#22D3EE'

const SANS = 'Inter, "Helvetica Neue", Arial, sans-serif'
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'

const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const
const progress = (frame: number, from: number, to: number, easing = Easing.linear) =>
	interpolate(frame, [from, to], [0, 1], { ...CLAMP, easing })

/* ----------------------------------------------------------------- scheduler */

type Job = { label: string; work: number; color: string }

const JOBS: Job[] = [
	{ label: 'encode', work: 22, color: MAGENTA },
	{ label: 'resize', work: 14, color: LIME },
	{ label: 'upload', work: 18, color: CYAN },
	{ label: 'notify', work: 12, color: VIOLET },
]

type Segment = { job: number; from: number; to: number; lane: number }

/** One core, quantum-sized slices, cycling until every job is drained. */
function roundRobin(quantum = 2): { segments: Segment[]; total: number } {
	const remaining = JOBS.map((job) => job.work)
	const segments: Segment[] = []
	let cursor = 0
	while (remaining.some((value) => value > 0)) {
		remaining.forEach((value, job) => {
			if (value <= 0) return
			const take = Math.min(quantum, value)
			segments.push({ job, from: cursor, to: cursor + take, lane: 0 })
			cursor += take
			remaining[job] -= take
		})
	}
	return { segments, total: cursor }
}

/** Four cores, one job each, all starting at tick zero. */
function parallel(): { segments: Segment[]; total: number } {
	const segments = JOBS.map((job, index) => ({ job: index, from: 0, to: job.work, lane: index }))
	return { segments, total: Math.max(...JOBS.map((job) => job.work)) }
}

const CONCURRENT = roundRobin(2)
const PARALLEL = parallel()
const LONGEST = Math.max(CONCURRENT.total, PARALLEL.total)

/** How much of a job is finished at a given tick, for either schedule. */
function completion(segments: Segment[], job: number, tick: number): number {
	const total = JOBS[job].work
	const done = segments
		.filter((segment) => segment.job === job)
		.reduce(
			(sum, segment) => sum + Math.max(0, Math.min(segment.to, tick) - segment.from),
			0,
		)
	return Math.max(0, Math.min(1, done / total))
}

function activeJob(segments: Segment[], tick: number, lane: number): number | null {
	const hit = segments.find(
		(segment) => segment.lane === lane && tick >= segment.from && tick < segment.to,
	)
	return hit ? hit.job : null
}

/* --------------------------------------------------------------------- lanes */

const TAPE_LEFT = 120
const TAPE_WIDTH = 840
const tickToX = (tick: number) => TAPE_LEFT + (tick / LONGEST) * TAPE_WIDTH

const Tape: React.FC<{
	segments: Segment[]
	lanes: number
	top: number
	height: number
	tick: number
	reveal: number
}> = ({ segments, lanes, top, height, tick, reveal }) => {
	const laneHeight = height / lanes
	return (
		<>
			{Array.from({ length: lanes }).map((_, lane) => (
				<div
					key={`bed-${lane}`}
					style={{
						position: 'absolute',
						left: TAPE_LEFT,
						top: top + lane * laneHeight,
						width: TAPE_WIDTH,
						height: laneHeight - 8,
						borderRadius: 10,
						backgroundColor: 'rgba(255,255,255,0.045)',
						border: '1px solid rgba(255,255,255,0.06)',
						boxSizing: 'border-box',
						opacity: reveal,
					}}
				/>
			))}
			{segments.map((segment, index) => {
				const visible = Math.min(segment.to, tick)
				if (visible <= segment.from) return null
				const left = tickToX(segment.from)
				const width = tickToX(visible) - left
				const job = JOBS[segment.job]
				return (
					<div
						key={index}
						style={{
							position: 'absolute',
							left,
							top: top + segment.lane * laneHeight + 3,
							width: Math.max(2, width - 2),
							height: laneHeight - 14,
							borderRadius: 6,
							background: `linear-gradient(180deg, ${job.color}, ${job.color}A0)`,
							opacity: reveal,
						}}
					/>
				)
			})}
			<div
				style={{
					position: 'absolute',
					left: tickToX(Math.min(tick, LONGEST)) - 1,
					top: top - 10,
					width: 2,
					height: height + 12,
					backgroundColor: 'rgba(255,255,255,0.6)',
					opacity: reveal * 0.9,
				}}
			/>
		</>
	)
}

const CoreGrid: React.FC<{ tick: number; segments: Segment[]; lanes: number; top: number }> = ({
	tick,
	segments,
	lanes,
	top,
}) => (
	<div style={{ position: 'absolute', left: 120, top, display: 'flex', gap: 16 }}>
		{Array.from({ length: 4 }).map((_, core) => {
			const lane = lanes === 1 ? 0 : core
			const busy = lanes === 1 ? (core === 0 ? activeJob(segments, tick, 0) : null) : activeJob(segments, tick, lane)
			const color = busy === null ? 'rgba(255,255,255,0.07)' : JOBS[busy].color
			return (
				<div
					key={core}
					style={{
						width: 198,
						height: 78,
						borderRadius: 14,
						border: `1px solid ${busy === null ? 'rgba(255,255,255,0.09)' : `${color}77`}`,
						backgroundColor: busy === null ? 'rgba(255,255,255,0.02)' : `${color}1F`,
						display: 'flex',
						flexDirection: 'column',
						alignItems: 'center',
						justifyContent: 'center',
						boxSizing: 'border-box',
					}}
				>
					<span style={{ fontFamily: MONO, fontSize: 15, letterSpacing: 3, color: MUTED }}>
						{`CORE ${core}`}
					</span>
					<span
						style={{
							fontFamily: MONO,
							fontSize: 22,
							color: busy === null ? 'rgba(255,255,255,0.22)' : color,
							marginTop: 4,
						}}
					>
						{busy === null ? 'idle' : JOBS[busy].label}
					</span>
				</div>
			)
		})}
	</div>
)

const JobBars: React.FC<{ segments: Segment[]; tick: number; top: number; fps: number; frame: number; appearAt: number }> = ({
	segments,
	tick,
	top,
	fps,
	frame,
	appearAt,
}) => (
	<>
		{JOBS.map((job, index) => {
			const enter = spring({
				frame: frame - appearAt - index * 4,
				fps,
				config: { damping: 14, mass: 0.5, stiffness: 120 },
			})
			const done = completion(segments, index, tick)
			return (
				<div key={job.label} style={{ opacity: enter }}>
					<div
						style={{
							position: 'absolute',
							left: 120,
							top: top + index * 56,
							fontFamily: MONO,
							fontSize: 21,
							color: done >= 1 ? job.color : MUTED,
							width: 150,
						}}
					>
						{job.label}
					</div>
					<div
						style={{
							position: 'absolute',
							left: 280,
							top: top + index * 56 + 6,
							width: 560,
							height: 14,
							borderRadius: 7,
							backgroundColor: 'rgba(255,255,255,0.06)',
							overflow: 'hidden',
						}}
					>
						<div
							style={{
								width: `${done * 100}%`,
								height: '100%',
								backgroundColor: job.color,
							}}
						/>
					</div>
					<div
						style={{
							position: 'absolute',
							left: 862,
							top: top + index * 56,
							fontFamily: MONO,
							fontSize: 20,
							color: done >= 1 ? job.color : MUTED,
						}}
					>
						{`${Math.round(done * 100)}%`}
					</div>
				</div>
			)
		})}
	</>
)

const Beat: React.FC<{ title: string; note: string; accent: string; local: number }> = ({
	title,
	note,
	accent,
	local,
}) => {
	const enter = progress(local, 0, 13, Easing.out(Easing.cubic))
	return (
		<>
			<div
				style={{
					position: 'absolute',
					top: 434,
					left: 90,
					width: 900,
					textAlign: 'center',
					fontFamily: SANS,
					fontSize: 70,
					fontWeight: 800,
					letterSpacing: -2.2,
					color: WHITE,
					opacity: enter,
					transform: `translateY(${(1 - enter) * 20}px)`,
				}}
			>
				{title}
			</div>
			<div
				style={{
					position: 'absolute',
					top: 524,
					left: 90,
					width: 900,
					textAlign: 'center',
					fontFamily: MONO,
					fontSize: 22,
					letterSpacing: 4,
					color: accent,
					opacity: progress(local, 8, 20),
				}}
			>
				{note}
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
				border: `2px dashed ${LIME}80`,
			}}
		/>
	</AbsoluteFill>
)

/* ---------------------------------------------------------------- composition */

export const ThreadRace: React.FC<{ showGuides?: boolean }> = ({ showGuides = false }) => {
	const frame = useCurrentFrame()
	const { fps } = useVideoConfig()

	const concurrentTick = interpolate(frame, [86, 452], [0, CONCURRENT.total], CLAMP)
	const raceConcurrent = interpolate(frame, [478, 646], [0, CONCURRENT.total], CLAMP)
	const raceParallel = interpolate(frame, [478, 646], [0, CONCURRENT.total], CLAMP)

	const accent = frame < 240 ? MAGENTA : frame < 465 ? LIME : frame < 660 ? CYAN : VIOLET
	const loopFade = progress(frame, 886, 899, Easing.in(Easing.quad))

	return (
		<AbsoluteFill style={{ backgroundColor: BG }}>
			<AbsoluteFill
				style={{
					background: `radial-gradient(64% 40% at 50% 40%, ${accent}18 0%, transparent 72%)`,
				}}
			/>
			<AbsoluteFill
				style={{
					backgroundImage:
						'linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)',
					backgroundSize: '60px 100%',
					opacity: 0.7,
				}}
			/>

			{frame < 66 ? (
				<AbsoluteFill style={{ opacity: 1 - progress(frame, 52, 66, Easing.in(Easing.cubic)) }}>
					<div
						style={{
							position: 'absolute',
							top: 500,
							left: 90,
							width: 900,
							textAlign: 'center',
							fontFamily: SANS,
							fontSize: 88,
							fontWeight: 900,
							letterSpacing: -3,
							color: WHITE,
							transform: `scale(${interpolate(frame, [0, 11], [1.3, 1], {
								...CLAMP,
								easing: Easing.out(Easing.back(1.6)),
							})})`,
						}}
					>
						FOUR JOBS.
						<br />
						<span style={{ color: MAGENTA }}>ONE CORE.</span>
					</div>
					<div
						style={{
							position: 'absolute',
							top: 720,
							left: 90,
							width: 900,
							textAlign: 'center',
							fontFamily: MONO,
							fontSize: 26,
							letterSpacing: 6,
							color: MUTED,
							opacity: progress(frame, 14, 28),
						}}
					>
						CONCURRENT ≠ PARALLEL
					</div>
					<CoreGrid tick={frame % 8} segments={CONCURRENT.segments} lanes={1} top={1020} />
				</AbsoluteFill>
			) : null}

			{frame >= 66 && frame < 465 ? (
				<>
					<Beat
						title={frame < 240 ? 'TIME SLICING' : 'DEAL THEM OUT'}
						note={frame < 240 ? 'one core, 2-tick quantum' : 'four cores, one job each'}
						accent={frame < 240 ? MAGENTA : LIME}
						local={frame - (frame < 240 ? 66 : 240)}
					/>
					<div
						style={{
							position: 'absolute',
							left: 120,
							top: 626,
							fontFamily: MONO,
							fontSize: 19,
							letterSpacing: 4,
							color: MUTED,
						}}
					>
						{frame < 240 ? 'CORE 0 TIMELINE' : 'CORE 0-3 TIMELINE'}
					</div>
					{frame < 240 ? (
						<Tape
							segments={CONCURRENT.segments}
							lanes={1}
							top={664}
							height={86}
							tick={concurrentTick}
							reveal={progress(frame, 72, 88)}
						/>
					) : (
						<Tape
							segments={PARALLEL.segments}
							lanes={4}
							top={664}
							height={200}
							tick={interpolate(frame, [252, 430], [0, PARALLEL.total], CLAMP)}
							reveal={progress(frame, 244, 260)}
						/>
					)}
					<CoreGrid
						tick={frame < 240 ? concurrentTick : interpolate(frame, [252, 430], [0, PARALLEL.total], CLAMP)}
						segments={frame < 240 ? CONCURRENT.segments : PARALLEL.segments}
						lanes={frame < 240 ? 1 : 4}
						top={frame < 240 ? 800 : 918}
					/>
					<JobBars
						segments={frame < 240 ? CONCURRENT.segments : PARALLEL.segments}
						tick={frame < 240 ? concurrentTick : interpolate(frame, [252, 430], [0, PARALLEL.total], CLAMP)}
						top={frame < 240 ? 950 : 1054}
						fps={fps}
						frame={frame}
						appearAt={frame < 240 ? 96 : 262}
					/>
				</>
			) : null}

			{frame >= 465 && frame < 660 ? (
				<>
					<Beat title="SAME WORK. RACE." note="66 ticks vs 22 ticks" accent={CYAN} local={frame - 465} />
					<div
						style={{
							position: 'absolute',
							left: 120,
							top: 640,
							fontFamily: MONO,
							fontSize: 19,
							letterSpacing: 4,
							color: MAGENTA,
						}}
					>
						CONCURRENT · 1 CORE
					</div>
					<Tape
						segments={CONCURRENT.segments}
						lanes={1}
						top={678}
						height={80}
						tick={raceConcurrent}
						reveal={progress(frame, 470, 486)}
					/>
					<div
						style={{
							position: 'absolute',
							left: 120,
							top: 806,
							fontFamily: MONO,
							fontSize: 19,
							letterSpacing: 4,
							color: LIME,
						}}
					>
						PARALLEL · 4 CORES
					</div>
					<Tape
						segments={PARALLEL.segments}
						lanes={4}
						top={844}
						height={196}
						tick={raceParallel}
						reveal={progress(frame, 470, 486)}
					/>
					{[
						{ label: 'CONCURRENT', total: CONCURRENT.total, color: MAGENTA, tick: raceConcurrent },
						{ label: 'PARALLEL', total: PARALLEL.total, color: LIME, tick: raceParallel },
					].map((row, index) => {
						const finished = row.tick >= row.total
						return (
							<div
								key={row.label}
								style={{
									position: 'absolute',
									left: 120 + index * 432,
									top: 1106,
									width: 408,
									height: 132,
									borderRadius: 18,
									border: `1px solid ${finished ? `${row.color}88` : 'rgba(255,255,255,0.08)'}`,
									backgroundColor: finished ? `${row.color}14` : 'rgba(255,255,255,0.02)',
									boxSizing: 'border-box',
									padding: 18,
								}}
							>
								<div style={{ fontFamily: MONO, fontSize: 17, letterSpacing: 3, color: MUTED }}>
									{row.label}
								</div>
								<div
									style={{
										fontFamily: MONO,
										fontSize: 54,
										fontWeight: 700,
										color: finished ? row.color : WHITE,
										marginTop: 6,
									}}
								>
									{`${Math.min(Math.round(row.tick), row.total)}`}
									<span style={{ fontSize: 24, color: MUTED }}>{` / ${row.total} ticks`}</span>
								</div>
								{finished ? (
									<div style={{ fontFamily: MONO, fontSize: 20, color: row.color, marginTop: 2 }}>
										DONE
									</div>
								) : null}
							</div>
						)
					})}
				</>
			) : null}

			{frame >= 660 && frame < 810 ? (
				<>
					<Beat
						title="WHY IT MATTERS"
						note="concurrency structures, parallelism executes"
						accent={VIOLET}
						local={frame - 660}
					/>
					{[
						{ k: 'Concurrency', v: 'deals with many things at once', c: MAGENTA },
						{ k: 'Parallelism', v: 'does many things at once', c: LIME },
						{ k: 'Amdahl', v: 'the serial part sets the floor', c: CYAN },
					].map((row, index) => {
						const enter = progress(frame, 676 + index * 30, 706 + index * 30, Easing.out(Easing.cubic))
						return (
							<div
								key={row.k}
								style={{
									position: 'absolute',
									left: 120,
									top: 700 + index * 176,
									width: 840,
									height: 148,
									borderRadius: 20,
									border: `1px solid ${row.c}44`,
									backgroundColor: `${row.c}0F`,
									boxSizing: 'border-box',
									padding: '26px 30px',
									opacity: enter,
									transform: `translateX(${(1 - enter) * 34}px)`,
								}}
							>
								<div style={{ fontFamily: SANS, fontSize: 40, fontWeight: 800, color: row.c }}>
									{row.k}
								</div>
								<div style={{ fontFamily: SANS, fontSize: 30, color: WHITE, marginTop: 8 }}>
									{row.v}
								</div>
							</div>
						)
					})}
				</>
			) : null}

			{frame >= 810 ? (
				<AbsoluteFill style={{ opacity: progress(frame, 812, 834, Easing.out(Easing.cubic)) }}>
					<div
						style={{
							position: 'absolute',
							top: 880,
							left: 90,
							width: 900,
							textAlign: 'center',
							fontFamily: SANS,
							fontSize: 78,
							fontWeight: 900,
							letterSpacing: -2.6,
							color: WHITE,
						}}
					>
						ONE CORE CAN JUGGLE.
						<br />
						<span style={{ color: LIME }}>FOUR CAN FINISH.</span>
					</div>
				</AbsoluteFill>
			) : null}

			<div
				style={{
					position: 'absolute',
					top: 1452,
					left: 90,
					width: 900,
					textAlign: 'center',
					fontFamily: MONO,
					fontSize: 18,
					letterSpacing: 6,
					color: MUTED,
				}}
			>
				{`ROUND ROBIN q=2 · ${CONCURRENT.segments.length} SLICES`}
			</div>

			<AbsoluteFill style={{ backgroundColor: BG, opacity: loopFade }} />
			{showGuides ? <Guides /> : null}
		</AbsoluteFill>
	)
}

export const Root: React.FC = () => (
	<Composition
		id="ThreadRace"
		component={ThreadRace}
		durationInFrames={DURATION_IN_FRAMES}
		fps={FPS}
		width={WIDTH}
		height={HEIGHT}
		defaultProps={{ showGuides: false }}
	/>
)

registerRoot(Root)

export default ThreadRace
