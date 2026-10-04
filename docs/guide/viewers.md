# Viewers

The viewer stack is neuroimjs's most mature subsystem. It renders volumes with PIXI.js (WebGL) and coordinates state with MobX. There are two ways in: a ready-made orthogonal viewer, covered on this page, and [composable single-slice views](/guide/composable-views) you arrange yourself.

<BrainViewer mode="ortho" :height="500" caption="SimpleOrthogonalViewer rendering the MNI152 template." />

## SimpleOrthogonalViewer

The fastest path to a classic three-plane viewer. Give it a container and a `VolStack`; the first layer in the stack is the reference grid.

```ts
import { SimpleOrthogonalViewer, VolLayer, VolStack, ColorMapFactory } from 'neuroimjs/browser'

const t1 = new VolLayer('T1w', t1Vol, ColorMapFactory.createGrayscale({ range: t1Range }), t1Range)
const z = new VolLayer(
  'z-stat',
  zVol,
  ColorMapFactory.fromPreset('BlueRed', { range: [-5, 5] }),
  [-5, 5],     // display range
  [-2.3, 2.3], // threshold: values strictly inside this band are hidden
  0.85,        // opacity
)
const stack = new VolStack(t1, z)

const viewer = await SimpleOrthogonalViewer.create(container, stack, {
  layout: 'left-tall',
  showOrientationLabels: true,
})
```

`create` resolves once the three views are built and sized. Layer ids (`'T1w'`, `'z-stat'`) are how every later call addresses a layer.

::: warning Don't mix entry points in one app
Import everything for a browser app from **`neuroimjs/browser`**: viewers, layers, colormaps and the [control panels](/guide/controls), which exist only there. That entry is a self-contained bundle with its own copy of every class (and of PIXI and MobX), so objects from the main `neuroimjs` entry are different classes to it. The failure is quiet: `updateLayer` recognises a `ColorMap` with `instanceof`, so a viewer from one entry driven by a `<layer-control-panel>` (or a `ColorMapFactory`) from the other renders every colormap change as grayscale. The main entry is also not browser-clean: it statically imports Node's `fs` and `path` (through `BigNeuroVec`). Use the main entry in Node, or for features that only it exports ([custom layers](/guide/custom-layers) need `CoordinateTransformer` and the `SliceLayer` type) — and then import the viewers from it as well.
:::

### Layouts

| `layout` | Arrangement | Sizing |
|---|---|---|
| `'top-bottom'` (default) | Axial across the top; sagittal and coronal side by side below. | Fills the container; views keep their physical aspect ratio and are centred. |
| `'left-tall'` | Axial spans the left column; coronal top-right, sagittal bottom-right. | Each view fills its grid cell. |
| `'ortho'` | Aligned 2×2: coronal \| sagittal over axial \| legend. | Column and row tracks are sized from the volume extents so all three views share one mm-per-pixel scale and crosshair lines continue across neighbouring views. **The viewer sets the container's height from its width**; size the width only. |

The `'ortho'` layout leaves its fourth cell empty for you, and can collapse to a single column on narrow screens:

```ts
const viewer = await SimpleOrthogonalViewer.create(el, stack, {
  layout: 'ortho',
  cellPaddingPx: 16,     // room for orientation labels
  stackBelowPx: 640,     // one column on narrow screens
  stackMode: 'single',   // ...showing one view at a time
})

const legend = viewer.getLegendElement()   // empty 4th cell, yours to fill
legend?.append(Object.assign(document.createElement('div'), { textContent: 'z > 2.3' }))

if (viewer.isStacked()) viewer.setStackedView('axial')
```

`getLegendElement()` returns `null` for the other layouts. `setStackedView` only matters while the layout is stacked with `stackMode: 'single'`.

### Options

