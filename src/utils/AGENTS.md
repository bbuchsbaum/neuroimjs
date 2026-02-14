<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-02-13 | Updated: 2026-02-13 -->

# utils

## Purpose
General-purpose utility classes for caching, object pooling, async data building, and resource management.

## Key Files

| File | Description |
|------|-------------|
| `Cache.ts` | Simple key-value cache |
| `LRUCache.ts` | Least-recently-used eviction cache |
| `ContainerPool.ts` | Object pool for PIXI containers to reduce GC pressure |
| `SpritePool.ts` | Object pool for PIXI sprites |
| `ScatterFieldBuilder.ts` | `buildScatterField` — constructs scatter field visualizations |
| `ScatterFieldAsync.ts` | `buildScatterFieldAsync` — async version with Web Worker support |
| `ScatterFieldWorker.ts` | Web Worker for scatter field computation |
| `Downloader.ts` | File download utility |
| `LazyList.ts` | Lazy evaluation list |

## For AI Agents

### Working In This Directory
- `LRUCache` is used by the display system for texture and slice caching.
- `ContainerPool` and `SpritePool` reduce PIXI object allocation during rendering.
- `ScatterFieldBuilder` is part of the public API for building scatter visualizations.
- These are internal utilities — most are not directly exported.

### Testing Requirements
- Tests in `tests/utils/` (LRUCache, ContainerPool, SpritePool, ScatterFieldBuilder).

<!-- MANUAL: -->
