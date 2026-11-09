/**
 * BackedView against the real SimpleOrthogonalViewer (PIXI mocked, as in the
 * other viewer tests): clicks and coordinate changes drive the plot, the
 * probe is outlined on the brain, and pointing at a subject shows its map.
 */
import { describe, test, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { setupConsoleMocks } from '../display/test-console-mock';
import { createPixiMock } from '../mocks/pixi.mock';

vi.mock('pixi.js', () => createPixiMock());

import { SimpleOrthogonalViewer } from '../../src/display/SimpleOrthogonalViewer';
import { VolStack } from '../../src/display/VolStack';
import { VolLayer } from '../../src/display/VolLayer';
import { ColorMapFactory } from '../../src/display/ColorMapFactory';
import { NeuroSpace } from '../../src/geometry/NeuroSpace';
import { AxisSet3D, NamedAxis } from '../../src/geometry/Axis';
import { FloatNeuroVol } from '../../src/volume/DenseNeuroVol';
import { MemoryBacking } from '../../src/backed/MemoryBacking';
import { PlotPanel } from '../../src/backed/PlotPanel';
import { BackedView } from '../../src/backed/BackedView';

const N = 8;
const space = new NeuroSpace([N, N, N], [2, 2, 2], [-7, -7, -7],
  new AxisSet3D(NamedAxis.LEFT_RIGHT, NamedAxis.POST_ANT, NamedAxis.INF_SUP));
// Two subjects × two conditions; the value at a voxel is its x index, plus 10 for s2 and 1 for faces.
const design = ['s1', 's2'].flatMap((subject) => ['faces', 'houses'].map((cond) => ({ subject, cond })));
const data = design.map((r) => Float32Array.from({ length: N ** 3 }, (_, i) => (i % N) + (r.subject === 's2' ? 10 : 0) + (r.cond === 'faces' ? 1 : 0)));
const backing = new MemoryBacking({ space, design, data, valueLabel: 'β' });

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('BackedView on SimpleOrthogonalViewer', () => {
  let container: HTMLElement;
  let viewer: SimpleOrthogonalViewer;

  beforeAll(() => setupConsoleMocks());
  beforeEach(async () => {
    container = document.createElement('div');
    container.style.width = '600px';
    container.style.height = '400px';
    document.body.appendChild(container);
    const base = new VolLayer('base', new FloatNeuroVol(space, new Float32Array(N ** 3)), ColorMapFactory.createGrayscale({ range: [0, 1] }));
    viewer = await SimpleOrthogonalViewer.create(container, new VolStack(base), { showCrosshair: false, showSlider: false });
  });
  afterEach(() => { viewer.dispose(); container.remove(); });

  test('a coordinate change plots there and marks the probe', async () => {
    const panel = new PlotPanel(backing, { width: 400 });
    BackedView.attach(viewer, backing, panel, { probe: 'voxel' });
    viewer.setWorldCoord([-1, -1, -1]); // voxel x = 3
    await tick();
    const scene = panel.scene()!;
    expect(scene.voxels).toBe(1);
    expect(scene.circular).toBe(true);
    const ids = viewer.listLayers().map((l) => l.id);
    expect(ids).toContain('backed-probe');
    const vals = scene.panels[0].series.flatMap((s) => s.subjects.flatMap((sub) => sub.points.map((p) => p.y)));
    expect(vals.sort((a, b) => a - b)).toEqual([3, 4, 13, 14]);
  });

  test('pointer presses on the viewer commit a probe', async () => {
    const panel = new PlotPanel(backing, { width: 400 });
    BackedView.attach(viewer, backing, panel, { probe: { sphere: 2 } });
    (viewer as any).emitter.emit('pointerDown', { view: 'axial', world: [1, 1, 1] });
    await tick();
    expect(panel.scene()!.probe).toBe('2 mm sphere at 1 1 1');
  });

  test("pointing at a subject shows that subject's map, and leaving hides it", async () => {
    const panel = new PlotPanel(backing, { width: 400 });
    BackedView.attach(viewer, backing, panel);
    viewer.setWorldCoord([1, 1, 1]);
    await tick();
    panel.focusSubject('s2');
    await tick();
    const layer = () => viewer.listLayers().find((l) => l.id === 'backed-subject');
    expect(layer()?.visible).toBe(true);
    const vol = (viewer as any).imageLayer.getVolStack().getLayerById('backed-subject').volume as FloatNeuroVol;
    // s2's map: mean of faces and houses = x + 10.5
    expect((vol.getData() as Float32Array)[5]).toBeCloseTo(15.5, 5);
    panel.focusSubject(null);
    await tick();
    expect(layer()?.visible).toBe(false);
  });

  test('keeps to the levels the plot keeps', async () => {
    const panel = new PlotPanel(backing, { width: 400, spec: { keep: { cond: ['faces'] } } });
    BackedView.attach(viewer, backing, panel);
    viewer.setWorldCoord([1, 1, 1]);
    await tick();
    panel.focusSubject('s1');
    await tick();
    const vol = (viewer as any).imageLayer.getVolStack().getLayerById('backed-subject').volume as FloatNeuroVol;
    expect((vol.getData() as Float32Array)[5]).toBeCloseTo(6, 5); // x = 5, faces + 1
  });

  test('detach removes what it drew', async () => {
    const panel = new PlotPanel(backing, { width: 400 });
    const view = BackedView.attach(viewer, backing, panel)!;
    viewer.setWorldCoord([1, 1, 1]);
    await tick();
    panel.focusSubject('s1');
    await tick();
    view.detach();
    expect(viewer.listLayers().map((l) => l.id)).toEqual(['base']);
  });
});
