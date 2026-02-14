import { read_vol } from '../src/io/nifti';
import { OrthogonalSliceRenderer } from '../src/display/OrthogonalSliceRenderer';
import { NeuroVol } from '../src/volume/NeuroVol';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Demo script to visualize orthogonal slices from MNI brain template
 * with crosshairs marking world coordinates
 */
async function runOrthogonalSliceDemo() {
  console.log('=== Orthogonal Slice Visualization Demo ===\n');
  
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
    const worldCoordinates = generateWorldCoordinates(bounds, 10);
    console.log(`\nGenerated ${worldCoordinates.length} world coordinates:`);
    worldCoordinates.forEach((coord, i) => {
      console.log(`  ${i + 1}: [${coord.map(c => c.toFixed(1)).join(', ')}] mm`);
    });
    
    // Create output directory
    const outputDir = path.join(__dirname, '../output/orthogonal_slices');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    console.log(`\nOutput directory: ${outputDir}`);
    
    // Create renderer with custom options
    const renderer = new OrthogonalSliceRenderer(volume, {
      showCrosshairs: true,
      crosshairColor: 0xFF0000, // Red
      crosshairThickness: 2,
      showLabels: true,
      labelStyle: {
        fill: 0xFFFF00, // Yellow
        fontSize: 16,
        fontFamily: 'Arial',
        fontWeight: 'bold'
      },
      backgroundColor: 0x222222, // Dark gray
      canvasWidth: 512,
      canvasHeight: 512
    });
    
    console.log('\nRendering slices...');
    
    // Process each coordinate
    for (let i = 0; i < worldCoordinates.length; i++) {
      const coord = worldCoordinates[i];
      console.log(`\nProcessing coordinate ${i + 1}/${worldCoordinates.length}: [${coord.map(c => c.toFixed(1)).join(', ')}]`);
      
      try {
        // Export orthogonal slices
        await renderer.exportOrthogonalSlices(coord, {
          outputDir,
          filePattern: `coord${i + 1}_{view}_x{x}_y{y}_z{z}.png`,
          format: 'png'
        });
        
        console.log(`  ✓ Exported axial, sagittal, and coronal slices`);
      } catch (error) {
        console.error(`  ✗ Error rendering coordinate ${i + 1}:`, error.message);
      }
    }
    
    // Create an HTML viewer for easy inspection
    createHTMLViewer(outputDir, worldCoordinates);
    console.log(`\nCreated HTML viewer: ${path.join(outputDir, 'index.html')}`);
    
    // Cleanup
    renderer.dispose();
    console.log('\nDemo completed successfully!');
    console.log(`View results at: ${outputDir}`);
    
  } catch (error) {
    console.error('Error running demo:', error);
    process.exit(1);
  }
}

/**
 * Generate world coordinates distributed throughout the volume
 */
function generateWorldCoordinates(
  bounds: number[][],
  count: number
): number[][] {
  const coords: number[][] = [];
  
  // Get min and max for each dimension
  const xMin = bounds[0][0];
  const xMax = bounds[1][0];
  const yMin = bounds[0][1];
  const yMax = bounds[1][1];
  const zMin = bounds[0][2];
  const zMax = bounds[1][2];
  
  // Add center point
  coords.push([
    (xMin + xMax) / 2,
    (yMin + yMax) / 2,
    (zMin + zMax) / 2
  ]);
  
  // Add anterior commissure approximate location (MNI space)
  coords.push([0, 0, 0]);
  
  // Add distributed points
  for (let i = coords.length; i < count; i++) {
    const t = i / (count - 1);
    
    // Create a spiral pattern through the volume
    const angle = t * Math.PI * 2;
    const radius = 0.3 + t * 0.2; // Vary radius from 30% to 50% of volume
    
    coords.push([
      xMin + (xMax - xMin) * (0.5 + radius * Math.cos(angle) * 0.5),
      yMin + (yMax - yMin) * (0.5 + radius * Math.sin(angle) * 0.5),
      zMin + (zMax - zMin) * t
    ]);
  }
  
  return coords;
}

/**
 * Create an HTML viewer for the generated slices
 */
