/**
 * Volume arithmetic operations for NeuroVol.
 *
 * Standalone functions that operate on any NeuroVol and return new volumes.
 * Matches neuroim2's Ops() group for vol+vol, vol+scalar, comparisons, etc.
 */

import { NeuroVol } from './NeuroVol';
import { FloatNeuroVol } from './DenseNeuroVol';
import { LogicalNeuroVol } from './LogicalNeuroVol';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function assertSameDims(a: NeuroVol, b: NeuroVol): void {
  const da = a.dim;
  const db = b.dim;
  if (da.length !== db.length || !da.every((d, i) => d === db[i])) {
    throw new Error(
      `Volume dimensions do not match: [${da}] vs [${db}]`
    );
  }
}

function isScalar(b: NeuroVol | number): b is number {
  return typeof b === 'number';
}

// ---------------------------------------------------------------------------
// Binary arithmetic
// ---------------------------------------------------------------------------

/**
 * Element-wise addition. `b` may be a volume (same dims) or a scalar.
 */
export function addVol(a: NeuroVol, b: NeuroVol | number): FloatNeuroVol {
  const ad = a.getData();
  const n = ad.length;
  const out = new Float32Array(n);

  if (isScalar(b)) {
    for (let i = 0; i < n; i++) out[i] = ad[i] + b;
  } else {
    assertSameDims(a, b);
    const bd = b.getData();
    for (let i = 0; i < n; i++) out[i] = ad[i] + bd[i];
  }
  return new FloatNeuroVol(a.space, out);
}

/**
 * Element-wise subtraction.
 */
export function subtractVol(a: NeuroVol, b: NeuroVol | number): FloatNeuroVol {
  const ad = a.getData();
  const n = ad.length;
  const out = new Float32Array(n);

  if (isScalar(b)) {
    for (let i = 0; i < n; i++) out[i] = ad[i] - b;
  } else {
    assertSameDims(a, b);
    const bd = b.getData();
    for (let i = 0; i < n; i++) out[i] = ad[i] - bd[i];
  }
  return new FloatNeuroVol(a.space, out);
}

/**
 * Element-wise multiplication.
 */
export function multiplyVol(a: NeuroVol, b: NeuroVol | number): FloatNeuroVol {
  const ad = a.getData();
  const n = ad.length;
  const out = new Float32Array(n);

  if (isScalar(b)) {
    for (let i = 0; i < n; i++) out[i] = ad[i] * b;
  } else {
    assertSameDims(a, b);
    const bd = b.getData();
    for (let i = 0; i < n; i++) out[i] = ad[i] * bd[i];
  }
  return new FloatNeuroVol(a.space, out);
}

/**
 * Element-wise division. Division by zero yields 0.
 */
export function divideVol(a: NeuroVol, b: NeuroVol | number): FloatNeuroVol {
  const ad = a.getData();
  const n = ad.length;
  const out = new Float32Array(n);

  if (isScalar(b)) {
    if (b === 0) {
      out.fill(0);
    } else {
      for (let i = 0; i < n; i++) out[i] = ad[i] / b;
    }
  } else {
    assertSameDims(a, b);
    const bd = b.getData();
    for (let i = 0; i < n; i++) out[i] = bd[i] !== 0 ? ad[i] / bd[i] : 0;
  }
  return new FloatNeuroVol(a.space, out);
}

// ---------------------------------------------------------------------------
// Comparison ops  (return LogicalNeuroVol)
// ---------------------------------------------------------------------------

export function greaterThan(a: NeuroVol, b: NeuroVol | number): LogicalNeuroVol {
  const ad = a.getData();
  const n = ad.length;
  const out = new Uint8Array(n);

  if (isScalar(b)) {
    for (let i = 0; i < n; i++) out[i] = ad[i] > b ? 1 : 0;
  } else {
    assertSameDims(a, b);
    const bd = b.getData();
    for (let i = 0; i < n; i++) out[i] = ad[i] > bd[i] ? 1 : 0;
  }
  return new LogicalNeuroVol(a.space, out);
}

export function lessThan(a: NeuroVol, b: NeuroVol | number): LogicalNeuroVol {
  const ad = a.getData();
  const n = ad.length;
  const out = new Uint8Array(n);

  if (isScalar(b)) {
    for (let i = 0; i < n; i++) out[i] = ad[i] < b ? 1 : 0;
  } else {
    assertSameDims(a, b);
    const bd = b.getData();
    for (let i = 0; i < n; i++) out[i] = ad[i] < bd[i] ? 1 : 0;
  }
  return new LogicalNeuroVol(a.space, out);
}

export function equalTo(
  a: NeuroVol,
  b: NeuroVol | number,
  tolerance: number = 0
): LogicalNeuroVol {
  const ad = a.getData();
  const n = ad.length;
  const out = new Uint8Array(n);

  if (isScalar(b)) {
    for (let i = 0; i < n; i++)
      out[i] = Math.abs(ad[i] - b) <= tolerance ? 1 : 0;
  } else {
    assertSameDims(a, b);
    const bd = b.getData();
    for (let i = 0; i < n; i++)
      out[i] = Math.abs(ad[i] - bd[i]) <= tolerance ? 1 : 0;
  }
  return new LogicalNeuroVol(a.space, out);
}

// ---------------------------------------------------------------------------
// Unary ops
// ---------------------------------------------------------------------------

export function negateVol(v: NeuroVol): FloatNeuroVol {
  const d = v.getData();
  const out = new Float32Array(d.length);
  for (let i = 0; i < d.length; i++) out[i] = -d[i];
  return new FloatNeuroVol(v.space, out);
}

export function absVol(v: NeuroVol): FloatNeuroVol {
  const d = v.getData();
  const out = new Float32Array(d.length);
  for (let i = 0; i < d.length; i++) out[i] = Math.abs(d[i]);
  return new FloatNeuroVol(v.space, out);
}

export function sqrtVol(v: NeuroVol): FloatNeuroVol {
  const d = v.getData();
  const out = new Float32Array(d.length);
  for (let i = 0; i < d.length; i++) out[i] = Math.sqrt(Math.max(0, d[i]));
  return new FloatNeuroVol(v.space, out);
}

// ---------------------------------------------------------------------------
// Aggregation (reduce to scalar)
// ---------------------------------------------------------------------------

export function sumVol(v: NeuroVol): number {
  const d = v.getData();
  let s = 0;
  for (let i = 0; i < d.length; i++) s += d[i];
  return s;
}

export function meanVol(v: NeuroVol): number {
  const d = v.getData();
  if (d.length === 0) return 0;
  let s = 0;
  for (let i = 0; i < d.length; i++) s += d[i];
  return s / d.length;
}

export function minVol(v: NeuroVol): number {
  const d = v.getData();
  let m = Infinity;
  for (let i = 0; i < d.length; i++) if (d[i] < m) m = d[i];
  return m;
}

export function maxVol(v: NeuroVol): number {
  const d = v.getData();
  let m = -Infinity;
  for (let i = 0; i < d.length; i++) if (d[i] > m) m = d[i];
  return m;
}

// ---------------------------------------------------------------------------
// Map arbitrary function
// ---------------------------------------------------------------------------

export function mapVol(v: NeuroVol, fn: (val: number) => number): FloatNeuroVol {
  const d = v.getData();
  const out = new Float32Array(d.length);
  for (let i = 0; i < d.length; i++) out[i] = fn(d[i]);
  return new FloatNeuroVol(v.space, out);
}
