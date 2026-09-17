'use client'

/**
 * A small, fast stand-in for the clip, played instead of it while editing.
 *
 * Every studio here previews the file the person actually dropped in. That is
 * honest, and for a phone-shot 4K clip it is also miserable: the preview has to
 * decode eight million pixels per frame to show them on a panel six hundred
 * wide, and every scrub lands between key frames that can be five seconds
 * apart, so the decoder replays seconds of video before it can paint anything.
 * The wait is not the studio thinking. It is the browser decoding pixels nobody
 * will ever see, over and over.
 *
 * So the clip is transcoded once, in the background, into a proxy: the same
 * footage at preview size, with a key frame twice a second. Two numbers change
 * and both of them matter.
 *
 *   - **Fewer pixels.** A 4K frame is twenty times the work of a 960-wide one,
 *     and the decoded-frame cache the preview keeps holds twenty times as many
 *     of them, which turns a two-second lookahead into most of a minute.
 *   - **Closer key frames.** A seek costs "decode everything since the last key
 *     frame". At a half-second interval that is at most fifteen frames, so a
 *     scrub, a cue click and the jump over a silence all land immediately
 *     rather than after a visible pause.
 *
 * Nothing here touches what gets exported. The proxy only ever reaches a
 * `<video>` element or the Player; every render path keeps reading the original
 * file, so the smaller copy cannot leak into the output.
 *
 * The result is written to the Origin Private File System under a key derived
 * from the file itself, which makes it survive a reload: the second time a clip
 * is opened the preview is smooth before the first frame is painted, and the
 * transcode never runs again.
 */

import type { CaptionVideoSource } from '../captions/types'
import { deviceProfile } from '../device'
import { memoryBudget, type MemoryTier } from './memory-budget'
import { loadMediaEngine } from '../lazy-chunk'
import { storageEstimate } from '../persist/idb'

/** Bumped whenever the encode settings below change, so stale files are ignored. */
const PROXY_FORMAT_VERSION = 1

const PROXY_DIRECTORY = 'studio-proxies'

/** How many proxies stay on disk. Beyond this the least recently used go. */
const RETAINED_PROXIES = 6

/**
 * Seconds between key frames in the proxy.
 *
 * This is the number the whole feature turns on. A camera writes a key frame
 * every one to five seconds because it is optimising for file size; a proxy is
 * optimising for the opposite thing, and half a second costs perhaps a fifth
 * more bytes in a file that is already a twentieth of the original.
 */
const KEY_FRAME_SECONDS = 0.5

/** A source whose own key frames are at least this far apart is worth proxying. */
const SLOW_SEEK_THRESHOLD_SECONDS = 1.5

/**
 * Slack demanded on top of the proxy's own size before one is written to disk.
 *
 * A proxy is small - a few megabytes per minute - so a flat "hundreds of
 * megabytes free or nothing" rule would refuse to help exactly the machines
 * that need it most, which are usually the ones with a full drive. What has to
 * be true is only that the write will fit with room to spare.
 */
const HEADROOM_MARGIN_BYTES = 32 * 1024 * 1024

/** Without a writable OPFS the proxy lives in RAM, so only a small one is built. */
const MAX_IN_MEMORY_BYTES = 64 * 1024 * 1024

/** The longest side of the proxy, by how much memory the machine admits to. */
const LONG_EDGE: Record<MemoryTier, number> = {
	tight: 540,
	modest: 720,
	roomy: 960,
}

/** A preview never needs more than this many frames per second. */
const MAX_PROXY_FPS = 30

export type PreviewProxy = {
	/** object URL of the proxy file - hand this to a player, never to a render */
	url: string
	width: number
	height: number
	fps: number
	sizeInBytes: number
	/** what a seek costs, in seconds of video the decoder has to replay */
	keyFrameSeconds: number
	/** true when the file came off disk rather than being encoded just now */
	cached: boolean
}

