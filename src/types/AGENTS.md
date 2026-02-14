<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-02-13 | Updated: 2026-02-13 -->

# types

## Purpose
Additional TypeScript type definitions beyond the core `src/types.ts`. Contains slice access strategy types used by the display and coordination systems.

## Key Files

| File | Description |
|------|-------------|
| `SliceAccess.ts` | `SliceAccessStrategy`, `SliceAccessConfig`, `SliceAccessResult`, `SliceAccessError`, `VolumeSliceDimensions`, `SliceExtractionParams`, `VolumeCompatibilityResult` |

## For AI Agents

### Working In This Directory
- These types define how slice extraction is configured and validated.
- Used by `SliceCoordinator` and the display system.
- Separate from `src/types.ts` because they are domain-specific rather than primitive.

<!-- MANUAL: -->
