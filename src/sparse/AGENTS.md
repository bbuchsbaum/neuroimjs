<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-02-13 | Updated: 2026-02-13 -->

# sparse

## Purpose
Sparse volume storage for volumes where most voxels have a default value (e.g., statistical maps, masks). Memory-efficient alternative to DenseNeuroVol.

## Key Files

| File | Description |
|------|-------------|
| `SparseNeuroVol.ts` | `SparseNeuroVol` — stores only non-default voxels as index-value pairs |

## For AI Agents

### Working In This Directory
- `SparseNeuroVol` implements the `NeuroVol` interface.
- Uses a map of flat indices to values. Default value is configurable (usually 0).
- Ideal for overlays, masks, and thresholded statistical maps.
- Used by the display system for overlay rendering.

### Testing Requirements
- Tests in `tests/SparseNeuroVolOverlay.test.ts`.

<!-- MANUAL: -->
