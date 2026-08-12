'use client'

import { Player, type PlayerRef } from '@remotion/player'
import { useEffect, useRef } from 'react'
import type { CompiledComposition } from '../lib/types'

/**
 * Loaded through next/dynamic with `ssr: false` - the Player touches browser
 * APIs on mount and must never run during server rendering.
 */
export default function PlayerCanvas({
	composition,
	css,
	audioEnabled,
}: {
	composition: CompiledComposition
	css?: string
	audioEnabled: boolean
}) {
	const playerRef = useRef<PlayerRef>(null)

	useEffect(() => {
		if (audioEnabled) playerRef.current?.unmute()
		else playerRef.current?.mute()
	}, [audioEnabled])

	return (
		<>
			{css ? <style dangerouslySetInnerHTML={{ __html: css }} /> : null}
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
				loop
				doubleClickToFullscreen
				clickToPlay
				spaceKeyToPlayOrPause
				acknowledgeRemotionLicense
			/>
		</>
	)
}
