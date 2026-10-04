# What is neuroimjs?

**neuroimjs** is a TypeScript library for working with neuroimaging data in JavaScript runtimes — both the browser and Node.js. It gives you:

- **Volumetric data structures** — 3D volumes (dense, sparse, clustered, logical), 4D time-series (`NeuroVec`), and 5D+ hyper-volumes — all backed by typed arrays.
- **NIfTI I/O** — read and write `.nii` / `.nii.gz`, with affine-aware spatial metadata.
- **A coordinate-system model** — explicit grid ↔ world (mm) ↔ image transforms, with anatomical orientations.
- **Spatial processing** — filtering, morphology, and resampling.
- **Analysis primitives** — searchlight, connected components, clustering, statistics.
- **Live WebGL viewers** — orthogonal and composable slice viewers built on PIXI.js.

It's the kind of toolkit you reach for when you want to load a brain volume and *show it in a web app*, or run light analysis client-side without a Python backend.

## Who it's for

- **Web developers** embedding brain visualization into research tools, dashboards, or clinical UIs.
- **Researchers** prototyping browser-based neuroimaging workflows.
- **Anyone** porting a slice viewer or NIfTI pipeline off the desktop and onto the web.

If you know [nilearn](https://nilearn.github.io/) or [NiBabel](https://nipy.org/nibabel/) from the Python world, neuroimjs aims at a similar surface area, JavaScript-native.

## Two environments, one library

| | Browser | Node.js |
|---|---|---|
| Entry point | `neuroimjs/browser` | `neuroimjs` |
| Strength | Interactive WebGL viewers, in-page loading and review | File I/O, processing, statistics, slice extraction |
| Leaves out | File-path I/O (`readVol`, `writeVol`, …), the processing and statistics modules, Node-only dependencies | `readNiftiArrayBuffer`, `SubjectOverlayViewer`, `OverlayReviewPanel`, `LayerControlPanel` |

The browser entry is a display-focused subset that keeps Node-only code out of browser bundles. It also has a few exports the Node entry lacks: the [`readNiftiArrayBuffer`](/guide/io#loading-data-in-the-browser) loader, the [overlay review](/guide/overlay-review) viewer and panel, and the `LayerControlPanel` web component. The loader depends on the ESM-only `nifti-reader-js`, which would break `require('neuroimjs')`, and the panels are Lit web components.

## A note on maturity

neuroimjs is **pre-1.0** (the current release is in the 0.5 series), so minor releases can still change the API; each change is listed in the [changelog](https://github.com/bbuchsbaum/neuroimjs/blob/main/CHANGELOG.md). The viewers and the core volume and geometry types are covered by unit and browser (Playwright) tests, and NIfTI reading is checked against fixtures generated with nibabel; these are safe to build on. A few corners are partial: AFNI and dual-file NIfTI cannot be read, and some `NeuroHyperVec` operations throw "not yet implemented". **[Stability & Roadmap](/guide/stability)** gives the status of each module.

## Next steps

- **[Getting Started](/guide/getting-started)** — install and render your first brain.
- **[Loading data in the browser](/guide/io#loading-data-in-the-browser)** — turn fetched or user-selected NIfTI bytes into a volume.
- **[Data Structures](/guide/concepts)** — the mental model behind volumes and spaces.
- **[Live Examples](/examples/)** — runnable viewers you can poke at right here.
