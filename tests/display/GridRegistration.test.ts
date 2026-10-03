import { describe, expect, it } from 'vitest';
import { NeuroSpace } from '../../src/geometry/NeuroSpace';
import { AxisSet3D } from '../../src/geometry/Axis';
import {
  registerGrid,
  layerSliceForReference,
  placeLayerSlice,
} from '../../src/display/GridRegistration';

const VIEWS = {
  axial: AxisSet3D.AXIAL_LPI,
  coronal: AxisSet3D.CORONAL_LIP,
  sagittal: AxisSet3D.SAGITTAL_AIL,
};

// A 1 mm reference and a 2 mm map whose voxel centres fall on reference
// voxel centres (as MNI152 1 mm / 2 mm grids do).
const ref1mm = new NeuroSpace([41, 49, 37], [1, 1, 1], [-20, -24, -18], AxisSet3D.AXIAL_LPI);
const map2mm = new NeuroSpace([19, 23, 17], [2, 2, 2], [-18, -22, -16], AxisSet3D.AXIAL_LPI);

/**
 * World position of the centre of a layer voxel (m, n) as drawn: the sprite
 * maps texture pixel t to position + scale * t, image-content x covers
 * reference voxel floor(x), and the reference plane is at referenceSlice.
 */
function drawnWorld(
  reference: NeuroSpace,
  view: AxisSet3D,
  placement: ReturnType<typeof placeLayerSlice>,
  upsample: number,
  m: number,
  n: number,
  referenceSlice: number
): number[] {
  const x = placement.position[0] + placement.scale[0] * upsample * (m + 0.5);
  const y = placement.position[1] + placement.scale[1] * upsample * (n + 0.5);
  return reference.reorient(view).gridToCoord([x - 0.5, y - 0.5, referenceSlice]);
}

describe('registerGrid', () => {
  it('is the identity for a layer on the reference grid', () => {
    for (const view of Object.values(VIEWS)) {
      const registration = registerGrid(ref1mm, ref1mm, view)!;
      expect(registration.origin.map(v => v + 0)).toEqual([0, 0, 0]);
      expect([registration.stepI, registration.stepJ, registration.stepK]).toEqual([1, 1, 1]);
      const placement = placeLayerSlice(registration);
      expect(placement.position).toEqual([0, 0]);
      expect(placement.scale).toEqual([1, 1]);
      expect(layerSliceForReference(registration, 7)).toBe(7);
    }
  });

  for (const [name, view] of Object.entries(VIEWS)) {
    it(`places every 2 mm voxel at its world position over a 1 mm grid (${name})`, () => {
      const registration = registerGrid(ref1mm, map2mm, view)!;
      expect(registration).not.toBeNull();
      expect([registration.stepI, registration.stepJ, registration.stepK]).toEqual([2, 2, 2]);

      const refView = ref1mm.reorient(view);
      const ownView = map2mm.reorient(view);
      expect(registration.depth).toBe(ownView.dim[2]);

      for (let referenceSlice = 0; referenceSlice < refView.dim[2]; referenceSlice++) {
        const own = layerSliceForReference(registration, referenceSlice);
        const planeWorld = refView.gridToCoord([0, 0, referenceSlice]);
        const ownExact = ownView.coordToGrid(planeWorld)[2];
        // The slab is [-0.5, depth - 0.5) in layer voxels; half-way rounds up,
        // as SimpleOrthogonalViewer.getValue does.
        if (ownExact < -0.5 || ownExact >= ownView.dim[2] - 0.5) {
          expect(own).toBeNull();
          continue;
        }
        expect(own).not.toBeNull();
        // Nearest plane: within half a 2 mm voxel of the reference plane.
        expect(Math.abs(own! - ownExact)).toBeLessThanOrEqual(0.5 + 1e-9);

        for (const upsample of [1, 4]) {
          const placement = placeLayerSlice(registration, upsample);
          for (const [m, n] of [[0, 0], [ownView.dim[0] - 1, 0], [3, ownView.dim[1] - 1], [7, 5]]) {
            const truth = ownView.gridToCoord([m, n, own!]);
            const drawn = drawnWorld(ref1mm, view, placement, upsample, m, n, referenceSlice);
            // In-plane: exact. Through-plane: the drawn plane is the reference
            // plane, at most half a layer voxel from the layer's own plane.
            const viewAxes = [view.i, view.j, view.k];
            for (let axis = 0; axis < 3; axis++) {
              const worldAxis = viewAxes.findIndex(a => Math.abs(a.direction[axis]) === 1);
              const diff = Math.abs(drawn[axis] - truth[axis]);
              if (worldAxis === 2) expect(diff).toBeLessThanOrEqual(1 + 1e-9);
              else expect(diff).toBeLessThan(1e-9);
            }
          }
        }
      }
    });
  }

  it('handles a half-voxel shifted, anisotropic grid', () => {
    const shifted = new NeuroSpace([13, 16, 9], [3, 2.5, 4], [-17.5, -20.25, -15], AxisSet3D.AXIAL_LPI);
    for (const view of Object.values(VIEWS)) {
      const registration = registerGrid(ref1mm, shifted, view)!;
      expect(registration).not.toBeNull();
      const own = layerSliceForReference(registration, 18);
      expect(own).not.toBeNull();
      const placement = placeLayerSlice(registration);
      const truth = shifted.reorient(view).gridToCoord([2, 3, own!]);
      const drawn = drawnWorld(ref1mm, view, placement, 1, 2, 3, 18);
      const inPlane = [view.i, view.j].map(a => a.direction.findIndex(v => v !== 0));
      inPlane.forEach(axis => expect(drawn[axis]).toBeCloseTo(truth[axis], 9));
    }
  });

  // Covers registerGrid only: VolStack wraps such layers in a FacadeVolLayer,
  // which ImageLayer leaves to the heuristic strategies.
  it('registers a grid stored in another orientation', () => {
    // RPI storage: voxel i runs right-to-left.
    const rpi = new NeuroSpace([19, 23, 17], [2, 2, 2], [18, -22, -16], AxisSet3D.AXIAL_RPI,
      [[-2, 0, 0, 18], [0, 2, 0, -22], [0, 0, 2, -16], [0, 0, 0, 1]]);
    for (const view of Object.values(VIEWS)) {
      const registration = registerGrid(ref1mm, rpi, view)!;
      expect(registration).not.toBeNull();
      expect(registration.stepI).toBeGreaterThan(0);
      expect(registration.stepJ).toBeGreaterThan(0);
      const own = layerSliceForReference(registration, 20)!;
      const truth = rpi.reorient(view).gridToCoord([4, 6, own]);
      const drawn = drawnWorld(ref1mm, view, placeLayerSlice(registration), 1, 4, 6, 20);
      const inPlane = [view.i, view.j].map(a => a.direction.findIndex(v => v !== 0));
      inPlane.forEach(axis => expect(drawn[axis]).toBeCloseTo(truth[axis], 9));
    }
  });

  it('refuses grids whose planes are rotated relative to the reference', () => {
    const angle = (10 * Math.PI) / 180;
    const c = 2 * Math.cos(angle);
    const s = 2 * Math.sin(angle);
    const oblique = new NeuroSpace([19, 23, 17], [2, 2, 2], [-18, -22, -16], AxisSet3D.AXIAL_LPI,
      [[c, -s, 0, -18], [s, c, 0, -22], [0, 0, 2, -16], [0, 0, 0, 1]]);
    expect(registerGrid(ref1mm, oblique, VIEWS.axial)).toBeNull();
    expect(registerGrid(ref1mm, oblique, VIEWS.coronal)).toBeNull();
  });
});
