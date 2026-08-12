'use client'

import { Player } from '@remotion/player'
import type { CompiledComposition } from '../lib/types'

/**
 * Loaded through next/dynamic with `ssr: false` - the Player touches browser
 * APIs on mount and must never run during server rendering.
 */
export default function PlayerCanvas({
	composition,
	css,
}: {
	composition: CompiledComposition
	css?: string
}) {
	return (
		<>
			{css ? <style dangerouslySetInnerHTML={{ __html: css }} /> : null}
			<Player
				key={`${composition.id}-${composition.width}x${composition.height}-${composition.durationInFrames}`}
				component={composition.component}
				inputProps={composition.defaultProps ?? {}}
				durationInFrames={Math.max(1, composition.durationInFrames)}
				fps={composition.fps}
				compositionWidth={composition.width}
				compositionHeight={composition.height}
				style={{ width: '100%', height: '100%' }}
				controls
				loop
				doubleClickToFullscreen
				clickToPlay
				spaceKeyToPlayOrPause
				acknowledgeRemotionLicense
			/>
		</>
	)
}
