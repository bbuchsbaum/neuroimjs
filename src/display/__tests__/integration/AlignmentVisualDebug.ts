/**
 * Visual debugging utility for multi-layer alignment
 * Saves rendered slices as PNG files for manual inspection
 */

import { ImageLayer } from '../../ImageLayer.js';
import { VolStack } from '../../VolStack.js';
import { AxisSet3D } from '../../../geometry/Axis.js';
import * as PIXI from 'pixi.js';
import * as fs from 'fs';
import * as path from 'path';
import { createCanvas } from 'canvas';

export interface DebugRenderOptions {
  outputDir: string;
  width?: number;
  height?: number;
  sliceIndices?: number[];
  views?: Array<'axial' | 'sagittal' | 'coronal'>;
  renderModes?: Array<'composite' | 'layer1' | 'layer2' | 'difference'>;
}

/**
 * Render slices and save as PNG files for debugging
 */
export class AlignmentVisualDebugger {
  private app: PIXI.Application;
  
  constructor(
    private imageLayer: ImageLayer,
    private volStack: VolStack
  ) {
    // Create PIXI app for rendering
    this.app = new PIXI.Application({
      width: 512,
      height: 512,
      backgroundColor: 0x000000,
      preserveDrawingBuffer: true,
      antialias: false
    });
  }
  
  /**
   * Render all debug images
   */
  async renderDebugImages(options: DebugRenderOptions): Promise<void> {
    const {
      outputDir,
      width = 512,
      height = 512,
      sliceIndices = [5, 10, 15], // Use indices within bounds for all test volumes
      views = ['axial', 'sagittal', 'coronal'],
      renderModes = ['composite', 'layer1', 'layer2', 'difference']
    } = options;
    
    // Create output directory
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    // Configure app size
    this.app.renderer.resize(width, height);
    
    // Render each combination
    for (const view of views) {
      const axis = this.getAxisForView(view);
      
      for (const sliceIndex of sliceIndices) {
        for (const mode of renderModes) {
          await this.renderSlice(
            axis,
            sliceIndex,
            view,
            mode,
            outputDir
          );
        }
      }
    }
    
    // Generate HTML viewer
    this.generateHTMLViewer(outputDir, views, sliceIndices, renderModes);
    
    console.log(`Debug images saved to: ${outputDir}`);
  }
  
  /**
   * Render a single slice configuration
   */
  private async renderSlice(
    axis: AxisSet3D,
    sliceIndex: number,
    view: string,
    mode: string,
    outputDir: string
  ): Promise<void> {
    // Clear stage
    this.app.stage.removeChildren();
    
    // Configure layer visibility
    const layer1 = this.volStack.getLayer(0);
    const layer2 = this.volStack.getLayer(1);
    
    switch (mode) {
      case 'layer1':
        layer1.visible = true;
        layer2.visible = false;
        break;
      case 'layer2':
        layer1.visible = false;
        layer2.visible = true;
        break;
      case 'composite':
        layer1.visible = true;
        layer2.visible = true;
        break;
      case 'difference':
        // Will render twice and compute difference
        break;
    }
    
    if (mode === 'difference') {
      await this.renderDifferenceImage(axis, sliceIndex, view, outputDir);
    } else {
      // Render slice
      const coord = this.getCoordForSlice(sliceIndex, view);
      const container = this.imageLayer.renderSlice(
        sliceIndex,
        coord,
        axis,
        this.app.stage
      );
      
      if (container) {
        // Force render
        this.app.render();
        
        // Save as PNG
        const filename = `${view}_slice${sliceIndex}_${mode}.png`;
        await this.saveCanvasAsPNG(
          (this.app as any).canvas || (this.app as any).view,
          path.join(outputDir, filename)
        );
      }
    }
    
    // Reset visibility
    layer1.visible = true;
    layer2.visible = true;
  }
  
