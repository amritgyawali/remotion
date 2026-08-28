/**
 * Framed motion scenes.
 *
 * Ten pieces that borrow a real object's furniture - a spotlight, a film strip,
 * a slate, a terminal, a browser, a phone, a device wall, a glyph rain, a paper
 * collage, a parallax stage - and animate inside it.
 *
 * Emitted verbatim into the generated TSX: no backticks, no dollar-braces.
 */

export const FRAME_SCENES = {
	'spotlight-reveal': `
/**
 * A dark stage and a light that finds the words.
 *
 * The beam travels a seeded path; type outside it is barely present, type
 * inside it is fully lit. Nothing fades - the reveal is positional.
 */
const SpotlightRevealScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const rows = motionLines(props, 3)
	const sweep = interpolate(frame, [0, props.frames], [0, 1], CLAMP)
	const beamX = shape === 1 ? width * (0.5 + Math.sin(sweep * Math.PI * 1.4) * 0.3) : width * (0.18 + sweep * 0.64)
	const beamY = shape === 2 ? height * (0.34 + Math.sin(sweep * Math.PI * 2) * 0.2) : height * 0.5
	const radius = Math.min(width, height) * (shape === 3 ? 0.24 : 0.32)
	// The beam only lights part of the frame, so the block has to be small enough
	// to sit inside it rather than spilling into the dark.
	const lit = fitStack(unit * 96, rows, width * 0.74, height * 0.56)

	return (
		<AbsoluteFill style={{ backgroundColor: motionStage(0.45) }}>
			<AbsoluteFill
				style={{
					background:
						'radial-gradient(circle ' + radius.toFixed(0) + 'px at ' + beamX.toFixed(0) + 'px ' + beamY.toFixed(0) + 'px, ' +
						withAlpha(THEME.glow, 0.34) + ', transparent 72%)',
				}}
			/>
			<AbsoluteFill
				style={{
					display: 'flex',
					flexDirection: 'column',
					alignItems: 'center',
					justifyContent: 'center',
					gap: unit * 12,
					maskImage:
						'radial-gradient(circle ' + (radius * 1.25).toFixed(0) + 'px at ' + beamX.toFixed(0) + 'px ' + beamY.toFixed(0) +
						'px, black 40%, rgba(0,0,0,0.16) 78%)',
					WebkitMaskImage:
						'radial-gradient(circle ' + (radius * 1.25).toFixed(0) + 'px at ' + beamX.toFixed(0) + 'px ' + beamY.toFixed(0) +
						'px, black 40%, rgba(0,0,0,0.16) 78%)',
				}}
			>
				{rows.map((line, index) => (
					<span
						key={'spot-' + index}
						style={{
							fontFamily: DISPLAY_FONT,
							fontWeight: DISPLAY_WEIGHT,
							fontSize: lit * (index === 0 ? 1 : 0.6),
							lineHeight: 1.06,
							letterSpacing: trackingFor(lit),
							color: index === 0 ? THEME.ink : THEME.muted,
							textTransform: TYPE_KEEPS_CASE ? 'none' : 'uppercase',
							textAlign: 'center',
							maxWidth: width * 0.8,
						}}
					>
						{line}
					</span>
				))}
			</AbsoluteFill>
			<div style={{ position: 'absolute', left: 0, right: 0, bottom: height * 0.08, display: 'flex', justifyContent: 'center' }}>
				<MicroLabel text={props.caption || props.kicker} delay={24} />
			</div>
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,

	'film-strip': `
/**
 * A strip of frames pulled through the gate.
 *
 * Perforations, frame lines and a slight weave. Each cell carries one line of
 * the brief, so the film is literally reading itself.
 */
const FilmStripScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const cells = motionLines(props, 6)
	const vertical = shape === 1
	const cellSize = vertical ? height * 0.34 : width * 0.3
	const travel = ((frame * unit * (shape === 3 ? 3.4 : 2.2)) % (cellSize * cells.length))
	const weave = Math.sin(frame / 9) * unit * 1.6
	// A cell is a fixed square; the copy inside it is fitted to the widest phrase
	// so one long line does not spill over the frame line.
	const cellFont = fitLine(
		unit * 38,
		cells.reduce((most, line) => (line.length > most.length ? line : most), ''),
		cellSize * 1.6,
	)

	return (
		<AbsoluteFill style={{ overflow: 'hidden' }}>
			<Backdrop seed={31} intensity={0.4} />
			<AbsoluteFill
				style={{
					display: 'flex',
					flexDirection: vertical ? 'column' : 'row',
					alignItems: 'center',
					justifyContent: 'flex-start',
					transform: vertical
						? 'translateY(' + (-travel + weave).toFixed(1) + 'px)'
						: 'translateX(' + (-travel + weave).toFixed(1) + 'px)',
				}}
			>
				{cells.concat(cells).map((line, index) => (
					<div
						key={'cell-' + index}
						style={{
							flex: '0 0 auto',
							width: vertical ? width * 0.72 : cellSize,
							height: vertical ? cellSize : height * 0.56,
							margin: unit * 8,
							border: Math.max(2, unit * 3) + 'px solid ' + withAlpha(THEME.ink, 0.5),
							backgroundColor: withAlpha(index % 3 === 0 ? THEME.accent : THEME.surface, 0.9),
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center',
							padding: unit * 22,
						}}
					>
						<span
							style={{
								fontFamily: DISPLAY_FONT,
								fontWeight: DISPLAY_WEIGHT,
								fontSize: cellFont,
								lineHeight: 1.14,
								color: index % 3 === 0 ? THEME.background : THEME.ink,
								textAlign: 'center',
								textTransform: TYPE_KEEPS_CASE ? 'none' : 'uppercase',
							}}
						>
							{line}
						</span>
					</div>
				))}
			</AbsoluteFill>
			{[0, 1].map((side) => (
				<div
					key={'perf-' + side}
					aria-hidden
					style={{
						position: 'absolute',
						left: vertical ? (side === 0 ? 0 : undefined) : 0,
						right: vertical ? (side === 1 ? 0 : undefined) : 0,
						top: vertical ? 0 : side === 0 ? 0 : undefined,
						bottom: vertical ? 0 : side === 1 ? 0 : undefined,
						width: vertical ? width * 0.1 : '100%',
						height: vertical ? '100%' : height * 0.09,
						backgroundColor: shade(THEME.background, 0.5),
						display: 'flex',
						flexDirection: vertical ? 'column' : 'row',
						alignItems: 'center',
						justifyContent: 'space-around',
					}}
				>
					{new Array(vertical ? 8 : 14).fill(0).map((_, hole) => (
						<div
							key={'hole-' + side + '-' + hole}
							style={{
								width: unit * 22,
								height: unit * 16,
								borderRadius: unit * 4,
								backgroundColor: withAlpha(THEME.background, 0.9),
								opacity: 0.8,
							}}
						/>
					))}
				</div>
			))}
			<AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
				<MotionPanel delay={12} pad={unit * 28} tone="ink">
					<MotionCaption headline={props.headline} caption={props.caption} delay={16} size={unit * 56} />
				</MotionPanel>
			</AbsoluteFill>
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,

	'chapter-slate': `
/**
 * A production slate.
 *
 * Clapper, scene and take numbers, and a stamped chapter line. The sticks close
 * on the beat and the card settles - a chapter break with a reason to exist.
 */
const ChapterSlateScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height, fps } = useVideoConfig()
	const shape = props.variant % 4
	const clap = spring({ frame: frame - 10, fps, config: { damping: 12, mass: 0.6, stiffness: 200 } })
	const angle = (1 - clap) * -26
	const rows = motionLines(props, 3)
	const board = Math.min(width * 0.68, height * 0.62)
	// Each row is a slate field name and its value on one baseline, so the value
	// gets the board minus the padding and the field beside it. The first row is
	// set larger by design and is fitted at its own size.
	const field = board - unit * 68 - unit * 110
	const slateSize = fitLine(unit * 52, rows[0] || '', field)
	const rowSize = fitLine(unit * 36, rows.slice(1).reduce((most, line) => (line.length > most.length ? line : most), ''), field)

	return (
		<AbsoluteFill>
			<Backdrop seed={32} intensity={0.5} />
			<AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
				<div
					style={{
						width: board,
						borderRadius: cornerRadius(unit),
						overflow: 'hidden',
						border: Math.max(2, unit * 3) + 'px solid ' + withAlpha(THEME.ink, 0.6),
						backgroundColor: withAlpha(THEME.surface, 0.96),
						transform: 'scale(' + (0.9 + clap * 0.1).toFixed(3) + ')',
						boxShadow: '0 ' + unit * 26 + 'px ' + unit * 60 + 'px ' + withAlpha('#000000', 0.36),
					}}
				>
					<div
						style={{
							display: 'flex',
							height: unit * 60,
							transformOrigin: 'left bottom',
							transform: 'rotate(' + angle.toFixed(2) + 'deg)',
						}}
					>
						{new Array(10).fill(0).map((_, index) => (
							<div
								key={'stick-' + index}
								style={{
									flex: 1,
									backgroundColor: index % 2 === 0 ? THEME.ink : THEME.background,
									transform: 'skewX(-16deg)',
								}}
							/>
						))}
					</div>
					<div style={{ padding: unit * 34, display: 'flex', flexDirection: 'column', gap: unit * 18 }}>
						{rows.map((line, index) => (
							<div
								key={'slate-' + index}
								style={{
									display: 'flex',
									alignItems: 'baseline',
									gap: unit * 18,
									borderBottom: Math.max(1, unit) + 'px solid ' + withAlpha(THEME.ink, 0.16),
									paddingBottom: unit * 12,
									opacity: interpolate(frame - (22 + index * beat(6)), [0, 14], [0, 1], CLAMP),
								}}
							>
								<span style={{ fontFamily: TEXT_FONT, fontSize: unit * 18, letterSpacing: unit * 2, color: THEME.muted, textTransform: 'uppercase' }}>
									{index === 0 ? 'scene' : index === 1 ? 'take' : 'roll'}
								</span>
								<span
									style={{
										fontFamily: DISPLAY_FONT,
										fontWeight: DISPLAY_WEIGHT,
										fontSize: index === 0 ? slateSize : rowSize,
										color: index === 0 ? THEME.accent : THEME.ink,
										textTransform: TYPE_KEEPS_CASE ? 'none' : 'uppercase',
									}}
								>
									{line}
								</span>
							</div>
						))}
						{shape !== 2 ? (
							<span style={{ fontFamily: TEXT_FONT, fontSize: fitBlock(unit * 22, props.caption, board - unit * 68, unit * 90), color: THEME.muted }}>{props.caption}</span>
						) : null}
					</div>
				</div>
			</AbsoluteFill>
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,

	'terminal-type': `
/**
 * A console that types.
 *
 * Monospaced lines appear character by character behind a blinking block
 * cursor, with a prompt glyph and a window chrome. The cadence follows the
 * house tempo, so a punchy film types faster.
 */
const TerminalTypeScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const rows = motionLines(props, 5)
	const perChar = Math.max(0.6, 1.6 * MOTION_TEMPO)
	let consumed = 12
	// A console line that wraps stops looking like a console, so the type is cut
	// until the longest line clears the window with the prompt glyph taken off.
	const termSize = fitLine(
		unit * 27,
		rows.reduce((most, line) => (line.length > most.length ? line : most), ''),
		width * 0.78 - unit * 96,
	)

	return (
		<AbsoluteFill>
			<Backdrop seed={33} intensity={0.4} />
			<AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
				<div
					style={{
						width: width * 0.78,
						minHeight: height * 0.52,
						borderRadius: cornerRadius(unit),
						overflow: 'hidden',
						backgroundColor: shade(THEME.background, THEME.scheme === 'light' ? -0.02 : 0.3),
						border: Math.max(1, unit * 1.6) + 'px solid ' + withAlpha(THEME.ink, 0.2),
						boxShadow: '0 ' + unit * 24 + 'px ' + unit * 60 + 'px ' + withAlpha('#000000', 0.4),
						opacity: interpolate(frame, [0, 14], [0, 1], CLAMP),
					}}
				>
					<div
						style={{
							height: unit * 44,
							display: 'flex',
							alignItems: 'center',
							gap: unit * 10,
							paddingLeft: unit * 20,
							backgroundColor: withAlpha(THEME.ink, 0.1),
						}}
					>
						{[THEME.accent, THEME.accentAlt, THEME.muted].map((color, index) => (
							<div key={'dot-' + index} style={{ width: unit * 13, height: unit * 13, borderRadius: unit * 13, backgroundColor: color }} />
						))}
						<span style={{ fontFamily: TEXT_FONT, fontSize: unit * 19, color: THEME.muted, marginLeft: unit * 12 }}>
							{(props.kicker || props.headline).slice(0, 40)}
						</span>
					</div>
					<div style={{ padding: unit * 28, display: 'flex', flexDirection: 'column', gap: unit * 12 }}>
						{rows.map((line, index) => {
							const start = consumed
							consumed += line.length * perChar + 14
							const shown = Math.max(0, Math.min(line.length, Math.floor((frame - start) / perChar)))
							if (shown <= 0) return null
							const active = shown < line.length
							return (
								<div key={'term-' + index} style={{ display: 'flex', alignItems: 'baseline', gap: unit * 12 }}>
									<span style={{ fontFamily: TEXT_FONT, fontSize: termSize, color: THEME.accent, fontWeight: safeTextWeight(700) }}>
										{shape === 1 ? '>' : shape === 2 ? '$' : '>>'}
									</span>
									<span
										style={{
											fontFamily: TEXT_FONT,
											fontSize: termSize,
											lineHeight: 1.5,
											color: index === 0 ? THEME.ink : THEME.muted,
											letterSpacing: unit * 0.6,
										}}
									>
										{line.slice(0, shown)}
										{active && Math.floor(frame / 8) % 2 === 0 ? '_' : ''}
									</span>
								</div>
							)
						})}
					</div>
				</div>
			</AbsoluteFill>
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,

	'browser-window': `
/**
 * A page loading in a browser shell.
 *
 * Address bar, tabs, a progress hairline and content blocks that resolve from
 * skeletons into real copy. Useful for anything web without pretending to be a
 * screenshot of a real site.
 */
const BrowserWindowScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const blocks = motionItems(props, 4)
	const load = interpolate(frame, [4, 40], [0, 1], { ...CLAMP, easing: EASE_OUT })
	// The page is four fifths of the frame with its own padding inside. The
	// headline gets that whole column; a block gets two fifths of it on the
	// tiled variants and the full column on the stacked one.
	const page = width * 0.8 - unit * 68
	const pageSize = fitBlock(unit * 52, props.headline, page, height * 0.2)
	const blockSize = fitBlock(
		unit * 25,
		blocks.reduce((most, block) => (block.title.length > most.length ? block.title : most), ''),
		(shape === 1 ? page : page * 0.4) - unit * 36,
		unit * 90,
	)

	return (
		<AbsoluteFill>
			<Backdrop seed={34} intensity={0.4} />
			<AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
				<div
					style={{
						width: width * 0.8,
						height: height * 0.68,
						borderRadius: cornerRadius(unit, 1.4),
						overflow: 'hidden',
						backgroundColor: withAlpha(THEME.surface, 0.97),
						border: Math.max(1, unit * 1.6) + 'px solid ' + withAlpha(THEME.ink, 0.18),
						boxShadow: '0 ' + unit * 30 + 'px ' + unit * 70 + 'px ' + withAlpha('#000000', 0.34),
						transform: 'scale(' + (0.94 + load * 0.06).toFixed(3) + ')',
						opacity: interpolate(frame, [0, 12], [0, 1], CLAMP),
					}}
				>
					<div style={{ height: unit * 52, display: 'flex', alignItems: 'center', gap: unit * 12, padding: unit * 14, backgroundColor: withAlpha(THEME.ink, 0.08) }}>
						{[0, 1, 2].map((dot) => (
							<div key={'bdot-' + dot} style={{ width: unit * 12, height: unit * 12, borderRadius: unit * 12, backgroundColor: withAlpha(THEME.ink, 0.3) }} />
						))}
						<div
							style={{
								flex: 1,
								height: unit * 30,
								marginLeft: unit * 12,
								borderRadius: unit * 30,
								backgroundColor: withAlpha(THEME.background, 0.9),
								display: 'flex',
								alignItems: 'center',
								paddingLeft: unit * 16,
								fontFamily: TEXT_FONT,
								fontSize: unit * 17,
								color: THEME.muted,
								overflow: 'hidden',
								whiteSpace: 'nowrap',
							}}
						>
							{(props.kicker || props.headline).toLowerCase().replace(/\\s+/g, '-').slice(0, 44)}
						</div>
					</div>
					<div style={{ height: Math.max(2, unit * 3), backgroundColor: THEME.accent, transformOrigin: 'left', transform: 'scaleX(' + load.toFixed(3) + ')' }} />
					<div style={{ padding: unit * 34, display: 'flex', flexDirection: 'column', gap: unit * 20 }}>
						<span
							style={{
								fontFamily: DISPLAY_FONT,
								fontWeight: DISPLAY_WEIGHT,
								fontSize: pageSize,
								color: THEME.ink,
								opacity: load,
								lineHeight: 1.1,
							}}
						>
							{props.headline}
						</span>
						<div style={{ display: shape === 1 ? 'block' : 'flex', gap: unit * 18, flexWrap: 'wrap' }}>
							{blocks.map((block, index) => {
								const ready = interpolate(frame - (26 + index * beat(7)), [0, 18], [0, 1], { ...CLAMP, easing: EASE_OUT })
								return (
									<div
										key={'block-' + index}
										style={{
											flex: shape === 1 ? undefined : '1 1 40%',
											marginBottom: shape === 1 ? unit * 14 : 0,
											padding: unit * 18,
											borderRadius: cornerRadius(unit),
											backgroundColor: withAlpha(ready > 0.5 ? THEME.accent : THEME.ink, ready > 0.5 ? 0.1 : 0.08),
											border: Math.max(1, unit) + 'px solid ' + withAlpha(THEME.ink, 0.12),
										}}
									>
										<span
											style={{
												fontFamily: TEXT_FONT,
												fontSize: blockSize,
												fontWeight: safeTextWeight(560),
												color: THEME.ink,
												opacity: ready,
											}}
										>
											{ready > 0.35 ? block.title : ''}
										</span>
									</div>
								)
							})}
						</div>
					</div>
				</div>
			</AbsoluteFill>
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,

	'phone-scroll': `
/**
 * A handset with a feed running through it.
 *
 * The device is drawn, not photographed, so it inherits the palette. Cards
 * scroll under a fixed status bar and one card is pinned by the accent.
 */
const PhoneScrollScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const cards = motionItems(props, 6)
	const phoneHeight = height * 0.78
	const phoneWidth = phoneHeight * 0.49
	const scroll = interpolate(frame, [10, props.frames], [0, cards.length * unit * 130], CLAMP)
	const tilt = shape === 1 ? 0 : Math.sin(frame / 90) * 4
	// A feed row is the narrowest box in the kit: half a phone, minus the phone
	// padding, the card padding and the icon in front of the text. The card
	// wraps, so it is the block that is fitted rather than a single line.
	const feedSize = fitBlock(
		unit * 21,
		cards.reduce((most, card) => (card.title.length > most.length ? card.title : most), ''),
		phoneWidth - unit * 100,
		unit * 76,
	)

	return (
		<AbsoluteFill>
			<Backdrop seed={35} intensity={0.5} />
			<AbsoluteFill style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: shape === 2 ? 'flex-end' : 'center', paddingRight: shape === 2 ? width * 0.12 : 0, perspective: width + 'px' }}>
				<div
					style={{
						width: phoneWidth,
						height: phoneHeight,
						borderRadius: unit * 52,
						border: Math.max(3, unit * 7) + 'px solid ' + withAlpha(THEME.ink, 0.82),
						backgroundColor: THEME.background,
						overflow: 'hidden',
						position: 'relative',
						transform: 'rotateY(' + tilt.toFixed(2) + 'deg) scale(' + interpolate(frame, [0, 22], [0.9, 1], { ...CLAMP, easing: EASE_OUT }).toFixed(3) + ')',
						boxShadow: '0 ' + unit * 34 + 'px ' + unit * 80 + 'px ' + withAlpha('#000000', 0.42),
					}}
				>
					<div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: unit * 46, backgroundColor: withAlpha(THEME.ink, 0.1), display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2 }}>
						<div style={{ width: phoneWidth * 0.3, height: unit * 18, borderRadius: unit * 20, backgroundColor: withAlpha(THEME.ink, 0.6) }} />
					</div>
					<div style={{ position: 'absolute', top: unit * 56, left: 0, right: 0, padding: unit * 14, display: 'flex', flexDirection: 'column', gap: unit * 14, transform: 'translateY(' + (-scroll).toFixed(1) + 'px)' }}>
						{cards.concat(cards).map((card, index) => (
							<div
								key={'feed-' + index}
								style={{
									padding: unit * 18,
									borderRadius: cornerRadius(unit),
									backgroundColor: withAlpha(index % 4 === 1 ? THEME.accent : THEME.surface, index % 4 === 1 ? 0.9 : 0.7),
									border: Math.max(1, unit) + 'px solid ' + withAlpha(THEME.ink, 0.12),
									display: 'flex',
									gap: unit * 12,
									alignItems: 'center',
								}}
							>
								<VectorIcon name={card.icon} size={unit * 26} color={index % 4 === 1 ? THEME.background : THEME.accent} strokeWidth={2} />
								<span
									style={{
										fontFamily: TEXT_FONT,
										fontSize: feedSize,
										fontWeight: safeTextWeight(560),
										color: index % 4 === 1 ? THEME.background : THEME.ink,
										lineHeight: 1.3,
									}}
								>
									{card.title}
								</span>
							</div>
						))}
					</div>
				</div>
			</AbsoluteFill>
			<AbsoluteFill style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'flex-start', paddingLeft: width * LAYOUT_INSET, pointerEvents: 'none' }}>
				{shape === 2 ? <MotionCaption kicker={props.kicker} headline={props.headline} caption={props.caption} delay={6} align="flex-start" size={unit * 58} /> : null}
			</AbsoluteFill>
			{shape !== 2 ? (
				<div style={{ position: 'absolute', left: 0, right: 0, bottom: height * 0.06, display: 'flex', justifyContent: 'center' }}>
					<MicroLabel text={props.caption || props.headline} delay={20} />
				</div>
			) : null}
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,

	'device-grid': `
/**
 * A wall of screens that light in sequence.
 *
 * Each panel carries a fragment; they wake on a diagonal and settle into a
 * single field, which is how a set of features reads as one product.
 */
const DeviceGridScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const columns = shape === 1 ? 4 : 3
	const tiles = motionItems(props, columns * (shape === 3 ? 3 : 2))
	// A panel is one column of the grid inside the page margin, and the icon
	// above the text takes a share of its height.
	const panel = (width * (1 - LAYOUT_INSET * 2) - unit * 16 * (columns - 1)) / columns
	const tileSize = fitBlock(
		unit * 22,
		tiles.reduce((most, tile) => (tile.title.length > most.length ? tile.title : most), ''),
		panel - unit * 32,
		height * (shape === 3 ? 0.15 : 0.2) - unit * 76,
	)

	return (
		<AbsoluteFill>
			<Backdrop seed={36} intensity={0.45} />
			<AbsoluteFill style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: unit * 26, padding: width * LAYOUT_INSET }}>
				<MotionCaption kicker={props.kicker} headline={props.headline} delay={2} size={unit * 52} />
				<div style={{ display: 'grid', gridTemplateColumns: 'repeat(' + columns + ', 1fr)', gap: unit * 16, width: '100%' }}>
					{tiles.map((tile, index) => {
						const wake = interpolate(frame - (12 + ((index % columns) + Math.floor(index / columns)) * beat(6)), [0, 20], [0, 1], { ...CLAMP, easing: EASE_OUT })
						return (
							<div
								key={'dev-' + index}
								style={{
									height: height * (shape === 3 ? 0.15 : 0.2),
									borderRadius: cornerRadius(unit),
									border: Math.max(2, unit * 2.4) + 'px solid ' + withAlpha(THEME.ink, 0.4),
									backgroundColor: withAlpha(index % 3 === 0 ? THEME.accent : THEME.surface, 0.16 + wake * 0.7),
									display: 'flex',
									flexDirection: 'column',
									alignItems: 'flex-start',
									justifyContent: 'flex-end',
									padding: unit * 16,
									gap: unit * 8,
									transform: 'translateY(' + ((1 - wake) * unit * 30).toFixed(1) + 'px) scale(' + (0.94 + wake * 0.06).toFixed(3) + ')',
									opacity: 0.2 + wake * 0.8,
									boxShadow: wake > 0.5 ? '0 0 ' + unit * 30 + 'px ' + withAlpha(THEME.glow, 0.24) : undefined,
								}}
							>
								<VectorIcon name={tile.icon} size={unit * 28} color={THEME.accent} strokeWidth={2} />
								<span style={{ fontFamily: TEXT_FONT, fontSize: tileSize, fontWeight: safeTextWeight(580), color: THEME.ink, lineHeight: 1.25 }}>
									{tile.title}
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

	'matrix-rain': `
