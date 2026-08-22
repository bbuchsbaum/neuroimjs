import { defineConfig } from 'vite';
import path from 'path';
import process from 'process';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    server: {
      deps: {
        inline: [
          // Inline our own modules to ensure proper class inheritance
          /src\/volume/,
          /src\/display/,
        ],
      },
    },
  },
  build: {
    // Do NOT wipe dist: the tsc CJS/ESM/types output (dist/cjs, dist/esm,
    // dist/types) is produced by `npm run build` and the browser bundle is
    // added on top by `vite build`.
    emptyOutDir: false,
    lib: {
      // Use browser-safe entry for UMD/ES bundles
      entry: path.resolve(__dirname, 'src/browser.ts'),
      name: 'neuroimjs',
      fileName: (format) => `neuroimjs.${format}.js`,
      formats: ['es', 'umd'],
    },
    rollupOptions: {
      // Externalize heavy/host-provided deps if needed
      external: [
        '@stdlib/ndarray',
        '@shoelace-style/shoelace',
      ],
      output: {
        exports: 'named',
        extend: true,
        globals: {
          '@stdlib/ndarray': 'ndarray',
          '@shoelace-style/shoelace': 'shoelace',
          nouislider: 'noUiSlider',
        },
      },
    },
    sourcemap: true,
    minify: 'terser',
  },
  plugins: [],
  resolve: {
    alias: [
      { find: '@', replacement: path.resolve(__dirname, './src') },
      { find: 'Buffer', replacement: 'buffer/' },
      // Prevent node-canvas from leaking into browser bundles
      { find: 'canvas', replacement: 'canvas/browser.js' },
    ],
    dedupe: ['buffer'],
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
    global: 'globalThis',
  },
  optimizeDeps: {
    exclude: [],
    entries: [
      // Only scan specific entry points to avoid problematic example files
      'src/index.ts',
      'src/browser.ts',
      'e2e/fixtures/*.html',
    ],
  },
  server: {
    fs: {
      strict: false, // Allow serving files outside root
    },
  },
});
