import { ValueError } from '../errors';
import type { SpaceDataset, SpaceMember, SpaceState, SpaceStatePatch } from './types';

export const SPACE_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

function fail(message: string): never {
  throw new ValueError(message, { code: 'INVALID_ARGUMENT' });
}

function token(value: unknown, field: string): void {
  if (typeof value !== 'string' || !SPACE_ID.test(value)) fail(`${field} must be a safe identifier`);
}

function fullGrid(array: ArrayLike<number>, size: number, field: string): void {
  if (array.length !== size) fail(`${field} must have exactly ${size} values`);
}

function finiteOrNaN(array: Float32Array, field: string, nonnegative = false): void {
  for (const value of array) {
    if (Number.isNaN(value)) continue;
    if (!Number.isFinite(value) || (nonnegative && value < 0)) fail(`${field} contains an invalid value`);
  }
}

function copyMember(member: SpaceMember): SpaceMember {
  return {
    id: member.id,
    subject: member.subject,
    model: member.model,
    contrast: member.contrast,
    ...(member.t !== undefined && { t: new Float32Array(member.t) }),
    ...(member.beta !== undefined && { beta: new Float32Array(member.beta) }),
    ...(member.se !== undefined && { se: new Float32Array(member.se) }),
  };
}

/** Validate and synchronously detach all caller-owned mutable dataset arrays. */
export function validateAndCopySpaceDataset(dataset: SpaceDataset): SpaceDataset {
  if (!dataset || typeof dataset !== 'object') fail('dataset must be an object');
  token(dataset.id, 'dataset.id');
  const dimensions = dataset.grid?.dimensions;
  if (!dimensions || dimensions.length !== 3 || dimensions.some(value => !Number.isSafeInteger(value) || value <= 0)) {
    fail('grid.dimensions must contain three positive safe integers');
  }
  const size = dimensions[0] * dimensions[1] * dimensions[2];
  if (!Number.isSafeInteger(size)) fail('grid size exceeds safe integer range');

  const affine = dataset.grid?.affine;
  if (!affine || !Array.isArray(affine)) fail('grid.affine must be 4 by 4');
  if (affine.length !== 4 || affine.some(row => row.length !== 4)) fail('grid.affine must be 4 by 4');
  for (const row of affine) for (const value of row) if (!Number.isFinite(value)) fail('grid.affine must be finite');
  if (affine[3][0] !== 0 || affine[3][1] !== 0 || affine[3][2] !== 0 || affine[3][3] !== 1) {
    fail('grid.affine must have homogeneous row [0, 0, 0, 1]');
  }
  for (let axis = 0; axis < 3; axis++) {
    if (affine[axis][axis] <= 0) fail('grid.affine must be positive-diagonal RAS+');
    for (let other = 0; other < 3; other++) if (axis !== other && affine[axis][other] !== 0) {
      fail('grid.affine must be axis-aligned without flips, permutations, shear, or obliquity');
    }
  }

  if (!(dataset.template instanceof Float32Array)) fail('template must be a Float32Array');
  if (!(dataset.mask instanceof Uint8Array)) fail('mask must be a Uint8Array');
  fullGrid(dataset.template, size, 'template');
  for (const value of dataset.template) if (!Number.isFinite(value)) fail('template must be finite');
  fullGrid(dataset.mask, size, 'mask');
  if (!Array.from(dataset.mask).some(value => value > 0)) fail('mask must contain at least one non-zero voxel');
  if (!Array.isArray(dataset.members) || dataset.members.length === 0) fail('members must be non-empty');

  const memberIds = new Set<string>();
  const tuples = new Set<string>();
  const analyses = new Map<string, SpaceMember[]>();
  for (const member of dataset.members) {
    if (!member || typeof member !== 'object') fail('members must contain objects');
    token(member.id, 'member.id'); token(member.subject, 'member.subject'); token(member.model, 'member.model'); token(member.contrast, 'member.contrast');
    if (memberIds.has(member.id)) fail(`duplicate member.id: ${member.id}`);
    memberIds.add(member.id);
    const tuple = `${member.model}\u0000${member.contrast}\u0000${member.subject}`;
    if (tuples.has(tuple)) fail('members must have unique model/contrast/subject tuples');
    tuples.add(tuple);
    const hasT = member.t !== undefined;
    const hasBeta = member.beta !== undefined;
    if (!hasT && !hasBeta) fail(`member ${member.id} needs t or beta`);
    if (hasT) { if (!(member.t instanceof Float32Array)) fail(`member ${member.id}.t must be a Float32Array`); fullGrid(member.t, size, `member ${member.id}.t`); finiteOrNaN(member.t, `member ${member.id}.t`); }
    if (hasBeta) { if (!(member.beta instanceof Float32Array)) fail(`member ${member.id}.beta must be a Float32Array`); fullGrid(member.beta, size, `member ${member.id}.beta`); finiteOrNaN(member.beta, `member ${member.id}.beta`); }
    if (member.se !== undefined) { if (!(member.se instanceof Float32Array)) fail(`member ${member.id}.se must be a Float32Array`); fullGrid(member.se, size, `member ${member.id}.se`); finiteOrNaN(member.se, `member ${member.id}.se`, true); }
    const analysis = `${member.model}\u0000${member.contrast}`;
    analyses.set(analysis, [...(analyses.get(analysis) ?? []), member]);
  }
  for (const members of analyses.values()) {
    if (!members.every(member => member.t !== undefined) && !members.every(member => member.beta !== undefined)) {
      fail('each model/contrast analysis needs a common t or beta statistic across all members');
    }
  }

  if (dataset.atlas) {
    if (typeof dataset.atlas.name !== 'string') fail('atlas.name must be a string');
    if (!(dataset.atlas.labels instanceof Int32Array)) fail('atlas.labels must be an Int32Array');
    fullGrid(dataset.atlas.labels, size, 'atlas.labels');
    const regionIds = new Set<number>();
    for (const region of dataset.atlas.regions) {
      if (!Number.isSafeInteger(region.id) || regionIds.has(region.id) || typeof region.label !== 'string') fail('atlas.regions must have unique integer ids and string labels');
      regionIds.add(region.id);
    }
  }
  const subjects = new Set(dataset.members.map(member => member.subject));
  const covariateSubjects = new Set<string>();
  for (const covariate of dataset.covariates ?? []) {
    token(covariate.subject, 'covariates.subject');
    if (!subjects.has(covariate.subject) || covariateSubjects.has(covariate.subject)) fail('covariates subjects must be known and unique');
    covariateSubjects.add(covariate.subject);
    for (const value of Object.values(covariate.values)) {
      if (value !== null && typeof value !== 'string' && typeof value !== 'number') fail('covariates values must be string, number, or null');
      if (typeof value === 'number' && !Number.isFinite(value)) fail('covariates must be finite');
    }
  }

  return {
    id: dataset.id,
    grid: { dimensions: [dimensions[0], dimensions[1], dimensions[2]], affine: affine.map(row => [...row]) },
    template: new Float32Array(dataset.template),
    mask: new Uint8Array(dataset.mask),
    members: dataset.members.map(copyMember),
    ...(dataset.atlas && { atlas: { name: dataset.atlas.name, labels: new Int32Array(dataset.atlas.labels), regions: dataset.atlas.regions.map(region => ({ ...region })) } }),
    ...(dataset.covariates && { covariates: dataset.covariates.map(covariate => ({ subject: covariate.subject, values: { ...covariate.values } })) }),
  };
}

export function copyState(state: SpaceState): SpaceState {
  return { ...state, ...(state.worldCoord && { worldCoord: [...state.worldCoord] as [number, number, number] }) };
}

export function copyStatePatch(patch: SpaceStatePatch): SpaceStatePatch {
  return { ...patch, ...(patch.worldCoord && { worldCoord: [...patch.worldCoord] as [number, number, number] }) };
}
