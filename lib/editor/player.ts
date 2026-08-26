'use client'

/**
 * Live preview: a `requestAnimationFrame` loop that advances the playhead by
 * wall-clock time and calls the same `renderFrame` the export loop uses, plus
 * a best-effort Web Audio preview so scrubbing and playback are not silent.
 *
 * The video clock is `performance.now()`, not the audio clock the blueprint's
 * architecture calls for (§3.6) - a genuine, documented simplification. Full
 * audio-as-master-clock needs the whole timeline's audio pre-mixed into one
 * scheduled graph; what ships here instead restarts a small per-clip
 * `AudioBufferSourceNode` pump whenever the active clip set changes, which is
 * simple enough to reason about correctly but can drift a video frame or two
 * from picture over a long play. It never affects export, which always
 * mixes down deterministically offline (`lib/editor/export.ts`).
 */

import { activeClipsAtFrame, projectDurationFrames } from './model'
import { renderFrame, type BlobResolver } from './compositor'
import type { AssetSinkPool } from './sinks'
import type { AudioClip, ProjectDoc, VideoClip } from './types'

export type PlayerListener = (state: { frame: number; playing: boolean; offlineAssetIds: Set<string> }) => void

function dbToGain(db: number): number {
	return Math.pow(10, db / 20)
}

type AudioPump = { stop: () => void }

export class Player {
	private canvas: OffscreenCanvas | HTMLCanvasElement
	private doc: ProjectDoc
	private pool: AssetSinkPool
	private resolveBlob: BlobResolver
	private frame = 0
	private playing = false
	private rafHandle: number | null = null
	private lastWallMs = 0
	private renderToken = 0
	private listeners = new Set<PlayerListener>()
	private audioCtx: AudioContext | null = null
	private pumps = new Map<string, AudioPump>()
	private muted = false
	/** Which assets the *current* frame could not resolve - cleared, not just added to, every render. */
	private offlineAssetIds = new Set<string>()

	constructor(canvas: OffscreenCanvas | HTMLCanvasElement, doc: ProjectDoc, pool: AssetSinkPool, resolveBlob: BlobResolver) {
		this.canvas = canvas
		this.doc = doc
		this.pool = pool
		this.resolveBlob = resolveBlob
	}

	subscribe(listener: PlayerListener): () => void {
		this.listeners.add(listener)
		return () => this.listeners.delete(listener)
	}

	private emit(): void {
		for (const listener of this.listeners) listener({ frame: this.frame, playing: this.playing, offlineAssetIds: this.offlineAssetIds })
	}

	/** Called whenever the document changes so the player draws the current state, not a stale one. */
	setDoc(doc: ProjectDoc): void {
		this.doc = doc
		void this.renderCurrent()
	}

	setMuted(muted: boolean): void {
		this.muted = muted
		if (muted) this.stopAllPumps()
		else if (this.playing) void this.syncAudio()
	}

	getFrame(): number {
		return this.frame
	}

	isPlaying(): boolean {
		return this.playing
	}

	async seek(frame: number): Promise<void> {
		const last = projectDurationFrames(this.doc)
		this.frame = Math.max(0, Math.min(frame, Math.max(last, 1)))
		await this.renderCurrent()
		if (this.playing) await this.syncAudio()
		this.emit()
	}

	play(): void {
		if (this.playing) return
		this.playing = true
		this.lastWallMs = performance.now()
		void this.syncAudio()
		this.rafHandle = requestAnimationFrame(this.loop)
		this.emit()
	}

	pause(): void {
		this.playing = false
		if (this.rafHandle !== null) cancelAnimationFrame(this.rafHandle)
		this.rafHandle = null
		this.stopAllPumps()
		this.emit()
	}

	dispose(): void {
		this.pause()
		void this.audioCtx?.close().catch(() => undefined)
		this.audioCtx = null
	}

	private loop = (): void => {
		if (!this.playing) return
		const now = performance.now()
		const dtSeconds = (now - this.lastWallMs) / 1000
		const fps = this.doc.settings.fps
		const advanceFrames = dtSeconds * fps

		if (advanceFrames >= 1) {
			this.lastWallMs = now
			const last = projectDurationFrames(this.doc)
			const next = this.frame + Math.floor(advanceFrames)
			if (next >= last) {
				this.frame = last
				this.playing = false
				this.stopAllPumps()
				void this.renderCurrent()
				this.emit()
				return
			}
			this.frame = next
			void this.renderCurrent()
			void this.syncAudio()
			this.emit()
		}
		this.rafHandle = requestAnimationFrame(this.loop)
	}

	private async renderCurrent(): Promise<void> {
		const token = ++this.renderToken
		const result = await renderFrame(this.doc, this.pool, this.resolveBlob, this.frame, this.canvas)
		// A slower-than-a-frame render must not clobber a newer one that already
		// landed - dropping the stale result is the backpressure policy here.
		if (token !== this.renderToken) return
		// Replaced, not merged: a reconnect that makes every asset resolvable
		// again must be able to clear this back to empty, not just grow it.
		this.offlineAssetIds = result.offlineAssetIds
		this.emit()
	}

	private ensureAudioContext(): AudioContext | null {
		if (this.muted) return null
		if (this.audioCtx) return this.audioCtx
		const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
		if (!Ctor) return null
		this.audioCtx = new Ctor()
		return this.audioCtx
	}

