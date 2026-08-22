/**
 * LOCAL 3D ASSET TURNTABLE
 * -----------------------------------------------------------------------------
 * A deterministic Remotion/Three.js showcase for the bundled GLB library.
 *
 * The important loading contract is intentionally kept in this one file:
 * - resolve public models with staticFile()
 * - load with the official GLTFLoader add-on
 * - hold rendering with delayRender()/continueRender()
 * - animate exclusively from useCurrentFrame() (never useFrame())
 * - render through a sized, lit ThreeCanvas with preserveDrawingBuffer enabled
 *
 * The bundled v1 models are plain, self-contained GLB 2.0 files. They do not
 * need Draco, Meshopt, KTX2, external .bin files, or external textures.
 */

import React from 'react'
import { ThreeCanvas } from '@remotion/three'
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js'
import { Box3, Mesh, Vector3 } from 'three'
import {
	AbsoluteFill,
	Composition,
	Easing,
	continueRender,
	delayRender,
	interpolate,
	registerRoot,
	staticFile,
	useCurrentFrame,
	useVideoConfig,
} from 'remotion'

export const WIDTH = 1920
export const HEIGHT = 1080
export const FPS = 30
export const DURATION_IN_FRAMES = 360

const MODEL_SRC = staticFile('assets/3d/v1/characters/hero-bot/hero-bot-001.glb')
const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const

type GltfRecord = {
	promise: Promise<GLTF>
	value?: GLTF
	error?: Error
}

/** One network request and one parsed scene per URL, even across repeated shots. */
const gltfCache = new Map<string, GltfRecord>()

const requestGltf = (url: string): GltfRecord => {
	const cached = gltfCache.get(url)
	if (cached) return cached

	const record = {} as GltfRecord
	record.promise = new GLTFLoader().loadAsync(url).then(
		(value) => {
			record.value = value
			return value
		},
		(error: unknown) => {
			record.error = error instanceof Error ? error : new Error(String(error))
			throw record.error
		},
	)
	gltfCache.set(url, record)
	return record
}

/**
 * Remotion-aware GLB hook. React Suspense/useLoader alone is not the readiness
 * signal used by every export path, so this explicitly owns a render handle.
 */
const useStudioGltf = (url: string): GLTF | null => {
	const initial = gltfCache.get(url)
	const [gltf, setGltf] = React.useState<GLTF | null>(() => initial?.value ?? null)
	const [error, setError] = React.useState<Error | null>(() => initial?.error ?? null)

	React.useEffect(() => {
		if (gltf || error) return

		const handle = delayRender(`Loading bundled GLB: ${url}`)
		const record = requestGltf(url)
		let active = true
		let waiting = true
		const finish = () => {
			if (!waiting) return
			waiting = false
			continueRender(handle)
		}

		record.promise.then(
			(value) => {
				if (active) setGltf(value)
				finish()
			},
			(reason: unknown) => {
				if (active) setError(reason instanceof Error ? reason : new Error(String(reason)))
				finish()
			},
		)

		return () => {
			active = false
			finish()
		}
	}, [error, gltf, url])

	if (error) throw error
	return gltf
}

type NormalizedModel = {
	object: GLTF['scene']
	offset: [number, number, number]
	scale: number
	halfHeight: number
}

/** Clones, centres and normalises any v1 library model into the same stage. */
const normalizeModel = (gltf: GLTF): NormalizedModel => {
	const object = gltf.scene.clone(true)
	object.traverse((child) => {
		if (!(child instanceof Mesh)) return
		child.castShadow = true
		child.receiveShadow = true
	})

	const bounds = new Box3().setFromObject(object)
	const size = bounds.getSize(new Vector3())
	const center = bounds.getCenter(new Vector3())
	const largestDimension = Math.max(size.x, size.y, size.z, 0.001)
	const scale = 3.55 / largestDimension

	return {
		object,
		offset: [-center.x, -center.y, -center.z],
		scale,
		halfHeight: (size.y * scale) / 2,
	}
}

