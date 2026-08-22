/**
 * Direct test of alignment calculations
 */

console.log('Multi-Layer Alignment Test - Direct Calculation');
console.log('==============================================\n');

// Test scenario parameters
const volume1 = {
  dims: [80, 80, 80],
  spacing: [2, 2, 2],
  fov: [160, 160, 160]
};

const volume2 = {
  dims: [60, 60, 20],
  spacing: [2.4, 2.4, 4],
  fov: [144, 144, 80]
};

console.log('Volume 1 (Reference):');
console.log(`  Dimensions: ${volume1.dims.join('x')} voxels`);
console.log(`  Spacing: ${volume1.spacing.join('x')} mm`);
console.log(`  FOV: ${volume1.fov.join('x')} mm\n`);

console.log('Volume 2 (Overlay):');
console.log(`  Dimensions: ${volume2.dims.join('x')} voxels`);
console.log(`  Spacing: ${volume2.spacing.join('x')} mm`);
console.log(`  FOV: ${volume2.fov.join('x')} mm\n`);

// Calculate expected scaling
const scaleX = volume1.spacing[0] / volume2.spacing[0];
const scaleY = volume1.spacing[1] / volume2.spacing[1];
const scaleZ = volume1.spacing[2] / volume2.spacing[2];

console.log('Expected Scaling (to match reference voxel size):');
console.log(`  X-axis: ${scaleX.toFixed(3)} (${(scaleX * 100).toFixed(1)}%)`);
console.log(`  Y-axis: ${scaleY.toFixed(3)} (${(scaleY * 100).toFixed(1)}%)`);
console.log(`  Z-axis: ${scaleZ.toFixed(3)} (${(scaleZ * 100).toFixed(1)}%)\n`);

// Calculate brain positions
const brainSize = 120; // mm
const brain1Center = volume1.fov.map(d => d / 2);
const brain2Center = volume2.fov.map(d => d / 2);

console.log('Brain Centers (world space):');
console.log(`  Volume 1: (${brain1Center.join(', ')}) mm`);
console.log(`  Volume 2: (${brain2Center.join(', ')}) mm\n`);

// For axial view (XY plane), calculate expected sprite dimensions
const sprite1Width = volume1.dims[0];
const sprite1Height = volume1.dims[1];

const sprite2Width = volume2.dims[0] * scaleX;
const sprite2Height = volume2.dims[1] * scaleY;

console.log('Expected Sprite Dimensions (Axial View):');
console.log(`  Sprite 1: ${sprite1Width} x ${sprite1Height} pixels`);
console.log(`  Sprite 2: ${sprite2Width.toFixed(1)} x ${sprite2Height.toFixed(1)} pixels (after scaling)\n`);

// Calculate offsets for center alignment
const offsetX = (sprite1Width - sprite2Width) / 2;
const offsetY = (sprite1Height - sprite2Height) / 2;

console.log('Expected Center Alignment Offsets:');
console.log(`  X offset: ${offsetX.toFixed(1)} pixels`);
console.log(`  Y offset: ${offsetY.toFixed(1)} pixels\n`);

// Simulate Dice calculation
console.log('Dice Coefficient Calculation:');
console.log('-----------------------------');

// Count brain voxels in each volume
const brain1Voxels = Math.pow(brainSize / volume1.spacing[0], 3);
const brain2Voxels = Math.pow(brainSize / volume2.spacing[0], 3) * 
                     (brainSize / volume2.spacing[1]) / (brainSize / volume2.spacing[0]) *
                     (brainSize / volume2.spacing[2]) / (brainSize / volume2.spacing[0]);

console.log(`Brain voxels in Volume 1: ~${Math.round(brain1Voxels)}`);
console.log(`Brain voxels in Volume 2: ~${Math.round(brain2Voxels)}`);

// With perfect alignment, intersection should be very high
const expectedDice = 0.995;
console.log(`\nExpected Dice coefficient: > ${expectedDice}`);
console.log('(With 3-pixel edge tolerance for interpolation effects)\n');

// Visual representation
console.log('Visual Alignment Summary:');
console.log('========================');
console.log('Volume 1 (Gray):    [====================] 100% opacity');
console.log('Volume 2 (Hot):     [==========] 50% opacity, scaled to match');
console.log('                         ↑');
console.log('                    Aligned center\n');

console.log('✓ Test calculations complete!');
console.log('\nTo run the full visual test, use:');
console.log('  npx tsx runAlignmentTest.ts --visual --output ./alignment-output');
