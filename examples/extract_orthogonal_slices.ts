#!/usr/bin/env node

/**
 * Script to extract orthogonal slices from MNI brain template
 * and save them as PNG files with crosshairs marking world coordinates
 */

import { read_vol } from '../src/io/nifti';
import { extractOrthogonalSlices } from '../src/volume/orthogonalSlices';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { createCanvas } from 'canvas';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Draw a slice to canvas with crosshairs
 */
function drawSliceWithCrosshairs(
  sliceData: Float32Array | Float64Array,
  width: number,
  height: number,
  crosshairX: number,
  crosshairY: number,
  label: string
): Buffer {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  
  // Find min/max for normalization
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < sliceData.length; i++) {
    const val = sliceData[i];
    if (val < min) min = val;
    if (val > max) max = val;
  }
  
  // Create image data
  const imageData = ctx.createImageData(width, height);
  const data = imageData.data;
  
  // Fill with normalized grayscale values (with Y-axis flipped for medical imaging)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Read from source with normal Y coordinate
      const sourceIdx = y * width + x;
      const val = sliceData[sourceIdx];
      const normalized = Math.floor(((val - min) / (max - min)) * 255);
      
      // Write to destination with flipped Y coordinate
      const flippedY = height - 1 - y;
      const destIdx = flippedY * width + x;
      const pixelIdx = destIdx * 4;
      
      data[pixelIdx] = normalized;     // R
      data[pixelIdx + 1] = normalized; // G
      data[pixelIdx + 2] = normalized; // B
      data[pixelIdx + 3] = 255;       // A
    }
  }
  
  ctx.putImageData(imageData, 0, 0);
  
  // Draw crosshairs (with flipped Y coordinate)
  ctx.strokeStyle = 'red';
  ctx.lineWidth = 2;
  
  // Vertical line (X coordinate unchanged)
  ctx.beginPath();
  ctx.moveTo(crosshairX, 0);
  ctx.lineTo(crosshairX, height);
  ctx.stroke();
  
  // Horizontal line (Y coordinate flipped)
  const flippedCrosshairY = height - crosshairY;
  ctx.beginPath();
  ctx.moveTo(0, flippedCrosshairY);
  ctx.lineTo(width, flippedCrosshairY);
  ctx.stroke();
  
  // Draw label
  ctx.fillStyle = 'yellow';
  ctx.font = '16px Arial';
  ctx.fillText(label, 10, 20);
  
  return canvas.toBuffer('image/png');
}

