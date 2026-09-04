'use client'

import dynamic from 'next/dynamic'
import type { PlayerRef } from '@remotion/player'
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type DragEvent as ReactDragEvent,
} from 'react'
import { compileProject } from '../lib/compiler'
import { downloadBlobUrl, formatSeconds } from '../lib/format'
import { useRenderController } from '../lib/use-render-controller'
import {
	cuesFromPlainText,
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
import { directObjects } from '../lib/captions/object-director'
import { loadModelCatalog } from '../lib/captions/object-models'
import { objectAssetById, objectAssetSrc } from '../lib/captions/object-library'
import {
	bakeObjectVideo,
	describeObjectPreview,
	describeObjectRender,
	previewObjectVideo,
	renderObjectStill,
} from '../lib/captions/object-render'
import { describeAutoPlan, keywordTargetCount, planWebObjects } from '../lib/captions/object-auto'
import { captionSafeArea, type ObjectSettings, type ObjectShot } from '../lib/captions/object-plan'
import { cuesToAss } from '../lib/captions/ass'
import { isCaptionFontId } from '../lib/captions/fonts'
import {
	alignToSpeech,
	cleanPunctuation,
	restoreEnglishWords,
	findReplace,
	holdThroughGaps,
	mergeShortCues,
	snapToFrames,
	splitLongCues,
	splitOnSpeakers,
	stretchTiming,
	transformCase,
} from '../lib/captions/tools'
import {
	DEFAULT_CAPTION_SOUND,
	DEFAULT_CAPTION_STYLE,
	DEFAULT_LAYOUT,
	presetById,
	soundForPreset,
} from '../lib/captions/style-presets'
import { buildSoundtrack } from '../lib/captions/sfx'
import { prefetchWebRenderer } from '../lib/lazy-chunk'
import { deviceProfile } from '../lib/device'
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
import type { SpeechSegment } from '../lib/captions/vad'
import type { CloudAsrStatus } from '../lib/captions/asr-models'
import { isVideoFile, probeVideo, releaseVideoSource } from '../lib/captions/video-source'
import {
	explainEmptyImport,
	importSubtitleFile,
	looksLikeSubtitleFile,
	parseSubtitleText,
	SubtitleImportError,
	subtitleFormatLabel,
	type SubtitleImportResult,
} from '../lib/captions/subtitle-import'
import type {
	CaptionCue,
	CaptionLayoutOptions,
	CaptionSound,
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
import {
	CAPTION_OBJECT_BLOB_PREFIX,
	CAPTION_ORIGINAL_BLOB_ID,
	CAPTION_SESSION_KEY,
	CAPTION_SESSION_VERSION,
	CAPTION_VIDEO_BLOB_ID,
	DEFAULT_OBJECT_PLAN,
	normalizeCaptionSession,
	videoFactsOf,
	videoFromFacts,
	type CaptionPanelTab,
	type CaptionSession,
	type StoredObjectPlan,
} from '../lib/captions/session'
import {
	readBlob,
	removeBlob,
	requestPersistentStorage,
	writeBlob,
} from '../lib/persist/idb'
import { useAutosave, useRestoredSnapshot } from '../lib/persist/use-vault'
import { sendToStudio, useIncomingHandoff } from '../lib/handoff'
import CaptionDesignPanel from './captions/CaptionDesignPanel'
import CaptionObjectPanel, { type ObjectActions, type ObjectAutoState } from './captions/CaptionObjectPanel'
import CaptionExportPanel from './captions/CaptionExportPanel'
import CaptionSoundPanel from './captions/CaptionSoundPanel'
import CaptionToolsPanel, { type ToolsActions } from './captions/CaptionToolsPanel'
import CaptionSourcePanel, { type TranscriptMode } from './captions/CaptionSourcePanel'
import CaptionTopBar from './captions/CaptionTopBar'
import CloudCaptionBurn from './cloud/CloudCaptionBurn'
import CloudProjectsPanel from './cloud/CloudProjectsPanel'
import { useCloud } from '../lib/cloud/use-cloud'
import CueTrack from './captions/CueTrack'
import ShortcutSheet from './captions/ShortcutSheet'
import { RestoreNotice } from './SaveState'
import {
	IconAlert,
	IconCaptions,
	IconClose,
	IconDownload,
	IconFilm,
	IconKeyboard,
	IconLayers,
	IconScissors,
	IconSliders,
	IconSpinner,
	IconTools,
	IconType,
	IconUpload,
	IconVolume,
} from './Icons'

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

const DEFAULT_PROFILE = profileById('nepali-english')
const DEFAULT_STYLE_SIGNATURE = JSON.stringify(DEFAULT_CAPTION_STYLE)
const DEFAULT_SOUND_SIGNATURE = JSON.stringify(DEFAULT_CAPTION_SOUND)
const DEFAULT_LAYOUT_SIGNATURE = JSON.stringify(DEFAULT_LAYOUT)
const DEFAULT_RENDER_SIGNATURE = JSON.stringify(INITIAL_SETTINGS)

function hasCaptionSessionWork(session: CaptionSession): boolean {
	return Boolean(
		session.video ||
			session.cues.length > 0 ||
			session.transcriptText.trim() ||
			session.handEdited ||
			session.fps !== 30 ||
			session.mode !== 'auto' ||
			session.speechProfile !== 'nepali-english' ||
			session.whisperModel !== DEFAULT_PROFILE.model ||
			session.whisperLanguage !== DEFAULT_PROFILE.language ||
			session.engine !== 'auto' ||
			session.cloudModel ||
			!session.polish ||
			!session.restoreEnglish ||
			session.tab !== 'design' ||
			session.objects.shots.length > 0 ||
			JSON.stringify(session.sound) !== DEFAULT_SOUND_SIGNATURE ||
			JSON.stringify(session.style) !== DEFAULT_STYLE_SIGNATURE ||
			JSON.stringify(session.layout) !== DEFAULT_LAYOUT_SIGNATURE ||
			JSON.stringify(session.render) !== DEFAULT_RENDER_SIGNATURE,
	)
}

const IDLE_TRANSCRIBE: TranscribeProgress = { stage: 'idle', progress: 0 }

const FPS_CHOICES = [24, 25, 30, 50, 60]

/** Checked against a restored snapshot so an unknown profile id cannot stick. */
const PROFILE_IDS: SpeechProfile['id'][] = ['nepali-english', 'nepali', 'english', 'other']

/**
 * How coarsely the playhead is remembered.
 *
 * Fine enough to come back to the same moment of the edit, coarse enough that
 * simply watching the preview does not rewrite the whole snapshot every frame.
 */
const POSITION_GRAIN_MS = 10_000

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

/** A shortcut must never eat a keystroke meant for a caption being typed. */
function isTypingTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false
	if (target.isContentEditable) return true
	const tag = target.tagName
	return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

type CaptionPane = 'source' | 'preview' | 'design'

const CAPTION_PANES: Array<{ id: CaptionPane; label: string; icon: typeof IconFilm }> = [
	{ id: 'source', label: 'Source', icon: IconUpload },
	{ id: 'preview', label: 'Preview', icon: IconFilm },
	{ id: 'design', label: 'Design', icon: IconSliders },
]

/** Number keys, in the order the panel tabs are drawn. */
/**
 * Objects are composited from the clip's own decoded frames, which means the
 * bytes have to be here. A pasted https:// address is a source the player can
 * stream but the encoder cannot open, so both entry points say the same thing.
 */
const NEEDS_LOCAL_FILE =
	'Objects need the clip’s own bytes. Drop the video file into the studio rather than pasting an address, and this works.'

/** The one-press flow before it has been asked to do anything. */
const IDLE_AUTO: ObjectAutoState = {
	running: false,
	message: '',
	ratio: 0,
	note: null,
	error: null,
	target: 0,
	misses: [],
	photos: [],
	finished: false,
}

const PANEL_KEYS: Record<string, CaptionPanelTab> = {
	'1': 'design',
	'2': 'sound',
	'3': 'objects',
	'4': 'tools',
	'5': 'export',
}

/**
 * The render settings a phone can actually finish.
 *
 * 2x on a 1080p clip is a 4K encode in one browser tab, which is the single most
 * reliable way to have the tab killed mid-render. The ceiling is applied on
 * mount and again to a restored snapshot - a session saved on a laptop, or on
 * this phone before the ceiling existed, must not carry 2x back in with it.
 */
function settingsForDevice(settings: RenderSettings): Partial<RenderSettings> {
	const device = deviceProfile()
	if (!device.mobile) return settings
	return { ...settings, scale: Math.min(settings.scale, device.maxScale), format: 'mp4' }
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
	// The sound layer is its own state rather than part of the style: it belongs
	// to this clip's mix, not to a look that gets copied between projects.
	const [sound, setSound] = useState<CaptionSound>(DEFAULT_CAPTION_SOUND)
	const [layout, setLayout] = useState<CaptionLayoutOptions>(DEFAULT_LAYOUT)
	const [handEdited, setHandEdited] = useState(false)

	const [mode, setMode] = useState<TranscriptMode>('auto')
	const [transcriptText, setTranscriptText] = useState('')
	// Nepali + English code-switching is this studio's primary case, so the
	// multilingual small model - the one that actually holds up on Nepali - is
	// the default rather than something the user has to discover.
	const [speechProfile, setSpeechProfile] = useState<SpeechProfile['id']>('nepali-english')
	const [whisperModel, setWhisperModel] = useState<WhisperModelId>(DEFAULT_PROFILE.model)
	const [whisperLanguage, setWhisperLanguage] = useState(DEFAULT_PROFILE.language)
	const [whisperSupport, setWhisperSupport] = useState<WhisperSupport | null>(null)
	const [loadedModels, setLoadedModels] = useState<WhisperModelId[]>([])
	// The cloud engine leads by default: it needs no download, no
	// SharedArrayBuffer and no fast machine, and `auto` still falls back to the
	// on-device model whenever the server has no key or NVIDIA cannot be reached.
	const [engine, setEngine] = useState<TranscribeEngine>('auto')
	const [cloudStatus, setCloudStatus] = useState<CloudAsrStatus | null>(null)
	const [cloudModel, setCloudModel] = useState<string | null>(null)
	const [polish, setPolish] = useState(true)
	// On by default: a Nepali transcript with कम्प्युटर in it is wrong for every
	// viewer, and the pass never touches a word that is genuinely Nepali.
	const [restoreEnglish, setRestoreEnglish] = useState(true)
	const [engineUsed, setEngineUsed] = useState<'cloud' | 'device' | null>(null)
	const [transcribing, setTranscribing] = useState(false)
	const [transcribeProgress, setTranscribeProgress] = useState<TranscribeProgress>(IDLE_TRANSCRIBE)
	const [transcribeError, setTranscribeError] = useState<string | null>(null)
	const [transcribeNotice, setTranscribeNotice] = useState<string | null>(null)
	/** What the last .srt/.vtt import actually produced - shown under the Import tab. */
	const [importNotice, setImportNotice] = useState<string | null>(null)

	const [compiled, setCompiled] = useState<{ project: VirtualProject; result: CompileResult } | null>(
		null,
	)
	const [compiling, setCompiling] = useState(false)
	const [compileError, setCompileError] = useState<string | null>(null)
	const [tab, setTab] = useState<CaptionPanelTab>('design')
	const [toolNote, setToolNote] = useState<string | null>(null)
	const [currentFrame, setCurrentFrame] = useState(0)
	const [isolated, setIsolated] = useState(false)
	const [placingCaption, setPlacingCaption] = useState(false)
	const [aligning, setAligning] = useState(false)
	const [cueHistory, setCueHistory] = useState({ canUndo: false, canRedo: false })
	const [shortcutsOpen, setShortcutsOpen] = useState(false)
	/** Which single pane a phone shows; ignored above the tablet break. */
	const [pane, setPane] = useState<CaptionPane>('source')
	/** true while a file is being dragged over the preview */
	const [dragOverStage, setDragOverStage] = useState(false)

	/**
	 * The object layer.
	 *
	 * One piece of state holds the whole thing - the shot list, the cut-out
	 * settings and whether it has been burned in - because those three are
	 * saved, restored and thrown away together. Everything beside it is
	 * transient: what a plan pass said, what the preview drew, how far a bake
	 * has got. None of that belongs in a snapshot.
	 */
	const [objectPlan, setObjectPlan] = useState<StoredObjectPlan>(DEFAULT_OBJECT_PLAN)
	const [objectPlanning, setObjectPlanning] = useState(false)
	const [objectPlanNotice, setObjectPlanNotice] = useState<string | null>(null)
	const [objectPlanError, setObjectPlanError] = useState<string | null>(null)
	const [objectDirector, setObjectDirector] = useState<'ai' | 'local' | null>(null)
	const [objectModelUsed, setObjectModelUsed] = useState<string | null>(null)
	/** whether `npm run assets:3d` has been run in this checkout */
	const [modelPackAvailable, setModelPackAvailable] = useState(false)
	const [objectPreviewing, setObjectPreviewing] = useState(false)
	const [objectPreview, setObjectPreview] = useState<{ url: string; shotId: string } | null>(null)
	const [objectPreviewError, setObjectPreviewError] = useState<string | null>(null)
	/**
	 * The draft video preview: small, rough, and never the working clip.
	 *
	 * Held here rather than in the panel because it owns a blob URL, and the one
	 * thing a preview must not do is leak the memory it was made to save.
	 */
	const [objectMovie, setObjectMovie] = useState<{ url: string; note: string } | null>(null)
	const [objectMovieRendering, setObjectMovieRendering] = useState(false)
	const [objectMovieProgress, setObjectMovieProgress] = useState({ phase: 'preparing', ratio: 0 })
	const [objectMovieError, setObjectMovieError] = useState<string | null>(null)
	const [objectBaking, setObjectBaking] = useState(false)
	const [objectBakeProgress, setObjectBakeProgress] = useState({ phase: 'preparing', ratio: 0 })
	const [objectBakeNote, setObjectBakeNote] = useState<string | null>(null)
	const [objectBakeError, setObjectBakeError] = useState<string | null>(null)

	/**
	 * The one-press flow, which owns none of the state the steps it drives own.
	 *
	 * It reads the transcript, plans the objects and bakes them, and every one of
	 * those already reports itself. What is kept here is only what a caller
	 * cannot recover afterwards: which step is running, what it said, and whether
	 * a finished file exists to save.
	 */
	const [objectAuto, setObjectAuto] = useState<ObjectAutoState>(IDLE_AUTO)
	/**
	 * The file the last bake produced.
	 *
	 * Held so "Save the video" is a download rather than a second bake. A ref
	 * rather than state because nothing renders differently for holding it - the
	 * panel reads the flag in objectAuto instead.
	 */
	const bakedFileRef = useRef<File | null>(null)

	/** progress of the "Send to Silence Studio" hand-off */
	const [sendToSilenceState, setSendToSilenceState] = useState<
		'idle' | 'sending' | 'sent' | 'failed'
	>('idle')

	/* --------------------------------------------------------- persistence */

	/** what came back from the vault on this load, for the one-off notice */
	const [restoredAt, setRestoredAt] = useState<number | null>(null)
	const [restoreSummary, setRestoreSummary] = useState<string | null>(null)
	const [restoreWarning, setRestoreWarning] = useState<string | null>(null)
	const cloud = useCloud()
	/** what opening a cloud workspace changed, said once next to the panel */
	const [cloudOpened, setCloudOpened] = useState<string | null>(null)
	/** false when only the settings could be kept - the clip must be re-picked */
	const [videoBanked, setVideoBanked] = useState(false)
	const [videoBlobId, setVideoBlobId] = useState<string | null>(null)
	/** playhead read out of a snapshot, applied once the composition exists */
	const pendingSeekRef = useRef<number | null>(null)

	/**
	 * Where speech is in the current video, as measured during transcription.
	 *
	 * Re-cutting the cue list into different line lengths has to break on the
	 * same pauses the transcript was aligned to, otherwise a wider preset
	 * silently moves every line break away from where the speaker breathes.
	 */
	const speechRef = useRef<SpeechSegment[]>([])

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
	// The tool callbacks read the live style through a ref: rebuilding every
	// handler on each colour tweak would remount the whole tools panel.
	const styleRef = useRef(style)
	styleRef.current = style
	// The object handlers are bound once and read the live plan through a ref,
	// the same way the tool callbacks read the style: rebuilding them on every
	// slider drag would remount the panel mid-gesture.
	const objectPlanRef = useRef(objectPlan)
	objectPlanRef.current = objectPlan
	const objectAbortRef = useRef<AbortController | null>(null)
	// Shortcuts read the playhead and the add-cue action through refs so the
	// key handler is bound once instead of on every frame of playback.
	const currentMsRef = useRef(0)
	const handleCueAddRef = useRef<(atMs?: number) => void>(() => {})
	const handleVideoFilesRef = useRef<(files: File[]) => void>(() => {})
	const closeShortcuts = useCallback(() => setShortcutsOpen(false), [])
	const render = useRenderController(INITIAL_SETTINGS)
	const { reset: resetRender, startRender } = render
	const { updateSettings: updateRenderSettings } = render

	/**
	 * Brings the last session back.
	 *
	 * Runs once, before anything else is allowed to save, so the empty initial
	 * state can never overwrite a good snapshot. The clip's bytes are fetched
	 * from the blob store and handed back as a real File - transcription needs
	 * to decode the original data, not a re-encoded copy.
	 */
	const restore = useRestoredSnapshot<CaptionSession>({
		key: CAPTION_SESSION_KEY,
		version: CAPTION_SESSION_VERSION,
		apply: async (raw, updatedAt) => {
			const session = normalizeCaptionSession(raw, { render: INITIAL_SETTINGS })
			if (!session || !hasCaptionSessionWork(session)) return

			setFps(session.fps)
			cuesRef.current = session.cues
			setCues(session.cues)
			setOrigin(session.origin)
			setStyle(session.style)
			setSound(session.sound)
			setLayout(session.layout)
			setHandEdited(session.handEdited)
			setMode(session.mode)
			setTranscriptText(session.transcriptText)
			if (PROFILE_IDS.includes(session.speechProfile as SpeechProfile['id'])) {
				setSpeechProfile(session.speechProfile as SpeechProfile['id'])
			}
			setWhisperModel(session.whisperModel)
			setWhisperLanguage(session.whisperLanguage)
			setEngine(session.engine)
			setCloudModel(session.cloudModel)
			setPolish(session.polish)
			setRestoreEnglish(session.restoreEnglish)
			setTab(session.tab)
			setObjectPlan(session.objects)
			updateRenderSettings(settingsForDevice(session.render))
			speechRef.current = session.speech
			pendingSeekRef.current = session.positionMs > 0 ? session.positionMs : null

			let restoredVideo: CaptionVideoSource | null = null
			if (session.video) {
				if (session.video.kind === 'file' && session.video.blobId) {
					const stored = await readBlob(session.video.blobId)
					const file = stored
						? new File([stored.blob], stored.name, {
								type: stored.type,
								lastModified: stored.lastModified,
							})
						: null
					restoredVideo = videoFromFacts(session.video, file)
					if (!restoredVideo) {
						setVideoBlobId(null)
						setRestoreWarning(
							`Your captions, timings and design are back, but "${session.video.name}" is no longer in this browser's storage. Drop the same file in again and everything reconnects.`,
						)
					}
				} else {
					restoredVideo = videoFromFacts(session.video, null)
				}
			}

			if (restoredVideo) {
				setVideoBlobId(session.video?.blobId ?? null)
				videoRef.current = restoredVideo
				setVideo(restoredVideo)
				setVideoBanked(restoredVideo.kind === 'url' || Boolean(session.video?.blobId))
			}

			setRestoredAt(updatedAt)
			setRestoreSummary(
				session.cues.length > 0
					? `${session.cues.length} caption${session.cues.length === 1 ? '' : 's'}, your timings and the ${session.style.preset} look are exactly where you left them.`
					: session.video
						? 'Your video and caption settings are exactly where you left them.'
						: session.transcriptText.trim()
							? 'Your script and caption settings are back. Add a video whenever you are ready.'
							: 'Your caption design and workspace settings are exactly where you left them.',
			)
		},
	})

	const restoring = restore.phase === 'loading'

	/**
	 * The snapshot, rebuilt whenever anything in it moves.
	 *
	 * Kept deliberately flat and JSON-only: the File and the object URL are not
	 * in here, because bytes belong in the blob store and a blob: URL is dead
	 * the moment the document that minted it goes away.
	 */
	const coarsePositionMs =
		Math.round((currentFrame / Math.max(1, fps)) * 1000 / POSITION_GRAIN_MS) * POSITION_GRAIN_MS

	const session = useMemo<CaptionSession | null>(() => {
		if (restoring) return null
		const next: CaptionSession = {
			video: video ? videoFactsOf(video, videoBlobId) : null,
			fps,
			cues,
			origin,
			style,
			sound,
			layout,
			handEdited,
			mode,
			transcriptText,
			speechProfile,
			whisperModel,
			whisperLanguage,
			engine,
			cloudModel,
			polish,
			restoreEnglish,
			tab,
			objects: objectPlan,
			render: render.settings,
			speech: speechRef.current,
			positionMs: coarsePositionMs,
		}
		return hasCaptionSessionWork(next) ? next : null
	}, [
		cloudModel,
		coarsePositionMs,
		cues,
		engine,
		fps,
		handEdited,
		layout,
		mode,
		objectPlan,
		origin,
		polish,
		render.settings,
		restoreEnglish,
		restoring,
		sound,
		speechProfile,
		style,
		tab,
		transcriptText,
		video,
		videoBlobId,
		whisperLanguage,
		whisperModel,
	])

	/**
	 * Opens a workspace saved in the cloud.
	 *
	 * Only the decisions come back - captions, timing, look, sound, objects.
	 * The clip deliberately does not: a snapshot points at a blob in *this*
	 * browser's storage, and a workspace opened on another machine would be
	 * pointing at nothing. Naming the file it wants is more use than silently
	 * restoring an empty player.
	 */
	const openCloudSession = useCallback(
		(raw: unknown) => {
			const opened = normalizeCaptionSession(raw, { render: INITIAL_SETTINGS })
			if (!opened) return

			setFps(opened.fps)
			cuesRef.current = opened.cues
			setCues(opened.cues)
			setOrigin(opened.origin)
			setStyle(opened.style)
			setSound(opened.sound)
			setLayout(opened.layout)
			setHandEdited(opened.handEdited)
			setMode(opened.mode)
			setTranscriptText(opened.transcriptText)
			setObjectPlan(opened.objects)
			setTab(opened.tab)
			updateRenderSettings(settingsForDevice(opened.render))
			setCloudOpened(
				opened.video
					? `Workspace open. Load "${opened.video.name}" again to render it.`
					: 'Workspace open.',
			)
		},
		[updateRenderSettings],
	)

	const vault = useAutosave<CaptionSession>({
		key: CAPTION_SESSION_KEY,
		version: CAPTION_SESSION_VERSION,
		data: session,
		enabled: !restoring,
	})
	const { forget: forgetSession, saveNow: saveSessionNow } = vault

	/** watches for a clip waiting from another studio; consumed once accepted */
	const handoff = useIncomingHandoff('captions', !restoring)

	/** Long-running work that must not be interrupted by an editing shortcut. */
	const busy = transcribing || render.rendering

	// Asked once, and only after there is something worth keeping: an origin with
	// a gigabyte of video in it is exactly what browsers evict first under
	// pressure, and the permission is silent in Chrome for a site in regular use.
	useEffect(() => {
		if (video) void requestPersistentStorage()
	}, [video])

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

	/**
	 * Where every caption sound lands, computed once from the cues and reused by
	 * the preview, the export and the .tsx download - so all three are the same
	 * mix rather than three that happen to agree.
	 */
	const soundtrack = useMemo(
		() =>
			buildSoundtrack(cues, sound, style, {
				durationMs: durationMs || undefined,
			}),
		[cues, durationMs, sound, style],
	)

	const source = useMemo(() => {
		if (!video || !plan) return ''
		return captionSourceFor({ video, cues, style, sound, plan, origin })
	}, [cues, origin, plan, sound, style, video])

	// The compiler only re-runs when the timeline itself changes; cue and style
	// edits are pushed through defaultProps so the preview never reloads the video.
	const sourceRef = useRef(source)
	sourceRef.current = source
	// Cue and colour edits ride through defaultProps, but the chosen faces are
	// baked into the file's loadFont() calls - so typography, and only
	// typography, has to recompile before the preview can show it.
	const structuralKey =
		plan && video
			? [
					video.url,
					`${plan.width}x${plan.height}`,
					plan.fps,
					plan.durationInFrames,
					style.fontId,
					style.devanagari ? style.devanagariFontId : 'latin-only',
				].join('|')
			: ''

	useEffect(() => {
		setIsolated(typeof window !== 'undefined' && window.crossOriginIsolated === true)
	}, [])

	/**
	 * Warm the encoder while the video is being transcribed and styled.
	 *
	 * It is a multi-megabyte chunk that used to be fetched at the moment Render
	 * was pressed - on a phone that download could time out and end the render at
	 * 0% before a single frame existed. Starting it here means the bytes are
	 * usually already cached, and a failure now costs nothing because the render
	 * path fetches it again with retries.
	 */
	useEffect(() => {
		if (!video) return
		prefetchWebRenderer()
	}, [video])

	/**
	 * Phones get settings a phone can finish.
	 *
	 * Applied once, on mount; the controls stay free afterwards, and the restore
	 * below re-applies the same ceiling to whatever the snapshot brings back.
	 */
	useEffect(() => {
		render.updateSettings(settingsForDevice(render.settings))
		// eslint-disable-next-line react-hooks/exhaustive-deps
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
			// Cues, look and the whole sound schedule ride through defaultProps, so
			// none of them needs a recompile to show up in the preview.
			defaultProps: {
				src: video.url,
				captions: cues,
				captionStyle: style,
				captionSound: sound,
				soundtrack,
			},
		}
	}, [compiled, cues, sound, soundtrack, style, video])

	// What the transcript is actually made of, measured rather than assumed -
	// drives both the font-stack warning and the auto-enable below.
	const scriptMix = useMemo<ScriptMix>(() => scriptMixOf(cues), [cues])

	const currentMs = composition ? (currentFrame / composition.fps) * 1000 : 0
	currentMsRef.current = currentMs

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

	// A restored playhead is applied the moment there is a player to move, and
	// then forgotten - otherwise every later recompile would yank the preview
	// back to where the previous session happened to stop.
	useEffect(() => {
		const target = pendingSeekRef.current
		if (target === null || !composition) return
		pendingSeekRef.current = null
		seekToMs(target)
	}, [composition, seekToMs])

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
				speechRef.current = []
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
				setRestoreWarning(null)
				setSendToSilenceState('idle')
				pendingSeekRef.current = null
				resetRender()
				// A phone shows one pane at a time: land on the clip, not the form.
				setPane('preview')

				// Bank the bytes so the clip is still here after a refresh. A pasted
				// address needs no copy - the address itself is the whole source.
				if (next.kind === 'url' || !next.file) {
					setVideoBlobId(null)
					setVideoBanked(next.kind === 'url')
					void removeBlob(CAPTION_VIDEO_BLOB_ID)
					return
				}

				setVideoBanked(false)
				const stored = await writeBlob(CAPTION_VIDEO_BLOB_ID, next.file, next.name)
				setVideoBlobId(stored ? CAPTION_VIDEO_BLOB_ID : null)
				setVideoBanked(stored)
				if (!stored) {
					setVideoError(
						`Your captions and settings will be saved, but "${next.name}" is too large for this browser to keep (${(next.sizeInBytes / 1024 / 1024).toFixed(0)} MB). After a refresh you would need to pick the file again.`,
					)
				}
			} catch (error) {
				setVideoError(error instanceof Error ? error.message : String(error))
			}
		},
		[clearCueHistory, resetRender],
	)

	/** Takes the waiting parcel: loads its clip, then its transcript if it has one. */
	const acceptHandoff = useCallback(() => {
		void (async () => {
			const taken = await handoff.accept()
			if (!taken) return
			await adoptVideo({ file: taken.file })
			if (taken.handoff.cues.length > 0) applyCues(taken.handoff.cues, 'srt')
		})()
	}, [adoptVideo, applyCues, handoff])

	/**
	 * What an accepted import says back to the user. The counts matter: the
	 * commonest silent failure used to be a file that imported as a single
	 * enormous cue, and a cue count next to the file name makes that obvious
	 * at a glance rather than three edits later.
	 */
	const announceImport = useCallback(
		(result: SubtitleImportResult, label: string, encoding?: string) => {
			const parts = [
				`${label}: ${result.cues.length} cue${result.cues.length === 1 ? '' : 's'} from ${subtitleFormatLabel(result.format)}`,
			]
			if (result.wordTimedCues > 0) {
				parts.push(`${result.wordTimedCues} with word timing from the file`)
			}
			if (encoding && encoding !== 'UTF-8') parts.push(`read as ${encoding}`)
			setImportNotice([parts.join(' - '), ...result.warnings].join(' '))
		},
		[],
	)

	const handleImportSubtitles = useCallback(
		async (file: File) => {
			setImportNotice(null)
			try {
				const result = await importSubtitleFile(file, { fps })
				applyCues(result.cues, 'srt')
				announceImport(result, result.name, result.encoding)
				setTranscribeError(null)
			} catch (error) {
				setTranscribeError(
					error instanceof SubtitleImportError
						? error.message
						: error instanceof Error
							? error.message
							: String(error),
				)
			}
		},
		[announceImport, applyCues, fps],
	)

	/**
	 * The paste path. On a phone, "open the .srt" is often the hardest step of
	 * the whole studio - the file lives in a chat thread or a cloud folder that
	 * the picker will not surface - while long-pressing its text and pasting it
	 * here always works.
	 */
	const handleImportSubtitleText = useCallback(
		(text: string) => {
			setImportNotice(null)
			const result = parseSubtitleText(text, { fps })
			if (result.cues.length === 0) {
				setTranscribeError(explainEmptyImport(text, 'The pasted subtitles'))
				return
			}
			applyCues(result.cues, 'srt')
			announceImport(result, 'Pasted subtitles')
			setTranscribeError(null)
		},
		[announceImport, applyCues, fps],
	)

	const handleVideoFiles = useCallback(
		(files: File[]) => {
			const file = files.find(isVideoFile) ?? files[0]
			if (!file) return
			if (!isVideoFile(file)) {
				// A subtitle dropped on the video well is not a mistake worth an
				// error - it is the file the user came here with. Take it.
				if (looksLikeSubtitleFile(file)) {
					setMode('import')
					void handleImportSubtitles(file)
					return
				}
				setVideoError(`${file.name} is not a video file. Drop an MP4, MOV or WebM.`)
				return
			}
			void adoptVideo({ file })
		},
		[adoptVideo, handleImportSubtitles],
	)

	/**
	 * The whole preview is a drop target, not just the panel tile.
	 *
	 * Dragging a clip at the big empty rectangle in the middle is what people
	 * try first; making that work removes the one step where the tool used to
	 * say no for no reason.
	 */
	const handleStageDragOver = useCallback((event: ReactDragEvent<HTMLElement>) => {
		if (!event.dataTransfer.types.includes('Files')) return
		event.preventDefault()
		event.dataTransfer.dropEffect = 'copy'
		setDragOverStage(true)
	}, [])

	const handleStageDragLeave = useCallback((event: ReactDragEvent<HTMLElement>) => {
		// Only the crossing that actually leaves the stage counts; moving between
		// children fires dragleave too, and would flicker the overlay.
		if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
		setDragOverStage(false)
	}, [])

	const handleStageDrop = useCallback(
		(event: ReactDragEvent<HTMLElement>) => {
			const files = Array.from(event.dataTransfer.files)
			if (files.length === 0) return
			event.preventDefault()
			setDragOverStage(false)
			handleVideoFilesRef.current(files)
		},
		[],
	)

	handleVideoFilesRef.current = handleVideoFiles

	const handleClearVideo = useCallback(() => {
		transcribeAbortRef.current?.abort()
		const previous = videoRef.current
		videoRef.current = null
		setVideo(null)
		if (previous) releaseVideoSource(previous)
		speechRef.current = []
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
		setRestoreWarning(null)
		setSendToSilenceState('idle')
		setCurrentFrame(0)
		// The timeline rate belongs to the clip that just left, so it goes back to
		// the default too - otherwise an emptied studio still looks like work in
		// progress and keeps announcing a session there is nothing left to restore.
		setFps(30)
		pendingSeekRef.current = null
		setVideoBlobId(null)
		setVideoBanked(false)
		void removeBlob(CAPTION_VIDEO_BLOB_ID)
		// The object plan belongs to the clip that just left: its shots are timed
		// to a transcript that no longer exists, and its parked original is bytes
		// nothing can restore into.
		objectAbortRef.current?.abort()
		for (const shot of objectPlanRef.current.shots) {
			if (shot.blobId) void removeBlob(shot.blobId)
		}
		setObjectPlan(DEFAULT_OBJECT_PLAN)
		setObjectPlanNotice(null)
		setObjectPlanError(null)
		setObjectBakeNote(null)
		setObjectBakeError(null)
		setObjectPreview(null)
		// The draft preview is a blob URL over a video of the clip that just
		// left; nothing else will ever free it.
		setObjectMovie((current) => {
			if (current) URL.revokeObjectURL(current.url)
			return null
		})
		setObjectMovieError(null)
		void removeBlob(CAPTION_ORIGINAL_BLOB_ID)
	}, [clearCueHistory, resetRender])

	useEffect(() => {
		return () => {
			transcribeAbortRef.current?.abort()
			objectAbortRef.current?.abort()
		}
	}, [])

	/* -------------------------------------------------------- transcript */

	/**
	 * Transcribes the clip, and hands the cues back as well as storing them.
	 *
	 * The return value exists for the one-press object flow. It runs
	 * transcription and then immediately needs the words, and `cuesRef` is only
	 * refreshed on the next render - so waiting on the state would either read
	 * the previous transcript or need a poll. Every other caller ignores it.
	 */
	const handleTranscribe = useCallback(async (): Promise<CaptionCue[] | null> => {
		if (!video) return null
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
				restoreEnglish,
				onProgress: setTranscribeProgress,
				signal: controller.signal,
			})

			speechRef.current = outcome.speech ?? []
			applyCues(outcome.cues, outcome.origin)
			setEngineUsed(outcome.engine)
			setTranscribeNotice(outcome.notice ?? null)
			if (outcome.engine === 'device') setLoadedModels(await loadedWhisperModels())
			// A cloud run says nothing about this browser's on-device support, but
			// a device run just proved it either way.
			if (outcome.engine === 'device') setWhisperSupport(await checkWhisperSupport(whisperModel))
			return outcome.cues
		} catch (error) {
			if (error instanceof TranscriptionCancelled || controller.signal.aborted) {
				setTranscribeProgress({ stage: 'cancelled', progress: 0, message: 'Cancelled' })
			} else {
				setTranscribeError(error instanceof Error ? error.message : String(error))
				setTranscribeProgress({ stage: 'error', progress: 0 })
			}
			return null
		} finally {
			transcribeAbortRef.current = null
			setTranscribing(false)
		}
	}, [
		applyCues,
		cloudModel,
		engine,
		layout,
		polish,
		restoreEnglish,
		video,
		whisperLanguage,
		whisperModel,
	])

	const handleAutoTime = useCallback(() => {
		if (!video || !transcriptText.trim()) return
		applyCues(cuesFromPlainText(transcriptText, { durationMs, layout }), 'text')
	}, [applyCues, durationMs, layout, transcriptText, video])

	const handleRegroup = useCallback(() => {
		commitCues((current) =>
			normalizeCues(regroupCues(current, layout, { speech: speechRef.current }), durationMs),
		)
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

	handleCueAddRef.current = handleCueAdd

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

	const handleSound = useCallback((patch: Partial<CaptionSound>) => {
		setSound((current) => ({ ...current, ...patch }))
	}, [])

	/* -------------------------------------------------------------- tools */

	/**
	 * Bulk edits. Each one runs through commitCues, so the whole rewrite is a
	 * single undo step, and each reports what it did - a tool that silently
	 * changes 40 lines is indistinguishable from a tool that did nothing.
	 */
	const toolActions = useMemo<ToolsActions>(
		() => ({
			onRestoreEnglish: () => {
				let note = 'Every word is already in the script it belongs to.'
				setHandEdited(true)
				commitCues((current) => {
					const result = restoreEnglishWords(current)
					if (result.changed === 0) return current
					const shown = result.samples.map((sample) => `${sample.from} - ${sample.to}`).join(', ')
					note = `Wrote ${result.changed} English word${
						result.changed === 1 ? '' : 's'
					} back in English (${shown}).`
					return normalizeCues(result.cues, durationMs)
				})
				setToolNote(note)
			},
			onAlignToSpeech: () => {
				if (!video || aligning) return
				setAligning(true)
				setToolNote('Reading the audio to find the speech...')
				void (async () => {
					try {
						// The map is free after a transcription run; for a pasted .srt or a
						// hand-typed script there has never been one, so it is measured now.
						if (speechRef.current.length === 0) {
							const { measureSpeech } = await import('../lib/captions/audio')
							const source = video.file ?? (await (await fetch(video.url)).blob())
							const measured = await measureSpeech({
								source,
								durationHintSeconds: video.durationInSeconds,
								signal: new AbortController().signal,
							})
							speechRef.current = measured.speech
							if (measured.silent || measured.speech.length === 0) {
								setToolNote('No speech could be found in that audio, so nothing was moved.')
								return
							}
						}

						let note = 'Nothing to align.'
						setHandEdited(true)
						commitCues((current) => {
							const result = alignToSpeech(current, speechRef.current, { durationMs })
							if (result.moved === 0) {
								note = 'Every line already sits on the speech - nothing needed moving.'
								return current
							}
							const shifted =
								Math.abs(result.offsetMs) >= 40
									? ` The transcript ran ${Math.abs(result.offsetMs)}ms ${
											result.offsetMs > 0 ? 'early' : 'late'
										}.`
									: ''
							note =
								result.mode === 'redistribute'
									? `Re-timed all ${current.length} lines across the speech in the audio.${shifted} ${Math.round(
											result.onSpeech * 100,
										)}% of words now land on speech.`
									: `Moved ${result.moved} of ${current.length} lines onto the speech.${shifted} ${Math.round(
											result.onSpeech * 100,
										)}% of words now land on speech.`
							return normalizeCues(result.cues, durationMs)
						})
						setToolNote(note)
					} catch (error) {
						setToolNote(
							`The audio could not be read for alignment (${
								error instanceof Error ? error.message : String(error)
							}).`,
						)
					} finally {
						setAligning(false)
					}
				})()
			},
			onFindReplace: (options) => {
				let replaced = 0
				setHandEdited(true)
				commitCues((current) => {
					const result = findReplace(current, options)
					replaced = result.replaced
					return normalizeCues(result.cues, durationMs)
				})
				setToolNote(
					replaced > 0
						? `Replaced ${replaced} occurrence${replaced === 1 ? '' : 's'} of "${options.find}".`
						: `Nothing matched "${options.find}".`,
				)
			},
			onCase: (mode) => {
				setHandEdited(true)
				commitCues((current) => normalizeCues(transformCase(current, mode), durationMs))
				setToolNote(`Rewrote every line in ${mode} case.`)
			},
			onCleanPunctuation: () => {
				let changed = 0
				setHandEdited(true)
				commitCues((current) => {
					const result = cleanPunctuation(current)
					changed = result.changed
					return normalizeCues(result.cues, durationMs)
				})
				setToolNote(
					changed > 0 ? `Tidied punctuation in ${changed} lines.` : 'The punctuation was already clean.',
				)
			},
			onSplitSpeakers: () => {
				let found = 0
				setHandEdited(true)
				commitCues((current) => {
					const result = splitOnSpeakers(current)
					found = result.found
					return normalizeCues(result.cues, durationMs)
				})
				setToolNote(
					found > 0
						? `Split ${found} speaker change${found === 1 ? '' : 's'} onto their own cues.`
						: 'No "Name:" prefixes were found to split on.',
				)
			},
			onStretch: (factor) => {
				setHandEdited(true)
				commitCues((current) => normalizeCues(stretchTiming(current, factor, durationMs), durationMs))
				setToolNote(`Scaled every timestamp by ${factor.toFixed(3)}x.`)
			},
			onHoldGaps: (maxHoldMs) => {
				setHandEdited(true)
				commitCues((current) => normalizeCues(holdThroughGaps(current, maxHoldMs, durationMs), durationMs))
				setToolNote(`Held each caption up to ${maxHoldMs} ms longer, into the silence after it.`)
			},
			onSnapToFrames: () => {
				setHandEdited(true)
				commitCues((current) => normalizeCues(snapToFrames(current, fps), durationMs))
				setToolNote(`Snapped every timestamp to a ${fps} fps frame boundary.`)
			},
			onSplitLong: (maxMs) => {
				setHandEdited(true)
				let before = 0
				let after = 0
				commitCues((current) => {
					before = current.length
					const next = normalizeCues(splitLongCues(current, maxMs), durationMs)
					after = next.length
					return next
				})
				setToolNote(
					after > before
						? `Split ${after - before} long cue${after - before === 1 ? '' : 's'}.`
						: `No cue ran longer than ${(maxMs / 1000).toFixed(1)}s.`,
				)
			},
			onMergeShort: (minMs) => {
				setHandEdited(true)
				let before = 0
				let after = 0
				commitCues((current) => {
					before = current.length
					const next = normalizeCues(mergeShortCues(current, minMs), durationMs)
					after = next.length
					return next
				})
				setToolNote(
					before > after
						? `Folded ${before - after} short cue${before - after === 1 ? '' : 's'} into their neighbour.`
						: 'Every cue was already long enough to read.',
				)
			},
			onEmphasis: (emphasisWords) => {
				setStyle((current) => ({ ...current, emphasisWords }))
				setToolNote(
					emphasisWords.length > 0
						? `${emphasisWords.length} word${emphasisWords.length === 1 ? '' : 's'} will always take the emphasis colour.`
						: 'Emphasis cleared.',
				)
			},
			onCopyStyle: () => {
				void navigator.clipboard.writeText(JSON.stringify(styleRef.current, null, '\t'))
				setToolNote('Caption style copied as JSON - paste it into another clip to reuse the look.')
			},
			onPasteStyle: (json) => {
				try {
					const parsed = JSON.parse(json) as Partial<CaptionStyle>
					if (typeof parsed !== 'object' || parsed === null) throw new Error('not an object')
					// Only keys the current style already has are taken, so a stale or
					// hand-edited paste can never inject an unknown field.
					const patch: Partial<CaptionStyle> = {}
					for (const key of Object.keys(styleRef.current) as (keyof CaptionStyle)[]) {
						if (key in parsed) Object.assign(patch, { [key]: parsed[key] })
					}
					// A font id from another build would leave the composition without a
					// face to load, so the two id fields are checked against the kit.
					if (!isCaptionFontId(patch.fontId)) delete patch.fontId
					if (!isCaptionFontId(patch.devanagariFontId)) delete patch.devanagariFontId
					setStyle((current) => ({ ...current, ...patch }))
					setToolNote(`Applied ${Object.keys(patch).length} style values from the pasted JSON.`)
				} catch {
					setToolNote('That was not a caption style JSON - copy one from this panel first.')
				}
			},
			onExportAss: () => {
				if (!video || !plan) return
				downloadText(
					cuesToAss(cuesRef.current, styleRef.current, plan),
					downloadFileName(video, 'ass'),
					'text/plain',
				)
				setToolNote('Exported a styled .ass subtitle with per-word karaoke timing.')
			},
		}),
		[aligning, commitCues, durationMs, fps, plan, video],
	)

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
			// Each look also has a sound it was designed with. It is applied, but
			// never switched on: a preset must not start making noise by itself.
			setSound((current) => soundForPreset(id, current))
			// A preset also carries the line length it was designed for, but never
			// at the cost of cues that were split or rewritten by hand.
			if (!handEdited) {
				setLayout(preset.layout)
				commitCues((current) =>
					current.length > 0
						? normalizeCues(
								regroupCues(current, preset.layout, { speech: speechRef.current }),
								durationMs,
							)
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

	/**
	 * Files this clip for the Silence Studio, transcript and all.
	 *
	 * The cues travel on the clip's own clock - the receiving studio only ever
	 * re-times them relative to the cuts it makes, so nothing here needs to know
	 * about silence at all.
	 */
	const handleSendToSilence = useCallback(() => {
		if (!video?.file) return
		setSendToSilenceState('sending')
		void (async () => {
			const ok = await sendToStudio({
				blob: video.file as File,
				from: 'captions',
				to: 'silence',
				facts: {
					name: video.name,
					type: video.file?.type || 'video/mp4',
					sizeInBytes: video.sizeInBytes,
					durationInSeconds: video.durationInSeconds,
					width: video.width,
					height: video.height,
					fps: video.fps,
					hasAudio: video.hasAudio,
				},
				note:
					cues.length > 0
						? `${cues.length} caption${cues.length === 1 ? '' : 's'} came with this clip - cut the dead air and they land on the tightened cut.`
						: 'Cut the dead air out of this clip.',
				cues,
			})
			setSendToSilenceState(ok ? 'sent' : 'failed')
		})()
	}, [cues, video])

	/**
	 * Studio-level keys.
	 *
	 * The timeline owns the ones that act on the selected caption (nudge, split,
	 * delete, undo) because only it knows what is selected; these are the ones
	 * that move the playhead, switch panels, or belong to the document itself.
	 */
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.altKey) return
			const command = event.ctrlKey || event.metaKey

			if (command && event.key.toLowerCase() === 's') {
				// Saving a web page is never what someone means in an editor.
				event.preventDefault()
				void saveSessionNow()
				return
			}
			if (isTypingTarget(event.target) || command) return

			if (event.key === '?' || (event.key === '/' && event.shiftKey)) {
				event.preventDefault()
				setShortcutsOpen((open) => !open)
				return
			}
			if (event.key === 'Escape') {
				setShortcutsOpen(false)
				setPlacingCaption(false)
				return
			}
			const tabForKey = PANEL_KEYS[event.key]
			if (tabForKey) {
				event.preventDefault()
				setTab(tabForKey)
				return
			}
			if (busy || cuesRef.current.length === 0) return

			const key = event.key.toLowerCase()
			if (key === 'j' || key === 'l') {
				event.preventDefault()
				const here = currentMsRef.current
				const target =
					key === 'j'
						? [...cuesRef.current].reverse().find((cue) => cue.startMs < here - 120)
						: cuesRef.current.find((cue) => cue.startMs > here + 120)
				if (target) seekToMsRef.current(target.startMs + 20)
				return
			}
			if (key === 'n') {
				event.preventDefault()
				handleCueAddRef.current(currentMsRef.current)
			}
		}

		window.addEventListener('keydown', onKeyDown)
		return () => window.removeEventListener('keydown', onKeyDown)
	}, [busy, saveSessionNow])

	/* ------------------------------------------------------------- objects */

	/**
	 * Whether this checkout has the 3D pack.
	 *
	 * It is generated by `npm run assets:3d` rather than committed, so its
	 * presence is a fact to be read once, not a guess the panel makes on every
	 * render.
	 */
	useEffect(() => {
		let live = true
		void loadModelCatalog().then((catalog) => {
			if (live) setModelPackAvailable(Boolean(catalog))
		})
		return () => {
			live = false
		}
	}, [])

	/**
	 * Swaps the clip under the captions without touching the transcript.
	 *
	 * `adoptVideo` is the wrong tool for a bake: it clears the cues, because a
	 * user dropping a new file means a new video. Here the file *is* the same
	 * video, one generation later, frame for frame and sample for sample - so
	 * every timing stays valid and has to survive.
	 */
	const replaceWorkingVideo = useCallback(async (file: File) => {
		const next = await probeVideo({ file })
		const previous = videoRef.current
		videoRef.current = next
		setVideo(next)
		if (previous) releaseVideoSource(previous)
		const stored = await writeBlob(CAPTION_VIDEO_BLOB_ID, file, next.name)
		setVideoBlobId(stored ? CAPTION_VIDEO_BLOB_ID : null)
		setVideoBanked(stored)
		return next
	}, [])

	const handleObjectSettings = useCallback((patch: Partial<ObjectSettings>) => {
		setObjectPlan((current) => ({ ...current, settings: { ...current.settings, ...patch } }))
	}, [])

	const handleObjectShot = useCallback((id: string, patch: Partial<ObjectShot>) => {
		setObjectPlan((current) => ({
			...current,
			shots: current.shots.map((shot) => (shot.id === id ? { ...shot, ...patch } : shot)),
		}))
	}, [])

	const handleObjectPlanRun = useCallback(() => {
		if (cuesRef.current.length === 0) return
		objectAbortRef.current?.abort()
		const controller = new AbortController()
		objectAbortRef.current = controller
		setObjectPlanning(true)
		setObjectPlanError(null)
		setObjectPlanNotice(null)

		void (async () => {
			try {
				const result = await directObjects({
					cues: cuesRef.current,
					durationMs,
					mode: objectPlanRef.current.mode,
					useAi: objectPlanRef.current.useAi,
					signal: controller.signal,
				})
				if (controller.signal.aborted) return
				// A re-plan replaces the shots and nothing else: the cut-out
				// settings describe this clip and this speaker, not which objects
				// were chosen, so they survive every re-plan.
				setObjectPlan((current) => ({ ...current, shots: result.shots }))
				setObjectDirector(result.director)
				setObjectModelUsed(result.model)
				setObjectPreview(null)
				setObjectPlanNotice(
					result.shots.length === 0
						? 'Nothing in this transcript named an object in the catalogue. Pick one by hand for a line, or re-word the caption and plan again.'
						: result.notice,
				)
			} catch (error) {
				if (controller.signal.aborted) return
				setObjectPlanError(error instanceof Error ? error.message : String(error))
			} finally {
				if (objectAbortRef.current === controller) objectAbortRef.current = null
				setObjectPlanning(false)
			}
		})()
	}, [durationMs])

	const handleObjectClearPlan = useCallback(() => {
		for (const shot of objectPlanRef.current.shots) {
			if (shot.blobId) void removeBlob(shot.blobId)
		}
		setObjectPlan((current) => ({ ...current, shots: [] }))
		setObjectPreview(null)
		setObjectPlanNotice(null)
		setObjectDirector(null)
		setObjectModelUsed(null)
	}, [])

	const handleObjectShotAsset = useCallback(
		(id: string, assetId: string) => {
			const asset = objectAssetById(assetId)
			if (!asset) return
			const previous = objectPlanRef.current.shots.find((shot) => shot.id === id)
			if (previous?.blobId) void removeBlob(previous.blobId)
			handleObjectShot(id, {
				kind: 'library',
				assetId: asset.id,
				label: asset.label,
				src: objectAssetSrc(asset, previous?.keyword || asset.id),
				blobId: null,
			})
			setObjectPreview(null)
		},
		[handleObjectShot],
	)

	/**
	 * Takes the user's own picture for one shot.
	 *
	 * The bytes go into the vault under that shot's own id so a refresh can draw
	 * it again; the object URL only has to outlive this tab.
	 */
	const handleObjectShotUpload = useCallback(
		(id: string, file: File) => {
			void (async () => {
				const blobId = `${CAPTION_OBJECT_BLOB_PREFIX}${id}`
				const stored = await writeBlob(blobId, file, file.name)
				handleObjectShot(id, {
					kind: 'upload',
					assetId: null,
					label: file.name.replace(/\.[a-z0-9]+$/i, ''),
					src: URL.createObjectURL(file),
					blobId: stored ? blobId : null,
				})
				setObjectPreview(null)
			})()
		},
		[handleObjectShot],
	)

	const handleObjectDeleteShot = useCallback((id: string) => {
		const shot = objectPlanRef.current.shots.find((entry) => entry.id === id)
		if (shot?.blobId) void removeBlob(shot.blobId)
		setObjectPlan((current) => ({
			...current,
			shots: current.shots.filter((entry) => entry.id !== id),
		}))
		setObjectPreview((current) => (current?.shotId === id ? null : current))
	}, [])

	const handleObjectApplyToAll = useCallback(
		(look: Pick<ObjectShot, 'scale' | 'offsetX' | 'offsetY' | 'opacity' | 'motion'>) => {
			setObjectPlan((current) => ({
				...current,
				shots: current.shots.map((shot) => ({ ...shot, ...look })),
			}))
		},
		[],
	)

	/**
	 * Renders one composited frame through the bake's own code path.
	 *
	 * The middle of the shot, because that is where the object is at full
	 * opacity - previewing its first frame would show the entrance and say
	 * nothing about the size being adjusted.
	 */
	const handleObjectPreview = useCallback((id: string) => {
		const source = videoRef.current
		const shot = objectPlanRef.current.shots.find((entry) => entry.id === id)
		if (!shot) return
		if (!source?.file) {
			setObjectPreviewError(NEEDS_LOCAL_FILE)
			return
		}

		objectAbortRef.current?.abort()
		const controller = new AbortController()
		objectAbortRef.current = controller
		setObjectPreviewing(true)
		setObjectPreviewError(null)

		void (async () => {
			try {
				const still = await renderObjectStill({
					shots: objectPlanRef.current.shots,
					settings: objectPlanRef.current.settings,
					probe: source,
					source: source.file as File,
					atSeconds: (shot.startMs + (shot.endMs - shot.startMs) / 2) / 1000,
					safeArea: captionSafeArea(styleRef.current),
					signal: controller.signal,
					resolveBlob: async (blobId) => (await readBlob(blobId))?.blob ?? null,
				})
				if (controller.signal.aborted) return
				setObjectPreview((current) => {
					if (current) URL.revokeObjectURL(current.url)
					return { url: still.url, shotId: id }
				})
			} catch (error) {
				if (controller.signal.aborted) return
				setObjectPreviewError(error instanceof Error ? error.message : String(error))
			} finally {
				if (objectAbortRef.current === controller) objectAbortRef.current = null
				setObjectPreviewing(false)
			}
		})()
	}, [])

	/**
	 * Renders a small, rough, playable version of the finished video.
	 *
	 * The still preview answers "is the picture the right size"; only a moving
	 * one answers "does it arrive when the word is said, and does it sit behind
	 * the head while the head moves". Baking the real thing to find that out
	 * costs minutes and, on a long clip at full size, more graphics memory than
	 * the browser has - which is the failure this exists to route around.
	 *
	 * It never touches the working clip. Nothing is parked, nothing is replaced,
	 * and the result is a blob URL the panel plays and this drops on the next
	 * run.
	 */
	const handleObjectPreviewVideo = useCallback(() => {
		const source = videoRef.current
		if (!source?.file) {
			setObjectMovieError(NEEDS_LOCAL_FILE)
			return
		}
		const shots = objectPlanRef.current.shots
		if (shots.length === 0) {
			setObjectMovieError('There are no objects to preview yet. Plan them first, or use the one press above.')
			return
		}

		objectAbortRef.current?.abort()
		const controller = new AbortController()
		objectAbortRef.current = controller
		setObjectMovieRendering(true)
		setObjectMovieError(null)
		setObjectMovieProgress({ phase: 'preparing', ratio: 0 })

		void (async () => {
			try {
				const result = await previewObjectVideo({
					shots,
					settings: objectPlanRef.current.settings,
					probe: source,
					source: source.file as File,
					safeArea: captionSafeArea(styleRef.current),
					signal: controller.signal,
					resolveBlob: async (blobId) => (await readBlob(blobId))?.blob ?? null,
					onStage: (stage) => setObjectMovieProgress(stage),
				})
				if (controller.signal.aborted) {
					URL.revokeObjectURL(result.url)
					return
				}
				setObjectMovie((current) => {
					if (current) URL.revokeObjectURL(current.url)
					return { url: result.url, note: describeObjectPreview(result) }
				})
			} catch (error) {
				if (controller.signal.aborted) return
				setObjectMovieError(error instanceof Error ? error.message : String(error))
			} finally {
				if (objectAbortRef.current === controller) objectAbortRef.current = null
				setObjectMovieRendering(false)
			}
		})()
	}, [])

	/**
	 * Burns a shot list into the clip and swaps the working video for the result.
	 *
	 * Shared by the button and by the one-press flow, and it takes the shots as
	 * an argument for exactly that reason: the automatic pass has just computed
	 * them and cannot read them back out of state until the next render, so a
	 * version of this that read `objectPlanRef` would bake the previous plan.
	 *
	 * The untouched video is parked in the vault first, before a single frame is
	 * encoded: a step that replaces the thing being edited has to be undoable
	 * from the moment it starts, not from the moment it succeeds.
	 */
	const runObjectBake = useCallback(
		async (
			shots: ObjectShot[],
			controller: AbortController,
			onStage?: (stage: { phase: string; ratio: number }) => void,
		) => {
			const source = videoRef.current
			if (!source?.file) throw new Error(NEEDS_LOCAL_FILE)
			const original = source.file as File
			const plan = objectPlanRef.current

			const parked = plan.originalBlobId
				? true
				: await writeBlob(CAPTION_ORIGINAL_BLOB_ID, original, original.name)

			const result = await bakeObjectVideo({
				shots,
				settings: plan.settings,
				probe: source,
				source: original,
				format: 'mp4',
				quality: 'high',
				// Zero means the clip's own size. Anything else was chosen in the
				// panel, and is usually chosen because the full-size bake ran the
				// browser out of graphics memory.
				maxDimension: plan.settings.outputMaxDimension || undefined,
				// The captions are styled after the bake as often as before it,
				// so the band they own is read at the moment the objects are
				// placed rather than baked into the plan.
				safeArea: captionSafeArea(styleRef.current),
				signal: controller.signal,
				resolveBlob: async (blobId) => (await readBlob(blobId))?.blob ?? null,
				onStage: (stage) => {
					setObjectBakeProgress(stage)
					onStage?.(stage)
				},
			})
			if (controller.signal.aborted) return null

			const baked = new File([result.blob], downloadFileName(source, result.format), {
				type: result.blob.type || 'video/mp4',
			})
			await replaceWorkingVideo(baked)
			URL.revokeObjectURL(result.url)
			bakedFileRef.current = baked

			setObjectPlan((current) => ({
				...current,
				baked: true,
				originalBlobId: parked ? CAPTION_ORIGINAL_BLOB_ID : current.originalBlobId,
				originalName: current.originalName ?? original.name,
			}))
			// The draft was a preview of a clip that no longer exists: the objects
			// are in the working video now, and leaving the old one on screen
			// invites a comparison between a thing and itself.
			setObjectMovie((current) => {
				if (current) URL.revokeObjectURL(current.url)
				return null
			})

			return { result, parked, file: baked }
		},
		[replaceWorkingVideo],
	)

	const handleObjectBake = useCallback(() => {
		const source = videoRef.current
		if (!source?.file) {
			setObjectBakeError(NEEDS_LOCAL_FILE)
			return
		}
		if (objectPlanRef.current.shots.length === 0) return

		objectAbortRef.current?.abort()
		const controller = new AbortController()
		objectAbortRef.current = controller
		setObjectBaking(true)
		setObjectBakeError(null)
		setObjectBakeNote(null)
		setObjectBakeProgress({ phase: 'preparing', ratio: 0 })

		void (async () => {
			try {
				const outcome = await runObjectBake(objectPlanRef.current.shots, controller)
				if (!outcome || controller.signal.aborted) return
				setObjectBakeNote(
					`${describeObjectRender(outcome.result.stats, outcome.result.summary)}. Baked in ${outcome.result.elapsedSeconds.toFixed(
						1,
					)}s. The captions are still a live layer, so restyle them as much as you like${
						outcome.parked
							? ''
							: ' - but this browser could not keep a copy of the original, so there is no way back'
					}.`,
				)
			} catch (error) {
				if (controller.signal.aborted) return
				setObjectBakeError(error instanceof Error ? error.message : String(error))
			} finally {
				if (objectAbortRef.current === controller) objectAbortRef.current = null
				setObjectBaking(false)
			}
		})()
	}, [runObjectBake])

	/**
	 * The one press: subtitles in, finished video out.
	 *
	 * Every step here already exists and already reports itself - transcription,
	 * the keyword pass, the picture search, the cut-out, the bake. What this adds
	 * is the order, one abort controller across all of it, and a single progress
	 * number, because five progress bars in a row is not one press.
	 *
	 * The failures are deliberately uneven. A word whose picture cannot be found
	 * costs that word and nothing else, and is named at the end. A transcript
	 * that cannot be produced, or a plan with no pictures at all, stops the run -
	 * there is nothing to bake, and burning an unchanged video back over itself
	 * would be a slow way to do nothing.
	 */
	const handleObjectAutoRun = useCallback(() => {
		const source = videoRef.current
		if (!source?.file) {
			setObjectAuto({ ...IDLE_AUTO, error: NEEDS_LOCAL_FILE })
			return
		}

		objectAbortRef.current?.abort()
		const controller = new AbortController()
		objectAbortRef.current = controller
		const target = keywordTargetCount(durationMs)
		setObjectAuto({
			...IDLE_AUTO,
			running: true,
			target,
			ratio: 0.01,
			message: 'Reading the subtitles',
		})
		setObjectBakeError(null)
		setObjectBakeNote(null)
		setObjectPlanError(null)

		void (async () => {
			try {
				let cues = cuesRef.current
				if (cues.length === 0) {
					setObjectAuto((current) => ({ ...current, message: 'Transcribing the clip', ratio: 0.02 }))
					cues = (await handleTranscribe()) ?? []
					if (cues.length === 0) {
						throw new Error(
							'The clip could not be transcribed, so there are no words to choose pictures from. Write or import a transcript, then press this again.',
						)
					}
				}
				if (controller.signal.aborted) return

				// The previous plan's pictures go now rather than at the end: they
				// are about to be replaced wholesale, and a run that is stopped
				// halfway should not leave two sets of bytes in the vault.
				for (const shot of objectPlanRef.current.shots) {
					if (shot.blobId) void removeBlob(shot.blobId)
				}

				const plan = await planWebObjects({
					cues,
					durationMs,
					frameWidth: source.width,
					frameHeight: source.height,
					headMultiple: objectPlanRef.current.settings.headMultiple,
					useAi: objectPlanRef.current.useAi,
					signal: controller.signal,
					onProgress: (progress) =>
						setObjectAuto((current) => ({
							...current,
							message: progress.message,
							// The search and the downloads are the first half of the
							// wall clock; the bake is the second.
							ratio: 0.03 + progress.ratio * 0.47,
						})),
					storePicture: async (shotId, blob, name) => {
						const blobId = `${CAPTION_OBJECT_BLOB_PREFIX}${shotId}`
						return (await writeBlob(blobId, blob, name)) ? blobId : null
					},
				})
				if (controller.signal.aborted) return

				for (const id of plan.discarded) void removeBlob(`${CAPTION_OBJECT_BLOB_PREFIX}${id}`)

				setObjectPlan((current) => ({ ...current, shots: plan.shots }))
				setObjectDirector(plan.director)
				setObjectModelUsed(plan.model)
				setObjectPreview(null)
				setObjectPlanNotice(plan.notice)
				setObjectAuto((current) => ({
					...current,
					misses: plan.misses,
					photos: plan.photos,
					ratio: 0.52,
					message: `Placing ${plan.shots.length} pictures behind the speaker`,
				}))

				if (plan.shots.length === 0) {
					throw new Error(
						'No picture could be found for anything said in this clip - not a cut-out, not a shape in the art pack, not even a photograph - so there is nothing to place. Try the art pack below, or drop in your own PNG for a line.',
					)
				}

				const outcome = await runObjectBake(plan.shots, controller, (stage) =>
					setObjectAuto((current) => ({
						...current,
						message: stage.phase,
						ratio: 0.55 + Math.min(1, stage.ratio) * 0.44,
					})),
				)
				if (!outcome || controller.signal.aborted) return

				setObjectAuto((current) => ({
					...current,
					running: false,
					finished: true,
					ratio: 1,
					message: 'Finished',
					note: `${describeAutoPlan(plan)}. ${describeObjectRender(
						outcome.result.stats,
						outcome.result.summary,
					)}. Baked in ${outcome.result.elapsedSeconds.toFixed(
						1,
					)}s. The subtitles are still a live layer on top - style them under Design, then burn them in from Export${
						outcome.parked ? '' : '. This browser could not keep a copy of the original, so there is no way back'
					}.`,
				}))
			} catch (error) {
				if (controller.signal.aborted) {
					setObjectAuto((current) => ({ ...current, running: false, message: 'Stopped' }))
					return
				}
				setObjectAuto((current) => ({
					...current,
					running: false,
					error: error instanceof Error ? error.message : String(error),
				}))
			} finally {
				if (objectAbortRef.current === controller) objectAbortRef.current = null
				setObjectAuto((current) => (current.running ? { ...current, running: false } : current))
			}
		})()
	}, [durationMs, handleTranscribe, runObjectBake])

	const handleObjectCancelAuto = useCallback(() => {
		objectAbortRef.current?.abort()
		setObjectAuto((current) => ({ ...current, running: false, message: 'Stopped' }))
	}, [])

	/** Saves whatever the last bake produced, without baking it again. */
	const handleObjectDownloadBaked = useCallback(() => {
		const file = bakedFileRef.current ?? (videoRef.current?.file as File | undefined) ?? null
		if (!file) return
		const url = URL.createObjectURL(file)
		downloadBlobUrl(url, file.name)
		setTimeout(() => URL.revokeObjectURL(url), 4000)
	}, [])

	const handleObjectRestoreOriginal = useCallback(() => {
		const blobId = objectPlanRef.current.originalBlobId
		if (!blobId) return
		void (async () => {
			setObjectBakeError(null)
			const stored = await readBlob(blobId)
			if (!stored) {
				setObjectBakeError(
					'The original is no longer in this browser’s storage, so it cannot be put back. Drop the file in again to start over.',
				)
				setObjectPlan((current) => ({ ...current, originalBlobId: null, baked: false }))
				return
			}
			const file = new File([stored.blob], stored.name, {
				type: stored.type,
				lastModified: stored.lastModified,
			})
			await replaceWorkingVideo(file)
			setObjectPlan((current) => ({ ...current, baked: false }))
			setObjectBakeNote('The original clip is back. The captions never moved.')
		})()
	}, [replaceWorkingVideo])

	const objectActions = useMemo<ObjectActions>(
		() => ({
			onAutoRun: handleObjectAutoRun,
			onCancelAuto: handleObjectCancelAuto,
			onDownloadBaked: handleObjectDownloadBaked,
			onPlan: handleObjectPlanRun,
			onClearPlan: handleObjectClearPlan,
			onMode: (mode) => setObjectPlan((current) => ({ ...current, mode })),
			onUseAi: (useAi) => setObjectPlan((current) => ({ ...current, useAi })),
			onSettings: handleObjectSettings,
			onShot: handleObjectShot,
			onShotAsset: handleObjectShotAsset,
			onShotUpload: handleObjectShotUpload,
			onDeleteShot: handleObjectDeleteShot,
			onApplyToAll: handleObjectApplyToAll,
			onPreview: handleObjectPreview,
			onPreviewVideo: handleObjectPreviewVideo,
			onCancelPreviewVideo: () => objectAbortRef.current?.abort(),
			onBake: handleObjectBake,
			onRestoreOriginal: handleObjectRestoreOriginal,
			onSeek: (ms) => seekToMsRef.current(ms),
		}),
		[
			handleObjectApplyToAll,
			handleObjectAutoRun,
			handleObjectBake,
			handleObjectCancelAuto,
			handleObjectClearPlan,
			handleObjectDownloadBaked,
			handleObjectDeleteShot,
			handleObjectPlanRun,
			handleObjectPreview,
			handleObjectPreviewVideo,
			handleObjectRestoreOriginal,
			handleObjectSettings,
			handleObjectShot,
			handleObjectShotAsset,
			handleObjectShotUpload,
		],
	)

	const handleReset = useCallback(() => {
		handleClearVideo()
		setStyle(DEFAULT_CAPTION_STYLE)
		setSound(DEFAULT_CAPTION_SOUND)
		setLayout(DEFAULT_LAYOUT)
		setMode('auto')
		setTab('design')
		setToolNote(null)
		setRestoredAt(null)
		setRestoreSummary(null)
		void forgetSession()
	}, [forgetSession, handleClearVideo])

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
				save={{ status: vault.status, savedAt: vault.savedAt, error: vault.error }}
				onReset={handleReset}
				canReset={video !== null || cues.length > 0 || transcriptText.trim().length > 0}
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
						<IconScissors size={15} />
					</span>
					<div className="restore-notice-copy">
						<strong>
							A clip is waiting from the Silence Studio
							<em>
								{handoff.incoming.handoff.name} -{' '}
								{formatSeconds(handoff.incoming.handoff.durationInSeconds)}
							</em>
						</strong>
						<span>
							{handoff.incoming.handoff.note || 'Load it here to caption the tightened cut.'}
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

			<div className="workspace workspace--captions" data-tab={pane}>
				<CaptionSourcePanel
					video={video}
					videoBanked={videoBanked}
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
					restoreEnglish={restoreEnglish}
					onRestoreEnglish={setRestoreEnglish}
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
					onClearVideo={handleClearVideo}
					onMode={setMode}
					onTranscriptText={setTranscriptText}
					onAutoTime={handleAutoTime}
					onImportSubtitles={(file) => void handleImportSubtitles(file)}
					onImportSubtitleText={handleImportSubtitleText}
					importNotice={importNotice}
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

				<section
					className="panel panel--stage"
					data-dragging={dragOverStage}
					onDragOver={handleStageDragOver}
					onDragLeave={handleStageDragLeave}
					onDrop={handleStageDrop}
				>
					<div className="stage-bar">
						<div className="stage-bar-group">
							<span className="chip chip--static">
								<IconCaptions size={12} /> {cues.length} caption{cues.length === 1 ? '' : 's'}
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
							{compiling ? (
								<span className="badge badge--accent">
									<IconSpinner size={11} /> building preview
								</span>
							) : null}
						</div>

						<div className="stage-bar-group stage-bar-group--end">
							<button
								className="btn btn--sm caption-place-button"
								data-active={placingCaption}
								disabled={!composition || busy}
								onClick={() => setPlacingCaption((value) => !value)}
								title="Click directly on the video to position every caption"
							>
								<IconCaptions size={12} />
								<span className="btn-label">
									{placingCaption ? 'Cancel placement' : 'Place on video'}
								</span>
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
							<button
								className="icon-btn"
								onClick={() => setShortcutsOpen(true)}
								title="Keyboard shortcuts (?)"
								aria-label="Keyboard shortcuts"
							>
								<IconKeyboard size={14} />
							</button>
						</div>
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
							<div className="stage-empty stage-empty--captions">
								<span className="stage-empty-mark">
									<IconCaptions size={24} />
								</span>
								<h2>Drop in a video to subtitle</h2>
								<p>
									Your clip never leaves this device, and everything you do here is saved to
									this browser as you work - a refresh mid-edit costs you nothing.
								</p>
								<ol className="stage-steps">
									<li>
										<b>1</b>
										<span>
											<strong>Add the video</strong>
											MP4, MOV or WebM, or paste a link
										</span>
									</li>
									<li>
										<b>2</b>
										<span>
											<strong>Get the words</strong>
											Transcribe it, paste a script, or import an .srt
										</span>
									</li>
									<li>
										<b>3</b>
										<span>
											<strong>Style and render</strong>
											18 presets, then burn the subtitles in
										</span>
									</li>
								</ol>
							</div>
						)}
					</div>

					{dragOverStage ? (
						<div className="stage-drop" aria-hidden="true">
							<span className="stage-drop-mark">
								<IconUpload size={26} />
							</span>
							<strong>Drop to subtitle this clip</strong>
							<small>MP4, MOV or WebM - it is read here and kept in this browser</small>
						</div>
					) : null}

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
						<div className="segmented segmented--icons segmented--wrap">
							<button
								data-active={tab === 'design'}
								onClick={() => setTab('design')}
								title="Design the captions (1)"
							>
								<IconType size={13} /> Design
							</button>
							<button
								data-active={tab === 'sound'}
								onClick={() => setTab('sound')}
								title="Give every caption a sound (2)"
							>
								<IconVolume size={13} /> Sound
								{sound.enabled ? <span className="tab-dot" aria-label="on" /> : null}
							</button>
							<button
								data-active={tab === 'objects'}
								onClick={() => setTab('objects')}
								title="Put an object behind the speaker (3)"
							>
								<IconLayers size={13} /> Objects
								{objectPlan.shots.length > 0 ? <span className="tab-dot" aria-label="planned" /> : null}
							</button>
							<button
								data-active={tab === 'tools'}
								onClick={() => setTab('tools')}
								title="Bulk edit the transcript (4)"
							>
								<IconTools size={13} /> Tools
							</button>
							<button
								data-active={tab === 'export'}
								onClick={() => setTab('export')}
								title="Render and download (5)"
							>
								<IconDownload size={13} /> Render
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
						) : tab === 'sound' ? (
							<CaptionSoundPanel
								sound={sound}
								style={style}
								cueCount={cues.length}
								soundtrack={soundtrack}
								disabled={render.rendering}
								onSound={handleSound}
							/>
						) : tab === 'objects' ? (
							<CaptionObjectPanel
								state={{
									cueCount: cues.length,
									shots: objectPlan.shots,
									settings: objectPlan.settings,
									mode: objectPlan.mode,
									useAi: objectPlan.useAi,
									// The clip's length decides how many objects the flow will ask
									// for, so the panel can say the number before anything runs; a
									// finished run keeps the count it actually used.
									auto:
										objectAuto.target > 0
											? objectAuto
											: { ...objectAuto, target: video ? keywordTargetCount(durationMs) : 0 },
									planning: objectPlanning,
									planNotice: objectPlanNotice,
									planError: objectPlanError,
									directedBy: objectDirector,
									modelUsed: objectModelUsed,
									modelPackAvailable,
									previewing: objectPreviewing,
									preview: objectPreview,
									previewError: objectPreviewError,
									movie: objectMovie,
									movieRendering: objectMovieRendering,
									movieProgress: objectMovieProgress,
									movieError: objectMovieError,
									baking: objectBaking,
									bakeProgress: objectBakeProgress,
									bakeNote: objectBakeNote,
									bakeError: objectBakeError,
									baked: objectPlan.baked,
									canRestore: Boolean(objectPlan.originalBlobId),
									disabled: busy,
								}}
								actions={objectActions}
							/>
						) : tab === 'tools' ? (
							<CaptionToolsPanel
								cues={cues}
								style={style}
								fps={fps}
								disabled={busy}
								aligning={aligning}
								lastAction={toolNote}
								actions={toolActions}
							/>
						) : (
							<CaptionExportPanel
								render={render}
								composition={composition}
								video={video}
								cueCount={cues.length}
								sendToSilenceState={sendToSilenceState}
								onRender={handleRender}
								onDownloadSrt={handleDownloadSrt}
								onDownloadVtt={handleDownloadVtt}
								onSendToSilence={handleSendToSilence}
								onDownloadSource={handleDownloadSource}
							>
								<CloudCaptionBurn
									cloud={cloud}
									file={video?.file ?? null}
									srt={() => cuesToSrt(cues)}
									cueCount={cues.length}
									format={render.settings.format === 'webm' ? 'webm' : 'mp4'}
								/>
								<CloudProjectsPanel
									studio="captions"
									cloud={cloud}
									snapshot={() =>
										session
											? {
													name: video?.name ?? 'Caption workspace',
													version: CAPTION_SESSION_VERSION,
													data: session,
												}
											: null
									}
									onOpen={openCloudSession}
									note={cloudOpened}
								/>
							</CaptionExportPanel>
						)}
					</div>
				</aside>
			</div>

			<nav className="mobile-tabs" aria-label="Subtitle studio sections">
				{CAPTION_PANES.map((item) => {
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

			{shortcutsOpen ? <ShortcutSheet onClose={closeShortcuts} /> : null}
		</div>
	)
}