export type ProxyOutcome =
	| { status: 'ready'; proxy: PreviewProxy }
	/** the original already plays well enough; there is nothing to gain */
	| { status: 'not-needed'; reason: string }
	/** no encoder, no room, or a file this browser cannot re-encode */
	| { status: 'unavailable'; reason: string }

export type ProxyPlan = {
	width: number
	height: number
	fps: number
	videoBitrate: number
	audioBitrate: number
	container: 'mp4' | 'webm'
	keyFrameSeconds: number
}

export class ProxyCancelled extends Error {
	constructor() {
		super('Preview proxy cancelled')
		this.name = 'ProxyCancelled'
	}
}

function evenSize(value: number): number {
	const rounded = Math.max(2, Math.round(value))
	return rounded % 2 === 0 ? rounded : rounded + 1
}

/**
 * The shape of the proxy for this clip on this machine.
 *
 * Bitrate is derived from the pixel count rather than picked from a table, so a
 * vertical phone clip and a wide screen recording both come out at a quality
 * that looks like the original rather than at whatever a landscape-shaped
 * constant happened to imply.
 */
export function proxyPlanFor(video: { width: number; height: number; fps: number }): ProxyPlan {
	const profile = deviceProfile()
	const budget = memoryBudget()
	const longEdge = profile.mobile ? Math.min(540, LONG_EDGE[budget.tier]) : LONG_EDGE[budget.tier]

	const sourceLong = Math.max(1, video.width, video.height)
	const scale = Math.min(1, longEdge / sourceLong)
	const width = evenSize(video.width * scale)
	const height = evenSize(video.height * scale)
	const fps = Math.min(MAX_PROXY_FPS, Math.max(1, Math.round(video.fps || 30)))

	// Roughly 0.09 bits per pixel per frame, a comfortable H.264 rate for
	// material watched at preview size, with headroom for the extra key frames.
	// Clamped at both ends so a postage stamp still looks like something and a
	// large proxy never approaches the original's rate.
	const videoBitrate = Math.round(
		Math.min(2_500_000, Math.max(400_000, width * height * fps * 0.09)),
	)

	return {
		width,
		height,
		fps,
		videoBitrate,
		audioBitrate: 128_000,
		container: 'mp4',
		keyFrameSeconds: KEY_FRAME_SECONDS,
	}
}

/** Bytes the finished proxy is expected to take. Used to decide where it goes. */
function estimateProxyBytes(plan: ProxyPlan, durationInSeconds: number, hasAudio: boolean): number {
	const bits = (plan.videoBitrate + (hasAudio ? plan.audioBitrate : 0)) * durationInSeconds
	return Math.round(bits / 8)
}

/**
 * A stable name for this clip's proxy.
 *
 * Built from the facts that would change the pixels - which file, how long, how
 * big, and what the proxy was asked to be - so the same drop of the same file
 * finds its proxy, and the same file previewed on a roomier machine does not
 * get handed the small one. A plain string hash is enough: a collision costs a
 * preview that looks like the wrong clip until it is cleared, not a corrupted
 * export.
 */
export function proxyCacheKey(video: CaptionVideoSource, plan: ProxyPlan): string {
	const descriptor = [
		PROXY_FORMAT_VERSION,
		video.kind === 'file' ? video.name : video.url,
		video.sizeInBytes,
		Math.round(video.durationInSeconds * 1000),
		`${video.width}x${video.height}`,
		`${plan.width}x${plan.height}`,
		plan.fps,
		plan.videoBitrate,
		plan.keyFrameSeconds,
	].join('|')

	// FNV-1a, run twice with different mixing constants - enough that the
	// birthday odds across a handful of cached files are not worth thinking
	// about, and short enough to read in a storage inspector.
	let a = 0x811c9dc5
	let b = 0x01000193
	for (let index = 0; index < descriptor.length; index += 1) {
		const code = descriptor.charCodeAt(index)
		a = Math.imul(a ^ code, 0x01000193) >>> 0
		b = Math.imul(b ^ code, 0x85ebca6b) >>> 0
	}
	return `p${PROXY_FORMAT_VERSION}-${a.toString(36)}${b.toString(36)}`
}

