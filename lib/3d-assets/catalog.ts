/**
 * 3D Asset Catalog
 *
 * Centralized registry of all 3D assets available for video generation.
 * Each asset is self-contained GLB 2.0 — no external textures, bin files, or loaders needed.
 */

export type AssetCategory = 'character' | 'object' | 'environment' | 'abstract' | 'icon'

export interface Asset3d {
	id: string
	name: string
	category: AssetCategory
	path: string
	/** Suggested scale for normalization (1 = default) */
	scale: number
	/** Animation loop duration in frames at 30fps. null = static. */
	animationDuration: number | null
	/** Best aspect ratios for this asset */
	aspectRatios: ('16:9' | '9:16' | '1:1' | '4:5' | '21:9')[]
	/** Dimension mode this asset fits best */
	dimensionModes: ('flat' | 'depth' | 'three')[]
	/** Scene types that can use this asset */
	sceneTypes: string[]
	tags: string[]
	/** Description for AI selection */
	description: string
	/** Licensing info */
	license: 'proprietary' | 'cc0' | 'cc-by' | 'cc-by-sa'
}

/**
 * Hero Character Library
 * Characters suitable for product demos, testimonials, explainers.
 */
export const CHARACTER_ASSETS: Asset3d[] = [
	{
		id: 'hero-bot-001',
		name: 'Hero Bot 001',
		category: 'character',
		path: 'assets/3d/v1/characters/hero-bot/hero-bot-001.glb',
		scale: 1,
		animationDuration: null,
		aspectRatios: ['16:9', '1:1'],
		dimensionModes: ['three'],
		sceneTypes: ['object3d', 'carousel3d'],
		tags: ['bot', 'character', 'tech', 'friendly', 'metallic'],
		description: 'Sleek robotic character. Ideal for tech product demos and feature showcases.',
		license: 'proprietary',
	},
	{
		id: 'astronaut-simple',
		name: 'Astronaut Simple',
		category: 'character',
		path: 'assets/3d/v1/characters/astronaut/astronaut-simple.glb',
		scale: 0.95,
		animationDuration: null,
		aspectRatios: ['16:9', '1:1'],
		dimensionModes: ['three'],
		sceneTypes: ['object3d', 'carousel3d'],
		tags: ['astronaut', 'space', 'character', 'exploration'],
		description: 'Minimalist astronaut character. Great for space, innovation, and journey narratives.',
		license: 'cc0',
	},
]

/**
 * Product Objects
 * Physical objects, products, and tangible items for turntables.
 */
export const OBJECT_ASSETS: Asset3d[] = [
	{
		id: 'smart-speaker',
		name: 'Smart Speaker',
		category: 'object',
		path: 'assets/3d/v1/objects/electronics/smart-speaker.glb',
		scale: 1,
		animationDuration: null,
		aspectRatios: ['16:9', '1:1'],
		dimensionModes: ['three'],
		sceneTypes: ['object3d'],
		tags: ['product', 'speaker', 'electronics', 'tech'],
		description: 'Cylindrical smart speaker with metallic finish. Product showcase turntable.',
		license: 'proprietary',
	},
	{
		id: 'crystal-gem',
		name: 'Crystal Gem',
		category: 'object',
		path: 'assets/3d/v1/objects/gemstones/crystal-gem.glb',
		scale: 1,
		animationDuration: null,
		aspectRatios: ['16:9', '1:1'],
		dimensionModes: ['three'],
		sceneTypes: ['object3d'],
		tags: ['gem', 'crystal', 'luxury', 'value'],
		description: 'Faceted crystal with light refraction. Premium product or achievement visualization.',
		license: 'cc0',
	},
	{
		id: 'smartphone-minimal',
		name: 'Smartphone Minimal',
		category: 'object',
		path: 'assets/3d/v1/objects/electronics/smartphone-minimal.glb',
		scale: 0.8,
		animationDuration: null,
		aspectRatios: ['9:16', '16:9'],
		dimensionModes: ['three'],
		sceneTypes: ['object3d'],
		tags: ['phone', 'mobile', 'app', 'tech'],
		description: 'Simple smartphone model with screen. App or mobile product demo.',
		license: 'cc0',
	},
]

/**
 * Abstract Geometry
 * Procedural shapes and mathematical forms for conceptual visualizations.
 */
export const ABSTRACT_ASSETS: Asset3d[] = [
	{
		id: 'orbital-torus',
		name: 'Orbital Torus',
		category: 'abstract',
		path: 'assets/3d/v1/abstract/geometric/orbital-torus.glb',
		scale: 1,
		animationDuration: null,
		aspectRatios: ['16:9', '1:1'],
		dimensionModes: ['three'],
		sceneTypes: ['object3d', 'carousel3d'],
		tags: ['torus', 'orbital', 'math', 'motion'],
		description: 'Smooth torus knot with parametric deformation. Tech, science, or data visualization.',
		license: 'cc0',
	},
	{
		id: 'morphing-icosphere',
		name: 'Morphing Icosphere',
		category: 'abstract',
		path: 'assets/3d/v1/abstract/geometric/morphing-icosphere.glb',
		scale: 1,
		animationDuration: 360,
		aspectRatios: ['16:9', '1:1'],
		dimensionModes: ['three'],
		sceneTypes: ['object3d'],
		tags: ['sphere', 'morph', 'transformation', 'growth'],
		description: 'Dynamically deforming sphere. Growth, evolution, or process visualization.',
		license: 'cc0',
	},
	{
		id: 'helix-dna',
		name: 'Helix DNA',
		category: 'abstract',
		path: 'assets/3d/v1/abstract/scientific/helix-dna.glb',
		scale: 1,
		animationDuration: null,
		aspectRatios: ['16:9', '1:1'],
		dimensionModes: ['three'],
		sceneTypes: ['object3d'],
		tags: ['helix', 'dna', 'science', 'biology', 'biotech'],
		description: 'Double helix DNA strand. Biotech, genetics, or science communication.',
		license: 'cc0',
	},
]

