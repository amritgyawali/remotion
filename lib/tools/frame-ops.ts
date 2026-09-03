/**
 * Per-frame geometry and colour, shared by every visual tool.
 *
 * One pipeline draws every "touches the picture" tool - rotate, flip, crop,
 * resize, colour grade, grayscale, sepia, blur, sharpen, vignette, watermark,
 * text burn-in - because they are all the same operation underneath: crop a
 * region, rotate/flip it, scale it into the output frame, and optionally
 * stack a filter or an overlay on top. Giving each of those its own encoder
 * pass would be fifteen copies of the same four hundred lines; giving them
 * one shared `FrameOpsParams` object instead means a new one-click filter is
 * a registry entry with a couple of fields set, not a new engine.
 *
 * Nothing here touches a video track or a decoder - it is handed one frame
 * at a time by `video-filter.ts` and knows nothing about what came before or
 * after it.
 */

export type Rotate = 0 | 90 | 180 | 270
export type AnchorPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center' | 'bottom-center'

export type CropRect = { x: number; y: number; width: number; height: number }

export type WatermarkSpec = {
	image: CanvasImageSource
	/** natural size of `image`, in device pixels */
	naturalWidth: number
	naturalHeight: number
	/** fraction of the output frame's width the watermark should occupy */
	scale: number
	opacity: number
	position: AnchorPosition
	marginPx: number
}

export type TextOverlaySpec = {
	content: string
	color: string
	sizePx: number
	position: AnchorPosition
	opacity: number
	background: string | null
	marginPx: number
	weight: 400 | 600 | 800
}

export type FrameOpsParams = {
	crop?: CropRect | null
	rotate?: Rotate
	flipH?: boolean
	flipV?: boolean
	/** final output size; when only one side is given the other is derived to keep the source aspect */
	targetWidth?: number | null
	targetHeight?: number | null
	brightness?: number
	contrast?: number
	saturation?: number
	grayscale?: number
	sepia?: number
	invert?: number
	blurPx?: number
	/** 0 disables it; 1 is a normal sharpen, 2 is heavy */
	sharpenAmount?: number
	/** 0 disables it; 1 is a strong, dark-edged frame */
	vignette?: number
	watermark?: WatermarkSpec | null
	text?: TextOverlaySpec | null
	chromaKey?: ChromaKeySpec | null
	/**
	 * Whole-frame passes that own their own pixels.
	 *
	 * Everything else here is a description of what to do; these two are the
	 * thing that does it, because both are per-pixel work that belongs on the
	 * GPU (`background-replace.ts` and `tone-renderer.ts` each hold a shader and
	 * its textures) and neither can be expressed as canvas state. They run in
	 * this order - the new backdrop is in place before the grade sees the
	 * frame, so the subject and the background are graded as one picture.
	 */
	backgroundPass?: FramePass | null
	tonePass?: FramePass | null
	/**
	 * Stacked onto the finished picture, after the grade and after the vignette,
	 * the way a watermark is - because that is what it is. The chroma-key
	 * overlay lives here rather than in `watermark` because it has to key its
	 * own source per frame and place the result itself.
	 */
	overlayPass?: FramePass | null
	/**
	 * Paints the frame's backdrop *before* the picture is drawn onto it.
	 *
	 * Every other pass here repaints a finished frame; this one owns what is
	 * underneath it, which is the only way a blurred-canvas reframe can work -
	 * the backdrop has to exist before the letterboxed picture lands on top of
	 * it. A pass that runs here takes over from `padColor`: it is handed a
	 * frame-sized context and is expected to cover it, because nothing else
	 * clears the canvas between frames.
	 */
	underlayPass?: FramePass | null
	/**
	 * Whole-frame passes, in order, run after the grade and before the
	 * sharpen/vignette finish.
	 *
	 * The three named slots above each exist because something has to happen at
	 * one specific point in the pipeline. This is the general case: the
	 * adjustment desk, the effects rack, shape masks, retouch, restoration,
	 * borders and titles are all "repaint the finished frame", they compose in
	 * whatever order the caller lists them, and giving each of them a named
	 * field of its own would be eight fields that only ever hold one value.
	 */
	passes?: FramePass[] | null
	/**
	 * A per-frame affine move of the picture inside its own frame.
	 *
	 * This is the seam every "the camera moves" tool hangs off - Ken Burns
	 * zooms, pans, spins, shakes, bounces and drifts are all the same three
	 * numbers changing over time, so they share one implementation and one
	 * place to get the sampling right. It is applied while the picture is
	 * still being scaled out of the native-resolution crop, so a zoom-in reads
	 * real source detail rather than magnifying an already-downscaled frame.
	 */
	transform?: FrameTransform | null
	/** `contain` letterboxes/pillarboxes onto `padColor` instead of stretching to fill */
	fit?: 'fill' | 'contain'
	padColor?: string
}

