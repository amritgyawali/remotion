#!/usr/bin/env node

/**
 * Generates the studio's original CC0 low-poly GLB production pack.
 *
 * The models are built directly from deterministic primitive geometry. There
 * are no downloaded meshes, textures, external buffers, or compressed
 * extensions, so every output remains portable and easy to inspect.
 */

import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const assetRoot = path.join(projectRoot, 'public', 'assets', '3d')
const outputRoot = path.join(assetRoot, 'v1')
const catalogPath = path.join(outputRoot, 'catalog.json')

const SCHEMA_VERSION = '1.0.0'
const PACK_VERSION = '1.0.0'
const VARIANTS_PER_FAMILY = 50
const MIN_ASSET_COUNT = 1_000
const MAX_PACK_BYTES = 80 * 1024 * 1024
const GLB_MAGIC = 0x46546c67
const JSON_CHUNK = 0x4e4f534a
const BIN_CHUNK = 0x004e4942

const round = (value, precision = 6) => Number(value.toFixed(precision))
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value))
const padVariant = (value) => String(value).padStart(3, '0')
const slash = (value) => value.split(path.sep).join('/')
const sha256 = (value) => createHash('sha256').update(value).digest('hex')

function hashSeed(text) {
	let value = 0x811c9dc5
	for (let index = 0; index < text.length; index++) {
		value ^= text.charCodeAt(index)
		value = Math.imul(value, 0x01000193)
	}
	return value >>> 0
}

function seededRandom(seedText) {
	let state = hashSeed(seedText) || 0x6d2b79f5
	return () => {
		state += 0x6d2b79f5
		let value = state
		value = Math.imul(value ^ (value >>> 15), value | 1)
		value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
		return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296
	}
}

const between = (random, minimum, maximum) => minimum + (maximum - minimum) * random()

const PALETTES = [
	['#53E8D4', '#5865F2', '#F7FBFF', '#172342', '#FF6DB5'],
	['#FFB13B', '#FF5268', '#FFF1C1', '#51233A', '#50D8C5'],
	['#48B8FF', '#14C89A', '#E9FCFF', '#123856', '#A970FF'],
	['#C467FF', '#FF65A5', '#FFF1FB', '#32174A', '#60E0EE'],
	['#39AD72', '#B2D756', '#F2FFD7', '#183D2B', '#F1A948'],
	['#4274FF', '#DEA43B', '#FFF7DD', '#172557', '#53DBF2'],
	['#FF7469', '#53DEB4', '#FFF7EE', '#4B2830', '#6388FF'],
	['#ECEAE4', '#8D95A5', '#FFFFFF', '#20242D', '#D3B66B'],
	['#FF3F62', '#7F42EE', '#FFF0F4', '#310A1D', '#56D9EB'],
	['#B5F84E', '#45D4F3', '#F7FFEC', '#17313A', '#A66BFF'],
	['#E6C77B', '#566AC8', '#FFF8E9', '#2B2E4A', '#E66B87'],
	['#FF913D', '#4CB3F4', '#FFF8E9', '#173957', '#54D8AC'],
]

const part = (name, shape, params, position, options = {}) => ({
	name,
	shape,
	params,
	position,
	rotation: options.rotation ?? [0, 0, 0],
	scale: options.scale ?? [1, 1, 1],
	slot: options.slot ?? 0,
	jitter: options.jitter ?? 0.035,
})

