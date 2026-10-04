# Volumes & Slices

A `NeuroVol` is a 3D image on a `NeuroSpace`. All implementations share one interface: `getAt(i, j, k)`, `setAt(i, j, k, v)`, `get(linearIndex)`, `getData()`, `getRange()`, and `getSlice(...)` / `getSliceAt(...)` for 2D cuts. Code written against `NeuroVol` works with any of the storage strategies on this page.

| Class | Storage | Use for |
|---|---|---|
| `FloatNeuroVol`, `Float64NeuroVol`, `Int8NeuroVol`, `UInt8NeuroVol`, `Int16NeuroVol`, `UInt16NeuroVol`, `Int32NeuroVol` | One typed array (`DenseNeuroVol`) | Anatomicals, statistic maps — the default |
| `LogicalNeuroVol` | `Uint8Array` of 0/1 | Masks, thresholded maps |
| `SparseNeuroVol` | `Map` of non-default voxels | Peaks, spheres, small ROIs on a large grid |
| `ClusteredNeuroVol` | Mask + one integer label per in-mask voxel | Parcellations, cluster maps |

## Dense volumes

```ts
import { NeuroSpace, FloatNeuroVol, createNeuroVol } from 'neuroimjs'

const space = new NeuroSpace([4, 3, 2], [2, 2, 2], [-4, -3, -2])
const vol = new FloatNeuroVol(space) // zero-filled Float32Array(24)

vol.setAt(1, 2, 1, 5)
vol.getAt(1, 2, 1) // 5
space.gridToIndex([1, 2, 1]) // 21  (= 1 + 2*4 + 1*4*3, x fastest)
vol.get(21) // 5
vol.getData()[21] // 5 — the backing typed array, not a copy

const counts = createNeuroVol('int16', space) // Int16NeuroVol
counts.getData().constructor.name // 'Int16Array'
```

- The constructor order is **`(space, data?)`**. Passing a typed array adopts it without copying, and its length must equal the voxel count.
- The memory layout is x-fastest, as in NIfTI: `index = i + j·nx + k·nx·ny`.
- `getAt`/`setAt` throw a `RangeError` for out-of-bounds or non-integer indices.
- `setData(array)` copies new values into the existing buffer.
- `createNeuroVol(type, space, data?)` picks the class from a type string: `'float32'`, `'float64'`, `'int8'`, `'uint8'`, `'int16'` or `'int32'`.

::: warning `uint16` volumes
`createNeuroSlice` has no `'uint16'` case, so `getSlice()` on a `UInt16NeuroVol` throws `Unsupported TypedArray type: uint16`. A `UInt16NeuroVol` therefore cannot be displayed or sliced. Both `readVol` and `readNiftiArrayBuffer` load an unscaled `UINT16` NIfTI file as a `UInt16NeuroVol`. An unscaled `UINT32` file throws in `readVol` (`Unsupported TypedArray type: uint32`) and is promoted to `Float64NeuroVol` by `readNiftiArrayBuffer`. Convert a `UInt16NeuroVol` before slicing or display: `new FloatNeuroVol(vol.space, Float32Array.from(vol.getData()))`.
:::

## Masks: `LogicalNeuroVol`

```ts
import { NeuroSpace, FloatNeuroVol, LogicalNeuroVol } from 'neuroimjs'

const space = new NeuroSpace([4, 4, 1])
const tmap = new FloatNeuroVol(space, Float32Array.from({ length: 16 }, (_, i) => i - 8))

const pos = LogicalNeuroVol.fromThreshold(tmap, 2.5, 'gt') // t > 2.5
const neg = LogicalNeuroVol.fromThreshold(tmap, -2.5, 'lt') // t < -2.5

pos.count() // 5
pos.getTrueIndices() // [11, 12, 13, 14, 15]
pos.getTrueCoords()[0] // [3, 2, 0]
pos.or(neg).count() // 11
pos.not().count() // 11

// Or build one directly from linear indices:
const roi = new LogicalNeuroVol(space, undefined, [0, 1, 4, 5])
roi.getBoolAt(1, 1, 0) // true
```

The comparison operators for `fromThreshold` are `'gt'`, `'lt'`, `'gte'`, `'lte'`, `'eq'` and `'neq'`. `and`, `or` and `xor` require both masks to be on the same space. A `LogicalNeuroVol` is a `DenseNeuroVol`, so it can be displayed and sliced like any other volume.

## Sparse volumes: `SparseNeuroVol`

Only non-default voxels are stored. The static factories cover the common cases:

