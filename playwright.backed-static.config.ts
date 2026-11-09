import { defineConfig, devices } from '@playwright/test';

/**
 * The static backed-plots site, served by a plain file server from dist/
 * under a subpath (/backed-demo/), the way any static host would serve it.
 * Build it first: npm run build:backed-demo
 */
const chromiumExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
const port = 4417;

export default defineConfig({
  testDir: './e2e/static',
  timeout: 90 * 1000,
  reporter: 'list',
  use: { baseURL: `http://127.0.0.1:${port}`, trace: 'off' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], launchOptions: chromiumExecutable ? { executablePath: chromiumExecutable } : undefined } }],
  webServer: {
    command: `python3 -m http.server ${port} --bind 127.0.0.1 --directory dist`,
    url: `http://127.0.0.1:${port}/backed-demo/`,
    reuseExistingServer: false,
    timeout: 30 * 1000,
  },
});
