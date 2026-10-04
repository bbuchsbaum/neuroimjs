# Reading & Writing (I/O)

neuroimjs reads NIfTI-1 and NIfTI-2 (`.nii`, `.nii.gz`) and writes NIfTI-1. There are two decoders, one per entry point:

| | Browser (`neuroimjs/browser`) | Node (`neuroimjs` or `neuroimjs/io`) |
|---|---|---|
| Read a 3D volume | `readNiftiArrayBuffer(buffer, { index })` (synchronous) | `readVol(pathOrBuffer, { index })` (async) |
| Read a 4D series | call `readNiftiArrayBuffer` once per `index` | `readVec(path)` |
| Write | — | `writeVol`, `writeVec` |

Both decoders share these rules:

- **Intensity scaling.** Values become `stored * scl_slope + scl_inter`. A `scl_slope` of 0 or a non-finite slope means "no scaling": the stored values come back unchanged and `scl_inter` is ignored too, as in the NIfTI-1 spec and nibabel.
- **Byte order.** Big-endian files are byte-swapped on read.
- **Geometry.** The volume's `NeuroSpace` carries the full affine (`space.trans`). `space.spacing` holds the voxel sizes implied by that affine (the norms of its first three columns, as nibabel's `voxel_sizes(img.affine)` computes), not the raw `pixdim`. The axis orientation is the one nearest the affine. The affine comes from nifti-reader-js, whose transform choice differs from nibabel's in three cases (see the [conformance notes](https://github.com/bbuchsbaum/neuroimjs/blob/main/tests/conformance/README.md) and the transform-selection ADR in [PR #19](https://github.com/bbuchsbaum/neuroimjs/pull/19)): when `qform_code > sform_code > 0` it uses the qform where nibabel uses the sform; a file with neither transform gets `diag(pixdim)` with a zero offset instead of nibabel's centred base affine; and a NIfTI-2 file with only a qform fails to load.

They differ in storage types:

- **Scaled data** become `Float32` (`FloatNeuroVol`) in `readVol` and `readVec`, but `Float64` (`Float64NeuroVol`) in `readNiftiArrayBuffer`, so scaled values can differ in the last float32 digits.
- **uint32 data** throw in `readVol` (`Unsupported TypedArray type: uint32`); `readNiftiArrayBuffer` promotes them losslessly to `Float64NeuroVol`.

## Loading data in the browser

Use `readNiftiArrayBuffer` from `neuroimjs/browser`. It takes the raw bytes of a `.nii` or `.nii.gz` file and returns a 3D `NeuroVol`:

```ts
import {
  readNiftiArrayBuffer, getVolumeGeometry,
  VolLayer, VolStack, ColorMapFactory, SimpleOrthogonalViewer,
} from 'neuroimjs/browser'

const response = await fetch('/data/mni152_t1.nii.gz')
const vol = readNiftiArrayBuffer(await response.arrayBuffer())

const range = vol.getRange()   // [min, max] of the (scaled) voxel values
const layer = new VolLayer('t1', vol, ColorMapFactory.createGrayscale({ range }), range)
await SimpleOrthogonalViewer.create(document.getElementById('viewer')!, new VolStack(layer))
```

What it does for you:

- **Decompression.** Gzip is detected from the bytes, not the file name, so it works for `fetch`, `File.arrayBuffer()` and data URLs alike.
- **Scaling, byte order and geometry** as described above.
- **Typed storage.** Unscaled data keeps its stored type (`Int16NeuroVol` for int16, `UInt8NeuroVol` for uint8, `FloatNeuroVol` for float32, …). Scaled data and uint32 data become `Float64NeuroVol`, so no precision is lost.
- **Picking a volume.** For a 4D file, `{ index }` selects one zero-based 3D volume (default 0); an index outside the file throws.
- **Validation.** Non-NIfTI input, ranks other than 3 or 4, unsupported datatypes and truncated image data throw an `Error`.

