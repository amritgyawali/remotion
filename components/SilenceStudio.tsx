'use client'

/**
 * The Silence Studio.
 *
 * One clip in, one tighter clip out, and everything in between measured rather
 * than guessed. The shape of the thing is deliberately narrow: the audio is
 * listened to once, a plan is derived from it, the plan is watchable before it
 * is written, and the finished cut can be handed straight to the Subtitle
 * Studio without touching a disk.
 *
 * All of it runs in the tab. The clip is never uploaded, the analysis never
 * leaves the machine, and the export is written by the browser's own encoder -
 * which also means a refresh at the wrong moment would otherwise cost the whole
 * session, so the workspace, the clip and even the measured level track are
 * kept in the local vault and brought back on the way in.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { downloadBlobUrl, formatSeconds } from '../lib/format'
import { isVideoFile, probeVideo, releaseVideoSource } from '../lib/captions/video-source'
import type { CaptionCue, CaptionVideoSource } from '../lib/captions/types'
import type { SpeechSegment } from '../lib/captions/vad'
import {
	AnalysisCancelled,
	NoAudioError,
	analyzeAudio,
	detectFrom,
	type AnalysisProgress,
	type AudioAnalysis,
} from '../lib/silence/analyze'
import {
	CUT_PRESETS,
	DEFAULT_CUT_SETTINGS,
	buildPlan,
	formatSpan,
	remapCues,
	type CutSettings,
	type GapOverrides,
	type SilenceAction,
} from '../lib/silence/plan'
import {
	RenderCancelled,
	cutFileName,
	renderCutVideo,
	type RenderProgress,
	type SilenceRenderResult,
} from '../lib/silence/render'
import {
	DEFAULT_EXPORT_SETTINGS,
	SILENCE_LEVELS_BLOB_ID,
	SILENCE_SESSION_KEY,
	SILENCE_SESSION_VERSION,
	SILENCE_VIDEO_BLOB_ID,
	analysisFacts,
	analysisFromFacts,
	levelsFromBlob,
	levelsToBlob,
	normalizeSilenceSession,
	type ExportSettings,
	type SilenceSession,
} from '../lib/silence/session'
import { readBlob, removeBlob, requestPersistentStorage, writeBlob } from '../lib/persist/idb'
import { useAutosave, useRestoredSnapshot } from '../lib/persist/use-vault'
import { sendToStudio, useIncomingHandoff } from '../lib/handoff'
import { useCloud } from '../lib/cloud/use-cloud'
import { useCloudMedia } from '../lib/cloud/use-cloud-media'
import { useCloudProjectAutosave } from '../lib/cloud/use-project-autosave'
import { runSpliceInCloud } from '../lib/cloud/run-tool'
import { MAX_CLOUD_SPLICES, cloudSpliceLimitReason } from '../lib/cloud/transform'
import CloudProjectsPanel from './cloud/CloudProjectsPanel'
import SilenceTopBar from './silence/SilenceTopBar'
import SilenceSourcePanel from './silence/SilenceSourcePanel'
import SilenceTimeline from './silence/SilenceTimeline'
import SilencePreview from './silence/SilencePreview'
import SilenceExportPanel from './silence/SilenceExportPanel'
import { RestoreNotice } from './SaveState'
import {
	IconCaptions,
	IconCheck,
	IconClose,
	IconDownload,
	IconScissors,
	IconSliders,
	IconSpinner,
	IconWaveform,
} from './Icons'

type Pane = 'source' | 'preview' | 'export'

const SILENCE_PANES: Array<{ id: Pane; label: string; icon: typeof IconScissors }> = [
	{ id: 'source', label: 'Detect', icon: IconSliders },
	{ id: 'preview', label: 'Preview', icon: IconWaveform },
	{ id: 'export', label: 'Export', icon: IconDownload },
]

/** Two settings objects are the same preset only if every field matches. */
function presetIdOf(settings: CutSettings): string | null {
	const match = CUT_PRESETS.find((preset) =>
		(Object.keys(preset.settings) as Array<keyof CutSettings>).every(
			(key) => preset.settings[key] === settings[key],
		),
	)
	return match?.id ?? null
}

