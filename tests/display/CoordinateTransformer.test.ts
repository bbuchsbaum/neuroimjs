import { describe, test, expect, vi, beforeAll } from 'vitest';
import { setupConsoleMocks } from './test-console-mock';
import { createPixiMock } from '../mocks/pixi.mock';

vi.mock('pixi.js', () => createPixiMock());

import * as PIXI from 'pixi.js';
import { CoordinateTransformer } from '../../src/display/CoordinateTransformer';
import { NeuroSpace } from '../../src/geometry/NeuroSpace';
import { AxisSet3D, NamedAxis } from '../../src/geometry/Axis';

describe('CoordinateTransformer', () => {
  let neuroSpace: NeuroSpace;

  beforeAll(() => {
    setupConsoleMocks();
  });

  beforeAll(() => {
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
  });

  test('constructor initializes without error', () => {
    expect(() => {
      new CoordinateTransformer(neuroSpace, AxisSet3D.AXIAL_LPI);
    }).not.toThrow();
  });

  test('setSliceIndex updates internal state', () => {
    const transformer = new CoordinateTransformer(neuroSpace, AxisSet3D.AXIAL_LPI, 0);
    transformer.setSliceIndex(32);
    expect(transformer.isSliceIndexValid()).toBe(true);
  });

  test('screenToImageCoord calls toLocal on container', () => {
    const transformer = new CoordinateTransformer(neuroSpace, AxisSet3D.AXIAL_LPI);
    const container = new PIXI.Container() as any;

    const result = transformer.screenToImageCoord(100, 200, container);
    expect(result).toHaveProperty('x');
    expect(result).toHaveProperty('y');
    expect(container.toLocal).toHaveBeenCalled();
  });

  test('sliceToVolumeCoord returns 3D coordinate', () => {
    const transformer = new CoordinateTransformer(neuroSpace, AxisSet3D.AXIAL_LPI, 32);
    const result = transformer.sliceToVolumeCoord({ x: 10, y: 20 });

    expect(result).toHaveLength(3);
    expect(result.every(Number.isFinite)).toBe(true);
  });

  test('volumeToLocalSliceCoord returns 2D coordinate', () => {
    const transformer = new CoordinateTransformer(neuroSpace, AxisSet3D.AXIAL_LPI, 32);
    const result = transformer.volumeToLocalSliceCoord([32, 32, 32]);

    expect(result).toHaveProperty('x');
    expect(result).toHaveProperty('y');
    expect(Number.isFinite(result.x)).toBe(true);
    expect(Number.isFinite(result.y)).toBe(true);
  });

  test('round-trip: volume -> slice -> volume preserves coordinates', () => {
    const transformer = new CoordinateTransformer(neuroSpace, AxisSet3D.AXIAL_LPI, 32);
    const original = [20, 25, 32]; // k must match the pinned slice

    const slicePt = transformer.volumeToLocalSliceCoord(original);
    const recovered = transformer.sliceToVolumeCoord(slicePt);

    expect(recovered[0]).toBeCloseTo(original[0], 1);
    expect(recovered[1]).toBeCloseTo(original[1], 1);
    expect(recovered[2]).toBeCloseTo(original[2], 1);
  });

  test('sliceToVolumeCoordSafe with clamp returns valid coords', () => {
    const transformer = new CoordinateTransformer(neuroSpace, AxisSet3D.AXIAL_LPI, 32);
    const result = transformer.sliceToVolumeCoordSafe({ x: 10, y: 20 }, { clamp: true });

    if (result) {
      expect(result).toHaveLength(3);
      expect(result.every(Number.isFinite)).toBe(true);
    }
  });

  test('getSliceBounds returns valid bounds', () => {
    const transformer = new CoordinateTransformer(neuroSpace, AxisSet3D.AXIAL_LPI, 32);
    const bounds = transformer.getSliceBounds();

    expect(bounds).toHaveProperty('minX');
    expect(bounds).toHaveProperty('maxX');
    expect(bounds).toHaveProperty('minY');
    expect(bounds).toHaveProperty('maxY');
    expect(bounds.maxX).toBeGreaterThan(bounds.minX);
    expect(bounds.maxY).toBeGreaterThan(bounds.minY);
  });

  test('validateSliceIndex returns valid index', () => {
    const transformer = new CoordinateTransformer(neuroSpace, AxisSet3D.AXIAL_LPI);
    const result = transformer.validateSliceIndex(32, 64);
    expect(result).toBe(32);
  });

  test('validateSliceIndex clamps out-of-range', () => {
    const transformer = new CoordinateTransformer(neuroSpace, AxisSet3D.AXIAL_LPI);
    const result = transformer.validateSliceIndex(100, 64, { clamp: true });
    expect(result).not.toBeNull();
    if (result !== null) {
      expect(result).toBeLessThanOrEqual(63);
    }
  });

  test('works with different orientations', () => {
    const orientations = [
      AxisSet3D.AXIAL_LPI,
      AxisSet3D.CORONAL_LIP,
      AxisSet3D.SAGITTAL_AIL,
    ];

    for (const axes of orientations) {
      const transformer = new CoordinateTransformer(neuroSpace, axes, 32);
      const vol = transformer.sliceToVolumeCoord({ x: 10, y: 10 });
      expect(vol).toHaveLength(3);
      expect(vol.every(Number.isFinite)).toBe(true);
    }
  });

  test('screenToVolumeCoordSafe returns null for NaN coords', () => {
    const transformer = new CoordinateTransformer(neuroSpace, AxisSet3D.AXIAL_LPI, 32);
    const container = new PIXI.Container() as any;
    const result = transformer.screenToVolumeCoordSafe(NaN, NaN, container);
    expect(result).toBeNull();
  });
});
