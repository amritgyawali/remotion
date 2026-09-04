'use client'

/**
 * Finding the person in the frame.
 *
 * This is the studio's one genuinely learned model outside the subtitle
 * studio: MediaPipe's image segmenter, running on WebAssembly in the tab, with
 * no frame ever leaving the machine. Given a frame it returns a per-pixel
 * confidence that the pixel is a person rather than the room behind them, and
 * `background-replace.ts` turns that into an alpha channel.
 *
 * Three things here are worth more than the API calls around them.
 *
 * Which mask means "person" is decided from the model's own labels, not
 * assumed. The two models this offers disagree completely: the fast one
 * publishes a single mask labelled `selfie` that is already the subject's
 * confidence, while the precise one publishes six - background, hair, body
 * skin, face skin, clothes, others - where the subject is everything the
 * first one is not. Reading either the way the other wants produces a
 * perfectly plausible, perfectly inverted matte, which is why
 * `resolveSubjectChannel` is a named, testable function rather than an index
 * picked in passing.
 *
 * The model is fetched once and kept. A 16MB download that happens every time
 * a tool is opened is not a feature; it lands in the same IndexedDB vault the
 * studio already keeps uploads in, so the second run starts instantly and an
 * offline tab still works.
 *
 * And the mask is smoothed over time. A per-frame segmenter is independent
 * frame to frame, so a still subject still gets an edge that wobbles by a
 * pixel or two every frame - which reads as a shimmering halo in motion, and
 * is the single biggest giveaway of a software background. An exponential
 * blend against the previous frame's mask costs one pass over 65k floats and
 * removes almost all of it.
 */

import { readBlob, writeBlob } from '../persist/idb'
import { memoryBudget } from '../media/memory-budget'

export type SegmentationModelId = 'balanced' | 'precise'

export type SegmentationModel = {
	id: SegmentationModelId
	label: string
	description: string
	/** where the vendored copy lives, if `npm run assets:segmentation` has run */
	localPath: string
	/** Google's public model bucket, used when the vendored copy is missing */
	remoteUrl: string
	approximateBytes: number
}

export const SEGMENTATION_MODELS: SegmentationModel[] = [
	{
		id: 'balanced',
		label: 'Balanced - fast',
		description: 'A 0.25 MB portrait model. Real-time, and right for a head-and-shoulders shot.',
		localPath: '/models/segmentation/selfie_segmenter.tflite',
		remoteUrl: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite',
		approximateBytes: 249_537,
	},
	{
		id: 'precise',
		label: 'Precise - slower',
		description: 'A 16 MB six-class model. Much better on hair, hands and loose clothing.',
		localPath: '/models/segmentation/selfie_multiclass_256x256.tflite',
		remoteUrl:
			'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/1/selfie_multiclass_256x256.tflite',
		approximateBytes: 16_371_837,
	},
]

export function segmentationModelById(id: string): SegmentationModel {
	return SEGMENTATION_MODELS.find((model) => model.id === id) ?? SEGMENTATION_MODELS[0]
}

/** Where the WebAssembly runtime is vendored to by `scripts/fetch-segmentation-assets.mjs`. */
const LOCAL_WASM_PATH = '/mediapipe/wasm'
const CDN_WASM_PATH = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm'

const modelCacheKey = (model: SegmentationModel): string => `segmentation:model:${model.id}`

export class SegmentationUnavailableError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'SegmentationUnavailableError'
	}
}

export type SegmentationProgress = { phase: 'model' | 'runtime' | 'ready'; ratio: number; note?: string }

export type SubjectChannel = {
	/** which confidence mask to read */
	index: number
	/** true when that mask is the background, so the subject is one minus it */
	invert: boolean
}

