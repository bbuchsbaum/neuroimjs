import { fileURLToPath } from 'node:url';
import { build } from 'vite';

// Package only the application. Consumer data arrives through the embedding
// API; neither local research data nor demo fixtures belong in this artifact.
process.env.VS_STATIC_SYNTHETIC = '0';
process.env.VS_SYNTHETIC = '0';
await build({
  configFile: fileURLToPath(new URL('../examples/volume-set/vite.config.ts', import.meta.url)),
  build: { outDir: fileURLToPath(new URL('../dist/space/frame', import.meta.url)) },
});
