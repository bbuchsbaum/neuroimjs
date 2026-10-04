# Spatial Processing & Resampling

neuroimjs ships filtering, morphology, and resampling that operate directly on typed-array volumes.

::: info Node entry
`SpatialFilter`, `Resampler`, the volume arithmetic functions and the slice extractors are exported from `neuroimjs`, not from `neuroimjs/browser`. The [Stability matrix](/guide/stability) gives the status of each.
:::

## Spatial filtering

`SpatialFilter` provides smoothing and edge-preserving filters.

A `SpatialFilter` is constructed **with** the volume; its methods are synchronous and return new volumes.

```ts
import { SpatialFilter } from 'neuroimjs'

const filter = new SpatialFilter(volume)

// Gaussian smoothing — sigma in voxels (scalar, or [sx, sy, sz] per axis)
const smoothed = filter.gaussianBlur(2.0)

// Bilateral — edge-preserving denoise (spatialSigma in voxels,
// intensitySigma in the volume's intensity units)
const denoised = filter.bilateralFilter({ spatialSigma: 2.0, intensitySigma: 50 })

// Guided filter (He et al.) — structure-aware smoothing
const guided = filter.guidedFilter({ radius: 2, epsilon: 0.01 })
```

The Gaussian kernel's sigma is in voxels, not millimetres: on anisotropic data pass `[sx, sy, sz]`, for example `mmSigma / spacing[i]` per axis. The blur runs as three 1D passes, which gives the same result as the full 3D kernel at a fraction of the cost. The bilateral and guided filters follow their published formulations. `SpatialFilter` also has `medianFilter(radius)`, `open`/`close`, `anisotropicDiffusion(iterations, kappa, lambda)` and `edgeDetection('sobel' | 'laplacian')`; `'canny'` falls back to Sobel with a warning.

### Morphology

```ts
// radius in voxels
const grown  = new SpatialFilter(mask).dilate(1)
const shrunk = new SpatialFilter(mask).erode(1)
```

`addSpatialFilteringToNeuroVol()` patches `gaussianBlur`, `bilateralFilter`, `medianFilter`, `erode` and `dilate` onto the dense volume prototype, so you can call `vol.gaussianBlur(2)` directly. TypeScript does not know about the patched methods, so most code is clearer with an explicit `new SpatialFilter(vol)`.

## Resampling & interpolation

`Resampler` resamples a volume onto a new grid with selectable interpolation.

```ts
import { Resampler } from 'neuroimjs'

const resampler = new Resampler(volume)

const resampled = resampler.resample(targetSpace, {
  method: 'linear',   // 'nearest' | 'linear' | 'cubic' | 'lanczos'
})
```

Interpolation methods:

| Method | Use |
|---|---|
| `nearest` | Labels / masks (no value mixing). |
| `linear` | General-purpose, fast. |
| `cubic` | Smoother continuous data (Catmull-Rom). |
| `lanczos` | Highest fidelity, slowest. |

`resampleToDimensions(dim)`, `resampleToVoxelSize([sx, sy, sz])`, `downsample(factor)` and `upsample(factor)` are shortcuts for common target grids, and `transform()` applies an arbitrary affine. `nearest`, `linear`, `cubic`, and `lanczos` interpolation are covered by tests; cubic/Lanczos boundary taps are linearly extrapolated so linear ramps remain unbiased at the outermost voxels. See [stability](/guide/stability).

## Volume arithmetic

Elementwise operations return new volumes:

```ts
import { addVol, subtractVol, divideVol, greaterThan, mapVol, meanVol } from 'neuroimjs'

const diff = subtractVol(post, pre)
const mask = greaterThan(statMap, 3.1)          // LogicalNeuroVol
const avg = divideVol(addVol(addVol(run1, run2), run3), 3)
const mu = meanVol(statMap)                     // a number: the mean voxel value
const z = mapVol(statMap, (v) => (v - mu) / sd)
```

The binary operations take a volume or a number as the second argument. `sumVol`, `meanVol`, `minVol` and `maxVol` reduce a volume to a single number; `negateVol`, `absVol` and `sqrtVol` are elementwise.

## Extracting 2D slices

`extractOrthogonalSlices` cuts axial, sagittal and coronal slices through a world coordinate (mm) and returns `NeuroSlice` objects, each with its own 2D space and data:

```ts
import { extractOrthogonalSlices, extractAxialSlice } from 'neuroimjs'

const { axial, sagittal, coronal } = extractOrthogonalSlices(vol, [0, -18, 20])
axial.space.dim          // the two in-plane dimensions, e.g. [x, y]

// Only some planes, or one at a time
const some = extractOrthogonalSlices(vol, [0, -18, 20], ['axial', 'sagittal'])
const one = extractAxialSlice(vol, [0, -18, 20])
```

The point is converted to a voxel index with the volume's affine; a point outside the volume throws. `getSliceOrientation(vol, 'axial')` and `getWorldBoundsForSlice(vol, 'axial', index)` describe a slice's orientation and extent.