| Option | Type | Default | Notes |
|---|---|---|---|
| `layout` | `'top-bottom' \| 'left-tall' \| 'ortho'` | `'top-bottom'` | See above. |
| `showCrosshair` | `boolean` | `true` | Toggle later with `setCrosshairVisible`. |
| `crosshairOptions` | `CrossHairOptions` | red, 1 px, 8 px gap | `crossColor`, `crossAlpha`, `crossThickness`, `crosshairGap`, `haloColor`, `haloAlpha`. Widths are screen pixels. |
| `showSlider` | `boolean` | `false` | A slice slider along the bottom of each view. |
| `showOrientationLabels` | `boolean` | `false` | L/R/A/P/S/I at each view's edges. |
| `orientationLabelOptions` | `OrientationLabelOptions` | 16 px bold white, black stroke | Also `margin`, `alpha`, `shadowAlpha`, `fontFamily`, and `anchor: 'viewport' \| 'image'` (`'image'` keeps neighbouring views' labels apart). |
| `backgroundColor` | PIXI number | `0x000000` | Canvas clear colour. |
| `gapPx` | `number` | `12` | CSS grid gap between views. |
| `cellPaddingPx` | `number` | `0` | Clear space around each slice inside its cell. |
| `focusOutline` | `string \| null` | `'2px solid rgba(100, 150, 255, 0.6)'` | Outline on the hovered view; `null` disables it (style `[data-nij-hover]` yourself). |
| `stackBelowPx` | `number` | `0` (never) | `'ortho'` only: container width below which views stack in one column. |
| `stackMode` | `'column' \| 'single'` | `'column'` | `'ortho'` only: stacked views shown together or one at a time. |
| `stackedLegendHeightPx` | `number` | `176` | `'ortho'` only: legend row height when stacked. |
| `alignmentStrategy` | `'world' \| 'auto' \| 'center' \| 'corner' \| 'overlap'` | `'world'` | How layers on a different voxel grid are placed. `'world'` slices each layer on its own grid and draws it at its true world position (a 2 mm map over a 1 mm template); `'auto'` is the older bounds-fitting heuristic. Change later with `setAlignmentStrategy`. |

A styled setup:

```ts
const viewer = await SimpleOrthogonalViewer.create(container, stack, {
  layout: 'top-bottom',
  showCrosshair: true,
  crosshairOptions: { crossColor: 0x22d3ee, crossAlpha: 0.9, crossThickness: 1, crosshairGap: 10 },
  showOrientationLabels: true,
  orientationLabelOptions: { fontSize: 13, color: 0xffffff, anchor: 'image' },
  backgroundColor: 0x0b0d10,
  focusOutline: null,
  alignmentStrategy: 'world',
})
```

::: warning `showIntensityReadout` is not wired up
`SimpleOrthogonalViewerOptions` accepts `showIntensityReadout`, but the option is currently ignored. Build the readout yourself from `onCoordChange` and `getValue` (below); it is a few lines and gives you control over formatting.
:::

### Navigating

```ts
viewer.setWorldCoord([-42, -58, -12])      // world mm (the volume's own frame)
const here = viewer.getWorldCoord()         // copy, [x, y, z] mm

viewer.setSliceIndex('axial', 40)           // jump one view by voxel index
const k = viewer.getSliceIndex('axial')

viewer.setFocusedView('axial')              // arrow keys step the axial view (until the pointer enters another)
```

Built-in interaction, per view:

| Input | Effect |
|---|---|
| Click | Move the crosshair (all views follow). |
| Wheel | Previous / next slice. The wheel is captured over the canvas, so the page does not scroll there. |
| Ctrl/⌘ + wheel | Zoom. |
| Double-click | Reset zoom and pan. |
| Middle-button drag | Pan. |
| ← / → | Previous / next slice in the *focused view*: the view the pointer last entered, or the one set with `setFocusedView` (whichever happened last). Leaving a view does not clear it, so the keys keep stepping the last-hovered view. Keyboard focus only decides the target before any view has been hovered or set: then a pane focused by click or Tab gets the keys. Keys typed into inputs and other widgets are left alone. |

`setLPICoord` / `getLPICoord` also exist. For volumes stored in LPI axis order (the usual case: an MNI-space NIfTI with a positive-diagonal affine) they are identical to `setWorldCoord` / `getWorldCoord`; for other orientations they map through voxel indices rather than true anatomical directions, so prefer the world-coordinate methods.

### Reading values and reacting

```ts
const off = viewer.onCoordChange((coord) => {
  const t1 = viewer.getValue('T1w', coord)   // number | null
  const z = viewer.getValue('z-stat', coord)
  console.log(coord.map(Math.round), t1, z)
})

viewer.onSliceChange(({ view, index }) => console.log(`${view} → ${index}`))

off() // every subscription returns its unsubscribe function
```

`getValue(layerId, worldCoord?)` reads the nearest raw voxel of that layer at a world coordinate (default: the crosshair). Each layer is read on its own grid, so a 2 mm overlay and a 1 mm template each report their own voxel. It returns `null` outside the volume or for a non-finite voxel, and throws for an unknown layer id.

`onCoordChange` can fire once per view for a single crosshair move (each view reports the new position), so keep the handler cheap or dedupe.

The public event surface is `onCoordChange`, `onSliceChange` and `onReady`. `onReady` is effectively redundant: the `ready` event fires inside `create()`, before you can subscribe, so treat the resolved promise as "ready". `SimpleOrthogonalViewer` does not expose hover (pointer-move) events; if you need a value-under-cursor readout, build the views with [`SingleSliceViewer`](/guide/composable-views#events), whose `onPointerMove` reports the world coordinate under the pointer.

### Layers

```ts
viewer.addLayer(new VolLayer('mask', statVol, ColorMapFactory.fromPreset('Greens', { range: [0, 1] }), [0, 1]))

viewer.updateLayer('z-stat', {
  colormap: 'RdBu',          // preset name (case-insensitive) or a ColorMap
  range: [-6, 6],
  threshold: [-3.1, 3.1],
  alpha: 0.7,
  visible: true,
})

viewer.moveLayer('mask', 1)  // 0 = bottom (the reference layer)
viewer.removeLayer('mask')

for (const l of viewer.listLayers()) {
  console.log(l.id, l.colormapName, l.range, l.threshold, l.alpha, l.visible)
}
```

- `addLayer` appends on top. Layers are drawn bottom-to-top in stack order.
- `updateLayer` changes only the fields you pass, accepts a colormap *name* (resolved case-insensitively; an unrecognised name falls back to grayscale), frees the layer's stale textures in every view and redraws. It is the convenient path, not the only one: the `VolLayer` setters (`setRange`, `setThreshold`, `setOpacity`, `setColormap`, `setVisible`) also redraw all three views, because the views share the stack's `VolLayer` objects and re-render reactively when they change (see [Colormaps & Layers](/guide/colormaps#changing-display-settings)). Don't assign the fields (`layer.threshold = …`) directly.
- `threshold` is a *hidden band*: values strictly between `low` and `high` are transparent, values outside are drawn. `[-2.3, 2.3]` shows |z| ≥ 2.3; `[0, 0]` disables thresholding.
- `moveLayer(id, toIndex)` reorders; index 0 is the bottom.

To swap the data behind a layer — a new subject, a re-smoothed map — without rebuilding the stack:

```ts
// Same id, same z-order; the new volume must be on the same grid.
viewer.updateLayerVolume('z-stat', nextZ, { range: [-6, 6], threshold: [-3.1, 3.1] })
```

`updateLayerVolume` throws if the new volume's geometry (dimensions, spacing, origin, affine) differs from the old one. Omitted options keep the layer's current range, threshold, opacity and colormap.

`setAlignmentStrategy(strategy)` and `setAlignmentOptions(partial)` change how off-grid layers are placed after creation; see [Multi-Layer Alignment](/guide/alignment).

### Zoom, pan and fit

```ts
viewer.setZoom('coronal', 2)        // clamped to [0.5, 10]
viewer.getZoom('coronal')           // 2
viewer.resetAllViews()              // zoom 1, pan 0, every view

viewer.setFitBounds({ min: [10, 12, 4], max: [80, 100, 84] })  // crop to a voxel box
viewer.setFitBounds(null)
```

`setFitBounds` fits every view to a box of reference-grid voxel indices (inclusive) — typically the head's bounding box — instead of the full field of view. In the `'ortho'` layout the tracks follow the box, so the shared scale is preserved.

### Appearance at runtime

```ts
import type { ViewerTheme } from 'neuroimjs/browser'

viewer.setCrosshairVisible(false)
viewer.setCrosshairStyle({ crossColor: 0xffffff, haloColor: 0x000000, haloAlpha: 0.6 })
viewer.setOrientationLabelsVisible(true, { fontSize: 12 })
viewer.setBackground(0x111619)

const light: ViewerTheme = {
  backgroundColor: 0xfafaf7,
  crosshair: { crossColor: 0x1c2226, crossAlpha: 0.55, haloColor: 0xffffff, haloAlpha: 0.6 },
  orientationLabels: { color: 0x3e4952, alpha: 0.9, shadowAlpha: 0 },
}
viewer.setTheme(light)   // partial updates; no rebuild
```

`ViewerTheme` (a type export) bundles `backgroundColor`, `backgroundAlpha`, `crosshair` and `orientationLabels`. Every field is optional and omitted fields keep their current value, so a light/dark switch is one call. `setOrientationLabelStyle` restyles the labels without toggling them.

### Saving and restoring state

```ts
const saved = viewer.getState()
localStorage.setItem('viewer', JSON.stringify(saved))

// later, on a viewer built from the same stack
viewer.applyState(JSON.parse(localStorage.getItem('viewer')!))
```

`getState()` returns `{ worldCoord, lpiCoord, slices, layers }`, where `layers` is `listLayers()`. `applyState` is best-effort: it restores the position, then each layer's colormap (by name), range, threshold, opacity and visibility, then layer order. It does not add or remove layers or change the layout. `colormapName` is the `ColorMap`'s `name`, and only a preset name, `'Hot'` or `'Grayscale'` resolves on the way back: a layer built with `createDiverging`, `createGradient`, `createMultiStop`, `createCategorical` or `fromColors` (names `'Diverging'`, `'Gradient'`, `'MultiStop'`, `'Categorical'`, `'Custom'`) comes back as **grayscale**. For such layers, re-apply the `ColorMap` object yourself after `applyState`.

### Exporting images

```ts
const png = viewer.toDataURL('axial')                    // 'image/png'
const jpg = viewer.toDataURL('sagittal', 'image/jpeg', 0.9)
const canvas = viewer.getCanvas('coronal')
```

### Sizing and lifecycle

The viewer turns the container into a CSS grid, sets its `width`/`height` to `100%` (for `'ortho'`, an explicit pixel height), and tracks size changes with a `ResizeObserver` plus the window `resize` event. Give the container a definite size — or, for `'ortho'`, a definite width — and it re-fits by itself; there is no need to recreate it on resize.

The viewer owns WebGL contexts, a document-level `keydown` listener, a `ResizeObserver` and MobX reactions. **Call `dispose()` when it leaves the page** — component unmount, route change, or before creating a replacement in the same container:

```ts
const viewer = await SimpleOrthogonalViewer.create(container, stack)
const off = viewer.onCoordChange(() => { /* ... */ })

// On unmount / route change:
off()
viewer.dispose()
```

`dispose()` is idempotent; it destroys the three PIXI applications and removes the views from the container. Browsers cap live WebGL contexts (each view uses one), so leaked viewers eventually make new ones fail. The `VolStack` and its volumes are yours and are not touched — you can reuse them in the next viewer.

## The lower layers

`SimpleOrthogonalViewer` is a thin wrapper; the pieces underneath are public.

| Class | What it is | Use it when |
|---|---|---|
| `SimpleOrthogonalViewer` | 3-up viewer with a programmatic API (layers, values, state, theming). | You want a standard viewer with minimal wiring. Start here. |
| `SingleSliceViewer` + `ViewSynchronizer` | One plane per instance, with a typed event API (including hover), linked explicitly. | Custom layouts, planes in separate panels, hover readouts. See [Composable Views](/guide/composable-views). |
| `OrthogonalImageViewer` | The 3-view orchestrator `SimpleOrthogonalViewer` wraps: layout grid, shared MobX coordinate, keyboard and resize handling. Exposes each `SliceViewer`. | You need direct access to a sub-view (e.g. to add a [custom layer](/guide/custom-layers)) while keeping the stock layout. |
| `SliceViewer` | Facade over one view's `SliceModel` (slice index, coordinate), `SliceView` (PIXI renderer) and `SliceController` (pointer, wheel, keyboard). | Building your own multi-view orchestration on MobX reactions. |
| `ImageLayer` | The `SliceLayer` that renders a `VolStack` slice (colormap, threshold, compositing, texture cache). | Required input to the two classes above. |
| `ViewerFactory` | Static constructors for `SliceModel` / `SliceView` / `SliceController` / `SliceViewer` (main `neuroimjs` entry only). | Swapping in your own implementation of one of the `ISlice*` interfaces. Rarely needed. |

Driving `OrthogonalImageViewer` and `SliceViewer` directly:

```ts
import { OrthogonalImageViewer, SliceViewer, ImageLayer, AxisSet3D } from 'neuroimjs/browser'

const imageLayer = new ImageLayer(stack)
imageLayer.initialize()
const ortho = await OrthogonalImageViewer.create({
  container: el,
  imageLayer,
  options: { layout: 'ortho', showCrosshair: true },
})
const axial = ortho.getSliceViewer('axial')     // a SliceViewer
axial.onCurrentSliceIndexChange((i) => console.log('axial', i))
ortho.dispose()

const layer = new ImageLayer(stack)
layer.initialize()
const sv = await SliceViewer.create(axialEl, layer, AxisSet3D.AXIAL_LPI, { showCrosshair: true })
sv.setPosition([0, 0, 0])
sv.dispose()
```

Note that `OrthogonalImageViewer` defaults to `layout: 'left-tall'`, whereas `SimpleOrthogonalViewer` defaults to `'top-bottom'`. Neither `SliceViewer.dispose()` nor `OrthogonalImageViewer.dispose()` disposes the `ImageLayer` you passed in (it may be shared); call `imageLayer.dispose()` yourself if you created it for that viewer alone.

## Logging

The viewers log only warnings and errors by default. To see their diagnostic
output (layer setup, sprite creation, render timings), opt in:

```ts
import { enableDebugLogging, setLogLevel } from 'neuroimjs/browser';

enableDebugLogging();      // DEBUG; enableDebugLogging(false) restores the default
setLogLevel('info');       // or 'warn' | 'error' | 'none'
```

Without code changes, set `globalThis.NEUROIMJS_DEBUG = true` (or
`globalThis.NEUROIMJS_LOG_LEVEL = 'debug'`) before neuroimjs loads; in Node,
use the `NEUROIMJS_DEBUG` / `NEUROIMJS_LOG_LEVEL` environment variables.

::: tip Live, not static
The brains on this page are these exact components running against a real MNI152 volume. The same code in your app produces the same result — see the runnable **[Examples](/examples/)**, and **[Controls](/guide/controls)** for a viewer wired to a layer panel.
:::
