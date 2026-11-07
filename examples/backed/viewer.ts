import {
  readNiftiArrayBuffer, SimpleOrthogonalViewer, VolLayer, VolStack, ColorMapFactory, FloatNeuroVol,
} from '../../src/browser';
import { PlotPanel, BackedView } from '../../src/backed';
import { makeStudy } from './study';

const status = document.getElementById('status')!;

async function boot() {
  const buf = await (await fetch('/docs/public/data/mni152_t1.nii.gz')).arrayBuffer();
  const template = readNiftiArrayBuffer(buf) as FloatNeuroVol;
  status.textContent = 'Building the study…';
  const { backing, tmap } = makeStudy(template);
  const [tlo, thi] = template.getRange();
  const ground = new VolLayer('template', template, ColorMapFactory.createGrayscale({ range: [tlo, thi * 0.8] }), [tlo, thi * 0.8]);
  const map = new VolLayer('tmap', tmap, ColorMapFactory.createHot({ range: [0, 9] }), [0, 9], [-1e9, 3.1], 0.9);
  const viewer = await SimpleOrthogonalViewer.create(document.getElementById('viewer')!, new VolStack(ground, map), {
    layout: 'ortho', showCrosshair: true, showSlider: false, gapPx: 4,
  });
  const plot = document.getElementById('plot')!;
  const panel = new PlotPanel(backing, { width: 480 });
  plot.appendChild(panel.element);
  const view = BackedView.attach(viewer, backing, panel, { probe: { sphere: 8 }, selection: 'faces − houses, t > 3.1' })!;
  viewer.setWorldCoord([42, -52, -18]);
  status.textContent = 'Click the brain to plot the data there. Point at a subject in the plot to see their map.';
  Object.assign(window, { __BACKED__: { viewer, panel, view, backing, ready: true } });
}

boot().catch((e) => { status.textContent = `Could not load: ${e.message}`; console.error(e); });
