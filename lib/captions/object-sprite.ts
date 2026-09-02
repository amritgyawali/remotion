'use client'

/**
 * Turning a shot into pixels, once, and placing it every frame.
 *
 * Two jobs live here because they have to agree exactly: whatever rasterises
 * the picture decides how sharp it is, and whatever places it decides where it
 * is. The still preview in the panel and the bake that writes the finished
 * video both call `objectRequestFor`, so what a user tunes with a slider is
 * literally the code that renders - there is no second implementation to
 * drift.
 *
 * The one thing worth explaining is the rasterisation size. The pack's objects
 * are SVGs with a 512 viewBox; drawing one into a 1080p frame at 40% height
 * means 432 pixels tall, and rasterising at 512 then scaling down is fine.
 * Rasterise at 512 and scale *up* - a 4K frame, or a big object - and the
 * result is a blurred SVG, which is the one thing vectors are supposed to make
 * impossible. So the sprite is rendered at the size it will actually occupy,
 * plus a little headroom for the motion that grows it, and capped so a silly
 * scale cannot allocate a gigabyte.
 */

import { shotFade, type ObjectMotion, type ObjectShot } from './object-plan'
import { placeObject, type HeadAnchor, type ObjectSizeMode, type SafeArea } from './object-anchor'
import type { ObjectPlacementRequest } from './object-compositor'

type Ctx2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D

export type ObjectSprite = {
	/** the still picture, or the current frame of a turning model */
	source: CanvasImageSource
	width: number
	height: number
	/**
	 * Redraws a model at this time and returns its canvas. Still pictures do
	 * not define it, which is what tells the renderer there is nothing to do.
	 */
	frameAt?: (seconds: number) => CanvasImageSource
	dispose(): void
}

/** Beyond this the sprite is scaled up rather than rendered bigger. */
const MAX_SPRITE_PIXELS = 2_048

/** Extra resolution so `pulse` and `pop` can grow the sprite without softening it. */
const MOTION_HEADROOM = 1.2

function makeCanvas(width: number, height: number): { canvas: OffscreenCanvas | HTMLCanvasElement; ctx: Ctx2D } {
	if (typeof OffscreenCanvas !== 'undefined') {
		const canvas = new OffscreenCanvas(width, height)
		const ctx = canvas.getContext('2d')
		if (!ctx) throw new Error('This browser has no 2D canvas context to rasterise the object with.')
		return { canvas, ctx }
	}
	const canvas = document.createElement('canvas')
	canvas.width = width
	canvas.height = height
	const ctx = canvas.getContext('2d')
	if (!ctx) throw new Error('This browser has no 2D canvas context to rasterise the object with.')
	return { canvas, ctx }
}

async function loadImage(src: string): Promise<HTMLImageElement> {
	const image = new Image()
	image.crossOrigin = 'anonymous'
	image.decoding = 'async'
	image.src = src
	// decode() rejects with a useless "encoding error" on a 404, so the address
	// is put back into the message - a missing pack file is the likely cause.
	await image.decode().catch(() => {
		throw new Error(`"${src}" could not be read as an image.`)
	})
	return image
}

export type LoadSpriteArgs = {
	/** the output frame's height in pixels, which sets the rasterisation size */
	frameHeight: number
	signal?: AbortSignal
	/** resolves an upload's vault id to something drawable, when the shot has one */
	resolveBlob?: (blobId: string) => Promise<Blob | null>
}

/**
 * Rasterises one shot's picture at the size it will be drawn.
 *
 * A `model3d` shot is handed to the three.js turntable, which is imported only
 * when a plan actually contains one - it is by far the largest chunk in the
 * studio and no flat object needs it.
 */
export async function loadObjectSprite(shot: ObjectShot, args: LoadSpriteArgs): Promise<ObjectSprite> {
	const target = Math.min(
		MAX_SPRITE_PIXELS,
		Math.max(64, Math.round(args.frameHeight * shot.scale * MOTION_HEADROOM)),
	)

	if (shot.kind === 'model3d') {
		const { createModelSprite } = await import('./object-3d')
		return createModelSprite({ assetId: shot.assetId ?? '', size: target, signal: args.signal })
	}

	let src = shot.src
	// An upload and a picture fetched from the web are the same thing by the
	// time they get here: bytes in the vault under this shot's own id.
	if ((shot.kind === 'upload' || shot.kind === 'web') && shot.blobId && args.resolveBlob) {
		// An object URL dies with the tab that made it, so a restored plan
		// rebuilds one from the bytes in the vault rather than trusting `src`.
		const blob = await args.resolveBlob(shot.blobId)
		if (blob) src = URL.createObjectURL(blob)
	}
	if (!src) throw new Error(`"${shot.label}" has no picture to draw. Choose one, or remove the shot.`)

	const image = await loadImage(src)
	const revoke = src !== shot.src && src.startsWith('blob:') ? src : null

	const naturalWidth = image.naturalWidth || 512
	const naturalHeight = image.naturalHeight || 512
	const aspect = naturalWidth / naturalHeight
	const height = target
	const width = Math.max(2, Math.round(height * aspect))

	const { canvas, ctx } = makeCanvas(width, height)
	ctx.clearRect(0, 0, width, height)
	ctx.drawImage(image, 0, 0, width, height)
	if (revoke) URL.revokeObjectURL(revoke)

	return {
		source: canvas,
		width,
		height,
		dispose() {
			/* a canvas is collected on its own; nothing to release */
		},
	}
}

