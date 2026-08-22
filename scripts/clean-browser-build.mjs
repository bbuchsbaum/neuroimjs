import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';

const distDirectory = path.resolve('dist');

let entries;
try {
  entries = await readdir(distDirectory, { withFileTypes: true });
} catch (error) {
  if (error?.code === 'ENOENT') process.exit(0);
  throw error;
}

for (const entry of entries) {
  const isBrowserFile = entry.isFile() &&
    (entry.name.endsWith('.js') ||
      entry.name.endsWith('.js.map') ||
      entry.name.endsWith('.css') ||
      entry.name.endsWith('.css.map'));
  if (isBrowserFile || (entry.isDirectory() && entry.name === 'assets')) {
    await rm(path.join(distDirectory, entry.name), { recursive: true, force: true });
  }
}
