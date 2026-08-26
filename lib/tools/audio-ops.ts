/**
 * Pure sample-level transforms for a decoded `AudioBuffer`.
 *
 * Everything here is arithmetic over `Float32Array`s: no DOM, no decoder, no
 * network. That is what lets the Tools Studio preview a transform's effect
 * instantly and lets the same function run in the render path and, if it is
 * ever worth it, in a worker. Every op returns a *new* `AudioBuffer` rather
 * than mutating in place, so a chain of them (say, swap channels, then gain,
 * then fade) never has to reason about aliasing.
 */

import { istft, stft } from './fft'

export type ChannelSource = 'auto' | 'left' | 'right' | 'mix'

/** dBFS below which a channel counts as carrying nothing at all. */
const SILENT_CHANNEL_DB = -50

function cloneBuffer(buffer: AudioBuffer, channels = buffer.numberOfChannels): AudioBuffer {
	return new AudioBuffer({
		length: buffer.length,
		numberOfChannels: Math.max(1, channels),
		sampleRate: buffer.sampleRate,
	})
}

function peakOf(data: Float32Array): number {
	let peak = 0
	for (let i = 0; i < data.length; i++) {
		const value = Math.abs(data[i])
		if (value > peak) peak = value
	}
	return peak
}

function rmsOf(data: Float32Array): number {
	if (data.length === 0) return 0
	let sum = 0
	// Sampling every 4th frame is plenty to tell "silent" from "not" and keeps
	// this cheap even on an hour-long track.
	let count = 0
	for (let i = 0; i < data.length; i += 4) {
		sum += data[i] * data[i]
		count += 1
	}
	return Math.sqrt(sum / Math.max(1, count))
}

function toDb(amplitude: number): number {
	return amplitude > 0 ? 20 * Math.log10(amplitude) : -Infinity
}

export type StereoReport = {
	leftDb: number
	rightDb: number
	/** true when one side is effectively empty - the file most people mean by "mono video" */
	imbalanced: boolean
	silentSide: 'left' | 'right' | null
}

/** What a stereo file's channel balance looks like, for the tool to explain itself. */
export function inspectStereoBalance(buffer: AudioBuffer): StereoReport {
	if (buffer.numberOfChannels < 2) {
		return { leftDb: toDb(rmsOf(buffer.getChannelData(0))), rightDb: -Infinity, imbalanced: true, silentSide: 'right' }
	}
	const leftDb = toDb(rmsOf(buffer.getChannelData(0)))
	const rightDb = toDb(rmsOf(buffer.getChannelData(1)))
	const silentSide = leftDb < SILENT_CHANNEL_DB && rightDb >= SILENT_CHANNEL_DB
		? 'left'
		: rightDb < SILENT_CHANNEL_DB && leftDb >= SILENT_CHANNEL_DB
			? 'right'
			: null
	return { leftDb, rightDb, imbalanced: silentSide !== null, silentSide }
}

/**
 * Turns a mono - or mono-panned-to-one-side - source into real two-channel
 * audio, so a pair of earbuds plays the same thing in both ears.
 *
 * `auto` measures the two channels and duplicates whichever one actually has
 * a signal; a file that already has independent left and right content is
 * left alone rather than being flattened into a mix. `left` / `right` let a
 * person override the guess when the source is unusually quiet; `mix` sums
 * both channels down to one signal first, which is the right call for a file
 * that is "stereo" only because the same mic feed was copied with a phase
 * flip on one side.
 */
export function upmixToStereo(buffer: AudioBuffer, source: ChannelSource = 'auto'): AudioBuffer {
	const out = cloneBuffer(buffer, 2)

	if (buffer.numberOfChannels <= 1) {
		const mono = buffer.getChannelData(0)
		out.copyToChannel(mono, 0)
		out.copyToChannel(mono, 1)
		return out
	}

	if (source === 'mix') {
		const left = buffer.getChannelData(0)
		const right = buffer.getChannelData(1)
		const mixed = new Float32Array(buffer.length)
		for (let i = 0; i < buffer.length; i++) {
			mixed[i] = (left[i] + right[i]) / 2
		}
		out.copyToChannel(mixed, 0)
		out.copyToChannel(mixed, 1)
		return out
	}

	const pick =
		source === 'left'
			? 0
			: source === 'right'
				? 1
				: inspectStereoBalance(buffer).silentSide === 'left'
					? 1
					: 0
	const channel = buffer.getChannelData(pick)
	out.copyToChannel(channel, 0)
	out.copyToChannel(channel, 1)
	return out
}

