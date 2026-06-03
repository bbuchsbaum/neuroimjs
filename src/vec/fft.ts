/**
 * Minimal real-input Discrete Fourier Transform helpers for temporal filtering.
 *
 * A naive O(n^2) DFT/IDFT is used. fMRI time series are typically short
 * (tens to a few hundred time points per voxel), so the O(n^2) cost is
 * acceptable and the implementation stays simple and correct for arbitrary
 * (non-power-of-2) lengths.
 */

/**
 * Forward DFT of a real-valued input signal.
 *
 * Returns the complex spectrum as separate real/imaginary arrays of length n,
 * where X[k] = sum_{t=0}^{n-1} x[t] * exp(-2*pi*i*k*t/n).
 */
export function dft(input: ArrayLike<number>): { re: Float64Array; im: Float64Array } {
  const n = input.length;
  const re = new Float64Array(n);
  const im = new Float64Array(n);

  for (let k = 0; k < n; k++) {
    let sumRe = 0;
    let sumIm = 0;
    const w = (-2 * Math.PI * k) / n;
    for (let t = 0; t < n; t++) {
      const angle = w * t;
      const x = input[t];
      sumRe += x * Math.cos(angle);
      sumIm += x * Math.sin(angle);
    }
    re[k] = sumRe;
    im[k] = sumIm;
  }

  return { re, im };
}

/**
 * Inverse DFT, returning the real part of the reconstructed signal.
 *
 * x[t] = (1/n) * sum_{k=0}^{n-1} X[k] * exp(+2*pi*i*k*t/n)
 *
 * Only the real component is returned, which is appropriate for filtering of
 * real-valued signals (the imaginary part is numerical noise once the spectrum
 * has been kept Hermitian-symmetric).
 */
export function idftReal(re: ArrayLike<number>, im: ArrayLike<number>): Float64Array {
  const n = re.length;
  const out = new Float64Array(n);

  for (let t = 0; t < n; t++) {
    let sumRe = 0;
    const w = (2 * Math.PI * t) / n;
    for (let k = 0; k < n; k++) {
      const angle = w * k;
      sumRe += re[k] * Math.cos(angle) - im[k] * Math.sin(angle);
    }
    out[t] = sumRe / n;
  }

  return out;
}

/**
 * Compute the physical frequency (in Hz) associated with DFT bin k for a signal
 * of length n sampled with the given sampling interval (TR, in seconds).
 *
 * Bins 0..floor(n/2) map to non-negative frequencies; bins above n/2 are the
 * mirror image (negative frequencies) and are assigned the magnitude of their
 * mirrored positive frequency so a symmetric band selection keeps the spectrum
 * Hermitian.
 */
export function binFrequencyHz(k: number, n: number, tr: number): number {
  const nyquistIndex = Math.floor(n / 2);
  const positiveK = k <= nyquistIndex ? k : n - k;
  return positiveK / (n * tr);
}
