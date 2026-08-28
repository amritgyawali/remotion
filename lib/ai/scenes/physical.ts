/**
 * Physical motion scenes.
 *
 * Ten pieces that borrow their timing from the world rather than from an easing
 * curve: things fall, swing, topple, stretch, settle, snap and break. A viewer
 * knows what weight looks like without being told, so a card that arrives on a
 * bounce reads as real in a way that the same card fading in never does.
 *
 * Emitted verbatim into the generated TSX: no backticks, no dollar-braces.
 */

export const PHYSICAL_SCENES = {
	'gravity-drop': `
/**
 * Words falling and landing.
 *
 * Each word is released on its own beat, accelerates, hits the baseline and
 * squashes - then overshoots back up a little before settling, which is the
 * detail that separates weight from a translate. The floor is drawn so the
 * landing has something to land on.
 */
const GravityWord: React.FC<{ word: string; delay: number; index: number; shape: number; size: number }> = ({
	word,
	delay,
	index,
	shape,
	size,
}) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { height, fps } = useVideoConfig()
	const fall = spring({ frame: frame - delay, fps, config: { damping: 11, mass: 1.1, stiffness: 130 } })
	const drop = (1 - fall) * -height * 0.6
	// The squash is read off the overshoot, so it happens exactly on contact and
	// unwinds with the same spring rather than on a second timer.
	const impact = Math.max(0, fall - 1)
	const squash = 1 - Math.min(0.22, Math.abs(impact) * 2.6)

	return (
		<span
			style={{
				fontFamily: DISPLAY_FONT,
				fontWeight: DISPLAY_WEIGHT,
				fontSize: size,
				letterSpacing: trackingFor(size),
				lineHeight: 1,
				color: index % 3 === 1 ? THEME.accent : THEME.ink,
				textTransform: TYPE_KEEPS_CASE ? 'none' : 'uppercase',
				transformOrigin: 'center bottom',
				transform:
					'translateY(' + drop.toFixed(1) + 'px) scale(' + (shape === 1 ? 1 : 1 / squash).toFixed(3) + ', ' + squash.toFixed(3) + ')',
				opacity: fall > 0.001 ? 1 : 0,
				paddingLeft: unit * 6,
				paddingRight: unit * 6,
			}}
		>
			{word}
		</span>
	)
}

const GravityDropScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const line = motionLines(props, 1)[0] || props.headline
	const parts = words(line).slice(0, 8)
	const size = fitStack(unit * 96, [line], width * 0.86, height * 0.34)

	return (
		<AbsoluteFill style={{ overflow: 'hidden' }}>
			<Backdrop seed={70} intensity={0.45} />
			<AbsoluteFill
				style={{
					display: 'flex',
					flexDirection: 'row',
					flexWrap: 'wrap',
					alignItems: 'flex-end',
					justifyContent: 'center',
					alignContent: 'center',
					paddingBottom: height * 0.24,
					paddingLeft: width * LAYOUT_INSET,
					paddingRight: width * LAYOUT_INSET,
					rowGap: unit * 8,
				}}
			>
				{parts.map((word, index) => (
					<GravityWord
						key={'gravity-' + index}
						word={word}
						delay={8 + index * beat(shape === 2 ? 4 : 6)}
						index={index}
						shape={shape}
						size={size}
					/>
				))}
			</AbsoluteFill>
			<div
				aria-hidden
				style={{
					position: 'absolute',
					left: width * LAYOUT_INSET,
					right: width * LAYOUT_INSET,
					bottom: height * 0.24 - unit * 2,
					height: Math.max(2, unit * 3),
					backgroundColor: withAlpha(THEME.ink, 0.32),
					transformOrigin: 'center',
					transform: 'scaleX(' + interpolate(frame, [0, 18], [0, 1], { ...CLAMP, easing: EASE_OUT }).toFixed(3) + ')',
				}}
			/>
			<div style={{ position: 'absolute', left: 0, right: 0, bottom: height * 0.12, display: 'flex', justifyContent: 'center' }}>
				<MicroLabel text={props.caption || props.kicker} delay={parts.length * 6 + 16} />
			</div>
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,

	'pendulum-swing': `
/**
 * Labels hanging from a bar.
 *
 * Each plate swings on its own length, and a longer pendulum swings slower -
 * that relationship is what makes the row read as hung rather than as animated,
 * so the period is derived from the cord length instead of being picked.
 */
const PendulumSwingScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const plates = motionItems(props, shape === 1 ? 5 : 4)
	const bar = height * 0.2
	const plateSize = fitBlock(
		unit * 28,
		plates.reduce((most, plate) => (plate.title.length > most.length ? plate.title : most), ''),
		width * 0.72 / plates.length - unit * 30,
		unit * 120,
	)

	return (
		<AbsoluteFill style={{ overflow: 'hidden' }}>
			<Backdrop seed={71} intensity={0.45} />
			<div
				aria-hidden
				style={{
					position: 'absolute',
					left: width * 0.08,
					right: width * 0.08,
					top: bar,
					height: Math.max(3, unit * 5),
					borderRadius: unit * 6,
					backgroundColor: withAlpha(THEME.ink, 0.7),
				}}
			/>
			{plates.map((plate, index) => {
				const cord = height * (0.22 + ((index * 7) % 5) * 0.045)
				const period = 34 + cord / (unit * 9)
				const release = 10 + index * beat(6)
				const decay = Math.max(0.12, interpolate(frame - release, [0, 150], [1, 0.16], CLAMP))
				const angle = Math.sin((frame - release) / period) * (shape === 2 ? 22 : 14) * decay
				const born = interpolate(frame - release, [0, 12], [0, 1], { ...CLAMP, easing: EASE_OUT })
				const left = width * 0.12 + ((width * 0.76) / plates.length) * (index + 0.5)
				return (
					<div
						key={'pend-' + index}
						style={{
							position: 'absolute',
							left,
							top: bar,
							transformOrigin: 'top center',
							transform: 'rotate(' + angle.toFixed(2) + 'deg)',
							opacity: born,
						}}
					>
						<div
							aria-hidden
							style={{
								width: Math.max(1, unit * 1.6),
								height: cord,
								marginLeft: -unit * 0.8,
								backgroundColor: withAlpha(THEME.ink, 0.4),
							}}
						/>
						<div
							style={{
								transform: 'translateX(-50%)',
								padding: unit * 18,
								paddingLeft: unit * 22,
								paddingRight: unit * 22,
								maxWidth: (width * 0.76) / plates.length - unit * 16,
								borderRadius: cornerRadius(unit),
								backgroundColor: index === 0 ? THEME.accent : withAlpha(THEME.surface, 0.94),
								border: Math.max(1, unit * 1.4) + 'px solid ' + withAlpha(THEME.ink, 0.18),
								boxShadow: '0 ' + unit * 12 + 'px ' + unit * 26 + 'px ' + withAlpha('#000000', 0.28),
								textAlign: 'center',
							}}
						>
							<span
								style={{
									fontFamily: TEXT_FONT,
									fontWeight: safeTextWeight(600),
									fontSize: plateSize,
									lineHeight: 1.24,
									color: index === 0 ? THEME.background : THEME.ink,
								}}
							>
								{plate.title}
							</span>
						</div>
					</div>
				)
			})}
			<AbsoluteFill style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', paddingBottom: height * 0.1 }}>
				<MotionCaption kicker={props.kicker} headline={props.headline} caption={props.caption} delay={26} size={unit * 52} />
			</AbsoluteFill>
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,

	'domino-fall': `
/**
 * A run of tiles going over.
 *
 * The chain is the argument: each tile is only pushed once the one before it
 * has passed the tipping point, so the delay between them is a consequence of
 * the fall rather than a number chosen per tile. The last one carries the
 * payoff and stays standing a beat longer.
 */
const DominoFallScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const tiles = motionLines(props, shape === 1 ? 6 : 5)
	const step = Math.max(7, beat(9))
	const tileWidth = Math.min(unit * 92, (width * 0.76) / tiles.length)
	const tileHeight = Math.min(height * 0.34, tileWidth * 2.4)
	const labelSize = fitBlock(
		unit * 22,
		tiles.reduce((most, tile) => (tile.length > most.length ? tile : most), ''),
		tileHeight - unit * 24,
		tileWidth - unit * 12,
	)

	return (
		<AbsoluteFill style={{ overflow: 'hidden' }}>
			<Backdrop seed={72} intensity={0.45} />
			<AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
				<div style={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-end', gap: tileWidth * 0.5 }}>
					{tiles.map((tile, index) => {
						const push = interpolate(frame - (16 + index * step), [0, 14], [0, 1], { ...CLAMP, easing: EASE_OUT })
						const last = index === tiles.length - 1
						const lean = (last ? Math.min(push, 0.42) : push) * 84
						return (
							<div
								key={'domino-' + index}
								style={{
									width: tileWidth,
									height: tileHeight,
									transformOrigin: 'bottom right',
									transform: 'rotate(' + lean.toFixed(2) + 'deg)',
									borderRadius: cornerRadius(unit, 0.5),
									backgroundColor: last ? THEME.accent : withAlpha(THEME.surface, 0.95),
									border: Math.max(1, unit * 1.6) + 'px solid ' + withAlpha(THEME.ink, 0.24),
									boxShadow: '0 ' + unit * 10 + 'px ' + unit * 24 + 'px ' + withAlpha('#000000', 0.3),
									display: 'flex',
									alignItems: 'center',
									justifyContent: 'center',
									opacity: interpolate(frame - index * 3, [0, 12], [0, 1], CLAMP),
								}}
							>
								<span
									style={{
										fontFamily: TEXT_FONT,
										fontWeight: safeTextWeight(620),
										fontSize: labelSize,
										lineHeight: 1.2,
										color: last ? THEME.background : THEME.ink,
										textAlign: 'center',
										// Set on its side, the way a domino face reads when the run
										// is seen from the front.
										transform: 'rotate(-90deg)',
										whiteSpace: 'nowrap',
									}}
								>
									{tile}
								</span>
							</div>
						)
					})}
				</div>
			</AbsoluteFill>
			<div
				aria-hidden
				style={{
					position: 'absolute',
					left: width * 0.06,
					right: width * 0.06,
					top: height * 0.5 + tileHeight / 2,
					height: Math.max(2, unit * 3),
					backgroundColor: withAlpha(THEME.ink, 0.3),
				}}
			/>
			<div style={{ position: 'absolute', left: width * LAYOUT_INSET, top: height * 0.12 }}>
				<MotionCaption kicker={props.kicker} headline={props.headline} delay={2} align="flex-start" size={unit * 50} />
			</div>
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,

	'elastic-rope': `
/**
 * A line pulled taut between two ideas.
 *
 * The rope sags, is drawn tight, overshoots and rings down - and the two ends
 * are the two labels, so the tension is literally between them. Reads as
 * cause and effect, or as a deal being closed.
 */
const ElasticRopeScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height, fps } = useVideoConfig()
	const shape = props.variant % 4
	const ends = motionLines(props, 2)
	const pull = spring({ frame: frame - 14, fps, config: { damping: 9, mass: 1, stiffness: 90 } })
	const sag = (1 - pull) * height * 0.16
	const mid = height * 0.5 + sag
	const anchorY = height * 0.5
	const left = width * 0.14
	const right = width * 0.86
	const endSize = fitStack(unit * 46, ends, width * 0.26, height * 0.24)

	return (
		<AbsoluteFill style={{ overflow: 'hidden' }}>
			<Backdrop seed={73} intensity={0.45} />
			<svg width={width} height={height} style={{ position: 'absolute', inset: 0 }} aria-hidden>
				<path
					d={'M ' + left + ' ' + anchorY + ' Q ' + width / 2 + ' ' + (anchorY + sag * 2) + ' ' + right + ' ' + anchorY}
					fill="none"
					stroke={withAlpha(THEME.accent, 0.85)}
					strokeWidth={Math.max(3, unit * (shape === 1 ? 4 : 7))}
					strokeLinecap="round"
				/>
			</svg>
			{[0, 1].map((side) => (
				<div
					key={'end-' + side}
					style={{
						position: 'absolute',
						left: side === 0 ? left : right,
						top: anchorY,
						transform: 'translate(-50%, -50%)',
						display: 'flex',
						flexDirection: 'column',
						alignItems: 'center',
						gap: unit * 12,
						opacity: interpolate(frame - side * 6, [0, 16], [0, 1], CLAMP),
					}}
				>
					<div
						aria-hidden
						style={{
							width: unit * 34,
							height: unit * 34,
							borderRadius: shape === 3 ? cornerRadius(unit, 0.4) : '50%',
							backgroundColor: side === 0 ? THEME.accent : THEME.accentAlt,
							boxShadow: '0 0 ' + unit * 22 + 'px ' + withAlpha(side === 0 ? THEME.accent : THEME.accentAlt, 0.5),
						}}
					/>
					<span
						style={{
							fontFamily: DISPLAY_FONT,
							fontWeight: DISPLAY_WEIGHT,
							fontSize: endSize,
							letterSpacing: trackingFor(endSize),
							lineHeight: 1.08,
							textAlign: 'center',
							maxWidth: width * 0.26,
							color: THEME.ink,
							textTransform: TYPE_KEEPS_CASE ? 'none' : 'uppercase',
						}}
					>
						{ends[side] || ends[0]}
					</span>
				</div>
			))}
			<div
				style={{
					position: 'absolute',
					left: 0,
					right: 0,
					top: mid + unit * 30,
					display: 'flex',
					justifyContent: 'center',
					opacity: interpolate(frame, [34, 52], [0, 1], CLAMP),
				}}
			>
				<MicroLabel text={props.caption || props.kicker || props.headline} delay={34} />
			</div>
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,

	'sand-settle': `
/**
 * A pile forming out of falling grains.
 *
 * Every grain is seeded a column and a resting depth, so the heap that forms is
 * different in every film but always a heap. The copy is cut into the pile once
 * it has stopped moving, which is what makes the accumulation feel like it was
 * building towards something.
 */
const SandSettleScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const grains = shape === 1 ? 190 : 130
	const floor = height * 0.78
	const line = motionLines(props, 1)[0] || props.headline
	const size = fitStack(unit * 74, [line], width * 0.7, height * 0.24)

	return (
		<AbsoluteFill style={{ overflow: 'hidden' }}>
			<Backdrop seed={74} intensity={0.4} />
			{new Array(grains).fill(0).map((_, index) => {
				const lane = mrand('sand-x-' + index)
				// A grain nearer the middle of the frame rests higher, which is what
				// gives the heap its slope without simulating anything.
				const centred = 1 - Math.abs(lane - 0.5) * 2
				const rest = floor - centred * centred * height * 0.22 - mrand('sand-d-' + index) * unit * 14
				const release = mrand('sand-t-' + index) * Math.max(30, props.frames * 0.55)
				const drop = interpolate(frame - release, [0, 26], [-height * 0.5, 0], { ...CLAMP, easing: EASE_OUT })
				const dot = unit * (3 + mrand('sand-s-' + index) * 6)
				if (frame < release) return null
				return (
					<div
						key={'grain-' + index}
						aria-hidden
						style={{
							position: 'absolute',
							left: lane * width,
							top: rest + drop,
							width: dot,
							height: dot,
							borderRadius: '50%',
							backgroundColor: withAlpha(index % 7 === 0 ? THEME.accent : THEME.ink, LIGHT_STOCK ? 0.5 : 0.42),
						}}
					/>
				)
			})}
			<AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', paddingBottom: height * 0.18 }}>
				<span
					style={{
						fontFamily: DISPLAY_FONT,
						fontWeight: DISPLAY_WEIGHT,
						fontSize: size,
						letterSpacing: trackingFor(size),
						lineHeight: 1.04,
						textAlign: 'center',
						maxWidth: width * 0.7,
						color: THEME.ink,
						textTransform: TYPE_KEEPS_CASE ? 'none' : 'uppercase',
						opacity: interpolate(frame, [Math.max(30, props.frames * 0.4), Math.max(48, props.frames * 0.55)], [0, 1], CLAMP),
					}}
				>
					{line}
				</span>
			</AbsoluteFill>
			<div style={{ position: 'absolute', left: 0, right: 0, bottom: height * 0.08, display: 'flex', justifyContent: 'center' }}>
				<MicroLabel text={props.caption || props.kicker} delay={Math.round(props.frames * 0.6)} />
			</div>
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,

	'magnet-snap': `
/**
 * Scatter becoming order.
 *
 * The chips start where the seed threw them and are pulled onto a grid, each
 * one arriving slightly before or after its neighbours so the lattice assembles
 * rather than appears. The point of the piece is the instant the mess resolves.
 */
const MagnetSnapScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const columns = shape === 1 ? 4 : 3
	const chips = motionItems(props, columns * 2)
	const cellWidth = (width * (1 - LAYOUT_INSET * 2) - unit * 16 * (columns - 1)) / columns
	const cellHeight = height * 0.17
	const chipSize = fitBlock(
		unit * 24,
		chips.reduce((most, chip) => (chip.title.length > most.length ? chip.title : most), ''),
		cellWidth - unit * 34,
		cellHeight - unit * 34,
	)

	return (
		<AbsoluteFill style={{ overflow: 'hidden' }}>
			<Backdrop seed={75} intensity={0.45} />
			<AbsoluteFill style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: unit * 26, padding: width * LAYOUT_INSET }}>
				<MotionCaption kicker={props.kicker} headline={props.headline} delay={2} size={unit * 50} />
				<div style={{ display: 'grid', gridTemplateColumns: 'repeat(' + columns + ', 1fr)', gap: unit * 16, width: '100%' }}>
					{chips.map((chip, index) => {
						const snap = interpolate(frame - (14 + mpick('snap-' + index, 9) * beat(3)), [0, 22], [0, 1], { ...CLAMP, easing: EASE_OUT })
						const away = 1 - snap
						const throwX = (mrand('mag-x-' + index) - 0.5) * width * 1.1 * away
						const throwY = (mrand('mag-y-' + index) - 0.5) * height * 0.9 * away
						const spin = (mrand('mag-r-' + index) - 0.5) * 180 * away
						return (
							<div
								key={'chip-' + index}
								style={{
									height: cellHeight,
									borderRadius: cornerRadius(unit),
									backgroundColor: index % 4 === 0 ? THEME.accent : withAlpha(THEME.surface, 0.92),
									border: Math.max(1, unit * 1.4) + 'px solid ' + withAlpha(THEME.ink, 0.16),
									display: 'flex',
									flexDirection: 'column',
									alignItems: 'flex-start',
									justifyContent: 'flex-end',
									gap: unit * 8,
									padding: unit * 17,
									transform:
										'translate(' + throwX.toFixed(1) + 'px, ' + throwY.toFixed(1) + 'px) rotate(' + spin.toFixed(2) + 'deg)',
									opacity: Math.min(1, snap * 3),
									boxShadow: snap > 0.98 ? '0 ' + unit * 10 + 'px ' + unit * 22 + 'px ' + withAlpha('#000000', 0.26) : undefined,
								}}
							>
								<VectorIcon name={chip.icon} size={unit * 26} color={index % 4 === 0 ? THEME.background : THEME.accent} strokeWidth={2} />
								<span
									style={{
										fontFamily: TEXT_FONT,
										fontWeight: safeTextWeight(580),
										fontSize: chipSize,
										lineHeight: 1.24,
										color: index % 4 === 0 ? THEME.background : THEME.ink,
									}}
								>
									{chip.title}
								</span>
							</div>
						)
					})}
				</div>
			</AbsoluteFill>
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,

	'spring-board': `
/**
 * Panels launched off a board.
 *
 * A plank flexes under each panel and throws it up into place; the plank keeps
 * ringing after the last one has gone, which is the detail that sells the
 * stored energy. Ordered, so it suits a procedure as well as a list.
 */
const SpringBoardScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height, fps } = useVideoConfig()
	const shape = props.variant % 4
	const cards = motionItems(props, shape === 1 ? 4 : 3)
	const board = height * 0.8
	const gap = unit * 18
	const cardWidth = (width * (1 - LAYOUT_INSET * 2) - gap * (cards.length - 1)) / cards.length
	const flex = cards.reduce((most, _card, index) => {
		const launch = spring({ frame: frame - (12 + index * beat(10)), fps, config: { damping: 10, mass: 0.9, stiffness: 140 } })
		const load = Math.max(0, 1 - Math.abs(launch - 0.15) * 5)
		return Math.max(most, load)
	}, 0)
	const titleSize = fitBlock(
		unit * 30,
		cards.reduce((most, card) => (card.title.length > most.length ? card.title : most), ''),
		cardWidth - unit * 52,
		height * 0.12,
	)

	return (
		<AbsoluteFill style={{ overflow: 'hidden' }}>
			<Backdrop seed={76} intensity={0.45} />
			<AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', paddingBottom: height * 0.14 }}>
				<div style={{ display: 'flex', alignItems: 'flex-end', gap, width: width * (1 - LAYOUT_INSET * 2) }}>
					{cards.map((card, index) => {
						const launch = spring({ frame: frame - (12 + index * beat(10)), fps, config: { damping: 10, mass: 0.9, stiffness: 140 } })
						return (
							<div
								key={'launch-' + index}
								style={{
									flex: 1,
									transform: 'translateY(' + ((1 - launch) * height * 0.5).toFixed(1) + 'px)',
									opacity: Math.min(1, launch * 4),
								}}
							>
								<MotionPanel delay={0} pad={unit * 26} tone={index === 0 ? 'accent' : 'surface'}>
									<div style={{ display: 'flex', flexDirection: 'column', gap: unit * 12, minHeight: height * 0.2 }}>
										<VectorIcon name={card.icon} size={unit * 38} color={THEME.accent} strokeWidth={1.9} />
										<span
											style={{
												fontFamily: DISPLAY_FONT,
												fontWeight: DISPLAY_WEIGHT,
												fontSize: titleSize,
												lineHeight: 1.1,
												letterSpacing: trackingFor(titleSize),
												color: THEME.ink,
											}}
										>
											{card.title}
										</span>
										{card.detail ? (
											<span
												style={{
													fontFamily: TEXT_FONT,
													fontSize: fitBlock(unit * 22, card.detail, cardWidth - unit * 52, height * 0.1),
													lineHeight: 1.4,
													color: THEME.muted,
												}}
											>
												{card.detail}
											</span>
										) : null}
									</div>
								</MotionPanel>
							</div>
						)
					})}
				</div>
			</AbsoluteFill>
			<div
				aria-hidden
				style={{
					position: 'absolute',
					left: width * 0.1,
					right: width * 0.1,
					top: board,
					height: Math.max(4, unit * 8),
					borderRadius: unit * 8,
					backgroundColor: THEME.accentAlt,
					transformOrigin: 'center',
					transform: 'scaleY(' + (1 + flex * (shape === 2 ? 2.4 : 1.4)).toFixed(3) + ') translateY(' + (flex * unit * 10).toFixed(1) + 'px)',
				}}
			/>
			<div style={{ position: 'absolute', left: width * LAYOUT_INSET, top: height * 0.1 }}>
				<MotionCaption kicker={props.kicker} headline={props.headline} delay={2} align="flex-start" size={unit * 48} />
			</div>
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,

	'liquid-fill': `
/**
 * A vessel filling to a number.
 *
 * The level rises to the figure the brief supplied, with a surface that keeps
 * moving after the level has settled so the liquid stays liquid. Where there is
 * no figure the vessel fills to the weight of the copy instead, which is honest
 * rather than invented.
 */
const LiquidFillScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const stat = props.stats[0]
	const target = stat ? Math.min(1, Math.max(0.12, Math.abs(stat.value) / (stat.suffix === '%' ? 100 : Math.abs(stat.value) * 1.35))) : 0.68
	const rise = interpolate(frame, [10, Math.max(48, props.frames * 0.6)], [0, target], { ...CLAMP, easing: EASE_OUT })
	const vessel = { w: Math.min(width * 0.34, height * 0.4), h: Math.min(height * 0.56, width * 0.5) }
	const surface = Math.sin(frame / 16) * unit * 5
	const stacked = useStacked()

	return (
		<AbsoluteFill style={{ overflow: 'hidden' }}>
			<Backdrop seed={77} intensity={0.45} />
			<AbsoluteFill
				style={{
					display: 'flex',
					flexDirection: stacked ? 'column' : 'row',
					alignItems: 'center',
					justifyContent: 'center',
					gap: unit * 44,
					padding: width * LAYOUT_INSET,
				}}
			>
				<div
					style={{
						position: 'relative',
						width: vessel.w,
						height: vessel.h,
						flex: '0 0 auto',
						borderRadius: shape === 3 ? cornerRadius(unit, 1.4) : unit * 26,
						border: Math.max(3, unit * 5) + 'px solid ' + withAlpha(THEME.ink, 0.6),
						overflow: 'hidden',
						backgroundColor: withAlpha(THEME.surface, 0.3),
					}}
				>
					<div
						style={{
							position: 'absolute',
							left: -vessel.w * 0.1,
							right: -vessel.w * 0.1,
							bottom: -unit * 20,
							height: vessel.h * rise + unit * 20 + surface,
							backgroundColor: withAlpha(THEME.accent, 0.85),
							borderTopLeftRadius: '46% 24px',
							borderTopRightRadius: '54% 26px',
							transform: 'rotate(' + (Math.sin(frame / 30) * 1.2).toFixed(2) + 'deg)',
						}}
					/>
					<AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
						<span
							style={{
								fontFamily: DISPLAY_FONT,
								fontWeight: DISPLAY_WEIGHT,
								fontSize: fitLine(unit * 72, stat ? formatStat(stat, 1) : props.kicker || '', vessel.w * 0.86),
								color: rise > 0.5 ? THEME.background : THEME.ink,
								lineHeight: 1,
							}}
						>
							{stat ? formatStat(stat, rise / Math.max(0.001, target)) : props.kicker}
						</span>
					</AbsoluteFill>
				</div>
				<MotionCaption
					kicker={stat ? stat.label : props.kicker}
					headline={props.headline}
					caption={props.caption}
					delay={20}
					align={stacked ? 'center' : 'flex-start'}
					size={unit * 54}
				/>
			</AbsoluteFill>
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,

	'smoke-reveal': `
/**
 * Turbulence clearing off a line.
 *
 * Layers of soft blobs drift and dissipate at different rates, so the word
 * behind them surfaces unevenly rather than on one fade. The smoke keeps
 * moving after the reveal, which stops the frame from going dead.
 */
const SmokeRevealScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const puffs = shape === 1 ? 16 : 11
	const line = motionLines(props, 1)[0] || props.headline
	const size = fitStack(unit * 106, [line], width * 0.8, height * 0.36)
	const clear = interpolate(frame, [12, Math.max(52, props.frames * 0.6)], [1, 0], { ...CLAMP, easing: EASE_OUT })

	return (
		<AbsoluteFill style={{ overflow: 'hidden' }}>
			<Backdrop seed={78} intensity={0.5} />
			<AbsoluteFill style={{ backgroundColor: motionStage(0.24) }} />
			<AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: width * LAYOUT_INSET }}>
				<span
					style={{
						fontFamily: DISPLAY_FONT,
						fontWeight: DISPLAY_WEIGHT,
						fontSize: size,
						letterSpacing: trackingFor(size),
						lineHeight: 1.02,
						textAlign: 'center',
						maxWidth: width * 0.8,
						color: THEME.ink,
						textTransform: TYPE_KEEPS_CASE ? 'none' : 'uppercase',
						opacity: interpolate(clear, [0.4, 1], [1, 0], CLAMP),
					}}
				>
					{line}
				</span>
			</AbsoluteFill>
			{new Array(puffs).fill(0).map((_, index) => {
				const seedX = mrand('smoke-x-' + index)
				const seedY = mrand('smoke-y-' + index)
				const radius = Math.min(width, height) * (0.18 + mrand('smoke-r-' + index) * 0.3)
				const life = Math.max(0, clear - index * 0.02)
				const drift = frame * (0.3 + seedX * 0.6)
				return (
					<div
						key={'smoke-' + index}
						aria-hidden
						style={{
							position: 'absolute',
							left: seedX * width - radius / 2 + Math.sin(frame / 60 + index) * unit * 30,
							top: seedY * height - radius / 2 - drift * (shape === 2 ? 0.7 : 0.3),
							width: radius,
							height: radius,
							borderRadius: '50%',
							backgroundColor: withAlpha(index % 4 === 0 ? THEME.accentAlt : THEME.surface, 0.4 * life),
							filter: 'blur(' + unit * 34 + 'px)',
						}}
					/>
				)
			})}
			<div style={{ position: 'absolute', left: 0, right: 0, bottom: height * 0.1, display: 'flex', justifyContent: 'center' }}>
				<MicroLabel text={props.caption || props.kicker} delay={Math.round(props.frames * 0.5)} />
			</div>
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,

	'shatter-glass': `
/**
 * A plate breaking to let the line through.
 *
 * The shards are wedges of a seeded fan, and they leave along their own radius
 * with their own spin, so the break is never symmetrical. The crack lands on a
 * beat and the copy is already there behind it, which is what makes the plate
 * feel like it was covering something.
 */
const ShatterGlassScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height, fps } = useVideoConfig()
	const shape = props.variant % 4
	const shards = shape === 1 ? 16 : 11
	const line = motionLines(props, 1)[0] || props.headline
	const size = fitStack(unit * 112, [line], width * 0.78, height * 0.36)
	const hit = spring({ frame: frame - 16, fps, config: { damping: 200, mass: 1, stiffness: 60 } })
	const kick = frame > 16 && frame < 24 ? Math.sin((frame - 16) * 1.6) * unit * (24 - frame) : 0

	return (
		<AbsoluteFill style={{ overflow: 'hidden', transform: 'translate(' + kick.toFixed(2) + 'px, ' + (kick * -0.5).toFixed(2) + 'px)' }}>
			<Backdrop seed={79} intensity={0.5} />
			<AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: width * LAYOUT_INSET }}>
				<span
					style={{
						fontFamily: DISPLAY_FONT,
						fontWeight: DISPLAY_WEIGHT,
						fontSize: size,
						letterSpacing: trackingFor(size),
						lineHeight: 1.02,
						textAlign: 'center',
						maxWidth: width * 0.78,
						color: THEME.accent,
						textTransform: TYPE_KEEPS_CASE ? 'none' : 'uppercase',
						opacity: interpolate(frame, [14, 26], [0, 1], CLAMP),
						transform: 'scale(' + interpolate(frame, [14, 34], [1.14, 1], { ...CLAMP, easing: EASE_OUT }).toFixed(3) + ')',
					}}
				>
					{line}
				</span>
			</AbsoluteFill>
			{new Array(shards).fill(0).map((_, index) => {
				const angle = (index / shards) * Math.PI * 2 + mrand('shard-a-' + index) * 0.4
				const reach = hit * Math.min(width, height) * (0.5 + mrand('shard-d-' + index) * 0.8)
				const spin = (mrand('shard-r-' + index) - 0.5) * 220 * hit
				const span = Math.min(width, height) * (0.2 + mrand('shard-s-' + index) * 0.26)
				return (
					<div
						key={'shard-' + index}
						aria-hidden
						style={{
							position: 'absolute',
							left: width / 2 + Math.cos(angle) * reach - span / 2,
							top: height / 2 + Math.sin(angle) * reach - span / 2,
							width: span,
							height: span,
							backgroundColor: withAlpha(THEME.surface, 0.9 * (1 - hit * 0.7)),
							border: Math.max(1, unit) + 'px solid ' + withAlpha(THEME.ink, 0.2 * (1 - hit)),
							clipPath:
								'polygon(' + (20 + mrand('shard-p1-' + index) * 30).toFixed(0) + '% 0%, 100% ' +
								(24 + mrand('shard-p2-' + index) * 40).toFixed(0) + '%, ' +
								(40 + mrand('shard-p3-' + index) * 40).toFixed(0) + '% 100%, 0% ' +
								(30 + mrand('shard-p4-' + index) * 44).toFixed(0) + '%)',
							transform: 'rotate(' + spin.toFixed(2) + 'deg)',
							opacity: 1 - hit * 0.9,
						}}
					/>
				)
			})}
			<div style={{ position: 'absolute', left: 0, right: 0, bottom: height * 0.11, display: 'flex', justifyContent: 'center' }}>
				<MicroLabel text={props.caption || props.kicker} delay={34} />
			</div>
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,
} as const
