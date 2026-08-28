/**
 * Editorial motion scenes.
 *
 * Ten pieces borrowed from print: spreads, columns, cards, margins, contact
 * sheets, page turns, postmarks, receipts, drafting and die-cuts. Print has
 * spent five centuries working out how to rank information on a flat surface,
 * and a frame is a flat surface - so these carry dense copy better than
 * anything drawn from screen language.
 *
 * Emitted verbatim into the generated TSX: no backticks, no dollar-braces.
 */

export const EDITORIAL_SCENES = {
	'magazine-spread': `
/**
 * A two-page spread assembling.
 *
 * A hairline gutter down the middle, a standfirst on the left and a pull quote
 * set large on the right, with the rules drawing themselves on. The asymmetry
 * is the design: a spread that balances is a poster, and a poster does not read
 * as journalism.
 */
const MagazineSpreadScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const rows = motionLines(props, 3)
	const stacked = useStacked()
	const column = (stacked ? width * 0.84 : width * 0.42) - unit * 40
	const pullSize = fitBlock(unit * 64, rows[0], column, height * (stacked ? 0.24 : 0.44))
	const standSize = fitBlock(unit * 26, rows[1] || props.caption, column, height * 0.22)

	return (
		<AbsoluteFill>
			<Backdrop seed={80} intensity={0.3} />
			<AbsoluteFill
				style={{
					display: 'flex',
					flexDirection: stacked ? 'column' : 'row',
					alignItems: 'stretch',
					padding: width * LAYOUT_INSET,
					gap: unit * 40,
				}}
			>
				<div style={{ flex: stacked ? undefined : 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: unit * 18 }}>
					<span
						style={{
							fontFamily: TEXT_FONT,
							fontSize: unit * 18,
							letterSpacing: unit * 3,
							textTransform: 'uppercase',
							color: THEME.accent,
							opacity: interpolate(frame, [2, 16], [0, 1], CLAMP),
						}}
					>
						{props.kicker || 'Feature'}
					</span>
					<div
						aria-hidden
						style={{
							height: Math.max(1, unit * 2),
							backgroundColor: THEME.ink,
							transformOrigin: 'left',
							transform: 'scaleX(' + interpolate(frame, [6, 26], [0, 1], { ...CLAMP, easing: EASE_OUT }).toFixed(3) + ')',
						}}
					/>
					<span
						style={{
							fontFamily: TEXT_FONT,
							fontSize: standSize,
							lineHeight: 1.5,
							color: THEME.muted,
							opacity: interpolate(frame, [18, 36], [0, 1], CLAMP),
						}}
					>
						{rows[1] || props.caption}
					</span>
					{rows[2] ? (
						<span
							style={{
								fontFamily: TEXT_FONT,
								fontSize: standSize * 0.86,
								lineHeight: 1.5,
								color: THEME.muted,
								opacity: interpolate(frame, [28, 46], [0, 1], CLAMP),
							}}
						>
							{rows[2]}
						</span>
					) : null}
				</div>
				{!stacked ? (
					<div
						aria-hidden
						style={{
							width: Math.max(1, unit * 1.4),
							backgroundColor: withAlpha(THEME.ink, 0.22),
							transformOrigin: 'top',
							transform: 'scaleY(' + interpolate(frame, [4, 30], [0, 1], { ...CLAMP, easing: EASE_OUT }).toFixed(3) + ')',
						}}
					/>
				) : null}
				<div style={{ flex: stacked ? undefined : 1.1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
					<span
						style={{
							fontFamily: DISPLAY_FONT,
							fontWeight: DISPLAY_WEIGHT,
							fontSize: pullSize,
							letterSpacing: trackingFor(pullSize),
							lineHeight: 1.06,
							color: THEME.ink,
							textTransform: TYPE_KEEPS_CASE ? 'none' : 'uppercase',
							opacity: interpolate(frame, [10, 30], [0, 1], CLAMP),
							transform: 'translateY(' + interpolate(frame, [10, 34], [unit * 26, 0], { ...CLAMP, easing: EASE_OUT }).toFixed(1) + 'px)',
						}}
					>
						{rows[0]}
					</span>
					{shape !== 2 ? (
						<div
							aria-hidden
							style={{
								marginTop: unit * 24,
								width: unit * 120,
								height: Math.max(3, unit * 5),
								backgroundColor: THEME.accent,
								transformOrigin: 'left',
								transform: 'scaleX(' + interpolate(frame, [30, 48], [0, 1], { ...CLAMP, easing: EASE_OUT }).toFixed(3) + ')',
							}}
						/>
					) : null}
				</div>
			</AbsoluteFill>
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,

	'newspaper-fold': `
/**
 * A front page opening out.
 *
 * The sheet arrives folded, unfolds on its horizontal crease and the columns
 * fill in behind the masthead. Body copy is set as rules rather than as text -
 * a frame is never held long enough to read a column, and drawing the greeking
 * as lines is honest about that.
 */
const NewspaperFoldScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const columns = shape === 1 ? 4 : 3
	const rows = motionLines(props, 2)
	const open = interpolate(frame, [6, 34], [0, 1], { ...CLAMP, easing: EASE_OUT })
	const sheet = { w: width * 0.8, h: height * 0.76 }
	const headSize = fitBlock(unit * 58, rows[0], sheet.w - unit * 60, height * 0.16)

	return (
		<AbsoluteFill style={{ overflow: 'hidden' }}>
			<Backdrop seed={81} intensity={0.35} />
			<AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', perspective: width + 'px' }}>
				<div
					style={{
						width: sheet.w,
						height: sheet.h,
						backgroundColor: LIGHT_STOCK ? THEME.surface : shade(THEME.surface, -0.1),
						border: Math.max(1, unit * 1.4) + 'px solid ' + withAlpha(THEME.ink, 0.2),
						padding: unit * 30,
						display: 'flex',
						flexDirection: 'column',
						gap: unit * 16,
						transformOrigin: 'center top',
						transform: 'rotateX(' + ((1 - open) * -78).toFixed(2) + 'deg) scale(' + (0.92 + open * 0.08).toFixed(3) + ')',
						boxShadow: '0 ' + unit * 26 + 'px ' + unit * 60 + 'px ' + withAlpha('#000000', 0.36),
					}}
				>
					<div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: unit * 16 }}>
						<span
							style={{
								fontFamily: DISPLAY_FONT,
								fontWeight: DISPLAY_WEIGHT,
								fontSize: unit * 22,
								letterSpacing: unit * 4,
								textTransform: 'uppercase',
								color: THEME.ink,
							}}
						>
							{(props.kicker || 'The Record').slice(0, 22)}
						</span>
						<span style={{ fontFamily: TEXT_FONT, fontSize: unit * 16, color: THEME.muted, letterSpacing: unit }}>
							{'No. ' + String(10 + mpick('edition', 89))}
						</span>
					</div>
					<div aria-hidden style={{ height: Math.max(2, unit * 3), backgroundColor: THEME.ink }} />
					<span
						style={{
							fontFamily: DISPLAY_FONT,
							fontWeight: DISPLAY_WEIGHT,
							fontSize: headSize,
							letterSpacing: trackingFor(headSize),
							lineHeight: 1.04,
							color: THEME.ink,
							textTransform: TYPE_KEEPS_CASE ? 'none' : 'uppercase',
							opacity: interpolate(frame, [26, 42], [0, 1], CLAMP),
						}}
					>
						{rows[0]}
					</span>
					<div style={{ display: 'flex', gap: unit * 22, flex: 1 }}>
						{new Array(columns).fill(0).map((_, column) => (
							<div key={'col-' + column} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: unit * 9 }}>
								{column === 0 && rows[1] ? (
									<span
										style={{
											fontFamily: TEXT_FONT,
											fontWeight: safeTextWeight(620),
											fontSize: fitBlock(unit * 20, rows[1], sheet.w / columns - unit * 30, height * 0.1),
											lineHeight: 1.42,
											color: THEME.ink,
											opacity: interpolate(frame, [36, 52], [0, 1], CLAMP),
										}}
									>
										{rows[1]}
									</span>
								) : null}
								{new Array(11).fill(0).map((_unused, ruleIndex) => (
									<div
										key={'rule-' + column + '-' + ruleIndex}
										aria-hidden
										style={{
											height: Math.max(1, unit * 2.2),
											width: (62 + mpick('greek-' + column + '-' + ruleIndex, 38)) + '%',
											backgroundColor: withAlpha(THEME.ink, 0.16),
											opacity: interpolate(frame - (34 + column * 4 + ruleIndex * 2), [0, 10], [0, 1], CLAMP),
										}}
									/>
								))}
							</div>
						))}
					</div>
				</div>
			</AbsoluteFill>
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,

	'index-card': `
/**
 * A card index being worked through.
 *
 * Ruled cards flip forward off the top of the stack, each one held long enough
 * to read and then thrown aside. The stack behind stays visible, so the film
 * shows how much is left - which is what an index does and a carousel does not.
 */
const IndexCardScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const cards = motionLines(props, shape === 1 ? 5 : 4)
	const hold = Math.max(18, props.frames / (cards.length + 0.6))
	const card = { w: Math.min(width * 0.62, height * 0.78), h: Math.min(height * 0.46, width * 0.42) }
	const size = fitBlock(
		unit * 44,
		cards.reduce((most, entry) => (entry.length > most.length ? entry : most), ''),
		card.w - unit * 74,
		card.h - unit * 90,
	)

	return (
		<AbsoluteFill style={{ overflow: 'hidden' }}>
			<Backdrop seed={82} intensity={0.4} />
			<AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', perspective: width * 1.2 + 'px' }}>
				{cards.map((entry, index) => {
					const start = index * hold
					const gone = interpolate(frame - start - hold, [0, 16], [0, 1], { ...CLAMP, easing: EASE_OUT })
					const behind = Math.max(0, index - Math.floor(frame / hold))
					if (gone >= 1) return null
					return (
						<div
							key={'index-' + index}
							style={{
								position: 'absolute',
								width: card.w,
								height: card.h,
								backgroundColor: LIGHT_STOCK ? THEME.surface : shade(THEME.surface, -0.06),
								borderRadius: cornerRadius(unit, 0.5),
								border: Math.max(1, unit * 1.4) + 'px solid ' + withAlpha(THEME.ink, 0.2),
								padding: unit * 34,
								paddingTop: unit * 46,
								transformOrigin: 'center top',
								transform:
									'translateY(' + (behind * unit * 10).toFixed(1) + 'px) rotateX(' + (gone * -96).toFixed(2) + 'deg) scale(' +
									(1 - behind * 0.03).toFixed(3) + ')',
								opacity: 1 - gone,
								zIndex: cards.length - index,
								boxShadow: '0 ' + unit * 16 + 'px ' + unit * 36 + 'px ' + withAlpha('#000000', 0.3),
							}}
						>
							<div
								aria-hidden
								style={{
									position: 'absolute',
									left: 0,
									right: 0,
									top: unit * 34,
									height: Math.max(1, unit * 2),
									backgroundColor: withAlpha(THEME.accent, 0.6),
								}}
							/>
							<span
								style={{
									fontFamily: TEXT_FONT,
									fontWeight: safeTextWeight(600),
									fontSize: size,
									lineHeight: 1.34,
									color: THEME.ink,
								}}
							>
								{entry}
							</span>
							<span
								style={{
									position: 'absolute',
									right: unit * 26,
									bottom: unit * 20,
									fontFamily: TEXT_FONT,
									fontSize: unit * 18,
									letterSpacing: unit * 2,
									color: THEME.muted,
								}}
							>
								{String(index + 1).padStart(2, '0') + ' / ' + String(cards.length).padStart(2, '0')}
							</span>
						</div>
					)
				})}
			</AbsoluteFill>
			<div style={{ position: 'absolute', left: 0, right: 0, bottom: height * 0.1, display: 'flex', justifyContent: 'center' }}>
				<MicroLabel text={props.headline || props.kicker} delay={4} />
			</div>
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,

	'footnote-margin': `
