# Single Slice View

A standalone `SingleSliceViewer` — embeddable in any layout, with a full event API. Below: one axial view with a slice slider.

<BrainViewer mode="axial" :height="460" :show-slider="true" caption="Live SingleSliceViewer (axial)." />

## Code

```ts
import {
  VolLayer, VolStack, ColorMapFactory, SingleSliceViewer,
} from 'neuroimjs'
import { loadNiftiVolume } from './load'  // the loader from the Orthogonal example

const { vol, range } = await loadNiftiVolume('/data/mni152_t1.nii.gz')
const stack = new VolStack(new VolLayer('t1', vol, ColorMapFactory.createGrayscale({ range }), range))

const axial = await SingleSliceViewer.createAxial(
  document.getElementById('axial')!,
  stack,
  { showCrosshair: true, showSlider: true, width: 512, height: 512 },
)

// Events
axial.onCoordChange((coord) => updateReadout('world', coord))
axial.onSliceChange((index) => updateReadout('slice', index))
axial.onPointerMove(({ imageCoord, worldCoord }) => {
  updateReadout('mouse', imageCoord ?? 'outside')
  updateReadout('mouseWorld', worldCoord ?? 'outside')
})

// Imperative control
axial.setCrosshairVisible(true)
axial.setCoord([0, -18, 20])
axial.getCurrentCoord()
axial.getCurrentSliceIndex()
axial.getOrientation()
```

## Three synchronized views

Compose your own orthogonal layout and link the views:

<div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem;">
  <BrainViewer mode="axial" :height="240" caption="Axial" />
  <BrainViewer mode="coronal" :height="240" caption="Coronal" />
  <BrainViewer mode="sagittal" :height="240" caption="Sagittal" />
</div>

```ts
import { SingleSliceViewer, ViewSynchronizer } from 'neuroimjs'

const axial    = await SingleSliceViewer.createAxial(axialEl, stack)
const sagittal = await SingleSliceViewer.createSagittal(sagEl, stack)
const coronal  = await SingleSliceViewer.createCoronal(corEl, stack)

// Crosshair moves in one → all update.
const sync = ViewSynchronizer.createOrthogonal(axial, sagittal, coronal)
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
