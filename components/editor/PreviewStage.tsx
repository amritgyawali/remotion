'use client'

/**
 * The canvas the `Player` (`lib/editor/player.ts`) draws into, plus the
 * transport bar underneath it. The canvas is sized in CSS to fit the stage
 * while its backing pixel buffer always matches the project's own
 * resolution - what the encoder sees during export is pixel-for-pixel what
 * this element shows, just possibly displayed smaller.
 */

import { forwardRef } from 'react'
import { IconAlert, IconPause, IconPlay, IconSkipNext, IconSkipPrev, IconVolume, IconVolumeOff, IconZoomIn, IconZoomOut } from '../Icons'
import type { ProjectDoc } from '../../lib/editor/types'

function timecode(frame: number, fps: number): string {
	const totalSeconds = frame / fps
	const h = Math.floor(totalSeconds / 3600)
	const m = Math.floor((totalSeconds % 3600) / 60)
	const s = Math.floor(totalSeconds % 60)
	const f = Math.round(frame - Math.floor(totalSeconds) * fps)
	const pad = (n: number) => String(n).padStart(2, '0')
	return h > 0 ? `${h}:${pad(m)}:${pad(s)}:${pad(f)}` : `${pad(m)}:${pad(s)}:${pad(f)}`
}

const PreviewStage = forwardRef<HTMLCanvasElement, {
	doc: ProjectDoc
	frame: number
	playing: boolean
	muted: boolean
	offlineCount: number
	onPlayPause: () => void
	onStepFrame: (delta: number) => void
	onJumpStart: () => void
	onJumpEnd: () => void
	onToggleMute: () => void
	fitScale: number
	onZoomIn: () => void
	onZoomOut: () => void
}>(function PreviewStage({ doc, frame, playing, muted, offlineCount, onPlayPause, onStepFrame, onJumpStart, onJumpEnd, onToggleMute, fitScale, onZoomIn, onZoomOut }, canvasRef) {
	return (
		<div className="editor-stage">
			<div className="editor-stage-canvas-wrap">
				<div className="editor-stage-canvas-frame" style={{ aspectRatio: `${doc.settings.width} / ${doc.settings.height}`, maxWidth: `${fitScale * 100}%` }}>
					<canvas ref={canvasRef} width={doc.settings.width} height={doc.settings.height} />
				</div>
				{offlineCount > 0 ? (
					<div className="editor-stage-warning">
						<IconAlert size={13} /> {offlineCount} clip{offlineCount === 1 ? '' : 's'} offline - reconnect from the media pool
					</div>
				) : null}
			</div>
			<div className="editor-transport">
				<button type="button" className="icon-btn" title="Jump to start (Home)" onClick={onJumpStart}>
					<IconSkipPrev size={15} />
				</button>
				<button type="button" className="icon-btn" title="Previous frame (Left)" onClick={() => onStepFrame(-1)}>
					<IconSkipPrev size={13} />
				</button>
				<button type="button" className="icon-btn icon-btn--accent" title={playing ? 'Pause (Space)' : 'Play (Space)'} onClick={onPlayPause}>
					{playing ? <IconPause size={15} /> : <IconPlay size={15} />}
				</button>
				<button type="button" className="icon-btn" title="Next frame (Right)" onClick={() => onStepFrame(1)}>
					<IconSkipNext size={13} />
				</button>
				<button type="button" className="icon-btn" title="Jump to end (End)" onClick={onJumpEnd}>
					<IconSkipNext size={15} />
				</button>
				<span className="editor-timecode">{timecode(frame, doc.settings.fps)}</span>
				<div className="topbar-spacer" />
				<button type="button" className="icon-btn" title={muted ? 'Unmute preview' : 'Mute preview'} onClick={onToggleMute}>
					{muted ? <IconVolumeOff size={14} /> : <IconVolume size={14} />}
				</button>
				<button type="button" className="icon-btn" title="Zoom out" onClick={onZoomOut}>
					<IconZoomOut size={14} />
				</button>
				<button type="button" className="icon-btn" title="Zoom in" onClick={onZoomIn}>
					<IconZoomIn size={14} />
				</button>
			</div>
		</div>
	)
})

export default PreviewStage
