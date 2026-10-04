import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    // Copies the committed MNI152 template into the git-ignored tests/data/.
    globalSetup: ['./scripts/prepare-test-data.mjs'],
    // e2e/ and tests/consumers/ hold Playwright specs (test.describe from
    // @playwright/test) which vitest cannot run — exclude them so they aren't
    // collected as failures. tests/consumers/ runs via `npm run test:consumers`.
    // .claude/ holds agent worktrees with full copies of tests/.
    exclude: ['**/node_modules/**', '**/dist/**', '**/e2e/**', 'tests/consumers/**', '**/.claude/**'],
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