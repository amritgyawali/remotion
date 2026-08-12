#!/usr/bin/env node

/** Prebuilds Chrome, FFmpeg and Remotion into a reusable Vercel Sandbox image. */

const enabled =
	process.env.VERCEL &&
	process.env.ENABLE_SERVER_RENDER === '1' &&
	process.env.RENDER_ACCESS_KEY &&
	process.env.BLOB_READ_WRITE_TOKEN

if (!enabled) {
	console.log('Vercel Sandbox snapshot skipped (browser rendering is ready).')
	process.exit(0)
}

const [{ put }, { createSandbox }] = await Promise.all([
	import('@vercel/blob'),
	import('@remotion/vercel'),
])

const sandbox = await createSandbox({
	resources: { vcpus: Number(process.env.VERCEL_SANDBOX_VCPUS ?? 4) },
	onProgress: ({ progress, message }) => {
		console.log(`[sandbox snapshot] ${message} ${Math.round(progress * 100)}%`)
	},
})

try {
	const snapshot = await sandbox.snapshot({ expiration: 0 })
	const key = `sandbox-snapshots/${process.env.VERCEL_DEPLOYMENT_ID ?? 'local'}.json`
	await put(key, JSON.stringify({ snapshotId: snapshot.snapshotId }), {
		access: 'public',
		contentType: 'application/json',
		addRandomSuffix: false,
		token: process.env.BLOB_READ_WRITE_TOKEN,
	})
	console.log(`[sandbox snapshot] ready: ${snapshot.snapshotId}`)
} finally {
	await sandbox.stop().catch(() => undefined)
}
