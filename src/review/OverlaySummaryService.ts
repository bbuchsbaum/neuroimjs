import { Float32NeuroVec, Float64NeuroVec, NeuroVec } from '../vec/NeuroVec';
import { Float64NeuroVol } from '../volume/DenseNeuroVol';
import { NeuroVol } from '../volume/NeuroVol';
import { TypedArray, ValueError } from '../types';

export type StatisticalNeuroVec = NeuroVec<TypedArray>;
export type PairedDifferenceNeuroVec = Float32NeuroVec | Float64NeuroVec;
export type OverlaySummaryCachePolicy = 'none' | 'assume-immutable';

export interface OverlaySummaryServiceOptions {
  /**
   * Caching is disabled by default because NeuroVec exposes mutable backing
   * arrays. Opt in only when the source data will remain immutable for the
   * lifetime of this service.
   */
  cache?: OverlaySummaryCachePolicy;
}

export interface SufficientStats {
  readonly source: StatisticalNeuroVec;
  readonly subjectIndices: readonly number[];
  readonly spatialSize: number;
  readonly n: number;
  readonly count: Uint32Array;
  readonly sum: Float64Array;
  /** Numerically stable compensated mean for each voxel. */
  readonly mean: Float64Array;
  /** Sum of squared deviations from the running mean (Welford M2). */
  readonly m2: Float64Array;
}

export interface ConsistencyOptions {
  /** Symmetric absolute cutoff. Positive values >= cutoff and negative values <= -cutoff are suprathreshold. */
  cutoff: number;
  output?: 'proportion' | 'count';
}

function spatialSize(vec: StatisticalNeuroVec): number {
  return vec.dim[0] * vec.dim[1] * vec.dim[2];
}

function allSubjectIndices(vec: StatisticalNeuroVec): number[] {
  return Array.from({ length: vec.dim[3] }, (_, i) => i);
}

function validateSubjectIndices(vec: StatisticalNeuroVec, subjectIndices: readonly number[]): void {
  if (subjectIndices.length === 0) {
    throw new ValueError('At least one subject index is required');
  }

  const seen = new Set<number>();
  subjectIndices.forEach((index) => {
    if (!Number.isInteger(index) || index < 0 || index >= vec.dim[3]) {
      throw new ValueError(`Subject index ${index} is out of range 0..${vec.dim[3] - 1}`);
    }
    if (seen.has(index)) {
      throw new ValueError(`Duplicate subject index: ${index}`);
    }
    seen.add(index);
  });
}

function assertVolumeCompatibleWithStats(volume: NeuroVol, stats: SufficientStats): void {
  if (
    volume.dim[0] !== stats.source.dim[0] ||
    volume.dim[1] !== stats.source.dim[1] ||
    volume.dim[2] !== stats.source.dim[2] ||
    !volume.space.isSpatiallyCompatibleWith(stats.source.space)
  ) {
    throw new ValueError('Held-out volume geometry does not match sufficient stats source');
  }
}

function assertCompatibleVecs(
  a: StatisticalNeuroVec,
  b: StatisticalNeuroVec,
  label = 'NeuroVec'
): void {
  if (
    a.dim.length !== 4 ||
    b.dim.length !== 4 ||
    a.dim[0] !== b.dim[0] ||
    a.dim[1] !== b.dim[1] ||
    a.dim[2] !== b.dim[2] ||
    a.dim[3] !== b.dim[3] ||
    !a.space.isSpatiallyCompatibleWith(b.space)
  ) {
    throw new ValueError(`${label} geometry mismatch`);
  }
}

function assertStatsMatchVec(stats: SufficientStats, vec: StatisticalNeuroVec): void {
  if (stats.source !== vec) {
    throw new ValueError('Sufficient stats source does not match requested NeuroVec');
  }

  if (
    stats.spatialSize !== spatialSize(vec) ||
    stats.count.length !== stats.spatialSize ||
    stats.sum.length !== stats.spatialSize ||
    stats.mean.length !== stats.spatialSize ||
    stats.m2.length !== stats.spatialSize
  ) {
    throw new ValueError('Sufficient stats shape does not match requested NeuroVec');
  }
}

function assertStatsSubjectIndices(
  stats: SufficientStats,
  subjectIndices: readonly number[]
): void {
  if (
    stats.subjectIndices.length !== subjectIndices.length ||
    stats.subjectIndices.some((index, i) => index !== subjectIndices[i])
  ) {
    throw new ValueError('Sufficient stats subject indices do not match requested subjects');
  }
}

function sampleVariance(m2: number, count: number): number {
  if (count <= 1) return NaN;
  const variance = m2 / (count - 1);
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(m2)) * 16;
  return variance < 0 && variance >= -tolerance ? 0 : variance;
}

