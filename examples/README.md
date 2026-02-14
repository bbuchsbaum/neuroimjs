# neuroimjs Examples

This directory contains example applications demonstrating various features of neuroimjs.

## Composable Views Examples

The composable views examples demonstrate how to create custom viewer layouts using `SingleSliceViewer` and `ViewSynchronizer` components.

### Running the Demos

#### Quick Start - View All Demos

```bash
npm run demo:composable
```

This will build the library and open an index page showing all available composable view demos.

#### Individual Demos

**Single Axial View** - Basic standalone view
```bash
npm run demo:single-view
```

**Two-View Synchronization** - Synchronized axial + sagittal views
```bash
npm run demo:two-view
```

**Multi-Panel Custom Layout** - Professional 3-view custom layout
```bash
npm run demo:multi-panel
```

### What Each Demo Shows

#### 1. Single Axial View (`single-axial-view.html`)

**Difficulty:** Beginner

Shows how to:
- Create a single standalone axial view
- Listen to coordinate change events
- Track mouse position in multiple coordinate systems
- Toggle crosshair visibility
- Handle basic controls

**Use Case:** Embedding a single view in an existing application

---

#### 2. Two-View Synchronization (`two-view-sync.html`)

**Difficulty:** Intermediate

Shows how to:
- Create multiple independent views (axial + sagittal)
- Synchronize views with `ViewSynchronizer`
- Toggle synchronization on/off at runtime
- Switch between click-only and hover synchronization modes
- Programmatically update coordinates across views

**Use Case:** Custom two-view layouts, side-by-side comparisons

---

#### 3. Multi-Panel Custom Layout (`multi-panel-custom-layout.html`)

**Difficulty:** Advanced

Shows how to:
- Create complex CSS Grid layouts
- Arrange three orthogonal views in custom configuration
- Build professional UI with information sidebars
- Handle window resizing
- Create polished user experiences

**Use Case:** Full-featured viewer applications, dashboard integrations

---

## Other Examples

### Classic Orthogonal Viewer

**Simple Orthogonal Viewer** - Pre-composed 3-view layout
```bash
npm run demo:simple-ortho
```

Shows the traditional `SimpleOrthogonalViewer` component with all three views in a fixed layout.

### Command-Line Examples

These examples run via Node.js and demonstrate programmatic usage:

```bash
npm run demo:ortho          # Orthogonal slice demo
npm run demo:extract        # Extract orthogonal slices
npm run demo:test-ortho     # Test orthogonal slicing
npm run demo:load           # Load image example
npm run demo:thumbs         # Generate thumbnails
```

## Development

### Serving Examples Locally

To serve all examples without opening a browser:

```bash
npm run serve:examples
```

Then open http://localhost:8080/examples/ in your browser.

### Building Before Running Demos

All `demo:*` commands automatically build the library first. If you want to build manually:

```bash
npm run build:vite
```

## Documentation

For detailed documentation on composable views:

- [**Composable Views Guide**](../docs/COMPOSABLE_VIEWS.md) - Complete developer guide
- [**Implementation Summary**](../docs/COMPOSABLE_VIEWS_SUMMARY.md) - Overview of changes

## Requirements

- Node.js 14+
- npm 6+
- Modern web browser with ES modules support

## Data Files

Some examples require brain imaging data. The examples use:
- `tpl-MNI152NLin2009aAsym_res-1_T1w.nii.gz` - MNI152 template (included)

## Browser Compatibility

The examples work in:
- Chrome/Edge 90+
- Firefox 88+
- Safari 14+

Requires support for:
- ES modules
- Async/await
- WebGL 2.0
- OffscreenCanvas (optional, for better performance)

## Troubleshooting

### "Failed to load module script"

Make sure you've built the library first:
```bash
npm run build:vite
```

### "Cannot find module neuroimjs"

The demos use relative imports from `../dist/`. Ensure the build output exists in the `dist/` directory.

### Examples don't open automatically

The `demo:*` scripts use the `-o` flag to open your browser. If this doesn't work:
1. Run the command manually
2. Note the port number in the output (usually 8080)
3. Open `http://localhost:8080/examples/[demo-name].html` in your browser

### CORS errors

Make sure you're using the http-server (via npm scripts), not opening files directly with `file://` protocol.

## Contributing

To add a new example:

1. Create your HTML file in the `examples/` directory
2. Add a corresponding `demo:your-example` script to `package.json`
3. Update this README with a description
4. Update `composable-views-index.html` if it's a composable views example

## License

Same as the main neuroimjs library.
