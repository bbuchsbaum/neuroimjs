# Spatial Processing & Resampling

neuroimjs ships filtering, morphology, and resampling that operate directly on typed-array volumes. Everything on this page is synchronous and returns a **new** volume (a `FloatNeuroVol` unless noted) — inputs are never modified.

These APIs are exported only from the main `neuroimjs` entry, not from `neuroimjs/browser`. They are plain TypeScript with no Node dependencies, so a browser bundle that imports the main entry can run them, but don't mix the two entries in one app ([Getting Started](/guide/getting-started#install)).

::: tip Units
Filter sizes on this page are in **voxels**, not mm: Gaussian sigma, median and morphology radii, bilateral window. Resampling targets (`resampleToVoxelSize`, a target `NeuroSpace`) are in mm. Searchlight and `sphericalROI` radii are in mm — see [ROIs](/guide/roi).
:::

## Spatial filtering

`SpatialFilter` is constructed **with** the volume; each method returns a filtered copy.

```ts
import { SpatialFilter } from 'neuroimjs'

const filter = new SpatialFilter(volume)

// Gaussian smoothing — sigma in VOXELS (scalar, or [sx, sy, sz])
const smoothed = filter.gaussianBlur(1.5)

// Bilateral — edge-preserving denoise. spatialSigma is in voxels,
// intensitySigma in data units; windowSize (voxels, default 5) bounds the kernel.
const denoised = filter.bilateralFilter({ spatialSigma: 1.5, intensitySigma: 50, windowSize: 5 })

// Guided filter (He et al.) — self-guided unless you pass `guide: otherVol`
const guided = filter.guidedFilter({ radius: 2, epsilon: 0.01 })

// Median, Perona–Malik diffusion (iterations, kappa, lambda ∈ [0, 0.25]), edges
const median   = filter.medianFilter(1)                 // 3×3×3 window
const diffused = filter.anisotropicDiffusion(10, 30, 0.15)
const edges    = filter.edgeDetection('sobel')          // 'sobel' | 'laplacian' | 'canny'
```

`gaussianBlur` ignores voxel spacing. To smooth by a physical FWHM, convert per axis:

```ts
const fwhmMm = 6
const sigmaVox = volume.space.spacing.map(
  (s) => fwhmMm / (2 * Math.sqrt(2 * Math.log(2)) * s),
) as [number, number, number]

const smoothed6mm = filter.gaussianBlur(sigmaVox)   // on 2×2×4 mm data: [1.274, 1.274, 0.637]
```

Notes on behaviour:

- `gaussianBlur` is separable (three 1-D passes). The kernel half-width is ⌈3·max σ⌉ voxels (at least 1) on **every** axis, so `[2, 2, 0.5]` still uses a 13-tap window along z. At the volume boundary the kernel is truncated and renormalised, so edges are not darkened — but total signal is not exactly conserved near the boundary.
- `edgeDetection('canny')` is not implemented: it logs a warning and returns the Sobel magnitude.
- `anisotropicDiffusion` throws if `lambda` is outside `[0, 0.25]`.

### Custom kernels

`spatialFilter` convolves with any `Kernel3D`. Built-ins: `Kernel3D.gaussian(sigma, size?)`, `box(size)`, `sphere(radius)`, `laplacian()`, `sobel('x' | 'y' | 'z')`, or `new Kernel3D(data)` from a `number[][][]`.

```ts
import { Kernel3D } from 'neuroimjs'

const boxed = filter.spatialFilter(Kernel3D.box(3))   // 3×3×3 mean filter
```

Kernels whose weights sum to ≈0 (Sobel, Laplacian) return the raw weighted sum; all others are normalised by the in-bounds weight, as with the Gaussian.

### Morphology

Grey-scale min/max morphology with a spherical structuring element; the radius is in voxels. Works on masks (`LogicalNeuroVol`) and continuous volumes alike, and returns a `FloatNeuroVol`.

```ts
const grown  = new SpatialFilter(mask).dilate(1)
const shrunk = new SpatialFilter(mask).erode(1)
const opened = new SpatialFilter(mask).open(1)    // erode → dilate: removes specks
const closed = new SpatialFilter(mask).close(1)   // dilate → erode: fills pinholes
```

`MorphOperation` (`'erode' | 'dilate' | 'open' | 'close'`) is exported as a type for code that selects an operation by name.

::: details Prototype helpers
`addSpatialFilteringToNeuroVol()` and `addResamplingToNeuroVol()` patch the dense-volume prototype so you can call `vol.gaussianBlur(…)`, `vol.medianFilter(…)`, `vol.erode(…)`, `vol.dilate(…)`, `vol.bilateralFilter(…)`, and `vol.resample(…)`, `vol.resampleToDimensions(…)`, `vol.resampleToVoxelSize(…)`, `vol.downsample(…)`, `vol.upsample(…)`. The added methods are **not** reflected in the TypeScript types, so you need a cast to call them. Prefer `SpatialFilter` / `Resampler` directly.
:::