export type FrameTransform = {
	/** 1 leaves the framing alone; 1.2 is a 20% push in */
	scale: number
	/** clockwise, in degrees, about the centre of the frame */
	rotateDeg: number
	/** fraction of the output width/height to slide by, after the zoom */
	offsetX: number
	offsetY: number
	/** 0-1; anything below 1 lets `padColor` show through */
	opacity?: number
}

export type FramePass = {
	apply(ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D, width: number, height: number, frameIndex: number): void
}

export type ChromaKeyBackground =
	| { kind: 'color'; color: string }
	| { kind: 'image'; image: CanvasImageSource; naturalWidth: number; naturalHeight: number }

export type ChromaKeySpec = {
	keyColor: { r: number; g: number; b: number }
	/** 0-1: how far a pixel's colour may drift from `keyColor` and still count as background */
	tolerance: number
	/** 0-1: width of the soft edge between "kept" and "keyed out" */
	smoothing: number
	background: ChromaKeyBackground
}

export function evenSize(value: number): number {
	const rounded = Math.max(2, Math.round(value))
	return rounded % 2 === 0 ? rounded : rounded + 1
}

/**
 * The largest even frame size that fits inside `maxDimension` on its long side.
 *
 * Only ever shrinks - asking for a bigger box than the picture leaves the
 * picture alone - and always lands on even numbers, because H.264 and HEVC
 * refuse odd ones. It is the single place a "render this smaller" request
 * becomes pixels, so the size the object layer is composited against and the
 * size the encoder is handed can never disagree.
 */
export function fitWithin(
	width: number,
	height: number,
	maxDimension: number,
): { width: number; height: number } {
	const w = Math.max(1, width)
	const h = Math.max(1, height)
	const longest = Math.max(w, h)
	const scale = Number.isFinite(maxDimension) && maxDimension > 0 ? Math.min(1, maxDimension / longest) : 1
	return { width: evenSize(w * scale), height: evenSize(h * scale) }
}

export type FrameOpsDims = {
	width: number
	height: number
	crop: CropRect
	/** the crop's bounding box after rotation, before the final scale to `width`/`height` */
	rotatedWidth: number
	rotatedHeight: number
}

/** Works out the final output size and the effective crop, once, from the source dimensions. */
export function computeFrameDims(sourceWidth: number, sourceHeight: number, params: FrameOpsParams): FrameOpsDims {
	const crop = params.crop ?? { x: 0, y: 0, width: sourceWidth, height: sourceHeight }
	const rotate = params.rotate ?? 0
	const rotatedWidth = rotate === 90 || rotate === 270 ? crop.height : crop.width
	const rotatedHeight = rotate === 90 || rotate === 270 ? crop.width : crop.height

	let width = params.targetWidth ?? rotatedWidth
	let height = params.targetHeight ?? rotatedHeight
	if (params.targetWidth && !params.targetHeight) {
		height = Math.round(params.targetWidth * (rotatedHeight / rotatedWidth))
	} else if (!params.targetWidth && params.targetHeight) {
		width = Math.round(params.targetHeight * (rotatedWidth / rotatedHeight))
	}

	return {
		width: evenSize(width),
		height: evenSize(height),
		crop,
		rotatedWidth,
		rotatedHeight,
	}
}