const FAMILIES = [
	{
		id: 'hero-bot', name: 'Hero Bot', category: 'characters',
		description: 'Friendly modular robot characters with expressive antennae and articulated limbs.',
		tags: ['character', 'robot', 'mascot', 'technology'], roles: ['hero', 'presenter', 'foreground'],
		parts: [
			part('torso', 'box', [0.86, 0.82, 0.5], [0, 1.12, 0], { slot: 0 }),
			part('head', 'box', [0.72, 0.55, 0.56], [0, 1.86, 0], { slot: 1 }),
			part('eye-left', 'sphere', [0.095], [-0.18, 1.91, 0.29], { slot: 2 }),
			part('eye-right', 'sphere', [0.095], [0.18, 1.91, 0.29], { slot: 2 }),
			part('arm-left', 'cylinder', [0.11, 0.13, 0.72], [-0.58, 1.13, 0], { rotation: [0, 0, -0.18], slot: 1 }),
			part('arm-right', 'cylinder', [0.11, 0.13, 0.72], [0.58, 1.13, 0], { rotation: [0, 0, 0.18], slot: 1 }),
			part('leg-left', 'cylinder', [0.13, 0.15, 0.62], [-0.24, 0.42, 0], { slot: 0 }),
			part('leg-right', 'cylinder', [0.13, 0.15, 0.62], [0.24, 0.42, 0], { slot: 0 }),
			part('antenna', 'cylinder', [0.035, 0.045, 0.3], [0, 2.29, 0], { slot: 3 }),
			part('antenna-light', 'sphere', [0.09], [0, 2.46, 0], { slot: 4 }),
		],
	},
	{
		id: 'soft-mascot', name: 'Soft Mascot', category: 'characters',
		description: 'Rounded original mascots for playful explainers, onboarding, and social clips.',
		tags: ['character', 'mascot', 'friendly', 'rounded'], roles: ['hero', 'presenter', 'reaction'],
		parts: [
			part('body', 'sphere', [0.58], [0, 0.94, 0], { scale: [0.92, 1.15, 0.8], slot: 0 }),
			part('head', 'sphere', [0.48], [0, 1.72, 0], { slot: 1 }),
			part('eye-left', 'sphere', [0.075], [-0.16, 1.78, 0.43], { slot: 3 }),
			part('eye-right', 'sphere', [0.075], [0.16, 1.78, 0.43], { slot: 3 }),
			part('ear-left', 'cone', [0.03, 0.18, 0.42], [-0.35, 2.08, 0], { rotation: [0, 0, -0.35], slot: 4 }),
			part('ear-right', 'cone', [0.03, 0.18, 0.42], [0.35, 2.08, 0], { rotation: [0, 0, 0.35], slot: 4 }),
			part('foot-left', 'sphere', [0.19], [-0.28, 0.3, 0.08], { scale: [1.25, 0.7, 1.5], slot: 1 }),
			part('foot-right', 'sphere', [0.19], [0.28, 0.3, 0.08], { scale: [1.25, 0.7, 1.5], slot: 1 }),
		],
	},
	{
		id: 'space-explorer', name: 'Space Explorer', category: 'characters',
		description: 'Low-poly explorers with helmets and compact life-support packs.',
		tags: ['character', 'explorer', 'space', 'adventure'], roles: ['hero', 'story', 'foreground'],
		parts: [
			part('torso', 'box', [0.72, 0.84, 0.48], [0, 1.1, 0], { slot: 2 }),
			part('helmet', 'sphere', [0.43], [0, 1.82, 0], { slot: 0 }),
			part('visor', 'sphere', [0.34], [0, 1.84, 0.2], { scale: [0.9, 0.68, 0.58], slot: 3 }),
			part('helmet-ring', 'torus', [0.37, 0.055], [0, 1.54, 0], { rotation: [Math.PI / 2, 0, 0], slot: 4 }),
			part('backpack', 'box', [0.52, 0.68, 0.25], [0, 1.16, -0.36], { slot: 1 }),
			part('arm-left', 'cylinder', [0.1, 0.12, 0.7], [-0.5, 1.08, 0], { rotation: [0, 0, -0.12], slot: 2 }),
			part('arm-right', 'cylinder', [0.1, 0.12, 0.7], [0.5, 1.08, 0], { rotation: [0, 0, 0.12], slot: 2 }),
			part('boot-left', 'box', [0.28, 0.58, 0.35], [-0.22, 0.38, 0.05], { slot: 1 }),
			part('boot-right', 'box', [0.28, 0.58, 0.35], [0.22, 0.38, 0.05], { slot: 1 }),
		],
	},
	{
		id: 'creator-camera', name: 'Creator Camera', category: 'objects',
		description: 'Stylized cameras with modular lenses, controls, and viewfinder forms.',
		tags: ['camera', 'creator', 'media', 'recording'], roles: ['product', 'cutaway', 'icon'],
		parts: [
			part('body', 'box', [1.3, 0.82, 0.54], [0, 0.68, 0], { slot: 0 }),
			part('lens', 'cylinder', [0.38, 0.32, 0.48], [0, 0.7, 0.47], { rotation: [Math.PI / 2, 0, 0], slot: 3 }),
			part('lens-ring', 'torus', [0.34, 0.055], [0, 0.7, 0.73], { rotation: [Math.PI / 2, 0, 0], slot: 4 }),
			part('viewfinder', 'box', [0.38, 0.25, 0.28], [-0.32, 1.22, -0.02], { slot: 1 }),
			part('shutter', 'cylinder', [0.09, 0.09, 0.08], [0.38, 1.14, 0.12], { slot: 4 }),
			part('grip', 'box', [0.24, 0.7, 0.5], [0.65, 0.58, -0.02], { slot: 1 }),
		],
	},
	{
		id: 'studio-device', name: 'Studio Device', category: 'objects',
		description: 'Compact creator workstations, screens, and production consoles.',
		tags: ['device', 'screen', 'studio', 'technology'], roles: ['product', 'interface', 'cutaway'],
		parts: [
			part('display', 'box', [1.45, 0.92, 0.12], [0, 1.05, 0], { rotation: [-0.08, 0, 0], slot: 3 }),
			part('screen', 'box', [1.27, 0.74, 0.04], [0, 1.06, 0.08], { rotation: [-0.08, 0, 0], slot: 0 }),
			part('stand', 'cylinder', [0.1, 0.12, 0.6], [0, 0.36, -0.05], { slot: 1 }),
			part('base', 'box', [0.76, 0.09, 0.52], [0, 0.06, 0.04], { slot: 1 }),
			part('control-left', 'sphere', [0.065], [-0.48, 1.03, 0.14], { slot: 4 }),
			part('control-right', 'sphere', [0.065], [0.48, 1.03, 0.14], { slot: 2 }),
		],
	},
	{
		id: 'lounge-chair', name: 'Lounge Chair', category: 'objects',
		description: 'Contemporary low-poly seating for interiors and product scenes.',
		tags: ['chair', 'furniture', 'interior', 'lounge'], roles: ['environment', 'product', 'set-dressing'],
		parts: [
			part('seat', 'box', [1.15, 0.22, 1.0], [0, 0.7, 0], { rotation: [0.04, 0, 0], slot: 0 }),
			part('back', 'box', [1.15, 1.15, 0.2], [0, 1.32, -0.43], { rotation: [-0.16, 0, 0], slot: 0 }),
			part('arm-left', 'box', [0.18, 0.58, 0.9], [-0.66, 0.93, 0], { slot: 1 }),
			part('arm-right', 'box', [0.18, 0.58, 0.9], [0.66, 0.93, 0], { slot: 1 }),
			part('leg-left', 'cylinder', [0.055, 0.075, 0.62], [-0.43, 0.32, -0.28], { rotation: [0.08, 0, -0.08], slot: 3 }),
			part('leg-right', 'cylinder', [0.055, 0.075, 0.62], [0.43, 0.32, -0.28], { rotation: [0.08, 0, 0.08], slot: 3 }),
		],
	},
	{
		id: 'heart-icon', name: 'Heart Icon', category: 'icons-3d',
		description: 'Dimensional heart marks assembled as expressive low-poly forms.',
		tags: ['icon', 'heart', 'like', 'social'], roles: ['icon', 'reaction', 'accent'],
		parts: [
			part('lobe-left', 'sphere', [0.48], [-0.32, 1.18, 0], { scale: [1, 0.9, 0.62], slot: 0 }),
			part('lobe-right', 'sphere', [0.48], [0.32, 1.18, 0], { scale: [1, 0.9, 0.62], slot: 0 }),
			part('point', 'crystal', [0.68, 1.25], [0, 0.72, 0], { rotation: [0, 0, Math.PI], scale: [1, 1, 0.58], slot: 0 }),
			part('glint', 'crystal', [0.1, 0.34], [-0.24, 1.48, 0.34], { rotation: [0, 0, -0.3], slot: 2 }),
		],
	},
	{
		id: 'star-icon', name: 'Star Icon', category: 'icons-3d',
		description: 'Radiant star tokens for ratings, highlights, and achievement moments.',
		tags: ['icon', 'star', 'rating', 'highlight'], roles: ['icon', 'badge', 'accent'],
		parts: [
			part('core', 'crystal', [0.52, 0.38], [0, 0.88, 0], { rotation: [Math.PI / 2, 0, 0], slot: 0 }),
			part('ray-top', 'cone', [0.03, 0.2, 0.75], [0, 1.55, 0], { slot: 1 }),
			part('ray-bottom', 'cone', [0.03, 0.2, 0.75], [0, 0.21, 0], { rotation: [0, 0, Math.PI], slot: 1 }),
			part('ray-left', 'cone', [0.03, 0.18, 0.68], [-0.67, 0.88, 0], { rotation: [0, 0, Math.PI / 2], slot: 4 }),
			part('ray-right', 'cone', [0.03, 0.18, 0.68], [0.67, 0.88, 0], { rotation: [0, 0, -Math.PI / 2], slot: 4 }),
		],
	},
	{
		id: 'signal-badge', name: 'Signal Badge', category: 'icons-3d',
		description: 'Layered communication, broadcast, and notification emblems.',
		tags: ['icon', 'signal', 'broadcast', 'notification'], roles: ['icon', 'badge', 'interface'],
		parts: [
			part('badge', 'cylinder', [0.68, 0.68, 0.18], [0, 0.78, 0], { rotation: [Math.PI / 2, 0, 0], slot: 3 }),
			part('ring-outer', 'torus', [0.43, 0.065], [0, 0.8, 0.14], { rotation: [Math.PI / 2, 0, 0], slot: 0 }),
			part('ring-inner', 'torus', [0.25, 0.05], [0, 0.8, 0.19], { rotation: [Math.PI / 2, 0, 0], slot: 1 }),
			part('signal-core', 'sphere', [0.1], [0, 0.8, 0.25], { slot: 2 }),
		],
	},
	{
		id: 'gift-box', name: 'Gift Box', category: 'items',
		description: 'Celebration parcels with ribbons, lids, and decorative toppers.',
		tags: ['gift', 'box', 'celebration', 'reward'], roles: ['prop', 'product', 'accent'],
		parts: [
			part('box', 'box', [1.12, 0.86, 0.94], [0, 0.48, 0], { slot: 0 }),
			part('lid', 'box', [1.24, 0.18, 1.04], [0, 0.98, 0], { slot: 1 }),
			part('ribbon-vertical', 'box', [0.2, 1.03, 0.98], [0, 0.57, 0], { slot: 4 }),
			part('ribbon-horizontal', 'box', [1.17, 1.02, 0.18], [0, 0.57, 0], { slot: 4 }),
			part('bow-left', 'torus', [0.23, 0.065], [-0.21, 1.24, 0], { rotation: [Math.PI / 2, 0.25, 0], scale: [1.15, 0.65, 1], slot: 4 }),
			part('bow-right', 'torus', [0.23, 0.065], [0.21, 1.24, 0], { rotation: [Math.PI / 2, -0.25, 0], scale: [1.15, 0.65, 1], slot: 4 }),
		],
	},
	{
		id: 'tool-kit', name: 'Tool Kit', category: 'items',
		description: 'Friendly toolboxes and modular maker props for process scenes.',
		tags: ['tools', 'maker', 'repair', 'process'], roles: ['prop', 'cutaway', 'process'],
		parts: [
			part('case', 'box', [1.35, 0.7, 0.62], [0, 0.48, 0], { slot: 0 }),
			part('lid', 'box', [1.38, 0.16, 0.66], [0, 0.88, 0], { slot: 1 }),
			part('handle-left', 'cylinder', [0.055, 0.055, 0.45], [-0.32, 1.17, 0], { slot: 3 }),
			part('handle-right', 'cylinder', [0.055, 0.055, 0.45], [0.32, 1.17, 0], { slot: 3 }),
			part('handle-top', 'cylinder', [0.055, 0.055, 0.64], [0, 1.39, 0], { rotation: [0, 0, Math.PI / 2], slot: 3 }),
			part('latch-left', 'box', [0.16, 0.22, 0.08], [-0.36, 0.76, 0.34], { slot: 4 }),
			part('latch-right', 'box', [0.16, 0.22, 0.08], [0.36, 0.76, 0.34], { slot: 4 }),
		],
	},
	{
		id: 'snack-stack', name: 'Snack Stack', category: 'items',
		description: 'Playful food and drink props built from clean geometric layers.',
		tags: ['food', 'snack', 'drink', 'lifestyle'], roles: ['prop', 'product', 'set-dressing'],
		parts: [
			part('cup', 'cylinder', [0.36, 0.43, 0.92], [0, 0.5, 0], { slot: 0 }),
			part('lid', 'cylinder', [0.46, 0.46, 0.12], [0, 1.02, 0], { slot: 2 }),
			part('straw', 'cylinder', [0.04, 0.04, 0.88], [0.15, 1.42, 0], { rotation: [0, 0, -0.14], slot: 4 }),
			part('snack-one', 'torus', [0.28, 0.1], [-0.5, 0.31, 0.12], { rotation: [Math.PI / 2, 0, 0.15], slot: 1 }),
			part('snack-two', 'torus', [0.24, 0.09], [-0.55, 0.72, 0.05], { rotation: [Math.PI / 2, 0, -0.18], slot: 1 }),
		],
	},
	{
		id: 'city-rover', name: 'City Rover', category: 'vehicles',
		description: 'Compact electric rover concepts for mobility and future-city scenes.',
		tags: ['vehicle', 'rover', 'mobility', 'city'], roles: ['hero', 'product', 'environment'],
		parts: [
			part('chassis', 'box', [1.72, 0.48, 0.92], [0, 0.58, 0], { slot: 0 }),
			part('cabin', 'wedge', [1.02, 0.68, 0.84], [-0.08, 1.08, 0], { slot: 1 }),
			part('wheel-front-left', 'cylinder', [0.28, 0.28, 0.18], [0.6, 0.35, 0.54], { rotation: [Math.PI / 2, 0, 0], slot: 3 }),
			part('wheel-front-right', 'cylinder', [0.28, 0.28, 0.18], [0.6, 0.35, -0.54], { rotation: [Math.PI / 2, 0, 0], slot: 3 }),
			part('wheel-back-left', 'cylinder', [0.28, 0.28, 0.18], [-0.6, 0.35, 0.54], { rotation: [Math.PI / 2, 0, 0], slot: 3 }),
			part('wheel-back-right', 'cylinder', [0.28, 0.28, 0.18], [-0.6, 0.35, -0.54], { rotation: [Math.PI / 2, 0, 0], slot: 3 }),
			part('light', 'box', [0.24, 0.15, 0.13], [0.88, 0.64, 0], { slot: 4 }),
		],
	},
	{
		id: 'sky-glider', name: 'Sky Glider', category: 'vehicles',
		description: 'Original compact aircraft silhouettes with layered wings and turbines.',
		tags: ['vehicle', 'aircraft', 'flight', 'future'], roles: ['hero', 'transition', 'environment'],
		parts: [
			part('fuselage', 'cylinder', [0.22, 0.08, 1.75], [0, 0.78, 0], { rotation: [0, 0, Math.PI / 2], slot: 0 }),
			part('wing', 'wedge', [1.82, 0.16, 0.88], [-0.08, 0.75, 0], { slot: 1 }),
			part('tail', 'wedge', [0.58, 0.12, 0.52], [-0.76, 0.92, 0], { rotation: [0, 0, 0.05], slot: 4 }),
			part('fin', 'wedge', [0.48, 0.55, 0.12], [-0.72, 1.07, 0], { rotation: [0, 0, -0.12], slot: 4 }),
			part('engine-left', 'cylinder', [0.17, 0.2, 0.45], [-0.12, 0.58, 0.5], { rotation: [0, 0, Math.PI / 2], slot: 3 }),
			part('engine-right', 'cylinder', [0.17, 0.2, 0.45], [-0.12, 0.58, -0.5], { rotation: [0, 0, Math.PI / 2], slot: 3 }),
		],
	},
	{
		id: 'mini-boat', name: 'Mini Boat', category: 'vehicles',
		description: 'Cheerful low-poly boats for travel, map, and story sequences.',
		tags: ['vehicle', 'boat', 'travel', 'water'], roles: ['hero', 'environment', 'story'],
		parts: [
			part('hull', 'wedge', [1.72, 0.56, 0.86], [0, 0.45, 0], { rotation: [0, 0, Math.PI], slot: 0 }),
			part('deck', 'box', [1.18, 0.16, 0.67], [-0.05, 0.78, 0], { slot: 1 }),
			part('cabin', 'box', [0.65, 0.52, 0.56], [-0.18, 1.08, 0], { slot: 2 }),
			part('window', 'box', [0.38, 0.2, 0.59], [0.02, 1.15, 0], { slot: 3 }),
			part('mast', 'cylinder', [0.035, 0.045, 1.18], [0.35, 1.45, 0], { slot: 4 }),
			part('flag', 'wedge', [0.42, 0.3, 0.05], [0.56, 1.9, 0], { slot: 4 }),
		],
	},
	{
		id: 'city-tower', name: 'City Tower', category: 'architecture',
		description: 'Modular future-facing towers for skylines and spatial explainers.',
		tags: ['architecture', 'tower', 'city', 'building'], roles: ['environment', 'background-object', 'establishing'],
		parts: [
			part('base', 'box', [1.05, 0.26, 0.9], [0, 0.14, 0], { slot: 3 }),
			part('lower', 'box', [0.88, 1.05, 0.72], [0, 0.8, 0], { slot: 0 }),
			part('middle', 'box', [0.7, 0.96, 0.62], [0.04, 1.78, 0], { rotation: [0, 0.08, 0], slot: 1 }),
			part('upper', 'box', [0.54, 0.78, 0.5], [-0.02, 2.64, 0], { rotation: [0, -0.08, 0], slot: 0 }),
			part('crown', 'crystal', [0.32, 0.7], [0, 3.34, 0], { slot: 4 }),
			part('sky-ring', 'torus', [0.45, 0.055], [0, 2.38, 0], { rotation: [Math.PI / 2, 0, 0], slot: 2 }),
		],
	},
	{
		id: 'open-pavilion', name: 'Open Pavilion', category: 'architecture',
		description: 'Airy pavilion structures for branded stages and product showcases.',
		tags: ['architecture', 'pavilion', 'stage', 'space'], roles: ['environment', 'stage', 'set-dressing'],
		parts: [
			part('platform', 'cylinder', [0.94, 1.02, 0.18], [0, 0.1, 0], { slot: 3 }),
			part('roof', 'cone', [0.08, 1.05, 0.48], [0, 2.02, 0], { slot: 0 }),
			part('post-one', 'cylinder', [0.055, 0.075, 1.7], [-0.62, 1.0, -0.35], { slot: 1 }),
			part('post-two', 'cylinder', [0.055, 0.075, 1.7], [0.62, 1.0, -0.35], { slot: 1 }),
			part('post-three', 'cylinder', [0.055, 0.075, 1.7], [-0.62, 1.0, 0.35], { slot: 1 }),
			part('post-four', 'cylinder', [0.055, 0.075, 1.7], [0.62, 1.0, 0.35], { slot: 1 }),
			part('center-orb', 'sphere', [0.22], [0, 0.64, 0], { slot: 4 }),
		],
	},
	{
		id: 'tiny-home', name: 'Tiny Home', category: 'architecture',
		description: 'Warm modular homes for lifestyle, property, and community stories.',
		tags: ['architecture', 'home', 'property', 'community'], roles: ['environment', 'establishing', 'story'],
		parts: [
			part('house', 'box', [1.42, 1.0, 1.08], [0, 0.58, 0], { slot: 0 }),
			part('roof-left', 'wedge', [1.55, 0.62, 0.62], [-0.27, 1.43, 0], { rotation: [0, Math.PI / 2, 0], slot: 1 }),
			part('roof-right', 'wedge', [1.55, 0.62, 0.62], [0.27, 1.43, 0], { rotation: [0, -Math.PI / 2, 0], slot: 1 }),
			part('door', 'box', [0.34, 0.69, 0.08], [-0.35, 0.38, 0.58], { slot: 3 }),
			part('window', 'box', [0.42, 0.38, 0.08], [0.32, 0.63, 0.58], { slot: 2 }),
			part('chimney', 'box', [0.2, 0.66, 0.22], [0.42, 1.68, -0.2], { slot: 4 }),
		],
	},
	{
		id: 'lowpoly-tree', name: 'Low-poly Tree', category: 'nature',
		description: 'Layered stylized trees for environmental and sustainability scenes.',
		tags: ['nature', 'tree', 'sustainability', 'landscape'], roles: ['environment', 'set-dressing', 'accent'],
		parts: [
			part('trunk', 'cylinder', [0.16, 0.21, 1.25], [0, 0.65, 0], { slot: 3 }),
			part('canopy-lower', 'cone', [0.06, 0.78, 1.3], [0, 1.28, 0], { slot: 0 }),
			part('canopy-middle', 'cone', [0.05, 0.65, 1.1], [0, 1.86, 0], { slot: 1 }),
			part('canopy-top', 'cone', [0.04, 0.49, 0.88], [0, 2.38, 0], { slot: 0 }),
			part('fruit-one', 'sphere', [0.11], [-0.28, 1.55, 0.24], { slot: 4 }),
			part('fruit-two', 'sphere', [0.09], [0.3, 1.92, 0.08], { slot: 4 }),
		],
	},
	{
		id: 'bloom-flower', name: 'Bloom Flower', category: 'nature',
		description: 'Graphic dimensional blooms with radial petals and sculpted centers.',
		tags: ['nature', 'flower', 'bloom', 'growth'], roles: ['accent', 'hero', 'transition'],
		parts: [
			part('stem', 'cylinder', [0.045, 0.06, 1.34], [0, 0.7, 0], { slot: 3 }),
			part('center', 'sphere', [0.27], [0, 1.55, 0], { slot: 4 }),
			part('petal-top', 'sphere', [0.32], [0, 2.0, 0], { scale: [0.64, 1.3, 0.42], slot: 0 }),
			part('petal-bottom', 'sphere', [0.32], [0, 1.1, 0], { scale: [0.64, 1.3, 0.42], slot: 0 }),
			part('petal-left', 'sphere', [0.32], [-0.45, 1.55, 0], { scale: [1.3, 0.64, 0.42], slot: 1 }),
			part('petal-right', 'sphere', [0.32], [0.45, 1.55, 0], { scale: [1.3, 0.64, 0.42], slot: 1 }),
			part('leaf', 'sphere', [0.28], [-0.26, 0.64, 0], { rotation: [0, 0, -0.56], scale: [1.4, 0.38, 0.3], slot: 3 }),
		],
	},
	{
		id: 'ringed-planet', name: 'Ringed Planet', category: 'nature',
		description: 'Original orbital worlds for science, space, and imagination themes.',
		tags: ['nature', 'planet', 'space', 'orbit'], roles: ['hero', 'environment', 'transition'],
		parts: [
			part('planet', 'sphere', [0.78], [0, 0.95, 0], { slot: 0 }),
			part('ring-outer', 'torus', [1.12, 0.075], [0, 0.95, 0], { rotation: [0.34, 0, -0.14], scale: [1, 1, 0.52], slot: 2 }),
			part('ring-inner', 'torus', [0.91, 0.04], [0, 0.95, 0], { rotation: [0.34, 0, -0.14], scale: [1, 1, 0.52], slot: 4 }),
			part('moon', 'sphere', [0.15], [1.24, 1.54, -0.2], { slot: 1 }),
		],
	},
	{
		id: 'kinetic-orbit', name: 'Kinetic Orbit', category: 'abstract-motion',
		description: 'Layered orbital systems designed for looping motion and transitions.',
		tags: ['abstract', 'orbit', 'motion', 'loop'], roles: ['transition', 'hero', 'accent'],
		parts: [
			part('core', 'sphere', [0.3], [0, 1.0, 0], { slot: 0 }),
			part('orbit-one', 'torus', [0.82, 0.045], [0, 1.0, 0], { rotation: [0.3, 0, 0.2], slot: 1 }),
			part('orbit-two', 'torus', [0.68, 0.04], [0, 1.0, 0], { rotation: [1.08, 0.24, -0.5], slot: 4 }),
			part('orbit-three', 'torus', [0.98, 0.035], [0, 1.0, 0], { rotation: [0.1, 0.82, 0.7], slot: 2 }),
			part('satellite-one', 'sphere', [0.12], [0.76, 1.32, 0.12], { slot: 4 }),
			part('satellite-two', 'sphere', [0.09], [-0.52, 0.46, 0.38], { slot: 2 }),
		],
	},
	{
		id: 'energy-crystal', name: 'Energy Crystal', category: 'abstract-motion',
		description: 'Faceted energy formations for reveals, power-ups, and title moments.',
		tags: ['abstract', 'crystal', 'energy', 'faceted'], roles: ['hero', 'accent', 'transition'],
		parts: [
			part('crystal-main', 'crystal', [0.56, 1.82], [0, 1.05, 0], { rotation: [0.08, 0, -0.08], slot: 0 }),
			part('crystal-left', 'crystal', [0.28, 1.05], [-0.48, 0.65, 0.08], { rotation: [0, 0, 0.32], slot: 1 }),
			part('crystal-right', 'crystal', [0.31, 1.14], [0.5, 0.69, -0.05], { rotation: [0, 0, -0.28], slot: 4 }),
			part('halo', 'torus', [0.84, 0.035], [0, 0.48, 0], { rotation: [Math.PI / 2, 0, 0], slot: 2 }),
			part('spark', 'sphere', [0.1], [0.64, 1.58, 0.18], { slot: 2 }),
		],
	},
	{
		id: 'motion-ribbon', name: 'Motion Ribbon', category: 'abstract-motion',
		description: 'Sculptural ribbons and trails for momentum, flow, and kinetic typography.',
		tags: ['abstract', 'ribbon', 'motion', 'flow'], roles: ['transition', 'accent', 'background-object'],
		parts: [
			part('ribbon-main', 'ribbon', [1.85, 0.34, 0.08, 0.46, 1.5], [0, 1.02, 0], { rotation: [0.1, -0.16, 0.2], slot: 0 }),
			part('ribbon-second', 'ribbon', [1.45, 0.22, 0.065, 0.36, 1.8], [0.06, 0.72, -0.3], { rotation: [-0.08, 0.24, -0.24], slot: 1 }),
			part('guide-orb-one', 'sphere', [0.13], [-0.88, 1.1, 0.08], { slot: 4 }),
			part('guide-orb-two', 'sphere', [0.1], [0.86, 0.77, -0.05], { slot: 2 }),
		],
	},
]

