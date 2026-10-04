# Getting Started

This guide goes from `npm install` to a brain rendered in the browser, then shows the Node.js path for data processing.

## Install

```bash
npm install neuroimjs
```

That is all you need. The rendering and parsing libraries (`pixi.js`, `mobx`, `chroma-js`, `lit`, `nifti-reader-js`, `pako`, …) are regular **dependencies** of the package, so npm installs them with it. You don't need any peer dependencies or extra install steps. The Node entry requires Node.js 22 or later.

There are two entry points:

| Import | Use it for |
|---|---|
| `neuroimjs/browser` | Browser bundles: viewers, layers and in-page NIfTI decoding (`readNiftiArrayBuffer`). No `fs`. |
| `neuroimjs` | Node.js: file I/O (`readVol`, `writeVol`, …), processing and analysis. |

::: warning Pick one entry per app
`neuroimjs/browser` is a separate prebuilt bundle with its own copies of every class. Don't import from both entries in one app: a `ColorMap` or volume created from one entry fails the `instanceof` checks in the other (for example in `resolveColorMap`). Browser code should import everything from `neuroimjs/browser`. The main `neuroimjs` entry statically imports Node's `fs` and `path`, so it doesn't bundle for the browser without shims.

The browser entry covers viewers, layers, colormaps, the dense and sparse volume classes, `readNiftiArrayBuffer`, searchlights, the ROI classes (`ROICoords`, `ROIVol`, `ROIVec`) and the [group statistics](/guide/group-stats) helpers. Filtering, resampling, volume arithmetic, connected components, `StatFunctions`, the 4D `split*`/`concat` helpers and the ROI factories are exported only from `neuroimjs`.
:::

## Hello, brain (browser)

Here's the result first. This is a live `neuroimjs` viewer, not an image:

<BrainViewer mode="axial" :height="420" :show-slider="true" caption="A single axial SingleSliceViewer with a slice slider." />

The code that produces it starts with a small loader. It turns a NIfTI URL into a volume and picks a display window:

```ts
// load.ts
import { readNiftiArrayBuffer } from 'neuroimjs/browser'

/** Fetch a .nii or .nii.gz and return the volume plus a robust display window. */
export async function loadNiftiVolume(url: string) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`)
  // Handles gzip, endianness, scl_slope/scl_inter and the affine.
  const vol = readNiftiArrayBuffer(await response.arrayBuffer())
  return { vol, range: robustRange(vol.getData()) }
}

/** 2nd–99.5th percentile of a subsample, so a few extreme voxels don't wash out the image. */
export function robustRange(data: ArrayLike<number>): [number, number] {
  const step = Math.max(1, Math.floor(data.length / 250_000))
  const sample: number[] = []
  for (let i = 0; i < data.length; i += step) sample.push(data[i])
  sample.sort((a, b) => a - b)
  const at = (p: number) => sample[Math.floor(p * (sample.length - 1))]
  const [lo, hi] = [at(0.02), at(0.995)]
  return hi > lo ? [lo, hi] : [sample[0], sample[sample.length - 1]]
}
```

For the MNI152 template used on this page, `readNiftiArrayBuffer` returns an `Int16NeuroVol` of 197 × 233 × 189 voxels. Its full range is `[0, 10899]` and `robustRange` gives `[112, 9663]`.

Then build a layer stack and mount a viewer:

```ts
import { VolLayer, VolStack, ColorMapFactory, SingleSliceViewer } from 'neuroimjs/browser'
import { loadNiftiVolume } from './load'

const { vol, range } = await loadNiftiVolume('/data/mni152_t1.nii.gz')

const colormap = ColorMapFactory.createGrayscale({ range })
const layer = new VolLayer('t1', vol, colormap, range)
const stack = new VolStack(layer)

const viewer = await SingleSliceViewer.createAxial(
  document.getElementById('viewer')!,
  stack,
  { showCrosshair: true, showSlider: true, width: 512, height: 512 },
)

viewer.onCoordChange((coord) => console.log('world coord (mm):', coord))
```

Want all three planes at once? Swap `SingleSliceViewer.createAxial` for [`SimpleOrthogonalViewer.create`](/guide/viewers). The **[Single Slice View example](/examples/single-view)** has a complete page.

## Hello, volume (Node.js)

In Node, read straight from disk:

```ts
import { readVol } from 'neuroimjs'

const vol = await readVol('tpl-MNI152NLin2009aAsym_res-1_T1w.nii.gz')

vol.constructor.name // 'Int16NeuroVol' — the stored datatype is preserved
vol.space.dim // [197, 233, 189]
vol.space.spacing // [1, 1, 1]
vol.getRange() // [0, 10899]

// Voxel by grid index, and the world (mm) position of that voxel:
vol.getAt(98, 134, 72) // 2809 — the voxel whose centre is world (0, 0, 0)
vol.space.gridToCoord([98, 134, 72]) // [0, 0, 0]
vol.space.coordToGrid([0, 0, 0]) // [98, 134, 72]
```

`readVol` applies NIfTI intensity scaling (`scl_slope` / `scl_inter`) and byte-swaps big-endian data, so the values you read are the scaled intensities. When scaling is active, the result is a `FloatNeuroVol` (Float32; the browser loader uses Float64). Unscaled `UINT32` files are not supported by `readVol` ([details](/guide/io)). The file above ships with the repository as `tests/data/volumes/tpl-MNI152NLin2009aAsym_res-1_T1w.nii.gz`.

## Where to go next

- **[Data Structures](/guide/concepts)**: `NeuroSpace`, `NeuroVol`, `NeuroVec`, and how they fit together.
- **[Volumes & Slices](/guide/volumes)** and **[Time Series](/guide/time-series)**: the containers in depth.
- **[Reading & Writing](/guide/io)**: every reader and writer, plus their caveats.
- **[Coordinate Systems](/guide/coordinate-systems)**: grid, world and image space.
- **[Viewers](/guide/viewers)** & **[Composable Views](/guide/composable-views)**: custom layouts.
- **[Stability & Roadmap](/guide/stability)**: what's production-ready today.
