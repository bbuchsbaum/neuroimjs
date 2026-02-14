#!/usr/bin/env node

/**
 * This script loads the MNI template NIfTI file and pretty prints its NeuroSpace information.
 * This version uses a more direct approach to avoid browser dependencies.
 * Run with: node tests/scripts/print_mni_space.js
 */

import * as path from 'path';
import { fileURLToPath } from 'url';
import * as fs from 'fs/promises';
import * as nifti from 'nifti-reader-js';
import { Matrix, determinant } from 'ml-matrix';

// Get the directory name in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to the MNI template file
const mniFilePath = path.join(__dirname, '../data/volumes/tpl-MNI152NLin2009aAsym_res-1_T1w.nii.gz');

// Simple implementation of NeuroSpace for this script
class SimpleNeuroSpace {
  constructor(dim, spacing, origin, affine) {
    this.dim = dim;
    this.spacing = spacing;
    this.origin = origin;
    this.affine = affine;
  }

  prettyPrint() {
    console.log('=== NeuroSpace ====');
    console.log(`Dimensions: ${this.dim.join(' × ')}`);
    console.log(`Spacing: [${this.spacing.map(v => v.toFixed(2)).join(', ')}]`);
    console.log(`Origin: [${this.origin.map(v => v.toFixed(2)).join(', ')}]`);
    
    // Determine axis orientations based on the affine matrix
    const orientations = this.determineOrientations();
    console.log(`\nAxis Orientations:`);
    console.log(`X-axis: ${orientations.x}`);
    console.log(`Y-axis: ${orientations.y}`);
    console.log(`Z-axis: ${orientations.z}`);
    
    console.log('\nTransformation Matrix:');
    this.affine.to2DArray().forEach(row => {
      console.log('  ' + row.map(v => v.toFixed(4).padStart(10)).join(' '));
    });
    
    // Calculate determinant using the imported determinant function
    const subMatrix = this.affine.subMatrix(0, this.dim.length - 1, 0, this.dim.length - 1);
    const det = determinant(subMatrix);
    console.log(`\nDeterminant: ${det.toFixed(4)}`);
  }
}

async function main() {
  try {
    console.log('Loading MNI template file:', mniFilePath);
    console.log('This may take a moment...');
    
    // Read the file
    const data = await fs.readFile(mniFilePath);
    const buffer = data.buffer;
    
    // Decompress if needed
    let niftiBuffer = buffer;
    if (nifti.isCompressed(buffer)) {
      console.log('File is compressed. Decompressing...');
      niftiBuffer = nifti.decompress(buffer);
      console.log('Decompression complete.');
    }
    
    if (!nifti.isNIFTI(niftiBuffer)) {
      throw new Error('The file is not a valid NIfTI file.');
    }
    
    // Read the header
    const header = nifti.readHeader(niftiBuffer);
    if (!header) {
      throw new Error('NIfTI header is null or undefined');
    }
    
    // Extract dimensions, spacing, origin, and affine matrix
    const dim = Array.from(header.dims.slice(1, 4));
    const spacing = Array.from(header.pixDims.slice(1, 4));
    const origin = [header.affine[0][3], header.affine[1][3], header.affine[2][3]];
    const affine = new Matrix(header.affine);
    
    // Create a simple NeuroSpace object
    const space = new SimpleNeuroSpace(dim, spacing, origin, affine);
    
    console.log('\nMNI Template Volume Information:');
    console.log('-------------------------------');
    
    // Display the NeuroSpace information
    space.prettyPrint();
    
    // Read the image data for basic statistics
    const imageBuffer = nifti.readImage(header, niftiBuffer);
    
    // Determine the data type and create the appropriate TypedArray
    let dataArray;
    switch (header.datatypeCode) {
      case nifti.NIFTI1.TYPE_INT8: dataArray = new Int8Array(imageBuffer); break;
      case nifti.NIFTI1.TYPE_UINT8: dataArray = new Uint8Array(imageBuffer); break;
      case nifti.NIFTI1.TYPE_INT16: dataArray = new Int16Array(imageBuffer); break;
      case nifti.NIFTI1.TYPE_UINT16: dataArray = new Uint16Array(imageBuffer); break;
      case nifti.NIFTI1.TYPE_INT32: dataArray = new Int32Array(imageBuffer); break;
      case nifti.NIFTI1.TYPE_UINT32: dataArray = new Uint32Array(imageBuffer); break;
      case nifti.NIFTI1.TYPE_FLOAT32: dataArray = new Float32Array(imageBuffer); break;
      case nifti.NIFTI1.TYPE_FLOAT64: dataArray = new Float64Array(imageBuffer); break;
      default: throw new Error(`Unsupported data type: ${header.datatypeCode}`);
    }
    
    // Calculate basic statistics
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    let nonZeroCount = 0;
    
    // Sample a subset of voxels for performance
    const totalVoxels = dataArray.length;
    const sampleSize = Math.min(100000, totalVoxels);
    const sampleInterval = Math.floor(totalVoxels / sampleSize);
    
    for (let i = 0; i < totalVoxels; i += sampleInterval) {
      const value = dataArray[i];
      min = Math.min(min, value);
      max = Math.max(max, value);
      sum += value;
      if (value !== 0) nonZeroCount++;
    }
    
    const sampledVoxels = Math.ceil(totalVoxels / sampleInterval);
    const mean = sum / sampledVoxels;
    
    console.log('\nVolume Data Information:');
    console.log('----------------------');
    console.log(`Data Type: ${header.datatypeCode}`);
    console.log(`Number of Voxels: ${totalVoxels}`);
    console.log(`Statistics based on ${sampledVoxels} sampled voxels:`);
    console.log(`Min Value: ${min}`);
    console.log(`Max Value: ${max}`);
    console.log(`Mean Value: ${mean.toFixed(2)}`);
    console.log(`Non-Zero Voxels in Sample: ${nonZeroCount} (${(nonZeroCount / sampledVoxels * 100).toFixed(2)}%)`);
    
  } catch (error) {
    console.error('Error loading or processing the MNI template:', error);
    console.error(error.stack);
  }
}

// Run the main function
main(); 