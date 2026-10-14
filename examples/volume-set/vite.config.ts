import { defineConfig } from 'vite';
import path from 'node:path';
import { vsDataPlugin } from './vs-data-plugin';

const repo = path.resolve(__dirname, '../..');

// Volume-set demo: serves local data via vsDataPlugin (VS_DATA_ROOT, VS_TEMPLATE_DIR).
// VS_STATIC_SYNTHETIC=1 makes `vite build` emit a self-contained public demo;
// callers choose its outDir (normally docs/.vitepress/dist/space).
export default defineConfig({
  root: __dirname,
  base: './',
  plugins: [vsDataPlugin()],
  resolve: {
    alias: [
      { find: '@', replacement: path.join(repo, 'src') },
      { find: 'Buffer', replacement: 'buffer/' },
      { find: 'canvas', replacement: 'canvas/browser.js' },
    ],
    dedupe: ['buffer'],
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
    global: 'globalThis',
  },
  // Serve only the repository (src via the @ alias, node_modules); data comes through vsDataPlugin's routes.
  server: { fs: { allow: [repo] } },
  build: { emptyOutDir: true, sourcemap: false, chunkSizeWarningLimit: 4000 },
});
