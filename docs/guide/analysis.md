# Statistics & Searchlight

neuroimjs includes analysis primitives for lightweight Node pipelines. Everything on this page is imported from the main `neuroimjs` entry. The searchlight functions are also exported from `neuroimjs/browser`; connected components, `StatFunctions`, partitioning and the 4D helpers are not. They are plain TypeScript, so a browser bundle that imports the main entry can run them, but don't mix the two entries in one app ([Getting Started](/guide/getting-started#install)). For region extraction see [ROIs](/guide/roi); for voxelwise group maps (mean, t, Welch, paired, consistency) see [Group Statistics](/guide/group-stats).

## Searchlight

A searchlight sweeps a sphere across the brain and hands you each neighbourhood as an `ROIVolWindow`. The radius is a **positional argument in mm**, spacing-aware per axis.

Each window carries **geometry, not data**: `.coords` (voxel `[i, j, k]` triples), `.indices()` (linear indices), `.centerIndex` / `.parentIndex` (the centre voxel within the window / within the volume). Its `.data` is filled with `1`s — read your values from the data volume yourself.

`searchlightIterator` returns `LazyList<ROIVolWindow> | ROIVolWindow[] | Promise<ROIVolWindow[]>` depending on options, so narrow the result before iterating:

```ts
import { searchlightIterator } from 'neuroimjs'

// eager + single-threaded → ROIVolWindow[]; nonzero → centres restricted to the mask
const result = searchlightIterator(mask, 4 /* mm */, { eager: true, nonzero: true })
if (!Array.isArray(result)) throw new Error('expected an eager, single-threaded result')

const data = dataVol.getData()
const scores = new Float32Array(dataVol.space.size)
for (const sphere of result) {
  const idx = sphere.indices().filter((i) => mask.getData()[i])   // keep in-mask voxels
  const local = idx.map((i) => data[i])
  scores[sphere.parentIndex] = local.reduce((a, b) => a + b, 0) / local.length
}
```

::: warning Spheres are not clipped to the mask
`nonzero: true` only restricts which voxels serve as **centres**. Sphere membership is purely geometric, so spheres near the mask edge include out-of-mask voxels — filter `indices()` against the mask as above. Without `nonzero`, every voxel in the volume becomes a centre.
:::

Return type by option:

| Options | Returns |
|---|---|
| default (`eager: false`) | `LazyList<ROIVolWindow>` — computed on access; iterable, `.get(i)`, `.length` |
| `eager: true` | `ROIVolWindow[]` |
| `eager: true, cores > 1` | `Promise<ROIVolWindow[]>` (Web Workers; falls back to sequential where `Worker` is unavailable) |

A lazy list caches each window once it has been computed, so a full pass ends up holding every sphere in memory.

```ts
import { LazyList } from 'neuroimjs'

const lazy = searchlightIterator(mask, 4, { nonzero: true })
if (lazy instanceof LazyList) {
  const first = lazy.get(0)
  for (const sphere of lazy) { /* … */ }
}
```

### Variants

```ts
import {
  searchlightCoords,
  randomSearchlight,
  clusteredSearchlight,
  bootstrapSearchlight,
} from 'neuroimjs'

// async → LazyList<Float32Array>; each entry is flat [i0, j0, k0, i1, j1, k1, …]
const coordSets = await searchlightCoords(mask, 4, { nonzero: true })

// Non-overlapping centres: pick a random centre, drop its sphere, repeat → ROIVolWindow[]
const tiles = randomSearchlight(mask, 4)

// One sphere per label (>0), centred on the label's centre of mass → ROIVolWindow[]
const perRegion = clusteredSearchlight(labelVol, 4)

// `iter` centres drawn with replacement from the mask (default radius 8, iter 100)
const boots = bootstrapSearchlight(mask, 4, 50)
```

`randomSearchlight` and `bootstrapSearchlight` draw a fresh seed on every call. Pass a seed (or your own generator) to make the centers reproducible:

```ts
const tiles = randomSearchlight(mask, 6, { seed: 42 })
const boot = bootstrapSearchlight(mask, 8, 200, { seed: 42 })
// or share one generator across calls: { rng: createRng(42) }
```


## Connected components

Label contiguous suprathreshold clusters, then tabulate them:

```ts
import { ConnectedComponents, clusterTable, localMaxima } from 'neuroimjs'

// (valueVolume, maskVolume, threshold, connectivity: 6 | 18 | 26)
const cc = ConnectedComponents.performConnectedComponents(statVol, mask, 3.1, 26)
cc.clusters      // Cluster[], largest first: { size, sumX, sumY, sumZ, maxValue, provisionalLabel, finalLabel }
cc.indexVolume   // Int16NeuroVol — each voxel labelled with its cluster id (1 = largest)
cc.sizeVolume    // Int16NeuroVol — each voxel labelled with its cluster's size

const table = clusterTable(cc, statVol)
const peaks = localMaxima(statVol, cc.indexVolume, 4 /* min voxel distance between peaks */)
```

For a single 3×3×3 blob with peak 5 at voxel `[5, 5, 5]` (2 mm grid, origin −20 mm), `clusterTable` returns:

```json
[{ "id": 1, "size": 27, "centerOfMass": [5, 5, 5], "centerOfMassWorld": [-10, -10, -10],
   "maxValue": 5, "maxLocation": [5, 5, 5], "meanValue": 4.037037037037037 }]
```

