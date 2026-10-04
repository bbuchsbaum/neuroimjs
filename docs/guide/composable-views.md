# Composable Views

When `SimpleOrthogonalViewer` isn't flexible enough — you want planes in separate panels, across windows, or wired into your own UI — drop down to **`SingleSliceViewer`** and connect them with **`ViewSynchronizer`**.

## Why composable views?

- 🎯 Place each plane anywhere in a custom layout (CSS Grid, flex, separate panels).
- 🔗 Wire views across different windows or applications.
- ⚙️ Full control over *how* views synchronize (click vs hover, which views).
- 📡 Type-safe, event-driven coordination, including pointer (hover) events that `SimpleOrthogonalViewer` does not expose.

## A single view

```ts
import { SingleSliceViewer } from 'neuroimjs/browser'

const axial = await SingleSliceViewer.createAxial(container, stack, {
  showCrosshair: true,
  showSlider: true,
  showOrientationLabels: true,
})
```

Import from `neuroimjs/browser` in browser apps, and take every other neuroimjs import in the app from the same entry; see [Don't mix entry points](/guide/viewers#simpleorthogonalviewer).

There are matching factories `createSagittal` and `createCoronal`, plus `create(container, stack, orientation, options)` for any `AxisSet3D` (the standard ones are also exported as `AXIAL_LPI`, `CORONAL_LIP` and `SAGITTAL_AIL`; e.g. `AxisSet3D.AXIAL_RPI` for radiological display).

| Option | Default | Notes |
|---|---|---|
| `showCrosshair` | `false` | Note the default differs from `SimpleOrthogonalViewer`. |
| `showSlider` | `false` | Slice slider along the bottom. |
| `showOrientationLabels`, `orientationLabelOptions` | `false` | As on [`SimpleOrthogonalViewer`](/guide/viewers#options). |
| `showIntensityReadout` | `false` | Adds an intensity-readout layer, but nothing currently feeds it pointer positions, so it stays blank. Build a readout from `onPointerMove` instead (see [the layout pattern](#a-custom-multi-panel-layout)). |
| `initialCoord` | volume centre | World mm. |
| `width`, `height` | container size | Initial canvas size only; the view re-fits to its container afterwards. |
| `enableDepthEnhancement`, `depthEnhancementOptions` | `false` | Blurred, parallax-shifted neighbouring slices as a depth cue. See [Custom Layers](/guide/custom-layers#depthenhancedlayer). |

The view sets the element you pass to `width: 100%; height: 100%` and watches it with a `ResizeObserver`, so size the *parent* (a grid cell, a panel) and the view follows. No manual resize handling is needed.

### Events

```ts
axial.onCoordChange((coord) => { /* [x,y,z] mm — crosshair moved */ })
axial.onSliceChange((index) => { /* slice index changed */ })
axial.onPointerMove(({ imageCoord, volumeCoord, worldCoord }) => {
  // continuous coordinates under the pointer; see Coordinate Systems
})
axial.onPointerDown(({ worldCoord }) => { /* click; worldCoord is the last hover position */ })
axial.on('zoomChanged', (level) => { /* after setZoom() or resetView() */ })

axial.setCoord([0, -18, 20])
const c = axial.getCurrentCoord()
const k = axial.getCurrentSliceIndex()
```

All subscriptions return an unsubscribe function.

Pointer payloads **lag one frame**. The view resolves the pointer position on an animation-frame throttle, but emits `pointerMove` / `pointerDown` synchronously from the raw event, so each payload carries the position computed for an *earlier* event: the first `pointerMove` arrives with all three fields `null`, and `pointerDown`'s coordinates are the last hover position, not the click point (the crosshair itself does move to the click point; read it with `onCoordChange` or `getCurrentCoord()`). If the position cannot be resolved, `volumeCoord` and `worldCoord` are empty arrays (`[]`) rather than `null`. Guard with `worldCoord?.length === 3`.

`zoomChanged` fires from the programmatic `setZoom()` (with the clamped level) and `resetView()` (with `1`). It does **not** fire for Ctrl/⌘-wheel zoom or double-click reset, which change the view directly; poll `getZoom()` if you need to track user zoom.

Pointer coordinates are clamped to the volume edge when the pointer is outside the image; see [Coordinates from the viewers](/guide/coordinate-systems#coordinates-from-the-viewers). The `'ready'` event fires inside the factory, before you can subscribe — the resolved promise is the ready signal.

### Controlling a view

```ts
axial.setCrosshairVisible(false)
axial.setOrientationLabelsVisible(true, { anchor: 'image' })
axial.setTheme({ backgroundColor: 0xfafaf7 })
axial.setZoom(2)
axial.setPan({ x: 40, y: 0 })
axial.resetView()
axial.dispose()
```

Also available: `setCrosshairStyle`, `setOrientationLabelStyle`, `setBackground`, `getZoom`, `getPan`, `getCanvas`, `getOrientation`, `getImageLayer`, `getCoordinateTransformer`, and the depth-enhancement toggles (`setDepthEnhancementEnabled`, `setDepthEnhancementOptions`). Wheel, Ctrl/⌘-wheel, double-click and middle-drag behave as in [`SimpleOrthogonalViewer`](/guide/viewers#navigating).

## Synchronizing views

Create independent views, then link them:

```ts
import { SingleSliceViewer, ViewSynchronizer } from 'neuroimjs/browser'

const axial    = await SingleSliceViewer.createAxial(axialEl, stack, { showCrosshair: true })
const sagittal = await SingleSliceViewer.createSagittal(sagEl, stack, { showCrosshair: true })
const coronal  = await SingleSliceViewer.createCoronal(corEl, stack, { showCrosshair: true })

const sync = ViewSynchronizer.createOrthogonal(axial, sagittal, coronal, { syncOnAdd: true })
```

Now moving the crosshair in any view moves the others. `ViewSynchronizerOptions`:

| Option | Default | Effect |
|---|---|---|
| `syncOnHover` | `false` | Follow the pointer, not just clicks and programmatic moves. Fixed at construction. |
| `syncOnAdd` | `false` | When a view is added, move it to the first view's coordinate. |
| `epsilon` | library default | Coordinates closer than this are treated as equal (prevents feedback loops). |

`ViewSynchronizer.fromViews` accepts any named set of views (a `Record` or a `Map`); `addView(id, view)`, `removeView(id)`, `getView(id)`, `getViewIds()` manage membership at runtime, and `syncCoordinate(coord)` pushes a coordinate to every view.

## Patterns

The repository's `examples/` directory has complete, runnable pages for the first three patterns: `two-view-sync.html`, `multi-panel-custom-layout.html` and `multi-layer-viewer.html`.

### Linking and unlinking

`enable()`, `disable()` and `toggle()` switch synchronization without tearing anything down. While disabled the views move independently, so re-snap them when you link again. `syncOnHover` cannot be changed on a live synchronizer; rebuild it:

```ts
let sync = ViewSynchronizer.fromViews(views)

function setLinked(linked: boolean) {
  if (linked) {
    sync.enable()
    // Views drifted apart while unlinked; snap them to one position.
    sync.syncCoordinate(views.axial.getCurrentCoord())
  } else {
    sync.disable()
  }
}

function setFollowHover(hover: boolean) {
  // syncOnHover is fixed at construction: rebuild the synchronizer.
  const wasEnabled = sync.isEnabled()
  sync.dispose()
  sync = ViewSynchronizer.fromViews(views, { syncOnHover: hover })
  if (!wasEnabled) sync.disable()
}
```

`sync.dispose()` only detaches the synchronizer's listeners; the views keep running.

### A custom multi-panel layout

The layout is plain CSS; each view fills whatever box you give it. A large axial with two small planes and a readout:

```html
<div class="viewer-grid">
  <div class="cell big"><div id="axial"></div></div>
  <div class="cell"><div id="sagittal"></div></div>
  <div class="cell"><div id="coronal"></div></div>
  <output id="readout">—</output>
</div>

<style>
  .viewer-grid {
    display: grid;
    grid-template-columns: 2fr 1fr;
    grid-template-rows: 1fr 1fr auto;
    gap: 8px;
    height: 70vh;
  }
  .cell { position: relative; min-width: 0; min-height: 0; background: #000; }
  .cell.big { grid-row: 1 / 3; }
  #readout { grid-column: 1 / 3; font: 12px ui-monospace, monospace; }
</style>
```

```ts
const views = {
  axial:    await SingleSliceViewer.createAxial(document.getElementById('axial')!, stack, { showCrosshair: true, showOrientationLabels: true }),
  sagittal: await SingleSliceViewer.createSagittal(document.getElementById('sagittal')!, stack, { showCrosshair: true }),
  coronal:  await SingleSliceViewer.createCoronal(document.getElementById('coronal')!, stack, { showCrosshair: true }),
}
const sync = ViewSynchronizer.createOrthogonal(views.axial, views.sagittal, views.coronal)

const readout = document.getElementById('readout')!
views.axial.onPointerMove(({ worldCoord }) => {
  if (worldCoord?.length === 3) readout.textContent = worldCoord.map((v) => v.toFixed(1)).join(', ') + ' mm'
})
```

`min-width: 0; min-height: 0` on the cells matters: without it, a grid item grows to fit the canvas inside it and the views never shrink. Because each view tracks its own size, the cells can change (sidebar toggles, breakpoints) without any calls from you.

### A layer panel for composable views

Every view built from the same `VolStack` shares its `VolLayer` objects, and each view re-renders by itself when a layer's colormap, range, threshold, opacity or visibility changes through the `VolLayer` setters (`setColormap`, `setRange`, `setThreshold`, `setOpacity`, `setVisible`), which is what the panel calls. So a [`<layer-control-panel>`](/guide/controls) only needs the stack:

```ts
import type { LayerControlPanel, LayerControlState } from 'neuroimjs/browser'

const panel = document.querySelector('layer-control-panel') as LayerControlPanel
panel.volStack = stack          // the same VolStack the views were built from
await panel.updateComplete
panel.selectLayer('z-stat')

panel.addEventListener('layer-control-change', (e) => {
  const state = (e as CustomEvent<LayerControlState>).detail
  console.log(state.layerId, state.threshold)
})
```

The panel is a browser-only web component exported from `neuroimjs/browser`, not the main entry. Binding `panel.imageLayer = axial.getImageLayer() ?? undefined` also works (that is what `getImageLayer()` is for; it returns `ImageLayer | null` while the property takes `ImageLayer | undefined`, hence the `?? undefined` under strict TypeScript), but `volStack` is simpler: there is no single image layer to pick when you have several views. Leave `panel.viewer` unset; it is only used with `SimpleOrthogonalViewer` and `OrthogonalImageViewer`.

### Side-by-side comparison

Two subjects (or pre/post, or two contrasts), each with its own stack, linked by world coordinate. This is meaningful when both are in the same template space:

```ts
const left  = await SingleSliceViewer.createAxial(leftEl, stackA, { showCrosshair: true })
const right = await SingleSliceViewer.createAxial(rightEl, stackB, { showCrosshair: true })
const sync = ViewSynchronizer.fromViews({ left, right }, { syncOnHover: true })
```

### Across windows

A view's coordinate is just an array, so it travels over `postMessage` or a `BroadcastChannel`. Guard against echoing a coordinate you just received:

```ts
const channel = new BroadcastChannel('neuroimjs-cursor')
let applying = false

axial.onCoordChange((coord) => {
  if (!applying) channel.postMessage(coord)
})

channel.onmessage = (e: MessageEvent<number[]>) => {
  applying = true
  try {
    axial.setCoord(e.data)
  } finally {
    applying = false
  }
}
```

### Tear-down

```ts
sync.dispose()                                   // detaches listeners only
Object.values(views).forEach((v) => v.dispose()) // WebGL, observers, DOM
```

Each `SingleSliceViewer` owns a WebGL context; dispose views you are done with, especially in single-page apps that mount and unmount them.

This is the layer external applications should build on for anything beyond the stock 3-up layout.