/* ------------------------------------------------------------------ disk */

async function openProxyDirectory(): Promise<FileSystemDirectoryHandle | null> {
	try {
		if (typeof navigator === 'undefined') return null
		const root = await navigator.storage?.getDirectory?.()
		if (!root) return null
		return await root.getDirectoryHandle(PROXY_DIRECTORY, { create: true })
	} catch {
		// No OPFS, or a private window that refuses it. The caller falls back to
		// building in memory, or to not building at all.
		return null
	}
}

function directoryNames(directory: FileSystemDirectoryHandle): AsyncIterable<string> {
	return (directory as unknown as { keys(): AsyncIterable<string> }).keys()
}

/**
 * Drops the least recently used proxies.
 *
 * `keep` is the one about to be written, which has no bytes yet and would
 * otherwise sort straight to the front of the queue for deletion.
 */
async function sweepProxies(directory: FileSystemDirectoryHandle, keep: string): Promise<void> {
	try {
		const entries: Array<{ name: string; lastModified: number }> = []
		for await (const name of directoryNames(directory)) {
			if (name === keep) continue
			try {
				const handle = await directory.getFileHandle(name)
				const file = await handle.getFile()
				entries.push({ name, lastModified: file.lastModified })
			} catch {
				entries.push({ name, lastModified: 0 })
			}
		}
		entries.sort((left, right) => right.lastModified - left.lastModified)
		for (const entry of entries.slice(Math.max(0, RETAINED_PROXIES - 1))) {
			await directory.removeEntry(entry.name).catch(() => {})
		}
	} catch {
		// A browser without directory iteration keeps its files; they are
		// overwritten by name rather than accumulating without bound.
	}
}

/**
 * An object URL a media element will actually accept.
 *
 * A file read back out of the private file system carries no MIME type, and a
 * `blob:` URL has no other way to declare one - so the element is handed a
 * typeless stream and may simply refuse it. Re-labelling costs nothing: the
 * slice is a view over the same disk-backed bytes, not a copy of them.
 */
function objectUrlFor(blob: Blob, mimeType: string): string {
	return URL.createObjectURL(blob.type === mimeType ? blob : blob.slice(0, blob.size, mimeType))
}

/** Looks for a finished proxy on disk, under either container extension. */
async function readCachedProxy(key: string, plan: ProxyPlan): Promise<PreviewProxy | null> {
	const directory = await openProxyDirectory()
	if (!directory) return null

	for (const extension of ['mp4', 'webm'] as const) {
		const name = `${key}.${extension}`
		try {
			const handle = await directory.getFileHandle(name)
			const file = await handle.getFile()
			if (file.size === 0) {
				// A build interrupted part-way leaves an empty file behind.
				await directory.removeEntry(name).catch(() => {})
				continue
			}
			return {
				url: objectUrlFor(file, extension === 'mp4' ? 'video/mp4' : 'video/webm'),
				width: plan.width,
				height: plan.height,
				fps: plan.fps,
				sizeInBytes: file.size,
				keyFrameSeconds: plan.keyFrameSeconds,
				cached: true,
			}
		} catch {
			/* try the other container */
		}
	}
	return null
}

/** Throws away every cached proxy. Offered for a "clear local data" control. */
export async function clearPreviewProxies(): Promise<void> {
	const directory = await openProxyDirectory()
	if (!directory) return
	try {
		for await (const name of directoryNames(directory)) {
			await directory.removeEntry(name).catch(() => {})
		}
	} catch {
		/* already gone */
	}
}

/* --------------------------------------------------------------- probing */

type SourceFacts = {
	/** seconds between the source's own key frames, measured rather than guessed */
	keyFrameSeconds: number
	width: number
	height: number
	hasAudio: boolean
	decodable: boolean
}