and `localMaxima` returns `[{ clusterId: 1, location: [5, 5, 5], value: 5 }]`.

Things to know:

- `Cluster` is not exported as a type. `sumX`/`sumY`/`sumZ` already hold the **centre of mass** in voxel coordinates (divided by `size`), despite their names. `finalLabel` is the cluster's id in `indexVolume` (1 = largest).
- **One-sided.** A voxel is included when `value >= threshold`. For negative clusters, run it on `negateVol(statVol)`.
- **`NaN` voxels inside the mask seed clusters.** The seed test is `value < threshold`, which is false for `NaN`, so an in-mask `NaN` voxel starts a cluster and pulls in any suprathreshold neighbours, and that cluster's `maxValue` is `NaN`. Drop non-finite voxels from the mask first.
- **Mask values must be exactly `1`.** Use a `LogicalNeuroVol`; a mask stored with any other non-zero value (e.g. 255) yields no clusters.
- `Connectivity` is exported as a **type only** — pass the literal `6`, `18` or `26`.
- `localMaxima` reports voxels strictly greater than all same-cluster 26-neighbours; `minDistance` (voxels) thins peaks greedily from the highest.
- Labels and sizes are stored as `Int16`, so a cluster larger than 32,767 voxels overflows `sizeVolume`.

## Reductions

`StatFunctions` holds six reductions over a `Float32Array`: `mean`, `sum`, `min`, `max`, `std`, `median`.

```ts
import { StatFunctions } from 'neuroimjs'

const values = new Float32Array([1, 2, NaN, 4, 10])

StatFunctions.mean(values)    // 4.25  (NaN skipped)
StatFunctions.std(values)     // 4.031128874149275  (NaN skipped, n − 1)
StatFunctions.min(values)     // 1
StatFunctions.max(values)     // 10
StatFunctions.sum(values)     // NaN — sum does not skip NaN
StatFunctions.median(values)  // don't rely on it: NaN breaks the sort, so the result is arbitrary
```

They are plain functions, so they plug directly into `splitReduce` below or your own searchlight loop.

## Partitioning & atlas reductions

```ts
import { partition, splitClusters, centroids, mapValues } from 'neuroimjs'

// Seeded k-means (k-means++ init) on voxel values → ClusteredNeuroVol, labels 1..k
const atlas = partition(statVol, 2)

// One ROIVol per label; .data holds dataVol's values at that label's voxels
const regions = splitClusters(dataVol, atlas)

// Centre of mass per label → Map<label, [i, j, k]> (voxel units; pass 'median' for the median)
const coms = centroids(atlas)

// Recode values via a lookup table (unlisted values pass through)
const recoded = mapValues(atlas.asDense(), new Map([[1, 100], [2, 200]]))
```

`partition(x, k, method = 'kmeans', mask?, seed = 1)` clusters non-zero voxels (or those in `mask`) on their scalar values only — it is a value-based segmentation, not a spatially contiguous parcellation. Given a 4D `NeuroVec`, `splitClusters` returns each voxel's time-series **mean**.

## 4D helpers

```ts
import { concat, series, scaleSeries, splitFill, splitScale, splitReduce, splitBlocks } from 'neuroimjs'

// Stack 3D volumes into a Float32NeuroVec [x, y, z, t]
const vec = concat(vols)

// Time-series at voxel coordinates → Float32Array[]
const ts = series(vec, [[0, 0, 0], [1, 0, 0]])

// Per-voxel normalisation: 'zscore' (default) | 'mean-center' | 'psc'
const z = scaleSeries(vec, 'zscore')

// Factor over volumes, e.g. run labels
const runs = new Int32Array([1, 1, 1, 2, 2, 2])
const byRun   = splitFill(vec, runs)                          // Map<level, NeuroVec>
const scaled  = splitScale(vec, runs)                         // centre + scale within each run
const reduced = splitReduce(vec, runs, StatFunctions.mean)    // one 3D volume — see note

// Split voxels (by linear index) into blocks → SparseNeuroVol[], one per block id, in first-seen order
const blocks = splitBlocks(dataVol, new Int32Array([0, 1, 2, 3]), new Int32Array([1, 1, 2, 2]))
```

::: warning `splitReduce` averages across levels
`splitReduce(x, fac, FUN)` applies `FUN` within each level and then **averages the per-level results** into a single 3D volume. For a voxel whose values are `0, 100, 200 | 300, 400, 500`, `StatFunctions.mean` yields `250` and `StatFunctions.max` yields `350` (the mean of 200 and 500) — not one volume per level. Use `splitFill` and reduce each level yourself if you need per-level maps. The output space is rebuilt from the vec's dims, spacing and origin only, so its axes and affine are dropped (as with `concat` below).
:::

::: warning `concat` keeps dims, spacing and origin only
`concat` rebuilds the 4D space from the first volume's dims, spacing and origin and drops its affine. For a radiological (x-flipped) input, voxel `[1, 0, 0]` maps to x = 88 mm in the source but x = 92 mm in `concat(...).getVolume(0)`. When geometry matters, use `createReviewVecFromVolumes` ([Group Statistics](/guide/group-stats)), which preserves the full space and validates that all inputs share it.
:::