/** Centred crop for a target aspect ratio, e.g. 9:16 for a vertical short. */
export function centeredAspectCrop(sourceWidth: number, sourceHeight: number, aspectW: number, aspectH: number): CropRect {
	const sourceAspect = sourceWidth / sourceHeight
	const targetAspect = aspectW / aspectH
	if (sourceAspect > targetAspect) {
		const width = Math.round(sourceHeight * targetAspect)
		return { x: Math.round((sourceWidth - width) / 2), y: 0, width, height: sourceHeight }
	}
	const height = Math.round(sourceWidth / targetAspect)
	return { x: 0, y: Math.round((sourceHeight - height) / 2), width: sourceWidth, height }
}

function buildCssFilter(params: FrameOpsParams): string {
	const parts: string[] = []
	if (params.brightness !== undefined && params.brightness !== 1) parts.push(`brightness(${params.brightness})`)
	if (params.contrast !== undefined && params.contrast !== 1) parts.push(`contrast(${params.contrast})`)
	if (params.saturation !== undefined && params.saturation !== 1) parts.push(`saturate(${params.saturation})`)
	if (params.grayscale) parts.push(`grayscale(${params.grayscale})`)
	if (params.sepia) parts.push(`sepia(${params.sepia})`)
	if (params.invert) parts.push(`invert(${params.invert})`)
	if (params.blurPx) parts.push(`blur(${params.blurPx}px)`)
	return parts.join(' ')
}

type Ctx2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D

/**
 * A 3x3 unsharp-style kernel, blended against the original by `amount`.
 *
 * This runs on the CPU, once per frame, so it is the one step here that
 * genuinely costs something on a large frame - which is why it is opt-in
 * rather than always on, and why the UI says so.
 */
function applySharpen(ctx: Ctx2D, width: number, height: number, amount: number): void {
	const image = ctx.getImageData(0, 0, width, height)
	const src = image.data
	const out = new Uint8ClampedArray(src.length)
	const center = 1 + 4 * amount
	const edge = -amount

	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const index = (y * width + x) * 4
			for (let channel = 0; channel < 3; channel++) {
				const c = src[index + channel]
				const up = y > 0 ? src[index - width * 4 + channel] : c
				const down = y < height - 1 ? src[index + width * 4 + channel] : c
				const left = x > 0 ? src[index - 4 + channel] : c
				const right = x < width - 1 ? src[index + 4 + channel] : c
				out[index + channel] = c * center + edge * (up + down + left + right)
			}
			out[index + 3] = src[index + 3]
		}
	}
	image.data.set(out)
	ctx.putImageData(image, 0, 0)
}

function drawVignette(ctx: Ctx2D, width: number, height: number, strength: number): void {
	const gradient = ctx.createRadialGradient(
		width / 2,
		height / 2,
		Math.min(width, height) * 0.35,
		width / 2,
		height / 2,
		Math.max(width, height) * 0.72,
	)
	gradient.addColorStop(0, 'rgba(0,0,0,0)')
	gradient.addColorStop(1, `rgba(0,0,0,${Math.min(1, strength)})`)
	ctx.save()
	ctx.globalCompositeOperation = 'multiply'
	ctx.fillStyle = gradient
	ctx.fillRect(0, 0, width, height)
	ctx.restore()
}

export function anchorPoint(
	position: AnchorPosition,
	frameWidth: number,
	frameHeight: number,
	boxWidth: number,
	boxHeight: number,
	margin: number,
): { x: number; y: number } {
	switch (position) {
		case 'top-left':
			return { x: margin, y: margin }
		case 'top-right':
			return { x: frameWidth - boxWidth - margin, y: margin }
		case 'bottom-left':
			return { x: margin, y: frameHeight - boxHeight - margin }
		case 'bottom-right':
			return { x: frameWidth - boxWidth - margin, y: frameHeight - boxHeight - margin }
		case 'bottom-center':
			return { x: (frameWidth - boxWidth) / 2, y: frameHeight - boxHeight - margin }
		case 'center':
		default:
			return { x: (frameWidth - boxWidth) / 2, y: (frameHeight - boxHeight) / 2 }
	}
}

function drawWatermark(ctx: Ctx2D, width: number, height: number, spec: WatermarkSpec): void {
	const boxWidth = width * spec.scale
	const boxHeight = boxWidth * (spec.naturalHeight / spec.naturalWidth)
	const { x, y } = anchorPoint(spec.position, width, height, boxWidth, boxHeight, spec.marginPx)
	ctx.save()
	ctx.globalAlpha = spec.opacity
	ctx.drawImage(spec.image, x, y, boxWidth, boxHeight)
	ctx.restore()
}

