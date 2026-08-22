#!/usr/bin/env node

/**
 * Deterministically synthesise the studio's original audio pack.
 *
 * There are deliberately no downloaded recordings, samples, presets, or runtime
 * dependencies here. Every sample is built from oscillators and seeded noise,
 * mastered, converted to 48 kHz / 16-bit stereo PCM, and described in the
 * generated catalog.
 *
 * Usage:
 *   node scripts/generate-audio-assets.mjs
 *   node scripts/generate-audio-assets.mjs --verify-only
 */

import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, rmdir, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const audioRoot = path.join(root, 'public', 'assets', 'audio')
const versionRoot = path.join(audioRoot, 'v1')
const catalogPath = path.join(audioRoot, 'catalog.json')

const SAMPLE_RATE = 48_000
const CHANNELS = 2
const BITS_PER_SAMPLE = 16
const REFERENCE_FPS = 30
const VARIANT_REFERENCE_FPS = 120
const VARIANTS_PER_FAMILY = 36
const MIN_PROCEDURAL_SFX_VARIANTS = 540
const MAX_SFX_BYTES = 45 * 1024 * 1024
const TAU = Math.PI * 2

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
const lerp = (from, to, progress) => from + (to - from) * progress
const smoothstep = (value) => {
	const x = clamp(value, 0, 1)
	return x * x * (3 - 2 * x)
}
const dbToGain = (db) => 10 ** (db / 20)
const gainToDb = (gain) => (gain > 0 ? 20 * Math.log10(gain) : -Infinity)
const midiToFrequency = (midi) => 440 * 2 ** ((midi - 69) / 12)
const triangle = (phase) => (2 / Math.PI) * Math.asin(Math.sin(phase))
const round = (value, digits = 3) => Number(value.toFixed(digits))

function hashSeed(text) {
	let value = 0x811c9dc5
	for (let index = 0; index < text.length; index++) {
		value ^= text.charCodeAt(index)
		value = Math.imul(value, 0x01000193)
	}
	return value >>> 0
}

function seededRandom(seedText) {
	let state = hashSeed(seedText) || 0x6d2b79f5
	return () => {
		state += 0x6d2b79f5
		let value = state
		value = Math.imul(value ^ (value >>> 15), value | 1)
		value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
		return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296
	}
}

function createTrack(durationSeconds) {
	const sampleCount = Math.round(durationSeconds * SAMPLE_RATE)
	return {
		durationSeconds,
		left: new Float64Array(sampleCount),
		right: new Float64Array(sampleCount),
	}
}

function panGains(pan) {
	const angle = ((clamp(pan, -1, 1) + 1) * Math.PI) / 4
	return [Math.cos(angle), Math.sin(angle)]
}

function mixSample(track, index, value, pan = 0) {
	if (index < 0 || index >= track.left.length) return
	const [leftGain, rightGain] = panGains(pan)
	track.left[index] += value * leftGain
	track.right[index] += value * rightGain
}

function envelope(time, duration, attack, release) {
	const attackGain = attack <= 0 ? 1 : smoothstep(time / attack)
	const releaseGain = release <= 0 ? 1 : smoothstep((duration - time) / release)
	return Math.min(attackGain, releaseGain)
}

function addNote(
	track,
	{
		start,
		duration,
		midi,
		amplitude,
		pan = 0,
		instrument = 'pad',
		attack = 0.025,
		release = 0.08,
		detune = 0,
	},
) {
	const firstSample = Math.max(0, Math.round(start * SAMPLE_RATE))
	const sampleLength = Math.max(1, Math.round(duration * SAMPLE_RATE))
	const frequency = midiToFrequency(midi) * 2 ** (detune / 1200)

	for (let offset = 0; offset < sampleLength; offset++) {
		const index = firstSample + offset
		if (index >= track.left.length) break
		const time = offset / SAMPLE_RATE
		const phase = TAU * frequency * time
		let voice

		if (instrument === 'pluck') {
			voice =
				(0.74 * Math.sin(phase) +
					0.18 * triangle(phase * 2 + 0.15) +
					0.08 * Math.sin(phase * 3.01)) *
				Math.exp(-time * 4.2)
		} else if (instrument === 'bass') {
			voice = 0.78 * Math.sin(phase) + 0.16 * triangle(phase) + 0.06 * Math.sin(phase * 2)
		} else if (instrument === 'pulse') {
			voice = 0.7 * Math.sin(phase) + 0.22 * Math.sin(phase * 2 + 0.1) + 0.08 * Math.sin(phase * 4)
		} else if (instrument === 'bell') {
			voice =
				(0.62 * Math.sin(phase) +
					0.22 * Math.sin(phase * 2.01) +
					0.11 * Math.sin(phase * 3.97) +
					0.05 * Math.sin(phase * 6.03)) *
				Math.exp(-time * 2.7)
		} else {
			voice =
				0.62 * Math.sin(phase) +
				0.2 * triangle(phase + 0.08) +
				0.12 * Math.sin(phase * 2.003) +
				0.06 * Math.sin(phase * 0.501)
		}

		const gain = envelope(time, duration, attack, release)
		mixSample(track, index, voice * amplitude * gain, pan)
	}
}

function addToneSweep(
	track,
	{
		start = 0,
		duration,
		startFrequency,
		endFrequency,
		amplitude,
		panFrom = 0,
		panTo = 0,
		curve = 'bell',
		harmonic = 0.16,
	},
) {
	const firstSample = Math.max(0, Math.round(start * SAMPLE_RATE))
	const sampleLength = Math.max(1, Math.round(duration * SAMPLE_RATE))
	let phase = 0

	for (let offset = 0; offset < sampleLength; offset++) {
		const index = firstSample + offset
		if (index >= track.left.length) break
		const progress = offset / Math.max(1, sampleLength - 1)
		const frequency = startFrequency * (endFrequency / startFrequency) ** progress
		phase += (TAU * frequency) / SAMPLE_RATE

		let shape
		if (curve === 'rise') shape = smoothstep(progress) * smoothstep((1 - progress) / 0.035)
		else if (curve === 'decay') shape = (1 - Math.exp(-progress * 80)) * Math.exp(-progress * 6)
		else shape = Math.sin(Math.PI * progress) ** 1.35

		const value = (Math.sin(phase) + harmonic * Math.sin(phase * 2.01)) * amplitude * shape
		mixSample(track, index, value, lerp(panFrom, panTo, smoothstep(progress)))
	}
}

function addFilteredNoise(
	track,
	{
		seed,
		start = 0,
		duration,
		amplitude,
		lowCutFrom,
		lowCutTo,
		highCutFrom,
		highCutTo,
		panFrom = 0,
		panTo = 0,
		shape = 'bell',
	},
) {
	const random = seededRandom(seed)
	const firstSample = Math.max(0, Math.round(start * SAMPLE_RATE))
	const sampleLength = Math.max(1, Math.round(duration * SAMPLE_RATE))
	let lowLeft = 0
	let highLeft = 0
	let lowRight = 0
	let highRight = 0

	for (let offset = 0; offset < sampleLength; offset++) {
		const index = firstSample + offset
		if (index >= track.left.length) break
		const progress = offset / Math.max(1, sampleLength - 1)
		const lowCut = lerp(lowCutFrom, lowCutTo, progress)
		const highCut = lerp(highCutFrom, highCutTo, progress)
		const lowAlpha = 1 - Math.exp((-TAU * clamp(lowCut, 20, 18_000)) / SAMPLE_RATE)
		const highAlpha = 1 - Math.exp((-TAU * clamp(highCut, 40, 20_000)) / SAMPLE_RATE)
		const noiseLeft = random() * 2 - 1
		const noiseRight = random() * 2 - 1
		lowLeft += lowAlpha * (noiseLeft - lowLeft)
		highLeft += highAlpha * (noiseLeft - highLeft)
		lowRight += lowAlpha * (noiseRight - lowRight)
		highRight += highAlpha * (noiseRight - highRight)

		let env
		if (shape === 'rise') env = smoothstep(progress) * smoothstep((1 - progress) / 0.035)
		else if (shape === 'decay') env = (1 - Math.exp(-progress * 90)) * Math.exp(-progress * 7)
		else env = Math.sin(Math.PI * progress) ** 1.25

		const pan = lerp(panFrom, panTo, smoothstep(progress))
		const [leftGain, rightGain] = panGains(pan)
		track.left[index] += (highLeft - lowLeft) * amplitude * env * leftGain
		track.right[index] += (highRight - lowRight) * amplitude * env * rightGain
	}
}

function addKick(track, start, amplitude = 0.7, duration = 0.34, baseFrequency = 44) {
	const firstSample = Math.max(0, Math.round(start * SAMPLE_RATE))
	const sampleLength = Math.max(1, Math.round(duration * SAMPLE_RATE))

	for (let offset = 0; offset < sampleLength; offset++) {
		const index = firstSample + offset
		if (index >= track.left.length) break
		const time = offset / SAMPLE_RATE
		const phase = TAU * (baseFrequency * time + (92 / 28) * (1 - Math.exp(-28 * time)))
		const env = (1 - Math.exp(-time * 180)) * Math.exp(-time * 11)
		const click = Math.sin(TAU * 1_800 * time) * Math.exp(-time * 95) * 0.08
		mixSample(track, index, (Math.sin(phase) * env + click) * amplitude, 0)
	}
}

function addSnare(track, start, amplitude, seed) {
	addFilteredNoise(track, {
		seed,
		start,
		duration: 0.24,
		amplitude,
		lowCutFrom: 700,
		lowCutTo: 1_100,
		highCutFrom: 10_000,
		highCutTo: 7_000,
		shape: 'decay',
	})
	addToneSweep(track, {
		start,
		duration: 0.2,
		startFrequency: 205,
		endFrequency: 155,
		amplitude: amplitude * 0.34,
		curve: 'decay',
	})
}

function addHat(track, start, amplitude, seed, pan) {
	addFilteredNoise(track, {
		seed,
		start,
		duration: 0.085,
		amplitude,
		lowCutFrom: 5_500,
		lowCutTo: 6_500,
		highCutFrom: 17_000,
		highCutTo: 14_000,
		panFrom: pan,
		panTo: pan,
		shape: 'decay',
	})
}

function addRim(track, start, amplitude, pan) {
	addToneSweep(track, {
		start,
		duration: 0.07,
		startFrequency: 1_350,
		endFrequency: 720,
		amplitude,
		panFrom: pan,
		panTo: pan,
		curve: 'decay',
		harmonic: 0.28,
	})
}

function applyDelay(track, taps, circular = false) {
	const sourceLeft = track.left.slice()
	const sourceRight = track.right.slice()
	const length = track.left.length

	for (const tap of taps) {
		const delaySamples = Math.max(1, Math.round(tap.seconds * SAMPLE_RATE))
		for (let index = 0; index < length; index++) {
			let sourceIndex = index - delaySamples
			if (circular) sourceIndex = ((sourceIndex % length) + length) % length
			if (sourceIndex < 0) continue
			const left = tap.crossfeed ? sourceRight[sourceIndex] : sourceLeft[sourceIndex]
			const right = tap.crossfeed ? sourceLeft[sourceIndex] : sourceRight[sourceIndex]
			track.left[index] += left * tap.gain
			track.right[index] += right * tap.gain
		}
	}
}

function removeDc(track) {
	let leftMean = 0
	let rightMean = 0
	for (let index = 0; index < track.left.length; index++) {
		leftMean += track.left[index]
		rightMean += track.right[index]
	}
	leftMean /= track.left.length
	rightMean /= track.right.length
	for (let index = 0; index < track.left.length; index++) {
		track.left[index] -= leftMean
		track.right[index] -= rightMean
	}
}

function fadeEdges(track, milliseconds) {
	const fadeSamples = Math.max(1, Math.round((milliseconds / 1_000) * SAMPLE_RATE))
	for (let index = 0; index < Math.min(fadeSamples, track.left.length); index++) {
		const gain = smoothstep(index / fadeSamples)
		track.left[index] *= gain
		track.right[index] *= gain
		const end = track.left.length - index - 1
		track.left[end] *= gain
		track.right[end] *= gain
	}
}

