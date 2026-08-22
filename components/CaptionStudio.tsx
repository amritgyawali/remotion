'use client'

import dynamic from 'next/dynamic'
import type { PlayerRef } from '@remotion/player'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { compileProject } from '../lib/compiler'
import { downloadBlobUrl, formatSeconds } from '../lib/format'
import { useRenderController } from '../lib/use-render-controller'
import {
	cuesFromPlainText,
	cuesFromSubtitleFile,
	cuesToPlainText,
	cuesToSrt,
	cuesToVtt,
	enforceReadability,
	makeCue,
	mergeCues,
	normalizeCues,
	regroupCues,
	scriptMixOf,
	shiftCues,
	splitCue,
	updateCue,
} from '../lib/captions/cues'
import { captionProject, captionSourceFor, downloadFileName, planComposition } from '../lib/captions/project'
import { DEFAULT_CAPTION_STYLE, DEFAULT_LAYOUT, presetById } from '../lib/captions/style-presets'
import {
	checkWhisperSupport,
	loadedWhisperModels,
	profileById,
	runTranscription,
	TranscriptionCancelled,
	type SpeechProfile,
	type WhisperSupport,
} from '../lib/captions/transcribe'
import { cloudAsrStatus } from '../lib/captions/cloud-transcribe'
import type { CloudAsrStatus } from '../lib/captions/asr-models'
import { isVideoFile, probeVideo, releaseVideoSource } from '../lib/captions/video-source'
import type {
	CaptionCue,
	CaptionLayoutOptions,
	CaptionStyle,
	CaptionStylePresetId,
	CaptionVideoSource,
	ScriptMix,
	TranscribeEngine,
	TranscribeProgress,
	TranscriptOrigin,
	WhisperModelId,
} from '../lib/captions/types'
import type { CompileResult, RenderSettings, VirtualProject } from '../lib/types'
import CaptionDesignPanel from './captions/CaptionDesignPanel'
import CaptionExportPanel from './captions/CaptionExportPanel'
import CaptionSourcePanel, { type TranscriptMode } from './captions/CaptionSourcePanel'
import CaptionTopBar from './captions/CaptionTopBar'
import CueTrack from './captions/CueTrack'
import { IconAlert, IconCaptions, IconSpinner } from './Icons'

const CaptionPlayer = dynamic(() => import('./captions/CaptionPlayer'), {
	ssr: false,
	loading: () => (
		<div className="stage-empty">
			<IconSpinner size={22} />
		</div>
	),
})

const INITIAL_SETTINGS: RenderSettings = {
	engine: 'browser',
	preset: 'high',
	format: 'mp4',
	audioEnabled: true,
	scale: 1,
	previewSeconds: 0,
}

const IDLE_TRANSCRIBE: TranscribeProgress = { stage: 'idle', progress: 0 }

const FPS_CHOICES = [24, 25, 30, 50, 60]

/**
 * Container metadata often reports a measured average like 30.66 fps. Snapping
 * to the standard rate it is clearly meant to be keeps the timeline honest and
 * the fps menu free of one-off entries.
 */
function timelineFps(detected: number): number {
	const closest = FPS_CHOICES.reduce((best, option) =>
		Math.abs(option - detected) < Math.abs(best - detected) ? option : best,
	)
	if (Math.abs(closest - detected) <= 1.5) return closest
	const rounded = Math.round(detected)
	return rounded >= 12 && rounded <= 120 ? rounded : 30
}

function downloadText(text: string, fileName: string, mimeType: string): void {
	const url = URL.createObjectURL(new Blob([text], { type: mimeType }))
	downloadBlobUrl(url, fileName)
	setTimeout(() => URL.revokeObjectURL(url), 4000)
}

function cueListsEqual(left: CaptionCue[], right: CaptionCue[]): boolean {
	return (
		left.length === right.length &&
		left.every((cue, index) => {
			const other = right[index]
			return (
				cue.id === other?.id &&
				cue.text === other.text &&
				cue.startMs === other.startMs &&
				cue.endMs === other.endMs
			)
		})
	)
}

