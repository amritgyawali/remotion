/**
 * Structural motion scenes.
 *
 * Ten pieces where geometry carries the idea: splits, mosaics, decks, isometric
 * stacks, drawn line-art, particle assembly, orbits, graphs, waveforms and
 * morphing fields. Every one is frame-driven and seeded, never random.
 *
 * Emitted verbatim into the generated TSX: no backticks, no dollar-braces.
 */

export const STRUCTURE_SCENES = {
	'split-reveal': `
/**
 * The frame comes apart.
 *
 * Two to four solid panels slide off in opposite directions and the line was
 * behind them the whole time. The panels carry their own copy on the way out,
 * so nothing is wasted motion.
 */
const SplitRevealScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const panels = shape === 3 ? 4 : 2
	const labels = motionLines(props, panels)
	const part = interpolate(frame, [10, 46], [0, 1], { ...CLAMP, easing: EASE_OUT })
	const vertical = shape === 1
	// Each label owns one panel, so the widest label sets a size the narrowest
	// panel can still hold. Four panels across is the tight case.
	const labelSize = fitStack(
		unit * 46,
		labels,
		(vertical ? width : width / panels) * 0.82,
		(vertical ? height / panels : height) * 0.6,
	)

	return (
		<AbsoluteFill style={{ overflow: 'hidden' }}>
			<Backdrop seed={21} intensity={0.6} />
			<AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
				<MotionCaption
					kicker={props.kicker}
					headline={props.headline}
					caption={props.caption}
					delay={26}
					size={unit * 78}
				/>
			</AbsoluteFill>
			{new Array(panels).fill(0).map((_, index) => {
				const away = index % 2 === 0 ? -1 : 1
				const travel = part * (vertical ? height : width) * 0.62 * away
				const size = 100 / panels
				return (
					<div
						key={'panel-' + index}
						aria-hidden={false}
						style={{
							position: 'absolute',
							left: vertical ? 0 : index * size + '%',
							top: vertical ? index * size + '%' : 0,
							width: vertical ? '100%' : size + '%',
							height: vertical ? size + '%' : '100%',
							backgroundColor: index % 2 === 0 ? THEME.accent : shade(THEME.background, -0.14),
							transform: vertical ? 'translateY(' + travel.toFixed(1) + 'px)' : 'translateX(' + travel.toFixed(1) + 'px)',
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center',
							opacity: part > 0.94 ? 0 : 1,
						}}
					>
						<span
							style={{
								fontFamily: DISPLAY_FONT,
								fontWeight: DISPLAY_WEIGHT,
								fontSize: labelSize,
								letterSpacing: trackingFor(labelSize) + unit * 2,
								color: index % 2 === 0 ? THEME.background : THEME.ink,
								opacity: interpolate(part, [0, 0.5], [1, 0], CLAMP),
								textTransform: TYPE_KEEPS_CASE ? 'none' : 'uppercase',
								padding: unit * 20,
								textAlign: 'center',
							}}
						>
							{labels[index]}
						</span>
					</div>
				)
			})}
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,

	'grid-mosaic': `
/**
 * A tile field that flips.
 *
 * Every tile turns on its own diagonal delay; some land on accent, some on
 * ground, and the ones that land on accent spell out the shape of the copy
 * block underneath. The wave direction changes with the variant.
 */
const GridMosaicScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const columns = shape === 1 ? 14 : shape === 2 ? 8 : 11
	const rows = Math.max(4, Math.round((columns * height) / width))
	const tileWidth = width / columns
	const tileHeight = height / rows

	return (
		<AbsoluteFill style={{ overflow: 'hidden', backgroundColor: THEME.background }}>
			<Backdrop seed={22} intensity={0.35} />
			{new Array(columns * rows).fill(0).map((_, index) => {
				const column = index % columns
				const row = Math.floor(index / columns)
				const wave =
					shape === 3
						? Math.hypot(column - columns / 2, row - rows / 2)
						: shape === 1
							? columns - column + row
							: column + row
				const delay = wave * beat(1.6)
				const turn = interpolate(frame - delay, [0, 18], [0, 1], { ...CLAMP, easing: EASE_OUT })
				const lit = mrand('mosaic-' + index) > 0.62
				return (
					<div
						key={'tile-' + index}
						aria-hidden
						style={{
							position: 'absolute',
							left: column * tileWidth,
							top: row * tileHeight,
							width: tileWidth + 1,
							height: tileHeight + 1,
							backgroundColor: lit ? withAlpha(THEME.accent, 0.9) : withAlpha(THEME.surface, 0.5),
							transform: 'perspective(' + width + 'px) rotateY(' + ((1 - turn) * 92).toFixed(2) + 'deg)',
							transformOrigin: 'left center',
							opacity: turn,
						}}
					/>
				)
			})}
			<AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
				<MotionPanel delay={26} pad={unit * 40} tone={shape === 2 ? 'ink' : 'surface'}>
					<MotionCaption kicker={props.kicker} headline={props.headline} caption={props.caption} delay={30} size={unit * 68} />
				</MotionPanel>
			</AbsoluteFill>
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,

	'card-stack': `
/**
 * A deck dealt to camera.
 *
 * Only one card is ever the front card. The ones behind it are blank plates
 * offset down the stack, and the front one flicks away to expose the next -
 * which is what makes a deck legible. Letting every card carry its text at once
 * printed four titles on top of one another.
 */
const StackCard: React.FC<{ item: MotionItem; index: number; total: number; shape: number; frames: number }> = ({
	item,
	index,
	total,
	shape,
	frames,
}) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width } = useVideoConfig()
	const hold = frames / total
	const start = index * hold
	const enter = interpolate(frame - start, [0, 18], [0, 1], { ...CLAMP, easing: EASE_OUT })
	const leave = interpolate(frame - start - hold, [0, 16], [0, 1], { ...CLAMP, easing: EASE_OUT })
	if (leave >= 1) return null

	/** How far back in the stack this card currently sits. */
	const behind = Math.max(0, index - Math.min(total - 1, Math.floor(frame / hold)))
	// A card that has started to leave gives up its text immediately, or its
	// title reads through the card arriving underneath it.
	const front = behind === 0 && enter > 0.001 && leave < 0.12
	const fan = shape === 1 ? 0 : (shape === 3 ? -1 : 1) * behind * 3.4
	const lift = behind * unit * (shape === 2 ? 16 : 24)
	const shrink = 1 - behind * 0.055
	// The card is the whole box the title has, so the title is measured against
	// it rather than against a size that only suited a two-word label.
	const cardWidth = width * (shape === 2 ? 0.36 : 0.46)
	const titleSize = fitLine(unit * 40, item.title, cardWidth - unit * 68)
	const detailSize = fitBlock(unit * 24, item.detail, cardWidth - unit * 68, unit * 150)

	return (
		<div
			style={{
				position: 'absolute',
				width: cardWidth,
				transform:
					'translateX(' + (leave * unit * 320).toFixed(1) + 'px) translateY(' + lift.toFixed(1) + 'px) rotate(' +
					(fan + leave * 16).toFixed(2) + 'deg) scale(' + (shrink * (0.9 + enter * 0.1)).toFixed(3) + ')',
				opacity: (1 - leave) * (1 - leave) * (front ? 1 : 0.5) * Math.min(1, enter * 4 + (behind > 0 ? 1 : 0)),
				zIndex: total - behind,
				filter: front ? undefined : 'saturate(0.7)',
			}}
		>
			<MotionPanel delay={0} pad={unit * 34} tone={front ? 'accent' : 'surface'}>
				<div style={{ display: 'flex', flexDirection: 'column', gap: unit * 16, minHeight: unit * 190 }}>
					<VectorIcon name={item.icon} size={unit * 46} color={front ? THEME.accent : withAlpha(THEME.ink, 0.35)} strokeWidth={1.8} />
					{front ? (
						<span
							style={{
								fontFamily: DISPLAY_FONT,
								fontWeight: DISPLAY_WEIGHT,
								fontSize: titleSize,
								lineHeight: 1.08,
								letterSpacing: trackingFor(titleSize),
								color: THEME.ink,
							}}
						>
							{item.title}
						</span>
					) : null}
					{front && item.detail ? (
						<span style={{ fontFamily: TEXT_FONT, fontSize: detailSize, color: THEME.muted, lineHeight: 1.4 }}>{item.detail}</span>
					) : null}
				</div>
			</MotionPanel>
		</div>
	)
}

const CardStackScene: React.FC<MotionSceneProps> = (props) => {
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const cards = motionItems(props, shape === 2 ? 5 : 4)

	return (
		<AbsoluteFill>
			<Backdrop seed={23} intensity={0.55} />
			<AbsoluteFill
				style={{
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					perspective: width + 'px',
					transformStyle: 'preserve-3d',
				}}
			>
				{cards.map((item, index) => (
					<StackCard key={'card-' + index} item={item} index={index} total={cards.length} shape={shape} frames={props.frames} />
				))}
			</AbsoluteFill>
			<div style={{ position: 'absolute', left: width * LAYOUT_INSET, top: height * 0.1 }}>
				<MotionCaption kicker={props.kicker} headline={props.headline} delay={2} align="flex-start" size={unit * 52} />
			</div>
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,

	'iso-layers': `
/**
 * An isometric stack that builds upward.
 *
 * Each plate is a labelled tier of the argument; they rise into place bottom
 * first, spread apart, and the whole assembly turns a few degrees so the stack
 * reads as an object rather than as a diagram.
 */
const IsoLayersScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const tiers = motionItems(props, shape === 1 ? 5 : 4)
	const turn = interpolate(frame, [0, 200], [-24, -14], { ...CLAMP, easing: EASE_OUT })
	const plate = Math.min(width * 0.46, height * 0.42)
	// The label column is inset from both edges and gives up a dot and a gap
	// before the text starts, so that is the box the tier names are cut to.
	const tierSize = fitStack(
		unit * 26,
		tiers.map((tier) => tier.title),
		width * (1 - LAYOUT_INSET * 2) - unit * 30,
		height * 0.44,
	)

	return (
		<AbsoluteFill>
			<Backdrop seed={24} intensity={0.5} />
			<AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', perspective: width * 1.4 + 'px' }}>
				<div
					style={{
						position: 'relative',
						width: plate,
						height: plate,
						transformStyle: 'preserve-3d',
						transform: 'rotateX(58deg) rotateZ(' + turn.toFixed(2) + 'deg)',
					}}
				>
					{tiers.map((item, index) => {
						const delay = 6 + (tiers.length - index) * beat(7)
						const rise = interpolate(frame - delay, [0, 26], [0, 1], { ...CLAMP, easing: EASE_OUT })
						const lift = (tiers.length - index) * unit * (shape === 2 ? 26 : 42)
						return (
							<div
								key={'iso-' + index}
								style={{
									position: 'absolute',
									inset: index * unit * (shape === 3 ? 4 : 12),
									backgroundColor: withAlpha(index === 0 ? THEME.accent : THEME.surface, 0.9),
									border: Math.max(1, unit * 1.5) + 'px solid ' + withAlpha(THEME.ink, 0.18),
									borderRadius: cornerRadius(unit),
									transform: 'translateZ(' + (lift * rise).toFixed(1) + 'px)',
									opacity: rise,
									boxShadow: '0 ' + unit * 20 + 'px ' + unit * 40 + 'px ' + withAlpha('#000000', 0.28),
								}}
							/>
						)
					})}
				</div>
			</AbsoluteFill>
			<AbsoluteFill
				style={{
					display: 'flex',
					flexDirection: 'column',
					justifyContent: 'center',
					alignItems: 'flex-start',
					paddingLeft: width * LAYOUT_INSET,
					gap: unit * 12,
				}}
			>
				<MotionCaption kicker={props.kicker} headline={props.headline} delay={2} align="flex-start" size={unit * 54} />
				<div style={{ display: 'flex', flexDirection: 'column', gap: unit * 10, marginTop: unit * 16 }}>
					{tiers.map((item, index) => (
						<div
							key={'iso-label-' + index}
							style={{
								display: 'flex',
								alignItems: 'center',
								gap: unit * 12,
								opacity: interpolate(frame - (10 + (tiers.length - index) * beat(7)), [0, 16], [0, 1], CLAMP),
							}}
						>
							<div style={{ width: unit * 14, height: unit * 14, borderRadius: unit * 4, backgroundColor: index === 0 ? THEME.accent : withAlpha(THEME.ink, 0.4) }} />
							<span style={{ fontFamily: TEXT_FONT, fontSize: tierSize, fontWeight: safeTextWeight(560), color: THEME.ink }}>
								{item.title}
							</span>
						</div>
					))}
				</div>
			</AbsoluteFill>
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,

	'path-draw': `
/**
 * Line art that draws itself.
 *
 * One continuous figure per variant - a route, a circuit, a signature, a
 * constellation - stroked on with dash offset, with the copy arriving as the
 * pen lifts.
 */
const PathDrawScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const draw = interpolate(frame, [6, Math.max(40, props.frames * 0.6)], [0, 1], { ...CLAMP, easing: EASE_OUT })
	const figures = [
		'M40 300 C 120 120, 260 460, 360 240 S 560 60, 660 250 S 800 420, 880 200',
		'M120 420 L 240 420 L 240 260 L 420 260 L 420 140 L 640 140 L 640 320 L 840 320',
		'M460 90 C 660 90, 800 230, 800 380 C 800 520, 640 610, 460 610 C 280 610, 120 520, 120 380 C 120 230, 260 90, 460 90 Z M280 330 L 640 330',
		'M100 500 L 250 200 L 400 430 L 550 120 L 700 380 L 860 160',
	]
	const stroke = Math.max(2, unit * (shape === 1 ? 5 : 7))

	return (
		<AbsoluteFill>
			<Backdrop seed={25} intensity={0.5} />
			<AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
				<svg viewBox="0 0 960 700" width={width * 0.82} height={height * 0.62} style={{ overflow: 'visible' }} aria-hidden>
					<path
						d={figures[shape]}
						fill="none"
						stroke={withAlpha(THEME.ink, 0.14)}
						strokeWidth={stroke}
						strokeLinecap="round"
						strokeLinejoin="round"
					/>
					<path
						d={figures[shape]}
						fill="none"
						stroke={THEME.accent}
						strokeWidth={stroke}
						strokeLinecap="round"
						strokeLinejoin="round"
						strokeDasharray={2600}
						strokeDashoffset={2600 * (1 - draw)}
					/>
					{new Array(4).fill(0).map((_, index) => {
						const at = (index + 1) / 5
						if (draw < at) return null
						const pop = interpolate(draw, [at, at + 0.12], [0, 1], CLAMP)
						return (
							<circle
								key={'node-' + index}
								cx={140 + index * 210}
								cy={shape === 3 ? 500 - index * 90 : 280 + Math.sin(index * 1.4) * 130}
								r={stroke * 2.2 * pop}
								fill={THEME.background}
								stroke={THEME.accentAlt}
								strokeWidth={stroke * 0.7}
							/>
						)
					})}
				</svg>
			</AbsoluteFill>
			<AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
				<div style={{ marginTop: height * 0.3 }}>
					<MotionCaption kicker={props.kicker} headline={props.headline} caption={props.caption} delay={Math.round(props.frames * 0.4)} size={unit * 56} />
				</div>
			</AbsoluteFill>
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,

	'particle-assemble': `
/**
 * Scattered points that find a form.
 *
 * Every particle has a seeded start and a target on a ring, a bar or a spiral;
 * they converge on a spring and the headline burns in as the form closes.
 */
const ParticleAssembleScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height, fps } = useVideoConfig()
	const shape = props.variant % 4
	const count = shape === 1 ? 120 : 84
	const gather = spring({ frame: frame - 8, fps, config: { damping: 26, mass: 0.9, stiffness: 70 } })
	const radius = Math.min(width, height) * 0.3

	return (
		<AbsoluteFill style={{ overflow: 'hidden' }}>
			<Backdrop seed={26} intensity={0.4} />
			<AbsoluteFill>
				{new Array(count).fill(0).map((_, index) => {
					const ratio = index / count
					const angle = ratio * Math.PI * 2
					const target =
						shape === 2
							? { x: width * (0.16 + ratio * 0.68), y: height * 0.5 + Math.sin(angle * 3) * height * 0.16 }
							: shape === 3
								? { x: width * 0.5 + Math.cos(angle * 3) * radius * ratio, y: height * 0.5 + Math.sin(angle * 3) * radius * ratio }
								: { x: width * 0.5 + Math.cos(angle) * radius, y: height * 0.5 + Math.sin(angle) * radius }
					const startX = mrand('pa-x-' + index) * width
					const startY = mrand('pa-y-' + index) * height
					const size = unit * (2.5 + mrand('pa-s-' + index) * 6)
					const orbit = Math.sin(frame / 40 + index) * unit * 4 * gather
					return (
						<div
							key={'pa-' + index}
							aria-hidden
							style={{
								position: 'absolute',
								left: startX + (target.x - startX) * gather + orbit,
								top: startY + (target.y - startY) * gather - orbit,
								width: size,
								height: size,
								borderRadius: size,
								backgroundColor: index % 5 === 0 ? THEME.accentAlt : THEME.accent,
								opacity: 0.24 + gather * 0.62,
								boxShadow: '0 0 ' + (size * 3).toFixed(1) + 'px ' + withAlpha(THEME.accent, 0.5),
							}}
						/>
					)
				})}
			</AbsoluteFill>
			<AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
				<MotionCaption kicker={props.kicker} headline={props.headline} caption={props.caption} delay={30} size={unit * 66} />
			</AbsoluteFill>
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,

	'orbit-nodes': `
/**
 * A hub and the things that turn around it.
 *
 * Labelled satellites ride two rings at different rates with drawn connectors,
 * so a relationship is shown rather than listed.
 */
const OrbitNodesScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const nodes = motionItems(props, shape === 1 ? 6 : 5)
	const centre = { x: width * 0.5, y: height * 0.5 }
	const ring = Math.min(width, height) * (shape === 2 ? 0.26 : 0.32)
	const spin = frame * (shape === 3 ? 0.32 : 0.2)
	// The pills sit on the ring and never wrap, so the longest name decides the
	// size for all of them - one pill set in smaller type than its neighbours
	// reads as a mistake, a whole ring set a little smaller does not.
	const chipSize = fitLine(
		unit * 23,
		nodes.reduce((most, node) => (node.title.length > most.length ? node.title : most), ''),
		width * 0.34 - unit * 70,
	)

	return (
		<AbsoluteFill>
			<Backdrop seed={27} intensity={0.5} />
			<AbsoluteFill>
				<svg width={width} height={height} style={{ position: 'absolute', inset: 0 }} aria-hidden>
					{[0.62, 1].map((scale, index) => (
						<circle
							key={'ring-' + index}
							cx={centre.x}
							cy={centre.y}
							r={ring * scale}
							fill="none"
							stroke={withAlpha(THEME.ink, 0.12)}
							strokeWidth={Math.max(1, unit)}
							strokeDasharray={index === 0 ? unit * 8 + ' ' + unit * 10 : undefined}
						/>
					))}
					{nodes.map((_, index) => {
						const angle = ((index / nodes.length) * 360 + spin) * (Math.PI / 180)
						const scale = index % 2 === 0 ? 1 : 0.62
						const x = centre.x + Math.cos(angle) * ring * scale
						const y = centre.y + Math.sin(angle) * ring * scale
						const show = interpolate(frame - (8 + index * beat(5)), [0, 16], [0, 1], CLAMP)
						return (
							<line
								key={'link-' + index}
								x1={centre.x}
								y1={centre.y}
								x2={centre.x + (x - centre.x) * show}
								y2={centre.y + (y - centre.y) * show}
								stroke={withAlpha(THEME.accent, 0.4)}
								strokeWidth={Math.max(1, unit * 1.4)}
							/>
						)
					})}
				</svg>
				{nodes.map((item, index) => {
					const angle = ((index / nodes.length) * 360 + spin) * (Math.PI / 180)
					const scale = index % 2 === 0 ? 1 : 0.62
					const show = interpolate(frame - (10 + index * beat(5)), [0, 18], [0, 1], { ...CLAMP, easing: EASE_OUT })
					return (
						<div
							key={'orbit-' + index}
							style={{
								position: 'absolute',
								left: centre.x + Math.cos(angle) * ring * scale,
								top: centre.y + Math.sin(angle) * ring * scale,
								transform: 'translate(-50%, -50%) scale(' + (0.6 + show * 0.4).toFixed(3) + ')',
								opacity: show,
								display: 'flex',
								alignItems: 'center',
								gap: unit * 10,
								padding: unit * 12,
								paddingLeft: unit * 16,
								paddingRight: unit * 18,
								borderRadius: cornerRadius(unit, 2),
								backgroundColor: withAlpha(THEME.surface, 0.92),
								border: Math.max(1, unit * 1.2) + 'px solid ' + withAlpha(THEME.accent, 0.4),
								whiteSpace: 'nowrap',
							}}
						>
							<VectorIcon name={item.icon} size={chipSize} color={THEME.accent} strokeWidth={2} />
							<span style={{ fontFamily: TEXT_FONT, fontSize: chipSize, fontWeight: safeTextWeight(560), color: THEME.ink }}>
								{item.title}
							</span>
						</div>
					)
				})}
				<div
					style={{
						position: 'absolute',
						left: centre.x,
						top: centre.y,
						transform: 'translate(-50%, -50%)',
						textAlign: 'center',
						maxWidth: ring * 1.1,
					}}
				>
					<MotionCaption headline={props.headline} delay={2} size={unit * 44} />
				</div>
			</AbsoluteFill>
			<div style={{ position: 'absolute', left: 0, right: 0, bottom: height * 0.07, display: 'flex', justifyContent: 'center' }}>
				<MicroLabel text={props.caption || props.kicker} delay={34} />
			</div>
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,

	'network-graph': `
/**
 * A graph that grows edge by edge.
 *
 * Node positions come from the generation seed inside a padded box, so no two
 * films draw the same topology, and the edges are stroked on in order.
 */
const NetworkGraphScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const labels = motionLines(props, shape === 1 ? 8 : 6)
	const box = { x: width * 0.14, y: height * 0.2, w: width * 0.72, h: height * 0.56 }
	const nodes = labels.map((label, index) => ({
		label,
		x: box.x + (0.12 + mrand('gx-' + index + '-' + label.length) * 0.76) * box.w,
		y: box.y + (0.12 + mrand('gy-' + index + '-' + label.length) * 0.76) * box.h,
	}))
	// The node caps at three tenths of the frame and ellipses past it. An ellipsis
	// eats the end of a real sentence, so the type is cut to the cap first and the
	// overflow rule is left in only as a backstop.
	const nodeSize = fitLine(
		unit * (shape === 1 ? 20 : 24),
		labels.reduce((most, label) => (label.length > most.length ? label : most), ''),
		width * 0.3 - unit * 36,
	)
	const edges = nodes.flatMap((node, index) =>
		index === 0 ? [] : [{ from: nodes[Math.floor(mrand('ge-' + index) * index)], to: node, index }],
	)

	return (
		<AbsoluteFill>
			<Backdrop seed={28} intensity={0.45} />
			<svg width={width} height={height} style={{ position: 'absolute', inset: 0 }} aria-hidden>
				{edges.map((edge) => {
					const grow = interpolate(frame - (10 + edge.index * beat(6)), [0, 20], [0, 1], { ...CLAMP, easing: EASE_OUT })
					return (
						<line
							key={'edge-' + edge.index}
							x1={edge.from.x}
							y1={edge.from.y}
							x2={edge.from.x + (edge.to.x - edge.from.x) * grow}
							y2={edge.from.y + (edge.to.y - edge.from.y) * grow}
							stroke={withAlpha(THEME.accent, 0.45)}
							strokeWidth={Math.max(1, unit * 1.6)}
							strokeLinecap="round"
						/>
					)
				})}
			</svg>
			{nodes.map((node, index) => {
				const pop = interpolate(frame - (8 + index * beat(6)), [0, 16], [0, 1], { ...CLAMP, easing: EASE_OUT })
				const pulse = 1 + Math.sin(frame / 26 + index) * 0.04
				return (
					<div
						key={'gnode-' + index}
						style={{
							position: 'absolute',
							left: node.x,
							top: node.y,
							transform: 'translate(-50%, -50%) scale(' + (pop * pulse).toFixed(3) + ')',
							opacity: pop,
							padding: unit * 10,
							paddingLeft: unit * 18,
							paddingRight: unit * 18,
							borderRadius: cornerRadius(unit, 2.4),
							backgroundColor: index === 0 ? THEME.accent : withAlpha(THEME.surface, 0.94),
							border: Math.max(1, unit * 1.2) + 'px solid ' + withAlpha(THEME.ink, 0.16),
							fontFamily: TEXT_FONT,
							fontWeight: safeTextWeight(560),
							fontSize: nodeSize,
							color: index === 0 ? THEME.background : THEME.ink,
							whiteSpace: 'nowrap',
							maxWidth: width * 0.3,
							overflow: 'hidden',
							textOverflow: 'ellipsis',
						}}
					>
						{node.label}
					</div>
				)
			})}
			<div style={{ position: 'absolute', left: width * LAYOUT_INSET, top: height * 0.07 }}>
				<MotionCaption kicker={props.kicker} headline={props.headline} delay={2} align="flex-start" size={unit * 50} />
			</div>
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,

	'wave-form': `
/**
 * A signal reading across the frame.
 *
 * Bars are driven by a sum of sines seeded per film, so the waveform belongs to
 * this generation and to no other. The copy sits inside the trough.
 */
const WaveFormScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const bars = shape === 1 ? 74 : shape === 3 ? 40 : 56
	const seedA = 0.6 + mrand('wave-a') * 1.8
	const seedB = 0.4 + mrand('wave-b') * 2.4
	const enter = interpolate(frame, [0, 24], [0, 1], { ...CLAMP, easing: EASE_OUT })
	const gap = Math.max(1, unit * 3)
	const barWidth = (width * 0.86) / bars - gap

	return (
		<AbsoluteFill>
			<Backdrop seed={29} intensity={0.45} />
			<AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
				<div style={{ display: 'flex', alignItems: 'center', gap, height: height * 0.5 }}>
					{new Array(bars).fill(0).map((_, index) => {
						const phase = index / bars
						const amplitude =
							Math.abs(Math.sin(phase * Math.PI * seedA + frame / 22)) * 0.6 +
							Math.abs(Math.sin(phase * Math.PI * seedB - frame / 15)) * 0.4
						const envelope = shape === 2 ? 1 : Math.sin(phase * Math.PI)
						const size = Math.max(unit * 4, amplitude * envelope * height * 0.42 * enter)
						return (
							<div
								key={'wf-' + index}
								aria-hidden
								style={{
									width: barWidth,
									height: size,
									borderRadius: shape === 3 ? 0 : barWidth,
									backgroundColor: index % 6 === 0 ? THEME.accentAlt : THEME.accent,
									opacity: 0.4 + amplitude * 0.6,
								}}
							/>
						)
					})}
				</div>
			</AbsoluteFill>
			<AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
				<MotionPanel delay={16} pad={unit * 30} tone={shape === 1 ? 'ink' : 'surface'}>
					<MotionCaption kicker={props.kicker} headline={props.headline} caption={props.caption} delay={20} size={unit * 58} />
				</MotionPanel>
			</AbsoluteFill>
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,

	'liquid-blob': `
/**
 * A field that will not sit still.
 *
 * Three overlapping organic shapes wander on independent sine paths behind the
 * type. Their radii are seeded, so the silhouette differs per generation, and
 * the whole field breathes with the tempo.
 */
const LiquidBlobScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const blobs = shape === 2 ? 4 : 3
	const enter = interpolate(frame, [0, 30], [0, 1], { ...CLAMP, easing: EASE_OUT })

	return (
		<AbsoluteFill style={{ overflow: 'hidden' }}>
			<Backdrop seed={30} intensity={0.3} />
			<AbsoluteFill>
				{new Array(blobs).fill(0).map((_, index) => {
					const size = Math.min(width, height) * (0.42 + mrand('blob-s-' + index) * 0.4)
					const speed = 44 + index * 21
					const x = width * (0.22 + mrand('blob-x-' + index) * 0.56) + Math.sin(frame / speed + index) * width * 0.1
					const y = height * (0.22 + mrand('blob-y-' + index) * 0.56) + Math.cos(frame / (speed * 1.3) + index) * height * 0.12
					const squash = 1 + Math.sin(frame / 38 + index * 2) * 0.14
					const color = index % 3 === 0 ? THEME.accent : index % 3 === 1 ? THEME.accentAlt : THEME.glow
					return (
						<div
							key={'blob-' + index}
							aria-hidden
							style={{
								position: 'absolute',
								left: x - size / 2,
								top: y - size / 2,
								width: size,
								height: size,
								borderRadius: '50%',
								backgroundColor: withAlpha(color, (shape === 3 ? 0.24 : 0.34) * FIGURE_WEIGHT * enter),
								transform: 'scale(' + squash.toFixed(3) + ', ' + (2 - squash).toFixed(3) + ')',
								filter: 'blur(' + (unit * (shape === 1 ? 20 : 44)).toFixed(1) + 'px)',
							}}
						/>
					)
				})}
			</AbsoluteFill>
			<AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
				<MotionCaption kicker={props.kicker} headline={props.headline} caption={props.caption} delay={10} size={unit * 82} />
			</AbsoluteFill>
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,
} as const
