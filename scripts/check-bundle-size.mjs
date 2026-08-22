import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const distDirectory = path.resolve('dist');
const maxFileGzipBytes = 370 * 1024;
const maxTotalGzipBytes = 800 * 1024;

async function javascriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory() && entry.name === 'assets') {
      files.push(...await javascriptFiles(absolute));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(absolute);
    }
  }
  return files;
}

const files = await javascriptFiles(distDirectory);
if (!files.some(file => path.basename(file) === 'neuroimjs.es.js') ||
    !files.some(file => path.basename(file) === 'neuroimjs.umd.js')) {
  throw new Error('Browser bundles are missing; run npm run build:vite first');
}

const sizes = [];
for (const file of files) {
  const gzipBytes = gzipSync(await readFile(file), { level: 9 }).length;
  sizes.push({ file: path.relative(distDirectory, file), gzipBytes });
}

const oversized = sizes.filter(({ gzipBytes }) => gzipBytes > maxFileGzipBytes);
const totalGzipBytes = sizes.reduce((total, { gzipBytes }) => total + gzipBytes, 0);
if (oversized.length > 0 || totalGzipBytes > maxTotalGzipBytes) {
  const details = oversized
    .map(({ file, gzipBytes }) => `${file}: ${(gzipBytes / 1024).toFixed(1)} KiB gzip`)
    .join('\n');
  throw new Error([
    details,
    `Total: ${(totalGzipBytes / 1024).toFixed(1)} KiB gzip`,
    `Budgets: ${(maxFileGzipBytes / 1024).toFixed(0)} KiB per file, ` +
      `${(maxTotalGzipBytes / 1024).toFixed(0)} KiB total`,
  ].filter(Boolean).join('\n'));
}

const largest = sizes.reduce((left, right) =>
  left.gzipBytes >= right.gzipBytes ? left : right
);
console.log(
  `Bundle budget passed: ${files.length} files, ` +
  `${(totalGzipBytes / 1024).toFixed(1)} KiB total gzip, ` +
  `${largest.file} ${(largest.gzipBytes / 1024).toFixed(1)} KiB gzip`
);
