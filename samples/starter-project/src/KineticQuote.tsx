import React from 'react'
import {
	AbsoluteFill,
	Easing,
	interpolate,
	spring,
	useCurrentFrame,
	useVideoConfig,
} from 'remotion'

/**
 * A multi-file starter. Split your video into components exactly like this and
 * zip the folder - the studio resolves relative imports for you.
 */

const WORDS = ['SHIP', 'VIDEO', 'LIKE', 'CODE']

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const

export const KineticQuote: React.FC = () => {
	const frame = useCurrentFrame()
	const { fps, durationInFrames } = useVideoConfig()
	const progress = frame / (durationInFrames - 1)

	return (
		<AbsoluteFill
			style={{
				backgroundColor: '#0B0C10',
				justifyContent: 'center',
				alignItems: 'center',
				fontFamily: 'Inter, Arial, sans-serif',
			}}
		>
			<AbsoluteFill
				style={{
					background: `radial-gradient(circle at 50% ${40 + Math.sin(frame / 30) * 6}%, #1B2A4A 0%, #0B0C10 62%)`,
				}}
			/>

			<div style={{ position: 'relative', textAlign: 'center' }}>
				{WORDS.map((word, index) => {
					const enter = spring({
						frame: frame - index * 9,
						fps,
						config: { damping: 14, stiffness: 130, mass: 0.6 },
					})
					return (
						<div
							key={word}
							style={{
								fontSize: 132,
								fontWeight: 900,
								letterSpacing: -5,
								lineHeight: 1.02,
								color: index === 3 ? '#5EEAD4' : '#FFFFFF',
								opacity: enter,
								transform: `translateY(${interpolate(enter, [0, 1], [80, 0])}px) scale(${interpolate(
									enter,
									[0, 1],
									[0.86, 1],
								)})`,
							}}
						>
							{word}
						</div>
					)
				})}

				<div
					style={{
						marginTop: 40,
						fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
						fontSize: 26,
						letterSpacing: 4,
						color: 'rgba(255,255,255,0.55)',
						opacity: interpolate(frame, [40, 60], [0, 1], {
							...clamp,
							easing: Easing.out(Easing.quad),
						}),
					}}
				>
					REMOTION + NEXT.JS
				</div>
			</div>

			<div
				style={{
					position: 'absolute',
					left: 140,
					right: 140,
					bottom: 220,
					height: 6,
					borderRadius: 3,
					backgroundColor: 'rgba(255,255,255,0.12)',
					overflow: 'hidden',
				}}
			>
				<div
					style={{
						width: `${progress * 100}%`,
						height: '100%',
						backgroundColor: '#5EEAD4',
						boxShadow: '0 0 16px rgba(94,234,212,0.7)',
					}}
				/>
			</div>
		</AbsoluteFill>
	)
}
