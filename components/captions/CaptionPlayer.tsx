'use client'

import { Player, type PlayerRef } from '@remotion/player'
import { useEffect, type RefObject } from 'react'
import type { CompiledComposition } from '../../lib/types'

/**
 * The subtitle preview. Loaded through next/dynamic with `ssr: false` because
 * the Player touches browser APIs on mount, and it reports the playhead back so
 * the cue list can follow along and stay clickable.
 */
export default function CaptionPlayer({
	composition,
	audioEnabled,
	playerRef,
	onFrame,
}: {
	composition: CompiledComposition
	audioEnabled: boolean
	playerRef: RefObject<PlayerRef | null>
	onFrame: (frame: number) => void
}) {
	useEffect(() => {
		const player = playerRef.current
		if (!player) return
		const listener = (event: { detail: { frame: number } }) => onFrame(event.detail.frame)
		player.addEventListener('frameupdate', listener)
		return () => player.removeEventListener('frameupdate', listener)
	}, [onFrame, playerRef])

	useEffect(() => {
		if (audioEnabled) playerRef.current?.unmute()
		else playerRef.current?.mute()
	}, [audioEnabled, playerRef])

	return (
		<Player
			ref={playerRef}
			key={`${composition.id}-${composition.width}x${composition.height}-${composition.durationInFrames}`}
			component={composition.component}
			inputProps={composition.defaultProps ?? {}}
			durationInFrames={Math.max(1, composition.durationInFrames)}
			fps={composition.fps}
			compositionWidth={composition.width}
			compositionHeight={composition.height}
			style={{ width: '100%', height: '100%' }}
			controls
			initiallyMuted={!audioEnabled}
			doubleClickToFullscreen
			clickToPlay
			spaceKeyToPlayOrPause
			acknowledgeRemotionLicense
		/>
	)
}
