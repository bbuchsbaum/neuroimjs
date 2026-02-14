#!/usr/bin/env node
// ESM stub that forwards to the maintained TypeScript version.
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const tsPath = path.join(__dirname, 'load_image.ts');

const bin = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const result = spawnSync(bin, ['tsx', tsPath], { stdio: 'inherit' });
if (result.error) {
  console.error('\nFailed to forward to TypeScript script. Try:');
  console.error('  npm run demo:load');
  process.exit(1);
}
process.exit(result.status ?? 0);
