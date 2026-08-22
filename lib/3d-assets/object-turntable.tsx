/**
 * Reusable 3D Object Turntable Component
 *
 * Generic product/object showcase that rotates any loaded 3D asset.
 * Drop-in for 'object3d' scene type in AI-generated storyboards.
 */

import React from 'react'
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from 'remotion'
import { ThreeCanvas } from '@remotion/three'
import { useAsset3d } from './use-asset'

const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const

export interface Object3dTurntableProps {
	/** Asset ID from catalog (e.g., 'hero-bot-001') or asset file URL */
	assetId: string
	/** Background color (hex) */
	backgroundColor?: string
	/** Ambient light color */
	ambientColor?: string
	/** Directional light color and intensity */
	keyLightColor?: string
	keyLightIntensity?: number
	/** Rim light (accent) color */
	rimLightColor?: string
	rimLightIntensity?: number
	/** Fill light (cool) color */
	fillLightColor?: string
	fillLightIntensity?: number
	/** Camera distance and FOV */
	cameraDistance?: number
	cameraFov?: number
	/** Rotation speed (rad/frame) */
	rotationSpeed?: number
	/** Float/bob animation amplitude */
	floatAmplitude?: number
	/** Shadow plane radius */
	shadowPlaneRadius?: number
	/** Enable wireframe overlay */
	wireframe?: boolean
	/** Glow effect on the model */
	glowColor?: string
	glowIntensity?: number
}

/**
 * Renders a single 3D asset as a rotating turntable with lighting setup.
 * Fully frame-driven, deterministic, export-safe.
 */
export const Object3dTurntable: React.FC<Object3dTurntableProps> = ({
	assetId,
	backgroundColor = '#080817',
	ambientColor = '#9db8ff',
	keyLightColor = '#fff4d6',
	keyLightIntensity = 3.1,
	rimLightColor = '#5edcff',
	rimLightIntensity = 18,
	fillLightColor = '#ff6ec7',
	fillLightIntensity = 14,
	cameraDistance = 7.15,
	cameraFov = 31,
	rotationSpeed = 0.009,
	floatAmplitude = 0.055,
	shadowPlaneRadius = 2.45,
	wireframe = false,
	glowColor = '#5edcff',
	glowIntensity = 0.2,
}) => {
	const frame = useCurrentFrame()
	const { width, height, durationInFrames } = useVideoConfig()
	const model = useAsset3d(assetId)

	const progress = frame / Math.max(1, durationInFrames - 1)
	const entrance = interpolate(frame, [0, 34], [0.72, 1], {
		...CLAMP,
		easing: Easing.out(Easing.cubic),
	})
	const floatY = Math.sin(progress * Math.PI * 4) * floatAmplitude
	const rotation = frame * rotationSpeed

	return (
		<AbsoluteFill style={{ backgroundColor, pointerEvents: 'none' }}>
			<ThreeCanvas
				width={width}
				height={height}
				shadows="basic"
				dpr={1.5}
				camera={{ fov: cameraFov, near: 0.1, far: 80, position: [0, 0.28, cameraDistance] }}
				gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}
				style={{ position: 'absolute', inset: 0 }}
			>
				{/* Lighting setup */}
				<ambientLight color={ambientColor} intensity={0.58} />
				<hemisphereLight color="#f3e7ff" groundColor="#111222" intensity={1.05} />
				<directionalLight
					castShadow
					color={keyLightColor}
					intensity={keyLightIntensity}
					position={[4.8, 7.2, 5.4]}
					shadow-mapSize-width={2048}
					shadow-mapSize-height={2048}
				/>
				<pointLight
					color={rimLightColor}
					intensity={rimLightIntensity}
					distance={12}
					decay={2}
					position={[-3.6, 1.6, 2.1]}
				/>
				<pointLight
					color={fillLightColor}
					intensity={fillLightIntensity}
					distance={10}
					decay={2}
					position={[3.4, -0.7, 1.8]}
				/>

				{/* Model with entrance animation */}
				{model ? (
					<>
						<group
							position={[0.72, floatY, 0]}
							rotation={[0, -0.5 + rotation, 0]}
							scale={model.scale * entrance}
						>
							<primitive object={model.object} position={model.offset} />
						</group>

						{/* Shadow plane */}
						<mesh
							position={[0.72, -model.halfHeight - 0.1, 0]}
							rotation={[-Math.PI / 2, 0, 0]}
							receiveShadow
						>
							<circleGeometry args={[shadowPlaneRadius, 96]} />
							<shadowMaterial color="#02020a" opacity={0.48} transparent />
						</mesh>

						{/* Wireframe overlay if enabled */}
						{wireframe && (
							<group
								position={[0.72, floatY, 0]}
								rotation={[0, -0.5 + rotation, 0]}
								scale={(model.scale * entrance) * 1.02}
							>
								<primitive object={model.object} position={model.offset} />
							</group>
						)}
					</>
				) : null}
			</ThreeCanvas>
		</AbsoluteFill>
	)
}

