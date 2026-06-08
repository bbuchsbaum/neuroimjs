---
layout: home

hero:
  name: neuroimjs
  text: Neuroimaging for JavaScript
  tagline: Volumetric data, NIfTI I/O, spatial transforms, and live WebGL brain viewers — in the browser and in Node.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: Live Examples
      link: /examples/
    - theme: alt
      text: API Reference
      link: /api/

features:
  - icon: 🧠
    title: Volumes, 4D & beyond
    details: Dense, sparse, clustered, and logical volumes; 4D time-series (NeuroVec) and 5D+ hyper-volumes — all backed by typed arrays.
    link: /guide/concepts
    linkText: Data structures
  - icon: 💾
    title: NIfTI I/O
    details: Read and write NIfTI in Node or the browser, with gzip support and affine-aware spatial metadata.
    link: /guide/io
    linkText: Reading & writing
  - icon: 🎨
    title: Live WebGL viewers
    details: Orthogonal and composable slice viewers rendered with PIXI.js — the same components powering the brain on this page.
    link: /guide/viewers
    linkText: Viewers
  - icon: 🧭
    title: Coordinate-system aware
    details: Grid, world (mm), and image spaces with explicit affine transforms and anatomical orientations.
    link: /guide/coordinate-systems
    linkText: Coordinate systems
  - icon: 🔬
    title: Spatial processing
    details: Gaussian, bilateral and guided filtering, morphology, and multi-kernel resampling over typed-array volumes.
    link: /guide/processing
    linkText: Processing
  - icon: 📈
    title: Analysis primitives
    details: Searchlight iterators, connected components, clustering, and statistics for in-browser analysis pipelines.
    link: /guide/analysis
    linkText: Analysis
---

## See it run

Everything below is a real `neuroimjs` viewer rendering a real MNI152 brain — no screenshots, no video. Drag to move the crosshair, scrub to change slices.

<BrainViewer mode="ortho" :height="520" caption="SimpleOrthogonalViewer — axial · coronal · sagittal, synchronized." />

```ts
import { SimpleOrthogonalViewer } from 'neuroimjs'
import { loadNiftiVolume } from './load' // the small helper shown in Getting Started

const { vol, range } = await loadNiftiVolume('/data/mni152_t1.nii.gz')
const stack = makeStack(vol, range)

await SimpleOrthogonalViewer.create(document.getElementById('viewer'), stack, {
  layout: 'top-bottom',
  showCrosshair: true,
})
```

::: tip Pre-1.0 — and actively hardening
neuroimjs is at `0.1.0`. The viewer stack, core data structures, NIfTI I/O, geometry, processing, and analysis primitives are covered by a fully green test suite. Remaining pre-1.0 work is structural consolidation — merging a few duplicate implementations behind the existing APIs. The **[Stability matrix](/guide/stability)** lists the verified, up-to-date status of every feature.
:::
