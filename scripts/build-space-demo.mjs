import { fileURLToPath } from 'node:url';
import { build } from 'vite';

// Documentation builds always use generated fixtures, regardless of a
// developer's local VS_DATA_ROOT or VS_TEMPLATE_DIR configuration.
process.env.VS_STATIC_SYNTHETIC = '1';
await build({
  configFile: fileURLToPath(new URL('../examples/volume-set/vite.config.ts', import.meta.url)),
  build: { outDir: fileURLToPath(new URL('../docs/.vitepress/dist/space', import.meta.url)) },
});
