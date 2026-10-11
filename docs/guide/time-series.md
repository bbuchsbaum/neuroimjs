# Time Series (4D) & Hypervectors (5D+)

A **`NeuroVec`** is a 4D image: a stack of 3D volumes on one grid, usually an fMRI run. A **hypervector** (`DenseNeuroHyperVec`) adds any number of *named* axes on top of the spatial grid: subject × condition, session × run, and so on.

Every 4D class implements the same small `NeuroVec` interface (`getAt`, `setAt`, `getSeries`, `getVolume`, `getData`, `getRange`). Accessors always take **`(i, j, k, t)`**. What differs is where the data live and, for one family, the order of the axes in `space.dim`.

## Pick a container

| Class | `space.dim` | Storage | Typical source |
|---|---|---|---|
| `Float32NeuroVec`, `Float64NeuroVec`, `Int16NeuroVec`, `Uint8NeuroVec` | `[X, Y, Z, T]` | One typed array in memory, frames back to back | Built in code |
| `EnhancedFloat32NeuroVec` | `[X, Y, Z, T]` | Same, plus detrending, filtering and temporal statistics | Built in code |
| `FileBackedNeuroVec` | `[X, Y, Z, T]` | Frames fetched by your callback, kept in an LRU cache | Large uncompressed files |
| `MappedNeuroVec` | `[X, Y, Z, T]` | `DataView` over an existing `ArrayBuffer`, no conversion | A decoded NIfTI buffer |
| `SparseNeuroVec` | `[X, Y, Z, T]` | `Map` from voxel index to series | A few voxels of interest |
| `BigNeuroVec` | **`[T, X, Y, Z]`** | In memory (`readVec`, `bigNeuroVecSeq`), or staged through a temp file when constructed directly | `readVec`, `bigNeuroVecSeq` |

::: warning Time-first vs. time-last
`readVec` and `bigNeuroVecSeq` return a `BigNeuroVec`, whose `space.dim` is **`[T, X, Y, Z]`**. All other classes use `[X, Y, Z, T]`. `getAt(i, j, k, t)` and `getSeries(i, j, k)` behave the same on both, but if you read the shape from `vec.dim`, check which family you have. On every class, `vec.length` is the **total element count** (X·Y·Z·T). It is not the number of time points.
:::

## Dense vectors in memory

```ts
import { NeuroSpace, Float32NeuroVec } from 'neuroimjs'

// x, y, z, t — time is the LAST axis; spacing[3] is the TR in seconds.
// Give spacing and origin the same length (both 4 here, or both 3).
const space = new NeuroSpace([64, 64, 36, 200], [3, 3, 4, 2], [-96, -96, -72, 0])
const bold = new Float32NeuroVec(space) // zero-filled Float32Array

bold.dim // [64, 64, 36, 200]
bold.length // 29491200  — total element count, NOT the number of time points
bold.dim[3] // 200 time points

bold.setAt(32, 32, 18, 0, 1000) // (i, j, k, t, value)
bold.getAt(32, 32, 18, 0) // 1000
bold.getSeries(32, 32, 18).length // 200  (number[])

// Volumes are stored back to back; getVolume(t) is a zero-copy view.
const frame0 = bold.getVolume(0) // FloatNeuroVol on a [64, 64, 36] space
frame0.getAt(32, 32, 18) // 1000
frame0.setAt(0, 0, 0, 7)
bold.getAt(0, 0, 0, 0) // 7 — writes through to the 4D buffer
```

Pass an existing typed array as the second constructor argument to adopt it without copying (`new Float32NeuroVec(space, data)`). Its length must equal `X·Y·Z·T`, and it must be laid out x-fastest within each frame, with frames back to back. This is the NIfTI on-disk order.

## Preprocessing & temporal statistics

The time-series operations live on `EnhancedFloat32NeuroVec`. The plain typed classes above have none of them. Every operation returns a **new** vec or volume and leaves the input unchanged.

