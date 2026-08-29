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
import { bakeToneLut, DEFAULT_TONE_ID, resolveFinish, toneById, trimRecipe, type ToneFinish } from './color-tone'
import { bandCenterById, createAdjustProcessor, isNeutralAdjust, type AdjustSettings } from './adjust'
import { applyEcho, applyEqualizer, applyReverb, applyVoicePreset, detectBeats, type VoicePresetId } from './audio-fx'
import { prepareBlendOverlay, type BlendFit, type BlendMode, type BlendPlacement } from './blend'
import { borderInset, createBorderPass, type BorderSettings, type BorderStyle } from './border'
import { prepareCanvasBackground, type CanvasBackdrop } from './canvas-bg'
import { createEffectProcessor, effectById } from './effects'
import { createEnhanceProcessor, isNeutralEnhance, type EnhanceSettings } from './enhance'
import { createInpaintPass, type InpaintMode } from './inpaint'
import { blendLutTowardIdentity, readCubeLutFile } from './lut'
import { createMaskPass, type MaskShape, type MaskTreatment } from './mask'
import { createMotionPlan, motionPresetById, type MotionEasing, type MotionPresetId } from './motion'
import { createRetouchProcessor, isNeutralRetouch, type RetouchSettings } from './retouch'
import { renderReversed } from './reverse'
import { renderSplitScreen, splitFileName, type SplitLayoutId } from './split-screen'
import { createTitlePass, type TextAnimationId, type TextStyleId } from './text-fx'
import { planAutoReframe } from './track'
import { renderTransition, transitionFileName, type TransitionId } from './transitions'
import { createToneProcessor, type ToneProcessor } from './tone-renderer'
import { prepareBackgroundReplace, type BackgroundMode, type BackgroundReplaceParams } from './background-runner'
import type { PlateFit } from './background-replace'
import { prepareChromaOverlay, type ChromaOverlayParams, type OverlayFit, type OverlayPlacement } from './chroma-overlay'
import type { SegmentationModelId } from './segmentation'
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

/**
 * Turns the colour-tone tool's sliders into a baked cube and the shader that
 * applies it. The trims are folded into the recipe *before* baking rather
 * than being extra shader uniforms, so warming a look by 20% costs the same
 * as not warming it.
 */
function buildToneProcessor(params: RunParams): ToneProcessor {
	const tone = toneById(str(params, 'tone', DEFAULT_TONE_ID)) ?? toneById(DEFAULT_TONE_ID)!
	const strength = num(params, 'strength', 100) / 100
	const recipe = trimRecipe(tone.recipe, {
		warmth: num(params, 'warmth', 0) / 100,
		exposure: num(params, 'exposure', 0) / 100,
		saturation: num(params, 'saturationTrim', 0) / 100,
		contrast: num(params, 'contrastTrim', 0) / 100,
	})
	const finish = resolveFinish(
		tone,
		{
			grain: num(params, 'grain', 0) / 100,
			vignette: num(params, 'vignette', 0) / 100,
			bloom: num(params, 'bloom', 0) / 100,
		},
		strength,
	)
	return createToneProcessor({ lut: bakeToneLut(recipe), strength, finish })
}

function readChromaOverlayParams(params: RunParams): ChromaOverlayParams {
	return {
		keyColor: str(params, 'keyColor', '#00b140'),
		autoKey: bool(params, 'autoKey', true),
		tolerance: num(params, 'tolerance', 30),
		smoothing: num(params, 'smoothing', 12),
		despill: num(params, 'despill', 60),
		opacity: num(params, 'opacity', 100),
		scale: num(params, 'scale', 35),
		placement: str(params, 'placement', 'fill') as OverlayPlacement,
		fit: str(params, 'fit', 'cover') as OverlayFit,
		startAt: num(params, 'startAt', 0),
		loop: bool(params, 'loop', true),
		showMatte: bool(params, 'showMatte', false),
	}
}

