# Viewers

The viewer stack is neuroimjs's most mature subsystem. It renders volumes with PIXI.js (WebGL) and coordinates state with MobX. There are two ways in: a ready-made orthogonal viewer, and composable single-slice views you arrange yourself.

<BrainViewer mode="ortho" :height="500" caption="SimpleOrthogonalViewer rendering the MNI152 template." />

## SimpleOrthogonalViewer

The fastest path to a classic three-plane viewer. Give it a container and a `VolStack`:

```ts
import { SimpleOrthogonalViewer } from 'neuroimjs'

const viewer = await SimpleOrthogonalViewer.create(container, stack, {
  layout: 'top-bottom',     // or 'left-tall'
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

Add more layers (e.g. a stat map over an anatomical) by appending to the stack:

```ts
viewer.addLayer(new VolLayer('stat', statVol, hotColormap, [3, 8]))
```

See **[Colormaps & Layers](/guide/colormaps)** for thresholding and opacity.

## When to use which

| Use | Reach for |
|---|---|
| A standard 3-up viewer, minimal wiring | `SimpleOrthogonalViewer` |
| Custom layouts, embedding individual planes, cross-window sync | `SingleSliceViewer` + `ViewSynchronizer` → [Composable Views](/guide/composable-views) |
| Low-level orchestration | `OrthogonalImageViewer` (the layer `SimpleOrthogonalViewer` wraps) |

## Sizing & lifecycle

Viewers read their container's dimensions on creation, so give the container an explicit size (CSS or the `width`/`height` options on single views). Recreate the viewer if the container resizes substantially.

::: tip Live, not static
The brains on this page are these exact components running against a real MNI152 volume. The same code in your app produces the same result — see the runnable **[Examples](/examples/)**.
:::