/**
 * Works out which of a segmenter's confidence masks describes the subject,
 * from the labels the model publishes about itself.
 *
 * A class actually called "background" is the reliable signal, and inverting
 * it is better than adding up the other five: it keeps hair, hands and
 * clothing in the matte without naming any of them, and it stays correct if a
 * future model adds a class. Failing that, a model with a single mask is
 * publishing the subject directly - that is what the portrait model's
 * `selfie` mask is. Only a multi-mask model with no background label is a
 * guess, and the convention there has always been that class zero is the
 * background.
 */
export function resolveSubjectChannel(labels: string[]): SubjectChannel {
	const normalised = labels.map((label) => label.toLowerCase())
	const backgroundIndex = normalised.findIndex((label) => label.includes('background'))
	if (backgroundIndex >= 0) return { index: backgroundIndex, invert: true }
	if (normalised.length <= 1) return { index: 0, invert: false }
	return { index: 0, invert: true }
}

/**
 * Fetches the model bytes, preferring - in order - the copy already in this
 * browser's vault, the copy vendored into `public/`, and finally Google's
 * bucket. Whatever arrives is written back to the vault.
 */
async function loadModelBytes(
	model: SegmentationModel,
	signal: AbortSignal,
	onProgress?: (progress: SegmentationProgress) => void,
): Promise<Uint8Array> {
	const cached = await readBlob(modelCacheKey(model))
	if (cached && cached.size > 1024) {
		onProgress?.({ phase: 'model', ratio: 1, note: 'already downloaded' })
		return new Uint8Array(await cached.blob.arrayBuffer())
	}

	const sources = [model.localPath, model.remoteUrl]
	let lastError: unknown = null

	for (const url of sources) {
		try {
			const response = await fetch(url, { signal, cache: 'force-cache' })
			if (!response.ok) {
				lastError = new Error(`${url} responded ${response.status}`)
				continue
			}

			// The remote copy is tens of megabytes on a slow line, so the bytes are
			// counted as they arrive rather than after the fact.
			const declared = Number(response.headers.get('content-length')) || model.approximateBytes
			const reader = response.body?.getReader()
			let bytes: Uint8Array
			if (reader) {
				const chunks: Uint8Array[] = []
				let received = 0
				for (;;) {
					const { done, value } = await reader.read()
					if (done) break
					if (value) {
						chunks.push(value)
						received += value.byteLength
						onProgress?.({ phase: 'model', ratio: Math.min(0.99, received / declared) })
					}
				}
				bytes = new Uint8Array(received)
				let offset = 0
				for (const chunk of chunks) {
					bytes.set(chunk, offset)
					offset += chunk.byteLength
				}
			} else {
				bytes = new Uint8Array(await response.arrayBuffer())
			}

			if (bytes.byteLength < 1024) {
				lastError = new Error(`${url} returned ${bytes.byteLength} bytes`)
				continue
			}

			void writeBlob(modelCacheKey(model), new Blob([bytes as unknown as BlobPart]), `${model.id}.tflite`)
			onProgress?.({ phase: 'model', ratio: 1 })
			return bytes
		} catch (error) {
			if (signal.aborted) throw error
			lastError = error
		}
	}

	throw new SegmentationUnavailableError(
		`The person-detection model could not be downloaded. ${
			lastError instanceof Error ? lastError.message : 'No source responded.'
		} Check the connection and try again - it is only downloaded once.`,
	)
}

type VisionModule = typeof import('@mediapipe/tasks-vision')

let visionModule: Promise<VisionModule> | null = null

async function loadVision(): Promise<VisionModule> {
	visionModule ??= import('@mediapipe/tasks-vision').catch((error) => {
		visionModule = null
		throw new SegmentationUnavailableError(
			`The on-device vision runtime failed to load: ${error instanceof Error ? error.message : String(error)}`,
		)
	})
	return visionModule
}

/** True when the vendored runtime is actually on disk, so we can skip the CDN. */
async function resolveWasmPath(signal: AbortSignal): Promise<string> {
	try {
		const response = await fetch(`${LOCAL_WASM_PATH}/vision_wasm_internal.js`, { method: 'HEAD', signal })
		if (response.ok) return LOCAL_WASM_PATH
	} catch {
		/* fall through to the CDN */
	}
	return CDN_WASM_PATH
}

