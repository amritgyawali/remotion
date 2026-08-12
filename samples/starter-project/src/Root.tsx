import React from 'react'
import { Composition } from 'remotion'
import { KineticQuote } from './KineticQuote'

export const Root: React.FC = () => (
	<Composition
		id="KineticQuote"
		component={KineticQuote}
		durationInFrames={300}
		fps={30}
		width={1080}
		height={1920}
	/>
)
