#!/usr/bin/env node
/**
 * Command-line utility to run multi-layer alignment test
 * Usage: npx tsx runAlignmentTest.ts [--visual] [--output ./output-dir]
 */

import { ImageLayer } from '../../ImageLayer.js';
import { VolStack } from '../../VolStack.js';
import { VolLayer } from '../../VolLayer.js';
import { NeuroVol } from '../../../volume/NeuroVol.js';
import { FloatNeuroVol } from '../../../volume/DenseNeuroVol.js';
import { NeuroSpace } from '../../../geometry/NeuroSpace.js';
import { ColorMapFactory } from '../../ColorMapFactory.js';
import { runVisualDebug } from './AlignmentVisualDebug.js';
import { AxisSet3D } from '../../../geometry/Axis.js';
import * as path from 'path';

/**
 * Create smooth brain volume
 */
function createBrainVolume(
  dims: [number, number, number],
  spacing: [number, number, number],
  brainSize: number = 120
): FloatNeuroVol {
  // Create standard LPI axes (neurological convention)
  const axes = AxisSet3D.AXIAL_LPI;
  
  const space = new NeuroSpace(
    dims,
    spacing,
    [0, 0, 0],
    axes
  );
  
  const data = new Float32Array(dims[0] * dims[1] * dims[2]);
  
  // World space center
  const center = [
    (dims[0] * spacing[0]) / 2,
    (dims[1] * spacing[1]) / 2,
    (dims[2] * spacing[2]) / 2
  ];
  
  const halfSize = brainSize / 2;
  const smoothness = 5;
  
  // Create smooth cube
  for (let k = 0; k < dims[2]; k++) {
    for (let j = 0; j < dims[1]; j++) {
      for (let i = 0; i < dims[0]; i++) {
        const worldX = i * spacing[0];
        const worldY = j * spacing[1];
        const worldZ = k * spacing[2];
        
        const dx = Math.abs(worldX - center[0]);
        const dy = Math.abs(worldY - center[1]);
        const dz = Math.abs(worldZ - center[2]);
        const maxDist = Math.max(dx, dy, dz);
        
        let value = 0;
        if (maxDist < halfSize - smoothness) {
          value = 1.0;
        } else if (maxDist < halfSize + smoothness) {
          const t = (halfSize + smoothness - maxDist) / (2 * smoothness);
          value = t * t * (3 - 2 * t);
        }
        
        const idx = i + j * dims[0] + k * dims[0] * dims[1];
        data[idx] = value;
      }
    }
  }
  
  return new FloatNeuroVol(space, data);
}

/**
 * Calculate statistics for the volumes
 */
function printVolumeStats(vol1: NeuroVol, vol2: NeuroVol): void {
  console.log('\n=== Volume Statistics ===');
  
  console.log('\nVolume 1:');
  console.log(`  Dimensions: ${vol1.dim.join('x')}`);
  console.log(`  Spacing: ${vol1.space.spacing.join('x')}mm`);
  console.log(`  FOV: ${vol1.dim.map((d: number, i: number) => d * vol1.space.spacing[i]).join('x')}mm`);
  
  console.log('\nVolume 2:');
  console.log(`  Dimensions: ${vol2.dim.join('x')}`);
  console.log(`  Spacing: ${vol2.space.spacing.join('x')}mm`);
  console.log(`  FOV: ${vol2.dim.map((d: number, i: number) => d * vol2.space.spacing[i]).join('x')}mm`);
  
  // Count non-zero voxels
  let count1 = 0, count2 = 0;
  const data1 = vol1.getData();
  const data2 = vol2.getData();
  for (let i = 0; i < data1.length; i++) {
    if (data1[i] > 0.5) count1++;
  }
  for (let i = 0; i < data2.length; i++) {
    if (data2[i] > 0.5) count2++;
  }
  
  console.log(`\nBrain voxels in volume 1: ${count1}`);
  console.log(`Brain voxels in volume 2: ${count2}`);
  
  // Calculate brain volume in mm³
  const voxelVol1 = vol1.space.spacing.reduce((a, b) => a * b, 1);
  const voxelVol2 = vol2.space.spacing.reduce((a, b) => a * b, 1);
  
  console.log(`\nBrain volume 1: ${(count1 * voxelVol1 / 1000).toFixed(1)} cm³`);
  console.log(`Brain volume 2: ${(count2 * voxelVol2 / 1000).toFixed(1)} cm³`);
}

