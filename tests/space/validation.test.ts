import { describe, expect, it } from 'vitest';
import { validateAndCopySpaceDataset } from '../../src/space/validation';
import type { SpaceDataset } from '../../src/space/types';

function dataset(): SpaceDataset {
  return {
    id: 'dataset.1',
    grid: { dimensions: [2, 1, 1], affine: [[2, 0, 0, 5], [0, 3, 0, 6], [0, 0, 4, 7], [0, 0, 0, 1]] },
    template: new Float32Array([1, 2]), mask: new Uint8Array([1, 1]),
    members: [
      { id: 'm.1', subject: 's.1', model: 'model.1', contrast: 'contrast.1', t: new Float32Array([1, NaN]), se: new Float32Array([1, NaN]) },
      { id: 'm.2', subject: 's.2', model: 'model.1', contrast: 'contrast.1', t: new Float32Array([2, 3]) },
    ],
  };
}

describe('Space dataset validation', () => {
  it('synchronously copies every caller-owned mutable array', () => {
    const input = dataset();
    const copied = validateAndCopySpaceDataset(input);
    input.template[0] = 99; input.mask[0] = 0; input.members[0].t![0] = 99;
    expect(copied.template[0]).toBe(1);
    expect(copied.mask[0]).toBe(1);
    expect(copied.members[0].t![0]).toBe(1);
  });

  it('rejects unsafe identifiers, unsupported affines, invalid arrays, and unavailable common statistics', () => {
    const unsafe = { ...dataset(), id: 'unsafe id' };
    expect(() => validateAndCopySpaceDataset(unsafe)).toThrow(/safe identifier/);
    const affine = { ...dataset(), grid: { ...dataset().grid, affine: [[1, 0.1, 0, 5], [0, 3, 0, 6], [0, 0, 4, 7], [0, 0, 0, 1]] } };
    expect(() => validateAndCopySpaceDataset(affine)).toThrow(/axis-aligned/);
    const arrays = { ...dataset(), mask: new Uint8Array([0, 0]) };
    expect(() => validateAndCopySpaceDataset(arrays)).toThrow(/non-zero/);
    const base = dataset();
    const capabilities = { ...base, members: [base.members[0], { ...base.members[1], beta: new Float32Array([2, 3]), t: undefined }] };
    expect(() => validateAndCopySpaceDataset(capabilities)).toThrow(/common t or beta/);
    const wrongTypes = { ...dataset(), template: new Float64Array([1, 2]) } as unknown as SpaceDataset;
    expect(() => validateAndCopySpaceDataset(wrongTypes)).toThrow(/Float32Array/);
    const nullStatistic = { ...dataset(), members: [{ ...dataset().members[0], t: null }] } as unknown as SpaceDataset;
    expect(() => validateAndCopySpaceDataset(nullStatistic)).toThrow(/\.t must be a Float32Array/);
    const falseStatistic = { ...dataset(), members: [{ ...dataset().members[0], t: false }] } as unknown as SpaceDataset;
    expect(() => validateAndCopySpaceDataset(falseStatistic)).toThrow(/\.t must be a Float32Array/);
    const falseSe = { ...dataset(), members: [{ ...dataset().members[0], se: false }] } as unknown as SpaceDataset;
    expect(() => validateAndCopySpaceDataset(falseSe)).toThrow(/\.se must be a Float32Array/);
    const covariates = { ...dataset(), covariates: [{ subject: 'missing', values: { age: 20 } }] };
    expect(() => validateAndCopySpaceDataset(covariates)).toThrow(/known and unique/);
  });
});
