# Spatial Processing & Resampling

neuroimjs ships filtering, morphology, and resampling that operate directly on typed-array volumes.

::: tip One caveat to know
Most processing paths are <span class="stability-badge stable">stable</span>. Earlier docs warned about a cubic/Lanczos boundary bias, but that regression is fixed and covered by edge tests. The [Stability matrix](/guide/stability) is authoritative.
:::

## Spatial filtering

`SpatialFilter` provides smoothing and edge-preserving filters.

A `SpatialFilter` is constructed **with** the volume; its methods are synchronous and return new volumes.

```ts
import { SpatialFilter } from 'neuroimjs'

const filter = new SpatialFilter(volume)

// Gaussian smoothing — sigma in mm (scalar, or [sx, sy, sz])
const smoothed = filter.gaussianBlur(2.0)

// Bilateral — edge-preserving denoise
const denoised = filter.bilateralFilter({ sigmaSpace: 2.0, sigmaIntensity: 0.1 })

// Guided filter (He et al.) — structure-aware smoothing
const guided = filter.guidedFilter({ radius: 2, epsilon: 0.01 })
```

The bilateral and guided filters are numerically faithful to their published formulations. Gaussian blur is correct; a separable performance optimization is planned.

### Morphology

```ts
// radius in voxels
const grown  = new SpatialFilter(mask).dilate(1)
const shrunk = new SpatialFilter(mask).erode(1)
```

You can also mix filtering into a volume via the helper:

```ts
import { addSpatialFilteringToNeuroVol } from 'neuroimjs'
```

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

`Resampler.transform()` (applying an arbitrary affine) is implemented. `nearest`, `linear`, `cubic`, and `lanczos` interpolation are covered by tests; cubic/Lanczos boundary taps are linearly extrapolated so linear ramps remain unbiased at the outermost voxels. See [stability](/guide/stability).

## Volume arithmetic

Elementwise operations return new volumes:

```ts
import { addVol, subtractVol, meanVol, mapVol, greaterThan } from 'neuroimjs'

const diff = subtractVol(post, pre)
const mask = greaterThan(statMap, 3.1)         // threshold
const avg = meanVol([run1, run2, run3])
const z = mapVol(statMap, (v) => (v - mu) / sd)
```

These are <span class="stability-badge stable">stable</span> and a convenient way to build derived maps before display.
