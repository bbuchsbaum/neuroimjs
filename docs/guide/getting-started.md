# Getting Started

This guide takes you from `npm install` to a real brain rendering in the browser, then shows the Node.js path for data processing.

## Install

```bash
npm install neuroimjs
```

That is all you need. The rendering and parsing libraries the viewers use (PIXI.js, MobX, Lit, `nifti-reader-js`, `pako`, `chroma-js`) are regular dependencies and install with it. neuroimjs requires Node.js 22 or later for its Node entry point.

## Hello, brain (browser)

Here's the result first — this is a live `neuroimjs` viewer, not an image:

<BrainViewer mode="axial" :height="420" :show-slider="true" caption="A single axial SingleSliceViewer with a slice slider." />

Here is code for the same view. `readNiftiArrayBuffer` turns the bytes of a `.nii` or `.nii.gz` file into a volume, applying the header's intensity scaling, byte order and affine:

```ts
import {
  readNiftiArrayBuffer, VolLayer, VolStack, ColorMapFactory, SingleSliceViewer,
} from 'neuroimjs/browser'

const response = await fetch('/data/mni152_t1.nii.gz')
const vol = readNiftiArrayBuffer(await response.arrayBuffer())
const range = vol.getRange()

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

[Loading data in the browser](/guide/io#loading-data-in-the-browser) covers what the loader does, how to pick one volume of a 4D file, and how to check geometry before overlaying.

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

`readVol` applies NIfTI intensity scaling (`scl_slope` / `scl_inter`) and handles big-endian data for you, so the values you read are already scaled. It follows the same rules as the browser loader.

## Where to go next

- **[Data Structures](/guide/concepts)** — `NeuroSpace`, `NeuroVol`, `NeuroVec`, and friends.
- **[Coordinate Systems](/guide/coordinate-systems)** — grid vs world vs image space.
- **[Viewers](/guide/viewers)** & **[Composable Views](/guide/composable-views)** — build custom layouts.
- **[Stability & Roadmap](/guide/stability)** — what's production-ready today.
