# Regions of Interest

An ROI in neuroimjs is a set of voxel coordinates tied to a `NeuroSpace`, optionally with one value (or one vector) per voxel. The factories build the **geometry**; you then read values from whichever volume or time-series you care about.

## The ROI classes

| Class | Holds | Typical source |
|---|---|---|
| `ROI` | Abstract base: `space`, `coords`, `length`, `indices()` | — |
| `ROICoords` | Coordinates only | `roiFromCoords(space, coords)` |
| `ROIVol` | Coordinates + one value per voxel (`.data`, a typed array) | `roiFromMask`, `roiFromIndices`, `splitClusters` |
| `ROIVolWindow` | `ROIVol` + a centre voxel (`centerIndex`, `parentIndex`) | `sphericalROI`, `cuboidROI`, `squareROI`, searchlights |
| `ROIVec` | Coordinates + one row vector per voxel (`.data`, an `ml-matrix` `Matrix`) | built from a `NeuroVec` |
| `ROIVecWindow` | `ROIVec` + a centre voxel | built from a `NeuroVec` |

Every ROI has `coords` (`number[][]` of voxel `[i, j, k]`), `length`, `indices()` (linear indices into the volume), `realCoords()` (world mm), and `centroid()` (world mm).

## Building ROIs

The factories below come from the main `neuroimjs` entry. `neuroimjs/browser` exports the `ROICoords`, `ROIVol` and `ROIVec` classes but none of the factories.

```ts
import {
  sphericalROI, cuboidROI, squareROI,
  roiFromMask, roiFromIndices, roiFromCoords, greaterThan,
} from 'neuroimjs'

// Sphere: (volume, centre in voxel coords, radius in mm)
const sphere = sphericalROI(volume, [10, 10, 5], 4)
// Same sphere, keeping only voxels where `volume` is non-zero (fill = 1, nonzero = true)
const inBrain = sphericalROI(volume, [10, 10, 5], 4, 1, true)

// Box: half-width in voxels per axis → (2·2+1) × (2·2+1) × (2·1+1) = 75 voxels
const box = cuboidROI(volume, [10, 10, 5], [2, 2, 1])

// In-plane square (5×5) at fixed k; fixDim: 0 = i, 1 = j, 2 = k (default)
const square = squareROI(volume, [10, 10, 5], 2)

// From a mask, linear indices, or explicit coordinates
const fromMask = roiFromMask(greaterThan(volume, 3000))        // ROIVol over the true voxels
const fromIdx  = roiFromIndices(volume.space, [0, 1, 2])        // ROIVol
const fromXYZ  = roiFromCoords(volume.space, [[1, 2, 3], [4, 5, 6]])               // ROICoords
const withData = roiFromCoords(volume.space, [[1, 2, 3], [4, 5, 6]], [0.5, 0.7])   // ROIVol
```

The sphere radius is in **millimetres** and is applied per axis using the voxel spacing, so on anisotropic data the sphere covers fewer voxels along the coarse axis. On a `2 × 2 × 4` mm grid, `sphericalROI(volume, [10, 10, 5], 4)` contains 15 voxels: two voxels either side in-plane, one slice above and below. `cuboidROI` and `squareROI` sizes are in **voxels**. All three clip at the volume boundary. Their full signatures are `sphericalROI(vol, centre, radius, fill = 1, nonzero = false)`, `cuboidROI(vol, centre, surround, fill = 1, nonzero = false)` and `squareROI(vol, centre, surround, fixDim = 2, fill = 1, nonzero = false)`. The trailing `nonzero` flag drops voxels where the passed volume is zero, so pass the earlier arguments explicitly to reach it: `sphericalROI(volume, [10, 10, 5], 4, 1, true)`.

`roiFromCoords` returns `ROIVol | ROICoords`; narrow with `instanceof ROIVol` before reading `.data`.

## Extracting values

::: warning `.data` is a fill value, not your data
`sphericalROI`, `cuboidROI`, `squareROI`, `roiFromMask` and `roiFromIndices` fill `.data` with a constant (`fill`, default `1`). The volume you pass to the geometric factories supplies only the grid (and the `nonzero` test). Read values explicitly:
:::

```ts
import { ROIVol } from 'neuroimjs'

// Via linear indices (fast, works for any dense volume)
const flat = volume.getData()
const vals = sphere.indices().map((i) => flat[i])

// …or via coordinates
const same = sphere.coords.map(([i, j, k]) => volume.getAt(i, j, k))

// Wrap them as an ROIVol to keep coordinates and values together
const sampled = new ROIVol(Float32Array.from(vals), sphere.space, sphere.coords)

sampled.getAt(10, 10, 5)   // value at that voxel (0 if the voxel is outside the ROI)
sampled.get(0)             // value of the ROI's first voxel
const mean = Array.from(sampled.data).reduce((a, b) => a + b, 0) / sampled.length
```

The same pattern pulls values from any volume on the same grid: a statistic map, a mask, a second subject.

Further operations on value-bearing ROIs:

```ts
const strong  = sampled.getSubset(Array.from(sampled.data, (v) => v > 2010))  // boolean mask or index list
const asVol   = sampled.asSparse()        // SparseNeuroVol: ROI values, 0 elsewhere
const worldMm = sphere.centroid()         // [x, y, z] in world mm
```

## Time-series ROIs

For a 4D `NeuroVec`, collect one time-series per voxel into an `ROIVec` (rows = voxels, columns = time points):

```ts
import { ROIVec, ROIVecWindow } from 'neuroimjs'

const rows = sphere.coords.map(([i, j, k]) => vec.getSeries(i, j, k))
const roiVec = new ROIVec(rows, sphere.space, sphere.coords)

roiVec.ncol             // number of time points
roiVec.getVector(0)     // time-series of the first voxel
roiVec.getColumn(1)     // all voxels at t = 1

// Keep track of the centre voxel, e.g. for searchlight-style analyses
const win = new ROIVecWindow(sphere.space, sphere.coords, rows, sphere.centerIndex)
win.getVector(win.centerIndex)   // the centre voxel's time-series
```

`series(vec, coords)` returns the same rows as `Float32Array`s without building an ROI. It is typed to take `[number, number, number][]`, while `ROI.coords` is `number[][]`, so convert first: `series(vec, sphere.coords.map(([i, j, k]) => [i, j, k] as [number, number, number]))`. To summarise many atlas regions at once, `splitClusters(dataVol, atlas)` returns one value-bearing `ROIVol` per label (see [Statistics & Searchlight](/guide/analysis#partitioning-atlas-reductions)).

## Errors you may hit

- `sphericalROI` throws `Centroid must lie within the volume bounds` for an out-of-grid centre, and `No voxels found within the specified sphere` when `nonzero` excludes everything.
- `cuboidROI` / `squareROI` throw if the centre voxel itself is excluded by `nonzero`.
- `roiFromMask` throws `Mask contains no true voxels` for an empty mask, e.g. a threshold that nothing passes.
- `ROIVol` / `ROIVec` constructors throw when the number of values (rows) does not match the number of coordinates.
