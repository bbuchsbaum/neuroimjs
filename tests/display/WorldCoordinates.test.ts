import { describe, expect, it, vi } from 'vitest';
import { SimpleOrthogonalViewer } from '../../src/display/SimpleOrthogonalViewer';
import { SliceModel } from '../../src/display/SliceModel';
import { AxisSet3D } from '../../src/geometry/Axis';
import { NeuroSpace } from '../../src/geometry/NeuroSpace';
import { readVol } from '../../src/io/io';
import { fixturePath, manifest } from '../conformance/manifest';

function viewerFor(space: NeuroSpace): SimpleOrthogonalViewer {
  const state = {
    currentCoord: [0, 0, 0],
    setWorldCoord(coord: number[]) { this.currentCoord = coord.slice(); },
  };
  return Object.assign(Object.create(SimpleOrthogonalViewer.prototype), {
    imageLayer: { neuroSpace: space }, viewer: state,
  }) as SimpleOrthogonalViewer;
}

describe('RAS+ world coordinates', () => {
  it('pins AXIAL_LPI to positive right, anterior and superior in millimetres', () => {
    const space = new NeuroSpace([4, 5, 6], [2, 3, 4], [-10, -20, -30], AxisSet3D.AXIAL_LPI);
    expect(space.gridToCoord([1, 1, 1])).toEqual([-8, -17, -26]);
  });

  for (const id of ['xform_qform_only_ras', 'xform_qform_only_las', 'xform_qform_only_rot90', 'xform_qform_only_oblique']) {
    it(`keeps nibabel world coordinates and selects the same voxel for ${id}`, async () => {
      const fixture = manifest.cases.find(c => c.id === id)!;
      const volume = await readVol(fixturePath(fixture));
      const viewer = viewerFor(volume.space);
      for (const sample of fixture.samples) {
        viewer.setWorldCoord(sample.xyz);
        expect(viewer.getWorldCoord()).toEqual(sample.xyz);
        const voxel = volume.space.coordToGrid(viewer.getWorldCoord());
        voxel.forEach((v, i) => expect(v).toBeCloseTo(sample.ijk[i], 4));
        // The manifest also probes fractional and out-of-grid coordinates;
        // slice navigation clamps those, so pin exact in-grid voxel centres here.
        if (!sample.ijk.every((v, i) => Number.isInteger(v) && v >= 0 && v < volume.space.dim[i])) continue;
        for (const axes of [AxisSet3D.AXIAL_LPI, AxisSet3D.CORONAL_LIP, AxisSet3D.SAGITTAL_AIL]) {
          const model = new SliceModel(volume.space.dimOf(axes.k), sample.xyz, volume.space, axes);
          model.setCurrentCoord(viewer.getWorldCoord());
          expect(model.currentSliceIndex).toBeCloseTo(sample.ijk[volume.space.whichDim(axes.k)], 8);
        }
      }
    });
  }

  it('warns once per legacy method and preserves the old coordinate mapping', () => {
    const space = new NeuroSpace([4, 5, 6], [2, 3, 4], [0, 0, 0], AxisSet3D.AXIAL_RPI);
    const viewer = viewerFor(space);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      viewer.setLPICoord([2, 3, 4]);
      viewer.setLPICoord([2, 3, 4]);
      expect(viewer.getWorldCoord()).toEqual([-2, 3, 4]);
      expect(viewer.getLPICoord()).toEqual([2, 3, 4]);
      expect(viewer.getLPICoord()).toEqual([2, 3, 4]);
      expect(warn.mock.calls.filter(args => String(args[0]).includes('setLPICoord is deprecated'))).toHaveLength(1);
      expect(warn.mock.calls.filter(args => String(args[0]).includes('getLPICoord is deprecated'))).toHaveLength(1);
    } finally { warn.mockRestore(); }
  });
});
