/**
 * Example showing how Python tests are converted to TypeScript
 */

// Example Python test:
const pythonTest = `
import pytest
import numpy as np
from pyneuroim import NeuroSpace, DenseNeuroVol, spherical_roi
from pyneuroim.io import read_vol, write_vol

class TestNeuroVol:
    def test_creation(self):
        space = NeuroSpace([10, 10, 10], [1, 1, 1], [0, 0, 0])
        data = np.zeros((10, 10, 10))
        vol = DenseNeuroVol(space, data)
        
        assert vol.shape == (10, 10, 10)
        assert len(vol) == 1000
        assert vol[5, 5, 5] == 0
    
    def test_roi_extraction(self):
        space = NeuroSpace([20, 20, 20], [2, 2, 2], [0, 0, 0])
        data = np.random.rand(20, 20, 20)
        vol = DenseNeuroVol(space, data)
        
        roi = spherical_roi([10, 10, 10], 5, space)
        extracted = vol[roi]
        
        assert extracted.shape[0] > 0
        assert np.all(extracted >= 0)
    
    @pytest.mark.asyncio
    async def test_io(self, tmp_path):
        space = NeuroSpace([5, 5, 5], [1, 1, 1], [0, 0, 0])
        data = np.arange(125).reshape(5, 5, 5)
        vol = DenseNeuroVol(space, data)
        
        file_path = tmp_path / "test.nii"
        write_vol(vol, str(file_path))
        
        loaded = read_vol(str(file_path))
        assert loaded.shape == vol.shape
        np.testing.assert_array_almost_equal(loaded.data, vol.data)
`;

// Converted TypeScript test:
const typescriptTest = `
import { describe, it, expect, beforeEach } from 'vitest';
import { NeuroSpace } from '../src/geometry/NeuroSpace';
import { FloatNeuroVol } from '../src/volume/DenseNeuroVol';
import { sphericalROI } from '../src/roi/ROI_factories';
import { readVol, writeVol } from '../src/io/io';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';

describe('NeuroVol', () => {
  it('should creation', async () => {
    const space = new NeuroSpace([10, 10, 10], [1, 1, 1], [0, 0, 0]);
    const data = new Float32Array(10 * 10 * 10);
    const vol = new FloatNeuroVol(space, data);
    
    expect(vol.dim).toEqual([10, 10, 10]);
    expect(vol.length).toEqual(1000);
    expect(vol.getAt(5, 5, 5)).toEqual(0);
  });
  
  it('should roi extraction', async () => {
    const space = new NeuroSpace([20, 20, 20], [2, 2, 2], [0, 0, 0]);
    const data = Float32Array.from({ length: 20 * 20 * 20 }, () => Math.random());
    const vol = new FloatNeuroVol(space, data);
    
    const roi = sphericalROI([10, 10, 10], 5, space);
    const extracted = vol.getDataFromROI(roi);
    
    expect(extracted.length).toBeGreaterThan(0);
    expect(Array.from(extracted).every(v => v >= 0)).toBeTruthy();
  });
  
  it('should io', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'neuro-test-'));
    const space = new NeuroSpace([5, 5, 5], [1, 1, 1], [0, 0, 0]);
    const data = Float32Array.from({ length: 125 }, (_, i) => i);
    const vol = new FloatNeuroVol(space, data);
    
    const filePath = path.join(tempDir, "test.nii");
    await writeVol(vol, filePath);
    
    const loaded = await readVol(filePath);
    expect(loaded.dim).toEqual(vol.dim);
    
    const loadedData = loaded.getData();
    const volData = vol.getData();
    for (let i = 0; i < loadedData.length; i++) {
      expect(loadedData[i]).toBeCloseTo(volData[i]);
    }
    
    // Cleanup
    await fs.rm(tempDir, { recursive: true, force: true });
  });
});
`;

console.log('=== Python to TypeScript Test Conversion Example ===\n');
console.log('Original Python test:');
console.log('```python' + pythonTest + '```\n');
console.log('Converted TypeScript test:');
console.log('```typescript' + typescriptTest + '```\n');
console.log('Key conversions:');
console.log('- pytest → vitest');
console.log('- numpy arrays → TypedArrays');
console.log('- assert statements → expect assertions');
console.log('- Python imports → TypeScript imports');
console.log('- Async/await patterns preserved');
console.log('- Temporary file handling adapted');