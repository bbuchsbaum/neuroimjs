<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-02-13 | Updated: 2026-02-13 -->

# interfaces

## Purpose
Dependency injection interfaces for decoupling display component implementations. Enables testability and alternative implementations of the MVC display system.

## Key Files

| File | Description |
|------|-------------|
| `index.ts` | Barrel export for all interfaces |
| `ISliceModel.ts` | `ISliceModel` — observable slice state contract (slice index, coordinate) |
| `ISliceView.ts` | `ISliceView` — rendering contract (update, addLayer, resize) |
| `ISliceController.ts` | `ISliceController` — input handling contract (pointer, keyboard events) |
| `ICoordinateTransformer.ts` | `ICoordinateTransformer` — coordinate conversion contract (grid ↔ world ↔ image) |

## For AI Agents

### Working In This Directory
- These interfaces are the public API contracts for the display system.
- Exported as types from `src/index.ts` — consumers code against these, not concrete classes.
- Adding methods to interfaces is a breaking change — affects all implementations.
- Mock implementations can be created for testing by implementing these interfaces.

<!-- MANUAL: -->
