import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parse as parseYaml } from 'yaml';
import { NeuroSpace } from '../../src/geometry/NeuroSpace';
import { FloatNeuroVol } from '../../src/volume/DenseNeuroVol';
import { Float32NeuroVec } from '../../src/vec/NeuroVec';
import { writeVol, writeVec } from '../../src/io/io';
import { openNFTab, parseDelimited } from '../../src/tabs';
import { sphere, voxel } from '../../src/backed/probe';
import { buildScene } from '../../src/backed/spec';

const space = new NeuroSpace([4, 4, 4], [2, 2, 2], [-3, -3, -3]);
const space4 = (nt: number) => new NeuroSpace([4, 4, 4, nt], [2, 2, 2, 1], [-3, -3, -3, 0]);
const reader = (dir: string) => ({ read: async (p: string) => { const b = readFileSync(join(dir, p)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; } });
const json = (x: unknown) => JSON.stringify(x, null, 2);

/** Value at voxel i for subject s (1-based), condition c (0 faces, 1 houses). */
const beta = (i: number, s: number, c: number) => (i === 0 ? 0 : 1 + s + (c === 0 ? 0.5 : 0) + i / 100);

let dir = '';
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'nftab-'));
  const b = join(dir, 'betas'), g = join(dir, 'group'), fir = join(dir, 'fir');
  for (const d of [b, join(b, 'maps'), g, join(g, 'maps'), fir, join(fir, 'maps')]) mkdirSync(d, { recursive: true });
  // Betas: one 4D file per subject, faces then houses, picked by index.t.
  const subjects = ['sub-01', 'sub-02', 'sub-03', 'sub-04'];
  for (const [k, s] of subjects.entries()) {
    const data = new Float32Array(64 * 2);
    for (let c = 0; c < 2; c++) for (let i = 0; i < 64; i++) data[c * 64 + i] = beta(i, k + 1, c);
    await writeVec(new Float32NeuroVec(space4(2), data), join(b, 'maps', `${s}_betas.nii.gz`));
  }
  writeFileSync(join(b, 'resources.csv'), 'resource_id,backend,locator\n' + subjects.map((s) => `${s},nifti,maps/${s}_betas.nii.gz`).join('\n') + '\n');
  writeFileSync(join(b, 'observations.csv'), 'row_id,subject,group,condition,age,beta_res,beta_sel\n' + subjects.flatMap((s, k) =>
    ['faces', 'houses'].map((c, ci) => `r${k}${ci},${s},${k < 2 ? 'control' : 'patient'},${c},${20 + 10 * k},${s},"{""index"":{""t"":${ci}}}"`)).join('\n') + '\n');
  writeFileSync(join(b, 'nftab.json'), json({
    spec_version: '0.1.0', dataset_id: 'betas', storage_profile: 'table-package',
    observation_table: { path: 'observations.csv', format: 'csv' }, row_id: 'row_id', observation_axes: ['subject', 'condition'],
    observation_columns: {
      row_id: { dtype: 'string', nullable: false, semantic_role: 'row_id' }, subject: { dtype: 'string', nullable: false, semantic_role: 'subject' },
      group: { dtype: 'string', semantic_role: 'group' }, condition: { dtype: 'string', semantic_role: 'condition', levels: ['faces', 'houses'] },
      age: { dtype: 'int32', semantic_role: 'covariate', unit: 'years' }, beta_res: { dtype: 'string' }, beta_sel: { dtype: 'json' },
    },
    features: { beta: { description: 'β', logical: { kind: 'volume', axes: ['x', 'y', 'z'], dtype: 'float32', space: 'MNI', unit: '% signal change', support_ref: 'g' },
      encodings: [{ type: 'ref', binding: { resource_id: { column: 'beta_res' }, selector: { column: 'beta_sel' } } }] } },
    supports: { g: { support_type: 'volume', support_id: 'g', space: 'MNI', grid_id: 'g' } },
    resources: { path: 'resources.csv', format: 'csv' },
  }));
  // The group map, backed by the betas.
  await writeVol(new FloatNeuroVol(space, Float32Array.from({ length: 64 }, (_, i) => i / 10)), join(g, 'maps', 't.nii.gz'));
  writeFileSync(join(g, 'observations.csv'), 'row_id,contrast,t_loc\ng1,faces − houses,maps/t.nii.gz\n');
  writeFileSync(join(g, 'nftab.json'), json({
    spec_version: '0.1.0', dataset_id: 'group', storage_profile: 'table-package', observation_table: { path: 'observations.csv', format: 'csv' },
    row_id: 'row_id', observation_axes: ['contrast'],
    observation_columns: { row_id: { dtype: 'string' }, contrast: { dtype: 'string', semantic_role: 'contrast' }, t_loc: { dtype: 'string' } },
    features: { t: { logical: { kind: 'volume', axes: ['x', 'y', 'z'], dtype: 'float32', support_ref: 'g' },
      encodings: [{ type: 'ref', binding: { backend: 'nifti', locator: { column: 't_loc' } } }] } },
    supports: { g: { support_type: 'volume', support_id: 'g', space: 'MNI', grid_id: 'g' } },
    extensions: { 'x-backing': { source: '../betas/nftab.json', feature: 'beta', map: 'faces − houses', stat: 't' } },
  }));
  // An FIR feature: a lag axis carried in each row's 4D file.
  for (const s of ['sub-01', 'sub-02']) {
    const data = new Float32Array(64 * 3);
    for (let a = 0; a < 3; a++) for (let i = 0; i < 64; i++) data[a * 64 + i] = (a + 1) * (s === 'sub-01' ? 1 : 2);
    await writeVec(new Float32NeuroVec(space4(3), data), join(fir, 'maps', `${s}_fir.nii.gz`));
  }
  writeFileSync(join(fir, 'observations.csv'), 'row_id,subject,loc\na,sub-01,maps/sub-01_fir.nii.gz\nb,sub-02,maps/sub-02_fir.nii.gz\n');
  writeFileSync(join(fir, 'nftab.json'), json({
    spec_version: '0.1.0', dataset_id: 'fir', storage_profile: 'table-package', observation_table: { path: 'observations.csv', format: 'csv' },
    row_id: 'row_id', observation_axes: ['subject'],
    observation_columns: { row_id: { dtype: 'string' }, subject: { dtype: 'string', semantic_role: 'subject' }, loc: { dtype: 'string' } },
    features: { response: { logical: { kind: 'array', axes: ['x', 'y', 'z', 'lag'], dtype: 'float32', axis_domains: { lag: { values: [0, 2, 4], unit: 's' } } },
      encodings: [{ type: 'ref', binding: { backend: 'nifti', locator: { column: 'loc' } } }] } },
  }));
});