```ts
import { NeuroSpace, EnhancedFloat32NeuroVec, type TemporalFilter } from 'neuroimjs'

// 2 voxels × 100 TRs at TR = 2 s: a slow drift plus a 0.05 Hz oscillation.
const T = 100
const space = new NeuroSpace([2, 1, 1, T], [3, 3, 3, 2], [0, 0, 0, 0])
const bold = new EnhancedFloat32NeuroVec(space)
for (let t = 0; t < T; t++) {
  const signal = 10 * Math.sin(2 * Math.PI * 0.05 * t * 2) // 0.05 Hz at TR = 2 s
  bold.setAt(0, 0, 0, t, 1000 + 0.5 * t + signal)
  bold.setAt(1, 0, 0, t, 800 + signal)
}

const detrended = bold.detrend('linear') // also 'mean' | 'polynomial' ({ order })
const band: TemporalFilter = { lowFreq: 0.01, highFreq: 0.1, tr: 2 } // Hz, Hz, seconds
const banded = bold.temporalFilter(band)
bold.getAt(1, 0, 0, 2) // ≈ 809.51
banded.getAt(1, 0, 0, 2) // ≈ 9.51 — DC (the 800 baseline) removed, 0.05 Hz kept

const mean = bold.temporalMean() // FloatNeuroVol, one value per voxel
mean.getAt(1, 0, 0) // ≈ 800

const r = bold.temporalCorrelation([0, 0, 0]) // seed-based correlation map
r.getAt(1, 0, 0) // ≈ 0.38 — the drift in voxel 0 dilutes the correlation
const rClean = detrended.temporalCorrelation([0, 0, 0])
rClean.getAt(1, 0, 0) // ≈ 1.0 after linear detrending

const z = bold.zscore() // per-voxel; zero-variance voxels are left unchanged
const firstHalf = bold.slice(0, 50) // time points [0, 50)
```

What each operation does:

| Method | Behaviour |
|---|---|
| `detrend(method, { order? })` | Per-voxel least-squares fit on the time index, then subtracts it. `DetrendMethod` is `'mean'`, `'linear'` or `'polynomial'`; the polynomial order defaults to 2. |
| `temporalFilter({ lowFreq?, highFreq?, tr? })` | Ideal (brick-wall) filter in the frequency domain: a DFT, then bins outside the band are zeroed and the series is inverse-transformed. With only `lowFreq` it is a high-pass that also removes the mean. With only `highFreq` it is a low-pass. With both it is a band-pass. `tr` defaults to 2 s. The DFT is O(T²) per voxel. |
| `convolve(kernel)`, `temporalSmooth(sigma)` | Per-voxel convolution with a normalized kernel (zero-padded edges). `temporalSmooth` builds a Gaussian kernel with `sigma` in samples. |
| `temporalMean/Std/Min/Max/Median()` | Reduce over time to a `FloatNeuroVol`. `temporalStd` uses the n − 1 denominator. |
| `temporalCorrelation([i, j, k])` | Pearson r between the seed voxel's series and every voxel's series. |
| `zscore()`, `percentSignalChange(baseline?)` | Per-voxel normalization. `baseline` is a list of time indices and defaults to the first 10% of frames. Voxels whose baseline mean is ≤ 0 are left unchanged. |
| `slice(start, end)`, `concatenate(other)` | Subset or join along time. |

`temporalCorrelationMap()` is declared but not yet implemented: it throws.

::: tip 4D spaces for `slice()` and `concatenate()`
If you give a 4D `NeuroSpace` a 4-element `spacing` (to record the TR), also give it a 4-element `origin`. With a 4-element spacing and the default 3-element origin, `EnhancedFloat32NeuroVec`'s `slice()` and `concatenate()` throw `Spacing and origin lengths must match`. So do the same methods on `FileBackedNeuroVec` and `MappedNeuroVec`, which copy into an `EnhancedFloat32NeuroVec` first.
:::

To run these operations on a vec you already have, wrap its buffer: `new EnhancedFloat32NeuroVec(vec.space, vec.getData())`. The data must be a `Float32Array` in `[X, Y, Z, T]` order.

## Larger-than-convenient runs

### `FileBackedNeuroVec`: frames on demand

You supply a synchronous `(t) => Float32Array` that returns one frame, x-fastest. The vec caches the most recently used frames. Below, frames are read straight from an uncompressed NIfTI file:

