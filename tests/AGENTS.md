<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-02-13 | Updated: 2026-02-13 -->

# tests

## Purpose
Unit and integration tests for neuroimjs using Vitest with jsdom environment. Tests mirror the `src/` directory structure. PIXI.js and canvas are mocked for display tests.

## Key Files

| File | Description |
|------|-------------|
| `setup.ts` | Global test setup — PIXI.js and canvas mocks |
| `Axis.test.ts` | Tests for AxisSet1D/2D/3D, NamedAxis |
| `NeuroSpace.test.ts` | Coordinate system and affine transform tests |
| `DenseNeuroVol.test.ts` | Dense volume construction, access, slicing |
| `NeuroVol.test.ts` | NeuroVol interface contract tests |
| `NeuroVec.test.ts` | 4D time-series data tests |
| `LogicalNeuroVol.test.ts` | Computed view volume tests |
| `ClusteredNeuroVol.test.ts` | Parcellated volume tests |
| `CoordinateTransformer.test.ts` | Grid/world/image coordinate conversion tests |
| `SliceTransform.test.ts` | Slice extraction transform tests |
| `VolLayer.test.ts` | Volume display layer tests |
| `VolStack.test.ts` | Multi-layer stack tests |
| `ROI.test.ts` | Region-of-interest factory and access tests |
| `io.test.ts` | NIfTI I/O read/write round-trip tests |
| `stats.test.ts` | Statistical operation tests |
| `searchlight.test.ts` | Searchlight analysis tests |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `display/` | Display system tests (ImageLayer, SliceView, viewers) |
| `hypervec/` | NeuroHyperVec 5D tests |
| `resampling/` | Resampler interpolation tests |
| `spatial/` | Spatial filter tests |
| `utils/` | Utility class tests (LRUCache, pools, ScatterField) |
| `vec/` | EnhancedNeuroVec tests |
| `volume/` | Orthogonal slice extraction tests |
| `benchmarks/` | Performance benchmarks (ImageLayer pooling) |
| `mocks/` | Shared mock implementations (pixi.mock.ts) |
| `scripts/` | Diagnostic scripts for manual testing |
| `data/` | Test fixtures and sample NIfTI volumes |

## For AI Agents

### Working In This Directory
- Always import mocks from `tests/mocks/` when testing display code.
- Test data lives in `tests/data/volumes/` — the MNI152 template is available.
- Use `TestVolumeFactory` from `src/testing/` for creating test volumes.
- Vitest with jsdom — no real DOM or WebGL available.

### Testing Requirements
```bash
npm test                          # Run all tests
npm run test:specific -- path     # Run specific test
npm run test:debug                # Verbose, no coverage
```

### Common Patterns
- `describe`/`it` blocks with Vitest assertions
- Factory helpers for test volumes and spaces
- Mock PIXI objects for display layer tests

<!-- MANUAL: -->
