<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-02-13 | Updated: 2026-02-13 -->

# geometry

## Purpose
Coordinate system foundation for neuroimjs. Defines axis orientation conventions, the `NeuroSpace` class for spatial coordinate systems with affine transforms, and helper functions for slice extraction across orientations.

## Key Files

| File | Description |
|------|-------------|
| `Axis.ts` | `AxisSet1D`, `AxisSet2D`, `AxisSet3D`, `NamedAxis` — axis naming and orientation constants (`AXIAL_LPI`, `CORONAL_LIP`, `SAGITTAL_AIL`) |
| `NeuroSpace.ts` | `NeuroSpace` — spatial coordinate system with dimensions, spacing, origin, affine matrix, grid-to-world conversions, reorientation |
| `SliceHelpers.ts` | Slice extraction utilities: `extractSliceForView`, `getSliceAxisIndex`, `getMaxSliceIndex`, `getCenterSliceIndex` |
| `AnatomicalPoint.js` | Legacy anatomical point helper (JavaScript) |

## For AI Agents

### Working In This Directory
- `NeuroSpace` is the fundamental spatial class used by all volume types. Changes here affect the entire library.
- Standard orientations (`AXIAL_LPI`, `CORONAL_LIP`, `SAGITTAL_AIL`) are exported from `Axis.ts` and used throughout the display system.
- Affine transforms follow NIfTI sform/qform conventions (4x4 matrix, RAS+ default).
- `SliceHelpers.ts` bridges geometry with the display system — used by `SliceCoordinator` and viewers.

### Testing Requirements
- Tests in `tests/Axis.test.ts` and `tests/NeuroSpace.test.ts`.
- Verify grid-to-world and world-to-grid round-trips.
- Test reorientation between standard orientations.

<!-- MANUAL: -->
