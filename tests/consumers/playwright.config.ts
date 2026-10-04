import { defineConfig, devices } from '@playwright/test';

/**
 * Downstream consumer contract suite. Run it through `npm run test:consumers`
 * (scripts/verify-consumers.mjs), which packs and installs the tarball, builds
 * the contract pages against it, serves them, and sets the environment below.
 */
const chromiumExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 90_000,
  reporter: 'list',
  outputDir: '../../test-results/consumers',
  use: {
    baseURL: process.env.NEUROIMJS_CONSUMER_BASE_URL,
    viewport: { width: 1280, height: 900 },
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: chromiumExecutable ? { executablePath: chromiumExecutable } : undefined,
      },
    },
  ],
});
