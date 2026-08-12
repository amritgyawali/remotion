#!/usr/bin/env node

/**
 * Generates the studio's original raster kit: grain and paper overlays, glow and
 * bokeh sprites, matcaps, and equirectangular environment maps for 3D lighting.
 *
 * Nothing is downloaded and there is no image dependency - a small PNG encoder
 * (node:zlib) writes every file from seeded math, so the output is identical on
 * every machine and safe to publish under CC0.
 *
 * Usage:
 *   node scripts/generate-texture-assets.mjs
 *   node scripts/generate-texture-assets.mjs --verify-only
 */

import { createHash } from 'node:crypto'
import { deflateSync } from 'node:zlib'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const textureRoot = path.join(root, 'public', 'assets', 'texture')
const versionRoot = path.join(textureRoot, 'v1')
const catalogPath = path.join(textureRoot, 'catalog.json')

const PACK_VERSION = '1.0.0'
const TAU = Math.PI * 2

/* -------------------------------------------------------------------------- */
/*  PNG encoder                                                               */
/* -------------------------------------------------------------------------- */

const CRC_TABLE = (() => {
	const table = new Uint32Array(256)
	for (let index = 0; index < 256; index++) {
		let value = index
		for (let bit = 0; bit < 8; bit++) {
			value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
		}
		table[index] = value >>> 0
	}
	return table
})()

function crc32(buffer) {
	let crc = 0xffffffff
	for (let index = 0; index < buffer.length; index++) {
		crc = CRC_TABLE[(crc ^ buffer[index]) & 0xff] ^ (crc >>> 8)
	}
	return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
	const length = Buffer.alloc(4)
	length.writeUInt32BE(data.length)
	const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
	const crc = Buffer.alloc(4)
	crc.writeUInt32BE(crc32(body))
	return Buffer.concat([length, body, crc])
}

/**
 * Writes an 8-bit PNG. `channels` is 2 (gray + alpha) or 4 (RGBA); gray+alpha
 * halves the file size for overlays that only need luminance.
 */
function encodePng(width, height, channels, pixels) {
	const colorType = channels === 2 ? 4 : 6
	const stride = width * channels
	const raw = Buffer.alloc((stride + 1) * height)
	for (let y = 0; y < height; y++) {
		raw[y * (stride + 1)] = 0 // filter: none, keeps the encoder deterministic
		pixels.copy
			? pixels.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride)
			: raw.set(pixels.subarray(y * stride, y * stride + stride), y * (stride + 1) + 1)
	}

	const header = Buffer.alloc(13)
	header.writeUInt32BE(width, 0)
	header.writeUInt32BE(height, 4)
	header[8] = 8
	header[9] = colorType
	header[10] = 0
	header[11] = 0
	header[12] = 0

	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', header),
		chunk('IDAT', deflateSync(raw, { level: 9 })),
		chunk('IEND', Buffer.alloc(0)),
	])
}

/* -------------------------------------------------------------------------- */
/*  Deterministic noise                                                       */
/* -------------------------------------------------------------------------- */

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

const clamp01 = (value) => Math.min(1, Math.max(0, value))
const smoothstep = (value) => {
	const x = clamp01(value)
	return x * x * (3 - 2 * x)
}
const lerp = (from, to, t) => from + (to - from) * t
const byte = (value) => Math.round(clamp01(value) * 255)

/** Tileable value noise: the lattice wraps, so the texture repeats seamlessly. */
function makeTileableNoise(size, seed) {
	const random = seededRandom(seed)
	const lattice = new Float64Array(size * size)
	for (let index = 0; index < lattice.length; index++) lattice[index] = random()
	return (x, y) => {
		const x0 = Math.floor(x) % size
		const y0 = Math.floor(y) % size
		const x1 = (x0 + 1) % size
		const y1 = (y0 + 1) % size
		const fx = smoothstep(x - Math.floor(x))
		const fy = smoothstep(y - Math.floor(y))
		const a = lattice[y0 * size + x0]
		const b = lattice[y0 * size + x1]
		const c = lattice[y1 * size + x0]
		const d = lattice[y1 * size + x1]
		return lerp(lerp(a, b, fx), lerp(c, d, fx), fy)
	}
}

