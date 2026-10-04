# Orthogonal Viewer

A complete, copy-pasteable orthogonal viewer — the same component running below.

<BrainViewer mode="ortho" :height="520" caption="Live SimpleOrthogonalViewer." />

## Full code

```ts
import {
  readNiftiArrayBuffer, VolLayer, VolStack, ColorMapFactory, SimpleOrthogonalViewer,
} from 'neuroimjs/browser'

// 1 — Load a NIfTI volume (.nii or .nii.gz; scaling is applied).
const resp = await fetch('/data/mni152_t1.nii.gz')
const t1 = readNiftiArrayBuffer(await resp.arrayBuffer())

// Robust display window: 2nd–99.5th percentile of a subsample.
const data = t1.getData()
const sample = Array.from(data.filter((_, i) => i % 97 === 0)).sort((a, b) => a - b)
const range: [number, number] = [
  sample[Math.floor(sample.length * 0.02)],
  sample[Math.floor(sample.length * 0.995)],
]

// 2 — Build a stack and mount the viewer.
const stack = new VolStack(new VolLayer('t1', t1, ColorMapFactory.createGrayscale({ range }), range))
const viewer = await SimpleOrthogonalViewer.create(document.getElementById('viewer')!, stack, {
  layout: 'top-bottom',
  showCrosshair: true,
})

// 3 — React to interaction.
viewer.onCoordChange((c) => console.log('world (mm):', c))
viewer.onSliceChange(({ view, index }) => console.log(view, index))

// Drive it programmatically (world mm; RAS for a NIfTI with a valid affine):
viewer.setWorldCoord([0, -18, 20])

// When the host unmounts:
// viewer.dispose()
```

## HTML scaffold

```html
<div id="viewer" style="width: 720px; height: 520px;"></div>
<script type="module" src="./viewer.ts"></script>
```

## Notes

- **Give the container a size.** The viewer fits itself to its container and follows later resizes, but a zero-height container renders nothing.
- **Layouts** — `'top-bottom'`, `'left-tall'`, or `'ortho'` (2×2 grid with a legend cell); see [Viewers](/guide/viewers).
- **Overlays** — `viewer.addLayer(new VolLayer('stat', statVol, ColorMapFactory.createHot(), [3, 8]))`. For thresholds, colormaps and the interactive panel, see [Colormaps & Layers](/guide/colormaps) and the **[Full Viewer with Controls](/examples/viewer-workbench)**.

→ Prefer custom layouts? See **[Single Slice View](/examples/single-view)** and the [Composable Views](/guide/composable-views) guide.
