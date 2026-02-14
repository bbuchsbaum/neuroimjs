import { defineConfig } from 'vite';
import path from 'path';
import dts from 'vite-plugin-dts';
import process from 'process';
import { viteStaticCopy } from 'vite-plugin-static-copy';

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
          process: 'process',
          '@shoelace-style/shoelace': 'shoelace',
          nouislider: 'noUiSlider',
        },
      },
    },
    sourcemap: true,
    minify: 'terser',
  },
  plugins: [
    dts(),
    viteStaticCopy({
      targets: [
        {
          src: 'node_modules/@shoelace-style/shoelace/dist/assets',
          dest: 'shoelace',
        },
      ],
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      process: 'process/browser',
      Buffer: 'buffer/',
      // Prevent node-canvas from leaking into browser bundles
      canvas: 'canvas/browser.js',
    },
    dedupe: ['process', 'buffer'],
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
    global: 'window', // Provide a global variable
  },
  optimizeDeps: {
    include: ['process/browser'], // Ensure process/browser is included during optimization
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
