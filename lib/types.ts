import type { ComponentType } from 'react'

/** A single file of the uploaded project, path is always POSIX and relative. */
export type SourceFile = {
	path: string
	contents: string
}

export type VirtualProject = {
	name: string
	entry: string
	files: SourceFile[]
}

export type CompositionMeta = {
	id: string
	width: number
	height: number
	fps: number
	durationInFrames: number
	defaultProps?: Record<string, unknown>
	/** true when the values were guessed because the file did not declare them */
	inferred?: boolean
}

export type CompiledComposition = CompositionMeta & {
	component: ComponentType<Record<string, unknown>>
	/** Routes compositions using @remotion/media through the audio-aware web renderer. */
	usesWebMedia: boolean
}

export type CompileResult = {
	compositions: CompiledComposition[]
	warnings: string[]
	/** css collected from `import './styles.css'` statements */
	css: string
}

export type RenderEngine = 'browser' | 'server'

export type QualityPresetId = 'draft' | 'high' | 'max'

export type OutputFormat = 'mp4' | 'webm' | 'gif' | 'prores' | 'png'

export type RenderSettings = {
	engine: RenderEngine
	preset: QualityPresetId
	format: OutputFormat
	/** 0.5 | 1 | 2 - resolution multiplier applied on top of the composition size */
	scale: number
	/** render only the first N seconds, 0 = full composition */
	previewSeconds: number
}

export type RenderPhase =
	| 'idle'
	| 'preparing'
	| 'bundling'
	| 'rendering'
	| 'encoding'
	| 'uploading'
	| 'done'
	| 'error'
	| 'cancelled'

export type RenderProgress = {
	phase: RenderPhase
	/** 0 - 1 */
	progress: number
	message?: string
	renderedFrames?: number
	totalFrames?: number
	framesPerSecond?: number
	etaSeconds?: number
}

export type RenderOutput = {
	url: string
	fileName: string
	sizeInBytes: number
	mimeType: string
	durationMs: number
	engine: RenderEngine
	width: number
	height: number
	codec: string
}

export type ServerCapabilities = {
	enabled: boolean
	requiresKey: boolean
	maxFrames: number
	maxPixels: number
	maxDurationSeconds: number
	blobDelivery: boolean
	concurrency: string
}
