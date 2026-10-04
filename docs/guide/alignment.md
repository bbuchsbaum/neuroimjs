# Multi-Layer Alignment System

The neuroimjs multi-layer alignment system enables precise visualization of multiple neuroimaging volumes with different fields of view (FOV), resolutions, and coordinate systems. This document provides comprehensive documentation for the alignment API.

## Overview

The alignment system consists of several key components:

1. **AlignmentManager**: Orchestrates alignment strategies and caching
2. **Alignment Strategies**: Different algorithms for aligning layers
   - CenterAlignmentStrategy: Aligns layers by their centers
   - CornerAlignmentStrategy: Aligns layers by matching corners
   - OverlapAlignmentStrategy: Optimizes for maximum overlap
3. **ImageLayer**: Manages rendering with automatic alignment
4. **VolStack**: Container for multiple volume layers

## Core Concepts

### World Space Coordinates

All alignment is performed in NIFTI LPI (Left-Posterior-Inferior) world space coordinates:
- X-axis: Left to Right
- Y-axis: Posterior to Anterior  
- Z-axis: Inferior to Superior

### Spacing and Resolution

Each volume has voxel spacing (in mm) that defines the physical size of each voxel:
```typescript
const spacing = [2.0, 2.0, 2.0]; // 2mm isotropic voxels
```

### Alignment Result

An alignment result contains:
```typescript
interface AlignmentResult {
  position: { x: number; y: number };  // Position in reference space
  scale: { x: number; y: number };     // Scale factors
  pivot: { x: number; y: number };     // Pivot point for transforms
  rotation?: number;                   // Optional rotation in radians
}
```

## API Reference

### AlignmentManager

```typescript
class AlignmentManager {
  constructor()
  
  // Register a custom alignment strategy
  registerStrategy(strategy: IAlignmentStrategy): void
  
  // Get a registered strategy by name
  getStrategy(name: string): IAlignmentStrategy | undefined
  
  // Automatically select the best strategy
  selectBestStrategy(
    targetSlice: ImageSlice, 
    referenceSlice: ImageSlice
  ): IAlignmentStrategy
  
  // Align a sprite to match a reference slice
  alignSprite(
    sprite: PIXI.Sprite,
    targetSlice: ImageSlice,
    referenceSlice: ImageSlice,
    options?: AlignmentManagerOptions
  ): AlignmentResult
  
  // Cache management
  clearCache(): void
  setCacheEnabled(enabled: boolean): void
  getCacheStats(): { size: number; enabled: boolean }
}
```

### AlignmentManagerOptions

```typescript
interface AlignmentManagerOptions {
  strategy?: 'auto' | 'center' | 'corner' | 'overlap';
  enableCache?: boolean;
  maintainAspectRatio?: boolean;
  allowRotation?: boolean;
  maxScale?: number;
  minScale?: number;
  anchor?: { x: number; y: number };
}
```

### ImageLayer

```typescript
class ImageLayer {
  constructor(
    volStack: VolStack,
    options?: ImageLayerOptions
  )
  
  // Render a slice with automatic alignment
  renderSlice(
    sliceIndex: number,
    position: [number, number, number],
    axis: AxisSet3D,
    container: PIXI.Container
  ): PIXI.Container | null
  
  // Memory and performance management
  dispose(): void
  getMemoryStats(): MemoryStats
  getAlignmentCacheStats(): { size: number; enabled: boolean }
}
```

### ImageLayerOptions

```typescript
interface ImageLayerOptions {
  strategy?: AlignmentStrategyType;
  enableCache?: boolean;
  maintainAspectRatio?: boolean;
  maxTextureSize?: number;
  enableMipmaps?: boolean;
}
```

## Alignment Strategies

### Center Alignment Strategy

Aligns volumes by their centers with spacing-based scaling. Best for:
- Volumes with similar coverage
- Quick alignment without optimization
- Default fallback strategy

