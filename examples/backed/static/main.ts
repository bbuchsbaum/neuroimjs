/**
 * The static site: everything is read from ./data, next to this page, as
 * plain files. The group map is an NFTab dataset whose x-backing points at
 * the per-subject betas; the plot reads those. No server code, no R.
 */
import { readNiftiArrayBuffer, type FloatNeuroVol } from '../../../src/browser';
import { openNFTab } from '../../../src/tabs';
import { mountViewer } from '../app';

const status = document.getElementById('status')!;

async function boot() {
  status.textContent = 'Loading the template…';
  const template = readNiftiArrayBuffer(await (await fetch('./data/template/mni152_t1.nii.gz')).arrayBuffer()) as FloatNeuroVol;
  status.textContent = 'Loading the group map…';
  const group = await openNFTab('./data/group/nftab.json');
  const map = await group.volume(0, 't');
  const linked = await group.followBacking({ onProgress: (i, n) => (status.textContent = `Loading the data behind the map: ${i} of ${n} rows…`) });
  if (!linked) throw new Error('the group map does not say which data it was computed from (no x-backing)');
  const { backing, link } = linked;
  await mountViewer({ template, map, mapName: `${link.map ?? 'map'} (${link.stat ?? 'value'})`, selection: link.map ?? 'this map', stat: link.stat ?? 'value', backing });
  status.textContent = `${backing.design.length} rows from ${linked.source.manifest.dataset_id}. Click the brain to plot the data behind the map.`;
}

boot().catch((e) => { status.textContent = `Could not load: ${e.message}`; console.error(e); });
