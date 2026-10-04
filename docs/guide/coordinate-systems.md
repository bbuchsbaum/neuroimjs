# Coordinate Systems

Neuroimaging lives or dies by coordinates. neuroimjs is explicit about which space you're in at all times. There are three you'll meet constantly, plus a slice space used during rendering.

## The three spaces

| Space | Units | Meaning |
|---|---|---|
| **Grid (voxel)** | `[i, j, k]` (integer at voxel centres) | Indices into the data array. |
| **World (physical)** | millimeters `[x, y, z]` | Real anatomical position, via the affine. |
| **Image (slice)** | in-plane voxel units (`n + 0.5` at voxel centres) | Position within the rendered 2D slice, before zoom, pan and fit-to-screen scaling map it to screen pixels. See [Image / slice space](#image-slice-space). |

`NeuroSpace` owns the **grid ↔ world** transform; `CoordinateTransformer` handles **slice ↔ grid ↔ world** for a given view.

```ts
// Grid → world (mm)
const world = space.gridToCoord([32, 32, 20])

// World (mm) → grid (fractional; round before indexing)
const voxel = space.coordToGrid([0, 0, 0])
```

## World convention

World coordinates are the NIfTI scanner/template frame: **x increases toward the subject's right, y toward anterior, z toward superior**. MNI coordinates read the usual way — `[-42, -58, -12]` is left, posterior, inferior of the origin. The origin `(0, 0, 0)` usually sits at the anterior commissure (MNI/Talairach) or wherever the scanner put it.

neuroimjs calls this orientation **LPI**, following the neuroim2/AFNI habit of naming each axis by the end it *starts* from: x runs Left→Right, y Posterior→Anterior, z Inferior→Superior. This is the same frame NiBabel calls RAS+ (named by the end the axis points *toward*). Keep the two naming schemes apart when reading other tools' docs.

## Axes: `NamedAxis` and `AxisSet3D`

A `NamedAxis` is one anatomical direction with a unit vector; an `AxisSet3D` assigns a named axis to each of `i`, `j`, `k`. A volume's `NeuroSpace` carries one (derived from the NIfTI affine on load), and each viewer view is defined by one.

```ts
import { NeuroSpace, AxisSet3D, NamedAxis, AXIAL_LPI } from 'neuroimjs'

const space = new NeuroSpace([91, 109, 91], [2, 2, 2], [-90, -126, -72], AxisSet3D.AXIAL_LPI)

space.axes.toString()                  // 'AxisSet3D: LEFT_RIGHT, POST_ANT, INF_SUP'
NamedAxis.LEFT_RIGHT.direction         // [1, 0, 0]  — x grows toward the right
NamedAxis.POST_ANT.direction           // [0, 1, 0]  — y grows toward anterior
space.whichDim(NamedAxis.INF_SUP)      // 2          — which array dimension runs I↔S

AxisSet3D.fromStr('LPI') === AXIAL_LPI // true
```

The six named axes are `LEFT_RIGHT`, `RIGHT_LEFT`, `POST_ANT`, `ANT_POST`, `INF_SUP` and `SUP_INF`. `whichDim` ignores direction, so `ANT_POST` and `POST_ANT` find the same dimension. `AxisSet3D` has static members for the common orientations (`AXIAL_LPI`, `AXIAL_RAS`, `CORONAL_LIP`, `SAGITTAL_AIL`, …); `AxisSet3D.fromStr('RPI')` parses a three-letter code in the same start-end naming.

::: warning `AXIAL_RAS` is not NiBabel's RAS+
The letters name where each axis *starts*. `AXIAL_RAS` is `RIGHT_LEFT, ANT_POST, SUP_INF`, so its axes point toward left, posterior and inferior: in NiBabel's terms it is **LPI+**, the exact opposite of RAS+ on all three axes. The NIfTI/NiBabel RAS+ world frame is neuroimjs's `AXIAL_LPI`.
:::

The three you need for display are exported as constants:

```ts
import { AXIAL_LPI, CORONAL_LIP, SAGITTAL_AIL } from 'neuroimjs'
```

`AXIAL_LPI` etc. are also reachable as `AxisSet3D.AXIAL_LPI`, which is the form to use with the `neuroimjs/browser` bundle (it exports the classes but not the standalone constants).

## The three views

When you take a 2D slice from a 3D volume, two axes lie *in-plane* (`i`, `j`) and one is *pinned* at a slice index (`k`):

| View | Axis set | In-plane (i, j) | Pinned (k) |
|---|---|---|---|
| **Axial** | `AXIAL_LPI` | L→R, P→A | I→S |
| **Coronal** | `CORONAL_LIP` | L→R, I→S | P→A |
| **Sagittal** | `SAGITTAL_AIL` | A→P, I→S | L→R |

`i` maps to screen x and `j` to screen y, flipped so that anatomy displays right-way-up (superior/anterior at the top). Axial and coronal views therefore use the neurological convention: the subject's left is on the screen's left. The orientation labels (`showOrientationLabels`) are derived from the live transform, so they always agree with what is drawn.

## Image / slice space

The renderer draws one texel per voxel, so the slice's own coordinate space ("image" or "local slice" coordinates) is in **voxel units of the two in-plane axes**, with voxel centres at `n + 0.5`. A flipped in-plane axis maps index `v` to `dim − 1 − v`. Zoom, pan and the fit-to-screen scale sit on top of that.

The full chain from a click to an anatomical coordinate:

```
screen pixel
   └─► image coordinate          CoordinateTransformer.screenToImageCoord (undoes zoom, pan, flip)
        └─► volume voxel [i,j,k]  CoordinateTransformer.sliceToVolumeCoord  (k = current slice)
             └─► world mm          NeuroSpace.gridToCoord
```

### `CoordinateTransformer`

A `CoordinateTransformer` binds a `NeuroSpace`, a view's `AxisSet3D` and the pinned slice index. Construct one to map between a volume and a view's slice plane without a viewer — for example to place your own marks on a slice:

```ts
import { CoordinateTransformer } from 'neuroimjs'

const voxel = space.coordToGrid([0, 0, 0])                 // [45, 63, 36]
const axial = new CoordinateTransformer(space, AXIAL_LPI, Math.round(voxel[2]))

const px = axial.volumeToLocalSliceCoord(voxel)            // { x: 45.5, y: 63.5 }
axial.sliceToVolumeCoord(px)                               // [45, 63, 36]
axial.sliceToWorldCoord(px)                                // [0, 0, 0]

axial.sliceToVolumeCoordSafe({ x: -50, y: 10 })                  // null (outside)
axial.sliceToVolumeCoordSafe({ x: -50, y: 10 }, { clamp: true }) // [0, 9.5, 36]
```

Call `setSliceIndex(k)` when the pinned slice changes. `screenToImageCoord`, `screenToVolumeCoord` and `screenToVolumeCoordSafe` additionally take the PIXI container the slice is drawn in; inside a [custom layer](/guide/custom-layers) you rarely need them, because the viewer already resolves pointer positions for you. `CoordinateTransformer` is exported from the main `neuroimjs` entry; from `neuroimjs/browser`, get a view's transformer with `SingleSliceViewer.getCoordinateTransformer()` (typed as the narrower `ICoordinateTransformer`: `screenToImageCoord`, `sliceToVolumeCoord`, `sliceToWorldCoord`, `setSliceIndex`).

## Coordinates from the viewers

In practice the viewers do the chain for you. For the pointer, use a [`SingleSliceViewer`](/guide/composable-views):

```ts
import { SingleSliceViewer } from 'neuroimjs/browser'

const axial = await SingleSliceViewer.createAxial(axialEl, stack)

axial.onPointerMove(({ worldCoord, volumeCoord }) => {
  if (!worldCoord || worldCoord.length !== 3) return
  console.log('mm', worldCoord.map((v) => v.toFixed(1)), 'voxel', volumeCoord?.map(Math.round))
})

// The same transformer the view uses for picking:
const t = axial.getCoordinateTransformer()
t.sliceToWorldCoord({ x: 10.5, y: 20.5 })
```

`worldCoord` and `volumeCoord` are continuous (fractional voxels), and when the pointer is over the canvas but outside the image they are **clamped to the nearest edge of the volume** rather than set to `null`. Round `volumeCoord` before indexing, and test the image bounds yourself if "outside the brain" matters.

Three details of the payloads, all from the view resolving the pointer on an animation-frame throttle while emitting events straight from the raw pointer event:

- **They lag one frame.** Each payload is the position computed for an earlier event. The first `pointerMove` arrives with `imageCoord`, `volumeCoord` and `worldCoord` all `null`.
- **`onPointerDown` reports the last hover position**, not the click point. The crosshair does move to the click point; read that with `onCoordChange`.
- **An unresolvable position gives `[]`**, not `null`, for `volumeCoord` and `worldCoord` (hence the `length !== 3` guard above).

`SimpleOrthogonalViewer` has no pointer-move API. It reports the **crosshair** position, which changes on click, keyboard and programmatic moves:

```ts
viewer.onCoordChange((coord) => {
  console.log('crosshair (mm):', coord, 'z =', viewer.getValue('z-stat', coord))
})
```

## Best practices

1. **Show world (mm) to users**, not voxel indices.
2. **Name variables for their space** — `worldCoord`, `voxelCoord`, `sliceCoord`.
3. **Don't assume axis directions** — the affine may include flips or rotations; read `space.axes` rather than assuming LPI.
4. **Account for spacing** — anisotropic voxels affect every transform and every radius (this is the root of a known [searchlight caveat](/guide/stability)).

## Common pitfalls

- **Mixing mm and voxels.** A radius of "3" means very different things in each.
- **Off-by-half in slice space.** Voxel centres sit at `n + 0.5` in image coordinates; voxel *indices* are integers.
- **Forgetting bounds checks.** Use the `*Safe` transform variants when accepting user input; they return `null` (or clamp, with `{ clamp: true }`).
- **Floating-point equality.** Compare coordinates with an epsilon.
- **`setLPICoord`.** On `SimpleOrthogonalViewer` it equals `setWorldCoord` for LPI-stored volumes, but for other storage orders it maps through voxel indices, not anatomy. Use `setWorldCoord`.

## References

- [NIfTI coordinate systems](https://nifti.nimh.nih.gov/nifti-1/documentation/nifti1fields/nifti1fields_pages/qsform.html)
- [NiBabel: coordinate systems](https://nipy.org/nibabel/coordinate_systems.html)
- [FSL orientation explained](https://fsl.fmrib.ox.ac.uk/fsl/fslwiki/Orientation)
