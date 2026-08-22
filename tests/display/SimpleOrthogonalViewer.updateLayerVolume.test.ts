import { describe, expect, it, vi } from 'vitest';
import { SimpleOrthogonalViewer } from '../../src/display/SimpleOrthogonalViewer';
import { AxisSet3D } from '../../src/geometry/Axis';
import { NeuroSpace } from '../../src/geometry/NeuroSpace';
import { FloatNeuroVol } from '../../src/volume/DenseNeuroVol';

describe('SimpleOrthogonalViewer.updateLayerVolume', () => {
  it('replaces the volume through every image layer so per-view texture caches are invalidated', () => {
    const space = new NeuroSpace([2, 2, 2], [1, 1, 1], [0, 0, 0], AxisSet3D.AXIAL_LPI);
    const volume = new FloatNeuroVol(space, new Float32Array(space.size).fill(4));
    const imageLayers = Array.from({ length: 4 }, () => ({
      replaceVolume: vi.fn(),
    }));
    const renderSlice = vi.fn();
    const emit = vi.fn();
    const orthogonalViewer = {
      applyToImageLayers: vi.fn((handler: (layer: { replaceVolume: ReturnType<typeof vi.fn> }) => void) => {
        imageLayers.forEach(handler);
      }),
      getSliceViewer: vi.fn(() => ({
        view: { renderSlice },
      })),
    };
    const wrapper = Object.assign(Object.create(SimpleOrthogonalViewer.prototype), {
      viewer: orthogonalViewer,
      emitter: { emit },
    }) as SimpleOrthogonalViewer;

    wrapper.updateLayerVolume('active-subject', volume, {
      range: null,
      threshold: [-3, 3],
      alpha: 0.6,
    });

    expect(orthogonalViewer.applyToImageLayers).toHaveBeenCalledTimes(1);
    imageLayers.forEach((layer) => {
      expect(layer.replaceVolume).toHaveBeenCalledWith('active-subject', volume, {
        range: null,
        threshold: [-3, 3],
        alpha: 0.6,
        colormap: undefined,
      });
    });
    expect(renderSlice).toHaveBeenCalledTimes(3);
    expect(emit).toHaveBeenCalledWith('layerUpdated', { id: 'active-subject' });
  });
});
