/**
 * Example of extracting orthogonal slices from a neuroimaging volume
 * at a specific world-space coordinate
 */

import { 
  readVol,
  extractOrthogonalSlices,
  extractAxialSlice,
  getSliceOrientation,
  getWorldBoundsForSlice
} from '../src';

async function main() {
  // Load a neuroimaging volume
  // Replace this with your actual NIfTI file path
  const volumePath = './data/brain.nii.gz';
  
  try {
    console.log('Loading volume...');
    const vol = await readVol(volumePath);
    console.log(`Volume dimensions: ${vol.dim.join('x')}`);
    console.log(`Volume spacing: ${vol.spacing.join(', ')}`);
    
    // Get the center of the volume in world coordinates
    const centerVoxel = vol.dim.map(d => (d - 1) / 2);
    const centerWorld = vol.space.gridToCoord(centerVoxel);
    console.log(`\nCenter voxel: [${centerVoxel.join(', ')}]`);
    console.log(`Center world: [${centerWorld.join(', ')}]`);
    
    // Extract all three orthogonal slices at the center
    console.log('\nExtracting orthogonal slices at center...');
    const slices = extractOrthogonalSlices(vol, centerWorld);
    
    console.log(`Axial slice dimensions: ${slices.axial.dim.join('x')}`);
    console.log(`Sagittal slice dimensions: ${slices.sagittal.dim.join('x')}`);
    console.log(`Coronal slice dimensions: ${slices.coronal.dim.join('x')}`);
    
    // Get slice orientations
    console.log('\nSlice orientations:');
    console.log(`Axial: ${getSliceOrientation(vol, 'axial')}`);
    console.log(`Sagittal: ${getSliceOrientation(vol, 'sagittal')}`);
    console.log(`Coronal: ${getSliceOrientation(vol, 'coronal')}`);
    
    // Extract a single slice type at a different location
    const customPoint = [10, 20, 30]; // Example world coordinates
    console.log(`\nExtracting axial slice at world point [${customPoint.join(', ')}]...`);
    const axialSlice = extractAxialSlice(vol, customPoint);
    console.log(`Axial slice dimensions: ${axialSlice.dim.join('x')}`);
    
    // Get slice data for visualization
    const sliceData = axialSlice.getData();
    const [min, max] = getMinMax(sliceData);
    console.log(`Value range: ${min.toFixed(2)} to ${max.toFixed(2)}`);
    
    // Get world bounds for a specific slice
    const sliceIndex = Math.floor(vol.dim[2] / 2); // Middle slice
    const [minBounds, maxBounds] = getWorldBoundsForSlice(vol, 'axial', sliceIndex);
    console.log(`\nWorld bounds for axial slice ${sliceIndex}:`);
    console.log(`Min: [${minBounds.join(', ')}]`);
    console.log(`Max: [${maxBounds.join(', ')}]`);
    
  } catch (error) {
    console.error('Error:', error);
  }
}

function getMinMax(data: Float32Array | Uint8Array | Int16Array | Float64Array | Int32Array | Uint16Array | Int8Array): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < data.length; i++) {
    if (data[i] < min) min = data[i];
    if (data[i] > max) max = data[i];
  }
  return [min, max];
}

// Run the example
main();