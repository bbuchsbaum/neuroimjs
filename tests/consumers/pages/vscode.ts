/**
 * neuroimjs-vscode contract page.
 *
 * Mirrors webview/src/viewerApp.ts and webview/src/niftiLoader.ts in the
 * neuroimjs-vscode extension (sibling checkout ../neuroimjs-vscode), a Vite
 * webview that imports from 'neuroimjs/browser' and is type-checked against
 * the package's declarations (strict, moduleResolution "Bundler"). The
 * consumer-runner type-checks this file against the packed tarball too, so a
 * signature change fails here before it fails in the extension build.
 *
 * Call surface: NeuroSpace(dim, spacing, origin, undefined, affine[][]),
 * FloatNeuroVol, ColorMapFactory.createGrayscale/createHot, VolLayer,
 * VolStack#addLayer, three SingleSliceViewer.create{Axial,Sagittal,Coronal}
 * views tied by ViewSynchronizer.createOrthogonal, and the
 * <layer-control-panel> custom element registered as an import side effect
 * and fed through its `volStack` property.
 */
import {
  ColorMapFactory,
  FloatNeuroVol,
  LayerControlPanel,
  NeuroSpace,
  SingleSliceViewer,
  ViewSynchronizer,
  VolLayer,
  VolStack,
} from 'neuroimjs/browser';
import { check, nextFrame, runConsumer, statVolume, underlayVolume, type SyntheticVolume } from './harness';

// viewerApp.ts keeps the import only for its registration side effect.
void LayerControlPanel;

type ViewId = 'axial' | 'sagittal' | 'coronal';
type LayerPanelElement = HTMLElement & { volStack?: VolStack };

interface Loaded {
  vol: FloatNeuroVol;
  range: [number, number];
}

// niftiLoader.ts: build the space from the header's affine and wrap float data.
function load(volume: SyntheticVolume): Loaded {
  const origin: [number, number, number] = [volume.affine[0][3], volume.affine[1][3], volume.affine[2][3]];
  const space = new NeuroSpace(volume.dim, volume.spacing, origin, undefined, volume.affine);
  const vol = new FloatNeuroVol(space, volume.data);
  let min = Infinity;
  let max = -Infinity;
  for (const value of volume.data) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return { vol, range: [min, max] };
}

let views: Record<ViewId, SingleSliceViewer> | undefined;
let synchronizer: ViewSynchronizer | undefined;
let stack: VolStack | undefined;
const coordEvents: number[][] = [];

function byId(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing expected DOM node: #${id}`);
  return node;
}

function requireViews(): Record<ViewId, SingleSliceViewer> {
  if (!views) throw new Error('views were not created');
  return views;
}

