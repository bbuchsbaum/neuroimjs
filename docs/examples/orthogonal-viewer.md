# Orthogonal Viewer

A complete, copy-pasteable orthogonal viewer — the same component running below.

<BrainViewer mode="ortho" :height="520" caption="Live SimpleOrthogonalViewer." />

## Full code

```ts
import {
  NeuroSpace, FloatNeuroVol,
  VolLayer, VolStack, ColorMapFactory,
  SimpleOrthogonalViewer,
} from 'neuroimjs'
import * as nifti from 'nifti-reader-js'

// 1 — Load a NIfTI volume, applying datatype + intensity scaling.
async function loadNiftiVolume(url: string) {
  let buf = await (await fetch(url)).arrayBuffer()
  if (nifti.isCompressed(buf)) buf = nifti.decompress(buf)
  if (!nifti.isNIFTI(buf)) throw new Error('Not a NIfTI file')

  const h = nifti.readHeader(buf)
  const img = nifti.readImage(h, buf)
  const dim = Array.from(h.dims.slice(1, 4))
  const spacing = Array.from(h.pixDims.slice(1, 4))
  const affine = h.affine
  const origin = [affine[0][3], affine[1][3], affine[2][3]]
  const space = new NeuroSpace(dim, spacing, origin, undefined, affine)

  const N = nifti.NIFTI1
  const ctor = {
    [N.TYPE_UINT8]: Uint8Array, [N.TYPE_INT16]: Int16Array,
    [N.TYPE_INT32]: Int32Array, [N.TYPE_FLOAT32]: Float32Array,
    [N.TYPE_FLOAT64]: Float64Array, [N.TYPE_UINT16]: Uint16Array,
  }[h.datatypeCode] ?? Float32Array
  const raw = new ctor(img)

  const slope = h.scl_slope || 1
  const inter = h.scl_inter || 0
  const data = new Float32Array(raw.length)
  for (let i = 0; i < raw.length; i++) data[i] = raw[i] * slope + inter

  // Robust display window (2nd–99.5th percentile of a subsample).
  const s = [...data].filter((_, i) => i % 97 === 0).sort((a, b) => a - b)
  const range: [number, number] = [s[Math.floor(s.length * 0.02)], s[Math.floor(s.length * 0.995)]]

  return { vol: new FloatNeuroVol(space, data), range }
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
- **Layouts** — `'top-bottom'` or `'left-tall'`.
- **Overlays** — `viewer.addLayer(new VolLayer('stat', statVol, hot, [3, 8]))`. See [Colormaps & Layers](/guide/colormaps).

→ Prefer custom layouts? See **[Single Slice View](/examples/single-view)** and the [Composable Views](/guide/composable-views) guide.
