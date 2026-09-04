/**
 * The tools that can be done by the cloud instead of by this laptop, and the
 * exact Cloudinary transformation each one becomes.
 *
 * This is the honest half of cloud mode. A studio full of WebCodecs pipelines
 * cannot all be posted to a URL - segmentation, chroma keying and the caption
 * compositor run per pixel per frame against models and canvases that only
 * exist in the browser. What *can* move is the large, dumb, expensive middle:
 * trims, speed, crops, rotations, grades, overlays, format changes. Those are
 * the ones a phone or a 7 GB laptop struggles with, and every one of them is a
 * single URL Cloudinary builds on its own hardware.
 *
 * So the map below is deliberately a subset, and `cloudPlanFor` returns null
 * for everything else rather than pretending. The UI reads that null and says
 * "this one runs on your device" instead of failing halfway through an upload.
 *
 * No secrets are imported here: the browser uses the same function to decide
 * whether to show the cloud button at all.
 */

import type { CloudResourceType } from './types'

export type CloudOutput = {
	format: 'mp4' | 'webm'
	quality: 'draft' | 'high' | 'max'
}

export type CloudOverlayNeed = {
	/** which extra file the transform needs uploaded before it can run */
	slot: 'image' | 'video' | 'subtitle'
	label: string
}

export type CloudTransformPlan = {
	/** the transformation string, chained components separated by a slash */
	transformation: string
	/** what the derived asset is delivered as */
	resourceType: CloudResourceType
	format: string
	/** what the finished file should be called, minus the extension */
	label: string
	overlay?: CloudOverlayNeed
	/** shown next to the cloud button so the trade-off is never a surprise */
	note?: string
}

type Params = Record<string, string | number | boolean>

