# Orthogonal Viewer

A complete, copy-pasteable orthogonal viewer — the same component running below.

<BrainViewer mode="ortho" :height="520" caption="Live SimpleOrthogonalViewer." />

## Full code

```ts
import {
  readNiftiArrayBuffer,
  VolLayer, VolStack, ColorMapFactory,
  SimpleOrthogonalViewer,
} from 'neuroimjs/browser'

// 1 — Load a NIfTI volume. readNiftiArrayBuffer handles gzip, datatype,
//     byte order, intensity scaling and the affine.
async function loadNiftiVolume(url: string) {
  const vol = readNiftiArrayBuffer(await (await fetch(url)).arrayBuffer())

  // Robust display window (2nd–99.5th percentile of a subsample).
  const data = vol.getData()
  const s = Array.from(data).filter((_, i) => i % 97 === 0).sort((a, b) => a - b)
  const range: [number, number] = [s[Math.floor(s.length * 0.02)], s[Math.floor(s.length * 0.995)]]

  return { vol, range }
}

// 2 — Build a stack and mount the viewer.
const { vol, range } = await loadNiftiVolume('/data/mni152_t1.nii.gz')
const layer = new VolLayer('t1', vol, ColorMapFactory.createGrayscale({ range }), range)
const stack = new VolStack(layer)

const viewer = await SimpleOrthogonalViewer.create(
  document.getElementById('viewer')!,
  stack,
  { layout: 'top-bottom', showCrosshair: true },
)

// 3 — React to interaction.
viewer.onCoordChange((c) => console.log('world (mm):', c))
viewer.onSliceChange(({ view, index }) => console.log(view, index))

// Drive it programmatically:
viewer.setLPICoord([0, 18, 20])
```

## HTML scaffold

```html
<div id="viewer" style="width: 720px; height: 520px;"></div>
<script type="module" src="./viewer.js"></script>
```

## Notes

- **Container size matters** — the viewer reads it on creation. Give `#viewer` explicit dimensions.
- **Layouts** — `'top-bottom'` (default), `'left-tall'`, or `'ortho'` (a 2×2 grid with a legend cell).
- **Overlays** — `viewer.addLayer(new VolLayer('stat', statVol, hot, [3, 8]))`. See [Colormaps & Layers](/guide/colormaps).

→ Prefer custom layouts? See **[Single Slice View](/examples/single-view)** and the [Composable Views](/guide/composable-views) guide.
