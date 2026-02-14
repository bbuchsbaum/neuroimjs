<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-02-13 | Updated: 2026-02-13 -->

# cluster

## Purpose
Cluster boundary detection and superpixel segmentation for volumetric data. Provides SNIC (Simple Non-Iterative Clustering) for supervoxel generation.

## Key Files

| File | Description |
|------|-------------|
| `ClusterBoundaries.ts` | Cluster boundary detection and visualization support |
| `snic.ts` | SNIC superpixel/supervoxel algorithm implementation |

## For AI Agents

### Working In This Directory
- `snic.ts` implements the SNIC algorithm for spatial clustering of voxels.
- `ClusterBoundaries.ts` extracts boundary voxels between clusters for rendering.
- Used by `ClusterLayer` in the display system and statistical analysis.

### Testing Requirements
- Test through `ClusteredNeuroVol` tests and display integration tests.

<!-- MANUAL: -->
