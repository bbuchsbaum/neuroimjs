# Live Examples

Every viewer on these pages is the real `neuroimjs` library running in your browser against an MNI152 template — interact with them directly.

## Orthogonal viewer

The classic three-plane layout, synchronized by a shared crosshair.

<BrainViewer mode="ortho" :height="460" caption="SimpleOrthogonalViewer — drag to move the crosshair." />

→ **[Walkthrough & code](/examples/orthogonal-viewer)**

## Single slice views

Individual planes you can place anywhere and synchronize yourself.

<div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem;">
  <BrainViewer mode="axial" :height="260" :show-slider="true" caption="Axial" />
  <BrainViewer mode="coronal" :height="260" :show-slider="true" caption="Coronal" />
  <BrainViewer mode="sagittal" :height="260" :show-slider="true" caption="Sagittal" />
</div>

→ **[Walkthrough & code](/examples/single-view)**

## Running these locally

The repository ships the same demos as standalone pages:

```bash
git clone https://github.com/bbuchsbaum/neuroimjs
cd neuroimjs
npm install

npm run demo:composable    # all composable-view demos
npm run demo:single-view   # single axial view
npm run demo:two-view      # two synchronized views
npm run demo:multi-panel   # custom multi-panel layout
npm run demo:simple-ortho  # classic 3-view
```

Each maps to an HTML file under `examples/`. They load a bundled MNI152 template and wire up the viewers exactly as shown in these walkthroughs.