function drawText(ctx: Ctx2D, width: number, height: number, spec: TextOverlaySpec): void {
	ctx.save()
	ctx.font = `${spec.weight} ${spec.sizePx}px var(--sans), Inter, sans-serif`
	// Canvas doesn't resolve CSS variables; fall back to a real family list.
	ctx.font = `${spec.weight} ${spec.sizePx}px Inter, "Segoe UI", sans-serif`
	const metrics = ctx.measureText(spec.content)
	const textWidth = metrics.width
	const textHeight = spec.sizePx * 1.25
	const padding = spec.sizePx * 0.4
	const boxWidth = textWidth + padding * 2
	const boxHeight = textHeight + padding
	const { x, y } = anchorPoint(spec.position, width, height, boxWidth, boxHeight, spec.marginPx)

	ctx.globalAlpha = spec.opacity
	if (spec.background) {
		ctx.fillStyle = spec.background
		const radius = Math.min(10, boxHeight / 3)
		ctx.beginPath()
		ctx.roundRect(x, y, boxWidth, boxHeight, radius)
		ctx.fill()
	}
	ctx.fillStyle = spec.color
	ctx.textBaseline = 'middle'
	ctx.fillText(spec.content, x + padding, y + boxHeight / 2)
	ctx.restore()
}

/**
 * Replaces a solid backdrop with a colour or an image.
 *
 * `getImageData`/`putImageData` write raw pixels and never blend against
 * what's already on the canvas, so the alpha this computes has to be
 * composited by hand: the keyed foreground is built on its own canvas first,
 * the background is painted onto `destCtx`, and only then is the foreground
 * drawn on top with `drawImage`, which *does* respect alpha.
 */
function applyChromaKey(destCtx: Ctx2D, width: number, height: number, spec: ChromaKeySpec): void {
	const foreground = destCtx.getImageData(0, 0, width, height)
	const data = foreground.data
	const { r: kr, g: kg, b: kb } = spec.keyColor
	const inner = Math.max(0, spec.tolerance - spec.smoothing)
	const outer = Math.max(inner + 0.0001, spec.tolerance)
	// The largest possible RGB distance (black to white) - used to normalise
	// distance into the same 0-1 range `tolerance` and `smoothing` are in.
	const maxDistance = Math.sqrt(3 * 255 * 255)

	for (let i = 0; i < data.length; i += 4) {
		const dr = data[i] - kr
		const dg = data[i + 1] - kg
		const db = data[i + 2] - kb
		const distance = Math.sqrt(dr * dr + dg * dg + db * db) / maxDistance
		if (distance <= inner) data[i + 3] = 0
		else if (distance >= outer) data[i + 3] = 255
		else data[i + 3] = Math.round((255 * (distance - inner)) / (outer - inner))
	}

	const foregroundCanvas = new OffscreenCanvas(width, height)
	const foregroundCtx = foregroundCanvas.getContext('2d') as OffscreenCanvasRenderingContext2D
	foregroundCtx.putImageData(foreground, 0, 0)

	destCtx.save()
	destCtx.clearRect(0, 0, width, height)
	if (spec.background.kind === 'color') {
		destCtx.fillStyle = spec.background.color
		destCtx.fillRect(0, 0, width, height)
	} else {
		const { image, naturalWidth, naturalHeight } = spec.background
		const scale = Math.max(width / naturalWidth, height / naturalHeight)
		const drawWidth = naturalWidth * scale
		const drawHeight = naturalHeight * scale
		destCtx.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight)
	}
	destCtx.drawImage(foregroundCanvas, 0, 0)
	destCtx.restore()
}

/**
 * Renders one source frame into `destCtx`, which must already be sized to
 * `dims.width` x `dims.height`.
 *
 * Crop and rotation happen on an intermediate canvas at native resolution
 * first; the result is then scaled once into the destination, which is what
 * keeps a rotated, cropped, resized frame from being resampled twice.
 *
 * `cropOffset` shifts the crop's *position* (not its size) for this one
 * frame without touching `dims` - the hook video stabilisation uses to nudge
 * each frame back onto a smoothed camera path while every other tool leaves
 * it at its default of no shift at all.
 */
