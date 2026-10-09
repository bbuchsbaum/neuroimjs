/**
 * Vite plugin that serves a local volume set (per-subject contrast NIfTIs) and
 * an MNI template to the volume-set demo. Nothing is copied into the repo.
 *
 *   VS_DATA_ROOT     directory containing <model>/sub-*\/*.nii.gz
 *   VS_TEMPLATE_DIR  directory containing the TemplateFlow res-02 T1w + brain mask
 *
 * Endpoints:
 *   GET /vs/manifest.json         set members parsed from BIDS-style names
 *   GET /vs/files/<model>/<sub>/<file>.nii.gz
 *   GET /vs/template/T1w.nii.gz | /vs/template/mask.nii.gz
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Plugin, Connect } from 'vite';

export interface VsMember {
  model: string;
  subject: string;
  contrast: string;
  url: string;
}

const TEMPLATE_FILES: Record<string, string> = {
  'T1w.nii.gz': 'tpl-MNI152NLin2009cAsym_res-02_T1w.nii.gz',
  'mask.nii.gz': 'tpl-MNI152NLin2009cAsym_res-02_desc-brain_mask.nii.gz',
  'atlas.nii.gz': 'tpl-MNI152NLin2009cAsym_res-02_atlas-Schaefer2018_desc-400Parcels17Networks_dseg.nii.gz',
  'atlas.tsv': 'tpl-MNI152NLin2009cAsym_atlas-Schaefer2018_desc-400Parcels17Networks_dseg.tsv',
};

function entity(name: string, key: string): string | undefined {
  const m = new RegExp(`(?:^|_)${key}-([A-Za-z0-9]+)`).exec(name);
  return m ? m[1] : undefined;
}

export function buildManifest(root: string): VsMember[] {
  const members: VsMember[] = [];
  if (!fs.existsSync(root)) return members;
  for (const modelDir of fs.readdirSync(root).sort()) {
    const mPath = path.join(root, modelDir);
    if (!fs.statSync(mPath).isDirectory()) continue;
    const model = modelDir.replace(/^memory_/, '').replace(/_results$/, '');
    for (const subDir of fs.readdirSync(mPath).sort()) {
      const sPath = path.join(mPath, subDir);
      if (!subDir.startsWith('sub-') || !fs.statSync(sPath).isDirectory()) continue;
      for (const file of fs.readdirSync(sPath).sort()) {
        if (!file.endsWith('.nii.gz')) continue;
        const subject = entity(file, 'sub');
        const contrast = entity(file, 'contrast');
        if (!subject || !contrast) continue;
        members.push({
          model,
          subject,
          contrast,
          url: `/vs/files/${encodeURIComponent(modelDir)}/${encodeURIComponent(subDir)}/${encodeURIComponent(file)}`,
        });
      }
    }
  }
  return members;
}

function within(root: string, rel: string): string | null {
  const resolved = path.resolve(root, rel);
  return resolved.startsWith(path.resolve(root) + path.sep) ? resolved : null;
}

function sendFile(res: Parameters<Connect.NextHandleFunction>[1], file: string): void {
  const stat = fs.statSync(file);
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Length', String(stat.size));
  res.setHeader('Cache-Control', 'max-age=3600');
  fs.createReadStream(file).pipe(res);
}

export function vsDataPlugin(): Plugin {
  const dataRoot = process.env.VS_DATA_ROOT ?? '';
  const templateDir = process.env.VS_TEMPLATE_DIR ?? '';

  const handler: Connect.NextHandleFunction = (req, res, next) => {
    const url = decodeURIComponent((req.url ?? '').split('?')[0]);
    if (!url.startsWith('/vs/')) return next();
    try {
      if (url === '/vs/manifest.json') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ members: buildManifest(dataRoot) }));
        return;
      }
      if (url.startsWith('/vs/template/')) {
        const name = TEMPLATE_FILES[url.slice('/vs/template/'.length)];
        const file = name ? path.join(templateDir, name) : null;
        if (!file || !fs.existsSync(file)) {
          res.statusCode = 404;
          res.end('template not found; set VS_TEMPLATE_DIR');
          return;
        }
        if (file.endsWith('.tsv')) res.setHeader('Content-Type', 'text/tab-separated-values');
        return sendFile(res, file);
      }
      if (url.startsWith('/vs/files/')) {
        const file = within(dataRoot, url.slice('/vs/files/'.length));
        if (!file || !file.endsWith('.nii.gz') || !fs.existsSync(file)) {
          res.statusCode = 404;
          res.end('not found');
          return;
        }
        return sendFile(res, file);
      }
      res.statusCode = 404;
      res.end('not found');
    } catch (err) {
      res.statusCode = 500;
      res.end(String(err));
    }
  };

  return {
    name: 'vs-data',
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}
