<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-02-13 | Updated: 2026-02-13 -->

# stats

## Purpose
Statistical operations and data partitioning for neuroimaging analysis. Provides block splitting, cluster-based operations, scaling, reduction, and centroid computation.

## Key Files

| File | Description |
|------|-------------|
| `stats.ts` | `splitBlocks`, `splitClusters`, `splitFill`, `splitReduce`, `splitScale`, `partition`, `mapValues`, `centroids`, `StatFunctions` |

## For AI Agents

### Working In This Directory
- Functions operate on volumes and arrays of values.
- `splitBlocks`/`splitClusters` partition data for parallel or grouped processing.
- `centroids` computes cluster centroids from labeled volumes.
- Used in conjunction with ROI and searchlight modules.

### Testing Requirements
- Tests in `tests/stats.test.ts`.

<!-- MANUAL: -->
