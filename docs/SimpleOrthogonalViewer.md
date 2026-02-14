# SimpleOrthogonalViewer – Quick Start

`SimpleOrthogonalViewer` is a minimal programmatic wrapper around the existing
`OrthogonalImageViewer`. It renders three synchronized orthogonal views
(axial on top; sagittal + coronal on bottom by default) and exposes a small API
to add/remove layers, set colormaps and ranges, and move the crosshair using
world (LPI, mm) coordinates. No widgets are included, so you can wire your own UI.

## Importing

```ts
import {
  read_vol,
  VolLayer,
  VolStack,
  ColorMapFactory,
  SimpleOrthogonalViewer,
} from 'neuroimjs';
```

## Minimal Example

```ts
// 1) Acquire a parent container in your page
const container = document.getElementById('viewer')!;

// 2) Load a volume (LPI world coordinates)
const volume = await read_vol('tests/data/volumes/tpl-MNI152NLin2009aAsym_res-1_T1w.nii.gz');

// 3) Create a base anatomical layer and stack
const gray = ColorMapFactory.createGrayscale();
const anatomical = new VolLayer('anatomical', volume, gray, null, [0, 0], 1.0);
const stack = new VolStack(anatomical);

// 4) Create the viewer
const viewer = await SimpleOrthogonalViewer.create(container, stack, {
  layout: 'top-bottom',      // or 'left-tall'
  showCrosshair: true,       // crosshair overlay
  showSlider: false,         // no built-in sliders
  gapPx: 8,                  // grid gap between the three canvases
});

// 5) Move to a world coordinate (mm; LPI)
viewer.setWorldCoord([0, -18, 22]);

// 6) Add an overlay layer (e.g., same volume with a "hot" colormap)
const hot = ColorMapFactory.createHot();
const overlay = new VolLayer('overlay', volume, hot, [0, 100], [20, 80], 0.5);
viewer.addLayer(overlay);

// 7) Update overlay properties later
viewer.updateLayer('overlay', {
  colormap: 'RdYlBu',   // any preset name supported by ColorMapFactory
  range: [0, 120],
  threshold: [30, 90],
  alpha: 0.7,
  visible: true,
});

// 8) Toggle crosshair at runtime
viewer.setCrosshairVisible(false);
viewer.setCrosshairVisible(true);

// 9) Access canvases (e.g., for thumbnails)
const axialCanvas = viewer.getCanvas('axial');

// 10) Set background color of canvases
viewer.setBackground(0x222222);

// 11) Cleanup
// viewer.dispose();
```

## API Summary

```ts
class SimpleOrthogonalViewer {
  static async create(
    container: HTMLElement,
    volStack: VolStack,
    options?: {
      layout?: 'left-tall' | 'top-bottom';
      showCrosshair?: boolean;
      showSlider?: boolean;
      gapPx?: number;
    }
  ): Promise<SimpleOrthogonalViewer>;

  // Coordinate control
  setWorldCoord(coord: number[]): void;
  getWorldCoord(): number[];

  // Layer control
  addLayer(layer: VolLayer): void;                 // adds to underlying VolStack
  removeLayer(layerId: string): void;
  updateLayer(layerId: string, params: {
    colormap?: ColorMap | string;                  // preset name or ColorMap
    range?: [number, number];
    threshold?: [number, number];
    alpha?: number;
    visible?: boolean;
  }): void;

  // View utilities
  getCanvas(view: 'axial' | 'sagittal' | 'coronal'): HTMLCanvasElement;
  setBackground(color: number): void;              // canvas CSS background per view
  setCrosshairVisible(visible: boolean): void;     // runtime toggle

  // Lifecycle
  dispose(): void;
}
```

## Layout Modes

- `'left-tall'` (legacy)
  - Axial occupies the left column (both rows)
  - Coronal (top-right) and Sagittal (bottom-right)

- `'top-bottom'` (default in the wrapper)
  - Axial spans the full width in the top row
  - Sagittal and Coronal split the bottom row horizontally

## Notes

- Crosshair & mapping are correct-by-construction: the underlying viewers use
  SliceTransform / CoordinateTransformer internally for world↔image mapping, and
  render with medical Y‑up (negative Y scale in PIXI). You don’t need to do
  any additional transforms for overlays placed in local image pixels.
- For custom overlays/annotations, use the SliceLayer interface and add them
  directly to each sub-view (exposed via OrthogonalImageViewer if you need lower-level access).

