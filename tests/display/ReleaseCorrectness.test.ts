import { describe, expect, it, vi } from 'vitest';
import * as PIXI from 'pixi.js';
import { SliceCoordinator } from '../../src/core/SliceCoordinator';
import { ImageLayer } from '../../src/display/ImageLayer';
import { VolLayer } from '../../src/display/VolLayer';
import { VolStack } from '../../src/display/VolStack';
import { ColorMapFactory } from '../../src/display/ColorMapFactory';
import { AxisSet3D } from '../../src/geometry/Axis';
import { NeuroSpace } from '../../src/geometry/NeuroSpace';
import { FloatNeuroVol } from '../../src/volume/DenseNeuroVol';

function stack(axes: AxisSet3D): VolStack {
  const space = new NeuroSpace([36, 44, 30], [2, 3, 4], [-20, -30, -40], axes);
  return new VolStack(new VolLayer('test', new FloatNeuroVol(space, new Float32Array(36 * 44 * 30)), ColorMapFactory.createGrayscale()));
}

describe('release display regressions', () => {
  it.each([
    [AxisSet3D.AXIAL_LPI, [30, 44, 36]],
    [AxisSet3D.AXIAL_RPI, [30, 44, 36]],
    [AxisSet3D.CORONAL_LIP, [44, 30, 36]],
    [AxisSet3D.SAGITTAL_AIL, [44, 36, 30]],
  ] as const)('validates anatomical slice bounds for %s', (axes, counts) => {
    const volumes = stack(axes);
    const coordinator = new SliceCoordinator();
    const views = [AxisSet3D.AXIAL_LPI, AxisSet3D.CORONAL_LIP, AxisSet3D.SAGITTAL_AIL];
    views.forEach((view, i) => {
      expect(coordinator.getValidSliceRange(view, volumes)).toEqual([0, counts[i] - 1]);
      const result = coordinator.validateSliceAccess(counts[i] - 1, view, volumes);
      expect(result.isValid).toBe(true);
      expect(result.sliceIndices).toEqual([counts[i] - 1]);
      expect(result.warnings).toEqual([]);
    });
    expect(coordinator.getVolumeDimensions(volumes, views[0])[0].sliceCounts).toEqual({
      axial: counts[0], coronal: counts[1], sagittal: counts[2],
    });
  });

  it('does not read canvas pixels back while rendering new slices', () => {
    const readback = vi.fn(() => new ImageData(1, 1));
    const createElement = document.createElement.bind(document);
    const spy = vi.spyOn(document, 'createElement').mockImplementation((tag, options) => {
      const element = createElement(tag, options);
      if (tag === 'canvas') {
        const canvas = element as HTMLCanvasElement;
        const getContext = canvas.getContext.bind(canvas);
        vi.spyOn(canvas, 'getContext').mockImplementation(((kind: string) => {
          const context = getContext(kind as '2d');
          if (kind === '2d' && context) context.getImageData = readback;
          return context;
        }) as typeof canvas.getContext);
      }
      return element;
    });
    const layer = new ImageLayer(stack(AxisSet3D.AXIAL_LPI));
    try {
      const parent = new PIXI.Container();
      expect(layer.renderSlice(13, [23, 32, 13], AxisSet3D.AXIAL_LPI, parent)).not.toBeNull();
      expect(layer.renderSlice(14, [23, 32, 14], AxisSet3D.AXIAL_LPI, parent)).not.toBeNull();
      expect(readback).not.toHaveBeenCalled();
    } finally {
      layer.dispose();
      spy.mockRestore();
    }
  });
});