export function drawFrame(
	destCtx: Ctx2D,
	drawSource: (ctx: Ctx2D, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number) => void,
	params: FrameOpsParams,
	dims: FrameOpsDims,
	cropOffset: { dx: number; dy: number } = { dx: 0, dy: 0 },
	frameIndex = 0,
): void {
	const rotate = params.rotate ?? 0
	const crop = { x: dims.crop.x + cropOffset.dx, y: dims.crop.y + cropOffset.dy, width: dims.crop.width, height: dims.crop.height }
	const rotationCanvas = new OffscreenCanvas(dims.rotatedWidth, dims.rotatedHeight)
	const rotationCtx = rotationCanvas.getContext('2d') as OffscreenCanvasRenderingContext2D
	rotationCtx.save()
	rotationCtx.translate(dims.rotatedWidth / 2, dims.rotatedHeight / 2)
	if (rotate) rotationCtx.rotate((rotate * Math.PI) / 180)
	drawSource(rotationCtx, crop.x, crop.y, crop.width, crop.height, -crop.width / 2, -crop.height / 2, crop.width, crop.height)
	rotationCtx.restore()

	const contain = params.fit === 'contain'
	const transform = params.transform ?? null
	// A moved or shrunk picture no longer covers the canvas, and the canvas is
	// reused frame after frame - without a fill, last frame's edges stay behind
	// as a smear. The underlay pass, when there is one, is that fill.
	const needsGround = contain || transform !== null
	destCtx.save()
	if (params.underlayPass) {
		destCtx.filter = 'none'
		params.underlayPass.apply(destCtx, dims.width, dims.height, frameIndex)
	} else if (needsGround) {
		destCtx.filter = 'none'
		destCtx.fillStyle = params.padColor ?? '#000000'
		destCtx.fillRect(0, 0, dims.width, dims.height)
	}
	const filter = buildCssFilter(params)
	destCtx.filter = filter || 'none'
	destCtx.translate(dims.width / 2, dims.height / 2)
	if (transform) {
		destCtx.globalAlpha = transform.opacity ?? 1
		destCtx.translate(transform.offsetX * dims.width, transform.offsetY * dims.height)
		if (transform.rotateDeg) destCtx.rotate((transform.rotateDeg * Math.PI) / 180)
		const zoom = transform.scale > 0 ? transform.scale : 1
		if (zoom !== 1) destCtx.scale(zoom, zoom)
	}
	destCtx.scale(params.flipH ? -1 : 1, params.flipV ? -1 : 1)
	if (contain) {
		const scale = Math.min(dims.width / dims.rotatedWidth, dims.height / dims.rotatedHeight)
		const drawWidth = dims.rotatedWidth * scale
		const drawHeight = dims.rotatedHeight * scale
		destCtx.drawImage(rotationCanvas, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight)
	} else {
		destCtx.drawImage(rotationCanvas, -dims.width / 2, -dims.height / 2, dims.width, dims.height)
	}
	destCtx.restore()
	destCtx.filter = 'none'

	if (params.chromaKey) applyChromaKey(destCtx, dims.width, dims.height, params.chromaKey)
	if (params.backgroundPass) params.backgroundPass.apply(destCtx, dims.width, dims.height, frameIndex)
	if (params.tonePass) params.tonePass.apply(destCtx, dims.width, dims.height, frameIndex)
	if (params.passes) {
		for (const pass of params.passes) pass.apply(destCtx, dims.width, dims.height, frameIndex)
	}
	if (params.sharpenAmount) applySharpen(destCtx, dims.width, dims.height, params.sharpenAmount)
	if (params.vignette) drawVignette(destCtx, dims.width, dims.height, params.vignette)
	if (params.overlayPass) params.overlayPass.apply(destCtx, dims.width, dims.height, frameIndex)
	if (params.watermark) drawWatermark(destCtx, dims.width, dims.height, params.watermark)
	if (params.text) drawText(destCtx, dims.width, dims.height, params.text)
}
