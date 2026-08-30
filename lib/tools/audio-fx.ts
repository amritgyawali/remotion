'use client'

/**
 * The effects half of the audio rack: space (reverb, echo), tone (a real
 * five-band equaliser), character (the voice-changer presets), and one
 * analysis pass that finds the beat.
 *
 * `audio-ops.ts` is repair - gates, compressors, de-essers, loudness. This is
 * the other kind of audio work, the kind you reach for on purpose. Everything
 * here is a plain `AudioBuffer -> AudioBuffer` function so it drops straight
 * into the same `remuxWithAudioEdit({ audio: { kind: 'process' } })` seam the
 * repair tools use, with no new plumbing and no `OfflineAudioContext`: doing
 * it by hand keeps the whole chain synchronous and testable in Node, which is
 * where the offline checks run.
 *
 * The reverb is a Freeverb - eight parallel damped comb filters into four
 * series allpasses, per channel, with the right channel's delay lengths
 * offset by a prime number of samples. That offset is the entire reason it
 * sounds like a room rather than a pipe: identical delays in both channels
 * produce a correlated tail the ear localises to the centre of the head.
 */

export type ReverbSettings = {
	/** 0-1: how big the room is (comb feedback) */
	size: number
	/** 0-1: how fast the high frequencies die away */
	damping: number
	/** 0-1: how much reverb is mixed in */
	wet: number
	/** milliseconds before the first reflection - distance from the wall */
	preDelayMs: number
	/** 0-1: how wide the tail is */
	width: number
}

/**
 * Freeverb's tuning, in samples at 44.1kHz. They are mutually prime on
 * purpose: delay lengths that share factors reinforce each other into a
 * ringing note instead of dissolving into a tail.
 */
const COMB_TUNING = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617]
const ALLPASS_TUNING = [556, 441, 341, 225]
/** The right channel's offset, in samples. Also prime. */
const STEREO_SPREAD = 23
const TUNING_RATE = 44100

function cloneShape(buffer: AudioBuffer): AudioBuffer {
	return new AudioBuffer({
		length: buffer.length,
		numberOfChannels: buffer.numberOfChannels,
		sampleRate: buffer.sampleRate,
	})
}

/** One damped comb: a delay line whose feedback is low-passed as it recirculates. */
class Comb {
	private readonly buffer: Float32Array
	private index = 0
	private filterStore = 0

	constructor(
		size: number,
		private readonly feedback: number,
		private readonly damping: number,
	) {
		this.buffer = new Float32Array(Math.max(1, size))
	}

	process(input: number): number {
		const output = this.buffer[this.index]
		// The one-pole low pass inside the loop is the "damping": each pass
		// round the delay loses more of its top end, which is what a real room
		// does and what separates a tail from a repeat.
		this.filterStore = output * (1 - this.damping) + this.filterStore * this.damping
		this.buffer[this.index] = input + this.filterStore * this.feedback
		this.index = (this.index + 1) % this.buffer.length
		return output
	}
}

/** One Schroeder allpass: flat in magnitude, scrambled in phase. */
class Allpass {
	private readonly buffer: Float32Array
	private index = 0

	constructor(size: number) {
		this.buffer = new Float32Array(Math.max(1, size))
	}

	process(input: number): number {
		const stored = this.buffer[this.index]
		const output = -input + stored
		this.buffer[this.index] = input + stored * 0.5
		this.index = (this.index + 1) % this.buffer.length
		return output
	}
}