describe('parseDelimited', () => {
  it('reads quotes, doubled quotes, CRLF and empty-as-null', () => {
    const { header, rows } = parseDelimited('a,b,c\r\n1,"x, ""y""",\r\n2,,"q"\r\n', ',');
    expect(header).toEqual(['a', 'b', 'c']);
    expect(rows).toEqual([['1', 'x, "y"', null], ['2', null, 'q']]);
  });
});

describe('openNFTab', () => {
  it('reads the design with types, roles and levels', async () => {
    const tab = await openNFTab(reader(join(dir, 'betas')));
    const d = tab.design();
    expect(d.subject).toBe('subject');
    expect(d.columns.map((c) => [c.name, c.kind])).toEqual([['subject', 'factor'], ['group', 'factor'], ['condition', 'factor'], ['age', 'numeric']]);
    expect(d.rows[3]).toEqual({ subject: 'sub-02', group: 'control', condition: 'houses', age: 30 });
  });

  it('resolves ref encodings with index.t selectors to the right volume', async () => {
    const tab = await openNFTab(reader(join(dir, 'betas')));
    const v = await tab.volume(5, 'beta'); // sub-03, houses
    expect((v.getData() as Float32Array)[10]).toBeCloseTo(beta(10, 3, 1), 5);
  });

  it('turns a feature into a backing the plot reads', async () => {
    const tab = await openNFTab(reader(join(dir, 'betas')));
    const b = await tab.backing('beta');
    expect(b.design).toHaveLength(8);
    expect(b.valueLabel).toBe('β (% signal change)');
    expect(b.provenance?.space).toBe('MNI');
    const at = space.indexToCoord(21);
    const e = b.extract(voxel(at));
    expect(Array.from(e.values).map((x) => +x.toFixed(3))).toEqual(
      [0, 1, 2, 3].flatMap((k) => [0, 1].map((c) => +beta(21, k + 1, c).toFixed(3))));
    const scene = buildScene(b, b.extract(sphere(at, 3)), { x: 'condition', color: 'group' });
    expect(scene.nSubjects).toBe(4);
    expect(scene.color.levels).toEqual(['control', 'patient']);
  });

  it('follows x-backing from a map to the data behind it', async () => {
    const group = await openNFTab(reader(dir), { at: 'group/nftab.json' });
    expect(group.backingLink()).toMatchObject({ source: '../betas/nftab.json', feature: 'beta', map: 'faces − houses', stat: 't' });
    const t = await group.volume(0, 't');
    expect((t.getData() as Float32Array)[30]).toBeCloseTo(3, 5);
    const linked = (await group.followBacking())!;
    expect(linked.source.manifest.dataset_id).toBe('betas');
    expect(linked.backing.provenance).toMatchObject({ map: 'faces − houses', space: 'MNI' });
    expect(linked.backing.extract(voxel(space.indexToCoord(9))).values[0]).toBeCloseTo(beta(9, 1, 0), 5);
  });

  it('finds nftab.json in a directory, and says where it looked when it is absent', async () => {
    expect((await openNFTab(reader(dir), { at: 'betas' })).manifest.dataset_id).toBe('betas');
    await expect(openNFTab(reader(dir))).rejects.toThrow(/no manifest found \(looked for nftab\.json, nftab\.yaml, nftab\.yml\)/);
  });

  it('reads a fourth axis as the plot axis (FIR lags)', async () => {
    const tab = await openNFTab(reader(join(dir, 'fir')));
    const b = await tab.backing('response');
    expect(b.axis).toEqual({ name: 'lag', values: [0, 2, 4], unit: 's' });
    const e = b.extract(voxel(space.indexToCoord(5)));
    expect(Array.from(e.values)).toEqual([1, 2, 3, 2, 4, 6]);
  });

  it('reads the neurotabs faces-demo example and reports its missing NIfTI plainly', async () => {
    const root = '/home/user/neurotabs/inst/examples/faces-demo';
    const tab = await openNFTab(reader(root), { parseYaml: (t) => parseYaml(t) });
    expect(tab.features).toEqual(['statmap', 'roi_beta']);
    const roi = await tab.backing('roi_beta');
    expect(roi.design).toHaveLength(8);
    expect(roi.extract({ kind: 'mask', indices: [1], label: 'right fusiform' }).values[0]).toBeCloseTo(0.44, 5);
    await expect(tab.backing('statmap')).rejects.toThrow(/cannot read maps\/group_stats\.nii\.gz/);
  });

  it('refuses what it cannot read, with the reason', async () => {
    const m = JSON.parse(readFileSync(join(dir, 'betas', 'nftab.json'), 'utf8'));
    const files = (manifest: unknown, obs = readFileSync(join(dir, 'betas', 'observations.csv'), 'utf8')) => ({
      'nftab.json': JSON.stringify(manifest), 'observations.csv': obs, 'resources.csv': readFileSync(join(dir, 'betas', 'resources.csv'), 'utf8') });
    await expect(openNFTab(files({ ...m, row_id: 'nope' }))).rejects.toThrow(/row_id "nope"/);
    await expect(openNFTab(files({ ...m, observation_table: { path: 'o.parquet', format: 'parquet' } }))).rejects.toThrow(/parquet/);
    await expect(openNFTab(files(m, 'row_id,subject,condition\nr1,s,faces\nr1,t,faces\n'))).rejects.toThrow(/not unique/);
    await expect(openNFTab(files(m, 'row_id,subject,condition,mystery\nr1,s,faces,1\n'))).rejects.toThrow(/"mystery" is not declared/);
    const yamlOnly = { 'nftab.yaml': 'spec_version: "0.1.0"' };
    await expect(openNFTab(yamlOnly)).rejects.toThrow(/YAML; pass options.parseYaml/);
    const other = await openNFTab(files({ ...m, features: { beta: { ...m.features.beta, encodings: [{ type: 'ref', binding: { backend: 'zarr', locator: 'x' } }] } } }));
    await expect(other.backing('beta')).rejects.toThrow(/backend "zarr" is not supported/);
  });

  it('checks each value against a declared shape', async () => {
    const m = JSON.parse(readFileSync(join(dir, 'betas', 'nftab.json'), 'utf8'));
    m.features.beta.logical.shape = [91, 109, 91];
    const src = { read: async (p: string) => (p === 'nftab.json' ? new TextEncoder().encode(JSON.stringify(m)).buffer as ArrayBuffer : reader(join(dir, 'betas')).read(p)) };
    const tab = await openNFTab(src);
    await expect(tab.backing('beta')).rejects.toThrow(/has shape \[4, 4, 4\], but the feature declares \[91, 109, 91\]/);
  });

  it('follows ../ links from a URL source', async () => {
    const served = new Map<string, Buffer>();
    const old = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      const path = new URL(url).pathname.replace(/^\/data\//, '');
      try { const b = readFileSync(join(dir, path)); served.set(path, b); return new Response(b); } catch { return new Response('no', { status: 404 }); }
    }) as typeof fetch;
    try {
      const group = await openNFTab('http://example.test/data/group/nftab.json');
      const linked = (await group.followBacking())!;
      expect(linked.backing.design).toHaveLength(8);
      expect([...served.keys()]).toContain('betas/maps/sub-04_betas.nii.gz');
    } finally { globalThis.fetch = old; }
  });
});
