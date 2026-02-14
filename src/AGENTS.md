<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-02-13 | Updated: 2026-02-13 -->

# src

## Purpose
All source code for neuroimjs. Organized into domain modules: geometry/coordinate systems, volumetric data structures, 4D/5D vectors, I/O, spatial processing, display/visualization, and utility libraries.

## Key Files

| File | Description |
|------|-------------|
| `index.ts` | Node.js public API — exports all modules |
| `browser.ts` | Browser public API — display-safe subset only |
| `types.ts` | Core type aliases (TypedArray, Point3D, Shape3D, NumericType) and error classes |
| `App.ts` / `App.tsx` | Demo application entry (not part of library API) |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `geometry/` | Coordinate systems, axes, NeuroSpace (see `geometry/AGENTS.md`) |
| `volume/` | 3D volumetric data: NeuroVol, DenseNeuroVol, slicing (see `volume/AGENTS.md`) |
| `vec/` | 4D time-series: NeuroVec variants (see `vec/AGENTS.md`) |
| `vector/` | Large-scale vectors: BigNeuroVec (see `vector/AGENTS.md`) |
| `hypervec/` | 5D+ hyperdimensional data (see `hypervec/AGENTS.md`) |
| `sparse/` | Sparse volume storage (see `sparse/AGENTS.md`) |
| `io/` | NIfTI read/write, format detection (see `io/AGENTS.md`) |
| `display/` | PIXI.js rendering, viewers, layers, MVC (see `display/AGENTS.md`) |
| `controls/` | Lit-based web component UI controls (see `controls/AGENTS.md`) |
| `core/` | Cross-cutting coordination (see `core/AGENTS.md`) |
| `spatial/` | 3D spatial filters: Gaussian, bilateral, morphology (see `spatial/AGENTS.md`) |
| `resampling/` | Interpolation and resampling (see `resampling/AGENTS.md`) |
| `searchlight/` | Searchlight analysis with worker pool (see `searchlight/AGENTS.md`) |
| `stats/` | Statistical operations and partitioning (see `stats/AGENTS.md`) |
| `roi/` | Region-of-interest creation and manipulation (see `roi/AGENTS.md`) |
| `atlas/` | Brain atlas and TemplateFlow integration (see `atlas/AGENTS.md`) |
| `cluster/` | Cluster boundaries and SNIC superpixels (see `cluster/AGENTS.md`) |
| `utils/` | Caches, pools, scatter field builders (see `utils/AGENTS.md`) |
| `types/` | Additional type definitions (SliceAccess) (see `types/AGENTS.md`) |
| `testing/` | Test volume factory utilities (see `testing/AGENTS.md`) |
| `test-migration/` | One-off test migration scripts (not library code) |

## For AI Agents

### Working In This Directory
- Every new public symbol must be exported from both `index.ts` and (if browser-safe) `browser.ts`.
- `types.ts` defines shared type aliases — prefer these over inline type definitions.
- All volume data uses TypedArrays for performance. Never use `number[]` for voxel storage.
- Factory methods (`create*`, `from*`) are the preferred construction pattern.

### Testing Requirements
- Unit tests in `tests/` mirror this directory structure.
- `npm test` runs Vitest with jsdom. PIXI.js is mocked in `tests/setup.ts`.
- Display tests may require the PIXI mock from `tests/mocks/pixi.mock.ts`.

### Common Patterns
- MobX `@observable` / `@action` for reactive display state
- Interface-first design in `display/interfaces/`
- TypedArray backing for all numeric data
- Event emitters for view coordination

<!-- MANUAL: -->