export function applyReverb(buffer: AudioBuffer, settings: ReverbSettings): AudioBuffer {
	const out = cloneShape(buffer)
	const rate = buffer.sampleRate
	const scale = rate / TUNING_RATE
	// 0.7-0.98 is the usable range: below it there is no tail, above it the
	// loop gain approaches 1 and the reverb never decays.
	const feedback = 0.7 + Math.min(1, Math.max(0, settings.size)) * 0.28
	const damping = Math.min(0.95, Math.max(0, settings.damping) * 0.9)
	const wet = Math.min(1, Math.max(0, settings.wet))
	const dry = 1 - wet * 0.75
	const preDelay = Math.max(0, Math.round((settings.preDelayMs / 1000) * rate))
	const width = Math.min(1, Math.max(0, settings.width))

	const tails: Float32Array[] = []
	for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
		const data = buffer.getChannelData(channel)
		const spread = channel % 2 === 1 ? STEREO_SPREAD : 0
		const combs = COMB_TUNING.map((size) => new Comb(Math.round(size * scale) + spread, feedback, damping))
		const allpasses = ALLPASS_TUNING.map((size) => new Allpass(Math.round(size * scale) + spread))
		const tail = new Float32Array(data.length)

		for (let i = 0; i < data.length; i++) {
			const input = (i >= preDelay ? data[i - preDelay] : 0) * 0.015
			let sum = 0
			for (const comb of combs) sum += comb.process(input)
			for (const allpass of allpasses) sum = allpass.process(sum)
			tail[i] = sum
		}
		tails.push(tail)
	}

	// Cross-feeding the two tails is how the width control works: at 0 they
	// collapse to mono, at 1 each channel keeps its own room.
	for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
		const data = buffer.getChannelData(channel)
		const own = tails[channel]
		const other = tails[buffer.numberOfChannels > 1 ? (channel + 1) % buffer.numberOfChannels : channel]
		const mixed = new Float32Array(data.length)
		for (let i = 0; i < data.length; i++) {
			const tail = own[i] * (0.5 + width * 0.5) + other[i] * (0.5 - width * 0.5)
			mixed[i] = Math.max(-1, Math.min(1, data[i] * dry + tail * wet))
		}
		out.copyToChannel(mixed, channel)
	}
	return out
}

export type EchoSettings = {
	delayMs: number
	/** 0-0.95: how much of each repeat is fed back in */
	feedback: number
	/** 0-1 */
	wet: number
	/** true to bounce the repeats between the channels */
	pingPong: boolean
}

export function applyEcho(buffer: AudioBuffer, settings: EchoSettings): AudioBuffer {
	const out = cloneShape(buffer)
	const rate = buffer.sampleRate
	const delay = Math.max(1, Math.round((settings.delayMs / 1000) * rate))
	// Anything at or above 1 is an oscillator, not an echo.
	const feedback = Math.min(0.92, Math.max(0, settings.feedback))
	const wet = Math.min(1, Math.max(0, settings.wet))
	const channels = buffer.numberOfChannels

	const lines: Float32Array[] = []
	for (let channel = 0; channel < channels; channel++) lines.push(new Float32Array(buffer.length))

	for (let i = 0; i < buffer.length; i++) {
		for (let channel = 0; channel < channels; channel++) {
			const data = buffer.getChannelData(channel)
			// Ping-pong reads its feedback from the *other* channel's line, which
			// is what makes each repeat alternate sides.
			const feedChannel = settings.pingPong && channels > 1 ? (channel + 1) % channels : channel
			const delayed = i >= delay ? lines[feedChannel][i - delay] : 0
			lines[channel][i] = data[i] + delayed * feedback
		}
	}

	for (let channel = 0; channel < channels; channel++) {
		const data = buffer.getChannelData(channel)
		const mixed = new Float32Array(buffer.length)
		for (let i = 0; i < buffer.length; i++) {
			const delayed = i >= delay ? lines[channel][i - delay] : 0
			mixed[i] = Math.max(-1, Math.min(1, data[i] + delayed * wet))
		}
		out.copyToChannel(mixed, channel)
	}
	return out
}

/* ------------------------------------------------------------- equaliser */

type BiquadCoeffs = { b0: number; b1: number; b2: number; a1: number; a2: number }

