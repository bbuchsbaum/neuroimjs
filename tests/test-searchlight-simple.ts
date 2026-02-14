import { NeuroSpace } from '../src/geometry/NeuroSpace';
import { LogicalNeuroVol } from '../src/volume/LogicalNeuroVol';
import { searchlightIterator } from '../src/searchlight/searchlight';

// Create simple test
const space = new NeuroSpace([5, 5, 5], [1, 1, 1], [0, 0, 0]);
const mask = new LogicalNeuroVol(space);

console.log('Space dimensions:', space.dim);
console.log('Space size:', space.size);

// Test indexToGrid
console.log('indexToGrid(0):', space.indexToGrid(0));
console.log('indexToGrid(1):', space.indexToGrid(1));
console.log('indexToGrid(124):', space.indexToGrid(124));

// Try searchlight
try {
  const result = searchlightIterator(mask, 3);
  console.log('Searchlight created successfully');
} catch (e) {
  console.error('Error:', e);
}