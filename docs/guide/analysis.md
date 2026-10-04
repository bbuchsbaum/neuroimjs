# Statistics & Searchlight

neuroimjs includes analysis primitives that run anywhere JavaScript does — useful for in-browser exploration or lightweight Node pipelines.

## Searchlight

A searchlight sweeps a small neighborhood (a sphere) across the brain, handing you the voxels in each neighborhood as an ROI to analyze. The radius is a **positional argument in mm**, and each item is an `ROIVolWindow` whose `.coords` lists the voxel coordinates in the sphere.

```ts
import { searchlightIterator, type ROIVolWindow } from 'neuroimjs'

// Eager mode returns ROIVolWindow[]; nonzero limits centers to in-mask voxels.
const searchlights = searchlightIterator(mask, 6 /* mm */, { eager: true, nonzero: true }) as ROIVolWindow[]

for (const sphere of searchlights) {
  // sphere.coords — voxel coordinates [i, j, k] inside the sphere
  const values = sphere.coords.map(([i, j, k]) => dataVol.getAt(i, j, k))
  const score = analyze(values)
}
```

The searchlight is built on the mask, so `sphere.data` holds a constant fill value (1) per voxel, not your data: read the data volume at `sphere.coords` as above. `nonzero` restricts the sphere *centres* to the mask; a sphere near the mask edge can include voxels outside it.

The return type is a union because the mode decides it: without `eager` you get a lazy list (`LazyList`, iterable, materialized on demand), with `eager: true` an array, and with `eager: true` plus `cores > 1` a promise of an array computed in Web Workers.

Variants for different sampling strategies:

```ts
import {
  searchlightCoords,     // yields coordinate sets
  randomSearchlight,     // randomized centers
  clusteredSearchlight,  // cluster-constrained
  bootstrapSearchlight,  // bootstrap resampling
} from 'neuroimjs'
```

`randomSearchlight` and `bootstrapSearchlight` draw a fresh seed on every call. Pass a seed (or your own generator) to make the centers reproducible:

```ts
const tiles = randomSearchlight(mask, 6, { seed: 42 })
const boot = bootstrapSearchlight(mask, 8, 200, { seed: 42 })
// or share one generator across calls: { rng: createRng(42) }
```

::: tip Radius units
The radius is interpreted in **millimeters** and is spacing-aware per axis, so it behaves correctly on anisotropic volumes — not just isotropic 1 mm data.
:::

## Connected components

Label contiguous clusters in a thresholded map, then tabulate them:

```ts
import { ConnectedComponents, clusterTable, localMaxima } from 'neuroimjs'

// Static entry point: (valueVolume, maskVolume, threshold, connectivity)
const result = ConnectedComponents.performConnectedComponents(statVol, mask, 3.1, 26)

result.clusters      // one entry per cluster: label, size, peak value
result.indexVolume   // each voxel labeled with its cluster id
result.sizeVolume    // each voxel labeled with its cluster's size

// Tabulate: id, size, centre of mass (voxel and world), peak value and location, mean
const table = clusterTable(result, statVol)

// Peaks within each cluster, at least minDistance voxels apart
const peaks = localMaxima(statVol, result.indexVolume, 2)
```

The BFS labeling is <span class="stability-badge stable">stable</span>.

## Statistics

`StatFunctions` provides numerically careful reductions (two-pass variance, Bessel correction) over a `Float32Array` of values:

```ts
import { StatFunctions } from 'neuroimjs'

StatFunctions.mean(values)    // NaN-skipping
StatFunctions.std(values)
StatFunctions.median(values)
StatFunctions.min(values)
StatFunctions.max(values)
StatFunctions.sum(values)
```

## Partitioning & reductions

Parcellate a volume and group voxels by label — handy for atlas-based analyses:

```ts
import { partition, splitClusters, centroids } from 'neuroimjs'

// k-means parcellation of a volume into k clusters → ClusteredNeuroVol
const atlas = partition(statVol, 20)

// Group a volume's voxels by an atlas's labels → ROIVol[] (one per region)
const regions = splitClusters(dataVol, atlas)

// Center-of-mass per labeled region → Map<label, [x, y, z]>
const coms = centroids(atlas)
```

## ROIs

Create regions of interest geometrically or from masks, then read or summarize the data they cover:

```ts
import { sphericalROI, cuboidROI, roiFromMask } from 'neuroimjs'

// (volume, centroid in voxel coords, radius in mm)
const roi = sphericalROI(volume, [40, 50, 30], 8)

roi.coords   // number[][] — voxel coordinates inside the ROI
roi.data     // a fill value per voxel (default 1), not the volume's values
const values = roi.coords.map(([i, j, k]) => volume.getAt(i, j, k))
```

`sphericalROI(vol, centroid, radius, fill = 1, nonzero = false)` uses `vol` only for its grid, plus, with `nonzero: true`, to drop voxels where `vol` is 0.

::: info
`sphericalROI` uses the same mm-based, spacing-aware radius as the searchlight.
:::