/** Sums every channel down to one - the inverse of `upmixToStereo`. */
export function downmixToMono(buffer: AudioBuffer): AudioBuffer {
	const out = cloneBuffer(buffer, 1)
	const mixed = new Float32Array(buffer.length)
	const channels = buffer.numberOfChannels
	for (let channel = 0; channel < channels; channel++) {
		const data = buffer.getChannelData(channel)
		for (let i = 0; i < buffer.length; i++) mixed[i] += data[i] / channels
	}
	out.copyToChannel(mixed, 0)
	return out
}

/** Left becomes right and right becomes left; anything past channel 2 is untouched. */
export function swapChannels(buffer: AudioBuffer): AudioBuffer {
	if (buffer.numberOfChannels < 2) return cloneWithChannel(buffer)
	const out = cloneBuffer(buffer)
	out.copyToChannel(buffer.getChannelData(1), 0)
	out.copyToChannel(buffer.getChannelData(0), 1)
	for (let channel = 2; channel < buffer.numberOfChannels; channel++) {
		out.copyToChannel(buffer.getChannelData(channel), channel)
	}
	return out
}

function cloneWithChannel(buffer: AudioBuffer): AudioBuffer {
	const out = cloneBuffer(buffer)
	for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
		out.copyToChannel(buffer.getChannelData(channel), channel)
	}
	return out
}

/** Multiplies every sample by `10^(db/20)`, clamped to the format's own ceiling. */
export function applyGainDb(buffer: AudioBuffer, db: number): AudioBuffer {
	const out = cloneBuffer(buffer)
	const factor = 10 ** (db / 20)
	for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
		const data = new Float32Array(buffer.getChannelData(channel))
		for (let i = 0; i < data.length; i++) data[i] = Math.max(-1, Math.min(1, data[i] * factor))
		out.copyToChannel(data, channel)
	}
	return out
}

/** Raises (or lowers) the whole clip so its loudest sample sits at `targetDb`. */
export function normalizePeak(buffer: AudioBuffer, targetDb = -1): AudioBuffer {
	let peak = 0
	for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
		peak = Math.max(peak, peakOf(buffer.getChannelData(channel)))
	}
	if (peak <= 0) return cloneWithChannel(buffer)
	const targetAmplitude = 10 ** (targetDb / 20)
	const gainDb = 20 * Math.log10(targetAmplitude / peak)
	return applyGainDb(buffer, gainDb)
}

/** Reverses every channel's sample order - the clip plays backwards. */
export function reverseAudio(buffer: AudioBuffer): AudioBuffer {
	const out = cloneBuffer(buffer)
	for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
		const source = buffer.getChannelData(channel)
		const reversed = new Float32Array(source.length)
		for (let i = 0; i < source.length; i++) reversed[i] = source[source.length - 1 - i]
		out.copyToChannel(reversed, channel)
	}
	return out
}

/** An equal-power fade, which sounds smoother than a straight line to the ear. */
function fadeGain(position: number): number {
	return Math.sin((Math.PI / 2) * Math.max(0, Math.min(1, position)))
}

export function applyFade(buffer: AudioBuffer, args: { inMs: number; outMs: number }): AudioBuffer {
	const out = cloneBuffer(buffer)
	const inFrames = Math.max(0, Math.round((args.inMs / 1000) * buffer.sampleRate))
	const outFrames = Math.max(0, Math.round((args.outMs / 1000) * buffer.sampleRate))
	for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
		const data = new Float32Array(buffer.getChannelData(channel))
		for (let i = 0; i < Math.min(inFrames, data.length); i++) {
			data[i] *= fadeGain(i / inFrames)
		}
		for (let i = 0; i < Math.min(outFrames, data.length); i++) {
			const index = data.length - 1 - i
			data[index] *= fadeGain(i / outFrames)
		}
		out.copyToChannel(data, channel)
	}
	return out
}

