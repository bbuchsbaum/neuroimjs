# Statistics & Searchlight

neuroimjs includes analysis primitives that run anywhere JavaScript does — useful for in-browser exploration or lightweight Node pipelines.

## Searchlight

A searchlight sweeps a small neighborhood (a sphere) across the brain, handing you the voxels in each neighborhood as an ROI to analyze. The radius is a **positional argument in mm**, and each item is an `ROIVolWindow` with `.coords` and `.data`.

```ts
import { searchlightIterator } from 'neuroimjs'

// Eager mode returns ROIVolWindow[]; nonzero limits centers to in-mask voxels.
const searchlights = searchlightIterator(mask, 6 /* mm */, { eager: true, nonzero: true })

for (const sphere of searchlights) {
  // sphere.coords — voxel coordinates inside the sphere (number[][])
  // sphere.data   — values at those coordinates
  const score = analyze(sphere.data)
}
```

Omit `eager` for a lazy list when you don't need every searchlight materialized at once.

Variants for different sampling strategies:

```ts
import {
  searchlightCoords,     // yields coordinate sets
  randomSearchlight,     // randomized centers
  clusteredSearchlight,  // cluster-constrained
  bootstrapSearchlight,  // bootstrap resampling
} from 'neuroimjs'
```

::: tip Radius units
The radius is interpreted in **millimeters** and is spacing-aware per axis, so it behaves correctly on anisotropic volumes — not just isotropic 1 mm data.
:::

## Connected components

Label contiguous clusters in a thresholded map, then tabulate them:

```ts
import { ConnectedComponents } from 'neuroimjs'

// Static entry point: (valueVolume, maskVolume, threshold, connectivity)
const { clusterTable, indexVolume, sizeVolume } =
  ConnectedComponents.performConnectedComponents(statVol, mask, 3.1, 26)

// clusterTable — size / peak / centroid per cluster
// indexVolume  — each voxel labeled with its cluster id
// sizeVolume   — each voxel labeled with its cluster's size
```

`clusterTable` and `localMaxima` are also exported as standalone helpers. The BFS labeling here is <span class="stability-badge stable">stable</span> and correct.

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
roi.data     // values at those coordinates
```

::: info
`sphericalROI` uses the same mm-based, spacing-aware radius as the searchlight. (There are currently a few overlapping ROI types; they're slated for [consolidation](/guide/stability), but the APIs above are stable.)
:::
