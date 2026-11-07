/**
 * The full viewer: three synchronized SingleSliceViewers over one VolStack,
 * the layer sidebar, and the plot of the data behind the map. The probe is
 * configurable: the cluster under the pointer at the map's live threshold,
 * a sphere, or one voxel.
 */
import {
  readNiftiArrayBuffer, SingleSliceViewer, ViewSynchronizer, VolLayer, VolStack, ColorMapFactory, FloatNeuroVol, LayerControlPanel,
} from '../../src/browser';
import { PlotPanel, BackedView, type ProbeSpec } from '../../src/backed';
import { makeStudy } from './study';

void LayerControlPanel; // registers <layer-control-panel>
const $ = (id: string) => document.getElementById(id)!;

async function boot() {
  const buf = await (await fetch('/docs/public/data/mni152_t1.nii.gz')).arrayBuffer();
  const template = readNiftiArrayBuffer(buf) as FloatNeuroVol;
  $('status').textContent = 'Building the study…';
  const { backing, tmap } = makeStudy(template);
  const [tlo, thi] = template.getRange();
  const anatomy = new VolLayer('anatomy', template, ColorMapFactory.createGrayscale({ range: [tlo, thi * 0.8] }), [tlo, thi * 0.8]);
  const map = new VolLayer('faces − houses (t)', tmap, ColorMapFactory.createHot({ range: [0, 9] }), [0, 9], [-1e9, 3.1], 0.9);
  const stack = new VolStack(anatomy);
  stack.addLayer(map);

  const opts = { showCrosshair: true, showSlider: false };
  const axial = await SingleSliceViewer.createAxial($('axial'), stack, opts);
  const sagittal = await SingleSliceViewer.createSagittal($('sagittal'), stack, opts);
  const coronal = await SingleSliceViewer.createCoronal($('coronal'), stack, opts);
  ViewSynchronizer.createOrthogonal(axial, sagittal, coronal, { syncOnHover: false });

  const layers = $('layers') as unknown as LayerControlPanel;
  layers.volStack = stack;
  layers.setAttribute('theme', matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

  const panel = new PlotPanel(backing);
  $('plot').appendChild(panel.element);
  const view = BackedView.attach([axial, sagittal, coronal], backing, panel, {
    probe: { cluster: true }, map, stat: 't', selection: 'faces − houses', layers: stack,
  })!;

  // The probe chooser.
  const kinds = [...document.querySelectorAll<HTMLButtonElement>('#probe-kind button')];
  const radius = $('radius') as HTMLSelectElement;
  const hint = $('probe-hint');
  const hints: Record<string, string> = {
    cluster: 'Click a blob to plot the whole cluster at the current threshold. Move the threshold to change the cluster.',
    sphere: 'Click anywhere to plot the average within the sphere.',
    voxel: 'Click anywhere to plot the single voxel under the pointer.',
  };
  const apply = (kind: string) => {
    kinds.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.kind === kind)));
    radius.disabled = kind !== 'sphere';
    hint.textContent = hints[kind];
    const spec: ProbeSpec = kind === 'cluster' ? { cluster: true } : kind === 'voxel' ? 'voxel' : { sphere: Number(radius.value) };
    view.setProbe(spec);
  };
  kinds.forEach((b) => (b.onclick = () => apply(b.dataset.kind!)));
  radius.onchange = () => apply('sphere');

  axial.setCoord([42, -52, -18]);
  $('status').textContent = 'Click the brain to plot the data behind the map.';
  Object.assign(window, { __BACKED__: { views: { axial, sagittal, coronal }, stack, map, layers, panel, view, backing, ready: true } });
}

boot().catch((e) => { $('status').textContent = `Could not load: ${e.message}`; console.error(e); });
