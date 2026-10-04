# Data Structures

neuroimjs rests on two ideas: a **space**, which says where voxels sit in the world, and a **volume**, which stores values on that space. Once these two are clear, the rest of the library follows.

## NeuroSpace: the coordinate frame

A `NeuroSpace` describes the geometry of a grid: its dimensions, voxel spacing, origin, anatomical axes, and the affine transform that maps voxel indices to world coordinates in millimetres.

```ts
import { NeuroSpace } from 'neuroimjs'

const space = new NeuroSpace(
  [64, 64, 40], // dim:     grid size in voxels
  [3, 3, 4], // spacing: mm per voxel
  [0, 0, 0], // origin:  world position of voxel [0,0,0]
)

space.dim // [64, 64, 40]
space.spacing // [3, 3, 4]
space.gridToCoord([32, 32, 20]) // [96, 96, 80] — world mm
space.coordToGrid([96, 96, 80]) // [32, 32, 20]
space.coordToGrid([97, 96, 80]) // [32.33…, 32, 20] — continuous, not rounded
```

A space can also be built from a full 4×4 affine (the fifth constructor argument), as the NIfTI readers do. **[Coordinate Systems](/guide/coordinate-systems)** covers the transforms in full. A space with a fourth dimension describes a time series (see below).

## NeuroVol: 3D volumes

`NeuroVol` is the interface for 3D data. Every implementation supports `getAt(i, j, k)`, `setAt`, `get(linearIndex)`, `getData()`, `getRange()` and slicing:

| Class | Storage | When to use |
|---|---|---|
| `DenseNeuroVol` subclasses: `FloatNeuroVol`, `Int16NeuroVol`, `UInt8NeuroVol`, … | One typed array | The default |
| `LogicalNeuroVol` | 0/1 `Uint8Array` | Masks and thresholded maps |
| `SparseNeuroVol` | `Map` of non-default voxels | Peaks, spheres, small ROIs on large grids |
| `ClusteredNeuroVol` | Mask + one label per in-mask voxel | Parcellations and atlases (wrapped by `NeuroAtlas`) |

```ts
import { NeuroSpace, FloatNeuroVol } from 'neuroimjs'

const vspace = new NeuroSpace([2, 2, 2])
const data = new Float32Array([0, 1, 2, 3, 4, 5, 6, 7])
const vol = new FloatNeuroVol(vspace, data) // (space, data)
vol.getAt(1, 0, 0) // 1
vol.getAt(0, 1, 0) // 2  — i varies fastest: index = i + j·nx + k·nx·ny
```

::: tip Constructor order
Typed volume constructors take **`(space, data)`**: the space first, then the typed array. The data array is adopted as is, without a copy, and is laid out x-fastest as in NIfTI.
:::

**[Volumes & Slices](/guide/volumes)** covers each class in depth: masks, sparse volumes, parcellations, geometry checks and 2D slice extraction.

## NeuroVec: 4D time series

A `NeuroVec` is a stack of 3D volumes on one grid, the natural shape for an fMRI run. Every implementation takes `(i, j, k, t)` in `getAt`/`setAt`, returns a voxel's series from `getSeries(i, j, k)`, and returns frame `t` as a `NeuroVol` from `getVolume(t)`. The family includes:

- dense typed vecs (`Float32NeuroVec`, …) built on a 4D space,
- `EnhancedFloat32NeuroVec`, which adds `detrend`, `temporalFilter` and temporal statistics,
- `FileBackedNeuroVec` and `MappedNeuroVec` for runs you don't want to convert up front,
- `SparseNeuroVec`,
- `BigNeuroVec`, which is what `readVec` returns.

::: warning Two axis orders
For most vec classes `space.dim` is `[X, Y, Z, T]`. `BigNeuroVec`, which `readVec` returns, uses `[T, X, Y, Z]`. On all of them, `vec.length` is the total element count, not the number of time points.
:::

**[Time Series](/guide/time-series)** has verified examples of each class, the preprocessing operations, and how to load large runs.

## Hypervectors: 5D and beyond

`createNeuroHyperVec(space, dimensions)` returns a `DenseNeuroHyperVec`: a 3D grid plus any number of named axes (subject, condition, session, …). It supports sub-volume extraction, reductions (`ReductionOp`), concatenation, splitting and permutation. Several advanced operations are not implemented yet. **[Time Series → Hypervectors](/guide/time-series#hypervectors-5d-and-beyond)** lists what works and what throws.

## Display building blocks

Visualization composes three small pieces:

```
VolStack  ─ holds one or more ─►  VolLayer  ─ wraps ─►  NeuroVol + ColorMap + range
   │
   └─► fed into a viewer (SimpleOrthogonalViewer, SingleSliceViewer, …)
```

```ts
// Display code runs in the browser, so import from the browser entry.
import { NeuroSpace, FloatNeuroVol, VolLayer, VolStack, ColorMapFactory } from 'neuroimjs/browser'

const vol = new FloatNeuroVol(new NeuroSpace([2, 2, 2]), new Float32Array([0, 1, 2, 3, 4, 5, 6, 7]))

const cmap = ColorMapFactory.createGrayscale({ range: [0, 7] })
const layer = new VolLayer('t1', vol, cmap, [0, 7])
const stack = new VolStack(layer) // pass more layers to overlay
```

See **[Colormaps & Layers](/guide/colormaps)** for overlays and thresholding, and **[Viewers](/guide/viewers)** to put a stack on screen.
