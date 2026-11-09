/**
 * Write the backed-plots demo study as plain NFTab packages, the way an
 * analysis would leave them on disk:
 *
 *   <out>/template/mni152_t1.nii.gz   the anatomy
 *   <out>/betas/                      β per subject × condition (one 4D NIfTI per subject)
 *   <out>/group/                      the group t map, with x-backing pointing at ../betas
 *
 * The values are the synthetic faces/houses study (planted fusiform effects);
 * the files and manifests are ordinary NFTab, read by the static demo with no
 * server and no R. Usage: tsx scripts/make-backed-demo-data.ts <out>
 */
import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { readNiftiArrayBuffer } from '../src/io/browserNifti';
import { writeVol, writeVec } from '../src/io/io';
import { NeuroSpace } from '../src/geometry/NeuroSpace';
import { FloatNeuroVol } from '../src/volume/DenseNeuroVol';
import { Float32NeuroVec } from '../src/vec/NeuroVec';
import { makeStudy } from '../examples/backed/study';

const out = resolve(process.argv[2] ?? 'dist/backed-demo-data');
const templatePath = 'docs/public/data/mni152_t1.nii.gz';
const raw = readFileSync(templatePath);
const template = readNiftiArrayBuffer(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer) as FloatNeuroVol;
const { backing, tmap } = makeStudy(template);

const json = (x: unknown) => JSON.stringify(x, null, 2) + '\n';
const csv = (header: string[], rows: (string | number)[][]) =>
  [header, ...rows].map((r) => r.map((v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))).join(',')).join('\n') + '\n';

async function main() {
  for (const d of ['template', 'betas/maps', 'group/maps']) mkdirSync(join(out, d), { recursive: true });
  copyFileSync(templatePath, join(out, 'template', 'mni152_t1.nii.gz'));
  copyFileSync('docs/public/data/LICENSE-MNI152.txt', join(out, 'template', 'LICENSE-MNI152.txt'));

  const space = backing.space;
  const [nx, ny, nz] = space.dim as number[];
  const n = nx * ny * nz;
  const conditions = ['faces', 'houses', 'scrambled'];
  const subjects = [...new Set(backing.design.map((r) => String(r.subject)))];
  // A covariate per subject, so the covariate view has something to show.
  const age = new Map(subjects.map((s, i) => [s, 21 + ((i * 7) % 40)]));
  const rows: (string | number)[][] = [];
  for (const s of subjects) {
    const data = new Float32Array(n * conditions.length);
    conditions.forEach((c, t) => {
      const r = backing.design.findIndex((d) => d.subject === s && d.condition === c);
      const map = backing.mapOf([r]);
      for (let i = 0; i < n; i++) data[t * n + i] = Number.isFinite(map[i]) ? map[i] : 0;
      const group = String(backing.design[r].group);
      rows.push([`${s}_${c}`, s, group, c, age.get(s) as number, s, JSON.stringify({ index: { t } })]);
    });
    const space4 = new NeuroSpace([nx, ny, nz, conditions.length], [...(space.spacing as number[]), 1], [...(space.origin as number[]), 0]);
    await writeVec(new Float32NeuroVec(space4, data), join(out, 'betas', 'maps', `${s}_betas.nii.gz`));
  }
  writeFileSync(join(out, 'betas', 'observations.csv'), csv(['row_id', 'subject', 'group', 'condition', 'age', 'beta_res', 'beta_sel'], rows));
  writeFileSync(join(out, 'betas', 'resources.csv'), csv(['resource_id', 'backend', 'locator'], subjects.map((s) => [s, 'nifti', `maps/${s}_betas.nii.gz`])));
  const support = { mni_4mm: { support_type: 'volume', support_id: `mni-4mm-${nx}x${ny}x${nz}`, space: 'MNI152NLin2009aAsym', grid_id: `mni-4mm-${nx}x${ny}x${nz}` } };
  writeFileSync(join(out, 'betas', 'nftab.json'), json({
    spec_version: '0.1.0',
    dataset_id: 'faces-houses-betas',
    storage_profile: 'table-package',
    observation_table: { path: 'observations.csv', format: 'csv' },
    row_id: 'row_id',
    observation_axes: ['subject', 'condition'],
    observation_columns: {
      row_id: { dtype: 'string', nullable: false, semantic_role: 'row_id' },
      subject: { dtype: 'string', nullable: false, semantic_role: 'subject' },
      group: { dtype: 'string', nullable: false, semantic_role: 'group', levels: ['control', 'patient'] },
      condition: { dtype: 'string', nullable: false, semantic_role: 'condition', levels: conditions },
      age: { dtype: 'int32', semantic_role: 'covariate', unit: 'years' },
      beta_res: { dtype: 'string' },
      beta_sel: { dtype: 'json' },
    },
    features: {
      beta: {
        description: 'β',
        logical: { kind: 'volume', axes: ['x', 'y', 'z'], dtype: 'float32', support_ref: 'mni_4mm', shape: [nx, ny, nz],
          space: 'MNI152NLin2009aAsym', alignment: 'same_grid', unit: '% signal change' },
        encodings: [{ type: 'ref', binding: { resource_id: { column: 'beta_res' }, selector: { column: 'beta_sel' } } }],
      },
    },
    supports: support,
    resources: { path: 'resources.csv', format: 'csv' },
  }));

  await writeVol(new FloatNeuroVol(space, tmap.getData() as Float32Array), join(out, 'group', 'maps', 'faces_vs_houses_t.nii.gz'));
  writeFileSync(join(out, 'group', 'observations.csv'), csv(['row_id', 'contrast', 't_map'], [['faces_vs_houses', 'faces − houses', 'maps/faces_vs_houses_t.nii.gz']]));
  writeFileSync(join(out, 'group', 'nftab.json'), json({
    spec_version: '0.1.0',
    dataset_id: 'faces-houses-group',
    storage_profile: 'table-package',
    observation_table: { path: 'observations.csv', format: 'csv' },
    row_id: 'row_id',
    observation_axes: ['contrast'],
    observation_columns: {
      row_id: { dtype: 'string', nullable: false, semantic_role: 'row_id' },
      contrast: { dtype: 'string', nullable: false, semantic_role: 'contrast' },
      t_map: { dtype: 'string' },
    },
    features: {
      t: {
        description: 'faces − houses, one-sample t across subjects',
        logical: { kind: 'volume', axes: ['x', 'y', 'z'], dtype: 'float32', support_ref: 'mni_4mm', shape: [nx, ny, nz], space: 'MNI152NLin2009aAsym' },
        encodings: [{ type: 'ref', binding: { backend: 'nifti', locator: { column: 't_map' } } }],
      },
    },
    supports: support,
    // Draft x-backing 0.1.0 (neurotabs spec/extensions/x-backing.md).
    extensions: { 'x-backing': { version: '0.1.0', source: '../betas/nftab.json', feature: 'beta', map: 'faces − houses', stat: 't',
      formula: '~ condition + (1 | subject)', source_checksum: 'sha256:' + createHash('sha256').update(readFileSync(join(out, 'betas', 'nftab.json'))).digest('hex') } },
  }));
  console.log(`wrote ${subjects.length} subjects × ${conditions.length} conditions and the group map to ${out}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
