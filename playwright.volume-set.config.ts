import { defineConfig, devices } from '@playwright/test';

/**
 * Volume-set demo gate. Runs only against the synthetic dataset (VS_SYNTHETIC=1):
 * no network, no private data. Usage: npm run test:e2e:volume-set
 */
const port = Number(process.env.VS_E2E_PORT ?? 5193);

export default defineConfig({
  testDir: './e2e/volume-set',
  fullyParallel: false,
  workers: 1,
  // Fixture loading/layout waits allow 90 s. Keep the enclosing test budget
  // larger than that bound, including rendering and interactions on CI.
  timeout: 120_000,
  reporter: [['list']],
  outputDir: 'test-results/volume-set',
  use: {
    baseURL: `http://localhost:${port}`,
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: `npx vite --config examples/volume-set/vite.config.ts --port ${port} --strictPort`,
    env: { VS_SYNTHETIC: '1' },
    url: `http://localhost:${port}/vs/manifest.json`,
    reuseExistingServer: false,
    timeout: 120 * 1000,
  },
});