function peakingCoeffs(sampleRate: number, freq: number, q: number, gainDb: number): BiquadCoeffs {
	const A = 10 ** (gainDb / 40)
	const w0 = (2 * Math.PI * freq) / sampleRate
	const cosw0 = Math.cos(w0)
	const alpha = Math.sin(w0) / (2 * q)
	const a0 = 1 + alpha / A
	return {
		b0: (1 + alpha * A) / a0,
		b1: (-2 * cosw0) / a0,
		b2: (1 - alpha * A) / a0,
		a1: (-2 * cosw0) / a0,
		a2: (1 - alpha / A) / a0,
	}
}

function lowShelfCoeffs(sampleRate: number, freq: number, gainDb: number): BiquadCoeffs {
	const A = 10 ** (gainDb / 40)
	const w0 = (2 * Math.PI * freq) / sampleRate
	const cosw0 = Math.cos(w0)
	const alpha = (Math.sin(w0) / 2) * Math.sqrt(2)
	const twoSqrtAAlpha = 2 * Math.sqrt(A) * alpha
	const a0 = A + 1 + (A - 1) * cosw0 + twoSqrtAAlpha
	return {
		b0: (A * (A + 1 - (A - 1) * cosw0 + twoSqrtAAlpha)) / a0,
		b1: (2 * A * (A - 1 - (A + 1) * cosw0)) / a0,
		b2: (A * (A + 1 - (A - 1) * cosw0 - twoSqrtAAlpha)) / a0,
		a1: (-2 * (A - 1 + (A + 1) * cosw0)) / a0,
		a2: (A + 1 + (A - 1) * cosw0 - twoSqrtAAlpha) / a0,
	}
}

function highShelfCoeffs(sampleRate: number, freq: number, gainDb: number): BiquadCoeffs {
	const A = 10 ** (gainDb / 40)
	const w0 = (2 * Math.PI * freq) / sampleRate
	const cosw0 = Math.cos(w0)
	const alpha = (Math.sin(w0) / 2) * Math.sqrt(2)
	const twoSqrtAAlpha = 2 * Math.sqrt(A) * alpha
	const a0 = A + 1 - (A - 1) * cosw0 + twoSqrtAAlpha
	return {
		b0: (A * (A + 1 + (A - 1) * cosw0 + twoSqrtAAlpha)) / a0,
		b1: (-2 * A * (A - 1 + (A + 1) * cosw0)) / a0,
		b2: (A * (A + 1 + (A - 1) * cosw0 - twoSqrtAAlpha)) / a0,
		a1: (2 * (A - 1 - (A + 1) * cosw0)) / a0,
		a2: (A + 1 - (A - 1) * cosw0 - twoSqrtAAlpha) / a0,
	}
}

/**
 * Writes the filtered signal into `out` rather than returning a new array, so
 * a cascade of stages can ping-pong between two buffers instead of allocating
 * one per stage - and so the sample arrays keep a single concrete type all the
 * way through to `copyToChannel`.
 */
function runBiquad(data: Float32Array, coeffs: BiquadCoeffs, out: Float32Array): void {
	let x1 = 0
	let x2 = 0
	let y1 = 0
	let y2 = 0
	for (let i = 0; i < data.length; i++) {
		const x0 = data[i]
		const y0 = coeffs.b0 * x0 + coeffs.b1 * x1 + coeffs.b2 * x2 - coeffs.a1 * y1 - coeffs.a2 * y2
		out[i] = y0
		x2 = x1
		x1 = x0
		y2 = y1
		y1 = y0
	}
}

/**
 * Runs a cascade of biquads over one channel and hands back the result.
 *
 * The return type is pinned to `ArrayBuffer` rather than left as the default
 * `ArrayBufferLike`, because `copyToChannel` will not accept an array that
 * might be backed by a `SharedArrayBuffer`.
 */