  /**
   * Render difference image between layers
   */
  private async renderDifferenceImage(
    axis: AxisSet3D,
    sliceIndex: number,
    view: string,
    outputDir: string
  ): Promise<void> {
    const width = this.app.renderer.width;
    const height = this.app.renderer.height;
    
    // Render layer 1
    this.volStack.getLayer(0).visible = true;
    this.volStack.getLayer(1).visible = false;
    
    const coord = this.getCoordForSlice(sliceIndex, view);
    this.imageLayer.renderSlice(sliceIndex, coord, axis, this.app.stage);
    this.app.render();
    
    const canvas1 = createCanvas(width, height);
    const ctx1 = canvas1.getContext('2d');
    ctx1.drawImage((this.app as any).canvas || (this.app as any).view, 0, 0);
    const data1 = ctx1.getImageData(0, 0, width, height);
    
    // Clear and render layer 2
    this.app.stage.removeChildren();
    this.volStack.getLayer(0).visible = false;
    this.volStack.getLayer(1).visible = true;
    
    // Adjust slice index for different spacing
    const adjustedSlice = this.adjustSliceIndex(sliceIndex, view);
    this.imageLayer.renderSlice(adjustedSlice, coord, axis, this.app.stage);
    this.app.render();
    
    const canvas2 = createCanvas(width, height);
    const ctx2 = canvas2.getContext('2d');
    ctx2.drawImage((this.app as any).canvas || (this.app as any).view, 0, 0);
    const data2 = ctx2.getImageData(0, 0, width, height);
    
    // Compute difference
    const diffCanvas = createCanvas(width, height);
    const diffCtx = diffCanvas.getContext('2d');
    const diffData = diffCtx.createImageData(width, height);
    
    for (let i = 0; i < data1.data.length; i += 4) {
      // Difference visualization:
      // Green = only in layer 1
      // Red = only in layer 2
      // Yellow = in both (overlap)
      // Black = in neither
      
      const val1 = data1.data[i] > 10 ? 1 : 0;
      const val2 = data2.data[i] > 10 ? 1 : 0;
      
      if (val1 && val2) {
        // Overlap - yellow
        diffData.data[i] = 255;     // R
        diffData.data[i + 1] = 255; // G
        diffData.data[i + 2] = 0;   // B
      } else if (val1) {
        // Only layer 1 - green
        diffData.data[i] = 0;       // R
        diffData.data[i + 1] = 255; // G
        diffData.data[i + 2] = 0;   // B
      } else if (val2) {
        // Only layer 2 - red
        diffData.data[i] = 255;     // R
        diffData.data[i + 1] = 0;   // G
        diffData.data[i + 2] = 0;   // B
      } else {
        // Neither - black
        diffData.data[i] = 0;       // R
        diffData.data[i + 1] = 0;   // G
        diffData.data[i + 2] = 0;   // B
      }
      diffData.data[i + 3] = 255; // A
    }
    
    diffCtx.putImageData(diffData, 0, 0);
    
    // Save difference image
    const filename = `${view}_slice${sliceIndex}_difference.png`;
    await this.saveCanvasAsPNG(diffCanvas, path.join(outputDir, filename));
    
    // Reset visibility
    this.volStack.getLayer(0).visible = true;
    this.volStack.getLayer(1).visible = true;
  }
  
