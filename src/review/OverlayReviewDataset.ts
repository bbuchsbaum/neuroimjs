import { Range, TypedArray, ValueError } from '../types';
import { Float32NeuroVec, Float64NeuroVec, NeuroVec } from '../vec/NeuroVec';
import { NeuroVol } from '../volume/NeuroVol';

export type ReviewNeuroVec = Float32NeuroVec | Float64NeuroVec;

export interface SubjectInfo {
  id: string;
  label?: string;
  group?: string;
  metadata?: Record<string, unknown>;
}

export interface OverlayReviewContrast {
  id: string;
  label?: string;
  vec: NeuroVec<TypedArray>;
  /**
   * Fixed display window for this contrast. It is resolved once at session
   * creation and is intentionally not recomputed while subjects are browsed.
   */
  displayRange?: Range;
}

export interface OverlayReviewDataset {
  template: NeuroVol;
  contrasts: OverlayReviewContrast[];
  subjects?: SubjectInfo[];
}

export interface ValidatedOverlayReviewContrast extends OverlayReviewContrast {
  displayRange: Range;
}

export interface ValidatedOverlayReviewDataset {
  template: NeuroVol;
  contrasts: ValidatedOverlayReviewContrast[];
  subjects: SubjectInfo[];
  subjectCount: number;
}

export interface OverlayReviewSessionOptions {
  initialContrastId?: string;
  initialSubjectIndex?: number;
}

function sameDim(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((d, i) => d === b[i]);
}

function spatialDim(vec: NeuroVec<TypedArray>): number[] {
  return vec.dim.slice(0, 3);
}

function volumeSize(dim: readonly number[]): number {
  return dim[0] * dim[1] * dim[2];
}

function assertVolumeCompatible(
  candidate: NeuroVol,
  reference: NeuroVol,
  label: string
): void {
  if (!sameDim(candidate.dim.slice(0, 3), reference.dim.slice(0, 3))) {
    throw new ValueError(
      `${label} dimensions [${candidate.dim.slice(0, 3)}] do not match template dimensions [${reference.dim.slice(0, 3)}]`
    );
  }

  if (!candidate.space.axes.equals(reference.space.axes)) {
    throw new ValueError(`${label} axes do not match template axes`);
  }

  if (!candidate.space.isSpatiallyCompatibleWith(reference.space)) {
    throw new ValueError(`${label} affine geometry does not match template geometry`);
  }
}

function assertVecCompatible(vec: NeuroVec<TypedArray>, template: NeuroVol, label: string): void {
  if (vec.dim.length !== 4) {
    throw new ValueError(`${label} must be a 4D NeuroVec`);
  }

  if (!sameDim(spatialDim(vec), template.dim.slice(0, 3))) {
    throw new ValueError(
      `${label} spatial dimensions [${spatialDim(vec)}] do not match template dimensions [${template.dim.slice(0, 3)}]`
    );
  }

  if (!vec.space.axes.equals(template.space.axes)) {
    throw new ValueError(`${label} axes do not match template axes`);
  }

  if (!vec.space.isSpatiallyCompatibleWith(template.space)) {
    throw new ValueError(`${label} affine geometry does not match template geometry`);
  }
}

function defaultSubjects(count: number): SubjectInfo[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `subject-${i + 1}`,
    label: `Subject ${i + 1}`,
  }));
}

function resolveDisplayRange(contrast: OverlayReviewContrast): Range {
  if (contrast.displayRange) {
    return [contrast.displayRange[0], contrast.displayRange[1]];
  }

  const range = contrast.vec.getRange();
  return [range[0], range[1]];
}

export function createReviewVecFromVolumes(volumes: readonly NeuroVol[]): ReviewNeuroVec {
  if (volumes.length === 0) {
    throw new ValueError('createReviewVecFromVolumes requires at least one volume');
  }

  const reference = volumes[0];
  const refDim = reference.dim.slice(0, 3);
  const spatialSize = volumeSize(refDim);
  // Retain Float32 when all inputs are Float32. Any Float64 or integer source
  // is promoted to Float64 so review construction never silently discards
  // source precision or integer range.
  const useFloat32 = volumes.every(volume => volume.getData() instanceof Float32Array);
  const data = useFloat32
    ? new Float32Array(spatialSize * volumes.length)
    : new Float64Array(spatialSize * volumes.length);

  for (let t = 0; t < volumes.length; t++) {
    const volume = volumes[t];
    assertVolumeCompatible(volume, reference, `Volume ${t}`);
    data.set(volume.getData(), t * spatialSize);
  }

  const space4d = reference.space.withDimensions([
    refDim[0],
    refDim[1],
    refDim[2],
    volumes.length,
  ]);

  return useFloat32
    ? new Float32NeuroVec(space4d, data as Float32Array)
    : new Float64NeuroVec(space4d, data as Float64Array);
}