It has no dependency on Node's `fs`, `path` or `Buffer`. It is exported from the browser entry only, because its NIfTI parser (`nifti-reader-js`) is ESM-only and would break `require('neuroimjs')`.

Reading a file the user selects works the same way:

```ts
input.addEventListener('change', async () => {
  const vol = readNiftiArrayBuffer(await input.files![0].arrayBuffer())
  // …build a VolStack and mount a viewer
})
```

### Checking geometry before you overlay

`getVolumeGeometry(vol)` returns a plain, JSON-safe description of where a volume sits: `dimensions`, `spacing`, `origin`, `axes`, a three-letter `orientation` code such as `"RAS"`, and the 4×4 `affine`. Use it to show or log geometry, or to send it to a worker. `assertSameVolumeGeometry(reference, candidate)` throws a descriptive error unless both volumes are on the same voxel grid:

```ts
import { getVolumeGeometry, assertSameVolumeGeometry } from 'neuroimjs/browser'

console.log(getVolumeGeometry(vol).orientation)   // e.g. "RAS"

// Fail early instead of drawing a misregistered overlay
assertSameVolumeGeometry(template, statMap)
```

Overlays on a *different* grid do not need to match: the viewers place them by world position. See [Multi-Layer Alignment](/guide/alignment).

## Viewer-free imports (`neuroimjs/io`, `neuroimjs/slices`, `neuroimjs/geometry`) {#viewer-free-imports}

Importing the root `neuroimjs` entry also loads the viewer stack: pixi.js, mobx and lit. In a Node service, a CLI or an Electron main process you usually want only I/O and geometry. Three subpath exports provide those without loading any display code:

| Subpath | Exports |
|---|---|
| `neuroimjs/io` | `readVol`, `writeVol`, `readHeader`, `readVolList`, `readVec`, `writeVec`, `read_vol`, `write_vol`, `FileFormat`, `NIFTIFormat`, `NIFTIDualFormat`, `AFNIFormat`, `findDescriptor`, `getFormat`; types `ReadVolOptions`, `WriteVolOptions`, `HeaderInfo`, `NeuroVol`, `NeuroVec` |
| `neuroimjs/slices` | `extractOrthogonalSlices`, `extractAxialSlice`, `extractSagittalSlice`, `extractCoronalSlice`, `getSliceOrientation`, `getWorldBoundsForSlice`, `extractSliceForView`, `getSliceAxisIndex`, `getMaxSliceIndex`, `isValidSliceIndex`, `getSliceAxisName`, `getCenterSliceIndex`, `getSafeSliceIndicesForSpaces`, `NeuroSlice`; type `NeuroVol` |
| `neuroimjs/geometry` | `NeuroSpace`, `NamedAxis`, `AxisSet`, `AxisSet1D`, `AxisSet2D`, `AxisSet3D`, `AXIAL_LPI`, `CORONAL_LIP`, `SAGITTAL_AIL`, `getVolumeGeometry`, `assertSameVolumeGeometry`; type `VolumeGeometry` |

Each subpath works with both `import` and `require`, and ships its own type declarations. Every symbol is also exported from the root entry, so you can switch an import between the two without other changes.

```ts
// Electron main process: build a thumbnail without loading pixi.js
import { readVol } from 'neuroimjs/io'
import { extractOrthogonalSlices } from 'neuroimjs/slices'

const vol = await readVol('sub-01_T1w.nii.gz')
const centre = vol.space.gridToCoord(vol.dim.slice(0, 3).map((d) => (d - 1) / 2))
const { axial, sagittal, coronal } = extractOrthogonalSlices(vol, centre)
```

`readNiftiArrayBuffer` is not in `neuroimjs/io`. It statically imports the ESM-only `nifti-reader-js`, which would break `require('neuroimjs/io')`. In Node, pass the bytes to `readVol` instead, which also accepts an `ArrayBuffer`. In the browser, `readNiftiArrayBuffer` is available from `neuroimjs/browser`.