export default function SilenceStudio() {
	/* ------------------------------------------------------------- state */

	const [video, setVideo] = useState<CaptionVideoSource | null>(null)
	const [videoBanked, setVideoBanked] = useState(false)
	const [videoBlobId, setVideoBlobId] = useState<string | null>(null)

	const [analysis, setAnalysis] = useState<AudioAnalysis | null>(null)
	const [restoredSpeech, setRestoredSpeech] = useState<SpeechSegment[]>([])
	const [analyzing, setAnalyzing] = useState(false)
	const [analysisProgress, setAnalysisProgress] = useState<AnalysisProgress | null>(null)
	const [analysisError, setAnalysisError] = useState<string | null>(null)

	const [settings, setSettings] = useState<CutSettings>(DEFAULT_CUT_SETTINGS)
	const [overrides, setOverrides] = useState<GapOverrides>({})
	const [selectedGap, setSelectedGap] = useState<number | null>(null)

	const [sourceMs, setSourceMs] = useState(0)
	const [seekNonce, setSeekNonce] = useState(0)
	const [previewOriginal, setPreviewOriginal] = useState(false)

	const [exportSettings, setExportSettings] = useState<ExportSettings>(DEFAULT_EXPORT_SETTINGS)
	const cloud = useCloud()
	const { asset: cloudAsset, error: cloudMediaError, setAsset: setCloudAsset } = useCloudMedia({
		cloud,
		file: video?.file ?? null,
	})
	useEffect(() => {
		if (cloud.location === 'cloud' && cloudMediaError) setAnalysisError(`Cloud upload: ${cloudMediaError}`)
	}, [cloud.location, cloudMediaError])
	const [cloudNote, setCloudNote] = useState<string | null>(null)
	const [rendering, setRendering] = useState(false)
	const [renderProgress, setRenderProgress] = useState<RenderProgress | null>(null)
	const [renderResult, setRenderResult] = useState<SilenceRenderResult | null>(null)
	const [renderError, setRenderError] = useState<string | null>(null)

	const [cues, setCues] = useState<CaptionCue[]>([])
	const [sendState, setSendState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle')
	const [pane, setPane] = useState<Pane>('preview')
	const [webCodecs, setWebCodecs] = useState(true)
	const [restoreSummary, setRestoreSummary] = useState<string | null>(null)
	const [restoreWarning, setRestoreWarning] = useState<string | null>(null)
	const [restoredAt, setRestoredAt] = useState<number | null>(null)

	const analysisAbortRef = useRef<AbortController | null>(null)
	const renderAbortRef = useRef<AbortController | null>(null)
	const analyzeRef = useRef<(source: Blob, hint: number) => void>(() => {})

	useEffect(() => {
		setWebCodecs(typeof window !== 'undefined' && typeof window.VideoEncoder !== 'undefined')
	}, [])

	/* --------------------------------------------------------- the plan */

	const durationMs = useMemo(() => {
		if (video) return video.durationInSeconds * 1000
		return analysis?.durationMs ?? 0
	}, [analysis, video])

	const detection = useMemo(
		() => (analysis ? detectFrom(analysis, settings) : null),
		[analysis, settings],
	)
	const activeSpeech = analysis ? (detection?.speech ?? []) : restoredSpeech
	const speechRatio = durationMs > 0
		? activeSpeech.reduce((total, segment) => total + segment.endMs - segment.startMs, 0) / durationMs
		: 0

	const plan = useMemo(
		() =>
			buildPlan({
				speech: activeSpeech,
				durationMs,
				settings,
				overrides,
			}),
		[activeSpeech, durationMs, overrides, settings],
	)

	const activePreset = useMemo(() => presetIdOf(settings), [settings])

	/* ---------------------------------------------------------- analysis */

	const runAnalysis = useCallback((source: Blob, durationHintSeconds: number) => {
		analysisAbortRef.current?.abort()
		const controller = new AbortController()
		analysisAbortRef.current = controller

		setAnalyzing(true)
		setAnalysisError(null)
		setAnalysisProgress({ phase: 'decoding', ratio: 0, secondsDone: 0 })

		void (async () => {
			try {
				const measured = await analyzeAudio({
					source,
					durationHintSeconds,
					signal: controller.signal,
					onProgress: setAnalysisProgress,
				})
				if (controller.signal.aborted) return
				setAnalysis(measured)
				// The level track outlives the session: writing it here is what lets a
				// refresh come back with the waveform already drawn.
				void writeBlob(SILENCE_LEVELS_BLOB_ID, levelsToBlob(measured.frameDb), 'levels.bin')
			} catch (error) {
				if (error instanceof AnalysisCancelled || controller.signal.aborted) return
				setAnalysis(null)
				setRestoredSpeech([])
				setAnalysisError(
					error instanceof NoAudioError
						? 'That file has no audio track, so there is no silence to find. Upload a clip with sound.'
						: error instanceof Error
							? error.message
							: String(error),
				)
			} finally {
				if (analysisAbortRef.current === controller) {
					setAnalyzing(false)
					setAnalysisProgress(null)
					analysisAbortRef.current = null
				}
			}
		})()
	}, [])

	analyzeRef.current = runAnalysis

	const cancelAnalysis = useCallback(() => {
		analysisAbortRef.current?.abort()
		analysisAbortRef.current = null
		setAnalyzing(false)
		setAnalysisProgress(null)
	}, [])

	/* ------------------------------------------------------------- video */

	const loadVideo = useCallback(
		async (file: File, options: { cues?: CaptionCue[]; analyse?: boolean } = {}) => {
			setAnalysisError(null)
			setRenderResult(null)
			setRenderError(null)
			setSendState('idle')
			try {
				const next = await probeVideo({ file })
				setVideo((current) => {
					releaseVideoSource(current)
					return next
				})
				setAnalysis(null)
				setOverrides({})
				setSelectedGap(null)
				setSourceMs(0)
				setSeekNonce((value) => value + 1)
				setCues(options.cues ?? [])

				void requestPersistentStorage()
				setVideoBanked(false)
				const stored = await writeBlob(SILENCE_VIDEO_BLOB_ID, file, next.name)
				setVideoBlobId(stored ? SILENCE_VIDEO_BLOB_ID : null)
				setVideoBanked(stored)
				void removeBlob(SILENCE_LEVELS_BLOB_ID)

				if (options.analyse !== false) analyzeRef.current(file, next.durationInSeconds)
			} catch (error) {
				setAnalysisError(error instanceof Error ? error.message : String(error))
			}
		},
		[],
	)

	const handleVideoFiles = useCallback(
		(files: File[]) => {
			const file = files.find(isVideoFile) ?? files[0]
			if (!file) return
			if (!isVideoFile(file)) {
				setAnalysisError(`${file.name} is not a video file. Drop an MP4, MOV or WebM.`)
				return
			}
			void loadVideo(file)
		},
		[loadVideo],
	)

	const handleClearVideo = useCallback(() => {
		cancelAnalysis()
		renderAbortRef.current?.abort()
		setVideo((current) => {
			releaseVideoSource(current)
			return null
		})
		setAnalysis(null)
		setRestoredSpeech([])
		setOverrides({})
		setSelectedGap(null)
		setSourceMs(0)
		setCues([])
		setRenderResult((current) => {
			if (current) URL.revokeObjectURL(current.url)
			return null
		})
		setRenderError(null)
		setSendState('idle')
		setVideoBanked(false)
		setVideoBlobId(null)
		setCloudAsset(null)
		void removeBlob(SILENCE_VIDEO_BLOB_ID)
		void removeBlob(SILENCE_LEVELS_BLOB_ID)
	}, [cancelAnalysis, setCloudAsset])

	/* --------------------------------------------------------- settings */

	const patchSettings = useCallback((patch: Partial<CutSettings>) => {
		setSettings((current) => ({ ...current, ...patch }))
	}, [])

	const applyPreset = useCallback((id: string) => {
		const preset = CUT_PRESETS.find((entry) => entry.id === id)
		if (!preset) return
		setSettings({ ...preset.settings })
		// A preset is a fresh opinion about the whole clip; keeping hand
		// decisions from a previous one would make it lie about what it does.
		setOverrides({})
		setSelectedGap(null)
	}, [])

	const handleGapAction = useCallback((key: number, action: SilenceAction) => {
		setOverrides((current) => ({ ...current, [String(key)]: action }))
	}, [])

	const seekSource = useCallback((ms: number) => {
		setSourceMs(ms)
		setSeekNonce((value) => value + 1)
	}, [])

	/* ------------------------------------------------------------ export */

	/**
	 * The cut, as a list of stretches to keep.
	 *
	 * The on-device renderer walks the plan's segments directly; the cloud wants
	 * seconds and a speed per kept stretch, and nothing else. Dropped segments
	 * simply never appear, which is what makes the splice a cut.
	 */
	const cloudSegments = useMemo(
		() =>
			plan.segments
				.filter((segment) => segment.mode !== 'drop')
				.map((segment) => ({
					startSec: segment.sourceStartMs / 1000,
					endSec: segment.sourceEndMs / 1000,
					speed: segment.speed,
				})),
		[plan],
	)

	/** Why the cloud cannot take this particular cut, or null when it can. */
	const cloudRefusal = useMemo(() => {
		if (!video) return 'Load a clip first.'
		if (exportSettings.scale !== 1) {
			return 'The cloud export keeps the source resolution, so clear the downscale to use it.'
		}
		return cloudSpliceLimitReason(cloudSegments.length)
	}, [cloudSegments.length, exportSettings.scale, video])

	const usingCloud = cloud.location === 'cloud' && cloudRefusal === null

	const handleRender = useCallback(() => {
		if (cloud.location === 'cloud' && cloudRefusal) {
			setRenderError(`${cloudRefusal} Switch to Local to render this cut on this machine.`)
			return
		}
		if (!video || (!video.file && !(usingCloud && cloudAsset))) {
			setRenderError('The original file is no longer in memory. Re-select the clip and try again.')
			return
		}
		renderAbortRef.current?.abort()
		const controller = new AbortController()
		renderAbortRef.current = controller

		setRendering(true)
		setRenderError(null)
		setRenderResult((current) => {
			if (current) URL.revokeObjectURL(current.url)
			return null
		})
		setSendState('idle')
		setRenderProgress({
			phase: 'preparing',
			ratio: 0,
			framesDone: 0,
			framesTotal: 0,
			secondsDone: 0,
		})

		void (async () => {
			try {
				if (usingCloud) {
					/*
					 * The cloud path produces the same file the device path does, but
					 * it is Cloudinary that walks the cut - so the facts below come
					 * from the source clip and the plan rather than from an encoder
					 * that ran here. Only the sizes are measured.
					 */
					const cut = await runSpliceInCloud({
						file: video.file,
						asset: cloudAsset,
						segments: cloudSegments,
						output: { format: exportSettings.format, quality: exportSettings.quality },
						includeAudio: exportSettings.includeAudio && video.hasAudio,
						signal: controller.signal,
						onProgress: ({ phase, ratio }) =>
							setRenderProgress({
								phase: ratio < 0.6 ? 'preparing' : ratio < 0.95 ? 'encoding' : 'finishing',
								ratio,
								framesDone: 0,
								framesTotal: 0,
								secondsDone: (plan.outputDurationMs / 1000) * ratio,
							}),
					})
					if (controller.signal.aborted) return
					setCloudNote(
						`Cut in the cloud: ${cloudSegments.length} ${cloudSegments.length === 1 ? 'piece' : 'pieces'} spliced from ${formatSpan(plan.sourceDurationMs)} of source, without decoding a frame here.`,
					)
					setRenderResult({
						blob: cut.blob,
						url: cut.url,
						format: exportSettings.format,
						width: video.width,
						height: video.height,
						fps: exportSettings.fps ?? Math.round(video.fps) ?? 30,
						durationSeconds: plan.outputDurationMs / 1000,
						sizeInBytes: cut.sizeInBytes,
						videoCodec: exportSettings.format === 'webm' ? 'vp9' : 'h264',
						audioCodec: exportSettings.includeAudio && video.hasAudio ? 'aac' : null,
					})
					return
				}

				const result = await renderCutVideo({
					source: video.file as File,
					plan,
					fps: exportSettings.fps ?? Math.round(video.fps) ?? 30,
					quality: exportSettings.quality,
					format: exportSettings.format,
					scale: exportSettings.scale,
					includeAudio: exportSettings.includeAudio && video.hasAudio,
					signal: controller.signal,
					onProgress: setRenderProgress,
				})
				if (controller.signal.aborted) return
				setRenderResult(result)
			} catch (error) {
				if (error instanceof RenderCancelled || controller.signal.aborted) return
				setRenderError(error instanceof Error ? error.message : String(error))
			} finally {
				if (renderAbortRef.current === controller) {
					setRendering(false)
					setRenderProgress(null)
					renderAbortRef.current = null
				}
			}
		})()
	}, [cloud.location, cloudAsset, cloudRefusal, cloudSegments, exportSettings, plan, usingCloud, video])

	const handleCancelRender = useCallback(() => {
		renderAbortRef.current?.abort()
		renderAbortRef.current = null
		setRendering(false)
		setRenderProgress(null)
	}, [])

	const handleDownload = useCallback(() => {
		if (!renderResult || !video) return
		downloadBlobUrl(renderResult.url, cutFileName(video.name, renderResult.format))
	}, [renderResult, video])

	const handleSendToCaptions = useCallback(() => {
		if (!renderResult || !video) return
		setSendState('sending')
		void (async () => {
			const ok = await sendToStudio({
				blob: renderResult.blob,
				from: 'silence',
				to: 'captions',
				facts: {
					name: cutFileName(video.name, renderResult.format),
					type: renderResult.blob.type,
					sizeInBytes: renderResult.sizeInBytes,
					durationInSeconds: renderResult.durationSeconds,
					width: renderResult.width,
					height: renderResult.height,
					fps: renderResult.fps,
					hasAudio: renderResult.audioCodec !== null,
				},
				note: `Silence removed - ${formatSpan(plan.savedMs)} shorter than the original.`,
				// The transcript, pushed through the same map the picture was.
				cues: cues.length > 0 ? remapCues(cues, plan) : [],
			})
			setSendState(ok ? 'sent' : 'failed')
		})()
	}, [cues, plan, renderResult, video])

	/* ------------------------------------------------------ persistence */

	const restore = useRestoredSnapshot<unknown>({
		key: SILENCE_SESSION_KEY,
		version: SILENCE_SESSION_VERSION,
		apply: async (data, updatedAt) => {
			const session = normalizeSilenceSession(data)
			if (!session) return

			setSettings(session.settings)
			setOverrides(session.overrides)
			setExportSettings(session.exportSettings)
			setPreviewOriginal(session.previewOriginal)
			setRestoredSpeech(session.speech)

			const notes: string[] = []
			let warning: string | null = null

			if (session.video?.blobId) {
				setCloudAsset(session.video.cloudAsset)
				const stored = await readBlob(session.video.blobId)
				if (stored) {
					const file = new File([stored.blob], session.video.name, { type: stored.type })
					const facts = session.video
					setVideo({
						url: URL.createObjectURL(file),
						name: facts.name,
						kind: 'file',
						sizeInBytes: facts.sizeInBytes || file.size,
						durationInSeconds: facts.durationInSeconds,
						width: facts.width,
						height: facts.height,
						fps: facts.fps,
						hasAudio: facts.hasAudio,
						file,
					})
					setVideoBlobId(session.video.blobId)
					setVideoBanked(true)
					notes.push(facts.name)

					if (session.analysis) {
						const levels = await readBlob(SILENCE_LEVELS_BLOB_ID)
						const frameDb = levels
							? await levelsFromBlob(levels.blob, session.analysis.frames)
							: null
						if (frameDb) {
							setAnalysis(analysisFromFacts(session.analysis, frameDb))
							notes.push('its measured waveform')
						} else {
							// The clip survived but its measurements did not; measuring
							// again is cheap and beats showing an empty timeline.
							analyzeRef.current(file, facts.durationInSeconds)
						}
					}
					// The stored playhead is on the source clock, which is the one clock
					// that survives a change of settings.
					setSourceMs(Math.max(0, session.positionMs))
					setSeekNonce((value) => value + 1)
				} else {
					warning =
						'Your settings came back, but the clip itself was dropped by the browser to free space. Pick the file again and everything else is still here.'
				}
			} else if (session.video?.cloudAsset) {
				const facts = session.video
				const asset = facts.cloudAsset!
				setCloudAsset(asset)
				setVideo({
					url: asset.secureUrl,
					name: facts.name,
					kind: 'url',
					sizeInBytes: facts.sizeInBytes,
					durationInSeconds: facts.durationInSeconds,
					width: facts.width,
					height: facts.height,
					fps: facts.fps,
					hasAudio: facts.hasAudio,
					file: null,
				})
				setVideoBanked(true)
				notes.push(`${facts.name} from Cloudinary`)
			}

			if (Object.keys(session.overrides).length > 0) {
				notes.push(`${Object.keys(session.overrides).length} hand-decided pauses`)
			}

			setRestoredAt(updatedAt)
			setRestoreWarning(warning)
			setRestoreSummary(notes.length > 0 ? `Brought back ${notes.join(', ')}.` : null)
		},
	})

	const snapshot: SilenceSession | null = useMemo(() => {
		if (!video && Object.keys(overrides).length === 0) return null
		return {
			video: video
				? {
						blobId: videoBlobId,
						url: null,
						name: video.name,
						kind: 'file',
						sizeInBytes: video.sizeInBytes,
						durationInSeconds: video.durationInSeconds,
						width: video.width,
						height: video.height,
						fps: video.fps,
						hasAudio: video.hasAudio,
						cloudAsset,
					}
				: null,
			analysis: analysis ? analysisFacts(analysis) : null,
			speech: activeSpeech,
			settings,
			overrides,
			exportSettings,
			positionMs: sourceMs,
			previewOriginal,
			tab: 'detect',
		}
	}, [activeSpeech, analysis, cloudAsset, exportSettings, overrides, previewOriginal, settings, sourceMs, video, videoBlobId])

	const cloudSnapshot = useMemo(
		() => snapshot ? { name: video?.name ?? 'Silence workspace', version: SILENCE_SESSION_VERSION, data: snapshot } : null,
		[snapshot, video?.name],
	)
	useCloudProjectAutosave({ studio: 'silence', cloud, snapshot: cloudSnapshot })

	const vault = useAutosave<SilenceSession>({
		key: SILENCE_SESSION_KEY,
		version: SILENCE_SESSION_VERSION,
		data: snapshot,
		enabled: restore.phase !== 'loading',
	})

	/* --------------------------------------------------------- hand-off */

	const handoff = useIncomingHandoff('silence', restore.phase !== 'loading')

	const acceptHandoff = useCallback(() => {
		void (async () => {
			const taken = await handoff.accept()
			if (!taken) return
			await loadVideo(taken.file, { cues: taken.handoff.cues })
		})()
	}, [handoff, loadVideo])

	/* ------------------------------------------------------------ reset */

	const handleReset = useCallback(() => {
		handleClearVideo()
		setSettings(DEFAULT_CUT_SETTINGS)
		setExportSettings(DEFAULT_EXPORT_SETTINGS)
		setPreviewOriginal(false)
		setRestoreSummary(null)
		setRestoreWarning(null)
		void vault.forget()
	}, [handleClearVideo, vault])

	useEffect(
		() => () => {
			analysisAbortRef.current?.abort()
			renderAbortRef.current?.abort()
		},
		[],
	)

	/* ------------------------------------------------------------- view */

	const busy = analyzing || rendering
	const savedLabel = plan.savedMs > 500 ? formatSpan(plan.savedMs) : null

	return (
		<div className="app">
			<SilenceTopBar
				steps={[
					{ id: 'video', label: 'Video', done: video !== null },
					{ id: 'listen', label: 'Analyse', done: analysis !== null },
					{ id: 'tune', label: 'Tune', done: plan.cuts > 0 },
					{ id: 'export', label: 'Export', done: renderResult !== null },
				]}
				webCodecs={webCodecs}
				cloud={cloud}
				savedLabel={savedLabel}
				save={{ status: vault.status, savedAt: vault.savedAt, error: vault.error }}
				onReset={handleReset}
				canReset={video !== null || analysis !== null}
			/>

			{restore.phase === 'restored' && (restoreSummary || restoreWarning) ? (
				<RestoreNotice
					updatedAt={restoredAt}
					summary={restoreSummary ?? ''}
					warning={restoreWarning}
					onDiscard={handleReset}
				/>
			) : null}

			{handoff.incoming ? (
				<div className="restore-notice" data-tone="ok" role="status">
					<span className="restore-notice-mark">
						<IconCaptions size={15} />
					</span>
					<div className="restore-notice-copy">
						<strong>
							A clip is waiting from the Subtitle Studio
							<em>
								{handoff.incoming.handoff.name} -{' '}
								{formatSeconds(handoff.incoming.handoff.durationInSeconds)}
							</em>
						</strong>
						<span>
							{handoff.incoming.handoff.note ||
								'Load it here to strip the dead air out of the captioned cut.'}
						</span>
					</div>
					<button type="button" className="restore-notice-action" onClick={acceptHandoff}>
						Load it
					</button>
					<button
						type="button"
						className="restore-notice-close"
						aria-label="Dismiss"
						onClick={handoff.dismiss}
					>
						<IconClose size={13} />
					</button>
				</div>
			) : null}

			<div className="workspace workspace--silence" data-tab={pane}>
				<SilenceSourcePanel
					video={video}
					videoBanked={videoBanked}
					busy={busy}
					analysis={analysis}
					analyzing={analyzing}
					analysisProgress={analysisProgress}
					analysisError={analysisError}
					speechRatio={speechRatio}
					settings={settings}
					plan={plan}
					activePreset={activePreset}
					onVideoFiles={handleVideoFiles}
					onClearVideo={handleClearVideo}
					onSettings={patchSettings}
					onPreset={applyPreset}
					onReanalyze={() => {
						if (video?.file) analyzeRef.current(video.file, video.durationInSeconds)
					}}
					onCancelAnalysis={cancelAnalysis}
				/>

				<section className="panel panel--stage">
					<div className="stage-bar">
						<div className="stage-bar-group">
							<span className="chip chip--static">
								<IconScissors size={12} /> {plan.cuts} cut{plan.cuts === 1 ? '' : 's'}
							</span>
							{video ? (
								<span className="chip chip--static">
									{video.width} x {video.height}
								</span>
							) : null}
							<span className="chip chip--static" title="Length after the edit">
								{formatSpan(plan.outputDurationMs)}
							</span>
							{analyzing ? (
								<span className="badge badge--accent">
									<IconSpinner size={11} className="spin" /> listening
								</span>
							) : null}
							{renderResult ? (
								<span className="badge badge--green">
									<IconCheck size={11} /> exported
								</span>
							) : null}
						</div>
					</div>

					<div className="stage stage--cut">
						<SilencePreview
							url={video?.url ?? null}
							plan={plan}
							sourceMs={sourceMs}
							seekNonce={seekNonce}
							previewOriginal={previewOriginal}
							onSourceMs={setSourceMs}
							onPreviewOriginal={setPreviewOriginal}
						/>
					</div>

					<SilenceTimeline
						analysis={analysis}
						plan={plan}
						sourceMs={sourceMs}
						selectedGap={selectedGap}
						sensitivityDb={settings.sensitivityDb}
						onSeekSource={seekSource}
						onSelectGap={setSelectedGap}
						onGapAction={handleGapAction}
					/>
				</section>

				<SilenceExportPanel
					video={video}
					plan={plan}
					settings={exportSettings}
					webCodecs={webCodecs}
					rendering={rendering}
					progress={renderProgress}
					result={renderResult}
					error={renderError}
					sendState={sendState}
					hasCues={cues.length > 0}
					onSettings={(patch) => setExportSettings((current) => ({ ...current, ...patch }))}
					onRender={handleRender}
					onCancel={handleCancelRender}
					onDownload={handleDownload}
					onSendToCaptions={handleSendToCaptions}
					cloud={cloud}
					cloudRefusal={cloudRefusal}
					cloudNote={cloudNote}
				>
					<CloudProjectsPanel
						studio="silence"
						cloud={cloud}
						snapshot={() => cloudSnapshot}
						onOpen={(data) => {
							const session = normalizeSilenceSession(data)
							if (!session) return
							setSettings(session.settings)
							setOverrides(session.overrides)
							setExportSettings(session.exportSettings)
							setRestoredSpeech(session.speech)
							if (session.video?.cloudAsset) {
								const facts = session.video
								const asset = facts.cloudAsset!
								setCloudAsset(asset)
								setVideo({ ...facts, url: asset.secureUrl, kind: 'url', file: null })
								setVideoBanked(true)
							}
							setCloudNote(
								session.video?.cloudAsset
									? `Settings and "${session.video.name}" restored from the cloud.`
									: session.video
									? `Settings restored. Load "${session.video.name}" again to cut it.`
									: 'Settings restored.',
							)
						}}
					/>
				</SilenceExportPanel>
			</div>

			<nav className="mobile-tabs" aria-label="Silence studio sections">
				{SILENCE_PANES.map((item) => {
					const Icon = item.icon
					return (
						<button
							key={item.id}
							className="mobile-tab"
							data-active={pane === item.id}
							aria-current={pane === item.id}
							onClick={() => setPane(item.id)}
						>
							<Icon size={17} />
							{item.label}
						</button>
					)
				})}
			</nav>
		</div>
	)
}
