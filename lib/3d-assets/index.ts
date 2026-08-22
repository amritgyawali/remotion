/**
 * 3D Asset System
 *
 * Complete library for loading, managing, and rendering 3D assets in Remotion videos.
 * Deterministic, frame-driven, export-safe.
 */

export {
	type Asset3d,
	type AssetCategory,
	ALL_ASSETS,
	CHARACTER_ASSETS,
	OBJECT_ASSETS,
	ABSTRACT_ASSETS,
	ENVIRONMENT_ASSETS,
	ICON_ASSETS,
	assetById,
	assetsByCategory,
	assetsByTag,
	assetsForScene,
	assetsForAspect,
} from './catalog'

export {
	useAsset3d,
	normalizeModel,
	getAssetInfo,
	clearAssetCache,
	getAssetCacheStats,
	type NormalizedModel,
} from './use-asset'

export {
	Object3dTurntable,
	Object3dTurntableWithSatellites,
	type Object3dTurntableProps,
} from './object-turntable'

export {
	Object3dScene,
	type Object3dSceneProps,
} from './object-scene'
