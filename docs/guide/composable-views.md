# Composable Views

When `SimpleOrthogonalViewer` isn't flexible enough — you want planes in separate panels, across windows, or wired into your own UI — drop down to **`SingleSliceViewer`** and connect them with **`ViewSynchronizer`**.

## Why composable views?

- 🎯 Place each plane anywhere in a custom layout (CSS Grid, flex, separate panels).
- 🔗 Wire views across different windows or applications.
- ⚙️ Full control over *how* views synchronize (click vs hover, which axes).
- 📡 Type-safe, event-driven coordination.

## A single view

```ts
import { SingleSliceViewer } from 'neuroimjs'

const axial = await SingleSliceViewer.createAxial(container, stack, {
  showCrosshair: true,
  showSlider: true,
  width: 512,
  height: 512,
})
```

There are matching factories `createSagittal` and `createCoronal`, plus a general `create(container, stack, orientation, options)` that takes any `AxisSet3D` (the standard ones are exported as `AXIAL_LPI`, `CORONAL_LIP` and `SAGITTAL_AIL`). Other options include `initialCoord` (world mm), `showIntensityReadout`, `showOrientationLabels` and the [depth cue](#depth-cues) settings.

### Events

```ts
axial.onCoordChange((coord) => { /* [x,y,z] mm */ })
axial.onSliceChange((index) => { /* slice changed */ })
axial.onPointerMove(({ imageCoord, volumeCoord, worldCoord }) => {
  // imageCoord: pixel in the slice; volumeCoord: voxel; worldCoord: mm
  // each is null when the pointer is outside the image
})
axial.onPointerDown(({ worldCoord }) => { /* click */ })

axial.setCrosshairVisible(false)
axial.setCoord([0, -18, 20])
const c = axial.getCurrentCoord()
```

## Synchronizing views

Create three independent views, then synchronize them into a linked orthogonal set:

```ts
import { SingleSliceViewer, ViewSynchronizer } from 'neuroimjs'

const axial    = await SingleSliceViewer.createAxial(axialEl, stack)
const sagittal = await SingleSliceViewer.createSagittal(sagEl, stack)
const coronal  = await SingleSliceViewer.createCoronal(corEl, stack)

const sync = ViewSynchronizer.createOrthogonal(axial, sagittal, coronal)
```

Now moving the crosshair in any view updates the others. Because the views are plain objects you own, you can lay them out however you like:

```html
<div class="grid">
  <div id="axial"></div>
  <div id="sagittal"></div>
  <div id="coronal"></div>
  <aside id="readout">…your own coordinate panel…</aside>
</div>
```

## Custom view sets

`ViewSynchronizer.fromViews` accepts any named set of views, so you can synchronize, say, two axial views of different subjects for comparison:

```ts
const sync = ViewSynchronizer.fromViews({ left: subjA, right: subjB })
```

### Controlling synchronization

By default views synchronize when the user clicks or drags the crosshair. Options and methods change that:

```ts
// Follow the pointer as well as clicks (more work per mouse move)
const hoverSync = new ViewSynchronizer({ syncOnHover: true })

// Add, inspect and remove views at any time
hoverSync.addView('axial', axial)
hoverSync.addView('coronal', coronal)
hoverSync.getViewIds()            // ['axial', 'coronal']
hoverSync.removeView('coronal')

// Pause and resume
hoverSync.disable()
hoverSync.enable()
hoverSync.toggle()                // returns the new state

// Move every view to a world coordinate (mm)
hoverSync.syncCoordinate([0, -18, 20])
```

`syncOnAdd: true` moves each newly added view to the coordinate of the first view, and `epsilon` sets the tolerance for treating two coordinates as equal.

## Depth cues

Single views can show the neighbouring slices behind and in front of the current one, blurred by distance and shifted with the pointer (parallax), as a sense of depth without 3D rendering. <span class="stability-badge experimental">experimental</span>

```ts
const axial = await SingleSliceViewer.createAxial(container, stack, {
  enableDepthEnhancement: true,
  depthEnhancementOptions: {
    depthLayers: 2,        // neighbouring slices on each side (default 2)
    maxBlurRadius: 8,      // blur of the furthest slice, px (default 8)
    parallaxAmount: 0.03,  // shift per slice as a fraction of the slice size (default 0.03)
    baseOpacity: 0.4,      // opacity of the nearest neighbour (default 0.4)
  },
})

axial.setDepthEnhancementEnabled(false)            // toggle at run time
axial.setDepthEnhancementOptions({ depthLayers: 3 })
```

The effect is drawn by `DepthEnhancedLayer`, a `SliceLayer` that renders the reference layer's neighbouring slices. It exists only if `enableDepthEnhancement` was set when the view was created (`hasDepthEnhancement()` tells you).

## Custom layers

Anything drawn in a view is a `SliceLayer`: an object with a `neuroSpace` and methods to render a slice, follow the crosshair, handle pointer events and clean up. Implement the interface to draw annotations, ROIs or markers, and add the layer to a view's underlying `SliceView`:

```ts
import * as PIXI from 'pixi.js'
import type { SliceLayer, SlicePointerEvent, NeuroSpace, AxisSet3D } from 'neuroimjs'

class MarkerLayer implements SliceLayer {
  private container = new PIXI.Container()
  constructor(public neuroSpace: NeuroSpace) {}

  initialize(): void {}
  renderSlice(sliceIndex: number, coord: number[], viewAxes: AxisSet3D, parent: PIXI.Container) {
    this.container.removeChildren()
    // draw PIXI.Graphics into this.container, in image (pixel) coordinates
    return this.container
  }
  setPosition(coord: number[]): void {}
  onPointerMove(event: SlicePointerEvent): boolean { return false } // true stops propagation
  onPointerDown(event: SlicePointerEvent): boolean { return false }
  dispose(): void { this.container.destroy({ children: true }) }
}

axial.getViewer().view.addLayer?.('markers', new MarkerLayer(stack.space))
// later: axial.getViewer().view.removeLayer?.('markers')
```

## Cleaning up

Call `dispose()` on every view you create; it removes its listeners and destroys its WebGL resources. `sync.dispose()` detaches the synchronizer from its views but does not dispose them. Every `on…` subscription returns an unsubscribe function; call it when the component that subscribed goes away.

## Patterns

- **Side-by-side comparison** — two synchronized axials of pre/post or two subjects.
- **Dashboard embedding** — one plane in a corner of a larger app, driven programmatically via `setCoord`.
- **Cross-window** — forward `onCoordChange` over `postMessage` to mirror a view in a popout.

This is the layer external applications should build on for anything beyond the stock 3-up layout.