if (FAMILIES.length !== 24) {
	throw new Error(`Expected 24 3D families, found ${FAMILIES.length}`)
}

const CATEGORY_COPY = {
	characters: 'Characters',
	objects: 'Objects',
	'icons-3d': '3D Icons',
	items: 'Items and props',
	vehicles: 'Vehicles',
	architecture: 'Architecture',
	nature: 'Nature',
	'abstract-motion': 'Abstract and motion forms',
}

function cross(a, b) {
	return [
		a[1] * b[2] - a[2] * b[1],
		a[2] * b[0] - a[0] * b[2],
		a[0] * b[1] - a[1] * b[0],
	]
}

function subtract(a, b) {
	return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

function normalize(vector) {
	const length = Math.hypot(vector[0], vector[1], vector[2]) || 1
	return [vector[0] / length, vector[1] / length, vector[2] / length]
}

function flatMesh(triangles) {
	const positions = []
	const normals = []
	const indices = []
	for (const triangle of triangles) {
		const normal = normalize(cross(subtract(triangle[1], triangle[0]), subtract(triangle[2], triangle[0])))
		for (const point of triangle) {
			positions.push(...point)
			normals.push(...normal)
			indices.push(indices.length)
		}
	}
	return finalizeMesh(positions, normals, indices)
}

function finalizeMesh(positions, normals, indices) {
	const minimum = [Infinity, Infinity, Infinity]
	const maximum = [-Infinity, -Infinity, -Infinity]
	for (let index = 0; index < positions.length; index += 3) {
		for (let axis = 0; axis < 3; axis++) {
			minimum[axis] = Math.min(minimum[axis], positions[index + axis])
			maximum[axis] = Math.max(maximum[axis], positions[index + axis])
		}
	}
	return {
		positions,
		normals,
		indices,
		bounds: { min: minimum, max: maximum },
		triangles: indices.length / 3,
	}
}

function boxMesh(width, height, depth) {
	const x = width / 2
	const y = height / 2
	const z = depth / 2
	const p = [
		[-x, -y, -z], [x, -y, -z], [x, y, -z], [-x, y, -z],
		[-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z],
	]
	const faces = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 4, 7, 3], [1, 2, 6, 5], [3, 7, 6, 2], [0, 1, 5, 4]]
	return flatMesh(faces.flatMap(([a, b, c, d]) => [[p[a], p[b], p[c]], [p[a], p[c], p[d]]]))
}