export type PersonMask = {
	/** single-channel confidence, 0 background to 1 subject, row-major */
	data: Float32Array
	width: number
	height: number
	/** the same values written into a canvas, ready to be a texture */
	canvas: OffscreenCanvas
}

export type PersonSegmenter = {
	/** Runs the model on one frame. `timestampMs` must not go backwards. */
	segment(frame: TexImageSource, timestampMs: number): PersonMask
	/** 0 disables temporal smoothing, 1 freezes the first mask forever. */
	setSmoothing(amount: number): void
	close(): void
}

export type CreateSegmenterOptions = {
	modelId: SegmentationModelId
	signal: AbortSignal
	/** 0-1; how much of the previous frame's mask is kept */
	smoothing?: number
	onProgress?: (progress: SegmentationProgress) => void
}

/**
 * Loads the runtime and the model, and hands back something that turns frames
 * into mattes. Everything expensive happens here, once.
 */
export async function createPersonSegmenter(options: CreateSegmenterOptions): Promise<PersonSegmenter> {
	const model = segmentationModelById(options.modelId)
	const { signal } = options

	const [vision, modelBytes] = await Promise.all([loadVision(), loadModelBytes(model, signal, options.onProgress)])
	if (signal.aborted) throw new DOMException('Aborted', 'AbortError')

	options.onProgress?.({ phase: 'runtime', ratio: 0.2 })
	const wasmPath = await resolveWasmPath(signal)
	const fileset = await vision.FilesetResolver.forVisionTasks(wasmPath)
	if (signal.aborted) throw new DOMException('Aborted', 'AbortError')

	options.onProgress?.({ phase: 'runtime', ratio: 0.7 })

	/**
	 * Which processor to ask for first.
	 *
	 * The GPU delegate is the faster one and stays the default. But on a small
	 * machine the graphics memory it wants is the same pool the video decoder
	 * and the compositor are already drawing from - it is not spare capacity,
	 * it is the capacity that is about to run out - and a bake that finishes
	 * slowly beats one that takes the tab, or the machine, down with it. So a
	 * machine that reports four gigabytes or less is given the processor first
	 * and the graphics card as the fallback, which is the same pair of attempts
	 * in the other order.
	 */
	const budget = memoryBudget()
	const order: Array<'GPU' | 'CPU'> = budget.preferCpuSegmentation ? ['CPU', 'GPU'] : ['GPU', 'CPU']

	const open = (delegate: 'GPU' | 'CPU') =>
		vision.ImageSegmenter.createFromOptions(fileset, {
			baseOptions: { modelAssetBuffer: modelBytes, delegate },
			runningMode: 'VIDEO',
			outputConfidenceMasks: true,
			outputCategoryMask: false,
		})

	const segmenter = await open(order[0]).catch(async (error) => {
		// A machine that cannot give MediaPipe a context of the first kind still
		// runs the model on the other, correctly, and usually several times
		// slower - which is the whole reason the first choice is not fixed.
		console.warn(`[segmentation] ${order[0]} delegate unavailable, falling back to ${order[1]}:`, error)
		return open(order[1])
	})

	const subject = resolveSubjectChannel(segmenter.getLabels())

	options.onProgress?.({ phase: 'ready', ratio: 1 })

	let smoothing = Math.min(0.95, Math.max(0, options.smoothing ?? 0.6))

	/**
	 * Two mask buffers, used alternately, instead of one per frame.
	 *
	 * The smoothed mask has to outlive the call that produced it: the caller
	 * holds it as `lastMask` and may hand the very same array back to the
	 * compositor for several frames while the picture is still. So the buffer
	 * cannot simply be overwritten in place - but it does not need a fresh
	 * allocation either. Two are enough. While one is being written the other
	 * is both the previous frame's mask and the one the caller is still
	 * reading, and by the time the pair swaps back the caller has moved on.
	 *
	 * At the precise model's 256x256 that is 256 KB per frame that is no longer
	 * allocated and collected - around a third of a gigabyte of churn over a
	 * two minute bake, on the machine least able to afford it.
	 */
	const pool: [Float32Array | null, Float32Array | null] = [null, null]
	let slot = 0
	let previous: Float32Array | null = null

	let maskCanvas: OffscreenCanvas | null = null
	let maskCtx: OffscreenCanvasRenderingContext2D | null = null
	let maskImage: ImageData | null = null
	let lastTimestamp = -1

	return {
		setSmoothing(amount) {
			smoothing = Math.min(0.95, Math.max(0, amount))
		},
		segment(frame, timestampMs) {
			// MediaPipe's video mode rejects a timestamp that does not advance,
			// and a clip with duplicate frame times would otherwise throw.
			const timestamp = timestampMs <= lastTimestamp ? lastTimestamp + 1 : Math.round(timestampMs)
			lastTimestamp = timestamp

			const result = segmenter.segmentForVideo(frame, timestamp)
			const masks = result.confidenceMasks
			if (!masks || masks.length === 0) {
				result.close()
				throw new SegmentationUnavailableError('The segmenter returned no mask for this frame.')
			}

			const channel = masks[Math.min(subject.index, masks.length - 1)]
			const width = channel.width
			const height = channel.height
			const raw = channel.getAsFloat32Array()

			const length = raw.length
			// A model whose output size changed mid-clip invalidates both buffers,
			// which is also the first-frame case: neither is allocated yet.
			if (!pool[slot] || pool[slot]!.length !== length) {
				pool[0] = new Float32Array(length)
				pool[1] = new Float32Array(length)
				previous = null
			}
			const current = pool[slot]!
			slot ^= 1

			const keep = previous && previous.length === length ? smoothing : 0
			// The invert test and the smoothing test are both loop-invariant, so
			// they are hoisted into four tight loops rather than re-evaluated
			// sixty-five thousand times a frame. Each body is then a straight line
			// of float maths the JIT can keep in registers.
			if (keep > 0 && previous) {
				const blend = 1 - keep
				if (subject.invert) {
					for (let i = 0; i < length; i++) current[i] = previous[i] * keep + (1 - raw[i]) * blend
				} else {
					for (let i = 0; i < length; i++) current[i] = previous[i] * keep + raw[i] * blend
				}
			} else if (subject.invert) {
				for (let i = 0; i < length; i++) current[i] = 1 - raw[i]
			} else {
				current.set(raw)
			}
			previous = current
			result.close()

			if (!maskCanvas || maskCanvas.width !== width || maskCanvas.height !== height) {
				maskCanvas = new OffscreenCanvas(width, height)
				maskCtx = maskCanvas.getContext('2d', { willReadFrequently: false })
				maskImage = maskCtx ? maskCtx.createImageData(width, height) : null
			}
			if (!maskCtx || !maskImage) {
				throw new SegmentationUnavailableError('This browser has no 2D canvas to hold the mask.')
			}

			const pixels = maskImage.data
			for (let i = 0, p = 0; i < current.length; i++, p += 4) {
				const value = current[i] * 255
				pixels[p] = value
				pixels[p + 1] = value
				pixels[p + 2] = value
				pixels[p + 3] = 255
			}
			maskCtx.putImageData(maskImage, 0, 0)

			return { data: current, width, height, canvas: maskCanvas }
		},
		close() {
			previous = null
			pool[0] = null
			pool[1] = null
			maskImage = null
			// Dropping the canvas too: a bake that ran on a 4K clip is holding a
			// mask surface the browser will not reclaim while the reference lives.
			maskCanvas = null
			maskCtx = null
			try {
				segmenter.close()
			} catch {
				/* already closed */
			}
		},
	}
}