function getFloatMetrics(track) {
	let peak = 0
	let squares = 0
	for (let index = 0; index < track.left.length; index++) {
		const left = track.left[index]
		const right = track.right[index]
		peak = Math.max(peak, Math.abs(left), Math.abs(right))
		squares += left * left + right * right
	}
	return { peak, rms: Math.sqrt(squares / (track.left.length * CHANNELS)) }
}

function master(track, { targetRmsDb = null, peakDb = -1.5, fadeMilliseconds = 3 }) {
	removeDc(track)
	for (let index = 0; index < track.left.length; index++) {
		track.left[index] = Math.tanh(track.left[index] * 1.2) / Math.tanh(1.2)
		track.right[index] = Math.tanh(track.right[index] * 1.2) / Math.tanh(1.2)
	}
	fadeEdges(track, fadeMilliseconds)
	// Saturation and asymmetric one-shot envelopes can reintroduce a tiny mean.
	// Remove it after shaping; equal offsets on both loop edges preserve the seam.
	removeDc(track)

	const current = getFloatMetrics(track)
	const desiredPeak = dbToGain(peakDb)
	const rmsScale = targetRmsDb === null ? Infinity : dbToGain(targetRmsDb) / Math.max(current.rms, 1e-12)
	const peakScale = desiredPeak / Math.max(current.peak, 1e-12)
	const scale = Math.min(rmsScale, peakScale)

	for (let index = 0; index < track.left.length; index++) {
		track.left[index] *= scale
		track.right[index] *= scale
	}
	return track
}

/**
 * Per-style mix decisions. Adding a mood means adding a row here plus a case in
 * the rhythm section below - the harmony, delay and mastering stay shared so
 * every bed sits at the same broadcast level under speech.
 */
const slowDelayStyles = new Set(['cinematic', 'ambient', 'tension', 'epic'])

const MUSIC_STYLE = {
	neon: { pad: 0.085, arp: 0.075, arpInstrument: 'pluck', arpOctave: 24, bass: 0.17, rms: -20 },
	warm: { pad: 0.1, arp: 0.085, arpInstrument: 'pluck', arpOctave: 24, bass: 0.17, rms: -20 },
	cinematic: { pad: 0.115, arp: 0.055, arpInstrument: 'bell', arpOctave: 12, bass: 0.21, rms: -21 },
	ambient: { pad: 0.135, arp: 0.038, arpInstrument: 'bell', arpOctave: 12, bass: 0.12, rms: -23 },
	epic: { pad: 0.125, arp: 0.05, arpInstrument: 'bell', arpOctave: 12, bass: 0.24, rms: -19 },
	lofi: { pad: 0.095, arp: 0.07, arpInstrument: 'pluck', arpOctave: 12, bass: 0.15, rms: -21 },
	corporate: { pad: 0.078, arp: 0.082, arpInstrument: 'pluck', arpOctave: 24, bass: 0.15, rms: -20 },
	tension: { pad: 0.12, arp: 0.026, arpInstrument: 'pulse', arpOctave: 12, bass: 0.2, rms: -22 },
}

function renderMusicBed({ id, durationSeconds, bpm, chords, roots, style }) {
	const track = createTrack(durationSeconds)
	const beat = 60 / bpm
	const bar = beat * 4
	if (Math.abs(bar * chords.length - durationSeconds) > 1 / SAMPLE_RATE) {
		throw new Error(`${id}: chord bars do not exactly fill the loop`)
	}
	const mix = MUSIC_STYLE[style]
	if (!mix) throw new Error(`${id}: unknown music style "${style}"`)

	const arpPattern = [0, 2, 1, 3, 2, 1, 0, 2]
	for (let barIndex = 0; barIndex < chords.length; barIndex++) {
		const barStart = barIndex * bar
		const chord = chords[barIndex]
		const root = roots[barIndex]
		const padAmplitude = mix.pad

		const slow = style === 'cinematic' || style === 'ambient' || style === 'tension'
		chord.forEach((midi, noteIndex) => {
			addNote(track, {
				start: barStart,
				duration: bar,
				midi,
				amplitude: padAmplitude,
				pan: lerp(-0.55, 0.55, noteIndex / Math.max(1, chord.length - 1)),
				instrument: 'pad',
				attack: slow ? 0.22 : 0.12,
				release: slow ? 0.34 : 0.2,
				detune: noteIndex % 2 === 0 ? -2 : 2,
			})
		})

		const bassBeats = style === 'ambient' || style === 'tension' ? [0] : [0, 2]
		for (const beatIndex of bassBeats) {
			addNote(track, {
				start: barStart + beatIndex * beat,
				duration: style === 'ambient' || style === 'tension' ? bar * 0.92 : beat * 1.62,
				midi: root,
				amplitude: mix.bass,
				instrument: 'bass',
				attack: 0.02,
				release: beat * 0.28,
			})
		}

		// Sparse beds keep the melody on a few steps so speech stays on top.
		const arpSteps =
			style === 'ambient' ? [0, 3, 5] : style === 'tension' ? [0, 4] : [0, 1, 2, 3, 4, 5, 6, 7]
		for (const step of arpSteps) {
			const midi = chord[arpPattern[step] % chord.length] + mix.arpOctave
			addNote(track, {
				start: barStart + step * (beat / 2),
				duration: beat * (style === 'warm' || style === 'lofi' ? 0.7 : 0.48),
				midi,
				amplitude: mix.arp,
				pan: step % 2 === 0 ? -0.36 : 0.36,
				instrument: mix.arpInstrument,
				attack: 0.008,
				release: beat * 0.2,
			})
		}

		if (style === 'neon') {
			for (const beatIndex of [0, 2]) addKick(track, barStart + beatIndex * beat, 0.3)
			for (const beatIndex of [1, 3]) addSnare(track, barStart + beatIndex * beat, 0.09, `${id}-snare-${barIndex}-${beatIndex}`)
			for (let step = 0; step < 8; step++) {
				addHat(track, barStart + step * (beat / 2), step % 2 ? 0.055 : 0.038, `${id}-hat-${barIndex}-${step}`, step % 2 ? 0.28 : -0.28)
			}
		} else if (style === 'warm') {
			for (const beatIndex of [0, 2]) addKick(track, barStart + beatIndex * beat, 0.18, 0.3, 50)
			for (const beatIndex of [1, 3]) addRim(track, barStart + beatIndex * beat, 0.055, beatIndex === 1 ? -0.2 : 0.2)
			for (let beatIndex = 0; beatIndex < 4; beatIndex++) {
				addHat(track, barStart + beatIndex * beat, 0.025, `${id}-soft-hat-${barIndex}-${beatIndex}`, beatIndex % 2 ? 0.45 : -0.45)
			}
		} else if (style === 'lofi') {
			// Behind-the-beat kick and rim: the tape-style swing of a lofi loop.
			addKick(track, barStart + beat * 0.02, 0.22, 0.36, 46)
			addKick(track, barStart + beat * 2.06, 0.16, 0.32, 46)
			for (const beatIndex of [1, 3]) addRim(track, barStart + beatIndex * beat + beat * 0.03, 0.07, beatIndex === 1 ? -0.26 : 0.26)
			for (let step = 0; step < 8; step++) {
				const swing = step % 2 ? beat * 0.08 : 0
				addHat(track, barStart + step * (beat / 2) + swing, step % 2 ? 0.03 : 0.042, `${id}-lofi-hat-${barIndex}-${step}`, step % 2 ? 0.34 : -0.34)
			}
		} else if (style === 'corporate') {
			for (const beatIndex of [0, 1, 2, 3]) addKick(track, barStart + beatIndex * beat, beatIndex % 2 ? 0.14 : 0.24, 0.28, 48)
			for (const beatIndex of [1, 3]) addSnare(track, barStart + beatIndex * beat, 0.07, `${id}-clap-${barIndex}-${beatIndex}`)
			for (let step = 0; step < 8; step++) {
				addHat(track, barStart + step * (beat / 2), step % 2 ? 0.045 : 0.03, `${id}-corp-hat-${barIndex}-${step}`, step % 2 ? 0.3 : -0.3)
			}
		} else if (style === 'epic') {
			addKick(track, barStart, 0.52, 0.7, 34)
			addKick(track, barStart + beat * 2, 0.42, 0.62, 36)
			addKick(track, barStart + beat * 3.5, 0.24, 0.4, 40)
			for (const beatIndex of [1, 3]) {
				addFilteredNoise(track, {
					seed: `${id}-taiko-${barIndex}-${beatIndex}`,
					start: barStart + beatIndex * beat,
					duration: 0.42,
					amplitude: 0.16,
					lowCutFrom: 90,
					lowCutTo: 60,
					highCutFrom: 1_600,
					highCutTo: 520,
					shape: 'decay',
				})
			}
		} else if (style === 'ambient') {
			// No percussion at all - this bed is for narration and slow visuals.
			addFilteredNoise(track, {
				seed: `${id}-air-${barIndex}`,
				start: barStart,
				duration: bar,
				amplitude: 0.05,
				lowCutFrom: 900,
				lowCutTo: 1_400,
				highCutFrom: 6_000,
				highCutTo: 9_000,
				panFrom: barIndex % 2 ? -0.4 : 0.4,
				panTo: barIndex % 2 ? 0.4 : -0.4,
			})
		} else if (style === 'tension') {
			for (let beatIndex = 0; beatIndex < 4; beatIndex++) {
				addRim(track, barStart + beatIndex * beat, 0.048, beatIndex % 2 ? 0.32 : -0.32)
			}
			addToneSweep(track, {
				start: barStart,
				duration: bar,
				startFrequency: midiToFrequency(root),
				endFrequency: midiToFrequency(root) * 1.02,
				amplitude: 0.1,
				curve: 'bell',
				harmonic: 0.1,
			})
		} else {
			addKick(track, barStart, 0.36, 0.55, 38)
			addKick(track, barStart + beat * 2, 0.2, 0.45, 42)
			for (let beatIndex = 0; beatIndex < 4; beatIndex++) {
				addNote(track, {
					start: barStart + beatIndex * beat,
					duration: beat * 0.72,
					midi: root + 12,
					amplitude: 0.075,
					pan: beatIndex % 2 ? 0.18 : -0.18,
					instrument: 'pulse',
					attack: 0.035,
					release: beat * 0.3,
				})
			}
		}
	}

	applyDelay(
		track,
		[
			{ seconds: beat * 0.5, gain: slowDelayStyles.has(style) ? 0.12 : 0.1, crossfeed: true },
			{ seconds: beat * 1.5, gain: style === 'warm' || style === 'lofi' ? 0.08 : 0.055, crossfeed: false },
		],
		true,
	)

	return master(track, { targetRmsDb: mix.rms, peakDb: -2.5, fadeMilliseconds: 6 })
}

