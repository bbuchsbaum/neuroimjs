<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-02-13 | Updated: 2026-02-13 -->

# vec

## Purpose
4D time-series data structures for fMRI and similar temporal neuroimaging data. Extends the 3D volume concept with a time dimension, supporting dense, sparse, mapped, file-backed, and enhanced (detrended/filtered) variants.

## Key Files

| File | Description |
|------|-------------|
| `INeuroVec.ts` | `INeuroVec` interface — contract for all 4D vector types. Defines `DetrendMethod`, `TemporalFilter`, options. |
| `NeuroVec.ts` | `NeuroVec` base class and typed variants: `DenseNeuroVec`, `Float32NeuroVec`, `Float64NeuroVec`, `Int16NeuroVec`, `Uint8NeuroVec` |
| `EnhancedNeuroVec.ts` | `EnhancedDenseNeuroVec` — adds detrending and temporal filtering on top of dense storage |
| `FileBackedNeuroVec.ts` | `FileBackedNeuroVec` — lazy loading from file, memory-efficient for large datasets |
| `MappedNeuroVec.ts` | `MappedNeuroVec` — computed/transformed view over another NeuroVec |
| `SparseNeuroVec.ts` | `SparseNeuroVec` — sparse 4D storage for masked data |

## For AI Agents

### Working In This Directory
- `INeuroVec` is the core interface. Implementations must support `get(i,j,k,t)` and time-series access at voxel coordinates.
- `DenseNeuroVec` stores all timepoints in a flat TypedArray with [x,y,z,t] layout.
- `EnhancedDenseNeuroVec` wraps `DenseNeuroVec` with preprocessing — detrending and bandpass filtering.
- These types are used by searchlight analysis, statistics, and I/O (`readVec`).

### Testing Requirements
- Tests in `tests/NeuroVec.test.ts` and `tests/vec/EnhancedNeuroVec.test.ts`.
- Verify time-series extraction, detrending correctness, and sparse access patterns.

<!-- MANUAL: -->
