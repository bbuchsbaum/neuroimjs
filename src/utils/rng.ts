/**
 * Seedable pseudo-random number generation.
 *
 * Analysis code that draws random numbers (random and bootstrap searchlights,
 * k-means initialisation, atlas colours) takes its numbers from a generator
 * created here, so results can be reproduced from a seed and do not depend on
 * global `Math.random` state.
 */

/** A source of uniform pseudo-random numbers in [0, 1). */
export type Rng = () => number;

/**
 * Options accepted by functions that draw random numbers.
 *
 * Pass `seed` for reproducible results, or `rng` to supply your own generator
 * (for example one shared across several calls). `rng` takes precedence over
 * `seed` when both are given.
 */
export interface RandomOptions {
  /** Seed for the built-in generator ({@link createRng}). */
  seed?: number;
  /** Custom generator returning uniform numbers in [0, 1). Overrides `seed`. */
  rng?: Rng;
}

/**
 * Create a seeded pseudo-random number generator (mulberry32).
 *
 * The same seed always yields the same sequence. The seed is reduced to an
 * unsigned 32-bit integer, so seeds that differ only above 2^32 or in their
 * fractional part give the same sequence.
 *
 * mulberry32 is fast and statistically adequate for resampling and
 * initialisation; it is not cryptographically secure.
 *
 * @param seed - Integer seed.
 * @returns A function returning uniform numbers in [0, 1).
 * @throws {RangeError} If `seed` is not a finite number.
 */
export function createRng(seed: number): Rng {
  if (typeof seed !== 'number' || !Number.isFinite(seed)) {
    throw new RangeError(`seed must be a finite number, got ${String(seed)}`);
  }
  let a = Math.trunc(seed) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Draw a fresh, unpredictable 32-bit seed from the platform's entropy source
 * (`crypto.getRandomValues`), falling back to `Math.random` where that is
 * unavailable.
 */
export function randomSeed(): number {
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint32Array) => Uint32Array } })
    .crypto;
  if (c && typeof c.getRandomValues === 'function') {
    return c.getRandomValues(new Uint32Array(1))[0];
  }
  return Math.floor(Math.random() * 4294967296);
}

/**
 * Resolve {@link RandomOptions} to a generator.
 *
 * Precedence: `options.rng`, then `options.seed`, then `defaultSeed`; when none
 * is given the generator is seeded from {@link randomSeed}, so successive calls
 * give different results.
 *
 * @param options - Caller's options.
 * @param defaultSeed - Seed to use when the caller gives neither `rng` nor `seed`.
 */
export function resolveRng(options: RandomOptions = {}, defaultSeed?: number): Rng {
  if (options.rng !== undefined) {
    if (typeof options.rng !== 'function') {
      throw new TypeError('rng must be a function returning numbers in [0, 1)');
    }
    return options.rng;
  }
  if (options.seed !== undefined) return createRng(options.seed);
  return createRng(defaultSeed ?? randomSeed());
}

/**
 * Draw a uniform integer index in [0, n) from `rng`.
 *
 * The generator's output is clamped to [0, 1) first, so a custom generator
 * that returns exactly 1 (or a value slightly outside the range) cannot index
 * outside the array.
 *
 * @throws {RangeError} If `n` is not a positive safe integer, or the generator
 *   returns a non-finite value.
 */
export function randomIndex(rng: Rng, n: number): number {
  if (!Number.isSafeInteger(n) || n < 1) {
    throw new RangeError(`n must be a positive integer, got ${String(n)}`);
  }
  const u = rng();
  if (typeof u !== 'number' || !Number.isFinite(u)) {
    throw new RangeError(`rng must return finite numbers in [0, 1), got ${String(u)}`);
  }
  const clamped = u < 0 ? 0 : u >= 1 ? 1 - Number.EPSILON / 2 : u;
  return Math.min(n - 1, Math.floor(clamped * n));
}