```ts
import { openSync, readSync } from 'node:fs'
import { readHeader, NeuroSpace, FileBackedNeuroVec } from 'neuroimjs'

const path = 'bold.nii' // uncompressed, FLOAT32 — seekable on disk
const h = await readHeader(path)
const [, nx, ny, nz, nt] = h.dim // h.dim is the raw 8-element NIfTI dim array
const voxels = nx * ny * nz

const fd = openSync(path, 'r')
const readFrame = (t: number): Float32Array => {
  const out = new Float32Array(voxels)
  readSync(fd, new Uint8Array(out.buffer), 0, out.byteLength, h.voxOffset + t * out.byteLength)
  return out
}

const space = new NeuroSpace([nx, ny, nz, nt], [...h.spacing, 1], [...h.origin, 0])
const bold = new FileBackedNeuroVec(space, readFrame, { maxCacheSize: 8 })

bold.getAt(1, 2, 3, 2) // reads frame 2 only
bold.getVolume(0) // FloatNeuroVol for frame 0
bold.getTimeSeries(1, 2, 3) // touches every frame (LRU cache holds 8)
```

`getData()` throws on this class. Pass `dataSetter` in the options to make it writable.

Memory and I/O costs vary by method:

- `temporalMean()` and `temporalStd()` stream frame by frame.
- `temporalMin/Max/Median()` loop voxel by voxel over all frames. Unless `maxCacheSize` is at least the number of frames, they re-fetch frames constantly.
- `detrend`, `temporalFilter`, `zscore`, `temporalCorrelation` and the other transforms first copy the whole run into an `EnhancedFloat32NeuroVec`, so they need the full run in memory.

### `MappedNeuroVec`: read a decoded buffer in place

`MappedNeuroVec` reads values through a `DataView` at a byte offset. It is a view over an `ArrayBuffer` you already hold, not an OS memory map. It is the cheapest way to work on a whole run that you have decompressed once:

```ts
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { readHeader, NeuroSpace, MappedNeuroVec } from 'neuroimjs'

const path = 'bold.nii.gz'
const h = await readHeader(path)
if (h.datatype !== 'FLOAT32') throw new Error(`expected FLOAT32, got ${h.datatype}`)
const [, nx, ny, nz, nt] = h.dim

const bytes = gunzipSync(readFileSync(path)) // decompress once; skip for plain .nii
const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)

const space = new NeuroSpace([nx, ny, nz, nt], [...h.spacing, 1], [...h.origin, 0])
const bold = new MappedNeuroVec(space, buffer, {
  dtype: 'float32', // 'float32' | 'float64' | 'int16' | 'uint8'
  byteOffset: h.voxOffset, // read the image in place, after the header
})
bold.getAt(1, 2, 3, 2) // 2043
bold.getSeries(1, 2, 3) // [43, 1043, 2043, 3043]
bold.getVolume(2) // copies one frame into a FloatNeuroVol
```

The view returns raw stored values. It does **not** apply `scl_slope`/`scl_inter` and does not byte-swap big-endian files. Set `littleEndian: false` for those, and apply scaling yourself when `h.sclSlope` is not 0 or 1, or `h.sclInter` is not 0. `MappedNeuroVec.fromTypedArray(space, array)` wraps an existing typed array. As with `FileBackedNeuroVec`, the transforms first copy the run into an `EnhancedFloat32NeuroVec`.

## Sparse time series

`SparseNeuroVec` stores series for a few voxels only. Every other voxel reads as the default value (0 unless you pass a third constructor argument).

```ts
import { NeuroSpace, SparseNeuroVec } from 'neuroimjs'

const space = new NeuroSpace([64, 64, 36, 4], [3, 3, 4, 2], [0, 0, 0, 0])
const seed = 32 + 32 * 64 + 18 * 64 * 64 // spatial linear index i + j·nx + k·nx·ny

// Map<linearVoxelIndex, series>; every other voxel reads as the default (0).
const roi = new SparseNeuroVec(space, new Map([[seed, [5, 6, 7, 8]]]))
roi.getSeries(32, 32, 18) // [5, 6, 7, 8]
roi.getAt(0, 0, 0, 1) // 0
roi.setAt(10, 10, 10, 2, 3) // allocates a series for (10, 10, 10) on first write
roi.getData().size // 2 stored voxels
roi.getVolume(3).getAt(32, 32, 18) // 8 — densified FloatNeuroVol
```

## `BigNeuroVec`: what `readVec` returns