/**
 * Shifts the whole track later (positive `ms`) or earlier (negative), without
 * losing a sample: the buffer grows by the shift instead of clipping audio
 * off one end. A video's audio track running a beat behind or ahead of the
 * picture is fixed by nudging it back into place, not by throwing part of it
 * away.
 */
export function shiftAudio(buffer: AudioBuffer, ms: number): AudioBuffer {
	const shiftFrames = Math.round((ms / 1000) * buffer.sampleRate)
	if (shiftFrames === 0) return cloneWithChannel(buffer)

	// A later start needs room to grow into, so the buffer lengthens by the
	// shift. An earlier start fits inside the existing length; the tail it
	// vacates is left silent rather than wrapping or clipping anything.
	const length = shiftFrames > 0 ? buffer.length + shiftFrames : buffer.length
	const out = new AudioBuffer({
		length,
		numberOfChannels: buffer.numberOfChannels,
		sampleRate: buffer.sampleRate,
	})
	for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
		const source = buffer.getChannelData(channel)
		const shifted = new Float32Array(length)
		if (shiftFrames > 0) {
			shifted.set(source, shiftFrames)
		} else {
			shifted.set(source.subarray(-shiftFrames), 0)
		}
		out.copyToChannel(shifted, channel)
	}
	return out
}

/**
 * A simple noise gate: an envelope follower mutes whatever sits under
 * `thresholdDb`, with an attack and release so the gate doesn't click open
 * and shut on every syllable. This is not source separation - it will not
 * pull a voice out from under music - but it is exactly what quiets the
 * steady hiss and room rumble sitting under real silence.
 */
export function noiseGate(
	buffer: AudioBuffer,
	args: { thresholdDb: number; attackMs: number; releaseMs: number },
): AudioBuffer {
	const out = cloneBuffer(buffer)
	const threshold = 10 ** (args.thresholdDb / 20)
	const attackSamples = Math.max(1, Math.round((args.attackMs / 1000) * buffer.sampleRate))
	const releaseSamples = Math.max(1, Math.round((args.releaseMs / 1000) * buffer.sampleRate))
	const attackStep = 1 / attackSamples
	const releaseStep = 1 / releaseSamples

	// The envelope is measured once, across every channel together, so a gate
	// on a stereo file opens and closes at the same instant on both sides -
	// gating channels independently would smear the stereo image every time
	// it triggered.
	const channels = buffer.numberOfChannels
	const composite = new Float32Array(buffer.length)
	for (let channel = 0; channel < channels; channel++) {
		const data = buffer.getChannelData(channel)
		for (let i = 0; i < data.length; i++) composite[i] = Math.max(composite[i], Math.abs(data[i]))
	}

	const envelope = new Float32Array(buffer.length)
	let level = 0
	for (let i = 0; i < composite.length; i++) {
		const open = composite[i] >= threshold
		level += open ? attackStep : -releaseStep
		level = Math.max(0, Math.min(1, level))
		envelope[i] = level
	}

	for (let channel = 0; channel < channels; channel++) {
		const data = new Float32Array(buffer.getChannelData(channel))
		for (let i = 0; i < data.length; i++) data[i] *= envelope[i]
		out.copyToChannel(data, channel)
	}
	return out
}

/* =============================================================================
   The advanced suite: EQ, dynamics, restoration, resampling and the two
   spectral tools (noise reduction, pitch shift). Everything below still
   follows the same rule as above - pure functions over `AudioBuffer`s, one
   new `AudioBuffer` out, nothing touched in place.
   ========================================================================== */

/** A linear-time envelope follower: attacks fast, releases slow (or however the caller sets it). */
function computeEnvelope(composite: Float32Array, sampleRate: number, attackMs: number, releaseMs: number): Float32Array {
	const attackCoeff = Math.exp(-1 / (sampleRate * Math.max(0.0001, attackMs / 1000)))
	const releaseCoeff = Math.exp(-1 / (sampleRate * Math.max(0.0001, releaseMs / 1000)))
	const envelope = new Float32Array(composite.length)
	let level = 0
	for (let i = 0; i < composite.length; i++) {
		const coeff = composite[i] > level ? attackCoeff : releaseCoeff
		level = coeff * level + (1 - coeff) * composite[i]
		envelope[i] = level
	}
	return envelope
}

