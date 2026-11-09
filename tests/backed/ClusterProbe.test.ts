import { describe, it, expect } from 'vitest';
import { NeuroSpace } from '../../src/geometry/NeuroSpace';
import { FloatNeuroVol } from '../../src/volume/DenseNeuroVol';
import { VolLayer } from '../../src/display/VolLayer';
import { VolStack } from '../../src/display/VolStack';
import { ColorMapFactory } from '../../src/display/ColorMapFactory';
import { clusterAt, regrid, describeThreshold } from '../../src/backed/probe';
import { MemoryBacking } from '../../src/backed/MemoryBacking';
import { PlotPanel } from '../../src/backed/PlotPanel';
import { BackedView } from '../../src/backed/BackedView';
import { stackLayers } from '../../src/backed/Overlays';

// A 10×1×1 line of voxels at 2 mm: two positive blobs and one negative one.
const space = new NeuroSpace([10, 1, 1], [2, 2, 2], [0, 0, 0]);
const tvals = [0, 4, 5, 4, 0, 6, 1, -5, -4, 0];
const map = { space, values: tvals, threshold: [-3, 3] as const };
const at = (i: number) => [i * 2, 0, 0];

describe('clusterAt', () => {
  it('returns the connected, same-sign blob under the seed', () => {
    expect(clusterAt(map, at(2)).indices).toEqual([1, 2, 3]);
    expect(clusterAt(map, at(5)).indices).toEqual([5]);
    expect(clusterAt(map, at(8)).indices).toEqual([7, 8]);
  });
  it('is empty on a hidden voxel and follows the threshold', () => {
    expect(clusterAt(map, at(6)).indices).toEqual([]);
    expect(clusterAt({ ...map, threshold: [-4.5, 4.5] }, at(2)).indices).toEqual([2]);
    expect(clusterAt({ ...map, threshold: [-0.5, 0.5] }, at(5)).indices).toEqual([5, 6]);
  });
});

describe('regrid and describeThreshold', () => {
  it('maps indices to a coarser grid by position', () => {
    const coarse = new NeuroSpace([5, 1, 1], [4, 4, 4], [0, 0, 0]);
    expect(regrid([0, 1, 2, 3], space, coarse)).toEqual([0, 1, 2]);
    expect(regrid([1, 2], space, space)).toEqual([1, 2]);
  });
  it('words thresholds as a reader would', () => {
    expect(describeThreshold([-3.1, 3.1], 't')).toBe('|t| > 3.1');
    expect(describeThreshold([-1e9, 2.3], 'z')).toBe('z > 2.3');
    expect(describeThreshold([-2, 1e9], 'z')).toBe('z < −2');
    expect(describeThreshold([-1, 2], 't')).toBe('t outside [−1, 2]');
    expect(describeThreshold([-20, 2.3], 't', [-5.9, 5.9])).toBe('t > 2.3');
  });
});