function statsOutput(
  stats: SufficientStats,
  fn: (i: number, count: number) => number
): Float64NeuroVol {
  const out = new Float64Array(stats.spatialSize);
  for (let i = 0; i < stats.spatialSize; i++) {
    out[i] = fn(i, stats.count[i]);
  }
  return new Float64NeuroVol(stats.source.getVolume(0).space, out);
}

export function computeSufficientStats(
  vec: StatisticalNeuroVec,
  subjectIndices: readonly number[] = allSubjectIndices(vec)
): SufficientStats {
  validateSubjectIndices(vec, subjectIndices);

  const nVoxels = spatialSize(vec);
  const data = vec.getData();
  const count = new Uint32Array(nVoxels);
  const sum = new Float64Array(nVoxels);
  const sumCompensation = new Float64Array(nVoxels);
  const mean = new Float64Array(nVoxels);
  const m2 = new Float64Array(nVoxels);

  // First pass: Neumaier compensated sums. Unlike sum-of-squares, this remains
  // accurate when values have a very large common offset and tiny variation.
  for (const subjectIndex of subjectIndices) {
    const offset = subjectIndex * nVoxels;
    for (let i = 0; i < nVoxels; i++) {
      const value = data[offset + i];
      if (!Number.isFinite(value)) continue;
      const previous = sum[i];
      const next = previous + value;
      sumCompensation[i] += Math.abs(previous) >= Math.abs(value)
        ? (previous - next) + value
        : (value - next) + previous;
      sum[i] = next;
      count[i]++;
    }
  }

  for (let i = 0; i < nVoxels; i++) {
    sum[i] += sumCompensation[i];
    mean[i] = count[i] > 0 ? sum[i] / count[i] : 0;
  }

  // Second pass: squared deviations around the compensated mean. This avoids
  // catastrophic cancellation from E[x^2] - E[x]^2.
  const m2Compensation = new Float64Array(nVoxels);
  for (const subjectIndex of subjectIndices) {
    const offset = subjectIndex * nVoxels;
    for (let i = 0; i < nVoxels; i++) {
      const value = data[offset + i];
      if (!Number.isFinite(value)) continue;
      const squaredDeviation = (value - mean[i]) ** 2;
      const previous = m2[i];
      const next = previous + squaredDeviation;
      m2Compensation[i] += Math.abs(previous) >= Math.abs(squaredDeviation)
        ? (previous - next) + squaredDeviation
        : (squaredDeviation - next) + previous;
      m2[i] = next;
    }
  }

  for (let i = 0; i < nVoxels; i++) m2[i] += m2Compensation[i];

  return {
    source: vec,
    subjectIndices: subjectIndices.slice(),
    spatialSize: nVoxels,
    n: subjectIndices.length,
    count,
    sum,
    mean,
    m2,
  };
}

/**
 * Low-level arithmetic helper that subtracts one volume from a stats object.
 *
 * Prefer {@link subtractSubjectFromStats} when subtracting a known subject from
 * the source NeuroVec. This function cannot infer subject membership from an
 * arbitrary volume, so returned subject metadata is unchanged.
 */
export function subtractVolumeFromStats(stats: SufficientStats, volume: NeuroVol): SufficientStats {
  assertVolumeCompatibleWithStats(volume, stats);

  const count = new Uint32Array(stats.count);
  const sum = new Float64Array(stats.sum);
  const mean = new Float64Array(stats.mean);
  const m2 = new Float64Array(stats.m2);
  const heldOutData = volume.getData();

  for (let i = 0; i < stats.spatialSize; i++) {
    const value = heldOutData[i];
    if (!Number.isFinite(value)) continue;
    const oldCount = count[i];
    if (oldCount === 0) continue;

    if (oldCount === 1) {
      count[i] = 0;
      sum[i] = 0;
      mean[i] = 0;
      m2[i] = 0;
      continue;
    }

    const oldMean = mean[i];
    const nextCount = oldCount - 1;
    const nextSum = sum[i] - value;
    const nextMean = nextSum / nextCount;
    const nextM2 = m2[i] - (value - oldMean) * (value - nextMean);
    count[i] = nextCount;
    sum[i] = nextSum;
    mean[i] = nextMean;
    const tolerance = Number.EPSILON * Math.max(1, Math.abs(m2[i])) * 32;
    m2[i] = nextM2 < 0 && nextM2 >= -tolerance ? 0 : nextM2;
  }

  return {
    ...stats,
    n: Math.max(0, stats.n - 1),
    count,
    sum,
    mean,
    m2,
  };
}

export function subtractSubjectFromStats(stats: SufficientStats, subjectIndex: number): SufficientStats {
  validateSubjectIndices(stats.source, [subjectIndex]);
  if (!stats.subjectIndices.includes(subjectIndex)) {
    throw new ValueError(`Subject index ${subjectIndex} is not included in the stats set`);
  }

  const nextStats = subtractVolumeFromStats(stats, stats.source.getVolume(subjectIndex));
  const subjectIndices = stats.subjectIndices.filter((index) => index !== subjectIndex);

  return {
    ...nextStats,
    subjectIndices,
    n: subjectIndices.length,
  };
}

