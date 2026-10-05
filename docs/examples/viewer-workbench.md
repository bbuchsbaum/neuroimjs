# Full Viewer with Controls

The complete interactive viewer: three synchronized planes, a thresholded statistical overlay on an anatomical template, the library's layer control panel, and a live coordinate/value readout. The viewer, layers, colormaps and panel are library components; the page adds the toolbar, the readout text and the synthetic overlay.

<ViewerWorkbench />

**Try it:**
- Click or drag in any plane to move the crosshair; the other two planes and the readout follow.
- Scroll over a plane to step through slices; hold <kbd>Ctrl</kbd>/<kbd>⌘</kbd> while scrolling to zoom, drag with the middle button to pan, and double-click (or *Reset zoom*) to restore the fit.
- In the panel, switch **Layer** between `z-stat` and `T1w`, change the colormap, drag the **Range** and **Threshold** handles (the link button keeps the threshold symmetric about zero), and fade the overlay with **Opacity**.
- *Jump to* moves to a named peak in MNI coordinates; *PNG* saves the axial view.

::: info About the data
The anatomy is the MNI152 2009a asymmetric T1w template (TemplateFlow `tpl-MNI152NLin2009aAsym`) at 1 mm. The overlay is a **synthetic** z-map generated in the browser (Gaussian clusters at motor and default-mode coordinates) so the page has no extra download; any NIfTI statistical map on the same or a different grid works the same way.
:::

## What it's made of

| Piece | API | Role |
|---|---|---|
| Three-plane layout | [`SimpleOrthogonalViewer`](/api/classes/SimpleOrthogonalViewer) | Axial, coronal and sagittal views sharing one crosshair |
| Layers | [`VolLayer`](/api/classes/VolLayer), [`VolStack`](/api/classes/VolStack) | Anatomy at the bottom, overlay on top, each with its own colormap, range, threshold and opacity |
| Overlay colormap | `ColorMapFactory.fromPreset('BlueRed', …)` | Diverging map; values strictly inside the threshold interval are transparent |
| Side panel | `<layer-control-panel>` ([`LayerControlPanel`](/guide/controls)) | Lit web component that edits the layers through the viewer |
| Readout | `viewer.onCoordChange`, `viewer.getValue` | World coordinate under the crosshair and each layer's voxel value there |

## Full code

```html
<div style="display: grid; grid-template-columns: 1fr 280px; height: 560px">
  <div id="viewer"></div>
  <layer-control-panel></layer-control-panel>
</div>
<p id="readout"></p>
<script type="module" src="./main.ts"></script>
```

