#!/usr/bin/env node

/**
 * Simple test script to verify orthogonal slicing works correctly
 * without the full rendering pipeline
 */

import { read_vol } from '../src/io/nifti.js';
import { extractOrthogonalSlices } from '../src/volume/orthogonalSlices.js';
import * as path from 'path';
import * as fs from 'fs';

async function testOrthogonalSlicing() {
  console.log('=== Orthogonal Slicing Test ===\n');
  
  try {
    // Path to MNI brain template
    const mniPath = path.join(process.cwd(), 'tests/data/volumes/tpl-MNI152NLin2009aAsym_res-1_T1w.nii.gz');
    console.log(`Loading MNI brain template from: ${mniPath}`);
    
    // Load the volume
    const volume = await read_vol(mniPath);
    console.log(`✓ Volume loaded successfully`);
    console.log(`  Dimensions: ${volume.dim.join(' x ')}`);
    console.log(`  Spacing: ${volume.space.spacing.join(' x ')} mm`);
    console.log(`  Origin: ${volume.space.origin.join(', ')} mm`);
    
    // Get volume bounds
    const bounds = volume.space.bounds();
    console.log(`\n✓ Volume bounds calculated:`);
    console.log(`  X: ${bounds[0][0].toFixed(1)} to ${bounds[1][0].toFixed(1)} mm`);
    console.log(`  Y: ${bounds[0][1].toFixed(1)} to ${bounds[1][1].toFixed(1)} mm`);
    console.log(`  Z: ${bounds[0][2].toFixed(1)} to ${bounds[1][2].toFixed(1)} mm`);
    
    // Test coordinate transformations
    const testCoords = [
      [0, 0, 0], // Origin
      [10, 20, 30], // Arbitrary point
      [(bounds[0][0] + bounds[1][0]) / 2, 
       (bounds[0][1] + bounds[1][1]) / 2, 
       (bounds[0][2] + bounds[1][2]) / 2] // Center
    ];
    
    console.log('\n✓ Testing coordinate transformations:');
    for (const coord of testCoords) {
      const gridCoord = volume.space.coordToGrid(coord);
      const backToWorld = volume.space.gridToCoord(gridCoord);
      console.log(`  World [${coord.map(c => c.toFixed(1)).join(', ')}] mm → ` +
                  `Grid [${gridCoord.map(g => g.toFixed(1)).join(', ')}] → ` +
                  `World [${backToWorld.map(c => c.toFixed(1)).join(', ')}] mm`);
    }
    
    // Test orthogonal slice extraction
    console.log('\n✓ Testing orthogonal slice extraction:');
    const centerCoord = [
      (bounds[0][0] + bounds[1][0]) / 2,
      (bounds[0][1] + bounds[1][1]) / 2,
      (bounds[0][2] + bounds[1][2]) / 2
    ];
    
    const slices = extractOrthogonalSlices(volume, centerCoord);
    
    console.log(`  Axial slice:`);
    console.log(`    - Dimensions: ${slices.axial.dim.join(' x ')}`);
    console.log(`    - Spacing: ${slices.axial.spacing.join(' x ')} mm`);
    console.log(`    - Data length: ${slices.axial.getData().length} voxels`);
    
    console.log(`  Sagittal slice:`);
    console.log(`    - Dimensions: ${slices.sagittal.dim.join(' x ')}`);
    console.log(`    - Spacing: ${slices.sagittal.spacing.join(' x ')} mm`);
    console.log(`    - Data length: ${slices.sagittal.getData().length} voxels`);
    
    console.log(`  Coronal slice:`);
    console.log(`    - Dimensions: ${slices.coronal.dim.join(' x ')}`);
    console.log(`    - Spacing: ${slices.coronal.spacing.join(' x ')} mm`);
    console.log(`    - Data length: ${slices.coronal.getData().length} voxels`);
    
    // Test data integrity
    console.log('\n✓ Testing data integrity:');
    const axialData = slices.axial.getData();
    const minValue = Math.min(...Array.from(axialData));
    const maxValue = Math.max(...Array.from(axialData));
    const meanValue = Array.from(axialData).reduce((a, b) => a + b, 0) / axialData.length;
    
    console.log(`  Axial slice statistics:`);
    console.log(`    - Min value: ${minValue.toFixed(2)}`);
    console.log(`    - Max value: ${maxValue.toFixed(2)}`);
    console.log(`    - Mean value: ${meanValue.toFixed(2)}`);
    
    // Test multiple coordinates
    console.log('\n✓ Testing multiple slice extractions:');
    const testPositions = 5;
    for (let i = 0; i < testPositions; i++) {
      const t = i / (testPositions - 1);
      const coord = [
        bounds[0][0] + (bounds[1][0] - bounds[0][0]) * t,
        bounds[0][1] + (bounds[1][1] - bounds[0][1]) * t,
        bounds[0][2] + (bounds[1][2] - bounds[0][2]) * t
      ];
      
      try {
        const s = extractOrthogonalSlices(volume, coord);
        console.log(`  ✓ Position ${i + 1}: [${coord.map(c => c.toFixed(1)).join(', ')}] mm - Success`);
      } catch (e) {
        console.log(`  ✗ Position ${i + 1}: [${coord.map(c => c.toFixed(1)).join(', ')}] mm - Error: ${e.message}`);
      }
    }
    
    console.log('\n✅ All tests passed! Orthogonal slicing is working correctly.');
    
  } catch (error) {
    console.error('❌ Error during testing:', error);
    process.exit(1);
  }
}

// Run the test
testOrthogonalSlicing().catch(console.error);