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
	selectedId,
	onSelect,
	compiling,
	error,
}: {
	compileResult: CompileResult | null
	composition: CompiledComposition | null
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
					<span className="chip chip--static">No composition</span>
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
							<span className="badge badge--orange" title="No <Composition> found - defaults applied">
								inferred
							</span>
						) : null}
					</>
				) : null}

				{compiling ? (
					<span className="badge badge--accent">
						<IconSpinner size={11} /> compiling
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
						<pre className="log" style={{ textAlign: 'left', marginTop: 12 }}>
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
						<PlayerCanvas composition={composition} css={compileResult?.css} />
					</div>
				) : (
					<div className="stage-empty">
						<span className="stage-empty-mark">
							<IconFilm size={24} />
						</span>
						<h2>Drop in a composition file</h2>
						<p>
							Upload a <code>.tsx</code> Remotion component or a zipped project on the left, or load
							one of the samples. It compiles in your browser - nothing is uploaded until you choose
							the server engine.
						</p>
					</div>
				)}
			</div>
		</section>
	)
}
