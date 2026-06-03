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
| Entry point | `neuroimjs/browser` (or the `browser` export) | `neuroimjs` |
| Strength | Interactive WebGL viewers, in-page analysis | File I/O, batch processing, slice extraction |
| Excludes | `fs`, `canvas` (Node-only modules) | nothing |

The browser entry deliberately excludes Node-only code so bundlers don't choke on `fs`.

## A note on maturity

neuroimjs is **pre-1.0 (`0.1.0`)**. The viewer stack and the core geometry/volume types are dependable; some I/O and processing paths have known bugs, and a handful of advertised APIs are still aspirational. We track this transparently — see **[Stability & Roadmap](/guide/stability)** so you always know what's safe to build on.

## Next steps

- **[Getting Started](/guide/getting-started)** — install and render your first brain.
- **[Data Structures](/guide/concepts)** — the mental model behind volumes and spaces.
- **[Live Examples](/examples/)** — runnable viewers you can poke at right here.