export function validateOverlayReviewDataset(dataset: OverlayReviewDataset): ValidatedOverlayReviewDataset {
  if (dataset.contrasts.length === 0) {
    throw new ValueError('OverlayReviewDataset requires at least one contrast');
  }

  const seenContrastIds = new Set<string>();
  let subjectCount: number | null = null;

  const contrasts = dataset.contrasts.map((contrast) => {
    if (!contrast.id) {
      throw new ValueError('Contrast id must be non-empty');
    }
    if (seenContrastIds.has(contrast.id)) {
      throw new ValueError(`Duplicate contrast id: ${contrast.id}`);
    }
    seenContrastIds.add(contrast.id);

    assertVecCompatible(contrast.vec, dataset.template, `Contrast ${contrast.id}`);

    const count = contrast.vec.dim[3];
    if (subjectCount === null) {
      subjectCount = count;
    } else if (count !== subjectCount) {
      throw new ValueError(
        `Contrast ${contrast.id} subject count ${count} does not match expected count ${subjectCount}`
      );
    }

    return {
      ...contrast,
      displayRange: resolveDisplayRange(contrast),
    };
  });

  const finalSubjectCount = subjectCount ?? 0;
  const subjects = dataset.subjects ? dataset.subjects.slice() : defaultSubjects(finalSubjectCount);

  if (subjects.length !== finalSubjectCount) {
    throw new ValueError(
      `Subject metadata length ${subjects.length} does not match contrast subject count ${finalSubjectCount}`
    );
  }

  const seenSubjectIds = new Set<string>();
  subjects.forEach((subject) => {
    if (!subject.id) {
      throw new ValueError('Subject id must be non-empty');
    }
    if (seenSubjectIds.has(subject.id)) {
      throw new ValueError(`Duplicate subject id: ${subject.id}`);
    }
    seenSubjectIds.add(subject.id);
  });

  return {
    template: dataset.template,
    contrasts,
    subjects,
    subjectCount: finalSubjectCount,
  };
}

export class OverlayReviewSession {
  private readonly dataset: ValidatedOverlayReviewDataset;
  private contrastId: string;
  private subjectIndex: number;

  constructor(dataset: OverlayReviewDataset, options: OverlayReviewSessionOptions = {}) {
    this.dataset = validateOverlayReviewDataset(dataset);
    this.contrastId = options.initialContrastId ?? this.dataset.contrasts[0].id;
    this.subjectIndex = options.initialSubjectIndex ?? 0;

    this.getContrast(this.contrastId);
    this.assertSubjectIndex(this.subjectIndex);
  }

  get subjectCount(): number {
    return this.dataset.subjectCount;
  }

  get currentSubjectIndex(): number {
    return this.subjectIndex;
  }

  get currentContrastId(): string {
    return this.contrastId;
  }

  get subjects(): ReadonlyArray<SubjectInfo> {
    return this.dataset.subjects;
  }

  get contrasts(): ReadonlyArray<ValidatedOverlayReviewContrast> {
    return this.dataset.contrasts;
  }

  get template(): NeuroVol {
    return this.dataset.template;
  }

  setSubjectIndex(index: number): void {
    this.assertSubjectIndex(index);
    this.subjectIndex = index;
  }

  setContrast(id: string): void {
    this.getContrast(id);
    this.contrastId = id;
  }

  getContrast(id: string = this.contrastId): ValidatedOverlayReviewContrast {
    const contrast = this.dataset.contrasts.find((candidate) => candidate.id === id);
    if (!contrast) {
      throw new ValueError(`Unknown contrast id: ${id}`);
    }
    return contrast;
  }

  getDisplayRange(id: string = this.contrastId): Range {
    const range = this.getContrast(id).displayRange;
    return [range[0], range[1]];
  }

  getSubjectVolume(
    subjectIndex: number = this.subjectIndex,
    contrastId: string = this.contrastId
  ): NeuroVol {
    this.assertSubjectIndex(subjectIndex);
    return this.getContrast(contrastId).vec.getVolume(subjectIndex);
  }

  private assertSubjectIndex(index: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.dataset.subjectCount) {
      throw new ValueError(`Subject index ${index} is out of range 0..${this.dataset.subjectCount - 1}`);
    }
  }
}
