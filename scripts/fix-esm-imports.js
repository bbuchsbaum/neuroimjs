/**
 * Post-build script: adds .js extensions to relative imports in dist/esm/
 * and dist/types/ so Node's ESM loader and NodeNext TypeScript consumers can
 * resolve them.
 *
 * Transforms:
 *   from './geometry/Axis'        -> from './geometry/Axis.js'
 *   from '../volume/DenseNeuroVol' -> from '../volume/DenseNeuroVol.js'
 *   export * from './types'       -> export * from './types.js'
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const ESM_DIR = join(import.meta.dirname, '..', 'dist', 'esm');
const TYPES_DIR = join(import.meta.dirname, '..', 'dist', 'types');

// Match from/import with relative paths that lack an extension
const IMPORT_RE = /(from\s+['"])(\.\.?\/[^'"]+?)(['"])/g;
const REQUIRE_RE = /(require\s*\(\s*['"])(\.\.?\/[^'"]+?)(['"]\s*\))/g;
// Side-effect imports: import './foo';
const SIDE_EFFECT_RE = /(import\s+['"])(\.\.?\/[^'"]+?)(['"])/g;
const DYNAMIC_IMPORT_RE = /(import\s*\(\s*['"])(\.\.?\/[^'"]+?)(['"]\s*\))/g;

async function getFiles(dir, suffix) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await getFiles(full, suffix));
    } else if (entry.name.endsWith(suffix)) {
      files.push(full);
    }
  }
  return files;
}

function addExtension(match, prefix, path, suffix) {
  // Skip if already has an extension
  if (/\.\w+$/.test(path)) return match;
  return `${prefix}${path}.js${suffix}`;
}

async function fixFile(filePath) {
  const content = await readFile(filePath, 'utf8');
  let fixed = content.replace(IMPORT_RE, addExtension);
  fixed = fixed.replace(REQUIRE_RE, addExtension);
  fixed = fixed.replace(SIDE_EFFECT_RE, addExtension);
  fixed = fixed.replace(DYNAMIC_IMPORT_RE, addExtension);
  if (fixed !== content) {
    await writeFile(filePath, fixed, 'utf8');
    return true;
  }
  return false;
}

for (const [label, directory, suffix] of [
  ['ESM', ESM_DIR, '.js'],
  ['type declaration', TYPES_DIR, '.d.ts'],
]) {
  const files = await getFiles(directory, suffix);
  let count = 0;
  for (const file of files) {
    if (await fixFile(file)) count++;
  }
  console.log(`Fixed .js extensions in ${count}/${files.length} ${label} files`);
}
