<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-02-13 | Updated: 2026-02-13 -->

# searchlight

## Purpose
Searchlight analysis — a neuroimaging technique that applies a function to local spherical neighborhoods at each voxel. Includes iterators, worker pool for parallelism, and strategies (random, clustered, bootstrap).

## Key Files

| File | Description |
|------|-------------|
| `searchlight.ts` | Core API: `searchlightIterator`, `searchlightCoords`, `randomSearchlight`, `clusteredSearchlight`, `bootstrapSearchlight` |
| `WorkerPool.ts` | Web Worker pool for parallel searchlight computation |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `workers/` | Web Worker implementation for searchlight computation |

## For AI Agents

### Working In This Directory
- Searchlight iterates over voxels, extracting a local neighborhood for each.
- `WorkerPool` distributes computation across Web Workers for parallelism.
- Functions accept a user-provided callback that processes each neighborhood.
- Works with both 3D volumes and 4D time-series data.

### Testing Requirements
- Tests in `tests/searchlight.test.ts`.

<!-- MANUAL: -->