export function meanVolume(stats: SufficientStats): Float64NeuroVol {
  return statsOutput(stats, (i, count) => (count > 0 ? stats.mean[i] : NaN));
}

export function standardDeviationVolume(stats: SufficientStats): Float64NeuroVol {
  return statsOutput(stats, (i, count) => {
    const variance = sampleVariance(stats.m2[i], count);
    return Number.isFinite(variance) ? Math.sqrt(Math.max(variance, 0)) : NaN;
  });
}

export function effectVolume(stats: SufficientStats): Float64NeuroVol {
  return statsOutput(stats, (i, count) => {
    const variance = sampleVariance(stats.m2[i], count);
    if (!Number.isFinite(variance) || variance <= 0) return NaN;
    return stats.mean[i] / Math.sqrt(variance);
  });
}

export function oneSampleTVolume(stats: SufficientStats): Float64NeuroVol {
  return statsOutput(stats, (i, count) => {
    const variance = sampleVariance(stats.m2[i], count);
    if (!Number.isFinite(variance) || variance <= 0) return NaN;
    return stats.mean[i] / Math.sqrt(variance / count);
  });
}

export function differenceOfMeansVolume(
  groupA: SufficientStats,
  groupB: SufficientStats
): Float64NeuroVol {
  assertCompatibleStats(groupA, groupB);
  return statsOutput(groupA, (i) => {
    const countA = groupA.count[i];
    const countB = groupB.count[i];
    if (countA === 0 || countB === 0) return NaN;
    return groupA.mean[i] - groupB.mean[i];
  });
}

export function welchTVolume(groupA: SufficientStats, groupB: SufficientStats): Float64NeuroVol {
  assertCompatibleStats(groupA, groupB);
  return statsOutput(groupA, (i) => {
    const countA = groupA.count[i];
    const countB = groupB.count[i];
    if (countA <= 1 || countB <= 1) return NaN;

    const varA = sampleVariance(groupA.m2[i], countA);
    const varB = sampleVariance(groupB.m2[i], countB);
    const denom = Math.sqrt(varA / countA + varB / countB);
    if (!Number.isFinite(denom) || denom <= 0) return NaN;

    return (groupA.mean[i] - groupB.mean[i]) / denom;
  });
}

export function pairedDifferenceVec(
  minuend: StatisticalNeuroVec,
  subtrahend: StatisticalNeuroVec,
  subjectIndices: readonly number[] = allSubjectIndices(minuend)
): PairedDifferenceNeuroVec {
  assertCompatibleVecs(minuend, subtrahend, 'Paired contrast');
  validateSubjectIndices(minuend, subjectIndices);

  const nVoxels = spatialSize(minuend);
  const dataA = minuend.getData();
  const dataB = subtrahend.getData();
  const useFloat32 = dataA instanceof Float32Array && dataB instanceof Float32Array;
  const out = useFloat32
    ? new Float32Array(nVoxels * subjectIndices.length)
    : new Float64Array(nVoxels * subjectIndices.length);

  subjectIndices.forEach((subjectIndex, outSubjectIndex) => {
    const sourceOffset = subjectIndex * nVoxels;
    const outOffset = outSubjectIndex * nVoxels;
    for (let i = 0; i < nVoxels; i++) {
      out[outOffset + i] = dataA[sourceOffset + i] - dataB[sourceOffset + i];
    }
  });

  const space = minuend.space.withDimensions([
    minuend.dim[0],
    minuend.dim[1],
    minuend.dim[2],
    subjectIndices.length,
  ]);

  return useFloat32
    ? new Float32NeuroVec(space, out as Float32Array)
    : new Float64NeuroVec(space, out as Float64Array);
}

export function pairedDifferenceStats(
  minuend: StatisticalNeuroVec,
  subtrahend: StatisticalNeuroVec,
  subjectIndices?: readonly number[]
): SufficientStats {
  return computeSufficientStats(pairedDifferenceVec(minuend, subtrahend, subjectIndices));
}

export function pairedDifferenceMeanVolume(
  minuend: StatisticalNeuroVec,
  subtrahend: StatisticalNeuroVec,
  subjectIndices?: readonly number[]
): Float64NeuroVol {
  return meanVolume(pairedDifferenceStats(minuend, subtrahend, subjectIndices));
}

export function pairedDifferenceEffectVolume(
  minuend: StatisticalNeuroVec,
  subtrahend: StatisticalNeuroVec,
  subjectIndices?: readonly number[]
): Float64NeuroVol {
  return effectVolume(pairedDifferenceStats(minuend, subtrahend, subjectIndices));
}