describe('cluster probe in BackedView', () => {
  const design = ['s1', 's2', 's3'].map((subject) => ({ subject }));
  const data = design.map((_, r) => Float32Array.from({ length: 10 }, (_, i) => i + r));
  const backing = new MemoryBacking({ space, design, data });
  const layer = new VolLayer('tmap', new FloatNeuroVol(space, Float32Array.from(tvals)), ColorMapFactory.createHot({ range: [0, 6] }), [0, 6], [-3, 3]);
  const viewer = () => {
    const h: Record<string, ((...a: any[]) => void)[]> = {};
    return { on: (e: string, f: (...a: any[]) => void) => { (h[e] ??= []).push(f); return () => {}; },
      emit: (e: string, ...a: any[]) => (h[e] ?? []).forEach((f) => f(...a)) };
  };
  const tick = () => new Promise((r) => setTimeout(r, 0));

  it('needs the map layer', () => {
    expect(() => BackedView.attach(viewer(), backing, new PlotPanel(backing, { width: 300 }), { probe: { cluster: true } })).toThrow(/map/);
  });

  it('plots the clicked cluster and follows the threshold slider', async () => {
    layer.setThreshold([-3, 3]);
    const v = viewer();
    const panel = new PlotPanel(backing, { width: 300 });
    BackedView.attach(v, backing, panel, { probe: { cluster: true }, map: layer, stat: 't', selection: 'faces − houses' });
    v.emit('pointerDown', { worldCoord: at(2) });
    await tick();
    expect(panel.scene()!.voxels).toBe(3);
    expect(panel.scene()!.probe).toBe('cluster at 4 0 0, |t| > 3');
    expect(panel.element.textContent).toContain('faces − houses, |t| > 3');
    layer.setThreshold([-4.5, 4.5]); // the sidebar's threshold control
    await tick();
    expect(panel.scene()!.voxels).toBe(1);
    expect(panel.element.textContent).toContain('faces − houses, |t| > 4.5');
  });

  it('falls back to a sphere outside every cluster, and setProbe switches probes', async () => {
    layer.setThreshold([-3, 3]);
    const v = viewer();
    const panel = new PlotPanel(backing, { width: 300 });
    const view = BackedView.attach(v, backing, panel, { probe: { cluster: true, fallback: 'voxel' }, map: layer, stat: 't' })!;
    v.emit('pointerDown', { worldCoord: at(6) });
    await tick();
    expect(panel.scene()!.probe).toBe('voxel at 12 0 0, outside every cluster at |t| > 3');
    view.setProbe({ sphere: 2 });
    await tick();
    expect(panel.scene()!.probe).toBe('2 mm sphere at 12 0 0');
    expect(panel.scene()!.voxels).toBe(3);
    view.setProbe({ cluster: true, fallback: null });
    await tick();
    expect(panel.scene()!.voxels).toBe(0);
  });

  it('says so when the map layer is hidden, and stops when it is shown', async () => {
    layer.setThreshold([-3, 3]);
    const v = viewer();
    const panel = new PlotPanel(backing, { width: 300 });
    BackedView.attach(v, backing, panel, { probe: { cluster: true }, map: layer, stat: 't' });
    v.emit('pointerDown', { worldCoord: at(2) });
    await tick();
    expect(panel.element.querySelector('.nij-plot-note')).toBeNull();
    layer.setVisible(false);
    await tick();
    expect(panel.element.querySelector('.nij-plot-note')?.textContent).toBe(
      'The map (tmap) is hidden; this plot still shows the data behind it, and clusters still follow its threshold.');
    layer.setVisible(true);
    await tick();
    expect(panel.element.querySelector('.nij-plot-note')).toBeNull();
  });

  it('draws through a shared VolStack, as internal layers', async () => {
    const base = new VolLayer('base', new FloatNeuroVol(space, new Float32Array(10)), ColorMapFactory.createGrayscale({ range: [0, 1] }));
    const stack = new VolStack(base);
    const v = viewer();
    const panel = new PlotPanel(backing, { width: 300 });
    const view = BackedView.attach([v, viewer()], backing, panel, { probe: 'voxel', layers: stack })!;
    v.emit('pointerDown', { worldCoord: at(3) });
    await tick();
    const probe = stack.getLayerById('backed-probe')!;
    expect(probe.internal).toBe(true);
    expect(Array.from(probe.volume.getData() as Float32Array)).toEqual([0, 0, 0, 1, 0, 0, 0, 0, 0, 0]);
    v.emit('pointerDown', { worldCoord: at(5) });
    await tick();
    expect((probe.volume.getData() as Float32Array)[5]).toBe(1);
    panel.focusSubject('s2');
    await tick();
    expect(stack.getLayerById('backed-subject')?.visible).toBe(true);
    expect(stack.getLayerIds().at(-1)).toBe('backed-probe'); // the marker stays on top
    view.detach();
    expect(stack.getLayerIds()).toEqual(['base']);
    void stackLayers;
  });
});