function renderSfx(id, durationSeconds) {
	const track = createTrack(durationSeconds)

	if (id === 'ui-click-soft') {
		addToneSweep(track, { duration: 0.09, startFrequency: 760, endFrequency: 210, amplitude: 0.7, curve: 'decay', harmonic: 0.08 })
	} else if (id === 'ui-pop-clean') {
		addToneSweep(track, { duration: 0.19, startFrequency: 175, endFrequency: 560, amplitude: 0.78, curve: 'bell', harmonic: 0.12 })
	} else if (id === 'ui-notification-bright') {
		addNote(track, { start: 0.015, duration: 0.34, midi: 79, amplitude: 0.58, pan: -0.12, instrument: 'bell', attack: 0.006, release: 0.12 })
		addNote(track, { start: 0.16, duration: 0.32, midi: 86, amplitude: 0.48, pan: 0.16, instrument: 'bell', attack: 0.006, release: 0.14 })
		applyDelay(track, [{ seconds: 0.075, gain: 0.12, crossfeed: true }])
	} else if (id === 'whoosh-fast') {
		addFilteredNoise(track, { seed: id, duration: 0.39, amplitude: 1.15, lowCutFrom: 260, lowCutTo: 5_800, highCutFrom: 2_500, highCutTo: 17_000, panFrom: -0.72, panTo: 0.72 })
		addToneSweep(track, { duration: 0.38, startFrequency: 90, endFrequency: 360, amplitude: 0.2, panFrom: -0.6, panTo: 0.6, curve: 'bell' })
	} else if (id === 'whoosh-deep') {
		addFilteredNoise(track, { seed: id, duration: 0.87, amplitude: 0.95, lowCutFrom: 90, lowCutTo: 1_000, highCutFrom: 1_100, highCutTo: 6_500, panFrom: 0.55, panTo: -0.55 })
		addToneSweep(track, { duration: 0.86, startFrequency: 130, endFrequency: 48, amplitude: 0.42, panFrom: 0.25, panTo: -0.25, curve: 'bell', harmonic: 0.08 })
	} else if (id === 'riser-digital') {
		addFilteredNoise(track, { seed: id, duration: 1.48, amplitude: 0.9, lowCutFrom: 180, lowCutTo: 7_800, highCutFrom: 1_600, highCutTo: 18_000, panFrom: -0.35, panTo: 0.35, shape: 'rise' })
		addToneSweep(track, { duration: 1.48, startFrequency: 92, endFrequency: 1_450, amplitude: 0.54, panFrom: 0.2, panTo: -0.2, curve: 'rise', harmonic: 0.24 })
	} else if (id === 'impact-clean') {
		addKick(track, 0.006, 1, 0.38, 56)
		addFilteredNoise(track, { seed: id, duration: 0.2, amplitude: 0.42, lowCutFrom: 1_100, lowCutTo: 620, highCutFrom: 14_000, highCutTo: 4_000, shape: 'decay' })
	} else if (id === 'impact-deep') {
		addKick(track, 0.008, 1.2, 0.72, 34)
		addToneSweep(track, { start: 0.02, duration: 0.72, startFrequency: 82, endFrequency: 31, amplitude: 0.54, curve: 'decay', harmonic: 0.05 })
		addFilteredNoise(track, { seed: id, duration: 0.4, amplitude: 0.35, lowCutFrom: 120, lowCutTo: 70, highCutFrom: 2_400, highCutTo: 750, shape: 'decay' })
	} else if (id === 'reveal-shimmer') {
		for (const [offset, midi, pan] of [[0.02, 79, -0.5], [0.12, 84, 0.42], [0.25, 88, -0.18], [0.38, 91, 0.55]]) {
			addNote(track, { start: offset, duration: 0.58, midi, amplitude: 0.42, pan, instrument: 'bell', attack: 0.008, release: 0.24 })
		}
		addFilteredNoise(track, { seed: id, duration: 0.98, amplitude: 0.22, lowCutFrom: 3_200, lowCutTo: 7_800, highCutFrom: 13_000, highCutTo: 18_000, panFrom: -0.4, panTo: 0.4 })
		applyDelay(track, [{ seconds: 0.11, gain: 0.14, crossfeed: true }])
	} else if (id === 'logo-stinger') {
		addKick(track, 0.008, 0.85, 0.48, 44)
		for (const [midi, pan] of [[48, -0.35], [55, 0.32], [60, -0.12], [64, 0.4]]) {
			addNote(track, { start: 0.045, duration: 1.08, midi, amplitude: 0.27, pan, instrument: 'bell', attack: 0.018, release: 0.36 })
		}
		addFilteredNoise(track, { seed: id, start: 0.03, duration: 0.62, amplitude: 0.28, lowCutFrom: 1_700, lowCutTo: 5_500, highCutFrom: 12_000, highCutTo: 16_000, shape: 'decay' })
		applyDelay(track, [{ seconds: 0.14, gain: 0.11, crossfeed: true }])
	} else if (id === 'ui-typewriter') {
		addFilteredNoise(track, { seed: id, duration: 0.05, amplitude: 0.85, lowCutFrom: 1_800, lowCutTo: 900, highCutFrom: 12_000, highCutTo: 5_200, shape: 'decay' })
		addToneSweep(track, { duration: 0.045, startFrequency: 420, endFrequency: 180, amplitude: 0.4, curve: 'decay' })
	} else if (id === 'ui-tick') {
		addToneSweep(track, { duration: 0.035, startFrequency: 2_400, endFrequency: 1_500, amplitude: 0.55, curve: 'decay', harmonic: 0.05 })
	} else if (id === 'ui-swipe') {
		addFilteredNoise(track, { seed: id, duration: 0.22, amplitude: 0.7, lowCutFrom: 800, lowCutTo: 3_400, highCutFrom: 5_000, highCutTo: 13_000, panFrom: -0.5, panTo: 0.5 })
	} else if (id === 'transition-glitch') {
		for (let index = 0; index < 7; index++) {
			addFilteredNoise(track, {
				seed: `${id}-${index}`,
				start: index * 0.042,
				duration: 0.03,
				amplitude: 0.62 + (index % 3) * 0.12,
				lowCutFrom: 600 + index * 700,
				lowCutTo: 400 + index * 500,
				highCutFrom: 9_000 + index * 900,
				highCutTo: 14_000,
				panFrom: index % 2 ? 0.6 : -0.6,
				panTo: index % 2 ? -0.4 : 0.4,
				shape: 'decay',
			})
		}
		addToneSweep(track, { start: 0.2, duration: 0.12, startFrequency: 1_100, endFrequency: 240, amplitude: 0.34, curve: 'decay', harmonic: 0.3 })
	} else if (id === 'transition-sub-drop') {
		addToneSweep(track, { duration: 1.1, startFrequency: 420, endFrequency: 28, amplitude: 0.95, curve: 'decay', harmonic: 0.06 })
		addFilteredNoise(track, { seed: id, duration: 0.55, amplitude: 0.28, lowCutFrom: 160, lowCutTo: 60, highCutFrom: 3_200, highCutTo: 600, shape: 'decay' })
	} else if (id === 'transition-riser-organic') {
		addFilteredNoise(track, { seed: id, duration: 1.9, amplitude: 0.8, lowCutFrom: 120, lowCutTo: 2_600, highCutFrom: 900, highCutTo: 11_000, panFrom: 0.3, panTo: -0.3, shape: 'rise' })
		addToneSweep(track, { duration: 1.9, startFrequency: 110, endFrequency: 620, amplitude: 0.4, curve: 'rise', harmonic: 0.16 })
	} else if (id === 'impact-snap') {
		addFilteredNoise(track, { seed: id, duration: 0.13, amplitude: 0.9, lowCutFrom: 1_400, lowCutTo: 800, highCutFrom: 16_000, highCutTo: 6_000, shape: 'decay' })
		addToneSweep(track, { duration: 0.12, startFrequency: 320, endFrequency: 120, amplitude: 0.5, curve: 'decay' })
	} else if (id === 'impact-boom-tail') {
		addKick(track, 0.006, 1.15, 0.85, 30)
		addToneSweep(track, { start: 0.01, duration: 1.6, startFrequency: 70, endFrequency: 26, amplitude: 0.5, curve: 'decay', harmonic: 0.04 })
		addFilteredNoise(track, { seed: id, start: 0.02, duration: 1.5, amplitude: 0.24, lowCutFrom: 200, lowCutTo: 80, highCutFrom: 4_200, highCutTo: 700, shape: 'decay' })
		applyDelay(track, [{ seconds: 0.22, gain: 0.16, crossfeed: true }])
	} else if (id === 'accent-chime-sparkle') {
		for (const [offset, midi, pan] of [[0.01, 84, -0.4], [0.09, 91, 0.35], [0.18, 96, -0.22], [0.28, 88, 0.45], [0.4, 100, 0]]) {
			addNote(track, { start: offset, duration: 0.5, midi, amplitude: 0.36, pan, instrument: 'bell', attack: 0.005, release: 0.22 })
		}
		applyDelay(track, [{ seconds: 0.13, gain: 0.16, crossfeed: true }])
	} else if (id === 'accent-power-up') {
		addToneSweep(track, { duration: 0.62, startFrequency: 180, endFrequency: 1_600, amplitude: 0.6, curve: 'rise', harmonic: 0.22 })
		for (const [offset, midi] of [[0.14, 72], [0.3, 79], [0.46, 84]]) {
			addNote(track, { start: offset, duration: 0.3, midi, amplitude: 0.32, instrument: 'pluck', attack: 0.005, release: 0.12 })
		}
	} else {
		throw new Error(`Unknown SFX renderer: ${id}`)
	}

	return master(track, { targetRmsDb: null, peakDb: -1.5, fadeMilliseconds: 2 })
}

const PROCEDURAL_FAMILIES = [
	{
		id: 'ui-click', title: 'UI Click', category: 'ui', durationFrames: [10, 16], volume: 0.34,
		motions: ['micro-pulse', 'press', 'release'], timbres: ['glass', 'soft', 'crisp', 'wood'],
		pitch: [620, 1_850], ratio: [0.18, 0.58], brightness: [3_200, 12_500], density: [1, 2], intervals: [2, 3, 5, 7],
		tags: ['click', 'button', 'interface', 'micro-interaction'],
	},
	{
		id: 'ui-pop', title: 'UI Pop', category: 'ui', durationFrames: [16, 26], volume: 0.36,
		motions: ['pop-in', 'pop-out', 'bounce'], timbres: ['bubble', 'rubber', 'clean', 'hollow'],
		pitch: [135, 390], ratio: [1.8, 4.6], brightness: [2_200, 9_500], density: [1, 3], intervals: [3, 5, 7, 12],
		tags: ['pop', 'badge', 'icon', 'interface'],
	},
	{
		id: 'ui-notification', title: 'UI Notification', category: 'ui', durationFrames: [34, 50], volume: 0.32,
		motions: ['notify-up', 'notify-down', 'confirm'], timbres: ['bell', 'digital', 'warm', 'crystal'],
		pitch: [560, 1_050], ratio: [1.12, 1.8], brightness: [5_000, 15_500], density: [2, 4], intervals: [3, 4, 5, 7, 9, 12],
		tags: ['notification', 'success', 'alert', 'interface'],
	},
	{
		id: 'ui-key', title: 'UI Key', category: 'ui', durationFrames: [7, 12], volume: 0.28,
		motions: ['tap', 'type', 'tick'], timbres: ['mechanical', 'soft', 'plastic', 'metal'],
		pitch: [230, 920], ratio: [0.28, 0.72], brightness: [3_600, 16_000], density: [1, 3], intervals: [1, 2, 3, 5],
		tags: ['keyboard', 'type', 'tick', 'interface'],
	},
	{
		id: 'motion-whoosh', title: 'Motion Whoosh', category: 'motion', durationFrames: [28, 48], volume: 0.38,
		motions: ['left-to-right', 'right-to-left', 'center-out', 'arc'], timbres: ['airy', 'silk', 'deep', 'futuristic'],
		pitch: [64, 230], ratio: [2.2, 9.5], brightness: [4_200, 18_000], density: [2, 5], intervals: [5, 7, 12, 19],
		tags: ['whoosh', 'motion', 'speed', 'transition'],
	},
	{
		id: 'motion-swipe', title: 'Motion Swipe', category: 'motion', durationFrames: [20, 34], volume: 0.32,
		motions: ['left-to-right', 'right-to-left', 'upward', 'downward'], timbres: ['paper', 'air', 'digital', 'soft'],
		pitch: [180, 720], ratio: [1.7, 5.2], brightness: [3_800, 15_500], density: [1, 4], intervals: [3, 5, 7, 12],
		tags: ['swipe', 'slide', 'card', 'motion'],
	},
	{
		id: 'transition-glitch', title: 'Transition Glitch', category: 'transitions', durationFrames: [24, 42], volume: 0.35,
		motions: ['stutter', 'fragment', 'scan', 'hard-cut'], timbres: ['bitcrushed', 'static', 'electric', 'metallic'],
		pitch: [170, 1_250], ratio: [0.18, 3.4], brightness: [5_500, 19_000], density: [4, 10], intervals: [1, 6, 11, 13],
		tags: ['glitch', 'digital', 'cut', 'transition'],
	},
	{
		id: 'transition-riser', title: 'Transition Riser', category: 'transitions', durationFrames: [55, 100], volume: 0.34,
		motions: ['build', 'lift', 'spiral', 'accelerate'], timbres: ['digital', 'organic', 'airy', 'tonal'],
		pitch: [55, 220], ratio: [7, 26], brightness: [6_500, 19_000], density: [2, 6], intervals: [7, 12, 19, 24],
		tags: ['riser', 'build', 'reveal', 'transition'],
	},
	{
		id: 'transition-drop', title: 'Transition Drop', category: 'transitions', durationFrames: [48, 84], volume: 0.38,
		motions: ['drop', 'plunge', 'decelerate', 'collapse'], timbres: ['sub', 'cinematic', 'round', 'dark'],
		pitch: [250, 820], ratio: [0.035, 0.2], brightness: [1_200, 6_500], density: [1, 4], intervals: [-24, -19, -12, -7],
		tags: ['drop', 'sub', 'bass', 'transition'],
	},
	{
		id: 'impact-hit', title: 'Impact Hit', category: 'impacts', durationFrames: [16, 30], volume: 0.42,
		motions: ['strike', 'snap', 'punch', 'stamp'], timbres: ['clean', 'hard', 'dry', 'bright'],
		pitch: [42, 96], ratio: [0.32, 0.82], brightness: [3_000, 16_500], density: [1, 4], intervals: [-12, -7, 5, 12],
		tags: ['impact', 'hit', 'reveal', 'accent'],
	},
	{
		id: 'impact-boom', title: 'Impact Boom', category: 'impacts', durationFrames: [48, 92], volume: 0.42,
		motions: ['expansion', 'shockwave', 'trailer-hit', 'decay'], timbres: ['deep', 'sub', 'cinematic', 'rumble'],
		pitch: [26, 58], ratio: [0.42, 0.82], brightness: [850, 5_200], density: [1, 4], intervals: [-24, -12, -7, 5],
		tags: ['boom', 'impact', 'trailer', 'payoff'],
	},
	{
		id: 'accent-chime', title: 'Accent Chime', category: 'accents', durationFrames: [32, 55], volume: 0.31,
		motions: ['spark', 'resolve', 'twinkle', 'confirm'], timbres: ['bell', 'crystal', 'glass', 'warm'],
		pitch: [540, 1_080], ratio: [1.1, 2.1], brightness: [7_000, 18_000], density: [2, 5], intervals: [3, 4, 5, 7, 9, 12],
		tags: ['chime', 'success', 'sparkle', 'accent'],
	},
	{
		id: 'accent-shimmer', title: 'Accent Shimmer', category: 'accents', durationFrames: [46, 84], volume: 0.31,
		motions: ['shimmer', 'scatter', 'cascade', 'reveal'], timbres: ['premium', 'crystal', 'magic', 'airy'],
		pitch: [680, 1_420], ratio: [1.3, 2.7], brightness: [9_000, 19_500], density: [4, 8], intervals: [2, 4, 5, 7, 11, 12],
		tags: ['shimmer', 'sparkle', 'reveal', 'accent'],
	},
	{
		id: 'accent-power', title: 'Accent Power', category: 'accents', durationFrames: [35, 64], volume: 0.33,
		motions: ['power-up', 'charge', 'level-up', 'unlock'], timbres: ['arcade', 'electric', 'heroic', 'digital'],
		pitch: [130, 360], ratio: [4.5, 12], brightness: [5_500, 17_000], density: [3, 6], intervals: [3, 5, 7, 12],
		tags: ['power-up', 'upgrade', 'game', 'accent'],
	},
	{
		id: 'foley-touch', title: 'Foley Touch', category: 'foley', durationFrames: [10, 22], volume: 0.3,
		motions: ['touch', 'place', 'brush', 'flick'], timbres: ['paper', 'cloth', 'wood', 'plastic'],
		pitch: [150, 680], ratio: [0.26, 0.85], brightness: [2_000, 14_500], density: [1, 4], intervals: [2, 3, 5, 7],
		tags: ['foley', 'touch', 'object', 'texture'],
	},
]

