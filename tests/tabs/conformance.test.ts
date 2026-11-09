/** Core NFTab 0.1 rules the reader enforces (spec/nftab-spec.md, neurotabs main). */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { openNFTab } from '../../src/tabs';
import { NeuroSpace } from '../../src/geometry/NeuroSpace';
import { voxel } from '../../src/backed/probe';

const base = () => ({
  spec_version: '0.1.0', dataset_id: 'd', storage_profile: 'table-package',
  observation_table: { path: 'obs.csv', format: 'csv' }, row_id: 'row_id', observation_axes: ['subject'],
  observation_columns: { row_id: { dtype: 'string' }, subject: { dtype: 'string', semantic_role: 'subject' }, a: { dtype: 'float64' }, b: { dtype: 'float64' } },
  features: { roi: { logical: { kind: 'vector', axes: ['roi'], dtype: 'float32' }, encodings: [{ type: 'columns', binding: { columns: ['a', 'b'] } }] } },
} as Record<string, any>);
const obs = 'row_id,subject,a,b\nr1,s1,1,2\nr2,s2,3,4\n';
const open = (m: unknown, files: Record<string, string | Uint8Array> = {}) => openNFTab({ 'nftab.json': JSON.stringify(m), 'obs.csv': obs, ...files });

describe('core NFTab rules', () => {
  it('reads a conforming dataset', async () => {
    const tab = await open(base());
    expect(await tab.resolve(1, 'roi')).toEqual([3, 4]);
  });

  it('§4.3: rejects unknown top-level keys and extension keys without x-', async () => {
    await expect(open({ ...base(), colour: 'blue' })).rejects.toThrow(/unknown top-level manifest key "colour"/);
    await expect(open({ ...base(), extensions: { summary: {} } })).rejects.toThrow(/extension key "summary" must begin with "x-"/);
    await expect(open({ ...base(), extensions: { 'x-anything': { a: 1 } } })).resolves.toBeTruthy();
    await expect(open({ ...base(), primary_feature: 'nope' })).rejects.toThrow(/primary_feature "nope"/);
  });

  it('§5.1: row_id and observation axes are non-null in every row', async () => {
    await expect(openNFTab({ 'nftab.json': JSON.stringify(base()), 'obs.csv': 'row_id,subject,a,b\nr1,,1,2\n' })).rejects.toThrow(/"subject" is null/);
    await expect(openNFTab({ 'nftab.json': JSON.stringify(base()), 'obs.csv': 'row_id,subject,a,b\n,s1,1,2\n' })).rejects.toThrow(/"row_id" is null/);
  });

  it('§9.3: a columns encoding has one axis, a matching shape, and declared columns', async () => {
    const m = base();
    m.features.roi.logical.shape = [3];
    await expect(open(m)).rejects.toThrow(/shape \[3\] but 2 bound columns/);
    const two = base();
    two.features.roi.logical.axes = ['i', 'j'];
    await expect(open(two)).rejects.toThrow(/exactly one logical axis/);
    const undeclared = base();
    undeclared.features.roi.encodings[0].binding.columns = ['a', 'zzz'];
    await expect(open(undeclared)).rejects.toThrow(/column "zzz", which is not declared/);
  });

  it('§8.2/§14.1: volume and surface features need a support_ref that resolves; volume supports need grid_id', async () => {
    const m = base();
    m.observation_columns.loc = { dtype: 'string' };
    m.features.vol = { logical: { kind: 'volume', axes: ['x', 'y', 'z'], dtype: 'float32' }, encodings: [{ type: 'ref', binding: { backend: 'nifti', locator: { column: 'loc' } } }] };
    await expect(open(m)).rejects.toThrow(/volume feature "vol" must declare logical.support_ref/);
    m.features.vol.logical.support_ref = 'g';
    await expect(open(m)).rejects.toThrow(/support "g", which is not in supports/);
    m.supports = { g: { support_type: 'volume', support_id: 'g', space: 'MNI' } };
    await expect(open(m)).rejects.toThrow(/volume support "g" declares no grid_id/);
  });

  it('§9.2/§10.2: resource ids are unique, checksums agree and are verified', async () => {
    const bytes = new TextEncoder().encode('not really a nifti');
    const sum = createHash('sha256').update(bytes).digest('hex');
    const m = base();
    m.observation_columns.res = { dtype: 'string' };
    m.observation_columns.sum = { dtype: 'string' };
    m.supports = { g: { support_type: 'volume', support_id: 'g', space: 'MNI', grid_id: 'g' } };
    m.features.vol = { logical: { kind: 'volume', axes: ['x', 'y', 'z'], dtype: 'float32', support_ref: 'g' },
      encodings: [{ type: 'ref', binding: { resource_id: { column: 'res' }, checksum: { column: 'sum' } } }] };
    m.resources = { path: 'res.csv', format: 'csv' };
    const table = (rowSum: string) => `row_id,subject,a,b,res,sum\nr1,s1,1,2,img,${rowSum}\n`;
    const files = (reg: string, rowSum: string) => ({ 'nftab.json': JSON.stringify(m), 'obs.csv': table(rowSum), 'res.csv': reg, 'img.nii': bytes });
    await expect(openNFTab(files(`resource_id,backend,locator\nimg,nifti,img.nii\nimg,nifti,img.nii\n`, ''))).rejects.toThrow(/resource_id "img" is not unique/);
    const disagree = await openNFTab(files(`resource_id,backend,locator,checksum\nimg,nifti,img.nii,sha256:${'0'.repeat(64)}\n`, `sha256:${sum}`));
    await expect(disagree.resolve(0, 'vol')).rejects.toThrow(/disagrees with/);
    const wrong = await openNFTab(files(`resource_id,backend,locator,checksum\nimg,nifti,img.nii,sha256:${'0'.repeat(64)}\n`, ''));
    await expect(wrong.resolve(0, 'vol')).rejects.toThrow(/does not match its checksum/);
    const right = await openNFTab(files(`resource_id,backend,locator,checksum\nimg,nifti,img.nii,sha256:${sum}\n`, ''));
    // The checksum passes; the bytes are not a NIfTI, which is the next thing reported.
    await expect(right.resolve(0, 'vol')).rejects.toThrow(/not a valid NIfTI/);
  });

  it('Appendix C: an x-masked-volume vector is mapped back onto its grid', async () => {
    const m = base();
    m.features.roi.logical = { kind: 'vector', axes: ['voxel'], dtype: 'float32', shape: [2] };
    m.extensions = { 'x-masked-volume': { features: { roi: { grid_axes: ['x', 'y', 'z'], grid_shape: [3, 3, 3], grid_index_base: 0, index_map: { path: 'idx.tsv', format: 'tsv' } } } } };
    const tab = await open(m, { 'idx.tsv': 'index\tx\ty\tz\n1\t1\t1\t1\n2\t2\t1\t1\n' });
    const space = new NeuroSpace([3, 3, 3], [2, 2, 2], [-2, -2, -2]);
    const b = await tab.backing('roi', { space });
    expect(Array.from(b.extract(voxel([0, 0, 0])).values)).toEqual([1, 3]); // grid (1,1,1)
    expect(Array.from(b.extract(voxel([2, 0, 0])).values)).toEqual([2, 4]); // grid (2,1,1)
    await expect((await open(m, { 'idx.tsv': 'index\tx\ty\tz\n1\t1\t1\t1\n1\t2\t1\t1\n' })).backing('roi')).rejects.toThrow(/exactly once/);
    await expect((await open(m, { 'idx.tsv': 'index\tx\ty\tz\n1\t1\t1\t1\n2\t3\t1\t1\n' })).backing('roi')).rejects.toThrow(/outside grid_shape/);
  });
});