async function extractAndSaveSlices() {
  console.log('=== Orthogonal Slice Extraction ===\n');
  
  try {
    // Path to MNI brain template
    const mniPath = path.join(__dirname, '../tests/data/volumes/tpl-MNI152NLin2009aAsym_res-1_T1w.nii.gz');
    console.log(`Loading MNI brain template from: ${mniPath}`);
    
    // Check if file exists
    if (!fs.existsSync(mniPath)) {
      throw new Error(`MNI template file not found at: ${mniPath}`);
    }
    
    // Load the volume
    const volume = await read_vol(mniPath);
    console.log(`Volume loaded successfully`);
    console.log(`Dimensions: ${volume.dim.join(' x ')}`);
    console.log(`Spacing: ${volume.space.spacing.join(' x ')} mm`);
    console.log(`Origin: ${volume.space.origin.join(', ')} mm`);
    
    // Get volume bounds
    const bounds = volume.space.bounds();
    console.log(`\nVolume bounds:`);
    console.log(`  X: ${bounds[0][0].toFixed(1)} to ${bounds[1][0].toFixed(1)} mm`);
    console.log(`  Y: ${bounds[0][1].toFixed(1)} to ${bounds[1][1].toFixed(1)} mm`);
    console.log(`  Z: ${bounds[0][2].toFixed(1)} to ${bounds[1][2].toFixed(1)} mm`);
    
    // Generate 10 world coordinates within the bounding box
    const worldCoords: number[][] = [];
    
    // Add center point
    worldCoords.push([0, -18, 22]); // Near AC-PC line
    
    // Add origin
    worldCoords.push([0, 0, 0]);
    
    // Add 8 random points
    for (let i = 0; i < 8; i++) {
      const t = i / 7; // 0 to 1
      const x = bounds[0][0] + (bounds[1][0] - bounds[0][0]) * (0.25 + 0.5 * Math.random());
      const y = bounds[0][1] + (bounds[1][1] - bounds[0][1]) * (0.25 + 0.5 * Math.random());
      const z = bounds[0][2] + (bounds[1][2] - bounds[0][2]) * t;
      worldCoords.push([
        Math.round(x * 10) / 10,
        Math.round(y * 10) / 10,
        Math.round(z * 10) / 10
      ]);
    }
    
    console.log(`\nGenerated ${worldCoords.length} world coordinates:`);
    worldCoords.forEach((coord, i) => {
      console.log(`  ${i + 1}: [${coord.map(c => c.toFixed(1)).join(', ')}] mm`);
    });
    
    // Create output directory
    const outputDir = path.join(process.cwd(), 'output', 'orthogonal_slices');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    console.log(`\nOutput directory: ${outputDir}`);
    
    // Process each coordinate
    for (let i = 0; i < worldCoords.length; i++) {
      const coord = worldCoords[i];
      console.log(`\nProcessing coordinate ${i + 1}: [${coord.join(', ')}] mm`);
      
      try {
        // Extract orthogonal slices
        const slices = extractOrthogonalSlices(volume, coord);
        
        // Convert world coordinate to grid coordinates for each slice
        const gridCoord = volume.space.coordToGrid(coord);
        
        // Save axial slice
        const axialCrosshairX = Math.round(gridCoord[0]);
        const axialCrosshairY = Math.round(gridCoord[1]);
        const axialBuffer = drawSliceWithCrosshairs(
          slices.axial.getData() as Float32Array,
          slices.axial.dim[0],
          slices.axial.dim[1],
          axialCrosshairX,
          axialCrosshairY,
          `Axial @ Z=${coord[2].toFixed(1)}mm`
        );
        const axialPath = path.join(outputDir, `coord_${i + 1}_axial.png`);
        fs.writeFileSync(axialPath, axialBuffer);
        console.log(`  ✓ Saved axial slice: ${axialPath}`);
        
        // Save sagittal slice
        const sagittalCrosshairX = Math.round(gridCoord[1]);
        const sagittalCrosshairY = Math.round(gridCoord[2]);
        const sagittalBuffer = drawSliceWithCrosshairs(
          slices.sagittal.getData() as Float32Array,
          slices.sagittal.dim[0],
          slices.sagittal.dim[1],
          sagittalCrosshairX,
          sagittalCrosshairY,
          `Sagittal @ X=${coord[0].toFixed(1)}mm`
        );
        const sagittalPath = path.join(outputDir, `coord_${i + 1}_sagittal.png`);
        fs.writeFileSync(sagittalPath, sagittalBuffer);
        console.log(`  ✓ Saved sagittal slice: ${sagittalPath}`);
        
        // Save coronal slice
        const coronalCrosshairX = Math.round(gridCoord[0]);
        const coronalCrosshairY = Math.round(gridCoord[2]);
        const coronalBuffer = drawSliceWithCrosshairs(
          slices.coronal.getData() as Float32Array,
          slices.coronal.dim[0],
          slices.coronal.dim[1],
          coronalCrosshairX,
          coronalCrosshairY,
          `Coronal @ Y=${coord[1].toFixed(1)}mm`
        );
        const coronalPath = path.join(outputDir, `coord_${i + 1}_coronal.png`);
        fs.writeFileSync(coronalPath, coronalBuffer);
        console.log(`  ✓ Saved coronal slice: ${coronalPath}`);
        
      } catch (error) {
        console.error(`  ✗ Error processing coordinate: ${error.message}`);
      }
    }
    
    // Create HTML viewer
    const html = `<!DOCTYPE html>
<html>
<head>
    <title>Orthogonal Slices Viewer</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            margin: 20px;
            background-color: #f0f0f0;
        }
        .coord-section {
            margin-bottom: 40px;
            background-color: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .coord-header {
            font-size: 18px;
            font-weight: bold;
            margin-bottom: 10px;
            color: #333;
        }
        .slices-container {
            display: flex;
            gap: 20px;
            justify-content: center;
        }
        .slice-wrapper {
            text-align: center;
        }
        .slice-label {
            font-weight: bold;
            margin-bottom: 5px;
            color: #666;
        }
        img {
            border: 2px solid #ddd;
            border-radius: 4px;
            max-width: 300px;
            height: auto;
        }
    </style>
</head>
<body>
    <h1>Orthogonal Slices with World Coordinates</h1>
    <p>Red crosshairs mark the world coordinate position in each slice.</p>
    
    ${worldCoords.map((coord, i) => `
    <div class="coord-section">
        <div class="coord-header">
            Coordinate ${i + 1}: [${coord.map(c => c.toFixed(1)).join(', ')}] mm
        </div>
        <div class="slices-container">
            <div class="slice-wrapper">
                <div class="slice-label">Axial (Z=${coord[2].toFixed(1)}mm)</div>
                <img src="coord_${i + 1}_axial.png" />
            </div>
            <div class="slice-wrapper">
                <div class="slice-label">Sagittal (X=${coord[0].toFixed(1)}mm)</div>
                <img src="coord_${i + 1}_sagittal.png" />
            </div>
            <div class="slice-wrapper">
                <div class="slice-label">Coronal (Y=${coord[1].toFixed(1)}mm)</div>
                <img src="coord_${i + 1}_coronal.png" />
            </div>
        </div>
    </div>
    `).join('\n')}
</body>
</html>`;
    
    fs.writeFileSync(path.join(outputDir, 'index.html'), html);
    console.log(`\n✅ HTML viewer created: ${path.join(outputDir, 'index.html')}`);
    console.log('\nAll slices extracted and saved successfully!');
    
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

// Run the extraction
extractAndSaveSlices().catch(console.error);