const panForMotion = (motion, width) => {
	if (motion === 'left-to-right' || motion === 'upward' || motion === 'lift') return [-width, width]
	if (motion === 'right-to-left' || motion === 'downward' || motion === 'plunge') return [width, -width]
	if (motion === 'center-out' || motion === 'expansion' || motion === 'shockwave') return [-width * 0.2, width]
	if (motion === 'arc' || motion === 'spiral' || motion === 'scatter' || motion === 'cascade') return [width, -width * 0.7]
	return [-width * 0.25, width * 0.25]
}

const randomBetween = (random, [minimum, maximum]) => lerp(minimum, maximum, random())
const frequencyToMidi = (frequency) => 69 + 12 * Math.log2(frequency / 440)

function createProceduralVariant(family, familyIndex, variantIndex) {
	const variant = `v${String(variantIndex).padStart(3, '0')}`
	const id = `${family.id}-${variant}`
	const random = seededRandom(`${id}-parameters-v1`)
	const [minimumFrames, maximumFrames] = family.durationFrames
	const durationSpan = maximumFrames - minimumFrames + 1
	const durationFramesAt120Fps = minimumFrames + ((variantIndex * 17 + familyIndex * 11) % durationSpan)
	const durationSeconds = durationFramesAt120Fps / VARIANT_REFERENCE_FPS
	const motion = family.motions[(variantIndex - 1) % family.motions.length]
	const timbre = family.timbres[(Math.floor((variantIndex - 1) / family.motions.length) + variantIndex) % family.timbres.length]
	const stereoWidth = round(0.18 + random() * 0.7, 4)
	const [panFrom, panTo] = panForMotion(motion, stereoWidth)
	const parameters = {
		baseFrequencyHz: round(randomBetween(random, family.pitch), 3),
		frequencyRatio: round(randomBetween(random, family.ratio), 5),
		brightnessHz: round(randomBetween(random, family.brightness), 2),
		bandwidth: round(0.22 + random() * 0.62, 5),
		harmonicMix: round(0.035 + random() * 0.32, 5),
		noiseMix: round(0.18 + random() * 0.75, 5),
		density: Math.round(randomBetween(random, family.density)),
		intervalSemitones: family.intervals[Math.floor(random() * family.intervals.length)],
		panFrom: round(panFrom, 5),
		panTo: round(panTo, 5),
		attackShape: round(0.55 + random() * 1.1, 5),
		delaySeconds: round(0.018 + random() * Math.min(0.13, durationSeconds * 0.22), 6),
	}

	return {
		id,
		title: `${family.title} ${variant.toUpperCase()}`,
		kind: 'sfx',
		category: family.category,
		family: family.id,
		variant,
		motion,
		timbre,
		file: `sfx/variants/${family.category}/${family.id}/${id}.wav`,
		durationSeconds,
		durationFramesAt120Fps,
		bpm: null,
		loopable: false,
		recommendedVolume: family.volume,
		tags: [...new Set([...family.tags, motion, timbre, family.id])],
		parameters,
		render: () => renderProceduralSfx({ id, family: family.id, durationSeconds, motion, timbre, parameters }),
	}
}

