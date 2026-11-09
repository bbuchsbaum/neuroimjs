import { describe, it, expect } from 'vitest';
import { NeuroSpace } from '../../src/geometry/NeuroSpace';
import { MemoryBacking } from '../../src/backed/MemoryBacking';
import { PlotPanel } from '../../src/backed/PlotPanel';
import { BackedView } from '../../src/backed/BackedView';

function fakeViewer() {
  const handlers: Record<string, ((...a: any[]) => void)[]> = {};
  return {
    on: (ev: string, h: (...a: any[]) => void) => {
      (handlers[ev] ??= []).push(h);
      return () => { handlers[ev] = handlers[ev].filter((x) => x !== h); };
    },
    emit: (ev: string, ...a: any[]) => (handlers[ev] ?? []).forEach((h) => h(...a)),
    count: (ev: string) => (handlers[ev] ?? []).length,
  };
}

const space = new NeuroSpace([3, 3, 3], [2, 2, 2], [-2, -2, -2]);
const design = ['s1', 's2', 's3'].flatMap((subject) => ['a', 'b'].map((cond) => ({ subject, cond })));
const backing = new MemoryBacking({
  space, design, data: design.map((r, i) => new Float32Array(27).fill(i + (r.cond === 'a' ? 1 : 0))),
});

describe('BackedView', () => {
  it('does nothing without backing data', () => {
    const v = fakeViewer();
    expect(BackedView.attach(v, null, new PlotPanel(backing, { width: 300 }))).toBeNull();
    expect(v.count('pointerDown')).toBe(0);
  });

  it('plots at a click, marked circular by default', async () => {
    const v = fakeViewer();
    const panel = new PlotPanel(backing, { width: 300 });
    BackedView.attach(v, backing, panel, { probe: 'voxel' });
    v.emit('pointerDown', { worldCoord: [0, 0, 0] });
    await Promise.resolve();
    const scene = panel.scene()!;
    expect(scene.voxels).toBe(1);
    expect(scene.circular).toBe(true);
    expect(panel.element.textContent).toContain('Circular');
  });

  it('is not circular when the map is declared independent', async () => {
    const v = fakeViewer();
    const panel = new PlotPanel(backing, { width: 300 });
    BackedView.attach(v, backing, panel, { independent: 'a priori ROI' });
    v.emit('coordChanged', [0, 0, 0]);
    await Promise.resolve();
    expect(panel.scene()!.circular).toBe(false);
    expect(panel.element.textContent).not.toContain('Circular');
    expect(panel.element.textContent).toContain('Region chosen independently: a priori ROI.');
  });

  it('shows the newest probe when answers arrive out of order', async () => {
    const delays = [30, 0];
    const slow = Object.assign(Object.create(Object.getPrototypeOf(backing)), backing, {
      extract(p: any) {
        const ms = delays.shift() ?? 0;
        return new Promise((res) => setTimeout(() => res(backing.extract(p)), ms));
      },
    });
    const v = fakeViewer();
    const panel = new PlotPanel(backing, { width: 300 });
    BackedView.attach(v, slow, panel, { probe: 'voxel', hover: false });
    v.emit('pointerDown', { worldCoord: [-2, -2, -2] }); // slow, older
    v.emit('pointerDown', { worldCoord: [0, 0, 0] }); // fast, newer
    await new Promise((r) => setTimeout(r, 60));
    expect(panel.scene()!.probe).toBe('voxel at 0 0 0');
  });

  it('detaches its listeners', () => {
    const v = fakeViewer();
    const view = BackedView.attach(v, backing, new PlotPanel(backing, { width: 300 }))!;
    expect(v.count('pointerDown')).toBe(1);
    view.detach();
    expect(v.count('pointerDown')).toBe(0);
    expect(v.count('pointerMove')).toBe(0);
  });
});