function runCascade(source: Float32Array, stages: BiquadCoeffs[]): Float32Array<ArrayBuffer> {
	const work = new Float32Array(source)
	if (stages.length === 0) return work
	const scratch = new Float32Array(source.length)
	for (const stage of stages) {
		runBiquad(work, stage, scratch)
		work.set(scratch)
	}
	return work
}

export type EqualizerSettings = {
	/** all five in dB, -18..+18 */
	low: number
	lowMid: number
	mid: number
	highMid: number
	high: number
}

/** The five band centres, chosen to split the spectrum roughly evenly by ear. */
export const EQ_BANDS = [
	{ key: 'low', label: '80 Hz', freq: 80 },
	{ key: 'lowMid', label: '250 Hz', freq: 250 },
	{ key: 'mid', label: '1 kHz', freq: 1000 },
	{ key: 'highMid', label: '3.5 kHz', freq: 3500 },
	{ key: 'high', label: '10 kHz', freq: 10000 },
] as const

export function applyEqualizer(buffer: AudioBuffer, settings: EqualizerSettings): AudioBuffer {
	const out = cloneShape(buffer)
	const rate = buffer.sampleRate
	// The outer bands are shelves, not bells: a peaking filter at 80Hz leaves
	// everything below it untouched, which is not what a "low" control should
	// do on a mix that has content down to 30Hz.
	const stages: BiquadCoeffs[] = []
	if (settings.low !== 0) stages.push(lowShelfCoeffs(rate, 120, settings.low))
	if (settings.lowMid !== 0) stages.push(peakingCoeffs(rate, 250, 0.9, settings.lowMid))
	if (settings.mid !== 0) stages.push(peakingCoeffs(rate, 1000, 0.9, settings.mid))
	if (settings.highMid !== 0) stages.push(peakingCoeffs(rate, 3500, 0.9, settings.highMid))
	if (settings.high !== 0) stages.push(highShelfCoeffs(rate, 8000, settings.high))

	for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
		const data = runCascade(buffer.getChannelData(channel), stages)
		for (let i = 0; i < data.length; i++) data[i] = Math.max(-1, Math.min(1, data[i]))
		out.copyToChannel(data, channel)
	}
	return out
}

/* ---------------------------------------------------------- voice changer */

export type VoicePresetId = 'chipmunk' | 'deep' | 'robot' | 'telephone' | 'megaphone' | 'alien' | 'whisper' | 'cave' | 'radio'

export const VOICE_PRESETS: Array<{ id: VoicePresetId; label: string; blurb: string; semitones: number }> = [
	{ id: 'chipmunk', label: 'Chipmunk', blurb: 'Up seven semitones, thinned out underneath.', semitones: 7 },
	{ id: 'deep', label: 'Deep', blurb: 'Down six semitones with the chest weight put back.', semitones: -6 },
	{ id: 'robot', label: 'Robot', blurb: 'Ring modulation - a fixed carrier, so pitch stops meaning anything.', semitones: 0 },
	{ id: 'telephone', label: 'Telephone', blurb: 'Band-limited to 300-3400 Hz, the way a phone line is.', semitones: 0 },
	{ id: 'megaphone', label: 'Megaphone', blurb: 'Mid-forward, clipped, and shouting.', semitones: 0 },
	{ id: 'alien', label: 'Alien', blurb: 'Pitched up and ring-modulated at a slow rate.', semitones: 4 },
	{ id: 'whisper', label: 'Whisper', blurb: 'The tone replaced by shaped noise.', semitones: 0 },
	{ id: 'cave', label: 'Cave', blurb: 'Down a little, with a long dark tail behind it.', semitones: -3 },
	{ id: 'radio', label: 'Old radio', blurb: 'Narrow, crunchy, and slightly detuned.', semitones: 0 },
]