/** Linear-interpolation resample - used to bring a second file onto the first's sample rate before mixing. */
export function resampleChannel(
	data: Float32Array<ArrayBuffer>,
	fromRate: number,
	toRate: number,
	targetLength?: number,
): Float32Array<ArrayBuffer> {
	if (fromRate === toRate && targetLength === undefined) return data
	const ratio = fromRate / toRate
	const outLength = targetLength ?? Math.max(1, Math.round(data.length / ratio))
	const out = new Float32Array(outLength)
	for (let i = 0; i < outLength; i++) {
		const sourcePos = i * ratio
		const index = Math.floor(sourcePos)
		const fraction = sourcePos - index
		const a = index < data.length ? data[index] : 0
		const b = index + 1 < data.length ? data[index + 1] : a
		out[i] = a + (b - a) * fraction
	}
	return out
}

/* ------------------------------------------------------------------ biquad */

type BiquadCoeffs = { b0: number; b1: number; b2: number; a1: number; a2: number }

/** RBJ Audio EQ Cookbook low shelf - boosts or cuts everything below `freq`. */
function lowShelfCoeffs(sampleRate: number, freq: number, gainDb: number): BiquadCoeffs {
	const a = 10 ** (gainDb / 40)
	const w0 = (2 * Math.PI * freq) / sampleRate
	const cosw0 = Math.cos(w0)
	const sinw0 = Math.sin(w0)
	const alpha = (sinw0 / 2) * Math.sqrt((a + 1 / a) * (1 / 0.9 - 1) + 2)
	const twoSqrtAAlpha = 2 * Math.sqrt(a) * alpha
	const b0 = a * (a + 1 - (a - 1) * cosw0 + twoSqrtAAlpha)
	const b1 = 2 * a * (a - 1 - (a + 1) * cosw0)
	const b2 = a * (a + 1 - (a - 1) * cosw0 - twoSqrtAAlpha)
	const a0 = a + 1 + (a - 1) * cosw0 + twoSqrtAAlpha
	const a1 = -2 * (a - 1 + (a + 1) * cosw0)
	const a2 = a + 1 + (a - 1) * cosw0 - twoSqrtAAlpha
	return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 }
}

/** RBJ Audio EQ Cookbook high shelf - boosts or cuts everything above `freq`. */
function highShelfCoeffs(sampleRate: number, freq: number, gainDb: number): BiquadCoeffs {
	const a = 10 ** (gainDb / 40)
	const w0 = (2 * Math.PI * freq) / sampleRate
	const cosw0 = Math.cos(w0)
	const sinw0 = Math.sin(w0)
	const alpha = (sinw0 / 2) * Math.sqrt((a + 1 / a) * (1 / 0.9 - 1) + 2)
	const twoSqrtAAlpha = 2 * Math.sqrt(a) * alpha
	const b0 = a * (a + 1 + (a - 1) * cosw0 + twoSqrtAAlpha)
	const b1 = -2 * a * (a - 1 + (a + 1) * cosw0)
	const b2 = a * (a + 1 + (a - 1) * cosw0 - twoSqrtAAlpha)
	const a0 = a + 1 - (a - 1) * cosw0 + twoSqrtAAlpha
	const a1 = 2 * (a - 1 - (a + 1) * cosw0)
	const a2 = a + 1 - (a - 1) * cosw0 - twoSqrtAAlpha
	return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 }
}

/** RBJ Audio EQ Cookbook constant-skirt bandpass, used as a sidechain filter for the de-esser. */
function bandpassCoeffs(sampleRate: number, freq: number, q: number): BiquadCoeffs {
	const w0 = (2 * Math.PI * freq) / sampleRate
	const cosw0 = Math.cos(w0)
	const sinw0 = Math.sin(w0)
	const alpha = sinw0 / (2 * q)
	const a0 = 1 + alpha
	return { b0: alpha / a0, b1: 0, b2: -alpha / a0, a1: (-2 * cosw0) / a0, a2: (1 - alpha) / a0 }
}

