<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-02-13 | Updated: 2026-02-13 -->

# memory

## Purpose
Texture and resource memory management for the PIXI.js rendering system. Tracks GPU memory usage and implements eviction policies to prevent memory leaks.

## Key Files

| File | Description |
|------|-------------|
| `MemoryManager.ts` | `MemoryManager` — tracks texture allocations, enforces memory limits, triggers eviction |
| `TextureMemoryConsumer.ts` | `TextureMemoryConsumer` — interface for objects that consume texture memory |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `__tests__/` | MemoryManager unit tests |

## For AI Agents

### Working In This Directory
- `MemoryManager` is a singleton that tracks all texture allocations.
- Components that allocate PIXI textures should implement `TextureMemoryConsumer`.
- Eviction uses LRU policy — least recently accessed textures are freed first.
- Critical for preventing WebGL context loss from GPU memory exhaustion.

### Testing Requirements
- Tests in `__tests__/MemoryManager.test.ts`.

<!-- MANUAL: -->