`npm run test:package` checks the compiled import graph of each subpath, then imports it from the packed tarball in plain Node (ESM and CommonJS). It fails if pixi.js, `@pixi/*`, mobx, lit or any display module is resolved. These subpaths are an interim measure. A later release is planned to split the package into separate core and viewer entries; the intent is to keep these subpaths working after that split.

## Node.js: read from disk

```ts
import { readVol, readVolList } from 'neuroimjs'

// A single 3D volume
const vol = await readVol('subject01_T1w.nii.gz')

// One volume from a 4D file (zero-based)
const frame = await readVol('bold.nii.gz', { index: 5 })

// Several files, one volume each
const vols = await readVolList(['sub-01.nii.gz', 'sub-02.nii.gz'])
```

`readVol` also accepts an `ArrayBuffer` of file bytes (gzip detected automatically). It takes a progress callback, called with values from 0 to 1:

```ts
const vol = await readVol('big.nii.gz', {
  onProgress: (p) => console.log(`${Math.round(p * 100)}%`),
})
```

### 4D time series: `readVec`

```ts
import { readVec, BigNeuroVec } from 'neuroimjs'

// readVec is typed as returning NeuroVec; the object is a BigNeuroVec,
// which is the type that declares volumeSpace.
const vec = (await readVec('bold.nii.gz')) as BigNeuroVec

const [nT, nX, nY, nZ] = vec.dim       // time first: [T, X, Y, Z]
const ts = vec.getSeries(32, 32, 20)    // nT values at voxel (32, 32, 20)
const first = vec.getVolume(0)          // a 3D NeuroVol with the file's geometry
const geometry = vec.volumeSpace        // the file's 3D NeuroSpace, full affine
```

`readVec` decodes the file once and keeps the data in memory; it writes nothing to disk. Two things to know:

- **The shape is time-first.** For compatibility, `vec.dim` and `vec.space.dim` are `[T, X, Y, Z]`, and `vec.getAt(i, j, k, t)` indexes voxel `(i, j, k)` at time `t`. Because `vec.space` treats the leading three entries as spatial, it does **not** describe the image geometry.
- **Use `volumeSpace` for geometry.** `vec.volumeSpace` is the file's 3D space, including the full affine; `getVolume(t)` returns volumes on that space.

`options.indices` reads a subset of volumes. `options.mask` is accepted but currently ignored, and `useBigVec` no longer changes anything.

## Writing

```ts
import { writeVol, writeVec } from 'neuroimjs'

await writeVol(vol, 'output.nii')                        // uncompressed
await writeVol(vol, 'output.nii.gz', { compress: true }) // gzip
await writeVec(vec, 'bold_copy.nii.gz', { compress: true })
```

::: warning Compression is not inferred from the file name
`writeVol` and `writeVec` gzip the output only when you pass `{ compress: true }` (or `format: 'NIFTI_GZ'`). Writing to a `.nii.gz` path without it produces an uncompressed file with a `.gz` name, which `readVol` then cannot read (bug, tracked: mote bd-01M4298YPGHKDWBSV61RAMF2VB).
:::

The output is a single-file NIfTI-1 image. `dataType` (for example `'FLOAT32'` or `'INT16'`) selects the stored type.

## Inspect a header without loading data

```ts
import { readHeader } from 'neuroimjs'

const info = await readHeader('subject01_T1w.nii.gz')
console.log(info.dim, info.spacing, info.datatype, info.affine)
```

`readHeader` returns raw header fields: `dim` is the full NIfTI `dim` array (rank first), and `spacing` is the raw `pixdim[1..3]`, which can differ from the affine-derived `vol.space.spacing` when the sform's scaling disagrees with pixdim.

## Formats

| Format | Read | Write |
|---|---|---|
| NIfTI-1 single file (`.nii`, `.nii.gz`) | ✅ | ✅ |
| NIfTI-2 single file (`.nii`, `.nii.gz`) | ✅ | — |
| NIfTI dual-file (`.hdr`/`.img`) | — | — |
| AFNI (`.HEAD`/`.BRIK`) | — | — |