/* ==========================================================================
   Motion.
   ========================================================================== */

export type MotionState = {
	/** radians */
	rotation: number
	/** multiplier on the drawn size */
	scale: number
	/** pixel nudges, as fractions of the drawn height */
	driftX: number
	driftY: number
}

/**
 * Where the object is within its own idle animation.
 *
 * Everything is a function of `elapsedMs` alone - no accumulated state, no
 * random - so frame N of a re-bake is frame N of the first one, and the still
 * preview at 3.2s matches the video at 3.2s.
 */
export function motionAt(motion: ObjectMotion, elapsedMs: number): MotionState {
	const seconds = elapsedMs / 1000
	switch (motion) {
		case 'float':
			return { rotation: 0, scale: 1, driftX: 0, driftY: Math.sin(seconds * 1.6) * 0.035 }
		case 'spin':
			// A slow full turn. Faster than about eight seconds a rotation and a
			// flat sprite reads as a spinning sticker rather than a solid object.
			return { rotation: (seconds / 8) * Math.PI * 2, scale: 1, driftX: 0, driftY: 0 }
		case 'sway':
			return {
				rotation: Math.sin(seconds * 1.1) * 0.09,
				scale: 1,
				driftX: Math.sin(seconds * 0.7) * 0.03,
				driftY: 0,
			}
		case 'pulse':
			return { rotation: 0, scale: 1 + Math.sin(seconds * 2.4) * 0.045, driftX: 0, driftY: 0 }
		default:
			return { rotation: 0, scale: 1, driftX: 0, driftY: 0 }
	}
}

/* ==========================================================================
   Drawing.
   ========================================================================== */

export type ObjectRequestArgs = {
	sprite: ObjectSprite
	shot: ObjectShot
	anchor: HeadAnchor
	/** where we are in the clip */
	ms: number
	frameWidth: number
	frameHeight: number
	entranceMs: number
	followHead: boolean
	sizeMode?: ObjectSizeMode
	safeArea?: SafeArea
}

/**
 * Works out where one shot's object goes on this frame, or nothing.
 *
 * This returns a request rather than drawing, because the drawing is the
 * compositor's job and it needs the rectangle *before* it starts: knowing
 * where the object lands is what lets it touch a tenth of the frame instead of
 * all of it. Null means there is nothing on screen - outside the shot, or
 * fully faded - and the caller can then skip the frame entirely.
 */
export function objectRequestFor(args: ObjectRequestArgs): ObjectPlacementRequest | null {
	const { shot, sprite, ms } = args
	const fade = shotFade(shot, ms, args.entranceMs)
	if (fade <= 0.002) return null

	const elapsed = ms - shot.startMs
	const motion = motionAt(shot.motion, elapsed)
	const source = sprite.frameAt ? sprite.frameAt(elapsed / 1000) : sprite.source

	const placement = placeObject({
		anchor: args.anchor,
		frameWidth: args.frameWidth,
		frameHeight: args.frameHeight,
		spriteWidth: sprite.width,
		spriteHeight: sprite.height,
		scale: shot.scale,
		offsetX: shot.offsetX,
		offsetY: shot.offsetY,
		followHead: args.followHead,
		sizeMode: args.sizeMode,
		safeArea: args.safeArea,
	})

	// The entrance grows the object as well as fading it: a sprite that only
	// fades looks painted onto the frame, one that also arrives looks placed
	// behind the speaker.
	const entrance = 0.9 + fade * 0.1

	return {
		sprite: source,
		centerX: placement.centerX + motion.driftX * placement.height,
		centerY: placement.centerY + motion.driftY * placement.height,
		width: placement.width * motion.scale * entrance,
		height: placement.height * motion.scale * entrance,
		rotation: motion.rotation,
		alpha: Math.max(0, Math.min(1, shot.opacity * fade)),
	}
}