```ts
import { NeuroSpace, SparseNeuroVol, FloatNeuroVol } from 'neuroimjs'

const space = new NeuroSpace([64, 64, 40], [3, 3, 3])

// A 2-voxel-radius sphere of 1s around grid point [32, 32, 20]:
const sphere = SparseNeuroVol.fromSphere(space, [32, 32, 20], 2)
sphere.nonDefaultCount // 33 stored voxels
sphere.sparsityRatio // ≈ 0.0002
sphere.getAt(32, 32, 20) // 1
sphere.getAt(0, 0, 0) // 0  (the default value)

// Explicit voxels and values:
const peaks = SparseNeuroVol.fromCoords(space, [[10, 10, 10], [50, 20, 30]], [4.2, -3.1])
peaks.getAt(50, 20, 30) // -3.1

// Densify when a consumer needs a full array:
const dense = new FloatNeuroVol(space, sphere.getData() as Float32Array)
dense.getRange() // [0, 1]
```

- `fromSphere` takes a center and a radius in **voxel** units. For a radius in mm on anisotropic grids, use `sphericalROI` ([ROIs](/guide/roi)).
- `fromMask(mask, fillValue)` and `fromDense(vol, threshold)` convert existing volumes.
- `fromPoint(space, [i, j, k], value)` creates a single voxel.
- `getData()` builds a new dense array on every call. Call it once and keep the result.

## Parcellations: `ClusteredNeuroVol` and `NeuroAtlas`

A clustered volume pairs a mask with **one integer label per true mask voxel**. The labels are given in increasing linear-index order. An optional `labelMap` names the labels.

```ts
import { NeuroSpace, FloatNeuroVol, LogicalNeuroVol, clusteredNeuroVol, NeuroAtlas } from 'neuroimjs'

const space = new NeuroSpace([4, 4, 1], [2, 2, 2])

// Mask: rows j = 0..1 of a 4×4 slab (linear indices 0–7).
const mask = new LogicalNeuroVol(space, undefined, [0, 1, 2, 3, 4, 5, 6, 7])
// One label per true mask voxel, in increasing linear-index order: i < 2 → 1, i ≥ 2 → 2.
const labels = [1, 1, 2, 2, 1, 1, 2, 2]
const parc = clusteredNeuroVol(mask, labels, { left: 1, right: 2 })

parc.numClusters() // 2
parc.clusterSizes() // Map { 1 => 4, 2 => 4 }
parc.getAt(3, 1, 0) // 2   (0 outside the mask)
parc.getClusterInfo('right') // { id: 2, label: 'right', size: 4, indices: [2, 3, 6, 7], center: [2.5, 0.5, 0] }

// Pull one region's values out of a co-registered volume:
const beta = new FloatNeuroVol(space, Float32Array.from({ length: 16 }, (_, i) => i))
parc.getClusterData(beta, 'left') // Float32Array [0, 1, 4, 5]
parc.getClusterMask(2).count() // 4

// Wrap it as an atlas to attach region metadata:
const atlas = new NeuroAtlas(parc, {
  name: 'toy',
  labels: ['left', 'right'],
  ids: [1, 2],
  cmap: [[230, 25, 75], [60, 180, 75]],
})
const roi = atlas.getROI({ label: 'right' })
roi?.coords.length // 4
```

- Regions can be looked up by numeric id or by label name.
- `getClusterInfo(...).center` is the centroid in grid coordinates.
- `getClusterId(coord)` and `getClusterLabel(coord)` take a **world** coordinate in mm, and it must land exactly on a voxel centre. Any other point throws a `RangeError` (`Volume index … is out of bounds`). Snap arbitrary points first: `parc.getClusterId(space.gridToCoord(space.coordToGrid(p).map(Math.round)))`. Points outside the mask return `undefined`.
- `atlas.getROI()` returns an `ROIVol` ([ROIs](/guide/roi)).
- `NeuroAtlas` also has `mergeAtlases(other)`, plus network loaders (`loadAtlas`, `loadGlasserAtlas`, `loadSchaeferAtlas`) that download from remote URLs.

::: tip Bulk access to a clustered volume
`getAt()` and `get()` on a `ClusteredNeuroVol` search the mask's index list on every call. That is fine for a few lookups but slow in a loop over every voxel. For bulk work, call `getData()` once: it returns a dense `Int32Array` of labels, 0 outside the mask. You can also wrap it with `asDense()`.
:::

## Checking that volumes share a grid

Overlays, masks and arithmetic assume both volumes occupy the **same voxel grid**. `assertSameVolumeGeometry` compares dimensions, axes, spacing, origin and the full affine, and throws on the first mismatch. It never resamples.

```ts
import { NeuroSpace, FloatNeuroVol, getVolumeGeometry, assertSameVolumeGeometry } from 'neuroimjs'

const t1 = new FloatNeuroVol(new NeuroSpace([91, 109, 91], [2, 2, 2], [-90, -126, -72]))
const stat = new FloatNeuroVol(new NeuroSpace([91, 109, 91], [2, 2, 2], [-90, -126, -72]))
const epi = new FloatNeuroVol(new NeuroSpace([64, 64, 36], [3, 3, 4], [-96, -132, -72]))

const g = getVolumeGeometry(t1)
g.dimensions // [91, 109, 91]
g.orientation // 'RAS'  (direction of increasing i, j, k)
JSON.stringify(g) // plain data: safe to log, postMessage or persist

assertSameVolumeGeometry(t1, stat) // passes silently
try {
  assertSameVolumeGeometry(t1, epi)
} catch (e) {
  console.log((e as Error).message)
  // Volume geometry mismatch in dimensions: expected 91x109x91, got 64x64x36
}
```

