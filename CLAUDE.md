# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build Commands

```bash
npm run build              # Full build: CJS + ESM + types
npm run build:vite         # Browser bundle (ES/UMD) via Vite
npm run build:cjs          # CommonJS only
npm run build:esm          # ESM only
npm run build:types        # Type declarations only
npm run build:quick        # Quick CJS build for development
```

## Testing

```bash
npm test                   # Run all tests (Vitest)
npm run test:watch         # Watch mode
npm run test:types         # Type checking only (tsc --noEmit)
npm run test:specific -- src/path/to/test  # Run specific test file
npm run test:debug         # Verbose output, no coverage
```

Tests use Vitest with jsdom environment. PIXI.js and canvas are mocked in `tests/setup.ts`.

## Linting & Formatting

```bash
npm run lint               # ESLint on src and tests
npm run format             # Prettier
```

## Demos

```bash
npm run demo:simple-ortho  # Classic 3-view orthogonal viewer
npm run demo:composable    # All composable view demos
npm run demo:single-view   # Single axial view
npm run demo:two-view      # Two synchronized views
npm run demo:multi-panel   # Custom multi-panel layout
npm run demo:ortho         # Node.js orthogonal slice extraction
```

## Architecture Overview

### Core Data Structures

- **NeuroSpace** (`src/geometry/NeuroSpace.ts`): Defines spatial coordinate systems with dimensions, spacing, origin, and affine transforms. Handles grid-to-world coordinate conversions.

- **NeuroVol** (`src/volume/NeuroVol.ts`): Interface for 3D volumetric data. Key implementations:
  - `DenseNeuroVol`: Dense typed array storage
  - `SparseNeuroVol`: Sparse voxel storage
  - `ClusteredNeuroVol`: Labeled/parcellated volumes
  - `LogicalNeuroVol`: Computed views over volumes

- **NeuroVec** (`src/vec/`): 4D time-series data structures for fMRI. Includes enhanced versions with detrending and temporal filtering.

- **NeuroHyperVec** (`src/hypervec/`): 5D+ hyperdimensional data structures.

### Display System

The display layer uses PIXI.js for WebGL rendering and MobX for reactive state.

**Model-View-Controller Pattern:**
- `SliceModel`: Reactive state for current slice index and 3D coordinate
- `SliceView`: PIXI-based rendering with layer composition
- `SliceController`: Pointer/keyboard event handling

**Layer System:**
- `SliceLayer` interface for custom rendering layers
- `ImageLayer`: Primary volume slice rendering with color mapping
- `VolLayer`: Volume data + rendering parameters (colormap, threshold, opacity)
- `VolStack`: Container of multiple aligned VolLayers

**Viewer Hierarchy:**
- `SingleSliceViewer`: Individual orientation view with event API (composable)
- `ViewSynchronizer`: Coordinate sync across multiple SingleSliceViewer instances
- `SliceViewer`: Facade tying model/view/controller together
- `OrthogonalImageViewer`: Lower-level 3-view orchestration
- `SimpleOrthogonalViewer`: High-level 3-view layout

### Coordinate Systems

Three coordinate spaces are used throughout:
1. **Grid coordinates**: Integer voxel indices [i, j, k]
2. **World coordinates**: Physical space in mm via affine transform
3. **Image coordinates**: Pixel positions in rendered slice

`CoordinateTransformer` handles conversions between these spaces.

### Axis Orientation

- `AxisSet3D`: Defines 3D orientation (i, j, k axes as named anatomical directions)
- Standard orientations exported: `AXIAL_LPI`, `CORONAL_LIP`, `SAGITTAL_AIL`
- `NeuroSpace.reorient()` transforms between orientations

### I/O

- `src/io/nifti.ts`: NIfTI read/write with pako compression
- `src/io/io.ts`: Higher-level I/O API (`readVol`, `writeVol`, `readHeader`)
- `src/io/formats.ts`: Format detection and adapters

### Processing Modules

- `src/spatial/`: Gaussian, bilateral, guided filtering; morphological operations
- `src/resampling/`: Interpolation (nearest, linear, cubic, sinc)
- `src/searchlight/`: Searchlight analysis with iterators and worker pool
- `src/stats/`: Statistical operations, clustering, partitioning
- `src/roi/`: ROI creation from spheres, masks, or coordinates

## Key Patterns

- MobX observables for reactive UI state
- Factory methods (`create()`, `fromNifti()`) for async initialization
- TypedArray backing for all volume data
- Event emitters for view coordination
- Dependency injection via interfaces in `src/display/interfaces/`

## Browser vs Node

- Browser entry: `src/browser.ts` (excludes Node-specific code)
- Node entry: `src/index.ts`
- Canvas module is mocked for browser bundles
