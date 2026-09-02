'use client'

/**
 * The Objects panel: what stands behind the speaker.
 *
 * The panel is deliberately presentational - it plans nothing and renders
 * nothing itself. Every button hands back up to `CaptionStudio`, which owns
 * the clip, the vault and the abort controller, so there is exactly one place
 * that knows how to start and stop a bake.
 *
 * The order of the sections is the order of the work, and the first of them is
 * the whole feature in one press: "Cutout and place PNG behind" transcribes if
 * it has to, picks a keyword for every five seconds of video, fetches a real
 * picture of each one, cuts its background away, sizes it against the speaker's
 * head and burns the lot in. Everything under it is the same pipeline taken
 * apart, for when a person wants to choose the pictures themselves.
 */

import { useMemo, useRef, useState } from 'react'
import {
	IconAlert,
	IconCheck,
	IconClock,
	IconDownload,
	IconEye,
	IconInfo,
	IconLayers,
	IconPerson,
	IconScissors,
	IconSparkle,
	IconSpinner,
	IconStop,
	IconTrash,
	IconUpload,
	IconWand,
} from '../Icons'
import { Segmented, Slider, Toggle } from './controls'
import { OBJECT_LIBRARY, type ObjectAssetCategory } from '../../lib/captions/object-library'
import {
	describeObjectPlan,
	type ObjectMotion,
	type ObjectPlanMode,
	type ObjectSettings,
	type ObjectShot,
} from '../../lib/captions/object-plan'

export type ObjectActions = {
	/** the one-press flow: subtitles in, finished video out */
	onAutoRun: () => void
	onCancelAuto: () => void
	/** saves the video the automatic pass produced */
	onDownloadBaked: () => void
	onPlan: () => void
	onClearPlan: () => void
	onMode: (mode: ObjectPlanMode) => void
	onUseAi: (useAi: boolean) => void
	onSettings: (patch: Partial<ObjectSettings>) => void
	onShot: (id: string, patch: Partial<ObjectShot>) => void
	onShotAsset: (id: string, assetId: string) => void
	onShotUpload: (id: string, file: File) => void
	onDeleteShot: (id: string) => void
	onApplyToAll: (look: Pick<ObjectShot, 'scale' | 'offsetX' | 'offsetY' | 'opacity' | 'motion'>) => void
	onPreview: (id: string) => void
	onBake: () => void
	onRestoreOriginal: () => void
	onSeek: (ms: number) => void
}

/** What the one-press flow is doing, and what it did. */
export type ObjectAutoState = {
	running: boolean
	/** the step, in the user's words - "Fetching “monastery” (3 of 12)" */
	message: string
	ratio: number
	note: string | null
	error: string | null
	/** how many keywords the clip's length asked for */
	target: number
	/** words that found no usable cut-out anywhere on the web */
	misses: string[]
	/** true once a finished video exists to save */
	finished: boolean
}

export type ObjectPanelState = {
	cueCount: number
	shots: ObjectShot[]
	settings: ObjectSettings
	mode: ObjectPlanMode
	useAi: boolean
	auto: ObjectAutoState
	planning: boolean
	planNotice: string | null
	planError: string | null
	directedBy: 'ai' | 'local' | null
	modelUsed: string | null
	/** false when `npm run assets:3d` has not been run in this checkout */
	modelPackAvailable: boolean
	previewing: boolean
	preview: { url: string; shotId: string } | null
	previewError: string | null
	baking: boolean
	bakeProgress: { phase: string; ratio: number }
	bakeNote: string | null
	bakeError: string | null
	/** true once this clip's objects have been burned in */
	baked: boolean
	canRestore: boolean
	disabled: boolean
}

const CATEGORY_LABEL: Record<ObjectAssetCategory, string> = {
	object: 'Things',
	icon: 'Icons',
	shape: 'Shapes',
	symbol: 'Symbols',
	motion: 'Motion art',
}

const MOTION_OPTIONS: { value: ObjectMotion; label: string }[] = [
	{ value: 'float', label: 'Float' },
	{ value: 'spin', label: 'Spin' },
	{ value: 'sway', label: 'Sway' },
	{ value: 'pulse', label: 'Pulse' },
	{ value: 'none', label: 'Still' },
]

