import { describe, expect, it } from 'vitest';
import { NeuroSpace } from '../src/geometry/NeuroSpace';
import { MappedNeuroVec } from '../src/vec/MappedNeuroVec';

describe('MappedNeuroVec backing storage', () => {
  it('uses an ArrayBuffer-backed typed array without copying', () => {
    const space = new NeuroSpace([1, 1, 1, 2]);
    const data = new Float32Array([1.25, 2.5]);
    const vec = MappedNeuroVec.fromTypedArray(space, data);

    expect(vec.getData()).toBe(data.buffer);
    expect(vec.getAt(0, 0, 0, 0)).toBe(1.25);
    expect(vec.getAt(0, 0, 0, 1)).toBe(2.5);
  });

  it.runIf(typeof SharedArrayBuffer !== 'undefined')(
    'accepts SharedArrayBuffer-backed typed arrays without copying',
    () => {
      const space = new NeuroSpace([1, 1, 1, 2]);
      const buffer = new SharedArrayBuffer(Float32Array.BYTES_PER_ELEMENT * 2);
      const data = new Float32Array(buffer);
      data.set([3.5, 7.25]);

      const vec = MappedNeuroVec.fromTypedArray(space, data);

      expect(vec.getData()).toBe(buffer);
      expect(vec.getAt(0, 0, 0, 0)).toBe(3.5);
      expect(vec.getAt(0, 0, 0, 1)).toBe(7.25);
    }
  );
});
