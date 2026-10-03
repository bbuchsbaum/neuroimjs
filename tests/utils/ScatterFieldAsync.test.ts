import { afterEach, describe, expect, it, vi } from 'vitest';
import { NeuroSpace } from '../../src/geometry/NeuroSpace';
import { buildScatterFieldAsync } from '../../src/utils/ScatterFieldAsync';
import { buildScatterField } from '../../src/utils/ScatterFieldBuilder';

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

  const points = [
    { x: 1, y: 1, z: 1, value: 2 },
    { x: 0, y: 2, z: 1, value: 1 },
  ];

  // A worker whose script never loads (e.g. a UMD host that does not serve
  // the bundle's assets/ chunk) reports through onerror after postMessage.
  function stubWorker(behaviour: 'error' | 'silent' | 'messageerror') {
    const state = { terminated: 0, posted: 0 };
    vi.stubGlobal('Worker', class {
      onmessage: ((event: unknown) => void) | null = null;
      onerror: ((event: unknown) => void) | null = null;
      onmessageerror: ((event: unknown) => void) | null = null;
      postMessage() {
        state.posted++;
        if (behaviour === 'error') {
          setTimeout(() => this.onerror?.({ message: 'Failed to fetch worker script (404)' }), 0);
        } else if (behaviour === 'messageerror') {
          setTimeout(() => this.onmessageerror?.({}), 0);
        }
      }
      terminate() {
        state.terminated++;
      }
    });
    return state;
  }

  it('falls back to the synchronous build when the worker fails to load', async () => {
    const state = stubWorker('error');
    const expected = buildScatterField({ space, points, cutoffMm: 3 });
    const result = await buildScatterFieldAsync({ space, points, cutoffMm: 3 });
    expect(state.posted).toBe(1);
    expect(state.terminated).toBeGreaterThan(0);
    expect(Array.from(result.data)).toEqual(Array.from(expected.data));
    expect(result.maxValue).toBe(expected.maxValue);
    expect(result.nonZeroCount).toBe(expected.nonZeroCount);
    expect(result.volume.space.dim).toEqual(space.dim);
  });

  it('falls back to the synchronous build when the worker message is unreadable', async () => {
    stubWorker('messageerror');
    const expected = buildScatterField({ space, points, cutoffMm: 3 });
    const result = await buildScatterFieldAsync({ space, points, cutoffMm: 3 });
    expect(Array.from(result.data)).toEqual(Array.from(expected.data));
  });

  it('falls back to the synchronous build when the worker times out', async () => {
    const state = stubWorker('silent');
    const expected = buildScatterField({ space, points, cutoffMm: 3 });
    const result = await buildScatterFieldAsync({ space, points, cutoffMm: 3, workerTimeoutMs: 20 });
    expect(state.terminated).toBeGreaterThan(0);
    expect(Array.from(result.data)).toEqual(Array.from(expected.data));
  });
});