/** Multiplies the signal by a sine carrier - the classic robot voice. */
function ringModulate(buffer: AudioBuffer, frequency: number, depth: number): AudioBuffer {
	const out = cloneShape(buffer)
	const rate = buffer.sampleRate
	for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
		const data = buffer.getChannelData(channel)
		const modulated = new Float32Array(data.length)
		for (let i = 0; i < data.length; i++) {
			const carrier = Math.sin((2 * Math.PI * frequency * i) / rate)
			modulated[i] = data[i] * (1 - depth) + data[i] * carrier * depth
		}
		out.copyToChannel(modulated, channel)
	}
	return out
}

/** Replaces the voiced tone with noise that follows the original's envelope. */
function whisperize(buffer: AudioBuffer): AudioBuffer {
	const out = cloneShape(buffer)
	const window = Math.max(1, Math.round(buffer.sampleRate * 0.01))
	for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
		const data = buffer.getChannelData(channel)
		const shaped = new Float32Array(data.length)
		let envelope = 0
		let seed = 22222
		for (let i = 0; i < data.length; i++) {
			// A one-pole follower on the rectified signal: cheap, and all a
			// whisper needs is the shape of the loudness, not its content.
			envelope += (Math.abs(data[i]) - envelope) / window
			seed = (seed * 1664525 + 1013904223) >>> 0
			const noise = seed / 0x7fffffff - 1
			shaped[i] = Math.max(-1, Math.min(1, noise * envelope * 2.4))
		}
		out.copyToChannel(shaped, channel)
	}
	return out
}

function softClip(buffer: AudioBuffer, drive: number): AudioBuffer {
	const out = cloneShape(buffer)
	for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
		const data = buffer.getChannelData(channel)
		const shaped = new Float32Array(data.length)
		// tanh saturation: smooth, no aliasing spikes, and it never exceeds 1.
		for (let i = 0; i < data.length; i++) shaped[i] = Math.tanh(data[i] * drive) / Math.tanh(drive)
		out.copyToChannel(shaped, channel)
	}
	return out
}

function bandPass(buffer: AudioBuffer, lowHz: number, highHz: number): AudioBuffer {
	const out = cloneShape(buffer)
	const rate = buffer.sampleRate
	// A shelf pair rather than a true bandpass: two cascaded shelves with
	// heavy cut give the same audible narrowing with far gentler phase.
	const lowCut = lowShelfCoeffs(rate, lowHz, -22)
	const highCut = highShelfCoeffs(rate, highHz, -22)
	for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
		out.copyToChannel(runCascade(buffer.getChannelData(channel), [lowCut, highCut]), channel)
	}
	return out
}

/**
 * Builds a preset out of the pieces above.
 *
 * `shiftPitch` is injected rather than imported so this module does not
 * depend on the phase vocoder in `audio-ops.ts` - which keeps it importable
 * on its own, and keeps the two modules' responsibilities from tangling.
 */
export function applyVoicePreset(
	buffer: AudioBuffer,
	preset: VoicePresetId,
	shiftPitch: (input: AudioBuffer, semitones: number) => AudioBuffer,
): AudioBuffer {
	switch (preset) {
		case 'chipmunk':
			return applyEqualizer(shiftPitch(buffer, 7), { low: -8, lowMid: -3, mid: 2, highMid: 3, high: 2 })
		case 'deep':
			return applyEqualizer(shiftPitch(buffer, -6), { low: 5, lowMid: 3, mid: 0, highMid: -2, high: -3 })
		case 'robot':
			return ringModulate(buffer, 55, 0.92)
		case 'telephone':
			return softClip(bandPass(buffer, 300, 3400), 1.6)
		case 'megaphone':
			return softClip(applyEqualizer(bandPass(buffer, 500, 4000), { low: 0, lowMid: 0, mid: 8, highMid: 6, high: 0 }), 3.2)
		case 'alien':
			return ringModulate(shiftPitch(buffer, 4), 18, 0.7)
		case 'whisper':
			return whisperize(buffer)
		case 'cave':
			return applyReverb(shiftPitch(buffer, -3), { size: 0.92, damping: 0.75, wet: 0.6, preDelayMs: 40, width: 1 })
		case 'radio':
			return softClip(bandPass(buffer, 400, 3000), 2.4)
		default:
			return buffer
	}
}

