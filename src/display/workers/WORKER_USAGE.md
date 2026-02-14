# Web Worker Usage Guide

This document explains how to use web workers in neuroimjs for offloading heavy computations.

## Overview

Web workers allow CPU-intensive operations to run in background threads, preventing UI freezing and improving performance. The neuroimjs display system provides:

- **SliceWorker**: Handles slice extraction, processing, and resampling
- **WorkerPool**: Manages multiple workers for parallel processing
- **WorkerService**: High-level API for easy integration

## Basic Usage

### Initialize Worker Service

```typescript
import { WorkerService } from './workers/WorkerService';

// Get singleton instance
const workerService = WorkerService.getInstance({
  enabled: true,
  maxWorkers: 4,
  workerUrl: '/workers/SliceWorker.js'
});

// Check if workers are available
if (workerService.isEnabled()) {
  console.log('Web workers are available');
}
```

### Extract Slices

```typescript
// Extract a slice from volume data using workers
const slice = await workerService.extractSlice(
  volumeData,        // Float32Array
  [256, 256, 128],   // Dimensions
  64,                // Slice index
  2,                 // Axis (Z)
  [1.0, 1.0, 2.0],   // Spacing
  (progress) => {
    console.log(`Extraction progress: ${progress}%`);
  }
);
```

### Process Images

```typescript
// Apply filters to image data
const blurred = await workerService.processSlice(
  imageData,
  'blur',
  { radius: 2 },
  (progress) => console.log(`Blur progress: ${progress}%`)
);

const edges = await workerService.processSlice(
  imageData,
  'edge',
  { threshold: 50 }
);

const sharpened = await workerService.processSlice(
  imageData,
  'sharpen',
  { strength: 1.5 }
);
```

### Batch Processing

```typescript
// Process multiple slices in parallel
const tasks = slices.map(slice => ({
  imageData: slice.data,
  operation: 'blur' as const,
  params: { radius: 1 }
}));

const results = await workerService.processSlicesBatch(
  tasks,
  (taskIndex, progress) => {
    console.log(`Task ${taskIndex}: ${progress}%`);
  }
);
```

### Resample Images

```typescript
// Resample image to different resolution
const resampled = await workerService.resampleImage(
  imageData,
  512,        // Target width
  512,        // Target height
  'bilinear', // Method: 'nearest', 'bilinear', 'bicubic'
  (progress) => console.log(`Resample progress: ${progress}%`)
);
```

## Integration with Display Components

### Using Workers in ImageLayer

```typescript
import { ImageLayer } from '../ImageLayer';
import { WorkerService } from './workers/WorkerService';

export class WorkerEnabledImageLayer extends ImageLayer {
  private workerService = WorkerService.getInstance();
  
  async renderSliceAsync(
    sliceIndex: number,
    coord: number[],
    viewAxes: AxisSet3D,
    parentContainer: PIXI.Container
  ): Promise<PIXI.Container | null> {
    if (!this.workerService.isEnabled()) {
      // Fallback to synchronous rendering
      return this.renderSlice(sliceIndex, coord, viewAxes, parentContainer);
    }
    
    // Use workers for slice extraction
    const promises = [];
    
    for (let i = 0; i < this.volumeStack.length; i++) {
      const layer = this.volumeStack.getLayer(i);
      
      promises.push(
        this.workerService.extractSlice(
          layer.getData(),
          layer.getDimensions(),
          sliceIndex,
          viewAxes.normalAxis,
          layer.getSpacing()
        )
      );
    }
    
    const slices = await Promise.all(promises);
    
    // Continue with rendering...
    // ... rest of implementation
  }
}
```

### Processing Pipeline

```typescript
// Create a processing pipeline using workers
async function processVolumeSlices(volume: NeuroVol) {
  const workerService = WorkerService.getInstance();
  const processedSlices = [];
  
  // Extract and process each slice
  for (let z = 0; z < volume.dims[2]; z++) {
    // Extract slice
    const slice = await workerService.extractSlice(
      volume.data,
      volume.dims,
      z,
      2, // Z-axis
      volume.spacing
    );
    
    // Apply edge detection
    const edges = await workerService.processSlice(
      slice.data,
      'edge',
      { threshold: 100 }
    );
    
    processedSlices.push(edges);
  }
  
  return processedSlices;
}
```

## Performance Considerations

### Worker Pool Configuration

