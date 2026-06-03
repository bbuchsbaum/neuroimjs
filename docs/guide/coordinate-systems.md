# Coordinate Systems

Neuroimaging lives or dies by coordinates. neuroimjs is explicit about which space you're in at all times. There are three you'll meet constantly, plus a slice space used during rendering.

## The three spaces

| Space | Units | Meaning |
|---|---|---|
| **Grid (voxel)** | integer `[i, j, k]` | Indices into the data array. |
| **World (physical)** | millimeters `[x, y, z]` | Real anatomical position, via the affine. |
| **Image (screen)** | pixels | Where a voxel lands in the rendered slice. |

`NeuroSpace` owns the **grid ↔ world** transform; `CoordinateTransformer` handles **world ↔ image** for a given view.

```ts
// Grid → world (mm)
const world = space.gridToCoord([32, 32, 20])

// World (mm) → grid
const voxel = space.coordToGrid([0, 0, 0])
```

## World convention: NIfTI LPI

The viewer treats **LPI (Left-Posterior-Inferior)** as the canonical world frame — the NIfTI convention:

- **X** — negative = patient's left, positive = right
- **Y** — negative = posterior, positive = anterior
- **Z** — negative = inferior, positive = superior

The origin `(0, 0, 0)` usually sits at the anterior commissure or the volume center, depending on acquisition.

Standard orientations are exported as constants:

```ts
import { AXIAL_LPI, CORONAL_LIP, SAGITTAL_AIL } from 'neuroimjs'
```

## The three views

When you take a 2D slice from a 3D volume, two axes lie *in-plane* and one is *pinned* at a slice index:

| View | In-plane (i, j) | Pinned (k) |
|---|---|---|
| **Axial** (LPI) | L→R, P→A | I→S |
| **Coronal** (LIP) | L→R, I→S | P→A |
| **Sagittal** (AIL) | A→P, I→S | L→R |

## Image / screen space

The screen follows web conventions — origin top-left, X right, Y down — and the viewer applies a Y-flip so anatomy displays right-way-up. The full chain from a click to an anatomical coordinate:

```
screen pixel
   └─► image coordinate (CoordinateTransformer.screenToImageCoord)
        └─► slice coordinate in mm
             └─► volume voxel (sliceToVolumeCoord)
                  └─► world mm (NeuroSpace.gridToCoord)
```

In practice the viewers do this for you and hand you the result:

```ts
viewer.onPointerMove(({ worldCoord, imageCoord }) => {
  // worldCoord: [x, y, z] in mm, or null when outside the brain
})
```

## Best practices

1. **Show world (mm) to users**, not voxel indices.
2. **Name variables for their space** — `worldCoord`, `voxelCoord`, `sliceCoord`.
3. **Don't assume axis directions** — the affine may include flips or rotations; read it from the header.
4. **Account for spacing** — anisotropic voxels affect every transform and every radius (this is the root of a known [searchlight caveat](/guide/stability)).

## Common pitfalls

- **Mixing mm and voxels.** A radius of "3" means very different things in each.
- **Forgetting bounds checks.** Use the `*Safe` transform variants when accepting user input.
- **Floating-point equality.** Compare coordinates with an epsilon.

## References

- [NIfTI coordinate systems](https://nifti.nimh.nih.gov/nifti-1/documentation/nifti1fields/nifti1fields_pages/qsform.html)
- [NiBabel: coordinate systems](https://nipy.org/nibabel/coordinate_systems.html)
- [FSL orientation explained](https://fsl.fmrib.ox.ac.uk/fsl/fslwiki/Orientation)
