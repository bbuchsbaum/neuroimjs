# Reading & Writing (I/O)

neuroimjs reads single-file **NIfTI** (`.nii`, `.nii.gz`; NIfTI-1 and NIfTI-2) and writes NIfTI-1. The two entry points expose different readers:

| | Node (`neuroimjs`) | Browser (`neuroimjs/browser`) |
|---|---|---|
| Read a 3D volume or one frame | `readVol(path \| ArrayBuffer, opts?)` (async) | `readNiftiArrayBuffer(ArrayBuffer, opts?)` (sync) |
| Read several files / a 4D run | `readVolList`, `readVec` | — |
| Header only | `readHeader(path)` | — |
| Write | `writeVol`, `writeVec` | — |

There are two NIfTI decoders, `readVol` (with `readVolList` and `readVec`, which use the same code) and `readNiftiArrayBuffer`. They share these rules:

- **Intensity scaling.** Values become `stored * scl_slope + scl_inter`. A `scl_slope` of 0 or a non-finite slope means "no scaling": the stored values come back unchanged and `scl_inter` is ignored too, as in the NIfTI-1 spec and nibabel.
- **Byte order.** Big-endian files are byte-swapped on read.
- **Geometry.** The volume's `NeuroSpace` carries the full affine (`space.trans`). `space.spacing` holds the voxel sizes implied by that affine (the norms of its first three columns, as nibabel's `voxel_sizes(img.affine)` computes), not the raw `pixdim`. The axis orientation is the one nearest the affine.

They differ in storage types:

- **Scaled data** become `Float32` (`FloatNeuroVol`) in `readVol` and `readVec`, but `Float64` (`Float64NeuroVol`) in `readNiftiArrayBuffer`, so scaled values can differ in the last float32 digits.
- **Unscaled `UINT32` data** throw in `readVol` (`Unsupported TypedArray type: uint32`); `readNiftiArrayBuffer` promotes them losslessly to `Float64NeuroVol`. Unscaled `UINT16` data load as `UInt16NeuroVol` in both, but such a volume cannot be sliced or displayed yet.

### Known differences from nibabel

Reading is checked against nibabel-generated fixtures (`npm run test:conformance`). The affine comes from nifti-reader-js, whose transform choice differs from nibabel's in three cases (see the [conformance notes](https://github.com/bbuchsbaum/neuroimjs/blob/main/tests/conformance/README.md) and the transform-selection ADR in [PR #19](https://github.com/bbuchsbaum/neuroimjs/pull/19)):

- when `qform_code > sform_code > 0`, neuroimjs uses the qform where nibabel uses the sform;
- a file with neither transform gets `diag(pixdim)` with a zero offset instead of nibabel's centred base affine;
- a NIfTI-2 file with only a qform fails to load.

The `UINT32` gap in `readVol` (above) is the fourth known discrepancy.

## Node: read from disk

```ts
import { readVol, readVolList, readVec } from 'neuroimjs'

// One 3D volume. The class follows the stored datatype (Int16NeuroVol, FloatNeuroVol, …);
// if scl_slope/scl_inter are set, values are scaled and returned as FloatNeuroVol.
const t1 = await readVol('sub-01_T1w.nii.gz')

// One frame of a 4D file (0-based).
const frame = await readVol('sub-01_bold.nii.gz', { index: 2 })

// Several files → NeuroVol[] (each read with the same options).
const means = await readVolList(['run-1_mean.nii.gz', 'run-2_mean.nii.gz'])

// A whole 4D file → BigNeuroVec (time-first layout; see Time Series).
const bold = await readVec('sub-01_bold.nii.gz')

// Progress callback, called with values in [0, 1].
await readVol('sub-01_T1w.nii.gz', { onProgress: p => console.log(`${Math.round(p * 100)}%`) })
```

- `readVol` also accepts an `ArrayBuffer` in Node, gzipped or not. Gzip is detected from the bytes.
- With a path, the file must exist, and the format is chosen from the extension. A path ending in `.nii.gz` is always gunzipped.
- `readVolList` takes an **array of paths** and reads them one after another. To get every frame of a single 4D file, use `readVec` or loop over `readVol(path, { index })`.
- `readVol` cannot load an **unscaled `UINT32`** file: it throws `Unsupported TypedArray type`. An unscaled `UINT16` file loads as `UInt16NeuroVol`, which cannot be sliced or displayed yet; convert it to `FloatNeuroVol` first. With intensity scaling active, both load as `FloatNeuroVol`.

