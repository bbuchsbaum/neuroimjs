/**
 * The full viewer app: three synchronized SingleSliceViewers over one
 * VolStack, the layer sidebar, and the plot of the data behind the map, with
 * a configurable probe. Shared by the dev demo and the static site.
 */
import {
  SingleSliceViewer, ViewSynchronizer, VolLayer, VolStack, ColorMapFactory, LayerControlPanel, MapLegend,
} from '../../src/browser';
import type { NeuroVol } from '../../src/browser';
import { PlotPanel, BackedView, type Backing, type ProbeSpec } from '../../src/backed';

void LayerControlPanel; // registers <layer-control-panel>
const $ = (id: string) => document.getElementById(id)!;

export interface ViewerApp {
  template: NeuroVol;
  map: NeuroVol;
  /** The map layer's name in the sidebar, e.g. "faces − houses (t)". */
  mapName: string;
  /** What the map shows, for the circular warning, e.g. "faces − houses". */
  selection: string;
  stat: string;
  backing: Backing;
  threshold?: number;
}

export async function mountViewer(o: ViewerApp) {
  const [tlo, thi] = o.template.getRange();
  const anatomy = new VolLayer('anatomy', o.template, ColorMapFactory.createGrayscale({ range: [tlo, thi * 0.8] }), [tlo, thi * 0.8]);
  const [, mhi] = o.map.getRange();
  const top = Math.max(1, Math.ceil(mhi));
  const thr = o.threshold ?? 3.1;
  const map = new VolLayer(o.mapName, o.map, ColorMapFactory.createHot({ range: [0, top] }), [0, top], [-Math.max(20, top), thr], 0.9);
  const stack = new VolStack(anatomy);
  stack.addLayer(map);

  const opts = { showCrosshair: true, showSlider: false };
  const axial = await SingleSliceViewer.createAxial($('axial'), stack, opts);
  const sagittal = await SingleSliceViewer.createSagittal($('sagittal'), stack, opts);
  const coronal = await SingleSliceViewer.createCoronal($('coronal'), stack, opts);
  ViewSynchronizer.createOrthogonal(axial, sagittal, coronal, { syncOnHover: false });

  // The fourth square: the map's colour key and histogram, following the cursor.
  const legend = new MapLegend($('legend'), map, { title: o.mapName, stat: o.stat, ground: 'dark' });
  axial.onCoordChange((c) => legend.setCursor(c));

  const layers = $('layers') as unknown as LayerControlPanel;
  layers.volStack = stack;
  layers.setAttribute('theme', matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

  const panel = new PlotPanel(o.backing);
  $('plot').appendChild(panel.element);
  const view = BackedView.attach([axial, sagittal, coronal], o.backing, panel, {
    probe: { cluster: true }, map, stat: o.stat, selection: o.selection, layers: stack,
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
  legend.setCursor([42, -52, -18]);
  const app = { views: { axial, sagittal, coronal }, stack, map, layers, panel, view, legend, backing: o.backing, ready: true };
  Object.assign(window, { __BACKED__: app });
  return app;
}
