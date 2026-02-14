<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-02-13 | Updated: 2026-02-13 -->

# display

## Purpose
WebGL-based slice visualization system built on PIXI.js v8 and MobX. Implements an MVC pattern with reactive state, layer-based rendering, color mapping, and multi-view coordination. This is the largest module in neuroimjs.

## Key Files

| File | Description |
|------|-------------|
| `SliceModel.ts` | Reactive state: current slice index, 3D coordinate (MobX observable) |
| `SliceView.ts` | PIXI-based rendering with layer composition |
| `SliceController.ts` | Pointer/keyboard event handling for slice navigation |
| `SliceViewer.ts` | Facade tying Model + View + Controller together |
| `SingleSliceViewer.ts` | Composable single-orientation viewer with event API |
| `ViewSynchronizer.ts` | Coordinate sync across multiple SingleSliceViewer instances |
| `OrthogonalImageViewer.ts` | Lower-level 3-view orchestration |
| `SimpleOrthogonalViewer.ts` | High-level 3-view layout with controls |
| `ImageLayer.ts` | Primary volume slice rendering layer with color mapping |
| `SliceLayer.ts` | `SliceLayer` interface for custom rendering layers |
| `VolLayer.ts` | Volume data + rendering parameters (colormap, threshold, opacity) |
| `VolStack.ts` | Container of multiple aligned VolLayers |
| `FacadeVolLayer.ts` | Simplified VolLayer facade |
| `ColorMap.ts` | Color mapping implementation |
| `ColorMapFactory.ts` | Factory for built-in colormaps (grayscale, hot, cool, etc.) |
| `ColorMapResolver.ts` | Resolves colormap by name or specification |
| `CoordinateTransformer.ts` | Converts between grid, world, and image coordinates |
| `CoordinateValidation.ts` | Coordinate bounds checking and validation |
| `CrossHair.ts` | Crosshair overlay rendering |
| `DepthEnhancedLayer.ts` | Depth-enhanced rendering layer |
| `ClusterLayer.ts` | Cluster/label overlay rendering |
| `SliceTransform.ts` | Slice extraction transforms |
| `DisplayUtils.ts` | Display helper utilities |
| `EventEmitter.ts` | Typed event emitter for display components |
| `ViewerFactory.ts` | Factory for creating viewer instances |
| `ViewerStateInfo.ts` | Viewer state serialization |
| `PositionLabel.ts` | Coordinate position label overlay |
| `MedicalCoordinateContainer.ts` | Medical orientation labels (L/R, A/P, S/I) |
| `NumericalUtils.ts` | Numerical precision utilities |
| `ImageSlice.ts` | Image slice data container |
| `pixi-v8-compat.d.ts` | PIXI.js v8 type compatibility shim |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `alignment/` | Multi-layer alignment strategies (see `alignment/AGENTS.md`) |
| `interfaces/` | DI interfaces: ISliceModel, ISliceView, etc. (see `interfaces/AGENTS.md`) |
| `types/` | Display type definitions (see `types/AGENTS.md`) |
| `logging/` | Configurable logging system (see `logging/AGENTS.md`) |
| `memory/` | Texture memory management (see `memory/AGENTS.md`) |
| `utils/` | Display utilities like debounce (see `utils/AGENTS.md`) |
| `workers/` | Web Worker slice extraction (see `workers/AGENTS.md`) |
| `__tests__/` | Unit and integration tests for display components |

## For AI Agents

### Working In This Directory
- This is the most complex module. Understand the MVC pattern before making changes.
- **Model** (`SliceModel`): MobX observables. Changes trigger reactive updates.
- **View** (`SliceView`): PIXI container with layers. Each layer is a `SliceLayer`.
- **Controller** (`SliceController`): Pointer events → model updates.
- Two viewer architectures coexist:
  1. **Legacy**: `SliceViewer` → `OrthogonalImageViewer` → `SimpleOrthogonalViewer`
  2. **Composable** (preferred): `SingleSliceViewer` + `ViewSynchronizer`
- `VolLayer` wraps a volume with display params. `VolStack` holds multiple for overlays.
- PIXI.js v8 is used — check `pixi-v8-compat.d.ts` for type adjustments.

### Testing Requirements
- Unit tests in `__tests__/` and `tests/display/`.
- PIXI must be mocked (`tests/mocks/pixi.mock.ts`).
- Integration tests in `__tests__/integration/` test multi-component scenarios.
- E2E tests in `e2e/` verify visual rendering in a real browser.

### Common Patterns
- MobX `@observable` / `@computed` / `@action` decorators on model classes
- Layer composition via `SliceLayer` interface
- Factory methods for viewer creation
- Event emitter pattern for cross-component communication

<!-- MANUAL: -->
