<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-02-13 | Updated: 2026-02-13 -->

# core

## Purpose
Cross-cutting coordination logic that bridges geometry and display systems.

## Key Files

| File | Description |
|------|-------------|
| `SliceCoordinator.ts` | `SliceCoordinator` — coordinates slice extraction across multiple volumes with different spaces, handling alignment and index mapping |

## For AI Agents

### Working In This Directory
- `SliceCoordinator` ensures consistent slicing when overlaying volumes with different dimensions/spacing.
- Depends on `NeuroSpace`, `SliceHelpers`, and `SliceAccess` types.
- Used by the display system to synchronize multi-layer views.

### Testing Requirements
- Test through integration tests and viewer tests.

<!-- MANUAL: -->