```ts
import {
  readNiftiArrayBuffer,
  VolLayer,
  VolStack,
  ColorMapFactory,
  SimpleOrthogonalViewer,
  LayerControlPanel,
} from 'neuroimjs/browser'
import type { NeuroVol } from 'neuroimjs/browser'

// 1. Load the anatomy and the statistical map (same grid here; layers on
//    different grids are also supported).
async function load(url: string): Promise<NeuroVol> {
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`${resp.status} ${url}`)
  return readNiftiArrayBuffer(await resp.arrayBuffer())
}
const t1 = await load('/data/mni152_t1.nii.gz')
const zmap = await load('/data/zstat1.nii.gz') // your own statistical map

// Robust display window for the anatomy: 2nd–99.5th percentile.
function robustRange(vol: NeuroVol): [number, number] {
  const data = vol.getData()
  const step = Math.max(1, Math.floor(data.length / 250_000))
  const sample: number[] = []
  for (let i = 0; i < data.length; i += step) sample.push(data[i])
  sample.sort((a, b) => a - b)
  const q = (p: number) => sample[Math.floor(p * (sample.length - 1))]
  return [q(0.02), q(0.995)]
}

// 2. Stack the layers bottom-to-top.
const range = robustRange(t1)
const anat = new VolLayer('T1w', t1, ColorMapFactory.createGrayscale({ range }), range)

// Diverging map, symmetric range, and |z| < 2.3 hidden: values strictly
// inside the threshold interval are transparent.
const stat = new VolLayer(
  'z-stat',
  zmap,
  ColorMapFactory.fromPreset('BlueRed'),
  [-6, 6],      // display range
  [-2.3, 2.3],  // threshold
  0.9,          // opacity — these three override the colormap's own settings
)
const stack = new VolStack(anat)
stack.addLayer(stat)

// 3. Mount the orthogonal viewer.
const viewer = await SimpleOrthogonalViewer.create(document.getElementById('viewer')!, stack, {
  layout: 'left-tall',
  showCrosshair: true,
  showOrientationLabels: true,
})
viewer.setWorldCoord([-38, -22, 56]) // MNI mm (RAS world space of the image)

// 4. Bind the control panel. Importing LayerControlPanel registers
//    <layer-control-panel>; give it the viewer (so edits re-render every
//    view) and the stack (so it can list the layers).
void LayerControlPanel
const panel = document.querySelector('layer-control-panel') as LayerControlPanel
panel.viewer = viewer
panel.volStack = stack
await panel.updateComplete
panel.selectLayer('z-stat')

// 5. Live readout of position and values under the crosshair.
const readout = document.getElementById('readout')!
viewer.onCoordChange((mm) => {
  const z = viewer.getValue('z-stat', mm)
  readout.textContent =
    `${mm.map(Math.round).join(', ')} mm · T1w ${viewer.getValue('T1w', mm)} · z ${z?.toFixed(2) ?? '—'}`
})

// Programmatic control works alongside the panel. The panel does not observe
// external edits, so re-select the layer to refresh its controls.
viewer.updateLayer('z-stat', { threshold: [-3.1, 3.1] })
panel.selectLayer('z-stat')
const png = viewer.toDataURL('axial') // snapshot one view
const saved = viewer.getState()        // coordinate, slices, layer display state
viewer.applyState(saved)

// 6. Tear down when the host component unmounts (frees the WebGL contexts),
//    e.g. in Vue's onBeforeUnmount or a React effect cleanup:
export function teardown() {
  viewer.dispose()
}
```

This listing is type-checked against the library source. The live viewer above makes the same calls, except that it generates its overlay in the browser instead of fetching a file.

## Notes

- **Threshold semantics.** `threshold: [lo, hi]` hides values *strictly between* `lo` and `hi`. For a two-tailed z-map use a symmetric interval such as `[-2.3, 2.3]`; for a positive-only map use a finite lower bound below the data, e.g. `[zmap.getRange()[0] - 1, 3.1]`, or a one-sided colormap. Keep thresholds finite: the control panel rejects `±Infinity`.
- **Edit layers through the viewer.** `viewer.updateLayer(id, { range, threshold, alpha, colormap, visible })` updates every view. The control panel does exactly this when `panel.viewer` is set. The panel does not listen for changes made elsewhere; call `panel.selectLayer(id)` after a programmatic edit to refresh it.
- **Coordinates.** `setWorldCoord` takes the image's world space (RAS mm for NIfTI with a valid affine — MNI coordinates for MNI-space images).
- **Different grids.** Layers need not share a voxel grid; each is sampled in world space, and `getValue` reads each layer at its own nearest voxel.
- **Lifecycle.** Call `viewer.dispose()` when the host component unmounts; each view owns a WebGL context and browsers cap how many can be alive at once.
- **Frameworks.** In Vue, tell the compiler that `layer-control-panel` is a custom element (`compilerOptions.isCustomElement`); in React, set `viewer` and `volStack` through a ref, since they are properties, not attributes. See [UI Controls](/guide/controls).

→ Simpler starting points: **[Orthogonal Viewer](/examples/orthogonal-viewer)** (no overlay, no panel) and **[Single Slice View](/examples/single-view)**.
