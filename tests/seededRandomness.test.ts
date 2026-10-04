/**
 * Randomness in analysis/atlas code comes from a seedable generator
 * (src/utils/rng.ts) instead of Math.random.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRng, resolveRng, randomIndex } from '../src/utils/rng';
import { randomSearchlight, bootstrapSearchlight } from '../src/searchlight/searchlight';
import { NeuroAtlas, GLASSER_DEFAULT_COLOR_SEED } from '../src/atlas/NeuroAtlas';
import { NeuroSpace } from '../src/geometry/NeuroSpace';
import { LogicalNeuroVol } from '../src/volume/LogicalNeuroVol';
import type { ROIVolWindow } from '../src/roi/ROI_improved';
import { useSyntheticAtlasDownloads } from './helpers/syntheticAtlas';

afterEach(() => {
  vi.restoreAllMocks();
});

function cubeMask(): LogicalNeuroVol {
  const space = new NeuroSpace([12, 12, 12], [1, 1, 1], [0, 0, 0]);
  const mask = new LogicalNeuroVol(space);
  const data = mask.getData() as Uint8Array;
  for (let z = 2; z < 10; z++) {
    for (let y = 2; y < 10; y++) {
      for (let x = 2; x < 10; x++) data[space.gridToIndex([x, y, z])] = 1;
    }
  }
  return mask;
}

/** A searchlight run as a comparable value: each window's voxel list. */
function signature(windows: ROIVolWindow[]): string {
  return windows.map(w => w.coords.map(c => c.join(',')).join(';')).join('|');
}

describe('createRng', () => {
  it('gives the same sequence for the same seed and differs across seeds', () => {
    const a = createRng(42);
    const b = createRng(42);
    const c = createRng(43);
    const sa = Array.from({ length: 20 }, a);
    const sb = Array.from({ length: 20 }, b);
    const sc = Array.from({ length: 20 }, c);
    expect(sa).toEqual(sb);
    expect(sa).not.toEqual(sc);
  });

  it('returns numbers in [0, 1)', () => {
    const r = createRng(7);
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < 10000; i++) {
      const v = r();
      if (v < min) min = v;
      if (v > max) max = v;
    }
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeLessThan(1);
  });

  it('matches the mulberry32 reference sequence used by partition()', () => {
    // First outputs of mulberry32(1), as produced by the generator previously
    // private to stats.ts; partition() results depend on this sequence.
    const r = createRng(1);
    expect(r()).toBe(0.6270739405881613);
    expect(r()).toBe(0.002735721180215478);
  });

  it('rejects non-finite seeds', () => {
    expect(() => createRng(Number.NaN)).toThrow(RangeError);
    expect(() => createRng(Infinity)).toThrow(RangeError);
  });

  it('resolveRng prefers rng over seed over the default seed', () => {
    const custom = () => 0.5;
    expect(resolveRng({ rng: custom, seed: 1 })).toBe(custom);
    expect(resolveRng({ seed: 9 })()).toBe(createRng(9)());
    expect(resolveRng({}, 5)()).toBe(createRng(5)());
    expect(() => resolveRng({ rng: 3 as never })).toThrow(TypeError);
  });

  it('randomIndex stays in range even when the generator returns 1', () => {
    expect(randomIndex(() => 1, 4)).toBe(3);
    expect(randomIndex(() => 0, 4)).toBe(0);
  });

  it('randomIndex clamps out-of-range generator output on both ends', () => {
    expect(randomIndex(() => -0.25, 4)).toBe(0);
    expect(randomIndex(() => 1.5, 4)).toBe(3);
    expect(randomIndex(() => 0.999999, 1)).toBe(0);
  });

  it('randomIndex rejects an empty range and non-finite generator output', () => {
    expect(() => randomIndex(() => 0.5, 0)).toThrow(RangeError);
    expect(() => randomIndex(() => 0.5, -2)).toThrow(RangeError);
    expect(() => randomIndex(() => 0.5, 2.5)).toThrow(RangeError);
    expect(() => randomIndex(() => Number.NaN, 4)).toThrow(RangeError);
  });

  it('a searchlight driven by a misbehaving rng stays in the mask', () => {
    const mask = cubeMask();
    const windows = bootstrapSearchlight(mask, 1, 5, { rng: () => 1 });
    expect(windows).toHaveLength(5);
  });
});

