# Single Slice View

A standalone `SingleSliceViewer` — embeddable in any layout, with a full event API. Below: one axial view with a slice slider.

<BrainViewer mode="axial" :height="460" :show-slider="true" caption="Live SingleSliceViewer (axial)." />

## Code

```ts
import {
  readNiftiArrayBuffer, VolLayer, VolStack, ColorMapFactory, SingleSliceViewer,
} from 'neuroimjs/browser'

const resp = await fetch('/data/mni152_t1.nii.gz')
const t1 = readNiftiArrayBuffer(await resp.arrayBuffer())
const range = t1.getRange() // or a percentile window; see Getting Started
const stack = new VolStack(new VolLayer('t1', t1, ColorMapFactory.createGrayscale({ range }), range))

const axial = await SingleSliceViewer.createAxial(document.getElementById('axial')!, stack, {
  showCrosshair: true,
  showSlider: true,
})

// Events (each returns an unsubscribe function)
const log = (label: string, value: unknown) => console.log(label, value)
axial.onCoordChange((coord) => log('world mm', coord))
axial.onSliceChange((index) => log('slice', index))
axial.onPointerMove(({ imageCoord, worldCoord }) => {
  log('mouse (image)', imageCoord ?? 'outside')
  log('mouse (world)', worldCoord ?? 'outside')
})

// Imperative control
axial.setCrosshairVisible(true)
axial.setCoord([0, -18, 20])
log('now at', axial.getCurrentCoord())
log('slice index', axial.getCurrentSliceIndex())
log('orientation', axial.getOrientation())
```

Pointer payloads are computed on the next animation frame, so a handler sees the position from the previous pointer event; see [Composable Views](/guide/composable-views) for details.

## Three synchronized views

Compose your own orthogonal layout and link the views. Click in any plane below and the other two follow:

<BrainViewer mode="trio" :height="260" caption="Three SingleSliceViewers linked by ViewSynchronizer.createOrthogonal." />

```ts
import { SingleSliceViewer, ViewSynchronizer } from 'neuroimjs/browser'

const axial    = await SingleSliceViewer.createAxial(document.getElementById('axial')!, stack)
const coronal  = await SingleSliceViewer.createCoronal(document.getElementById('coronal')!, stack)
const sagittal = await SingleSliceViewer.createSagittal(document.getElementById('sagittal')!, stack)

// Moving the crosshair in one view updates the others.
const sync = ViewSynchronizer.createOrthogonal(axial, sagittal, coronal)

// Tear down in reverse order when the host unmounts.
sync.dispose()
for (const v of [axial, coronal, sagittal]) v.dispose()
```

```html
<div class="grid">
  <div id="axial"></div>
  <div id="coronal"></div>
  <div id="sagittal"></div>
</div>
<style>
  .grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; }
  .grid > div { aspect-ratio: 1; background: #000; }
</style>
```

→ Full guide: **[Composable Views](/guide/composable-views)**.
