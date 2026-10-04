# Viewers

The viewer stack is neuroimjs's most mature subsystem. It renders volumes with PIXI.js (WebGL) and coordinates state with MobX. There are two ways in: a ready-made orthogonal viewer, and composable single-slice views you arrange yourself.

<BrainViewer mode="ortho" :height="500" caption="SimpleOrthogonalViewer rendering the MNI152 template." />

## SimpleOrthogonalViewer

The fastest path to a classic three-plane viewer. Give it a container and a `VolStack`:

```ts
import { SimpleOrthogonalViewer } from 'neuroimjs'

const viewer = await SimpleOrthogonalViewer.create(container, stack, {
  layout: 'top-bottom',     // or 'left-tall' | 'ortho'
  showCrosshair: true,
  showSlider: false,
  gapPx: 12,
})
```

### Driving it

```ts
// Move the crosshair to a world coordinate (mm)
viewer.setWorldCoord([0, -18, 20])

// Or in anatomical LPI coordinates, regardless of volume orientation
viewer.setLPICoord([0, 18, 20])

const here = viewer.getWorldCoord()
```

### Reacting to it

Every subscription returns an unsubscribe function:

```ts
const off = viewer.onCoordChange((coord) => {
  console.log('crosshair (mm):', coord)
})

viewer.onSliceChange(({ view, index }) => {
  console.log(`${view} slice → ${index}`)
})

viewer.onReady(() => console.log('viewer ready'))

// later…
off()
```

### Overlays

Add more layers (e.g. a stat map over an anatomical) by appending to the stack, and change them by id:

```ts
viewer.addLayer(new VolLayer('stat', statVol, hotColormap, [3, 8]))
viewer.updateLayer('stat', { threshold: [-3, 3], alpha: 0.8 })
viewer.removeLayer('stat')
```

See **[Colormaps & Layers](/guide/colormaps)** for thresholding and opacity, and **[Multi-Layer Alignment](/guide/alignment)** for overlays on a different voxel grid from the first layer.

## Styling

Restyle a running viewer in place, without rebuilding it. Colours are PIXI numeric colours (`0xRRGGBB`); omitted fields keep their current value.

```ts
viewer.setBackground(0x111619)        // clear colour of every view (optional alpha second)
viewer.setCrosshairStyle({ crossColor: 0x22d3ee, crossAlpha: 0.8, crossThickness: 1, crosshairGap: 4 })
viewer.setOrientationLabelStyle({ color: 0xffffff, fontSize: 14, alpha: 0.9 })

// Or all at once, e.g. when switching between light and dark themes
viewer.setTheme({
  backgroundColor: 0xfafaf7,
  crosshair: { crossColor: 0x1c2226, haloColor: 0xffffff, haloAlpha: 0.6 },
  orientationLabels: { color: 0x3e4952, shadowAlpha: 0 },
})

const canvas = viewer.getCanvas('axial')   // the view's <canvas>, e.g. for screenshots
```

`setTheme` takes a `ViewerTheme` (`backgroundColor`, `backgroundAlpha`, `crosshair`, `orientationLabels`) and is also available on `SingleSliceViewer`, together with `setBackground`, `setCrosshairStyle` and `setOrientationLabelStyle`. The same styles can be given at construction through the `backgroundColor`, `crosshairOptions` and `orientationLabelOptions` options. `toDataURL(view, type?, quality?)` exports one view as a PNG (or JPEG/WebP) data URL.

## When to use which

| Use | Reach for |
|---|---|
| A standard 3-up viewer, minimal wiring | `SimpleOrthogonalViewer` |
| Custom layouts, embedding individual planes, cross-window sync | `SingleSliceViewer` + `ViewSynchronizer` → [Composable Views](/guide/composable-views) |
| Low-level orchestration | `OrthogonalImageViewer` (the layer `SimpleOrthogonalViewer` wraps) |

## Sizing & lifecycle

Viewers size themselves to their container, so give the container an explicit size (CSS, or the `width`/`height` options on single views). They watch the container with a `ResizeObserver` and re-fit when it changes size. Call `dispose()` when you remove a viewer; it releases its WebGL resources and listeners.

Layouts: `'top-bottom'` (the default) puts the axial view across the top and the sagittal and coronal views below; `'left-tall'` puts the axial view in a tall left column; `'ortho'` is an aligned 2×2 grid (coronal and sagittal above, axial and a legend cell below) that stacks into one column on narrow containers.

## Logging

The viewers log only warnings and errors by default. To see their diagnostic
output (layer setup, sprite creation, render timings), opt in:

```ts
import { enableDebugLogging, setLogLevel } from 'neuroimjs';

enableDebugLogging();      // DEBUG; enableDebugLogging(false) restores the default
setLogLevel('info');       // or 'warn' | 'error' | 'none'
```

Without code changes, set `globalThis.NEUROIMJS_DEBUG = true` (or
`globalThis.NEUROIMJS_LOG_LEVEL = 'debug'`) before neuroimjs loads; in Node,
use the `NEUROIMJS_DEBUG` / `NEUROIMJS_LOG_LEVEL` environment variables.

::: tip Live, not static
The brains on this page are these exact components running against a real MNI152 volume. The same code in your app produces the same result — see the runnable **[Examples](/examples/)**.
:::
