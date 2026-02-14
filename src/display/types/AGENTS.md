<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-02-13 | Updated: 2026-02-13 -->

# types

## Purpose
Display-specific type definitions for layer updates, worker communication, pointer events, viewer parameters, and cluster visualization.

## Key Files

| File | Description |
|------|-------------|
| `display.ts` | `LayerUpdateParams`, `ExtractSliceData`, `ProcessSliceData`, `SlicePointerEvent`, `ViewerUpdateParams`, `ClusterParams`, worker data types, type guards |
| `events.ts` | Display event type definitions |
| `visualization.ts` | Visualization configuration types |

## For AI Agents

### Working In This Directory
- `LayerUpdateParams` is used by `VolLayer` and control panels for property updates.
- Worker data types (`ExtractSliceData`, `ProcessSliceData`, `ResampleData`) define the worker message protocol.
- Type guards (`isSliceResultData`, `isExtractSliceData`) help discriminate union types at runtime.
- `SlicePointerEvent` wraps PIXI pointer events for consistent access to global coordinates.

<!-- MANUAL: -->