```typescript
const strategy = new CenterAlignmentStrategy();
const result = strategy.align(targetSlice, referenceSlice, {
  maintainAspectRatio: false,
  anchor: { x: 0.5, y: 0.5 }
});
```

### Corner Alignment Strategy  

Aligns volumes by matching their corner points. Best for:
- Volumes with very different resolutions
- Edge-aligned data
- Registration tasks

```typescript
const strategy = new CornerAlignmentStrategy();
const result = strategy.align(targetSlice, referenceSlice, {
  allowRotation: true
});
```

### Overlap Alignment Strategy

Optimizes alignment for maximum overlap between layers. Best for:
- Partially overlapping volumes
- Co-registered data
- ROI visualization

```typescript
const strategy = new OverlapAlignmentStrategy();
const result = strategy.align(targetSlice, referenceSlice, {
  maintainAspectRatio: true
});
```

## Custom Alignment Strategies

Implement the `IAlignmentStrategy` interface:

```typescript
interface IAlignmentStrategy {
  getName(): string;
  canHandle(
    targetSlice: ImageSlice, 
    referenceSlice: ImageSlice
  ): boolean;
  align(
    targetSlice: ImageSlice,
    referenceSlice: ImageSlice,
    options?: AlignmentOptions
  ): AlignmentResult;
  applyAlignment(
    sprite: PIXI.Sprite, 
    alignment: AlignmentResult
  ): void;
}
```

Example custom strategy:

```typescript
class MyCustomStrategy implements IAlignmentStrategy {
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
    options: AlignmentOptions = {}
  ): AlignmentResult {
    // Custom alignment algorithm
    return {
      position: { x: 0, y: 0 },
      scale: { x: 1, y: 1 },
      pivot: { x: 0, y: 0 }
    };
  }
  
  applyAlignment(sprite: PIXI.Sprite, alignment: AlignmentResult): void {
    sprite.pivot.set(alignment.pivot.x, alignment.pivot.y);
    sprite.position.set(alignment.position.x, alignment.position.y);
    sprite.scale.set(alignment.scale.x, alignment.scale.y);
  }
}

// Register the custom strategy
alignmentManager.registerStrategy(new MyCustomStrategy());
```

## Performance Considerations

### Caching

The alignment system includes automatic caching of alignment calculations:

```typescript
// Enable/disable caching
imageLayer.alignmentManager.setCacheEnabled(true);

// Check cache statistics
const stats = imageLayer.getAlignmentCacheStats();
console.log(`Cache size: ${stats.size}`);

// Clear cache when needed
imageLayer.alignmentManager.clearCache();
```

### Memory Management

Monitor and manage memory usage:

```typescript
const memStats = imageLayer.getMemoryStats();
console.log(`Texture memory: ${memStats.textures.total / 1024 / 1024} MB`);
console.log(`Cached alignments: ${memStats.alignment.count}`);

// Dispose resources when done
imageLayer.dispose();
```

### Best Practices

1. **Enable caching** for repeated slice rendering
2. **Set appropriate scale limits** to prevent extreme transformations
3. **Use 'auto' strategy** unless specific alignment is needed
4. **Dispose resources** when layers are no longer needed
5. **Monitor memory usage** for large datasets

## Troubleshooting

### Common Issues

1. **Misaligned layers**: Check that both volumes use the same coordinate system (LPI)
2. **Performance issues**: Enable caching and reduce texture size
3. **Memory errors**: Dispose unused layers and clear caches
4. **Scaling problems**: Verify spacing values are correct in mm

### Debug Utilities

```typescript
// Log alignment details
const result = alignmentManager.alignSprite(sprite, target, reference);
console.log('Alignment:', {
  scale: result.scale,
  position: result.position,
  pivot: result.pivot
});

// Check strategy selection
const strategy = alignmentManager.selectBestStrategy(target, reference);
console.log('Selected strategy:', strategy.getName());
```