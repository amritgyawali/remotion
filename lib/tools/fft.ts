/**
 * A small, self-contained FFT and the STFT scaffolding built on it.
 *
 * Two of the audio tools - spectral noise reduction and pitch shift - need to
 * look at a signal in the frequency domain, and neither is worth pulling in a
 * dependency for: an iterative radix-2 Cooley-Tukey transform is a couple of
 * dozen lines and, at the block sizes audio processing uses (1024-4096), it
 * is fast enough to run per-frame in a browser tab without a worker.
 *
 * Everything here is pure math over typed arrays - no DOM, no codec, so it is
 * exercised the same way whether it is called from a click handler or a test.
 */

export function isPowerOfTwo(n: number): boolean {
	return n > 0 && (n & (n - 1)) === 0
}

export function nextPowerOfTwo(n: number): number {
	let value = 1
	while (value < n) value *= 2
	return value
}

/**
 * In-place iterative Cooley-Tukey FFT (and, with `inverse`, the IFFT).
 *
 * `re`/`im` must both have a power-of-two length. The inverse transform
 * divides by N so it round-trips exactly - the caller never has to remember
 * to normalise.
 */
export function fft(re: Float64Array, im: Float64Array, inverse = false): void {
	const n = re.length
	if (n !== im.length || !isPowerOfTwo(n)) {
		throw new Error('fft() requires two equal-length, power-of-two arrays.')
	}
	if (n === 1) return

	// Bit-reversal permutation.
	for (let i = 1, j = 0; i < n; i++) {
		let bit = n >> 1
		for (; j & bit; bit >>= 1) j ^= bit
		j ^= bit
		if (i < j) {
			const tr = re[i]; re[i] = re[j]; re[j] = tr
			const ti = im[i]; im[i] = im[j]; im[j] = ti
		}
	}

	const sign = inverse ? 1 : -1
	for (let size = 2; size <= n; size *= 2) {
		const half = size / 2
		const angleStep = (sign * 2 * Math.PI) / size
		for (let start = 0; start < n; start += size) {
			for (let k = 0; k < half; k++) {
				const angle = angleStep * k
				const wr = Math.cos(angle)
				const wi = Math.sin(angle)
				const evenIndex = start + k
				const oddIndex = start + k + half
				const oddRe = re[oddIndex] * wr - im[oddIndex] * wi
				const oddIm = re[oddIndex] * wi + im[oddIndex] * wr
				re[oddIndex] = re[evenIndex] - oddRe
				im[oddIndex] = im[evenIndex] - oddIm
				re[evenIndex] += oddRe
				im[evenIndex] += oddIm
			}
		}
	}

	if (inverse) {
		for (let i = 0; i < n; i++) {
			re[i] /= n
			im[i] /= n
		}
	}
}

/** A periodic Hann window - the standard analysis window for an STFT. */
export function hannWindow(size: number): Float64Array {
	const window = new Float64Array(size)
	for (let i = 0; i < size; i++) {
		window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size)
	}
	return window
}

export type StftFrame = { magnitude: Float64Array; phase: Float64Array }

/**
 * Splits `signal` into overlapping, windowed frames and FFTs each one.
 *
 * `hopSize` is how far the window advances between frames; `fftSize` (a
 * power of two, `>= frameSize`) is what each frame is zero-padded to before
 * transforming, which is what gives spectral-subtraction and the phase
 * vocoder enough frequency resolution without needing a longer window.
 */
export function stft(signal: Float32Array, frameSize: number, hopSize: number, fftSize: number): StftFrame[] {
	const window = hannWindow(frameSize)
	const frames: StftFrame[] = []
	const re = new Float64Array(fftSize)
	const im = new Float64Array(fftSize)

	for (let start = 0; start + frameSize <= signal.length + hopSize; start += hopSize) {
		re.fill(0)
		im.fill(0)
		for (let i = 0; i < frameSize; i++) {
			const sampleIndex = start + i
			re[i] = sampleIndex < signal.length ? signal[sampleIndex] * window[i] : 0
		}
		fft(re, im, false)

		const half = fftSize / 2 + 1
		const magnitude = new Float64Array(half)
		const phase = new Float64Array(half)
		for (let i = 0; i < half; i++) {
			magnitude[i] = Math.hypot(re[i], im[i])
			phase[i] = Math.atan2(im[i], re[i])
		}
		frames.push({ magnitude, phase })
	}
	return frames
}

/** Rebuilds a real signal from STFT frames via inverse FFT and overlap-add. */
export function istft(frames: StftFrame[], frameSize: number, hopSize: number, fftSize: number, outputLength: number): Float32Array {
	const window = hannWindow(frameSize)
	const output = new Float64Array(outputLength + fftSize)
	const windowSum = new Float64Array(outputLength + fftSize)
	const re = new Float64Array(fftSize)
	const im = new Float64Array(fftSize)
	const half = fftSize / 2 + 1

	for (let f = 0; f < frames.length; f++) {
		const { magnitude, phase } = frames[f]
		re.fill(0)
		im.fill(0)
		for (let i = 0; i < half; i++) {
			re[i] = magnitude[i] * Math.cos(phase[i])
			im[i] = magnitude[i] * Math.sin(phase[i])
		}
		// Mirror the spectrum so the inverse transform of a real signal stays real.
		for (let i = 1; i < fftSize - half + 1; i++) {
			re[fftSize - i] = re[i]
			im[fftSize - i] = -im[i]
		}
		fft(re, im, true)

		const start = f * hopSize
		for (let i = 0; i < frameSize; i++) {
			const index = start + i
			if (index >= output.length) break
			output[index] += re[i] * window[i]
			windowSum[index] += window[i] * window[i]
		}
	}

	const result = new Float32Array(outputLength)
	for (let i = 0; i < outputLength; i++) {
		result[i] = windowSum[i] > 1e-8 ? output[i] / windowSum[i] : output[i]
	}
	return result
}