```ts
import { readVec, readVol, bigNeuroVecSeq, writeVec, BigNeuroVec } from 'neuroimjs'

const bold = await readVec('bold.nii') // BigNeuroVec
bold.space.dim // [T, X, Y, Z] — time FIRST, e.g. [4, 3, 4, 5]
bold.dim[0] // number of time points
bold.length // T·X·Y·Z — total element count
bold.getAt(1, 2, 3, 2) // accessors still take (i, j, k, t)
bold.getSeries(1, 2, 3) // number[] of length T
bold.getVolume(2) // FloatNeuroVol for frame 2, on the file's 3D space
(bold as BigNeuroVec).volumeSpace // the file's 3D NeuroSpace, including the affine

// Load a subset of frames:
const sub = await readVec('bold.nii', { indices: [0, 2] })
sub.space.dim // [2, 3, 4, 5]

// Build one from 3D volumes and write it out as a 4D NIfTI:
const frames = [await readVol('bold.nii', { index: 0 }), await readVol('bold.nii', { index: 1 })]
const pair = bigNeuroVecSeq(frames)
await writeVec(pair, 'pair.nii.gz') // gzipped: compression follows the extension

// readVec and bigNeuroVecSeq keep everything in memory; cleanup() is harmless
// and only deletes a backing file when the vec was constructed with one.
pair.cleanup()
```

Things to know before relying on `BigNeuroVec` for large data:

- **It is held fully in memory.** `readVec` reads and decompresses the file once and copies every frame into one `Float32Array`; nothing is written to disk and nothing is memory-mapped. For runs too large for memory, use `FileBackedNeuroVec` or `MappedNeuroVec` (above).
- **`vec.space` is not the image geometry.** Because the shape is time-first, `NeuroSpace` treats `[T, X, Y]` as the spatial axes. The file's 3D space, including the full affine, is `volumeSpace`, and `getVolume(t)` returns volumes on it (`bigNeuroVecSeq` takes `volumeSpace` from the first input volume). The time axis gets the header's `pixdim[4]` (the TR) as its spacing when that is positive, else 1.
- **`mask` is ignored**, and `useBigVec` no longer changes anything.

### Writing 4D data

`writeVec` writes either layout. It reads the layout from the class: a `BigNeuroVec` is time-first and takes its geometry from `volumeSpace`, while a `DenseNeuroVec` (`Float32NeuroVec`, `Int16NeuroVec`, …) or `SparseNeuroVec` is time-last and takes it from its 4D `space`. The file is always NIfTI `[X, Y, Z, T]`, with the full affine stored as both qform and sform (sform only if the affine is sheared, which a qform cannot represent). Other `NeuroVec` implementations are rejected with `INVALID_ARGUMENT`.

```ts
import { NeuroSpace, Float32NeuroVec, writeVec, readHeader, readVol } from 'neuroimjs'

// [X, Y, Z, T] with a 2 mm grid and a 2.5 s TR in the fourth spacing entry.
const bold = new Float32NeuroVec(new NeuroSpace([3, 4, 5, 6], [2, 2, 2, 2.5], [-3, -4, -5, 0]))
bold.getData().fill(1)

await writeVec(bold, 'bold_out.nii.gz')

const hdr = await readHeader('bold_out.nii.gz')
hdr.dim // [4, 3, 4, 5, 6, 1, 1, 1]
const frame = await readVol('bold_out.nii.gz', { index: 5 }) // same affine as bold.getVolume(5)
```

`pixdim[4]` is the vec's time spacing when its space has one (`spacing[3]` here; `spacing[0]` for a `BigNeuroVec`), otherwise 1; the time unit is seconds when the spacing is known. `readVec` reads it back as `space.spacing[0]`.

## Hypervectors (5D and beyond)

`createNeuroHyperVec(space, dimensions)` returns a `DenseNeuroHyperVec`: a 3D spatial grid plus named axes, held in one `Float32Array`. Each `DimensionInfo` has a `name`, a `size` and optional `labels`. The spatial axes are always `x`, `y`, `z`, in that order.

