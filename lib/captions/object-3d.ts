'use client'

/**
 * Turning one of the pack's GLB models into a sprite that can stand behind a
 * speaker.
 *
 * This is the only file in the subtitle studio that touches three.js, and it
 * is imported dynamically for exactly that reason: the 3D runtime is the
 * largest chunk in the app, and a plan made entirely of flat objects must
 * never pay for it.
 *
 * The renderer is small on purpose. There is no scene to compose - one model,
 * one turntable, a transparent background - so the interesting decisions are
 * about making that one model read at the size it will be drawn:
 *
 * - **The model is normalised, not trusted.** The pack's families are
 *   different heights in their own units, so each is centred on its own
 *   bounding box and scaled until its longest side is one unit. Without that,
 *   a tiny home and a heart icon at the same "40% of frame height" differ by a
 *   factor of ten.
 *
 * - **The camera is framed once and never moved.** A perspective camera pulled
 *   back to fit a unit sphere shows the whole model through a full turn, so
 *   nothing clips as it rotates - the failure that makes a turntable look
 *   broken rather than stylised.
 *
 * - **Rotation is a function of elapsed time.** Same input, same frame, every
 *   bake. The renderer holds no clock of its own.
 */

import type { ObjectSprite } from './object-sprite'
import { loadModelCatalog, modelPathForAssetId } from './object-models'

export type CreateModelSpriteArgs = {
	/** `<family>-<NNN>`, as written by `modelAssetId` */
	assetId: string
	/** the square canvas the model is rendered into, in pixels */
	size: number
	signal?: AbortSignal
}

/** Seconds for one full turn. Slow enough to read as solid, fast enough to notice. */
const TURN_SECONDS = 9

export async function createModelSprite(args: CreateModelSpriteArgs): Promise<ObjectSprite> {
	const catalog = await loadModelCatalog(args.signal)
	if (!catalog) {
		throw new Error(
			'The 3D model pack has not been built in this checkout. Run "npm run assets:3d", or choose a flat object instead.',
		)
	}

	const path = modelPathForAssetId(catalog, args.assetId)
	if (!path) throw new Error(`"${args.assetId}" is not a model in the 3D pack.`)

	const [three, loaderModule] = await Promise.all([
		import('three'),
		import('three/addons/loaders/GLTFLoader.js'),
	])
	if (args.signal?.aborted) throw new DOMException('Aborted', 'AbortError')

	const size = Math.max(64, Math.round(args.size))
	const canvas =
		typeof OffscreenCanvas !== 'undefined'
			? new OffscreenCanvas(size, size)
			: Object.assign(document.createElement('canvas'), { width: size, height: size })

	const renderer = new three.WebGLRenderer({
		canvas: canvas as unknown as HTMLCanvasElement,
		alpha: true,
		antialias: true,
		premultipliedAlpha: true,
	})
	renderer.setSize(size, size, false)
	renderer.setClearColor(0x000000, 0)
	renderer.toneMapping = three.ACESFilmicToneMapping
	renderer.toneMappingExposure = 1.15

	const scene = new three.Scene()
	const pivot = new three.Group()
	scene.add(pivot)

	// A soft sky/ground fill plus one key and one rim: enough shaping for a
	// low-poly model to have a front and a side without a light rig to tune.
	scene.add(new three.HemisphereLight(0xdfe8ff, 0x1b2030, 2.1))
	const key = new three.DirectionalLight(0xffffff, 2.6)
	key.position.set(2.4, 3.2, 2.8)
	scene.add(key)
	const rim = new three.DirectionalLight(0x9678ff, 1.8)
	rim.position.set(-2.6, 1.4, -2.2)
	scene.add(rim)

	const gltf = await new loaderModule.GLTFLoader().loadAsync(path).catch(() => {
		renderer.dispose()
		throw new Error(`"${path}" could not be loaded. Rebuild the pack with "npm run assets:3d".`)
	})
	if (args.signal?.aborted) {
		renderer.dispose()
		throw new DOMException('Aborted', 'AbortError')
	}

	const model = gltf.scene
	const box = new three.Box3().setFromObject(model)
	const span = new three.Vector3()
	const centre = new three.Vector3()
	box.getSize(span)
	box.getCenter(centre)
	const longest = Math.max(span.x, span.y, span.z) || 1
	model.position.set(-centre.x, -centre.y, -centre.z)
	pivot.add(model)
	pivot.scale.setScalar(1 / longest)

	// Pull back far enough that the model's bounding sphere fits through a full
	// turn, with a tenth of a unit of air so nothing grazes the frame edge.
	const camera = new three.PerspectiveCamera(32, 1, 0.1, 100)
	const radius = Math.sqrt(3) / 2
	const distance = (radius * 1.1) / Math.tan((camera.fov * Math.PI) / 360)
	camera.position.set(0, 0.12, distance)
	camera.lookAt(0, 0, 0)

	const draw = (seconds: number): typeof canvas => {
		pivot.rotation.y = (seconds / TURN_SECONDS) * Math.PI * 2
		// A gentle tilt so a flat-on family still shows a top face.
		pivot.rotation.x = 0.14
		renderer.render(scene, camera)
		return canvas
	}

	draw(0)

	return {
		source: canvas as unknown as CanvasImageSource,
		width: size,
		height: size,
		frameAt: (seconds) => draw(seconds) as unknown as CanvasImageSource,
		dispose() {
			model.traverse((child: unknown) => {
				const mesh = child as { geometry?: { dispose(): void }; material?: unknown }
				mesh.geometry?.dispose()
				const material = mesh.material
				if (Array.isArray(material)) {
					for (const entry of material) (entry as { dispose?: () => void }).dispose?.()
				} else {
					(material as { dispose?: () => void } | undefined)?.dispose?.()
				}
			})
			renderer.dispose()
		},
	}
}
