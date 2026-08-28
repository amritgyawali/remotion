/**
 * Data-shaped motion scenes.
 *
 * Ten pieces that carry an argument as geometry: races, breakdowns, rings,
 * gauges, funnels, tiers, overlaps, heat fields, flows and counters.
 *
 * Honesty rule: a number is only ever printed when the storyboard actually
 * supplied a stat. When it did not, the renderer still draws its figure - the
 * proportions come from the copy - but every numeric readout is suppressed, so
 * a film can look like a chart without claiming a measurement nobody made.
 *
 * Emitted verbatim into the generated TSX: no backticks, no dollar-braces.
 */

export const DATA_SCENES = {
	'bar-race': `
/**
 * A ranked field that reorders as it fills.
 *
 * Rows grow to their weight and swap positions as they overtake, so the point
 * is the movement rather than the final still.
 */
const BarRaceScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const count = shape === 1 ? 6 : 5
	const labels = motionLines(props, count)
	const weights = motionWeights(props, count)
	const showNumbers = props.stats.length >= count
	const grow = interpolate(frame, [8, Math.max(40, props.frames * 0.62)], [0, 1], { ...CLAMP, easing: EASE_OUT })
	const ranked = weights
		.map((weight, index) => ({ index, weight, current: weight * grow }))
		.slice()
		.sort((a, b) => b.current - a.current)
	const rowHeight = Math.min(unit * 78, (height * 0.6) / count)

	return (
		<AbsoluteFill>
			<Backdrop seed={41} intensity={0.45} />
			<AbsoluteFill style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: width * LAYOUT_INSET, gap: unit * 12 }}>
				<MotionCaption kicker={props.kicker} headline={props.headline} delay={2} align="flex-start" size={unit * 50} />
				<div style={{ position: 'relative', height: rowHeight * count, marginTop: unit * 18 }}>
					{ranked.map((row, position) => {
						// The bar clips its own label, and the bar a row ends at is set by
						// its weight - so the label is cut to the settled bar, not to the
						// one growing under it, or the type would rescale every frame.
						const barSize = fitLine(
							unit * 25,
							labels[row.index],
							Math.max(unit * 40, row.weight * width * 0.58) - unit * 26,
						)
						return (
						<div
							key={'race-' + row.index}
							style={{
								position: 'absolute',
								left: 0,
								right: 0,
								top: position * rowHeight,
								height: rowHeight - unit * 8,
								display: 'flex',
								alignItems: 'center',
								gap: unit * 14,
								transition: 'none',
							}}
						>
							<span
								style={{
									width: unit * 46,
									fontFamily: DISPLAY_FONT,
									fontWeight: DISPLAY_WEIGHT,
									fontSize: unit * 26,
									color: THEME.muted,
								}}
							>
								{String(position + 1).padStart(2, '0')}
							</span>
							<div
								style={{
									height: '100%',
									width: Math.max(unit * 40, row.current * width * 0.58),
									borderRadius: shape === 2 ? 0 : cornerRadius(unit),
									backgroundColor: position === 0 ? THEME.accent : withAlpha(THEME.accentAlt, 0.55),
									display: 'flex',
									alignItems: 'center',
									paddingLeft: unit * 18,
									overflow: 'hidden',
								}}
							>
								<span
									style={{
										fontFamily: TEXT_FONT,
										fontWeight: safeTextWeight(600),
										fontSize: barSize,
										color: THEME.background,
										whiteSpace: 'nowrap',
									}}
								>
									{labels[row.index]}
								</span>
							</div>
							{showNumbers ? (
								<span
									style={{
										fontFamily: DISPLAY_FONT,
										fontWeight: DISPLAY_WEIGHT,
										fontSize: fitLine(unit * 28, formatStat(props.stats[row.index], 1), width * 0.24),
										color: THEME.ink,
									}}
								>
									{formatStat(props.stats[row.index], grow)}
								</span>
							) : null}
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

	'donut-breakdown': `
/**
 * A ring split into shares.
 *
 * Segments sweep on in order with a legend that ticks in beside them, and the
 * hole carries the headline so the figure and the claim are one object.
 */
const DonutBreakdownScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const count = shape === 1 ? 5 : 4
	const labels = motionLines(props, count)
	const weights = motionWeights(props, count)
	const total = weights.reduce((sum, value) => sum + value, 0) || 1
	const sweep = interpolate(frame, [8, Math.max(40, props.frames * 0.6)], [0, 1], { ...CLAMP, easing: EASE_OUT })
	const size = Math.min(width * 0.44, height * 0.62)
	const radius = size / 2
	const thickness = shape === 2 ? radius * 0.9 : radius * 0.42
	const colors = [THEME.accent, THEME.accentAlt, THEME.glow, withAlpha(THEME.ink, 0.5), withAlpha(THEME.accent, 0.4)]
	let cursor = -90
	// The hub is whatever the ring leaves in the middle. On the thick-ring
	// variant that is almost nothing, so the headline stays out of it entirely
	// rather than being sliced at forty characters and set over the stroke.
	const stacked = useStacked()
	const hub = size - thickness * 2
	const hubSize = fitBlock(unit * 34, props.headline, hub * 0.92, hub * 0.92)
	// The legend stands beside the ring on the wide variants and under it on the
	// stacked one, which is the only case where it has the frame to itself.
	const legendBox = (shape === 3 || stacked ? width * 0.8 : width - size - unit * 120) - unit * 34
	const legendSize = fitLine(
		unit * 26,
		labels.reduce((most, label) => (label.length > most.length ? label : most), ''),
		legendBox * (props.stats.length >= count ? 0.6 : 1),
	)

	return (
		<AbsoluteFill>
			<Backdrop seed={42} intensity={0.45} />
			<AbsoluteFill style={{ display: 'flex', flexDirection: shape === 3 || stacked ? 'column' : 'row', alignItems: 'center', justifyContent: 'center', gap: unit * 48 }}>
				<div style={{ position: 'relative', width: size, height: size }}>
					<svg width={size} height={size} viewBox={'0 0 ' + size + ' ' + size} aria-hidden>
						{weights.map((weight, index) => {
							const share = (weight / total) * 360
							const start = cursor
							cursor += share
							const end = start + share * sweep
							const large = end - start > 180 ? 1 : 0
							const point = (angle: number) => {
								const rad = (angle * Math.PI) / 180
								return {
									x: radius + Math.cos(rad) * (radius - thickness / 2),
									y: radius + Math.sin(rad) * (radius - thickness / 2),
								}
							}
							const from = point(start)
							const to = point(end)
							if (end - start < 0.4) return null
							return (
								<path
									key={'seg-' + index}
									d={'M ' + from.x + ' ' + from.y + ' A ' + (radius - thickness / 2) + ' ' + (radius - thickness / 2) + ' 0 ' + large + ' 1 ' + to.x + ' ' + to.y}
									fill="none"
									stroke={colors[index % colors.length]}
									strokeWidth={thickness}
									strokeLinecap={shape === 0 ? 'butt' : 'round'}
								/>
							)
						})}
					</svg>
					{hub > size * 0.34 ? (
						<div style={{ position: 'absolute', inset: thickness, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
							<span
								style={{
									fontFamily: DISPLAY_FONT,
									fontWeight: DISPLAY_WEIGHT,
									fontSize: hubSize,
									lineHeight: 1.08,
									color: THEME.ink,
									opacity: interpolate(frame, [20, 36], [0, 1], CLAMP),
								}}
							>
								{props.headline}
							</span>
						</div>
					) : null}
				</div>
				<div style={{ display: 'flex', flexDirection: 'column', gap: unit * 16 }}>
					{labels.map((label, index) => (
						<div
							key={'legend-' + index}
							style={{
								display: 'flex',
								alignItems: 'center',
								gap: unit * 14,
								opacity: interpolate(frame - (14 + index * beat(7)), [0, 16], [0, 1], CLAMP),
							}}
						>
							<div style={{ width: unit * 20, height: unit * 20, borderRadius: unit * 6, backgroundColor: colors[index % colors.length] }} />
							<span style={{ fontFamily: TEXT_FONT, fontSize: legendSize, fontWeight: safeTextWeight(560), color: THEME.ink }}>{label}</span>
							{props.stats.length >= count ? (
								<span style={{ fontFamily: DISPLAY_FONT, fontWeight: DISPLAY_WEIGHT, fontSize: legendSize, color: THEME.accent }}>
									{formatStat(props.stats[index], sweep)}
								</span>
							) : null}
						</div>
					))}
				</div>
			</AbsoluteFill>
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,

	'progress-rings': `
/**
 * Concentric arcs that close.
 *
 * Three or four rings fill at different rates around a shared centre, each
 * labelled on its own radius. Reads as capacity, completion or coverage.
 */
const ProgressRingsScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const count = shape === 1 ? 4 : 3
	const labels = motionLines(props, count)
	const weights = motionWeights(props, count)
	const size = Math.min(width * 0.6, height * 0.72)
	const centre = size / 2
	const stroke = size * (shape === 2 ? 0.045 : 0.07)
	const colors = [THEME.accent, THEME.accentAlt, THEME.glow, withAlpha(THEME.ink, 0.5)]
	// The key sits beside the rings, so it gets what the rings leave; the stacked
	// variant puts it underneath, where it has the width of the frame.
	const stacked = useStacked()
	const keyBox = (shape === 3 || stacked ? width * 0.82 : width - size - unit * 110) - unit * 38
	const keySize = fitLine(
		unit * 25,
		labels.reduce((most, label) => (label.length > most.length ? label : most), ''),
		keyBox * (props.stats.length >= count ? 0.62 : 1),
	)

	return (
		<AbsoluteFill>
			<Backdrop seed={43} intensity={0.45} />
			<AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: unit * 40, flexDirection: shape === 3 || stacked ? 'column' : 'row' }}>
				<svg width={size} height={size} aria-hidden style={{ overflow: 'visible' }}>
					{weights.map((weight, index) => {
						const radius = centre - stroke * 1.4 * (index + 1) - size * 0.02 * index
						const circumference = 2 * Math.PI * radius
						const fill = interpolate(frame - (10 + index * beat(8)), [0, 42], [0, weight], { ...CLAMP, easing: EASE_OUT })
						return (
							<g key={'ring-' + index} transform={'rotate(-90 ' + centre + ' ' + centre + ')'}>
								<circle cx={centre} cy={centre} r={radius} fill="none" stroke={withAlpha(THEME.ink, 0.1)} strokeWidth={stroke} />
								<circle
									cx={centre}
									cy={centre}
									r={radius}
									fill="none"
									stroke={colors[index % colors.length]}
									strokeWidth={stroke}
									strokeLinecap={shape === 0 ? 'butt' : 'round'}
									strokeDasharray={circumference}
									strokeDashoffset={circumference * (1 - fill)}
								/>
							</g>
						)
					})}
				</svg>
				<div style={{ display: 'flex', flexDirection: 'column', gap: unit * 18 }}>
					<MotionCaption kicker={props.kicker} headline={props.headline} delay={2} align="flex-start" size={unit * 46} />
					{labels.map((label, index) => (
						<div
							key={'ring-label-' + index}
							style={{ display: 'flex', alignItems: 'center', gap: unit * 12, opacity: interpolate(frame - (16 + index * beat(8)), [0, 16], [0, 1], CLAMP) }}
						>
							<div style={{ width: unit * 26, height: unit * 6, borderRadius: unit * 6, backgroundColor: colors[index % colors.length] }} />
							<span style={{ fontFamily: TEXT_FONT, fontSize: keySize, color: THEME.ink, fontWeight: safeTextWeight(560) }}>{label}</span>
							{props.stats.length >= count ? (
								<span style={{ fontFamily: DISPLAY_FONT, fontWeight: DISPLAY_WEIGHT, fontSize: keySize, color: colors[index % colors.length] }}>
									{formatStat(props.stats[index], interpolate(frame - (10 + index * beat(8)), [0, 42], [0, 1], CLAMP))}
								</span>
							) : null}
						</div>
					))}
				</div>
			</AbsoluteFill>
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,

	'speedometer': `
/**
 * A gauge sweeping to rest.
 *
 * Tick marks, an arc, a needle with overshoot and a plate underneath. The
 * needle settles on a spring, so it reads mechanical rather than eased.
 */
const SpeedometerScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height, fps } = useVideoConfig()
	const shape = props.variant % 4
	const weight = motionWeights(props, 1)[0]
	const settle = spring({ frame: frame - 12, fps, config: { damping: 14, mass: 1.1, stiffness: 90 } })
	const size = Math.min(width * 0.56, height * 0.66)
	const centre = size / 2
	const span = shape === 1 ? 240 : 200
	const start = 90 + (360 - span) / 2
	const angle = start + span * weight * settle
	const ticks = shape === 2 ? 24 : 16

	return (
		<AbsoluteFill>
			<Backdrop seed={44} intensity={0.45} />
			<AbsoluteFill style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: unit * 20 }}>
				<svg width={size} height={size} aria-hidden style={{ overflow: 'visible' }}>
					{new Array(ticks + 1).fill(0).map((_, index) => {
						const at = start + (span * index) / ticks
						const rad = (at * Math.PI) / 180
						const outer = centre - size * 0.03
						const inner = outer - size * (index % 4 === 0 ? 0.1 : 0.055)
						const lit = index / ticks <= weight * settle
						return (
							<line
								key={'tick-' + index}
								x1={centre + Math.cos(rad) * inner}
								y1={centre + Math.sin(rad) * inner}
								x2={centre + Math.cos(rad) * outer}
								y2={centre + Math.sin(rad) * outer}
								stroke={lit ? THEME.accent : withAlpha(THEME.ink, 0.2)}
								strokeWidth={Math.max(2, unit * (index % 4 === 0 ? 4 : 2))}
								strokeLinecap="round"
							/>
						)
					})}
					<circle cx={centre} cy={centre} r={size * 0.045} fill={THEME.accent} />
					<line
						x1={centre}
						y1={centre}
						x2={centre + Math.cos((angle * Math.PI) / 180) * (centre - size * 0.14)}
						y2={centre + Math.sin((angle * Math.PI) / 180) * (centre - size * 0.14)}
						stroke={THEME.ink}
						strokeWidth={Math.max(3, unit * 6)}
						strokeLinecap="round"
					/>
				</svg>
				{props.stats.length > 0 ? (
					<span
						style={{
							fontFamily: DISPLAY_FONT,
							fontWeight: DISPLAY_WEIGHT,
							fontSize: fitLine(unit * 78, formatStat(props.stats[0], 1), width * 0.7),
							color: THEME.accent,
							lineHeight: 1,
						}}
					>
						{formatStat(props.stats[0], settle)}
					</span>
				) : null}
				<MotionCaption headline={props.headline} caption={props.caption} delay={22} size={unit * 52} />
			</AbsoluteFill>
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,

	'funnel-steps': `
/**
 * A narrowing sequence.
 *
 * Each stage is wider than the one below it and drops into place from above,
 * so attrition is felt rather than described.
 */
const FunnelStepsScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const count = shape === 1 ? 5 : 4
	const stages = motionItems(props, count)
	const stageHeight = Math.min(unit * 88, (height * 0.58) / count)
	const top = width * (shape === 2 ? 0.5 : 0.62)

	return (
		<AbsoluteFill>
			<Backdrop seed={45} intensity={0.45} />
			<AbsoluteFill style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: unit * 8 }}>
				<MotionCaption kicker={props.kicker} headline={props.headline} delay={2} size={unit * 48} />
				<div style={{ marginTop: unit * 22, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: unit * 6 }}>
					{stages.map((stage, index) => {
						const ratio = 1 - (index / count) * 0.62
						const drop = interpolate(frame - (10 + index * beat(8)), [0, 22], [0, 1], { ...CLAMP, easing: EASE_OUT })
						// The band narrows as it descends and the figure beside the label takes
						// its share of the row, so both are taken off before the label is cut.
						const bandSize = fitBlock(
							unit * 26,
							stage.title,
							top * ratio - unit * 54 - (props.stats.length >= count ? unit * 116 : 0),
							stageHeight - unit * 10,
						)
						return (
							<div
								key={'funnel-' + index}
								style={{
									width: top * ratio,
									height: stageHeight,
									clipPath:
										shape === 3
											? undefined
											: 'polygon(0 0, 100% 0, ' + (100 - 6).toFixed(0) + '% 100%, 6% 100%)',
									borderRadius: shape === 3 ? cornerRadius(unit) : 0,
									backgroundColor: withAlpha(index === 0 ? THEME.accent : THEME.accentAlt, 0.9 - index * 0.14),
									display: 'flex',
									alignItems: 'center',
									justifyContent: 'center',
									gap: unit * 14,
									opacity: drop,
									transform: 'translateY(' + ((1 - drop) * -unit * 40).toFixed(1) + 'px)',
								}}
							>
								<span
									style={{
										fontFamily: TEXT_FONT,
										fontWeight: safeTextWeight(620),
										fontSize: bandSize,
										color: THEME.background,
										textAlign: 'center',
										paddingLeft: unit * 20,
										paddingRight: unit * 20,
									}}
								>
									{stage.title}
								</span>
								{props.stats.length >= count ? (
									<span
										style={{
											fontFamily: DISPLAY_FONT,
											fontWeight: DISPLAY_WEIGHT,
											fontSize: fitLine(unit * 28, formatStat(props.stats[index], 1), unit * 116),
											color: THEME.background,
										}}
									>
										{formatStat(props.stats[index], drop)}
									</span>
								) : null}
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

	'pyramid-tiers': `
/**
 * A hierarchy built from the base up.
 *
 * Tiers stack with the widest first, each carrying its own label, and the apex
 * lands last with the accent - the shape of a priority list.
 */
const PyramidTiersScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const count = shape === 1 ? 5 : 4
	const tiers = motionItems(props, count)
	const stacked = useStacked()
	// Stacked, the pyramid has the frame to itself and can be wider; beside a
	// caption it has to leave room for one.
	const base = Math.min(width * (stacked ? 0.82 : 0.6), height * 0.8)
	const tierHeight = Math.min(unit * 82, (height * 0.56) / count)
	const inverted = shape === 3

	return (
		<AbsoluteFill>
			<Backdrop seed={46} intensity={0.45} />
			<AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: unit * 44, flexDirection: shape === 2 || stacked ? 'column' : 'row', padding: width * LAYOUT_INSET }}>
				<div style={{ display: 'flex', flexDirection: inverted ? 'column' : 'column-reverse', alignItems: 'center', gap: unit * 6 }}>
					{tiers.map((tier, index) => {
						const ratio = 1 - (index / count) * 0.74
						const rise = interpolate(frame - (10 + index * beat(9)), [0, 24], [0, 1], { ...CLAMP, easing: EASE_OUT })
						// Every tier is a different width by construction, so each one sizes
						// its own label. The narrow end of the pyramid is the tight case.
						const tierSize = fitBlock(unit * 24, tier.title, base * ratio - unit * 22, tierHeight - unit * 16)
						return (
							<div
								key={'tier-' + index}
								style={{
									width: base * ratio,
									flex: '0 0 auto',
									height: tierHeight,
									backgroundColor: withAlpha(index === count - 1 ? THEME.accent : THEME.accentAlt, 0.35 + (index / count) * 0.55),
									border: Math.max(1, unit * 1.4) + 'px solid ' + withAlpha(THEME.ink, 0.16),
									borderRadius: cornerRadius(unit, 0.6),
									display: 'flex',
									alignItems: 'center',
									justifyContent: 'center',
									opacity: rise,
									transform: 'translateY(' + ((1 - rise) * unit * 34).toFixed(1) + 'px) scaleX(' + (0.8 + rise * 0.2).toFixed(3) + ')',
								}}
							>
								<span style={{ fontFamily: TEXT_FONT, fontWeight: safeTextWeight(620), fontSize: tierSize, color: THEME.ink, textAlign: 'center', padding: unit * 10 }}>
									{tier.title}
								</span>
							</div>
						)
					})}
				</div>
				<MotionCaption kicker={props.kicker} headline={props.headline} caption={props.caption} delay={4} align={shape === 2 ? 'center' : 'flex-start'} size={unit * 50} />
			</AbsoluteFill>
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,

	'venn-overlap': `
/**
 * Two or three fields that meet.
 *
 * The circles travel in from the edges and the intersection lights as they
 * settle, with the shared idea printed in the lens.
 */
const VennOverlapScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const circles = shape === 1 ? 3 : 2
	const labels = motionLines(props, circles + 1)
	const close = interpolate(frame, [8, 44], [0, 1], { ...CLAMP, easing: EASE_OUT })
	const radius = Math.min(width, height) * (circles === 3 ? 0.19 : 0.23)
	const spread = radius * (circles === 3 ? 1.05 : 0.86)
	// A ring label never wraps, so it is cut against a little more than the
	// circle it names; the shared idea in the lens does wrap, and is cut to the
	// same box the maxWidth below already imposes on it.
	const ringSize = fitLine(
		unit * 25,
		labels.slice(0, circles).reduce((most, label) => (label.length > most.length ? label : most), ''),
		radius * 2.4,
	)
	const lensSize = fitBlock(unit * 34, labels[circles] || props.headline, radius * 1.4, radius * 1.2)

	return (
		<AbsoluteFill>
			<Backdrop seed={47} intensity={0.45} />
			<AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
				<div style={{ position: 'relative', width: width * 0.7, height: height * 0.6 }}>
					{new Array(circles).fill(0).map((_, index) => {
						/**
						 * Two circles sit left and right, three sit on a triangle. The
						 * old formula started every layout at -90 degrees, which stacked
						 * a pair vertically and pushed the lower label off the frame.
						 */
						const angle = circles === 2 ? (index === 0 ? Math.PI : 0) : (index / circles) * Math.PI * 2 - Math.PI / 2
						const x = width * 0.35 + Math.cos(angle) * spread * close + (1 - close) * Math.cos(angle) * width * 0.3
						const y = height * 0.3 + Math.sin(angle) * spread * close + (1 - close) * Math.sin(angle) * height * 0.3
						const color = index === 0 ? THEME.accent : index === 1 ? THEME.accentAlt : THEME.glow
						return (
							<div key={'venn-' + index} style={{ position: 'absolute', left: x - radius, top: y - radius, width: radius * 2, height: radius * 2 }}>
								<div
									style={{
										width: '100%',
										height: '100%',
										borderRadius: '50%',
										backgroundColor: withAlpha(color, shape === 2 ? 0.2 : 0.36),
										border: Math.max(2, unit * 2.4) + 'px solid ' + withAlpha(color, 0.8),
										mixBlendMode: THEME.scheme === 'light' ? 'multiply' : 'screen',
									}}
								/>
								<span
									style={{
										position: 'absolute',
										left: '50%',
										top: index % 2 === 0 ? -unit * 42 : radius * 2 + unit * 12,
										transform: 'translateX(-50%)',
										fontFamily: TEXT_FONT,
										fontWeight: safeTextWeight(620),
										fontSize: ringSize,
										color: THEME.ink,
										whiteSpace: 'nowrap',
										opacity: close,
									}}
								>
									{labels[index]}
								</span>
							</div>
						)
					})}
					<div
						style={{
							position: 'absolute',
							left: width * 0.35,
							top: height * 0.3,
							transform: 'translate(-50%, -50%)',
							textAlign: 'center',
							maxWidth: radius * 1.4,
							opacity: interpolate(frame, [40, 58], [0, 1], CLAMP),
						}}
					>
						<span style={{ fontFamily: DISPLAY_FONT, fontWeight: DISPLAY_WEIGHT, fontSize: lensSize, color: THEME.ink, lineHeight: 1.1 }}>
							{labels[circles] || props.headline}
						</span>
					</div>
				</div>
			</AbsoluteFill>
			<div style={{ position: 'absolute', left: 0, right: 0, bottom: height * 0.08, display: 'flex', justifyContent: 'center' }}>
				<MicroLabel text={props.caption || props.kicker} delay={50} />
			</div>
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,

	'heat-grid': `
/**
 * A field of cells warming up.
 *
 * Intensity is seeded per cell, the wave sweeps diagonally, and a row and a
 * column are labelled - a matrix without pretending to be a spreadsheet.
 */
const HeatGridScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const columns = shape === 1 ? 10 : 7
	const rows = shape === 1 ? 6 : 5
	const labels = motionLines(props, rows)
	const cell = Math.min((width * 0.6) / columns, (height * 0.56) / rows)
	// The row names are capped at a fifth of the frame and ellipsed past it.
	// Cutting the type to the cap first keeps whole words instead of stumps.
	const rowSize = fitLine(
		unit * 21,
		labels.reduce((most, label) => (label.length > most.length ? label : most), ''),
		width * 0.2,
	)

	return (
		<AbsoluteFill>
			<Backdrop seed={48} intensity={0.4} />
			<AbsoluteFill style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: unit * 34 }}>
				<div style={{ display: 'flex', flexDirection: 'column', gap: unit * 6, alignItems: 'flex-end' }}>
					{labels.map((label, index) => (
						<div
							key={'hlabel-' + index}
							style={{
								height: cell,
								display: 'flex',
								alignItems: 'center',
								fontFamily: TEXT_FONT,
								fontSize: rowSize,
								fontWeight: safeTextWeight(560),
								color: THEME.muted,
								opacity: interpolate(frame - (10 + index * beat(5)), [0, 14], [0, 1], CLAMP),
								maxWidth: width * 0.2,
								overflow: 'hidden',
								whiteSpace: 'nowrap',
								textOverflow: 'ellipsis',
							}}
						>
							{label}
						</div>
					))}
				</div>
				<div style={{ display: 'grid', gridTemplateColumns: 'repeat(' + columns + ', ' + cell + 'px)', gap: unit * 6 }}>
					{new Array(columns * rows).fill(0).map((_, index) => {
						const column = index % columns
						const row = Math.floor(index / columns)
						const heat = mrand('heat-' + index)
						const wake = interpolate(frame - (8 + (column + row) * beat(3)), [0, 18], [0, 1], { ...CLAMP, easing: EASE_OUT })
						return (
							<div
								key={'heat-' + index}
								aria-hidden
								style={{
									width: cell,
									height: cell,
									borderRadius: shape === 2 ? cell / 2 : cornerRadius(unit, 0.5),
									backgroundColor: withAlpha(heat > 0.68 ? THEME.accent : heat > 0.4 ? THEME.accentAlt : THEME.ink, (0.08 + heat * 0.72) * wake),
									transform: 'scale(' + (0.6 + wake * 0.4).toFixed(3) + ')',
								}}
							/>
						)
					})}
				</div>
			</AbsoluteFill>
			<div style={{ position: 'absolute', left: width * LAYOUT_INSET, top: height * 0.08 }}>
				<MotionCaption kicker={props.kicker} headline={props.headline} delay={2} align="flex-start" size={unit * 48} />
			</div>
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,

	'sankey-flow': `
/**
 * Ribbons carrying volume from one column to another.
 *
 * The bands widen with their weight and are drawn on left to right, so a
 * distribution reads as movement between two states.
 */
const SankeyFlowScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const count = shape === 1 ? 5 : 4
	const labels = motionLines(props, count * 2)
	const weights = motionWeights(props, count)
	const total = weights.reduce((sum, value) => sum + value, 0) || 1
	const draw = interpolate(frame, [10, Math.max(46, props.frames * 0.6)], [0, 1], { ...CLAMP, easing: EASE_OUT })
	const left = width * 0.22
	const right = width * 0.78
	const top = height * 0.24
	const span = height * 0.52
	let leftCursor = top
	let rightCursor = top
	// Both columns are the same distance in from their edge, so one size cut to
	// the narrower of the two margins serves every label on the frame.
	const nodeSize = fitLine(
		unit * 21,
		labels.reduce((most, label) => (label.length > most.length ? label : most), ''),
		Math.min(left, width - right) - unit * 46,
	)

	return (
		<AbsoluteFill>
			<Backdrop seed={49} intensity={0.4} />
			<svg width={width} height={height} style={{ position: 'absolute', inset: 0 }} aria-hidden>
				{weights.map((weight, index) => {
					const band = (weight / total) * span
					const y1 = leftCursor + band / 2
					leftCursor += band
					const targetBand = (weights[(index + 1) % count] / total) * span
					const y2 = rightCursor + targetBand / 2
					rightCursor += targetBand
					const mid = (left + right) / 2
					const path =
						'M ' + left + ' ' + y1 + ' C ' + mid + ' ' + y1 + ', ' + mid + ' ' + y2 + ', ' + (left + (right - left) * draw) + ' ' + (y1 + (y2 - y1) * draw)
					return (
						<path
							key={'flow-' + index}
							d={path}
							fill="none"
							stroke={withAlpha(index % 2 === 0 ? THEME.accent : THEME.accentAlt, 0.5)}
							strokeWidth={Math.max(4, band * 0.82)}
							strokeLinecap="butt"
						/>
					)
				})}
			</svg>
			{[0, 1].map((side) => {
				let cursor = top
				return (
					<div key={'col-' + side}>
						{weights.map((weight, index) => {
							const band = (weight / total) * span
							const y = cursor
							cursor += band
							return (
								<div
									key={'node-' + side + '-' + index}
									style={{
										position: 'absolute',
										left: side === 0 ? left - unit * 18 : right,
										top: y,
										width: unit * 18,
										height: Math.max(unit * 10, band - unit * 6),
										backgroundColor: side === 0 ? THEME.accent : THEME.accentAlt,
										borderRadius: cornerRadius(unit, 0.4),
										opacity: interpolate(frame - (6 + index * beat(4)), [0, 14], [0, 1], CLAMP),
									}}
								>
									<span
										style={{
											position: 'absolute',
											left: side === 0 ? undefined : unit * 28,
											right: side === 0 ? unit * 28 : undefined,
											top: '50%',
											transform: 'translateY(-50%)',
											fontFamily: TEXT_FONT,
											fontSize: nodeSize,
											fontWeight: safeTextWeight(560),
											color: THEME.ink,
											whiteSpace: 'nowrap',
											textAlign: side === 0 ? 'right' : 'left',
											// The columns sit a fifth of the way in from each edge,
											// so a long label runs off the frame unless it is
											// bounded to the margin it actually lives in.
											maxWidth: (side === 0 ? left : width - right) - unit * 46,
											overflow: 'hidden',
											textOverflow: 'ellipsis',
										}}
									>
										{labels[side * count + index]}
									</span>
								</div>
							)
						})}
					</div>
				)
			})}
			<div style={{ position: 'absolute', left: 0, right: 0, top: height * 0.08, display: 'flex', justifyContent: 'center' }}>
				<MotionCaption kicker={props.kicker} headline={props.headline} delay={2} size={unit * 48} />
			</div>
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,

	'counter-burst': `