function num(params: Params, key: string, fallback: number): number {
	const value = params[key]
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function str(params: Params, key: string, fallback: string): string {
	const value = params[key]
	return typeof value === 'string' && value.length > 0 ? value : fallback
}

function bool(params: Params, key: string, fallback: boolean): boolean {
	const value = params[key]
	return typeof value === 'boolean' ? value : fallback
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/** Trailing zeroes in a URL segment are noise; Cloudinary reads either form. */
function short(value: number, places = 3): string {
	return String(Number(value.toFixed(places)))
}

const GRAVITY: Record<string, string> = {
	'top-left': 'north_west',
	'top-right': 'north_east',
	'bottom-left': 'south_west',
	'bottom-right': 'south_east',
	'bottom-center': 'south',
	center: 'center',
}

/**
 * Text inside a transformation is inside a URL path segment, so a comma or a
 * slash in it would be read as a component or a chain break. Encoding twice is
 * what Cloudinary's own documentation asks for, and it is the difference
 * between a caption reading "Kathmandu, Nepal" and a 400.
 */
function encodeLayerText(text: string): string {
	return encodeURIComponent(text.slice(0, 200))
		.replace(/%2C/gi, '%252C')
		.replace(/%2F/gi, '%252F')
}

/** A public id used as an overlay puts its folders after colons, not slashes. */
export function layerId(publicId: string): string {
	return publicId.replace(/\//g, ':')
}

function hexColor(value: string, fallback: string): string {
	const match = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(value.trim())
	return match ? match[1].toLowerCase() : fallback
}

/**
 * Speed, expressed the way Cloudinary accepts it.
 *
 * `e_accelerate` takes a percentage change and tops out at +100 (double speed)
 * and -50 (half). A time-lapse at 8x is therefore not one component but three
 * doublings chained together, and a 0.25x slow motion is two halvings. Chaining
 * is exact - each stage applies to the output of the last - so an 8x request
 * really does come back 8x.
 */
function accelerateChain(factor: number): string[] {
	const safe = clamp(factor, 0.05, 32)
	if (Math.abs(safe - 1) < 0.01) return []

	const parts: string[] = []
	let remaining = safe

	while (remaining > 2.0001 && parts.length < 6) {
		parts.push('e_accelerate:100')
		remaining /= 2
	}
	while (remaining < 0.4999 && parts.length < 6) {
		parts.push('e_accelerate:-50')
		remaining *= 2
	}
	if (Math.abs(remaining - 1) > 0.01) {
		parts.push(`e_accelerate:${short(clamp((remaining - 1) * 100, -50, 100), 1)}`)
	}
	return parts
}

/** The output stage every video plan ends with: codec, quality, sane ceiling. */
function outputChain(output: CloudOutput): string {
	const quality =
		output.quality === 'draft' ? 'q_auto:eco' : output.quality === 'max' ? 'q_auto:best' : 'q_auto:good'
	const codec = output.format === 'webm' ? 'vc_vp9' : 'vc_h264'
	return `${quality},${codec}`
}

/**
 * Which tool ids the cloud can take, and what each one turns into.
 *
 * Each entry returns the chain *without* the output stage; `cloudPlanFor` adds
 * that. Returning an empty array means "this tool is cloud-capable but these
 * particular params are a no-op", which the caller treats as nothing to do.
 */
type Builder = (params: Params, output: CloudOutput) => CloudTransformPlan | null

const BUILDERS: Record<string, Builder> = {
	/* ------------------------------------------------------------- timing */

	'trim-clip': (params) => {
		const start = Math.max(0, num(params, 'startSec', 0))
		const end = Math.max(start + 0.05, num(params, 'endSec', 0))
		return plan([`so_${short(start, 2)},eo_${short(end, 2)}`], 'trimmed')
	},

	'speed-change': (params) => plan(accelerateChain(num(params, 'factor', 1.5)), 'speed'),
	'slow-motion': (params) => plan(accelerateChain(num(params, 'factor', 0.5)), 'slow'),
	'time-lapse': (params) => plan(accelerateChain(num(params, 'factor', 8)), 'timelapse'),

	'loop-clip': (params) => {
		// e_loop counts the *extra* passes, so three total plays is two loops.
		const extra = clamp(Math.round(num(params, 'times', 3)) - 1, 1, 19)
		return plan([`e_loop:${extra}`], 'looped')
	},

	'reverse-video': () => plan(['e_reverse'], 'reversed'),

	/* ---------------------------------------------------------- transform */

	'rotate-cw': () => plan(['a_90'], 'rotated'),
	'rotate-ccw': () => plan(['a_270'], 'rotated'),
	'rotate-180': () => plan(['a_180'], 'rotated'),
	'flip-horizontal': () => plan(['a_hflip'], 'flipped'),
	'flip-vertical': () => plan(['a_vflip'], 'flipped'),

	'crop-video': (params) => {
		const left = clamp(num(params, 'left', 0), 0, 45) / 100
		const top = clamp(num(params, 'top', 0), 0, 45) / 100
		const right = clamp(num(params, 'right', 0), 0, 45) / 100
		const bottom = clamp(num(params, 'bottom', 0), 0, 45) / 100
		const width = 1 - left - right
		const height = 1 - top - bottom
		if (width > 0.999 && height > 0.999) return plan([], 'crop')
		// Cloudinary reads a value below 1 as a fraction of the source, and
		// exactly 1 as a single pixel - so a full-width crop has to stay under it.
		return plan(
			[
				`c_crop,g_north_west,w_${short(Math.min(width, 0.999))},h_${short(Math.min(height, 0.999))},x_${short(left)},y_${short(top)}`,
			],
			'cropped',
		)
	},

	'aspect-crop': (params) => {
		const aspect = str(params, 'aspect', '9:16').replace(':', ':')
		if (!/^\d{1,2}:\d{1,2}$/.test(aspect)) return null
		return plan([`ar_${aspect},c_fill,g_auto`], 'reframed')
	},

	'resize-video': (params) => {
		const width = clamp(Math.round(num(params, 'width', 1280)), 120, 3840)
		// Even widths only: an odd one makes H.264 chroma subsampling fail.
		return plan([`w_${width - (width % 2)},c_scale`], 'resized')
	},

	'change-framerate': (params) => {
		const fps = clamp(Math.round(Number(str(params, 'fps', '30'))) || 30, 1, 120)
		return plan([`fps_${fps}`], `${fps}fps`)
	},

	'letterbox-pad': (params) => {
		const aspect = str(params, 'aspect', '9:16')
		if (!/^\d{1,2}:\d{1,2}$/.test(aspect)) return null
		const color = hexColor(str(params, 'padColor', '#000000'), '000000')
		return plan([`ar_${aspect},c_pad,b_rgb:${color}`], 'padded')
	},

	/* -------------------------------------------------------------- color */

	grayscale: () => plan(['e_grayscale'], 'grayscale'),
	sepia: () => plan(['e_sepia'], 'sepia'),
	'invert-colors': () => plan(['e_negate'], 'inverted'),
	'auto-color': () => plan(['e_improve'], 'autocolor'),

	'blur-video': (params) => {
		// The tool asks for a blur radius in pixels; Cloudinary wants 1-2000.
		const px = clamp(num(params, 'px', 8), 0, 100)
		if (px <= 0) return plan([], 'blur')
		return plan([`e_blur:${Math.round(clamp(px * 20, 1, 2000))}`], 'blurred')
	},

	'sharpen-video': (params) => {
		const amount = clamp(num(params, 'amount', 50), 0, 100)
		if (amount <= 0) return plan([], 'sharpen')
		return plan([`e_sharpen:${Math.round(clamp(amount * 20, 1, 2000))}`], 'sharpened')
	},

	vignette: (params) =>
		plan([`e_vignette:${Math.round(clamp(num(params, 'strength', 40), 0, 100))}`], 'vignette'),

	'color-grade': (params) => {
		const parts = [
			gradePart('e_brightness', num(params, 'brightness', 0)),
			gradePart('e_contrast', num(params, 'contrast', 0)),
			gradePart('e_saturation', num(params, 'saturation', 0)),
		].filter(Boolean) as string[]
		return plan(parts.length ? [parts.join(',')] : [], 'graded')
	},

	adjust: (params) => {
		const parts = [
			gradePart('e_brightness', num(params, 'exposure', 0)),
			gradePart('e_contrast', num(params, 'contrast', 0)),
			gradePart('e_saturation', num(params, 'saturation', 0)),
			gradePart('e_vibrance', num(params, 'vibrance', 0)),
			gradePart('e_hue', num(params, 'hue', 0)),
		].filter(Boolean) as string[]
		const sharpness = clamp(num(params, 'sharpness', 0), 0, 100)
		if (sharpness > 0) parts.push(`e_sharpen:${Math.round(clamp(sharpness * 20, 1, 2000))}`)
		return plan(parts.length ? [parts.join(',')] : [], 'adjusted', {
			note: 'The cloud covers exposure, contrast, saturation, vibrance, hue and sharpness. Highlights, shadows and clarity are device-only.',
		})
	},

	'video-enhance': () => plan(['e_improve:50', 'e_sharpen:400'], 'enhanced'),

	stabilization: (params) => {
		// e_deshake only accepts these four pixel budgets.
		const strength = clamp(num(params, 'strength', 50), 0, 100)
		const pixels = strength > 75 ? 64 : strength > 50 ? 48 : strength > 25 ? 32 : 16
		return plan([`e_deshake:${pixels}`], 'stabilized')
	},

	/* -------------------------------------------------------------- audio */

	'mute-audio': () => plan(['ac_none'], 'muted'),

	'volume-gain': (params) => {
		const db = clamp(num(params, 'db', 0), -60, 24)
		if (Math.abs(db) < 0.1) return plan([], 'volume')
		return plan([`e_volume:${short(db, 1)}db`], 'volume')
	},

	'fade-audio': (params) => {
		const parts: string[] = []
		const inMs = Math.round(clamp(num(params, 'inMs', 0), 0, 60_000))
		const outMs = Math.round(clamp(num(params, 'outMs', 0), 0, 60_000))
		if (inMs > 0) parts.push(`e_fade:${inMs}`)
		if (outMs > 0) parts.push(`e_fade:-${outMs}`)
		return plan(parts.length ? [parts.join(',')] : [], 'faded')
	},

	/* ------------------------------------------------------------ overlay */

	watermark: (params) => {
		const gravity = GRAVITY[str(params, 'position', 'bottom-right')] ?? 'south_east'
		const scale = clamp(num(params, 'scale', 16), 5, 45) / 100
		const opacity = Math.round(clamp(num(params, 'opacity', 85), 10, 100))
		return plan(
			[
				`l_%OVERLAY%,w_${short(scale)},fl_relative,o_${opacity}`,
				`fl_layer_apply,g_${gravity},x_24,y_24`,
			],
			'watermarked',
			{ overlay: { slot: 'image', label: 'Watermark image' } },
		)
	},

	'text-overlay': (params) => {
		const content = str(params, 'content', '').trim()
		if (!content) return null
		const size = Math.round(clamp(num(params, 'size', 36), 10, 200))
		const color = hexColor(str(params, 'color', '#ffffff'), 'ffffff')
		const gravity = GRAVITY[str(params, 'position', 'bottom-center')] ?? 'south'
		const chip = bool(params, 'background', true)
		const layer = [
			`l_text:Arial_${size}_bold:${encodeLayerText(content)}`,
			`co_rgb:${color}`,
			chip ? 'b_rgb:000000A0' : null,
		]
			.filter(Boolean)
			.join(',')
		return plan([layer, `fl_layer_apply,g_${gravity},y_48`], 'titled')
	},

	'subtitle-burn-in': (params) => {
		const size = Math.round(clamp(num(params, 'size', 28), 12, 120))
		return plan([`l_subtitles:Arial_${size}:%OVERLAY%`, 'fl_layer_apply'], 'subtitled', {
			overlay: { slot: 'subtitle', label: 'Subtitle file (.srt)' },
		})
	},

	'picture-in-picture': (params) => {
		const gravity = GRAVITY[str(params, 'position', 'top-right')] ?? 'north_east'
		const scale = clamp(num(params, 'scale', 30), 10, 60) / 100
		const opacity = Math.round(clamp(num(params, 'opacity', 100), 10, 100))
		return plan(
			[
				`l_video:%OVERLAY%,w_${short(scale)},fl_relative,o_${opacity}`,
				`fl_layer_apply,g_${gravity},x_24,y_24`,
			],
			'pip',
			{ overlay: { slot: 'video', label: 'Inset video' } },
		)
	},

	/* ------------------------------------------------------------- export */

	'format-convert': (_params, output) => plan([], output.format === 'webm' ? 'webm' : 'mp4'),

	'compress-video': (_params, output) =>
		plan([output.quality === 'max' ? 'q_auto:good' : 'q_auto:eco'], 'compressed'),

	'extract-thumbnail': (params) => {
		const at = Math.max(0, num(params, 'atSeconds', 0))
		return {
			transformation: `so_${short(at, 2)}`,
			resourceType: 'video',
			format: 'jpg',
			label: 'frame',
		}
	},

	'export-gif': (params) => {
		const width = Math.round(clamp(num(params, 'widthPx', 360), 120, 640))
		const fps = Math.round(clamp(num(params, 'fps', 10), 4, 20))
		const seconds = Math.round(clamp(num(params, 'maxSeconds', 8), 1, 30))
		return {
			transformation: `so_0,eo_${seconds},w_${width},c_scale,fps_${fps}`,
			resourceType: 'video',
			format: 'gif',
			label: 'loop',
		}
	},

	'extract-audio': (params) => {
		const format = str(params, 'format', 'mp3').toLowerCase()
		return {
			transformation: 'fl_no_overflow',
			resourceType: 'video',
			format: ['mp3', 'aac', 'ogg', 'wav'].includes(format) ? format : 'mp3',
			label: 'audio',
		}
	},
}

/** -100..100 sliders that are zero add nothing but a longer URL. */
function gradePart(effect: string, value: number): string | null {
	const amount = Math.round(clamp(value, -100, 100))
	return amount === 0 ? null : `${effect}:${amount}`
}

/** Small helper so every builder above reads as "these components, this name". */
function plan(
	parts: string[],
	label: string,
	extra: { overlay?: CloudOverlayNeed; note?: string } = {},
): CloudTransformPlan {
	return {
		transformation: parts.join('/'),
		resourceType: 'video',
		format: '',
		label,
		...extra,
	}
}

export function cloudCapable(toolId: string): boolean {
	return Object.hasOwn(BUILDERS, toolId)
}

export const CLOUD_TOOL_IDS: readonly string[] = Object.keys(BUILDERS).sort()

/**
 * Turns one tool press into one Cloudinary URL, or into null when this tool
 * only exists on the device.
 *
 * The output stage is appended here rather than inside every builder, so a
 * change to how quality is expressed is a change to one line. Plans that
 * already fix their own format - a thumbnail, a GIF, an audio extraction -
 * keep it and skip the video codec entirely.
 */
export function cloudPlanFor(
	toolId: string,
	params: Params,
	output: CloudOutput,
): CloudTransformPlan | null {
	const build = BUILDERS[toolId]
	if (!build) return null

	const base = build(params, output)
	if (!base) return null

	if (base.format) return base

	const chain = [base.transformation, outputChain(output)].filter((part) => part.length > 0)
	return { ...base, transformation: chain.join('/'), format: output.format }
}

/** Fills the `%OVERLAY%` placeholder once the extra file has a public id. */
export function withOverlay(transformation: string, overlayPublicId: string): string {
	return transformation.replace(/%OVERLAY%/g, layerId(overlayPublicId))
}

export function needsOverlay(transformation: string): boolean {
	return transformation.includes('%OVERLAY%')
}

/* ========================================================================== *
 *  The two studio-shaped transforms
 *
 *  Everything above turns one tool press into one URL. These two turn a whole
 *  studio's finished decision - a cut list, a caption track - into one URL, so
 *  the studio's heaviest export stops needing a WebCodecs encoder at all.
 * ========================================================================== */

/** One kept stretch of the source, as the cut list describes it. */
export type CloudSpliceSegment = {
	startSec: number
	endSec: number
	/** playback rate; 1 leaves the stretch alone */
	speed: number
}

/**
 * Cloudinary builds a splice chain as one component per joined segment, and
 * every component carries the whole overlay reference. Past a couple of dozen
 * the URL stops being a URL, and the transformation stops being something the
 * account will accept. A cut with more joins than this stays on the device,
 * where it costs time rather than a failure.
 */
export const MAX_CLOUD_SPLICES = 20

export function cloudSpliceLimitReason(segments: number): string | null {
	if (segments < 1) return 'There is nothing left to keep in this cut.'
	if (segments > MAX_CLOUD_SPLICES) {
		return `This cut joins ${segments} pieces. The cloud can splice up to ${MAX_CLOUD_SPLICES} in one job, so this export runs on your device.`
	}
	return null
}

/**
 * Turns a list of kept stretches into a splice chain.
 *
 * The first stretch is the base asset trimmed to itself; every later one is
 * the same asset spliced onto the end. That is why `publicId` is needed here
 * and nowhere else - a splice layer names the file it is splicing in, and the
 * file it names is the source itself.
 */
export function cloudSplicePlan(args: {
	publicId: string
	segments: CloudSpliceSegment[]
	output: CloudOutput
	/** dropping the sound is the one thing the cut list cannot express */
	includeAudio?: boolean
}): CloudTransformPlan | null {
	const segments = args.segments.filter((item) => item.endSec - item.startSec > 0.02)
	if (segments.length === 0 || segments.length > MAX_CLOUD_SPLICES) return null

	const layer = layerId(args.publicId)
	const parts: string[] = []

	segments.forEach((segment, index) => {
		const range = `so_${short(segment.startSec)},eo_${short(segment.endSec)}`
		const speed = accelerateChain(segment.speed)
		const body = [range, ...speed].join('/')
		if (index === 0) {
			parts.push(body)
			return
		}
		// A spliced layer carries its own trim and speed, then is applied.
		parts.push(`fl_splice,l_video:${layer}`, body, 'fl_layer_apply')
	})

	if (args.includeAudio === false) parts.push('ac_none')
	parts.push(outputChain(args.output))

	const keptSec = segments.reduce(
		(total, item) => total + (item.endSec - item.startSec) / Math.max(0.1, item.speed),
		0,
	)

	return {
		transformation: parts.filter((part) => part.length > 0).join('/'),
		resourceType: 'video',
		format: args.output.format,
		label: `Silence cut (${segments.length} ${segments.length === 1 ? 'piece' : 'pieces'}, ${short(keptSec, 1)}s)`,
	}
}

export type CloudSubtitleStyle = {
	/** a Cloudinary-known font family; anything else is refused by the URL */
	fontFamily: string
	fontSize: number
	color: string
	/** 0 - 100; 0 leaves the text unboxed */
	boxOpacity: number
	boxColor: string
	/** distance from the bottom edge, in pixels of the source */
	bottomOffset: number
}

export const DEFAULT_CLOUD_SUBTITLE_STYLE: CloudSubtitleStyle = {
	fontFamily: 'Arial',
	fontSize: 32,
	color: '#ffffff',
	boxOpacity: 55,
	boxColor: '#000000',
	bottomOffset: 72,
}

/**
 * Cloudinary only burns in fonts it hosts itself. Offering a font the account
 * cannot resolve produces a 400 several seconds after the upload, which is the
 * worst possible moment to learn about it, so the picker is closed.
 */
export const CLOUD_SUBTITLE_FONTS = ['Arial', 'Verdana', 'Georgia', 'Impact', 'Roboto', 'Open Sans'] as const

/**
 * Burns an uploaded subtitle track into the picture.
 *
 * The track is a raw asset - an SRT or a VTT - and it is referenced the same
 * way an image overlay is, which is why this returns an overlay need rather
 * than a finished string: the caller uploads the file, then fills the
 * placeholder with `withOverlay`.
 */
export function cloudSubtitlePlan(args: {
	style?: Partial<CloudSubtitleStyle>
	output: CloudOutput
	/** trims the burn-in to a range, for a preview that costs a few seconds */
	previewSec?: number
}): CloudTransformPlan {
	const style = { ...DEFAULT_CLOUD_SUBTITLE_STYLE, ...args.style }
	const font = CLOUD_SUBTITLE_FONTS.includes(style.fontFamily as (typeof CLOUD_SUBTITLE_FONTS)[number])
		? style.fontFamily
		: DEFAULT_CLOUD_SUBTITLE_STYLE.fontFamily

	// Spaces in a font name are underscores inside a layer reference.
	const face = `${font.replace(/\s+/g, '_')}_${clamp(Math.round(style.fontSize), 8, 200)}`
	const layer = [
		`l_subtitles:${face}:%OVERLAY%`,
		`co_rgb:${hexColor(style.color, 'ffffff')}`,
	]
	if (style.boxOpacity > 0) {
		const alpha = Math.round(clamp(style.boxOpacity, 0, 100) * 2.55)
			.toString(16)
			.padStart(2, '0')
			.toUpperCase()
		layer.push(`b_rgb:${hexColor(style.boxColor, '000000')}${alpha}`)
	}
	layer.push('g_south', `y_${clamp(Math.round(style.bottomOffset), 0, 2000)}`)

	const parts: string[] = []
	if (args.previewSec && args.previewSec > 0) parts.push(`so_0,eo_${short(args.previewSec, 1)}`)
	parts.push(layer.join(','), 'fl_layer_apply', outputChain(args.output))

	return {
		transformation: parts.filter((part) => part.length > 0).join('/'),
		resourceType: 'video',
		format: args.output.format,
		label: args.previewSec ? 'Burnt-in captions (preview)' : 'Burnt-in captions',
		overlay: { slot: 'subtitle', label: 'Caption track' },
	}
}
