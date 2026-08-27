/**
 * Typographic motion scenes.
 *
 * Ten complete pieces whose subject *is* the type: kinetic sequences, swaps,
 * masks, glitch, neon, impact, marquees and tickers. None of them shares a
 * composition with another, so two films that both open on words still open
 * differently.
 *
 * Emitted verbatim into the generated TSX: no backticks, no dollar-braces.
 */

export const TYPE_SCENES = {
	'kinetic-type': `
/**
 * Kinetic typography.
 *
 * Each word is its own event: it lands on a beat, at its own size, in its own
 * corner of the page, and the ones already down keep drifting. The rhythm is
 * read from the motion signature, so a slam film and a drift film do not
 * animate the same sentence the same way.
 */
const KineticWord: React.FC<{
	word: string
	delay: number
	index: number
	shape: number
	emphasis: boolean
}> = ({ word, delay, index, shape, emphasis }) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const arrival = useArrival(delay, 1.1, index)
	const size = unit * (emphasis ? 128 : 74) * (shape === 4 ? 0.82 : 1)
	const drift = Math.sin((frame - delay) / 44 + index) * unit * (shape === 0 ? 7 : 3)
	const lift = shape === 3 ? (index % 2 === 0 ? -unit * 26 : unit * 26) : 0

	return (
		<span
			style={{
				fontFamily: DISPLAY_FONT,
				fontWeight: emphasis ? DISPLAY_WEIGHT : Math.max(300, DISPLAY_WEIGHT - 250),
				fontSize: size,
				lineHeight: 0.94,
				letterSpacing: trackingFor(size) - unit * 1.2,
				color: emphasis ? THEME.accent : THEME.ink,
				opacity: arrival.opacity,
				transform: arrival.transform + ' translate(' + drift.toFixed(2) + 'px, ' + (lift + drift * 0.4).toFixed(2) + 'px)',
				clipPath: arrival.clipPath,
				filter: arrival.filter,
				textTransform: TYPE_KEEPS_CASE ? 'none' : 'uppercase',
			}}
		>
			{word}
		</span>
	)
}

const KineticTypeScene: React.FC<MotionSceneProps> = (props) => {
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 5
	const source = props.headline || motionLines(props, 1)[0]
	const parts = words(source).slice(0, 9)
	const step = Math.max(6, (props.frames * 0.52) / Math.max(1, parts.length))

	return (
		<AbsoluteFill>
			<Backdrop seed={11} intensity={0.55} />
			<AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: width * LAYOUT_INSET }}>
				<div
					style={{
						display: 'flex',
						flexWrap: 'wrap',
						alignItems: 'baseline',
						justifyContent: shape === 1 ? 'flex-start' : shape === 3 ? 'flex-end' : 'center',
						gap: unit * 18,
						maxWidth: width * 0.86,
					}}
				>
					{parts.map((word, index) => (
						<KineticWord
							key={'kt-' + index}
							word={word}
							delay={index * step}
							index={index}
							shape={shape}
							emphasis={index % (shape === 2 ? 2 : 3) === 0}
						/>
					))}
				</div>
			</AbsoluteFill>
			{props.caption ? (
				<div style={{ position: 'absolute', left: width * LAYOUT_INSET, bottom: height * 0.08 }}>
					<MicroLabel text={props.caption} delay={parts.length * step + 8} />
				</div>
			) : null}
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,

	'word-swap': `
/**
 * One anchor line, one slot that keeps changing.
 *
 * The fixed half of the sentence never moves; the variable half cycles through
 * the brief's own phrases on a hard cut, which is what makes the device read as
 * an argument rather than as a slideshow.
 */
const WordSwapScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width } = useVideoConfig()
	const shape = props.variant % 4
	const swaps = motionLines(props, 4)
	const anchor = props.kicker || words(props.headline).slice(0, 2).join(' ')
	const hold = Math.max(14, props.frames / Math.max(2, swaps.length + 0.4))
	const index = Math.min(swaps.length - 1, Math.floor(frame / hold))
	const local = frame - index * hold
	const cut = interpolate(local, [0, 7], [0, 1], { ...CLAMP, easing: EASE_OUT })
	const exit = interpolate(local, [hold - 6, hold], [1, 0], CLAMP)
	// Only one phrase is on screen at a time, so the size is bound by the widest
	// of them rather than by the height of a stack that never exists.
	const size = fitLine(
		unit * (shape === 2 ? 96 : 116),
		swaps.reduce((most, line) => (line.length > most.length ? line : most), ''),
		width * 0.78,
	)

	return (
		<AbsoluteFill>
			<Backdrop seed={12} intensity={0.75} />
			<SceneFrame gap={unit * 18} align={shape === 1 ? 'flex-start' : 'center'}>
				<Kicker text={anchor} delay={2} />
				<div
					style={{
						position: 'relative',
						minHeight: unit * 150,
						display: 'flex',
						alignItems: 'center',
						justifyContent: shape === 1 ? 'flex-start' : 'center',
						width: width * 0.82,
						overflow: 'hidden',
					}}
				>
					<span
						style={{
							fontFamily: DISPLAY_FONT,
							fontWeight: DISPLAY_WEIGHT,
							fontSize: size,
							lineHeight: 1,
							letterSpacing: trackingFor(size) - unit,
							color: index % 2 === 0 ? THEME.ink : THEME.accent,
							opacity: cut * exit,
							transform:
								shape === 3
									? 'translateY(' + ((1 - cut) * unit * 90).toFixed(2) + 'px)'
									: 'translateX(' + ((1 - cut) * unit * (shape === 1 ? -70 : 70)).toFixed(2) + 'px) skewX(' + ((1 - cut) * -9).toFixed(2) + 'deg)',
							textTransform: TYPE_KEEPS_CASE ? 'none' : 'uppercase',
							textAlign: shape === 1 ? 'left' : 'center',
						}}
					>
						{swaps[index]}
					</span>
					<div
						aria-hidden
						style={{
							position: 'absolute',
							left: 0,
							right: 0,
							bottom: 0,
							height: Math.max(2, unit * 4),
							backgroundColor: withAlpha(THEME.accent, 0.5),
							transformOrigin: 'left',
							transform: 'scaleX(' + (local / hold).toFixed(3) + ')',
						}}
					/>
				</div>
				<Copy text={props.caption} delay={18} align={shape === 1 ? 'left' : 'center'} size={unit * 26} />
			</SceneFrame>
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,

	'type-ladder': `
/**
 * A type scale built line by line.
 *
 * Each line is set larger than the one above it and enters from the opposite
 * margin, so the block assembles into a wedge instead of a paragraph.
 */
const LadderRow: React.FC<{ line: string; index: number; ratio: number; shape: number; last: boolean; cap: number }> = ({
	line,
	index,
	ratio,
	shape,
	last,
	cap,
}) => {
	const unit = useUnit()
	const { width } = useVideoConfig()
	// The wedge only reads as a wedge while every rung stays on one line, so the
	// scale is capped by whatever the longest rung can afford.
	const size = Math.min(cap, unit * (34 + ratio * 82))
	const arrival = useArrival(6 + index * beat(6), size / 90, index)
	const fromLeft = shape === 1 ? index % 2 === 1 : index % 2 === 0

	return (
		<div
			style={{
				display: 'flex',
				alignItems: 'center',
				gap: unit * 16,
				flexDirection: fromLeft ? 'row' : 'row-reverse',
				opacity: arrival.opacity,
				transform: arrival.transform + ' translateX(' + ((fromLeft ? -1 : 1) * (1 - arrival.opacity) * unit * 40).toFixed(2) + 'px)',
				filter: arrival.filter,
			}}
		>
			<span
				style={{
					fontFamily: DISPLAY_FONT,
					fontWeight: DISPLAY_WEIGHT,
					fontSize: size,
					lineHeight: 1.02,
					letterSpacing: trackingFor(size),
					color: last ? THEME.accent : THEME.ink,
					textTransform: TYPE_KEEPS_CASE ? 'none' : 'uppercase',
					maxWidth: width * 0.8,
				}}
			>
				{line}
			</span>
			{shape === 0 ? (
				<span
					style={{
						fontFamily: TEXT_FONT,
						fontSize: unit * 20,
						fontWeight: safeTextWeight(500),
						color: THEME.muted,
						letterSpacing: unit * 2,
					}}
				>
					{String(index + 1).padStart(2, '0')}
				</span>
			) : null}
		</div>
	)
}

const TypeLadderScene: React.FC<MotionSceneProps> = (props) => {
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const rows = motionLines(props, shape === 3 ? 3 : 5)
	const growing = shape !== 2

	return (
		<AbsoluteFill>
			<Backdrop seed={13} intensity={0.6} />
			<AbsoluteFill
				style={{
					display: 'flex',
					flexDirection: 'column',
					justifyContent: 'center',
					alignItems: shape === 1 ? 'flex-end' : 'flex-start',
					padding: width * LAYOUT_INSET,
					gap: unit * 6,
				}}
			>
				{rows.map((line, index) => (
					<LadderRow
						key={'ladder-' + index}
						line={line}
						index={index}
						ratio={growing ? index / Math.max(1, rows.length - 1) : 1 - index / Math.max(1, rows.length - 1)}
						shape={shape}
						last={index === rows.length - 1 && growing}
						cap={fitStack(unit * 116, rows, width * 0.78, height * 0.74)}
					/>
				))}
			</AbsoluteFill>
			{props.caption ? (
				<div style={{ position: 'absolute', right: width * LAYOUT_INSET, bottom: height * 0.07 }}>
					<MicroLabel text={props.caption} delay={rows.length * 7} align="right" />
				</div>
			) : null}
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,

	'mask-wipe': `
/**
 * A headline uncovered by moving colour.
 *
 * Solid blocks travel across the line and the type is revealed in the space
 * they leave behind, so the reveal is a physical event rather than a fade.
 */
const MaskWipeScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const rows = motionLines(props, 3)
	const bandHeight = height * (shape === 2 ? 0.13 : 0.17)
	/**
	 * Each band sets its line on one line inside a clipping box, so the type is
	 * fitted to the widest phrase rather than set at a size the brief may not fit.
	 */
	const bandSize = fitLine(unit * 96, rows.reduce((most, line) => (line.length > most.length ? line : most), ''), width * 0.82)

	return (
		<AbsoluteFill>
			<Backdrop seed={14} intensity={0.5} />
			<AbsoluteFill style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: unit * 10 }}>
				{rows.map((line, index) => {
					const delay = 4 + index * beat(9)
					const sweep = interpolate(frame - delay, [0, 26], [0, 1], { ...CLAMP, easing: EASE_OUT })
					const leftward = shape === 1 ? index % 2 === 0 : shape === 3
					const size = bandSize * (index === 1 ? 1 : 0.72)
					return (
						<div
							key={'mask-' + index}
							style={{
								position: 'relative',
								height: bandHeight,
								display: 'flex',
								alignItems: 'center',
								justifyContent: shape === 0 ? 'center' : leftward ? 'flex-end' : 'flex-start',
								paddingLeft: width * LAYOUT_INSET,
								paddingRight: width * LAYOUT_INSET,
								overflow: 'hidden',
							}}
						>
							<span
								style={{
									fontFamily: DISPLAY_FONT,
									fontWeight: DISPLAY_WEIGHT,
									fontSize: size,
									letterSpacing: trackingFor(size),
									color: index === 1 ? THEME.accent : THEME.ink,
									textTransform: TYPE_KEEPS_CASE ? 'none' : 'uppercase',
									clipPath: 'inset(0 ' + ((1 - sweep) * 100).toFixed(2) + '% 0 0)',
									whiteSpace: 'nowrap',
								}}
							>
								{line}
							</span>
							<div
								aria-hidden
								style={{
									position: 'absolute',
									top: 0,
									bottom: 0,
									left: 0,
									width: '100%',
									backgroundColor: index % 2 === 0 ? THEME.accent : THEME.accentAlt,
									transformOrigin: leftward ? 'right' : 'left',
									transform:
										'translateX(' + (sweep * (leftward ? -100 : 100)).toFixed(2) + '%) scaleX(' + Math.max(0.02, 1 - sweep * 0.35).toFixed(3) + ')',
									opacity: sweep < 1 ? 1 : 0,
								}}
							/>
						</div>
					)
				})}
			</AbsoluteFill>
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,

	'glitch-title': `
/**
 * Signal-loss title.
 *
 * The line is drawn three times in three channels which separate on a seeded,
 * frame-quantised jitter, then lock. Every displacement is derived from the
 * generation seed, so the corruption is identical on every render.
 */
const GlitchTitleScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const line = props.headline || motionLines(props, 1)[0]
	const lock = interpolate(frame, [0, props.frames * 0.55], [1, 0.06], CLAMP)
	const tick = Math.floor(frame / 2)
	const jitter = (channel: number) => (mrand('glitch-' + channel + '-' + tick) - 0.5) * unit * 34 * lock
	const size = fitLine(unit * (shape === 2 ? 92 : 120), line, width * 0.86)
	const slices = shape === 3 ? 7 : 5

	return (
		<AbsoluteFill style={{ backgroundColor: THEME.background }}>
			<Backdrop seed={15} intensity={0.4} />
			<AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
				<div style={{ position: 'relative', width: width * 0.9, textAlign: 'center' }}>
					{[THEME.accent, THEME.accentAlt, THEME.ink].map((color, channel) => (
						<span
							key={'glitch-' + channel}
							style={{
								position: channel === 2 ? 'relative' : 'absolute',
								inset: channel === 2 ? undefined : 0,
								display: 'block',
								fontFamily: DISPLAY_FONT,
								fontWeight: DISPLAY_WEIGHT,
								fontSize: size,
								lineHeight: 1.04,
								letterSpacing: trackingFor(size),
								color,
								textTransform: TYPE_KEEPS_CASE ? 'none' : 'uppercase',
								mixBlendMode: channel === 2 ? 'normal' : THEME.scheme === 'light' ? 'multiply' : 'screen',
								opacity: channel === 2 ? 1 : 0.6,
								transform: 'translate(' + jitter(channel).toFixed(2) + 'px, ' + (jitter(channel + 7) * 0.28).toFixed(2) + 'px)',
							}}
						>
							{line}
						</span>
					))}
					{new Array(slices).fill(0).map((_, index) => {
						const band = mrand('slice-' + index + '-' + Math.floor(frame / 5))
						if (band > 0.34 * lock + 0.02) return null
						return (
							<div
								key={'slice-' + index}
								aria-hidden
								style={{
									position: 'absolute',
									left: -width * 0.05,
									right: -width * 0.05,
									top: mrand('sy-' + index + '-' + Math.floor(frame / 5)) * size,
									height: Math.max(2, unit * (3 + index)),
									backgroundColor: withAlpha(THEME.accent, 0.6),
									transform: 'translateX(' + ((band - 0.17) * width * 0.3).toFixed(1) + 'px)',
								}}
							/>
						)
					})}
				</div>
			</AbsoluteFill>
			<div style={{ position: 'absolute', left: width * LAYOUT_INSET, bottom: height * 0.1 }}>
				<MicroLabel text={props.caption || props.kicker} delay={26} />
			</div>
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,

	'neon-sign': `
