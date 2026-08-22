import { afterEach, describe, expect, it, vi } from 'vitest';
import { NeuroSpace } from '../../src/geometry/NeuroSpace';
import { buildScatterFieldAsync } from '../../src/utils/ScatterFieldAsync';

describe('buildScatterFieldAsync fallback contracts', () => {
  const space = new NeuroSpace([3, 3, 3]);

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('runs custom callback kernels synchronously instead of trying to clone them', async () => {
    let workersConstructed = 0;
    vi.stubGlobal('Worker', class {
      constructor() {
        workersConstructed++;
      }
    });

    const result = await buildScatterFieldAsync({
      space,
      points: [{ x: 0, y: 0, z: 0 }],
      kernel: () => 2,
      cutoffMm: 0,
    });

    expect(workersConstructed).toBe(0);
    expect(result.data[0]).toBe(2);
  });

  it('rejects invalid worker timeouts before constructing a worker', async () => {
    let workersConstructed = 0;
    vi.stubGlobal('Worker', class {
      constructor() {
        workersConstructed++;
      }
    });

    await expect(buildScatterFieldAsync({
      space,
      points: [{ x: 0, y: 0, z: 0 }],
      workerTimeoutMs: 0,
    })).rejects.toThrow('workerTimeoutMs must be a positive finite number');
    expect(workersConstructed).toBe(0);
  });
});
