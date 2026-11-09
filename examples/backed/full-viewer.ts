/** Dev demo: the full viewer over the synthetic study built in memory. */
import { readNiftiArrayBuffer, type FloatNeuroVol } from '../../src/browser';
import { makeStudy } from './study';
import { mountViewer } from './app';

const status = document.getElementById('status')!;

async function boot() {
  const buf = await (await fetch('/docs/public/data/mni152_t1.nii.gz')).arrayBuffer();
  const template = readNiftiArrayBuffer(buf) as FloatNeuroVol;
  status.textContent = 'Building the study…';
  const { backing, tmap } = makeStudy(template);
  await mountViewer({ template, map: tmap, mapName: 'faces − houses (t)', selection: 'faces − houses', stat: 't', backing });
  status.textContent = 'Click the brain to plot the data behind the map.';
}

boot().catch((e) => { status.textContent = `Could not load: ${e.message}`; console.error(e); });