function fbm(noise, x, y, octaves, baseFrequency, size) {
	let total = 0
	let amplitude = 1
	let sum = 0
	let frequency = baseFrequency
	for (let octave = 0; octave < octaves; octave++) {
		total += noise(((x * frequency) % size) + size, ((y * frequency) % size) + size) * amplitude
		sum += amplitude
		amplitude *= 0.5
		frequency *= 2
	}
	return total / sum
}

/* -------------------------------------------------------------------------- */
/*  Texture painters                                                          */
/* -------------------------------------------------------------------------- */

function grayAlpha(size, paint) {
	const pixels = Buffer.alloc(size * size * 2)
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const [gray, alpha] = paint(x, y)
			const offset = (y * size + x) * 2
			pixels[offset] = byte(gray)
			pixels[offset + 1] = byte(alpha)
		}
	}
	return { width: size, height: size, channels: 2, pixels }
}

function rgba(width, height, paint) {
	const pixels = Buffer.alloc(width * height * 4)
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const [red, green, blue, alpha] = paint(x, y)
			const offset = (y * width + x) * 4
			pixels[offset] = byte(red)
			pixels[offset + 1] = byte(green)
			pixels[offset + 2] = byte(blue)
			pixels[offset + 3] = byte(alpha)
		}
	}
	return { width, height, channels: 4, pixels }
}

function filmGrain(size, seed, intensity) {
	const random = seededRandom(seed)
	const values = new Float64Array(size * size)
	for (let index = 0; index < values.length; index++) {
		// Two samples average toward the middle: photographic grain, not TV static.
		values[index] = (random() + random()) / 2
	}
	return grayAlpha(size, (x, y) => {
		const value = values[y * size + x]
		return [value, Math.abs(value - 0.5) * 2 * intensity]
	})
}

function softNoise(size, seed) {
	const noise = makeTileableNoise(64, seed)
	return grayAlpha(size, (x, y) => {
		const value = fbm(noise, (x / size) * 64, (y / size) * 64, 4, 1, 64)
		return [value, 1]
	})
}

function paperFiber(size, seed) {
	const coarse = makeTileableNoise(32, `${seed}-coarse`)
	const fine = makeTileableNoise(128, `${seed}-fine`)
	return grayAlpha(size, (x, y) => {
		const u = (x / size) * 32
		const v = (y / size) * 32
		const base = fbm(coarse, u, v, 3, 1, 32)
		const fibre = fine(((x / size) * 128) % 128, ((y / size) * 128) % 128)
		const streak = Math.sin((x / size) * TAU * 3 + fibre * 2.2) * 0.06
		const value = clamp01(0.62 + (base - 0.5) * 0.5 + (fibre - 0.5) * 0.22 + streak)
		return [value, clamp01(0.35 + (1 - value) * 0.5)]
	})
}

function halftone(size, dotsPerSide) {
	const cell = size / dotsPerSide
	return grayAlpha(size, (x, y) => {
		const row = Math.floor(y / cell)
		const offset = row % 2 === 0 ? 0 : cell / 2
		const cx = ((x + offset) % cell) - cell / 2
		const cy = (y % cell) - cell / 2
		const distance = Math.hypot(cx, cy) / (cell * 0.34)
		const dot = 1 - smoothstep((distance - 0.85) * 6)
		return [1, dot]
	})
}

function scanlines(size, lineHeight) {
	return grayAlpha(size, (_x, y) => {
		const phase = (y % lineHeight) / lineHeight
		const line = Math.sin(phase * Math.PI) ** 2
		return [0, line * 0.55]
	})
}

function vignette(size, strength) {
	const center = (size - 1) / 2
	return grayAlpha(size, (x, y) => {
		const distance = Math.hypot(x - center, y - center) / center
		return [0, clamp01(smoothstep((distance - 0.55) / 0.75) * strength)]
	})
}

function lightLeak(width, height, seed, colorA, colorB) {
	const noise = makeTileableNoise(32, seed)
	return rgba(width, height, (x, y) => {
		const u = x / width
		const v = y / height
		const drift = fbm(noise, u * 32, v * 32, 3, 1, 32)
		const band = Math.exp(-(((u - 0.78 + drift * 0.1) / 0.34) ** 2))
		const glowTop = Math.exp(-(((v - 0.18) / 0.6) ** 2))
		const alpha = clamp01(band * glowTop * 0.92)
		const blend = clamp01(v * 0.8 + drift * 0.3)
		return [
			lerp(colorA[0], colorB[0], blend),
			lerp(colorA[1], colorB[1], blend),
			lerp(colorA[2], colorB[2], blend),
			alpha,
		]
	})
}

