'use client'

/**
 * The Sound tab: what a subtitle sounds like as it appears.
 *
 * Every control here is auditioned, not imagined - picking an effect plays it
 * at the level it will actually be mixed at, including the loudness trim, so
 * "is this too loud" is answered before a render rather than after one. The
 * audition is a plain HTMLAudioElement: it needs no decoding pipeline, it is
 * started by a tap, and it stops the previous one so a fast scroll through
 * thirty-five options never turns into thirty-five overlapping sounds.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
	CAPTION_SFX,
	SFX_CATEGORY_LABEL,
	SFX_CATEGORY_ORDER,
	autoSfxIdFor,
	describeSoundtrack,
	resolveSfxId,
	sfxById,
	sfxSrc,
	type CaptionSfxCategory,
	type CaptionSoundEvent,
} from '../../lib/captions/sfx'
import type {
	CaptionSound,
	CaptionSoundTrigger,
	CaptionSoundVariation,
	CaptionStyle,
} from '../../lib/captions/types'
import { IconAlert, IconPlay, IconSparkle, IconVolume, IconVolumeOff } from '../Icons'
import { Segmented, Slider } from './controls'

const TRIGGERS: { value: CaptionSoundTrigger; label: string; hint: string }[] = [
	{
		value: 'sentence',
		label: 'Every sentence',
		hint: 'One sound as each caption appears. The default, and what a social edit uses.',
	},
	{
		value: 'word',
		label: 'Every word',
		hint: 'One per word. Built for the typewriter reveal - keep it quiet and short.',
	},
	{
		value: 'emphasis',
		label: 'Emphasis only',
		hint: 'Only on the words marked as emphasis, so the sound lands on the point.',
	},
]

const VARIATIONS: { value: CaptionSoundVariation; label: string }[] = [
	{ value: 'shuffle', label: 'Shuffle' },
	{ value: 'cycle', label: 'In order' },
	{ value: 'fixed', label: 'Same take' },
]

/** A tiny audition player: one sound at a time, cleaned up on unmount. */
function useAudition(): {
	play: (path: string, volume: number) => void
	playing: string | null
	blocked: boolean
} {
	const elementRef = useRef<HTMLAudioElement | null>(null)
	const [playing, setPlaying] = useState<string | null>(null)
	const [blocked, setBlocked] = useState(false)

	useEffect(() => {
		return () => {
			elementRef.current?.pause()
			elementRef.current = null
		}
	}, [])

	const play = useCallback((path: string, volume: number) => {
		const current = elementRef.current
		if (current) {
			current.pause()
			current.currentTime = 0
		}
		const audio = current ?? new Audio()
		elementRef.current = audio
		audio.src = `/${path}`
		// The mixed level, not the raw file: an audition that plays at full scale
		// tells you nothing about how the effect sits in the video.
		audio.volume = Math.max(0, Math.min(1, volume))
		audio.onended = () => setPlaying(null)
		setPlaying(path)
		void audio
			.play()
			.then(() => setBlocked(false))
			.catch(() => {
				// Autoplay policies, a silent switch on iOS, or a missing file.
				setPlaying(null)
				setBlocked(true)
			})
	}, [])

	return { play, playing, blocked }
}

