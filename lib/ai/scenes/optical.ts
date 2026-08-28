/**
 * Optical motion scenes.
 *
 * Ten pieces whose subject is light itself: what a lens does to it, what a
 * screen does to it, what happens when two grids of it interfere. None of them
 * draws an object - they draw the behaviour of the thing looking at the object,
 * which is why they can carry a beat that has no illustration to offer.
 *
 * Emitted verbatim into the generated TSX: no backticks, no dollar-braces.
 */

export const OPTICAL_SCENES = {
	'lens-flare-title': `
/**
 * An anamorphic streak crossing a title.
 *
 * The flare is the event and the words are what it lights on the way past: a
 * horizontal blade of light travels the frame, a ring of ghosts trails it at a
 * fraction of the speed, and the title is only fully legible once the blade has
 * cleared it. Cheap in a bad kit and unmistakable in a good one, so the ghosts
 * are placed on the same axis rather than scattered.
 */
const LensFlareTitleScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const sweep = interpolate(frame, [0, Math.max(48, props.frames * 0.55)], [-0.15, 1.15], { ...CLAMP, easing: EASE_OUT })
	const centre = { x: width * sweep, y: height * (shape === 1 ? 0.36 : 0.5) }
	const heat = interpolate(frame, [0, 20, 70], [0, 1, 0.55], CLAMP)
	const rows = motionLines(props, 1)
	const titleSize = fitStack(unit * 104, [props.headline], width * 0.82, height * 0.4)

	return (
		<AbsoluteFill style={{ overflow: 'hidden' }}>
			<Backdrop seed={60} intensity={0.55} />
			<AbsoluteFill style={{ backgroundColor: motionStage(0.22) }} />
			<AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
				<span
					style={{
						fontFamily: DISPLAY_FONT,
						fontWeight: DISPLAY_WEIGHT,
						fontSize: titleSize,
						letterSpacing: trackingFor(titleSize),
						lineHeight: 1.02,
						textAlign: 'center',
						maxWidth: width * 0.82,
						color: THEME.ink,
						textTransform: TYPE_KEEPS_CASE ? 'none' : 'uppercase',
						// The words brighten as the blade passes them rather than fading
						// in on a timer, so the light is doing the revealing.
						opacity: interpolate(sweep, [0.05, 0.45], [0.14, 1], CLAMP),
						textShadow: LIGHT_STOCK ? undefined : '0 0 ' + unit * 26 + 'px ' + withAlpha(THEME.glow, 0.4 * heat),
					}}
				>
					{props.headline}
				</span>
			</AbsoluteFill>
			<div
				aria-hidden
				style={{
					position: 'absolute',
					left: 0,
					right: 0,
					top: centre.y - unit * 3,
					height: Math.max(2, unit * 6),
					background:
						'linear-gradient(90deg, transparent 0%, ' +
						withAlpha(THEME.glow, 0) + ' ' + Math.max(0, sweep * 100 - 34).toFixed(1) + '%, ' +
						withAlpha(THEME.glow, 0.9 * heat) + ' ' + (sweep * 100).toFixed(1) + '%, ' +
						withAlpha(THEME.glow, 0) + ' ' + Math.min(100, sweep * 100 + 34).toFixed(1) + '%, transparent 100%)',
					filter: 'blur(' + unit * 3 + 'px)',
					mixBlendMode: LIGHT_STOCK ? 'multiply' : 'screen',
				}}
			/>
			<div
				aria-hidden
				style={{
					position: 'absolute',
					left: centre.x - unit * 150,
					top: centre.y - unit * 150,
					width: unit * 300,
					height: unit * 300,
					borderRadius: '50%',
					background: 'radial-gradient(circle, ' + withAlpha(THEME.glow, 0.5 * heat) + ' 0%, transparent 68%)',
					mixBlendMode: LIGHT_STOCK ? 'multiply' : 'screen',
				}}
			/>
			{[0.34, 0.58, 0.82, 1.24, 1.5].map((step, index) => {
				const ghost = 0.5 + (sweep - 0.5) * step
				const size = unit * (12 + index * 9) * (shape === 2 ? 1.5 : 1)
				return (
					<div
						key={'ghost-' + index}
						aria-hidden
						style={{
							position: 'absolute',
							left: width * ghost - size / 2,
							top: centre.y - size / 2,
							width: size,
							height: size,
							borderRadius: '50%',
							border: Math.max(1, unit * 1.4) + 'px solid ' +
								withAlpha(index % 2 === 0 ? THEME.accent : THEME.accentAlt, 0.36 * heat),
							backgroundColor: withAlpha(index % 2 === 0 ? THEME.accent : THEME.glow, 0.1 * heat),
							mixBlendMode: LIGHT_STOCK ? 'multiply' : 'screen',
						}}
					/>
				)
			})}
			<div style={{ position: 'absolute', left: 0, right: 0, bottom: height * 0.11, display: 'flex', justifyContent: 'center' }}>
				<MicroLabel text={props.caption || props.kicker || rows[0]} delay={40} />
			</div>
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,

	'chromatic-split': `
/**
 * Three channels finding each other.
 *
 * The headline is printed three times in the three primaries of the palette,
 * pulled apart on a diagonal and then brought back into register. The moment of
 * alignment is the beat, so the convergence is eased hard and the film holds on
 * the clean word afterwards.
 */
const ChromaticSplitScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const line = motionLines(props, 1)[0] || props.headline
	const size = fitStack(unit * 128, [line], width * 0.84, height * 0.44)
	const settle = interpolate(frame, [6, 44], [1, 0], { ...CLAMP, easing: EASE_OUT })
	// A second, smaller disturbance after the landing keeps the frame alive
	// without re-breaking the word.
	const tremor = Math.sin(frame / 7) * Math.max(0, interpolate(frame, [48, 96], [1, 0], CLAMP)) * unit * 1.6
	const spread = unit * (shape === 1 ? 44 : 30) * settle + tremor
	const channels = [
		{ color: THEME.accent, x: -spread, y: spread * (shape === 2 ? 0.7 : 0.22) },
		{ color: THEME.accentAlt, x: spread, y: -spread * (shape === 2 ? 0.7 : 0.22) },
		{ color: THEME.ink, x: 0, y: 0 },
	]

	return (
		<AbsoluteFill>
			<Backdrop seed={61} intensity={0.45} />
			<AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
				<div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
					{channels.map((channel, index) => (
						<span
							key={'channel-' + index}
							style={{
								position: index === channels.length - 1 ? 'relative' : 'absolute',
								fontFamily: DISPLAY_FONT,
								fontWeight: DISPLAY_WEIGHT,
								fontSize: size,
								letterSpacing: trackingFor(size),
								lineHeight: 1.02,
								textAlign: 'center',
								maxWidth: width * 0.84,
								color: channel.color,
								textTransform: TYPE_KEEPS_CASE ? 'none' : 'uppercase',
								transform: 'translate(' + channel.x.toFixed(2) + 'px, ' + channel.y.toFixed(2) + 'px)',
								mixBlendMode: index === channels.length - 1 ? undefined : LIGHT_STOCK ? 'multiply' : 'screen',
								opacity: index === channels.length - 1 ? 1 : 0.72,
							}}
						>
							{line}
						</span>
					))}
				</div>
			</AbsoluteFill>
			{shape !== 3 ? (
				<div style={{ position: 'absolute', left: 0, right: 0, top: height * 0.16, display: 'flex', justifyContent: 'center' }}>
					<MicroLabel text={props.kicker || props.caption} delay={30} />
				</div>
			) : null}
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,

	'moire-field': `
/**
 * Two rulings beating against each other.
 *
 * Neither grid is interesting on its own; the pattern lives in the difference
 * between them, and it changes every frame because one of them is turning. The
 * copy sits on a plate cut out of the interference so the words never fight the
 * pattern for the same pixels.
 */
const MoireFieldScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const rows = motionLines(props, 2)
	const pitch = unit * (shape === 1 ? 9 : 14)
	const turn = interpolate(frame, [0, 240], [0, shape === 2 ? 26 : 12], CLAMP)
	const ruling = (angle: number, tone: string) =>
		'repeating-linear-gradient(' + angle.toFixed(2) + 'deg, ' +
		tone + ' 0px, ' + tone + ' ' + (pitch * 0.42).toFixed(2) + 'px, transparent ' +
		(pitch * 0.42).toFixed(2) + 'px, transparent ' + pitch.toFixed(2) + 'px)'
	const size = fitStack(unit * 74, rows, width * 0.62, height * 0.34)

	return (
		<AbsoluteFill style={{ overflow: 'hidden' }}>
			<Backdrop seed={62} intensity={0.3} />
			<AbsoluteFill
				aria-hidden
				style={{ background: ruling(0, withAlpha(THEME.ink, LIGHT_STOCK ? 0.5 : 0.34)) }}
			/>
			<AbsoluteFill
				aria-hidden
				style={{
					background: ruling(turn, withAlpha(THEME.accent, 0.42)),
					mixBlendMode: LIGHT_STOCK ? 'multiply' : 'screen',
					transform: 'scale(1.4)',
				}}
			/>
			<AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
				<div
					style={{
						backgroundColor: THEME.background,
						padding: unit * 44,
						paddingLeft: unit * 54,
						paddingRight: unit * 54,
						borderRadius: cornerRadius(unit, 1.2),
						border: Math.max(2, unit * 2.4) + 'px solid ' + THEME.ink,
						display: 'flex',
						flexDirection: 'column',
						gap: unit * 12,
						maxWidth: width * 0.72,
						transform: 'scale(' + interpolate(frame, [4, 26], [0.9, 1], { ...CLAMP, easing: EASE_OUT }).toFixed(3) + ')',
						opacity: interpolate(frame, [4, 22], [0, 1], CLAMP),
						boxShadow: '0 ' + unit * 22 + 'px ' + unit * 54 + 'px ' + withAlpha('#000000', 0.34),
					}}
				>
					{rows.map((row, index) => (
						<span
							key={'moire-' + index}
							style={{
								fontFamily: DISPLAY_FONT,
								fontWeight: index === 0 ? DISPLAY_WEIGHT : Math.max(400, DISPLAY_WEIGHT - 220),
								fontSize: index === 0 ? size : size * 0.6,
								letterSpacing: trackingFor(size),
								lineHeight: 1.06,
								color: index === 0 ? THEME.ink : THEME.muted,
								textTransform: TYPE_KEEPS_CASE ? 'none' : 'uppercase',
								opacity: interpolate(frame - (12 + index * beat(7)), [0, 14], [0, 1], CLAMP),
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

	'caustic-pool': `
/**
 * Light through moving water.
 *
 * Caustics are bright where the surface focuses and dark where it spreads, so
 * the bands are drawn as a stack of soft rules whose brightness and offset each
 * run on their own sine. Rendering them as blurred bars rather than as a
 * texture keeps the palette in charge of the colour.
 */
const CausticPoolScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const bands = shape === 1 ? 16 : 11
	const rows = motionLines(props, 2)
	const size = fitStack(unit * 84, rows, width * 0.74, height * 0.4)

	return (
		<AbsoluteFill style={{ overflow: 'hidden' }}>
			<Backdrop seed={63} intensity={0.5} />
			<AbsoluteFill style={{ backgroundColor: motionStage(0.3) }} />
			{new Array(bands).fill(0).map((_, index) => {
				const phase = frame / (34 + (index % 5) * 7) + index * 0.9
				const drift = Math.sin(phase) * width * 0.06
				const bright = 0.16 + (Math.sin(phase * 1.7) * 0.5 + 0.5) * 0.5
				const thick = unit * (5 + (index % 3) * 7)
				return (
					<div
						key={'caustic-' + index}
						aria-hidden
						style={{
							position: 'absolute',
							left: -width * 0.2,
							width: width * 1.4,
							top: (height / bands) * index + Math.sin(phase * 0.6) * unit * 14,
							height: thick,
							background:
								'linear-gradient(90deg, transparent 0%, ' + withAlpha(THEME.glow, bright) + ' 38%, ' +
								withAlpha(THEME.accent, bright * 0.8) + ' 62%, transparent 100%)',
							transform: 'translateX(' + drift.toFixed(1) + 'px) rotate(' + (Math.sin(phase * 0.4) * 4).toFixed(2) + 'deg)',
							filter: 'blur(' + unit * (shape === 2 ? 5 : 9) + 'px)',
							mixBlendMode: LIGHT_STOCK ? 'multiply' : 'screen',
						}}
					/>
				)
			})}
			<AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: width * LAYOUT_INSET }}>
				<div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: unit * 16 }}>
					{rows.map((row, index) => (
						<span
							key={'pool-' + index}
							style={{
								fontFamily: DISPLAY_FONT,
								fontWeight: index === 0 ? DISPLAY_WEIGHT : Math.max(400, DISPLAY_WEIGHT - 240),
								fontSize: index === 0 ? size : size * 0.54,
								letterSpacing: trackingFor(size),
								lineHeight: 1.06,
								textAlign: 'center',
								color: index === 0 ? THEME.ink : THEME.muted,
								textTransform: TYPE_KEEPS_CASE ? 'none' : 'uppercase',
								opacity: interpolate(frame - (10 + index * beat(8)), [0, 18], [0, 1], CLAMP),
								transform: 'translateY(' + (interpolate(frame - (10 + index * beat(8)), [0, 18], [unit * 20, 0], { ...CLAMP, easing: EASE_OUT })).toFixed(1) + 'px)',
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

	'prism-refract': `
/**
 * One word entering a wedge and leaving as a spectrum.
 *
 * The headline arrives white, meets a glass wedge at the centre of the frame
 * and fans out the other side in the three palette hues at increasing angles.
 * The dispersion is what carries the beat, so the fan opens on an ease and then
 * holds rather than oscillating.
 */
const PrismRefractScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const line = motionLines(props, 1)[0] || props.headline
	const size = fitStack(unit * 92, [line], width * 0.66, height * 0.3)
	const open = interpolate(frame, [14, 52], [0, 1], { ...CLAMP, easing: EASE_OUT })
	const hues = [THEME.accent, THEME.glow, THEME.accentAlt]
	const wedge = Math.min(width, height) * 0.24

	return (
		<AbsoluteFill style={{ overflow: 'hidden' }}>
			<Backdrop seed={64} intensity={0.5} />
			<AbsoluteFill style={{ backgroundColor: motionStage(0.26) }} />
			<div
				aria-hidden
				style={{
					position: 'absolute',
					left: 0,
					right: width * 0.5,
					top: height * 0.5 - unit * 2,
					height: Math.max(2, unit * 4),
					backgroundColor: withAlpha(THEME.ink, 0.7),
					transformOrigin: 'left',
					transform: 'scaleX(' + interpolate(frame, [0, 16], [0, 1], { ...CLAMP, easing: EASE_OUT }).toFixed(3) + ')',
				}}
			/>
			<AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
				<div
					aria-hidden
					style={{
						width: 0,
						height: 0,
						borderLeft: wedge * 0.52 + 'px solid transparent',
						borderRight: wedge * 0.52 + 'px solid transparent',
						borderBottom: wedge + 'px solid ' + withAlpha(THEME.surface, 0.4),
						filter: 'drop-shadow(0 0 ' + unit * 16 + 'px ' + withAlpha(THEME.glow, 0.4) + ')',
						transform: 'rotate(' + (shape === 1 ? 18 : 0) + 'deg)',
					}}
				/>
			</AbsoluteFill>
			{hues.map((hue, index) => {
				const angle = (index - 1) * (shape === 2 ? 14 : 9) * open
				return (
					<AbsoluteFill
						key={'refract-' + index}
						style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: width * LAYOUT_INSET }}
					>
						<span
							style={{
								fontFamily: DISPLAY_FONT,
								fontWeight: DISPLAY_WEIGHT,
								fontSize: size,
								letterSpacing: trackingFor(size),
								lineHeight: 1.02,
								textAlign: 'right',
								maxWidth: width * 0.44,
								color: hue,
								textTransform: TYPE_KEEPS_CASE ? 'none' : 'uppercase',
								transformOrigin: 'left center',
								transform: 'rotate(' + angle.toFixed(2) + 'deg) translateX(' + (open * unit * 20 * index).toFixed(1) + 'px)',
								opacity: open * (index === 1 ? 1 : 0.78),
								mixBlendMode: LIGHT_STOCK ? 'multiply' : 'screen',
							}}
						>
							{line}
						</span>
					</AbsoluteFill>
				)
			})}
			<div style={{ position: 'absolute', left: width * LAYOUT_INSET, bottom: height * 0.1 }}>
				<MicroLabel text={props.caption || props.kicker} delay={54} />
			</div>
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,

	'bokeh-drift': `
/**
 * A frame pulling focus.
 *
 * Out-of-focus highlights drift across a dark stage while the copy sits behind
 * them, blurred, and comes sharp as the lens finds it. The orbs keep moving
 * after the pull so the shot never freezes; their sizes are seeded so no two
 * films get the same field.
 */
const BokehDriftScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const orbs = shape === 1 ? 22 : 15
	const rows = motionLines(props, 2)
	const size = fitStack(unit * 88, rows, width * 0.7, height * 0.36)
	const focus = interpolate(frame, [10, 46], [1, 0], { ...CLAMP, easing: EASE_OUT })

	return (
		<AbsoluteFill style={{ overflow: 'hidden' }}>
			<Backdrop seed={65} intensity={0.4} />
			<AbsoluteFill style={{ backgroundColor: motionStage(0.34) }} />
			<AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: width * LAYOUT_INSET }}>
				<div
					style={{
						display: 'flex',
						flexDirection: 'column',
						alignItems: 'center',
						gap: unit * 14,
						filter: 'blur(' + (focus * unit * 22).toFixed(2) + 'px)',
						transform: 'scale(' + (1 + focus * 0.06).toFixed(3) + ')',
					}}
				>
					{rows.map((row, index) => (
						<span
							key={'bokeh-line-' + index}
							style={{
								fontFamily: DISPLAY_FONT,
								fontWeight: index === 0 ? DISPLAY_WEIGHT : Math.max(400, DISPLAY_WEIGHT - 240),
								fontSize: index === 0 ? size : size * 0.5,
								letterSpacing: trackingFor(size),
								lineHeight: 1.06,
								textAlign: 'center',
								color: index === 0 ? THEME.ink : THEME.muted,
								textTransform: TYPE_KEEPS_CASE ? 'none' : 'uppercase',
							}}
						>
							{row}
						</span>
					))}
				</div>
			</AbsoluteFill>
			{new Array(orbs).fill(0).map((_, index) => {
				const seedX = mrand('bokeh-x-' + index)
				const seedY = mrand('bokeh-y-' + index)
				const radius = unit * (18 + mrand('bokeh-r-' + index) * 74)
				const rise = frame * (0.18 + seedY * 0.5)
				const top = ((seedY * height + rise) % (height + radius * 2)) - radius
				return (
					<div
						key={'bokeh-' + index}
						aria-hidden
						style={{
							position: 'absolute',
							left: seedX * width - radius / 2 + Math.sin(frame / 80 + index) * unit * 20,
							top,
							width: radius,
							height: radius,
							borderRadius: '50%',
							backgroundColor: withAlpha(index % 3 === 0 ? THEME.accent : index % 3 === 1 ? THEME.glow : THEME.accentAlt, 0.3),
							border: Math.max(1, unit) + 'px solid ' + withAlpha(THEME.glow, 0.22),
							filter: 'blur(' + unit * 4 + 'px)',
							mixBlendMode: LIGHT_STOCK ? 'multiply' : 'screen',
						}}
					/>
				)
			})}
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,

	'scanline-crt': `
/**
 * A tube, not a panel.
 *
 * Phosphor lines, a roll bar drifting up the frame and a soft bloom on the type
 * are what separate a CRT from a flat screen with a filter over it. The copy is
 * set in the terminal weight of the kit and jitters by less than a line so it
 * reads as signal rather than as a broken layout.
 */
const ScanlineCrtScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const rows = motionLines(props, 3)
	const size = fitStack(unit * 62, rows, width * 0.72, height * 0.46)
	const roll = (frame * unit * (shape === 1 ? 5 : 2.6)) % (height + unit * 200)
	const jitter = Math.round(Math.sin(frame / 3) * (mrand('crt-' + Math.floor(frame / 9)) > 0.86 ? unit * 4 : 0))

	return (
		<AbsoluteFill style={{ overflow: 'hidden' }}>
			<Backdrop seed={66} intensity={0.3} />
			<AbsoluteFill style={{ backgroundColor: motionStage(0.42) }} />
			<AbsoluteFill
				style={{
					display: 'flex',
					flexDirection: 'column',
					justifyContent: 'center',
					gap: unit * 16,
					padding: width * LAYOUT_INSET,
					transform: 'translateX(' + jitter + 'px)',
				}}
			>
				{rows.map((row, index) => (
					<span
						key={'crt-' + index}
						style={{
							fontFamily: TEXT_FONT,
							fontWeight: safeTextWeight(620),
							fontSize: index === 0 ? size : size * 0.62,
							letterSpacing: unit * 1.4,
							lineHeight: 1.3,
							color: index === 0 ? THEME.accent : THEME.ink,
							textTransform: 'uppercase',
							opacity: interpolate(frame - (8 + index * beat(6)), [0, 12], [0, 1], CLAMP),
							textShadow: LIGHT_STOCK
								? undefined
								: '0 0 ' + unit * 14 + 'px ' + withAlpha(index === 0 ? THEME.accent : THEME.glow, 0.7),
						}}
					>
						{row}
					</span>
				))}
			</AbsoluteFill>
			<AbsoluteFill
				aria-hidden
				style={{
					background:
						'repeating-linear-gradient(180deg, ' + withAlpha('#000000', LIGHT_STOCK ? 0.12 : 0.34) + ' 0px, ' +
						withAlpha('#000000', LIGHT_STOCK ? 0.12 : 0.34) + ' ' + Math.max(1, unit * 1.6).toFixed(2) + 'px, transparent ' +
						Math.max(1, unit * 1.6).toFixed(2) + 'px, transparent ' + Math.max(3, unit * 4).toFixed(2) + 'px)',
					pointerEvents: 'none',
				}}
			/>
			<div
				aria-hidden
				style={{
					position: 'absolute',
					left: 0,
					right: 0,
					top: height - roll,
					height: unit * 160,
					background: 'linear-gradient(180deg, transparent, ' + withAlpha(THEME.glow, 0.14) + ', transparent)',
					pointerEvents: 'none',
				}}
			/>
			<AbsoluteFill
				aria-hidden
				style={{
					background: 'radial-gradient(ellipse at center, transparent 52%, ' + withAlpha('#000000', 0.5) + ' 100%)',
					pointerEvents: 'none',
				}}
			/>
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,

	'halftone-bloom': `
/**
 * A dot screen opening from the centre.
 *
 * Every dot carries the same information - its radius - and the picture is the
 * field of them. A wave travels out from the middle growing the dots as it
 * passes, and the word sits in the clearing left behind, so the copy is
 * revealed by the screen rather than laid on top of it.
 */
const HalftoneBloomScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const columns = shape === 1 ? 26 : 18
	const rowCount = Math.max(6, Math.round((columns * height) / width))
	const line = motionLines(props, 1)[0] || props.headline
	const size = fitStack(unit * 96, [line], width * 0.7, height * 0.28)
	const wave = interpolate(frame, [4, Math.max(50, props.frames * 0.6)], [0, 1.35], { ...CLAMP, easing: EASE_OUT })
	const cell = width / columns

	return (
		<AbsoluteFill style={{ overflow: 'hidden' }}>
			<Backdrop seed={67} intensity={0.34} />
			<AbsoluteFill>
				{new Array(columns * rowCount).fill(0).map((_, index) => {
					const column = index % columns
					const row = Math.floor(index / columns)
					const x = (column + 0.5) / columns
					const y = (row + 0.5) / rowCount
					const reach = Math.sqrt((x - 0.5) * (x - 0.5) + (y - 0.5) * (y - 0.5)) * 1.6
					const front = Math.max(0, 1 - Math.abs(reach - wave) * 3.4)
					const settled = reach < wave ? 0.42 : 0
					const scale = Math.min(1, settled + front)
					if (scale < 0.02) return null
					const dot = cell * 0.78 * scale
					return (
						<div
							key={'dot-' + index}
							aria-hidden
							style={{
								position: 'absolute',
								left: x * width - dot / 2,
								top: y * height - dot / 2,
								width: dot,
								height: dot,
								borderRadius: shape === 2 ? cornerRadius(unit, 0.3) : '50%',
								backgroundColor: withAlpha(front > 0.4 ? THEME.accent : THEME.ink, LIGHT_STOCK ? 0.5 : 0.4),
							}}
						/>
					)
				})}
			</AbsoluteFill>
			<AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
				<div
					style={{
						backgroundColor: THEME.background,
						paddingLeft: unit * 40,
						paddingRight: unit * 40,
						paddingTop: unit * 22,
						paddingBottom: unit * 22,
						borderRadius: cornerRadius(unit, 0.8),
						opacity: interpolate(frame, [22, 40], [0, 1], CLAMP),
					}}
				>
					<span
						style={{
							fontFamily: DISPLAY_FONT,
							fontWeight: DISPLAY_WEIGHT,
							fontSize: size,
							letterSpacing: trackingFor(size),
							lineHeight: 1.04,
							textAlign: 'center',
							color: THEME.ink,
							textTransform: TYPE_KEEPS_CASE ? 'none' : 'uppercase',
						}}
					>
						{line}
					</span>
				</div>
			</AbsoluteFill>
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,

	'light-leak-wipe': `
/**
 * A film leak carrying one line off and another on.
 *
 * The leak is a warm bloom that crosses the frame; the swap happens inside it,
 * so the cut is hidden in the light rather than announced by it. Two lines
 * only - the piece is a transition with something to say, not a list.
 */
const LightLeakWipeScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const rows = motionLines(props, 2)
	const size = fitStack(unit * 98, rows, width * 0.76, height * 0.36)
	const cross = interpolate(frame, [10, Math.max(44, props.frames * 0.5)], [0, 1], { ...CLAMP, easing: EASE_OUT })
	const swapped = cross > 0.5
	const heat = 1 - Math.abs(cross - 0.5) * 2

	return (
		<AbsoluteFill style={{ overflow: 'hidden' }}>
			<Backdrop seed={68} intensity={0.44} />
			<AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: width * LAYOUT_INSET }}>
				<span
					style={{
						fontFamily: DISPLAY_FONT,
						fontWeight: DISPLAY_WEIGHT,
						fontSize: size,
						letterSpacing: trackingFor(size),
						lineHeight: 1.04,
						textAlign: 'center',
						maxWidth: width * 0.76,
						color: swapped ? THEME.accent : THEME.ink,
						textTransform: TYPE_KEEPS_CASE ? 'none' : 'uppercase',
						opacity: 1 - heat * 0.85,
						transform: 'translateY(' + (heat * unit * (shape === 1 ? 26 : 12)).toFixed(1) + 'px)',
					}}
				>
					{swapped ? rows[1] || rows[0] : rows[0]}
				</span>
			</AbsoluteFill>
			<div
				aria-hidden
				style={{
					position: 'absolute',
					top: -height * 0.2,
					bottom: -height * 0.2,
					left: width * (cross * 1.5 - 0.4),
					width: width * 0.5,
					background:
						'linear-gradient(100deg, transparent 0%, ' + withAlpha(THEME.glow, 0.5) + ' 34%, ' +
						withAlpha(THEME.accentAlt, 0.66) + ' 52%, ' + withAlpha(THEME.glow, 0.4) + ' 68%, transparent 100%)',
					filter: 'blur(' + unit * 28 + 'px)',
					mixBlendMode: LIGHT_STOCK ? 'multiply' : 'screen',
					transform: 'rotate(' + (shape === 2 ? -12 : -4) + 'deg)',
				}}
			/>
			<div style={{ position: 'absolute', left: 0, right: 0, bottom: height * 0.1, display: 'flex', justifyContent: 'center' }}>
				<MicroLabel text={props.caption || props.kicker} delay={44} />
			</div>
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,

	'vignette-pulse': `
/**
 * An iris breathing around one statement.
 *
 * The frame closes to a circle and opens again on the film's own tempo, which
 * puts the viewer's attention exactly where the sentence is and nowhere else.
 * The type does not move; everything around it does.
 */
const VignettePulseScene: React.FC<MotionSceneProps> = (props) => {
	const frame = useCurrentFrame()
	const unit = useUnit()
	const { width, height } = useVideoConfig()
	const shape = props.variant % 4
	const line = motionLines(props, 1)[0] || props.headline
	const size = fitStack(unit * 86, [line], width * 0.6, height * 0.4)
	const open = interpolate(frame, [0, 30], [0.18, 1], { ...CLAMP, easing: EASE_OUT })
	const breath = 1 + Math.sin(frame / (shape === 1 ? 26 : 44)) * 0.06
	const iris = 34 + open * breath * (shape === 2 ? 22 : 30)

	return (
		<AbsoluteFill style={{ overflow: 'hidden' }}>
			<Backdrop seed={69} intensity={0.5} />
			<AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: width * LAYOUT_INSET }}>
				<div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: unit * 18 }}>
					<span
						style={{
							fontFamily: DISPLAY_FONT,
							fontWeight: DISPLAY_WEIGHT,
							fontSize: size,
							letterSpacing: trackingFor(size),
							lineHeight: 1.06,
							textAlign: 'center',
							maxWidth: width * 0.6,
							color: THEME.ink,
							textTransform: TYPE_KEEPS_CASE ? 'none' : 'uppercase',
							opacity: interpolate(frame, [8, 26], [0, 1], CLAMP),
						}}
					>
						{line}
					</span>
					{props.caption ? (
						<span
							style={{
								fontFamily: TEXT_FONT,
								fontSize: fitBlock(unit * 26, props.caption, width * 0.5, height * 0.12),
								lineHeight: 1.42,
								textAlign: 'center',
								maxWidth: width * 0.5,
								color: THEME.muted,
								opacity: interpolate(frame, [24, 44], [0, 1], CLAMP),
							}}
						>
							{props.caption}
						</span>
					) : null}
				</div>
			</AbsoluteFill>
			<AbsoluteFill
				aria-hidden
				style={{
					background:
						'radial-gradient(circle at 50% 50%, transparent ' + iris.toFixed(1) + '%, ' +
						withAlpha('#000000', LIGHT_STOCK ? 0.3 : 0.72) + ' ' + (iris + 26).toFixed(1) + '%)',
					pointerEvents: 'none',
				}}
			/>
			<SceneEdge frames={props.frames} />
		</AbsoluteFill>
	)
}
`,
} as const