/**
 * How expensive this file actually is to scrub.
 *
 * Two key packets is all it takes: the distance between the first one and the
 * one after it is the decode debt of every seek in the file. Reading them costs
 * a couple of metadata-only range requests, which is nothing next to deciding
 * wrongly and transcoding a file that was already fine.
 */
export async function measureSource(
	input: import('mediabunny').Input,
	EncodedPacketSink: typeof import('mediabunny').EncodedPacketSink,
): Promise<SourceFacts | null> {
	const track = await input.getPrimaryVideoTrack()
	if (!track) return null

	const [decodable, width, height, audioTrack] = await Promise.all([
		track.canDecode(),
		track.getDisplayWidth(),
		track.getDisplayHeight(),
		input.getPrimaryAudioTrack(),
	])

	let keyFrameSeconds = 0
	try {
		const packets = new EncodedPacketSink(track)
		const first = await packets.getFirstKeyPacket({ metadataOnly: true })
		const second = first ? await packets.getNextKeyPacket(first, { metadataOnly: true }) : null
		if (first && second) {
			keyFrameSeconds = Math.max(0, second.timestamp - first.timestamp)
		} else if (first) {
			// One key frame in the whole file: every seek backwards decodes from
			// the beginning, which is the most expensive shape a clip can have.
			keyFrameSeconds = Number.POSITIVE_INFINITY
		}
	} catch {
		// A container that will not answer is treated as a slow one, which is the
		// safe direction: the worst case is a proxy that was not strictly needed.
		keyFrameSeconds = SLOW_SEEK_THRESHOLD_SECONDS
	}

	return { keyFrameSeconds, width, height, hasAudio: audioTrack !== null, decodable }
}

/* -------------------------------------------------------------- building */

/**
 * One transcode at a time, across every studio in the tab.
 *
 * Two proxies encoding at once is not twice as fast - it is the same work
 * fighting over one set of hardware encoders, while the preview they are both
 * meant to smooth stutters from the contention.
 */
let queue: Promise<unknown> = Promise.resolve()

/** Builds already running, so two panels asking for one clip do one transcode. */
const inFlight = new Map<string, Promise<ProxyOutcome>>()

export type BuildProxyOptions = {
	video: CaptionVideoSource
	signal?: AbortSignal
	onProgress?: (ratio: number) => void
}

/**
 * Resolves with a proxy, with the reason one is not needed, or with the reason
 * one could not be made. Only a cancel throws, so a caller never has to tell a
 * real failure from a deliberate teardown by reading a message.
 */
export async function buildPreviewProxy(options: BuildProxyOptions): Promise<ProxyOutcome> {
	const { video } = options
	if (!video.file && !video.url) {
		return { status: 'unavailable', reason: 'There is no file to build a preview copy from.' }
	}

	const plan = proxyPlanFor(video)
	const key = proxyCacheKey(video, plan)

	const running = inFlight.get(key)
	if (running) return running

	const work = queued(options, plan, key).finally(() => {
		inFlight.delete(key)
	})
	inFlight.set(key, work)
	return work
}

async function queued(
	options: BuildProxyOptions,
	plan: ProxyPlan,
	key: string,
): Promise<ProxyOutcome> {
	// The cache is checked before the queue, so a reload with a warm cache is
	// instant even while another clip is transcoding.
	const cached = await readCachedProxy(key, plan)
	if (cached) return { status: 'ready', proxy: cached }
	if (options.signal?.aborted) throw new ProxyCancelled()

	const next = queue.then(() => encode(options, plan, key))
	// The queue must survive a failed build, so it chains a settled promise.
	queue = next.catch(() => undefined)
	return next
}