function wedgeMesh(width, height, depth) {
	const x = width / 2
	const y = height / 2
	const z = depth / 2
	const a = [-x, -y, -z]
	const b = [x, -y, -z]
	const c = [-x, -y, z]
	const d = [x, -y, z]
	const e = [-x, y, 0]
	const f = [x, y, 0]
	return flatMesh([
		[a, b, d], [a, d, c], [a, e, f], [a, f, b], [c, d, f], [c, f, e],
		[a, c, e], [b, f, d],
	])
}

function cylinderMesh(bottomRadius, topRadius, height, sides) {
	const triangles = []
	const bottomCenter = [0, -height / 2, 0]
	const topCenter = [0, height / 2, 0]
	for (let side = 0; side < sides; side++) {
		const angleA = (side / sides) * Math.PI * 2
		const angleB = ((side + 1) / sides) * Math.PI * 2
		const b0 = [Math.cos(angleA) * bottomRadius, -height / 2, Math.sin(angleA) * bottomRadius]
		const b1 = [Math.cos(angleB) * bottomRadius, -height / 2, Math.sin(angleB) * bottomRadius]
		const t0 = [Math.cos(angleA) * topRadius, height / 2, Math.sin(angleA) * topRadius]
		const t1 = [Math.cos(angleB) * topRadius, height / 2, Math.sin(angleB) * topRadius]
		triangles.push([b0, b1, t1], [b0, t1, t0], [topCenter, t0, t1], [bottomCenter, b1, b0])
	}
	return flatMesh(triangles)
}

function sphereMesh(radius, segments, rings) {
	const positions = []
	const normals = []
	const indices = []
	for (let ring = 0; ring <= rings; ring++) {
		const latitude = (ring / rings) * Math.PI
		for (let segment = 0; segment <= segments; segment++) {
			const longitude = (segment / segments) * Math.PI * 2
			const normal = [
				Math.sin(latitude) * Math.cos(longitude),
				Math.cos(latitude),
				Math.sin(latitude) * Math.sin(longitude),
			]
			positions.push(normal[0] * radius, normal[1] * radius, normal[2] * radius)
			normals.push(...normal)
		}
	}
	for (let ring = 0; ring < rings; ring++) {
		for (let segment = 0; segment < segments; segment++) {
			const a = ring * (segments + 1) + segment
			const b = a + segments + 1
			if (ring > 0) indices.push(a, b, a + 1)
			if (ring < rings - 1) indices.push(b, b + 1, a + 1)
		}
	}
	return finalizeMesh(positions, normals, indices)
}

