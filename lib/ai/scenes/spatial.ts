/**
 * Spatial motion scenes.
 *
 * Ten pieces built out of depth: corridors, rings, shafts, tunnels, nets,
 * flights, facades, horizons, orbits and stacks. Everything here is CSS
 * perspective rather than WebGL, so the pieces cost nothing to render and stay
 * available even when the film was not asked for in 3D.
 *
 * Emitted verbatim into the generated TSX: no backticks, no dollar-braces.
 */

export const SPATIAL_SCENES = {
	'corridor-fly': `
/**
 * Flying down a hall of panels.
 *
 * The camera moves at a constant rate and the panels are placed at fixed
 * depths, so each one grows, passes and is gone - which is what makes the run
 * feel like travel rather than like a sequence of cards. Panels recycle behind
 * the camera, so the corridor never runs out.
 */
const CorridorFlyScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const panels = motionLines(props, shape === 1 ? 6 : 4)
	const spacing = 900
	const speed = 8 * MOTION_TEMPO
	const size = fitBlock(
		unit * 54,
		panels.reduce((most, panel) => (panel.length > most.length ? panel : most), ''),
		width * 0.42,
		height * 0.3,
	)

	return (
		<AbsoluteFill style={{ overflow: 'hidden' }}>
			<Backdrop seed={100} intensity={0.4} />
			<AbsoluteFill style={{ backgroundColor: motionStage(0.34) }} />
			<AbsoluteFill style={{ perspective: width * 0.9 + 'px', perspectiveOrigin: '50% 50%' }}>
				<div style={{ position: 'absolute', inset: 0, transformStyle: 'preserve-3d' }}>
					{panels.map((panel, index) => {
						const travel = (frame * speed + index * spacing) % (spacing * panels.length)
						const z = spacing * panels.length - travel - spacing * 0.6
						const side = index % 2 === 0
						const near = Math.max(0, 1 - Math.abs(z) / (spacing * 2))
						return (
							<div
								key={'panel-' + index}
								style={{
									position: 'absolute',
									top: height * 0.3,
									left: side ? width * 0.06 : undefined,
									right: side ? undefined : width * 0.06,
									width: width * 0.42,
									padding: unit * 26,
									borderRadius: cornerRadius(unit),
									backgroundColor: withAlpha(THEME.surface, 0.9),
									borderLeft: side ? Math.max(3, unit * 5) + 'px solid ' + THEME.accent : undefined,
									borderRight: side ? undefined : Math.max(3, unit * 5) + 'px solid ' + THEME.accentAlt,
									transform: 'translateZ(' + (-z).toFixed(1) + 'px) rotateY(' + (side ? 26 : -26) + 'deg)',
									opacity: near,
								}}
							>
								<span
									style={{
										fontFamily: DISPLAY_FONT,
										fontWeight: DISPLAY_WEIGHT,
										fontSize: size,
										letterSpacing: trackingFor(size),
										lineHeight: 1.12,
										color: THEME.ink,
										textTransform: TYPE_KEEPS_CASE ? 'none' : 'uppercase',
									}}
								>
									{panel}
								</span>
							</div>
						)
					})}
				</div>
			</AbsoluteFill>
			<AbsoluteFill style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: height * 0.1 }}>
				<MotionCaption kicker={props.kicker} headline={props.headline} delay={2} size={unit * 48} />
			</AbsoluteFill>
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,

	'card-ring': `
/**
 * A carousel seen from inside the ring.
 *
 * Cards are placed on a circle in three dimensions and the whole ring turns, so
 * the one facing the camera is legible and the rest fall away in perspective.
 * The turn settles on a card rather than spinning forever, which gives the beat
 * somewhere to land.
 */
const CardRingScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const cards = motionItems(props, shape === 1 ? 7 : 5)
	const radius = Math.min(width, height) * (shape === 2 ? 0.52 : 0.62)
	const stepAngle = 360 / cards.length
	const spin = interpolate(frame, [6, Math.max(60, props.frames * 0.7)], [-stepAngle * 1.6, stepAngle * (cards.length - 2)], {
		...CLAMP,
		easing: EASE_OUT,
	})
	const cardWidth = Math.min(width * 0.44, height * 0.5)
	const size = fitBlock(
		unit * 34,
		cards.reduce((most, card) => (card.title.length > most.length ? card.title : most), ''),
		cardWidth - unit * 56,
		height * 0.16,
	)

	return (
		<AbsoluteFill style={{ overflow: 'hidden' }}>
			<Backdrop seed={101} intensity={0.42} />
			<AbsoluteFill style={{ perspective: width * 1.1 + 'px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
				<div style={{ position: 'relative', transformStyle: 'preserve-3d', transform: 'rotateY(' + spin.toFixed(2) + 'deg) rotateX(-6deg)' }}>
					{cards.map((card, index) => {
						const angle = index * stepAngle
						const facing = Math.abs((((angle + spin) % 360) + 540) % 360 - 180) / 180
						return (
							<div
								key={'ring-' + index}
								style={{
									position: 'absolute',
									left: -cardWidth / 2,
									top: -height * 0.16,
									width: cardWidth,
									padding: unit * 26,
									borderRadius: cornerRadius(unit, 1.2),
									backgroundColor: withAlpha(THEME.surface, 0.95),
									border: Math.max(1, unit * 1.6) + 'px solid ' + withAlpha(THEME.ink, 0.16),
									transform: 'rotateY(' + angle + 'deg) translateZ(' + radius.toFixed(1) + 'px)',
									backfaceVisibility: 'hidden',
									opacity: 0.3 + facing * 0.7,
									boxShadow: '0 ' + unit * 16 + 'px ' + unit * 38 + 'px ' + withAlpha('#000000', 0.32),
									display: 'flex',
									flexDirection: 'column',
									gap: unit * 12,
								}}
							>
								<VectorIcon name={card.icon} size={unit * 34} color={THEME.accent} strokeWidth={2} />
								<span
									style={{
										fontFamily: DISPLAY_FONT,
										fontWeight: DISPLAY_WEIGHT,
										fontSize: size,
										letterSpacing: trackingFor(size),
										lineHeight: 1.12,
										color: THEME.ink,
									}}
								>
									{card.title}
								</span>
								{card.detail ? (
									<span
										style={{
											fontFamily: TEXT_FONT,
											fontSize: fitBlock(unit * 21, card.detail, cardWidth - unit * 56, height * 0.1),
											lineHeight: 1.42,
											color: THEME.muted,
										}}
									>
										{card.detail}
									</span>
								) : null}
							</div>
						)
					})}
				</div>
			</AbsoluteFill>
			<div style={{ position: 'absolute', left: 0, right: 0, top: height * 0.1, display: 'flex', justifyContent: 'center' }}>
				<MicroLabel text={props.kicker || props.headline} delay={2} />
			</div>
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,

	'elevator-floors': `
/**
 * Floors passing a window.
 *
 * The shaft moves and the floor markers slide past a fixed sill, decelerating
 * onto the one that matters. Naturally ordered and naturally hierarchical,
 * which makes it a good fit for levels, tiers and stages.
 */
const ElevatorFloorsScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const floors = motionLines(props, shape === 1 ? 6 : 4)
	const pitch = height * 0.3
	const stop = interpolate(frame, [8, Math.max(58, props.frames * 0.66)], [0, floors.length - 1], { ...CLAMP, easing: EASE_OUT })
	const landed = Math.round(stop)
	const size = fitBlock(
		unit * 60,
		floors.reduce((most, floor) => (floor.length > most.length ? floor : most), ''),
		width * 0.56,
		pitch * 0.7,
	)

	return (
		<AbsoluteFill style={{ overflow: 'hidden' }}>
			<Backdrop seed={102} intensity={0.4} />
			<AbsoluteFill style={{ backgroundColor: motionStage(0.3) }} />
			<div
				style={{
					position: 'absolute',
					left: 0,
					right: 0,
					top: height * 0.5 - pitch / 2,
					transform: 'translateY(' + (-stop * pitch).toFixed(1) + 'px)',
				}}
			>
				{floors.map((floor, index) => (
					<div
						key={'floor-' + index}
						style={{
							height: pitch,
							display: 'flex',
							alignItems: 'center',
							gap: unit * 24,
							paddingLeft: width * LAYOUT_INSET,
							paddingRight: width * LAYOUT_INSET,
							borderTop: Math.max(1, unit * 1.6) + 'px solid ' + withAlpha(THEME.ink, 0.18),
							opacity: Math.max(0.24, 1 - Math.abs(stop - index) * 0.6),
						}}
					>
						<span
							style={{
								fontFamily: DISPLAY_FONT,
								fontWeight: DISPLAY_WEIGHT,
								fontSize: unit * 40,
								color: index === landed ? THEME.accent : THEME.muted,
								flex: '0 0 auto',
							}}
						>
							{String(floors.length - index).padStart(2, '0')}
						</span>
						<span
							style={{
								fontFamily: DISPLAY_FONT,
								fontWeight: DISPLAY_WEIGHT,
								fontSize: size,
								letterSpacing: trackingFor(size),
								lineHeight: 1.1,
								color: THEME.ink,
								textTransform: TYPE_KEEPS_CASE ? 'none' : 'uppercase',
							}}
						>
							{floor}
						</span>
					</div>
				))}
			</div>
			<div
				aria-hidden
				style={{
					position: 'absolute',
					left: 0,
					right: 0,
					top: height * 0.5 - pitch / 2,
					height: pitch,
					border: Math.max(2, unit * 3) + 'px solid ' + withAlpha(THEME.accent, 0.7),
					borderLeft: 'none',
					borderRight: 'none',
					pointerEvents: 'none',
				}}
			/>
			<AbsoluteFill
				aria-hidden
				style={{
					background:
						'linear-gradient(180deg, ' + THEME.background + ' 0%, transparent 26%, transparent 74%, ' + THEME.background + ' 100%)',
					pointerEvents: 'none',
				}}
			/>
			<div style={{ position: 'absolute', left: width * LAYOUT_INSET, top: height * 0.08 }}>
				<MicroLabel text={props.kicker || props.headline} delay={2} />
			</div>
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,

	'tunnel-rings': `
/**
 * Rings receding to a vanishing point.
 *
 * The rings run away from the camera on a fixed cadence and the copy sits at
 * the mouth, so the frame has a centre to fall into. Hypnotic on purpose - it
 * suits a beat that is about scale or depth rather than about detail.
 */
const TunnelRingsScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const rings = shape === 1 ? 16 : 11
	const rows = motionLines(props, 2)
	const size = fitStack(unit * 82, rows, width * 0.56, height * 0.3)
	const speed = 0.011 * MOTION_TEMPO

	return (
		<AbsoluteFill style={{ overflow: 'hidden' }}>
			<Backdrop seed={103} intensity={0.36} />
			<AbsoluteFill style={{ backgroundColor: motionStage(0.4) }} />
			{new Array(rings).fill(0).map((_, index) => {
				const depth = (frame * speed + index / rings) % 1
				// Cubed so the rings crowd near the vanishing point the way real
				// perspective crowds them, rather than spacing out evenly.
				const scale = depth * depth * depth
				const span = Math.max(width, height) * 1.5 * scale
				return (
					<div
						key={'ring-' + index}
						aria-hidden
						style={{
							position: 'absolute',
							left: width / 2 - span / 2,
							top: height / 2 - span / 2,
							width: span,
							height: span,
							borderRadius: shape === 2 ? cornerRadius(unit, 3) : '50%',
							border:
								Math.max(1, unit * 3 * scale + 1) + 'px solid ' +
								withAlpha(index % 3 === 0 ? THEME.accent : THEME.ink, 0.14 + scale * 0.5),
							transform: 'rotate(' + (index * 7 + frame * 0.2).toFixed(2) + 'deg)',
						}}
					/>
				)
			})}
			<AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: width * LAYOUT_INSET }}>
				<div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: unit * 14 }}>
					{rows.map((row, index) => (
						<span
							key={'tunnel-' + index}
							style={{
								fontFamily: DISPLAY_FONT,
								fontWeight: index === 0 ? DISPLAY_WEIGHT : Math.max(400, DISPLAY_WEIGHT - 240),
								fontSize: index === 0 ? size : size * 0.46,
								letterSpacing: trackingFor(size),
								lineHeight: 1.06,
								textAlign: 'center',
								maxWidth: width * 0.56,
								color: index === 0 ? THEME.ink : THEME.muted,
								textTransform: TYPE_KEEPS_CASE ? 'none' : 'uppercase',
								opacity: interpolate(frame - (10 + index * beat(8)), [0, 18], [0, 1], CLAMP),
								textShadow: LIGHT_STOCK ? undefined : '0 0 ' + unit * 30 + 'px ' + THEME.background,
							}}
						>
							{row}
						</span>
					))}
				</div>
			</AbsoluteFill>
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,

	'cube-unfold': `
/**
 * A solid opening into its net.
 *
 * The faces start folded into a box and hinge outward onto the plane, each one
 * carrying a piece of the argument. It says "here is the whole of it" in a way
 * a grid appearing cannot.
 */
const CubeUnfoldScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const faces = motionItems(props, 4)
	const open = interpolate(frame, [10, Math.max(52, props.frames * 0.58)], [0, 1], { ...CLAMP, easing: EASE_OUT })
	const face = Math.min(width * 0.3, height * 0.3)
	const size = fitBlock(
		unit * 26,
		faces.reduce((most, item) => (item.title.length > most.length ? item.title : most), ''),
		face - unit * 34,
		face - unit * 60,
	)
	const hinges = [
		{ x: -1, y: 0, rotate: 'rotateY(' + (-90 + open * 90).toFixed(2) + 'deg)', origin: 'right center' },
		{ x: 1, y: 0, rotate: 'rotateY(' + (90 - open * 90).toFixed(2) + 'deg)', origin: 'left center' },
		{ x: 0, y: -1, rotate: 'rotateX(' + (90 - open * 90).toFixed(2) + 'deg)', origin: 'center bottom' },
		{ x: 0, y: 1, rotate: 'rotateX(' + (-90 + open * 90).toFixed(2) + 'deg)', origin: 'center top' },
	]

	return (
		<AbsoluteFill style={{ overflow: 'hidden' }}>
			<Backdrop seed={104} intensity={0.42} />
			<AbsoluteFill style={{ perspective: width * 1.2 + 'px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
				<div
					style={{
						position: 'relative',
						width: face,
						height: face,
						transformStyle: 'preserve-3d',
						transform: 'rotateX(' + (shape === 1 ? -14 : -6) + 'deg) rotateZ(' + ((1 - open) * 20).toFixed(2) + 'deg)',
					}}
				>
					<div
						aria-hidden
						style={{
							position: 'absolute',
							inset: 0,
							backgroundColor: THEME.accent,
							borderRadius: cornerRadius(unit, 0.6),
							boxShadow: '0 ' + unit * 20 + 'px ' + unit * 44 + 'px ' + withAlpha('#000000', 0.34),
						}}
					/>
					{faces.map((item, index) => {
						const hinge = hinges[index % hinges.length]
						return (
							<div
								key={'face-' + index}
								style={{
									position: 'absolute',
									left: hinge.x * face,
									top: hinge.y * face,
									width: face,
									height: face,
									padding: unit * 17,
									borderRadius: cornerRadius(unit, 0.6),
									backgroundColor: withAlpha(THEME.surface, 0.96),
									border: Math.max(1, unit * 1.4) + 'px solid ' + withAlpha(THEME.ink, 0.16),
									transformOrigin: hinge.origin,
									transform: hinge.rotate,
									display: 'flex',
									flexDirection: 'column',
									justifyContent: 'flex-end',
									gap: unit * 8,
									opacity: Math.min(1, open * 2),
								}}
							>
								<VectorIcon name={item.icon} size={unit * 26} color={THEME.accent} strokeWidth={2} />
								<span
									style={{
										fontFamily: TEXT_FONT,
										fontWeight: safeTextWeight(620),
										fontSize: size,
										lineHeight: 1.24,
										color: THEME.ink,
									}}
								>
									{item.title}
								</span>
							</div>
						)
					})}
				</div>
			</AbsoluteFill>
			<div style={{ position: 'absolute', left: 0, right: 0, bottom: height * 0.08, display: 'flex', justifyContent: 'center' }}>
				<MotionCaption kicker={props.kicker} headline={props.headline} delay={2} size={unit * 46} />
			</div>
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,

	'stairs-climb': `
/**
 * Steps rising in isometric.
 *
 * Each tread is a level and each riser is the distance between them, so the
 * shape of the graphic is the shape of the progression. Drawn on a fixed
 * isometric angle so it reads as built rather than as charted.
 */
const StairsClimbScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const steps = motionLines(props, shape === 1 ? 5 : 4)
	const tread = Math.min(width * 0.24, height * 0.18)
	const riser = tread * 0.52
	const size = fitBlock(
		unit * 26,
		steps.reduce((most, step) => (step.length > most.length ? step : most), ''),
		tread * 1.6,
		riser * 1.4,
	)

	return (
		<AbsoluteFill style={{ overflow: 'hidden' }}>
			<Backdrop seed={105} intensity={0.42} />
			<AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
				<div style={{ position: 'relative', width: tread * steps.length, height: riser * steps.length }}>
					{steps.map((step, index) => {
						const rise = interpolate(frame - (12 + index * beat(9)), [0, 22], [0, 1], { ...CLAMP, easing: EASE_OUT })
						const last = index === steps.length - 1
						return (
							<div
								key={'step-' + index}
								style={{
									position: 'absolute',
									left: index * tread * 0.78,
									bottom: index * riser,
									width: tread,
									height: riser,
									backgroundColor: last ? THEME.accent : withAlpha(THEME.surface, 0.94),
									border: Math.max(1, unit * 1.4) + 'px solid ' + withAlpha(THEME.ink, 0.2),
									transform: 'skewY(-14deg) translateY(' + ((1 - rise) * riser * 2.4).toFixed(1) + 'px)',
									opacity: rise,
									boxShadow: '0 ' + unit * 10 + 'px ' + unit * 22 + 'px ' + withAlpha('#000000', 0.26),
									display: 'flex',
									alignItems: 'center',
									justifyContent: 'center',
								}}
							>
								<span
									style={{
										fontFamily: TEXT_FONT,
										fontWeight: safeTextWeight(640),
										fontSize: size,
										lineHeight: 1.2,
										textAlign: 'center',
										color: last ? THEME.background : THEME.ink,
										transform: 'skewY(14deg)',
										padding: unit * 8,
									}}
								>
									{step}
								</span>
							</div>
						)
					})}
				</div>
			</AbsoluteFill>
			<div style={{ position: 'absolute', left: width * LAYOUT_INSET, top: height * 0.1 }}>
				<MotionCaption kicker={props.kicker} headline={props.headline} delay={2} align="flex-start" size={unit * 48} />
			</div>
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,

	'window-grid': `
/**
 * A facade lighting up.
 *
 * Windows come on one by one until the building is awake, and the ones that
 * carry copy are the ones that stay lit. Scales well: a dense grid reads as a
 * city and a sparse one reads as a single block.
 */
const WindowGridScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const columns = shape === 1 ? 9 : 6
	const rowCount = shape === 1 ? 7 : 5
	const marks = motionLines(props, 3)
	const cellWidth = (width * 0.72) / columns
	const cellHeight = (height * 0.56) / rowCount
	// Labels take two cells, so the grid is measured against the wider box.
	const size = fitBlock(unit * 20, marks.reduce((most, mark) => (mark.length > most.length ? mark : most), ''), cellWidth * 2 - unit * 18, cellHeight - unit * 16)
	const markAt = (order: number) => Math.floor((columns * rowCount) / (marks.length + 1)) * (order + 1)

	return (
		<AbsoluteFill style={{ overflow: 'hidden' }}>
			<Backdrop seed={106} intensity={0.4} />
			<AbsoluteFill style={{ backgroundColor: motionStage(0.4) }} />
			<AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
				<div
					style={{
						display: 'grid',
						gridTemplateColumns: 'repeat(' + columns + ', ' + cellWidth + 'px)',
						gridAutoRows: cellHeight + 'px',
						gap: unit * 8,
						padding: unit * 22,
						backgroundColor: withAlpha(THEME.ink, 0.24),
						borderRadius: cornerRadius(unit, 0.6),
					}}
				>
					{new Array(columns * rowCount).fill(0).map((_, index) => {
						const markIndex = marks.findIndex((_mark, order) => markAt(order) === index)
						if (markIndex >= 0) {
							return (
								<div
									key={'win-' + index}
									style={{
										gridColumn: 'span 2',
										backgroundColor: THEME.accent,
										borderRadius: cornerRadius(unit, 0.25),
										display: 'flex',
										alignItems: 'center',
										justifyContent: 'center',
										padding: unit * 8,
										overflow: 'hidden',
										opacity: interpolate(frame - (14 + markIndex * beat(9)), [0, 14], [0, 1], CLAMP),
									}}
								>
									<span
										style={{
											fontFamily: TEXT_FONT,
											fontWeight: safeTextWeight(680),
											fontSize: size,
											lineHeight: 1.16,
											textAlign: 'center',
											color: THEME.background,
										}}
									>
										{marks[markIndex]}
									</span>
								</div>
							)
						}
						const on = mrand('window-' + index) > 0.34
						const at = 8 + mrand('window-t-' + index) * Math.max(30, props.frames * 0.5)
						const lit = on ? interpolate(frame - at, [0, 10], [0, 1], CLAMP) : 0
						return (
							<div
								key={'win-' + index}
								aria-hidden
								style={{
									backgroundColor: withAlpha(THEME.glow, 0.1 + lit * 0.7),
									borderRadius: cornerRadius(unit, 0.25),
									boxShadow: lit > 0.5 ? '0 0 ' + unit * 14 + 'px ' + withAlpha(THEME.glow, 0.4) : undefined,
								}}
							/>
						)
					})}
				</div>
			</AbsoluteFill>
			<div style={{ position: 'absolute', left: 0, right: 0, bottom: height * 0.08, display: 'flex', justifyContent: 'center' }}>
				<MotionCaption kicker={props.kicker} headline={props.headline} delay={2} size={unit * 46} />
			</div>
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,

	'horizon-parallax': `
/**
 * Layered ground moving at different rates.
 *
 * Nearer bands travel faster than far ones, which is the only cue the eye needs
 * to read distance. The copy rides on the still layer, so the world moves and
 * the statement does not.
 */
const HorizonParallaxScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const rows = motionLines(props, 2)
	const layers = shape === 1 ? 5 : 4
	const size = fitStack(unit * 88, rows, width * 0.72, height * 0.3)

	return (
		<AbsoluteFill style={{ overflow: 'hidden' }}>
			<Backdrop seed={107} intensity={0.44} />
			{new Array(layers).fill(0).map((_, index) => {
				const depth = (index + 1) / layers
				const drift = (frame * depth * 3 * MOTION_TEMPO) % (width * 0.5)
				const base = height * (0.52 + depth * 0.2)
				const crest = height * 0.06 * depth
				return (
					<div
						key={'layer-' + index}
						aria-hidden
						style={{
							position: 'absolute',
							left: -width * 0.5 - drift,
							width: width * 2.2,
							top: base,
							bottom: 0,
							backgroundColor: shade(THEME.surface, -0.3 + depth * 0.34),
							borderTopLeftRadius: '50% ' + crest + 'px',
							borderTopRightRadius: '50% ' + crest + 'px',
							opacity: 0.4 + depth * 0.5,
						}}
					/>
				)
			})}
			<AbsoluteFill
				style={{
					display: 'flex',
					flexDirection: 'column',
					alignItems: 'center',
					justifyContent: 'flex-start',
					paddingTop: height * 0.16,
					paddingLeft: width * LAYOUT_INSET,
					paddingRight: width * LAYOUT_INSET,
					gap: unit * 14,
				}}
			>
				{rows.map((row, index) => (
					<span
						key={'horizon-' + index}
						style={{
							fontFamily: DISPLAY_FONT,
							fontWeight: index === 0 ? DISPLAY_WEIGHT : Math.max(400, DISPLAY_WEIGHT - 240),
							fontSize: index === 0 ? size : size * 0.44,
							letterSpacing: trackingFor(size),
							lineHeight: 1.06,
							textAlign: 'center',
							maxWidth: width * 0.72,
							color: index === 0 ? THEME.ink : THEME.muted,
							textTransform: TYPE_KEEPS_CASE ? 'none' : 'uppercase',
							opacity: interpolate(frame - (8 + index * beat(9)), [0, 18], [0, 1], CLAMP),
							transform:
								'translateY(' +
								interpolate(frame - (8 + index * beat(9)), [0, 18], [unit * 24, 0], { ...CLAMP, easing: EASE_OUT }).toFixed(1) +
								'px)',
						}}
					>
						{row}
					</span>
				))}
			</AbsoluteFill>
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,

	'orbit-slab': `
/**
 * A camera going round a standing slab.
 *
 * The type is set on a plane with real thickness and the view orbits it, so the
 * word is a made object rather than a layer. The orbit slows as it comes square
 * to the camera, which is where the reading happens.
 */
const OrbitSlabScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const line = motionLines(props, 1)[0] || props.headline
	const size = fitStack(unit * 92, [line], width * 0.6, height * 0.3)
	const orbit = interpolate(frame, [4, Math.max(60, props.frames * 0.72)], [shape === 1 ? -68 : 62, 0], { ...CLAMP, easing: EASE_OUT })
	const slabDepth = unit * 26
	const layers = TYPE_IS_FLAT ? 1 : 6

	return (
		<AbsoluteFill style={{ overflow: 'hidden' }}>
			<Backdrop seed={108} intensity={0.44} />
			<AbsoluteFill style={{ backgroundColor: motionStage(0.28) }} />
			<AbsoluteFill style={{ perspective: width + 'px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
				<div style={{ transformStyle: 'preserve-3d', transform: 'rotateY(' + orbit.toFixed(2) + 'deg) rotateX(-4deg)' }}>
					{new Array(layers).fill(0).map((_, layer) => (
						<span
							key={'slab-' + layer}
							style={{
								position: layer === 0 ? 'relative' : 'absolute',
								left: 0,
								top: 0,
								fontFamily: DISPLAY_FONT,
								fontWeight: DISPLAY_WEIGHT,
								fontSize: size,
								letterSpacing: trackingFor(size),
								lineHeight: 1.04,
								textAlign: 'center',
								maxWidth: width * 0.6,
								color: layer === 0 ? THEME.ink : shade(THEME.accent, -0.2 - layer * 0.06),
								textTransform: TYPE_KEEPS_CASE ? 'none' : 'uppercase',
								transform: 'translateZ(' + (-layer * (slabDepth / 6)).toFixed(2) + 'px)',
							}}
						>
							{line}
						</span>
					))}
				</div>
			</AbsoluteFill>
			<div style={{ position: 'absolute', left: 0, right: 0, bottom: height * 0.12, display: 'flex', justifyContent: 'center' }}>
				<MicroLabel text={props.caption || props.kicker} delay={30} />
			</div>
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,

	'depth-push': `
/**
 * Planes pushing forward one at a time.
 *
 * Each statement arrives from far away, comes to the front, and is pushed back
 * by the next - so the stack is always in the same place and only the order
 * changes. Ruthlessly clear, which is what a sequence of claims needs.
 */
const DepthPushScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const planes = motionLines(props, shape === 1 ? 4 : 3)
	const hold = Math.max(20, props.frames / (planes.length + 0.4))
	const size = fitBlock(
		unit * 76,
		planes.reduce((most, plane) => (plane.length > most.length ? plane : most), ''),
		width * 0.66,
		height * 0.3,
	)

	return (
		<AbsoluteFill style={{ overflow: 'hidden' }}>
			<Backdrop seed={109} intensity={0.42} />
			<AbsoluteFill style={{ perspective: width * 0.8 + 'px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
				{planes.map((plane, index) => {
					const at = frame - index * hold
					const arrive = interpolate(at, [0, 18], [0, 1], { ...CLAMP, easing: EASE_OUT })
					const leave = interpolate(at - hold, [0, 16], [0, 1], { ...CLAMP, easing: EASE_OUT })
					if (at < -6 || leave >= 1) return null
					const z = (1 - arrive) * -width * 0.8 + leave * width * 0.5
					return (
						<div
							key={'plane-' + index}
							style={{
								position: 'absolute',
								padding: unit * 34,
								paddingLeft: unit * 44,
								paddingRight: unit * 44,
								maxWidth: width * 0.66,
								borderRadius: cornerRadius(unit, 1.2),
								backgroundColor: index % 2 === 0 ? withAlpha(THEME.surface, 0.96) : THEME.accent,
								border: Math.max(1, unit * 1.6) + 'px solid ' + withAlpha(THEME.ink, 0.16),
								transform: 'translateZ(' + z.toFixed(1) + 'px)',
								opacity: Math.min(arrive, 1 - leave),
								boxShadow: '0 ' + unit * 20 + 'px ' + unit * 46 + 'px ' + withAlpha('#000000', 0.34),
							}}
						>
							<span
								style={{
									fontFamily: DISPLAY_FONT,
									fontWeight: DISPLAY_WEIGHT,
									fontSize: size,
									letterSpacing: trackingFor(size),
									lineHeight: 1.08,
									textAlign: 'center',
									display: 'block',
									color: index % 2 === 0 ? THEME.ink : THEME.background,
									textTransform: TYPE_KEEPS_CASE ? 'none' : 'uppercase',
								}}
							>
								{plane}
							</span>
						</div>
					)
				})}
			</AbsoluteFill>
			<div style={{ position: 'absolute', left: 0, right: 0, top: height * 0.1, display: 'flex', justifyContent: 'center' }}>
				<MicroLabel text={props.kicker || props.caption} delay={2} />
			</div>
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,
} as const