export default function CaptionSoundPanel({
	sound,
	style,
	cueCount,
	soundtrack,
	disabled,
	onSound,
}: {
	sound: CaptionSound
	style: CaptionStyle
	cueCount: number
	/** the schedule the composition will actually play, for the summary line */
	soundtrack: CaptionSoundEvent[]
	disabled: boolean
	onSound: (patch: Partial<CaptionSound>) => void
}) {
	const [category, setCategory] = useState<CaptionSfxCategory | 'all'>('all')
	const audition = useAudition()

	const autoId = autoSfxIdFor(style)
	const resolvedId = resolveSfxId(sound, style)
	const resolved = sfxById(resolvedId)
	const off = !sound.enabled

	const options = useMemo(
		() => (category === 'all' ? CAPTION_SFX : CAPTION_SFX.filter((o) => o.category === category)),
		[category],
	)

	/** Auditions the take a middle sentence would get, not always take one. */
	const preview = useCallback(
		(id: string) => {
			const option = sfxById(id)
			const variant = option.variants > 1 ? Math.min(option.variants, 7) : 1
			audition.play(sfxSrc(option, variant), Math.min(1, sound.volume * option.gain * 2.2))
		},
		[audition, sound.volume],
	)

	const perMinute =
		soundtrack.length > 1
			? (soundtrack.length /
					Math.max(1, (soundtrack[soundtrack.length - 1].atMs - soundtrack[0].atMs) / 60000)) |
				0
			: 0

	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
			<div>
				<h2 className="section-label">
					Caption sound
					<span className={`badge ${sound.enabled ? 'badge--green' : 'badge--muted'}`}>
						{sound.enabled ? 'on' : 'off'}
					</span>
				</h2>
				<div className="segmented" role="group" aria-label="Caption sound effects">
					<button
						data-active={sound.enabled}
						disabled={disabled}
						onClick={() => onSound({ enabled: true })}
					>
						<IconVolume size={12} /> Sounds on
					</button>
					<button
						data-active={!sound.enabled}
						disabled={disabled}
						onClick={() => onSound({ enabled: false })}
					>
						<IconVolumeOff size={12} /> Silent
					</button>
				</div>
				<p className="hint-text">
					{cueCount === 0
						? 'Transcribe or import a subtitle first - the sounds are placed on the caption timings.'
						: sound.enabled
							? `${describeSoundtrack(soundtrack, sound)}${
									perMinute > 0 ? `, about ${perMinute} a minute` : ''
								}. Burned into the exported video, mixed with the original audio.`
							: 'Off by default. Turn it on and every sentence lands with a sound of its own.'}
				</p>
			</div>

			<div>
				<h2 className="section-label">
					Effect
					<IconSparkle size={12} />
				</h2>

				<button
					className="sfx-option sfx-option--auto"
					data-active={sound.effectId === 'auto'}
					disabled={disabled || off}
					onClick={() => {
						onSound({ effectId: 'auto' })
						preview(autoId)
					}}
				>
					<span className="sfx-option-body">
						<span className="sfx-option-name">Auto - match the entrance</span>
						<span className="sfx-option-hint">
							{sfxById(autoId).label} right now, chosen for the{' '}
							{style.reveal === 'typewriter' ? 'typewriter reveal' : `${style.animation} entrance`}.
							Change the entrance in Design and the sound follows it.
						</span>
					</span>
					<span className="sfx-option-play" aria-hidden>
						<IconPlay size={11} />
					</span>
				</button>

				<div className="chip-row" style={{ marginTop: 12 }}>
					<button
						className="chip chip--button"
						data-active={category === 'all'}
						disabled={disabled || off}
						onClick={() => setCategory('all')}
					>
						All {CAPTION_SFX.length}
					</button>
					{SFX_CATEGORY_ORDER.map((id) => (
						<button
							key={id}
							className="chip chip--button"
							data-active={category === id}
							disabled={disabled || off}
							onClick={() => setCategory(id)}
						>
							{SFX_CATEGORY_LABEL[id]}
						</button>
					))}
				</div>

				<div className="sfx-list">
					{options.map((option) => (
						<button
							key={option.id}
							className="sfx-option"
							data-active={sound.effectId === option.id}
							data-playing={audition.playing?.includes(option.id) ? 'true' : undefined}
							disabled={disabled || off}
							onClick={() => {
								onSound({ effectId: option.id })
								preview(option.id)
							}}
						>
							<span className="sfx-option-body">
								<span className="sfx-option-name">
									{option.label}
									{option.variants > 1 ? (
										<span className="badge badge--muted">{option.variants} takes</span>
									) : null}
								</span>
								<span className="sfx-option-hint">{option.hint}</span>
							</span>
							<span className="sfx-option-play" aria-hidden>
								<IconPlay size={11} />
							</span>
						</button>
					))}
				</div>

				{audition.blocked ? (
					<div className="notice notice--warn" style={{ marginTop: 10 }}>
						<span className="notice-icon">
							<IconAlert size={14} />
						</span>
						<span>
							This browser would not play the preview - on a phone that is usually the silent
							switch. The sound is still mixed into the exported video.
						</span>
					</div>
				) : null}
			</div>

			<div>
				<h2 className="section-label">Mix</h2>
				<div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
					<Slider
						id="sound-volume"
						label="Effect volume"
						value={sound.volume}
						min={0}
						max={1}
						step={0.01}
						disabled={disabled || off}
						format={(value) => (value === 0 ? 'silent' : `${Math.round(value * 100)}%`)}
						onChange={(value) => onSound({ volume: value })}
					/>
					<p className="hint-text" style={{ margin: 0 }}>
						Levelled per effect, so 60% is 60% whether you pick a tick or a boom. Tap an effect
						above to hear it at this setting.
					</p>

					<Slider
						id="sound-duck"
						label="Duck the video under it"
						value={sound.duck}
						min={0}
						max={0.8}
						step={0.02}
						disabled={disabled || off}
						format={(value) => (value === 0 ? 'off' : `-${Math.round(value * 100)}%`)}
						onChange={(value) => onSound({ duck: value })}
					/>
					<p className="hint-text" style={{ margin: 0 }}>
						Dips the original audio while each effect plays, the way a broadcast desk would, so the
						sound sits with the speech instead of on top of it.
					</p>
				</div>
			</div>

			<div>
				<h2 className="section-label">Placement</h2>
				<div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
					<Segmented
						label="Play on"
						value={sound.trigger}
						options={TRIGGERS.map(({ value, label }) => ({ value, label }))}
						disabled={disabled || off}
						wrap
						onChange={(value) => {
							// Per-word on fast speech needs a shorter guard than a per-sentence
							// track, otherwise most of the words are simply dropped.
							onSound(
								value === 'word'
									? { trigger: value, minGapMs: Math.min(sound.minGapMs, 60) }
									: { trigger: value },
							)
						}}
					/>
					<p className="hint-text" style={{ margin: 0 }}>
						{TRIGGERS.find((entry) => entry.value === sound.trigger)?.hint}
					</p>

					<Slider
						id="sound-offset"
						label="Timing"
						value={sound.offsetMs}
						min={-300}
						max={300}
						step={5}
						disabled={disabled || off}
						format={(value) =>
							value === 0 ? 'on the caption' : value < 0 ? `${-value}ms early` : `${value}ms late`
						}
						onChange={(value) => onSound({ offsetMs: value })}
					/>
					<p className="hint-text" style={{ margin: 0 }}>
						A few frames early is what makes the sound and the caption read as one event - the ear
						is ahead of the eye.
					</p>

					<Slider
						id="sound-gap"
						label="Minimum gap"
						value={sound.minGapMs}
						min={0}
						max={800}
						step={10}
						disabled={disabled || off}
						format={(value) => (value === 0 ? 'no limit' : `${value}ms`)}
						onChange={(value) => onSound({ minGapMs: value })}
					/>
					<p className="hint-text" style={{ margin: 0 }}>
						Effects closer together than this are skipped, which is what stops fast speech turning
						the track into a machine gun.
					</p>
				</div>
			</div>

			<div>
				<h2 className="section-label">Variety</h2>
				<div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
					<Segmented
						label="Take per sentence"
						value={sound.variation}
						options={VARIATIONS}
						disabled={disabled || off || resolved.variants <= 1}
						wrap
						onChange={(value) => onSound({ variation: value })}
					/>
					<p className="hint-text" style={{ margin: 0 }}>
						{resolved.variants <= 1
							? `${resolved.label} is a single fixed take. Pick one of the "takes" effects above to vary it per sentence.`
							: sound.variation === 'shuffle'
								? `Each sentence draws one of ${resolved.variants} takes - the same one every render.`
								: sound.variation === 'cycle'
									? `Walks the ${resolved.variants} takes in order, sentence by sentence.`
									: 'Every sentence plays the same take - correct when the sound is a brand sound.'}
					</p>

					{sound.variation === 'shuffle' && resolved.variants > 1 ? (
						<button
							className="btn btn--ghost"
							disabled={disabled || off}
							onClick={() => onSound({ seed: Math.random().toString(36).slice(2, 8) })}
						>
							Re-roll the takes
						</button>
					) : null}

					<Slider
						id="sound-pitch"
						label="Pitch drift"
						value={sound.pitchVariation}
						min={0}
						max={0.2}
						step={0.01}
						disabled={disabled || off}
						format={(value) => (value === 0 ? 'off' : `+/- ${Math.round(value * 100)}%`)}
						onChange={(value) => onSound({ pitchVariation: value })}
					/>
					<p className="hint-text" style={{ margin: 0 }}>
						A small drift per hit is what stops a repeated one-shot sounding like a loop. It is
						derived from the sentence number, never rolled, so renders stay identical.
					</p>
				</div>
			</div>

			<div className="card">
				<div className="stat-row">
					<span>Effect</span>
					<span className="field-value">
						{resolved.label}
						{sound.effectId === 'auto' ? ' (auto)' : ''}
					</span>
				</div>
				<div className="stat-row">
					<span>Sounds scheduled</span>
					<span className="field-value">{soundtrack.length}</span>
				</div>
				<div className="stat-row">
					<span>Longest effect</span>
					<span className="field-value">{resolved.durationSeconds.toFixed(2)}s</span>
				</div>
				<p className="hint-text" style={{ marginBottom: 0 }}>
					Every effect is from the studio&apos;s own CC0 kit, so an exported video owes no
					attribution. The .tsx download carries this exact schedule as data.
				</p>
			</div>
		</div>
	)
}
