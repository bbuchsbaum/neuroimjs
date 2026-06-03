# neuroimjs

A comprehensive neuroimaging library for JavaScript/TypeScript that provides tools for loading, processing, visualizing, and analyzing brain imaging data in the browser and Node.js.

> 📖 **[Documentation & live demos →](https://bbuchsbaum.github.io/neuroimjs/)** — interactive brain viewers, guides, and the full API reference.
>
> ⚠️ **Pre-1.0 (`0.1.0`).** The viewer stack and core data structures are dependable; some I/O and processing paths have known issues. See the **[Stability matrix](https://bbuchsbaum.github.io/neuroimjs/guide/stability)** before depending on a feature.

## Features

- 🧠 **Volume Processing** - Load and manipulate NIfTI, AFNI, and other neuroimaging formats
- 📊 **4D+ Data Support** - Handle time-series and high-dimensional neuroimaging data
- 🎨 **Interactive Visualization** - WebGL-based 2D slice viewers with PIXI.js
- 🔄 **Spatial Filtering** - Advanced filtering, resampling, and interpolation
- 📈 **Statistical Analysis** - Searchlight analysis, clustering, and statistical operations
- 🏗️ **Composable Views** - Build custom viewer layouts for external applications

## Installation

```bash
npm install neuroimjs
```

## Quick Start

### Basic Volume Loading and Visualization

```typescript
import {
  readVol, VolLayer, VolStack, ColorMapFactory, SimpleOrthogonalViewer,
} from 'neuroimjs';

// Load a NIfTI volume (Node path here; in the browser pass an ArrayBuffer)
const vol = await readVol('brain.nii.gz');
const range = vol.getRange();

// Wrap it in a display layer stack
const stack = new VolStack(
  new VolLayer('t1', vol, ColorMapFactory.createGrayscale({ range }), range)
);

// Create a 3-view orthogonal viewer
const viewer = await SimpleOrthogonalViewer.create(
  document.getElementById('viewer-container'),
  stack
);
```

### Composable Views (NEW!)

Create custom layouts with individual slice views:

```typescript
import {
  readVol, VolLayer, VolStack, ColorMapFactory,
  SingleSliceViewer, ViewSynchronizer,
} from 'neuroimjs';

// Build a display stack from a volume (see "Basic Volume Loading" above)
const vol = await readVol('brain.nii.gz');
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

// Read/write NIfTI files (intensity scaling + endianness handled on read)
import { readVol, writeVol } from 'neuroimjs';
const vol = await readVol('input.nii.gz');
await writeVol(vol, 'output.nii.gz');
```

### 4D Time-Series Data

```typescript
import { readVec } from 'neuroimjs';

// Load 4D fMRI data (Node path; in the browser pass an ArrayBuffer)
const vec = await readVec('fmri.nii.gz');

// Inspect the time-series at a voxel
const series = vec.getSeries(32, 32, 20);
```

> Temporal preprocessing (`detrend`, `temporalFilter`) is available on the enhanced
> vec classes (`EnhancedDenseNeuroVec`, `FileBackedNeuroVec`). See the
> [docs](https://bbuchsbaum.github.io/neuroimjs/guide/concepts).

### Spatial Operations

```typescript
import { SpatialFilter } from 'neuroimjs';

const filter = new SpatialFilter();

// Gaussian smoothing
const smoothed = await filter.gaussianBlur(volume, { sigma: 2.0 });

// Bilateral filtering (edge-preserving)
const filtered = await filter.bilateralFilter(volume, {
  sigmaSpace: 2.0,
  sigmaIntensity: 0.1
});
```

### Statistical Analysis

```typescript
import { searchlightIterator } from 'neuroimjs';

// Searchlight analysis
for await (const sphere of searchlightIterator(volume, { radius: 3 })) {
  // Analyze voxels in sphere
  const result = analyzeROI(sphere.voxels);
  results.set(sphere.center, result);
}
```

## Visualization Components

### Pre-composed Viewers

- **SimpleOrthogonalViewer** - Standard 3-view layout (axial, sagittal, coronal)
- **OrthogonalImageViewer** - Lower-level 3-view orchestration

### Composable Views (NEW)

- **SingleSliceViewer** - Individual orientation views with events
- **ViewSynchronizer** - Coordinate synchronization across views
- **SliceLayer** - Custom rendering layer interface

See [Composable Views Guide](docs/COMPOSABLE_VIEWS.md) for detailed documentation.

## API Documentation

### Display Components

- [Composable Views Guide](docs/COMPOSABLE_VIEWS.md) - Custom layouts and coordination
- [SimpleOrthogonalViewer](docs/SimpleOrthogonalViewer.md) - Standard 3-view viewer

### Volume Processing

- `DenseNeuroVol` - Dense 3D volume storage
- `SparseNeuroVol` - Sparse volume storage
- `ClusteredNeuroVol` - Clustered/labeled volumes
- `NeuroSpace` - Spatial coordinate system

### 4D Data

- `NeuroVec` - 4D time-series data
- `EnhancedNeuroVec` - Enhanced 4D with preprocessing
- `FileBackedNeuroVec` - Memory-mapped 4D data
- `NeuroHyperVec` - 5D+ hyperdimensional data

### I/O

- `readVol` / `writeVol` - NIfTI file I/O
- `VolStack` - Multi-layer volume management
- `readHeader` - Read NIfTI headers without loading data

### Spatial Processing

- `SpatialFilter` - Filtering operations (Gaussian, bilateral, median, morphology)
- `Resampler` - Resampling and interpolation (nearest, linear, cubic, sinc)

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