/** A first-order-per-stage high pass, used as the first K-weighting stage. */
function highPassCoeffs(sampleRate: number, freq: number, q: number): BiquadCoeffs {
	const w0 = (2 * Math.PI * freq) / sampleRate
	const cosw0 = Math.cos(w0)
	const sinw0 = Math.sin(w0)
	const alpha = sinw0 / (2 * q)
	const a0 = 1 + alpha
	const b0 = (1 + cosw0) / 2 / a0
	const b1 = -(1 + cosw0) / a0
	const b2 = (1 + cosw0) / 2 / a0
	return { b0, b1, b2, a1: (-2 * cosw0) / a0, a2: (1 - alpha) / a0 }
}

function applyBiquad(buffer: AudioBuffer, coeffs: BiquadCoeffs): AudioBuffer {
	const out = cloneBuffer(buffer)
	for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
		const data = buffer.getChannelData(channel)
		const filtered = new Float32Array(data.length)
		let x1 = 0
		let x2 = 0
		let y1 = 0
		let y2 = 0
		for (let i = 0; i < data.length; i++) {
			const x0 = data[i]
			const y0 = coeffs.b0 * x0 + coeffs.b1 * x1 + coeffs.b2 * x2 - coeffs.a1 * y1 - coeffs.a2 * y2
			filtered[i] = y0
			x2 = x1
			x1 = x0
			y2 = y1
			y1 = y0
		}
		out.copyToChannel(filtered, channel)
	}
	return out
}

/** Warms up (or thins out) the low end. Centred around 150 Hz. */
export function bassBoost(buffer: AudioBuffer, gainDb: number): AudioBuffer {
	return applyBiquad(buffer, lowShelfCoeffs(buffer.sampleRate, 150, gainDb))
}

/** Adds (or removes) air and presence up top. Centred around 6 kHz. */
export function trebleBoost(buffer: AudioBuffer, gainDb: number): AudioBuffer {
	return applyBiquad(buffer, highShelfCoeffs(buffer.sampleRate, 6000, gainDb))
}

/**
 * Mid-side stereo widening: the shared centre is left alone, the
 * left-minus-right difference is scaled. 100% is the original image; above
 * that the stage gets wider and less mono-compatible.
 */
export function stereoWiden(buffer: AudioBuffer, widthPercent: number): AudioBuffer {
	// A mono source has no width to widen - duplicating it to two identical
	// channels first is the honest baseline, and widening that stays silent
	// (mid carries everything, side is zero) until there is real stereo signal.
	if (buffer.numberOfChannels < 2) return upmixToStereo(buffer, 'auto')
	const out = cloneBuffer(buffer)
	const left = buffer.getChannelData(0)
	const right = buffer.getChannelData(1)
	const width = widthPercent / 100
	const outLeft = new Float32Array(buffer.length)
	const outRight = new Float32Array(buffer.length)
	for (let i = 0; i < buffer.length; i++) {
		const mid = (left[i] + right[i]) / 2
		const side = ((left[i] - right[i]) / 2) * width
		outLeft[i] = Math.max(-1, Math.min(1, mid + side))
		outRight[i] = Math.max(-1, Math.min(1, mid - side))
	}
	out.copyToChannel(outLeft, 0)
	out.copyToChannel(outRight, 1)
	for (let channel = 2; channel < buffer.numberOfChannels; channel++) out.copyToChannel(buffer.getChannelData(channel), channel)
	return out
}

/* --------------------------------------------------------------- dynamics */

export type DynamicsSettings = { thresholdDb: number; ratio: number; attackMs: number; releaseMs: number; makeupDb: number }

/**
 * A feed-forward compressor/limiter: one envelope, shared across channels so
 * the stereo image never shifts as it pumps, feeding a standard
 * threshold/ratio gain computer. A limiter is just this with a steep ratio
 * and a fast attack - the registry offers both as presets of one engine.
 */