function radialSprite(size, { core, edge, ringAt = null, softness = 1 }) {
	const center = (size - 1) / 2
	return rgba(size, size, (x, y) => {
		const distance = Math.hypot(x - center, y - center) / center
		let alpha = Math.exp(-((distance / (0.42 * softness)) ** 2))
		if (ringAt !== null) {
			const ring = Math.exp(-(((distance - ringAt) / 0.055) ** 2))
			alpha = clamp01(alpha * 0.35 + ring * 0.85)
		}
		if (distance > 1) alpha = 0
		const blend = clamp01(distance * 1.4)
		return [lerp(core[0], edge[0], blend), lerp(core[1], edge[1], blend), lerp(core[2], edge[2], blend), alpha]
	})
}

function starSprite(size, points, color) {
	const center = (size - 1) / 2
	return rgba(size, size, (x, y) => {
		const dx = (x - center) / center
		const dy = (y - center) / center
		const distance = Math.hypot(dx, dy)
		const angle = Math.atan2(dy, dx)
		const spike = Math.abs(Math.cos(angle * (points / 2))) ** 14
		const core = Math.exp(-((distance / 0.12) ** 2))
		const rays = spike * Math.exp(-((distance / 0.85) ** 2)) * 0.9
		const alpha = clamp01(core + rays)
		return [color[0], color[1], color[2], distance > 1 ? 0 : alpha]
	})
}

function smokePuff(size, seed) {
	const noise = makeTileableNoise(32, seed)
	const center = (size - 1) / 2
	return rgba(size, size, (x, y) => {
		const dx = (x - center) / center
		const dy = (y - center) / center
		const distance = Math.hypot(dx, dy)
		const cloud = fbm(noise, ((x / size) * 32) % 32, ((y / size) * 32) % 32, 4, 1, 32)
		const falloff = Math.exp(-((distance / 0.52) ** 2))
		const alpha = clamp01((cloud * 1.35 - 0.35) * falloff)
		const value = 0.72 + cloud * 0.28
		return [value, value, value, distance > 1 ? 0 : alpha]
	})
}

/** Lit-sphere material capture: a shaded hemisphere used as a fake environment. */
function matcap(size, { base, highlight, rim, roughness }) {
	const center = (size - 1) / 2
	const lightDirection = [-0.42, 0.66, 0.62]
	return rgba(size, size, (x, y) => {
		const nx = (x - center) / center
		const ny = -(y - center) / center
		const lengthSquared = nx * nx + ny * ny
		if (lengthSquared > 1) return [0, 0, 0, 0]
		const nz = Math.sqrt(1 - lengthSquared)
		const diffuse = clamp01(nx * lightDirection[0] + ny * lightDirection[1] + nz * lightDirection[2])
		const specular = diffuse ** (2 + (1 - roughness) * 220)
		const fresnel = (1 - nz) ** 3
		const shade = 0.25 + diffuse * 0.85
		return [
			clamp01(base[0] * shade + highlight[0] * specular + rim[0] * fresnel),
			clamp01(base[1] * shade + highlight[1] * specular + rim[1] * fresnel),
			clamp01(base[2] * shade + highlight[2] * specular + rim[2] * fresnel),
			1,
		]
	})
}

/**
 * Equirectangular environment map for three.js `scene.environment`. Latitude
 * drives sky-to-ground blending; longitude places a soft key light.
 */
function environmentMap(width, height, { zenith, horizon, ground, sun, sunLongitude, sunSize }) {
	return rgba(width, height, (x, y) => {
		const longitude = (x / width) * TAU
		const latitude = (0.5 - y / height) * Math.PI
		const up = Math.sin(latitude)
		const sky = up >= 0 ? smoothstep(up * 1.6) : 0
		const base =
			up >= 0
				? [lerp(horizon[0], zenith[0], sky), lerp(horizon[1], zenith[1], sky), lerp(horizon[2], zenith[2], sky)]
				: [
						lerp(horizon[0], ground[0], smoothstep(-up * 2)),
						lerp(horizon[1], ground[1], smoothstep(-up * 2)),
						lerp(horizon[2], ground[2], smoothstep(-up * 2)),
					]
		const angularDistance = Math.hypot(
			Math.atan2(Math.sin(longitude - sunLongitude), Math.cos(longitude - sunLongitude)),
			latitude - 0.42,
		)
		const glow = Math.exp(-((angularDistance / sunSize) ** 2))
		return [
			clamp01(base[0] + sun[0] * glow),
			clamp01(base[1] + sun[1] * glow),
			clamp01(base[2] + sun[2] * glow),
			1,
		]
	})
}

