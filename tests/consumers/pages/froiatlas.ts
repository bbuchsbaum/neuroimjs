/**
 * FROIAtlas contract page.
 *
 * Mirrors app/src/shared/components/visualization/SliceViewer.tsx in
 * FROIAtlas (~/code/jscode/FROIAtlas/app, dependency "file:../../neuroimjs").
 * FROIAtlas's Vite config aliases the bare specifier 'neuroimjs' to
 * node_modules/neuroimjs/dist/neuroimjs.es.js (the browser bundle) and loads
 * it with a dynamic import(); the consumer-runner builds this page with the
 * same alias. FROIAtlas ships its own `declare module 'neuroimjs'` typings
 * (src/types/neuroimjs.d.ts), so the package's .d.ts files do not protect it:
 * only the runtime surface below does. This page is therefore not
 * type-checked against the tarball.
 *
 * Call surface: NeuroSpace(dim, spacing, origin, undefined, affine[][]),
 * FloatNeuroVol, ColorMapFactory.createGrayscale/createHot({ range }),
 * VolLayer, VolStack, SimpleOrthogonalViewer.create (layout 'left-tall'),
 * setBackground, setWorldCoord, onCoordChange, setCrosshairVisible, addLayer,
 * updateLayerVolume with a *string* colormap ('hot'), removeLayer, dispose.
 */
import { check, nextFrame, runConsumer, statVolume, underlayVolume } from './harness';

const OVERLAY_LAYER_ID = 'foci-overlay';

type NeuroimjsModule = typeof import('neuroimjs');
type Viewer = Awaited<ReturnType<NeuroimjsModule['SimpleOrthogonalViewer']['create']>>;

let neuroimjs: NeuroimjsModule;
let viewer: Viewer;
const coords: number[][] = [];

function overlayVolume(gain: number) {
  const { NeuroSpace, FloatNeuroVol } = neuroimjs;
  const synthetic = statVolume(gain);
  const data = synthetic.data.map(value => Math.max(0, value));
  const origin = [synthetic.affine[0][3], synthetic.affine[1][3], synthetic.affine[2][3]];
  const overlaySpace = new NeuroSpace(synthetic.dim, synthetic.spacing, origin, undefined, synthetic.affine);
  let maxWeight = 0;
  for (const value of data) maxWeight = Math.max(maxWeight, value);
  return { volume: new FloatNeuroVol(overlaySpace, data), maxWeight };
}

void runConsumer([
  ['loadModule', async () => {
    neuroimjs = await import('neuroimjs');
    const names = ['SimpleOrthogonalViewer', 'VolLayer', 'VolStack', 'ColorMapFactory', 'FloatNeuroVol', 'NeuroSpace'] as const;
    const missing = names.filter(name => typeof neuroimjs[name] !== 'function');
    check(missing.length === 0, `neuroimjs (browser bundle) lacks: ${missing.join(', ')}`);
  }],

  ['initViewer', async () => {
    const { SimpleOrthogonalViewer, VolLayer, VolStack, ColorMapFactory, FloatNeuroVol, NeuroSpace } = neuroimjs;
    const template = underlayVolume();
    const dim = template.dim;
    const spacing = template.spacing;
    const affine = template.affine;
    const origin = [affine[0][3], affine[1][3], affine[2][3]];
    const rangeMin = 0;
    const rangeMax = 900;
    const space = new NeuroSpace(dim, spacing, origin, undefined, affine);
    const volume = new FloatNeuroVol(space, template.data);
    const colormap = ColorMapFactory.createGrayscale({ range: [rangeMin, rangeMax] });
    const layer = new VolLayer('template', volume, colormap, [rangeMin, rangeMax], [0, 0], 1.0);
    const stack = new VolStack(layer);
    const container = document.getElementById('viewer');
    if (!container) throw new Error('no container');
    viewer = await SimpleOrthogonalViewer.create(container, stack, {
      layout: 'left-tall',
      showCrosshair: true,
      showSlider: false,
      gapPx: 4,
    });
    viewer.setBackground(0x1a1a2e);
    viewer.setWorldCoord([0, 0, 0]);
    viewer.onCoordChange((coord: number[]) => {
      coords.push([coord[0], coord[1], coord[2]]);
    });
    await nextFrame();
    check(container.querySelectorAll('canvas').length === 3, 'left-tall layout did not create three canvases');
  }],

  ['goToPeak', () => {
    viewer.setWorldCoord([12, 0, 4]);
    check(coords.length > 0, 'onCoordChange did not fire');
    const last = coords[coords.length - 1];
    check(Math.abs(last[0] - 12) < 2.5, `onCoordChange payload ${last}`);
    return last;
  }],

  ['crosshairToggle', () => {
    viewer.setCrosshairVisible(false);
    viewer.setCrosshairVisible(true);
  }],

  // First overlay: VolLayer + addLayer.
  ['addOverlay', () => {
    const { VolLayer, ColorMapFactory } = neuroimjs;
    const { volume, maxWeight } = overlayVolume(1);
    const overlayColormap = ColorMapFactory.createHot({ range: [0, maxWeight] });
    const overlayLayer = new VolLayer(OVERLAY_LAYER_ID, volume, overlayColormap, [0, maxWeight], [0, 0], 0.7);
    viewer.addLayer(overlayLayer);
    const ids = viewer.listLayers().map(entry => entry.id);
    check(ids.join() === `template,${OVERLAY_LAYER_ID}`, `layers after addLayer: ${ids}`);
  }],

  // Sigma change: in-place update with a string colormap.
  ['updateLayerVolume', () => {
    const { volume, maxWeight } = overlayVolume(0.6);
    viewer.updateLayerVolume(OVERLAY_LAYER_ID, volume, {
      range: [0, maxWeight],
      alpha: 0.7,
      colormap: 'hot',
      threshold: [0, 0],
    });
    const entry = viewer.listLayers().find(layer => layer.id === OVERLAY_LAYER_ID);
    check(entry !== undefined, 'overlay vanished after updateLayerVolume');
    check(/hot/i.test(entry.colormapName), `string colormap 'hot' resolved to ${entry.colormapName}`);
    check(Math.abs(entry.range[1] - maxWeight) < 1e-6 && Math.abs(entry.alpha - 0.7) < 1e-6, 'range/alpha not applied');
    return entry.colormapName;
  }],

  ['removeLayer', () => {
    check(typeof viewer.removeLayer === 'function', 'removeLayer missing (FROIAtlas calls it with ?.() and would silently keep the overlay)');
    viewer.removeLayer(OVERLAY_LAYER_ID);
    const ids = viewer.listLayers().map(entry => entry.id);
    check(ids.join() === 'template', `layers after removeLayer: ${ids}`);
  }],

  ['dispose', () => {
    viewer.dispose();
  }],
]);
