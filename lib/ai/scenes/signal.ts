/**
 * Signal motion scenes.
 *
 * Ten pieces built from instruments and interfaces: sweeps, waveforms, spectra,
 * pings, scanners, progress, notifications, queries, tuners and telemetry. They
 * all share one idea - that something is being measured or received right now -
 * which is what makes them read as live rather than as illustrated.
 *
 * Emitted verbatim into the generated TSX: no backticks, no dollar-braces.
 */

export const SIGNAL_SCENES = {
	'radar-sweep': `
/**
 * A sweep finding contacts.
 *
 * The arm turns at a constant rate and each blip lights when the beam crosses
 * it, then fades on a decay - so the copy is discovered rather than listed. The
 * range rings and the bearing marks are drawn plainly so the labels stay the
 * brightest thing on the scope.
 */
const RadarSweepScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const contacts = motionLines(props, shape === 1 ? 6 : 4)
	const scope = Math.min(width * 0.62, height * 0.72)
	const centre = { x: width * 0.5, y: height * 0.5 }
	const turn = (frame * (shape === 2 ? 2.6 : 1.8)) % 360
	const chipSize = fitLine(
		unit * 21,
		contacts.reduce((most, contact) => (contact.length > most.length ? contact : most), ''),
		width * 0.3,
	)

	return (
		<AbsoluteFill style={{ overflow: 'hidden' }}>
			<Backdrop seed={90} intensity={0.4} />
			<AbsoluteFill style={{ backgroundColor: motionStage(0.34) }} />
			<svg width={width} height={height} style={{ position: 'absolute', inset: 0 }} aria-hidden>
				{[0.34, 0.66, 1].map((ring, index) => (
					<circle
						key={'range-' + index}
						cx={centre.x}
						cy={centre.y}
						r={(scope / 2) * ring}
						fill="none"
						stroke={withAlpha(THEME.accent, 0.24)}
						strokeWidth={Math.max(1, unit * 1.2)}
					/>
				))}
				{[0, 45, 90, 135].map((bearing) => {
					const rad = (bearing * Math.PI) / 180
					return (
						<line
							key={'bearing-' + bearing}
							x1={centre.x - Math.cos(rad) * (scope / 2)}
							y1={centre.y - Math.sin(rad) * (scope / 2)}
							x2={centre.x + Math.cos(rad) * (scope / 2)}
							y2={centre.y + Math.sin(rad) * (scope / 2)}
							stroke={withAlpha(THEME.accent, 0.14)}
							strokeWidth={Math.max(1, unit)}
						/>
					)
				})}
			</svg>
			<div
				aria-hidden
				style={{
					position: 'absolute',
					left: centre.x,
					top: centre.y - scope / 2,
					width: scope / 2,
					height: scope / 2,
					transformOrigin: 'left bottom',
					transform: 'rotate(' + turn.toFixed(2) + 'deg)',
					background: 'conic-gradient(from 0deg, ' + withAlpha(THEME.accent, 0.42) + ', transparent 42%)',
					borderBottomLeftRadius: '100%',
					mixBlendMode: LIGHT_STOCK ? 'multiply' : 'screen',
				}}
			/>
			{contacts.map((contact, index) => {
				const bearing = (index / contacts.length) * 360 + mrand('radar-b-' + index) * 40
				const range = 0.3 + mrand('radar-r-' + index) * 0.62
				const rad = (bearing * Math.PI) / 180
				// How long since the beam last passed this bearing, in degrees.
				const behind = (turn - bearing + 360) % 360
				const lit = Math.max(0, 1 - behind / 150)
				return (
					<div
						key={'contact-' + index}
						style={{
							position: 'absolute',
							left: centre.x + Math.cos(rad) * (scope / 2) * range,
							top: centre.y + Math.sin(rad) * (scope / 2) * range,
							transform: 'translate(-50%, -50%)',
							display: 'flex',
							alignItems: 'center',
							gap: unit * 8,
							whiteSpace: 'nowrap',
							opacity: 0.22 + lit * 0.78,
						}}
					>
						<div
							aria-hidden
							style={{
								width: unit * 12,
								height: unit * 12,
								borderRadius: '50%',
								backgroundColor: THEME.accent,
								boxShadow: '0 0 ' + unit * 18 * lit + 'px ' + THEME.accent,
							}}
						/>
						<span
							style={{
								fontFamily: TEXT_FONT,
								fontWeight: safeTextWeight(560),
								fontSize: chipSize,
								letterSpacing: unit * 1.2,
								color: THEME.ink,
								textTransform: 'uppercase',
							}}
						>
							{contact}
						</span>
					</div>
				)
			})}
			<div style={{ position: 'absolute', left: width * LAYOUT_INSET, top: height * 0.09 }}>
				<MotionCaption kicker={props.kicker} headline={props.headline} delay={2} align="flex-start" size={unit * 46} />
			</div>
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,

	'waveform-scrub': `
/**
 * A recording being played.
 *
 * The waveform is drawn from the seed so every film gets its own take, a
 * playhead crosses it, and the line the film is on is the one under the head.
 * Everything behind the head is played out and dimmed, which is what makes the
 * position mean something.
 */
const WaveformScrubScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const cues = motionLines(props, shape === 1 ? 4 : 3)
	const bars = shape === 2 ? 110 : 74
	const head = interpolate(frame, [8, Math.max(60, props.frames * 0.9)], [0, 1], CLAMP)
	const active = Math.min(cues.length - 1, Math.floor(head * cues.length))
	const lane = height * 0.34
	const size = fitBlock(unit * 52, cues[active] || '', width * 0.8, height * 0.2)

	return (
		<AbsoluteFill style={{ overflow: 'hidden' }}>
			<Backdrop seed={91} intensity={0.4} />
			<AbsoluteFill style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: unit * 34, padding: width * LAYOUT_INSET }}>
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
					{cues[active]}
				</span>
				<div style={{ position: 'relative', height: lane, display: 'flex', alignItems: 'center', gap: unit * 3 }}>
					{new Array(bars).fill(0).map((_, index) => {
						const at = index / bars
						const tall = (0.16 + mrand('wave-' + index) * 0.84) * lane
						const played = at <= head
						return (
							<div
								key={'wave-' + index}
								aria-hidden
								style={{
									flex: 1,
									height: tall,
									borderRadius: unit * 3,
									backgroundColor: played ? withAlpha(THEME.accent, 0.9) : withAlpha(THEME.ink, 0.22),
									transform: played && Math.abs(at - head) < 0.03 ? 'scaleY(1.2)' : undefined,
								}}
							/>
						)
					})}
					<div
						aria-hidden
						style={{
							position: 'absolute',
							left: head * 100 + '%',
							top: -unit * 10,
							bottom: -unit * 10,
							width: Math.max(2, unit * 3),
							backgroundColor: THEME.accentAlt,
							boxShadow: '0 0 ' + unit * 16 + 'px ' + withAlpha(THEME.accentAlt, 0.8),
						}}
					/>
				</div>
				<div style={{ display: 'flex', justifyContent: 'space-between' }}>
					{cues.map((cue, index) => (
						<span
							key={'cue-' + index}
							style={{
								fontFamily: TEXT_FONT,
								fontSize: fitLine(unit * 19, cue, (width * (1 - LAYOUT_INSET * 2)) / cues.length - unit * 20),
								letterSpacing: unit,
								textTransform: 'uppercase',
								color: index === active ? THEME.accent : THEME.muted,
								whiteSpace: 'nowrap',
							}}
						>
							{cue}
						</span>
					))}
				</div>
			</AbsoluteFill>
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,

	'equalizer-bars': `
/**
 * A spectrum with a band per idea.
 *
 * Each column breathes on its own frequency and the tallest one at any moment
 * carries the label that is currently lit, so the piece has a rhythm without
 * needing a beat map. Reads as energy, mix or balance.
 */
const EqualizerBarsScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const bands = motionLines(props, shape === 1 ? 7 : 5)
	const lane = height * 0.44
	const columnWidth = (width * (1 - LAYOUT_INSET * 2) - unit * 14 * (bands.length - 1)) / bands.length
	const size = fitBlock(
		unit * 24,
		bands.reduce((most, band) => (band.length > most.length ? band : most), ''),
		columnWidth,
		height * 0.14,
	)

	return (
		<AbsoluteFill style={{ overflow: 'hidden' }}>
			<Backdrop seed={92} intensity={0.42} />
			<AbsoluteFill style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: unit * 26, padding: width * LAYOUT_INSET }}>
				<MotionCaption kicker={props.kicker} headline={props.headline} delay={2} align="flex-start" size={unit * 48} />
				<div style={{ display: 'flex', alignItems: 'flex-end', gap: unit * 14, height: lane }}>
					{bands.map((band, index) => {
						const speed = 16 + (index % 4) * 9
						const swing = (Math.sin(frame / speed + index * 1.4) * 0.5 + 0.5) * 0.7 + 0.25
						const grow = interpolate(frame - (8 + index * beat(4)), [0, 18], [0, 1], { ...CLAMP, easing: EASE_OUT })
						const tall = lane * swing * grow
						return (
							<div key={'band-' + index} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: unit * 10 }}>
								<div
									aria-hidden
									style={{
										height: tall,
										borderRadius: shape === 3 ? 0 : cornerRadius(unit, 0.6),
										background:
											'linear-gradient(180deg, ' + THEME.accent + ' 0%, ' + withAlpha(THEME.accentAlt, 0.7) + ' 100%)',
										boxShadow: '0 0 ' + unit * 20 + 'px ' + withAlpha(THEME.accent, 0.3),
									}}
								/>
								<span
									style={{
										fontFamily: TEXT_FONT,
										fontWeight: safeTextWeight(580),
										fontSize: size,
										lineHeight: 1.24,
										color: swing > 0.7 ? THEME.ink : THEME.muted,
										opacity: grow,
									}}
								>
									{band}
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

	'sonar-ping': `