## Resampling & interpolation

`Resampler` resamples a volume onto a new grid. Target voxels are mapped through world (mm) coordinates, so source and target may differ in dimensions, spacing, and origin.

```ts
import { Resampler, NeuroSpace } from 'neuroimjs'

const resampler = new Resampler(volume)

// Onto an explicit grid (here 1 mm isotropic, same origin)
const targetSpace = new NeuroSpace([40, 40, 40], [1, 1, 1], volume.space.origin)
const resampled = resampler.resample(targetSpace, {
  method: 'linear',      // 'nearest' | 'linear' | 'cubic' | 'lanczos' (default 'linear')
  backgroundValue: 0,    // value for target voxels that fall outside the source
})

// Convenience wrappers — all keep the source origin and axes
const iso2  = resampler.resampleToVoxelSize([2, 2, 2])     // new spacing (mm), dims chosen to keep the FOV
const sized = resampler.resampleToDimensions([10, 10, 5])  // new dims, spacing chosen to keep the FOV
const half  = resampler.downsample(2)                      // ⌊dim / 2⌋
const dbl   = resampler.upsample(2, { method: 'nearest' }) // dim × 2

// Sample at a continuous VOXEL coordinate (> ½ voxel outside the grid → 0)
const v = resampler.interpolateAt(2.5, 3.5, 1.5, 'cubic')
```

When the target has more than 1.5× fewer voxels along any axis, the source is Gaussian-smoothed first (`antiAlias`, default `true` for `resample` and every wrapper, including `downsample`; pass `antiAlias: false` to skip it). The smoothing happens before interpolation, whatever the `method`. For a `20×20×10` source at `2×2×4` mm, `resampleToVoxelSize([2, 2, 2])` gives dims `[20, 20, 20]`, and `downsample(2)` gives dims `[10, 10, 5]` at `[4, 4, 8]` mm.

| Method | Use |
|---|---|
| `nearest` | Labels / masks, but only with `antiAlias: false`. Otherwise a downsampling target blurs the labels before the lookup. For a `ClusteredNeuroVol`, use `resampleClustered` (below). |
| `linear` | General-purpose, fast. |
| `cubic` | Smoother continuous data (Catmull-Rom). |
| `lanczos` | Highest fidelity, slowest. |

Cubic and Lanczos boundary taps are linearly extrapolated, so linear ramps stay unbiased at the outermost voxels.

### Affine transforms in voxel space

`transform(options, resampleOptions?)` applies a rotation / scale / translation **in voxel coordinates** and resamples onto the same grid. Rotations are radians about `[x, y, z]`, applied about `center` (default `[0, 0, 0]`, the first voxel); `matrix` supplies a full 4×4 forward map instead.

```ts
// Shift content 2 voxels along i
const shifted = resampler.transform({ translation: [2, 0, 0] })

// Rotate 90° in-plane about the volume centre
const rotated = resampler.transform(
  { rotation: [0, 0, Math.PI / 2], center: [9.5, 9.5, 4.5] },
  { method: 'nearest' },
)
```

### Atlases and label volumes

`Resampler.resampleClustered` resamples a `ClusteredNeuroVol` with nearest-neighbour lookup and returns a `ClusteredNeuroVol` on the target grid, keeping only labels that survive:

```ts
const atlas1mm = Resampler.resampleClustered(atlas, targetSpace)
```

## Volume arithmetic

Elementwise operations take a volume and either another volume or a scalar, and return a new `FloatNeuroVol`; comparisons return a `LogicalNeuroVol`. Reductions (`sumVol`, `meanVol`, `minVol`, `maxVol`) return a **number** over all voxels.

```ts
import { addVol, subtractVol, divideVol, meanVol, mapVol, greaterThan } from 'neuroimjs'

const diff = subtractVol(post, pre)
const supra = greaterThan(statMap, 3.1)                        // LogicalNeuroVol
const avg  = divideVol(addVol(addVol(run1, run2), run3), 3)     // voxelwise mean of three runs

const mu = meanVol(statMap)                                     // scalar
const sd = Math.sqrt(meanVol(mapVol(statMap, (v) => (v - mu) ** 2)))
const z  = mapVol(statMap, (v) => (v - mu) / sd)
```

Also available: `multiplyVol`, `lessThan`, `equalTo(a, b, tolerance?)`, `negateVol`, `absVol`, `sqrtVol`, `sumVol`, `minVol`, `maxVol`. For a voxelwise mean (and SD, t, …) across many volumes, the [group statistics](/guide/group-stats) helpers are faster and NaN-aware.