/**
 * Tube lettering that warms up.
 *
 * The glow is layered text-shadow rather than a filter, so it survives every
 * export path identically, and the flicker is a seeded square wave that settles
 * into a steady burn.
 */
const NeonSignScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const rows = motionLines(props, shape === 1 ? 3 : 2)
	const settle = interpolate(frame, [0, 46], [0, 1], { ...CLAMP, easing: EASE_OUT })
	const tick = Math.floor(frame / 3)
	const flicker = frame < 40 ? (mrand('neon-' + tick) > 0.36 ? 1 : 0.28) : 1
	const glow = (color: string, power: number) =>
		'0 0 ' + (unit * 6 * power).toFixed(1) + 'px ' + withAlpha(color, 0.9) +
		', 0 0 ' + (unit * 20 * power).toFixed(1) + 'px ' + withAlpha(color, 0.6) +
		', 0 0 ' + (unit * 52 * power).toFixed(1) + 'px ' + withAlpha(color, 0.34)

	return (
		<AbsoluteFill style={{ backgroundColor: motionStage(0.35) }}>
			<Backdrop seed={16} intensity={0.35} />
			<AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
				<div
					style={{
						position: 'relative',
						padding: unit * 54,
						border: Math.max(2, unit * 3) + 'px solid ' + withAlpha(THEME.accentAlt, 0.34 * settle),
						borderRadius: cornerRadius(unit, 1.6),
						boxShadow: 'inset ' + glow(THEME.accentAlt, 0.5 * settle),
						display: 'flex',
						flexDirection: 'column',
						alignItems: 'center',
						gap: unit * 12,
					}}
				>
					{rows.map((line, index) => {
						const color = index % 2 === 0 ? THEME.accent : THEME.accentAlt
						const size = fitStack(unit * (index === 0 ? 104 : 62), rows, width * 0.68, height * 0.52)
						return (
							<span
								key={'neon-' + index}
								style={{
									fontFamily: DISPLAY_FONT,
									fontWeight: Math.max(400, DISPLAY_WEIGHT - 120),
									fontSize: size,
									lineHeight: 1.08,
									letterSpacing: trackingFor(size) + unit * 2,
									color: THEME.scheme === 'light' ? color : '#fdfdff',
									textShadow: glow(color, flicker * settle),
									opacity: (0.3 + 0.7 * settle) * flicker,
									textTransform: TYPE_KEEPS_CASE ? 'none' : 'uppercase',
									textAlign: 'center',
									maxWidth: width * 0.72,
								}}
							>
								{line}
							</span>
						)
					})}
					{shape !== 3 ? (
						<div
							aria-hidden
							style={{
								width: unit * 160,
								height: Math.max(2, unit * 3),
								borderRadius: unit * 4,
								backgroundColor: THEME.accent,
								boxShadow: glow(THEME.accent, settle),
								transform: 'scaleX(' + settle.toFixed(3) + ')',
							}}
						/>
					) : null}
				</div>
			</AbsoluteFill>
			<div style={{ position: 'absolute', left: 0, right: 0, bottom: height * 0.09, display: 'flex', justifyContent: 'center' }}>
				<MicroLabel text={props.caption} delay={38} />
			</div>
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,

	'stamp-impact': `
/**
 * Words that land.
 *
 * Each phrase arrives oversized and overshoots to rest while a shockwave ring
 * leaves the point of impact and the whole frame kicks a pixel or two. Reads as
 * force, which no fade can do.
 */
const StampImpactScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height, fps } = useVideoConfig()
	const shape = props.variant % 4
	const hits = motionLines(props, 3)
	const step = Math.max(12, (props.frames * 0.62) / hits.length)
	const lastHit = Math.floor(Math.min(hits.length - 1, frame / step))
	const sinceHit = frame - lastHit * step
	const kick = sinceHit < 6 ? Math.sin(sinceHit * 1.6) * unit * (6 - sinceHit) * 0.9 : 0

	return (
		<AbsoluteFill>
			<Backdrop seed={17} intensity={0.6} />
			<AbsoluteFill
				style={{
					display: 'flex',
					flexDirection: 'column',
					alignItems: 'center',
					justifyContent: 'center',
					gap: unit * 8,
					transform: 'translate(' + kick.toFixed(2) + 'px, ' + (kick * -0.6).toFixed(2) + 'px)',
				}}
			>
				{hits.map((line, index) => {
					const delay = index * step
					const land = spring({ frame: frame - delay, fps, config: { damping: 11, mass: 0.7, stiffness: 220 } })
					if (frame < delay) return null
					const size = fitStack(unit * (shape === 2 ? 84 : 112), hits, width * 0.84, height * 0.66)
					const ringAge = frame - delay
					return (
						<div key={'stamp-' + index} style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
							{ringAge < 30 ? (
								<div
									aria-hidden
									style={{
										position: 'absolute',
										width: unit * 120,
										height: unit * 120,
										borderRadius: unit * 400,
										border: Math.max(2, unit * 4) + 'px solid ' + withAlpha(THEME.accent, Math.max(0, 0.6 - ringAge / 30)),
										transform: 'scale(' + (0.4 + ringAge * 0.22).toFixed(2) + ')',
									}}
								/>
							) : null}
							<span
								style={{
									fontFamily: DISPLAY_FONT,
									fontWeight: DISPLAY_WEIGHT,
									fontSize: size,
									lineHeight: 1,
									letterSpacing: trackingFor(size) - unit,
									color: index === 1 ? THEME.accent : THEME.ink,
									textTransform: TYPE_KEEPS_CASE ? 'none' : 'uppercase',
									transform: 'scale(' + (2.1 - land * 1.1).toFixed(3) + ') rotate(' + (shape === 3 ? (index % 2 === 0 ? -2 : 2) : 0) + 'deg)',
									opacity: Math.min(1, land * 2.4),
									maxWidth: width * 0.86,
									textAlign: 'center',
								}}
							>
								{line}
							</span>
						</div>
					)
				})}
			</AbsoluteFill>
			<div style={{ position: 'absolute', left: 0, right: 0, bottom: height * 0.09, display: 'flex', justifyContent: 'center' }}>
				<MicroLabel text={props.caption} delay={hits.length * step} />
			</div>
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,

	'marquee-bands': `
/**
 * Counter-running text bands.
 *
 * Four to six strips cross the frame at different speeds and directions. The
 * copy repeats inside a strip on purpose - the band is a texture - while the
 * headline sits on top in a solid plate so it stays readable.
 */
const MarqueeBandsScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const count = shape === 1 ? 6 : shape === 3 ? 4 : 5
	const rows = motionLines(props, count)
	const tilt = shape === 2 ? -8 : shape === 0 ? 6 : 0

	return (
		<AbsoluteFill style={{ overflow: 'hidden' }}>
			<Backdrop seed={18} intensity={0.4} />
			<AbsoluteFill
				style={{
					display: 'flex',
					flexDirection: 'column',
					justifyContent: 'center',
					gap: unit * 10,
					transform: 'rotate(' + tilt + 'deg) scale(1.25)',
				}}
			>
				{rows.map((line, index) => {
					const reverse = index % 2 === 1
					const speed = unit * (2.4 + (index % 3) * 1.1)
					const offset = ((frame * speed) % (width * 0.6)) * (reverse ? 1 : -1)
					const solid = index % 3 === 1
					const size = unit * (shape === 1 ? 46 : 60)
					return (
						<div
							key={'band-' + index}
							style={{
								display: 'flex',
								alignItems: 'center',
								whiteSpace: 'nowrap',
								backgroundColor: solid ? THEME.accent : 'transparent',
								borderTop: solid ? undefined : Math.max(1, unit) + 'px solid ' + withAlpha(THEME.ink, 0.12),
								borderBottom: solid ? undefined : Math.max(1, unit) + 'px solid ' + withAlpha(THEME.ink, 0.12),
								paddingTop: unit * 6,
								paddingBottom: unit * 6,
								transform: 'translateX(' + offset.toFixed(1) + 'px)',
								opacity: interpolate(frame, [index * 4, 18 + index * 4], [0, 1], CLAMP),
							}}
						>
							{new Array(6).fill(0).map((__, copy) => (
								<span
									key={'band-' + index + '-' + copy}
									style={{
										fontFamily: DISPLAY_FONT,
										fontWeight: solid ? DISPLAY_WEIGHT : Math.max(300, DISPLAY_WEIGHT - 300),
										fontSize: size,
										letterSpacing: trackingFor(size) + unit * 2,
										color: solid ? THEME.background : withAlpha(THEME.ink, 0.5),
										paddingLeft: unit * 26,
										paddingRight: unit * 26,
										textTransform: TYPE_KEEPS_CASE ? 'none' : 'uppercase',
									}}
								>
									{line}
								</span>
							))}
						</div>
					)
				})}
			</AbsoluteFill>
			<AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
				<MotionPanel delay={10} pad={unit * 34} tone={shape === 3 ? 'accent' : 'surface'}>
					<MotionCaption headline={props.headline} caption={props.caption} delay={14} size={unit * 64} />
				</MotionPanel>
			</AbsoluteFill>
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,

	'ticker-strip': `
/**
 * Broadcast lower third.
 *
 * A labelled rail, a scrolling detail line and a clock block. The furniture is
 * doing the storytelling, which is why it never reads as a title card.
 */
const TickerStripScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const rows = motionLines(props, 4)
	const open = interpolate(frame, [0, 22], [0, 1], { ...CLAMP, easing: EASE_OUT })
	const scroll = (frame * unit * 2.2) % (width * 0.9)
	const barTop = shape === 1 ? height * 0.12 : height * 0.66

	return (
		<AbsoluteFill>
			<Backdrop seed={19} intensity={0.7} />
			<AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', paddingBottom: height * 0.2 }}>
				<MotionCaption kicker={props.kicker} headline={props.headline} delay={6} size={unit * 72} />
			</AbsoluteFill>
			<div
				style={{
					position: 'absolute',
					left: 0,
					right: 0,
					top: barTop,
					transform: 'translateY(' + ((1 - open) * height * 0.2).toFixed(1) + 'px)',
					opacity: open,
				}}
			>
				<div style={{ display: 'flex', alignItems: 'stretch', height: unit * 74 }}>
					<div
						style={{
							backgroundColor: THEME.accent,
							color: THEME.background,
							display: 'flex',
							alignItems: 'center',
							paddingLeft: unit * 30,
							paddingRight: unit * 30,
							fontFamily: DISPLAY_FONT,
							fontWeight: DISPLAY_WEIGHT,
							fontSize: unit * 26,
							letterSpacing: unit * 3,
							textTransform: 'uppercase',
						}}
					>
						{(props.kicker || rows[0]).slice(0, 16)}
					</div>
					<div style={{ flex: 1, backgroundColor: withAlpha(THEME.surface, 0.94), overflow: 'hidden', display: 'flex', alignItems: 'center' }}>
						<div style={{ display: 'flex', whiteSpace: 'nowrap', transform: 'translateX(' + (-scroll).toFixed(1) + 'px)' }}>
							{rows.concat(rows).map((line, index) => (
								<span
									key={'tick-' + index}
									style={{
										fontFamily: TEXT_FONT,
										fontWeight: safeTextWeight(520),
										fontSize: unit * 27,
										color: THEME.ink,
										paddingLeft: unit * 24,
										paddingRight: unit * 24,
										borderRight: Math.max(1, unit) + 'px solid ' + withAlpha(THEME.ink, 0.16),
									}}
								>
									{line}
								</span>
							))}
						</div>
					</div>
					{shape !== 2 ? (
						<div
							style={{
								backgroundColor: withAlpha(THEME.ink, 0.9),
								color: THEME.background,
								display: 'flex',
								alignItems: 'center',
								paddingLeft: unit * 22,
								paddingRight: unit * 22,
								fontFamily: DISPLAY_FONT,
								fontWeight: DISPLAY_WEIGHT,
								fontSize: unit * 26,
								letterSpacing: unit * 2,
							}}
						>
							{String(Math.floor(frame / 30)).padStart(2, '0') + ':' + String(frame % 30).padStart(2, '0')}
						</div>
					) : null}
				</div>
				<div style={{ height: Math.max(2, unit * 5), backgroundColor: THEME.accentAlt, transformOrigin: 'left', transform: 'scaleX(' + (frame / props.frames).toFixed(3) + ')' }} />
			</div>
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,

	'letter-grid': `
/**
 * A field of letters that resolves into a word.
 *
 * The grid is filled with the brief's own characters; the ones that spell the
 * subject light up in sequence and everything else dims away. Reads as a
 * search finding its answer.
 */
const LetterGridScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const target = (words(props.headline)[0] || motionLines(props, 1)[0] || 'STUDIO').slice(0, 10).toUpperCase()
	const columns = shape === 1 ? 14 : shape === 3 ? 10 : 12
	const rowCount = shape === 3 ? 6 : 7
	const alphabet = (props.headline + props.caption + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ').toUpperCase().replace(/[^A-Z]/g, '')
	const highlightRow = Math.floor(rowCount / 2)
	const startColumn = Math.max(0, Math.floor((columns - target.length) / 2))
	const cell = Math.min(width * 0.86 / columns, height * 0.7 / rowCount)

	return (
		<AbsoluteFill>
			<Backdrop seed={20} intensity={0.4} />
			<AbsoluteFill style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: unit * 26 }}>
				<div style={{ display: 'grid', gridTemplateColumns: 'repeat(' + columns + ', ' + cell + 'px)' }}>
					{new Array(columns * rowCount).fill(0).map((_, index) => {
						const row = Math.floor(index / columns)
						const column = index % columns
						const slot = column - startColumn
						const isTarget = row === highlightRow && slot >= 0 && slot < target.length
						const reveal = interpolate(frame - (isTarget ? 20 + slot * beat(4) : 0), [0, 14], [0, 1], CLAMP)
						const churn = alphabet[(index * 7 + Math.floor(frame / 4) * (isTarget ? 0 : 3)) % alphabet.length] || 'A'
						const glyph = isTarget && reveal > 0.5 ? target[slot] : churn
						return (
							<div
								key={'lg-' + index}
								style={{
									width: cell,
									height: cell,
									display: 'flex',
									alignItems: 'center',
									justifyContent: 'center',
									fontFamily: DISPLAY_FONT,
									fontWeight: isTarget ? DISPLAY_WEIGHT : 400,
									fontSize: cell * 0.52,
									color: isTarget && reveal > 0.5 ? THEME.background : withAlpha(THEME.ink, 0.28),
									backgroundColor: isTarget && reveal > 0.5 ? THEME.accent : 'transparent',
									border: Math.max(1, unit * 0.8) + 'px solid ' + withAlpha(THEME.ink, 0.07),
									transform: 'scale(' + (isTarget ? 0.85 + reveal * 0.15 : 1).toFixed(3) + ')',
								}}
							>
								{glyph}
							</div>
						)
					})}
				</div>
				<MotionCaption caption={props.caption || props.kicker} delay={30 + target.length * 4} />
			</AbsoluteFill>
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,
} as const
