'use client'

/**
 * The one place that knows how a tool's params turn into a call to an
 * engine.
 *
 * `registry.ts` describes tools as data; `av-remux.ts`, `video-filter.ts` and
 * `plan-ops.ts` are the three engines that actually do the work. This file is
 * the switch between them - small on purpose, since every branch is a couple
 * of lines that reads params out of a loosely-typed object and hands them to
 * a strongly-typed engine call. If a tool ever needs real bespoke logic
 * beyond "map these params to that engine", that is the sign it has outgrown
 * this file and earned a real module of its own.
 */

import type { CaptionVideoSource } from '../captions/types'
import { probeVideo, releaseVideoSource } from '../captions/video-source'
import { toolById, type HandlerId, type ToolDef } from './registry'
import {
	applyFade,
	applyGainDb,
	bassBoost,
	compressDynamics,
	declickAudio,
	deEss,
	downmixToMono,
	duckMix,
	noiseGate,
	normalizeLoudnessApprox,
	normalizePeak,
	pitchShift,
	reverseAudio,
	shiftAudio,
	spectralDenoise,
	stereoWiden,
	swapChannels,
	trebleBoost,
	upmixToStereo,
	type ChannelSource,
} from './audio-ops'
import { decodeWholeTrack, extractAudioOnly, remuxFileName, remuxWithAudioEdit, type AudioOnlyFormat, type AudioOutputFormat } from './av-remux'
import { centeredAspectCrop, type AnchorPosition, type ChromaKeySpec, type CropRect, type FrameOpsParams } from './frame-ops'
import {
	analyzeAutoLevels,
	detectLetterboxCrop,
	estimateStabilization,
	exportGif,
	extractThumbnail,
	filterFileName,
	openSecondaryVideoSource,
	renderVideoFilter,
	type PerFrameHook,
	type VideoFilterFormat,
	type VideoFilterQuality,
} from './video-filter'
import { cutFileName, freezeFramePlan, loopPlan, renderCutVideo, speedPlan, speedRampPlan, trimPlan } from './plan-ops'
import { mergeClips, mergeFileName } from './merge'
import { detectSceneCuts } from './scene-detect'
import { buildZip, type ZipEntry } from './zip-writer'

export type OutputSettings = { format: VideoFilterFormat; quality: VideoFilterQuality }

export type RunParams = Record<string, string | number | boolean>

export type RunProgress = { phase: string; ratio: number }

export type RunOutput = {
	blob: Blob
	url: string
	name: string
	sizeInBytes: number
	kind: 'video' | 'audio' | 'image' | 'file'
	meta?: string
}

export type RunResult = { outputs: RunOutput[] }

export type RunContext = {
	file: File
	probe: CaptionVideoSource
	params: RunParams
	secondaryFile: File | null
	/** files queued for a batch tool - empty for every other tool */
	batchFiles: File[]
	output: OutputSettings
	signal: AbortSignal
	onProgress: (progress: RunProgress) => void
}

