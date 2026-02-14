<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-02-13 | Updated: 2026-02-13 -->

# alignment

## Purpose
Multi-layer alignment strategies for overlaying images with different resolutions, field-of-view, or spacing. All strategies prioritize physical dimension matching (mm) over pixel matching to preserve anatomical proportions.

## Key Files

| File | Description |
|------|-------------|
| `IAlignmentStrategy.ts` | `IAlignmentStrategy` interface, `AlignmentResult`, `AlignmentOptions` — strategy contract |
| `AlignmentManager.ts` | `AlignmentManager` — selects and applies the appropriate strategy for a given pair of slices |
| `CenterAlignmentStrategy.ts` | Centers target on reference, scaling by spacing ratio |
| `CornerAlignmentStrategy.ts` | Aligns from top-left corner, scaling by spacing ratio |
| `OverlapAlignmentStrategy.ts` | Aligns by maximizing physical overlap between slices |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `__tests__/` | Unit tests for alignment strategies and manager |

## For AI Agents

### Working In This Directory
- Scale factors are `referenceSpacing / targetSpacing` — preserves physical dimensions, not pixel counts.
- `AlignmentManager` auto-selects strategy based on slice properties. Can be overridden.
- New strategies must implement `IAlignmentStrategy` (align, applyAlignment, getName, canHandle).
- Used by `ImageLayer` when rendering overlay volumes with different spaces.

### Testing Requirements
- Tests in `__tests__/AlignmentManager.test.ts` and `__tests__/AlignmentStrategies.test.ts`.
- Integration tests in `../src/display/__tests__/integration/MultiLayerAlignment.test.ts`.
- Verify physical dimension preservation across different spacing combinations.

<!-- MANUAL: -->