function readBackgroundParams(params: RunParams): BackgroundReplaceParams {
	return {
		mode: str(params, 'mode', 'upload') as BackgroundMode,
		color: str(params, 'color', '#0b0f1a'),
		fit: str(params, 'fit', 'cover') as PlateFit,
		blurPercent: num(params, 'blur', 4),
		model: str(params, 'model', 'balanced') as SegmentationModelId,
		feather: num(params, 'feather', 10),
		matte: num(params, 'matte', 55),
		edgeShift: num(params, 'edgeShift', 0),
		edgeClean: num(params, 'edgeClean', 35),
		lightWrap: num(params, 'lightWrap', 25),
		smoothing: num(params, 'smoothing', 60),
		showMatte: bool(params, 'showMatte', false),
	}
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
		reverb: (buffer) =>
			applyReverb(buffer, {
				size: num(ctx.params, 'size', 55) / 100,
				damping: num(ctx.params, 'damping', 55) / 100,
				wet: num(ctx.params, 'wet', 30) / 100,
				preDelayMs: num(ctx.params, 'preDelayMs', 20),
				width: num(ctx.params, 'width', 100) / 100,
			}),
		echo: (buffer) =>
			applyEcho(buffer, {
				delayMs: num(ctx.params, 'delayMs', 320),
				feedback: num(ctx.params, 'feedback', 35) / 100,
				wet: num(ctx.params, 'wet', 35) / 100,
				pingPong: bool(ctx.params, 'pingPong', false),
			}),
		equalizer: (buffer) =>
			applyEqualizer(buffer, {
				low: num(ctx.params, 'low', 0),
				lowMid: num(ctx.params, 'lowMid', 0),
				mid: num(ctx.params, 'mid', 0),
				highMid: num(ctx.params, 'highMid', 0),
				high: num(ctx.params, 'high', 0),
			}),
		// The pitch shifter is handed in rather than imported by `audio-fx.ts`,
		// so the effects rack does not depend on the phase vocoder in the repair
		// module just to make a voice deeper.
		'voice-changer': (buffer) => applyVoicePreset(buffer, str(ctx.params, 'preset', 'deep') as VoicePresetId, pitchShift),
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

	if (handler === 'color-tone') {
		const processor = buildToneProcessor(ctx.params)
		try {
			const result = await renderVideoFilter({
				source: ctx.file,
				params: { tonePass: processor },
				audio: 'copy',
				format: ctx.output.format,
				quality: ctx.output.quality,
				signal: ctx.signal,
				onProgress: (p) => ctx.onProgress({ phase: p.phase, ratio: p.ratio }),
			})
			const tone = toneById(str(ctx.params, 'tone', DEFAULT_TONE_ID))
			return {
				outputs: [
					{
						blob: result.blob,
						url: result.url,
						name: filterFileName(baseName, result.format, tone ? tone.id : 'graded'),
						sizeInBytes: result.sizeInBytes,
						kind: 'video',
						meta: tone
							? `${tone.name} at ${Math.round(num(ctx.params, 'strength', 100))}%${processor.degraded ? ' - graded on the CPU, without the optical effects' : ''}`
							: undefined,
					},
				],
			}
		} finally {
			processor.dispose()
		}
	}

	if (handler === 'background-replace') {
		ctx.onProgress({ phase: 'preparing the person model', ratio: 0 })
		const prepared = await prepareBackgroundReplace({
			params: readBackgroundParams(ctx.params),
			probe: ctx.probe,
			plateFile: ctx.secondaryFile,
			signal: ctx.signal,
			// The model is a one-off download that can be sixteen megabytes, so it
			// gets its own slice of the progress bar rather than a frozen 0%.
			onProgress: (p) =>
				ctx.onProgress({
					phase: p.phase === 'model' ? 'downloading the person model' : 'starting the person model',
					ratio: p.ratio * 0.12,
				}),
		})
		try {
			const result = await renderVideoFilter({
				source: ctx.file,
				params: {},
				audio: 'copy',
				format: ctx.output.format,
				quality: ctx.output.quality,
				perFrame: prepared.perFrame,
				signal: ctx.signal,
				onProgress: (p) => ctx.onProgress({ phase: p.phase, ratio: 0.12 + p.ratio * 0.88 }),
			})
			return {
				outputs: [
					{
						blob: result.blob,
						url: result.url,
						name: filterFileName(baseName, result.format, 'background'),
						sizeInBytes: result.sizeInBytes,
						kind: 'video',
						meta: prepared.summary,
					},
				],
			}
		} finally {
			prepared.dispose()
		}
	}

	if (handler === 'chroma-overlay') {
		ctx.onProgress({ phase: 'reading the overlay clip', ratio: 0 })
		const prepared = await prepareChromaOverlay({
			params: readChromaOverlayParams(ctx.params),
			overlayFile: ctx.secondaryFile,
			signal: ctx.signal,
		})
		try {
			const result = await renderVideoFilter({
				source: ctx.file,
				params: {},
				audio: 'copy',
				format: ctx.output.format,
				quality: ctx.output.quality,
				perFrame: prepared.perFrame,
				signal: ctx.signal,
				onProgress: (p) => ctx.onProgress({ phase: p.phase, ratio: p.ratio }),
			})
			return {
				outputs: [
					{
						blob: result.blob,
						url: result.url,
						name: filterFileName(baseName, result.format, 'overlay'),
						sizeInBytes: result.sizeInBytes,
						kind: 'video',
						meta: prepared.summary,
					},
				],
			}
		} finally {
			prepared.dispose()
		}
	}

	if (handler === 'beat-detect') {
		ctx.onProgress({ phase: 'decoding', ratio: 0 })
		const decoded = await decodeWholeTrack({ source: ctx.file, signal: ctx.signal })
		if (!decoded) throw new Error('That file has no audio track to find a beat in.')
		ctx.onProgress({ phase: 'listening for the beat', ratio: 0.7 })
		const analysis = detectBeats(decoded.buffer, num(ctx.params, 'sensitivity', 55) / 100)
		if (analysis.beats.length === 0) {
			throw new Error('No beats were found at this sensitivity - raise it, or this track may have no steady rhythm.')
		}
		// A plain text marker list, one time per line: importable into every
		// editor that takes markers, and readable without one.
		const lines = [
			`# ${ctx.file.name}`,
			`# ${analysis.beats.length} beats${analysis.bpm ? `, about ${analysis.bpm} bpm` : ', no steady tempo found'}`,
			...analysis.beats.map((seconds) => seconds.toFixed(3)),
		]
		const blob = new Blob([lines.join('\n')], { type: 'text/plain' })
		return {
			outputs: [
				{
					blob,
					url: URL.createObjectURL(blob),
					name: `${baseName.replace(/\.[a-z0-9]+$/i, '')}-beats.txt`,
					sizeInBytes: blob.size,
					kind: 'file',
					meta: analysis.bpm
						? `${analysis.beats.length} beats, about ${analysis.bpm} bpm (${Math.round(analysis.confidence * 100)}% of the gaps agree)`
						: `${analysis.beats.length} beats, but no steady tempo`,
				},
			],
		}
	}

	if (handler === 'reverse-video') {
		const result = await renderReversed({
			source: ctx.file,
			format: ctx.output.format,
			quality: ctx.output.quality,
			includeAudio: ctx.probe.hasAudio && bool(ctx.params, 'includeAudio', true),
			signal: ctx.signal,
			onProgress: (p) => ctx.onProgress({ phase: p.phase, ratio: p.ratio }),
		})
		return {
			outputs: [
				{
					blob: result.blob,
					url: result.url,
					name: filterFileName(baseName, result.format, 'reversed'),
					sizeInBytes: result.sizeInBytes,
					kind: 'video',
				},
			],
		}
	}

	if (handler === 'transition') {
		if (!ctx.secondaryFile) throw new Error('Choose the clip to cut to first.')
		const result = await renderTransition({
			first: ctx.file,
			second: ctx.secondaryFile,
			transition: str(ctx.params, 'transition', 'dissolve') as TransitionId,
			transitionSeconds: num(ctx.params, 'seconds', 1),
			format: ctx.output.format,
			quality: ctx.output.quality,
			signal: ctx.signal,
			onProgress: (p) => ctx.onProgress({ phase: p.phase, ratio: p.ratio }),
		})
		return {
			outputs: [
				{
					blob: result.blob,
					url: result.url,
					name: transitionFileName(baseName, result.format),
					sizeInBytes: result.sizeInBytes,
					kind: 'video',
					meta: `${result.durationSeconds.toFixed(1)}s - the two clips overlap, so this is shorter than both of them together`,
				},
			],
		}
	}

	if (handler === 'split-screen') {
		// The loaded clip is deliberately not one of the panels: a montage's
		// running order is the order the files were added, and quietly making
		// whatever happens to be open into panel one would fight that.
		if (ctx.batchFiles.length === 0) throw new Error('Add the clips for each panel first.')
		const result = await renderSplitScreen({
			clips: ctx.batchFiles,
			layout: str(ctx.params, 'layout', 'side-by-side') as SplitLayoutId,
			aspect: str(ctx.params, 'aspect', '16:9'),
			gap: num(ctx.params, 'gap', 0.8),
			background: str(ctx.params, 'background', '#0b0b10'),
			fit: str(ctx.params, 'fit', 'cover') as 'cover' | 'contain',
			radius: num(ctx.params, 'radius', 0),
			format: ctx.output.format,
			quality: ctx.output.quality,
			signal: ctx.signal,
			onProgress: (p) => ctx.onProgress({ phase: p.phase, ratio: p.ratio }),
		})
		return {
			outputs: [
				{
					blob: result.blob,
					url: result.url,
					name: splitFileName(result.format),
					sizeInBytes: result.sizeInBytes,
					kind: 'video',
					meta: `${result.panels} panels at ${result.width}x${result.height}`,
				},
			],
		}
	}

	const advanced = await buildAdvancedVisual(handler, ctx)
	if (advanced) {
		try {
			const result = await renderVideoFilter({
				source: ctx.file,
				params: advanced.params,
				audio: 'copy',
				format: ctx.output.format,
				quality: ctx.output.quality,
				perFrame: advanced.perFrame,
				signal: ctx.signal,
				onProgress: (p) => ctx.onProgress({ phase: p.phase, ratio: p.ratio }),
			})
			return {
				outputs: [
					{
						blob: result.blob,
						url: result.url,
						name: filterFileName(baseName, result.format, tool.id),
						sizeInBytes: result.sizeInBytes,
						kind: 'video',
						meta: advanced.summary,
					},
				],
			}
		} finally {
			// Shaders, scratch canvases, decoded overlays and model handles all
			// live here; a cancelled or failed render must release them too.
			advanced.dispose()
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

/* ==========================================================================
   The pass-based tools.

   Everything in `buildVisualParams` below is pure data: a crop rectangle, a
   filter string, a number. These are not. Each one builds something that owns
   a resource - a compiled shader and its textures, a scratch canvas, a decoded
   overlay clip, a segmentation model - and every one of those has to be
   released whether the render finishes, fails or is cancelled.

   So they get their own builder, which hands back a `dispose` alongside the
   parameters, and both the renderer and the preview wrap it in a `finally`.
   Keeping them separate from the data-only path means the fifteen tools that
   genuinely have nothing to clean up are not made to carry a lifecycle they
   do not need.
   ========================================================================== */

/** Enough of a run or a preview to build a pass from. */
type VisualContext = {
	file: File
	probe: CaptionVideoSource
	params: RunParams
	secondaryFile: File | null
	signal: AbortSignal
	onProgress?: (progress: RunProgress) => void
}

type AdvancedVisual = {
	params: FrameOpsParams
	perFrame?: PerFrameHook
	/** shown on the finished card, or under the preview, when there is something to say */
	summary?: string
	dispose(): void
}

const NO_FINISH: Required<ToneFinish> = {
	grain: 0,
	grainSize: 1,
	vignette: 0,
	bloom: 0,
	halation: 0,
	softness: 0,
	chroma: 0,
}

function readAdjustSettings(params: RunParams): AdjustSettings {
	return {
		exposure: num(params, 'exposure', 0),
		contrast: num(params, 'contrast', 0),
		temperature: num(params, 'temperature', 0),
		tint: num(params, 'tint', 0),
		highlights: num(params, 'highlights', 0),
		shadows: num(params, 'shadows', 0),
		whites: num(params, 'whites', 0),
		blacks: num(params, 'blacks', 0),
		gamma: num(params, 'gamma', 0),
		fade: num(params, 'fade', 0),
		vibrance: num(params, 'vibrance', 0),
		saturation: num(params, 'saturation', 0),
		hue: num(params, 'hue', 0),
		clarity: num(params, 'clarity', 0),
		sharpness: num(params, 'sharpness', 0),
		band: {
			center: bandCenterById(str(params, 'band', 'orange')),
			width: num(params, 'bandWidth', 18) / 100,
			hue: num(params, 'bandHue', 0),
			saturation: num(params, 'bandSat', 0),
			luminance: num(params, 'bandLum', 0),
		},
	}
}

async function buildAdvancedVisual(handler: HandlerId, ctx: VisualContext): Promise<AdvancedVisual | null> {
	const fps = Math.round(ctx.probe.fps) || 30
	const noop = () => {}

	switch (handler) {
		case 'adjust': {
			const settings = readAdjustSettings(ctx.params)
			if (isNeutralAdjust(settings)) {
				throw new Error('Nothing is adjusted yet - move at least one slider before running this.')
			}
			const processor = createAdjustProcessor(settings)
			return {
				params: { passes: [processor] },
				dispose: () => processor.dispose(),
				summary: processor.degraded ? 'Adjusted on the CPU - the same maths, just slower.' : undefined,
			}
		}

		case 'video-effect': {
			const id = str(ctx.params, 'effect', 'glitch')
			const effect = effectById(id)
			if (!effect) throw new Error(`"${id}" is not an effect this build knows about.`)
			const processor = createEffectProcessor({
				effect: id,
				intensity: num(ctx.params, 'intensity', effect.defaultIntensity) / 100,
				speed: num(ctx.params, 'speed', 1),
				angle: num(ctx.params, 'angle', 0),
				colorA: hexToRgb(str(ctx.params, 'colorA', '#ff2d95')),
				colorB: hexToRgb(str(ctx.params, 'colorB', '#22d3ee')),
				fps,
			})
			return {
				params: { passes: [processor] },
				dispose: () => processor.dispose(),
				summary: processor.degraded
					? `${effect.label} rendered on the CPU - correct, but far slower over a whole clip.`
					: effect.label,
			}
		}

		case 'camera-motion': {
			const preset = str(ctx.params, 'preset', 'ken-burns') as MotionPresetId
			const plan = createMotionPlan({
				preset,
				amount: num(ctx.params, 'amount', 60) / 100,
				easing: str(ctx.params, 'easing', 'ease-in-out') as MotionEasing,
				durationSeconds: num(ctx.params, 'seconds', ctx.probe.durationInSeconds),
				fps,
				reverse: bool(ctx.params, 'reverse', false),
			})
			return {
				params: {},
				// The move is per-frame by definition, so it rides the same patch
				// seam stabilisation and picture-in-picture use.
				perFrame: async (frameIndex) => ({ patch: { transform: plan(frameIndex) } }),
				dispose: noop,
				summary: motionPresetById(preset)?.label,
			}
		}

		case 'shape-mask': {
			const pass = createMaskPass({
				shape: str(ctx.params, 'shape', 'circle') as MaskShape,
				centerX: num(ctx.params, 'centerX', 50) / 100,
				centerY: num(ctx.params, 'centerY', 50) / 100,
				size: num(ctx.params, 'size', 55) / 100,
				ratio: num(ctx.params, 'ratio', 100) / 100,
				rotation: num(ctx.params, 'rotation', 0),
				feather: num(ctx.params, 'feather', 30) / 100,
				invert: bool(ctx.params, 'invert', false),
				treatment: str(ctx.params, 'treatment', 'blur') as MaskTreatment,
				strength: num(ctx.params, 'strength', 80) / 100,
				color: str(ctx.params, 'color', '#000000'),
			})
			return { params: { passes: [pass] }, dispose: () => pass.dispose() }
		}

		case 'border-frame': {
			const settings: BorderSettings = {
				style: str(ctx.params, 'style', 'solid') as BorderStyle,
				thickness: num(ctx.params, 'thickness', 3),
				radius: num(ctx.params, 'radius', 0),
				color: str(ctx.params, 'color', '#ffffff'),
				colorB: str(ctx.params, 'colorB', '#0b0b10'),
				opacity: num(ctx.params, 'opacity', 100),
			}
			// The inset is what keeps the frame from covering the picture; it is
			// computed against the source size because that is the frame the
			// transform is applied in.
			const transform = borderInset(settings, ctx.probe.width, ctx.probe.height)
			return { params: { passes: [createBorderPass(settings)], transform }, dispose: noop }
		}

		case 'animated-text': {
			const content = str(ctx.params, 'content', '')
			if (!content.trim()) throw new Error('Type the title text first.')
			const pass = createTitlePass({
				content,
				fontSize: num(ctx.params, 'fontSize', 7),
				weight: Number(str(ctx.params, 'weight', '600')) as 400 | 600 | 800,
				italic: bool(ctx.params, 'italic', false),
				uppercase: bool(ctx.params, 'uppercase', false),
				letterSpacing: num(ctx.params, 'letterSpacing', 0),
				lineHeight: num(ctx.params, 'lineHeight', 1.25),
				color: str(ctx.params, 'color', '#ffffff'),
				accent: str(ctx.params, 'accent', '#0b0b10'),
				style: str(ctx.params, 'style', 'outline') as TextStyleId,
				animation: str(ctx.params, 'animation', 'fade') as TextAnimationId,
				position: str(ctx.params, 'position', 'bottom-center') as AnchorPosition,
				offsetX: num(ctx.params, 'offsetX', 0) / 100,
				offsetY: num(ctx.params, 'offsetY', 0) / 100,
				rotation: num(ctx.params, 'rotation', 0),
				opacity: num(ctx.params, 'opacity', 100) / 100,
				startAt: num(ctx.params, 'startAt', 0),
				durationSeconds: num(ctx.params, 'seconds', 3),
				animateSeconds: num(ctx.params, 'animateSeconds', 0.5),
				maxWidth: num(ctx.params, 'maxWidth', 80) / 100,
				fps,
			})
			return { params: { passes: [pass] }, dispose: noop }
		}

		case 'remove-object': {
			const pass = createInpaintPass({
				mode: str(ctx.params, 'mode', 'fill') as InpaintMode,
				region: {
					x: num(ctx.params, 'x', 70) / 100,
					y: num(ctx.params, 'y', 80) / 100,
					width: num(ctx.params, 'width', 22) / 100,
					height: num(ctx.params, 'height', 12) / 100,
				},
				feather: num(ctx.params, 'feather', 45) / 100,
				strength: num(ctx.params, 'strength', 70) / 100,
				matchGrain: bool(ctx.params, 'matchGrain', true),
			})
			return { params: { passes: [pass] }, dispose: () => pass.dispose() }
		}

		case 'retouch': {
			const settings: RetouchSettings = {
				smooth: num(ctx.params, 'smooth', 45) / 100,
				even: num(ctx.params, 'even', 25) / 100,
				brighten: num(ctx.params, 'brighten', 15) / 100,
				warmth: num(ctx.params, 'warmth', 10) / 100,
				clarityEyes: num(ctx.params, 'eyes', 25) / 100,
				radius: num(ctx.params, 'radius', 50) / 100,
			}
			if (isNeutralRetouch(settings)) throw new Error('Every retouch slider is at zero - move one before running this.')
			const processor = createRetouchProcessor(settings)
			return {
				params: { passes: [processor] },
				dispose: () => processor.dispose(),
				summary: processor.degraded ? 'Retouched on the CPU - a plain blur on skin, not the edge-preserving one.' : undefined,
			}
		}

		case 'enhance': {
			const settings: EnhanceSettings = {
				denoise: num(ctx.params, 'denoise', 40) / 100,
				deblock: num(ctx.params, 'deblock', 30) / 100,
				sharpen: num(ctx.params, 'sharpen', 35) / 100,
				saturation: num(ctx.params, 'saturation', 0) / 100,
			}
			if (isNeutralEnhance(settings)) throw new Error('Every enhance slider is at zero - move one before running this.')
			const processor = createEnhanceProcessor(settings)
			const upscale = Number(str(ctx.params, 'upscale', '1'))
			return {
				params: {
					passes: [processor],
					targetWidth: upscale > 1 ? Math.round(ctx.probe.width * upscale) : null,
				},
				dispose: () => processor.dispose(),
				summary: processor.degraded ? 'Cleaned up on the CPU - the same filters, just slower.' : undefined,
			}
		}

		case 'lut-import': {
			if (!ctx.secondaryFile) throw new Error('Choose the .cube file first.')
			const parsed = await readCubeLutFile(ctx.secondaryFile)
			const strength = Math.min(100, Math.max(0, num(ctx.params, 'strength', 100))) / 100
			// The fade toward the identity is done on the table rather than in the
			// shader, so an imported LUT behaves exactly like a built-in look.
			const processor = createToneProcessor({
				lut: blendLutTowardIdentity(parsed.lut, strength),
				strength: 1,
				finish: NO_FINISH,
			})
			return {
				params: { tonePass: processor },
				dispose: () => processor.dispose(),
				summary: `${parsed.title} - ${parsed.lut.size} points per axis${parsed.sourceDimensions === 1 ? ', expanded from a 1D curve' : ''}${
					processor.degraded ? ', applied on the CPU' : ''
				}`,
			}
		}

		case 'canvas-background': {
			const prepared = await prepareCanvasBackground({
				params: {
					aspect: str(ctx.params, 'aspect', '9:16'),
					backdrop: str(ctx.params, 'backdrop', 'blur') as CanvasBackdrop,
					blurStrength: num(ctx.params, 'blurStrength', 70),
					dim: num(ctx.params, 'dim', 25),
					color: str(ctx.params, 'color', '#0b0b10'),
					colorB: str(ctx.params, 'colorB', '#1f2937'),
					foregroundScale: num(ctx.params, 'foregroundScale', 100),
				},
				probe: ctx.probe,
				plateFile: ctx.secondaryFile,
				signal: ctx.signal,
			})
			return { params: prepared.params, perFrame: prepared.perFrame, summary: prepared.summary, dispose: prepared.dispose }
		}

		case 'blend-overlay': {
			const prepared = await prepareBlendOverlay({
				params: {
					mode: str(ctx.params, 'mode', 'screen') as BlendMode,
					opacity: num(ctx.params, 'opacity', 70),
					placement: str(ctx.params, 'placement', 'fill') as BlendPlacement,
					fit: str(ctx.params, 'fit', 'cover') as BlendFit,
					scale: num(ctx.params, 'scale', 35),
					startAt: num(ctx.params, 'startAt', 0),
					loop: bool(ctx.params, 'loop', true),
				},
				overlayFile: ctx.secondaryFile,
				signal: ctx.signal,
			})
			return { params: {}, perFrame: prepared.perFrame, summary: prepared.summary, dispose: prepared.dispose }
		}

		case 'auto-reframe': {
			const { w, h } = parseAspect(str(ctx.params, 'aspect', '9:16'))
			ctx.onProgress?.({ phase: 'looking for the subject', ratio: 0 })
			const plan = await planAutoReframe({
				source: ctx.file,
				aspectW: w,
				aspectH: h,
				fps,
				steadiness: num(ctx.params, 'steadiness', 60) / 100,
				model: str(ctx.params, 'model', 'balanced') as SegmentationModelId,
				motionOnly: bool(ctx.params, 'motionOnly', false),
				signal: ctx.signal,
				onProgress: (progress) => ctx.onProgress?.({ phase: progress.phase, ratio: progress.ratio * 0.35 }),
				onModelProgress: (progress) =>
					ctx.onProgress?.({
						phase: progress.phase === 'model' ? 'downloading the person model' : 'starting the person model',
						ratio: progress.ratio * 0.1,
					}),
			})
			return {
				params: { crop: plan.crop },
				perFrame: async (frameIndex) => ({ cropOffset: plan.offsets[frameIndex] ?? { dx: 0, dy: 0 } }),
				summary: plan.summary,
				dispose: noop,
			}
		}

		default:
			return null
	}
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

/* ==========================================================================
   Previews.

   Two of the tools here cannot be judged from their sliders - a background
   swap and a colour grade both have to be *seen* - and both would otherwise
   be judged by rendering the whole clip, changing one number and rendering it
   again. So one frame is put through the identical engine instead, at a
   capped width, which takes about as long as it takes to decode that frame.

   This is deliberately not a second implementation: it builds the same
   processors and the same per-frame hook the render does, and hands them to
   `extractThumbnail`, which runs the same `drawFrame`. A preview that could
   disagree with the export would be worse than no preview.
   ========================================================================== */

export type PreviewContext = {
	file: File
	probe: CaptionVideoSource
	params: RunParams
	secondaryFile: File | null
	/** where in the clip to sample; clamped into the clip by the caller */
	atSeconds: number
	signal: AbortSignal
	onProgress?: (progress: RunProgress) => void
}

export type PreviewResult = {
	blob: Blob
	url: string
	width: number
	height: number
	/** what the preview actually did, when that is worth saying */
	note?: string
}

/** Preview frames are capped here: past this they cost more than they teach. */
const PREVIEW_MAX_WIDTH = 720

export async function previewTool(tool: ToolDef, ctx: PreviewContext): Promise<PreviewResult> {
	const handler = tool.handler as HandlerId | undefined
	if (!handler) throw new Error(`"${tool.name}" has nothing to preview.`)

	const targetWidth = Math.min(PREVIEW_MAX_WIDTH, ctx.probe.width)
	const atSeconds = Math.max(0, Math.min(ctx.probe.durationInSeconds - 0.05, ctx.atSeconds))

	if (handler === 'color-tone') {
		const processor = buildToneProcessor(ctx.params)
		try {
			ctx.onProgress?.({ phase: 'grading a frame', ratio: 0.5 })
			const still = await extractThumbnail({
				source: ctx.file,
				atSeconds,
				params: { targetWidth, tonePass: processor },
				signal: ctx.signal,
			})
			return {
				...still,
				note: processor.degraded ? 'Graded on the CPU - bloom, halation and diffusion need WebGL2.' : undefined,
			}
		} finally {
			processor.dispose()
		}
	}

	if (handler === 'background-replace') {
		ctx.onProgress?.({ phase: 'preparing the person model', ratio: 0.05 })
		const prepared = await prepareBackgroundReplace({
			params: readBackgroundParams(ctx.params),
			probe: ctx.probe,
			plateFile: ctx.secondaryFile,
			signal: ctx.signal,
			onProgress: (p) =>
				ctx.onProgress?.({
					phase: p.phase === 'model' ? 'downloading the person model' : 'starting the person model',
					ratio: p.ratio * 0.8,
				}),
		})
		try {
			ctx.onProgress?.({ phase: 'compositing a frame', ratio: 0.9 })
			const still = await extractThumbnail({
				source: ctx.file,
				atSeconds,
				params: { targetWidth },
				perFrame: prepared.perFrame,
				signal: ctx.signal,
			})
			return {
				...still,
				note: prepared.degraded ? 'Composited without a GPU - no light wrap or fringe clean-up.' : undefined,
			}
		} finally {
			prepared.dispose()
		}
	}

	if (handler === 'chroma-overlay') {
		ctx.onProgress?.({ phase: 'keying a frame', ratio: 0.5 })
		const prepared = await prepareChromaOverlay({
			params: readChromaOverlayParams(ctx.params),
			overlayFile: ctx.secondaryFile,
			signal: ctx.signal,
		})
		try {
			const still = await extractThumbnail({
				source: ctx.file,
				atSeconds,
				params: { targetWidth },
				perFrame: prepared.perFrame,
				signal: ctx.signal,
			})
			return {
				...still,
				note: prepared.degraded ? 'Keyed on the CPU - correct, but far slower over a whole clip.' : undefined,
			}
		} finally {
			prepared.dispose()
		}
	}

	const advanced = await buildAdvancedVisual(handler, ctx)
	if (advanced) {
		try {
			ctx.onProgress?.({ phase: 'rendering a frame', ratio: 0.6 })
			const still = await extractThumbnail({
				source: ctx.file,
				atSeconds,
				// A tool that sets its own output size - the canvas reframe, an
				// upscale - has already decided how big the frame is, and capping
				// it here would preview a different picture from the one the
				// export produces.
				params: advanced.params.targetWidth ? advanced.params : { ...advanced.params, targetWidth },
				perFrame: advanced.perFrame,
				signal: ctx.signal,
			})
			return { ...still, note: advanced.summary }
		} finally {
			advanced.dispose()
		}
	}

	const visualParams = await buildVisualParams(handler, {
		file: ctx.file,
		probe: ctx.probe,
		params: ctx.params,
		secondaryFile: ctx.secondaryFile,
		batchFiles: [],
		output: { format: 'mp4', quality: 'draft' },
		signal: ctx.signal,
		onProgress: () => {},
	})
	if (!visualParams) throw new Error(`"${tool.name}" cannot be previewed a frame at a time.`)
	return extractThumbnail({ source: ctx.file, atSeconds, params: { ...visualParams, targetWidth }, signal: ctx.signal })
}

export type { AudioOutputFormat }