/**
 * Environment Modules
 * Terrain, buildings, and environmental context pieces.
 */
export const ENVIRONMENT_ASSETS: Asset3d[] = [
	{
		id: 'floating-island',
		name: 'Floating Island',
		category: 'environment',
		path: 'assets/3d/v1/environment/terrain/floating-island.glb',
		scale: 1,
		animationDuration: null,
		aspectRatios: ['16:9'],
		dimensionModes: ['three'],
		sceneTypes: ['terrain3d', 'landscape'],
		tags: ['island', 'terrain', 'fantasy', 'exploration'],
		description: 'Isolated floating terrain with vegetation. Landscape or journey narrative.',
		license: 'cc0',
	},
	{
		id: 'pagoda-temple',
		name: 'Pagoda Temple',
		category: 'environment',
		path: 'assets/3d/v1/environment/architecture/pagoda-temple.glb',
		scale: 1,
		animationDuration: null,
		aspectRatios: ['16:9', '1:1'],
		dimensionModes: ['three'],
		sceneTypes: ['monument', 'terrain3d'],
		tags: ['temple', 'architecture', 'asian', 'landmark'],
		description: 'Traditional multi-tiered temple. Cultural, heritage, or landmark content.',
		license: 'cc0',
	},
	{
		id: 'city-skyline',
		name: 'City Skyline',
		category: 'environment',
		path: 'assets/3d/v1/environment/architecture/city-skyline.glb',
		scale: 1,
		animationDuration: null,
		aspectRatios: ['16:9', '21:9'],
		dimensionModes: ['three'],
		sceneTypes: ['terrain3d'],
		tags: ['city', 'urban', 'skyline', 'business'],
		description: 'Stylized cityscape silhouette. Urban, business, or growth narratives.',
		license: 'cc0',
	},
]

/**
 * Icon Geometry
 * Small, symbol-like 3D shapes for UI elements and infographics.
 */
export const ICON_ASSETS: Asset3d[] = [
	{
		id: 'cube-icon',
		name: 'Cube Icon',
		category: 'icon',
		path: 'assets/3d/v1/icons/primitives/cube.glb',
		scale: 1,
		animationDuration: null,
		aspectRatios: ['16:9', '1:1'],
		dimensionModes: ['three'],
		sceneTypes: ['carousel3d'],
		tags: ['cube', 'box', 'container', 'structure'],
		description: 'Simple cube. UI icon, container, or building block metaphor.',
		license: 'cc0',
	},
	{
		id: 'star-icon',
		name: 'Star Icon',
		category: 'icon',
		path: 'assets/3d/v1/icons/symbols/star.glb',
		scale: 1,
		animationDuration: null,
		aspectRatios: ['16:9', '1:1'],
		dimensionModes: ['three'],
		sceneTypes: ['carousel3d'],
		tags: ['star', 'rating', 'achievement', 'quality'],
		description: 'Sharp five-pointed star. Ratings, quality, or achievement symbol.',
		license: 'cc0',
	},
	{
		id: 'rocket-icon',
		name: 'Rocket Icon',
		category: 'icon',
		path: 'assets/3d/v1/icons/symbols/rocket.glb',
		scale: 1,
		animationDuration: null,
		aspectRatios: ['16:9', '1:1'],
		dimensionModes: ['three'],
		sceneTypes: ['carousel3d'],
		tags: ['rocket', 'launch', 'growth', 'startup'],
		description: 'Stylized rocket ship. Launch, startup, or growth visualization.',
		license: 'cc0',
	},
]

export const ALL_ASSETS = [
	...CHARACTER_ASSETS,
	...OBJECT_ASSETS,
	...ABSTRACT_ASSETS,
	...ENVIRONMENT_ASSETS,
	...ICON_ASSETS,
]

export const assetById = (id: string): Asset3d | undefined =>
	ALL_ASSETS.find((a) => a.id === id)

export const assetsByCategory = (category: AssetCategory): Asset3d[] =>
	ALL_ASSETS.filter((a) => a.category === category)

export const assetsByTag = (tag: string): Asset3d[] =>
	ALL_ASSETS.filter((a) => a.tags.includes(tag))

export const assetsForScene = (sceneType: string): Asset3d[] =>
	ALL_ASSETS.filter((a) => a.sceneTypes.includes(sceneType))

export const assetsForAspect = (aspect: string): Asset3d[] =>
	ALL_ASSETS.filter((a) => a.aspectRatios.includes(aspect as any))
