/**
 * NEON PRODUCT REVEAL - second sample for Remotion Video Studio.
 *
 * 1080x1920 - 30fps - 15s. Glassmorphism, spring physics, animated gradient
 * sweep and a kinetic feature list. Pure DOM/CSS, no external assets.
 *
 *   npx remotion studio samples/neon-product-reveal.tsx
 *   node scripts/render-local.mjs samples/neon-product-reveal.tsx --preset max
 */

import React from 'react'
import {
	AbsoluteFill,
	Composition,
	Easing,
	interpolate,
	registerRoot,
	Sequence,
	spring,
	useCurrentFrame,
	useVideoConfig,
} from 'remotion'

const SANS = 'Inter, "Helvetica Neue", Arial, sans-serif'
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace'

const INK = '#F5F7FF'
const MUTED = 'rgba(245,247,255,0.62)'
const ACCENT = '#7C6BFF'
const ACCENT_2 = '#22D3EE'

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const
const EASE = Easing.bezier(0.16, 1, 0.3, 1)

const FEATURES = [
	{ label: 'Frame accurate', detail: 'every pixel deterministic' },
	{ label: 'Hardware encoded', detail: 'WebCodecs H.264' },
	{ label: 'Zero render cost', detail: 'runs in the browser' },
]

const Aurora: React.FC = () => {
	const frame = useCurrentFrame()
	const angle = (frame / 450) * 360
	return (
		<AbsoluteFill style={{ backgroundColor: '#07060F' }}>
			<AbsoluteFill
				style={{
					background: `conic-gradient(from ${angle}deg at 50% 38%, ${ACCENT}33, ${ACCENT_2}22, #FF6B9A22, ${ACCENT}33)`,
					filter: 'blur(80px)',
					opacity: 0.85,
				}}
			/>
			<AbsoluteFill
				style={{
					background: 'radial-gradient(ellipse at 50% 30%, transparent 30%, #07060F 76%)',
				}}
			/>
		</AbsoluteFill>
	)
}

const GlassCard: React.FC<{ delay: number }> = ({ delay }) => {
	const frame = useCurrentFrame()
	const { fps } = useVideoConfig()
	const enter = spring({ frame: frame - delay, fps, config: { damping: 15, stiffness: 90, mass: 0.9 } })
	const sweep = interpolate((frame - delay) % 120, [0, 60, 120], [-420, 420, 420], clamp)
	const tilt = interpolate(Math.sin(frame / 40), [-1, 1], [-1.6, 1.6])

	return (
		<div
			style={{
				position: 'absolute',
				left: 140,
				top: 470,
				width: 800,
				height: 520,
				borderRadius: 40,
				overflow: 'hidden',
				border: '1px solid rgba(255,255,255,0.16)',
				backgroundColor: 'rgba(255,255,255,0.06)',
				boxShadow: '0 40px 120px rgba(0,0,0,0.55)',
				opacity: enter,
				transform: `translateY(${interpolate(enter, [0, 1], [70, 0])}px) rotate(${tilt}deg) scale(${interpolate(enter, [0, 1], [0.92, 1])})`,
			}}
		>
			<div
				style={{
					position: 'absolute',
					left: sweep,
					top: -120,
					width: 260,
					height: 760,
					background:
						'linear-gradient(100deg, transparent, rgba(255,255,255,0.22), transparent)',
					transform: 'rotate(18deg)',
				}}
			/>
			<div style={{ position: 'absolute', inset: 0, padding: 56 }}>
				<div
					style={{
						display: 'inline-flex',
						alignItems: 'center',
						gap: 10,
						padding: '10px 18px',
						borderRadius: 999,
						border: `1px solid ${ACCENT_2}66`,
						backgroundColor: `${ACCENT_2}1A`,
						fontFamily: MONO,
						fontSize: 20,
						color: ACCENT_2,
						letterSpacing: 1,
					}}
				>
					v1.0 · OUT NOW
				</div>
				<div
					style={{
						marginTop: 34,
						fontFamily: SANS,
						fontSize: 92,
						fontWeight: 900,
						letterSpacing: -3,
						lineHeight: 0.98,
						color: INK,
					}}
				>
					Render
					<br />
					<span style={{ color: ACCENT }}>anything.</span>
				</div>
				<div
					style={{
						marginTop: 26,
						fontFamily: SANS,
						fontSize: 28,
						lineHeight: 1.45,
						color: MUTED,
						maxWidth: 620,
					}}
				>
					Drop a React file in, get a finished video out.
				</div>
			</div>
		</div>
	)
}

