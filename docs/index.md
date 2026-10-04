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
    details: Read NIfTI-1/2 in the browser or Node and write NIfTI-1 from Node, with gzip, intensity scaling and affine-aware spatial metadata.
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

Everything below is a real `neuroimjs` viewer rendering the MNI152 template with a statistical overlay. Nothing here is a screenshot or a video. Click or drag to move the crosshair, scroll to change slices (<kbd>Ctrl</kbd>/<kbd>⌘</kbd>-scroll zooms), and use the panel on the right to change the overlay's colormap, range, threshold and opacity.

<ViewerWorkbench />

The layout is one `SimpleOrthogonalViewer`, and the side panel is the library's `<layer-control-panel>` web component bound to the same `VolStack`. **[See the full source →](/examples/viewer-workbench)**

::: tip Pre-1.0 — and actively hardening
neuroimjs is at `0.5.0`. The viewer stack, core data structures, NIfTI reading, geometry, processing, and analysis primitives are covered by a green test suite, and NIfTI reading is checked against nibabel-generated fixtures. Some paths still have confirmed bugs or limitations (4D writing, unscaled `UINT16`/`UINT32` NIfTI data, hypervector reductions, a few processing edge cases); the **[Stability matrix](/guide/stability)** lists the verified status of every feature, so you know what is safe to build on.
:::
