/**
 * Narrative motion scenes.
 *
 * Ten pieces that stage a rhetorical move: opposition, before-and-after,
 * verification, dialogue, tiers, endorsement walls, countdowns, calendars,
 * banners and a punch through nested frames.
 *
 * Emitted verbatim into the generated TSX: no backticks, no dollar-braces.
 */

export const STORY_SCENES = {
	'versus-clash': `
/**
 * Two positions slammed together.
 *
 * The halves arrive from opposite edges, meet on the beat, and a badge lands in
 * the seam. The frame kicks on impact so the collision is felt.
 */
const VersusClashScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height, fps } = useVideoConfig()
	const shape = props.variant % 4
	const sides = motionLines(props, 2)
	const details = motionItems(props, 2)
	const slam = spring({ frame: frame - 8, fps, config: { damping: 15, mass: 0.8, stiffness: 180 } })
	const impact = frame - 8 - Math.round(fps * 0.4)
	const kick = impact > 0 && impact < 8 ? Math.sin(impact * 1.7) * unit * (8 - impact) : 0
	const vertical = shape === 1
	// Each half is a column with padding, so the type is fitted to that column.
	const sideSize = fitStack(unit * 62, sides, (vertical ? width : width / 2) * 0.78, (vertical ? height / 2 : height) * 0.5)
	// The blurb under each name was capped at a fixed 420 units, which is wider
	// than a half-frame column on a portrait cut. It gets the column instead.
	const halfWidth = (vertical ? width : width / 2) * 0.78
	const blurbSize = fitBlock(
		unit * 24,
		details.reduce((most, item) => ((item.detail || '').length > most.length ? item.detail : most), ''),
		halfWidth,
		(vertical ? height / 2 : height) * 0.24,
	)

	return (
		<AbsoluteFill style={{ overflow: 'hidden', transform: 'translate(' + kick.toFixed(2) + 'px, ' + (kick * -0.4).toFixed(2) + 'px)' }}>
			<Backdrop seed={51} intensity={0.4} />
			<AbsoluteFill style={{ display: 'flex', flexDirection: vertical ? 'column' : 'row' }}>
				{[0, 1].map((side) => {
					const away = side === 0 ? -1 : 1
					const travel = (1 - slam) * away * (vertical ? height : width) * 0.8
					return (
						<div
							key={'side-' + side}
							style={{
								flex: 1,
								backgroundColor: side === 0 ? withAlpha(THEME.accent, 0.9) : shade(THEME.background, -0.1),
								display: 'flex',
								flexDirection: 'column',
								alignItems: 'center',
								justifyContent: 'center',
								gap: unit * 16,
								padding: unit * 40,
								transform: vertical ? 'translateY(' + travel.toFixed(1) + 'px)' : 'translateX(' + travel.toFixed(1) + 'px)',
								clipPath: shape === 2 && !vertical ? (side === 0 ? 'polygon(0 0, 100% 0, 88% 100%, 0 100%)' : 'polygon(12% 0, 100% 0, 100% 100%, 0 100%)') : undefined,
							}}
						>
							<span
								style={{
									fontFamily: DISPLAY_FONT,
									fontWeight: DISPLAY_WEIGHT,
									fontSize: sideSize,
									lineHeight: 1.06,
									letterSpacing: trackingFor(sideSize),
									color: side === 0 ? THEME.background : THEME.ink,
									textAlign: 'center',
									textTransform: TYPE_KEEPS_CASE ? 'none' : 'uppercase',
								}}
							>
								{sides[side]}
							</span>
							{details[side] && details[side].detail ? (
								<span style={{ fontFamily: TEXT_FONT, fontSize: blurbSize, color: side === 0 ? withAlpha(THEME.background, 0.85) : THEME.muted, textAlign: 'center', maxWidth: halfWidth }}>
									{details[side].detail}
								</span>
							) : null}
						</div>
					)
				})}
			</AbsoluteFill>
			<AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
				<div
					style={{
						width: unit * 130,
						height: unit * 130,
						borderRadius: shape === 3 ? cornerRadius(unit) : unit * 200,
						backgroundColor: THEME.background,
						border: Math.max(3, unit * 5) + 'px solid ' + THEME.accentAlt,
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
						transform: 'scale(' + Math.max(0, (frame - 8 - fps * 0.3) / 8 > 1 ? 1 : Math.max(0, (frame - 8 - fps * 0.3) / 8)).toFixed(3) + ') rotate(' + (shape === 0 ? -8 : 0) + 'deg)',
						boxShadow: '0 ' + unit * 16 + 'px ' + unit * 40 + 'px ' + withAlpha('#000000', 0.4),
					}}
				>
					<span style={{ fontFamily: DISPLAY_FONT, fontWeight: DISPLAY_WEIGHT, fontSize: unit * 44, color: THEME.accentAlt, letterSpacing: unit * 2 }}>
						VS
					</span>
				</div>
			</AbsoluteFill>
			<div style={{ position: 'absolute', left: 0, right: 0, bottom: height * 0.06, display: 'flex', justifyContent: 'center' }}>
				<MicroLabel text={props.headline} delay={30} />
			</div>
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,

	'comparison-slider': `
/**
 * One frame, two states, a wiping divider.
 *
 * The handle travels across and the panel behind it changes - the standard
 * before-and-after device, done with a hard edge and a labelled grip.
 */
const ComparisonSliderScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const sides = motionLines(props, 2)
	const travel = interpolate(frame, [10, Math.max(48, props.frames * 0.72)], [0.14, 0.86], { ...CLAMP, easing: EASE_OUT })
	const wobble = shape === 1 ? Math.sin(frame / 34) * 0.03 : 0
	const at = Math.min(0.92, Math.max(0.08, travel + wobble))
	// Each state is confined to its own half, so the type is fitted to that half
	// rather than to the whole frame.
	const stateSize = fitStack(unit * 76, sides, width * 0.4, height * 0.5)

	return (
		<AbsoluteFill style={{ overflow: 'hidden' }}>
			{/*
			 * The two states are anchored to opposite margins rather than both to
			 * the centre. Centred, they printed on top of one another and the
			 * wipe read as one word corrupting into another.
			 */}
			<AbsoluteFill
				style={{
					backgroundColor: shade(THEME.background, -0.12),
					display: 'flex',
					// AbsoluteFill lays out as a column, so the cross axis is the
					// horizontal one. Anchoring with justifyContent put the two
					// states above and below each other instead of side by side.
					flexDirection: 'row',
					alignItems: 'center',
					justifyContent: 'flex-end',
					paddingRight: width * 0.08,
				}}
			>
				<div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: unit * 10, maxWidth: width * 0.42 }}>
					<span style={{ fontFamily: TEXT_FONT, fontSize: unit * 22, letterSpacing: unit * 3, color: THEME.muted, textTransform: 'uppercase' }}>
						after
					</span>
					<span
						style={{
							fontFamily: DISPLAY_FONT,
							fontWeight: DISPLAY_WEIGHT,
							fontSize: stateSize,
							lineHeight: 1.06,
							color: withAlpha(THEME.ink, 0.86),
							textTransform: TYPE_KEEPS_CASE ? 'none' : 'uppercase',
							textAlign: 'right',
						}}
					>
						{sides[1]}
					</span>
				</div>
			</AbsoluteFill>
			<AbsoluteFill
				style={{
					backgroundColor: withAlpha(THEME.accent, 0.92),
					display: 'flex',
					flexDirection: 'row',
					alignItems: 'center',
					justifyContent: 'flex-start',
					paddingLeft: width * 0.08,
					clipPath: 'inset(0 ' + ((1 - at) * 100).toFixed(2) + '% 0 0)',
				}}
			>
				<div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: unit * 10, maxWidth: width * 0.42 }}>
					<span style={{ fontFamily: TEXT_FONT, fontSize: unit * 22, letterSpacing: unit * 3, color: withAlpha(THEME.background, 0.8), textTransform: 'uppercase' }}>
						before
					</span>
					<span
						style={{
							fontFamily: DISPLAY_FONT,
							fontWeight: DISPLAY_WEIGHT,
							fontSize: stateSize,
							lineHeight: 1.06,
							color: THEME.background,
							textTransform: TYPE_KEEPS_CASE ? 'none' : 'uppercase',
							textAlign: 'left',
						}}
					>
						{sides[0]}
					</span>
				</div>
			</AbsoluteFill>
			<div
				style={{
					position: 'absolute',
					left: at * width,
					top: 0,
					bottom: 0,
					width: Math.max(3, unit * 5),
					backgroundColor: THEME.background,
					boxShadow: '0 0 ' + unit * 24 + 'px ' + withAlpha('#000000', 0.4),
				}}
			>
				<div
					style={{
						position: 'absolute',
						left: '50%',
						top: '50%',
						transform: 'translate(-50%, -50%)',
						width: unit * 74,
						height: unit * 74,
						borderRadius: unit * 100,
						backgroundColor: THEME.background,
						border: Math.max(2, unit * 3) + 'px solid ' + THEME.accentAlt,
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
						gap: unit * 6,
					}}
				>
					<span style={{ fontFamily: DISPLAY_FONT, fontWeight: DISPLAY_WEIGHT, fontSize: unit * 30, color: THEME.accentAlt }}>
						{shape === 2 ? '<>' : '||'}
					</span>
				</div>
			</div>
			<div style={{ position: 'absolute', left: 0, right: 0, top: height * 0.08, display: 'flex', justifyContent: 'center' }}>
				<MotionCaption kicker={props.kicker} headline={props.headline} delay={2} size={unit * 44} />
			</div>
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,

	'checklist-tick': `
/**
 * Items being verified one by one.
 *
 * A box, a drawn tick, a rule struck through the line. The pace is the point:
 * this scene turns a list into a decision being made.
 */
const ChecklistTickScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const rows = motionItems(props, shape === 1 ? 6 : 4)
	const step = Math.max(10, (props.frames * 0.68) / rows.length)
	// A struck-through row has to stay on one line - the rule is drawn across the
	// box, so a wrapped row would be crossed out through the middle of itself.
	const rowSize = fitLine(
		unit * 42,
		rows.reduce((most, row) => (row.title.length > most.length ? row.title : most), ''),
		width * (1 - LAYOUT_INSET * 2) - unit * 66,
	)

	return (
		<AbsoluteFill>
			<Backdrop seed={52} intensity={0.5} />
			<AbsoluteFill style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: width * LAYOUT_INSET, gap: unit * 18 }}>
				<MotionCaption kicker={props.kicker} headline={props.headline} delay={2} align="flex-start" size={unit * 52} />
				<div style={{ display: 'flex', flexDirection: 'column', gap: unit * 14, marginTop: unit * 14 }}>
					{rows.map((row, index) => {
						const start = 14 + index * step
						const tick = interpolate(frame - start, [0, 16], [0, 1], { ...CLAMP, easing: EASE_OUT })
						const strike = interpolate(frame - start - 8, [0, 14], [0, 1], CLAMP)
						const enter = interpolate(frame - (index * beat(5)), [0, 16], [0, 1], { ...CLAMP, easing: EASE_OUT })
						return (
							<div
								key={'check-' + index}
								style={{
									display: 'flex',
									alignItems: 'center',
									gap: unit * 20,
									opacity: enter,
									transform: 'translateX(' + ((1 - enter) * -unit * 30).toFixed(1) + 'px)',
								}}
							>
								<div
									style={{
										width: unit * 46,
										height: unit * 46,
										flex: '0 0 auto',
										borderRadius: shape === 3 ? unit * 60 : cornerRadius(unit, 0.6),
										border: Math.max(2, unit * 3) + 'px solid ' + (tick > 0.5 ? THEME.accent : withAlpha(THEME.ink, 0.34)),
										backgroundColor: tick > 0.5 ? withAlpha(THEME.accent, 0.18) : 'transparent',
										display: 'flex',
										alignItems: 'center',
										justifyContent: 'center',
									}}
								>
									<svg width={unit * 30} height={unit * 30} viewBox="0 0 24 24" aria-hidden>
										<path
											d="M4 12.5 L9.5 18 L20 6"
											fill="none"
											stroke={THEME.accent}
											strokeWidth="3"
											strokeLinecap="round"
											strokeLinejoin="round"
											strokeDasharray={28}
											strokeDashoffset={28 * (1 - tick)}
										/>
									</svg>
								</div>
								<div style={{ position: 'relative' }}>
									<span
										style={{
											fontFamily: DISPLAY_FONT,
											fontWeight: Math.max(500, DISPLAY_WEIGHT - 180),
											fontSize: rowSize,
											color: strike > 0.6 ? THEME.muted : THEME.ink,
											lineHeight: 1.2,
										}}
									>
										{row.title}
									</span>
									{shape !== 2 ? (
										<div
											style={{
												position: 'absolute',
												left: 0,
												right: 0,
												top: '54%',
												height: Math.max(2, unit * 3),
												backgroundColor: withAlpha(THEME.accent, 0.7),
												transformOrigin: 'left',
												transform: 'scaleX(' + strike.toFixed(3) + ')',
											}}
										/>
									) : null}
								</div>
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

	'qa-bubbles': `
