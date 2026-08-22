/**
 * Remotion 3D Asset Loading Hook
 *
 * Handles GLB loading, normalization, and caching for deterministic, frame-driven rendering.
 * Integrates with Remotion's delayRender/continueRender pattern.
 */

import React from 'react'
import { Box3, Mesh, Vector3 } from 'three'
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js'
import { continueRender, delayRender, staticFile } from 'remotion'
import { assetById, type Asset3d } from './catalog'

type GltfRecord = {
	promise: Promise<GLTF>
	value?: GLTF
	error?: Error
}

/** Singleton cache: one network request per URL, reused across all comps. */
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

export interface NormalizedModel {
	object: GLTF['scene']
	offset: [number, number, number]
	scale: number
	halfHeight: number
	boundingBox: { min: Vector3; max: Vector3; size: Vector3 }
}

/**
 * Normalize any model to consistent framing: centered, scaled, with shadow planes computed.
 * Clones the scene so it can be reused across multiple compositions safely.
 */
export const normalizeModel = (gltf: GLTF): NormalizedModel => {
	const object = gltf.scene.clone(true)

	// Set up shadows
	object.traverse((child) => {
		if (!(child instanceof Mesh)) return
		child.castShadow = true
		child.receiveShadow = true
	})

	// Compute bounds and center
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
		boundingBox: {
			min: bounds.min,
			max: bounds.max,
			size,
		},
	}
}

/**
 * useAsset3d — Remotion hook for loading and rendering 3D assets.
 *
 * Integrates with:
 * - Remotion's delayRender/continueRender for export safety
 * - Three.js GLTFLoader
 * - Caching to avoid redundant network requests
 * - Deterministic frame-driven animation (useCurrentFrame, never useFrame)
 *
 * @param assetIdOrUrl Asset ID from catalog or direct URL
 * @returns Normalized model or null while loading
 * @throws Error if asset not found or load fails
 */
export const useAsset3d = (assetIdOrUrl: string): NormalizedModel | null => {
	// Resolve asset ID to URL
	const url = React.useMemo(() => {
		const asset = assetById(assetIdOrUrl)
		if (asset) {
			return staticFile(asset.path)
		}
		// Allow direct URLs (for custom assets)
		if (assetIdOrUrl.startsWith('http') || assetIdOrUrl.startsWith('/')) {
			return assetIdOrUrl
		}
		throw new Error(`Asset not found: ${assetIdOrUrl}`)
	}, [assetIdOrUrl])

	const initial = gltfCache.get(url)
	const [model, setModel] = React.useState<NormalizedModel | null>(
		() => initial?.value ? normalizeModel(initial.value) : null,
	)
	const [error, setError] = React.useState<Error | null>(() => initial?.error ?? null)

	React.useEffect(() => {
		if (model || error) return

		const handle = delayRender(`Loading 3D asset: ${assetIdOrUrl}`)
		const record = requestGltf(url)
		let active = true
		let waiting = true

		const finish = () => {
			if (!waiting) return
			waiting = false
			continueRender(handle)
		}

		record.promise.then(
			(gltf) => {
				if (active) setModel(normalizeModel(gltf))
				finish()
			},
			(reason: unknown) => {
				if (active)
					setError(reason instanceof Error ? reason : new Error(String(reason)))
				finish()
			},
		)

		return () => {
			active = false
			finish()
		}
	}, [error, model, url, assetIdOrUrl])

	if (error) throw error
	return model
}

/**
 * Asset metadata accessor — gets catalog info for an asset.
 * Useful for AI to select appropriate assets by capabilities.
 */
export const getAssetInfo = (id: string): Asset3d | undefined => assetById(id)

/**
 * Cache control — clear loaded assets if needed (e.g., in development).
 */
export const clearAssetCache = (): void => {
	gltfCache.clear()
}

/**
 * Cache stats — for debugging and profiling.
 */
export const getAssetCacheStats = (): {
	loaded: number
	pending: number
	failed: number
} => {
	let loaded = 0,
		pending = 0,
		failed = 0
	gltfCache.forEach((record) => {
		if (record.error) failed++
		else if (record.value) loaded++
		else pending++
	})
	return { loaded, pending, failed }
}