function renderProceduralSfx({ id, family, durationSeconds, timbre, parameters: p }) {
	const track = createTrack(durationSeconds)
	const activeDuration = durationSeconds * 0.94
	const endFrequency = Math.max(22, Math.min(19_500, p.baseFrequencyHz * p.frequencyRatio))
	const toneAmplitude = 0.34 + (1 - p.noiseMix) * 0.42
	const noiseAmplitude = 0.36 + p.noiseMix * 0.66

	if (family === 'ui-click') {
		addToneSweep(track, { duration: activeDuration, startFrequency: p.baseFrequencyHz, endFrequency, amplitude: toneAmplitude, panFrom: p.panFrom, panTo: p.panTo, curve: 'decay', harmonic: p.harmonicMix })
		if (p.density > 1) addToneSweep(track, { start: durationSeconds * 0.17, duration: durationSeconds * 0.56, startFrequency: p.baseFrequencyHz * 1.45, endFrequency: endFrequency * 1.18, amplitude: 0.2, panFrom: -p.panTo, panTo: p.panFrom, curve: 'decay', harmonic: 0.04 })
	} else if (family === 'ui-pop') {
		addToneSweep(track, { duration: activeDuration, startFrequency: p.baseFrequencyHz, endFrequency, amplitude: 0.72, panFrom: p.panFrom, panTo: p.panTo, curve: 'bell', harmonic: p.harmonicMix })
		addFilteredNoise(track, { seed: id, duration: durationSeconds * 0.58, amplitude: 0.18 * p.noiseMix, lowCutFrom: p.brightnessHz * 0.18, lowCutTo: p.brightnessHz * 0.4, highCutFrom: p.brightnessHz, highCutTo: p.brightnessHz * 0.72, panFrom: p.panFrom, panTo: p.panTo, shape: 'decay' })
	} else if (family === 'ui-notification') {
		const baseMidi = frequencyToMidi(p.baseFrequencyHz)
		for (let note = 0; note < p.density; note++) {
			const progress = note / Math.max(1, p.density - 1)
			addNote(track, { start: durationSeconds * (0.035 + progress * 0.42), duration: durationSeconds * (0.62 - progress * 0.1), midi: baseMidi + (note ? p.intervalSemitones + (note - 1) * 2 : 0), amplitude: 0.48 / (1 + note * 0.14), pan: lerp(p.panFrom, p.panTo, progress), instrument: timbre === 'digital' ? 'pulse' : 'bell', attack: 0.004 + p.attackShape * 0.002, release: durationSeconds * 0.28 })
		}
		applyDelay(track, [{ seconds: p.delaySeconds, gain: 0.08 + p.harmonicMix * 0.2, crossfeed: true }])
	} else if (family === 'ui-key') {
		addFilteredNoise(track, { seed: id, duration: durationSeconds * 0.72, amplitude: noiseAmplitude, lowCutFrom: p.brightnessHz * p.bandwidth, lowCutTo: p.brightnessHz * 0.2, highCutFrom: p.brightnessHz, highCutTo: p.brightnessHz * 0.58, panFrom: p.panFrom, panTo: p.panTo, shape: 'decay' })
		addToneSweep(track, { duration: durationSeconds * 0.66, startFrequency: p.baseFrequencyHz, endFrequency, amplitude: toneAmplitude * 0.52, panFrom: p.panFrom, panTo: p.panTo, curve: 'decay', harmonic: p.harmonicMix })
	} else if (family === 'motion-whoosh' || family === 'motion-swipe') {
		const isWhoosh = family === 'motion-whoosh'
		addFilteredNoise(track, { seed: id, duration: activeDuration, amplitude: noiseAmplitude, lowCutFrom: p.baseFrequencyHz, lowCutTo: Math.min(p.brightnessHz * 0.46, endFrequency * 2.4), highCutFrom: Math.max(1_000, p.brightnessHz * (isWhoosh ? 0.32 : 0.44)), highCutTo: p.brightnessHz, panFrom: p.panFrom, panTo: p.panTo, shape: 'bell' })
		addToneSweep(track, { duration: activeDuration * 0.96, startFrequency: p.baseFrequencyHz, endFrequency, amplitude: toneAmplitude * (isWhoosh ? 0.56 : 0.34), panFrom: p.panFrom, panTo: p.panTo, curve: 'bell', harmonic: p.harmonicMix })
		if (p.density >= 4) applyDelay(track, [{ seconds: p.delaySeconds, gain: 0.08, crossfeed: true }])
	} else if (family === 'transition-glitch') {
		const burstGap = durationSeconds * 0.72 / p.density
		for (let burst = 0; burst < p.density; burst++) {
			const alternating = burst % 2 ? -1 : 1
			addFilteredNoise(track, { seed: `${id}-${burst}`, start: durationSeconds * 0.025 + burst * burstGap, duration: Math.min(durationSeconds * 0.18, burstGap * (0.48 + (burst % 3) * 0.13)), amplitude: 0.48 + (burst % 4) * 0.09, lowCutFrom: p.baseFrequencyHz * (1 + burst * 0.32), lowCutTo: p.baseFrequencyHz * p.bandwidth, highCutFrom: Math.min(19_500, p.brightnessHz * (0.55 + burst * 0.045)), highCutTo: p.brightnessHz, panFrom: alternating * p.panFrom, panTo: alternating * p.panTo, shape: 'decay' })
		}
		addToneSweep(track, { start: durationSeconds * 0.42, duration: durationSeconds * 0.38, startFrequency: p.baseFrequencyHz, endFrequency, amplitude: 0.27, panFrom: p.panTo, panTo: p.panFrom, curve: 'decay', harmonic: p.harmonicMix })
	} else if (family === 'transition-riser') {
		addFilteredNoise(track, { seed: id, duration: activeDuration, amplitude: noiseAmplitude, lowCutFrom: p.baseFrequencyHz, lowCutTo: Math.min(p.brightnessHz * 0.62, endFrequency), highCutFrom: p.brightnessHz * 0.18, highCutTo: p.brightnessHz, panFrom: p.panFrom, panTo: p.panTo, shape: 'rise' })
		addToneSweep(track, { duration: activeDuration, startFrequency: p.baseFrequencyHz, endFrequency, amplitude: toneAmplitude, panFrom: -p.panFrom, panTo: -p.panTo, curve: 'rise', harmonic: p.harmonicMix })
	} else if (family === 'transition-drop') {
		addToneSweep(track, { duration: activeDuration, startFrequency: p.baseFrequencyHz, endFrequency, amplitude: 0.9, panFrom: p.panFrom, panTo: p.panTo, curve: 'decay', harmonic: p.harmonicMix * 0.5 })
		addFilteredNoise(track, { seed: id, duration: durationSeconds * 0.66, amplitude: noiseAmplitude * 0.38, lowCutFrom: p.baseFrequencyHz * 0.42, lowCutTo: 35, highCutFrom: p.brightnessHz, highCutTo: Math.max(240, p.brightnessHz * p.bandwidth * 0.24), panFrom: p.panFrom, panTo: p.panTo, shape: 'decay' })
	} else if (family === 'impact-hit') {
		addKick(track, durationSeconds * 0.025, 0.88 + p.harmonicMix, durationSeconds * 0.92, p.baseFrequencyHz)
		addFilteredNoise(track, { seed: id, duration: durationSeconds * (0.55 + p.bandwidth * 0.32), amplitude: noiseAmplitude * 0.62, lowCutFrom: p.brightnessHz * 0.18, lowCutTo: p.brightnessHz * 0.08, highCutFrom: p.brightnessHz, highCutTo: p.brightnessHz * 0.36, panFrom: p.panFrom, panTo: p.panTo, shape: 'decay' })
	} else if (family === 'impact-boom') {
		addKick(track, durationSeconds * 0.012, 1.02, Math.min(durationSeconds * 0.8, 0.72), p.baseFrequencyHz)
		addToneSweep(track, { start: durationSeconds * 0.015, duration: activeDuration, startFrequency: p.baseFrequencyHz * 1.7, endFrequency: Math.max(24, endFrequency), amplitude: 0.6, panFrom: p.panFrom, panTo: p.panTo, curve: 'decay', harmonic: p.harmonicMix * 0.35 })
		addFilteredNoise(track, { seed: id, duration: durationSeconds * 0.76, amplitude: noiseAmplitude * 0.35, lowCutFrom: p.baseFrequencyHz * 2.5, lowCutTo: 50, highCutFrom: p.brightnessHz, highCutTo: Math.max(360, p.brightnessHz * 0.18), panFrom: p.panFrom, panTo: p.panTo, shape: 'decay' })
		if (p.density >= 3) applyDelay(track, [{ seconds: p.delaySeconds * 1.8, gain: 0.1, crossfeed: true }])
	} else if (family === 'accent-chime') {
		const baseMidi = frequencyToMidi(p.baseFrequencyHz)
		for (let note = 0; note < p.density; note++) {
			const progress = note / Math.max(1, p.density - 1)
			addNote(track, { start: durationSeconds * (0.02 + progress * 0.42), duration: durationSeconds * (0.66 - progress * 0.12), midi: baseMidi + (note % 2 ? p.intervalSemitones : note * 2), amplitude: 0.4 / (1 + note * 0.13), pan: lerp(p.panFrom, p.panTo, progress), instrument: timbre === 'warm' ? 'pluck' : 'bell', attack: 0.004, release: durationSeconds * 0.25 })
		}
		applyDelay(track, [{ seconds: p.delaySeconds, gain: 0.1 + p.harmonicMix * 0.15, crossfeed: true }])
	} else if (family === 'accent-shimmer') {
		const baseMidi = frequencyToMidi(p.baseFrequencyHz)
		for (let note = 0; note < p.density; note++) {
			const progress = note / Math.max(1, p.density - 1)
			const octave = note >= Math.ceil(p.density / 2) ? 12 : 0
			addNote(track, { start: durationSeconds * (0.015 + progress * 0.56), duration: durationSeconds * (0.48 - progress * 0.12), midi: baseMidi + octave + (note * p.intervalSemitones) % 12, amplitude: 0.3 / (1 + note * 0.09), pan: note % 2 ? p.panTo : p.panFrom, instrument: 'bell', attack: 0.003, release: durationSeconds * 0.22 })
		}
		addFilteredNoise(track, { seed: id, duration: activeDuration, amplitude: 0.14 + p.noiseMix * 0.12, lowCutFrom: p.brightnessHz * 0.28, lowCutTo: p.brightnessHz * 0.55, highCutFrom: p.brightnessHz * 0.72, highCutTo: p.brightnessHz, panFrom: p.panFrom, panTo: p.panTo, shape: 'bell' })
	} else if (family === 'accent-power') {
		addToneSweep(track, { duration: activeDuration * 0.86, startFrequency: p.baseFrequencyHz, endFrequency, amplitude: 0.58, panFrom: p.panFrom, panTo: p.panTo, curve: 'rise', harmonic: p.harmonicMix })
		const baseMidi = frequencyToMidi(p.baseFrequencyHz * 1.8)
		for (let note = 0; note < p.density; note++) {
			const progress = note / Math.max(1, p.density - 1)
			addNote(track, { start: durationSeconds * (0.16 + progress * 0.52), duration: durationSeconds * 0.3, midi: baseMidi + note * p.intervalSemitones, amplitude: 0.23, pan: lerp(p.panFrom, p.panTo, progress), instrument: timbre === 'heroic' ? 'bell' : 'pulse', attack: 0.004, release: durationSeconds * 0.1 })
		}
	} else if (family === 'foley-touch') {
		for (let pulse = 0; pulse < p.density; pulse++) {
			const progress = pulse / Math.max(1, p.density)
			addFilteredNoise(track, { seed: `${id}-${pulse}`, start: durationSeconds * progress * 0.46, duration: durationSeconds * (0.42 - progress * 0.08), amplitude: noiseAmplitude * (0.66 - progress * 0.16), lowCutFrom: p.brightnessHz * p.bandwidth, lowCutTo: p.brightnessHz * 0.16, highCutFrom: p.brightnessHz, highCutTo: p.brightnessHz * (0.42 + p.bandwidth * 0.2), panFrom: lerp(p.panFrom, p.panTo, progress), panTo: lerp(p.panFrom, p.panTo, Math.min(1, progress + 0.25)), shape: 'decay' })
		}
		addToneSweep(track, { duration: durationSeconds * 0.55, startFrequency: p.baseFrequencyHz, endFrequency, amplitude: toneAmplitude * 0.34, panFrom: p.panFrom, panTo: p.panTo, curve: 'decay', harmonic: p.harmonicMix })
	} else {
		throw new Error(`Unknown procedural SFX family: ${family}`)
	}

	return master(track, { targetRmsDb: null, peakDb: -1.5, fadeMilliseconds: 1.5 })
}

const PROCEDURAL_SFX = PROCEDURAL_FAMILIES.flatMap((family, familyIndex) =>
	Array.from({ length: VARIANTS_PER_FAMILY }, (_, index) => createProceduralVariant(family, familyIndex, index + 1)),
)

const MUSIC = [
	{
		id: 'neon-pulse',
		title: 'Neon Pulse',
		kind: 'music',
		category: 'electronic',
		file: 'music/neon-pulse-120bpm-loop.wav',
		durationSeconds: 8,
		bpm: 120,
		loopable: true,
		recommendedVolume: 0.18,
		tags: ['neon', 'technology', 'energetic', 'futuristic', 'product'],
		render: () => renderMusicBed({
			id: 'neon-pulse', durationSeconds: 8, bpm: 120, style: 'neon',
			chords: [[48, 55, 60, 63], [44, 51, 56, 60], [39, 46, 51, 55], [46, 53, 58, 62]],
			roots: [36, 32, 39, 34],
		}),
	},
	{
		id: 'warm-inspiration',
		title: 'Warm Inspiration',
		kind: 'music',
		category: 'uplifting',
		file: 'music/warm-inspiration-96bpm-loop.wav',
		durationSeconds: 10,
		bpm: 96,
		loopable: true,
		recommendedVolume: 0.17,
		tags: ['warm', 'uplifting', 'friendly', 'story', 'education'],
		render: () => renderMusicBed({
			id: 'warm-inspiration', durationSeconds: 10, bpm: 96, style: 'warm',
			chords: [[48, 55, 60, 64], [43, 50, 55, 59], [45, 52, 57, 60], [41, 48, 53, 57]],
			roots: [36, 31, 33, 29],
		}),
	},
	{
		id: 'cinematic-orbit',
		title: 'Cinematic Orbit',
		kind: 'music',
		category: 'cinematic',
		file: 'music/cinematic-orbit-80bpm-loop.wav',
		durationSeconds: 12,
		bpm: 80,
		loopable: true,
		recommendedVolume: 0.16,
		tags: ['cinematic', 'space', 'dramatic', 'premium', 'slow-build'],
		render: () => renderMusicBed({
			id: 'cinematic-orbit', durationSeconds: 12, bpm: 80, style: 'cinematic',
			chords: [[38, 45, 50, 53], [34, 41, 46, 50], [41, 48, 53, 57], [36, 43, 48, 52]],
			roots: [26, 22, 29, 24],
		}),
	},
	{
		id: 'ambient-calm',
		title: 'Ambient Calm',
		kind: 'music',
		category: 'ambient',
		file: 'music/ambient-calm-70bpm-loop.wav',
		durationSeconds: 13.714285714285714,
		bpm: 70,
		loopable: true,
		recommendedVolume: 0.14,
		tags: ['ambient', 'calm', 'nature', 'meditation', 'narration', 'documentary'],
		render: () => renderMusicBed({
			id: 'ambient-calm', durationSeconds: 13.714285714285714, bpm: 70, style: 'ambient',
			chords: [[45, 52, 57, 64], [43, 50, 55, 62], [41, 48, 53, 60], [40, 47, 52, 59]],
			roots: [33, 31, 29, 28],
		}),
	},
	{
		id: 'epic-cinematic',
		title: 'Epic Cinematic',
		kind: 'music',
		category: 'cinematic',
		file: 'music/epic-cinematic-88bpm-loop.wav',
		durationSeconds: 10.909090909090908,
		bpm: 88,
		loopable: true,
		recommendedVolume: 0.16,
		tags: ['epic', 'trailer', 'heroic', 'sport', 'launch', 'drums'],
		render: () => renderMusicBed({
			id: 'epic-cinematic', durationSeconds: 10.909090909090908, bpm: 88, style: 'epic',
			chords: [[40, 47, 52, 55], [38, 45, 50, 53], [43, 50, 55, 59], [36, 43, 48, 52]],
			roots: [28, 26, 31, 24],
		}),
	},
	{
		id: 'lofi-chill',
		title: 'Lofi Chill',
		kind: 'music',
		category: 'lofi',
		file: 'music/lofi-chill-84bpm-loop.wav',
		durationSeconds: 11.428571428571429,
		bpm: 84,
		loopable: true,
		recommendedVolume: 0.17,
		tags: ['lofi', 'chill', 'study', 'vlog', 'relaxed', 'jazzy'],
		render: () => renderMusicBed({
			id: 'lofi-chill', durationSeconds: 11.428571428571429, bpm: 84, style: 'lofi',
			chords: [[47, 53, 58, 62], [45, 52, 57, 60], [43, 50, 55, 59], [40, 47, 52, 57]],
			roots: [35, 33, 31, 28],
		}),
	},
	{
		id: 'corporate-clean',
		title: 'Corporate Clean',
		kind: 'music',
		category: 'corporate',
		file: 'music/corporate-clean-112bpm-loop.wav',
		durationSeconds: 8.571428571428571,
		bpm: 112,
		loopable: true,
		recommendedVolume: 0.16,
		tags: ['corporate', 'saas', 'explainer', 'optimistic', 'business', 'demo'],
		render: () => renderMusicBed({
			id: 'corporate-clean', durationSeconds: 8.571428571428571, bpm: 112, style: 'corporate',
			chords: [[52, 59, 64, 68], [50, 57, 62, 66], [47, 54, 59, 63], [45, 52, 57, 61]],
			roots: [40, 38, 35, 33],
		}),
	},
	{
		id: 'tension-drone',
		title: 'Tension Drone',
		kind: 'music',
		category: 'tension',
		file: 'music/tension-drone-72bpm-loop.wav',
		durationSeconds: 13.333333333333334,
		bpm: 72,
		loopable: true,
		recommendedVolume: 0.15,
		tags: ['tension', 'suspense', 'problem', 'thriller', 'before-after', 'drone'],
		render: () => renderMusicBed({
			id: 'tension-drone', durationSeconds: 13.333333333333334, bpm: 72, style: 'tension',
			chords: [[38, 44, 49, 51], [38, 45, 49, 52], [37, 44, 48, 51], [38, 44, 49, 50]],
			roots: [26, 26, 25, 26],
		}),
	},
]

