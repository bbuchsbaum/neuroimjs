import { describe, it, expect } from 'vitest';
import {
  ConnectedComponents,
  clusterTable,
  localMaxima,
  Connectivity
} from '../../src/roi/ConnectedComponents';
import { FloatNeuroVol } from '../../src/volume/DenseNeuroVol';
import { UInt8NeuroVol } from '../../src/volume/DenseNeuroVol';
import { NeuroSpace } from '../../src/geometry/NeuroSpace';

describe('ConnectedComponents', () => {
  const space = new NeuroSpace([10, 10, 10], [1, 1, 1], [0, 0, 0]);
  const n = 1000;

  /** Create a volume with two spherical blobs. */
  function makeBlobVolume(): { values: FloatNeuroVol; mask: UInt8NeuroVol } {
    const vd = new Float32Array(n);
    const md = new Uint8Array(n);

    // Blob 1: center (2,2,2), radius 1.5, peak=10
    // Blob 2: center (7,7,7), radius 1.5, peak=8
    for (let k = 0; k < 10; k++) {
      for (let j = 0; j < 10; j++) {
        for (let i = 0; i < 10; i++) {
          const idx = i + j * 10 + k * 100;
          const d1 = Math.sqrt((i - 2) ** 2 + (j - 2) ** 2 + (k - 2) ** 2);
          const d2 = Math.sqrt((i - 7) ** 2 + (j - 7) ** 2 + (k - 7) ** 2);
          if (d1 <= 1.5) {
            vd[idx] = 10 - d1 * 2;
            md[idx] = 1;
          } else if (d2 <= 1.5) {
            vd[idx] = 8 - d2 * 2;
            md[idx] = 1;
          }
        }
      }
    }
    return {
      values: new FloatNeuroVol(space, vd),
      mask: new UInt8NeuroVol(space, md),
    };
  }

  describe('performConnectedComponents', () => {
    it('finds two clusters from two blobs', () => {
      const { values, mask } = makeBlobVolume();
      const result = ConnectedComponents.performConnectedComponents(
        values, mask, 1, Connectivity.TwentySix
      );

      expect(result.clusters.length).toBe(2);
      // Sorted by size descending → both blobs should appear
      expect(result.clusters[0].size).toBeGreaterThan(0);
      expect(result.clusters[1].size).toBeGreaterThan(0);
    });

    it('index volume labels match cluster count', () => {
      const { values, mask } = makeBlobVolume();
      const result = ConnectedComponents.performConnectedComponents(
        values, mask, 1, Connectivity.TwentySix
      );
      const data = result.indexVolume.getData();
      const labels = new Set<number>();
      for (let i = 0; i < data.length; i++) {
        if (data[i] > 0) labels.add(data[i]);
      }
      expect(labels.size).toBe(2);
    });
  });

  describe('clusterTable', () => {
    it('returns enriched entries for each cluster', () => {
      const { values, mask } = makeBlobVolume();
      const result = ConnectedComponents.performConnectedComponents(
        values, mask, 1, Connectivity.TwentySix
      );
      const table = clusterTable(result, values);

      expect(table.length).toBe(2);
      for (const entry of table) {
        expect(entry.size).toBeGreaterThan(0);
        expect(entry.meanValue).toBeGreaterThan(0);
        expect(entry.maxValue).toBeGreaterThan(0);
        expect(entry.centerOfMass).toHaveLength(3);
        expect(entry.centerOfMassWorld).toHaveLength(3);
        expect(entry.maxLocation).toHaveLength(3);
      }
    });

    it('max location is within the cluster', () => {
      const { values, mask } = makeBlobVolume();
      const result = ConnectedComponents.performConnectedComponents(
        values, mask, 1, Connectivity.TwentySix
      );
      const table = clusterTable(result, values);
      const indexData = result.indexVolume.getData();

      for (const entry of table) {
        const [i, j, k] = entry.maxLocation;
        const idx = i + j * 10 + k * 100;
        expect(indexData[idx]).toBe(entry.id);
      }
    });
  });

  describe('localMaxima', () => {
    it('finds peaks in each cluster', () => {
      const { values, mask } = makeBlobVolume();
      const result = ConnectedComponents.performConnectedComponents(
        values, mask, 1, Connectivity.TwentySix
      );
      const peaks = localMaxima(values, result.indexVolume);

      expect(peaks.length).toBeGreaterThanOrEqual(2);
      // Each cluster should have at least one peak
      const clusterIds = new Set(peaks.map(p => p.clusterId));
      expect(clusterIds.size).toBe(2);
    });

    it('minDistance filters nearby peaks', () => {
      const { values, mask } = makeBlobVolume();
      const result = ConnectedComponents.performConnectedComponents(
        values, mask, 1, Connectivity.TwentySix
      );
      const allPeaks = localMaxima(values, result.indexVolume);
      const filtered = localMaxima(values, result.indexVolume, 100);

      // With a very large minDistance, only one peak per cluster
      const clusterIds = new Set(filtered.map(p => p.clusterId));
      for (const cid of clusterIds) {
        const peaks = filtered.filter(p => p.clusterId === cid);
        expect(peaks.length).toBe(1);
      }
    });
  });
});