describe('randomSearchlight seeding', () => {
  it('same seed gives identical searchlights', () => {
    const mask = cubeMask();
    expect(signature(randomSearchlight(mask, 2, { seed: 11 }))).toBe(
      signature(randomSearchlight(mask, 2, { seed: 11 }))
    );
  });

  it('different seeds give different searchlights', () => {
    const mask = cubeMask();
    expect(signature(randomSearchlight(mask, 2, { seed: 11 }))).not.toBe(
      signature(randomSearchlight(mask, 2, { seed: 12 }))
    );
  });

  it('a custom rng drives center selection', () => {
    const mask = cubeMask();
    expect(signature(randomSearchlight(mask, 2, { rng: createRng(3) }))).toBe(
      signature(randomSearchlight(mask, 2, { seed: 3 }))
    );
  });

  it('does not use Math.random, and unseeded calls differ', () => {
    const spy = vi.spyOn(Math, 'random');
    const mask = cubeMask();
    randomSearchlight(mask, 2, { seed: 1 });
    expect(spy).not.toHaveBeenCalled();
    // Unseeded: fresh entropy per call (crypto), so two runs differ.
    expect(signature(randomSearchlight(mask, 2))).not.toBe(signature(randomSearchlight(mask, 2)));
  });
});

describe('bootstrapSearchlight seeding', () => {
  it('same seed gives identical samples', () => {
    const mask = cubeMask();
    expect(signature(bootstrapSearchlight(mask, 2, 50, { seed: 5 }))).toBe(
      signature(bootstrapSearchlight(mask, 2, 50, { seed: 5 }))
    );
  });

  it('different seeds give different samples', () => {
    const mask = cubeMask();
    expect(signature(bootstrapSearchlight(mask, 2, 50, { seed: 5 }))).not.toBe(
      signature(bootstrapSearchlight(mask, 2, 50, { seed: 6 }))
    );
  });

  it('does not use Math.random, and unseeded calls differ', () => {
    const spy = vi.spyOn(Math, 'random');
    const mask = cubeMask();
    bootstrapSearchlight(mask, 2, 50, { seed: 5 });
    expect(spy).not.toHaveBeenCalled();
    expect(signature(bootstrapSearchlight(mask, 2, 50))).not.toBe(
      signature(bootstrapSearchlight(mask, 2, 50))
    );
  });
});

describe('Glasser atlas colours', () => {
  // Colours do not depend on the grid; a small one keeps these loads fast.
  beforeEach(() => {
    useSyntheticAtlasDownloads({ grid: 'small' });
  });

  it('same seed gives identical colours', async () => {
    const a = await NeuroAtlas.loadGlasserAtlas({ seed: 21 });
    const b = await NeuroAtlas.loadGlasserAtlas({ seed: 21, useCache: false });
    expect(a.cmap).toEqual(b.cmap);
  }, 30000);

  it('different seeds give different colours', async () => {
    const a = await NeuroAtlas.loadGlasserAtlas({ seed: 21 });
    const b = await NeuroAtlas.loadGlasserAtlas({ seed: 22 });
    expect(a.cmap).not.toEqual(b.cmap);
  }, 30000);

  it('defaults to a fixed documented seed, including the boolean signature', async () => {
    const spy = vi.spyOn(Math, 'random');
    const byDefault = await NeuroAtlas.loadGlasserAtlas();
    const byBoolean = await NeuroAtlas.loadGlasserAtlas(true);
    const explicit = await NeuroAtlas.loadGlasserAtlas({ seed: GLASSER_DEFAULT_COLOR_SEED });
    expect(byDefault.cmap).toEqual(explicit.cmap);
    expect(byBoolean.cmap).toEqual(explicit.cmap);
    expect(spy).not.toHaveBeenCalled();
  }, 30000);

  it('a custom rng sets the colours', async () => {
    const atlas = await NeuroAtlas.loadGlasserAtlas({ rng: () => 0.5 });
    expect(atlas.cmap[0]).toEqual([127.5, 127.5, 127.5]);
  }, 30000);
});
