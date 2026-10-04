# Data Structures

Everything in neuroimjs is built on two ideas: a **space** that describes where voxels live in the world, and a **volume** that stores values on that space. Get these two and the rest of the library falls into place.

## NeuroSpace — the coordinate frame

A `NeuroSpace` describes the geometry of a grid: its dimensions, voxel spacing, origin, anatomical orientation, and the affine transform that maps voxel indices to physical (world) coordinates in millimeters.

```ts
import { NeuroSpace } from 'neuroimjs'

const space = new NeuroSpace(
  [64, 64, 40],     // dim:     grid size in voxels
  [3, 3, 4],        // spacing: mm per voxel
  [0, 0, 0],        // origin:  world position of voxel [0,0,0]
)

space.dim       // [64, 64, 40]
space.spacing   // [3, 3, 4]
space.gridToCoord([32, 32, 20])   // → world coordinate in mm
space.coordToGrid([0, 0, 0])      // → nearest voxel index
```

A space can also be constructed from a full 4×4 affine (e.g. one read from a NIfTI header) — that's what the loaders do. See **[Coordinate Systems](/guide/coordinate-systems)** for the full transform story.

## NeuroVol — 3D volumes

`NeuroVol` is the interface for 3D volumetric data. There are several implementations for different storage strategies:

| Class | When to use |
|---|---|
| `DenseNeuroVol` (and typed subclasses like `FloatNeuroVol`, `Int16NeuroVol`) | The default — every voxel stored in a typed array. |
| `SparseNeuroVol` | Mostly-empty volumes (masks, sparse activation maps). |
| `ClusteredNeuroVol` | Parcellations / atlases — voxels labeled by region. |
| `LogicalNeuroVol` | A computed/boolean view over another volume. |

```ts
import { FloatNeuroVol, NeuroSpace } from 'neuroimjs'

const space = new NeuroSpace([2, 2, 2])
const data = new Float32Array([0, 1, 2, 3, 4, 5, 6, 7])

// Note the argument order: (space, data)
const vol = new FloatNeuroVol(space, data)

vol.getAt(1, 0, 0)      // 1
vol.space               // the NeuroSpace above
```

::: tip Constructor order
Typed volume constructors take **`(space, data)`** — space first, then the typed array.
:::

## NeuroVec — 4D time-series

`NeuroVec` extends the idea to 4D: a stack of 3D volumes over time, the natural shape for fMRI. Typed variants (`Float32NeuroVec`, etc.) and enhanced variants with preprocessing live alongside it.

```ts
import { NeuroSpace, Float32NeuroVec } from 'neuroimjs'

// 10 time points of a 64 × 64 × 40 volume: spatial dims first, time last
const space = new NeuroSpace([64, 64, 40, 10], [3, 3, 4, 2])
const vec = new Float32NeuroVec(space, new Float32Array(64 * 64 * 40 * 10))

vec.dim                          // [64, 64, 40, 10]
vec.getSeries(32, 32, 20)        // the 10 values at voxel (32, 32, 20)
vec.getVolume(0)                 // the first 3D volume, a FloatNeuroVol
```

::: warning `readVec` uses a different, time-first shape
`readVec` returns a `BigNeuroVec` whose `dim` (and `space.dim`) is **`[T, X, Y, Z]`**, so `vec.space` does not describe the image grid. Its 3D geometry, including the affine, is on `vec.volumeSpace`, and `getSeries(i, j, k)` and `getVolume(t)` work as above. Details are in [Reading & Writing](/guide/io#_4d-time-series-readvec).
:::

`vec.length` is the total number of values (voxels × time points), not the number of time points; read the time-point count from `dim`.

Two other 4D containers take their data from you rather than from a file:

- **`FileBackedNeuroVec`** calls a function you supply, `(t) => Float32Array`, to fetch volume `t` on demand and keeps recently used volumes in an LRU cache (10 by default). It never opens files itself; the callback decides where data come from.
- **`MappedNeuroVec`** reads values through a `DataView` over an `ArrayBuffer` you supply (float32, float64, int16 or uint8, either byte order), without copying it. It is not a memory-mapped file.

::: tip
Temporal preprocessing (`detrend`, `temporalFilter`) lives on the *enhanced* vec classes (`EnhancedDenseNeuroVec`, `EnhancedFloat32NeuroVec`) and on `FileBackedNeuroVec`, and performs real per-voxel filtering.
:::

## NeuroHyperVec — 5D and beyond

`DenseNeuroHyperVec` (created with `createNeuroHyperVec`) adds named dimensions beyond time (subjects × conditions × …) for multi-dimensional designs. Indexing, `getSubVolume`, `reduce`, `concat`, `split`, `permute` and `view` are implemented; `glm`, `extractFeatures` and `save` throw "not yet implemented". The whole module is <span class="stability-badge experimental">experimental</span> ([stability](/guide/stability)).

## Display building blocks

Visualization composes three small pieces:

```
VolStack  ─ holds one or more ─►  VolLayer  ─ wraps ─►  NeuroVol + ColorMap + range
   │
   └─► fed into a viewer (SimpleOrthogonalViewer, SingleSliceViewer, …)
```

```ts
import { VolLayer, VolStack, ColorMapFactory } from 'neuroimjs'

const cmap = ColorMapFactory.createGrayscale({ range: [0, 1000] })
const layer = new VolLayer('t1', vol, cmap, [0, 1000])
const stack = new VolStack(layer)   // add more layers to overlay
```

See **[Colormaps & Layers](/guide/colormaps)** for overlays and thresholding, and **[Viewers](/guide/viewers)** to put a stack on screen.
