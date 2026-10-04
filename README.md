# neuroimjs

A comprehensive neuroimaging library for JavaScript/TypeScript that provides tools for loading, processing, visualizing, and analyzing brain imaging data in the browser and Node.js.

> 📖 **[Documentation & live demos →](https://bbuchsbaum.github.io/neuroimjs/)** — interactive brain viewers, guides, and the full API reference.
>
> ⚠️ **Pre-1.0.** Minor releases can still change the API; see [CHANGELOG.md](CHANGELOG.md). The viewers, core data structures and NIfTI I/O are tested and dependable. Some modules are experimental or missing (for example, there is no AFNI reader); the **[Stability matrix](https://bbuchsbaum.github.io/neuroimjs/guide/stability)** lists the status of each.

## Features

- 🧠 **NIfTI I/O** - Read NIfTI-1/2 (`.nii`, `.nii.gz`) in the browser and Node, write NIfTI-1 from Node, with intensity scaling and affine geometry
- 📊 **3D/4D Data** - Dense, sparse, clustered and logical volumes; 4D time series; experimental 5D+ containers
- 🎨 **Interactive Visualization** - WebGL-based 2D slice viewers with PIXI.js
- 🔄 **Spatial Filtering** - Advanced filtering, resampling, and interpolation
- 📈 **Statistical Analysis** - Searchlight analysis, clustering, and statistical operations
- 🏗️ **Composable Views** - Build custom viewer layouts for external applications
- 👥 **Group Overlay Review** - Browse per-subject maps over a template with live group summaries

## Installation

```bash
npm install neuroimjs
```

## Quick Start

### Basic Volume Loading and Visualization

```typescript
import {
  readNiftiArrayBuffer, VolLayer, VolStack, ColorMapFactory, SimpleOrthogonalViewer,
} from 'neuroimjs/browser';

// Load a NIfTI volume in the browser (gzip, scaling, byte order and affine handled)
const response = await fetch('brain.nii.gz');
const vol = readNiftiArrayBuffer(await response.arrayBuffer());
const range = vol.getRange();

// Wrap it in a display layer stack
const stack = new VolStack(
  new VolLayer('t1', vol, ColorMapFactory.createGrayscale({ range }), range)
);

// Create a 3-view orthogonal viewer
const viewer = await SimpleOrthogonalViewer.create(
  document.getElementById('viewer-container')!,
  stack
);
```

In Node, read from disk with `readVol('brain.nii.gz')` from `neuroimjs` instead.

### Composable Views

Create custom layouts with individual slice views:

```typescript
import {
  readNiftiArrayBuffer, VolLayer, VolStack, ColorMapFactory,
  SingleSliceViewer, ViewSynchronizer,
} from 'neuroimjs/browser';

// Build a display stack from a volume (see "Basic Volume Loading" above)
const vol = readNiftiArrayBuffer(await (await fetch('brain.nii.gz')).arrayBuffer());
const range = vol.getRange();
const volStack = new VolStack(
  new VolLayer('t1', vol, ColorMapFactory.createGrayscale({ range }), range)
);

// Create individual views
const axial = await SingleSliceViewer.createAxial(axialContainer, volStack);
const sagittal = await SingleSliceViewer.createSagittal(sagContainer, volStack);
const coronal = await SingleSliceViewer.createCoronal(coronalContainer, volStack);

// Synchronize them
const sync = ViewSynchronizer.createOrthogonal(axial, sagittal, coronal);

// Listen to events
axial.onCoordChange(coord => {
  console.log('Coordinate changed:', coord);
});
```

**Why use composable views?**
- 🎯 Place views in any custom panel layout
- 🔗 Wire views across different windows or applications
- ⚙️ Full control over synchronization behavior
- 📡 Event-driven coordination with type-safe APIs

See the [Composable Views Guide](https://bbuchsbaum.github.io/neuroimjs/guide/composable-views) for complete documentation.

## Examples

### View Live Demos

```bash
# All composable view demos
npm run demo:composable

# Individual demos
npm run demo:single-view      # Single axial view
npm run demo:two-view         # Two synchronized views
npm run demo:multi-panel      # Multi-panel custom layout

# Classic orthogonal viewer
npm run demo:simple-ortho
```

See [examples/README.md](examples/README.md) for more details.

## Core Concepts

### Volume Data

```typescript
import { FloatNeuroVol, NeuroSpace } from 'neuroimjs';

// Create a volume programmatically — constructor takes (space, data)
const space = new NeuroSpace([64, 64, 64], [3, 3, 3]);
const volume = new FloatNeuroVol(space, data);

// Read/write NIfTI files in Node (intensity scaling + endianness handled on read)
import { readVol, writeVol } from 'neuroimjs';
const vol = await readVol('input.nii.gz');
await writeVol(vol, 'output.nii.gz', { compress: true }); // gzip only with compress: true
```

### 4D Time-Series Data

```typescript
import { readVec } from 'neuroimjs';

// Load 4D fMRI data (Node, from a file path)
const vec = await readVec('fmri.nii.gz');

// vec.dim is time-first: [T, X, Y, Z]. The 3D geometry (with the affine) is
// on vec.volumeSpace; getVolume(t) returns 3D volumes on that space.
const series = vec.getSeries(32, 32, 20); // T values
```

> Temporal preprocessing (`detrend`, `temporalFilter`) is available on the enhanced
> vec classes (`EnhancedDenseNeuroVec`, `EnhancedFloat32NeuroVec`) and `FileBackedNeuroVec`. See the
> [docs](https://bbuchsbaum.github.io/neuroimjs/guide/concepts).

### Spatial Operations

```typescript
import { SpatialFilter } from 'neuroimjs';

const filter = new SpatialFilter(volume);

// Gaussian smoothing (sigma in voxels; pass [sx, sy, sz] for anisotropic data)
const smoothed = filter.gaussianBlur(2.0);

// Bilateral filtering (edge-preserving)
const filtered = filter.bilateralFilter({
  spatialSigma: 2.0,   // voxels
  intensitySigma: 50   // intensity units
});
```

### Statistical Analysis

```typescript
import { searchlightIterator, type ROIVolWindow } from 'neuroimjs';

// Searchlight analysis: radius in mm; nonzero restricts centres to the mask
const spheres = searchlightIterator(mask, 6, { eager: true, nonzero: true }) as ROIVolWindow[];
for (const sphere of spheres) {
  // sphere.coords: voxel coordinates in the sphere; read your data there
  const values = sphere.coords.map(([i, j, k]) => dataVol.getAt(i, j, k));
  const result = analyzeROI(values);
}
```

## Visualization Components

### Pre-composed Viewers

- **SimpleOrthogonalViewer** - Standard 3-view layout (axial, sagittal, coronal)
- **OrthogonalImageViewer** - Lower-level 3-view orchestration

### Composable Views

- **SingleSliceViewer** - Individual orientation views with events
- **ViewSynchronizer** - Coordinate synchronization across views
- **SliceLayer** - Custom rendering layer interface

See the [Composable Views guide](https://bbuchsbaum.github.io/neuroimjs/guide/composable-views) for detailed documentation.

## API Documentation

The [API reference](https://bbuchsbaum.github.io/neuroimjs/api/) is generated from the source. Guides:

### Display Components

- [Viewers](https://bbuchsbaum.github.io/neuroimjs/guide/viewers) - `SimpleOrthogonalViewer`, the standard 3-view viewer
- [Composable Views](https://bbuchsbaum.github.io/neuroimjs/guide/composable-views) - Custom layouts and coordination
- [Multi-Layer Alignment](https://bbuchsbaum.github.io/neuroimjs/guide/alignment) - Overlays on different voxel grids
- [Group Overlay Review](https://bbuchsbaum.github.io/neuroimjs/guide/overlay-review) - `SubjectOverlayViewer` and `OverlayReviewPanel`

### Volume Processing

- `DenseNeuroVol` - Dense 3D volume storage
- `SparseNeuroVol` - Sparse volume storage
- `ClusteredNeuroVol` - Clustered/labeled volumes
- `NeuroSpace` - Spatial coordinate system

### 4D Data

- `NeuroVec` - 4D time-series data
- `EnhancedDenseNeuroVec` - 4D with temporal preprocessing
- `BigNeuroVec` - 4D storage in memory or backed by a file (what `readVec` returns)
- `FileBackedNeuroVec` - 4D data loaded on demand through a callback, with an LRU cache
- `DenseNeuroHyperVec` - 5D+ data (experimental)

### I/O

- `readNiftiArrayBuffer` - NIfTI bytes to a volume in the browser (`neuroimjs/browser`)
- `readVol` / `writeVol` / `readVec` / `writeVec` - NIfTI file I/O in Node
- `readHeader` - Read NIfTI headers without loading data
- `getVolumeGeometry` / `assertSameVolumeGeometry` - Inspect and compare volume geometry

For Node processes that should not load the viewer stack (pixi.js, mobx,
lit), such as an Electron main process, import from the viewer-free
subpaths `neuroimjs/io`, `neuroimjs/slices` and `neuroimjs/geometry`. See
[Viewer-free imports](https://bbuchsbaum.github.io/neuroimjs/guide/io#viewer-free-imports).

### Spatial Processing

- `SpatialFilter` - Filtering operations (Gaussian, bilateral, median, morphology)
- `Resampler` - Resampling and interpolation (nearest, linear, cubic, Lanczos)

### Statistical Operations

- `searchlightIterator` - Searchlight analysis
- `StatFunctions` - Mean, std, correlation, t-tests, etc.
- `splitBlocks` / `splitClusters` - Volume partitioning

### ROI Tools

- `sphericalROI` / `cuboidROI` - Create geometric ROIs
- `roiFromMask` - Create ROI from binary mask
- `ROIVol` / `ROIVec` - ROI-based analysis

## Development

```bash
# Install dependencies
npm install

# Build library
npm run build

# Run tests
npm test

# Run specific tests
npm run test:specific -- src/path/to/test

# NIfTI conformance against nibabel-generated fixtures
npm run test:conformance

# Browser (Playwright) tests
npm run test:e2e

# Type checking
npm run test:types

# Linting
npm run lint
```

## Browser Support

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+

Requires:
- ES modules
- WebGL 2.0
- Async/await
- OffscreenCanvas (optional, for better performance)

## Contributing

Contributions are welcome! To get started:

1. Fork the repository and create a feature branch
2. Install dependencies with `npm install`
3. Make your changes and add tests where appropriate
4. Run `npm test` and `npm run lint` to ensure everything passes
5. Open a pull request describing your changes

## License

MIT

## Related Projects

- [nilearn](https://nilearn.github.io/) - Python neuroimaging library
- [NiBabel](https://nipy.org/nibabel/) - Python NIfTI I/O
- [AFNI](https://afni.nimh.nih.gov/) - Analysis of Functional NeuroImages
- [FSL](https://fsl.fmrib.ox.ac.uk/) - FMRIB Software Library

## Citation

If you use neuroimjs in your research, please cite this repository:

```bibtex
@software{neuroimjs,
  author = {Buchsbaum, Bradley},
  title = {neuroimjs: A neuroimaging library for JavaScript},
  url = {https://github.com/bbuchsbaum/neuroimjs},
  license = {MIT}
}
```

## Acknowledgments

Built with:
- [PIXI.js](https://pixijs.com/) - WebGL rendering
- [MobX](https://mobx.js.org/) - Reactive state management
- [nifti-reader-js](https://github.com/rii-mango/NIFTI-Reader-JS) - NIfTI parsing
- [pako](https://github.com/nodeca/pako) - Compression
