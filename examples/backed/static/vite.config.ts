/**
 * Static build of the backed-plots demo: relative asset paths (base './'), so
 * the output directory can be served from any host and any subpath.
 * The study's files are generated into `publicDir` first
 * (scripts/make-backed-demo-data.ts) and copied beside the page as ./data.
 */
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: here('.'),
  base: './',
  publicDir: here('../../../dist/backed-demo-data'),
  define: { 'process.env.NODE_ENV': JSON.stringify('production'), global: 'globalThis' },
  build: { outDir: here('../../../dist/backed-demo'), emptyOutDir: true, chunkSizeWarningLimit: 4000 },
});
