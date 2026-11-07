import { describe, it, expect } from 'vitest';
import { NeuroSpace } from '../../src/geometry/NeuroSpace';
import { MemoryBacking } from '../../src/backed/MemoryBacking';
import { PlotPanel } from '../../src/backed/PlotPanel';
import { voxel } from '../../src/backed/probe';

const space = new NeuroSpace([1, 1, 1], [2, 2, 2], [0, 0, 0]);
const vals = [0.4, 0.5, 0.45, 0.6, 0.55, 0.5, 0.48, 3.0];
const design = vals.map((_, i) => ({ subject: `s${i + 1}` }));
const backing = new MemoryBacking({ space, design, data: vals.map((v) => Float32Array.of(v)) });

describe('one value per subject', () => {
  it('rings and counts subjects beyond 1.5 × IQR', () => {
    const panel = new PlotPanel(backing, { width: 360, controls: false });
    panel.show(backing.extract(voxel([0, 0, 0])));
    expect(panel.element.querySelectorAll('.nij-flag')).toHaveLength(1);
    expect(panel.element.textContent).toContain('1 beyond 1.5 × IQR (ringed)');
  });
  it('shows a covariate fit with Spearman ρ alongside r', () => {
    const cov = new MemoryBacking({ space, design: design.map((d, i) => ({ ...d, age: 20 + i })), data: vals.map((v) => Float32Array.of(v)),
      columns: [{ name: 'age', kind: 'numeric' }] });
    const panel = new PlotPanel(cov, { width: 400, spec: { x: 'age' }, controls: false });
    panel.show(cov.extract(voxel([0, 0, 0])));
    expect(panel.element.textContent).toMatch(/r = 0\.\d\d, p = \.\d+, n = 8.*Spearman ρ = 0\.\d\d/);
  });
});