const LEGACY_SFX_METADATA = {
	'ui-click-soft': { family: 'ui-click', motion: 'press', timbre: 'soft' },
	'ui-pop-clean': { family: 'ui-pop', motion: 'pop-in', timbre: 'clean' },
	'ui-notification-bright': { family: 'ui-notification', motion: 'confirm', timbre: 'crystal' },
	'whoosh-fast': { family: 'motion-whoosh', motion: 'left-to-right', timbre: 'airy' },
	'whoosh-deep': { family: 'motion-whoosh', motion: 'right-to-left', timbre: 'deep' },
	'riser-digital': { family: 'transition-riser', motion: 'build', timbre: 'digital' },
	'impact-clean': { family: 'impact-hit', motion: 'strike', timbre: 'clean' },
	'impact-deep': { family: 'impact-boom', motion: 'shockwave', timbre: 'deep' },
	'reveal-shimmer': { family: 'accent-shimmer', motion: 'reveal', timbre: 'premium' },
	'logo-stinger': { family: 'accent-chime', motion: 'resolve', timbre: 'bell' },
	'ui-typewriter': { family: 'ui-key', motion: 'type', timbre: 'mechanical' },
	'ui-tick': { family: 'ui-key', motion: 'tick', timbre: 'metal' },
	'ui-swipe': { family: 'motion-swipe', motion: 'left-to-right', timbre: 'soft' },
	'transition-glitch': { family: 'transition-glitch', motion: 'hard-cut', timbre: 'static' },
	'transition-sub-drop': { family: 'transition-drop', motion: 'drop', timbre: 'sub' },
	'transition-riser-organic': { family: 'transition-riser', motion: 'lift', timbre: 'organic' },
	'impact-snap': { family: 'impact-hit', motion: 'snap', timbre: 'dry' },
	'impact-boom-tail': { family: 'impact-boom', motion: 'trailer-hit', timbre: 'cinematic' },
	'accent-chime-sparkle': { family: 'accent-chime', motion: 'twinkle', timbre: 'crystal' },
	'accent-power-up': { family: 'accent-power', motion: 'power-up', timbre: 'arcade' },
}

const LEGACY_SFX = [
	{ id: 'ui-click-soft', title: 'Soft UI Click', category: 'ui', file: 'sfx/ui/click-soft.wav', durationSeconds: 0.1, recommendedVolume: 0.36, tags: ['click', 'button', 'minimal'] },
	{ id: 'ui-pop-clean', title: 'Clean UI Pop', category: 'ui', file: 'sfx/ui/pop-clean.wav', durationSeconds: 0.2, recommendedVolume: 0.38, tags: ['pop', 'badge', 'icon'] },
	{ id: 'ui-notification-bright', title: 'Bright Notification', category: 'ui', file: 'sfx/ui/notification-bright.wav', durationSeconds: 0.5, recommendedVolume: 0.34, tags: ['notification', 'success', 'positive'] },
	{ id: 'whoosh-fast', title: 'Fast Whoosh', category: 'transitions', file: 'sfx/transitions/whoosh-fast.wav', durationSeconds: 0.4, recommendedVolume: 0.4, tags: ['whoosh', 'transition', 'arrow', 'fast'] },
	{ id: 'whoosh-deep', title: 'Deep Whoosh', category: 'transitions', file: 'sfx/transitions/whoosh-deep.wav', durationSeconds: 0.9, recommendedVolume: 0.38, tags: ['whoosh', 'transition', 'deep', 'cinematic'] },
	{ id: 'riser-digital', title: 'Digital Riser', category: 'transitions', file: 'sfx/transitions/riser-digital.wav', durationSeconds: 1.5, recommendedVolume: 0.35, tags: ['riser', 'build', 'transition', 'digital'] },
	{ id: 'impact-clean', title: 'Clean Impact', category: 'impacts', file: 'sfx/impacts/impact-clean.wav', durationSeconds: 0.4, recommendedVolume: 0.46, tags: ['impact', 'hit', 'reveal'] },
	{ id: 'impact-deep', title: 'Deep Impact', category: 'impacts', file: 'sfx/impacts/impact-deep.wav', durationSeconds: 0.8, recommendedVolume: 0.42, tags: ['impact', 'bass', 'cinematic', 'payoff'] },
	{ id: 'reveal-shimmer', title: 'Reveal Shimmer', category: 'accents', file: 'sfx/accents/reveal-shimmer.wav', durationSeconds: 1, recommendedVolume: 0.34, tags: ['shimmer', 'sparkle', 'reveal', 'premium'] },
	{ id: 'logo-stinger', title: 'Logo Stinger', category: 'accents', file: 'sfx/accents/logo-stinger.wav', durationSeconds: 1.2, recommendedVolume: 0.4, tags: ['logo', 'stinger', 'ending', 'brand'] },
	{ id: 'ui-typewriter', title: 'Typewriter Key', category: 'ui', file: 'sfx/ui/typewriter.wav', durationSeconds: 0.08, recommendedVolume: 0.3, tags: ['type', 'keyboard', 'caption', 'text'] },
	{ id: 'ui-tick', title: 'Counter Tick', category: 'ui', file: 'sfx/ui/tick.wav', durationSeconds: 0.06, recommendedVolume: 0.28, tags: ['tick', 'counter', 'number', 'chart'] },
	{ id: 'ui-swipe', title: 'Swipe', category: 'ui', file: 'sfx/ui/swipe.wav', durationSeconds: 0.25, recommendedVolume: 0.32, tags: ['swipe', 'card', 'slide', 'mobile'] },
	{ id: 'transition-glitch', title: 'Glitch Cut', category: 'transitions', file: 'sfx/transitions/glitch.wav', durationSeconds: 0.4, recommendedVolume: 0.36, tags: ['glitch', 'cut', 'digital', 'error'] },
	{ id: 'transition-sub-drop', title: 'Sub Drop', category: 'transitions', file: 'sfx/transitions/sub-drop.wav', durationSeconds: 1.2, recommendedVolume: 0.4, tags: ['drop', 'bass', 'scene-change', 'cinematic'] },
	{ id: 'transition-riser-organic', title: 'Organic Riser', category: 'transitions', file: 'sfx/transitions/riser-organic.wav', durationSeconds: 2, recommendedVolume: 0.34, tags: ['riser', 'build', 'nature', 'documentary'] },
	{ id: 'impact-snap', title: 'Snap Impact', category: 'impacts', file: 'sfx/impacts/impact-snap.wav', durationSeconds: 0.16, recommendedVolume: 0.4, tags: ['snap', 'cut', 'text', 'fast'] },
	{ id: 'impact-boom-tail', title: 'Boom With Tail', category: 'impacts', file: 'sfx/impacts/impact-boom-tail.wav', durationSeconds: 2, recommendedVolume: 0.44, tags: ['boom', 'trailer', 'title', 'payoff'] },
	{ id: 'accent-chime-sparkle', title: 'Chime Sparkle', category: 'accents', file: 'sfx/accents/chime-sparkle.wav', durationSeconds: 1, recommendedVolume: 0.32, tags: ['chime', 'magic', 'sparkle', 'success'] },
	{ id: 'accent-power-up', title: 'Power Up', category: 'accents', file: 'sfx/accents/power-up.wav', durationSeconds: 0.8, recommendedVolume: 0.34, tags: ['power', 'upgrade', 'level-up', 'game'] },
].map((asset) => ({
	...asset,
	...LEGACY_SFX_METADATA[asset.id],
	variant: 'legacy',
	kind: 'sfx',
	loopable: false,
	bpm: null,
	render: () => renderSfx(asset.id, asset.durationSeconds),
}))

const SFX = [...LEGACY_SFX, ...PROCEDURAL_SFX]

const FAMILY_SUMMARIES = PROCEDURAL_FAMILIES.map((family) => ({
	id: family.id,
	category: family.category,
	pathPattern: `v1/sfx/variants/${family.category}/${family.id}/${family.id}-v{NNN}.wav`,
	staticFilePathPattern: `assets/audio/v1/sfx/variants/${family.category}/${family.id}/${family.id}-v{NNN}.wav`,
	variantCount: VARIANTS_PER_FAMILY,
	motion: family.motions,
	timbre: family.timbres,
	recommendedVolume: family.volume,
}))

const LEGACY_VARIANT_MAP = Object.fromEntries(LEGACY_SFX.map((asset) => {
	const family = FAMILY_SUMMARIES.find((entry) => entry.id === asset.family)
	return [asset.id, {
		legacyFile: `v1/${asset.file}`,
		legacyStaticFilePath: `assets/audio/v1/${asset.file}`,
		family: asset.family,
		category: family.category,
		variantCount: family.variantCount,
		variantIdPattern: `${asset.family}-v{NNN}`,
		pathPattern: family.pathPattern,
		staticFilePathPattern: family.staticFilePathPattern,
	}]
}))

const ASSETS = [...MUSIC, ...SFX]

const PRESERVED_MUSIC_FILES = {
	'neon-pulse': 'music/neon-pulse-120bpm-loop.wav',
	'warm-inspiration': 'music/warm-inspiration-96bpm-loop.wav',
	'cinematic-orbit': 'music/cinematic-orbit-80bpm-loop.wav',
	'ambient-calm': 'music/ambient-calm-70bpm-loop.wav',
	'epic-cinematic': 'music/epic-cinematic-88bpm-loop.wav',
	'lofi-chill': 'music/lofi-chill-84bpm-loop.wav',
	'corporate-clean': 'music/corporate-clean-112bpm-loop.wav',
	'tension-drone': 'music/tension-drone-72bpm-loop.wav',
}

const PRESERVED_LEGACY_SFX_FILES = {
	'ui-click-soft': 'sfx/ui/click-soft.wav',
	'ui-pop-clean': 'sfx/ui/pop-clean.wav',
	'ui-notification-bright': 'sfx/ui/notification-bright.wav',
	'whoosh-fast': 'sfx/transitions/whoosh-fast.wav',
	'whoosh-deep': 'sfx/transitions/whoosh-deep.wav',
	'riser-digital': 'sfx/transitions/riser-digital.wav',
	'impact-clean': 'sfx/impacts/impact-clean.wav',
	'impact-deep': 'sfx/impacts/impact-deep.wav',
	'reveal-shimmer': 'sfx/accents/reveal-shimmer.wav',
	'logo-stinger': 'sfx/accents/logo-stinger.wav',
	'ui-typewriter': 'sfx/ui/typewriter.wav',
	'ui-tick': 'sfx/ui/tick.wav',
	'ui-swipe': 'sfx/ui/swipe.wav',
	'transition-glitch': 'sfx/transitions/glitch.wav',
	'transition-sub-drop': 'sfx/transitions/sub-drop.wav',
	'transition-riser-organic': 'sfx/transitions/riser-organic.wav',
	'impact-snap': 'sfx/impacts/impact-snap.wav',
	'impact-boom-tail': 'sfx/impacts/impact-boom-tail.wav',
	'accent-chime-sparkle': 'sfx/accents/chime-sparkle.wav',
	'accent-power-up': 'sfx/accents/power-up.wav',
}

