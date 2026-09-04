'use client'

import { useEffect, useRef, useState } from 'react'
import type { CloudAsset } from './types'
import type { CloudState } from './use-cloud'
import { ensureUploaded } from './run-tool'

/** Uploads every newly-selected source in cloud mode and keeps its durable Cloudinary identity. */
export function useCloudMedia(args: {
	cloud: CloudState
	file: File | null
	existing?: CloudAsset | null
}): { asset: CloudAsset | null; uploading: boolean; progress: number; error: string | null; setAsset: (asset: CloudAsset | null) => void } {
	const [asset, setAsset] = useState<CloudAsset | null>(args.existing ?? null)
	const [uploading, setUploading] = useState(false)
	const [progress, setProgress] = useState(0)
	const [error, setError] = useState<string | null>(null)
	const previousFile = useRef<File | null>(args.file)

	useEffect(() => {
		if (args.existing) setAsset(args.existing)
	}, [args.existing])

	useEffect(() => {
		const sameCloudFile = Boolean(
			args.file && asset && asset.originalName === args.file.name && (asset.bytes == null || asset.bytes === args.file.size),
		)
		if (previousFile.current !== args.file) {
			previousFile.current = args.file
			if (args.file && !sameCloudFile) setAsset(null)
			setProgress(0)
			setError(null)
		}
		if (!args.cloud.available || args.cloud.location !== 'cloud' || !args.file) return
		if (sameCloudFile) {
			setProgress(1)
			return
		}
		const controller = new AbortController()
		setUploading(true)
		void ensureUploaded({
			file: args.file,
			signal: controller.signal,
			onProgress: ({ ratio }) => setProgress(Math.min(1, ratio * 2)),
		}).then((next) => {
			if (controller.signal.aborted) return
			setAsset(next)
			setProgress(1)
			setError(null)
		}).catch((failure) => {
			if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Cloud upload failed.')
		}).finally(() => {
			if (!controller.signal.aborted) setUploading(false)
		})
		return () => controller.abort()
	}, [args.cloud.available, args.cloud.location, args.file, asset])

	return { asset, uploading, progress, error, setAsset }
}
