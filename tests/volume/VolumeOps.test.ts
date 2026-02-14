import { describe, it, expect } from 'vitest';
import {
  addVol, subtractVol, multiplyVol, divideVol,
  greaterThan, lessThan, equalTo,
  negateVol, absVol, sqrtVol,
  sumVol, meanVol, minVol, maxVol,
  mapVol
} from '../../src/volume/VolumeOps';
import { FloatNeuroVol } from '../../src/volume/DenseNeuroVol';
import { NeuroSpace } from '../../src/geometry/NeuroSpace';

describe('VolumeOps', () => {
  const space = new NeuroSpace([4, 4, 4], [1, 1, 1], [0, 0, 0]);
  const n = 64;

  function makeVol(fill: number | ((i: number) => number)): FloatNeuroVol {
    const d = new Float32Array(n);
    if (typeof fill === 'number') d.fill(fill);
    else for (let i = 0; i < n; i++) d[i] = fill(i);
    return new FloatNeuroVol(space, d);
  }

  // --- Binary arithmetic ---

  describe('addVol', () => {
    it('adds two volumes element-wise', () => {
      const a = makeVol(3);
      const b = makeVol(7);
      const r = addVol(a, b);
      expect(r.getData()[0]).toBeCloseTo(10);
      expect(r.getData()[n - 1]).toBeCloseTo(10);
    });

    it('adds a scalar', () => {
      const a = makeVol(5);
      const r = addVol(a, 10);
      expect(r.getData()[0]).toBeCloseTo(15);
    });

    it('throws on dimension mismatch', () => {
      const a = makeVol(1);
      const otherSpace = new NeuroSpace([5, 4, 4], [1, 1, 1], [0, 0, 0]);
      const b = new FloatNeuroVol(otherSpace, new Float32Array(80));
      expect(() => addVol(a, b)).toThrow(/dimensions/i);
    });
  });

  describe('subtractVol', () => {
    it('subtracts element-wise', () => {
      const a = makeVol(10);
      const b = makeVol(3);
      const r = subtractVol(a, b);
      expect(r.getData()[0]).toBeCloseTo(7);
    });

    it('subtracts scalar', () => {
      const r = subtractVol(makeVol(10), 4);
      expect(r.getData()[0]).toBeCloseTo(6);
    });
  });

  describe('multiplyVol', () => {
    it('multiplies element-wise', () => {
      const a = makeVol(3);
      const b = makeVol(4);
      const r = multiplyVol(a, b);
      expect(r.getData()[0]).toBeCloseTo(12);
    });

    it('multiplies by scalar', () => {
      const r = multiplyVol(makeVol(5), 3);
      expect(r.getData()[0]).toBeCloseTo(15);
    });
  });

  describe('divideVol', () => {
    it('divides element-wise', () => {
      const a = makeVol(12);
      const b = makeVol(4);
      const r = divideVol(a, b);
      expect(r.getData()[0]).toBeCloseTo(3);
    });

    it('division by zero yields 0', () => {
      const a = makeVol(10);
      const b = makeVol(0);
      const r = divideVol(a, b);
      expect(r.getData()[0]).toBe(0);
    });

    it('divides by scalar', () => {
      const r = divideVol(makeVol(20), 5);
      expect(r.getData()[0]).toBeCloseTo(4);
    });

    it('divide by scalar 0 yields 0', () => {
      const r = divideVol(makeVol(10), 0);
      expect(r.getData()[0]).toBe(0);
    });
  });

  // --- Comparison ops ---

  describe('greaterThan', () => {
    it('compares vol > scalar', () => {
      const a = makeVol(i => i);
      const r = greaterThan(a, 32);
      expect(r.getData()[32]).toBe(0);
      expect(r.getData()[33]).toBe(1);
    });

    it('compares vol > vol', () => {
      const a = makeVol(10);
      const b = makeVol(5);
      const r = greaterThan(a, b);
      expect(r.getData()[0]).toBe(1);
    });
  });

  describe('lessThan', () => {
    it('compares vol < scalar', () => {
      const a = makeVol(i => i);
      const r = lessThan(a, 5);
      expect(r.getData()[4]).toBe(1);
      expect(r.getData()[5]).toBe(0);
    });
  });

  describe('equalTo', () => {
    it('exact equality', () => {
      const a = makeVol(5);
      const r = equalTo(a, 5);
      expect(r.getData()[0]).toBe(1);
    });

    it('tolerance-based equality', () => {
      const a = makeVol(5.001);
      const r = equalTo(a, 5, 0.01);
      expect(r.getData()[0]).toBe(1);
    });
  });

  // --- Unary ops ---

  describe('negateVol', () => {
    it('negates all values', () => {
      const r = negateVol(makeVol(3));
      expect(r.getData()[0]).toBeCloseTo(-3);
    });
  });

  describe('absVol', () => {
    it('takes absolute value', () => {
      const a = makeVol(-7);
      const r = absVol(a);
      expect(r.getData()[0]).toBeCloseTo(7);
    });
  });

  describe('sqrtVol', () => {
    it('takes sqrt (clamps negative to 0)', () => {
      const a = makeVol(9);
      expect(sqrtVol(a).getData()[0]).toBeCloseTo(3);
      const b = makeVol(-1);
      expect(sqrtVol(b).getData()[0]).toBeCloseTo(0);
    });
  });

  // --- Aggregation ---

  describe('aggregation', () => {
    it('sumVol', () => {
      const a = makeVol(2);
      expect(sumVol(a)).toBeCloseTo(n * 2);
    });

    it('meanVol', () => {
      const a = makeVol(i => i);
      expect(meanVol(a)).toBeCloseTo((n - 1) / 2);
    });

    it('minVol', () => {
      const a = makeVol(i => i + 1);
      expect(minVol(a)).toBeCloseTo(1);
    });

    it('maxVol', () => {
      const a = makeVol(i => i + 1);
      expect(maxVol(a)).toBeCloseTo(n);
    });
  });

  // --- mapVol ---

  describe('mapVol', () => {
    it('applies arbitrary function', () => {
      const a = makeVol(3);
      const r = mapVol(a, v => v * v);
      expect(r.getData()[0]).toBeCloseTo(9);
    });
  });

  // --- Chaining / compound expression ---

  describe('compound expression', () => {
    it('(a * b) + c works', () => {
      const a = makeVol(2);
      const b = makeVol(3);
      const r = addVol(multiplyVol(a, b), 1);
      expect(r.getData()[0]).toBeCloseTo(7);
    });
  });
});