function validateDefinitions() {
	if (MUSIC.length !== 8) throw new Error(`Expected 8 preserved music assets, found ${MUSIC.length}`)
	if (LEGACY_SFX.length !== 20) throw new Error(`Expected 20 preserved legacy SFX, found ${LEGACY_SFX.length}`)
	if (PROCEDURAL_SFX.length < MIN_PROCEDURAL_SFX_VARIANTS) {
		throw new Error(`Expected at least ${MIN_PROCEDURAL_SFX_VARIANTS} procedural SFX variants, found ${PROCEDURAL_SFX.length}`)
	}
	if (SFX.length < 560) throw new Error(`Expected at least 560 total SFX, found ${SFX.length}`)
	if (PROCEDURAL_SFX.length !== PROCEDURAL_FAMILIES.length * VARIANTS_PER_FAMILY) {
		throw new Error('Procedural family/variant cardinality is inconsistent')
	}

	for (const [id, file] of Object.entries(PRESERVED_MUSIC_FILES)) {
		if (MUSIC.find((asset) => asset.id === id)?.file !== file) throw new Error(`${id}: preserved music path changed`)
	}
	for (const [id, file] of Object.entries(PRESERVED_LEGACY_SFX_FILES)) {
		if (LEGACY_SFX.find((asset) => asset.id === id)?.file !== file) throw new Error(`${id}: preserved legacy SFX path changed`)
	}

	const requiredCategories = new Set(['ui', 'motion', 'transitions', 'impacts', 'accents', 'foley'])
	for (const category of requiredCategories) {
		if (!PROCEDURAL_FAMILIES.some((family) => family.category === category)) {
			throw new Error(`Missing required procedural SFX category: ${category}`)
		}
	}

	const ids = new Set()
	const files = new Set()
	for (const asset of ASSETS) {
		if (!asset.id || ids.has(asset.id)) throw new Error(`Duplicate or empty asset id: ${asset.id}`)
		if (!asset.file || files.has(asset.file)) throw new Error(`Duplicate or empty asset path: ${asset.file}`)
		if (path.posix.isAbsolute(asset.file) || asset.file.includes('\\') || asset.file.split('/').includes('..') || !asset.file.endsWith('.wav')) {
			throw new Error(`${asset.id}: unsafe or unsupported WAV path ${asset.file}`)
		}
		const exactSampleCount = asset.durationSeconds * SAMPLE_RATE
		if (asset.kind === 'sfx' && Math.abs(exactSampleCount - Math.round(exactSampleCount)) > 1e-6) {
			throw new Error(`${asset.id}: duration does not resolve to an exact 48 kHz sample count`)
		}
		ids.add(asset.id)
		files.add(asset.file)
		if (asset.kind === 'sfx') {
			for (const field of ['family', 'variant', 'motion', 'timbre']) {
				if (typeof asset[field] !== 'string' || !asset[field]) throw new Error(`${asset.id}: missing SFX metadata field ${field}`)
			}
			if (!Array.isArray(asset.tags) || asset.tags.length < 3) throw new Error(`${asset.id}: missing searchable SFX tags`)
		}
	}

	for (const family of PROCEDURAL_FAMILIES) {
		const variants = PROCEDURAL_SFX.filter((asset) => asset.family === family.id)
		if (variants.length !== VARIANTS_PER_FAMILY) throw new Error(`${family.id}: expected ${VARIANTS_PER_FAMILY} variants`)
		for (let index = 1; index <= VARIANTS_PER_FAMILY; index++) {
			const variant = `v${String(index).padStart(3, '0')}`
			const id = `${family.id}-${variant}`
			const expectedFile = `sfx/variants/${family.category}/${family.id}/${id}.wav`
			const asset = variants[index - 1]
			if (asset.id !== id || asset.variant !== variant || asset.file !== expectedFile) {
				throw new Error(`${family.id}: non-deterministic variant ordering or path at ${variant}`)
			}
		}
	}

	if (Object.keys(LEGACY_VARIANT_MAP).length !== LEGACY_SFX.length) throw new Error('Legacy variant map is incomplete')
}

function contentFingerprint(track) {
	const hash = createHash('sha256')
	const framesPerChunk = 1_024
	const chunk = Buffer.allocUnsafe(framesPerChunk * CHANNELS * 4)
	let chunkFrames = 0

	for (let index = 0; index < track.left.length; index++) {
		const offset = chunkFrames * CHANNELS * 4
		chunk.writeInt32LE(Math.round(clamp(track.left[index], -1, 1) * 8_388_607), offset)
		chunk.writeInt32LE(Math.round(clamp(track.right[index], -1, 1) * 8_388_607), offset + 4)
		chunkFrames++
		if (chunkFrames === framesPerChunk) {
			hash.update(chunk)
			chunkFrames = 0
		}
	}
	if (chunkFrames) hash.update(chunk.subarray(0, chunkFrames * CHANNELS * 4))
	return hash.digest('hex')
}

function perceptualFingerprint(track) {
	const binCount = 32
	const descriptor = [`signal-v1`, track.left.length, SAMPLE_RATE, CHANNELS]
	let previousMono = 0
	let previousSign = 0

	for (let bin = 0; bin < binCount; bin++) {
		const start = Math.floor((bin * track.left.length) / binCount)
		const end = Math.max(start + 1, Math.floor(((bin + 1) * track.left.length) / binCount))
		let monoSquares = 0
		let sideSquares = 0
		let derivativeSquares = 0
		let absoluteMono = 0
		let peak = 0
		let zeroCrossings = 0

		for (let index = start; index < end; index++) {
			const mono = (track.left[index] + track.right[index]) * 0.5
			const side = (track.left[index] - track.right[index]) * 0.5
			const derivative = mono - previousMono
			const sign = mono >= 0 ? 1 : -1
			if (previousSign && sign !== previousSign) zeroCrossings++
			monoSquares += mono * mono
			sideSquares += side * side
			derivativeSquares += derivative * derivative
			absoluteMono += Math.abs(mono)
			peak = Math.max(peak, Math.abs(mono), Math.abs(side))
			previousMono = mono
			previousSign = sign
		}
		const length = end - start
		descriptor.push(
			Math.round(Math.sqrt(monoSquares / length) * 1_000_000),
			Math.round(Math.sqrt(sideSquares / length) * 1_000_000),
			Math.round(Math.sqrt(derivativeSquares / length) * 1_000_000),
			Math.round((absoluteMono / length) * 1_000_000),
			Math.round(peak * 1_000_000),
			zeroCrossings,
		)
	}

	return createHash('sha256').update(descriptor.join(',')).digest('hex')
}

function getTrackFingerprints(track) {
	return {
		contentFingerprintSha256: contentFingerprint(track),
		perceptualFingerprintSha256: perceptualFingerprint(track),
	}
}

function assertUniqueFingerprints(fingerprintOwners, asset, fingerprints) {
	for (const field of ['contentFingerprintSha256', 'perceptualFingerprintSha256']) {
		const fingerprint = fingerprints[field]
		const existing = fingerprintOwners[field].get(fingerprint)
		if (existing) throw new Error(`${asset.id}: ${field} duplicates ${existing}`)
		fingerprintOwners[field].set(fingerprint, asset.id)
	}
}

async function listWavFiles(directory, relativeDirectory = '') {
	let entries
	try {
		entries = await readdir(directory, { withFileTypes: true })
	} catch (error) {
		if (error.code === 'ENOENT') return []
		throw error
	}
	const files = []
	for (const entry of entries) {
		const relative = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name
		const absolute = path.join(directory, entry.name)
		if (entry.isDirectory()) files.push(...await listWavFiles(absolute, relative))
		else if (entry.isFile() && entry.name.toLowerCase().endsWith('.wav')) files.push(relative)
	}
	return files.sort()
}

async function pruneEmptyDirectories(directory, keepRoot = true) {
	let entries
	try {
		entries = await readdir(directory, { withFileTypes: true })
	} catch (error) {
		if (error.code === 'ENOENT') return
		throw error
	}
	for (const entry of entries) {
		if (entry.isDirectory()) await pruneEmptyDirectories(path.join(directory, entry.name), false)
	}
	if (!keepRoot) {
		try {
			await rmdir(directory)
		} catch (error) {
			if (error.code !== 'ENOTEMPTY' && error.code !== 'ENOENT') throw error
		}
	}
}

async function removeStaleGeneratedWavs() {
	const expected = new Set(ASSETS.map((asset) => asset.file))
	const existing = await listWavFiles(versionRoot)
	const stale = existing.filter((file) => !expected.has(file))
	for (const file of stale) await unlink(path.join(versionRoot, ...file.split('/')))
	await pruneEmptyDirectories(versionRoot)
	return stale
}

async function assertNoStaleGeneratedWavs() {
	const expected = new Set(ASSETS.map((asset) => asset.file))
	const existing = await listWavFiles(versionRoot)
	const stale = existing.filter((file) => !expected.has(file))
	const missing = [...expected].filter((file) => !existing.includes(file))
	if (stale.length) throw new Error(`Found ${stale.length} stale generated WAV files, including ${stale[0]}`)
	if (missing.length) throw new Error(`Missing ${missing.length} generated WAV files, including ${missing[0]}`)
}

function encodeWav(track, seed) {
	const sampleCount = track.left.length
	const dataBytes = sampleCount * CHANNELS * (BITS_PER_SAMPLE / 8)
	const output = Buffer.alloc(44 + dataBytes)
	output.write('RIFF', 0, 'ascii')
	output.writeUInt32LE(36 + dataBytes, 4)
	output.write('WAVE', 8, 'ascii')
	output.write('fmt ', 12, 'ascii')
	output.writeUInt32LE(16, 16)
	output.writeUInt16LE(1, 20)
	output.writeUInt16LE(CHANNELS, 22)
	output.writeUInt32LE(SAMPLE_RATE, 24)
	output.writeUInt32LE(SAMPLE_RATE * CHANNELS * (BITS_PER_SAMPLE / 8), 28)
	output.writeUInt16LE(CHANNELS * (BITS_PER_SAMPLE / 8), 32)
	output.writeUInt16LE(BITS_PER_SAMPLE, 34)
	output.write('data', 36, 'ascii')
	output.writeUInt32LE(dataBytes, 40)

	const random = seededRandom(`${seed}-tpdf-dither`)
	let offset = 44
	for (let index = 0; index < sampleCount; index++) {
		for (const sample of [track.left[index], track.right[index]]) {
			const dither = (random() - random()) / 65_536
			const value = clamp(sample + dither, -1, 0.999969)
			output.writeInt16LE(value < 0 ? Math.round(value * 32_768) : Math.round(value * 32_767), offset)
			offset += 2
		}
	}
	return output
}

function inspectWav(buffer) {
	if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
		throw new Error('Invalid RIFF/WAVE header')
	}
	if (buffer.toString('ascii', 12, 16) !== 'fmt ' || buffer.toString('ascii', 36, 40) !== 'data') {
		throw new Error('Expected canonical 44-byte PCM WAV header')
	}
	const audioFormat = buffer.readUInt16LE(20)
	const channels = buffer.readUInt16LE(22)
	const sampleRate = buffer.readUInt32LE(24)
	const bitsPerSample = buffer.readUInt16LE(34)
	const dataBytes = buffer.readUInt32LE(40)
	if (audioFormat !== 1 || channels !== CHANNELS || sampleRate !== SAMPLE_RATE || bitsPerSample !== BITS_PER_SAMPLE) {
		throw new Error(`Unexpected WAV format: PCM=${audioFormat}, channels=${channels}, rate=${sampleRate}, bits=${bitsPerSample}`)
	}
	if (dataBytes !== buffer.length - 44) throw new Error('WAV data length does not match the header')

	let peak = 0
	let squares = 0
	let sum = 0
	let samples = 0
	for (let offset = 44; offset < buffer.length; offset += 2) {
		const value = buffer.readInt16LE(offset) / 32_768
		peak = Math.max(peak, Math.abs(value))
		squares += value * value
		sum += value
		samples++
	}
	const frameCount = dataBytes / (channels * (bitsPerSample / 8))
	const firstLeft = buffer.readInt16LE(44) / 32_768
	const firstRight = buffer.readInt16LE(46) / 32_768
	const lastLeft = buffer.readInt16LE(buffer.length - 4) / 32_768
	const lastRight = buffer.readInt16LE(buffer.length - 2) / 32_768

	return {
		durationSeconds: frameCount / sampleRate,
		peakDbfs: gainToDb(peak),
		rmsDbfs: gainToDb(Math.sqrt(squares / samples)),
		dcOffset: sum / samples,
		seamDelta: Math.max(Math.abs(firstLeft - lastLeft), Math.abs(firstRight - lastRight)),
	}
}