/**
 * Main test runner
 */
async function runTest(): Promise<void> {
  console.log('Multi-Layer Alignment Test');
  console.log('==========================');
  
  // Parse command line arguments
  const args = process.argv.slice(2);
  const visual = args.includes('--visual');
  const outputIndex = args.indexOf('--output');
  const outputDir = outputIndex >= 0 ? args[outputIndex + 1] : './alignment-output';
  
  // Create test volumes
  console.log('\nCreating test volumes...');
  const volume1 = createBrainVolume([80, 80, 80], [2, 2, 2]);
  const volume2 = createBrainVolume([60, 60, 20], [2.4, 2.4, 4]);
  
  // Print statistics
  printVolumeStats(volume1, volume2);
  
  // Create colormaps
  const grayColorMap = ColorMapFactory.createGrayscale();
  const hotColorMap = ColorMapFactory.createHot();
  
  // Create volume stack
  console.log('\nCreating volume stack...');
  const layer1 = new VolLayer('anatomical', volume1, grayColorMap, [0, 1], [0, 0], 1.0);
  const layer2 = new VolLayer('overlay', volume2, hotColorMap, [0, 1], [0, 0], 0.5);

  const volStack = new VolStack(layer1, layer2);
  
  // Create image layer
  console.log('\nCreating image layer with alignment...');
  const imageLayer = new ImageLayer(volStack, {
    strategy: 'auto',
    enableCache: true,
    maintainAspectRatio: false
  });
  
  // Print alignment info
  console.log('\n=== Alignment Information ===');
  const alignmentOptions = imageLayer.getAlignmentOptions();
  console.log(`Strategy: ${alignmentOptions.strategy}`);
  console.log(`Cache enabled: ${alignmentOptions.enableCache}`);
  console.log(`Maintain aspect ratio: ${alignmentOptions.maintainAspectRatio}`);
  
  // Run visual debugging if requested
  if (visual) {
    console.log(`\nGenerating visual debug output to: ${outputDir}`);
    await runVisualDebug(imageLayer, volStack, outputDir);
    console.log('Visual debugging complete!');
    console.log(`Open ${path.join(outputDir, 'index.html')} in a browser to view results.`);
  }
  
  // Calculate expected alignment parameters
  console.log('\n=== Expected Alignment Parameters ===');
  console.log('Volume 2 → Volume 1 scaling:');
  console.log(`  X axis: ${(2.0 / 2.4).toFixed(3)} (${((2.0 / 2.4) * 100).toFixed(1)}%)`);
  console.log(`  Y axis: ${(2.0 / 2.4).toFixed(3)} (${((2.0 / 2.4) * 100).toFixed(1)}%)`);
  console.log(`  Z axis: ${(2.0 / 4.0).toFixed(3)} (${((2.0 / 4.0) * 100).toFixed(1)}%)`);
  
  // Test a few slices
  console.log('\n=== Testing Alignment ===');
  const testSlices = [30, 40, 50];
  const axes = ['XYZ', 'YZX', 'XZY'];
  const axisNames = ['Axial', 'Sagittal', 'Coronal'];
  
  for (let i = 0; i < axes.length; i++) {
    console.log(`\n${axisNames[i]} view:`);
    const { AxisSet3D } = await import('../../../geometry/Axis.js');
    const axis = AxisSet3D.fromStr(axes[i]);
    
    for (const slice of testSlices) {
      const { Container } = await import('pixi.js');
      const container = imageLayer.renderSlice(slice, [40, 40, 40], axis, new Container());
      if (container) {
        console.log(`  Slice ${slice}: ✓ Rendered successfully`);
      }
    }
  }
  
  // Print memory and cache statistics
  console.log('\n=== Performance Statistics ===');
  const memStats = imageLayer.getMemoryStats();
  console.log(`Texture memory: ${memStats.textureMemory.count} textures, ${(memStats.textureMemory.size / 1024 / 1024).toFixed(2)} MB`);
  console.log(`Alignment cache: ${memStats.alignment.size} entries`);
  
  // Cleanup
  imageLayer.dispose();
  console.log('\nTest complete!');
}

// Run the test
runTest().catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});
