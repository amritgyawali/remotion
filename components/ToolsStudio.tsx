'use client'

/**
 * The Tools Studio.
 *
 * Where the other two video studios each do one job well, this one is a
 * toolbox: fifty-odd small, single-purpose edits, browsed and run from one
 * page. The shape follows the same rule as the rest of the app - everything
 * runs in the tab, nothing is uploaded - but the catalogue means the studio
 * itself does almost nothing. A tool is a `ToolDef` from `lib/tools/registry`;
 * running it is one call to `runTool`, which dispatches to whichever of the
 * three small engines (`av-remux`, `video-filter`, `plan-ops`) that tool
 * actually needs. This component's job is just to hold the clip, hold which
 * tool is open and what its knobs are set to, and put the result on screen.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { downloadBlobUrl } from '../lib/format'
import { isVideoFile, probeVideo, releaseVideoSource } from '../lib/captions/video-source'
import type { CaptionVideoSource } from '../lib/captions/types'
import { toolById, type ToolCategory } from '../lib/tools/registry'
import { runTool, type OutputSettings, type RunOutput, type RunParams, type RunProgress } from '../lib/tools/runners'
import { withResolvedDefaults } from '../components/tools/ToolParamForm'
import {
	DEFAULT_OUTPUT_SETTINGS,
	TOOLS_SESSION_KEY,
	TOOLS_SESSION_VERSION,
	TOOLS_VIDEO_BLOB_ID,
	normalizeToolsSession,
	type ToolsSession,
} from '../lib/tools/session'
import { readBlob, removeBlob, requestPersistentStorage, writeBlob } from '../lib/persist/idb'
import { useAutosave, useRestoredSnapshot } from '../lib/persist/use-vault'
import { sendToStudio, useIncomingHandoff } from '../lib/handoff'
import { useCloud } from '../lib/cloud/use-cloud'
import { useCloudMedia } from '../lib/cloud/use-cloud-media'
import { useCloudProjectAutosave } from '../lib/cloud/use-project-autosave'
import { runToolInCloud, toolRunsInCloud } from '../lib/cloud/run-tool'
import CloudProjectsPanel from './cloud/CloudProjectsPanel'
import ToolsTopBar from './tools/ToolsTopBar'
import ToolsSourcePanel from './tools/ToolsSourcePanel'
import ToolsOutputPanel from './tools/ToolsOutputPanel'
import { RestoreNotice } from './SaveState'
import { IconClose, IconDownload, IconFilm, IconTools } from './Icons'

type Pane = 'source' | 'preview' | 'export'

const TOOLS_PANES: Array<{ id: Pane; label: string; icon: typeof IconTools }> = [
	{ id: 'source', label: 'Tools', icon: IconTools },
	{ id: 'preview', label: 'Preview', icon: IconFilm },
	{ id: 'export', label: 'Output', icon: IconDownload },
]

export default function ToolsStudio() {
	/* ------------------------------------------------------------- state */

	const [video, setVideo] = useState<CaptionVideoSource | null>(null)
	const [videoBanked, setVideoBanked] = useState(false)
	const [videoBlobId, setVideoBlobId] = useState<string | null>(null)
	const [loadError, setLoadError] = useState<string | null>(null)

	const [selectedToolId, setSelectedToolId] = useState<string | null>(null)
	const [query, setQuery] = useState('')
	const [category, setCategory] = useState<ToolCategory | null>(null)
	const [paramsByTool, setParamsByTool] = useState<Record<string, RunParams>>({})
	const [secondaryFile, setSecondaryFile] = useState<File | null>(null)
	const [batchFiles, setBatchFiles] = useState<File[]>([])
	const [output, setOutput] = useState<OutputSettings>(DEFAULT_OUTPUT_SETTINGS)

	const [running, setRunning] = useState(false)
	const [progress, setProgress] = useState<RunProgress | null>(null)
	const [outputs, setOutputs] = useState<RunOutput[]>([])
	const [runError, setRunError] = useState<string | null>(null)
	const [sendState, setSendState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle')
	const [pane, setPane] = useState<Pane>('source')
	const [webCodecs, setWebCodecs] = useState(true)
	const [showResult, setShowResult] = useState(false)
	const [restoreSummary, setRestoreSummary] = useState<string | null>(null)
	const [restoreWarning, setRestoreWarning] = useState<string | null>(null)
	const [restoredAt, setRestoredAt] = useState<number | null>(null)

	const cloud = useCloud()
	const { asset: cloudAsset, error: cloudMediaError, setAsset: setCloudAsset } = useCloudMedia({
		cloud,
		file: video?.file ?? null,
	})
	useEffect(() => {
		if (cloud.location === 'cloud' && cloudMediaError) setLoadError(`Cloud upload: ${cloudMediaError}`)
	}, [cloud.location, cloudMediaError])
	const [cloudNote, setCloudNote] = useState<string | null>(null)

	const runAbortRef = useRef<AbortController | null>(null)

	useEffect(() => {
		setWebCodecs(typeof window !== 'undefined' && typeof window.VideoEncoder !== 'undefined')
	}, [])

	const selectedTool = useMemo(() => (selectedToolId ? (toolById(selectedToolId) ?? null) : null), [selectedToolId])

	const currentParams = useMemo(() => {
		if (!selectedTool) return {}
		return withResolvedDefaults(selectedTool, paramsByTool[selectedTool.id] ?? {}, video)
	}, [paramsByTool, selectedTool, video])

	/**
	 * Whether the selected tool, with these exact settings, has something the
	 * cloud can do. It is params-sensitive on purpose: "Crop" with every slider
	 * at zero is a no-op, and offering to upload a gigabyte for it would be a lie.
	 */
	const cloudTool = useMemo(
		() => (selectedTool ? toolRunsInCloud(selectedTool.id, currentParams, output) : false),
		[currentParams, output, selectedTool],
	)

	/* ------------------------------------------------------------- video */

	const loadVideo = useCallback(async (file: File) => {
		setLoadError(null)
		setOutputs((current) => {
			current.forEach((item) => URL.revokeObjectURL(item.url))
			return []
		})
		setRunError(null)
		setSendState('idle')
		setShowResult(false)
		try {
			const next = await probeVideo({ file })
			setVideo((current) => {
				releaseVideoSource(current)
				return next
			})
			void requestPersistentStorage()
			setVideoBanked(false)
			const stored = await writeBlob(TOOLS_VIDEO_BLOB_ID, file, next.name)
			setVideoBlobId(stored ? TOOLS_VIDEO_BLOB_ID : null)
			setVideoBanked(stored)
		} catch (error) {
			setLoadError(error instanceof Error ? error.message : String(error))
		}
	}, [])

	const handleVideoFiles = useCallback(
		(files: File[]) => {
			const file = files.find(isVideoFile) ?? files[0]
			if (!file) return
			if (!isVideoFile(file)) {
				setLoadError(`${file.name} is not a video file. Drop an MP4, MOV or WebM.`)
				return
			}
			void loadVideo(file)
		},
		[loadVideo],
	)

	const handleClearVideo = useCallback(() => {
		runAbortRef.current?.abort()
		setVideo((current) => {
			releaseVideoSource(current)
			return null
		})
		setOutputs((current) => {
			current.forEach((item) => URL.revokeObjectURL(item.url))
			return []
		})
		setRunError(null)
		setSendState('idle')
		setShowResult(false)
		setVideoBanked(false)
		setVideoBlobId(null)
		setCloudAsset(null)
		void removeBlob(TOOLS_VIDEO_BLOB_ID)
	}, [setCloudAsset])

	/* -------------------------------------------------------------- tool */

	const selectTool = useCallback((id: string) => {
		setSelectedToolId(id)
		setSecondaryFile(null)
		setBatchFiles([])
		setOutputs((current) => {
			current.forEach((item) => URL.revokeObjectURL(item.url))
			return []
		})
		setRunError(null)
		setSendState('idle')
		setShowResult(false)
	}, [])

	const backToCatalog = useCallback(() => setSelectedToolId(null), [])

	const patchParam = useCallback(
		(key: string, value: string | number | boolean) => {
			if (!selectedTool) return
			setParamsByTool((current) => ({
				...current,
				[selectedTool.id]: { ...(current[selectedTool.id] ?? {}), [key]: value },
			}))
		},
		[selectedTool],
	)

	/* -------------------------------------------------------------- run */

	const handleRun = useCallback(() => {
		if (!selectedTool) return
		// A batch tool works off its own queue rather than the loaded clip, so it is
		// the queue that has to be non-empty - the studio may hold no clip at all.
		const isBatch = Boolean(selectedTool.multiFile)
		if (cloud.location === 'cloud' && (isBatch || !cloudTool)) {
			setRunError('This operation needs the local media engine. Switch to Local to run it on this machine.')
			return
		}
		if (isBatch ? batchFiles.length === 0 : !video?.file && !(cloud.location === 'cloud' && cloudAsset && cloudTool)) return
		runAbortRef.current?.abort()
		const controller = new AbortController()
		runAbortRef.current = controller

		setRunning(true)
		setRunError(null)
		setSendState('idle')
		setShowResult(false)
		setOutputs((current) => {
			current.forEach((item) => URL.revokeObjectURL(item.url))
			return []
		})
		setProgress({ phase: 'preparing', ratio: 0 })

		void (async () => {
			// A batch run describes itself by its first queued file: the batch handler
			// probes each file itself, but `RunContext` should still name something real
			// rather than carry a stand-in for a clip that was never loaded.
			let batchProbe: CaptionVideoSource | null = null
			try {
				/**
				 * The cloud path, when this visitor asked for it and this tool has a
				 * cloud equivalent. Everything else - batch queues, and the tools whose
				 * work is per-pixel - stays on the device, and the button copy says so
				 * rather than failing here.
				 */
				if (cloud.location === 'cloud' && !isBatch && (video?.file || cloudAsset) && cloudTool) {
					const cloudResult = await runToolInCloud({
						toolId: selectedTool.id,
						file: video?.file,
						asset: cloudAsset,
						params: currentParams,
						output,
						secondaryFile,
						signal: controller.signal,
						onProgress: ({ phase, ratio }) => setProgress({ phase, ratio }),
					})
					if (controller.signal.aborted) return
					setOutputs([
						{
							blob: cloudResult.blob,
							url: cloudResult.url,
							name: cloudResult.name,
							sizeInBytes: cloudResult.sizeInBytes,
							kind: cloudResult.kind,
							meta: cloudResult.meta,
						},
					])
					setShowResult(true)
					return
				}

				if (isBatch) batchProbe = await probeVideo({ file: batchFiles[0] })
				if (controller.signal.aborted) return
				const primary = isBatch ? batchFiles[0] : (video?.file as File)
				const probe = isBatch ? (batchProbe as CaptionVideoSource) : (video as CaptionVideoSource)
				const result = await runTool(selectedTool, {
					file: primary,
					probe,
					params: currentParams,
					secondaryFile,
					batchFiles: isBatch ? batchFiles : [],
					output,
					signal: controller.signal,
					onProgress: setProgress,
				})
				if (controller.signal.aborted) return
				setOutputs(result.outputs)
				setShowResult(true)
			} catch (error) {
				if (controller.signal.aborted) return
				setRunError(error instanceof Error ? error.message : String(error))
			} finally {
				releaseVideoSource(batchProbe)
				if (runAbortRef.current === controller) {
					setRunning(false)
					setProgress(null)
					runAbortRef.current = null
				}
			}
		})()
	}, [batchFiles, cloud.location, cloudAsset, cloudTool, currentParams, output, secondaryFile, selectedTool, video])

	const handleCancelRun = useCallback(() => {
		runAbortRef.current?.abort()
		runAbortRef.current = null
		setRunning(false)
		setProgress(null)
	}, [])

	const handleDownload = useCallback(
		(index: number) => {
			const item = outputs[index]
			if (!item) return
			downloadBlobUrl(item.url, item.name)
		},
		[outputs],
	)

	const handleSendTo = useCallback(
		(target: 'silence' | 'captions') => {
			const item = outputs[0]
			if (!item || !video) return
			setSendState('sending')
			void (async () => {
				const ok = await sendToStudio({
					blob: item.blob,
					from: 'tools',
					to: target,
					facts: {
						name: item.name,
						type: item.blob.type,
						sizeInBytes: item.sizeInBytes,
						durationInSeconds: video.durationInSeconds,
						width: video.width,
						height: video.height,
						fps: video.fps,
						hasAudio: video.hasAudio,
					},
					note: `Sent from Tools Studio${selectedTool ? ` - ${selectedTool.name} applied` : ''}.`,
				})
				setSendState(ok ? 'sent' : 'failed')
			})()
		},
		[outputs, selectedTool, video],
	)

	/* ------------------------------------------------------ persistence */

	const restore = useRestoredSnapshot<unknown>({
		key: TOOLS_SESSION_KEY,
		version: TOOLS_SESSION_VERSION,
		apply: async (data, updatedAt) => {
			const session = normalizeToolsSession(data)
			if (!session) return

			setSelectedToolId(session.selectedToolId)
			setParamsByTool(session.paramsByTool)
			setOutput(session.output)
			setCategory((session.activeCategory as ToolCategory) ?? null)
			setQuery(session.query)

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
				} else {
					warning =
						'Your tool settings came back, but the clip itself was dropped by the browser to free space. Pick the file again.'
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

			setRestoredAt(updatedAt)
			setRestoreWarning(warning)
			setRestoreSummary(notes.length > 0 ? `Brought back ${notes.join(', ')}.` : null)
		},
	})

	const snapshot: ToolsSession | null = useMemo(() => {
		if (!video && !selectedToolId && Object.keys(paramsByTool).length === 0) return null
		return {
			video: video
				? {
						blobId: videoBlobId,
						name: video.name,
						sizeInBytes: video.sizeInBytes,
						durationInSeconds: video.durationInSeconds,
						width: video.width,
						height: video.height,
						fps: video.fps,
						hasAudio: video.hasAudio,
						cloudAsset,
					}
				: null,
			selectedToolId,
			paramsByTool,
			output,
			activeCategory: category,
			query,
		}
	}, [category, cloudAsset, output, paramsByTool, query, selectedToolId, video, videoBlobId])

	const cloudSnapshot = useMemo(
		() => snapshot ? { name: video?.name ?? 'Tools workspace', version: TOOLS_SESSION_VERSION, data: snapshot } : null,
		[snapshot, video?.name],
	)
	useCloudProjectAutosave({ studio: 'tools', cloud, snapshot: cloudSnapshot })

	const vault = useAutosave<ToolsSession>({
		key: TOOLS_SESSION_KEY,
		version: TOOLS_SESSION_VERSION,
		data: snapshot,
		enabled: restore.phase !== 'loading',
	})

	/* --------------------------------------------------------- hand-off */

	const handoff = useIncomingHandoff('tools', restore.phase !== 'loading')

	const acceptHandoff = useCallback(() => {
		void (async () => {
			const taken = await handoff.accept()
			if (!taken) return
			await loadVideo(taken.file)
		})()
	}, [handoff, loadVideo])

	/* ------------------------------------------------------------ reset */

	const handleReset = useCallback(() => {
		handleClearVideo()
		setSelectedToolId(null)
		setSecondaryFile(null)
		setBatchFiles([])
		setParamsByTool({})
		setOutput(DEFAULT_OUTPUT_SETTINGS)
		setQuery('')
		setCategory(null)
		setRestoreSummary(null)
		setRestoreWarning(null)
		void vault.forget()
	}, [handleClearVideo, vault])

	useEffect(() => () => runAbortRef.current?.abort(), [])

	/* ------------------------------------------------------------- view */

	const previewOutput = outputs.find((item) => item.kind === 'video') ?? null
	const previewUrl = showResult && previewOutput ? previewOutput.url : video?.url

	return (
		<div className="app">
			<ToolsTopBar
				webCodecs={webCodecs}
				cloud={cloud}
				save={{ status: vault.status, savedAt: vault.savedAt, error: vault.error }}
				onReset={handleReset}
				canReset={video !== null || selectedToolId !== null}
			/>

			{restore.phase === 'restored' && (restoreSummary || restoreWarning) ? (
				<RestoreNotice updatedAt={restoredAt} summary={restoreSummary ?? ''} warning={restoreWarning} onDiscard={handleReset} />
			) : null}

			{handoff.incoming ? (
				<div className="restore-notice" data-tone="ok" role="status">
					<span className="restore-notice-mark">
						<IconTools size={15} />
					</span>
					<div className="restore-notice-copy">
						<strong>
							A clip is waiting from another studio
							<em>{handoff.incoming.handoff.name}</em>
						</strong>
						<span>{handoff.incoming.handoff.note || 'Load it here to run a tool on it.'}</span>
					</div>
					<button type="button" className="restore-notice-action" onClick={acceptHandoff}>
						Load it
					</button>
					<button type="button" className="restore-notice-close" aria-label="Dismiss" onClick={handoff.dismiss}>
						<IconClose size={13} />
					</button>
				</div>
			) : null}

			<div className="workspace" data-tab={pane}>
				<ToolsSourcePanel
					video={video}
					videoBanked={videoBanked}
					busy={running}
					selectedTool={selectedTool}
					query={query}
					category={category}
					params={currentParams}
					secondaryFile={secondaryFile}
					batchFiles={batchFiles}
					onVideoFiles={handleVideoFiles}
					onClearVideo={handleClearVideo}
					onQuery={setQuery}
					onCategory={setCategory}
					onSelectTool={selectTool}
					onBackToCatalog={backToCatalog}
					onParamChange={patchParam}
					onSecondaryFile={setSecondaryFile}
					onBatchFiles={setBatchFiles}
				/>

				<section className="panel panel--stage">
					<div className="stage-bar">
						<div className="stage-bar-group">
							{selectedTool ? (
								<span className="chip chip--static">
									<selectedTool.icon size={12} /> {selectedTool.name}
								</span>
							) : null}
							{video ? (
								<span className="chip chip--static">
									{video.width} x {video.height}
								</span>
							) : null}
						</div>
						{previewOutput ? (
							<div className="segmented" role="group" aria-label="Preview">
								<button data-active={!showResult} onClick={() => setShowResult(false)}>
									Original
								</button>
								<button data-active={showResult} onClick={() => setShowResult(true)}>
									Result
								</button>
							</div>
						) : null}
					</div>

					<div className="stage">
						{loadError ? (
							<div className="notice notice--error" style={{ margin: 16 }}>
								<span>{loadError}</span>
							</div>
						) : null}

						{previewUrl ? (
							<div className="stage-frame">
								<video key={previewUrl} src={previewUrl} controls playsInline className="result-media" style={{ width: '100%', height: '100%' }} />
							</div>
						) : (
							<div className="stage-empty">
								<span className="stage-empty-mark">
									<IconFilm size={22} />
								</span>
								<h2>Upload a clip to get started</h2>
								<p>Pick a tool from the left, or drop a video first - either order works.</p>
							</div>
						)}
					</div>
				</section>

				<ToolsOutputPanel
					tool={selectedTool}
					hasVideo={video !== null}
					batchCount={batchFiles.length}
					webCodecs={webCodecs}
					output={output}
					onOutput={(patch) => setOutput((current) => ({ ...current, ...patch }))}
					running={running}
					progress={progress}
					outputs={outputs}
					runError={runError}
					sendState={sendState}
					onRun={handleRun}
					onCancel={handleCancelRun}
					onDownload={handleDownload}
					onSendTo={handleSendTo}
					cloud={cloud}
					cloudTool={cloudTool}
					cloudNote={cloudNote}
				>
					<CloudProjectsPanel
						studio="tools"
						cloud={cloud}
						snapshot={() => cloudSnapshot}
						onOpen={async (data) => {
							const session = normalizeToolsSession(data)
							if (!session) return
							setSelectedToolId(session.selectedToolId)
							setParamsByTool(session.paramsByTool)
							setOutput(session.output)
							setCategory((session.activeCategory as ToolCategory) ?? null)
							setQuery(session.query)
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
									? `Settings restored. Load "${session.video.name}" again to run them.`
									: 'Settings restored.',
							)
						}}
					/>
				</ToolsOutputPanel>
			</div>

			<nav className="mobile-tabs" aria-label="Tools studio sections">
				{TOOLS_PANES.map((item) => {
					const Icon = item.icon
					return (
						<button key={item.id} className="mobile-tab" data-active={pane === item.id} aria-current={pane === item.id} onClick={() => setPane(item.id)}>
							<Icon size={17} />
							{item.label}
						</button>
					)
				})}
			</nav>
		</div>
	)
}