/* -------------------------------------------------------------------------- */
/*  Asset table                                                               */
/* -------------------------------------------------------------------------- */

const ASSETS = [
	{
		id: 'overlay-film-grain',
		title: 'Film Grain',
		category: 'overlays',
		file: 'overlays/film-grain.png',
		tileable: true,
		usage: 'Screen or overlay blend at 6-14% opacity to kill digital flatness.',
		tags: ['grain', 'film', 'texture', 'analog'],
		// 512 so a full-frame plate can be tiled at native size without upscaling.
		render: () => filmGrain(512, 'film-grain', 0.9),
	},
	{
		id: 'overlay-grain-fine',
		title: 'Fine Grain',
		category: 'overlays',
		file: 'overlays/grain-fine.png',
		tileable: true,
		usage: 'Subtle sensor noise for clean product and UI videos.',
		tags: ['grain', 'noise', 'subtle'],
		render: () => filmGrain(512, 'grain-fine', 0.45),
	},
	{
		id: 'overlay-noise-soft',
		title: 'Soft Noise',
		category: 'overlays',
		file: 'overlays/noise-soft.png',
		tileable: true,
		usage: 'Cloud-like value noise for displacement, masks and gradient dither.',
		tags: ['noise', 'clouds', 'mask', 'displacement'],
		render: () => softNoise(256, 'noise-soft'),
	},
	{
		id: 'overlay-paper-fiber',
		title: 'Paper Fiber',
		category: 'overlays',
		file: 'overlays/paper-fiber.png',
		tileable: true,
		usage: 'Multiply over flat colour for editorial, print and craft looks.',
		tags: ['paper', 'organic', 'editorial', 'craft'],
		render: () => paperFiber(256, 'paper-fiber'),
	},
	{
		id: 'overlay-halftone',
		title: 'Halftone Dots',
		category: 'overlays',
		file: 'overlays/halftone-dots.png',
		tileable: true,
		usage: 'Print/comic texture; mask a colour layer with it for retro panels.',
		tags: ['halftone', 'print', 'retro', 'comic'],
		render: () => halftone(256, 16),
	},
	{
		id: 'overlay-scanlines',
		title: 'Scanlines',
		category: 'overlays',
		file: 'overlays/scanlines.png',
		tileable: true,
		usage: 'CRT and terminal looks; keep under 25% opacity so text stays sharp.',
		tags: ['scanline', 'crt', 'terminal', 'retro'],
		render: () => scanlines(64, 4),
	},
	{
		id: 'overlay-vignette',
		title: 'Vignette',
		category: 'overlays',
		file: 'overlays/vignette.png',
		tileable: false,
		usage: 'Full-frame darkening that pushes attention to the centre.',
		tags: ['vignette', 'focus', 'cinematic'],
		render: () => vignette(512, 0.85),
	},
	{
		id: 'overlay-light-leak-warm',
		title: 'Warm Light Leak',
		category: 'overlays',
		file: 'overlays/light-leak-warm.png',
		tileable: false,
		usage: 'Screen blend from a frame edge for sunlight and nostalgia.',
		tags: ['light leak', 'warm', 'sun', 'analog'],
		render: () => lightLeak(768, 432, 'leak-warm', [1, 0.78, 0.36], [1, 0.38, 0.22]),
	},
	{
		id: 'overlay-light-leak-cool',
		title: 'Cool Light Leak',
		category: 'overlays',
		file: 'overlays/light-leak-cool.png',
		tileable: false,
		usage: 'Screen blend for night, tech and sci-fi scenes.',
		tags: ['light leak', 'cool', 'night', 'sci-fi'],
		render: () => lightLeak(768, 432, 'leak-cool', [0.45, 0.78, 1], [0.55, 0.35, 1]),
	},
	{
		id: 'sprite-glow-radial',
		title: 'Radial Glow',
		category: 'sprites',
		file: 'sprites/glow-radial.png',
		tileable: false,
		usage: 'Additive light source, lens bloom, or a soft particle in 3D.',
		tags: ['glow', 'light', 'particle', 'additive'],
		render: () => radialSprite(256, { core: [1, 0.97, 0.86], edge: [1, 0.65, 0.25] }),
	},
	{
		id: 'sprite-bokeh',
		title: 'Bokeh Circle',
		category: 'sprites',
		file: 'sprites/bokeh-circle.png',
		tileable: false,
		usage: 'Defocused highlight; scatter a few dozen at low opacity for depth.',
		tags: ['bokeh', 'depth', 'particle', 'background'],
		render: () => radialSprite(256, { core: [1, 1, 1], edge: [0.72, 0.86, 1], ringAt: 0.82, softness: 1.6 }),
	},
	{
		id: 'sprite-spark-star',
		title: 'Spark Star',
		category: 'sprites',
		file: 'sprites/spark-star.png',
		tileable: false,
		usage: 'Four-point sparkle for reveals, magic and highlight moments.',
		tags: ['spark', 'star', 'sparkle', 'reveal'],
		render: () => starSprite(256, 4, [1, 0.98, 0.92]),
	},
	{
		id: 'sprite-smoke-puff',
		title: 'Smoke Puff',
		category: 'sprites',
		file: 'sprites/smoke-puff.png',
		tileable: false,
		usage: 'Soft volumetric puff for fog, dust and atmosphere layers.',
		tags: ['smoke', 'fog', 'dust', 'atmosphere'],
		render: () => smokePuff(256, 'smoke-puff'),
	},
	{
		id: 'matcap-chrome',
		title: 'Chrome Matcap',
		category: 'matcaps',
		file: 'matcaps/chrome.png',
		tileable: false,
		usage: 'meshMatcapMaterial for mirror-like metal without an HDRI.',
		tags: ['matcap', 'metal', 'chrome', '3d'],
		render: () => matcap(256, { base: [0.42, 0.46, 0.52], highlight: [1, 1, 1], rim: [0.5, 0.6, 0.8], roughness: 0.08 }),
	},
	{
		id: 'matcap-clay',
		title: 'Clay Matcap',
		category: 'matcaps',
		file: 'matcaps/clay.png',
		tileable: false,
		usage: 'Soft matte surface for friendly, illustrative 3D.',
		tags: ['matcap', 'clay', 'matte', '3d'],
		render: () => matcap(256, { base: [0.86, 0.6, 0.48], highlight: [1, 0.9, 0.82], rim: [0.4, 0.22, 0.2], roughness: 0.85 }),
	},
	{
		id: 'matcap-pearl',
		title: 'Pearl Matcap',
		category: 'matcaps',
		file: 'matcaps/pearl.png',
		tileable: false,
		usage: 'Premium, softly iridescent surface for product hero shots.',
		tags: ['matcap', 'pearl', 'premium', '3d'],
		render: () => matcap(256, { base: [0.82, 0.84, 0.92], highlight: [1, 1, 1], rim: [0.72, 0.5, 0.95], roughness: 0.35 }),
	},
	{
		id: 'matcap-emerald',
		title: 'Emerald Matcap',
		category: 'matcaps',
		file: 'matcaps/emerald.png',
		tileable: false,
		usage: 'Deep green glassy material for nature and finance visuals.',
		tags: ['matcap', 'green', 'glass', '3d'],
		render: () => matcap(256, { base: [0.1, 0.55, 0.38], highlight: [0.85, 1, 0.94], rim: [0.2, 0.9, 0.7], roughness: 0.2 }),
	},
	{
		id: 'environment-studio',
		title: 'Studio Environment',
		category: 'environments',
		file: 'environments/studio.png',
		tileable: false,
		usage: 'Equirectangular map for scene.environment: neutral product lighting.',
		tags: ['environment', 'hdri-style', 'studio', '3d'],
		render: () =>
			environmentMap(1024, 512, {
				zenith: [0.94, 0.96, 1],
				horizon: [0.72, 0.75, 0.82],
				ground: [0.16, 0.17, 0.2],
				sun: [0.5, 0.48, 0.44],
				sunLongitude: Math.PI * 0.6,
				sunSize: 0.5,
			}),
	},
	{
		id: 'environment-sunset',
		title: 'Sunset Environment',
		category: 'environments',
		file: 'environments/sunset.png',
		tileable: false,
		usage: 'Warm low-sun lighting for nature, travel and lifestyle scenes.',
		tags: ['environment', 'sunset', 'warm', '3d'],
		render: () =>
			environmentMap(1024, 512, {
				zenith: [0.18, 0.28, 0.52],
				horizon: [0.98, 0.62, 0.32],
				ground: [0.1, 0.12, 0.12],
				sun: [0.7, 0.42, 0.1],
				sunLongitude: Math.PI * 0.35,
				sunSize: 0.42,
			}),
	},
	{
		id: 'environment-night-city',
		title: 'Night City Environment',
		category: 'environments',
		file: 'environments/night-city.png',
		tileable: false,
		usage: 'Cool ambient with a magenta key for tech, gaming and neon looks.',
		tags: ['environment', 'night', 'neon', '3d'],
		render: () =>
			environmentMap(1024, 512, {
				zenith: [0.03, 0.04, 0.1],
				horizon: [0.16, 0.1, 0.3],
				ground: [0.02, 0.02, 0.05],
				sun: [0.62, 0.16, 0.72],
				sunLongitude: Math.PI * 1.25,
				sunSize: 0.7,
			}),
	},
]

