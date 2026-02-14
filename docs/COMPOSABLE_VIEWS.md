# Composable Views Guide

This guide explains how to create custom viewer layouts using individual composable view components from neuroimjs.

## Table of Contents

- [Overview](#overview)
- [Key Components](#key-components)
- [Quick Start](#quick-start)
- [Creating Individual Views](#creating-individual-views)
- [Synchronizing Views](#synchronizing-views)
- [Event Handling](#event-handling)
- [Coordinate Systems](#coordinate-systems)
- [Custom Layers](#custom-layers)
- [Advanced Patterns](#advanced-patterns)
- [API Reference](#api-reference)

## Overview

neuroimjs provides two approaches for creating neuroimaging viewers:

1. **Pre-composed Viewers**: Use `SimpleOrthogonalViewer` for a standard 3-view layout
2. **Composable Views**: Use `SingleSliceViewer` and `ViewSynchronizer` to build custom layouts

The composable approach is ideal when you need:
- Custom panel arrangements
- Views spanning multiple windows or applications
- Non-standard view combinations (e.g., two axial views at different positions)
- Integration with existing GUI frameworks
- Fine-grained control over synchronization behavior

## Key Components

### SingleSliceViewer

A standalone view component that displays a single orientation (axial, sagittal, or coronal).

**Features:**
- Event-driven API for coordinate and interaction events
- Direct access to coordinate transformers
- Mouse event tracking (image, volume, and world coordinates)
- Crosshair and slider controls
- Full resize support

### ViewSynchronizer

Manages coordinate synchronization across multiple `SingleSliceViewer` instances.

**Features:**
- Sync arbitrary numbers of views
- Toggle synchronization on/off at runtime
- Choose between click-only or hover synchronization
- Programmatic coordinate updates
- Add/remove views dynamically

### SliceLayer Interface

Extensible layer system for custom rendering and overlays.

**Built-in layers:**
- `ImageLayer`: Volume data rendering
- `CrossHair`: Crosshair overlays
- `ClusterLayer`: ROI/cluster boundaries
- `PositionLabel`: Text labels

## Quick Start

### Single View

```typescript
import { VolStack, SingleSliceViewer } from 'neuroimjs';

// Load volume data
const volStack = await VolStack.fromNifti('brain.nii.gz');

// Create a single axial view
const axialView = await SingleSliceViewer.createAxial(
  document.getElementById('viewer-container'),
  volStack,
  {
    showCrosshair: true,
    showSlider: true,
    width: 512,
    height: 512
  }
);

// Listen to events
axialView.onCoordChange(coord => {
  console.log('New coordinate:', coord);
});
```

### Synchronized Views

```typescript
import { VolStack, SingleSliceViewer, ViewSynchronizer } from 'neuroimjs';

// Load volume
const volStack = await VolStack.fromNifti('brain.nii.gz');

// Create views
const axial = await SingleSliceViewer.createAxial(axialContainer, volStack);
const sagittal = await SingleSliceViewer.createSagittal(sagContainer, volStack);
const coronal = await SingleSliceViewer.createCoronal(coronalContainer, volStack);

// Create synchronizer
const sync = ViewSynchronizer.createOrthogonal(
  axial,
  sagittal,
  coronal,
  { syncOnHover: false } // Sync on click only
);

// Now clicks in any view will update the others!
```

## Creating Individual Views

### Factory Methods

`SingleSliceViewer` provides convenient factory methods for standard orientations:

```typescript
// Axial view (looking down through the head)
const axial = await SingleSliceViewer.createAxial(container, volStack, options);

// Sagittal view (looking from the side)
const sagittal = await SingleSliceViewer.createSagittal(container, volStack, options);

// Coronal view (looking from the front)
const coronal = await SingleSliceViewer.createCoronal(container, volStack, options);
```

### Custom Orientations

For custom orientations, use the `create()` method with a custom `AxisSet3D`:

```typescript
import { AxisSet3D } from 'neuroimjs';

// Create a custom orientation
const customAxes = new AxisSet3D(/* custom axis configuration */);

const customView = await SingleSliceViewer.create(
  container,
  volStack,
  customAxes,
  options
);
```

### View Options

```typescript
interface SingleSliceViewerOptions {
  // Dimensions
  width?: number;        // Width in pixels
  height?: number;       // Height in pixels

  // Controls
  showCrosshair?: boolean;  // Show crosshair overlay
  showSlider?: boolean;     // Show slice navigation slider

  // Initial position
  initialCoord?: number[];  // Starting coordinate [x, y, z] in mm
}
```

## Synchronizing Views

### Basic Synchronization

```typescript
// Create a synchronizer
const sync = new ViewSynchronizer({
  syncOnHover: false,  // Only sync on clicks, not mouse movement
  syncOnAdd: false     // Don't sync when views are first added
});

// Add views
sync.addView('axial', axialView);
sync.addView('sagittal', sagittalView);
sync.addView('coronal', coronalView);
```

### Managing Synchronization

```typescript
// Toggle sync on/off
sync.toggle();

// Enable/disable programmatically
sync.enable();
sync.disable();

// Check state
if (sync.isEnabled()) {
  console.log('Synchronization is active');
}

// Programmatically sync a coordinate
sync.syncCoordinate([50, 60, 70]); // World coordinates in mm
```

### Dynamic View Management

```typescript
// Add a view later
const newView = await SingleSliceViewer.createAxial(newContainer, volStack);
sync.addView('axial2', newView);

// Remove a view
const removed = sync.removeView('axial2');

// Get all view IDs
const viewIds = sync.getViewIds(); // ['axial', 'sagittal', 'coronal']

// Check if a view exists
if (sync.hasView('axial')) {
  const view = sync.getView('axial');
}
```

### Hover vs Click Synchronization

```typescript
// Click-only synchronization (default)
const clickSync = new ViewSynchronizer({ syncOnHover: false });

// Hover synchronization (updates as you move the mouse)
const hoverSync = new ViewSynchronizer({ syncOnHover: true });

// Note: Hover sync can be resource-intensive with many views
```

## Event Handling

### Coordinate Events

```typescript
// Listen to coordinate changes
const unsubscribe = viewer.onCoordChange(coord => {
  console.log('World coordinate:', coord); // [x, y, z] in mm
});

// Listen to slice index changes
viewer.onSliceChange(index => {
  console.log('Slice index:', index);
});

// Unsubscribe when done
unsubscribe();
```

### Pointer Events

```typescript
// Pointer move (hover)
viewer.onPointerMove(({ imageCoord, volumeCoord, worldCoord }) => {
  if (imageCoord) {
    console.log('Mouse position in image:', imageCoord); // {x, y}
  }
  if (worldCoord) {
    console.log('Mouse position in world:', worldCoord); // [x, y, z]
  }
});

// Pointer down (click)
viewer.onPointerDown(({ worldCoord }) => {
  console.log('Clicked at:', worldCoord);
});
```

### Generic Event Subscription

```typescript
// Use the generic on() method for any event
viewer.on('coordChanged', coord => {
  console.log('Coordinate changed:', coord);
});

viewer.on('pointerMove', event => {
  // Handle pointer move
});

viewer.on('ready', () => {
  console.log('Viewer is ready!');
});
```

## Coordinate Systems

neuroimjs works with multiple coordinate systems:

### World Coordinates (mm)

Real-world millimeter coordinates in scanner space:
```typescript
const worldCoord = viewer.getCurrentCoord(); // [x, y, z] in mm
viewer.setCoord([50, 60, 70]); // Set position in mm
```

### Volume Coordinates (voxels)

Integer voxel indices in the volume:
```typescript
const volumeCoord = viewer.getMouseVolumeCoordinate(); // [i, j, k]
```

### Image Coordinates (pixels)

2D pixel coordinates in the slice image:
```typescript
const imageCoord = viewer.getMouseImagePosition(); // {x, y}
```

### Coordinate Conversion

Access the coordinate transformer for custom conversions:

```typescript
const transformer = viewer.getCoordinateTransformer();

// Screen to image coordinates
const imageCoord = transformer.screenToImageCoord(screenX, screenY, container);

// Screen to volume coordinates
const volumeCoord = transformer.screenToVolumeCoord(screenX, screenY, container);

// And more...
```

## Custom Layers

Create custom visualization layers by implementing the `SliceLayer` interface:

### Basic Custom Layer

```typescript
import { SliceLayer, NeuroSpace, AxisSet3D } from 'neuroimjs';
import * as PIXI from 'pixi.js';

class AnnotationLayer implements SliceLayer {
  neuroSpace: NeuroSpace;
  private container: PIXI.Container | null = null;
  private annotations: Array<{coord: number[], label: string}> = [];

  constructor(neuroSpace: NeuroSpace) {
    this.neuroSpace = neuroSpace;
  }

  async initialize(): Promise<void> {
    // Load annotation data
    this.annotations = await loadAnnotations();
  }

  renderSlice(
    sliceIndex: number,
    coord: number[],
    viewAxes: AxisSet3D,
    parentContainer: PIXI.Container
  ): PIXI.Container | null {
    if (!this.container) {
      this.container = new PIXI.Container();
    }

    // Clear previous rendering
    this.container.removeChildren();

    // Render annotations for this slice
    const sliceAnnotations = this.getAnnotationsForSlice(sliceIndex, viewAxes);

    sliceAnnotations.forEach(ann => {
      const graphics = new PIXI.Graphics();
      graphics.circle(ann.x, ann.y, 5);
      graphics.fill(0xff0000);

      const text = new PIXI.Text({
        text: ann.label,
        style: { fill: 0xffffff, fontSize: 12 }
      });
      text.position.set(ann.x + 10, ann.y);

      this.container!.addChild(graphics);
      this.container!.addChild(text);
    });

    return this.container;
  }

  setPosition(coord: number[]): void {
    // Update layer state based on new position
  }

  onPointerMove(event: SlicePointerEvent): boolean {
    // Handle mouse hover
    // Return true to stop event propagation
    return false;
  }

  onPointerDown(event: SlicePointerEvent): boolean {
    // Handle mouse click
    return false;
  }

  dispose(): void {
    if (this.container) {
      this.container.destroy({ children: true });
      this.container = null;
    }
  }

  private getAnnotationsForSlice(sliceIndex: number, viewAxes: AxisSet3D) {
    // Filter and transform annotations for this slice
    return [];
  }
}
```

### Using Custom Layers

```typescript
// Create the viewer
const viewer = await SingleSliceViewer.createAxial(container, volStack);

// Create and add custom layer
const annotationLayer = new AnnotationLayer(volStack.neuroSpace);
await annotationLayer.initialize();

viewer.getViewer().view.addLayer('annotations', annotationLayer);

// Remove layer later
viewer.getViewer().view.removeLayer('annotations');
```

## Advanced Patterns

### Multi-Window Synchronization

Synchronize views across multiple browser windows or electron panels:

```typescript
// Window 1
const sync1 = new ViewSynchronizer();
sync1.addView('axial', axialView);

// Window 2
const sync2 = new ViewSynchronizer();
sync2.addView('sagittal', sagittalView);

// Coordinate both synchronizers via messaging
window.addEventListener('message', event => {
  if (event.data.type === 'coordUpdate') {
    sync1.syncCoordinate(event.data.coord);
  }
});

axialView.onCoordChange(coord => {
  window.postMessage({ type: 'coordUpdate', coord }, '*');
});
```

### Conditional Synchronization

Only sync certain views under specific conditions:

```typescript
const sync = new ViewSynchronizer();

// Disable auto-sync
sync.disable();

// Manually sync on specific events
someButton.addEventListener('click', () => {
  const coord = primaryView.getCurrentCoord();
  sync.syncCoordinate(coord);
});
```

### Programmatic Navigation

```typescript
// Jump to a specific anatomical location
viewer.setCoord([0, 0, 0]); // Origin

// Get current position
const currentCoord = viewer.getCurrentCoord();

// Navigate relative to current position
const [x, y, z] = currentCoord;
viewer.setCoord([x + 10, y, z]); // Move 10mm in X direction
```

### Responsive Layouts

Handle window resizing properly:

```typescript
window.addEventListener('resize', () => {
  // Resize all viewers
  axialView.handleResize();
  sagittalView.handleResize();
  coronalView.handleResize();
});

// Or in a React component
useEffect(() => {
  const handleResize = () => viewer.handleResize();
  window.addEventListener('resize', handleResize);
  return () => window.removeEventListener('resize', handleResize);
}, [viewer]);
```

### Custom Control Panels

Create custom UI controls that interact with views:

```typescript
// Custom coordinate display
viewer.onCoordChange(coord => {
  document.getElementById('x-coord').value = coord[0].toFixed(2);
  document.getElementById('y-coord').value = coord[1].toFixed(2);
  document.getElementById('z-coord').value = coord[2].toFixed(2);
});

// Custom coordinate input
document.getElementById('jump-button').addEventListener('click', () => {
  const x = parseFloat(document.getElementById('x-coord').value);
  const y = parseFloat(document.getElementById('y-coord').value);
  const z = parseFloat(document.getElementById('z-coord').value);
  viewer.setCoord([x, y, z]);
});

// Crosshair toggle
document.getElementById('crosshair-toggle').addEventListener('change', e => {
  viewer.setCrosshairVisible(e.target.checked);
});
```

## API Reference

### SingleSliceViewer

#### Factory Methods

- `static async createAxial(container, volStack, options?)` - Create axial view
- `static async createSagittal(container, volStack, options?)` - Create sagittal view
- `static async createCoronal(container, volStack, options?)` - Create coronal view
- `static async create(container, volStack, orientation, options?)` - Create custom orientation

#### Event Methods

- `on(event, handler)` - Subscribe to any event
- `onCoordChange(handler)` - Subscribe to coordinate changes
- `onSliceChange(handler)` - Subscribe to slice index changes
- `onPointerMove(handler)` - Subscribe to pointer move events
- `onPointerDown(handler)` - Subscribe to pointer down events

#### State Methods

- `getCurrentCoord()` - Get current world coordinate
- `setCoord(coord)` - Set current world coordinate
- `getCurrentSliceIndex()` - Get current slice index
- `getMouseImagePosition()` - Get mouse position in image coordinates
- `getMouseVolumeCoordinate()` - Get mouse position in volume coordinates
- `getMouseWorldCoordinate()` - Get mouse position in world coordinates

#### View Methods

- `getCoordinateTransformer()` - Get coordinate transformer
- `getOrientation()` - Get view orientation
- `getCanvas()` - Get canvas element
- `getScale()` - Get current zoom level
- `getWidth()` - Get view width
- `getHeight()` - Get view height

#### Control Methods

- `setCrosshairVisible(visible)` - Toggle crosshair
- `handleResize()` - Handle container resize
- `dispose()` - Clean up resources

### ViewSynchronizer

#### Constructor

- `new ViewSynchronizer(options?)` - Create synchronizer

#### View Management

- `addView(viewId, viewer)` - Add a view
- `removeView(viewId)` - Remove a view
- `getView(viewId)` - Get a view by ID
- `getViewIds()` - Get all view IDs
- `hasView(viewId)` - Check if view exists
- `getViewCount()` - Get number of views

#### Synchronization Control

- `syncCoordinate(coord)` - Sync a coordinate to all views
- `enable()` - Enable synchronization
- `disable()` - Disable synchronization
- `isEnabled()` - Check if enabled
- `toggle()` - Toggle synchronization

#### Factory Methods

- `static fromViews(views, options?)` - Create from view map
- `static createOrthogonal(axial, sagittal, coronal, options?)` - Create for orthogonal views

#### Cleanup

- `dispose()` - Remove all views and clean up

## Examples

See the `examples/` directory for complete working examples:

- `single-axial-view.html` - Basic single view
- `two-view-sync.html` - Two synchronized views
- `multi-panel-custom-layout.html` - Complex multi-panel layout

## Best Practices

1. **Always dispose views** when they're no longer needed to prevent memory leaks
2. **Use epsilon tolerance** when comparing coordinates to handle floating-point precision
3. **Throttle hover events** if performance is a concern with many views
4. **Handle resize events** for responsive layouts
5. **Use world coordinates** for synchronization to ensure consistency across views
6. **Test with different volume dimensions** and orientations
7. **Validate coordinates** before setting them programmatically

## Troubleshooting

### Views don't synchronize

- Check that synchronization is enabled: `sync.isEnabled()`
- Verify views are added to synchronizer: `sync.getViewIds()`
- Ensure you're using world coordinates (mm), not voxel indices

### Crosshairs don't appear

- Call `viewer.setCrosshairVisible(true)`
- Check that the view was created with `showCrosshair: true`

### Mouse events not firing

- Ensure the view container has proper dimensions
- Check that pointer event handlers are attached after view creation
- Verify the PIXI canvas is receiving events

### Memory leaks

- Always call `dispose()` on views when removing them
- Unsubscribe from events when components unmount
- Call `sync.dispose()` when destroying synchronizer

## Further Reading

- [PIXI.js Documentation](https://pixijs.com/docs) - For custom layer development
- [MobX Documentation](https://mobx.js.org/) - Understanding the reactive system
- [NIfTI Format Specification](https://nifti.nimh.nih.gov/) - Understanding coordinate systems
