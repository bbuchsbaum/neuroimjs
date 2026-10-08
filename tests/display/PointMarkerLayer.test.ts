import { describe, expect, it, vi } from 'vitest';
import { createPixiMock } from '../mocks/pixi.mock';

vi.mock('pixi.js', () => createPixiMock());

import { PointMarkerLayer } from '../../src/display/PointMarkerLayer';
import { NeuroSpace } from '../../src/geometry/NeuroSpace';
import { AxisSet3D, NamedAxis } from '../../src/geometry/Axis';

const axes = new AxisSet3D(NamedAxis.LEFT_RIGHT, NamedAxis.POST_ANT, NamedAxis.INF_SUP);
const space = new NeuroSpace([8, 8, 8], [1, 1, 1], [0, 0, 0], axes);
const ctx = {
  width: 100, height: 100,
  insets: { top: 0, right: 0, bottom: 0, left: 0 },
  project: (x: number, y: number) => ({ x: x * 10, y: y * 10 }),
};

describe('PointMarkerLayer', () => {
  it('uses viewer slice rounding and returns only markers it draws', () => {
    const layer = new PointMarkerLayer(space, axes);
    layer.setMarkers([
      { id: 'near', xyz: [3, 3, 3.4] },
      { id: 'other-slice', xyz: [3, 3, 4] },
      { id: 'out-of-grid', xyz: [12, 3, 3] },
    ]);
    expect(layer.worldToSliceIndex([3, 3, 3.4])).toBe(3);
    layer.renderSlice(3, [3, 3, 3], axes, {} as never);
    layer.layoutScreen(ctx);
    expect(layer.markersOnSlice()).toEqual(['near']);
    layer.renderSlice(4, [3, 3, 4], axes, {} as never);
    layer.layoutScreen(ctx);
    expect(layer.markersOnSlice()).toEqual(['other-slice']);
    layer.dispose();
  });

  it('applies slab thickness and viewport clipping to the query', () => {
    const layer = new PointMarkerLayer(space, axes);
    layer.setMarkers([{ id: 'a', xyz: [3, 3, 3.4] }], { slabMm: 0.5, shape: 'dot' });
    layer.renderSlice(3, [3, 3, 3], axes, {} as never);
    layer.layoutScreen(ctx);
    expect(layer.markersOnSlice()).toEqual([]);
    layer.setMarkers([{ id: 'a', xyz: [3, 3, 3.4] }], { slabMm: 1, shape: 'dot' });
    layer.renderSlice(3, [3, 3, 3], axes, {} as never);
    layer.layoutScreen({ ...ctx, width: 20 });
    expect(layer.markersOnSlice()).toEqual([]);
    layer.layoutScreen(ctx);
    expect(layer.markersOnSlice()).toEqual(['a']);
    layer.dispose();
  });
});