  /**
   * Save canvas as PNG file
   */
  private async saveCanvasAsPNG(
    canvas: HTMLCanvasElement | any,
    filepath: string
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const buffer = canvas.toBuffer('image/png');
      fs.writeFile(filepath, buffer, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
  
  /**
   * Generate HTML viewer for easy inspection
   */
  private generateHTMLViewer(
    outputDir: string,
    views: string[],
    sliceIndices: number[],
    renderModes: string[]
  ): void {
    const html = `
<!DOCTYPE html>
<html>
<head>
    <title>Multi-Layer Alignment Debug Viewer</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            background: #222;
            color: #fff;
            margin: 20px;
        }
        .container {
            display: grid;
            grid-template-columns: repeat(${renderModes.length}, 1fr);
            gap: 10px;
            margin-bottom: 30px;
        }
        .image-box {
            text-align: center;
            background: #333;
            padding: 10px;
            border-radius: 5px;
        }
        .image-box img {
            max-width: 100%;
            height: auto;
            border: 1px solid #555;
        }
        .image-box h4 {
            margin: 10px 0 5px 0;
            color: #aaa;
        }
        h2 {
            color: #4CAF50;
            margin-top: 30px;
        }
        h3 {
            color: #FFC107;
        }
        .legend {
            background: #333;
            padding: 15px;
            border-radius: 5px;
            margin-bottom: 20px;
        }
        .legend-item {
            display: inline-block;
            margin-right: 20px;
        }
        .color-box {
            display: inline-block;
            width: 20px;
            height: 20px;
            vertical-align: middle;
            margin-right: 5px;
        }
    </style>
</head>
<body>
    <h1>Multi-Layer Alignment Debug Viewer</h1>
    
    <div class="legend">
        <h4>Difference Image Legend:</h4>
        <div class="legend-item">
            <span class="color-box" style="background: #0F0;"></span>
            Green = Layer 1 only
        </div>
        <div class="legend-item">
            <span class="color-box" style="background: #F00;"></span>
            Red = Layer 2 only
        </div>
        <div class="legend-item">
            <span class="color-box" style="background: #FF0;"></span>
            Yellow = Overlap
        </div>
    </div>
    
    ${views.map(view => `
        <h2>${view.charAt(0).toUpperCase() + view.slice(1)} View</h2>
        ${sliceIndices.map(slice => `
            <h3>Slice ${slice}</h3>
            <div class="container">
                ${renderModes.map(mode => `
                    <div class="image-box">
                        <h4>${mode.charAt(0).toUpperCase() + mode.slice(1)}</h4>
                        <img src="${view}_slice${slice}_${mode}.png" alt="${view} ${mode} slice ${slice}">
                    </div>
                `).join('')}
            </div>
        `).join('')}
    `).join('')}
    
    <script>
        // Add click to zoom functionality
        document.querySelectorAll('img').forEach(img => {
            img.style.cursor = 'zoom-in';
            img.onclick = function() {
                if (this.style.transform === 'scale(2)') {
                    this.style.transform = 'scale(1)';
                    this.style.cursor = 'zoom-in';
                } else {
                    this.style.transform = 'scale(2)';
                    this.style.cursor = 'zoom-out';
                }
                this.style.transition = 'transform 0.3s';
            };
        });
    </script>
</body>
</html>
    `;
    
    fs.writeFileSync(path.join(outputDir, 'index.html'), html);
  }
  
  /**
   * Get axis for view name
   */
  private getAxisForView(view: string): AxisSet3D {
    switch (view) {
      case 'axial': return AxisSet3D.fromStr('XYZ');
      case 'sagittal': return AxisSet3D.fromStr('YZX');
      case 'coronal': return AxisSet3D.fromStr('XZY');
      default: return AxisSet3D.fromStr('XYZ');
    }
  }
  
  /**
   * Get coordinate for slice
   */
  private getCoordForSlice(sliceIndex: number, view: string): number[] {
    const center1 = [40, 40, 40]; // Center of volume 1
    const center2 = [30, 30, 10]; // Center of volume 2
    
    // Use volume 1 coordinates
    switch (view) {
      case 'axial':
        return [center1[0], center1[1], sliceIndex];
      case 'sagittal':
        return [sliceIndex, center1[1], center1[2]];
      case 'coronal':
        return [center1[0], sliceIndex, center1[2]];
      default:
        return center1;
    }
  }
  
  /**
   * Adjust slice index for volume 2 based on spacing differences
   */
  private adjustSliceIndex(sliceIndex: number, view: string): number {
    // Volume 1: 80x80x80 @ 2x2x2
    // Volume 2: 60x60x20 @ 2.4x2.4x4
    
    switch (view) {
      case 'axial':
        // Z: 2mm vs 4mm spacing
        return Math.round(sliceIndex * 2 / 4);
      case 'sagittal':
        // X: 2mm vs 2.4mm spacing
        return Math.round(sliceIndex * 2 / 2.4);
      case 'coronal':
        // Y: 2mm vs 2.4mm spacing
        return Math.round(sliceIndex * 2 / 2.4);
      default:
        return sliceIndex;
    }
  }
  
  /**
   * Cleanup resources
   */
  dispose(): void {
    this.app.destroy(true);
  }
}

/**
 * Run visual debugging
 */
export async function runVisualDebug(
  imageLayer: ImageLayer,
  volStack: VolStack,
  outputDir: string = './alignment-debug'
): Promise<void> {
  const visualDebugger = new AlignmentVisualDebugger(imageLayer, volStack);
  
  await visualDebugger.renderDebugImages({
    outputDir,
    sliceIndices: [20, 30, 40, 50, 60],
    views: ['axial', 'sagittal', 'coronal'],
    renderModes: ['layer1', 'layer2', 'composite', 'difference']
  });
  
  visualDebugger.dispose();
}