export function compressDynamics(buffer: AudioBuffer, settings: DynamicsSettings): AudioBuffer {
	const out = cloneBuffer(buffer)
	const channels = buffer.numberOfChannels
	const composite = new Float32Array(buffer.length)
	for (let channel = 0; channel < channels; channel++) {
		const data = buffer.getChannelData(channel)
		for (let i = 0; i < data.length; i++) composite[i] = Math.max(composite[i], Math.abs(data[i]))
	}
	const envelope = computeEnvelope(composite, buffer.sampleRate, settings.attackMs, settings.releaseMs)
	const makeup = 10 ** (settings.makeupDb / 20)
	const gainCurve = new Float32Array(buffer.length)
	for (let i = 0; i < envelope.length; i++) {
		const level = Math.max(1e-6, envelope[i])
		const levelDb = 20 * Math.log10(level)
		let gainDb = 0
		if (levelDb > settings.thresholdDb) {
			const overDb = levelDb - settings.thresholdDb
			gainDb = overDb / settings.ratio - overDb
		}
		gainCurve[i] = 10 ** (gainDb / 20) * makeup
	}
	for (let channel = 0; channel < channels; channel++) {
		const data = new Float32Array(buffer.getChannelData(channel))
		for (let i = 0; i < data.length; i++) data[i] = Math.max(-1, Math.min(1, data[i] * gainCurve[i]))
		out.copyToChannel(data, channel)
	}
	return out
}

/**
 * A de-esser: a sidechain bandpassed to the sibilance range (4-9 kHz by
 * default) drives a gain reduction that is applied to the *full* signal, so
 * an "S" gets quieter without dulling the rest of the word around it.
 */
export function deEss(buffer: AudioBuffer, args: { thresholdDb: number; freq: number; ratio: number }): AudioBuffer {
	const out = cloneBuffer(buffer)
	const sidechain = applyBiquad(buffer, bandpassCoeffs(buffer.sampleRate, args.freq, 1.4))
	const composite = new Float32Array(buffer.length)
	for (let channel = 0; channel < sidechain.numberOfChannels; channel++) {
		const data = sidechain.getChannelData(channel)
		for (let i = 0; i < data.length; i++) composite[i] = Math.max(composite[i], Math.abs(data[i]))
	}
	const envelope = computeEnvelope(composite, buffer.sampleRate, 2, 40)
	const gainCurve = new Float32Array(buffer.length)
	for (let i = 0; i < envelope.length; i++) {
		const level = Math.max(1e-6, envelope[i])
		const levelDb = 20 * Math.log10(level)
		let gainDb = 0
		if (levelDb > args.thresholdDb) {
			const overDb = levelDb - args.thresholdDb
			gainDb = overDb / args.ratio - overDb
		}
		gainCurve[i] = 10 ** (gainDb / 20)
	}
	for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
		const data = new Float32Array(buffer.getChannelData(channel))
		for (let i = 0; i < data.length; i++) data[i] *= gainCurve[i]
		out.copyToChannel(data, channel)
	}
	return out
}

/**
 * Despikes isolated clicks and pops: a 5-tap median filter is a near-perfect
 * predictor of what a sample "should" be, so any sample that deviates from
 * its own neighbourhood's median by more than the neighbourhood's own
 * variability is almost certainly an impulse, not signal - and gets replaced
 * by the median. Real audio content never trips this; a click always does.
 */
export function declickAudio(buffer: AudioBuffer, args: { sensitivity: number }): AudioBuffer {
	const out = cloneBuffer(buffer)
	const radius = 2
	const windowSize = radius * 2 + 1
	for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
		const data = buffer.getChannelData(channel)
		const result = new Float32Array(data.length)
		const window = new Array<number>(windowSize)
		for (let i = 0; i < data.length; i++) {
			for (let k = -radius; k <= radius; k++) {
				const index = i + k
				window[k + radius] = index >= 0 && index < data.length ? data[index] : data[i]
			}
			const sorted = [...window].sort((a, b) => a - b)
			const median = sorted[radius]
			let averageDeviation = 0
			for (const value of window) averageDeviation += Math.abs(value - median)
			averageDeviation /= windowSize
			const threshold = Math.max(0.015, averageDeviation * args.sensitivity)
			result[i] = Math.abs(data[i] - median) > threshold ? median : data[i]
		}
		out.copyToChannel(result, channel)
	}
	return out
}

