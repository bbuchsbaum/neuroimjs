#!/usr/bin/env ts-node

/**
 * This script loads the MNI template NIfTI file and pretty prints its NeuroSpace information.
 * Run with: npx ts-node tests/scripts/print_mni_volume.ts
 */

import * as path from 'path';
import { read_vol } from '../../src/io/nifti';
import { NeuroVol } from '../../src/volume/NeuroVol';
import { NeuroSpace } from '../../src/geometry/NeuroSpace';

// Path to the MNI template file
const mniFilePath = path.join(__dirname, '../data/volumes/tpl-MNI152NLin2009aAsym_res-1_T1w.nii.gz');

async function main(): Promise<void> {
  try {
    console.log('Loading MNI template file:', mniFilePath);
    console.log('This may take a moment...');
    
    // Load the NIfTI file
    const volume: NeuroVol = await read_vol(mniFilePath);
    
    console.log('\nMNI Template Volume Information:');
    console.log('-------------------------------');
    
    // Get the NeuroSpace from the volume
    const space: NeuroSpace = volume.space;
    
    // Use the prettyPrint method to display the NeuroSpace information
    space.prettyPrint();
    
    // Print some additional volume information
    console.log('\nVolume Data Information:');
    console.log('----------------------');
    
    // Get volume dimensions
    const dims = volume.dim;
    const totalVoxels = dims[0] * dims[1] * dims[2];
    console.log(`Dimensions: ${dims.join(' × ')}`);
    console.log(`Total Voxels: ${totalVoxels}`);
    
    // Calculate some basic statistics
    // Note: We need to iterate through the volume using linear indices
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    let nonZeroCount = 0;
    
    // Sample statistics from a subset of voxels (for performance)
    const sampleSize = Math.min(100000, totalVoxels);
    const sampleInterval = Math.floor(totalVoxels / sampleSize);
    
    for (let i = 0; i < totalVoxels; i += sampleInterval) {
      // Get the value at this linear index
      const value = volume.get(i);
      
      min = Math.min(min, value);
      max = Math.max(max, value);
      sum += value;
      if (value !== 0) nonZeroCount++;
    }
    
    const sampledVoxels = Math.ceil(totalVoxels / sampleInterval);
    const mean = sum / sampledVoxels;
    
    console.log(`Statistics based on ${sampledVoxels} sampled voxels:`);
    console.log(`Min Value: ${min}`);
    console.log(`Max Value: ${max}`);
    console.log(`Mean Value: ${mean.toFixed(2)}`);
    console.log(`Non-Zero Voxels in Sample: ${nonZeroCount} (${(nonZeroCount / sampledVoxels * 100).toFixed(2)}%)`);
    
    // Print some additional NeuroSpace information
    console.log('\nAdditional NeuroSpace Information:');
    console.log('--------------------------------');
    console.log(`Dimensions: ${space.dim.join(' × ')}`);
    console.log(`Spacing: ${space.spacing.map(v => v.toFixed(2)).join(' × ')}`);
    console.log(`Origin: [${space.origin.map(v => v.toFixed(2)).join(', ')}]`);
    
    // Print the centroid
    const centroid = space.centroid();
    console.log(`Centroid: [${centroid.map(v => v.toFixed(2)).join(', ')}]`);
    
    // Print the bounds
    const [minBound, maxBound] = space.bounds();
    console.log(`Bounds: Min [${minBound.map(v => v.toFixed(2)).join(', ')}], Max [${maxBound.map(v => v.toFixed(2)).join(', ')}]`);
    
  } catch (error) {
    console.error('Error loading or processing the MNI template:', error);
  }
}

// Run the main function
main(); 