export function pairedDifferenceTVolume(
  minuend: StatisticalNeuroVec,
  subtrahend: StatisticalNeuroVec,
  subjectIndices?: readonly number[]
): Float64NeuroVol {
  return oneSampleTVolume(pairedDifferenceStats(minuend, subtrahend, subjectIndices));
}

function assertCompatibleStats(a: SufficientStats, b: SufficientStats): void {
  if (
    a.spatialSize !== b.spatialSize ||
    a.source.dim[0] !== b.source.dim[0] ||
    a.source.dim[1] !== b.source.dim[1] ||
    a.source.dim[2] !== b.source.dim[2] ||
    !a.source.space.isSpatiallyCompatibleWith(b.source.space)
  ) {
    throw new ValueError('Sufficient stats geometry mismatch');
  }
}

export function consistencyVolume(
  vec: StatisticalNeuroVec,
  options: ConsistencyOptions,
  subjectIndices: readonly number[] = allSubjectIndices(vec),
  stats: SufficientStats = computeSufficientStats(vec, subjectIndices)
): Float64NeuroVol {
  if (!Number.isFinite(options.cutoff) || options.cutoff < 0) {
    throw new ValueError('Consistency cutoff must be a finite non-negative number');
  }

  validateSubjectIndices(vec, subjectIndices);
  assertStatsMatchVec(stats, vec);
  assertStatsSubjectIndices(stats, subjectIndices);

  const nVoxels = spatialSize(vec);
  const data = vec.getData();
  const out = new Float64Array(nVoxels);

  for (let i = 0; i < nVoxels; i++) {
    const validCount = stats.count[i];
    if (validCount === 0) {
      out[i] = NaN;
      continue;
    }

    const mean = stats.mean[i];
    const sign = mean > 0 ? 1 : mean < 0 ? -1 : 0;
    if (sign === 0) {
      out[i] = 0;
      continue;
    }

    let consistent = 0;
    for (const subjectIndex of subjectIndices) {
      const value = data[subjectIndex * nVoxels + i];
      if (!Number.isFinite(value)) continue;
      if (sign > 0 && value >= options.cutoff) consistent++;
      if (sign < 0 && value <= -options.cutoff) consistent++;
    }

    out[i] = options.output === 'count' ? consistent : consistent / validCount;
  }

  return new Float64NeuroVol(vec.getVolume(0).space, out);
}

export class OverlaySummaryService {
  private readonly vec: StatisticalNeuroVec;
  private readonly cachePolicy: OverlaySummaryCachePolicy;
  private readonly cache = new Map<string, SufficientStats>();

  constructor(vec: StatisticalNeuroVec, options: OverlaySummaryServiceOptions = {}) {
    this.vec = vec;
    this.cachePolicy = options.cache ?? 'none';
  }

  getStats(subjectIndices: readonly number[] = allSubjectIndices(this.vec)): SufficientStats {
    if (this.cachePolicy === 'none') {
      return computeSufficientStats(this.vec, subjectIndices);
    }

    const key = subjectIndices.join(',');
    const cached = this.cache.get(key);
    if (cached) return cached;

    const stats = computeSufficientStats(this.vec, subjectIndices);
    this.cache.set(key, stats);
    return stats;
  }

  clearCache(): void {
    this.cache.clear();
  }

  mean(subjectIndices?: readonly number[]): Float64NeuroVol {
    return meanVolume(this.getStats(subjectIndices));
  }

  standardDeviation(subjectIndices?: readonly number[]): Float64NeuroVol {
    return standardDeviationVolume(this.getStats(subjectIndices));
  }

  effect(subjectIndices?: readonly number[]): Float64NeuroVol {
    return effectVolume(this.getStats(subjectIndices));
  }

  oneSampleT(subjectIndices?: readonly number[]): Float64NeuroVol {
    return oneSampleTVolume(this.getStats(subjectIndices));
  }

  leaveOneOutStats(subjectIndex: number, subjectIndices?: readonly number[]): SufficientStats {
    const stats = this.getStats(subjectIndices);
    return subtractSubjectFromStats(stats, subjectIndex);
  }

  leaveOneOutMean(subjectIndex: number, subjectIndices?: readonly number[]): Float64NeuroVol {
    return meanVolume(this.leaveOneOutStats(subjectIndex, subjectIndices));
  }

  leaveOneOutT(subjectIndex: number, subjectIndices?: readonly number[]): Float64NeuroVol {
    return oneSampleTVolume(this.leaveOneOutStats(subjectIndex, subjectIndices));
  }

  consistency(options: ConsistencyOptions, subjectIndices?: readonly number[]): Float64NeuroVol {
    return consistencyVolume(this.vec, options, subjectIndices, this.getStats(subjectIndices));
  }
}
