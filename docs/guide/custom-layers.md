# Custom Layers

Everything drawn in a slice view — the image, the crosshair, the orientation labels — is a **`SliceLayer`**. You can add your own: peak markers, ROI outlines, a scale bar, annotations. This page covers the interface, the two coordinate modes a layer can draw in, and the two optional built-in layers, `OrientationLabelLayer` and `DepthEnhancedLayer`.

Custom layers attach below the stable `SimpleOrthogonalViewer` / `SingleSliceViewer` API, to a view's `SliceView`. This page imports everything from the main **`neuroimjs`** entry, because `CoordinateTransformer`, the `SliceLayer` interface and `ScreenLayoutContext` are exported only there, not from `neuroimjs/browser`. Draw with the same `pixi.js` (v8) package neuroimjs depends on, so your bundler resolves a single PIXI; the prebuilt `neuroimjs/browser` bundle carries its own copy of PIXI.

::: warning One entry per app
An app with custom layers takes its viewers, layers and colormaps from the main entry too: a layer drawn with your `pixi.js` would be handed to a view rendering with the bundle's separate PIXI copy, which is unsupported, and mixing entries breaks `instanceof` checks (see [Don't mix entry points](/guide/viewers#simpleorthogonalviewer)). Two consequences of using the main entry in a browser: it statically imports Node's `fs` and `path` (through `BigNeuroVec`), so your bundler must stub them for the browser; and the [control panels](/guide/controls) are exported only from `neuroimjs/browser`, so they are not available to such an app without mixing entries.
:::

## The interface

```ts
interface SliceLayer {
  neuroSpace: NeuroSpace
  initialize(): Promise<void> | void
  renderSlice(sliceIndex: number, coord: number[], viewAxes: AxisSet3D,
              parentContainer: PIXI.Container): PIXI.Container | null
  setPosition(coord: number[]): void
  onPointerMove(event: SlicePointerEvent): boolean
  onPointerDown(event: SlicePointerEvent): boolean
  dispose(): void

  screenSpace?: boolean                       // draw in viewport pixels, not image space
  layoutScreen?(ctx: ScreenLayoutContext): void
  update?(params: any): void
}
```

How the view drives a layer:

1. **`addLayer(id, layer)`** calls `initialize()` (not awaited — load anything asynchronous before adding the layer), then `setPosition(currentCoord)`, then renders.
2. **`renderSlice(...)`** runs on every render: slice change, crosshair move, layer property change, resize. Before each render the view empties its containers, so return a container every time; reuse one instance rather than allocating per frame. Return `null` to draw nothing.
3. **`setPosition(coord)`** receives the crosshair position (world mm) whenever it moves, just before the re-render.
4. **`dispose()`** runs on `removeLayer(id)` and when the view is disposed.

`onPointerMove` / `onPointerDown` are part of the interface, but the current views **do not dispatch pointer events to layers**. Implement them as `return false` and, for interactivity, subscribe to the owning viewer's `onPointerMove` / `onPointerDown` (see [Composable Views](/guide/composable-views#events)) and update the layer from there.

## Two coordinate modes

**Image space (default).** The returned container is added to the view's main container, which is scaled to fit, zoomed, panned and Y-flipped. Coordinates are the slice's *image coordinates*: voxel units of the two in-plane axes, voxel centres at `n + 0.5` (see [Coordinate Systems](/guide/coordinate-systems#image-slice-space)). Content scales with the anatomy. Note that the view fits the bounds of *everything* in that container, so content that extends past the slice changes the fit.

**Screen space (`screenSpace = true`).** The container goes into an unscaled overlay on top of the image, and is excluded from the fit. After every fit — render, resize, zoom, pan — the view calls `layoutScreen(ctx)` with the viewport size, `insets` (space reserved by the slice slider), an optional `contentRect`, and `ctx.project(x, y)`, which maps an image coordinate to viewport pixels. Content keeps a constant pixel size. The crosshair and orientation labels work this way.

The usual recipe for a screen-space layer: resolve *what* to draw in image coordinates in `renderSlice` (where you know the slice and orientation), then position it in `layoutScreen`.

## Example: peak markers

Rings at fixed world coordinates, a constant 7 px radius at any zoom, shown on the slice that contains each peak:

```ts
import * as PIXI from 'pixi.js'
import { CoordinateTransformer, NeuroSpace, AxisSet3D } from 'neuroimjs'
import type { SliceLayer, ScreenLayoutContext, SlicePointerEvent } from 'neuroimjs'

export class PeakMarkers implements SliceLayer {
  readonly screenSpace = true
  neuroSpace: NeuroSpace
  private container = new PIXI.Container()
  private g = new PIXI.Graphics()
  private visible: Array<{ x: number; y: number }> = []   // image-space points on this slice
  private lastCtx: ScreenLayoutContext | null = null

  constructor(space: NeuroSpace, private peaks: number[][], private color = 0xffd400) {
    this.neuroSpace = space
    this.container.addChild(this.g)
  }

  initialize(): void {}
  setPosition(_coord: number[]): void {}

  renderSlice(sliceIndex: number, _coord: number[], viewAxes: AxisSet3D): PIXI.Container | null {
    const t = new CoordinateTransformer(this.neuroSpace, viewAxes, sliceIndex)
    const pinned = this.neuroSpace.whichDim(viewAxes.k)
    this.visible = []
    for (const mm of this.peaks) {
      const voxel = this.neuroSpace.coordToGrid(mm)
      // Keep peaks whose voxel lies on the slice being drawn.
      if (Math.round(voxel[pinned]) === sliceIndex) this.visible.push(t.volumeToLocalSliceCoord(voxel))
    }
    if (this.lastCtx) this.layoutScreen(this.lastCtx)
    return this.container
  }

  layoutScreen(ctx: ScreenLayoutContext): void {
    this.lastCtx = ctx
    this.g.clear()
    for (const pt of this.visible) {
      const p = ctx.project(pt.x, pt.y)
      this.g.circle(p.x, p.y, 7)
    }
    if (this.visible.length) this.g.stroke({ width: 2, color: this.color })
  }

  onPointerMove(_e: SlicePointerEvent): boolean { return false }
  onPointerDown(_e: SlicePointerEvent): boolean { return false }

  dispose(): void {
    this.container.destroy({ children: true })
  }
}
```

Pass the **reference space** — the first layer's, `stack.space` — as `neuroSpace`: the slice index and image coordinates a view hands to its layers are on that grid.

## Attaching a layer

Layers attach to a view's `SliceView`. From a `SingleSliceViewer`:

```ts
import { SingleSliceViewer } from 'neuroimjs'

const axial = await SingleSliceViewer.createAxial(el, stack, { showCrosshair: true })
const peaks = [[-42, -58, -12], [44, -60, -14]]

axial.getViewer().view.addLayer?.('peaks', new PeakMarkers(stack.space, peaks))
// ...
axial.getViewer().view.removeLayer?.('peaks')   // calls the layer's dispose()
```

From an `OrthogonalImageViewer`, per view — use one layer instance per view, since a layer keeps per-view state:

```ts
import { ImageLayer, OrthogonalImageViewer } from 'neuroimjs'

const imageLayer = new ImageLayer(stack)
imageLayer.initialize()
const ortho = await OrthogonalImageViewer.create({ container: el, imageLayer, options: { layout: 'ortho' } })

for (const view of ['axial', 'coronal', 'sagittal'] as const) {
  // One instance per view: a layer keeps per-view state.
  ortho.getSliceViewer(view).view.addLayer?.('peaks', new PeakMarkers(stack.space, [[-42, -58, -12]]))
}
```

`addLayer` is optional on the `ISliceView` interface (hence `?.`); the stock `SliceView` implements it, and ignores a second layer with an existing id. Layers render in insertion order, above the image. `SimpleOrthogonalViewer` does not expose its views, so use `OrthogonalImageViewer` (what it wraps) when you need the 3-up layout plus custom layers. `SingleSliceViewer.getViewer()` is documented as an advanced/internal accessor; it is the supported route today but may change before 1.0.

## OrientationLabelLayer

The L/R/A/P/S/I labels are a screen-space layer. The letters for each edge are derived from the live transform (`ctx.project` of each in-plane axis), so they cannot disagree with the rendered image, whatever the flips, zoom or pan. Normally you just toggle them:

```ts
import { SingleSliceViewer, OrientationLabelLayer } from 'neuroimjs'

const axial = await SingleSliceViewer.createAxial(el, stack)
axial.setOrientationLabelsVisible(true, { fontSize: 12, anchor: 'image' })   // the usual route

// Equivalent, by hand:
const view = axial.getViewer().view
view.addLayer?.('my-labels', new OrientationLabelLayer(stack.space, { fontSize: 12 }))
```

Constructing it yourself is mainly useful as a reference implementation of `screenSpace` / `layoutScreen`, or to add a second, differently styled set. `OrientationLabelOptions`: `fontSize` (16), `color` (`0xffffff`), `fontFamily`, `fontWeight` (`'bold'`), `letterSpacing`, `margin` (6 px), `strokeColor` / `strokeWidth` (black, 3), `alpha`, `shadowAlpha` / `shadowBlur`, and `anchor`: `'viewport'` (default; pinned to the view edges) or `'image'` (just outside the image's edges, clamped to the viewport — keeps neighbouring views' labels apart).

## DepthEnhancedLayer

<span class="stability-badge experimental">experimental</span> Renders neighbouring slices (`depthLayers` on each side), blurred in proportion to distance (`maxBlurRadius`) and faded (`baseOpacity`), as a depth cue. Enable it through `SingleSliceViewer`:

```ts
const axial = await SingleSliceViewer.createAxial(el, stack, {
  enableDepthEnhancement: true,
  depthEnhancementOptions: { depthLayers: 2, maxBlurRadius: 6, baseOpacity: 0.3 },
})
axial.setDepthEnhancementEnabled(false)
axial.setDepthEnhancementOptions({ depthLayers: 3 })
```

Current limitations: it is composited *above* the current slice (layers render after the image), so it veils rather than backs the image — keep `baseOpacity` low; and its cursor-driven parallax (`parallaxAmount`) depends on layer pointer events, which the views do not dispatch, so there is no parallax yet. It reads only the stack's first layer.