/**
 * A conversation arriving line by line.
 *
 * Alternating bubbles with tails, a typing indicator between them, staggered by
 * the house tempo. Turns an argument into an exchange.
 */
const QaBubblesScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const lines = motionLines(props, shape === 1 ? 5 : 4)
	const step = Math.max(14, (props.frames * 0.72) / lines.length)
	// Bubbles stack down the frame, so each one owns a share of the column height
	// as well as the width it is capped at. One size for the whole thread - a
	// conversation set in mixed sizes reads as a rendering fault.
	const bubbleSize = fitBlock(
		unit * 29,
		lines.reduce((most, line) => (line.length > most.length ? line : most), ''),
		width * 0.56 - unit * 60,
		(height * 0.78) / lines.length - unit * 62,
	)

	return (
		<AbsoluteFill>
			<Backdrop seed={53} intensity={0.5} />
			<AbsoluteFill style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: width * LAYOUT_INSET, gap: unit * 16 }}>
				{lines.map((line, index) => {
					const mine = index % 2 === 1
					const start = 8 + index * step
					const pop = interpolate(frame - start, [0, 18], [0, 1], { ...CLAMP, easing: EASE_OUT })
					if (frame < start - 6) return null
					return (
						<div key={'bubble-' + index} style={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start' }}>
							<div
								style={{
									position: 'relative',
									maxWidth: width * 0.56,
									padding: unit * 24,
									paddingLeft: unit * 30,
									paddingRight: unit * 30,
									borderRadius: unit * (shape === 3 ? 16 : 40),
									borderBottomRightRadius: mine ? unit * 8 : undefined,
									borderBottomLeftRadius: mine ? undefined : unit * 8,
									backgroundColor: mine ? THEME.accent : withAlpha(THEME.surface, 0.92),
									border: mine ? undefined : Math.max(1, unit * 1.4) + 'px solid ' + withAlpha(THEME.ink, 0.14),
									opacity: pop,
									transform: 'translateY(' + ((1 - pop) * unit * 26).toFixed(1) + 'px) scale(' + (0.9 + pop * 0.1).toFixed(3) + ')',
									boxShadow: '0 ' + unit * 12 + 'px ' + unit * 30 + 'px ' + withAlpha('#000000', 0.2),
								}}
							>
								<span
									style={{
										fontFamily: TEXT_FONT,
										fontSize: bubbleSize,
										fontWeight: safeTextWeight(520),
										lineHeight: 1.4,
										color: mine ? THEME.background : THEME.ink,
									}}
								>
									{line}
								</span>
							</div>
						</div>
					)
				})}
				<div style={{ display: 'flex', gap: unit * 8, opacity: interpolate(frame, [lines.length * step, lines.length * step + 12], [0, 1], CLAMP) }}>
					{[0, 1, 2].map((dot) => (
						<div
							key={'typing-' + dot}
							style={{
								width: unit * 12,
								height: unit * 12,
								borderRadius: unit * 12,
								backgroundColor: THEME.muted,
								transform: 'translateY(' + (Math.sin(frame / 6 + dot) * unit * 4).toFixed(2) + 'px)',
							}}
						/>
					))}
				</div>
			</AbsoluteFill>
			<div style={{ position: 'absolute', left: width * LAYOUT_INSET, top: height * 0.07 }}>
				<MotionCaption kicker={props.kicker} headline={props.headline} delay={2} align="flex-start" size={unit * 44} />
			</div>
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,

	'price-tiers': `
/**
 * Options laid side by side with one raised.
 *
 * Columns rise in sequence, the recommended one taller and warmer, each with a
 * feature run under a rule. A choice, presented.
 */
const PriceTiersScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const count = shape === 1 ? 4 : 3
	const tiers = motionItems(props, count)
	const featured = shape === 2 ? 0 : Math.floor(count / 2)
	// A card is one of three or four columns capped at just over a quarter of the
	// frame, and everything in it - name, blurb, figure - shares that width.
	const card = Math.min(width * 0.28, (width * (1 - LAYOUT_INSET * 2) - unit * 18 * (count - 1)) / count) - unit * 52
	const nameSize = fitBlock(
		unit * 34,
		tiers.reduce((most, tier) => (tier.title.length > most.length ? tier.title : most), ''),
		card,
		height * 0.14,
	)
	const blurbSize = fitBlock(
		unit * 22,
		tiers.reduce((most, tier) => ((tier.detail || '').length > most.length ? tier.detail : most), ''),
		card,
		height * 0.2,
	)
	const priceSize = fitLine(
		unit * 44,
		props.stats.slice(0, count).reduce((most, stat) => {
			const shown = formatStat(stat, 1)
			return shown.length > most.length ? shown : most
		}, ''),
		card,
	)

	return (
		<AbsoluteFill>
			<Backdrop seed={54} intensity={0.45} />
			<AbsoluteFill style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: unit * 28, padding: width * LAYOUT_INSET }}>
				<MotionCaption kicker={props.kicker} headline={props.headline} delay={2} size={unit * 50} />
				<div style={{ display: 'flex', alignItems: 'stretch', gap: unit * 18, width: '100%', justifyContent: 'center' }}>
					{tiers.map((tier, index) => {
						const rise = interpolate(frame - (12 + index * beat(8)), [0, 24], [0, 1], { ...CLAMP, easing: EASE_OUT })
						const hero = index === featured
						return (
							<div
								key={'tier-' + index}
								style={{
									flex: 1,
									maxWidth: width * 0.28,
									padding: unit * 26,
									paddingTop: hero ? unit * 40 : unit * 26,
									paddingBottom: hero ? unit * 40 : unit * 26,
									borderRadius: cornerRadius(unit, 1.2),
									backgroundColor: hero ? THEME.accent : withAlpha(THEME.surface, 0.9),
									border: Math.max(1, unit * 1.6) + 'px solid ' + withAlpha(hero ? THEME.accent : THEME.ink, hero ? 0.9 : 0.14),
									display: 'flex',
									flexDirection: 'column',
									gap: unit * 14,
									opacity: rise,
									transform: 'translateY(' + ((1 - rise) * unit * 40).toFixed(1) + 'px)',
									boxShadow: hero ? '0 ' + unit * 26 + 'px ' + unit * 56 + 'px ' + withAlpha('#000000', 0.34) : undefined,
								}}
							>
								<VectorIcon name={tier.icon} size={unit * 34} color={hero ? THEME.background : THEME.accent} strokeWidth={1.9} />
								<span
									style={{
										fontFamily: DISPLAY_FONT,
										fontWeight: DISPLAY_WEIGHT,
										fontSize: nameSize,
										lineHeight: 1.14,
										color: hero ? THEME.background : THEME.ink,
									}}
								>
									{tier.title}
								</span>
								<div style={{ height: Math.max(1, unit * 1.4), backgroundColor: withAlpha(hero ? THEME.background : THEME.ink, 0.24), transformOrigin: 'left', transform: 'scaleX(' + rise.toFixed(3) + ')' }} />
								{tier.detail ? (
									<span style={{ fontFamily: TEXT_FONT, fontSize: blurbSize, lineHeight: 1.4, color: hero ? withAlpha(THEME.background, 0.9) : THEME.muted }}>
										{tier.detail}
									</span>
								) : null}
								{props.stats[index] ? (
									<span style={{ fontFamily: DISPLAY_FONT, fontWeight: DISPLAY_WEIGHT, fontSize: priceSize, color: hero ? THEME.background : THEME.accent, marginTop: 'auto' }}>
										{formatStat(props.stats[index], rise)}
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

	'logo-wall': `
/**
 * A wall of marks.
 *
 * Abstract badges rather than borrowed logos - each cell draws a seeded glyph
 * with its label. Reads as coverage, membership or a roster.
 */
const LogoWallScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const columns = shape === 1 ? 5 : 4
	const cells = motionItems(props, columns * (shape === 3 ? 3 : 2))
	// The cell ellipsed anything past 86 per cent of its width, which turned a
	// four-word name into two words and a stub. Cutting the type instead keeps
	// the whole name, and the overflow rule stays as a backstop.
	const cell = (width * (1 - LAYOUT_INSET * 2) - unit * 16 * (columns - 1)) / columns
	const markSize = fitLine(
		unit * 20,
		cells.reduce((most, entry) => (entry.title.length > most.length ? entry.title : most), ''),
		cell * 0.86,
	)

	return (
		<AbsoluteFill>
			<Backdrop seed={55} intensity={0.45} />
			<AbsoluteFill style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: unit * 30, padding: width * LAYOUT_INSET }}>
				<MotionCaption kicker={props.kicker} headline={props.headline} delay={2} size={unit * 48} />
				<div style={{ display: 'grid', gridTemplateColumns: 'repeat(' + columns + ', 1fr)', gap: unit * 16, width: '100%' }}>
					{cells.map((cell, index) => {
						const pop = interpolate(frame - (12 + mpick('wall-' + index, 14) * beat(3)), [0, 18], [0, 1], { ...CLAMP, easing: EASE_OUT })
						return (
							<div
								key={'mark-' + index}
								style={{
									height: height * 0.16,
									borderRadius: cornerRadius(unit),
									border: Math.max(1, unit * 1.4) + 'px solid ' + withAlpha(THEME.ink, 0.14),
									backgroundColor: withAlpha(THEME.surface, 0.7),
									display: 'flex',
									flexDirection: 'column',
									alignItems: 'center',
									justifyContent: 'center',
									gap: unit * 8,
									opacity: pop,
									transform: 'scale(' + (0.8 + pop * 0.2).toFixed(3) + ')',
								}}
							>
								<MotionGlyph index={index + props.variant} size={unit * 44} delay={12 + index * 2} color={index % 3 === 0 ? THEME.accent : THEME.accentAlt} />
								<span
									style={{
										fontFamily: DISPLAY_FONT,
										fontWeight: DISPLAY_WEIGHT,
										fontSize: markSize,
										letterSpacing: unit * 1.6,
										color: THEME.ink,
										textTransform: TYPE_KEEPS_CASE ? 'none' : 'uppercase',
										maxWidth: '86%',
										overflow: 'hidden',
										whiteSpace: 'nowrap',
										textOverflow: 'ellipsis',
									}}
								>
									{cell.title}
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

	'countdown-clock': `
/**
 * A number falling toward a moment.
 *
 * Each count lands with a ring closing behind it, then cuts. The final card
 * holds on the headline instead of a number, so the scene resolves into the
 * point rather than into zero.
 */
const CountdownClockScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const steps = shape === 1 ? 5 : 3
	const beatFrames = Math.max(12, (props.frames * 0.72) / (steps + 1))
	const index = Math.min(steps, Math.floor(frame / beatFrames))
	const local = frame - index * beatFrames
	const pop = interpolate(local, [0, 9], [0, 1], { ...CLAMP, easing: EASE_OUT })
	const size = Math.min(width, height) * 0.46
	const done = index >= steps

	return (
		<AbsoluteFill>
			<Backdrop seed={56} intensity={0.5} />
			<AbsoluteFill style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: unit * 20 }}>
				<div style={{ position: 'relative', width: size, height: size, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
					<svg width={size} height={size} style={{ position: 'absolute' }} aria-hidden>
						<circle cx={size / 2} cy={size / 2} r={size * 0.44} fill="none" stroke={withAlpha(THEME.ink, 0.12)} strokeWidth={Math.max(2, unit * 5)} />
						<circle
							cx={size / 2}
							cy={size / 2}
							r={size * 0.44}
							fill="none"
							stroke={done ? THEME.accentAlt : THEME.accent}
							strokeWidth={Math.max(2, unit * 5)}
							strokeLinecap="round"
							strokeDasharray={2 * Math.PI * size * 0.44}
							strokeDashoffset={2 * Math.PI * size * 0.44 * (1 - Math.min(1, local / beatFrames))}
							transform={'rotate(-90 ' + size / 2 + ' ' + size / 2 + ')'}
						/>
					</svg>
					{done ? (
						<span
							style={{
								fontFamily: DISPLAY_FONT,
								fontWeight: DISPLAY_WEIGHT,
								fontSize: fitLine(unit * 54, props.headline, size * 1.5),
								textAlign: 'center',
								color: THEME.accent,
								maxWidth: size * 0.82,
								lineHeight: 1.08,
								opacity: pop,
								textTransform: TYPE_KEEPS_CASE ? 'none' : 'uppercase',
							}}
						>
							{props.headline}
						</span>
					) : (
						<span
							style={{
								fontFamily: DISPLAY_FONT,
								fontWeight: DISPLAY_WEIGHT,
								fontSize: unit * 190,
								lineHeight: 1,
								color: THEME.ink,
								transform: 'scale(' + (1.5 - pop * 0.5).toFixed(3) + ')',
								opacity: Math.min(1, pop * 1.6),
							}}
						>
							{steps - index}
						</span>
					)}
				</div>
				<MicroLabel text={done ? props.caption : props.kicker || props.caption} delay={0} />
			</AbsoluteFill>
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,

	'calendar-flip': `
/**
 * Split-flap boards turning over.
 *
 * Each tile rotates on its horizontal seam with a hinge shadow, landing on the
 * next label. Reads as departure boards, schedules and dates.
 */
const CalendarFlipScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const tiles = shape === 1 ? 4 : 3
	const faces = motionLines(props, tiles * 2)
	const cycle = Math.max(16, props.frames / 3.4)
	// Every flap shows every face in turn, so one size cut to the longest of them
	// keeps the board steady - a tile that resized as it landed would undo the
	// split-flap illusion.
	const faceSize = fitBlock(
		unit * 34,
		faces.reduce((most, face) => (face.length > most.length ? face : most), ''),
		width * (shape === 1 ? 0.16 : 0.2) - unit * 32,
		height * 0.26 - unit * 32,
	)

	return (
		<AbsoluteFill>
			<Backdrop seed={57} intensity={0.45} />
			<AbsoluteFill style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: unit * 26 }}>
				<div style={{ display: 'flex', gap: unit * 14, perspective: width + 'px' }}>
					{new Array(tiles).fill(0).map((_, index) => {
						const offset = index * beat(6)
						const elapsed = Math.max(0, frame - offset)
						const phase = (elapsed % cycle) / cycle
						/**
						 * A hinge, not a spin. Rotating the whole tile through 180
						 * degrees leaves it edge-on for the rest of the cycle, so the
						 * board reads as blank; folding to nothing and back is what a
						 * split-flap actually does.
						 */
						const fold = phase < 0.14 ? 1 - phase / 0.14 : phase < 0.28 ? (phase - 0.14) / 0.14 : 1
						const turn = Math.floor(elapsed / cycle) + (phase >= 0.14 ? 1 : 0)
						const face = faces[(index + turn) % faces.length]
						return (
							<div
								key={'flap-' + index}
								style={{
									width: width * (shape === 1 ? 0.16 : 0.2),
									height: height * 0.26,
									position: 'relative',
									transformOrigin: 'center center',
									transform: 'scaleY(' + Math.max(0.02, fold).toFixed(3) + ')',
								}}
							>
								<div
									style={{
										position: 'absolute',
										inset: 0,
										borderRadius: cornerRadius(unit),
										backgroundColor: index % 2 === 0 ? withAlpha(THEME.surface, 0.95) : withAlpha(THEME.accent, 0.9),
										border: Math.max(1, unit * 1.6) + 'px solid ' + withAlpha(THEME.ink, 0.2),
										display: 'flex',
										alignItems: 'center',
										justifyContent: 'center',
										padding: unit * 14,
										boxShadow: '0 ' + unit * 16 + 'px ' + unit * 34 + 'px ' + withAlpha('#000000', 0.3),
									}}
								>
									<span
										style={{
											fontFamily: DISPLAY_FONT,
											fontWeight: DISPLAY_WEIGHT,
											fontSize: faceSize,
											lineHeight: 1.1,
											color: index % 2 === 0 ? THEME.ink : THEME.background,
											textAlign: 'center',
											textTransform: TYPE_KEEPS_CASE ? 'none' : 'uppercase',
										}}
									>
										{face}
									</span>
								</div>
								<div
									aria-hidden
									style={{
										position: 'absolute',
										left: 0,
										right: 0,
										top: '50%',
										height: Math.max(1, unit * 2),
										backgroundColor: withAlpha('#000000', 0.35),
									}}
								/>
							</div>
						)
					})}
				</div>
				<MotionCaption kicker={props.kicker} headline={props.headline} caption={props.caption} delay={16} size={unit * 48} />
			</AbsoluteFill>
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,

	'ribbon-banner': `
/**
 * A banner unrolling across the frame.
 *
 * The ribbon opens from its centre with folded ends and the title is revealed
 * as it passes. Ceremonial without being a lower third.
 */
const RibbonBannerScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const open = interpolate(frame, [6, 40], [0, 1], { ...CLAMP, easing: EASE_OUT })
	const rows = motionLines(props, 2)
	const bannerHeight = height * (shape === 1 ? 0.3 : 0.22)
	const tilt = shape === 2 ? -5 : 0
	// The ribbon opens to 92 per cent of the frame and the title never wraps, so
	// that opened width, less the folded ends, is the whole budget.
	const titleSize = fitLine(unit * 74, rows[0] || '', width * 0.92 - unit * 60)

	return (
		<AbsoluteFill>
			<Backdrop seed={58} intensity={0.5} />
			<AbsoluteFill style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: unit * 26 }}>
				<div style={{ position: 'relative', width: '100%', height: bannerHeight, transform: 'rotate(' + tilt + 'deg)' }}>
					<div
						style={{
							position: 'absolute',
							left: '50%',
							top: 0,
							bottom: 0,
							width: (open * 92).toFixed(2) + '%',
							transform: 'translateX(-50%)',
							backgroundColor: THEME.accent,
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center',
							overflow: 'hidden',
							boxShadow: '0 ' + unit * 16 + 'px ' + unit * 40 + 'px ' + withAlpha('#000000', 0.32),
						}}
					>
						<span
							style={{
								fontFamily: DISPLAY_FONT,
								fontWeight: DISPLAY_WEIGHT,
								fontSize: titleSize,
								letterSpacing: trackingFor(titleSize) + unit,
								color: THEME.background,
								whiteSpace: 'nowrap',
								opacity: interpolate(open, [0.55, 0.95], [0, 1], CLAMP),
								textTransform: TYPE_KEEPS_CASE ? 'none' : 'uppercase',
							}}
						>
							{rows[0]}
						</span>
					</div>
					{[0, 1].map((side) => (
						<div
							key={'tail-' + side}
							aria-hidden
							style={{
								position: 'absolute',
								top: bannerHeight * 0.16,
								height: bannerHeight * 0.68,
								width: bannerHeight * 0.42,
								left: side === 0 ? 'calc(50% - ' + (open * 46).toFixed(2) + '% - ' + bannerHeight * 0.36 + 'px)' : undefined,
								right: side === 1 ? 'calc(50% - ' + (open * 46).toFixed(2) + '% - ' + bannerHeight * 0.36 + 'px)' : undefined,
								backgroundColor: shade(THEME.accent, 0.3),
								clipPath: side === 0 ? 'polygon(0 0, 100% 12%, 100% 88%, 0 100%)' : 'polygon(0 12%, 100% 0, 100% 100%, 0 88%)',
								opacity: open,
							}}
						/>
					))}
				</div>
				<Copy text={rows[1] || props.caption} delay={44} size={unit * 30} />
			</AbsoluteFill>
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,

	'zoom-punch': `
/**
 * Nested frames punched through one at a time.
 *
 * The camera drives into a stack of plates and each one holds a fragment as it
 * passes. Speed with structure, which is what a montage cut usually lacks.
 */
const ZoomPunchScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const plates = motionLines(props, shape === 1 ? 5 : 4)
	const perPlate = Math.max(14, props.frames / (plates.length + 0.6))
	// A plate is punched through at up to 3.4x, so it is fitted small: the size
	// here is what it reads at before the camera drives into it.
	const plateSize = fitLine(
		unit * 60,
		plates.reduce((most, line) => (line.length > most.length ? line : most), ''),
		width * 0.62,
	)

	return (
		<AbsoluteFill style={{ overflow: 'hidden' }}>
			<Backdrop seed={59} intensity={0.45} />
			<AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
				{plates.map((plate, index) => {
					const local = frame - index * perPlate
					if (local < -perPlate) return null
					const zoom = interpolate(local, [0, perPlate * 1.6], [0.34, 3.4], CLAMP)
					const fade = interpolate(local, [0, 8, perPlate * 1.1, perPlate * 1.5], [0, 1, 1, 0], CLAMP)
					if (fade <= 0) return null
					return (
						<div
							key={'plate-' + index}
							style={{
								position: 'absolute',
								padding: unit * 34,
								paddingLeft: unit * 54,
								paddingRight: unit * 54,
								borderRadius: cornerRadius(unit),
								border: Math.max(2, unit * 3) + 'px solid ' + withAlpha(index % 2 === 0 ? THEME.accent : THEME.accentAlt, 0.8),
								backgroundColor: withAlpha(THEME.background, shape === 2 ? 0.2 : 0.62),
								transform: 'scale(' + zoom.toFixed(3) + ') rotate(' + (shape === 3 ? (index % 2 === 0 ? -3 : 3) : 0) + 'deg)',
								opacity: fade,
								maxWidth: width * 0.7,
							}}
						>
							<span
								style={{
									fontFamily: DISPLAY_FONT,
									fontWeight: DISPLAY_WEIGHT,
									fontSize: plateSize,
									lineHeight: 1.08,
									letterSpacing: trackingFor(plateSize),
									color: THEME.ink,
									textAlign: 'center',
									display: 'block',
									textTransform: TYPE_KEEPS_CASE ? 'none' : 'uppercase',
								}}
							>
								{plate}
							</span>
						</div>
					)
				})}
			</AbsoluteFill>
			<div style={{ position: 'absolute', left: 0, right: 0, bottom: height * 0.07, display: 'flex', justifyContent: 'center' }}>
				<MicroLabel text={props.caption || props.kicker} delay={10} />
			</div>
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,
} as const
