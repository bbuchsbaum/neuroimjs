<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-02-13 | Updated: 2026-02-13 -->

# roi

## Purpose
Region-of-interest (ROI) creation and manipulation. Supports spherical, cuboid, mask-based, coordinate-based, and index-based ROI definitions. Includes connected component labeling and searchlight ROI generation.

## Key Files

| File | Description |
|------|-------------|
| `ROI_base.ts` | `ROI` abstract base class |
| `ROI_improved.ts` | `ROICoords`, `ROIVol`, `ROIVolWindow`, `ROIVec`, `ROIVecWindow` — concrete ROI types |
| `ROI_factories.ts` | Factory functions: `sphericalROI`, `cuboidROI`, `squareROI`, `roiFromMask`, `roiFromIndices`, `roiFromCoords` |
| `ROI.ts` | Legacy ROI implementation |
| `ConnectedComponents.ts` | Connected component labeling algorithm |
| `Coordinates.ts` | Coordinate manipulation utilities for ROIs |
| `Searchlight.ts` | Searchlight-specific ROI generation |

## For AI Agents

### Working In This Directory
- Prefer the factory functions in `ROI_factories.ts` for creating ROIs.
- `ROI_improved.ts` has the modern implementations. `ROI.ts` is legacy.
- ROIs reference a `NeuroSpace` for coordinate context.
- `ROIVol` extracts data from 3D volumes; `ROIVec` from 4D time-series.

### Testing Requirements
- Tests in `tests/ROI.test.ts`.
- Verify ROI voxel counts, boundary conditions, and data extraction.

<!-- MANUAL: -->