```typescript
// Adjust worker pool size based on workload
const stats = workerService.getStats();

if (stats.poolStats && stats.poolStats.queuedTasks > 10) {
  // Increase workers if many tasks are queued
  workerService.setMaxWorkers(8);
}

// Monitor performance
console.log('Worker stats:', stats);
```

### Memory Management

Workers operate in separate contexts with their own memory:

```typescript
// Large data transfers can be expensive
// Consider using SharedArrayBuffer for large datasets

// Bad: Frequent large transfers
for (let i = 0; i < 1000; i++) {
  await workerService.processSlice(largeImage, 'blur');
}

// Better: Batch processing
const batch = Array(10).fill(largeImage).map(img => ({
  imageData: img,
  operation: 'blur' as const
}));
await workerService.processSlicesBatch(batch);
```

## Error Handling

```typescript
try {
  const result = await workerService.processSlice(
    imageData,
    'blur',
    { radius: 2 }
  );
} catch (error) {
  console.error('Worker processing failed:', error);
  
  // Fallback to main thread processing
  const result = processImageSync(imageData, 'blur');
}
```

## Cleanup

Always clean up workers when done:

```typescript
// In component cleanup
dispose() {
  // Terminate worker service
  WorkerService.getInstance().terminate();
  
  // Other cleanup...
  super.dispose();
}
```

## Browser Compatibility

Web Workers are supported in all modern browsers, but check availability:

```typescript
if (typeof Worker === 'undefined') {
  console.warn('Web Workers not supported');
  // Use synchronous fallback
}

// The WorkerService handles this automatically
const service = WorkerService.getInstance();
if (!service.isEnabled()) {
  // Workers not available
}
```

## Building Worker Scripts

The worker script needs to be built separately:

```json
// webpack.config.js
{
  entry: {
    main: './src/index.ts',
    SliceWorker: './src/display/workers/SliceWorker.ts'
  },
  output: {
    filename: '[name].js',
    path: path.resolve(__dirname, 'dist/workers')
  }
}
```

## Best Practices

1. **Use workers for CPU-intensive tasks**
   - Slice extraction from large volumes
   - Image filtering and processing
   - Resampling operations

2. **Avoid workers for small tasks**
   - Communication overhead may outweigh benefits
   - Simple operations are faster on main thread

3. **Batch operations when possible**
   - Reduces communication overhead
   - Better utilizes worker pool

4. **Monitor performance**
   - Use getStats() to track worker utilization
   - Adjust pool size based on workload

5. **Handle errors gracefully**
   - Always provide fallbacks
   - Workers may not be available in all environments

6. **Clean up properly**
   - Terminate workers when done
   - Prevent memory leaks

## Example: Complete Integration

```typescript
import { ImageLayer } from '../ImageLayer';
import { WorkerService } from './workers/WorkerService';
import { VolStack } from '../VolStack';

export class OptimizedImageLayer extends ImageLayer {
  private workerService: WorkerService;
  private useWorkers: boolean;
  
  constructor(
    volStack: VolStack,
    options?: {
      useWorkers?: boolean;
      workerOptions?: WorkerServiceOptions;
    }
  ) {
    super(volStack);
    
    this.workerService = WorkerService.getInstance(options?.workerOptions);
    this.useWorkers = options?.useWorkers !== false && this.workerService.isEnabled();
  }
  
  async preprocessSlices(): Promise<void> {
    if (!this.useWorkers) {
      return;
    }
    
    const stats = this.workerService.getStats();
    console.log('Worker pool stats:', stats);
    
    // Preprocess slices in parallel
    const tasks = [];
    
    for (let i = 0; i < this.volumeStack.length; i++) {
      const layer = this.volumeStack.getLayer(i);
      
      // Apply preprocessing based on layer type
      if (layer.needsEdgeEnhancement) {
        tasks.push({
          imageData: layer.getCurrentSlice(),
          operation: 'edge' as const,
          params: { threshold: 50 }
        });
      } else if (layer.needsSmoothing) {
        tasks.push({
          imageData: layer.getCurrentSlice(),
          operation: 'blur' as const,
          params: { radius: 1 }
        });
      }
    }
    
    if (tasks.length > 0) {
      const results = await this.workerService.processSlicesBatch(tasks);
      // Apply results back to layers
      // ...
    }
  }
  
  dispose(): void {
    // Clean up workers if this was the last user
    const stats = this.workerService.getStats();
    if (stats.poolStats?.busyWorkers === 0) {
      this.workerService.terminate();
    }
    
    super.dispose();
  }
}
```