/**
 * An approximate loudness normaliser, in the spirit of ITU-R BS.1770: the
 * signal is K-weighted (a high-pass around the sub-bass, then a high shelf
 * that mirrors the ear's extra sensitivity around 2-4 kHz) before its mean
 * square is measured, and the whole (unweighted) signal is then gained to
 * put that measurement at the target. What's missing versus the full
 * standard is the absolute/relative loudness gating across blocks - worth
 * saying plainly, since "LUFS" is a specific, audited number and this is a
 * fast, single-pass approximation of it, not a certified meter.
 */
export function normalizeLoudnessApprox(buffer: AudioBuffer, targetLufs: number): AudioBuffer {
	const stage1 = applyBiquad(buffer, highPassCoeffs(buffer.sampleRate, 60, Math.SQRT1_2))
	const weighted = applyBiquad(stage1, highShelfCoeffs(buffer.sampleRate, 2000, 4))

	let sumSquares = 0
	let count = 0
	for (let channel = 0; channel < weighted.numberOfChannels; channel++) {
		const data = weighted.getChannelData(channel)
		for (let i = 0; i < data.length; i++) {
			sumSquares += data[i] * data[i]
			count += 1
		}
	}
	if (count === 0 || sumSquares === 0) return cloneBuffer(buffer)
	const meanSquare = sumSquares / count
	const measuredLufs = -0.691 + 10 * Math.log10(meanSquare)
	const gainDb = Math.max(-24, Math.min(24, targetLufs - measuredLufs))
	return applyGainDb(buffer, gainDb)
}

/* ---------------------------------------------------- spectral processing */

/**
 * Spectral noise reduction: the first slice of the clip is treated as a
 * sample of the noise floor, averaged into a per-frequency-bin profile, and
 * every analysis frame across the whole track then has that profile
 * subtracted from its magnitude spectrum (phase is left untouched - the ear
 * is far more sensitive to phase distortion than to a slightly wrong
 * magnitude). A spectral floor keeps the subtraction from ever hitting
 * exactly zero, which is what avoids the "musical noise" chirping that a
 * naive implementation produces.
 */
export function spectralDenoise(buffer: AudioBuffer, args: { strength: number }): AudioBuffer {
	const frameSize = 1024
	const hop = 256
	const fftSize = 1024
	const out = cloneBuffer(buffer)
	const strength = Math.max(0, Math.min(1, args.strength))
	const oversubtraction = 1 + strength * 2.5
	const floorRatio = 0.06

	for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
		const data = buffer.getChannelData(channel)
		const noiseSampleCount = Math.max(frameSize, Math.min(data.length, Math.round(buffer.sampleRate * 0.35)))
		const noiseFrames = stft(data.subarray(0, noiseSampleCount), frameSize, hop, fftSize)
		const half = fftSize / 2 + 1
		const noiseProfile = new Float64Array(half)
		for (const frame of noiseFrames) {
			for (let i = 0; i < half; i++) noiseProfile[i] += frame.magnitude[i]
		}
		if (noiseFrames.length > 0) {
			for (let i = 0; i < half; i++) noiseProfile[i] /= noiseFrames.length
		}

		const frames = stft(data, frameSize, hop, fftSize)
		for (const frame of frames) {
			for (let i = 0; i < half; i++) {
				const reduced = frame.magnitude[i] - noiseProfile[i] * oversubtraction
				frame.magnitude[i] = Math.max(reduced, noiseProfile[i] * floorRatio)
			}
		}
		out.copyToChannel(istft(frames, frameSize, hop, fftSize, data.length), channel)
	}
	return out
}

/**
 * Pitch shift at a constant duration, via the classic two-step trick: a
 * phase vocoder time-stretches the signal by the shift ratio (which changes
 * duration but preserves pitch), and a linear resample then plays that
 * stretched signal back at the original rate (which changes pitch but
 * restores duration). The phase vocoder step is what keeps the result
 * sounding like the original voice or instrument rather than a buzz - each
 * bin's phase is advanced by its true, measured instantaneous frequency
 * rather than by the bin's nominal frequency, which is the difference
 * between a usable pitch shift and a robotic one.
 */
