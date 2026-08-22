/**
 * AI-Generated Object3d Scene Component
 *
 * Drop-in for AI storyboard scenes with type: 'object3d' and assetId field.
 * Renders loaded 3D assets with full lighting, animation, and effects.
 */

import React from 'react'
import {
	AbsoluteFill,
	Easing,
	interpolate,
	useCurrentFrame,
	useVideoConfig,
} from 'remotion'
import { ThreeCanvas } from '@remotion/three'
import { useAsset3d } from './use-asset'

const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const

export interface Object3dSceneProps {
	frames: number
	/** Asset ID from catalog */
	assetId: string
	headline: string
	caption: string
	/** Lighting theme: 'default' | 'warm' | 'cool' | 'neon' */
	lightingTheme?: 'default' | 'warm' | 'cool' | 'neon'
	/** Enable satellites around the model */
	satellites?: boolean
	/** Camera animation: 'orbit' | 'drift' | 'static' */
	cameraMotion?: 'orbit' | 'drift' | 'static'
	backgroundColor?: string
}

const LIGHTING_PRESETS = {
	default: {
		ambient: { color: '#9db8ff', intensity: 0.58 },
		hemisphere: { color: '#f3e7ff', groundColor: '#111222', intensity: 1.05 },
		key: { color: '#fff4d6', intensity: 3.1, position: [4.8, 7.2, 5.4] as [number, number, number] },
		rim: { color: '#5edcff', intensity: 18 },
		fill: { color: '#ff6ec7', intensity: 14 },
	},
	warm: {
		ambient: { color: '#fff8e7', intensity: 0.65 },
		hemisphere: { color: '#ffd4a3', groundColor: '#1a1410', intensity: 1.1 },
		key: { color: '#ffca89', intensity: 3.3, position: [5, 7, 5] as [number, number, number] },
		rim: { color: '#ff9d4d', intensity: 16 },
		fill: { color: '#ff6b35', intensity: 12 },
	},
	cool: {
		ambient: { color: '#a8d8ff', intensity: 0.62 },
		hemisphere: { color: '#b4e7ff', groundColor: '#0a1428', intensity: 1.15 },
		key: { color: '#ffffff', intensity: 3.2, position: [5, 7.5, 5.5] as [number, number, number] },
		rim: { color: '#00e5ff', intensity: 20 },
		fill: { color: '#0080ff', intensity: 14 },
	},
	neon: {
		ambient: { color: '#1a0033', intensity: 0.4 },
		hemisphere: { color: '#ff00ff', groundColor: '#000000', intensity: 0.8 },
		key: { color: '#ffffff', intensity: 2.5, position: [4.5, 6.5, 5] as [number, number, number] },
		rim: { color: '#ff0080', intensity: 25 },
		fill: { color: '#00ffff', intensity: 18 },
	},
}

type LightingTheme = keyof typeof LIGHTING_PRESETS

const StageCaption: React.FC<{ headline: string; caption: string }> = ({
	headline,
	caption,
}) => {
	const { height } = useVideoConfig()

	return (
		<AbsoluteFill
			style={{
				justifyContent: 'flex-end',
				alignItems: 'center',
				paddingBottom: height * 0.085,
				gap: 14,
				flexDirection: 'column',
				pointerEvents: 'none',
			}}
		>
			<div
				style={{
					fontSize: 66,
					fontWeight: 800,
					color: '#f6f3ff',
					textAlign: 'center',
					maxWidth: '80%',
					lineHeight: 1.2,
				}}
			>
				{headline}
			</div>
			{caption && (
				<div
					style={{
						fontSize: 27,
						color: 'rgba(239,238,255,0.7)',
						textAlign: 'center',
						maxWidth: '80%',
						lineHeight: 1.45,
					}}
				>
					{caption}
				</div>
			)}
		</AbsoluteFill>
	)
}

/**
 * Renders an AI-generated object3d scene with loaded 3D asset.
 */