async function encode(
	options: BuildProxyOptions,
	plan: ProxyPlan,
	key: string,
): Promise<ProxyOutcome> {
	const { video, signal, onProgress } = options
	if (signal?.aborted) throw new ProxyCancelled()

	// One import site for the demuxer, decoders and muxer, shared with every
	// other caller - so probing a clip here warms the chunk an export needs.
	const {
		ALL_FORMATS,
		BlobSource,
		BufferTarget,
		Conversion,
		EncodedPacketSink,
		Input,
		Mp4OutputFormat,
		Output,
		StreamTarget,
		UrlSource,
		WebMOutputFormat,
		getFirstEncodableAudioCodec,
		getFirstEncodableVideoCodec,
	} = await loadMediaEngine()

	const input = new Input({
		formats: ALL_FORMATS,
		source: video.file ? new BlobSource(video.file) : new UrlSource(video.url),
	})

	let facts: SourceFacts | null = null
	try {
		facts = await measureSource(input, EncodedPacketSink)
	} catch {
		facts = null
	}

	if (!facts || !facts.decodable) {
		input.dispose()
		return {
			status: 'unavailable',
			reason: facts
				? 'This browser cannot decode that video codec, so it cannot build a preview copy.'
				: 'This browser could not read that file’s video track.',
		}
	}

	// The two things a proxy fixes. If neither is wrong, the original is already
	// the best thing to play and a transcode would cost minutes to gain nothing.
	const sourceLong = Math.max(facts.width, facts.height)
	const tooManyPixels = sourceLong > Math.max(plan.width, plan.height) * 1.15
	const slowToSeek = facts.keyFrameSeconds >= SLOW_SEEK_THRESHOLD_SECONDS
	if (!tooManyPixels && !slowToSeek) {
		input.dispose()
		return {
			status: 'not-needed',
			reason: 'This clip is already small and quick to seek, so the preview plays it directly.',
		}
	}

	const videoCodec = await getFirstEncodableVideoCodec(['avc', 'vp9', 'av1', 'vp8'], {
		width: plan.width,
		height: plan.height,
		bitrate: plan.videoBitrate,
	})
	if (!videoCodec) {
		input.dispose()
		return {
			status: 'unavailable',
			reason: 'This browser cannot encode video, so the preview plays the original file.',
		}
	}

	const container: 'mp4' | 'webm' = videoCodec === 'avc' || videoCodec === 'av1' ? 'mp4' : 'webm'
	const audioCodec = facts.hasAudio
		? await getFirstEncodableAudioCodec(container === 'mp4' ? ['aac', 'opus'] : ['opus', 'vorbis'], {
				bitrate: plan.audioBitrate,
			})
		: null

	const expectedBytes = estimateProxyBytes(plan, video.durationInSeconds, facts.hasAudio)

	/*
	 * Where the bytes go, in order of preference.
	 *
	 * Disk is where a proxy belongs: it costs no heap while it encodes, and it
	 * is still there after a reload, which is what makes the second visit to a
	 * clip instant. A browser that will not give one - a private window, a
	 * blocked origin - still gets a proxy as long as it is small enough to sit
	 * in memory beside the decoder it is relieving. Only a long clip with
	 * nowhere to put it is refused, because that is the case where trying would
	 * take the tab down with it.
	 */
	let directory = await openProxyDirectory()
	if (directory) {
		const estimate = await storageEstimate()
		if (estimate && estimate.quota > 0) {
			const headroom = estimate.quota - estimate.usage
			if (headroom < expectedBytes * 2 + HEADROOM_MARGIN_BYTES) directory = null
		}
	}
	if (!directory && expectedBytes > MAX_IN_MEMORY_BYTES) {
		input.dispose()
		return {
			status: 'unavailable',
			reason: 'There is nowhere to put a preview copy of a clip this long - the browser is out of storage.',
		}
	}

	const name = `${key}.${container}`
	const mimeType = container === 'mp4' ? 'video/mp4' : 'video/webm'

	let handle: FileSystemFileHandle | null = null
	let writable: FileSystemWritableFileStream | null = null
	let buffered: InstanceType<typeof BufferTarget> | null = null
	let target: ConstructorParameters<typeof Output>[0]['target']

	if (directory) {
		try {
			await sweepProxies(directory, name)
			handle = await directory.getFileHandle(name, { create: true })
			writable = await handle.createWritable({ keepExistingData: false })
			target = new StreamTarget(writable as unknown as ConstructorParameters<typeof StreamTarget>[0], {
				chunked: true,
				chunkSize: 2 * 1024 * 1024,
			})
		} catch {
			handle = null
			writable = null
			buffered = new BufferTarget()
			target = buffered
		}
	} else {
		buffered = new BufferTarget()
		target = buffered
	}

	const streaming = writable !== null

	const output = new Output({
		format:
			container === 'mp4'
				? // Streaming to disk and putting the metadata first are mutually
					// exclusive - the second means holding every chunk in memory, which
					// is the allocation a proxy exists to avoid. A local file plays
					// perfectly well with its moov box at the end.
					new Mp4OutputFormat({ fastStart: streaming ? false : 'in-memory' })
				: new WebMOutputFormat(),
		target,
	})

	const discard = async () => {
		if (writable) await writable.abort().catch(() => {})
		if (directory && handle) await directory.removeEntry(name).catch(() => {})
	}

	// Wrapped, because a browser can refuse an encoder configuration here rather
	// than when the codec was probed - and an unwrapped throw would leave the
	// half-open file on disk and surface as a failure rather than as "no proxy
	// this time", which is all it is.
	let conversion: Awaited<ReturnType<typeof Conversion.init>>
	try {
		conversion = await Conversion.init({
		input,
		output,
		video: {
			width: plan.width,
			height: plan.height,
			fit: 'fill',
			frameRate: plan.fps,
			codec: videoCodec,
			bitrate: plan.videoBitrate,
			keyFrameInterval: plan.keyFrameSeconds,
			// No hardware preference is asked for, deliberately. The probe above
			// answers for a plain configuration, so pinning the encoder to hardware
			// here would be asking for something that was never checked - and a
			// machine without a usable video encoder (a headless browser, a VM, a
			// laptop on integrated graphics that is already busy) answers that by
			// throwing part-way through the transcode rather than up front.
		},
		audio: audioCodec ? { codec: audioCodec, bitrate: plan.audioBitrate } : { discard: true },
		showWarnings: false,
		})
	} catch (error) {
		input.dispose()
		await discard()
		return {
			status: 'unavailable',
			reason:
				error instanceof Error
					? `No preview copy could be set up: ${error.message}`
					: 'No preview copy could be set up for this clip.',
		}
	}

	if (!conversion.isValid) {
		await conversion.cancel().catch(() => {})
		input.dispose()
		await discard()
		return {
			status: 'unavailable',
			reason: 'This file’s tracks cannot be re-encoded here, so the preview plays the original.',
		}
	}

	conversion.onProgress = (ratio) => onProgress?.(Math.min(1, Math.max(0, ratio)))

	const onAbort = () => {
		void conversion.cancel()
	}
	signal?.addEventListener('abort', onAbort, { once: true })

	try {
		await conversion.execute()
		if (signal?.aborted) throw new ProxyCancelled()

		const file = streaming && handle ? await handle.getFile() : null
		const blob =
			file ?? (buffered?.buffer ? new Blob([buffered.buffer], { type: mimeType }) : null)
		if (!blob) throw new Error('The encoder produced no preview copy.')

		return {
			status: 'ready',
			proxy: {
				url: objectUrlFor(blob, mimeType),
				width: plan.width,
				height: plan.height,
				fps: plan.fps,
				sizeInBytes: blob.size,
				keyFrameSeconds: plan.keyFrameSeconds,
				cached: false,
			},
		}
	} catch (error) {
		await discard()
		if (signal?.aborted || (error as Error | null)?.name === 'ConversionCanceledError') {
			throw new ProxyCancelled()
		}
		return {
			status: 'unavailable',
			reason:
				error instanceof Error
					? `The preview copy could not be built: ${error.message}`
					: 'The preview copy could not be built.',
		}
	} finally {
		signal?.removeEventListener('abort', onAbort)
		input.dispose()
	}
}