The optional third argument sets the numeric tolerance (default `1e-6`). If the grids differ, resample one volume onto the other first ([Spatial & Resampling](/guide/processing)).

## 2D slices

A `NeuroSlice` is a 2D image on a 2D `NeuroSpace`. Pixels are row-major: `getAt(i, j)` reads `data[j * nx + i]`. There are two ways to cut one out of a volume:

```ts
import { NeuroSpace, FloatNeuroVol, AxisSet3D, extractOrthogonalSlices, extractAxialSlice } from 'neuroimjs'

// value = i + 10*j + 100*k makes it easy to see which voxel lands where
const space = new NeuroSpace([4, 5, 6], [2, 2, 2], [-4, -5, -6])
const data = new Float32Array(4 * 5 * 6)
for (let k = 0; k < 6; k++)
  for (let j = 0; j < 5; j++)
    for (let i = 0; i < 4; i++) data[i + 4 * j + 20 * k] = i + 10 * j + 100 * k
const vol = new FloatNeuroVol(space, data)

// By grid index along the pinned axis:
const ax = vol.getSlice(3, AxisSet3D.AXIAL_LPI)
ax.dim // [4, 5]
ax.getAt(2, 1) // 312  → voxel (2, 1, 3)

// By world coordinate (mm): one call, up to three planes.
const world = space.gridToCoord([2, 1, 3]) // [0, -3, 0]
const { axial, coronal, sagittal } = extractOrthogonalSlices(vol, world)
axial.getAt(2, 1) // 312
coronal.dim // [4, 6]  (x by z)
sagittal.dim // [5, 6] (y by z)
sagittal.getAt(1, 3) // 332 → voxel (2, 3, 3): the slice's x axis is volume j, running anterior → posterior
coronal.getColumn(2) // values along z at x = 2, y = 1: [12, 112, 212, …]
extractAxialSlice(vol, world).getRow(1) // [310, 311, 312, 313]
```

- `getSlice(index, axes)` takes a grid index along the axis that `axes` pins (its third axis).
- `extract{Axial,Coronal,Sagittal}Slice(vol, worldPoint)` and `extractOrthogonalSlices(vol, worldPoint, types?)` convert a world point to the nearest grid plane first. `extractOrthogonalSlices` throws if the point lies outside the volume.
- The in-plane axis order and direction come from the `AxisSet3D` preset:

  | Preset | In-plane axes (x × y) |
  |---|---|
  | `AXIAL_LPI` | `LEFT_RIGHT` × `POST_ANT` |
  | `CORONAL_LIP` | `LEFT_RIGHT` × `INF_SUP` |
  | `SAGITTAL_AIL` | `ANT_POST` × `INF_SUP` |

  Each name gives the direction of increasing index, so `ANT_POST` means index 0 is the most anterior voxel.
- `getSliceAt(worldCoord, axes, 'nearest' | 'trilinear')` samples a plane through an arbitrary world point, with interpolation.

Slices are copies, so writing into one does not modify the volume. To build a slice from your own data, use `createNeuroSlice`:

```ts
import { NeuroSpace, createNeuroSlice } from 'neuroimjs'

const img = createNeuroSlice('float32', new NeuroSpace([3, 2], [1, 1]), new Float32Array([0, 1, 2, 3, 4, 5]))
img.getAt(2, 1) // 5   (row-major: index = j * nx + i)
img.getRow(0) // Float32Array [0, 1, 2]
```

### Low level: `VoxelIterator`

`getSlice` is built on `VoxelIterator`. Given a source volume, a reoriented output space and a plane index in that output space, the iterator yields each output pixel together with the source voxel it maps to. Use it to write a custom resampler or renderer that has to respect axis flips:

```ts
import { NeuroSpace, FloatNeuroVol, AxisSet3D, VoxelIterator } from 'neuroimjs'

const vol = new FloatNeuroVol(new NeuroSpace([4, 5, 6]))
const sagittal = vol.space.reorient(AxisSet3D.SAGITTAL_AIL) // grid [5, 6, 4]

const first: string[] = []
for (const v of new VoxelIterator(vol, sagittal, 2)) {
  if (first.length < 3) first.push(`${v.outputIndex3D} ← ${v.sourceIndex3D}`)
}
first
// [ '0,0,2 ← 2,4,0', '1,0,2 ← 2,3,0', '2,0,2 ← 2,2,0' ]
```

Each `VoxelItResult` also carries `inBounds`.

## See also

- **[Coordinate Systems](/guide/coordinate-systems)**: grid, world and screen coordinates.
- **[Time Series](/guide/time-series)**: 4D and 5D containers.
- **[Spatial & Resampling](/guide/processing)**: filtering, morphology and moving data between grids.