function verifyAsset(asset, buffer, expectedHash = null) {
	const metrics = inspectWav(buffer)
	if (Math.abs(metrics.durationSeconds - asset.durationSeconds) > 1 / SAMPLE_RATE) {
		throw new Error(`${asset.id}: expected ${asset.durationSeconds}s, got ${metrics.durationSeconds}s`)
	}
	if (metrics.peakDbfs > -1.35) throw new Error(`${asset.id}: peak ${metrics.peakDbfs.toFixed(2)} dBFS exceeds ceiling`)
	if (!Number.isFinite(metrics.rmsDbfs) || metrics.rmsDbfs < -60) throw new Error(`${asset.id}: signal is silent or too quiet`)
	if (Math.abs(metrics.dcOffset) > 0.001) throw new Error(`${asset.id}: DC offset is too high`)
	if (asset.loopable && metrics.seamDelta > 0.002) throw new Error(`${asset.id}: loop seam delta is too high`)
	const sha256 = createHash('sha256').update(buffer).digest('hex')
	if (expectedHash && sha256 !== expectedHash) throw new Error(`${asset.id}: SHA-256 does not match catalog`)
	return { ...metrics, sha256 }
}

async function generate() {
	validateDefinitions()
	const startedAt = Date.now()
	const catalogAssets = []
	let totalBytes = 0
	let sfxBytes = 0
	const fingerprintOwners = {
		contentFingerprintSha256: new Map(),
		perceptualFingerprintSha256: new Map(),
	}

	for (let assetIndex = 0; assetIndex < ASSETS.length; assetIndex++) {
		const asset = ASSETS[assetIndex]
		const track = asset.render()
		const fingerprints = getTrackFingerprints(track)
		assertUniqueFingerprints(fingerprintOwners, asset, fingerprints)
		const buffer = encodeWav(track, asset.id)
		const metrics = verifyAsset(asset, buffer)
		const outputPath = path.join(versionRoot, asset.file)
		await mkdir(path.dirname(outputPath), { recursive: true })
		await writeFile(outputPath, buffer)
		totalBytes += buffer.length
		if (asset.kind === 'sfx') sfxBytes += buffer.length

		const catalogAsset = {
			id: asset.id,
			title: asset.title,
			kind: asset.kind,
			category: asset.category,
			file: `v1/${asset.file}`,
			staticFilePath: `assets/audio/v1/${asset.file}`,
			durationSeconds: asset.durationSeconds,
			durationFramesAt30Fps: Math.round(asset.durationSeconds * REFERENCE_FPS),
			durationFramesAt120Fps: Math.round(asset.durationSeconds * VARIANT_REFERENCE_FPS),
			loopable: asset.loopable,
			bpm: asset.bpm,
			recommendedVolume: asset.recommendedVolume,
			tags: asset.tags,
			...(asset.kind === 'sfx' ? {
				family: asset.family,
				variant: asset.variant,
				motion: asset.motion,
				timbre: asset.timbre,
				origin: asset.variant === 'legacy' ? 'legacy-procedural' : 'procedural-variant',
				synthesisParameters: asset.parameters ?? null,
			} : { origin: 'procedural-music' }),
			peakDbfs: round(metrics.peakDbfs, 2),
			rmsDbfs: round(metrics.rmsDbfs, 2),
			dcOffset: round(metrics.dcOffset, 7),
			fingerprintStage: 'mastered-float-pre-dither',
			...fingerprints,
			sha256: metrics.sha256,
			sizeBytes: buffer.length,
		}
		catalogAssets.push(catalogAsset)

		if ((assetIndex + 1) % 50 === 0 || assetIndex === 0 || assetIndex === ASSETS.length - 1) {
			console.log(`audio  -> ${String(assetIndex + 1).padStart(3)}/${ASSETS.length}  public/assets/audio/v1/${asset.file}`)
		}
	}
	if (sfxBytes > MAX_SFX_BYTES) {
		throw new Error(`Expanded SFX use ${(sfxBytes / 1024 / 1024).toFixed(2)} MiB, exceeding the ${MAX_SFX_BYTES / 1024 / 1024} MiB budget`)
	}
	const stale = await removeStaleGeneratedWavs()

	const catalog = {
		schemaVersion: 2,
		packVersion: '2.0.0',
		generatedBy: 'scripts/generate-audio-assets.mjs',
		license: 'CC0-1.0',
		attributionRequired: false,
		sourceMaterial: 'Original procedural synthesis only; no third-party samples or recordings.',
		variantSelection: {
			indexFormula: '(fnv1a32(`${creativeSeed}:${legacyId}`) % variantCount) + 1',
			placeholder: '{NNN} is the zero-padded 1-based variant index',
		},
		format: {
			container: 'WAV',
			encoding: 'PCM signed 16-bit little-endian',
			sampleRateHz: SAMPLE_RATE,
			channels: CHANNELS,
			bitsPerSample: BITS_PER_SAMPLE,
		},
		assetCount: catalogAssets.length,
		counts: {
			music: MUSIC.length,
			sfx: SFX.length,
			legacySfx: LEGACY_SFX.length,
			proceduralSfxVariants: PROCEDURAL_SFX.length,
			byCategory: Object.fromEntries([...new Set(SFX.map((asset) => asset.category))].sort().map((category) => [category, SFX.filter((asset) => asset.category === category).length])),
		},
		totalBytes,
		sfxBytes,
		families: FAMILY_SUMMARIES,
		legacyVariantMap: LEGACY_VARIANT_MAP,
		fingerprints: {
			content: 'SHA-256 of mastered stereo float samples quantized to signed 24-bit before PCM dither',
			perceptual: 'SHA-256 of a 32-window signal descriptor (mono/side/derivative energy, absolute level, peak, zero crossings) before PCM dither',
		},
		assets: catalogAssets,
	}
	await mkdir(audioRoot, { recursive: true })
	await writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8')
	const elapsedSeconds = (Date.now() - startedAt) / 1_000
	console.log(`catalog -> public/assets/audio/catalog.json (${catalogAssets.length} assets, ${SFX.length} SFX, ${(sfxBytes / 1024 / 1024).toFixed(2)} MiB SFX)`)
	console.log(`generated ${PROCEDURAL_SFX.length} variants in ${elapsedSeconds.toFixed(2)}s; removed ${stale.length} stale WAV file${stale.length === 1 ? '' : 's'}`)
}

async function verifyOnly() {
	validateDefinitions()
	const startedAt = Date.now()
	const catalog = JSON.parse(await readFile(catalogPath, 'utf8'))
	if (catalog.schemaVersion !== 2 || catalog.packVersion !== '2.0.0') throw new Error('Catalog schema/pack version does not match the generator')
	if (catalog.assetCount !== ASSETS.length) throw new Error('Catalog asset count does not match the generator')
	if (!Array.isArray(catalog.assets) || catalog.assets.length !== ASSETS.length) throw new Error('Catalog assets array has the wrong length')
	if (JSON.stringify(catalog.families) !== JSON.stringify(FAMILY_SUMMARIES)) throw new Error('Catalog family summaries do not match the generator')
	if (JSON.stringify(catalog.legacyVariantMap) !== JSON.stringify(LEGACY_VARIANT_MAP)) throw new Error('Catalog legacy variant map does not match the generator')
	if (catalog.counts?.music !== MUSIC.length || catalog.counts?.sfx !== SFX.length || catalog.counts?.legacySfx !== LEGACY_SFX.length || catalog.counts?.proceduralSfxVariants !== PROCEDURAL_SFX.length) {
		throw new Error('Catalog count summary does not match the generator')
	}

	const catalogIds = new Set()
	const catalogFiles = new Set()
	for (const entry of catalog.assets) {
		if (catalogIds.has(entry.id)) throw new Error(`Catalog contains duplicate id ${entry.id}`)
		if (catalogFiles.has(entry.file)) throw new Error(`Catalog contains duplicate path ${entry.file}`)
		catalogIds.add(entry.id)
		catalogFiles.add(entry.file)
	}

	const fingerprintOwners = {
		contentFingerprintSha256: new Map(),
		perceptualFingerprintSha256: new Map(),
	}
	let totalBytes = 0
	let sfxBytes = 0
	for (let assetIndex = 0; assetIndex < ASSETS.length; assetIndex++) {
		const asset = ASSETS[assetIndex]
		const catalogAsset = catalog.assets.find((entry) => entry.id === asset.id)
		if (!catalogAsset) throw new Error(`${asset.id}: missing from catalog`)
		if (catalogAsset.file !== `v1/${asset.file}` || catalogAsset.staticFilePath !== `assets/audio/v1/${asset.file}`) throw new Error(`${asset.id}: catalog path mismatch`)
		if (catalogAsset.durationSeconds !== asset.durationSeconds || catalogAsset.loopable !== asset.loopable || catalogAsset.bpm !== asset.bpm) throw new Error(`${asset.id}: catalog timing metadata mismatch`)
		if (asset.kind === 'sfx') {
			for (const field of ['family', 'variant', 'motion', 'timbre']) {
				if (catalogAsset[field] !== asset[field]) throw new Error(`${asset.id}: catalog ${field} mismatch`)
			}
			if (JSON.stringify(catalogAsset.tags) !== JSON.stringify(asset.tags)) throw new Error(`${asset.id}: catalog tags mismatch`)
			if (JSON.stringify(catalogAsset.synthesisParameters) !== JSON.stringify(asset.parameters ?? null)) throw new Error(`${asset.id}: synthesis parameter mismatch`)
		}

		const track = asset.render()
		const fingerprints = getTrackFingerprints(track)
		assertUniqueFingerprints(fingerprintOwners, asset, fingerprints)
		for (const field of ['contentFingerprintSha256', 'perceptualFingerprintSha256']) {
			if (catalogAsset[field] !== fingerprints[field]) throw new Error(`${asset.id}: ${field} does not match pre-dither signal`)
		}

		const expectedBuffer = encodeWav(track, asset.id)
		const expectedHash = createHash('sha256').update(expectedBuffer).digest('hex')
		if (catalogAsset.sha256 !== expectedHash) throw new Error(`${asset.id}: catalog checksum is not reproducible from synthesis`)
		const buffer = await readFile(path.join(audioRoot, catalogAsset.file))
		const metrics = verifyAsset(asset, buffer, catalogAsset.sha256)
		if (buffer.length !== catalogAsset.sizeBytes || !buffer.equals(expectedBuffer)) throw new Error(`${asset.id}: WAV bytes differ from deterministic generator output`)
		totalBytes += buffer.length
		if (asset.kind === 'sfx') sfxBytes += buffer.length
		if ((assetIndex + 1) % 50 === 0 || assetIndex === 0 || assetIndex === ASSETS.length - 1) {
			console.log(`verified ${String(assetIndex + 1).padStart(3)}/${ASSETS.length}  ${asset.id.padEnd(30)} ${metrics.durationSeconds.toFixed(3)}s`)
		}
	}
	if (totalBytes !== catalog.totalBytes || sfxBytes !== catalog.sfxBytes) throw new Error('Catalog byte totals do not match the WAV files')
	if (sfxBytes > MAX_SFX_BYTES) throw new Error(`SFX byte budget exceeded: ${(sfxBytes / 1024 / 1024).toFixed(2)} MiB`)
	await assertNoStaleGeneratedWavs()
	console.log(`verified ${ASSETS.length} deterministic PCM WAV assets (${SFX.length} SFX, ${(sfxBytes / 1024 / 1024).toFixed(2)} MiB SFX) in ${((Date.now() - startedAt) / 1_000).toFixed(2)}s`)
}

const verifyOnlyMode = process.argv.includes('--verify-only')
;(verifyOnlyMode ? verifyOnly() : generate()).catch((error) => {
	console.error(error)
	process.exit(1)
})