function torusMesh(majorRadius, tubeRadius, radialSegments, tubularSegments) {
	const positions = []
	const normals = []
	const indices = []
	for (let radial = 0; radial <= radialSegments; radial++) {
		const v = (radial / radialSegments) * Math.PI * 2
		for (let tubular = 0; tubular <= tubularSegments; tubular++) {
			const u = (tubular / tubularSegments) * Math.PI * 2
			const normal = [Math.cos(u) * Math.cos(v), Math.sin(v), Math.sin(u) * Math.cos(v)]
			positions.push(
				(majorRadius + tubeRadius * Math.cos(v)) * Math.cos(u),
				tubeRadius * Math.sin(v),
				(majorRadius + tubeRadius * Math.cos(v)) * Math.sin(u),
			)
			normals.push(...normal)
		}
	}
	for (let radial = 0; radial < radialSegments; radial++) {
		for (let tubular = 0; tubular < tubularSegments; tubular++) {
			const a = radial * (tubularSegments + 1) + tubular
			const b = (radial + 1) * (tubularSegments + 1) + tubular
			indices.push(a, b, a + 1, b, b + 1, a + 1)
		}
	}
	return finalizeMesh(positions, normals, indices)
}

function crystalMesh(radius, height, sides) {
	const triangles = []
	const top = [0, height / 2, 0]
	const bottom = [0, -height / 2, 0]
	const waistY = -height * 0.08
	for (let side = 0; side < sides; side++) {
		const angleA = (side / sides) * Math.PI * 2
		const angleB = ((side + 1) / sides) * Math.PI * 2
		const a = [Math.cos(angleA) * radius, waistY, Math.sin(angleA) * radius]
		const b = [Math.cos(angleB) * radius, waistY, Math.sin(angleB) * radius]
		triangles.push([top, a, b], [bottom, b, a])
	}
	return flatMesh(triangles)
}

function ribbonMesh(length, width, thickness, amplitude, waves, segments) {
	const leftTop = []
	const rightTop = []
	const leftBottom = []
	const rightBottom = []
	for (let segment = 0; segment <= segments; segment++) {
		const progress = segment / segments
		const x = -length / 2 + progress * length
		const phase = progress * Math.PI * 2 * waves
		const y = Math.sin(phase) * amplitude
		const slope = Math.cos(phase) * amplitude * Math.PI * 2 * waves / length
		const perpendicular = normalize([-slope, 1, 0])
		const offsetX = perpendicular[0] * width / 2
		const offsetY = perpendicular[1] * width / 2
		leftTop.push([x + offsetX, y + offsetY, thickness / 2])
		rightTop.push([x - offsetX, y - offsetY, thickness / 2])
		leftBottom.push([x + offsetX, y + offsetY, -thickness / 2])
		rightBottom.push([x - offsetX, y - offsetY, -thickness / 2])
	}
	const triangles = []
	for (let segment = 0; segment < segments; segment++) {
		const next = segment + 1
		triangles.push(
			[leftTop[segment], rightTop[segment], rightTop[next]], [leftTop[segment], rightTop[next], leftTop[next]],
			[leftBottom[segment], rightBottom[next], rightBottom[segment]], [leftBottom[segment], leftBottom[next], rightBottom[next]],
			[leftTop[segment], leftTop[next], leftBottom[next]], [leftTop[segment], leftBottom[next], leftBottom[segment]],
			[rightTop[segment], rightBottom[next], rightTop[next]], [rightTop[segment], rightBottom[segment], rightBottom[next]],
		)
	}
	triangles.push(
		[leftTop[0], leftBottom[0], rightBottom[0]], [leftTop[0], rightBottom[0], rightTop[0]],
		[leftTop.at(-1), rightBottom.at(-1), leftBottom.at(-1)], [leftTop.at(-1), rightTop.at(-1), rightBottom.at(-1)],
	)
	return flatMesh(triangles)
}

function realizeParams(template, random, variant, partIndex) {
	const factor = (value, index, spread = 0.075) => {
		const signature = 1 + variant * 0.00019 + (partIndex + 1) * (index + 1) * 0.000013
		return round(value * signature * between(random, 1 - spread, 1 + spread))
	}
	const [a, b, c, d, e] = template.params
	const detail = (variant + partIndex * 3) % 4
	switch (template.shape) {
		case 'box':
		case 'wedge': return [factor(a, 0), factor(b, 1), factor(c, 2)]
		case 'sphere': return [factor(a, 0), 8 + detail, 5 + (detail % 3)]
		case 'cylinder':
		case 'cone': return [factor(a, 0), factor(b, 1), factor(c, 2), 7 + detail]
		case 'torus': return [factor(a, 0), factor(b, 1), 5 + (detail % 3), 10 + detail * 2]
		case 'crystal': return [factor(a, 0), factor(b, 1), 5 + detail]
		case 'ribbon': return [factor(a, 0), factor(b, 1), factor(c, 2), factor(d, 3, 0.1), factor(e, 4, 0.06), 10 + detail * 2]
		default: throw new Error(`Unknown primitive ${template.shape}`)
	}
}

function createGeometry(shape, params) {
	switch (shape) {
		case 'box': return boxMesh(...params)
		case 'wedge': return wedgeMesh(...params)
		case 'sphere': return sphereMesh(...params)
		case 'cylinder':
		case 'cone': return cylinderMesh(...params)
		case 'torus': return torusMesh(...params)
		case 'crystal': return crystalMesh(...params)
		case 'ribbon': return ribbonMesh(...params)
		default: throw new Error(`Unknown primitive ${shape}`)
	}
}

function eulerToQuaternion([x, y, z]) {
	const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2)
	const s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2)
	return [
		round(s1 * c2 * c3 + c1 * s2 * s3),
		round(c1 * s2 * c3 - s1 * c2 * s3),
		round(c1 * c2 * s3 + s1 * s2 * c3),
		round(c1 * c2 * c3 - s1 * s2 * s3),
	]
}

function rotateByQuaternion(point, [qx, qy, qz, qw]) {
	const [x, y, z] = point
	const ix = qw * x + qy * z - qz * y
	const iy = qw * y + qz * x - qx * z
	const iz = qw * z + qx * y - qy * x
	const iw = -qx * x - qy * y - qz * z
	return [
		ix * qw + iw * -qx + iy * -qz - iz * -qy,
		iy * qw + iw * -qy + iz * -qx - ix * -qz,
		iz * qw + iw * -qz + ix * -qy - iy * -qx,
	]
}

function transformedBounds(bounds, translation, rotation, scale) {
	const minimum = [Infinity, Infinity, Infinity]
	const maximum = [-Infinity, -Infinity, -Infinity]
	for (const x of [bounds.min[0], bounds.max[0]]) {
		for (const y of [bounds.min[1], bounds.max[1]]) {
			for (const z of [bounds.min[2], bounds.max[2]]) {
				const rotated = rotateByQuaternion([x * scale[0], y * scale[1], z * scale[2]], rotation)
				for (let axis = 0; axis < 3; axis++) {
					const value = rotated[axis] + translation[axis]
					minimum[axis] = Math.min(minimum[axis], value)
					maximum[axis] = Math.max(maximum[axis], value)
				}
			}
		}
	}
	return { min: minimum, max: maximum }
}

function combineBounds(items) {
	const minimum = [Infinity, Infinity, Infinity]
	const maximum = [-Infinity, -Infinity, -Infinity]
	for (const item of items) {
		for (let axis = 0; axis < 3; axis++) {
			minimum[axis] = Math.min(minimum[axis], item.min[axis])
			maximum[axis] = Math.max(maximum[axis], item.max[axis])
		}
	}
	return { min: minimum, max: maximum }
}

function realizeParts(family, variant) {
	const random = seededRandom(`remotion-3d-v1:${family.id}:${variant}`)
	const parts = family.parts.map((template, partIndex) => {
		const params = realizeParams(template, random, variant, partIndex)
		const geometry = createGeometry(template.shape, params)
		const jitter = template.jitter
		const translation = template.position.map((value, axis) => round(value + between(random, -jitter, jitter) * (axis === 1 ? 0.7 : 1)))
		const rotationEuler = template.rotation.map((value) => round(value + between(random, -jitter * 0.7, jitter * 0.7)))
		const rotation = eulerToQuaternion(rotationEuler)
		const scale = template.scale.map((value, axis) => round(value * between(random, 0.965, 1.035) * (1 + variant * (axis + 1) * 0.000027)))
		return { ...template, params, geometry, translation, rotation, scale }
	})
	const rawBounds = combineBounds(parts.map((item) => transformedBounds(item.geometry.bounds, item.translation, item.rotation, item.scale)))
	const centerX = (rawBounds.min[0] + rawBounds.max[0]) / 2
	const centerZ = (rawBounds.min[2] + rawBounds.max[2]) / 2
	for (const item of parts) {
		item.translation = [
			round(item.translation[0] - centerX),
			round(item.translation[1] - rawBounds.min[1]),
			round(item.translation[2] - centerZ),
		]
	}
	return parts
}

