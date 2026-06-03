import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    // e2e/ holds Playwright specs (test.describe from @playwright/test) which
    // vitest cannot run — exclude them so they aren't collected as failures.
    exclude: ['**/node_modules/**', '**/dist/**', '**/e2e/**'],
    // Ensure proper module resolution
    resolve: {
      alias: {
        '@': resolve(__dirname, './src'),
      },
    },
    // Force proper ES module handling
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
});