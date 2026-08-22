#!/usr/bin/env node

/**
 * This script loads the Schaefer atlas and pretty prints its NeuroSpace information.
 * Run with: node tests/scripts/print_atlas_space.js
 */

import * as path from 'path';
import { fileURLToPath } from 'url';
import * as fs from 'fs/promises';
import * as nifti from 'nifti-reader-js';
import { Matrix, determinant } from 'ml-matrix';

// Try to import NeuroSpace directly from the source file
try {
  var { NeuroSpace } = await import('../../src/geometry/NeuroSpace.js');
  console.log("Successfully imported NeuroSpace from source file");
} catch (error) {
  console.warn("Could not import NeuroSpace from source:", error.message);
  console.warn("Using simplified implementation instead");
  // We'll use the SimpleNeuroSpace implementation as fallback
}

// Get the directory name in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Simplified implementation of NamedAxis and AxisSet3D for this script
class NamedAxis {
  constructor(name) {
    this.name = name;
  }
  
  equals(other) {
    return this.name === other.name;
  }
}

class AxisSet3D {
  constructor(i, j, k) {
    this.i = i;
    this.j = j;
    this.k = k;
  }
  
  axes() {
    return [this.i, this.j, this.k];
  }
  
  static get AXIAL_LPI() {
    return new AxisSet3D(
      new NamedAxis('Left'),
      new NamedAxis('Posterior'),
      new NamedAxis('Inferior')
    );
  }
}

// Simple implementation of NeuroSpace for this script (used as fallback)
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

  determineOrientations() {
    // Extract the rotation part of the affine matrix (first 3x3 submatrix)
    const rotationMatrix = this.affine.subMatrix(0, 2, 0, 2);
    
    // Normalize each column to get the direction cosines
    const directions = [];
    for (let col = 0; col < 3; col++) {
      const column = rotationMatrix.getColumn(col);
      const magnitude = Math.sqrt(column.reduce((sum, val) => sum + val * val, 0));
      directions.push(column.map(val => val / magnitude));
    }
    
    // Determine the primary orientation of each axis
    const axisNames = ['Right-Left', 'Anterior-Posterior', 'Inferior-Superior'];
    const orientations = {};
    
    // Helper function to determine the orientation name
    const getOrientationName = (direction) => {
      const absDirection = direction.map(Math.abs);
      const maxIndex = absDirection.indexOf(Math.max(...absDirection));
      const sign = Math.sign(direction[maxIndex]);
      
      const orientationPairs = [
        ['Right', 'Left'],
        ['Anterior', 'Posterior'],
        ['Inferior', 'Superior']
      ];
      
      return sign > 0 ? orientationPairs[maxIndex][0] : orientationPairs[maxIndex][1];
    };
    
    orientations.x = getOrientationName(directions[0]);
    orientations.y = getOrientationName(directions[1]);
    orientations.z = getOrientationName(directions[2]);
    
    return orientations;
  }
  
  // Simple implementation of reorient method
  reorient(targetAxes) {
    console.log(`Reorienting to: ${targetAxes.i.name}-${targetAxes.j.name}-${targetAxes.k.name}`);
    
    // For demonstration, we'll just create a new SimpleNeuroSpace with the same dimensions
    // but with a modified affine matrix that would represent the reorientation
    // In a real implementation, this would involve complex matrix transformations
    
    // Create a simple rotation matrix for demonstration
    const newAffine = new Matrix(this.affine.rows, this.affine.columns);
    
    // Copy the original matrix
    for (let i = 0; i < this.affine.rows; i++) {
      for (let j = 0; j < this.affine.columns; j++) {
        newAffine.set(i, j, this.affine.get(i, j));
      }
    }
    
    // Modify the rotation part to simulate reorientation
    // This is a simplified example - real reorientation would be more complex
    if (targetAxes.i.name === 'Left') newAffine.set(0, 0, -Math.abs(newAffine.get(0, 0)));
    if (targetAxes.j.name === 'Posterior') newAffine.set(1, 1, -Math.abs(newAffine.get(1, 1)));
    if (targetAxes.k.name === 'Inferior') newAffine.set(2, 2, -Math.abs(newAffine.get(2, 2)));
    
    return new SimpleNeuroSpace(
      [...this.dim], // Copy dimensions
      [...this.spacing], // Copy spacing
      [...this.origin], // Copy origin
      newAffine // Use the new affine matrix
    );
  }
}

// Use the imported NeuroSpace or fallback to SimpleNeuroSpace
const ActualNeuroSpace = typeof NeuroSpace !== 'undefined' ? NeuroSpace : SimpleNeuroSpace;