function hexToFactor(hex) {
	return [
		Number.parseInt(hex.slice(1, 3), 16) / 255,
		Number.parseInt(hex.slice(3, 5), 16) / 255,
		Number.parseInt(hex.slice(5, 7), 16) / 255,
		1,
	].map((value) => round(value))
}

function createMaterials(familyIndex, variant) {
	const paletteIndex = (familyIndex * 5 + variant - 1) % PALETTES.length
	const colors = PALETTES[paletteIndex]
	const finish = (familyIndex + variant) % 5
	return colors.map((color, slot) => ({
		name: `Material ${slot + 1}`,
		pbrMetallicRoughness: {
			baseColorFactor: hexToFactor(color),
			metallicFactor: round(clamp((finish * 0.12 + slot * 0.07) % 0.66, 0, 0.65)),
			roughnessFactor: round(clamp(0.28 + ((variant + slot * 3) % 7) * 0.085, 0.22, 0.86)),
		},
		doubleSided: true,
	}))
}

function floatsToBuffer(values) {
	const buffer = Buffer.alloc(values.length * 4)
	values.forEach((value, index) => buffer.writeFloatLE(value, index * 4))
	return buffer
}

function uint16ToBuffer(values) {
	const buffer = Buffer.alloc(values.length * 2)
	values.forEach((value, index) => buffer.writeUInt16LE(value, index * 2))
	return buffer
}

function addAlignedBuffer(chunks, value) {
	const currentLength = chunks.reduce((total, chunk) => total + chunk.length, 0)
	const padding = (4 - (currentLength % 4)) % 4
	if (padding) chunks.push(Buffer.alloc(padding))
	const offset = currentLength + padding
	chunks.push(value)
	return offset
}

function glbFingerprint(json, bin) {
	const canonical = {
		nodes: json.nodes.map(({ mesh, translation, rotation, scale, children }) => ({ mesh, translation, rotation, scale, children })),
		meshes: json.meshes.map((mesh) => mesh.primitives),
		materials: json.materials.map(({ pbrMetallicRoughness, doubleSided }) => ({ pbrMetallicRoughness, doubleSided })),
	}
	return sha256(Buffer.concat([bin, Buffer.from(JSON.stringify(canonical))]))
}

function packGlb(json, bin) {
	const jsonBuffer = Buffer.from(JSON.stringify(json))
	const jsonPadding = (4 - (jsonBuffer.length % 4)) % 4
	const paddedJson = Buffer.concat([jsonBuffer, Buffer.alloc(jsonPadding, 0x20)])
	const binPadding = (4 - (bin.length % 4)) % 4
	const paddedBin = Buffer.concat([bin, Buffer.alloc(binPadding)])
	const totalLength = 12 + 8 + paddedJson.length + 8 + paddedBin.length
	const header = Buffer.alloc(12)
	header.writeUInt32LE(GLB_MAGIC, 0)
	header.writeUInt32LE(2, 4)
	header.writeUInt32LE(totalLength, 8)
	const jsonHeader = Buffer.alloc(8)
	jsonHeader.writeUInt32LE(paddedJson.length, 0)
	jsonHeader.writeUInt32LE(JSON_CHUNK, 4)
	const binHeader = Buffer.alloc(8)
	binHeader.writeUInt32LE(paddedBin.length, 0)
	binHeader.writeUInt32LE(BIN_CHUNK, 4)
	return Buffer.concat([header, jsonHeader, paddedJson, binHeader, paddedBin])
}

function summarizeBounds(bounds) {
	const minimum = bounds.min.map((value) => round(value, 5))
	const maximum = bounds.max.map((value) => round(value, 5))
	const size = maximum.map((value, axis) => round(value - minimum[axis], 5))
	const center = maximum.map((value, axis) => round((value + minimum[axis]) / 2, 5))
	return {
		min: minimum,
		max: maximum,
		size,
		center,
		radius: round(Math.hypot(size[0], size[1], size[2]) / 2, 5),
	}
}

function buildGlb(family, familyIndex, variant) {
	const parts = realizeParts(family, variant)
	const materials = createMaterials(familyIndex, variant)
	const chunks = []
	const bufferViews = []
	const accessors = []
	const meshes = []
	const nodes = []

	for (const [partIndex, item] of parts.entries()) {
		const positionBuffer = floatsToBuffer(item.geometry.positions)
		const normalBuffer = floatsToBuffer(item.geometry.normals)
		const indexBuffer = uint16ToBuffer(item.geometry.indices)
		const positionOffset = addAlignedBuffer(chunks, positionBuffer)
		const positionView = bufferViews.push({ buffer: 0, byteOffset: positionOffset, byteLength: positionBuffer.length, target: 34962 }) - 1
		const normalOffset = addAlignedBuffer(chunks, normalBuffer)
		const normalView = bufferViews.push({ buffer: 0, byteOffset: normalOffset, byteLength: normalBuffer.length, target: 34962 }) - 1
		const indexOffset = addAlignedBuffer(chunks, indexBuffer)
		const indexView = bufferViews.push({ buffer: 0, byteOffset: indexOffset, byteLength: indexBuffer.length, target: 34963 }) - 1
		const positionAccessor = accessors.push({
			bufferView: positionView,
			componentType: 5126,
			count: item.geometry.positions.length / 3,
			type: 'VEC3',
			min: item.geometry.bounds.min.map((value) => round(value)),
			max: item.geometry.bounds.max.map((value) => round(value)),
		}) - 1
		const normalAccessor = accessors.push({
			bufferView: normalView,
			componentType: 5126,
			count: item.geometry.normals.length / 3,
			type: 'VEC3',
		}) - 1
		const indexAccessor = accessors.push({
			bufferView: indexView,
			componentType: 5123,
			count: item.geometry.indices.length,
			type: 'SCALAR',
			min: [0],
			max: [Math.max(...item.geometry.indices)],
		}) - 1
		meshes.push({
			name: item.name,
			primitives: [{ attributes: { POSITION: positionAccessor, NORMAL: normalAccessor }, indices: indexAccessor, material: item.slot % materials.length, mode: 4 }],
		})
		nodes.push({
			name: item.name,
			mesh: partIndex,
			translation: item.translation,
			rotation: item.rotation,
			scale: item.scale,
		})
	}

	const bin = Buffer.concat(chunks)
	const assetId = `3d-${family.category}-${family.id}-${padVariant(variant)}`
	const json = {
		asset: { version: '2.0', generator: `Remotion Studio Original 3D Pack ${PACK_VERSION}`, copyright: 'CC0-1.0' },
		scene: 0,
		scenes: [{ name: family.name, nodes: nodes.map((_, index) => index) }],
		nodes,
		meshes,
		materials,
		accessors,
		bufferViews,
		buffers: [{ byteLength: bin.length }],
		extras: { assetId, family: family.id, category: family.category, variant, license: 'CC0-1.0' },
	}
	const geometryFingerprint = glbFingerprint(json, bin)
	json.extras.geometryFingerprint = geometryFingerprint
	const glb = packGlb(json, bin)
	const worldBounds = combineBounds(parts.map((item) => transformedBounds(item.geometry.bounds, item.translation, item.rotation, item.scale)))
	return {
		glb,
		json,
		bin,
		parts,
		materials,
		geometryFingerprint,
		triangles: parts.reduce((total, item) => total + item.geometry.triangles, 0),
		bounds: summarizeBounds(worldBounds),
	}
}

