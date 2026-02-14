import { describe, test, expect, vi, beforeEach, beforeAll } from 'vitest';
import { setupConsoleMocks } from './test-console-mock';
import { SliceModel } from '../../src/display/SliceModel';
import { NeuroSpace } from '../../src/geometry/NeuroSpace';
import { AxisSet3D, NamedAxis } from '../../src/geometry/Axis';

describe('SliceModel', () => {
  let neuroSpace: NeuroSpace;
  let viewAxes: AxisSet3D;

  beforeAll(() => {
    setupConsoleMocks();
  });

  beforeEach(() => {
    neuroSpace = new NeuroSpace(
      [64, 64, 64],
      [2, 2, 2],
      [0, 0, 0],
      new AxisSet3D(
        NamedAxis.LEFT_RIGHT,
        NamedAxis.POST_ANT,
        NamedAxis.INF_SUP
      )
    );
    viewAxes = AxisSet3D.AXIAL_LPI;
  });

  test('constructor sets initial state', () => {
    const center = neuroSpace.gridToCoord([32, 32, 32]);
    const model = new SliceModel(64, center, neuroSpace, viewAxes);

    expect(model.totalSlices).toBe(64);
    expect(model.currentCoord).toHaveLength(3);
  });

  test('currentSliceIndex is derived from currentCoord', () => {
    const center = neuroSpace.gridToCoord([32, 32, 32]);
    const model = new SliceModel(64, center, neuroSpace, viewAxes);

    // For AXIAL_LPI, the movement axis (k) is INF_SUP
    // The slice index should be approximately 32
    expect(model.currentSliceIndex).toBeCloseTo(32, 0);
  });

  test('setCurrentSliceIndex updates coordinate and slice', () => {
    const center = neuroSpace.gridToCoord([32, 32, 32]);
    const model = new SliceModel(64, center, neuroSpace, viewAxes);

    model.setCurrentSliceIndex(10);
    expect(model.currentSliceIndex).toBe(10);
  });

  test('nextSlice increments by 1', () => {
    const center = neuroSpace.gridToCoord([32, 32, 32]);
    const model = new SliceModel(64, center, neuroSpace, viewAxes);
    const initialIndex = model.currentSliceIndex;

    model.nextSlice();
    expect(model.currentSliceIndex).toBe(initialIndex + 1);
  });

  test('previousSlice decrements by 1', () => {
    const center = neuroSpace.gridToCoord([32, 32, 32]);
    const model = new SliceModel(64, center, neuroSpace, viewAxes);
    const initialIndex = model.currentSliceIndex;

    model.previousSlice();
    expect(model.currentSliceIndex).toBe(initialIndex - 1);
  });

  test('nextSlice clamps at totalSlices - 1', () => {
    const lastSliceCoord = neuroSpace.gridToCoord([32, 32, 63]);
    const model = new SliceModel(64, lastSliceCoord, neuroSpace, viewAxes);

    model.nextSlice();
    expect(model.currentSliceIndex).toBeLessThanOrEqual(63);
  });

  test('previousSlice clamps at 0', () => {
    const firstSliceCoord = neuroSpace.gridToCoord([32, 32, 0]);
    const model = new SliceModel(64, firstSliceCoord, neuroSpace, viewAxes);

    model.previousSlice();
    expect(model.currentSliceIndex).toBeGreaterThanOrEqual(0);
  });

  test('setCurrentCoord updates the coordinate', () => {
    const center = neuroSpace.gridToCoord([32, 32, 32]);
    const model = new SliceModel(64, center, neuroSpace, viewAxes);

    const newCoord = neuroSpace.gridToCoord([10, 20, 30]);
    model.setCurrentCoord(newCoord);

    expect(model.currentSliceIndex).toBeCloseTo(30, 0);
  });

  test('setCurrentCoordIfChanged only updates when different', () => {
    const center = neuroSpace.gridToCoord([32, 32, 32]);
    const model = new SliceModel(64, center, neuroSpace, viewAxes);

    // Setting the same coord should not change reference
    const coordBefore = model.currentCoord;
    model.setCurrentCoordIfChanged(center);
    expect(model.currentCoord).toBe(coordBefore);

    // Setting a different coord should change
    const newCoord = neuroSpace.gridToCoord([10, 20, 30]);
    model.setCurrentCoordIfChanged(newCoord);
    expect(model.currentSliceIndex).toBeCloseTo(30, 0);
  });

  test('getViewAxes returns the configured axes', () => {
    const center = neuroSpace.gridToCoord([32, 32, 32]);
    const model = new SliceModel(64, center, neuroSpace, viewAxes);

    expect(model.getViewAxes()).toBe(viewAxes);
  });

  test('works with CORONAL orientation', () => {
    const coronalAxes = AxisSet3D.CORONAL_LIP;
    const center = neuroSpace.gridToCoord([32, 32, 32]);
    const movementDim = neuroSpace.whichDim(coronalAxes.k);
    const totalSlices = neuroSpace.dim[movementDim];
    const model = new SliceModel(totalSlices, center, neuroSpace, coronalAxes);

    expect(model.totalSlices).toBe(64);
    model.setCurrentSliceIndex(20);
    expect(model.currentSliceIndex).toBe(20);
  });

  test('works with SAGITTAL orientation', () => {
    const sagAxes = AxisSet3D.SAGITTAL_AIL;
    const center = neuroSpace.gridToCoord([32, 32, 32]);
    const movementDim = neuroSpace.whichDim(sagAxes.k);
    const totalSlices = neuroSpace.dim[movementDim];
    const model = new SliceModel(totalSlices, center, neuroSpace, sagAxes);

    expect(model.totalSlices).toBe(64);
    model.setCurrentSliceIndex(40);
    expect(model.currentSliceIndex).toBe(40);
  });

  test('onCoordChange fires when coordinate changes', () => {
    const center = neuroSpace.gridToCoord([32, 32, 32]);
    const model = new SliceModel(64, center, neuroSpace, viewAxes);
    const handler = vi.fn();

    const disposer = model.onCoordChange(handler);
    model.setCurrentSliceIndex(10);

    // MobX reactions are synchronous in tests
    expect(handler).toHaveBeenCalled();

    disposer();
  });

  test('onSliceIndexChange fires when slice index changes', () => {
    const center = neuroSpace.gridToCoord([32, 32, 32]);
    const model = new SliceModel(64, center, neuroSpace, viewAxes);
    const handler = vi.fn();

    const disposer = model.onSliceIndexChange(handler);
    model.setCurrentSliceIndex(10);

    expect(handler).toHaveBeenCalledWith(10);

    disposer();
  });
});
