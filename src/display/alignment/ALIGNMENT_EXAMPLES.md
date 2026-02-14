# Multi-Layer Alignment Examples

This document provides examples of how to use the multi-layer alignment system in neuroimjs.

## Overview

The alignment system provides sophisticated methods for aligning neuroimaging layers with different:
- Resolutions (voxel sizes)
- Fields of view (FOV)
- Orientations
- Coordinate systems

## Basic Usage

### Creating an ImageLayer with Alignment Options

```typescript
import { ImageLayer } from '../ImageLayer';
import { VolStack } from '../VolStack';

// Create a volume stack with multiple layers
const volStack = new VolStack(referenceSpace);

// Create ImageLayer with specific alignment options
const imageLayer = new ImageLayer(volStack, {
  strategy: 'auto',           // Automatic strategy selection
  enableCache: true,          // Cache alignment results
  maintainAspectRatio: false, // Allow non-uniform scaling
  maxScale: 10,              // Prevent excessive upscaling
  minScale: 0.1              // Prevent excessive downscaling
});
```

## Alignment Strategies

### 1. Center Alignment (Default)

Aligns layers by their centers. Best for layers with similar FOV but different resolutions.

```typescript
imageLayer.setAlignmentStrategy('center');
```

**Use cases:**
- Standard multi-modal registration
- Layers with similar coverage but different voxel sizes
- Quick alignment without fine-tuning

### 2. Corner Alignment

Aligns layers by matching their corner points. Best for layers with significantly different resolutions.

```typescript
imageLayer.setAlignmentStrategy('corner');
```

**Use cases:**
- High-resolution insets or regions of interest
- Layers with very different voxel sizes (>2x difference)
- Edge-critical alignments

### 3. Overlap Alignment

Optimizes alignment for maximum overlap between layers. Best for partially overlapping datasets.

```typescript
imageLayer.setAlignmentStrategy('overlap');
```

**Use cases:**
- Partial brain coverage scans
- Multiple slabs or patches
- Maximizing visible overlap region

### 4. Automatic Selection

Let the system choose the best strategy based on layer properties.

```typescript
imageLayer.setAlignmentStrategy('auto');
```

The system will:
1. Check for significant overlap (>30%) → Use overlap strategy
2. Check for large resolution differences (>2x) → Use corner strategy
3. Otherwise → Use center strategy

## Advanced Configuration

### Runtime Configuration

```typescript
// Change alignment options at runtime
imageLayer.setAlignmentOptions({
  maintainAspectRatio: true,
  maxScale: 5
});

// Change just the strategy
imageLayer.setAlignmentStrategy('corner');

// Get current options
const options = imageLayer.getAlignmentOptions();
```

### Performance Optimization

```typescript
// Monitor cache performance
const cacheStats = imageLayer.getAlignmentCacheStats();
console.log(`Cache size: ${cacheStats.size}, Enabled: ${cacheStats.enabled}`);

// Clear cache if needed (e.g., after significant changes)
imageLayer.clearAlignmentCache();

// Disable caching for dynamic scenarios
imageLayer.setAlignmentOptions({ enableCache: false });
```

## Real-World Examples

### Example 1: T1 and fMRI Alignment

```typescript
// T1: High-resolution structural (1mm isotropic)
// fMRI: Low-resolution functional (3mm isotropic)

const imageLayer = new ImageLayer(volStack, {
  strategy: 'center',         // Both cover full brain
  maintainAspectRatio: true,  // Preserve aspect ratio
  maxScale: 5                 // Limit upscaling of fMRI
});
```

### Example 2: Whole Brain and ROI

```typescript
// Whole brain: Standard resolution
// ROI: High-resolution hippocampus scan

const imageLayer = new ImageLayer(volStack, {
  strategy: 'corner',         // Very different resolutions
  maintainAspectRatio: false, // Allow non-uniform scaling
  allowRotation: true         // Handle oblique acquisitions
});
```

### Example 3: Multiple Overlapping Slabs

```typescript
// Multiple partially overlapping slabs

const imageLayer = new ImageLayer(volStack, {
  strategy: 'overlap',        // Maximize overlap visibility
  maintainAspectRatio: true,  // Consistent scaling
  enableCache: true           // Cache for performance
});
```

## Custom Alignment Strategies

You can create custom alignment strategies:

```typescript
import { IAlignmentStrategy, AlignmentResult, AlignmentOptions } from './IAlignmentStrategy';
import { ImageSlice } from '../ImageSlice';
import * as PIXI from 'pixi.js';

class CustomAlignmentStrategy implements IAlignmentStrategy {
  getName(): string {
    return 'custom';
  }
  
  canHandle(targetSlice: ImageSlice, referenceSlice: ImageSlice): boolean {
    // Custom logic to determine if this strategy applies
    return true;
  }
  
  align(
    targetSlice: ImageSlice,
    referenceSlice: ImageSlice,
    options?: AlignmentOptions
  ): AlignmentResult {
    // Custom alignment logic
    return {
      position: { x: 0, y: 0 },
      scale: { x: 1, y: 1 },
      pivot: { x: 0, y: 0 },
      rotation: 0
    };
  }
  
  applyAlignment(sprite: PIXI.Sprite, alignment: AlignmentResult): void {
    sprite.pivot.set(alignment.pivot.x, alignment.pivot.y);
    sprite.position.set(alignment.position.x, alignment.position.y);
    sprite.scale.set(alignment.scale.x, alignment.scale.y);
    if (alignment.rotation !== undefined) {
      sprite.rotation = alignment.rotation;
    }
  }
}

// Register the custom strategy
const alignmentManager = imageLayer.getAlignmentManager(); // Note: This method would need to be added
alignmentManager.registerStrategy(new CustomAlignmentStrategy());
```

## Troubleshooting

### Layers Not Aligning Properly

1. Check coordinate systems match (LPI convention)
2. Verify spacing values are correct
3. Try different strategies
4. Check for rotation/oblique acquisitions

### Performance Issues

1. Enable caching: `enableCache: true`
2. Reduce texture cache size if memory is limited
3. Use appropriate pool sizes for sprites/containers
4. Clear cache periodically for dynamic scenarios

### Visual Artifacts

1. Check scale limits (maxScale/minScale)
2. Verify aspect ratio settings
3. Ensure proper coordinate transformations
4. Check for numerical precision issues (use epsilon tolerance)

## Best Practices

1. **Start with 'auto' strategy** - Let the system choose based on data properties
2. **Enable caching** - Significant performance improvement for static layers
3. **Set appropriate scale limits** - Prevent excessive scaling that degrades quality
4. **Monitor performance** - Use getPoolStats() and getCacheStats()
5. **Clear cache when needed** - After significant changes to layers
6. **Use appropriate strategies** - Match strategy to your specific use case
7. **Test with real data** - Alignment behavior depends on actual data properties