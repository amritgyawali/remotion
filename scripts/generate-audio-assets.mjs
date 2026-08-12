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
import { mkdir, readFile, writeFile } from 'node:fs/promises'
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

const SFX = [
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
].map((asset) => ({ ...asset, kind: 'sfx', loopable: false, bpm: null, render: () => renderSfx(asset.id, asset.durationSeconds) }))

const ASSETS = [...MUSIC, ...SFX]

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
	const catalogAssets = []
	let totalBytes = 0

	for (const asset of ASSETS) {
		const track = asset.render()
		const buffer = encodeWav(track, asset.id)
		const metrics = verifyAsset(asset, buffer)
		const outputPath = path.join(versionRoot, asset.file)
		await mkdir(path.dirname(outputPath), { recursive: true })
		await writeFile(outputPath, buffer)
		totalBytes += buffer.length

		catalogAssets.push({
			id: asset.id,
			title: asset.title,
			kind: asset.kind,
			category: asset.category,
			file: `v1/${asset.file}`,
			staticFilePath: `assets/audio/v1/${asset.file}`,
			durationSeconds: asset.durationSeconds,
			durationFramesAt30Fps: Math.round(asset.durationSeconds * REFERENCE_FPS),
			loopable: asset.loopable,
			bpm: asset.bpm,
			recommendedVolume: asset.recommendedVolume,
			tags: asset.tags,
			peakDbfs: round(metrics.peakDbfs, 2),
			rmsDbfs: round(metrics.rmsDbfs, 2),
			dcOffset: round(metrics.dcOffset, 7),
			sha256: metrics.sha256,
			sizeBytes: buffer.length,
		})
		console.log(`audio  -> public/assets/audio/v1/${asset.file} (${asset.durationSeconds.toFixed(1)}s)`)
	}

	const catalog = {
		schemaVersion: 1,
		packVersion: '1.0.0',
		generatedBy: 'scripts/generate-audio-assets.mjs',
		license: 'CC0-1.0',
		attributionRequired: false,
		sourceMaterial: 'Original procedural synthesis only; no third-party samples or recordings.',
		format: {
			container: 'WAV',
			encoding: 'PCM signed 16-bit little-endian',
			sampleRateHz: SAMPLE_RATE,
			channels: CHANNELS,
			bitsPerSample: BITS_PER_SAMPLE,
		},
		assetCount: catalogAssets.length,
		totalBytes,
		assets: catalogAssets,
	}
	await mkdir(audioRoot, { recursive: true })
	await writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8')
	console.log(`catalog -> public/assets/audio/catalog.json (${catalogAssets.length} assets, ${(totalBytes / 1_000_000).toFixed(2)} MB)`)
}

async function verifyOnly() {
	const catalog = JSON.parse(await readFile(catalogPath, 'utf8'))
	if (catalog.assetCount !== ASSETS.length) throw new Error('Catalog asset count does not match the generator')
	for (const asset of ASSETS) {
		const catalogAsset = catalog.assets.find((entry) => entry.id === asset.id)
		if (!catalogAsset) throw new Error(`${asset.id}: missing from catalog`)
		const buffer = await readFile(path.join(audioRoot, catalogAsset.file))
		const metrics = verifyAsset(asset, buffer, catalogAsset.sha256)
		console.log(
			`verified ${asset.id.padEnd(24)} ${metrics.durationSeconds.toFixed(3)}s  peak ${metrics.peakDbfs.toFixed(2)} dBFS  RMS ${metrics.rmsDbfs.toFixed(2)} dBFS`,
		)
	}
	console.log(`verified ${ASSETS.length} deterministic PCM WAV assets`)
}

const verifyOnlyMode = process.argv.includes('--verify-only')
;(verifyOnlyMode ? verifyOnly() : generate()).catch((error) => {
	console.error(error)
	process.exit(1)
})