	private stopAllPumps(): void {
		for (const pump of this.pumps.values()) pump.stop()
		this.pumps.clear()
	}

	/** Restarts audio playback for exactly the clips active at the current frame; no-op if the set is unchanged. */
	private async syncAudio(): Promise<void> {
		if (this.muted) return
		const ctx = this.ensureAudioContext()
		if (!ctx) return
		if (ctx.state === 'suspended') await ctx.resume().catch(() => undefined)

		const active = activeClipsAtFrame(this.doc, this.frame).filter(
			(clip): clip is VideoClip | AudioClip => (clip.kind === 'video' || clip.kind === 'audio') && !clip.audio.muted,
		)
		const activeIds = new Set(active.map((c) => c.id))
		for (const [id, pump] of this.pumps) {
			if (!activeIds.has(id)) {
				pump.stop()
				this.pumps.delete(id)
			}
		}
		for (const clip of active) {
			if (this.pumps.has(clip.id)) continue
			const asset = this.doc.assets[clip.assetId]
			if (!asset || !asset.hasAudio || asset.status !== 'ready') continue
			const blob = this.resolveBlob(asset.id)
			if (!blob) continue
			const sink = await this.pool.get(asset, blob)
			if (!sink?.audioSink) continue
			const fps = this.doc.settings.fps
			const sourceStart = clip.sourceInSeconds + ((this.frame - clip.startFrame) / fps) * clip.speed
			const clipEndsInSeconds = (clip.startFrame + clip.durationFrames - this.frame) / fps
			this.pumps.set(clip.id, this.startPump(ctx, sink.audioSink, clip, this.frame, sourceStart, clipEndsInSeconds, fps))
		}
	}

	/**
	 * Streams decoded buffers from `sourceStart` and schedules them back-to-back
	 * on the audio clock, honouring the clip's speed (played at `playbackRate`,
	 * so pitch shifts with it - the same disclosed simplification export uses,
	 * see `lib/editor/export.ts`) and its fade-in/out as real gain automation,
	 * not just a flat gain value - a fade dragged in the inspector is audible
	 * the moment it is dragged, on the very next loop through this clip.
	 */
	private startPump(
		ctx: AudioContext,
		audioSink: NonNullable<Awaited<ReturnType<AssetSinkPool['get']>>>['audioSink'],
		clip: VideoClip | AudioClip,
		startTimelineFrame: number,
		sourceStart: number,
		maxWallSeconds: number,
		fps: number,
	): AudioPump {
		let stopped = false
		const gain = ctx.createGain()
		gain.connect(ctx.destination)
		const nodes: AudioBufferSourceNode[] = []
		const lookahead = 0.03 // a tiny cushion so the first buffer never misses the clock
		const pumpStartAudioTime = ctx.currentTime + lookahead
		let nextPlayAt = pumpStartAudioTime

		const gainTarget = dbToGain(clip.audio.gainDb)
		const timelineFrameToAudioTime = (frame: number) => pumpStartAudioTime + (frame - startTimelineFrame) / fps
		const fadeInEnd = clip.startFrame + clip.audio.fadeInFrames
		const fadeOutStart = clip.startFrame + clip.durationFrames - clip.audio.fadeOutFrames
		if (clip.audio.fadeInFrames > 0 || clip.audio.fadeOutFrames > 0) {
			const clampedNow = Math.max(ctx.currentTime, pumpStartAudioTime)
			if (clip.audio.fadeInFrames > 0 && this.frame < fadeInEnd) {
				gain.gain.setValueAtTime(0, clampedNow)
				gain.gain.linearRampToValueAtTime(gainTarget, Math.max(clampedNow, timelineFrameToAudioTime(fadeInEnd)))
			} else {
				gain.gain.setValueAtTime(gainTarget, clampedNow)
			}
			if (clip.audio.fadeOutFrames > 0 && fadeOutStart < clip.startFrame + clip.durationFrames) {
				const rampStart = Math.max(clampedNow, timelineFrameToAudioTime(fadeOutStart))
				gain.gain.setValueAtTime(gainTarget, rampStart)
				gain.gain.linearRampToValueAtTime(0, Math.max(rampStart, timelineFrameToAudioTime(clip.startFrame + clip.durationFrames)))
			}
		} else {
			gain.gain.value = gainTarget
		}

		void (async () => {
			if (!audioSink) return
			try {
				for await (const wrapped of audioSink.buffers(sourceStart)) {
					if (stopped) break
					if (wrapped.timestamp - sourceStart > maxWallSeconds) break
					const node = ctx.createBufferSource()
					node.buffer = wrapped.buffer
					if (clip.speed !== 1) node.playbackRate.value = clip.speed
					node.connect(gain)
					node.start(nextPlayAt)
					nextPlayAt += wrapped.buffer.duration / clip.speed
					nodes.push(node)
					if (nodes.length > 64) nodes.splice(0, nodes.length - 64)
				}
			} catch {
				/* asset went away mid-playback - stop() below already covers cleanup */
			}
		})()

		return {
			stop: () => {
				stopped = true
				for (const node of nodes) {
					try {
						node.stop()
					} catch {
						/* already stopped */
					}
				}
				gain.disconnect()
			},
		}
	}
}