export const Object3dScene: React.FC<Object3dSceneProps> = ({
	frames,
	assetId,
	headline,
	caption,
	lightingTheme = 'default',
	satellites = true,
	cameraMotion = 'orbit',
	backgroundColor = '#080817',
}) => {
	const frame = useCurrentFrame()
	const { width, height } = useVideoConfig()
	const model = useAsset3d(assetId)

	const lighting = LIGHTING_PRESETS[lightingTheme as LightingTheme]

	// Animations
	const enter = interpolate(frame, [0, 34], [0.72, 1], {
		...CLAMP,
		easing: Easing.out(Easing.cubic),
	})
	const floatY = Math.sin(frame / 34) * 0.17
	const baseSpin = frame * 0.0115

	// Camera motion variants
	const cameraDistance = interpolate(
		frame,
		[0, frames],
		cameraMotion === 'static' ? [7.15, 7.15] : [8.6, 6.7],
		CLAMP,
	)

	const orbitSpin =
		cameraMotion === 'static'
			? 0
			: cameraMotion === 'drift'
				? Math.sin(frame / 150) * 0.42
				: Math.sin(frame / 100) * 0.6

	return (
		<AbsoluteFill style={{ backgroundColor, overflow: 'hidden' }}>
			<ThreeCanvas
				width={width}
				height={height}
				shadows="basic"
				dpr={1.5}
				camera={{
					fov: 31,
					near: 0.1,
					far: 80,
					position: [
						Math.sin(orbitSpin) * cameraDistance * 0.7,
						0.28,
						Math.cos(orbitSpin) * cameraDistance,
					],
				}}
				gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}
				style={{ position: 'absolute', inset: 0 }}
			>
				{/* Lighting rig */}
				<ambientLight
					color={lighting.ambient.color}
					intensity={lighting.ambient.intensity}
				/>
				<hemisphereLight
					color={lighting.hemisphere.color}
					groundColor={lighting.hemisphere.groundColor}
					intensity={lighting.hemisphere.intensity}
				/>
				<directionalLight
					castShadow
					color={lighting.key.color}
					intensity={lighting.key.intensity}
					position={lighting.key.position}
					shadow-mapSize-width={2048}
					shadow-mapSize-height={2048}
				/>
				<pointLight
					color={lighting.rim.color}
					intensity={lighting.rim.intensity}
					distance={12}
					decay={2}
					position={[-3.6, 1.6, 2.1]}
				/>
				<pointLight
					color={lighting.fill.color}
					intensity={lighting.fill.intensity}
					distance={10}
					decay={2}
					position={[3.4, -0.7, 1.8]}
				/>

				{/* Model */}
				{model ? (
					<>
						<group
							position={[0, floatY, 0]}
							rotation={[0, baseSpin, 0]}
							scale={model.scale * enter}
						>
							<primitive object={model.object} position={model.offset} />
						</group>

						{/* Shadow plane */}
						<mesh
							position={[0, -model.halfHeight - 0.1, 0]}
							rotation={[-Math.PI / 2, 0, 0]}
							receiveShadow
						>
							<circleGeometry args={[2.45, 96]} />
							<shadowMaterial color="#02020a" opacity={0.48} transparent />
						</mesh>

						{/* Satellites */}
						{satellites &&
							new Array(4).fill(0).map((_, index) => {
								const angle = baseSpin * (1.4 + index * 0.35) + index * 1.7
								const radius = 2.9 + index * 0.5
								return (
									<mesh
										key={`satellite-${index}`}
										castShadow
										position={[
											Math.cos(angle) * radius,
											Math.sin(angle * 0.8 + index) * 1.05,
											Math.sin(angle) * radius,
										]}
										scale={0.1 + index * 0.028}
									>
										<sphereGeometry args={[1, 18, 18]} />
										<meshStandardMaterial
											color={lighting.rim.color}
											emissive={lighting.rim.color}
											emissiveIntensity={0.75}
											roughness={0.3}
										/>
									</mesh>
								)
							})}

						{/* Accent ring */}
						<mesh position={[0, 0, -4.5]}>
							<ringGeometry args={[3.3, 3.36, 96]} />
							<meshBasicMaterial
								color={lighting.rim.color}
								transparent
								opacity={0.45}
							/>
						</mesh>

						{/* Base plane */}
						<mesh
							receiveShadow
							position={[0, -2.25, 0]}
							rotation={[-Math.PI / 2, 0, 0]}
						>
							<circleGeometry args={[8, 72]} />
							<meshStandardMaterial
								color="#1a2540"
								roughness={0.94}
								metalness={0.06}
							/>
						</mesh>
					</>
				) : null}
			</ThreeCanvas>

			{/* Typography overlay */}
			<StageCaption headline={headline} caption={caption} />
		</AbsoluteFill>
	)
}