// Simple implementation of NeuroAtlas for this script
class SimpleNeuroAtlas {
  static async loadSchaeferAtlas({ parcels = 400, networks = 17, resolution = 2 }) {
    // Convert numbers to strings for URL construction
    const parcelsStr = parcels.toString();
    const networksStr = networks.toString();
    const resolutionStr = resolution.toString();

    // Use the same GitHub URL as in the NeuroAtlas class
    const baseAtlasUrl =
      'https://raw.githubusercontent.com/ThomasYeoLab/CBIG/master/stable_projects/brain_parcellation/Schaefer2018_LocalGlobal/Parcellations/MNI';
    const atlasFilename = `Schaefer2018_${parcelsStr}Parcels_${networksStr}Networks_order_FSLMNI152_${resolutionStr}mm.nii.gz`;
    const atlasUrl = `${baseAtlasUrl}/${atlasFilename}`;

    // Also get the labels file
    const labelsFilename = `Schaefer2018_${parcelsStr}Parcels_${networksStr}Networks_order.txt`;
    const labelsUrl = `${baseAtlasUrl}/freeview_lut/${labelsFilename}`;

    console.log(`Downloading Schaefer atlas from: ${atlasUrl}`);
    
    // Download the atlas file
    const response = await fetch(atlasUrl);
    if (!response.ok) {
      throw new Error(`Failed to download atlas: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.arrayBuffer();
    const buffer = data;
    
    // Download and parse labels
    console.log(`Downloading labels from: ${labelsUrl}`);
    const labelsResponse = await fetch(labelsUrl);
    if (!labelsResponse.ok) {
      throw new Error(`Failed to download labels: ${labelsResponse.status} ${labelsResponse.statusText}`);
    }
    
    const labelsData = await labelsResponse.text();
    const labels = labelsData.trim().split('\n').map(line => line.trim().split('\t'));
    const ids = labels.map(label => parseInt(label[0], 10));
    const regionNames = labels.map(label => {
      const parts = label[1].split('_');
      return parts.slice(parts.length - 2).join('_');
    });
    
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
    
    // Read the image data
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
    
    // Create a simple atlas object
    return {
      atlas: {
        space: new ActualNeuroSpace(dim, spacing, origin, affine),
        getData: () => dataArray,
        getRange: () => {
          let min = Infinity;
          let max = -Infinity;
          
          for (let i = 0; i < dataArray.length; i++) {
            const value = dataArray[i];
            if (value > 0) { // Only consider non-zero values for atlas labels
              min = Math.min(min, value);
              max = Math.max(max, value);
            }
          }
          
          return [min, max];
        }
      },
      metadata: {
        ids,
        labels: regionNames,
        fullLabels: labels.map(label => label[1]),
        colors: labels.map(label => [
          parseInt(label[2], 10),
          parseInt(label[3], 10),
          parseInt(label[4], 10),
        ])
      }
    };
  }
}

async function main() {
  try {
    // Load the Schaefer atlas with the same parameters as in sliceviewer.js
    const atlas = await SimpleNeuroAtlas.loadSchaeferAtlas({
      parcels: 400,
      networks: 17,
      resolution: 2
    });
    
    console.log("\nSchaefer Atlas Information:");
    console.log("---------------------------");
    
    // Display the NeuroSpace information
    atlas.atlas.space.prettyPrint();
    
    // Only attempt reorientation if we're using the real NeuroSpace
    if (typeof NeuroSpace !== 'undefined') {
      console.log("\nReoriented to LPI:");
      console.log("------------------");
      const reorientedAtlas = atlas.atlas.space.reorient(AxisSet3D.AXIAL_LPI);
      reorientedAtlas.prettyPrint();
    }
    
    // Get and display the atlas range
    const atlasRange = atlas.atlas.getRange();
    console.log("\nAtlas Range:", atlasRange);
    
    // Calculate basic statistics
    const dataArray = atlas.atlas.getData();
    const totalVoxels = dataArray.length;
    
    let nonZeroCount = 0;
    let uniqueLabels = new Set();
    
    for (let i = 0; i < totalVoxels; i++) {
      const value = dataArray[i];
      if (value > 0) {
        nonZeroCount++;
        uniqueLabels.add(value);
      }
    }
    
    console.log('\nAtlas Data Information:');
    console.log('----------------------');
    console.log(`Total Voxels: ${totalVoxels}`);
    console.log(`Non-Zero Voxels: ${nonZeroCount} (${(nonZeroCount / totalVoxels * 100).toFixed(2)}%)`);
    console.log(`Number of Unique Labels: ${uniqueLabels.size}`);
    console.log(`Label Range: ${Math.min(...uniqueLabels)} to ${Math.max(...uniqueLabels)}`);
    
    // Display label information
    console.log('\nLabel Information:');
    console.log('------------------');
    console.log(`Total Labels: ${atlas.metadata.labels.length}`);
    console.log(`First 5 Labels: ${atlas.metadata.labels.slice(0, 5).join(', ')}`);
    console.log(`First 5 IDs: ${atlas.metadata.ids.slice(0, 5).join(', ')}`);
    console.log(`First 5 Full Labels: ${atlas.metadata.fullLabels.slice(0, 5).join(', ')}`);
    
    // Display network information by parsing the full labels
    const networks = new Set(atlas.metadata.fullLabels.map(label => label.split('_')[2]));
    console.log(`\nNetworks (${networks.size}): ${Array.from(networks).join(', ')}`);
    
    // Display hemisphere information
    const hemispheres = new Set(atlas.metadata.fullLabels.map(label => label.split('_')[1]));
    console.log(`Hemispheres: ${Array.from(hemispheres).join(', ')}`);
    
  } catch (error) {
    console.error('Error loading or processing the Schaefer atlas:', error);
    console.error(error.stack);
  }
}

// Run the main function
main();
