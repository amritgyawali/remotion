/**
 * AI 3D Asset Showcase
 *
 * Demonstrates the integrated 3D asset library in action.
 * Show-cases character, object, abstract, and environment assets with proper lighting.
 */

import React from 'react'
import {
	AbsoluteFill,
	Composition,
	Easing,
	Sequence,
	interpolate,
	registerRoot,
	spring,
	useCurrentFrame,
	useVideoConfig,
} from 'remotion'
import { Object3dScene } from '@/lib/3d-assets/object-scene'
import { Object3dTurntable } from '@/lib/3d-assets'

export const WIDTH = 1920
export const HEIGHT = 1080
export const FPS = 30
export const DURATION_IN_FRAMES = 1080 // 36 seconds

const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const

const Backdrop: React.FC<{ color: string }> = ({ color }) => (
	<AbsoluteFill style={{ backgroundColor: color }} />
)

/**
 * Showcase 1: Character Asset — Hero Bot
 */
const CharacterShowcase: React.FC = () => {
	const frame = useCurrentFrame()
	const { fps } = useVideoConfig()
	const enter = spring({
		frame,
		fps,
		config: { damping: 200, mass: 0.9, stiffness: 80 },
	})

	return (
		<AbsoluteFill style={{ backgroundColor: '#080817' }}>
			<Object3dScene
				frames={270}
				assetId="hero-bot-001"
				headline="Hero Bot 001"
				caption="Intelligent companion for the future"
				lightingTheme="default"
				cameraMotion="orbit"
				satellites
			/>
			<AbsoluteFill
				style={{
					background:
						'radial-gradient(circle at 30% 30%, rgba(83,220,255,0.15), transparent 35%)',
					pointerEvents: 'none',
				}}
			/>
		</AbsoluteFill>
	)
}

/**
 * Showcase 2: Product Asset — Crystal Gem
 */
const ProductShowcase: React.FC = () => {
	return (
		<AbsoluteFill style={{ backgroundColor: '#0a0a1a' }}>
			<Object3dScene
				frames={270}
				assetId="crystal-gem"
				headline="Crystal Gem"
				caption="Precision faceted geometry"
				lightingTheme="cool"
				cameraMotion="drift"
				satellites={false}
			/>
			<AbsoluteFill
				style={{
					background:
						'radial-gradient(circle at 70% 60%, rgba(0,229,255,0.1), transparent 40%)',
					pointerEvents: 'none',
				}}
			/>
		</AbsoluteFill>
	)
}

/**
 * Showcase 3: Abstract Asset — Orbital Torus (if available)
 */
const AbstractShowcase: React.FC = () => {
	return (
		<AbsoluteFill style={{ backgroundColor: '#0f0520' }}>
			<Object3dScene
				frames={270}
				assetId="orbital-torus"
				headline="Orbital Torus"
				caption="Mathematical beauty in motion"
				lightingTheme="neon"
				cameraMotion="orbit"
				satellites
			/>
			<AbsoluteFill
				style={{
					background:
						'radial-gradient(circle at 50% 50%, rgba(255,0,128,0.12), transparent 50%)',
					pointerEvents: 'none',
				}}
			/>
		</AbsoluteFill>
	)
}

/**
 * Title card
 */
const TitleCard: React.FC = () => {
	const frame = useCurrentFrame()
	const opacity = interpolate(frame, [0, 20, 50, 70], [0, 1, 1, 0], CLAMP)
	const scale = interpolate(frame, [0, 30], [0.8, 1], CLAMP)

	return (
		<AbsoluteFill
			style={{
				backgroundColor: '#080817',
				justifyContent: 'center',
				alignItems: 'center',
				opacity,
				transform: `scale(${scale})`,
			}}
		>
			<div style={{ textAlign: 'center', color: '#f6f3ff' }}>
				<h1
					style={{
						fontSize: 96,
						fontWeight: 800,
						margin: 0,
						letterSpacing: -2,
					}}
				>
					3D Assets
				</h1>
				<p style={{ fontSize: 32, margin: '20px 0 0', opacity: 0.7 }}>
					Fully integrated for video generation
				</p>
			</div>
		</AbsoluteFill>
	)
}

/**
 * Closing card
 */
const ClosingCard: React.FC = () => {
	const frame = useCurrentFrame()
	const opacity = interpolate(frame, [0, 20, 40, 60], [0, 1, 1, 0], CLAMP)

	return (
		<AbsoluteFill
			style={{
				backgroundColor: '#080817',
				justifyContent: 'center',
				alignItems: 'center',
				opacity,
			}}
		>
			<div style={{ textAlign: 'center', color: '#5ff4e5' }}>
				<p style={{ fontSize: 28, margin: 0, fontWeight: 600 }}>
					Ready for production
				</p>
			</div>
		</AbsoluteFill>
	)
}

/**
 * Main composition
 */
export const Ai3dAssetShowcase: React.FC = () => (
	<AbsoluteFill>
		<Sequence from={0} durationInFrames={70}>
			<TitleCard />
		</Sequence>

		<Sequence from={70} durationInFrames={270}>
			<CharacterShowcase />
		</Sequence>

		<Sequence from={340} durationInFrames={270}>
			<ProductShowcase />
		</Sequence>

		<Sequence from={610} durationInFrames={270}>
			<AbstractShowcase />
		</Sequence>

		<Sequence from={880} durationInFrames={200}>
			<ClosingCard />
		</Sequence>
	</AbsoluteFill>
)

export const Root: React.FC = () => (
	<Composition
		id="Ai3dAssetShowcase"
		component={Ai3dAssetShowcase}
		durationInFrames={DURATION_IN_FRAMES}
		fps={FPS}
		width={WIDTH}
		height={HEIGHT}
	/>
)

registerRoot(Root)

export default Ai3dAssetShowcase
