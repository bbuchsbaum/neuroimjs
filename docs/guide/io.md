# Reading & Writing (I/O)

neuroimjs reads and writes NIfTI (`.nii`, `.nii.gz`) in both Node and the browser. The high-level API lives in `neuroimjs`; the low-level NIfTI codec is also exported if you need it.

::: info
The I/O layer applies NIfTI intensity scaling (`scl_slope` / `scl_inter`) and handles endianness on read. AFNI support is still limited — NIfTI is the supported path. See the [Stability matrix](/guide/stability) for the full picture.
:::

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
