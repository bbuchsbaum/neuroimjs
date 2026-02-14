# Multi-Layer Alignment Usage Guide

This guide provides practical examples and code snippets for using the neuroimjs multi-layer alignment system.

## Table of Contents

1. [Basic Usage](#basic-usage)
2. [Working with Different Resolutions](#working-with-different-resolutions)
3. [Alignment Strategies](#alignment-strategies)
4. [Performance Optimization](#performance-optimization)
5. [Advanced Examples](#advanced-examples)
6. [Common Patterns](#common-patterns)

## Basic Usage

### Creating a Multi-Layer View

```typescript
import { VolStack, VolLayer, ImageLayer } from 'neuroimjs/display';
import { FloatNeuroVol } from 'neuroimjs/volume';
import { NeuroSpace } from 'neuroimjs/geometry';
import { AxisSet3D } from 'neuroimjs/geometry';
import { ColorMap } from 'neuroimjs/display';

// Create two volumes with different properties
const vol1 = new FloatNeuroVol(
  new NeuroSpace([80, 80, 80], [2, 2, 2], [0, 0, 0], AxisSet3D.AXIAL_LPI),
  anatomicalData
);

const vol2 = new FloatNeuroVol(
  new NeuroSpace([60, 60, 20], [2.4, 2.4, 4], [0, 0, 0], AxisSet3D.AXIAL_LPI),
  functionalData
);

// Create color maps
const grayColorMap = new ColorMap(grayscaleColors, { name: 'gray' });
const hotColorMap = new ColorMap(hotColors, { name: 'hot' });

// Create layers
const anatomicalLayer = new VolLayer('anatomical', vol1, grayColorMap);
const functionalLayer = new VolLayer('functional', vol2, hotColorMap);
functionalLayer.opacity = 0.5;

// Create volume stack
const volStack = new VolStack(anatomicalLayer, functionalLayer);

// Create image layer with automatic alignment
const imageLayer = new ImageLayer(volStack, {
  strategy: 'auto',
  enableCache: true
});
```

### Rendering Slices

```typescript
import * as PIXI from 'pixi.js';

// Create PIXI application
const app = new PIXI.Application({
  width: 512,
  height: 512,
  backgroundColor: 0x000000
});

// Render axial slice
const container = new PIXI.Container();
const sliceIndex = 40;
const position: [number, number, number] = [40, 40, 40];
const axis = AxisSet3D.fromStr('XYZ'); // Axial

const result = imageLayer.renderSlice(sliceIndex, position, axis, container);
if (result) {
  app.stage.addChild(result);
}
```

## Working with Different Resolutions

### Handling FOV Differences

When working with volumes that have different fields of view:

```typescript
// Volume 1: Large FOV, low resolution
const largeFOV = new FloatNeuroVol(
  new NeuroSpace([128, 128, 60], [2, 2, 3], [0, 0, 0], AxisSet3D.AXIAL_LPI),
  wholeBrainData
);

// Volume 2: Small FOV, high resolution  
const smallFOV = new FloatNeuroVol(
  new NeuroSpace([256, 256, 40], [0.5, 0.5, 1], [20, 20, 10], AxisSet3D.AXIAL_LPI),
  hippocampusData
);

// The alignment system automatically handles the different FOVs
const imageLayer = new ImageLayer(volStack, {
  strategy: 'overlap', // Best for partial overlap
  maintainAspectRatio: true
});
```

### Multi-Resolution Pyramid

For very large datasets, create resolution pyramids:

```typescript
class MultiResolutionVolume {
  private resolutions: Map<number, NeuroVol>;
  
  constructor(baseVolume: NeuroVol) {
    this.resolutions = new Map();
    this.resolutions.set(1, baseVolume);
    
    // Generate lower resolutions
    this.generatePyramid();
  }
  
  private generatePyramid() {
    let currentVol = this.resolutions.get(1)!;
    
    for (let level = 2; level <= 4; level++) {
      const factor = Math.pow(2, level - 1);
      const newDims = currentVol.dims.map(d => Math.ceil(d / factor));
      const newSpacing = currentVol.spacing.map(s => s * factor);
      
      // Downsample data
      const downsampled = this.downsample(currentVol, factor);
      
      this.resolutions.set(level, new FloatNeuroVol(
        new NeuroSpace(newDims, newSpacing, currentVol.origin, currentVol.axes),
        downsampled
      ));
    }
  }
  
  getResolution(zoomLevel: number): NeuroVol {
    // Select appropriate resolution based on zoom
    if (zoomLevel > 4) return this.resolutions.get(1)!;
    if (zoomLevel > 2) return this.resolutions.get(2)!;
    if (zoomLevel > 1) return this.resolutions.get(3)!;
    return this.resolutions.get(4)!;
  }
}
```

## Alignment Strategies

### Center Alignment

Best for whole-brain comparisons:

```typescript
const imageLayer = new ImageLayer(volStack, {
  strategy: 'center',
  anchor: { x: 0.5, y: 0.5 } // Center anchor point
});
```

### Corner Alignment

Useful for edge-aligned data:

```typescript
const imageLayer = new ImageLayer(volStack, {
  strategy: 'corner',
  allowRotation: true // Enable rotation for better edge matching
});
```

### Overlap Alignment

Optimal for partially overlapping ROIs:

```typescript
const imageLayer = new ImageLayer(volStack, {
  strategy: 'overlap',
  maintainAspectRatio: false // Allow independent X/Y scaling
});
```

### Custom Alignment

Implement custom alignment logic:

```typescript
class LandmarkAlignmentStrategy implements IAlignmentStrategy {
  private landmarks: Map<string, [number, number, number]>;
  
  constructor(landmarks: Map<string, [number, number, number]>) {
    this.landmarks = landmarks;
  }
  
  getName(): string {
    return 'landmark';
  }
  
  canHandle(targetSlice: ImageSlice, referenceSlice: ImageSlice): boolean {
    // Check if both slices have landmarks
    return true;
  }
  
  align(
    targetSlice: ImageSlice,
    referenceSlice: ImageSlice,
    options: AlignmentOptions = {}
  ): AlignmentResult {
    // Calculate transform based on landmark correspondence
    const targetLandmark = this.findLandmarkInSlice(targetSlice);
    const refLandmark = this.findLandmarkInSlice(referenceSlice);
    
    // Compute alignment to match landmarks
    const offset = {
      x: refLandmark.x - targetLandmark.x,
      y: refLandmark.y - targetLandmark.y
    };
    
    return {
      position: offset,
      scale: { x: 1, y: 1 },
      pivot: { x: targetLandmark.x, y: targetLandmark.y }
    };
  }
  
  private findLandmarkInSlice(slice: ImageSlice): { x: number, y: number } {
    // Implementation to find landmark in slice
    return { x: 0, y: 0 };
  }
}

// Register and use custom strategy
const alignmentManager = imageLayer['alignmentManager'];
alignmentManager.registerStrategy(new LandmarkAlignmentStrategy(landmarks));
```

## Performance Optimization

### Caching Strategies

```typescript
// Configure cache size and behavior
const imageLayer = new ImageLayer(volStack, {
  enableCache: true,
  maxCacheSize: 100 // Maximum cached alignments
});

// Monitor cache performance
const cacheStats = imageLayer.getAlignmentCacheStats();
console.log(`Cache hit rate: ${cacheStats.hitRate}%`);

// Clear cache when switching datasets
imageLayer.alignmentManager.clearCache();
```

### Memory Management

```typescript
class MemoryManagedViewer {
  private imageLayer: ImageLayer;
  private memoryLimit: number = 500 * 1024 * 1024; // 500MB
  
  constructor(volStack: VolStack) {
    this.imageLayer = new ImageLayer(volStack, {
      maxTextureSize: 2048,
      enableMipmaps: false // Save memory for static views
    });
    
    this.monitorMemory();
  }
  
  private monitorMemory() {
    setInterval(() => {
      const stats = this.imageLayer.getMemoryStats();
      const totalMemory = stats.textures.total + stats.buffers.total;
      
      if (totalMemory > this.memoryLimit) {
        this.reduceMemoryUsage();
      }
    }, 5000);
  }
  
  private reduceMemoryUsage() {
    // Clear unused textures
    this.imageLayer.clearUnusedTextures();
    
    // Reduce cache size
    this.imageLayer.alignmentManager.setCacheSize(50);
    
    // Force garbage collection
    if (global.gc) global.gc();
  }
}
```

### Batch Rendering

```typescript
// Render multiple slices efficiently
async function renderSliceRange(
  imageLayer: ImageLayer,
  startSlice: number,
  endSlice: number,
  axis: AxisSet3D
): Promise<PIXI.Container[]> {
  const containers: PIXI.Container[] = [];
  
  // Batch render for better performance
  for (let i = startSlice; i <= endSlice; i++) {
    const container = new PIXI.Container();
    const result = imageLayer.renderSlice(
      i,
      [40, 40, i],
      axis,
      container
    );
    
    if (result) {
      containers.push(result);
    }
    
    // Yield to prevent blocking
    if (i % 10 === 0) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
  
  return containers;
}
```

## Advanced Examples

### Multi-Modal Visualization

```typescript
// Create multi-modal stack with T1, T2, and DTI
const t1Layer = new VolLayer('T1', t1Volume, grayColorMap);
const t2Layer = new VolLayer('T2', t2Volume, grayColorMap);
const dtiLayer = new VolLayer('DTI', dtiVolume, rainbowColorMap);

// Configure layer properties
t1Layer.opacity = 1.0;
t2Layer.opacity = 0.0;
dtiLayer.opacity = 0.6;

const multiModalStack = new VolStack(t1Layer, t2Layer, dtiLayer);

// Create viewer with layer switching
class MultiModalViewer {
  private imageLayer: ImageLayer;
  private currentModality: string = 'T1';
  
  switchModality(modality: string) {
    const layers = this.imageLayer.volStack.layers;
    
    layers.forEach(layer => {
      layer.opacity = layer.name === modality ? 1.0 : 0.0;
    });
    
    // Keep DTI overlay if enabled
    if (this.dtiOverlayEnabled) {
      layers.find(l => l.name === 'DTI')!.opacity = 0.6;
    }
    
    this.imageLayer.renderCurrentSlice();
  }
}
```

### Time Series Visualization

```typescript
// Handle 4D time series data
class TimeSeriesViewer {
  private volumes: NeuroVol[];
  private currentTime: number = 0;
  private imageLayer: ImageLayer;
  
  constructor(timeSeriesData: NeuroVol[]) {
    this.volumes = timeSeriesData;
    this.updateDisplay();
  }
  
  private updateDisplay() {
    // Create layers for current and previous timepoint
    const currentLayer = new VolLayer(
      'current',
      this.volumes[this.currentTime],
      hotColorMap
    );
    
    const previousLayer = new VolLayer(
      'previous',
      this.volumes[Math.max(0, this.currentTime - 1)],
      coolColorMap
    );
    previousLayer.opacity = 0.3;
    
    const volStack = new VolStack(previousLayer, currentLayer);
    
    // Update or create image layer
    if (this.imageLayer) {
      this.imageLayer.dispose();
    }
    
    this.imageLayer = new ImageLayer(volStack, {
      strategy: 'center', // Time series usually aligned
      enableCache: true
    });
  }
  
  nextTimePoint() {
    this.currentTime = (this.currentTime + 1) % this.volumes.length;
    this.updateDisplay();
  }
  
  playAnimation(fps: number = 10) {
    setInterval(() => this.nextTimePoint(), 1000 / fps);
  }
}
```

### Interactive ROI Drawing

```typescript
class ROIDrawingTool {
  private imageLayer: ImageLayer;
  private roiLayer: PIXI.Graphics;
  private currentROI: number[] = [];
  
  enableDrawing(container: PIXI.Container) {
    this.roiLayer = new PIXI.Graphics();
    container.addChild(this.roiLayer);
    
    container.interactive = true;
    container.on('pointerdown', this.startDrawing.bind(this));
    container.on('pointermove', this.continueDrawing.bind(this));
    container.on('pointerup', this.finishDrawing.bind(this));
  }
  
  private startDrawing(event: PIXI.InteractionEvent) {
    const pos = event.data.getLocalPosition(event.currentTarget);
    this.currentROI = [pos.x, pos.y];
    
    this.roiLayer.clear();
    this.roiLayer.lineStyle(2, 0xff0000);
    this.roiLayer.moveTo(pos.x, pos.y);
  }
  
  private continueDrawing(event: PIXI.InteractionEvent) {
    if (this.currentROI.length === 0) return;
    
    const pos = event.data.getLocalPosition(event.currentTarget);
    this.roiLayer.lineTo(pos.x, pos.y);
    this.currentROI.push(pos.x, pos.y);
  }
  
  private finishDrawing() {
    if (this.currentROI.length > 4) {
      // Close the ROI
      this.roiLayer.closePath();
      
      // Convert to world coordinates
      const worldROI = this.convertToWorldCoordinates(this.currentROI);
      
      // Save ROI
      this.saveROI(worldROI);
    }
    
    this.currentROI = [];
  }
}
```

## Common Patterns

### Layer Toggle Controls

```typescript
function createLayerControls(imageLayer: ImageLayer): HTMLElement {
  const controls = document.createElement('div');
  controls.className = 'layer-controls';
  
  imageLayer.volStack.layers.forEach((layer, index) => {
    const control = document.createElement('div');
    control.className = 'layer-control';
    
    // Visibility toggle
    const visToggle = document.createElement('input');
    visToggle.type = 'checkbox';
    visToggle.checked = layer.opacity > 0;
    visToggle.onchange = () => {
      layer.opacity = visToggle.checked ? 1.0 : 0.0;
      imageLayer.renderCurrentSlice();
    };
    
    // Opacity slider
    const opacitySlider = document.createElement('input');
    opacitySlider.type = 'range';
    opacitySlider.min = '0';
    opacitySlider.max = '100';
    opacitySlider.value = String(layer.opacity * 100);
    opacitySlider.oninput = () => {
      layer.opacity = parseFloat(opacitySlider.value) / 100;
      imageLayer.renderCurrentSlice();
    };
    
    control.appendChild(visToggle);
    control.appendChild(document.createTextNode(layer.name));
    control.appendChild(opacitySlider);
    controls.appendChild(control);
  });
  
  return controls;
}
```

### Synchronized Views

```typescript
class SynchronizedViewManager {
  private views: Map<string, ImageLayer> = new Map();
  private currentPosition: [number, number, number] = [40, 40, 40];
  
  addView(name: string, imageLayer: ImageLayer) {
    this.views.set(name, imageLayer);
  }
  
  updatePosition(position: [number, number, number]) {
    this.currentPosition = position;
    
    // Update all views
    this.views.forEach((imageLayer, viewName) => {
      const axis = this.getAxisForView(viewName);
      const sliceIndex = this.getSliceIndex(position, axis);
      
      imageLayer.renderSlice(
        sliceIndex,
        position,
        axis,
        imageLayer.container
      );
    });
  }
  
  private getAxisForView(viewName: string): AxisSet3D {
    switch (viewName) {
      case 'axial': return AxisSet3D.fromStr('XYZ');
      case 'sagittal': return AxisSet3D.fromStr('YZX');
      case 'coronal': return AxisSet3D.fromStr('XZY');
      default: return AxisSet3D.AXIAL_LPI;
    }
  }
}
```

### Error Handling

```typescript
class RobustImageLayer extends ImageLayer {
  renderSlice(
    sliceIndex: number,
    position: [number, number, number],
    axis: AxisSet3D,
    container: PIXI.Container
  ): PIXI.Container | null {
    try {
      return super.renderSlice(sliceIndex, position, axis, container);
    } catch (error) {
      console.error('Slice rendering failed:', error);
      
      // Return error placeholder
      const errorContainer = new PIXI.Container();
      const errorText = new PIXI.Text('Rendering Error', {
        fill: 0xff0000,
        fontSize: 16
      });
      errorContainer.addChild(errorText);
      
      return errorContainer;
    }
  }
  
  handleAlignmentError(error: Error, layer: VolLayer) {
    console.warn(`Alignment failed for layer ${layer.name}:`, error);
    
    // Fall back to no alignment
    return {
      position: { x: 0, y: 0 },
      scale: { x: 1, y: 1 },
      pivot: { x: 0, y: 0 }
    };
  }
}
```

## Next Steps

- Explore the [API Reference](./README.md) for detailed documentation
- Try the [interactive example](../../examples/multi-layer-viewer.html)
- Review the [test suite](../../src/display/__tests__/integration/MultiLayerAlignment.test.ts) for more examples