const FeatureRow: React.FC<{ index: number; label: string; detail: string }> = ({
	index,
	label,
	detail,
}) => {
	const frame = useCurrentFrame()
	const { fps } = useVideoConfig()
	const enter = spring({ frame: frame - index * 8, fps, config: { damping: 16, stiffness: 110 } })

	return (
		<div
			style={{
				display: 'flex',
				alignItems: 'center',
				gap: 22,
				padding: '22px 28px',
				borderRadius: 22,
				border: '1px solid rgba(255,255,255,0.10)',
				backgroundColor: 'rgba(255,255,255,0.04)',
				opacity: enter,
				transform: `translateX(${interpolate(enter, [0, 1], [-60, 0])}px)`,
			}}
		>
			<div
				style={{
					width: 46,
					height: 46,
					borderRadius: 14,
					backgroundColor: `${ACCENT}2E`,
					border: `1px solid ${ACCENT}80`,
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					fontFamily: MONO,
					fontSize: 22,
					color: INK,
				}}
			>
				<div
					style={{
						width: index === 1 ? 18 : 15,
						height: index === 2 ? 8 : index === 1 ? 18 : 15,
						borderRadius: index === 1 ? '50%' : 3,
						border: index === 2 ? 'none' : `2px solid ${INK}`,
						backgroundColor: index === 2 ? INK : 'transparent',
						transform: index === 0 ? 'rotate(45deg)' : undefined,
					}}
				/>
			</div>
			<div>
				<div style={{ fontFamily: SANS, fontSize: 34, fontWeight: 700, color: INK }}>{label}</div>
				<div style={{ fontFamily: MONO, fontSize: 21, color: MUTED, marginTop: 4 }}>{detail}</div>
			</div>
		</div>
	)
}

export const NeonProductReveal: React.FC = () => {
	const frame = useCurrentFrame()
	const { durationInFrames } = useVideoConfig()
	const outro = interpolate(frame, [durationInFrames - 40, durationInFrames - 10], [0, 1], clamp)

	return (
		<AbsoluteFill style={{ backgroundColor: '#07060F' }}>
			<Aurora />

			<GlassCard delay={6} />

			<Sequence from={70}>
				<div
					style={{
						position: 'absolute',
						left: 140,
						top: 1060,
						width: 800,
						display: 'flex',
						flexDirection: 'column',
						gap: 18,
					}}
				>
					{FEATURES.map((feature, index) => (
						<FeatureRow key={feature.label} index={index} {...feature} />
					))}
				</div>
			</Sequence>

			<Sequence from={200}>
				<div
					style={{
						position: 'absolute',
						left: 140,
						top: 1400,
						width: 800,
						padding: '30px 36px',
						borderRadius: 26,
						background: `linear-gradient(120deg, ${ACCENT}, ${ACCENT_2})`,
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'space-between',
						opacity: interpolate(frame - 200, [0, 16], [0, 1], clamp),
						transform: `translateY(${interpolate(frame - 200, [0, 20], [40, 0], {
							...clamp,
							easing: EASE,
						})}px)`,
					}}
				>
					<span style={{ fontFamily: SANS, fontSize: 38, fontWeight: 800, color: '#0B0A17' }}>
						Upload a .tsx file
					</span>
					<span style={{ fontFamily: SANS, fontSize: 40, fontWeight: 900, color: '#0B0A17' }}>
						→
					</span>
				</div>
			</Sequence>

			<AbsoluteFill style={{ backgroundColor: '#07060F', opacity: outro * 0.65 }} />
		</AbsoluteFill>
	)
}

export const Root: React.FC = () => (
	<Composition
		id="NeonProductReveal"
		component={NeonProductReveal}
		durationInFrames={450}
		fps={30}
		width={1080}
		height={1920}
	/>
)

registerRoot(Root)

export default NeonProductReveal