export default function CaptionStudio() {
	const [video, setVideo] = useState<CaptionVideoSource | null>(null)
	const [videoError, setVideoError] = useState<string | null>(null)
	const [fps, setFps] = useState(30)
	const [cues, setCues] = useState<CaptionCue[]>([])
	const [origin, setOrigin] = useState<TranscriptOrigin>('none')
	const [style, setStyle] = useState<CaptionStyle>(DEFAULT_CAPTION_STYLE)
	const [layout, setLayout] = useState<CaptionLayoutOptions>(DEFAULT_LAYOUT)
	const [handEdited, setHandEdited] = useState(false)

	const [mode, setMode] = useState<TranscriptMode>('auto')
	const [transcriptText, setTranscriptText] = useState('')
	// Nepali + English code-switching is this studio's primary case, so the
	// multilingual small model - the one that actually holds up on Nepali - is
	// the default rather than something the user has to discover.
	const [speechProfile, setSpeechProfile] = useState<SpeechProfile['id']>('nepali-english')
	const [whisperModel, setWhisperModel] = useState<WhisperModelId>(profileById('nepali-english').model)
	const [whisperLanguage, setWhisperLanguage] = useState(profileById('nepali-english').language)
	const [whisperSupport, setWhisperSupport] = useState<WhisperSupport | null>(null)
	const [loadedModels, setLoadedModels] = useState<WhisperModelId[]>([])
	// The cloud engine leads by default: it needs no download, no
	// SharedArrayBuffer and no fast machine, and `auto` still falls back to the
	// on-device model whenever the server has no key or NVIDIA cannot be reached.
	const [engine, setEngine] = useState<TranscribeEngine>('auto')
	const [cloudStatus, setCloudStatus] = useState<CloudAsrStatus | null>(null)
	const [cloudModel, setCloudModel] = useState<string | null>(null)
	const [polish, setPolish] = useState(true)
	const [engineUsed, setEngineUsed] = useState<'nvidia' | 'device' | null>(null)
	const [transcribing, setTranscribing] = useState(false)
	const [transcribeProgress, setTranscribeProgress] = useState<TranscribeProgress>(IDLE_TRANSCRIBE)
	const [transcribeError, setTranscribeError] = useState<string | null>(null)
	const [transcribeNotice, setTranscribeNotice] = useState<string | null>(null)

	const [compiled, setCompiled] = useState<{ project: VirtualProject; result: CompileResult } | null>(
		null,
	)
	const [compiling, setCompiling] = useState(false)
	const [compileError, setCompileError] = useState<string | null>(null)
	const [tab, setTab] = useState<'design' | 'export'>('design')
	const [currentFrame, setCurrentFrame] = useState(0)
	const [isolated, setIsolated] = useState(false)
	const [placingCaption, setPlacingCaption] = useState(false)
	const [cueHistory, setCueHistory] = useState({ canUndo: false, canRedo: false })

	const playerRef = useRef<PlayerRef | null>(null)
	const transcribeAbortRef = useRef<AbortController | null>(null)
	// Object URLs are revoked outside the state updater: React may call an updater
	// twice, and freeing the previous clip is a side effect, not a state change.
	const videoRef = useRef<CaptionVideoSource | null>(null)
	const cuesRef = useRef<CaptionCue[]>([])
	const cueHistoryRef = useRef<{ past: CaptionCue[][]; future: CaptionCue[][] }>({
		past: [],
		future: [],
	})
	cuesRef.current = cues
	const render = useRenderController(INITIAL_SETTINGS)
	const { reset: resetRender, startRender } = render

	const clearCueHistory = useCallback(() => {
		cueHistoryRef.current = { past: [], future: [] }
		setCueHistory({ canUndo: false, canRedo: false })
	}, [])

	const commitCues = useCallback((update: (current: CaptionCue[]) => CaptionCue[]) => {
		const current = cuesRef.current
		const next = update(current)
		if (cueListsEqual(current, next)) return
		const history = cueHistoryRef.current
		history.past = [...history.past, current].slice(-80)
		history.future = []
		cuesRef.current = next
		setCues(next)
		setCueHistory({ canUndo: true, canRedo: false })
	}, [])

	const handleCueUndo = useCallback(() => {
		const history = cueHistoryRef.current
		const previous = history.past.at(-1)
		if (!previous) return
		history.past = history.past.slice(0, -1)
		history.future = [...history.future, cuesRef.current].slice(-80)
		cuesRef.current = previous
		setCues(previous)
		setHandEdited(true)
		setCueHistory({ canUndo: history.past.length > 0, canRedo: true })
	}, [])

	const handleCueRedo = useCallback(() => {
		const history = cueHistoryRef.current
		const next = history.future.at(-1)
		if (!next) return
		history.future = history.future.slice(0, -1)
		history.past = [...history.past, cuesRef.current].slice(-80)
		cuesRef.current = next
		setCues(next)
		setHandEdited(true)
		setCueHistory({ canUndo: true, canRedo: history.future.length > 0 })
	}, [])

	const durationMs = video ? Math.round(video.durationInSeconds * 1000) : 0
	const plan = useMemo(() => (video ? planComposition(video, fps) : null), [video, fps])

	const source = useMemo(() => {
		if (!video || !plan) return ''
		return captionSourceFor({ video, cues, style, plan, origin })
	}, [cues, origin, plan, style, video])

	// The compiler only re-runs when the timeline itself changes; cue and style
	// edits are pushed through defaultProps so the preview never reloads the video.
	const sourceRef = useRef(source)
	sourceRef.current = source
	const structuralKey = plan && video ? `${video.url}|${plan.width}x${plan.height}|${plan.fps}|${plan.durationInFrames}` : ''

	useEffect(() => {
		setIsolated(typeof window !== 'undefined' && window.crossOriginIsolated === true)
	}, [])

	useEffect(() => {
		let active = true
		checkWhisperSupport(whisperModel).then((support) => {
			if (active) setWhisperSupport(support)
		})
		loadedWhisperModels().then((models) => {
			if (active) setLoadedModels(models)
		})
		return () => {
			active = false
		}
	}, [whisperModel])

	// Whether the server holds an NVIDIA key decides what "Auto" does, so it is
	// asked once on mount rather than at the moment the user presses the button.
	useEffect(() => {
		let active = true
		cloudAsrStatus().then((status) => {
			if (active) setCloudStatus(status)
		})
		return () => {
			active = false
		}
	}, [])

	useEffect(() => {
		if (!structuralKey) {
			setCompiled(null)
			setCompileError(null)
			return
		}
		let active = true
		setCompiling(true)
		setCompileError(null)
		const project = captionProject(sourceRef.current, 'captioned-video')
		compileProject(project)
			.then((result) => {
				if (!active) return
				setCompiled({ project, result })
			})
			.catch((error: unknown) => {
				if (!active) return
				setCompiled(null)
				setCompileError(error instanceof Error ? error.message : String(error))
			})
			.finally(() => {
				if (active) setCompiling(false)
			})
		return () => {
			active = false
		}
	}, [structuralKey])

	const composition = useMemo(() => {
		const base = compiled?.result.compositions[0]
		if (!base || !video) return null
		return {
			...base,
			defaultProps: { src: video.url, captions: cues, captionStyle: style },
		}
	}, [compiled, cues, style, video])

	// What the transcript is actually made of, measured rather than assumed -
	// drives both the font-stack warning and the auto-enable below.
	const scriptMix = useMemo<ScriptMix>(() => scriptMixOf(cues), [cues])

	const currentMs = composition ? (currentFrame / composition.fps) * 1000 : 0

	const seekToMsRef = useRef<(ms: number) => void>(() => {})

	const seekToMs = useCallback(
		(ms: number) => {
			if (!composition) return
			const frame = Math.max(
				0,
				Math.min(composition.durationInFrames - 1, Math.round((ms / 1000) * composition.fps)),
			)
			playerRef.current?.seekTo(frame)
			setCurrentFrame(frame)
		},
		[composition],
	)
	seekToMsRef.current = seekToMs

	/**
	 * Every transcript path lands here, so a fresh set of cues always leaves the
	 * studio in the same state - and the preview parks on the first caption
	 * instead of on a frame where nothing is on screen yet.
	 */
	const applyCues = useCallback(
		(next: CaptionCue[], nextOrigin: TranscriptOrigin) => {
			const bounded = normalizeCues(next, durationMs || Number.MAX_SAFE_INTEGER)
			// Readability pass: a transcriber-timed cue can be 150ms long, which
			// reads as a flash. Stretch into the following silence, never into the
			// next line, so short lines get a comfortable hold.
			const normalized = normalizeCues(
				enforceReadability(bounded, {
					minCueMs: layout.minCueMs,
					durationMs: durationMs || Number.MAX_SAFE_INTEGER,
				}),
				durationMs || Number.MAX_SAFE_INTEGER,
			)
			cuesRef.current = normalized
			setCues(normalized)
			clearCueHistory()
			setOrigin(nextOrigin)
			setHandEdited(false)
			// The written script keeps the author's own paragraphs; the other two
			// paths fill the box so the transcript is there to copy or rework.
			if (nextOrigin !== 'text') setTranscriptText(cuesToPlainText(normalized))
			// Devanagari detected in the transcript but the companion face is off:
			// turn it on so the export never ships tofu boxes for Nepali text.
			const mix = scriptMixOf(normalized)
			if (mix.devanagari) {
				setStyle((current) => (current.devanagari ? current : { ...current, devanagari: true }))
			}
			const first = normalized[0]
			if (first) seekToMsRef.current(first.startMs + (first.endMs - first.startMs) / 2)
		},
		[clearCueHistory, durationMs, layout.minCueMs],
	)

	/* ------------------------------------------------------------- video */

	const adoptVideo = useCallback(
		async (input: { file?: File; url?: string }) => {
			setVideoError(null)
			try {
				const next = await probeVideo(input)
				const previous = videoRef.current
				videoRef.current = next
				setVideo(next)
				if (previous) releaseVideoSource(previous)
				setFps(timelineFps(next.fps))
				cuesRef.current = []
				setCues([])
				clearCueHistory()
				setOrigin('none')
				setHandEdited(false)
				setTranscriptText('')
				setTranscribeProgress(IDLE_TRANSCRIBE)
				setTranscribeError(null)
				setTranscribeNotice(null)
				setEngineUsed(null)
				setCurrentFrame(0)
				resetRender()
			} catch (error) {
				setVideoError(error instanceof Error ? error.message : String(error))
			}
		},
		[clearCueHistory, resetRender],
	)

	const handleVideoFiles = useCallback(
		(files: File[]) => {
			const file = files.find(isVideoFile) ?? files[0]
			if (!file) return
			if (!isVideoFile(file)) {
				setVideoError(`${file.name} is not a video file. Drop an MP4, MOV or WebM.`)
				return
			}
			void adoptVideo({ file })
		},
		[adoptVideo],
	)

	const handleVideoUrl = useCallback(
		(url: string) => {
			void adoptVideo({ url })
		},
		[adoptVideo],
	)

	const handleClearVideo = useCallback(() => {
		transcribeAbortRef.current?.abort()
		const previous = videoRef.current
		videoRef.current = null
		setVideo(null)
		if (previous) releaseVideoSource(previous)
		cuesRef.current = []
		setCues([])
		clearCueHistory()
		setOrigin('none')
		setHandEdited(false)
		setTranscriptText('')
		setTranscribeProgress(IDLE_TRANSCRIBE)
		setTranscribeError(null)
		setTranscribeNotice(null)
		setEngineUsed(null)
		setCompiled(null)
		resetRender()
		setPlacingCaption(false)
	}, [clearCueHistory, resetRender])

	useEffect(() => {
		return () => {
			transcribeAbortRef.current?.abort()
		}
	}, [])

	/* -------------------------------------------------------- transcript */

	const handleTranscribe = useCallback(async () => {
		if (!video) return
		const controller = new AbortController()
		transcribeAbortRef.current = controller
		setTranscribing(true)
		setTranscribeError(null)
		setTranscribeNotice(null)
		setEngineUsed(null)
		setTranscribeProgress({ stage: 'checking', progress: 0, message: 'Choosing a speech engine' })

		try {
			const outcome = await runTranscription({
				video,
				engine,
				language: whisperLanguage,
				whisperModel,
				cloudModel,
				layout,
				polish,
				onProgress: setTranscribeProgress,
				signal: controller.signal,
			})

			applyCues(outcome.cues, outcome.origin)
			setEngineUsed(outcome.engine)
			setTranscribeNotice(outcome.notice ?? null)
			if (outcome.engine === 'device') setLoadedModels(await loadedWhisperModels())
			// A cloud run says nothing about this browser's on-device support, but
			// a device run just proved it either way.
			if (outcome.engine === 'device') setWhisperSupport(await checkWhisperSupport(whisperModel))
		} catch (error) {
			if (error instanceof TranscriptionCancelled || controller.signal.aborted) {
				setTranscribeProgress({ stage: 'cancelled', progress: 0, message: 'Cancelled' })
			} else {
				setTranscribeError(error instanceof Error ? error.message : String(error))
				setTranscribeProgress({ stage: 'error', progress: 0 })
			}
		} finally {
			transcribeAbortRef.current = null
			setTranscribing(false)
		}
	}, [applyCues, cloudModel, engine, layout, polish, video, whisperLanguage, whisperModel])

	const handleAutoTime = useCallback(() => {
		if (!video || !transcriptText.trim()) return
		applyCues(cuesFromPlainText(transcriptText, { durationMs, layout }), 'text')
	}, [applyCues, durationMs, layout, transcriptText, video])

	const handleImportSubtitles = useCallback(
		async (file: File) => {
			try {
				const parsed = cuesFromSubtitleFile(await file.text())
				if (parsed.length === 0) {
					setTranscribeError(`${file.name} has no readable cues. Export it as .srt or .vtt.`)
					return
				}
				applyCues(parsed, 'srt')
				setTranscribeError(null)
			} catch (error) {
				setTranscribeError(error instanceof Error ? error.message : String(error))
			}
		},
		[applyCues],
	)

	const handleRegroup = useCallback(() => {
		commitCues((current) => normalizeCues(regroupCues(current, layout), durationMs))
		setHandEdited(false)
	}, [commitCues, durationMs, layout])

	const handleSpeechProfile = useCallback((id: SpeechProfile['id']) => {
		const profile = profileById(id)
		setSpeechProfile(id)
		setWhisperModel(profile.model)
		setWhisperLanguage(profile.language)
	}, [])

	/* --------------------------------------------------------- cue edits */

	const handleCueUpdate = useCallback(
		(
			id: string,
			patch: { text?: string; startMs?: number; endMs?: number; overwrite?: boolean },
		) => {
			setHandEdited(true)
			commitCues((current) => {
				const { overwrite, ...cuePatch } = patch
				const original = current.find((cue) => cue.id === id)
				if (!original) return current
				const target = updateCue(original, cuePatch)
				if (!overwrite) {
					return normalizeCues(
						current.map((cue) => (cue.id === id ? target : cue)),
						durationMs,
					)
				}

				// Overwrite editing keeps the dragged caption exactly under the mouse.
				// Neighboring captions are trimmed only where they intersect it.
				const frameMs = 1000 / Math.max(1, fps)
				const next = current.flatMap((cue) => {
					if (cue.id === id) return [target]
					if (cue.endMs <= target.startMs || cue.startMs >= target.endMs) return [cue]
					if (cue.startMs < target.startMs && cue.endMs > target.startMs) {
						const endMs = target.startMs - frameMs
						return endMs >= cue.startMs + frameMs ? [updateCue(cue, { endMs })] : []
					}
					if (cue.startMs < target.endMs && cue.endMs > target.endMs) {
						const startMs = target.endMs + frameMs
						return startMs <= cue.endMs - frameMs ? [updateCue(cue, { startMs })] : []
					}
					return []
				})
				return normalizeCues(next, durationMs)
			})
		},
		[commitCues, durationMs, fps],
	)

	const handleCueSplit = useCallback(
		(id: string, atMs?: number) => {
			setHandEdited(true)
			commitCues((current) =>
				normalizeCues(
					current.flatMap((cue) => {
						if (cue.id !== id) return [cue]
						let tokenIndex = Math.ceil(cue.tokens.length / 2)
						if (atMs !== undefined && atMs > cue.startMs && atMs < cue.endMs && cue.tokens.length > 1) {
							tokenIndex = cue.tokens
								.map((token, index) => ({ index, distance: Math.abs(token.fromMs - atMs) }))
								.filter(({ index }) => index > 0)
								.sort((left, right) => left.distance - right.distance)[0]?.index ?? tokenIndex
						}
						return splitCue(cue, tokenIndex)
					}),
					durationMs,
				),
			)
		},
		[commitCues, durationMs],
	)

	const handleCueMerge = useCallback(
		(id: string) => {
			setHandEdited(true)
			commitCues((current) => {
				const index = current.findIndex((cue) => cue.id === id)
				if (index === -1 || index === current.length - 1) return current
				const merged = mergeCues(current[index], current[index + 1])
				const next = [...current]
				next.splice(index, 2, merged)
				return normalizeCues(next, durationMs)
			})
		},
		[commitCues, durationMs],
	)

	const handleCueDelete = useCallback(
		(id: string) => {
			setHandEdited(true)
			commitCues((current) => current.filter((cue) => cue.id !== id))
		},
		[commitCues],
	)

	const handleCueAdd = useCallback(
		(atMs?: number) => {
			setHandEdited(true)
			commitCues((current) => {
				const frameMs = 1000 / Math.max(1, fps)
				let startMs = atMs ?? (current.length > 0 ? current[current.length - 1].endMs + frameMs : 0)
				const coveringCue = current.find((cue) => startMs >= cue.startMs && startMs < cue.endMs)
				if (coveringCue) startMs = coveringCue.endMs + frameMs
				startMs = Math.max(0, Math.min(Math.max(0, durationMs - frameMs), startMs))
				const nextCue = current.find((cue) => cue.startMs > startMs)
				const availableEnd = nextCue ? nextCue.startMs - frameMs : durationMs || startMs + 1500
				const endMs = Math.max(startMs + frameMs, Math.min(startMs + 1500, availableEnd))
				return normalizeCues([...current, makeCue('New caption', startMs, endMs)], durationMs)
			})
		},
		[commitCues, durationMs, fps],
	)

	const handleCueDuplicate = useCallback(
		(id: string) => {
			setHandEdited(true)
			commitCues((current) => {
				const cue = current.find((item) => item.id === id)
				if (!cue) return current
				const frameMs = 1000 / Math.max(1, fps)
				const duration = cue.endMs - cue.startMs
				const startMs = Math.min(Math.max(0, durationMs - frameMs), cue.endMs + frameMs)
				const endMs = Math.min(durationMs || startMs + duration, startMs + duration)
				return normalizeCues([...current, makeCue(cue.text, startMs, endMs)], durationMs)
			})
		},
		[commitCues, durationMs, fps],
	)

	const handleShiftAll = useCallback(
		(deltaMs: number) => {
			setHandEdited(true)
			commitCues((current) => shiftCues(current, deltaMs, durationMs))
		},
		[commitCues, durationMs],
	)

	/* -------------------------------------------------------------- style */

	const handleStyle = useCallback((patch: Partial<CaptionStyle>) => {
		setStyle((current) => ({ ...current, ...patch }))
	}, [])

	const handlePreviewPlacement = useCallback((clientY: number, top: number, height: number) => {
		const ratio = Math.max(0, Math.min(1, (clientY - top) / Math.max(1, height)))
		if (ratio < 0.4) {
			setStyle((current) => ({
				...current,
				placement: 'top',
				offsetPercent: Math.max(0, Math.min(45, Math.round(ratio * 1000) / 10)),
			}))
		} else if (ratio > 0.6) {
			setStyle((current) => ({
				...current,
				placement: 'bottom',
				offsetPercent: Math.max(0, Math.min(45, Math.round((1 - ratio) * 1000) / 10)),
			}))
		} else {
			setStyle((current) => ({ ...current, placement: 'center' }))
		}
		setPlacingCaption(false)
	}, [])

	const handlePreset = useCallback(
		(id: CaptionStylePresetId) => {
			const preset = presetById(id)
			setStyle(preset.style)
			// A preset also carries the line length it was designed for, but never
			// at the cost of cues that were split or rewritten by hand.
			if (!handEdited) {
				setLayout(preset.layout)
				commitCues((current) =>
					current.length > 0
						? normalizeCues(regroupCues(current, preset.layout), durationMs)
						: current,
				)
			}
		},
		[commitCues, durationMs, handEdited],
	)

	const handleLayout = useCallback((patch: Partial<CaptionLayoutOptions>) => {
		setLayout((current) => ({ ...current, ...patch }))
	}, [])

	/* ------------------------------------------------------------ export */

	const handleRender = useCallback(() => {
		if (!composition || !video || !plan) return
		const project = captionProject(source, video.name)
		const extension = render.settings.format === 'webm' ? 'webm' : 'mp4'
		void startRender({
			project,
			composition,
			fileName: downloadFileName(video, extension),
		})
	}, [composition, plan, render.settings.format, source, startRender, video])

	const handleDownloadSrt = useCallback(() => {
		if (!video) return
		downloadText(cuesToSrt(cues), downloadFileName(video, 'srt'), 'application/x-subrip')
	}, [cues, video])

	const handleDownloadVtt = useCallback(() => {
		if (!video) return
		downloadText(cuesToVtt(cues), downloadFileName(video, 'vtt'), 'text/vtt')
	}, [cues, video])

	const handleDownloadSource = useCallback(() => {
		if (!video || !source) return
		downloadText(source, downloadFileName(video, 'tsx'), 'text/plain')
	}, [source, video])

	const handleReset = useCallback(() => {
		handleClearVideo()
		setStyle(DEFAULT_CAPTION_STYLE)
		setLayout(DEFAULT_LAYOUT)
		setMode('auto')
	}, [handleClearVideo])

	const busy = transcribing || render.rendering

	return (
		<div className="app">
			<CaptionTopBar
				steps={[
					{ id: 'video', label: 'Video', done: video !== null },
					{ id: 'transcript', label: 'Transcript', done: cues.length > 0 },
					{ id: 'design', label: 'Design', done: cues.length > 0 && tab === 'export' },
					{ id: 'render', label: 'Render', done: render.output !== null },
				]}
				engine={render.settings.engine}
				capabilities={render.capabilities}
				webCodecs={render.webCodecs}
				crossOriginIsolated={isolated}
				onReset={handleReset}
				canReset={video !== null}
			/>

			<div className="workspace workspace--captions">
				<CaptionSourcePanel
					video={video}
					busy={busy}
					cues={cues}
					origin={origin}
					layout={layout}
					mode={mode}
					transcriptText={transcriptText}
					speechProfile={speechProfile}
					engine={engine}
					cloudStatus={cloudStatus}
					cloudModel={cloudModel}
					polish={polish}
					whisperModel={whisperModel}
					whisperLanguage={whisperLanguage}
					whisperSupport={whisperSupport}
					loadedModels={loadedModels}
					transcribing={transcribing}
					transcribeProgress={transcribeProgress}
					transcribeError={transcribeError}
					transcribeNotice={transcribeNotice}
					engineUsed={engineUsed}
					videoError={videoError}
					onVideoFiles={handleVideoFiles}
					onVideoUrl={handleVideoUrl}
					onClearVideo={handleClearVideo}
					onMode={setMode}
					onTranscriptText={setTranscriptText}
					onAutoTime={handleAutoTime}
					onImportSubtitles={(file) => void handleImportSubtitles(file)}
					onSpeechProfile={handleSpeechProfile}
					onEngine={setEngine}
					onCloudModel={setCloudModel}
					onPolish={setPolish}
					onWhisperModel={setWhisperModel}
					onWhisperLanguage={setWhisperLanguage}
					onTranscribe={() => void handleTranscribe()}
					onCancelTranscribe={() => transcribeAbortRef.current?.abort()}
					onLayout={handleLayout}
					onRegroup={handleRegroup}
				/>

				<section className="panel panel--stage">
					<div className="stage-bar">
						<span className="chip chip--static">
							<IconCaptions size={12} /> {cues.length} captions
						</span>
						{composition ? (
							<>
								<span className="chip chip--static">
									{composition.width} x {composition.height}
								</span>
								<span className="chip chip--static">
									{formatSeconds(composition.durationInFrames / composition.fps)}
								</span>
							</>
						) : null}
						<button
							className="btn btn--sm caption-place-button"
							data-active={placingCaption}
							disabled={!composition || busy}
							onClick={() => setPlacingCaption((value) => !value)}
							title="Click directly on the video to position every caption"
						>
							<IconCaptions size={12} />
							{placingCaption ? 'Cancel placement' : 'Place on video'}
						</button>
						<label className="stage-fps">
							fps
							<select
								className="select"
								value={fps}
								disabled={!video || busy}
								onChange={(event) => setFps(Number(event.target.value))}
								aria-label="Frames per second"
							>
								{Array.from(new Set([...FPS_CHOICES, fps]))
									.sort((a, b) => a - b)
									.map((option) => (
										<option key={option} value={option}>
											{option}
										</option>
									))}
							</select>
						</label>
						{compiling ? (
							<span className="badge badge--accent">
								<IconSpinner size={11} /> building preview
							</span>
						) : null}
					</div>

					<div className="stage stage--captions">
						{videoError && !composition ? (
							<div className="stage-empty">
								<span className="stage-empty-mark" style={{ color: 'var(--red)' }}>
									<IconAlert size={24} />
								</span>
								<h2>That video did not load</h2>
								<p>{videoError}</p>
							</div>
						) : compileError ? (
							<div className="stage-empty">
								<span className="stage-empty-mark" style={{ color: 'var(--red)' }}>
									<IconAlert size={24} />
								</span>
								<h2>The caption composition did not build</h2>
								<pre className="log" style={{ textAlign: 'left', marginTop: 12 }}>
									{compileError}
								</pre>
							</div>
						) : composition ? (
							<div
								className="stage-frame"
								style={{
									aspectRatio: `${composition.width} / ${composition.height}`,
									height: composition.height >= composition.width ? '100%' : 'auto',
									width: composition.height >= composition.width ? 'auto' : '100%',
								}}
							>
								<CaptionPlayer
									composition={composition}
									audioEnabled={render.settings.audioEnabled}
									playerRef={playerRef}
									onFrame={setCurrentFrame}
								/>
								{placingCaption ? (
									<button
										type="button"
										className="caption-placement-overlay"
										aria-label="Choose subtitle position on the video"
										onClick={(event) => {
											const rect = event.currentTarget.getBoundingClientRect()
											handlePreviewPlacement(event.clientY, rect.top, rect.height)
										}}
									>
										<span className="caption-placement-zone caption-placement-zone--top">TOP</span>
										<span className="caption-placement-zone caption-placement-zone--middle">MIDDLE</span>
										<span className="caption-placement-zone caption-placement-zone--bottom">BOTTOM</span>
										<span className="caption-placement-hint">Click where the subtitle should appear</span>
									</button>
								) : null}
							</div>
						) : (
							<div className="stage-empty">
								<span className="stage-empty-mark">
									<IconCaptions size={24} />
								</span>
								<h2>Drop in a video to subtitle</h2>
								<p>
									Your clip is read on this device. Generate the transcript with the on-device
									speech model, or paste your own script, then style the captions and render a
									finished video with the subtitles burned in.
								</p>
							</div>
						)}
					</div>

					{video ? (
						<CueTrack
							cues={cues}
							currentMs={currentMs}
							durationMs={durationMs}
							fps={fps}
							disabled={busy}
							canUndo={cueHistory.canUndo}
							canRedo={cueHistory.canRedo}
							onSeek={seekToMs}
							onUpdate={handleCueUpdate}
							onSplit={handleCueSplit}
							onMerge={handleCueMerge}
							onDuplicate={handleCueDuplicate}
							onDelete={handleCueDelete}
							onAdd={handleCueAdd}
							onShiftAll={handleShiftAll}
							onUndo={handleCueUndo}
							onRedo={handleCueRedo}
						/>
					) : null}
				</section>

				<aside className="panel panel--right">
					<div className="panel-tabs">
						<div className="segmented">
							<button data-active={tab === 'design'} onClick={() => setTab('design')}>
								3 - Design
							</button>
							<button data-active={tab === 'export'} onClick={() => setTab('export')}>
								4 - Render
							</button>
						</div>
					</div>
					<div className="panel-scroll">
						{tab === 'design' ? (
							<CaptionDesignPanel
								style={style}
								disabled={render.rendering}
								scriptMix={scriptMix}
								onStyle={handleStyle}
								onPreset={handlePreset}
							/>
						) : (
							<CaptionExportPanel
								render={render}
								composition={composition}
								video={video}
								cueCount={cues.length}
								onRender={handleRender}
								onDownloadSrt={handleDownloadSrt}
								onDownloadVtt={handleDownloadVtt}
								onDownloadSource={handleDownloadSource}
							/>
						)}
					</div>
				</aside>
			</div>
		</div>
	)
}