/**
 * A body block annotated in the margin.
 *
 * The argument is set as a paragraph and the notes arrive beside it, each one
 * tied to its line by a leader rule. The marginalia is where the film's voice
 * goes, which lets the main block stay plain.
 */
const FootnoteMarginScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const notes = motionLines(props, 3)
	const stacked = useStacked()
	const bodyWidth = stacked ? width * 0.84 : width * 0.52
	const noteWidth = stacked ? width * 0.84 : width * 0.26
	const bodySize = fitBlock(unit * 40, props.headline, bodyWidth, height * 0.4)

	return (
		<AbsoluteFill>
			<Backdrop seed={83} intensity={0.32} />
			<AbsoluteFill
				style={{
					display: 'flex',
					flexDirection: stacked ? 'column' : 'row',
					alignItems: stacked ? 'flex-start' : 'flex-start',
					justifyContent: 'center',
					gap: unit * 34,
					padding: width * LAYOUT_INSET,
					paddingTop: height * 0.2,
				}}
			>
				<div style={{ width: bodyWidth }}>
					<span
						style={{
							fontFamily: DISPLAY_FONT,
							fontWeight: Math.max(420, DISPLAY_WEIGHT - 200),
							fontSize: bodySize,
							lineHeight: 1.3,
							letterSpacing: trackingFor(bodySize),
							color: THEME.ink,
							opacity: interpolate(frame, [4, 22], [0, 1], CLAMP),
						}}
					>
						{props.headline}
					</span>
				</div>
				<div style={{ width: noteWidth, display: 'flex', flexDirection: 'column', gap: unit * 20 }}>
					{notes.map((note, index) => (
						<div
							key={'note-' + index}
							style={{
								display: 'flex',
								gap: unit * 12,
								opacity: interpolate(frame - (18 + index * beat(8)), [0, 16], [0, 1], CLAMP),
								transform:
									'translateX(' +
									interpolate(frame - (18 + index * beat(8)), [0, 16], [unit * (shape === 1 ? -24 : 24), 0], {
										...CLAMP,
										easing: EASE_OUT,
									}).toFixed(1) +
									'px)',
							}}
						>
							<span
								style={{
									fontFamily: TEXT_FONT,
									fontWeight: safeTextWeight(700),
									fontSize: unit * 18,
									color: THEME.accent,
									lineHeight: 1.4,
									flex: '0 0 auto',
								}}
							>
								{String(index + 1)}
							</span>
							<span
								style={{
									fontFamily: TEXT_FONT,
									fontSize: fitBlock(unit * 21, note, noteWidth - unit * 30, height * 0.14),
									lineHeight: 1.46,
									color: THEME.muted,
								}}
							>
								{note}
							</span>
						</div>
					))}
				</div>
			</AbsoluteFill>
			<div style={{ position: 'absolute', left: width * LAYOUT_INSET, top: height * 0.11 }}>
				<MicroLabel text={props.kicker || props.caption} delay={2} />
			</div>
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,

	'contact-sheet': `
/**
 * A sheet of frames with one of them chosen.
 *
 * Every cell carries a fragment and a frame number, and a grease-pencil ring
 * lands on the one the film is actually about. The selection is the whole
 * point, so the ring arrives late and hard.
 */
const ContactSheetScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const columns = shape === 1 ? 4 : 3
	const cells = motionLines(props, columns * 2)
	const chosen = mpick('contact-pick', cells.length)
	const cellWidth = (width * (1 - LAYOUT_INSET * 2) - unit * 14 * (columns - 1)) / columns
	const cellHeight = height * 0.19
	const size = fitBlock(
		unit * 22,
		cells.reduce((most, cell) => (cell.length > most.length ? cell : most), ''),
		cellWidth - unit * 30,
		cellHeight - unit * 44,
	)
	const ring = interpolate(frame - Math.max(34, props.frames * 0.42), [0, 14], [0, 1], { ...CLAMP, easing: EASE_OUT })

	return (
		<AbsoluteFill>
			<Backdrop seed={84} intensity={0.4} />
			<AbsoluteFill style={{ backgroundColor: motionStage(0.3) }} />
			<AbsoluteFill style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: unit * 22, padding: width * LAYOUT_INSET }}>
				<MotionCaption kicker={props.kicker} headline={props.headline} delay={2} align="flex-start" size={unit * 46} />
				<div style={{ display: 'grid', gridTemplateColumns: 'repeat(' + columns + ', 1fr)', gap: unit * 14 }}>
					{cells.map((cell, index) => (
						<div
							key={'cell-' + index}
							style={{
								position: 'relative',
								height: cellHeight,
								backgroundColor: withAlpha(THEME.surface, 0.9),
								border: Math.max(1, unit) + 'px solid ' + withAlpha(THEME.ink, 0.2),
								display: 'flex',
								alignItems: 'flex-end',
								padding: unit * 15,
								opacity: interpolate(frame - (10 + index * beat(3)), [0, 12], [0, 1], CLAMP),
							}}
						>
							<span
								style={{
									fontFamily: TEXT_FONT,
									fontWeight: safeTextWeight(560),
									fontSize: size,
									lineHeight: 1.26,
									color: THEME.ink,
								}}
							>
								{cell}
							</span>
							<span
								style={{
									position: 'absolute',
									top: unit * 10,
									left: unit * 12,
									fontFamily: TEXT_FONT,
									fontSize: unit * 15,
									letterSpacing: unit * 1.6,
									color: THEME.muted,
								}}
							>
								{String(index + 1).padStart(2, '0') + 'A'}
							</span>
							{index === chosen ? (
								<div
									aria-hidden
									style={{
										position: 'absolute',
										inset: -unit * 6,
										border: Math.max(3, unit * 5) + 'px solid ' + THEME.accent,
										borderRadius: unit * 40,
										transform: 'rotate(' + (-3 + mrand('ring') * 6).toFixed(2) + 'deg) scale(' + (0.7 + ring * 0.3).toFixed(3) + ')',
										opacity: ring,
									}}
								/>
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

	'book-page-turn': `
/**
 * A page turning to the next line.
 *
 * The leaf lifts at the fore edge, curls and lays over, and the line underneath
 * is already set - so the copy is being read rather than presented. Slower than
 * a card flip on purpose: a book is a considered object.
 */
const BookPageTurnScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const pages = motionLines(props, shape === 1 ? 4 : 3)
	const hold = Math.max(22, props.frames / (pages.length + 0.5))
	const leaf = { w: Math.min(width * 0.42, height * 0.6), h: Math.min(height * 0.62, width * 0.5) }
	const size = fitBlock(
		unit * 40,
		pages.reduce((most, page) => (page.length > most.length ? page : most), ''),
		leaf.w - unit * 56,
		leaf.h - unit * 90,
	)

	return (
		<AbsoluteFill style={{ overflow: 'hidden' }}>
			<Backdrop seed={85} intensity={0.4} />
			<AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', perspective: width * 1.4 + 'px' }}>
				<div style={{ display: 'flex', transformStyle: 'preserve-3d' }}>
					<div
						aria-hidden
						style={{
							width: leaf.w,
							height: leaf.h,
							backgroundColor: LIGHT_STOCK ? shade(THEME.surface, 0.04) : shade(THEME.surface, -0.12),
							borderTopLeftRadius: cornerRadius(unit, 0.4),
							borderBottomLeftRadius: cornerRadius(unit, 0.4),
							boxShadow: 'inset ' + -unit * 20 + 'px 0 ' + unit * 34 + 'px ' + withAlpha('#000000', 0.28),
						}}
					/>
					<div style={{ position: 'relative', width: leaf.w, height: leaf.h }}>
						{pages.map((page, index) => {
							const turn = interpolate(frame - index * hold, [0, hold * 0.7], [0, 1], { ...CLAMP, easing: EASE_OUT })
							if (turn >= 1) return null
							return (
								<div
									key={'leaf-' + index}
									style={{
										position: 'absolute',
										inset: 0,
										backgroundColor: LIGHT_STOCK ? THEME.surface : shade(THEME.surface, -0.04),
										borderTopRightRadius: cornerRadius(unit, 0.4),
										borderBottomRightRadius: cornerRadius(unit, 0.4),
										border: Math.max(1, unit) + 'px solid ' + withAlpha(THEME.ink, 0.14),
										padding: unit * 28,
										display: 'flex',
										alignItems: 'center',
										transformOrigin: 'left center',
										transform: 'rotateY(' + (turn * -172).toFixed(2) + 'deg)',
										backfaceVisibility: 'hidden',
										zIndex: pages.length - index,
										boxShadow: '0 ' + unit * 12 + 'px ' + unit * 30 + 'px ' + withAlpha('#000000', 0.24),
									}}
								>
									<span
										style={{
											fontFamily: DISPLAY_FONT,
											fontWeight: Math.max(420, DISPLAY_WEIGHT - 220),
											fontSize: size,
											lineHeight: 1.32,
											letterSpacing: trackingFor(size),
											color: THEME.ink,
										}}
									>
										{page}
									</span>
									<span
										style={{
											position: 'absolute',
											bottom: unit * 18,
											right: unit * 26,
											fontFamily: TEXT_FONT,
											fontSize: unit * 17,
											color: THEME.muted,
										}}
									>
										{String(index + 1)}
									</span>
								</div>
							)
						})}
					</div>
				</div>
			</AbsoluteFill>
			<div style={{ position: 'absolute', left: 0, right: 0, top: height * 0.12, display: 'flex', justifyContent: 'center' }}>
				<MicroLabel text={props.kicker || props.headline} delay={2} />
			</div>
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,

	'stamp-postcard': `
/**
 * A card from somewhere, postmarked.
 *
 * A stamp in the corner, a cancellation ring landing across it and a hand-set
 * message on the ruled half. Reads as arrival, as a place, or as a promise
 * that something is on its way.
 */
const StampPostcardScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height, fps } = useVideoConfig()
	const shape = props.variant % 4
	const rows = motionLines(props, 2)
	const card = { w: Math.min(width * 0.74, height * 1.1), h: Math.min(height * 0.6, width * 0.5) }
	const land = spring({ frame: frame - 8, fps, config: { damping: 14, mass: 0.8, stiffness: 120 } })
	const cancel = spring({ frame: frame - 30, fps, config: { damping: 9, mass: 0.7, stiffness: 200 } })
	const size = fitBlock(unit * 40, rows[0], card.w * 0.52 - unit * 30, card.h - unit * 80)

	return (
		<AbsoluteFill style={{ overflow: 'hidden' }}>
			<Backdrop seed={86} intensity={0.42} />
			<AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
				<div
					style={{
						width: card.w,
						height: card.h,
						backgroundColor: LIGHT_STOCK ? THEME.surface : shade(THEME.surface, -0.05),
						border: Math.max(1, unit * 1.6) + 'px solid ' + withAlpha(THEME.ink, 0.22),
						borderRadius: cornerRadius(unit, 0.4),
						display: 'flex',
						transform: 'rotate(' + ((1 - land) * (shape === 1 ? -8 : 5)).toFixed(2) + 'deg) scale(' + (0.86 + land * 0.14).toFixed(3) + ')',
						opacity: Math.min(1, land * 3),
						boxShadow: '0 ' + unit * 22 + 'px ' + unit * 50 + 'px ' + withAlpha('#000000', 0.34),
						overflow: 'hidden',
					}}
				>
					<div style={{ flex: 1, padding: unit * 28, display: 'flex', alignItems: 'center' }}>
						<span
							style={{
								fontFamily: DISPLAY_FONT,
								fontWeight: Math.max(440, DISPLAY_WEIGHT - 180),
								fontSize: size,
								lineHeight: 1.24,
								letterSpacing: trackingFor(size),
								color: THEME.ink,
							}}
						>
							{rows[0]}
						</span>
					</div>
					<div aria-hidden style={{ width: Math.max(1, unit * 1.4), backgroundColor: withAlpha(THEME.ink, 0.18) }} />
					<div style={{ flex: 1, padding: unit * 28, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
						<div style={{ display: 'flex', justifyContent: 'flex-end', position: 'relative' }}>
							<div
								style={{
									width: unit * 96,
									height: unit * 112,
									backgroundColor: withAlpha(THEME.accent, 0.9),
									border: Math.max(2, unit * 3) + 'px dashed ' + withAlpha(THEME.background, 0.8),
									display: 'flex',
									alignItems: 'center',
									justifyContent: 'center',
								}}
							>
								<MotionGlyph index={props.variant} size={unit * 54} delay={12} color={THEME.background} />
							</div>
							<div
								aria-hidden
								style={{
									position: 'absolute',
									right: unit * 40,
									top: unit * 10,
									width: unit * 130,
									height: unit * 130,
									borderRadius: '50%',
									border: Math.max(2, unit * 4) + 'px solid ' + withAlpha(THEME.ink, 0.55),
									transform: 'rotate(-14deg) scale(' + (0.6 + Math.min(1, cancel) * 0.4).toFixed(3) + ')',
									opacity: Math.min(1, cancel) * 0.9,
								}}
							/>
						</div>
						{new Array(4).fill(0).map((_, ruleIndex) => (
							<div
								key={'rule-' + ruleIndex}
								aria-hidden
								style={{
									height: Math.max(1, unit * 1.6),
									backgroundColor: withAlpha(THEME.ink, 0.16),
									opacity: interpolate(frame - (24 + ruleIndex * 4), [0, 10], [0, 1], CLAMP),
								}}
							/>
						))}
						<span
							style={{
								fontFamily: TEXT_FONT,
								fontSize: fitBlock(unit * 20, rows[1] || props.caption, card.w * 0.44, height * 0.1),
								lineHeight: 1.44,
								color: THEME.muted,
								opacity: interpolate(frame, [36, 52], [0, 1], CLAMP),
							}}
						>
							{rows[1] || props.caption}
						</span>
					</div>
				</div>
			</AbsoluteFill>
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,

	'receipt-roll': `
/**
 * A till roll printing itself.
 *
 * Lines arrive one at a time with a figure ruled right, a dashed tear at the
 * top and a total struck under a double rule. The form does the arguing: a
 * receipt is a thing nobody disputes.
 */
const ReceiptRollScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const lines = motionLines(props, shape === 1 ? 6 : 5)
	const roll = { w: Math.min(width * 0.46, height * 0.44) }
	const per = Math.max(7, beat(9))
	const size = fitBlock(
		unit * 22,
		lines.reduce((most, line) => (line.length > most.length ? line : most), ''),
		roll.w * 0.6,
		unit * 60,
	)

	return (
		<AbsoluteFill style={{ overflow: 'hidden' }}>
			<Backdrop seed={87} intensity={0.4} />
			<AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
				<div
					style={{
						width: roll.w,
						backgroundColor: LIGHT_STOCK ? THEME.surface : shade(THEME.surface, -0.02),
						padding: unit * 26,
						paddingTop: unit * 34,
						display: 'flex',
						flexDirection: 'column',
						gap: unit * 12,
						boxShadow: '0 ' + unit * 20 + 'px ' + unit * 46 + 'px ' + withAlpha('#000000', 0.3),
						transform: 'rotate(' + (shape === 2 ? -2 : 0) + 'deg)',
						clipPath:
							'polygon(0% 2%, 6% 0%, 12% 2%, 18% 0%, 24% 2%, 30% 0%, 36% 2%, 42% 0%, 48% 2%, 54% 0%, 60% 2%, 66% 0%, 72% 2%, 78% 0%, 84% 2%, 90% 0%, 96% 2%, 100% 0%, 100% 100%, 0% 100%)',
					}}
				>
					<span
						style={{
							fontFamily: TEXT_FONT,
							fontWeight: safeTextWeight(700),
							fontSize: unit * 20,
							letterSpacing: unit * 3,
							textTransform: 'uppercase',
							textAlign: 'center',
							color: THEME.ink,
						}}
					>
						{(props.kicker || props.headline).slice(0, 24)}
					</span>
					<div aria-hidden style={{ height: Math.max(1, unit * 1.6), backgroundColor: withAlpha(THEME.ink, 0.3) }} />
					{lines.map((line, index) => (
						<div
							key={'receipt-' + index}
							style={{
								display: 'flex',
								alignItems: 'baseline',
								justifyContent: 'space-between',
								gap: unit * 14,
								opacity: interpolate(frame - (14 + index * per), [0, 6], [0, 1], CLAMP),
							}}
						>
							<span style={{ fontFamily: TEXT_FONT, fontSize: size, lineHeight: 1.4, color: THEME.ink }}>{line}</span>
							<span style={{ fontFamily: DISPLAY_FONT, fontWeight: DISPLAY_WEIGHT, fontSize: size, color: THEME.muted }}>
								{props.stats[index] ? formatStat(props.stats[index], 1) : String(mpick('amount-' + index, 90) + 9)}
							</span>
						</div>
					))}
					<div aria-hidden style={{ height: Math.max(1, unit * 1.6), backgroundColor: withAlpha(THEME.ink, 0.3), marginTop: unit * 6 }} />
					<div aria-hidden style={{ height: Math.max(1, unit * 1.6), backgroundColor: withAlpha(THEME.ink, 0.3) }} />
					<div
						style={{
							display: 'flex',
							alignItems: 'baseline',
							justifyContent: 'space-between',
							opacity: interpolate(frame - (18 + lines.length * per), [0, 12], [0, 1], CLAMP),
						}}
					>
						<span style={{ fontFamily: TEXT_FONT, fontWeight: safeTextWeight(700), fontSize: size, letterSpacing: unit * 2, textTransform: 'uppercase', color: THEME.ink }}>
							{'Total'}
						</span>
						<span style={{ fontFamily: DISPLAY_FONT, fontWeight: DISPLAY_WEIGHT, fontSize: size * 1.7, color: THEME.accent }}>
							{props.stats[0] ? formatStat(props.stats[0], 1) : String(lines.length)}
						</span>
					</div>
				</div>
			</AbsoluteFill>
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,

	'blueprint-draft': `
/**
 * A drawing being dimensioned.
 *
 * A grid, a plate, and leader lines with witness marks calling out each part.
 * Everything is drawn in one weight on one ground, because that is what makes a
 * technical drawing read as measured rather than as decorated.
 */
const BlueprintDraftScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const callouts = motionLines(props, shape === 1 ? 4 : 3)
	const plate = Math.min(width * 0.42, height * 0.46)
	const grid = unit * (shape === 2 ? 26 : 40)
	const rule = withAlpha(THEME.accent, 0.9)
	const size = fitLine(
		unit * 22,
		callouts.reduce((most, call) => (call.length > most.length ? call : most), ''),
		width * 0.3,
	)

	return (
		<AbsoluteFill style={{ overflow: 'hidden' }}>
			<AbsoluteFill style={{ backgroundColor: LIGHT_STOCK ? shade(THEME.background, 0.04) : motionStage(0.38) }} />
			<AbsoluteFill
				aria-hidden
				style={{
					background:
						'repeating-linear-gradient(0deg, ' + withAlpha(THEME.accent, 0.16) + ' 0px, ' + withAlpha(THEME.accent, 0.16) +
						' 1px, transparent 1px, transparent ' + grid.toFixed(1) + 'px), repeating-linear-gradient(90deg, ' +
						withAlpha(THEME.accent, 0.16) + ' 0px, ' + withAlpha(THEME.accent, 0.16) + ' 1px, transparent 1px, transparent ' +
						grid.toFixed(1) + 'px)',
					opacity: interpolate(frame, [0, 20], [0, 1], CLAMP),
				}}
			/>
			<AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
				<div
					style={{
						width: plate,
						height: plate,
						border: Math.max(2, unit * 3) + 'px solid ' + rule,
						borderRadius: shape === 3 ? '50%' : cornerRadius(unit, 0.6),
						transform: 'rotate(' + interpolate(frame, [0, 200], [0, shape === 3 ? 0 : 8], CLAMP).toFixed(2) + 'deg)',
						opacity: interpolate(frame, [6, 26], [0, 1], CLAMP),
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
					}}
				>
					<MotionGlyph index={props.variant + 3} size={plate * 0.5} delay={14} color={rule} />
				</div>
			</AbsoluteFill>
			{callouts.map((call, index) => {
				const side = index % 2 === 0
				const draw = interpolate(frame - (24 + index * beat(8)), [0, 18], [0, 1], { ...CLAMP, easing: EASE_OUT })
				const top = height * (0.28 + index * 0.15)
				return (
					<div
						key={'callout-' + index}
						style={{
							position: 'absolute',
							top,
							left: side ? width * LAYOUT_INSET : undefined,
							right: side ? undefined : width * LAYOUT_INSET,
							display: 'flex',
							flexDirection: side ? 'row' : 'row-reverse',
							alignItems: 'center',
							gap: unit * 10,
							opacity: draw,
						}}
					>
						<span
							style={{
								fontFamily: TEXT_FONT,
								fontWeight: safeTextWeight(600),
								fontSize: size,
								letterSpacing: unit * 1.4,
								color: THEME.ink,
								textTransform: 'uppercase',
								whiteSpace: 'nowrap',
							}}
						>
							{call}
						</span>
						<div
							aria-hidden
							style={{
								width: width * 0.14 * draw,
								height: Math.max(1, unit * 1.6),
								backgroundColor: rule,
							}}
						/>
						<div aria-hidden style={{ width: unit * 10, height: unit * 10, borderRadius: '50%', backgroundColor: rule }} />
					</div>
				)
			})}
			<div style={{ position: 'absolute', left: width * LAYOUT_INSET, top: height * 0.1 }}>
				<MotionCaption kicker={props.kicker} headline={props.headline} delay={2} align="flex-start" size={unit * 46} />
			</div>
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,

	'sticker-sheet': `
/**
 * Die-cut stickers peeling off a sheet.
 *
 * Each sticker lands with a slight rotation and a lifted corner, so the sheet
 * reads as physical rather than as a grid of chips. Loose, warm and a little
 * chaotic - useful when the film needs to stop being serious for one beat.
 */
const StickerSheetScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height, fps } = useVideoConfig()
	const shape = props.variant % 4
	const stickers = motionItems(props, shape === 1 ? 6 : 5)
	const size = fitLine(
		unit * 30,
		stickers.reduce((most, sticker) => (sticker.title.length > most.length ? sticker.title : most), ''),
		width * 0.34,
	)

	return (
		<AbsoluteFill style={{ overflow: 'hidden' }}>
			<Backdrop seed={88} intensity={0.45} />
			{stickers.map((sticker, index) => {
				const pop = spring({ frame: frame - (10 + index * beat(7)), fps, config: { damping: 12, mass: 0.7, stiffness: 170 } })
				const left = width * (0.14 + mrand('sticker-x-' + index) * 0.62)
				const top = height * (0.2 + mrand('sticker-y-' + index) * 0.54)
				const tilt = (mrand('sticker-r-' + index) - 0.5) * (shape === 2 ? 34 : 18)
				const tone = index % 3
				return (
					<div
						key={'sticker-' + index}
						style={{
							position: 'absolute',
							left,
							top,
							maxWidth: Math.min(width * 0.34, width * 0.94 - left),
							padding: unit * 18,
							paddingLeft: unit * 26,
							paddingRight: unit * 26,
							borderRadius: unit * 60,
							backgroundColor: tone === 0 ? THEME.accent : tone === 1 ? THEME.accentAlt : THEME.surface,
							color: tone === 2 ? THEME.ink : THEME.background,
							border: Math.max(3, unit * 5) + 'px solid ' + THEME.background,
							display: 'flex',
							alignItems: 'center',
							gap: unit * 10,
							transform: 'rotate(' + (tilt * pop).toFixed(2) + 'deg) scale(' + Math.max(0, pop).toFixed(3) + ')',
							opacity: Math.min(1, pop * 3),
							boxShadow: unit * 6 + 'px ' + unit * 8 + 'px 0 ' + withAlpha('#000000', 0.25),
							zIndex: index,
						}}
					>
						<VectorIcon name={sticker.icon} size={size} color={tone === 2 ? THEME.accent : THEME.background} strokeWidth={2.2} />
						<span
							style={{
								fontFamily: DISPLAY_FONT,
								fontWeight: DISPLAY_WEIGHT,
								fontSize: size,
								letterSpacing: trackingFor(size),
								lineHeight: 1.1,
								whiteSpace: 'nowrap',
								textTransform: TYPE_KEEPS_CASE ? 'none' : 'uppercase',
							}}
						>
							{sticker.title}
						</span>
					</div>
				)
			})}
			<div style={{ position: 'absolute', left: width * LAYOUT_INSET, bottom: height * 0.1 }}>
				<MotionCaption kicker={props.kicker} headline={props.headline} delay={2} align="flex-start" size={unit * 50} />
			</div>
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,
} as const