```ts
import { NeuroSpace, FloatNeuroVol, createNeuroHyperVec } from 'neuroimjs'

// 3 subjects × 2 conditions of 4×4×2 beta maps.
const space = new NeuroSpace([4, 4, 2], [3, 3, 3])
const hv = createNeuroHyperVec(space, [
  { name: 'subject', size: 3 },
  { name: 'condition', size: 2, labels: ['faces', 'houses'] },
]) // a DenseNeuroHyperVec

hv.shape // [4, 4, 2, 3, 2]  (x, y, z, then the named axes in order)
hv.ndim // 5

for (let s = 0; s < 3; s++)
  for (let c = 0; c < 2; c++)
    hv.setSubVolume({ subject: s, condition: c }, new FloatNeuroVol(space, new Float32Array(32).fill(10 * s + c)))

// Fix every named axis → a 3D volume; leave one free → a 4D Float32NeuroVec.
hv.getSubVolume({ subject: 2, condition: 1 }) // FloatNeuroVol, all 21
hv.getSubVolume({ condition: 0 }) // Float32NeuroVec [4, 4, 2, 3]: one frame per subject
hv.getVoxelSeries(0, 0, 0) // [0, 1, 10, 11, 20, 21]  (last named axis fastest)

const groupMean = hv.reduce(['subject'], { operation: 'mean' }) // shape [4, 4, 2, 2]
groupMean.getSubVolume({ condition: 1 }) // all 11

hv.concat(hv, 'subject').shape // [4, 4, 2, 6, 2]
hv.split('subject', [1]).map(p => p.shape) // [[4, 4, 2, 1, 2], [4, 4, 2, 2, 2]]
hv.permute(['x', 'y', 'z', 'condition', 'subject']).shape // [4, 4, 2, 2, 3]
```

`ReductionOp` is `'mean' | 'sum' | 'std' | 'var' | 'min' | 'max' | 'median'`. Here `std` and `var` use the population (n) denominator, unlike `temporalStd` above. `mapAlong(dims, fn)` applies a `NeuroVol → NeuroVol` function to every sub-volume.

::: warning Current limits
- **`reduce()` overflows the call stack on realistic grids.** It recurses once per output element and fails with `RangeError: Maximum call stack size exceeded` beyond a few thousand output values. In Node's default configuration it fails at 8 000 output values and still works at 4 000. Until this is fixed, reduce whole-brain data volume by volume (example below).
- Data are stored x-major (C order over `[x, y, z, …named]`), not in the x-fastest NIfTI order. Write data through `setSubVolume` rather than passing a raw array to the `DenseNeuroHyperVec` constructor.
- `getSubVolume` returns a 4D vec over a single free named axis. If you leave more than one named axis free, it silently returns a vec over the first one only, so fix all named axes but one.
- `getSubVolume` cannot subset the spatial axes. Any `x`, `y` or `z` key in the index spec, including `x: 0`, throws `No time dimension found for NeuroVec extraction`. Extract the full volume, then index it with `getAt`.
- Not implemented (they throw): `view`, `extractFeatures`, `glm`, `save`, and the `sparse` / `lazy` options of `createNeuroHyperVec`. `correlateAlong` runs, but it does not compute a meaningful per-index correlation. Don't use it.
:::

Averaging over subjects on a whole-brain grid, without `reduce()`:

```ts
import { NeuroSpace, FloatNeuroVol, createNeuroHyperVec } from 'neuroimjs'

const space = new NeuroSpace([64, 64, 40], [3, 3, 3])
const nSub = 3
const hv = createNeuroHyperVec(space, [{ name: 'subject', size: nSub }, { name: 'condition', size: 2 }])
for (let s = 0; s < nSub; s++)
  hv.setSubVolume({ subject: s, condition: 1 }, new FloatNeuroVol(space, new Float32Array(64 * 64 * 40).fill(s)))

// Whole-brain grids: average across subjects volume by volume.
const acc = new Float32Array(64 * 64 * 40)
for (let s = 0; s < nSub; s++) {
  const beta = (hv.getSubVolume({ subject: s, condition: 1 }) as FloatNeuroVol).getData()
  for (let i = 0; i < acc.length; i++) acc[i] += beta[i] / nSub
}
const facesMean = new FloatNeuroVol(space, acc)
facesMean.getAt(10, 20, 30) // 1
```

For group statistics over a set of subject maps (t, effect size, consistency), see **[Group Statistics](/guide/group-stats)**.
