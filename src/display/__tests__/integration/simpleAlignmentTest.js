#!/usr/bin/env node
/**
 * Simple alignment test using basic JavaScript to verify multi-layer alignment
 */

import { ImageLayer } from '../../ImageLayer.js';
import { VolStack } from '../../VolStack.js';
import { VolLayer } from '../../VolLayer.js';
import { NeuroVol } from '../../../volume/NeuroVol.js';
import { NeuroSpace } from '../../../geometry/NeuroSpace.js';
import { ColorMap } from '../../ColorMap.js';
import { AxisSet3D } from '../../../geometry/Axis.js';
import * as PIXI from 'pixi.js';

/**
 * Create a test brain volume
 */
function createBrainVolume(dims, spacing, brainSize = 120) {
  // Create simple axes - identity matrix
  const axes = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1]
  ];
  
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
  
  // Create cube
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
        
        if (maxDist < halfSize) {
          const idx = i + j * dims[0] + k * dims[0] * dims[1];
          data[idx] = 1.0;
        }
      }
    }
  }
  
  return new NeuroVol(data, dims, space);
}

async function runTest() {
  console.log('Simple Multi-Layer Alignment Test');
  console.log('=================================\n');
  
  try {
    // Create test volumes
    console.log('Creating test volumes...');
    const volume1 = createBrainVolume([80, 80, 80], [2, 2, 2]);
    const volume2 = createBrainVolume([60, 60, 20], [2.4, 2.4, 4]);
    
    console.log('Volume 1: 80x80x80 @ 2x2x2mm');
    console.log('Volume 2: 60x60x20 @ 2.4x2.4x4mm');
    
    // Create colormaps
    const grayColorMap = new ColorMap('gray', (value) => {
      const v = Math.floor(value * 255);
      return [v, v, v, 255];
    });
    
    const hotColorMap = new ColorMap('hot', (value) => {
      const v = value * 255;
      const r = Math.min(255, Math.floor(v * 1.5));
      const g = Math.max(0, Math.floor((v - 85) * 0.75));
      const b = 0;
      return [r, g, b, 255];
    });
    
    // Create volume stack
    console.log('\nCreating volume stack...');
    const volStack = new VolStack(volume1.space);
    
    const layer1 = new VolLayer('anatomical', volume1);
    layer1.colorMap = grayColorMap;
    layer1.opacity = 1.0;
    layer1.setRange([0, 1]);
    
    const layer2 = new VolLayer('overlay', volume2);
    layer2.colorMap = hotColorMap;
    layer2.opacity = 0.5;
    layer2.setRange([0, 1]);
    
    volStack.addLayer(layer1);
    volStack.addLayer(layer2);
    
    // Create image layer
    console.log('Creating image layer with alignment...');
    const imageLayer = new ImageLayer(volStack, {
      strategy: 'auto',
      enableCache: true,
      maintainAspectRatio: false
    });
    
    // Test alignment
    console.log('\n=== Alignment Test Results ===');
    
    const testSlice = 40;
    const axis = AxisSet3D.fromStr('XYZ'); // Axial view
    
    // Create a simple container
    const app = new PIXI.Application({
      width: 512,
      height: 512,
      backgroundColor: 0x000000
    });
    
    // Render a test slice
    const container = imageLayer.renderSlice(
      testSlice,
      [40, 40, 40],
      axis,
      app.stage
    );
    
    if (container) {
      console.log('✓ Slice rendered successfully');
      console.log(`  Children in container: ${container.children.length}`);
      
      // Check alignment
      if (container.children.length >= 2) {
        const sprite1 = container.children[0];
        const sprite2 = container.children[1];
        
        console.log('\nLayer 1 (reference):');
        console.log(`  Position: (${sprite1.x}, ${sprite1.y})`);
        console.log(`  Scale: (${sprite1.scale.x}, ${sprite1.scale.y})`);
        
        console.log('\nLayer 2 (overlay):');
        console.log(`  Position: (${sprite2.x}, ${sprite2.y})`);
        console.log(`  Scale: (${sprite2.scale.x}, ${sprite2.scale.y})`);
        
        // Expected scales
        const expectedScaleX = 2.0 / 2.4; // 0.833
        const expectedScaleY = 2.0 / 2.4; // 0.833
        
        console.log('\nExpected scaling:');
        console.log(`  X: ${expectedScaleX.toFixed(3)}`);
        console.log(`  Y: ${expectedScaleY.toFixed(3)}`);
        
        // Check if scaling is correct
        const scaleXError = Math.abs(sprite2.scale.x - expectedScaleX);
        const scaleYError = Math.abs(sprite2.scale.y - expectedScaleY);
        
        if (scaleXError < 0.01 && scaleYError < 0.01) {
          console.log('\n✓ Alignment scaling is correct!');
        } else {
          console.log('\n✗ Alignment scaling mismatch');
        }
      }
    } else {
      console.log('✗ Failed to render slice');
    }
    
    // Check cache stats
    const cacheStats = imageLayer.getAlignmentCacheStats();
    console.log('\nCache statistics:');
    console.log(`  Entries: ${cacheStats.size}`);
    
    // Cleanup
    imageLayer.dispose();
    app.destroy(true);
    
    console.log('\nTest complete!');
    
  } catch (error) {
    console.error('Test failed:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the test
runTest();