import { describe, expect, it } from 'vitest';
import { SimpleOrthogonalViewer } from '../../src/display/SimpleOrthogonalViewer';
import { VolStack } from '../../src/display/VolStack';
import { VolLayer } from '../../src/display/VolLayer';
import { ColorMapFactory } from '../../src/display/ColorMapFactory';
import { AxisSet3D } from '../../src/geometry/Axis';
import { NeuroSpace } from '../../src/geometry/NeuroSpace';
import { FloatNeuroVol } from '../../src/volume/DenseNeuroVol';

function volume(space: NeuroSpace, fill: (i: number, j: number, k: number) => number): FloatNeuroVol {
  const [nx, ny, nz] = space.dim;
  const data = new Float32Array(nx * ny * nz);
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) data[i + nx * (j + ny * k)] = fill(i, j, k);
  return new FloatNeuroVol(space, data);
}

describe('SimpleOrthogonalViewer.getValue with layers on different grids', () => {
  it('reads each layer at its own voxel for the same world coordinate', () => {
    const ref1mm = new NeuroSpace([41, 49, 37], [1, 1, 1], [-20, -24, -18], AxisSet3D.AXIAL_LPI);
    const map2mm = new NeuroSpace([19, 23, 17], [2, 2, 2], [-18, -22, -16], AxisSet3D.AXIAL_LPI);
    const encode = (i: number, j: number, k: number) => 1 + i + 100 * j + 10000 * k;
    const stack = new VolStack(
      new VolLayer('anatomy', volume(ref1mm, encode), ColorMapFactory.createGrayscale()),
      new VolLayer('stat', volume(map2mm, encode), ColorMapFactory.createHot())
    );
    const viewer = Object.assign(Object.create(SimpleOrthogonalViewer.prototype), {
      imageLayer: { getVolStack: () => stack },
    }) as SimpleOrthogonalViewer;

    // World (3, -5, 7) mm: 1 mm voxel (23, 19, 25); nearest 2 mm voxel
    // (10.5 -> 11, 8.5 -> 9, 11.5 -> 12).
    expect(viewer.getValue('anatomy', [3, -5, 7])).toBe(encode(23, 19, 25));
    expect(viewer.getValue('stat', [3, -5, 7])).toBe(encode(11, 9, 12));
    // On a 2 mm voxel centre both grids agree on the location.
    expect(viewer.getValue('stat', [-18, -22, -16])).toBe(encode(0, 0, 0));
    expect(viewer.getValue('anatomy', [-18, -22, -16])).toBe(encode(2, 2, 2));
    // Inside the template but outside the map's slab.
    expect(viewer.getValue('anatomy', [0, 0, 18])).toBe(encode(20, 24, 36));
    expect(viewer.getValue('stat', [0, 0, 18])).toBeNull();
  });
});