void runConsumer([
  ['registerPanel', () => {
    const panel = byId('layer-panel');
    check(customElements.get('layer-control-panel') !== undefined, '<layer-control-panel> is not registered by importing neuroimjs/browser');
    check(panel instanceof LayerControlPanel, 'the <layer-control-panel> element was not upgraded');
  }],

  // createBaseView()
  ['createBaseView', () => {
    const loaded = load(underlayVolume());
    const baseColorMap = ColorMapFactory.createGrayscale({ range: loaded.range });
    const baseLayer = new VolLayer('base', loaded.vol, baseColorMap, loaded.range);
    stack = new VolStack(baseLayer);
    (byId('layer-panel') as LayerPanelElement).volStack = stack;
    return loaded.range;
  }],

  // createOrthogonalViews()
  ['createOrthogonalViews', async () => {
    if (!stack) throw new Error('no stack');
    const options = { showCrosshair: true, showSlider: false };
    const axial = await SingleSliceViewer.createAxial(byId('axial-container'), stack, options);
    const sagittal = await SingleSliceViewer.createSagittal(byId('sagittal-container'), stack, options);
    const coronal = await SingleSliceViewer.createCoronal(byId('coronal-container'), stack, options);
    views = { axial, sagittal, coronal };
    synchronizer = ViewSynchronizer.createOrthogonal(axial, sagittal, coronal, { syncOnHover: false });
    const onCoordChanged = (coord: number[]) => {
      coordEvents.push(coord);
    };
    axial.onCoordChange(onCoordChanged);
    sagittal.onCoordChange(onCoordChanged);
    coronal.onCoordChange(onCoordChanged);
    await nextFrame();
    const canvases = ['axial-container', 'sagittal-container', 'coronal-container']
      .map(id => byId(id).querySelectorAll('canvas').length);
    check(canvases.every(count => count > 0), `canvases per view: ${canvases}`);
  }],

  // initializeViewer(): restore the last coordinate; sync propagates it.
  ['syncedCoordinate', async () => {
    const { axial, sagittal, coronal } = requireViews();
    const initial = axial.getCurrentCoord();
    check(initial.length === 3 && initial.every(Number.isFinite), `getCurrentCoord ${initial}`);
    synchronizer?.enable();
    axial.setCoord([10, -6, 8]);
    await nextFrame();
    const [s, c] = [sagittal.getCurrentCoord(), coronal.getCurrentCoord()];
    check(Math.abs(s[0] - 10) < 2.5 && Math.abs(c[1] + 6) < 2.5, `sync did not propagate: sagittal ${s}, coronal ${c}`);
    check(coordEvents.length > 0, 'onCoordChange never fired');
    const slices = [axial, sagittal, coronal].map(v => v.getCurrentSliceIndex());
    check(slices.every(Number.isInteger), `getCurrentSliceIndex ${slices}`);
    return slices;
  }],

  // toggleSync()/applySyncState()/resetView()
  ['syncControl', async () => {
    const { axial, sagittal } = requireViews();
    if (!synchronizer) throw new Error('no synchronizer');
    const enabled = synchronizer.toggle();
    check(enabled === false, `toggle() from enabled returned ${enabled}`);
    const before = sagittal.getCurrentCoord()[0];
    axial.setCoord([-14, 0, 0]);
    await nextFrame();
    check(Math.abs(sagittal.getCurrentCoord()[0] - before) < 1e-6, 'disabled synchronizer still propagated');
    synchronizer.disable();
    synchronizer.enable();
    synchronizer.syncCoordinate([0, 0, 0]);
    await nextFrame();
    check(Math.abs(sagittal.getCurrentCoord()[0]) < 2.5, 'syncCoordinate did not move the sagittal view');
  }],

  // applyCrosshairState()/handleResize()
  ['crosshairAndResize', () => {
    const v = requireViews();
    for (const view of [v.axial, v.sagittal, v.coronal]) {
      view.setCrosshairVisible(false);
      view.setCrosshairVisible(true);
      view.handleResize();
    }
  }],

  // addLayers(): overlays go straight into the panel's stack.
  ['addOverlay', async () => {
    const panel = byId('layer-panel') as LayerPanelElement & { updateComplete?: Promise<unknown> };
    if (!panel.volStack) throw new Error('panel.volStack not retained');
    const loaded = load(statVolume());
    const overlayColorMap = ColorMapFactory.createHot({ range: loaded.range, alpha: 0.7 });
    const overlayLayer = new VolLayer('overlay-1', loaded.vol, overlayColorMap, loaded.range, undefined, 0.7);
    panel.volStack.addLayer(overlayLayer);
    check(panel.volStack.length === 2, `stack length ${panel.volStack.length}`);
    check(panel.volStack.getLayerById('overlay-1') === overlayLayer, 'overlay not retrievable from the stack');
    await panel.updateComplete;
    await nextFrame();
    // Recorded, not asserted here: the panel only reads the stack when
    // `volStack` is assigned, so overlays added later are not listed. The
    // spec tracks this known gap separately (see vscode.spec.ts).
    const options = Array.from(panel.shadowRoot?.querySelectorAll('option') ?? []).map(option => option.value);
    return { stackLength: panel.volStack.length, panelListsOverlay: options.includes('overlay-1') };
  }],

  // disposeViews()
  ['dispose', () => {
    const v = requireViews();
    synchronizer?.dispose();
    v.axial.dispose();
    v.sagittal.dispose();
    v.coronal.dispose();
  }],
]);