`FileFormat`, `NIFTIFormat`, `NIFTIDualFormat`, `AFNIFormat`, `findDescriptor` and `getFormat` describe file formats by extension. A descriptor does not imply a reader: there is no reader for dual-file NIfTI or AFNI.

## Legacy aliases

`read_vol(input)` and `write_vol(vol, path)` are thin wrappers over `readVol` and `writeVol`, kept for backward compatibility. Prefer `readVol` / `writeVol` in new code.

## Errors

The library's own errors are instances of `NeuroimError`. Each carries a stable
`code`, and some also carry a `details` object (for example `{ index, volumeCount }`)
and a `cause`. Branch on the code rather than on the message: message wording
may change between releases, but codes will not.

```ts
import { readVol, isNeuroimError } from 'neuroimjs'

try {
  const vol = await readVol(buffer, { index: 3 })
} catch (error) {
  if (isNeuroimError(error, 'OUT_OF_RANGE')) {
    console.warn(`only ${error.details?.volumeCount} volumes`)
  } else if (isNeuroimError(error, 'CORRUPT_FILE')) {
    console.warn('not a readable NIfTI file')
  } else {
    throw error
  }
}
```

`isNeuroimError` also recognises errors from another copy of the library, such
as the CommonJS and ESM builds loaded side by side, where `instanceof` fails.
`NeuroimError`, `NeuroimTypeError` and `isNeuroimError` are exported from both
`neuroimjs` and `neuroimjs/browser`. The deprecated `ValueError`, `IOError` and
`NotImplementedError` are exported from `neuroimjs` only.

An error that crosses a worker boundary (`postMessage`, `structuredClone`)
arrives as a plain `Error`: the clone drops `code`, `details` and the brand
that `isNeuroimError` checks, so send `{ code, message }` explicitly if the
other side needs to branch on it.

| Code | Meaning | Typical sources |
|---|---|---|
| `INVALID_ARGUMENT` | An argument has the wrong shape, type or value | `NeuroSpace` with non-positive spacing or a singular affine; unknown axis names; empty `readVec` selection |
| `OUT_OF_RANGE` | An index or coordinate is outside the valid range | `readVol`/`readVec`/`readNiftiArrayBuffer` volume index past the end; `extractSliceNeuroSpace` past an axis |
| `GEOMETRY_MISMATCH` | Spaces, volumes or axis sets that must agree do not | `assertSameVolumeGeometry`; `withDimensions` with a different spatial rank; incompatible axis permutations |
| `UNSUPPORTED_FORMAT` | The format, or a valid feature of it, is not supported | unknown file extension; writing a non-NIfTI format; a NIfTI that is neither 3D nor 4D |
| `UNSUPPORTED_DATATYPE` | The voxel data type is not supported | NIfTI datatypes such as FLOAT128 or RGB24 |
| `CORRUPT_FILE` | The bytes do not decode as the expected format | bad magic number, unreadable header, invalid dimensions, truncated image data |
| `NOT_IMPLEMENTED` | The API exists but has no implementation for this input | `reorient` on a space that is not 2D or 3D; `NotImplementedError` |
| `IO_ERROR` | Reading from or writing to storage failed | `IOError` |

Errors raised by Node itself, such as `ENOENT` for a missing file, and by
third-party decoders, such as a failed gunzip, propagate unchanged and are not
`NeuroimError`s.

**Deprecated names.** `ValueError` is now a subclass of `NeuroimError`.
Functions that used to throw `ValueError` still do, now with a specific code,
so existing `instanceof ValueError` checks keep working. New code should use
`isNeuroimError` instead. The old `TypeError` export, which shadowed the global
`TypeError`, has been removed. Its replacement is `NeuroimTypeError`, which has
code `INVALID_ARGUMENT`.
