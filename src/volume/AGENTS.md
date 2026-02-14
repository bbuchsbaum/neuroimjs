<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-02-13 | Updated: 2026-02-13 -->

# volume

## Purpose
3D volumetric data structures — the core data model for neuroimjs. Defines the `NeuroVol` interface and its implementations for dense, logical, and clustered volumes. Also provides orthogonal slice extraction and voxel iteration.

## Key Files

| File | Description |
|------|-------------|
| `NeuroVol.ts` | `NeuroVol` interface — common contract for all 3D volume types |
| `DenseNeuroVol.ts` | `DenseNeuroVol` — TypedArray-backed dense volume with typed variants (Float32, Int16, etc.) |
| `LogicalNeuroVol.ts` | `LogicalNeuroVol` — computed view over a volume (lazy evaluation) |
| `ClusteredNeuroVol.ts` | `ClusteredNeuroVol` — labeled/parcellated volume with cluster metadata |
| `NeuroSlice.ts` | `NeuroSlice` — 2D slice extracted from a volume |
| `NeuroIm.ts` | Factory functions: `createNeuroVol`, `createNeuroSlice` |
| `orthogonalSlices.ts` | `extractOrthogonalSlices`, `extractAxialSlice`, etc. — slice extraction by orientation |
| `VoxelIterator.ts` | Iterator over voxel coordinates in a volume |
| `Resampler.ts` | Volume-specific resampling utilities |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `__tests__/` | Unit tests for DenseNeuroVol slice extraction |

## For AI Agents

### Working In This Directory
- `NeuroVol` is the central interface — all volume types implement it. Adding methods affects all implementations.
- `DenseNeuroVol` is the workhorse — used for NIfTI loading and most processing.
- Use factory methods in `NeuroIm.ts` for construction, not direct constructors.
- `orthogonalSlices.ts` is heavily used by the display system for slice rendering.
- All volumes store data in TypedArrays. Access via `get(i,j,k)` or flat index.

### Testing Requirements
- Tests in `tests/DenseNeuroVol.test.ts`, `tests/NeuroVol.test.ts`, `tests/LogicalNeuroVol.test.ts`, `tests/ClusteredNeuroVol.test.ts`.
- Test voxel access, slicing, coordinate transforms, and data integrity.

<!-- MANUAL: -->
