# Reading & Writing (I/O)

neuroimjs reads NIfTI-1 and NIfTI-2 (`.nii`, `.nii.gz`) and writes NIfTI-1. There are two decoders, one per entry point:

| | Browser (`neuroimjs/browser`) | Node (`neuroimjs`) |
|---|---|---|
| Read a 3D volume | `readNiftiArrayBuffer(buffer, { index })` (synchronous) | `readVol(pathOrBuffer, { index })` (async) |
| Read a 4D series | call `readNiftiArrayBuffer` once per `index` | `readVec(path)` |
| Write | — | `writeVol`, `writeVec` |

Both decoders apply the same rules, so the same file gives the same values and geometry in either environment:

- **Intensity scaling.** Values become `stored * scl_slope + scl_inter`. A `scl_slope` of 0 or a non-finite slope means "no scaling": the stored values come back unchanged and `scl_inter` is ignored too, as in the NIfTI-1 spec and nibabel.
- **Byte order.** Big-endian files are byte-swapped on read.
- **Geometry.** The volume's `NeuroSpace` carries the full affine (`space.trans`). `space.spacing` holds the voxel sizes implied by that affine (the norms of its first three columns, as nibabel's `voxel_sizes(img.affine)` computes), not the raw `pixdim`. The axis orientation is the one nearest the affine.

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
`writeVol` and `writeVec` gzip the output only when you pass `{ compress: true }` (or `format: 'NIFTI_GZ'`). Writing to a `.nii.gz` path without it produces an uncompressed file with a `.gz` name, which `readVol` then cannot read.
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
