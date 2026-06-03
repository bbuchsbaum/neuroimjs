# Getting Started

This guide takes you from `npm install` to a real brain rendering in the browser, then shows the Node.js path for data processing.

## Install

```bash
npm install neuroimjs
```

The viewer components rely on a few **peer dependencies**. Install the ones you use:

```bash
# Required for the WebGL viewers:
npm install pixi.js mobx

# Optional, depending on features:
npm install chroma-js          # richer colormaps
npm install lit @lit/reactive-element   # the <LayerControlPanel> web component
npm install nifti-reader-js    # convenient client-side NIfTI parsing
```

::: info Why peer dependencies?
Heavy rendering libraries (PIXI.js, MobX) are declared as **optional peer dependencies** so that consumers who only need the data structures or Node I/O don't pull in a WebGL stack. You install exactly what your use case needs.
:::

## Hello, brain (browser)

Here's the result first — this is a live `neuroimjs` viewer, not an image:

<BrainViewer mode="axial" :height="420" :show-slider="true" caption="A single axial SingleSliceViewer with a slice slider." />

And the code that produces it. First, a small loader that turns a NIfTI URL into a volume with a sensible display window:

```ts
// load.ts
import * as nifti from 'nifti-reader-js'
import { FloatNeuroVol, NeuroSpace } from 'neuroimjs'

export async function loadNiftiVolume(url: string) {
  let buffer = await (await fetch(url)).arrayBuffer()
  if (nifti.isCompressed(buffer)) buffer = nifti.decompress(buffer)
  if (!nifti.isNIFTI(buffer)) throw new Error('Not a NIfTI file')

  const header = nifti.readHeader(buffer)
  const img = nifti.readImage(header, buffer)

  const dim = Array.from(header.dims.slice(1, 4))
  const spacing = Array.from(header.pixDims.slice(1, 4))
  const affine = header.affine
  const origin = [affine[0][3], affine[1][3], affine[2][3]]
  const space = new NeuroSpace(dim, spacing, origin, undefined, affine)

  // Apply NIfTI intensity scaling (slope/intercept) — important for many volumes.
  const slope = header.scl_slope || 1
  const inter = header.scl_inter || 0
  const raw = new Float32Array(img) // simplified: see the example for full dtype handling
  const data = new Float32Array(raw.length)
  for (let i = 0; i < raw.length; i++) data[i] = raw[i] * slope + inter

  return { vol: new FloatNeuroVol(space, data), space, range: [data[0], data[0]] as [number, number] }
}
```

Then build a layer stack and mount a viewer:

```ts
import {
  VolLayer, VolStack, ColorMapFactory, SingleSliceViewer,
} from 'neuroimjs'
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

::: tip Full loader
The snippet above simplifies datatype handling and range computation for brevity. The **[Single Slice View example](/examples/single-view)** and the repo's `examples/` directory contain a complete loader that handles all NIfTI datatypes and computes a robust intensity window.
:::

Want all three planes at once? Swap `SingleSliceViewer.createAxial` for [`SimpleOrthogonalViewer.create`](/guide/viewers).

## Hello, volume (Node.js)

In Node you can read straight from disk:

```ts
import { readVol } from 'neuroimjs'

const vol = await readVol('subject01_T1w.nii.gz')

console.log('dimensions:', vol.space.dim)      // e.g. [193, 229, 193]
console.log('spacing (mm):', vol.space.spacing) // e.g. [1, 1, 1]

// Read a voxel by grid index:
const value = vol.getAt(96, 114, 96)
```

`readVol` applies NIfTI intensity scaling (`scl_slope` / `scl_inter`) and handles big-endian data for you, so the values you read are already in physical units.

## Where to go next

- **[Data Structures](/guide/concepts)** — `NeuroSpace`, `NeuroVol`, `NeuroVec`, and friends.
- **[Coordinate Systems](/guide/coordinate-systems)** — grid vs world vs image space.
- **[Viewers](/guide/viewers)** & **[Composable Views](/guide/composable-views)** — build custom layouts.
- **[Stability & Roadmap](/guide/stability)** — what's production-ready today.