const ModelStage: React.FC = () => {
	const frame = useCurrentFrame()
	const { width, height, durationInFrames } = useVideoConfig()
	const gltf = useStudioGltf(MODEL_SRC)
	const model = React.useMemo(() => (gltf ? normalizeModel(gltf) : null), [gltf])
	const progress = frame / Math.max(1, durationInFrames - 1)
	const entrance = interpolate(frame, [0, 34], [0.72, 1], {
		...CLAMP,
		easing: Easing.out(Easing.cubic),
	})
	const floatY = Math.sin(progress * Math.PI * 4) * 0.055

	return (
		<AbsoluteFill style={{ pointerEvents: 'none' }}>
			<ThreeCanvas
				width={width}
				height={height}
				shadows="basic"
				dpr={1.5}
				camera={{ fov: 31, near: 0.1, far: 80, position: [0, 0.28, 7.15] }}
				gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}
				style={{ position: 'absolute', inset: 0 }}
			>
				<ambientLight color="#9db8ff" intensity={0.58} />
				<hemisphereLight color="#f3e7ff" groundColor="#111222" intensity={1.05} />
				<directionalLight
					castShadow
					color="#fff4d6"
					intensity={3.1}
					position={[4.8, 7.2, 5.4]}
					shadow-mapSize-width={2048}
					shadow-mapSize-height={2048}
				/>
				<pointLight color="#5edcff" intensity={18} distance={12} decay={2} position={[-3.6, 1.6, 2.1]} />
				<pointLight color="#ff6ec7" intensity={14} distance={10} decay={2} position={[3.4, -0.7, 1.8]} />

				{model ? (
					<>
						<group
							position={[0.72, floatY, 0]}
							rotation={[0, -0.5 + progress * Math.PI * 2, 0]}
							scale={model.scale * entrance}
						>
							<primitive object={model.object} position={model.offset} />
						</group>
						<mesh position={[0.72, -model.halfHeight - 0.1, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
							<circleGeometry args={[2.45, 96]} />
							<shadowMaterial color="#02020a" opacity={0.48} transparent />
						</mesh>
					</>
				) : null}
			</ThreeCanvas>
		</AbsoluteFill>
	)
}

const EditorialOverlay: React.FC = () => {
	const frame = useCurrentFrame()
	const { durationInFrames } = useVideoConfig()
	const enter = interpolate(frame, [8, 42], [0, 1], {
		...CLAMP,
		easing: Easing.out(Easing.cubic),
	})
	const leave = interpolate(frame, [durationInFrames - 28, durationInFrames - 1], [1, 0], {
		...CLAMP,
		easing: Easing.in(Easing.cubic),
	})
	const visible = enter * leave

	return (
		<AbsoluteFill style={{ color: '#f6f3ff', opacity: visible }}>
			<div
				style={{
					position: 'absolute',
					left: 96,
					top: 76,
					padding: '11px 18px',
					border: '1px solid rgba(214,222,255,0.3)',
					borderRadius: 999,
					fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
					fontSize: 18,
					fontWeight: 700,
					letterSpacing: 4.2,
					color: '#a8f4ff',
					backgroundColor: 'rgba(10,10,28,0.52)',
				}}
			>
				LOCAL GLB / 001
			</div>

			<div style={{ position: 'absolute', left: 96, top: 250, width: 680 }}>
				<div
					style={{
						fontFamily: 'Inter, Helvetica Neue, Arial, sans-serif',
						fontSize: 132,
						fontWeight: 850,
						letterSpacing: -8,
						lineHeight: 0.84,
						translate: `${(1 - enter) * -46}px 0`,
					}}
				>
					HERO
					<br />
					<span style={{ color: '#ff7bd5' }}>BOT</span>
				</div>
				<p
					style={{
						width: 500,
						margin: '38px 0 0',
						fontFamily: 'Inter, Helvetica Neue, Arial, sans-serif',
						fontSize: 27,
						lineHeight: 1.45,
						color: 'rgba(239,238,255,0.7)',
					}}
				>
					Self-contained geometry, materials and normals. Loaded once, framed automatically, ready for any future scene.
				</p>
			</div>

			<div
				style={{
					position: 'absolute',
					left: 96,
					bottom: 72,
					display: 'flex',
					gap: 38,
					fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
					fontSize: 17,
					letterSpacing: 2.6,
					color: 'rgba(224,231,255,0.64)',
				}}
			>
				<span>GLB 2.0</span>
				<span>FRAME-DRIVEN</span>
				<span>RENDER-SAFE</span>
			</div>
		</AbsoluteFill>
	)
}

export const AssetTurntable3D: React.FC = () => {
	const frame = useCurrentFrame()
	const { durationInFrames } = useVideoConfig()
	const phase = (frame / Math.max(1, durationInFrames - 1)) * Math.PI * 2

	return (
		<AbsoluteFill style={{ backgroundColor: '#080817', overflow: 'hidden' }}>
			<AbsoluteFill
				style={{
					background: `radial-gradient(ellipse at ${68 + Math.sin(phase) * 3}% ${44 + Math.cos(phase) * 4}%, rgba(83,220,255,0.2), transparent 34%), radial-gradient(ellipse at 30% 82%, rgba(255,74,183,0.14), transparent 40%), linear-gradient(138deg, #070713 0%, #121129 58%, #080817 100%)`,
				}}
			/>
			<svg width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} style={{ position: 'absolute', inset: 0 }}>
				<path
					d={`M -80 ${820 + Math.sin(phase) * 18} C 380 610, 760 1010, 1260 770 S 1900 520, 2050 650`}
					fill="none"
					stroke="#8deaff"
					strokeWidth="3"
					opacity="0.18"
				/>
				<circle cx="1520" cy="410" r="292" fill="none" stroke="#ff80d8" strokeWidth="2" opacity="0.13" />
			</svg>
			<ModelStage />
			<EditorialOverlay />
		</AbsoluteFill>
	)
}

export const Root: React.FC = () => (
	<Composition
		id="AssetTurntable3D"
		component={AssetTurntable3D}
		durationInFrames={DURATION_IN_FRAMES}
		fps={FPS}
		width={WIDTH}
		height={HEIGHT}
	/>
)

registerRoot(Root)

export default AssetTurntable3D