const timecode = (ms: number): string => {
	const total = Math.max(0, ms) / 1000
	const minutes = Math.floor(total / 60)
	const seconds = total - minutes * 60
	return `${minutes}:${seconds.toFixed(1).padStart(4, '0')}`
}

export default function CaptionObjectPanel({
	state,
	actions,
}: {
	state: ObjectPanelState
	actions: ObjectActions
}) {
	const [selectedId, setSelectedId] = useState<string | null>(null)
	const uploadRef = useRef<HTMLInputElement | null>(null)
	const uploadTargetRef = useRef<string | null>(null)

	const grouped = useMemo(() => {
		const groups = new Map<ObjectAssetCategory, typeof OBJECT_LIBRARY>()
		for (const asset of OBJECT_LIBRARY) {
			const bucket = groups.get(asset.category)
			if (bucket) bucket.push(asset)
			else groups.set(asset.category, [asset])
		}
		return [...groups.entries()]
	}, [])

	const selected = state.shots.find((shot) => shot.id === selectedId) ?? state.shots[0] ?? null
	const busy = state.disabled || state.planning || state.baking || state.auto.running
	const credits = state.shots.filter((shot) => shot.kind === 'web' && shot.credit)

	/* ------------------------------------------------------- one press */

	const onePress = (
		<div className="object-auto">
			<h2 className="section-label">
				<IconScissors size={12} /> One press
				{state.auto.finished ? <span className="badge badge--green">done</span> : null}
			</h2>
			<p className="hint-text">
				Reads the subtitles and takes one keyword for every five seconds of video
				{state.auto.target > 0 ? ' - ' + state.auto.target + ' for this clip' : ''} - the words it is
				about rather than the words it repeats. Then it finds a real PNG of each one on the web, cuts
				its background away, and stands it {Math.round(state.settings.headMultiple * 10) / 10}× the
				width of the speaker’s head behind them at the moment that word is said, before burning the
				whole thing into the clip.
			</p>

			<div className="object-actions">
				<button
					className="btn btn--primary btn--block"
					disabled={busy}
					onClick={actions.onAutoRun}
					title="Subtitles in, finished video out"
				>
					{state.auto.running ? <IconSpinner size={13} /> : <IconScissors size={13} />}
					{state.auto.running ? 'Working…' : 'Cutout and place PNG behind'}
				</button>
				{state.auto.running ? (
					<button className="btn" onClick={actions.onCancelAuto}>
						<IconStop size={13} /> Stop
					</button>
				) : null}
				{state.auto.finished && !state.auto.running ? (
					<button className="btn" onClick={actions.onDownloadBaked}>
						<IconDownload size={13} /> Save the video
					</button>
				) : null}
			</div>

			{state.auto.running ? (
				<div style={{ marginTop: 12 }}>
					<div className="progress-track">
						<div
							className="progress-fill"
							style={{ width: `${Math.round(Math.min(1, state.auto.ratio) * 100)}%` }}
						/>
					</div>
					<div className="progress-meta">
						<span>{state.auto.message}</span>
						<span>{Math.round(Math.min(1, state.auto.ratio) * 100)}%</span>
					</div>
				</div>
			) : null}

			{state.auto.error ? (
				<div className="notice notice--error" style={{ marginTop: 12 }}>
					<span className="notice-icon">
						<IconAlert size={14} />
					</span>
					<span>{state.auto.error}</span>
				</div>
			) : null}

			{state.auto.note && !state.auto.running ? (
				<div className="notice notice--success" style={{ marginTop: 12 }}>
					<span className="notice-icon">
						<IconCheck size={14} />
					</span>
					<span>{state.auto.note}</span>
				</div>
			) : null}

			{state.auto.misses.length > 0 && !state.auto.running ? (
				<div className="notice notice--info" style={{ marginTop: 12 }}>
					<span className="notice-icon">
						<IconInfo size={14} />
					</span>
					<span>
						No cut-out picture could be found for {state.auto.misses.join(', ')}. Those words were
						left without an object rather than given a rectangle - swap one in by hand below if you
						have a PNG for it.
					</span>
				</div>
			) : null}

			<Slider
				id="object-head-multiple"
				label="Picture size, against the head"
				value={Math.round(state.settings.headMultiple * 10)}
				min={10}
				max={60}
				step={1}
				disabled={busy}
				format={(value) => `${(value / 10).toFixed(1)}× the head’s width`}
				onChange={(value) => actions.onSettings({ headMultiple: value / 10 })}
			/>
		</div>
	)

	// A clip with no transcript still gets the one-press block: that flow
	// transcribes for itself, and hiding the button behind a step it performs
	// would be telling the user to do the work the button exists to do.
	if (state.cueCount === 0) {
		return (
			<div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
				<div className="notice notice--info">
					<span className="notice-icon">
						<IconInfo size={14} />
					</span>
					<span>
						Objects are chosen from what is actually said. Press the button below and the studio will
						transcribe the clip first; or generate, write or import a transcript yourself and every
						line becomes a candidate for an object behind the speaker.
					</span>
				</div>
				{onePress}
			</div>
		)
	}

	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
			<div>
				<h2 className="section-label">
					Objects behind the speaker
					{state.baked ? <span className="badge badge--green">burned in</span> : null}
				</h2>
				<p className="hint-text">
					The person is cut out of every frame and a picture is placed behind their head, timed to
					the words that chose it. The captions stay a live layer on top, so you can keep restyling
					them afterwards.
				</p>
			</div>

			{onePress}

			{/* ------------------------------------------------------- source */}

			<Segmented
				label="Where objects come from"
				value={state.mode}
				disabled={busy}
				options={[
					{ value: 'flat', label: 'Art pack' },
					{ value: 'model3d', label: '3D models' },
				]}
				onChange={actions.onMode}
			/>

			{state.mode === 'model3d' && !state.modelPackAvailable ? (
				<div className="notice notice--warn">
					<span className="notice-icon">
						<IconAlert size={14} />
					</span>
					<span>
						The 3D pack is generated rather than committed. Run <code>npm run assets:3d</code> once to
						build its twelve hundred models, or plan with the flat art pack instead.
					</span>
				</div>
			) : null}

			<Toggle
				label="Let the AI director choose"
				hint="Adds the objects a line only implies - “we finally shipped it” becomes a package. Without a key the studio’s own keyword matcher plans it instead, offline."
				checked={state.useAi}
				disabled={busy}
				onChange={actions.onUseAi}
			/>

			<div className="object-actions">
				<button className="btn btn--primary" disabled={busy} onClick={actions.onPlan}>
					{state.planning ? <IconSpinner size={13} /> : <IconWand size={13} />}
					{state.planning ? 'Planning objects…' : state.shots.length > 0 ? 'Re-plan objects' : 'Plan objects'}
				</button>
				<button
					className="btn"
					disabled={busy || state.shots.length === 0}
					onClick={actions.onClearPlan}
				>
					<IconTrash size={13} /> Clear
				</button>
			</div>

			{state.planError ? (
				<div className="notice notice--error">
					<span className="notice-icon">
						<IconAlert size={14} />
					</span>
					<span>{state.planError}</span>
				</div>
			) : null}

			{state.planNotice ? (
				<div className="notice notice--info">
					<span className="notice-icon">
						<IconInfo size={14} />
					</span>
					<span>{state.planNotice}</span>
				</div>
			) : null}

			{state.shots.length > 0 ? (
				<div className="chip-row">
					<span className="chip chip--static">{describeObjectPlan(state.shots)}</span>
					{state.directedBy === 'ai' && state.modelUsed ? (
						<span className="chip chip--static">
							<IconSparkle size={11} /> {state.modelUsed.split('/').pop()}
						</span>
					) : state.shots.length > 0 ? (
						<span className="chip chip--static">keyword matcher</span>
					) : null}
				</div>
			) : null}

			{/* -------------------------------------------------------- shots */}

			{state.shots.length > 0 ? (
				<div>
					<h2 className="section-label">
						<IconLayers size={12} /> Shot list
					</h2>
					<div className="object-shots">
						{state.shots.map((shot) => (
							<button
								key={shot.id}
								type="button"
								className="object-shot"
								data-active={selected?.id === shot.id}
								disabled={busy}
								onClick={() => {
									setSelectedId(shot.id)
									actions.onSeek(shot.startMs + (shot.endMs - shot.startMs) / 2)
								}}
							>
								<span className="object-shot-thumb">
									{shot.src ? (
										// eslint-disable-next-line @next/next/no-img-element
										<img src={shot.src} alt="" width={30} height={30} />
									) : (
										<IconLayers size={15} />
									)}
								</span>
								<span className="object-shot-body">
									<span className="object-shot-name">{shot.label}</span>
									<span className="object-shot-meta">
										{shot.keyword ? `“${shot.keyword}” · ` : ''}
										{timecode(shot.startMs)} – {timecode(shot.endMs)}
										{shot.kind === 'web' ? ' · from the web' : ''}
									</span>
								</span>
								<span
									className="object-shot-drop"
									role="button"
									tabIndex={-1}
									aria-label={`Remove ${shot.label}`}
									onClick={(event) => {
										event.stopPropagation()
										actions.onDeleteShot(shot.id)
									}}
								>
									<IconTrash size={12} />
								</span>
							</button>
						))}
					</div>
				</div>
			) : null}

			{/* ---------------------------------------------------- one shot */}

			{selected ? (
				<div>
					<h2 className="section-label">Selected object</h2>

					<div className="field">
						<label className="field-label" htmlFor="object-swap">
							Picture
							<span className="field-value">
								{selected.kind === 'upload'
									? 'your file'
									: selected.kind === 'web'
										? 'from the web'
										: selected.label}
							</span>
						</label>
						<select
							id="object-swap"
							className="select"
							value={selected.kind === 'library' ? (selected.assetId ?? '') : ''}
							disabled={busy}
							onChange={(event) => {
								if (event.target.value) actions.onShotAsset(selected.id, event.target.value)
							}}
						>
							<option value="">
								{selected.kind === 'library' ? 'Choose an object…' : `${selected.label} (${selected.kind === 'web' ? 'fetched' : 'uploaded'})`}
							</option>
							{grouped.map(([category, assets]) => (
								<optgroup key={category} label={CATEGORY_LABEL[category]}>
									{assets.map((asset) => (
										<option key={asset.id} value={asset.id}>
											{asset.label}
										</option>
									))}
								</optgroup>
							))}
						</select>
					</div>

					{selected.credit ? (
						<p className="hint-text">
							{selected.sourceUrl ? (
								<a href={selected.sourceUrl} target="_blank" rel="noreferrer noopener">
									{selected.credit}
								</a>
							) : (
								selected.credit
							)}
						</p>
					) : null}

					<div className="object-actions">
						<button
							className="btn"
							disabled={busy}
							onClick={() => {
								uploadTargetRef.current = selected.id
								uploadRef.current?.click()
							}}
						>
							<IconUpload size={13} /> Use my own PNG
						</button>
						<button
							className="btn"
							disabled={busy || state.previewing}
							onClick={() => actions.onPreview(selected.id)}
						>
							{state.previewing ? <IconSpinner size={13} /> : <IconEye size={13} />}
							{state.previewing ? 'Rendering…' : 'Preview this frame'}
						</button>
					</div>

					<input
						ref={uploadRef}
						type="file"
						accept="image/png,image/webp,image/jpeg,image/svg+xml,.png,.webp,.jpg,.jpeg,.svg"
						hidden
						onChange={(event) => {
							const file = event.target.files?.[0]
							const target = uploadTargetRef.current
							event.target.value = ''
							if (file && target) actions.onShotUpload(target, file)
						}}
					/>

					{state.previewError ? (
						<div className="notice notice--error">
							<span className="notice-icon">
								<IconAlert size={14} />
							</span>
							<span>{state.previewError}</span>
						</div>
					) : null}

					{state.preview ? (
						// eslint-disable-next-line @next/next/no-img-element
						<img className="tool-preview-frame" src={state.preview.url} alt="One composited frame" />
					) : null}

					<Slider
						id="object-scale"
						label="Size"
						value={Math.round(selected.scale * 100)}
						min={5}
						max={140}
						step={1}
						disabled={busy}
						format={(value) => `${value}% of frame height`}
						onChange={(value) => actions.onShot(selected.id, { scale: value / 100 })}
					/>
					<Slider
						id="object-offset-y"
						label="Height above the head"
						value={Math.round(-selected.offsetY * 100)}
						min={-30}
						max={40}
						step={1}
						disabled={busy}
						format={(value) => `${value}%`}
						onChange={(value) => actions.onShot(selected.id, { offsetY: -value / 100 })}
					/>
					<Slider
						id="object-offset-x"
						label="Sideways"
						value={Math.round(selected.offsetX * 100)}
						min={-40}
						max={40}
						step={1}
						disabled={busy}
						format={(value) => (value === 0 ? 'centred on the head' : `${value > 0 ? '+' : ''}${value}%`)}
						onChange={(value) => actions.onShot(selected.id, { offsetX: value / 100 })}
					/>
					<Slider
						id="object-opacity"
						label="Opacity"
						value={Math.round(selected.opacity * 100)}
						min={10}
						max={100}
						step={1}
						suffix="%"
						disabled={busy}
						onChange={(value) => actions.onShot(selected.id, { opacity: value / 100 })}
					/>
					<Segmented
						label="Motion"
						value={selected.motion}
						disabled={busy}
						wrap
						options={MOTION_OPTIONS}
						onChange={(value) => actions.onShot(selected.id, { motion: value })}
					/>

					<div className="object-actions">
						<button
							className="btn"
							disabled={busy || state.shots.length < 2}
							onClick={() =>
								actions.onApplyToAll({
									scale: selected.scale,
									offsetX: selected.offsetX,
									offsetY: selected.offsetY,
									opacity: selected.opacity,
									motion: selected.motion,
								})
							}
						>
							<IconCheck size={13} /> Use this look for every object
						</button>
					</div>
				</div>
			) : null}

			{/* ------------------------------------------------------ cut-out */}

			<div>
				<h2 className="section-label">
					<IconPerson size={12} /> The cut-out
				</h2>
				<p className="hint-text">
					Only the edge where an object meets the speaker has to be right - everywhere else the
					picture behind them is their own room, unchanged. Turn the matte on to see what the model
					found.
				</p>

				<Segmented
					label="Detection model"
					value={state.settings.model}
					disabled={busy}
					options={[
						{ value: 'balanced', label: 'Balanced · fast' },
						{ value: 'precise', label: 'Precise · 16 MB' },
					]}
					onChange={(model) => actions.onSettings({ model })}
				/>
				<Slider
					id="object-feather"
					label="Edge softness"
					value={state.settings.feather}
					min={0}
					max={100}
					step={1}
					suffix="%"
					disabled={busy}
					onChange={(feather) => actions.onSettings({ feather })}
				/>
				<Slider
					id="object-matte"
					label="Edge hardness"
					value={state.settings.matte}
					min={0}
					max={100}
					step={1}
					suffix="%"
					disabled={busy}
					onChange={(matte) => actions.onSettings({ matte })}
				/>
				<Slider
					id="object-edge-shift"
					label="Cut in / out"
					value={state.settings.edgeShift}
					min={-50}
					max={50}
					step={1}
					disabled={busy}
					format={(value) =>
						value === 0 ? 'as detected' : value > 0 ? `${value} keeps more` : `${value} eats in`
					}
					onChange={(edgeShift) => actions.onSettings({ edgeShift })}
				/>
				<Slider
					id="object-contact-shadow"
					label="Shadow on the object"
					value={state.settings.contactShadow}
					min={0}
					max={100}
					step={1}
					disabled={busy}
					format={(value) => (value === 0 ? 'none' : `${value}%`)}
					onChange={(contactShadow) => actions.onSettings({ contactShadow })}
				/>
				<Slider
					id="object-light-wrap"
					label="Light wrap"
					value={state.settings.lightWrap}
					min={0}
					max={100}
					step={1}
					suffix="%"
					disabled={busy}
					onChange={(lightWrap) => actions.onSettings({ lightWrap })}
				/>
				<Slider
					id="object-smoothing"
					label="Mask steadiness"
					value={state.settings.smoothing}
					min={0}
					max={95}
					step={1}
					suffix="%"
					disabled={busy}
					onChange={(smoothing) => actions.onSettings({ smoothing })}
				/>
				<Slider
					id="object-anchor-damping"
					label="Head tracking steadiness"
					value={state.settings.anchorDamping}
					min={0}
					max={100}
					step={1}
					disabled={busy}
					format={(value) =>
						value >= 95 ? 'almost fixed' : value <= 10 ? 'follows exactly' : `${value}%`
					}
					onChange={(anchorDamping) => actions.onSettings({ anchorDamping })}
				/>
				<Slider
					id="object-entrance"
					label="Arrive and leave over"
					value={state.settings.entranceMs}
					min={0}
					max={1200}
					step={20}
					disabled={busy}
					format={(value) => (value === 0 ? 'no fade' : `${value} ms`)}
					onChange={(entranceMs) => actions.onSettings({ entranceMs })}
				/>
				<Toggle
					label="Follow the head"
					hint="Off pins every object to the middle of the frame, which is what a fixed camera and a still subject want."
					checked={state.settings.followHead}
					disabled={busy}
					onChange={(followHead) => actions.onSettings({ followHead })}
				/>
				<Segmented
					label="Size the object against"
					value={state.settings.sizeMode}
					disabled={busy}
					options={[
						{ value: 'head', label: 'The speaker' },
						{ value: 'frame', label: 'The frame' },
					]}
					onChange={(sizeMode) => actions.onSettings({ sizeMode })}
				/>
				<Toggle
					label="Skip the model on still frames"
					hint="Reuses the last cut-out while the picture has not moved, which is most of a talking head. Turn it off for a locked camera where only the subject moves."
					checked={state.settings.adaptiveMask}
					disabled={busy}
					onChange={(adaptiveMask) => actions.onSettings({ adaptiveMask })}
				/>
				<Toggle
					label="Show the cut-out"
					hint="Renders the matte instead of the picture. White is the person, black is everything the object can appear in."
					checked={state.settings.showMatte}
					disabled={busy}
					onChange={(showMatte) => actions.onSettings({ showMatte })}
				/>
			</div>

			{/* --------------------------------------------------------- bake */}

			<div>
				<h2 className="section-label">
					<IconClock size={12} /> Burn the objects in
				</h2>
				<p className="hint-text">
					This decodes the clip once, places the objects, and re-encodes the video. The audio is
					copied untouched, so every caption timing survives exactly. The original stays in this
					browser and one press brings it back.
				</p>

				<div className="object-actions">
					<button
						className="btn btn--primary"
						disabled={busy || state.shots.length === 0}
						onClick={actions.onBake}
					>
						{state.baking ? <IconSpinner size={13} /> : <IconLayers size={13} />}
						{state.baking ? 'Placing objects…' : state.baked ? 'Bake again' : 'Add objects to the video'}
					</button>
					<button
						className="btn"
						disabled={state.baking || !state.canRestore}
						onClick={actions.onRestoreOriginal}
					>
						Restore the original
					</button>
				</div>

				{state.baking ? (
					<div style={{ marginTop: 12 }}>
						<div className="progress-track">
							<div
								className="progress-fill"
								style={{ width: `${Math.round(Math.min(1, state.bakeProgress.ratio) * 100)}%` }}
							/>
						</div>
						<div className="progress-meta">
							<span>{state.bakeProgress.phase}</span>
							<span>{Math.round(Math.min(1, state.bakeProgress.ratio) * 100)}%</span>
						</div>
					</div>
				) : null}

				{state.bakeError ? (
					<div className="notice notice--error" style={{ marginTop: 12 }}>
						<span className="notice-icon">
							<IconAlert size={14} />
						</span>
						<span>{state.bakeError}</span>
					</div>
				) : null}

				{state.bakeNote && !state.baking ? (
					<div className="notice notice--success" style={{ marginTop: 12 }}>
						<span className="notice-icon">
							<IconCheck size={14} />
						</span>
						<span>{state.bakeNote}</span>
					</div>
				) : null}
			</div>

			{/* ------------------------------------------------------ credits */}

			{credits.length > 0 ? (
				<div>
					<h2 className="section-label">Picture credits</h2>
					<p className="hint-text">
						Every picture fetched from the web, with who made it and under what licence. Keep this
						with the video if you publish it.
					</p>
					<ul className="object-credits">
						{credits.map((shot) => (
							<li key={shot.id}>
								{shot.sourceUrl ? (
									<a href={shot.sourceUrl} target="_blank" rel="noreferrer noopener">
										{shot.credit}
									</a>
								) : (
									shot.credit
								)}
							</li>
						))}
					</ul>
				</div>
			) : null}
		</div>
	)
}