/**
 * Falling glyph columns.
 *
 * Each column runs at its own seeded speed with a bright leading character, and
 * the headline burns through the middle in a knocked-out plate.
 */
const MatrixRainScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const columns = shape === 1 ? 34 : 24
	const glyphs = ((props.headline + props.caption).replace(/\\s+/g, '') + '01234567890ABCDEF').toUpperCase()
	const columnWidth = width / columns
	const rowHeight = unit * (shape === 2 ? 26 : 34)
	const perColumn = Math.ceil(height / rowHeight) + 4

	return (
		<AbsoluteFill style={{ backgroundColor: motionStage(0.4), overflow: 'hidden' }}>
			{new Array(columns).fill(0).map((_, column) => {
				const speed = 0.6 + mrand('rain-' + column) * 2.4
				const offset = (frame * speed * unit * 2 + mrand('rain-o-' + column) * height) % (height + rowHeight * 6)
				return (
					<div
						key={'col-' + column}
						aria-hidden
						style={{ position: 'absolute', left: column * columnWidth, top: offset - rowHeight * perColumn, width: columnWidth }}
					>
						{new Array(perColumn).fill(0).map((__, row) => {
							const head = row === perColumn - 1
							return (
								<div
									key={'g-' + column + '-' + row}
									style={{
										height: rowHeight,
										textAlign: 'center',
										fontFamily: TEXT_FONT,
										fontSize: rowHeight * 0.76,
										fontWeight: safeTextWeight(head ? 700 : 400),
										color: head ? THEME.glow : THEME.accent,
										opacity: head ? 0.95 : (row / perColumn) * 0.4,
										textShadow: head ? '0 0 ' + unit * 14 + 'px ' + withAlpha(THEME.glow, 0.8) : undefined,
									}}
								>
									{glyphs[(column * 7 + row * 3 + Math.floor(frame / 4)) % glyphs.length]}
								</div>
							)
						})}
					</div>
				)
			})}
			<AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
				<div
					style={{
						padding: unit * 32,
						paddingLeft: unit * 46,
						paddingRight: unit * 46,
						backgroundColor: LIGHT_STOCK ? withAlpha(THEME.background, 0.94) : shade(THEME.background, 0.55),
						border: Math.max(1, unit * 1.6) + 'px solid ' + withAlpha(THEME.accent, 0.5),
						borderRadius: cornerRadius(unit),
						opacity: interpolate(frame, [8, 28], [0, 1], CLAMP),
					}}
				>
					<MotionCaption headline={props.headline} caption={props.caption} delay={12} size={unit * 62} />
				</div>
			</AbsoluteFill>
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,

	'poster-collage': `
/**
 * Torn paper assembling into a poster.
 *
 * Tiles fly in at seeded angles with hard shadows and overlap deliberately, so
 * the composition looks cut and pasted rather than laid out on a grid.
 */
const PosterCollageScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const pieces = motionLines(props, shape === 1 ? 7 : 5)

	return (
		<AbsoluteFill style={{ overflow: 'hidden' }}>
			<Backdrop seed={37} intensity={0.5} />
			<AbsoluteFill>
				{pieces.map((piece, index) => {
					const land = interpolate(frame - (6 + index * beat(6)), [0, 24], [0, 1], { ...CLAMP, easing: EASE_OUT })
					const angle = (mrand('col-a-' + index) - 0.5) * (shape === 3 ? 10 : 26)
					const left = width * (0.1 + mrand('col-x-' + index) * 0.56)
					const top = height * (0.14 + mrand('col-y-' + index) * 0.58)
					const tone = index % 3
					// A tile is placed by seed and then allowed to be nearly half the
					// frame wide, which put the right-hand ones off the edge. It gets
					// whatever is left between where it starts and the margin, and its
					// type is cut to that box.
					const box = Math.min(width * 0.44, width * 0.94 - left)
					const pieceSize = fitBlock(unit * (index === 0 ? 60 : 38), piece, box - unit * 52, height * 0.3)
					return (
						<div
							key={'piece-' + index}
							style={{
								position: 'absolute',
								left,
								top,
								maxWidth: box,
								padding: unit * 20,
								paddingLeft: unit * 26,
								paddingRight: unit * 26,
								backgroundColor: tone === 0 ? THEME.accent : tone === 1 ? THEME.surface : THEME.accentAlt,
								color: tone === 1 ? THEME.ink : THEME.background,
								fontFamily: DISPLAY_FONT,
								fontWeight: DISPLAY_WEIGHT,
								fontSize: pieceSize,
								lineHeight: 1.08,
								letterSpacing: trackingFor(pieceSize),
								textTransform: TYPE_KEEPS_CASE ? 'none' : 'uppercase',
								transform:
									'translate(' + ((1 - land) * (mrand('col-d-' + index) - 0.5) * width * 0.7).toFixed(1) + 'px, ' +
									((1 - land) * height * 0.3).toFixed(1) + 'px) rotate(' + (angle * land).toFixed(2) + 'deg)',
								opacity: land,
								boxShadow: unit * 10 + 'px ' + unit * 12 + 'px 0 ' + withAlpha('#000000', 0.22),
								zIndex: index,
							}}
						>
							{piece}
						</div>
					)
				})}
			</AbsoluteFill>
			<div style={{ position: 'absolute', left: width * LAYOUT_INSET, bottom: height * 0.07 }}>
				<MicroLabel text={props.caption || props.kicker} delay={pieces.length * 7} />
			</div>
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,

	'parallax-strata': `
/**
 * Layered bands that travel at different rates.
 *
 * A depth stage without a single piece of representational art: the strata are
 * abstract, so this reads as any subject rather than as a landscape.
 */
const ParallaxStrataScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const bands = shape === 1 ? 7 : 5
	const rows = motionLines(props, 2)
	const strataSize = fitStack(unit * 92, rows, width * 0.76, height * 0.46)

	return (
		<AbsoluteFill style={{ overflow: 'hidden' }}>
			<Backdrop seed={38} intensity={0.35} />
			{new Array(bands).fill(0).map((_, index) => {
				const depth = (index + 1) / bands
				const drift = (frame * unit * 0.9 * depth) % (width * 0.5)
				const top = height * (0.14 + index * (0.72 / bands))
				const thickness = height * (0.05 + depth * 0.05)
				const enter = interpolate(frame - index * beat(4), [0, 22], [0, 1], { ...CLAMP, easing: EASE_OUT })
				return (
					<div
						key={'strata-' + index}
						aria-hidden
						style={{
							position: 'absolute',
							left: -width * 0.3 + (index % 2 === 0 ? drift : -drift),
							top,
							width: width * 1.6,
							height: thickness,
							borderRadius: shape === 2 ? 0 : thickness,
							backgroundColor: withAlpha(index % 2 === 0 ? THEME.accent : THEME.accentAlt, (0.1 + depth * 0.22) * FIGURE_WEIGHT),
							transform: 'rotate(' + (shape === 3 ? -4 + index : 0) + 'deg) scaleX(' + enter.toFixed(3) + ')',
							transformOrigin: index % 2 === 0 ? 'left' : 'right',
						}}
					/>
				)
			})}
			<AbsoluteFill style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: unit * 16 }}>
				{rows.map((line, index) => (
					<span
						key={'strata-line-' + index}
						style={{
							fontFamily: DISPLAY_FONT,
							fontWeight: index === 0 ? DISPLAY_WEIGHT : Math.max(300, DISPLAY_WEIGHT - 300),
							fontSize: strataSize * (index === 0 ? 1 : 0.44),
							letterSpacing: trackingFor(strataSize * 0.76),
							color: index === 0 ? THEME.ink : THEME.muted,
							textAlign: 'center',
							maxWidth: width * 0.78,
							opacity: interpolate(frame - (14 + index * beat(8)), [0, 20], [0, 1], CLAMP),
							transform: 'translateY(' + (interpolate(frame - (14 + index * beat(8)), [0, 20], [unit * 30, 0], CLAMP)).toFixed(1) + 'px)',
							textTransform: TYPE_KEEPS_CASE ? 'none' : 'uppercase',
						}}
					>
						{line}
					</span>
				))}
			</AbsoluteFill>
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,
} as const