function escapeXml(value) {
	return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

function previewSvg(family, variant, model, familyIndex) {
	const colors = PALETTES[(familyIndex * 5 + variant - 1) % PALETTES.length]
	const bounds = model.bounds
	const span = Math.max(...bounds.size, 0.1)
	const scale = 126 / span
	const ordered = [...model.parts].sort((a, b) => (a.translation[0] + a.translation[2]) - (b.translation[0] + b.translation[2]))
	const shapes = ordered.map((item, index) => {
		const x = 128 + (item.translation[0] - item.translation[2]) * scale * 0.66
		const y = 222 - item.translation[1] * scale * 0.82 + (item.translation[0] + item.translation[2]) * scale * 0.14
		const local = item.geometry.bounds
		const width = Math.max(5, (local.max[0] - local.min[0]) * item.scale[0] * scale * 0.72)
		const height = Math.max(5, (local.max[1] - local.min[1]) * item.scale[1] * scale * 0.72)
		const color = colors[item.slot % colors.length]
		const opacity = round(0.78 + (index % 3) * 0.08, 2)
		if (item.shape === 'sphere' || item.shape === 'torus' || item.shape === 'cylinder' || item.shape === 'cone') {
			return `<ellipse cx="${round(x, 2)}" cy="${round(y, 2)}" rx="${round(width / 2, 2)}" ry="${round(height / 2, 2)}" fill="${color}" fill-opacity="${opacity}" stroke="#fff" stroke-opacity=".42" stroke-width="1.4"/>`
		}
		const halfWidth = width / 2
		const halfHeight = height / 2
		return `<path d="M${round(x, 2)} ${round(y - halfHeight, 2)}L${round(x + halfWidth, 2)} ${round(y, 2)}L${round(x, 2)} ${round(y + halfHeight, 2)}L${round(x - halfWidth, 2)} ${round(y, 2)}Z" fill="${color}" fill-opacity="${opacity}" stroke="#fff" stroke-opacity=".42" stroke-width="1.4"/>`
	}).join('')
	const title = `${family.name} ${padVariant(variant)}`
	return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" role="img" aria-labelledby="title"><title id="title">${escapeXml(title)}</title><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${colors[3]}"/><stop offset="1" stop-color="#080B17"/></linearGradient><filter id="s" x="-30%" y="-30%" width="160%" height="180%"><feDropShadow dx="0" dy="5" stdDeviation="5" flood-opacity=".32"/></filter></defs><rect width="256" height="256" rx="30" fill="url(#bg)"/><ellipse cx="128" cy="222" rx="72" ry="12" fill="#000" opacity=".28"/><g filter="url(#s)">${shapes}</g><circle cx="225" cy="31" r="12" fill="${colors[4]}" opacity=".9"/><path d="M217 31h16M225 23v16" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>
`
}

function buildAsset(family, familyIndex, variant) {
	const variantText = padVariant(variant)
	const model = buildGlb(family, familyIndex, variant)
	const preview = previewSvg(family, variant, model, familyIndex)
	const pathValue = `${family.category}/${family.id}/${family.id}-${variantText}.glb`
	const previewPath = `previews/${family.category}/${family.id}/${family.id}-${variantText}.svg`
	const staticFilePath = `assets/3d/v1/${pathValue}`
	const previewStaticFilePath = `assets/3d/v1/${previewPath}`
	const seed = `remotion-3d-v1:${family.id}:${variant}`
	return {
		model,
		preview,
		entry: {
			id: `3d-${family.category}-${family.id}-${variantText}`,
			name: `${family.name} ${variantText}`,
			path: pathValue,
			staticFilePath,
			previewPath,
			previewStaticFilePath,
			category: family.category,
			family: family.id,
			variant,
			tags: [...family.tags, `variant-${variantText}`],
			roles: family.roles,
			triangles: model.triangles,
			nodes: model.parts.length,
			materials: model.materials.length,
			bounds: model.bounds,
			bytes: model.glb.length,
			previewBytes: Buffer.byteLength(preview),
			sha256: sha256(model.glb),
			previewSha256: sha256(preview),
			geometryFingerprint: model.geometryFingerprint,
			seed,
			style: `palette-${String((familyIndex * 5 + variant - 1) % PALETTES.length + 1).padStart(2, '0')}`,
			license: 'CC0-1.0',
			generationEligible: true,
		},
	}
}

function familyCatalogEntry(family) {
	return {
		id: family.id,
		name: family.name,
		category: family.category,
		description: family.description,
		variantCount: VARIANTS_PER_FAMILY,
		pathPattern: `assets/3d/v1/${family.category}/${family.id}/${family.id}-{NNN}.glb`,
		previewPathPattern: `assets/3d/v1/previews/${family.category}/${family.id}/${family.id}-{NNN}.svg`,
		tags: family.tags,
		roles: family.roles,
	}
}

function createCatalog(assets) {
	const categories = Object.entries(CATEGORY_COPY).map(([id, name]) => ({
		id,
		name,
		familyCount: FAMILIES.filter((family) => family.category === id).length,
		assetCount: FAMILIES.filter((family) => family.category === id).length * VARIANTS_PER_FAMILY,
	}))
	return {
		schemaVersion: SCHEMA_VERSION,
		packVersion: PACK_VERSION,
		format: 'glTF Binary 2.0 (.glb)',
		assetCount: assets.length,
		previewCount: assets.length,
		familyCount: FAMILIES.length,
		variantsPerFamily: VARIANTS_PER_FAMILY,
		minAssetCount: MIN_ASSET_COUNT,
		license: {
			spdx: 'CC0-1.0',
			name: 'Creative Commons Zero v1.0 Universal',
			url: 'https://creativecommons.org/publicdomain/zero/1.0/',
			path: 'assets/3d/LICENSE-3D.md',
		},
		root: 'assets/3d/v1',
		generator: 'scripts/generate-3d-assets.mjs',
		generatorCommand: 'node scripts/generate-3d-assets.mjs',
		features: ['self-contained', 'deterministic', 'low-poly', 'pbr-materials', 'y-up', 'no-external-dependencies'],
		categories,
		families: FAMILIES.map(familyCatalogEntry),
		assets,
	}
}

function parseGlb(buffer) {
	if (buffer.length < 36) throw new Error('GLB is too short')
	if (buffer.readUInt32LE(0) !== GLB_MAGIC) throw new Error('Invalid GLB magic')
	if (buffer.readUInt32LE(4) !== 2) throw new Error('GLB version is not 2')
	if (buffer.readUInt32LE(8) !== buffer.length) throw new Error('GLB declared length does not match file size')
	const jsonLength = buffer.readUInt32LE(12)
	if (buffer.readUInt32LE(16) !== JSON_CHUNK) throw new Error('First GLB chunk is not JSON')
	const jsonStart = 20
	const jsonEnd = jsonStart + jsonLength
	if (jsonEnd + 8 > buffer.length) throw new Error('GLB JSON chunk exceeds file')
	const json = JSON.parse(buffer.subarray(jsonStart, jsonEnd).toString('utf8').trimEnd())
	const binLength = buffer.readUInt32LE(jsonEnd)
	if (buffer.readUInt32LE(jsonEnd + 4) !== BIN_CHUNK) throw new Error('Second GLB chunk is not BIN')
	const binStart = jsonEnd + 8
	if (binStart + binLength !== buffer.length) throw new Error('GLB BIN chunk length does not match file')
	const bin = buffer.subarray(binStart, binStart + binLength)
	return { json, bin }
}

const COMPONENT_BYTES = { 5123: 2, 5126: 4 }
const TYPE_COMPONENTS = { SCALAR: 1, VEC3: 3 }

function readAccessor(json, bin, accessorIndex) {
	const accessor = json.accessors[accessorIndex]
	if (!accessor) throw new Error(`Missing accessor ${accessorIndex}`)
	const view = json.bufferViews[accessor.bufferView]
	if (!view) throw new Error(`Missing bufferView ${accessor.bufferView}`)
	const componentBytes = COMPONENT_BYTES[accessor.componentType]
	const componentCount = TYPE_COMPONENTS[accessor.type]
	if (!componentBytes || !componentCount) throw new Error(`Unsupported accessor format ${accessor.componentType}/${accessor.type}`)
	const stride = view.byteStride ?? componentBytes * componentCount
	const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0)
	const required = accessor.count === 0 ? 0 : (accessor.count - 1) * stride + componentBytes * componentCount
	if (start < 0 || start + required > bin.length || start + required > (view.byteOffset ?? 0) + view.byteLength) {
		throw new Error(`Accessor ${accessorIndex} exceeds its bufferView`)
	}
	const values = []
	for (let item = 0; item < accessor.count; item++) {
		for (let component = 0; component < componentCount; component++) {
			const offset = start + item * stride + component * componentBytes
			values.push(accessor.componentType === 5126 ? bin.readFloatLE(offset) : bin.readUInt16LE(offset))
		}
	}
	return { accessor, values, componentCount }
}

function approximatelyEqual(a, b, tolerance = 0.0001) {
	return Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(a), Math.abs(b))
}

function validateGlb(buffer, entry) {
	const { json, bin } = parseGlb(buffer)
	if (json.asset?.version !== '2.0') throw new Error(`${entry.path}: missing glTF 2.0 asset version`)
	if (json.buffers?.length !== 1 || json.buffers[0].uri) throw new Error(`${entry.path}: model is not self-contained`)
	if (json.buffers[0].byteLength > bin.length || bin.length - json.buffers[0].byteLength > 3) throw new Error(`${entry.path}: invalid embedded buffer length`)
	if (json.scenes?.length !== 1 || json.scene !== 0) throw new Error(`${entry.path}: invalid scene declaration`)
	if (json.nodes?.length !== entry.nodes || json.meshes?.length !== entry.nodes) throw new Error(`${entry.path}: node/mesh count mismatch`)
	if (json.materials?.length !== entry.materials) throw new Error(`${entry.path}: material count mismatch`)
	for (const [viewIndex, view] of json.bufferViews.entries()) {
		const start = view.byteOffset ?? 0
		if (start % 4 !== 0 || start < 0 || start + view.byteLength > json.buffers[0].byteLength) {
			throw new Error(`${entry.path}: invalid bufferView ${viewIndex}`)
		}
	}
	let triangles = 0
	for (const [meshIndex, mesh] of json.meshes.entries()) {
		if (mesh.primitives?.length !== 1) throw new Error(`${entry.path}: mesh ${meshIndex} must have one primitive`)
		const primitive = mesh.primitives[0]
		if (primitive.mode !== 4 || primitive.attributes?.POSITION === undefined || primitive.attributes?.NORMAL === undefined || primitive.indices === undefined) {
			throw new Error(`${entry.path}: mesh ${meshIndex} has an invalid primitive`)
		}
		const position = readAccessor(json, bin, primitive.attributes.POSITION)
		const normal = readAccessor(json, bin, primitive.attributes.NORMAL)
		const indices = readAccessor(json, bin, primitive.indices)
		if (position.accessor.componentType !== 5126 || position.componentCount !== 3 || normal.accessor.componentType !== 5126 || normal.componentCount !== 3) {
			throw new Error(`${entry.path}: POSITION/NORMAL must be float VEC3`)
		}
		if (indices.accessor.componentType !== 5123 || indices.componentCount !== 1 || indices.values.length % 3 !== 0) {
			throw new Error(`${entry.path}: indices must be triangle uint16 data`)
		}
		if (position.accessor.count !== normal.accessor.count) throw new Error(`${entry.path}: normal count mismatch`)
		if (indices.values.some((value) => value >= position.accessor.count)) throw new Error(`${entry.path}: out-of-range mesh index`)
		triangles += indices.values.length / 3
		const actualMin = [Infinity, Infinity, Infinity]
		const actualMax = [-Infinity, -Infinity, -Infinity]
		for (let index = 0; index < position.values.length; index += 3) {
			for (let axis = 0; axis < 3; axis++) {
				const value = position.values[index + axis]
				if (!Number.isFinite(value)) throw new Error(`${entry.path}: non-finite position`)
				actualMin[axis] = Math.min(actualMin[axis], value)
				actualMax[axis] = Math.max(actualMax[axis], value)
			}
		}
		for (let axis = 0; axis < 3; axis++) {
			if (!approximatelyEqual(actualMin[axis], position.accessor.min[axis]) || !approximatelyEqual(actualMax[axis], position.accessor.max[axis])) {
				throw new Error(`${entry.path}: accessor bounds mismatch`)
			}
		}
	}
	if (triangles !== entry.triangles) throw new Error(`${entry.path}: triangle count mismatch`)
	const fingerprint = glbFingerprint(json, bin.subarray(0, json.buffers[0].byteLength))
	if (fingerprint !== entry.geometryFingerprint || json.extras?.geometryFingerprint !== fingerprint) {
		throw new Error(`${entry.path}: geometry fingerprint mismatch`)
	}
	if (json.extras?.assetId !== entry.id || json.extras?.license !== 'CC0-1.0') throw new Error(`${entry.path}: invalid asset extras`)
	return { json, bin }
}

async function walkFiles(directory) {
	const files = []
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const absolute = path.join(directory, entry.name)
		if (entry.isDirectory()) files.push(...await walkFiles(absolute))
		else if (entry.isFile()) files.push(absolute)
	}
	return files
}

async function expectedAssets() {
	const built = []
	for (const [familyIndex, family] of FAMILIES.entries()) {
		for (let variant = 1; variant <= VARIANTS_PER_FAMILY; variant++) {
			built.push(buildAsset(family, familyIndex, variant))
		}
	}
	return built
}

async function generate() {
	const resolvedOutput = path.resolve(outputRoot)
	const resolvedAssetRoot = path.resolve(assetRoot)
	if (!resolvedOutput.startsWith(`${resolvedAssetRoot}${path.sep}`) || path.basename(resolvedOutput) !== 'v1') {
		throw new Error(`Refusing to replace unexpected output directory: ${resolvedOutput}`)
	}
	await rm(resolvedOutput, { recursive: true, force: true })
	await mkdir(resolvedOutput, { recursive: true })
	const built = await expectedAssets()
	for (const item of built) {
		const modelPath = path.join(outputRoot, ...item.entry.path.split('/'))
		const previewPath = path.join(outputRoot, ...item.entry.previewPath.split('/'))
		await mkdir(path.dirname(modelPath), { recursive: true })
		await mkdir(path.dirname(previewPath), { recursive: true })
		await writeFile(modelPath, item.model.glb)
		await writeFile(previewPath, item.preview)
	}
	const catalog = createCatalog(built.map((item) => item.entry))
	await writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`)
	return verify()
}