/**
 * One number, the whole frame.
 *
 * The digits roll up on a spring, a ring closes behind them and rays leave the
 * centre on the landing. When the brief carried no number the scene shows its
 * label alone rather than inventing a figure.
 */
const CounterBurstScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height, fps } = useVideoConfig()
	const shape = props.variant % 4
	const stat = props.stats[0]
	const run = spring({ frame: frame - 8, fps, config: { damping: 30, mass: 1.2, stiffness: 60 } })
	const landed = run > 0.985
	const burstAge = frame - 8 - Math.round(fps * 0.9)
	const rays = shape === 1 ? 18 : 12
	const size = Math.min(width, height) * 0.44
	// The figure is measured at its landed value, which is the widest it ever
	// gets: a count-up starts at nought and only grows digits on the way. It has
	// to clear the ring it is set inside, not the frame.
	const figureSize = stat ? fitLine(unit * (shape === 2 ? 130 : 168), formatStat(stat, 1), size * 0.82) : 0

	return (
		<AbsoluteFill>
			<Backdrop seed={50} intensity={0.5} />
			<AbsoluteFill style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: unit * 18 }}>
				<div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', width: size, height: size }}>
					<svg width={size} height={size} style={{ position: 'absolute', overflow: 'visible' }} aria-hidden>
						<circle
							cx={size / 2}
							cy={size / 2}
							r={size * 0.44}
							fill="none"
							stroke={withAlpha(THEME.accent, 0.7)}
							strokeWidth={Math.max(2, unit * 5)}
							strokeDasharray={2 * Math.PI * size * 0.44}
							strokeDashoffset={2 * Math.PI * size * 0.44 * (1 - run)}
							transform={'rotate(-90 ' + size / 2 + ' ' + size / 2 + ')'}
						/>
						{landed && burstAge > 0 && burstAge < 26
							? new Array(rays).fill(0).map((_, index) => {
									const angle = ((index / rays) * 360 * Math.PI) / 180
									const reach = size * (0.46 + burstAge * 0.012)
									return (
										<line
											key={'ray-' + index}
											x1={size / 2 + Math.cos(angle) * size * 0.46}
											y1={size / 2 + Math.sin(angle) * size * 0.46}
											x2={size / 2 + Math.cos(angle) * reach}
											y2={size / 2 + Math.sin(angle) * reach}
											stroke={withAlpha(THEME.accentAlt, Math.max(0, 0.8 - burstAge / 26))}
											strokeWidth={Math.max(2, unit * 4)}
											strokeLinecap="round"
										/>
									)
								})
							: null}
					</svg>
					{stat ? (
						<span
							style={{
								fontFamily: DISPLAY_FONT,
								fontWeight: DISPLAY_WEIGHT,
								fontSize: figureSize,
								lineHeight: 1,
								letterSpacing: trackingFor(figureSize) - unit * 2,
								color: THEME.accent,
								transform: 'scale(' + (0.86 + run * 0.14).toFixed(3) + ')',
							}}
						>
							{formatStat(stat, run)}
						</span>
					) : (
						<MotionGlyph index={props.variant} size={size * 0.6} delay={8} />
					)}
				</div>
				<MotionCaption
					headline={stat ? stat.label || props.headline : props.headline}
					caption={props.caption}
					delay={26}
					size={unit * 52}
				/>
			</AbsoluteFill>
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,
} as const
