/**
 * Backed plots: the data behind a map, shaped for plotting.
 *
 * A backing is a design table (one row per observation: subject, condition,
 * group, ...) whose rows each carry a value at every voxel, optionally along
 * one extra axis (FIR lags, basis coefficients). A probe picks voxels; the
 * backing returns one value (or one axis vector) per row, averaged over them.
 */
import type { NeuroSpace } from '../geometry/NeuroSpace';
import type { Probe } from './probe';

export type Value = string | number | null;
export type Row = Record<string, Value>;

export interface Column {
  name: string;
  /** A factor has levels; a numeric column is a covariate. */
  kind: 'factor' | 'numeric';
  /** NFTab semantic role: subject, group, condition, session, run, covariate, ... */
  role?: string;
  /** Level order for factors (declared order, else first seen). */
  levels?: string[];
  unit?: string;
}

/** The extra axis each row's value runs along, e.g. FIR lag. */
export interface Axis {
  name: string;
  values: number[];
  unit?: string;
  /**
   * When the axis holds basis coefficients (spline, multi-function HRF), the
   * curve they stand for: curve[t] = sum_b weights[t][b] * coef[b].
   */
  basis?: { name: string; values: number[]; unit?: string; weights: number[][] };
}

/** Where a map came from, when it was computed from this backing. */
export interface Provenance {
  /** What the map shows, e.g. "faces − houses, t". */
  map?: string;
  formula?: string;
  /** Named space of probe coordinates, e.g. "MNI152NLin2009cAsym". */
  space?: string;
}

/** Values at a probe: `values[row * width + a]` for axis position a. */
export interface Extract {
  label: string;
  voxels: number;
  width: number;
  values: Float32Array;
}

export interface Backing {
  readonly design: Row[];
  readonly columns: Column[];
  /** Column naming the subject; rows of one subject are never independent. */
  readonly subject?: string;
  readonly axis?: Axis;
  readonly space?: NeuroSpace;
  readonly provenance?: Provenance;
  /** What a value is, e.g. "β (% signal)". */
  readonly valueLabel?: string;
  extract(probe: Probe): Extract | Promise<Extract>;
  /**
   * The whole-grid map averaged over these design rows (and over the axis,
   * as the mean of the response it stands for), NaN where nothing is stored.
   * Optional: a backing that cannot afford it leaves it out.
   */
  mapOf?(rows: number[]): Float32Array | Promise<Float32Array>;
}
