# Reading & Writing (I/O)

neuroimjs reads and writes NIfTI (`.nii`, `.nii.gz`) in both Node and the browser. The high-level API lives in `neuroimjs`; the low-level NIfTI codec is also exported if you need it.

::: info
The I/O layer applies NIfTI intensity scaling (`scl_slope` / `scl_inter`) and handles endianness on read. AFNI support is still limited — NIfTI is the supported path. See the [Stability matrix](/guide/stability) for the full picture.
:::

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

## Node.js: read from disk

```ts
import { readVol, readVolList, readVec, writeVol } from 'neuroimjs'

// A single 3D volume
const vol = await readVol('subject01_T1w.nii.gz')

// A specific volume from a 4D file
const frame = await readVol('bold.nii.gz', { index: 5 })

// Every frame of a 4D file as a list of 3D volumes
const frames = await readVolList('bold.nii.gz')

// A 4D time-series as a NeuroVec
const vec = await readVec('bold.nii.gz')
```

`readVol` accepts a progress callback for large files:

```ts
const vol = await readVol('big.nii.gz', {
  onProgress: (p) => console.log(`${Math.round(p * 100)}%`),
})
```

### Writing

```ts
import { writeVol } from 'neuroimjs'

await writeVol(vol, 'output.nii.gz')   // gzip inferred from .gz extension
```

## Inspect a header without loading data

```ts
import { readHeader } from 'neuroimjs'

const info = await readHeader('subject01_T1w.nii.gz')
console.log(info.dim, info.spacing, info.datatype)
```

## Browser: read from a URL or File

`readVol` also accepts an `ArrayBuffer`, so it works client-side:

```ts
const buffer = await (await fetch('/data/brain.nii.gz')).arrayBuffer()
const vol = await readVol(buffer)
```

For interactive viewers, parsing with `nifti-reader-js` and building a `FloatNeuroVol` yourself gives you the finest control over datatype handling and the display window. That full recipe is in **[Getting Started](/guide/getting-started)** and the **[Single Slice View example](/examples/single-view)**.

Reading a user-selected file:

```ts
input.addEventListener('change', async () => {
  const buffer = await input.files![0].arrayBuffer()
  const vol = await readVol(buffer)
  // …build a VolStack and mount a viewer
})
```

## Formats

| Format | Read | Write |
|---|---|---|
| NIfTI-1 / NIfTI-2 (`.nii`, `.nii.gz`) | ✅ | ✅ |
| NIfTI dual-file (`.hdr`/`.img`) | ✅ | ✅ |
| AFNI (`.HEAD`/`.BRIK`) | ⚠️ limited — see [stability](/guide/stability) | — |

Format detection and adapters are exposed via `getFormat`, `findDescriptor`, `NIFTIFormat`, etc., if you need to drive the codec directly.

## Low-level codec

For full control, the raw NIfTI read/write functions are exported:

```ts
import { read_vol, write_vol } from 'neuroimjs'
```

Most applications should prefer the `readVol` / `writeVol` wrappers above.

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
