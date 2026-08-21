'use client'

import dynamic from 'next/dynamic'
import { aspectLabel, formatDuration } from '../lib/format'
import type { CompiledComposition, CompileResult } from '../lib/types'
import { IconAlert, IconFilm, IconSpinner } from './Icons'

const PlayerCanvas = dynamic(() => import('./PlayerCanvas'), {
	ssr: false,
	loading: () => (
		<div className="stage-empty">
			<IconSpinner size={22} />
		</div>
	),
})

export default function StagePanel({
	compileResult,
	composition,
	audioEnabled,
	selectedId,
	onSelect,
	compiling,
	error,
}: {
	compileResult: CompileResult | null
	composition: CompiledComposition | null
	audioEnabled: boolean
	selectedId: string | null
	onSelect: (id: string) => void
	compiling: boolean
	error: string | null
}) {
	const compositions = compileResult?.compositions ?? []

	return (
		<section className="panel panel--stage">
			<div className="stage-bar">
				{compositions.length > 1 ? (
					<select
						className="select"
						style={{ width: 'auto', minWidth: 190 }}
						value={selectedId ?? ''}
						onChange={(event) => onSelect(event.target.value)}
						aria-label="Composition"
					>
						{compositions.map((item) => (
							<option key={item.id} value={item.id}>
								{item.id}
							</option>
						))}
					</select>
				) : composition ? (
					<span className="chip chip--static">{composition.id}</span>
				) : (
					<span className="chip chip--static">No composition yet</span>
				)}

				{composition ? (
					<>
						<span className="chip chip--static">
							{composition.width} x {composition.height}
						</span>
						<span className="chip chip--static">
							{aspectLabel(composition.width, composition.height)}
						</span>
						<span className="chip chip--static">{composition.fps} fps</span>
						<span className="chip chip--static">
							{formatDuration(composition.durationInFrames, composition.fps)}
						</span>
						{composition.inferred ? (
							<span
								className="badge badge--orange"
								title="No <Composition> found - sensible defaults were applied"
							>
								inferred
							</span>
						) : null}
					</>
				) : null}

				<span className="stage-bar-spacer" />

				{compiling ? (
					<span className="badge badge--accent">
						<IconSpinner size={11} /> building preview
					</span>
				) : null}
			</div>

			<div className="stage">
				{error ? (
					<div className="stage-empty">
						<span className="stage-empty-mark" style={{ color: 'var(--red)' }}>
							<IconAlert size={24} />
						</span>
						<h2>That file did not compile</h2>
						<p>Fix the error below, or ask the AI for a new version - nothing else was changed.</p>
						<pre className="log" style={{ textAlign: 'left', marginTop: 14 }}>
							{error}
						</pre>
					</div>
				) : composition ? (
					<div
						className="stage-frame"
						style={{
							aspectRatio: `${composition.width} / ${composition.height}`,
							height: composition.height >= composition.width ? '100%' : 'auto',
							width: composition.height >= composition.width ? 'auto' : '100%',
						}}
					>
						<PlayerCanvas
							composition={composition}
							css={compileResult?.css}
							audioEnabled={audioEnabled}
						/>
					</div>
				) : (
					<div className="stage-empty">
						<span className="stage-empty-mark">
							<IconFilm size={24} />
						</span>
						<h2>Your preview shows up here</h2>
						<p>
							Describe a video on the left and it plays here in seconds. You can also drop in a{' '}
							<code>.tsx</code> Remotion file or open an example - everything compiles on this
							device.
						</p>
					</div>
				)}
			</div>
		</section>
	)
}
