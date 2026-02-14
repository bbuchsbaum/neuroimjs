<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-02-13 | Updated: 2026-02-13 -->

# spatial

## Purpose
3D spatial filtering operations for volumes. Includes Gaussian smoothing, bilateral filtering, guided filtering, and morphological operations (erosion, dilation, opening, closing).

## Key Files

| File | Description |
|------|-------------|
| `ISpatialFilter.ts` | Interface and option types: `ISpatialFilter`, `BilateralFilterOptions`, `GuidedFilterOptions`, `MorphOperation` |
| `Kernel3D.ts` | 3D convolution kernel construction (Gaussian, box, custom) |
| `SpatialFilter.ts` | `SpatialFilter` implementation and `addSpatialFilteringToNeuroVol` mixin |

## For AI Agents

### Working In This Directory
- `SpatialFilter` operates on `NeuroVol` instances, producing new filtered volumes.
- `addSpatialFilteringToNeuroVol` augments volumes with `.smooth()`, `.bilateral()`, etc.
- Kernels are separable where possible for performance.
- All filtering preserves volume dimensions and spacing.

### Testing Requirements
- Tests in `tests/spatial/SpatialFilter.test.ts`.

<!-- MANUAL: -->
