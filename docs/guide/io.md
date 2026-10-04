# Reading & Writing (I/O)

neuroimjs reads single-file **NIfTI** (`.nii`, `.nii.gz`; NIfTI-1 and NIfTI-2) and writes NIfTI-1. The two entry points expose different readers:

| | Node (`neuroimjs`) | Browser (`neuroimjs/browser`) |
|---|---|---|
| Read a 3D volume or one frame | `readVol(path \| ArrayBuffer, opts?)` (async) | `readNiftiArrayBuffer(ArrayBuffer, opts?)` (sync) |
| Read several files / a 4D run | `readVolList`, `readVec` | — |
| Header only | `readHeader(path)` | — |
| Write | `writeVol`, `writeVec` | — |

All readers apply `scl_slope`/`scl_inter`, byte-swap big-endian data, and build the `NeuroSpace` from the file's affine. A slope of 0 (or NaN) is treated as 1, but a non-zero `scl_inter` is still added. This departs from the NIfTI spec, which ignores both fields when the slope is 0.

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
- `readVol` cannot load an **unscaled `UINT16` or `UINT32`** file: it throws `Unsupported TypedArray type`. With intensity scaling active, both load as `FloatNeuroVol`. In the browser, `readNiftiArrayBuffer` handles both (see below).
- `readVec` returns a **`BigNeuroVec` whose `space.dim` is `[T, X, Y, Z]`**. It re-reads the file once per frame and stages data in temporary files. It also loses geometry. Up to 100 frames, the 4D space keeps the voxel spacing and origin but drops the affine, and the time axis gets spacing 1 (the TR is not read). Above 100 frames, or with `useBigVec: true`, the space is `[1, 1, 1, 1]` spacing at origin `[0, 0, 0, 0]`. Read [Time Series → BigNeuroVec](/guide/time-series#bigneurovec-what-readvec-returns) before using it.

## Node: write

```ts
import { readVol, writeVol, readHeader } from 'neuroimjs'

const vol = await readVol('sub-01_T1w.nii.gz')

await writeVol(vol, 'out.nii') // uncompressed, datatype follows the volume (INT16 here)
await writeVol(vol, 'out.nii.gz', { compress: true }) // gzip — must be requested explicitly
await writeVol(vol, 'out_f32.nii.gz', { compress: true, dataType: 'FLOAT32' })

const hdr = await readHeader('out_f32.nii.gz')
hdr.datatype // 'FLOAT32'
```

::: warning Compression is not inferred from the file name
`writeVol` gzips only when you pass `{ compress: true }`. `writeVol(vol, 'x.nii.gz')` without it writes **uncompressed** bytes under a `.gz` name. `readVol` and `readHeader` then fail on that file, because they gunzip anything named `.nii.gz`.
:::

`writeVol` options:

- `dataType` (`'FLOAT32'`, `'FLOAT64'`, `'INT8'`, `'UINT8'`, `'INT16'`, `'UINT16'`, `'INT32'`, `'UINT32'`) converts on write. Integer targets are rounded and clamped to the type's range.
- `onProgress` reports progress.
- `format` accepts only NIfTI names (`'NIFTI'`, `'NIFTI_GZ'`); anything else throws. With `format: 'NIFTI_GZ'` the output is gzipped as well.

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

## Browser: `readNiftiArrayBuffer`

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

`readNiftiArrayBuffer` is exported **only** from `neuroimjs/browser`. It is not in the main `neuroimjs` entry, because `nifti-reader-js` is ESM-only and a static import would break `require('neuroimjs')`. It returns the stored datatype (`Int16NeuroVol`, `FloatNeuroVol`, …). Scaled data come back as `Float64NeuroVol`, and `UINT32` is promoted to `Float64NeuroVol`. `UINT16` stays a `UInt16NeuroVol`, which loads fine but cannot be sliced or displayed yet; convert it to `FloatNeuroVol` first ([Volumes & Slices](/guide/volumes#dense-volumes)). It throws on invalid input, an out-of-range `index`, or truncated image data. To window the result for display, see the loader in [Getting Started](/guide/getting-started).

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

`read_vol(input)` and `write_vol(vol, path)` are thin snake_case wrappers kept for backward compatibility. `read_vol` is `readVol` with default options. `write_vol` is `writeVol` with no options, so it never compresses. Prefer `readVol` / `writeVol` in new code.

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
