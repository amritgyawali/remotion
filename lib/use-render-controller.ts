'use client'

/**
 * The render pipeline, shared by the code studio and the subtitle studio.
 *
 * It owns the output settings, the server capability probe, progress, the log
 * and the finished file - so both tools encode through exactly the same browser
 * and server paths and behave identically when a render is cancelled.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { renderInBrowser, renderStillInBrowser, RenderCancelled, isWebCodecsSupported } from './browser-render'
import { deviceProfile, keepScreenAwake } from './device'
import { isChunkLoadError } from './lazy-chunk'
import { DEFAULT_CAPABILITIES, fetchServerCapabilities, renderOnServer } from './server-render-client'
import { safeFileName } from './format'
import { FORMAT_INFO } from './presets'
import type {
	CompiledComposition,
	RenderOutput,
	RenderProgress,
	RenderSettings,
	ServerCapabilities,
	VirtualProject,
} from './types'

const IDLE: RenderProgress = { phase: 'idle', progress: 0 }

/**
 * Turns a raw failure into something a person can act on.
 *
 * The browser encoder reports its two most common failures - a chunk that never
 * arrived and a tab that ran out of memory - in wording that describes webpack
 * and WebCodecs internals rather than what the person should do next. Phones hit
 * both far more often than laptops, so each one is translated into the setting
 * that actually fixes it.
 */
function explainRenderFailure(error: unknown, settings: RenderSettings): string {
	const message = error instanceof Error ? error.message : String(error)
	const device = deviceProfile()

	if (isChunkLoadError(error)) {
		return (
			`${message} The video encoder is downloaded once per visit - stay on this tab while it loads, ` +
			'then press Render again.'
		)
	}
	if (/out of memory|allocation failed|Array buffer allocation|QuotaExceeded/i.test(message)) {
		const advice =
			settings.scale > 1
				? 'Set the resolution back to 1x'
				: settings.previewSeconds === 0
					? 'Render a shorter slice first, or use the Balanced quality preset'
					: 'Try the Balanced quality preset'
		return `${message} This device ran out of room for the render. ${advice}.`
	}
	if (device.mobile && /decode|codec|encoder|configuration/i.test(message)) {
		return `${message} On a phone, 1x resolution and the MP4 format are the combination most likely to finish.`
	}
	return message
}

export type StartRenderArgs = {
	project: VirtualProject
	composition: CompiledComposition
	css?: string
	/** overrides the default "<composition>-<preset>.<ext>" name */
	fileName?: string
}

export type RenderController = {
	settings: RenderSettings
	updateSettings: (patch: Partial<RenderSettings>) => void
	capabilities: ServerCapabilities
	webCodecs: boolean
	progress: RenderProgress
	output: RenderOutput | null
	error: string | null
	rendering: boolean
	log: string[]
	accessKey: string
	setAccessKey: (value: string) => void
	startRender: (args: StartRenderArgs) => Promise<void>
	cancel: () => void
	reset: () => void
}

export function useRenderController(initialSettings: RenderSettings): RenderController {
	const [settings, setSettings] = useState<RenderSettings>(initialSettings)
	const [capabilities, setCapabilities] = useState<ServerCapabilities>(DEFAULT_CAPABILITIES)
	const [webCodecs, setWebCodecs] = useState(true)
	const [progress, setProgress] = useState<RenderProgress>(IDLE)
	const [output, setOutput] = useState<RenderOutput | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [rendering, setRendering] = useState(false)
	const [log, setLog] = useState<string[]>([])
	const [accessKey, setAccessKey] = useState('')

	const abortRef = useRef<AbortController | null>(null)
	const objectUrlRef = useRef<string | null>(null)

	useEffect(() => {
		setWebCodecs(isWebCodecsSupported())
		let active = true
		fetchServerCapabilities().then((next) => {
			if (active) setCapabilities(next)
		})
		return () => {
			active = false
		}
	}, [])

	const replaceOutput = useCallback((next: RenderOutput | null) => {
		if (objectUrlRef.current) {
			URL.revokeObjectURL(objectUrlRef.current)
			objectUrlRef.current = null
		}
		if (next && next.url.startsWith('blob:')) objectUrlRef.current = next.url
		setOutput(next)
	}, [])

	useEffect(() => {
		return () => {
			abortRef.current?.abort()
			if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
		}
	}, [])

	const updateSettings = useCallback((patch: Partial<RenderSettings>) => {
		setSettings((current) => {
			const next = { ...current, ...patch }
			// Keep the format valid for the selected engine.
			if (!FORMAT_INFO[next.format].engines.includes(next.engine)) next.format = 'mp4'
			return next
		})
	}, [])

	const reset = useCallback(() => {
		abortRef.current?.abort()
		replaceOutput(null)
		setError(null)
		setProgress(IDLE)
		setLog([])
	}, [replaceOutput])

	const startRender = useCallback(
		async ({ project, composition, css, fileName }: StartRenderArgs) => {
			const controller = new AbortController()
			abortRef.current = controller
			setRendering(true)
			setError(null)
			replaceOutput(null)
			setLog([])
			setProgress({ phase: 'preparing', progress: 0.01 })

			const extension = FORMAT_INFO[settings.format].extension
			const name =
				fileName ?? `${safeFileName(composition.id)}-${settings.preset}.${extension}`

			const onProgress = (next: RenderProgress) => {
				setProgress(next)
				if (next.message) {
					setLog((current) => {
						if (current[current.length - 1] === next.message) return current
						return [...current, next.message as string].slice(-60)
					})
				}
			}

			// A phone that locks its screen suspends this tab, which stalls the
			// encoder and then kills the render. The lock is released in `finally`.
			const releaseWakeLock =
				settings.engine === 'browser' ? await keepScreenAwake() : () => undefined

			try {
				const result =
					settings.engine === 'server'
						? await renderOnServer({
								project,
								compositionId: composition.id,
								settings,
								fileName: name,
								accessKey: accessKey || undefined,
								overrides: {
									width: composition.width,
									height: composition.height,
									fps: composition.fps,
									durationInFrames: composition.durationInFrames,
								},
								onProgress,
								signal: controller.signal,
							})
						: settings.format === 'png'
							? await renderStillInBrowser({
									composition,
									settings,
									css,
									fileName: name,
									onProgress,
									signal: controller.signal,
								})
							: await renderInBrowser({
									composition,
									settings,
									css,
									fileName: name,
									onProgress,
									signal: controller.signal,
								})

				replaceOutput(result)
				setProgress({ phase: 'done', progress: 1, message: 'Render complete' })
			} catch (renderError) {
				if (renderError instanceof RenderCancelled || controller.signal.aborted) {
					setProgress({ phase: 'cancelled', progress: 0, message: 'Cancelled' })
				} else {
					setError(explainRenderFailure(renderError, settings))
					setProgress({ phase: 'error', progress: 0 })
				}
			} finally {
				releaseWakeLock()
				abortRef.current = null
				setRendering(false)
			}
		},
		[accessKey, replaceOutput, settings],
	)

	const cancel = useCallback(() => {
		abortRef.current?.abort()
	}, [])

	return {
		settings,
		updateSettings,
		capabilities,
		webCodecs,
		progress,
		output,
		error,
		rendering,
		log,
		accessKey,
		setAccessKey,
		startRender,
		cancel,
		reset,
	}
}