function createHTMLViewer(outputDir: string, worldCoordinates: number[][]): void {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Orthogonal Slice Visualization - MNI Brain Template</title>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background-color: #1a1a1a;
            color: #f0f0f0;
            margin: 0;
            padding: 20px;
        }
        
        h1 {
            text-align: center;
            color: #4CAF50;
            margin-bottom: 10px;
        }
        
        .subtitle {
            text-align: center;
            color: #888;
            margin-bottom: 30px;
        }
        
        .coordinate-section {
            margin-bottom: 50px;
            background-color: #2a2a2a;
            border-radius: 10px;
            padding: 20px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
        }
        
        .coordinate-header {
            background-color: #3a3a3a;
            margin: -20px -20px 20px -20px;
            padding: 15px 20px;
            border-radius: 10px 10px 0 0;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .coordinate-title {
            font-size: 20px;
            color: #FFC107;
            margin: 0;
        }
        
        .coordinate-values {
            font-family: 'Courier New', monospace;
            color: #4CAF50;
            font-size: 16px;
        }
        
        .slices-container {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 20px;
            max-width: 1600px;
            margin: 0 auto;
        }
        
        .slice-box {
            text-align: center;
            background-color: #1a1a1a;
            border-radius: 8px;
            padding: 15px;
            transition: transform 0.2s;
        }
        
        .slice-box:hover {
            transform: scale(1.02);
            background-color: #252525;
        }
        
        .slice-box h3 {
            margin: 0 0 10px 0;
            color: #64B5F6;
            font-size: 18px;
            text-transform: uppercase;
            letter-spacing: 1px;
        }
        
        .slice-box img {
            width: 100%;
            height: auto;
            border: 2px solid #444;
            border-radius: 4px;
            cursor: zoom-in;
        }
        
        .slice-box img.zoomed {
            cursor: zoom-out;
        }
        
        .legend {
            background-color: #2a2a2a;
            padding: 20px;
            border-radius: 10px;
            margin-bottom: 30px;
            text-align: center;
        }
        
        .legend h2 {
            color: #4CAF50;
            margin-top: 0;
        }
        
        .legend-item {
            display: inline-block;
            margin: 0 20px;
            color: #ccc;
        }
        
        .crosshair-demo {
            display: inline-block;
            width: 30px;
            height: 30px;
            position: relative;
            vertical-align: middle;
            margin-right: 10px;
        }
        
        .crosshair-demo::before,
        .crosshair-demo::after {
            content: '';
            position: absolute;
            background-color: #FF0000;
        }
        
        .crosshair-demo::before {
            width: 100%;
            height: 2px;
            top: 50%;
            left: 0;
            transform: translateY(-50%);
        }
        
        .crosshair-demo::after {
            width: 2px;
            height: 100%;
            top: 0;
            left: 50%;
            transform: translateX(-50%);
        }
        
        .modal {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0, 0, 0, 0.9);
            z-index: 1000;
            cursor: zoom-out;
        }
        
        .modal img {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            max-width: 90%;
            max-height: 90%;
            border: 3px solid #fff;
        }
        
        .info {
            background-color: #2a2a2a;
            padding: 20px;
            border-radius: 10px;
            margin-bottom: 30px;
        }
        
        .info p {
            margin: 5px 0;
            color: #ccc;
        }
    </style>
</head>
<body>
    <h1>Orthogonal Slice Visualization</h1>
    <p class="subtitle">MNI152 Nonlinear Asymmetric Template</p>
    
    <div class="info">
        <h2>Visualization Information</h2>
        <p><strong>Template:</strong> MNI152NLin2009aAsym (1mm resolution T1-weighted)</p>
        <p><strong>Crosshairs:</strong> Red lines marking the world coordinate position</p>
        <p><strong>Orientation Labels:</strong> Yellow letters indicating anatomical directions</p>
        <p><strong>Views:</strong> Axial (transverse), Sagittal, and Coronal planes</p>
        <p><strong>Click any image to zoom in/out</strong></p>
    </div>
    
    <div class="legend">
        <h2>Anatomical Orientations</h2>
        <div class="legend-item">
            <strong>L</strong> = Left
        </div>
        <div class="legend-item">
            <strong>R</strong> = Right
        </div>
        <div class="legend-item">
            <strong>A</strong> = Anterior
        </div>
        <div class="legend-item">
            <strong>P</strong> = Posterior
        </div>
        <div class="legend-item">
            <strong>S</strong> = Superior
        </div>
        <div class="legend-item">
            <strong>I</strong> = Inferior
        </div>
        <div class="legend-item">
            <span class="crosshair-demo"></span>
            Crosshair (World Coordinate)
        </div>
    </div>
    
    ${worldCoordinates.map((coord, i) => `
        <div class="coordinate-section">
            <div class="coordinate-header">
                <h2 class="coordinate-title">Coordinate ${i + 1}</h2>
                <span class="coordinate-values">
                    X: ${coord[0].toFixed(1)}mm, 
                    Y: ${coord[1].toFixed(1)}mm, 
                    Z: ${coord[2].toFixed(1)}mm
                </span>
            </div>
            <div class="slices-container">
                <div class="slice-box">
                    <h3>Axial</h3>
                    <img src="coord${i + 1}_axial_x${coord[0].toFixed(1)}_y${coord[1].toFixed(1)}_z${coord[2].toFixed(1)}.png" 
                         alt="Axial slice at coordinate ${i + 1}">
                </div>
                <div class="slice-box">
                    <h3>Sagittal</h3>
                    <img src="coord${i + 1}_sagittal_x${coord[0].toFixed(1)}_y${coord[1].toFixed(1)}_z${coord[2].toFixed(1)}.png" 
                         alt="Sagittal slice at coordinate ${i + 1}">
                </div>
                <div class="slice-box">
                    <h3>Coronal</h3>
                    <img src="coord${i + 1}_coronal_x${coord[0].toFixed(1)}_y${coord[1].toFixed(1)}_z${coord[2].toFixed(1)}.png" 
                         alt="Coronal slice at coordinate ${i + 1}">
                </div>
            </div>
        </div>
    `).join('')}
    
    <div class="modal" id="imageModal">
        <img id="modalImage" src="" alt="Zoomed view">
    </div>
    
    <script>
        // Image zoom functionality
        const modal = document.getElementById('imageModal');
        const modalImg = document.getElementById('modalImage');
        
        document.querySelectorAll('.slice-box img').forEach(img => {
            img.addEventListener('click', function() {
                modal.style.display = 'block';
                modalImg.src = this.src;
                modalImg.alt = this.alt;
            });
        });
        
        modal.addEventListener('click', function() {
            modal.style.display = 'none';
        });
        
        // Keyboard navigation
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape' && modal.style.display === 'block') {
                modal.style.display = 'none';
            }
        });
    </script>
</body>
</html>`;
  
  fs.writeFileSync(path.join(outputDir, 'index.html'), html);
}

// Run the demo
runOrthogonalSliceDemo().catch(console.error);