/**
 * Variant for product turntables with rotating satellite objects around the main model.
 */
export const Object3dTurntableWithSatellites: React.FC<
	Object3dTurntableProps & {
		satelliteCount?: number
		satelliteColor?: string
		satelliteGlow?: boolean
	}
> = ({
	satelliteCount = 4,
	satelliteColor = '#9678ff',
	satelliteGlow = true,
	...props
}) => {
	const frame = useCurrentFrame()
	const { width, height, durationInFrames } = useVideoConfig()
	const model = useAsset3d(props.assetId)

	const progress = frame / Math.max(1, durationInFrames - 1)
	const entrance = interpolate(frame, [0, 34], [0.72, 1], {
		...CLAMP,
		easing: Easing.out(Easing.cubic),
	})
	const floatY = Math.sin(progress * Math.PI * 4) * (props.floatAmplitude ?? 0.055)
	const rotation = frame * (props.rotationSpeed ?? 0.009)

	return (
		<AbsoluteFill style={{ backgroundColor: props.backgroundColor ?? '#080817' }}>
			<ThreeCanvas
				width={width}
				height={height}
				shadows="basic"
				dpr={1.5}
				camera={{
					fov: props.cameraFov ?? 31,
					near: 0.1,
					far: 80,
					position: [0, 0.28, props.cameraDistance ?? 7.15],
				}}
				gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}
				style={{ position: 'absolute', inset: 0 }}
			>
				<ambientLight color={props.ambientColor ?? '#9db8ff'} intensity={0.58} />
				<hemisphereLight color="#f3e7ff" groundColor="#111222" intensity={1.05} />
				<directionalLight
					castShadow
					color={props.keyLightColor ?? '#fff4d6'}
					intensity={props.keyLightIntensity ?? 3.1}
					position={[4.8, 7.2, 5.4]}
					shadow-mapSize-width={2048}
					shadow-mapSize-height={2048}
				/>

				{model ? (
					<>
						{/* Main model */}
						<group
							position={[0.72, floatY, 0]}
							rotation={[0, -0.5 + rotation, 0]}
							scale={model.scale * entrance}
						>
							<primitive object={model.object} position={model.offset} />
						</group>

						{/* Satellites orbiting */}
						{new Array(satelliteCount).fill(0).map((_, index) => {
							const angle = rotation * (1.4 + index * 0.35) + index * 1.7
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
										color={satelliteColor}
										emissive={satelliteGlow ? satelliteColor : '#000000'}
										emissiveIntensity={satelliteGlow ? 0.75 : 0}
										roughness={0.3}
									/>
								</mesh>
							)
						})}

						{/* Shadow plane */}
						<mesh
							position={[0.72, -model.halfHeight - 0.1, 0]}
							rotation={[-Math.PI / 2, 0, 0]}
							receiveShadow
						>
							<circleGeometry args={[props.shadowPlaneRadius ?? 2.45, 96]} />
							<shadowMaterial color="#02020a" opacity={0.48} transparent />
						</mesh>
					</>
				) : null}
			</ThreeCanvas>
		</AbsoluteFill>
	)
}