async function verify() {
	const built = await expectedAssets()
	const expectedCatalog = createCatalog(built.map((item) => item.entry))
	const diskCatalog = JSON.parse(await readFile(catalogPath, 'utf8'))
	if (JSON.stringify(diskCatalog) !== JSON.stringify(expectedCatalog)) {
		throw new Error('3D catalog is stale; run node scripts/generate-3d-assets.mjs')
	}
	if (diskCatalog.assetCount < MIN_ASSET_COUNT || diskCatalog.assetCount !== FAMILIES.length * VARIANTS_PER_FAMILY) {
		throw new Error(`Expected at least ${MIN_ASSET_COUNT} models; found ${diskCatalog.assetCount}`)
	}
	const ids = new Set()
	const modelHashes = new Set()
	const previewHashes = new Set()
	const fingerprints = new Set()
	const expectedFiles = new Set(['catalog.json'])
	let totalBytes = Buffer.byteLength(`${JSON.stringify(diskCatalog, null, 2)}\n`)
	let totalTriangles = 0
	for (const item of built) {
		const { entry } = item
		if (ids.has(entry.id)) throw new Error(`Duplicate asset id ${entry.id}`)
		if (modelHashes.has(entry.sha256)) throw new Error(`Duplicate model SHA-256 ${entry.path}`)
		if (previewHashes.has(entry.previewSha256)) throw new Error(`Duplicate preview SHA-256 ${entry.previewPath}`)
		if (fingerprints.has(entry.geometryFingerprint)) throw new Error(`Duplicate geometry fingerprint ${entry.path}`)
		ids.add(entry.id)
		modelHashes.add(entry.sha256)
		previewHashes.add(entry.previewSha256)
		fingerprints.add(entry.geometryFingerprint)
		const modelPath = path.join(outputRoot, ...entry.path.split('/'))
		const previewPath = path.join(outputRoot, ...entry.previewPath.split('/'))
		const [modelBuffer, previewBuffer] = await Promise.all([readFile(modelPath), readFile(previewPath)])
		if (modelBuffer.length !== entry.bytes || sha256(modelBuffer) !== entry.sha256 || !modelBuffer.equals(item.model.glb)) {
			throw new Error(`${entry.path}: generated model differs from catalog/source`)
		}
		if (previewBuffer.length !== entry.previewBytes || sha256(previewBuffer) !== entry.previewSha256 || previewBuffer.toString('utf8') !== item.preview) {
			throw new Error(`${entry.previewPath}: generated preview differs from catalog/source`)
		}
		validateGlb(modelBuffer, entry)
		expectedFiles.add(entry.path)
		expectedFiles.add(entry.previewPath)
		totalBytes += modelBuffer.length + previewBuffer.length
		totalTriangles += entry.triangles
	}
	const diskFiles = (await walkFiles(outputRoot)).map((file) => slash(path.relative(outputRoot, file))).sort()
	const stale = diskFiles.filter((file) => !expectedFiles.has(file))
	const missing = [...expectedFiles].filter((file) => !diskFiles.includes(file))
	if (stale.length || missing.length) {
		throw new Error(`3D file parity failed. Stale: ${stale.join(', ') || 'none'}; missing: ${missing.join(', ') || 'none'}`)
	}
	if (totalBytes > MAX_PACK_BYTES) throw new Error(`3D pack is too large: ${totalBytes} bytes`)
	const mib = (totalBytes / 1024 / 1024).toFixed(2)
	console.log(`Verified ${built.length.toLocaleString('en-US')} GLB 2.0 models + ${built.length.toLocaleString('en-US')} SVG previews across ${FAMILIES.length} families (${mib} MiB, ${totalTriangles.toLocaleString('en-US')} triangles).`)
	console.log('All IDs, SHA-256 hashes, previews, and geometry/content fingerprints are unique; catalog and disk are in exact parity.')
	return { assetCount: built.length, previewCount: built.length, totalBytes, totalTriangles }
}

const verifyOnly = process.argv.includes('--verify-only')

/**
 * This pack is generated on demand rather than committed - it is ~31 MB of
 * deterministic binaries that only the Remotion 3D samples read, so the repo
 * carries the recipe instead of the output. That makes "not built yet" a normal
 * state rather than a failure, and verifying it is simply a no-op: there is
 * nothing on disk that could have drifted. Run `npm run assets:3d` to build it.
 */
async function verifyIfBuilt() {
	const built = await stat(catalogPath).then(
		() => true,
		() => false,
	)
	if (!built) {
		console.log('3D pack not built - skipping verification. Run "npm run assets:3d" to generate it.')
		return
	}
	await verify()
}

try {
	await (verifyOnly ? verifyIfBuilt() : generate())
} catch (error) {
	console.error(error instanceof Error ? error.message : error)
	process.exitCode = 1
}