/**
 * A single ping going out and coming back.
 *
 * Rings leave the centre on a fixed interval and fade with distance; the copy
 * arrives on the ring that reaches it. Quiet, patient and unlike anything else
 * in the kit, so it suits a beat that needs to slow the film down.
 */
const SonarPingScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const rows = motionLines(props, 2)
	const period = Math.max(26, beat(34))
	const rings = 4
	const reach = Math.max(width, height) * 0.75
	const size = fitStack(unit * 78, rows, width * 0.6, height * 0.3)

	return (
		<AbsoluteFill style={{ overflow: 'hidden' }}>
			<Backdrop seed={93} intensity={0.4} />
			<AbsoluteFill style={{ backgroundColor: motionStage(0.36) }} />
			{new Array(rings).fill(0).map((_, index) => {
				const age = ((frame + index * period) % (period * rings)) / (period * rings)
				const radius = age * reach
				return (
					<div
						key={'ping-' + index}
						aria-hidden
						style={{
							position: 'absolute',
							left: width / 2 - radius,
							top: height / 2 - radius,
							width: radius * 2,
							height: radius * 2,
							borderRadius: '50%',
							border: Math.max(1, unit * (shape === 1 ? 4 : 2.4)) + 'px solid ' + withAlpha(THEME.accent, 0.7 * (1 - age)),
							opacity: 1 - age,
						}}
					/>
				)
			})}
			<AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: width * LAYOUT_INSET }}>
				<div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: unit * 16 }}>
					<div
						aria-hidden
						style={{
							width: unit * 22,
							height: unit * 22,
							borderRadius: '50%',
							backgroundColor: THEME.accent,
							boxShadow: '0 0 ' + unit * 30 + 'px ' + THEME.accent,
							marginBottom: unit * 10,
						}}
					/>
					{rows.map((row, index) => (
						<span
							key={'sonar-' + index}
							style={{
								fontFamily: DISPLAY_FONT,
								fontWeight: index === 0 ? DISPLAY_WEIGHT : Math.max(400, DISPLAY_WEIGHT - 240),
								fontSize: index === 0 ? size : size * 0.48,
								letterSpacing: trackingFor(size),
								lineHeight: 1.08,
								textAlign: 'center',
								maxWidth: width * 0.6,
								color: index === 0 ? THEME.ink : THEME.muted,
								textTransform: TYPE_KEEPS_CASE ? 'none' : 'uppercase',
								opacity: interpolate(frame - (14 + index * period * 0.5), [0, 18], [0, 1], CLAMP),
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

	'barcode-scan': `
/**
 * A code read by a moving beam.
 *
 * The bars are seeded so the code is different in every film, the beam crosses
 * once, and the decoded line appears underneath the moment the beam clears the
 * last bar. The reveal is timed to the read, not to a delay.
 */
const BarcodeScanScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const line = motionLines(props, 1)[0] || props.headline
	const bars = shape === 1 ? 58 : 40
	const pass = interpolate(frame, [10, Math.max(46, props.frames * 0.5)], [0, 1], { ...CLAMP, easing: EASE_OUT })
	const codeWidth = width * 0.66
	const size = fitBlock(unit * 60, line, codeWidth, height * 0.2)

	return (
		<AbsoluteFill style={{ overflow: 'hidden' }}>
			<Backdrop seed={94} intensity={0.36} />
			<AbsoluteFill style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: unit * 34 }}>
				<div style={{ position: 'relative', width: codeWidth, height: height * 0.24, display: 'flex', alignItems: 'stretch', gap: unit * 2 }}>
					{new Array(bars).fill(0).map((_, index) => {
						const thick = 1 + Math.floor(mrand('bar-' + index) * 3)
						const read = index / bars <= pass
						return (
							<div
								key={'bar-' + index}
								aria-hidden
								style={{
									flex: thick,
									backgroundColor: mrand('gap-' + index) > 0.36 ? (read ? THEME.accent : THEME.ink) : 'transparent',
									opacity: read ? 1 : 0.5,
								}}
							/>
						)
					})}
					<div
						aria-hidden
						style={{
							position: 'absolute',
							left: pass * 100 + '%',
							top: -unit * 18,
							bottom: -unit * 18,
							width: Math.max(2, unit * 4),
							backgroundColor: THEME.accentAlt,
							boxShadow: '0 0 ' + unit * 26 + 'px ' + THEME.accentAlt,
							opacity: pass < 1 ? 1 : 0,
						}}
					/>
				</div>
				<span
					style={{
						fontFamily: DISPLAY_FONT,
						fontWeight: DISPLAY_WEIGHT,
						fontSize: size,
						letterSpacing: trackingFor(size),
						lineHeight: 1.08,
						textAlign: 'center',
						maxWidth: codeWidth,
						color: THEME.ink,
						textTransform: TYPE_KEEPS_CASE ? 'none' : 'uppercase',
						opacity: interpolate(pass, [0.86, 1], [0, 1], CLAMP),
					}}
				>
					{line}
				</span>
				<span
					style={{
						fontFamily: TEXT_FONT,
						fontSize: unit * 19,
						letterSpacing: unit * 4,
						textTransform: 'uppercase',
						color: THEME.muted,
						opacity: interpolate(pass, [0.9, 1], [0, 1], CLAMP),
					}}
				>
					{props.caption || props.kicker}
				</span>
			</AbsoluteFill>
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,

	'loading-bars': `
/**
 * Several things completing at different rates.
 *
 * Each row fills to its own weight and stops, and the ones that finish first
 * are marked done - so a set of parallel efforts reads as a status rather than
 * as a chart. The last row lands on the beat the scene ends.
 */
const LoadingBarsScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const jobs = motionLines(props, shape === 1 ? 5 : 4)
	const weights = motionWeights(props, jobs.length)
	const track = width * (1 - LAYOUT_INSET * 2)
	const size = fitLine(
		unit * 26,
		jobs.reduce((most, job) => (job.length > most.length ? job : most), ''),
		track * 0.7,
	)

	return (
		<AbsoluteFill>
			<Backdrop seed={95} intensity={0.4} />
			<AbsoluteFill style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: unit * 24, padding: width * LAYOUT_INSET }}>
				<MotionCaption kicker={props.kicker} headline={props.headline} delay={2} align="flex-start" size={unit * 48} />
				{jobs.map((job, index) => {
					const target = 0.42 + weights[index] * 0.58
					const fill = interpolate(frame - (12 + index * beat(7)), [0, 34 + index * 6], [0, target], { ...CLAMP, easing: EASE_OUT })
					const done = fill >= target - 0.002
					return (
						<div key={'job-' + index} style={{ display: 'flex', flexDirection: 'column', gap: unit * 8 }}>
							<div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: unit * 16 }}>
								<span
									style={{
										fontFamily: TEXT_FONT,
										fontWeight: safeTextWeight(580),
										fontSize: size,
										color: THEME.ink,
										whiteSpace: 'nowrap',
										overflow: 'hidden',
										textOverflow: 'ellipsis',
									}}
								>
									{job}
								</span>
								<span
									style={{
										fontFamily: DISPLAY_FONT,
										fontWeight: DISPLAY_WEIGHT,
										fontSize: size * 0.9,
										color: done ? THEME.accent : THEME.muted,
										flex: '0 0 auto',
									}}
								>
									{Math.round(fill * 100) + '%'}
								</span>
							</div>
							<div
								aria-hidden
								style={{
									height: unit * (shape === 2 ? 20 : 12),
									borderRadius: shape === 3 ? 0 : unit * 20,
									backgroundColor: withAlpha(THEME.ink, 0.12),
									overflow: 'hidden',
								}}
							>
								<div
									style={{
										width: fill * 100 + '%',
										height: '100%',
										borderRadius: 'inherit',
										backgroundColor: done ? THEME.accent : THEME.accentAlt,
										boxShadow: done ? '0 0 ' + unit * 18 + 'px ' + withAlpha(THEME.accent, 0.5) : undefined,
									}}
								/>
							</div>
						</div>
					)
				})}
			</AbsoluteFill>
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,

	'notification-stack': `
/**
 * Alerts arriving one after another.
 *
 * Each card slides in from the edge, pushes the stack down and settles; the
 * older ones shrink back and dim, so the newest is always the one being read.
 * Reads as momentum, demand, or a queue that keeps growing.
 */
const NotificationStackScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height, fps } = useVideoConfig()
	const shape = props.variant % 4
	const alerts = motionItems(props, shape === 1 ? 5 : 4)
	const step = Math.max(14, (props.frames * 0.68) / alerts.length)
	const cardWidth = Math.min(width * 0.56, height * 0.7)
	const size = fitBlock(
		unit * 26,
		alerts.reduce((most, alert) => (alert.title.length > most.length ? alert.title : most), ''),
		cardWidth - unit * 108,
		unit * 96,
	)

	return (
		<AbsoluteFill style={{ overflow: 'hidden' }}>
			<Backdrop seed={96} intensity={0.44} />
			<AbsoluteFill
				style={{
					display: 'flex',
					flexDirection: 'column',
					alignItems: shape === 2 ? 'center' : 'flex-end',
					justifyContent: 'center',
					gap: unit * 14,
					padding: width * LAYOUT_INSET,
				}}
			>
				{alerts.map((alert, index) => {
					const start = 8 + index * step
					const slide = spring({ frame: frame - start, fps, config: { damping: 16, mass: 0.8, stiffness: 140 } })
					const behind = Math.max(0, alerts.length - 1 - index - Math.max(0, alerts.length - 1 - Math.floor((frame - 8) / step)))
					if (frame < start - 4) return null
					return (
						<div
							key={'alert-' + index}
							style={{
								width: cardWidth,
								display: 'flex',
								alignItems: 'center',
								gap: unit * 16,
								padding: unit * 22,
								paddingLeft: unit * 26,
								paddingRight: unit * 26,
								borderRadius: cornerRadius(unit, 1.2),
								backgroundColor: withAlpha(THEME.surface, 0.96),
								border: Math.max(1, unit * 1.4) + 'px solid ' + withAlpha(THEME.ink, 0.14),
								transform:
									'translateX(' + ((1 - slide) * (shape === 2 ? 0 : width * 0.4)).toFixed(1) + 'px) translateY(' +
									((1 - slide) * (shape === 2 ? unit * 40 : 0)).toFixed(1) + 'px) scale(' + (1 - behind * 0.03).toFixed(3) + ')',
								opacity: Math.min(1, slide * 2) * (1 - behind * 0.18),
								boxShadow: '0 ' + unit * 14 + 'px ' + unit * 34 + 'px ' + withAlpha('#000000', 0.3),
							}}
						>
							<div
								style={{
									width: unit * 54,
									height: unit * 54,
									flex: '0 0 auto',
									borderRadius: cornerRadius(unit, 0.8),
									backgroundColor: withAlpha(THEME.accent, 0.16),
									display: 'flex',
									alignItems: 'center',
									justifyContent: 'center',
								}}
							>
								<VectorIcon name={alert.icon} size={unit * 28} color={THEME.accent} strokeWidth={2} />
							</div>
							<div style={{ display: 'flex', flexDirection: 'column', gap: unit * 4, minWidth: 0 }}>
								<span style={{ fontFamily: TEXT_FONT, fontWeight: safeTextWeight(640), fontSize: size, lineHeight: 1.24, color: THEME.ink }}>
									{alert.title}
								</span>
								{alert.detail ? (
									<span
										style={{
											fontFamily: TEXT_FONT,
											fontSize: size * 0.8,
											lineHeight: 1.36,
											color: THEME.muted,
										}}
									>
										{alert.detail}
									</span>
								) : null}
							</div>
						</div>
					)
				})}
			</AbsoluteFill>
			<div style={{ position: 'absolute', left: width * LAYOUT_INSET, top: height * 0.1 }}>
				<MotionCaption kicker={props.kicker} headline={props.headline} delay={2} align="flex-start" size={unit * 48} />
			</div>
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,

	'search-suggest': `
/**
 * A query typing itself, with what comes back.
 *
 * The field types the headline character by character and the suggestions drop
 * in underneath as it goes. The frame is a question being asked, which makes it
 * a natural hook - the answers are the film.
 */
const SearchSuggestScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const query = props.headline
	const results = motionLines(props, shape === 1 ? 5 : 4)
	const perChar = Math.max(0.8, 1.9 * MOTION_TEMPO)
	const shown = Math.max(0, Math.min(query.length, Math.floor((frame - 10) / perChar)))
	const typed = shown >= query.length
	const field = Math.min(width * 0.74, height * 0.9)
	const querySize = fitLine(unit * 36, query, field - unit * 110)
	const resultSize = fitLine(
		unit * 26,
		results.reduce((most, result) => (result.length > most.length ? result : most), ''),
		field - unit * 110,
	)

	return (
		<AbsoluteFill>
			<Backdrop seed={97} intensity={0.4} />
			<AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: width * LAYOUT_INSET }}>
				<div style={{ width: field, display: 'flex', flexDirection: 'column', gap: unit * 10 }}>
					<div
						style={{
							display: 'flex',
							alignItems: 'center',
							gap: unit * 16,
							padding: unit * 22,
							paddingLeft: unit * 28,
							paddingRight: unit * 28,
							borderRadius: shape === 3 ? cornerRadius(unit) : unit * 60,
							backgroundColor: withAlpha(THEME.surface, 0.96),
							border: Math.max(2, unit * 2.2) + 'px solid ' + withAlpha(THEME.accent, 0.6),
							boxShadow: '0 ' + unit * 14 + 'px ' + unit * 34 + 'px ' + withAlpha('#000000', 0.26),
						}}
					>
						<VectorIcon name="target" size={unit * 30} color={THEME.accent} strokeWidth={2.2} />
						<span
							style={{
								fontFamily: TEXT_FONT,
								fontWeight: safeTextWeight(560),
								fontSize: querySize,
								color: THEME.ink,
								whiteSpace: 'nowrap',
								overflow: 'hidden',
							}}
						>
							{query.slice(0, shown)}
							{!typed && Math.floor(frame / 8) % 2 === 0 ? '|' : ''}
						</span>
					</div>
					{results.map((result, index) => {
						const at = 6 + index * beat(5)
						const arrive = interpolate(frame - (10 + query.length * perChar * 0.5) - at, [0, 14], [0, 1], { ...CLAMP, easing: EASE_OUT })
						return (
							<div
								key={'result-' + index}
								style={{
									display: 'flex',
									alignItems: 'center',
									gap: unit * 16,
									padding: unit * 18,
									paddingLeft: unit * 28,
									paddingRight: unit * 28,
									borderRadius: cornerRadius(unit),
									backgroundColor: index === 0 ? withAlpha(THEME.accent, 0.14) : withAlpha(THEME.surface, 0.8),
									opacity: arrive,
									transform: 'translateY(' + ((1 - arrive) * -unit * 14).toFixed(1) + 'px)',
								}}
							>
								<div aria-hidden style={{ width: unit * 10, height: unit * 10, borderRadius: '50%', backgroundColor: index === 0 ? THEME.accent : withAlpha(THEME.ink, 0.3) }} />
								<span
									style={{
										fontFamily: TEXT_FONT,
										fontSize: resultSize,
										color: index === 0 ? THEME.ink : THEME.muted,
										whiteSpace: 'nowrap',
										overflow: 'hidden',
										textOverflow: 'ellipsis',
									}}
								>
									{result}
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

	'dial-tuner': `
/**
 * A dial sliding across stations.
 *
 * The scale slides behind a fixed needle and each station it passes calls out
 * its name; the one it lands on stays lit. Reads as searching and then finding,
 * which is the shape of most turns.
 */
const DialTunerScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const stations = motionLines(props, shape === 1 ? 6 : 4)
	const spacing = width * 0.42
	const settle = interpolate(frame, [8, Math.max(56, props.frames * 0.62)], [0, stations.length - 1], {
		...CLAMP,
		easing: EASE_OUT,
	})
	const landed = Math.round(settle)
	const size = fitLine(
		unit * 54,
		stations.reduce((most, station) => (station.length > most.length ? station : most), ''),
		spacing * 0.9,
	)

	return (
		<AbsoluteFill style={{ overflow: 'hidden' }}>
			<Backdrop seed={98} intensity={0.44} />
			<AbsoluteFill style={{ backgroundColor: motionStage(0.24) }} />
			<div
				style={{
					position: 'absolute',
					top: height * 0.42,
					left: 0,
					right: 0,
					height: height * 0.2,
					display: 'flex',
					alignItems: 'center',
					transform: 'translateX(' + (width / 2 - settle * spacing - spacing / 2).toFixed(1) + 'px)',
				}}
			>
				{stations.map((station, index) => (
					<div
						key={'station-' + index}
						style={{
							width: spacing,
							flex: '0 0 auto',
							display: 'flex',
							flexDirection: 'column',
							alignItems: 'center',
							gap: unit * 10,
							opacity: Math.max(0.2, 1 - Math.abs(settle - index) * 0.7),
						}}
					>
						<span
							style={{
								fontFamily: DISPLAY_FONT,
								fontWeight: DISPLAY_WEIGHT,
								fontSize: size,
								letterSpacing: trackingFor(size),
								lineHeight: 1.06,
								textAlign: 'center',
								color: index === landed ? THEME.accent : THEME.ink,
								textTransform: TYPE_KEEPS_CASE ? 'none' : 'uppercase',
								whiteSpace: 'nowrap',
							}}
						>
							{station}
						</span>
						<div aria-hidden style={{ width: Math.max(2, unit * 3), height: unit * 26, backgroundColor: withAlpha(THEME.ink, 0.4) }} />
					</div>
				))}
			</div>
			<div
				aria-hidden
				style={{
					position: 'absolute',
					left: width / 2 - unit * 2,
					top: height * 0.34,
					width: Math.max(3, unit * 4),
					height: height * 0.3,
					backgroundColor: THEME.accentAlt,
					boxShadow: '0 0 ' + unit * 22 + 'px ' + THEME.accentAlt,
				}}
			/>
			<div
				aria-hidden
				style={{
					position: 'absolute',
					left: 0,
					right: 0,
					top: height * 0.62,
					height: Math.max(1, unit * 2),
					background:
						'repeating-linear-gradient(90deg, ' + withAlpha(THEME.ink, 0.4) + ' 0px, ' + withAlpha(THEME.ink, 0.4) + ' ' +
						Math.max(1, unit * 2).toFixed(1) + 'px, transparent ' + Math.max(1, unit * 2).toFixed(1) + 'px, transparent ' +
						(unit * 20).toFixed(1) + 'px)',
				}}
			/>
			<div style={{ position: 'absolute', left: width * LAYOUT_INSET, top: height * 0.12 }}>
				<MotionCaption kicker={props.kicker} headline={props.headline} delay={2} align="flex-start" size={unit * 46} />
			</div>
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,

	'telemetry-hud': `
/**
 * A read-out of everything at once.
 *
 * Corner brackets, a horizon rule, a bearing strip and a column of live figures
 * - the vocabulary of a cockpit, used to make a set of numbers feel like they
 * are being observed rather than reported.
 */
const TelemetryHudScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const readouts = motionItems(props, shape === 1 ? 4 : 3)
	const rule = withAlpha(THEME.accent, 0.8)
	const tilt = Math.sin(frame / 60) * (shape === 2 ? 3.4 : 1.4)
	const labelSize = fitLine(
		unit * 20,
		readouts.reduce((most, item) => (item.title.length > most.length ? item.title : most), ''),
		width * 0.3,
	)

	return (
		<AbsoluteFill style={{ overflow: 'hidden' }}>
			<Backdrop seed={99} intensity={0.4} />
			<AbsoluteFill style={{ backgroundColor: motionStage(0.3) }} />
			{[0, 1, 2, 3].map((corner) => (
				<div
					key={'bracket-' + corner}
					aria-hidden
					style={{
						position: 'absolute',
						left: corner % 2 === 0 ? width * 0.06 : undefined,
						right: corner % 2 === 1 ? width * 0.06 : undefined,
						top: corner < 2 ? height * 0.08 : undefined,
						bottom: corner >= 2 ? height * 0.08 : undefined,
						width: unit * 60,
						height: unit * 60,
						borderTop: corner < 2 ? Math.max(2, unit * 3) + 'px solid ' + rule : undefined,
						borderBottom: corner >= 2 ? Math.max(2, unit * 3) + 'px solid ' + rule : undefined,
						borderLeft: corner % 2 === 0 ? Math.max(2, unit * 3) + 'px solid ' + rule : undefined,
						borderRight: corner % 2 === 1 ? Math.max(2, unit * 3) + 'px solid ' + rule : undefined,
						opacity: interpolate(frame - corner * 3, [0, 14], [0, 1], CLAMP),
					}}
				/>
			))}
			<div
				aria-hidden
				style={{
					position: 'absolute',
					left: width * 0.14,
					right: width * 0.14,
					top: height * 0.5,
					height: Math.max(1, unit * 2),
					backgroundColor: rule,
					transform: 'rotate(' + tilt.toFixed(2) + 'deg)',
					opacity: 0.7,
				}}
			/>
			<AbsoluteFill style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: unit * 20, padding: width * LAYOUT_INSET }}>
				<MotionCaption kicker={props.kicker} headline={props.headline} delay={2} align="flex-start" size={unit * 50} />
				<div style={{ display: 'flex', flexDirection: 'column', gap: unit * 12 }}>
					{readouts.map((item, index) => {
						const stat = props.stats[index]
						const live = interpolate(frame - (14 + index * beat(6)), [0, 30], [0, 1], { ...CLAMP, easing: EASE_OUT })
						return (
							<div
								key={'readout-' + index}
								style={{
									display: 'flex',
									alignItems: 'baseline',
									gap: unit * 16,
									opacity: Math.min(1, live * 3),
								}}
							>
								<span
									style={{
										fontFamily: TEXT_FONT,
										fontSize: labelSize,
										letterSpacing: unit * 2,
										textTransform: 'uppercase',
										color: THEME.muted,
										minWidth: width * 0.22,
										whiteSpace: 'nowrap',
										overflow: 'hidden',
										textOverflow: 'ellipsis',
									}}
								>
									{item.title}
								</span>
								<div aria-hidden style={{ flex: 1, height: Math.max(1, unit * 1.4), backgroundColor: withAlpha(THEME.ink, 0.2) }} />
								<span
									style={{
										fontFamily: DISPLAY_FONT,
										fontWeight: DISPLAY_WEIGHT,
										fontSize: fitLine(unit * 44, stat ? formatStat(stat, 1) : String(index + 1), width * 0.24),
										color: THEME.accent,
										flex: '0 0 auto',
									}}
								>
									{stat ? formatStat(stat, live) : String(Math.round(live * (40 + index * 17)))}
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
} as const