### 4D time series: `readVec` {#_4d-time-series-readvec}

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

- **The shape is time-first.** For compatibility, `vec.dim` and `vec.space.dim` are `[T, X, Y, Z]`, and `vec.getAt(i, j, k, t)` indexes voxel `(i, j, k)` at time `t`. Because `vec.space` treats the leading three entries as spatial, it does **not** describe the image geometry. The TR is not read.
- **Use `volumeSpace` for geometry.** `vec.volumeSpace` is the file's 3D space, including the full affine; `getVolume(t)` returns volumes on that space.

`options.indices` reads a subset of volumes. `options.mask` is accepted but currently ignored, and `useBigVec` no longer changes anything. See [Time Series → BigNeuroVec](/guide/time-series#bigneurovec-what-readvec-returns).

## Node: write

```ts
import { readVol, writeVol, readHeader } from 'neuroimjs'

const vol = await readVol('sub-01_T1w.nii.gz')

await writeVol(vol, 'out.nii') // uncompressed, datatype follows the volume (INT16 here)
await writeVol(vol, 'out.nii.gz') // gzip: compression follows the extension
await writeVol(vol, 'out_f32.nii.gz', { dataType: 'FLOAT32' })

const hdr = await readHeader('out_f32.nii.gz')
hdr.datatype // 'FLOAT32'
```

Compression follows the file name. `writeVol`, `writeVec` and `write_vol` gzip a path ending in `.nii.gz` and leave a path ending in `.nii` uncompressed; the extension is matched case-insensitively. The `compress` and `format` options may repeat that choice, but they may not contradict it: `{ compress: false }` on a `.nii.gz` path, or `{ compress: true }` or `format: 'NIFTI_GZ'` on a `.nii` path, throws a `NeuroimError` with code `INVALID_ARGUMENT` and writes nothing, because the readers choose gunzip from the extension and could not open the result. For a path with any other extension, `compress` decides, then `format: 'NIFTI_GZ'`; the default is uncompressed.

`writeVol` options:

- `dataType` (`'FLOAT32'`, `'FLOAT64'`, `'INT8'`, `'UINT8'`, `'INT16'`, `'UINT16'`, `'INT32'`, `'UINT32'`) converts on write. Integer targets are rounded and clamped to the type's range.
- `onProgress` reports progress.
- `format` accepts only NIfTI names (`'NIFTI'`, `'NIFTI_GZ'`); anything else throws `UNSUPPORTED_FORMAT`. `'NIFTI'`, the default, leaves compression to the extension; `'NIFTI_GZ'` requests gzip.
- `compress` requests (`true`) or refuses (`false`) gzip, subject to the extension rule above.

`writeVol` stores both the qform and the sform from the volume's affine. `writeVec` writes only an axis-aligned sform built from the vec's spacing and origin, so rotations and flips in the original affine are lost.

`writeVec(vec, path, options)` writes a 4D file and takes the same options. It expects the **time-first** layout that `readVec` and `bigNeuroVecSeq` produce. See [Writing 4D data](/guide/time-series#writing-4d-data) for converting an `[X, Y, Z, T]` vec first.

## Node: inspect a header

```ts
import { readHeader } from 'neuroimjs'

const info = await readHeader('sub-01_T1w.nii.gz')
info.dim // [3, 197, 233, 189, 1, 1, 0, 0] — raw NIfTI dim[0..7]; dim[0] is the rank
info.dim.slice(1, 1 + info.dim[0]) // [197, 233, 189]
info.spacing // [1, 1, 1]
info.datatype // 'INT16'
info.affine // 4×4 voxel-to-world matrix (number[][])
info.sclSlope // 1
info.voxOffset // 352 — byte offset of the image data
```

`readHeader` takes a file path and is Node-only. It still reads and, for `.nii.gz`, decompresses the whole file. The returned `HeaderInfo` also has `origin`, `bitpix`, `description`, `qformCode`, `sformCode` and `sclInter`. `info.spacing` holds the three spatial voxel sizes. The TR is not included.

## Viewer-free imports (`neuroimjs/io`, `neuroimjs/slices`, `neuroimjs/geometry`) {#viewer-free-imports}

Importing the root `neuroimjs` entry also loads the viewer stack: pixi.js, mobx and lit. In a Node service, a CLI or an Electron main process you usually want only I/O and geometry. Three subpath exports provide those without loading any display code:

| Subpath | Exports |
|---|---|
| `neuroimjs/io` | `readVol`, `writeVol`, `readHeader`, `readVolList`, `readVec`, `writeVec`, `read_vol`, `write_vol`, `FileFormat`, `NIFTIFormat`, `NIFTIDualFormat`, `AFNIFormat`, `findDescriptor`, `getFormat`, `DenseNeuroVol`, `FloatNeuroVol`, `Float64NeuroVol`, `Int8NeuroVol`, `Int16NeuroVol`, `Int32NeuroVol`, `UInt8NeuroVol`, `UInt16NeuroVol`, `NeuroimError`, `NeuroimTypeError`, `isNeuroimError`, `NEUROIM_ERROR_CODES`; types `ReadVolOptions`, `WriteVolOptions`, `HeaderInfo`, `NeuroVol`, `NeuroVec`, `NeuroimErrorCode`, `NeuroimErrorOptions` |
| `neuroimjs/slices` | `extractOrthogonalSlices`, `extractAxialSlice`, `extractSagittalSlice`, `extractCoronalSlice`, `getSliceOrientation`, `getWorldBoundsForSlice`, `extractSliceForView`, `getSliceAxisIndex`, `getMaxSliceIndex`, `isValidSliceIndex`, `getSliceAxisName`, `getCenterSliceIndex`, `getSafeSliceIndicesForSpaces`, `NeuroSlice`; type `NeuroVol` |
| `neuroimjs/geometry` | `NeuroSpace`, `NamedAxis`, `AxisSet`, `AxisSet1D`, `AxisSet2D`, `AxisSet3D`, `AXIAL_LPI`, `CORONAL_LIP`, `SAGITTAL_AIL`, `getVolumeGeometry`, `assertSameVolumeGeometry`, `NeuroimError`, `NeuroimTypeError`, `isNeuroimError`, `NEUROIM_ERROR_CODES`; types `VolumeGeometry`, `NeuroimErrorCode`, `NeuroimErrorOptions` |

At runtime each subpath works with both `import` (ES module build) and `require` (CommonJS build). Every symbol is also exported from the root entry, so you can switch an import between the two without other changes.

The type declarations are ES-module `.d.ts` files in a `"type": "module"` package. They resolve under these TypeScript settings:

- `moduleResolution: "NodeNext"` (or `"Node16"`) in ES-module code, and `"Bundler"`.
- CommonJS code under `module: "NodeNext"` with TypeScript 5.8 or later, which allows `require` of ES-module types. Under `module: "Node16"` or older TypeScript, `import x = require('neuroimjs/io')` reports TS1471. The root entry behaves the same way.
- Legacy `moduleResolution: "node"` / `"node10"`, through the package's `typesVersions` map.

::: warning Pick one module system
CommonJS and ES-module builds are separate copies of the code. If one part of a process uses `require('neuroimjs/io')` and another uses `import 'neuroimjs/geometry'`, the same class has two identities: a `NeuroSpace` from one fails `instanceof NeuroSpace` against the other. Use either `import` or `require` throughout. `isNeuroimError` is the exception: it recognises errors from either copy.
:::

```ts
// Electron main process: build a thumbnail without loading pixi.js
import { readVol } from 'neuroimjs/io'
import { extractOrthogonalSlices } from 'neuroimjs/slices'

const vol = await readVol('sub-01_T1w.nii.gz')
const centre = vol.space.gridToCoord(vol.dim.slice(0, 3).map((d) => (d - 1) / 2))
const { axial, sagittal, coronal } = extractOrthogonalSlices(vol, centre)
```

`readNiftiArrayBuffer` is not in `neuroimjs/io`. It statically imports the ESM-only `nifti-reader-js`, which would break `require('neuroimjs/io')`. In Node, pass the bytes to `readVol` instead, which also accepts an `ArrayBuffer`. In the browser, `readNiftiArrayBuffer` is available from `neuroimjs/browser`. It stays synchronous and browser-only for now; loading `nifti-reader-js` lazily would make it asynchronous, which would change its API.

`npm run test:package` checks the compiled import graph of each subpath, then imports it from the packed tarball in plain Node (ESM and CommonJS). It fails if the graph reaches a display module or any package other than Node built-ins, `ml-matrix`, `pako`, `nifti-reader-js` and `buffer`, or if pixi.js, `@pixi/*`, mobx or lit is resolved at run time. It also type-checks the subpaths under NodeNext, Bundler and node10. These subpaths are an interim measure. A later release is planned to split the package into separate core and viewer entries; the intent is to keep these subpaths working after that split.

## Browser: `readNiftiArrayBuffer` {#loading-data-in-the-browser}

The browser entry has no file system and does not export `readVol`. Fetch or read the bytes yourself, then decode them synchronously:

```ts
import { readNiftiArrayBuffer } from 'neuroimjs/browser'

// From a URL (.nii or .nii.gz — gzip is detected from the bytes, not the name):
const buffer = await (await fetch('/data/brain.nii.gz')).arrayBuffer()
const vol = readNiftiArrayBuffer(buffer) // synchronous; returns a NeuroVol

// One frame of a 4D file:
const frame3 = readNiftiArrayBuffer(buffer, { index: 3 })

// From a user-selected file:
const input = document.querySelector<HTMLInputElement>('input[type=file]')!
input.addEventListener('change', async () => {
  const file = input.files?.[0]
  if (!file) return
  const picked = readNiftiArrayBuffer(await file.arrayBuffer())
  console.log(file.name, picked.space.dim)
})
```

`readNiftiArrayBuffer` is exported **only** from `neuroimjs/browser`. It is not in the main `neuroimjs` entry, because `nifti-reader-js` is ESM-only and a static import would break `require('neuroimjs')`. It returns the stored datatype (`Int16NeuroVol`, `FloatNeuroVol`, …). Scaled data come back as `Float64NeuroVol`, and `UINT32` is promoted to `Float64NeuroVol`. `UINT16` stays a `UInt16NeuroVol`, which loads fine but cannot be sliced or displayed yet; convert it to `FloatNeuroVol` first ([Volumes & Slices](/guide/volumes#dense-volumes)). It throws on invalid input, an out-of-range `index`, or truncated image data. It has no dependency on Node's `fs`, `path` or `Buffer`. To window the result for display, see the loader in [Getting Started](/guide/getting-started). To check that an overlay sits on the same grid as its template before drawing it, use `getVolumeGeometry` and `assertSameVolumeGeometry` ([Volumes & Slices](/guide/volumes#checking-that-volumes-share-a-grid)); overlays on a *different* grid are placed by world position ([Multi-Layer Alignment](/guide/alignment)).

## Formats

| Format | Read | Write |
|---|---|---|
| NIfTI-1 single file (`.nii`, `.nii.gz`) | ✅ | ✅ |
| NIfTI-2 single file | ✅ header parsing via `nifti-reader-js` | ❌ writers always produce NIfTI-1 (`n+1`) |
| NIfTI dual file (`.hdr` + `.img`) | ❌ recognized by `findDescriptor`, but the readers expect a single-file image | ❌ |
| AFNI (`.HEAD`/`.BRIK`) | ❌ recognized by `findDescriptor` only | ❌ |

The format descriptors are exported for code that needs to branch on file type:

```ts
import { findDescriptor, getFormat, NIFTIFormat } from 'neuroimjs'

// Match an existing file to a descriptor (null if nothing matches or the file is missing).
const fmt = await findDescriptor('sub-01_T1w.nii.gz')
fmt instanceof NIFTIFormat // true
fmt?.fileFormat // 'NIFTI'
fmt?.headerEncoding // 'gzip'

// Look one up by name: NIFTI, NIFTI_GZ, NIFTI_DUAL, NIFTI_DUAL_GZ, AFNI.
getFormat('NIFTI_GZ').headerExtension // 'nii.gz'
```

Each `FileFormat` records its header and data extensions and encodings, and its `fileMatches(path)` checks that the header and data files exist on disk. The descriptors do no decoding.

## Legacy aliases

`read_vol(input)` and `write_vol(vol, path)` are thin snake_case wrappers kept for backward compatibility. `read_vol` is `readVol` with default options. `write_vol` is `writeVol` with no options, so it gzips a `.nii.gz` path and not a `.nii` path. Prefer `readVol` / `writeVol` in new code.

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

## See also

- **[Volumes & Slices](/guide/volumes)**: the volume classes these readers return.
- **[Time Series](/guide/time-series)**: 4D containers, including streaming and in-place access to large runs.