/* -------------------------------------------------------------------------- */
/*  Build                                                                     */
/* -------------------------------------------------------------------------- */

const verifyOnly = process.argv.includes('--verify-only')

async function main() {
	if (verifyOnly) {
		const catalog = JSON.parse(await readFile(catalogPath, 'utf8'))
		if (catalog.assetCount !== ASSETS.length) {
			throw new Error('Catalog asset count does not match the generator')
		}
		for (const asset of ASSETS) {
			const entry = catalog.assets.find((item) => item.id === asset.id)
			if (!entry) throw new Error(`${asset.id}: missing from catalog`)
			const buffer = await readFile(path.join(textureRoot, entry.file))
			const sha256 = createHash('sha256').update(buffer).digest('hex')
			if (sha256 !== entry.sha256) throw new Error(`${asset.id}: SHA-256 does not match catalog`)
			console.log(`verified ${asset.id.padEnd(28)} ${entry.width}x${entry.height}  ${(buffer.length / 1024).toFixed(0)} KB`)
		}
		console.log(`\nverified ${ASSETS.length} deterministic PNG textures`)
		return
	}

	await rm(versionRoot, { recursive: true, force: true })
	const catalogAssets = []
	let totalBytes = 0

	for (const asset of ASSETS) {
		const image = asset.render()
		const buffer = encodePng(image.width, image.height, image.channels, image.pixels)
		const filePath = path.join(versionRoot, asset.file)
		await mkdir(path.dirname(filePath), { recursive: true })
		await writeFile(filePath, buffer)
		totalBytes += buffer.length

		catalogAssets.push({
			id: asset.id,
			title: asset.title,
			kind: 'texture',
			category: asset.category,
			file: `v1/${asset.file}`,
			path: `/assets/texture/v1/${asset.file}`,
			staticFilePath: `assets/texture/v1/${asset.file}`,
			width: image.width,
			height: image.height,
			hasAlpha: true,
			tileable: asset.tileable,
			usage: asset.usage,
			tags: asset.tags,
			bytes: buffer.length,
			sha256: createHash('sha256').update(buffer).digest('hex'),
		})
		console.log(`texture -> public/assets/texture/v1/${asset.file} (${image.width}x${image.height}, ${(buffer.length / 1024).toFixed(0)} KB)`)
	}

	await writeFile(
		catalogPath,
		`${JSON.stringify(
			{
				schemaVersion: 1,
				packVersion: PACK_VERSION,
				generatedBy: 'scripts/generate-texture-assets.mjs',
				title: 'Remotion Studio Texture Kit',
				description:
					'Original grain, paper, glow, matcap and environment textures generated from seeded math.',
				license: 'CC0-1.0',
				attributionRequired: false,
				assetCount: catalogAssets.length,
				totalBytes,
				assets: catalogAssets,
			},
			null,
			2,
		)}\n`,
	)
	console.log(
		`catalog -> public/assets/texture/catalog.json (${catalogAssets.length} assets, ${(totalBytes / 1_000_000).toFixed(2)} MB)`,
	)
}

main().catch((error) => {
	console.error(`\n${error instanceof Error ? error.message : error}\n`)
	process.exit(1)
})
