/** A backing held in memory: every row's in-mask values, read at any probe instantly. */
import type { NeuroSpace } from '../geometry/NeuroSpace';
import type { Axis, Backing, Column, Extract, Provenance, Row } from './types';
import { type Probe, probeIndices, probeLabel } from './probe';

export interface MemoryBackingOptions {
  space: NeuroSpace;
  design: Row[];
  /** Linear grid indices of stored voxels; all voxels when omitted. */
  mask?: ArrayLike<number>;
  /** One array per row: `values[m * width + a]` for mask position m, axis position a. */
  data: Float32Array[];
  axis?: Axis;
  columns?: Column[];
  subject?: string;
  provenance?: Provenance;
  valueLabel?: string;
}

const FACTOR_ROLES = new Set(['subject', 'group', 'condition', 'session', 'run', 'contrast', 'site']);

/** Column kinds and level order, from the design when not declared. */
export function inferColumns(design: Row[], declared: Column[] = []): Column[] {
  const names = [...new Set(design.flatMap((r) => Object.keys(r)))];
  return names.map((name) => {
    const d = declared.find((c) => c.name === name);
    const vals = design.map((r) => r[name]).filter((v) => v != null);
    const numeric = vals.every((v) => typeof v === 'number');
    const kind = d?.kind ?? (numeric && !FACTOR_ROLES.has(d?.role ?? '') ? 'numeric' : 'factor');
    const levels = kind === 'factor' ? (d?.levels ?? [...new Set(vals.map(String))]) : undefined;
    return { ...d, name, kind, levels };
  });
}

export class MemoryBacking implements Backing {
  readonly design: Row[];
  readonly columns: Column[];
  readonly subject?: string;
  readonly axis?: Axis;
  readonly space: NeuroSpace;
  readonly provenance?: Provenance;
  readonly valueLabel?: string;
  private readonly data: Float32Array[];
  private readonly width: number;
  private readonly gridToMask: Int32Array | null;

  constructor(o: MemoryBackingOptions) {
    this.space = o.space;
    this.design = o.design;
    this.axis = o.axis;
    this.provenance = o.provenance;
    this.valueLabel = o.valueLabel;
    this.data = o.data;
    this.width = o.axis ? o.axis.values.length : 1;
    if (o.data.length !== o.design.length) throw new Error('one data array per design row is required');
    this.columns = inferColumns(o.design, o.columns);
    this.subject = o.subject ?? this.columns.find((c) => c.role === 'subject')?.name ??
      (this.columns.some((c) => c.name === 'subject') ? 'subject' : undefined);
    if (o.mask) {
      const n = (o.space.dim as number[]).slice(0, 3).reduce((a, b) => a * b, 1);
      this.gridToMask = new Int32Array(n).fill(-1);
      for (let m = 0; m < o.mask.length; m++) this.gridToMask[o.mask[m]] = m;
    } else this.gridToMask = null;
  }

  extract(probe: Probe): Extract {
    const at = probeIndices(probe, this.space)
      .map((g) => (this.gridToMask ? this.gridToMask[g] : g))
      .filter((m) => m >= 0);
    const w = this.width;
    const values = new Float32Array(this.design.length * w).fill(NaN);
    if (at.length) {
      this.data.forEach((d, r) => {
        for (let a = 0; a < w; a++) {
          let s = 0, n = 0;
          for (const m of at) {
            const v = d[m * w + a];
            if (Number.isFinite(v)) { s += v; n++; }
          }
          values[r * w + a] = n ? s / n : NaN;
        }
      });
    }
    return { label: probeLabel(probe), voxels: at.length, width: w, values };
  }
}
