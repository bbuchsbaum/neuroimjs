import { describe, it, expect } from 'vitest';
import { tQuantile, tPValue, fitLine } from '../../src/backed/stats';
import { summarise, long, variesWithin } from '../../src/backed/frame';
import { MemoryBacking } from '../../src/backed/MemoryBacking';
import { NeuroSpace } from '../../src/geometry/NeuroSpace';
import { voxel, sphere, probeIndices } from '../../src/backed/probe';
import type { Row } from '../../src/backed/types';

describe('t distribution', () => {
  it('matches R qt / pt', () => {
    expect(tQuantile(0.975, 9)).toBeCloseTo(2.262157, 5); // qt(.975, 9)
    expect(tQuantile(0.975, 1)).toBeCloseTo(12.7062, 3);
    expect(tQuantile(0.975, 100)).toBeCloseTo(1.983972, 5);
    expect(tPValue(2.5, 12)).toBeCloseTo(0.02788, 4); // 2 * pt(-2.5, 12)
  });
  it('fits a line', () => {
    const f = fitLine([1, 2, 3, 4], [2, 4, 6, 8.5]);
    expect(f.slope).toBeCloseTo(2.15, 6);
    expect(f.r).toBeGreaterThan(0.99);
  });
});

describe('summarise', () => {
  // Three subjects × two conditions, with big subject offsets.
  const rows: Row[] = [
    ['s1', 'a', 10], ['s1', 'b', 12], ['s2', 'a', 0], ['s2', 'b', 3], ['s3', 'a', 5], ['s3', 'b', 6],
  ].map(([subject, cond, value]) => ({ subject, cond, value }));

  it('between-subject interval is the t interval of subject cells', () => {
    const s = summarise(rows, { subject: 'subject', keys: ['cond'], error: 'between' });
    const a = s.cells.find((c) => c.key.cond === 'a')!;
    // mean 5, sd 5, n 3: half = qt(.975, 2) * 5 / sqrt(3)
    expect(a.mean).toBeCloseTo(5, 10);
    expect(a.hi - a.mean).toBeCloseTo((4.302653 * 5) / Math.sqrt(3), 4);
  });

  it('within-subject interval removes subject offsets (Cousineau–Morey)', () => {
    const s = summarise(rows, { subject: 'subject', keys: ['cond'], within: ['cond'], error: 'within' });
    expect(s.error).toBe('within');
    const a = s.cells.find((c) => c.key.cond === 'a')!;
    // Differences b−a: 2, 3, 1 → normalized a values: 6 − 1 = ... computed by hand:
    // subject means 11, 1.5, 5.5; grand 6. a normalized: 5, 4.5, 5.5 → sd 0.5
    const half = (4.302653 * 0.5 * Math.sqrt(2)) / Math.sqrt(3);
    expect(a.hi - a.mean).toBeCloseTo(half, 4);
  });

  it('averages runs within subject before counting subjects', () => {
    const r2 = rows.flatMap((r) => [{ ...r, run: 1 }, { ...r, run: 2, value: (r.value as number) + 1 }]);
    const s = summarise(r2, { subject: 'subject', keys: ['cond'], error: 'between' });
    expect(s.cells.every((c) => c.n === 3)).toBe(true);
    expect(s.cells.find((c) => c.key.cond === 'a')!.mean).toBeCloseTo(5.5, 10);
  });

  it('keeps every subject in the means when one lacks a within cell', () => {
    const r4 = [...rows, { subject: 's4', cond: 'a', value: 100 }];
    const s = summarise(r4, { subject: 'subject', keys: ['cond'], within: ['cond'], error: 'within' });
    const a = s.cells.find((c) => c.key.cond === 'a')!;
    expect(s.incomplete).toEqual(['s4']);
    expect(a.n).toBe(4);
    expect(a.mean).toBeCloseTo(115 / 4, 10);
    // the interval still comes from the three complete subjects
    expect(a.hi - a.mean).toBeCloseTo((4.302653 * 0.5 * Math.sqrt(2)) / Math.sqrt(3), 4);
  });

  it('knows what varies within subject', () => {
    expect(variesWithin(rows, 'subject', 'cond')).toBe(true);
    expect(variesWithin(rows.map((r) => ({ ...r, g: r.subject === 's1' ? 'x' : 'y' })), 'subject', 'g')).toBe(false);
  });
});

describe('MemoryBacking', () => {
  const space = new NeuroSpace([3, 3, 3], [2, 2, 2], [-2, -2, -2]);
  const design = [{ subject: 's1' }, { subject: 's2' }];
  const data = design.map((_, r) => Float32Array.from({ length: 27 }, (_, i) => i + 100 * r));

  it('reads one voxel and averages a sphere', () => {
    const b = new MemoryBacking({ space, design, data });
    expect(probeIndices(voxel([0, 0, 0]), space)).toEqual([13]);
    expect(Array.from(b.extract(voxel([0, 0, 0])).values)).toEqual([13, 113]);
    const e = b.extract(sphere([0, 0, 0], 2));
    expect(e.voxels).toBe(7);
    expect(e.values[0]).toBeCloseTo(13, 5);
  });

  it('reconstructs basis curves', () => {
    const b = new MemoryBacking({
      space, design, data: design.map(() => Float32Array.from({ length: 54 }, (_, i) => (i % 2 ? 2 : 1))),
      axis: { name: 'basis', values: [1, 2], basis: { name: 't', values: [0, 1], weights: [[1, 0], [1, 1]] } },
    });
    const rows = long(b, b.extract(voxel([0, 0, 0])));
    expect(rows.map((r) => r.value)).toEqual([1, 3, 1, 3]);
  });
});