/* ----------------------------------------------------------- beat detection */

export type BeatAnalysis = {
	/** onset times, in seconds */
	beats: number[]
	/** the tempo the spacing between them implies, or null when it is not steady */
	bpm: number | null
	/** how confident the tempo estimate is, 0-1 */
	confidence: number
}

/**
 * Energy-based onset detection.
 *
 * The signal is chopped into short frames; each frame's energy is compared
 * against the local average of the second around it, and a frame that is
 * sharply above its own neighbourhood is an onset. Comparing against a
 * *local* average rather than a fixed threshold is what makes it work on a
 * track that gets louder - a fixed threshold finds every beat in the chorus
 * and none in the verse.
 *
 * The tempo is then the most common gap between onsets, quantised into 5ms
 * bins so that beats which are a couple of milliseconds apart still land in
 * the same bucket.
 */
export function detectBeats(buffer: AudioBuffer, sensitivity: number): BeatAnalysis {
	const rate = buffer.sampleRate
	const frameSize = Math.max(64, Math.round(rate * 0.02))
	const frameCount = Math.floor(buffer.length / frameSize)
	if (frameCount < 8) return { beats: [], bpm: null, confidence: 0 }

	const energy = new Float32Array(frameCount)
	for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
		const data = buffer.getChannelData(channel)
		for (let frame = 0; frame < frameCount; frame++) {
			let sum = 0
			const start = frame * frameSize
			for (let i = 0; i < frameSize; i++) {
				const value = data[start + i]
				sum += value * value
			}
			energy[frame] += sum / frameSize
		}
	}

	// The window either side of a frame that counts as "local". One second is
	// the standard choice: long enough to average over a bar, short enough to
	// track a build.
	const window = Math.max(4, Math.round(rate / frameSize / 2))
	// 1.1 is barely above the local average and finds far too much; 2.2 finds
	// only the hardest hits. The slider runs between them.
	const factor = 2.2 - Math.min(1, Math.max(0, sensitivity)) * 1.1

	const beats: number[] = []
	let lastBeatFrame = -Infinity
	// Nothing under 120ms apart is two beats; it is one beat and its own decay.
	const minGap = Math.round(0.12 * (rate / frameSize))

	for (let frame = 1; frame < frameCount; frame++) {
		let sum = 0
		let count = 0
		for (let offset = -window; offset <= window; offset++) {
			const index = frame + offset
			if (index < 0 || index >= frameCount) continue
			sum += energy[index]
			count++
		}
		const local = sum / Math.max(1, count)
		if (energy[frame] > local * factor && energy[frame] > energy[frame - 1] && frame - lastBeatFrame >= minGap) {
			beats.push((frame * frameSize) / rate)
			lastBeatFrame = frame
		}
	}

	if (beats.length < 4) return { beats, bpm: null, confidence: 0 }

	const bins = new Map<number, number>()
	for (let i = 1; i < beats.length; i++) {
		const gap = beats[i] - beats[i - 1]
		if (gap < 0.25 || gap > 2) continue
		const bin = Math.round(gap / 0.005)
		bins.set(bin, (bins.get(bin) ?? 0) + 1)
	}
	let bestBin = 0
	let bestCount = 0
	for (const [bin, count] of bins) {
		if (count > bestCount) {
			bestCount = count
			bestBin = bin
		}
	}
	if (bestCount < 3) return { beats, bpm: null, confidence: 0 }

	const gap = bestBin * 0.005
	return {
		beats,
		bpm: Math.round(60 / gap),
		confidence: Math.min(1, bestCount / Math.max(1, beats.length - 1)),
	}
}
