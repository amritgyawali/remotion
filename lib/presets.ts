import type { OutputFormat, QualityPresetId } from './types'

export type QualityPreset = {
	id: QualityPresetId
	label: string
	tagline: string
	/** bits per pixel per second - drives the browser encoder bitrate */
	bitsPerPixel: number
	/** x264 constant rate factor used by the server renderer (lower = better) */
	crf: number
	x264Preset: 'veryfast' | 'medium' | 'slow' | 'veryslow'
	jpegQuality: number
	/** png frames are lossless but ~3x slower; only the max preset uses them */
	imageFormat: 'jpeg' | 'png'
	keyframeIntervalSeconds: number
}

export const QUALITY_PRESETS: Record<QualityPresetId, QualityPreset> = {
	draft: {
		id: 'draft',
		label: 'Draft',
		tagline: 'Fastest - check timing',
		bitsPerPixel: 0.05,
		crf: 26,
		x264Preset: 'veryfast',
		jpegQuality: 80,
		imageFormat: 'jpeg',
		keyframeIntervalSeconds: 4,
	},
	high: {
		id: 'high',
		label: 'High',
		tagline: 'Balanced - great for social',
		bitsPerPixel: 0.14,
		crf: 16,
		x264Preset: 'slow',
		jpegQuality: 95,
		imageFormat: 'jpeg',
		keyframeIntervalSeconds: 2,
	},
	max: {
		id: 'max',
		label: 'Max power',
		tagline: 'Every core, near-lossless',
		bitsPerPixel: 0.34,
		crf: 9,
		x264Preset: 'veryslow',
		jpegQuality: 100,
		imageFormat: 'png',
		keyframeIntervalSeconds: 1,
	},
}

export const MIN_BITRATE = 4_000_000
export const MAX_BITRATE = 160_000_000

/** Bitrate for the in-browser WebCodecs encoder. */
export function computeBitrate(
	width: number,
	height: number,
	fps: number,
	preset: QualityPresetId,
): number {
	const { bitsPerPixel } = QUALITY_PRESETS[preset]
	const raw = width * height * fps * bitsPerPixel
	return Math.round(Math.min(MAX_BITRATE, Math.max(MIN_BITRATE, raw)))
}

/**
 * H.264 level has to be high enough for the resolution, otherwise Chrome
 * silently refuses the config. Pick the smallest level that fits.
 */
export function h264CodecString(width: number, height: number, fps: number): string {
	const macroblocks = Math.ceil(width / 16) * Math.ceil(height / 16)
	const macroblocksPerSecond = macroblocks * fps
	const levels: Array<{ hex: string; maxMb: number; maxMbps: number }> = [
		{ hex: '1f', maxMb: 3600, maxMbps: 108_000 }, // 3.1
		{ hex: '20', maxMb: 5120, maxMbps: 216_000 }, // 3.2
		{ hex: '28', maxMb: 8192, maxMbps: 245_760 }, // 4.0
		{ hex: '29', maxMb: 8192, maxMbps: 245_760 }, // 4.1
		{ hex: '2a', maxMb: 8704, maxMbps: 522_240 }, // 4.2
		{ hex: '32', maxMb: 22_080, maxMbps: 589_824 }, // 5.0
		{ hex: '33', maxMb: 36_864, maxMbps: 983_040 }, // 5.1
		{ hex: '34', maxMb: 36_864, maxMbps: 2_073_600 }, // 5.2
		{ hex: '35', maxMb: 139_264, maxMbps: 4_177_920 }, // 6.0
	]
	const level =
		levels.find((l) => macroblocks <= l.maxMb && macroblocksPerSecond <= l.maxMbps) ??
		levels[levels.length - 1]
	// High profile (0x64) + constraint flags 0x00 + level
	return `avc1.6400${level.hex}`
}

export const FORMAT_INFO: Record<
	OutputFormat,
	{ label: string; extension: string; mimeType: string; engines: Array<'browser' | 'server'>; note: string }
> = {
	mp4: {
		label: 'MP4 / H.264',
		extension: 'mp4',
		mimeType: 'video/mp4',
		engines: ['browser', 'server'],
		note: 'Plays everywhere. Best default for TikTok, Reels, Shorts and YouTube.',
	},
	webm: {
		label: 'WebM / VP9',
		extension: 'webm',
		mimeType: 'video/webm',
		engines: ['browser', 'server'],
		note: 'Smaller files, supports alpha on the server renderer.',
	},
	gif: {
		label: 'Animated GIF',
		extension: 'gif',
		mimeType: 'image/gif',
		engines: ['server'],
		note: 'Server renderer only. Great for READMEs and embeds.',
	},
	prores: {
		label: 'ProRes 4444',
		extension: 'mov',
		mimeType: 'video/quicktime',
		engines: ['server'],
		note: 'Mastering quality with alpha channel. Very large files.',
	},
	png: {
		label: 'Still frame (PNG)',
		extension: 'png',
		mimeType: 'image/png',
		engines: ['browser', 'server'],
		note: 'Exports a single poster frame at full resolution.',
	},
}

export const SCALE_OPTIONS = [
	{ value: 0.5, label: '0.5x' },
	{ value: 1, label: '1x' },
	{ value: 2, label: '2x' },
]

/** Keeps encoders happy - H.264 requires even dimensions. */
export function evenDimension(value: number): number {
	const rounded = Math.round(value)
	return rounded % 2 === 0 ? rounded : rounded + 1
}