function num(params: RunParams, key: string, fallback: number): number {
	const value = params[key]
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function str(params: RunParams, key: string, fallback: string): string {
	const value = params[key]
	return typeof value === 'string' && value.length > 0 ? value : fallback
}

function bool(params: RunParams, key: string, fallback: boolean): boolean {
	const value = params[key]
	return typeof value === 'boolean' ? value : fallback
}

async function loadWatermarkImage(file: File): Promise<{ image: ImageBitmap; width: number; height: number }> {
	const image = await createImageBitmap(file)
	return { image, width: image.width, height: image.height }
}

function parseAspect(value: string): { w: number; h: number } {
	const [w, h] = value.split(':').map((part) => Number(part))
	return { w: w > 0 ? w : 9, h: h > 0 ? h : 16 }
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
	const clean = hex.replace('#', '')
	const value = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean.padEnd(6, '0')
	const parsed = Number.parseInt(value, 16)
	return { r: (parsed >> 16) & 0xff, g: (parsed >> 8) & 0xff, b: parsed & 0xff }
}

async function probeFile(file: File): Promise<CaptionVideoSource> {
	return probeVideo({ file })
}

/** A standard reference canvas per aspect ratio - the size real footage actually gets padded onto. */
const LETTERBOX_PRESETS: Record<string, [number, number]> = {
	'9:16': [1080, 1920],
	'1:1': [1080, 1080],
	'4:5': [1080, 1350],
	'16:9': [1920, 1080],
	'4:3': [1440, 1080],
}

export async function runTool(tool: ToolDef, ctx: RunContext): Promise<RunResult> {
	const handler = tool.handler as HandlerId
	const durationMs = ctx.probe.durationInSeconds * 1000
	const baseName = ctx.file.name

	/* ------------------------------------------------------------- audio */

	const audioTransformHandlers: Partial<Record<HandlerId, (buffer: AudioBuffer) => AudioBuffer>> = {
		'mono-stereo': (buffer) => upmixToStereo(buffer, str(ctx.params, 'source', 'auto') as ChannelSource),
		'stereo-mono': (buffer) => downmixToMono(buffer),
		'swap-channels': (buffer) => swapChannels(buffer),
		gain: (buffer) => applyGainDb(buffer, num(ctx.params, 'db', 0)),
		normalize: (buffer) => normalizePeak(buffer, num(ctx.params, 'targetDb', -1)),
		fade: (buffer) => applyFade(buffer, { inMs: num(ctx.params, 'inMs', 0), outMs: num(ctx.params, 'outMs', 0) }),
		'reverse-audio': (buffer) => reverseAudio(buffer),
		'audio-delay': (buffer) => shiftAudio(buffer, num(ctx.params, 'ms', 0)),
		'noise-gate': (buffer) =>
			noiseGate(buffer, {
				thresholdDb: num(ctx.params, 'thresholdDb', -38),
				attackMs: num(ctx.params, 'attackMs', 8),
				releaseMs: num(ctx.params, 'releaseMs', 180),
			}),
		'bass-boost': (buffer) => bassBoost(buffer, num(ctx.params, 'gainDb', 6)),
		'treble-boost': (buffer) => trebleBoost(buffer, num(ctx.params, 'gainDb', 5)),
		'stereo-widen': (buffer) => stereoWiden(buffer, num(ctx.params, 'widthPercent', 140)),
		compressor: (buffer) =>
			compressDynamics(buffer, {
				thresholdDb: num(ctx.params, 'thresholdDb', -18),
				ratio: num(ctx.params, 'ratio', 3),
				attackMs: num(ctx.params, 'attackMs', 8),
				releaseMs: num(ctx.params, 'releaseMs', 120),
				makeupDb: num(ctx.params, 'makeupDb', 3),
			}),
		limiter: (buffer) =>
			compressDynamics(buffer, {
				thresholdDb: num(ctx.params, 'ceilingDb', -1),
				ratio: 20,
				attackMs: 1,
				releaseMs: 60,
				makeupDb: 0,
			}),
		'de-ess': (buffer) =>
			deEss(buffer, { thresholdDb: num(ctx.params, 'thresholdDb', -22), freq: num(ctx.params, 'freq', 6500), ratio: 4 }),
		'lufs-normalize': (buffer) => normalizeLoudnessApprox(buffer, num(ctx.params, 'targetLufs', -16)),
		'pitch-shift': (buffer) => pitchShift(buffer, num(ctx.params, 'semitones', 0)),
		declick: (buffer) => declickAudio(buffer, { sensitivity: num(ctx.params, 'sensitivity', 6) }),
		'spectral-denoise': (buffer) => spectralDenoise(buffer, { strength: num(ctx.params, 'strength', 55) / 100 }),
	}

	if (handler in audioTransformHandlers) {
		const transform = audioTransformHandlers[handler]!
		const result = await remuxWithAudioEdit({
			source: ctx.file,
			audio: { kind: 'process', transform },
			format: ctx.output.format,
			signal: ctx.signal,
			onProgress: (p) => ctx.onProgress({ phase: p.phase, ratio: p.ratio }),
		})
		return {
			outputs: [
				{
					blob: result.blob,
					url: result.url,
					name: remuxFileName(baseName, result.format, tool.id),
					sizeInBytes: result.sizeInBytes,
					kind: 'video',
				},
			],
		}
	}

	if (handler === 'mute-audio') {
		const result = await remuxWithAudioEdit({
			source: ctx.file,
			audio: { kind: 'mute' },
			format: ctx.output.format,
			signal: ctx.signal,
			onProgress: (p) => ctx.onProgress({ phase: p.phase, ratio: p.ratio }),
		})
		return {
			outputs: [
				{ blob: result.blob, url: result.url, name: remuxFileName(baseName, result.format, 'muted'), sizeInBytes: result.sizeInBytes, kind: 'video' },
			],
		}
	}

	if (handler === 'replace-audio') {
		if (!ctx.secondaryFile) throw new Error('Choose the replacement audio file first.')
		const result = await remuxWithAudioEdit({
			source: ctx.file,
			audio: { kind: 'replace', file: ctx.secondaryFile, gainDb: num(ctx.params, 'db', 0) },
			format: ctx.output.format,
			signal: ctx.signal,
			onProgress: (p) => ctx.onProgress({ phase: p.phase, ratio: p.ratio }),
		})
		return {
			outputs: [
				{ blob: result.blob, url: result.url, name: remuxFileName(baseName, result.format, 'dub'), sizeInBytes: result.sizeInBytes, kind: 'video' },
			],
		}
	}

	if (handler === 'music-ducking') {
		if (!ctx.secondaryFile) throw new Error('Choose the music track first.')
		const decodedMusic = await decodeWholeTrack({ source: ctx.secondaryFile, signal: ctx.signal })
		if (!decodedMusic) throw new Error('That file has no audio track to duck under this clip.')
		const duckDb = num(ctx.params, 'duckDb', 12)
		const musicGainDb = num(ctx.params, 'musicGainDb', -3)
		const result = await remuxWithAudioEdit({
			source: ctx.file,
			audio: {
				kind: 'process',
				transform: (main) => duckMix(main, decodedMusic.buffer, { duckDb, attackMs: 120, releaseMs: 400, musicGainDb }),
			},
			format: ctx.output.format,
			signal: ctx.signal,
			onProgress: (p) => ctx.onProgress({ phase: p.phase, ratio: p.ratio }),
		})
		return {
			outputs: [
				{ blob: result.blob, url: result.url, name: remuxFileName(baseName, result.format, 'ducked'), sizeInBytes: result.sizeInBytes, kind: 'video' },
			],
		}
	}

	if (handler === 'metadata-edit') {
		const result = await remuxWithAudioEdit({
			source: ctx.file,
			audio: { kind: 'copy' },
			format: ctx.output.format,
			metadata: {
				title: str(ctx.params, 'title', ''),
				artist: str(ctx.params, 'artist', ''),
				description: str(ctx.params, 'description', ''),
			},
			signal: ctx.signal,
			onProgress: (p) => ctx.onProgress({ phase: p.phase, ratio: p.ratio }),
		})
		return {
			outputs: [
				{ blob: result.blob, url: result.url, name: remuxFileName(baseName, result.format, 'tagged'), sizeInBytes: result.sizeInBytes, kind: 'video' },
			],
		}
	}

	if (handler === 'extract-audio') {
		const format = str(ctx.params, 'format', 'wav') as AudioOnlyFormat
		const result = await extractAudioOnly({
			source: ctx.file,
			format,
			signal: ctx.signal,
			onProgress: (ratio) => ctx.onProgress({ phase: 'decoding', ratio }),
		})
		return {
			outputs: [
				{ blob: result.blob, url: result.url, name: remuxFileName(baseName, format, 'audio'), sizeInBytes: result.sizeInBytes, kind: 'audio' },
			],
		}
	}

	/* --------------------------------------------------------- timing */

	if (
		handler === 'trim' ||
		handler === 'speed' ||
		handler === 'loop' ||
		handler === 'framerate' ||
		handler === 'freeze-frame' ||
		handler === 'speed-ramp'
	) {
		const fps = handler === 'framerate' ? Number(str(ctx.params, 'fps', '30')) : Math.round(ctx.probe.fps) || 30
		const plan =
			handler === 'trim'
				? trimPlan(durationMs, num(ctx.params, 'startSec', 0) * 1000, num(ctx.params, 'endSec', durationMs / 1000) * 1000)
				: handler === 'speed'
					? speedPlan(durationMs, num(ctx.params, 'factor', 1))
					: handler === 'loop'
						? loopPlan(durationMs, num(ctx.params, 'times', 2))
						: handler === 'freeze-frame'
							? freezeFramePlan(durationMs, num(ctx.params, 'atSec', durationMs / 2000) * 1000, num(ctx.params, 'holdMs', 1500), fps)
							: handler === 'speed-ramp'
								? speedRampPlan(durationMs, [
										{ t: 0, factor: num(ctx.params, 'startFactor', 1) },
										{ t: 0.5, factor: num(ctx.params, 'midFactor', 2.5) },
										{ t: 1, factor: num(ctx.params, 'endFactor', 1) },
									])
								: trimPlan(durationMs, 0, durationMs)

		const result = await renderCutVideo({
			source: ctx.file,
			plan,
			fps,
			quality: ctx.output.quality,
			format: ctx.output.format,
			scale: 1,
			includeAudio: ctx.probe.hasAudio,
			signal: ctx.signal,
			onProgress: (p) => ctx.onProgress({ phase: p.phase, ratio: p.ratio }),
		})
		return {
			outputs: [{ blob: result.blob, url: result.url, name: cutFileName(baseName, result.format), sizeInBytes: result.sizeInBytes, kind: 'video' }],
		}
	}

	const renderTrimParts = async (ranges: Array<[number, number]>): Promise<RunOutput[]> => {
		const outputs: RunOutput[] = []
		for (let i = 0; i < ranges.length; i++) {
			const [startMs, endMs] = ranges[i]
			const result = await renderCutVideo({
				source: ctx.file,
				plan: trimPlan(durationMs, startMs, endMs),
				fps: Math.round(ctx.probe.fps) || 30,
				quality: ctx.output.quality,
				format: ctx.output.format,
				scale: 1,
				includeAudio: ctx.probe.hasAudio,
				signal: ctx.signal,
				onProgress: (p) => ctx.onProgress({ phase: p.phase, ratio: (i + p.ratio) / ranges.length }),
			})
			outputs.push({
				blob: result.blob,
				url: result.url,
				name: remuxFileName(baseName, result.format, ranges.length > 1 ? `part${i + 1}` : 'part'),
				sizeInBytes: result.sizeInBytes,
				kind: 'video',
			})
		}
		return outputs
	}

	if (handler === 'split') {
		const atSec = num(ctx.params, 'atSec', durationMs / 2000)
		const atMs = Math.max(0, Math.min(durationMs, atSec * 1000))
		return { outputs: await renderTrimParts([[0, atMs], [atMs, durationMs]]) }
	}

	if (handler === 'scene-split') {
		const sensitivity = num(ctx.params, 'sensitivity', 50) / 100
		ctx.onProgress({ phase: 'reading', ratio: 0 })
		const cuts = await detectSceneCuts(ctx.file, ctx.signal, sensitivity)
		if (cuts.length === 0) {
			throw new Error("No hard cuts were found at this sensitivity - try raising it, or this clip may be a single continuous shot.")
		}
		const boundaries = [0, ...cuts.map((cut) => cut.atMs), durationMs]
		const ranges: Array<[number, number]> = []
		for (let i = 0; i < boundaries.length - 1; i++) {
			if (boundaries[i + 1] - boundaries[i] > 200) ranges.push([boundaries[i], boundaries[i + 1]])
		}
		return { outputs: await renderTrimParts(ranges) }
	}

	/* ------------------------------------------------------------ visual */

	if (handler === 'thumbnail') {
		const result = await extractThumbnail({
			source: ctx.file,
			atSeconds: num(ctx.params, 'atSeconds', 0),
			signal: ctx.signal,
		})
		return {
			outputs: [{ blob: result.blob, url: result.url, name: `${baseName.replace(/\.[a-z0-9]+$/i, '')}-frame.png`, sizeInBytes: result.blob.size, kind: 'image' }],
		}
	}

	if (handler === 'merge-clips') {
		if (!ctx.secondaryFile) throw new Error('Choose the second clip first.')
		const result = await mergeClips({
			first: ctx.file,
			second: ctx.secondaryFile,
			format: ctx.output.format,
			quality: ctx.output.quality,
			signal: ctx.signal,
			onProgress: (p) => ctx.onProgress({ phase: p.phase, ratio: p.ratio }),
		})
		return {
			outputs: [{ blob: result.blob, url: result.url, name: mergeFileName(baseName, result.format), sizeInBytes: result.sizeInBytes, kind: 'video' }],
		}
	}

	if (handler === 'export-gif') {
		const result = await exportGif({
			source: ctx.file,
			targetWidth: num(ctx.params, 'widthPx', 360),
			fps: num(ctx.params, 'fps', 10),
			maxSeconds: num(ctx.params, 'maxSeconds', 8),
			signal: ctx.signal,
			onProgress: (ratio) => ctx.onProgress({ phase: 'encoding', ratio }),
		})
		const name = `${baseName.replace(/\.[a-z0-9]+$/i, '')}.gif`
		return {
			outputs: [
				{
					blob: result.blob,
					url: result.url,
					name,
					sizeInBytes: result.blob.size,
					kind: 'image',
					meta: result.trimmedToSeconds ? `Trimmed to the first ${result.trimmedToSeconds}s to keep the file size reasonable.` : undefined,
				},
			],
		}
	}

	if (handler === 'batch-export') {
		if (ctx.batchFiles.length === 0) throw new Error('Add at least one file to the batch first.')
		const subToolId = str(ctx.params, 'tool', 'mute-audio')
		const subTool = toolById(subToolId)
		if (!subTool || !subTool.handler) throw new Error('Pick which tool to run over the batch.')

		const zipEntries: ZipEntry[] = []
		// Each output is named after its own input, so two queued files that share a
		// name would produce two identically-named zip entries - and most unzip tools
		// silently overwrite, quietly losing a result. Number the repeats instead.
		const usedNames = new Map<string, number>()
		const uniqueName = (name: string): string => {
			const seen = usedNames.get(name) ?? 0
			usedNames.set(name, seen + 1)
			if (seen === 0) return name
			const dot = name.lastIndexOf('.')
			return dot > 0 ? `${name.slice(0, dot)} (${seen + 1})${name.slice(dot)}` : `${name} (${seen + 1})`
		}
		for (let i = 0; i < ctx.batchFiles.length; i++) {
			const file = ctx.batchFiles[i]
			ctx.onProgress({ phase: `file ${i + 1} of ${ctx.batchFiles.length}`, ratio: i / ctx.batchFiles.length })
			// Probing mints an object URL per file. Without the release a long batch
			// would pin every input in memory until the tab navigated away.
			const probe = await probeFile(file)
			try {
				const sub = await runTool(subTool, {
					file,
					probe,
					params: {},
					secondaryFile: null,
					batchFiles: [],
					output: ctx.output,
					signal: ctx.signal,
					onProgress: (p) => ctx.onProgress({ phase: `file ${i + 1}/${ctx.batchFiles.length}: ${p.phase}`, ratio: (i + p.ratio) / ctx.batchFiles.length }),
				})
				for (const output of sub.outputs) {
					zipEntries.push({ name: uniqueName(output.name), data: new Uint8Array(await output.blob.arrayBuffer()) })
					URL.revokeObjectURL(output.url)
				}
			} finally {
				releaseVideoSource(probe)
			}
		}
		const zip = buildZip(zipEntries)
		const url = URL.createObjectURL(zip)
		return { outputs: [{ blob: zip, url, name: 'batch-export.zip', sizeInBytes: zip.size, kind: 'file' }] }
	}

	if (handler === 'stabilize') {
		ctx.onProgress({ phase: 'reading', ratio: 0 })
		const fps = Math.round(ctx.probe.fps) || 30
		const strength = num(ctx.params, 'strength', 60) / 100
		const plan = await estimateStabilization(ctx.file, fps, ctx.signal, strength)
		const perFrame: PerFrameHook = async (index) => ({ cropOffset: plan.compensation[index] ?? { dx: 0, dy: 0 } })

		const targetWidth = ctx.probe.width
		const targetHeight = ctx.probe.height
		const cropWidth = Math.round(targetWidth / plan.cropScale)
		const cropHeight = Math.round(targetHeight / plan.cropScale)
		const crop: CropRect = {
			x: Math.round((targetWidth - cropWidth) / 2),
			y: Math.round((targetHeight - cropHeight) / 2),
			width: cropWidth,
			height: cropHeight,
		}

		const result = await renderVideoFilter({
			source: ctx.file,
			params: { crop, targetWidth, targetHeight },
			audio: 'copy',
			format: ctx.output.format,
			quality: ctx.output.quality,
			perFrame,
			signal: ctx.signal,
			onProgress: (p) => ctx.onProgress({ phase: p.phase, ratio: p.ratio }),
		})
		return {
			outputs: [{ blob: result.blob, url: result.url, name: filterFileName(baseName, result.format, 'stabilized'), sizeInBytes: result.sizeInBytes, kind: 'video' }],
		}
	}

	if (handler === 'picture-in-picture') {
		if (!ctx.secondaryFile) throw new Error('Choose the overlay clip first.')
		const overlay = await openSecondaryVideoSource(ctx.secondaryFile)
		const w = ctx.probe.width
		const h = ctx.probe.height
		const position = str(ctx.params, 'position', 'bottom-right') as AnchorPosition
		const scale = num(ctx.params, 'scale', 28) / 100
		const opacity = num(ctx.params, 'opacity', 100) / 100
		const marginPx = Math.round(Math.min(w, h) * 0.04)

		const perFrame: PerFrameHook = async (_index, timestampSeconds) => {
			const frame = await overlay.getFrameAt(timestampSeconds)
			if (!frame) return {}
			return {
				overlay: {
					image: frame.canvas,
					naturalWidth: frame.naturalWidth,
					naturalHeight: frame.naturalHeight,
					scale,
					opacity,
					position,
					marginPx,
				},
			}
		}

		try {
			const result = await renderVideoFilter({
				source: ctx.file,
				params: {},
				audio: 'copy',
				format: ctx.output.format,
				quality: ctx.output.quality,
				perFrame,
				signal: ctx.signal,
				onProgress: (p) => ctx.onProgress({ phase: p.phase, ratio: p.ratio }),
			})
			return {
				outputs: [{ blob: result.blob, url: result.url, name: filterFileName(baseName, result.format, 'pip'), sizeInBytes: result.sizeInBytes, kind: 'video' }],
			}
		} finally {
			overlay.dispose()
		}
	}

	const visualParams = await buildVisualParams(handler, ctx)
	if (visualParams) {
		const result = await renderVideoFilter({
			source: ctx.file,
			params: visualParams,
			audio: 'copy',
			format: ctx.output.format,
			quality: ctx.output.quality,
			signal: ctx.signal,
			onProgress: (p) => ctx.onProgress({ phase: p.phase, ratio: p.ratio }),
		})
		return {
			outputs: [{ blob: result.blob, url: result.url, name: filterFileName(baseName, result.format, tool.id), sizeInBytes: result.sizeInBytes, kind: 'video' }],
		}
	}

	throw new Error(`"${tool.name}" doesn't have a working engine yet.`)
}

/** Builds the shared `FrameOpsParams` for every video-filter-backed tool. */
async function buildVisualParams(handler: HandlerId, ctx: RunContext): Promise<FrameOpsParams | null> {
	const w = ctx.probe.width
	const h = ctx.probe.height

	switch (handler) {
		case 'rotate':
			return { rotate: (Number(str(ctx.params, 'deg', '90')) as 0 | 90 | 180 | 270) }
		case 'flip':
			return { flipH: bool(ctx.params, 'flipH', false), flipV: bool(ctx.params, 'flipV', false) }
		case 'crop': {
			const left = num(ctx.params, 'left', 0)
			const top = num(ctx.params, 'top', 0)
			const right = num(ctx.params, 'right', 0)
			const bottom = num(ctx.params, 'bottom', 0)
			const crop: CropRect = {
				x: Math.round((w * left) / 100),
				y: Math.round((h * top) / 100),
				width: Math.max(10, Math.round((w * (100 - left - right)) / 100)),
				height: Math.max(10, Math.round((h * (100 - top - bottom)) / 100)),
			}
			return { crop }
		}
		case 'aspect-crop': {
			const { w: aw, h: ah } = parseAspect(str(ctx.params, 'aspect', '9:16'))
			return { crop: centeredAspectCrop(w, h, aw, ah) }
		}
		case 'resize':
			return { targetWidth: Math.round(num(ctx.params, 'width', w)) }
		case 'color-grade':
			return {
				brightness: num(ctx.params, 'brightness', 1),
				contrast: num(ctx.params, 'contrast', 1),
				saturation: num(ctx.params, 'saturation', 1),
			}
		case 'grayscale':
			return { grayscale: 1 }
		case 'sepia':
			return { sepia: 1 }
		case 'invert':
			return { invert: 1 }
		case 'blur':
			return { blurPx: num(ctx.params, 'px', 6) }
		case 'sharpen':
			return { sharpenAmount: num(ctx.params, 'amount', 0.6) }
		case 'vignette':
			return { vignette: num(ctx.params, 'strength', 0.5) }
		case 'watermark': {
			if (!ctx.secondaryFile) throw new Error('Choose a watermark image first.')
			const loaded = await loadWatermarkImage(ctx.secondaryFile)
			return {
				watermark: {
					image: loaded.image,
					naturalWidth: loaded.width,
					naturalHeight: loaded.height,
					scale: num(ctx.params, 'scale', 16) / 100,
					opacity: num(ctx.params, 'opacity', 85) / 100,
					position: str(ctx.params, 'position', 'bottom-right') as AnchorPosition,
					marginPx: Math.round(Math.min(w, h) * 0.04),
				},
			}
		}
		case 'text-overlay':
			return {
				text: {
					content: str(ctx.params, 'content', ''),
					color: str(ctx.params, 'color', '#ffffff'),
					sizePx: num(ctx.params, 'size', 36),
					position: str(ctx.params, 'position', 'bottom-center') as AnchorPosition,
					opacity: 1,
					background: bool(ctx.params, 'background', true) ? 'rgba(10,10,16,0.55)' : null,
					marginPx: Math.round(Math.min(w, h) * 0.04),
					weight: 600,
				},
			}
		case 'format-convert':
		case 'compress':
			return {}
		case 'chroma-key':
			return {
				chromaKey: {
					keyColor: hexToRgb(str(ctx.params, 'keyColor', '#00b140')),
					tolerance: num(ctx.params, 'tolerance', 35) / 100,
					smoothing: num(ctx.params, 'smoothing', 12) / 100,
					background: { kind: 'color', color: str(ctx.params, 'backgroundColor', '#000000') },
				} satisfies ChromaKeySpec,
			}
		case 'auto-color': {
			const levels = await analyzeAutoLevels(ctx.file, ctx.signal)
			return { brightness: levels.brightness, contrast: levels.contrast, saturation: levels.saturation }
		}
		case 'autocrop-bars': {
			const crop = await detectLetterboxCrop(ctx.file, ctx.signal)
			return crop ? { crop } : {}
		}
		case 'letterbox-pad': {
			const { w: aw, h: ah } = parseAspect(str(ctx.params, 'aspect', '9:16'))
			const preset = LETTERBOX_PRESETS[`${aw}:${ah}`] ?? [aw * 120, ah * 120]
			return { targetWidth: preset[0], targetHeight: preset[1], fit: 'contain', padColor: str(ctx.params, 'padColor', '#000000') }
		}
		default:
			return null
	}
}

export type { AudioOutputFormat }