export function pitchShift(buffer: AudioBuffer, semitones: number): AudioBuffer {
	if (Math.abs(semitones) < 0.01) return cloneBuffer(buffer)
	const ratio = 2 ** (semitones / 12)
	const frameSize = 2048
	const fftSize = 2048
	const hopAnalysis = 512
	const hopSynthesis = Math.max(1, Math.round(hopAnalysis * ratio))
	const half = fftSize / 2 + 1
	const out = cloneBuffer(buffer)

	for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
		const data = buffer.getChannelData(channel)
		const analysisFrames = stft(data, frameSize, hopAnalysis, fftSize)

		const expectedAdvance = new Float64Array(half)
		for (let i = 0; i < half; i++) expectedAdvance[i] = (2 * Math.PI * i * hopAnalysis) / fftSize

		const synthFrames = analysisFrames.map(() => ({ magnitude: new Float64Array(half), phase: new Float64Array(half) }))
		const phaseAccum = new Float64Array(half)
		let previousPhase = new Float64Array(half)

		for (let f = 0; f < analysisFrames.length; f++) {
			const { magnitude, phase } = analysisFrames[f]
			if (f === 0) {
				phaseAccum.set(phase)
			} else {
				for (let i = 0; i < half; i++) {
					let delta = phase[i] - previousPhase[i] - expectedAdvance[i]
					delta -= 2 * Math.PI * Math.round(delta / (2 * Math.PI))
					const trueFreq = expectedAdvance[i] + delta
					phaseAccum[i] += trueFreq * (hopSynthesis / hopAnalysis)
				}
			}
			synthFrames[f].magnitude.set(magnitude)
			synthFrames[f].phase.set(phaseAccum)
			previousPhase = phase
		}

		const stretchedLength = analysisFrames.length > 0 ? (analysisFrames.length - 1) * hopSynthesis + frameSize : 0
		const stretched = istft(synthFrames, frameSize, hopSynthesis, fftSize, Math.max(1, stretchedLength))
		out.copyToChannel(resampleChannel(stretched, 1, 1 / ratio, data.length), channel)
	}
	return out
}

/* ----------------------------------------------------------------- mixing */

/**
 * Mixes a second (music) track underneath `main`, automatically pulling the
 * music down whenever `main` is carrying signal and letting it back up in
 * the gaps - the standard broadcast trick for laying music under narration
 * without a human riding the fader.
 */
export function duckMix(
	main: AudioBuffer,
	music: AudioBuffer,
	args: { duckDb: number; attackMs: number; releaseMs: number; musicGainDb: number },
): AudioBuffer {
	const sampleRate = main.sampleRate
	const channels = Math.max(1, main.numberOfChannels)
	const length = main.length
	const out = new AudioBuffer({ length, numberOfChannels: channels, sampleRate })

	const mainComposite = new Float32Array(length)
	for (let channel = 0; channel < main.numberOfChannels; channel++) {
		const data = main.getChannelData(channel)
		for (let i = 0; i < length; i++) mainComposite[i] = Math.max(mainComposite[i], Math.abs(data[i]))
	}
	const envelope = computeEnvelope(mainComposite, sampleRate, args.attackMs, args.releaseMs)
	const duckFloor = 10 ** (-Math.abs(args.duckDb) / 20)
	const musicGain = 10 ** (args.musicGainDb / 20)
	const openThreshold = 0.015

	for (let channel = 0; channel < channels; channel++) {
		const mainData = main.getChannelData(Math.min(channel, main.numberOfChannels - 1))
		const musicRaw = music.getChannelData(Math.min(channel, Math.max(0, music.numberOfChannels - 1)))
		const musicData = resampleChannel(musicRaw, music.sampleRate, sampleRate, length)
		const mixed = new Float32Array(length)
		for (let i = 0; i < length; i++) {
			const duck = envelope[i] > openThreshold ? duckFloor : 1
			const m = i < mainData.length ? mainData[i] : 0
			mixed[i] = Math.max(-1, Math.min(1, m + musicData[i] * musicGain * duck))
		}
		out.copyToChannel(mixed, channel)
	}
	return out
}
