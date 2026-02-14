import { test, expect } from '@playwright/test';

test.describe('SparseNeuroVol Overlay Support', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the overlay test fixture
    await page.goto('/e2e/fixtures/overlay-test.html');

    // Wait for all tests to complete
    await page.waitForFunction(() => {
      return (window as any).__TEST_RESULTS__ !== undefined;
    }, { timeout: 30000 });
  });

  test('all overlay tests pass', async ({ page }) => {
    // Get test results from the page
    const results = await page.evaluate(() => (window as any).__TEST_RESULTS__);

    // Log results for debugging
    console.log('Test Results:', JSON.stringify(results, null, 2));

    // Check all tests passed
    expect(results.allPassed).toBe(true);
    expect(results.passed).toBe(results.total);
    // Dynamic addLayer regression specifically
    const dynamicTest = results.results.find((r: any) => r.name === 'Dynamic addLayer increases stack length');
    expect(dynamicTest?.passed).toBe(true);
  });

  test('dense volume viewer renders', async ({ page }) => {
    // Check the dense-only container has a canvas
    const canvas = page.locator('[data-testid="dense-only"] canvas');
    await expect(canvas).toBeVisible({ timeout: 10000 });

    // Check status shows success
    const status = page.locator('#status-dense');
    await expect(status).toHaveClass(/success/);
  });

  test('sparse volume viewer renders', async ({ page }) => {
    // Check the sparse-only container has a canvas
    const canvas = page.locator('[data-testid="sparse-only"] canvas');
    await expect(canvas).toBeVisible({ timeout: 10000 });

    // Check status shows success
    const status = page.locator('#status-sparse');
    await expect(status).toHaveClass(/success/);
  });

  test('overlay viewer renders mixed volumes', async ({ page }) => {
    // Check the overlay container has a canvas
    const canvas = page.locator('[data-testid="overlay"] canvas');
    await expect(canvas).toBeVisible({ timeout: 10000 });

    // Check status shows success
    const status = page.locator('#status-overlay');
    await expect(status).toHaveClass(/success/);
  });

  test('ROI overlay viewer renders', async ({ page }) => {
    // Check the roi-overlay container has a canvas
    const canvas = page.locator('[data-testid="roi-overlay"] canvas');
    await expect(canvas).toBeVisible({ timeout: 10000 });

    // Check status shows success
    const status = page.locator('#status-roi');
    await expect(status).toHaveClass(/success/);
  });

  test('visual regression: overlay test page', async ({ page }) => {
    // Wait for all viewers to render
    await page.waitForTimeout(2000);

    // Take a screenshot for visual comparison
    await expect(page).toHaveScreenshot('overlay-test-page.png', {
      maxDiffPixels: 500, // Allow some variance due to anti-aliasing
      timeout: 10000,
    });
  });

  test('visual regression: dense viewer', async ({ page }) => {
    await page.waitForTimeout(1000);
    const denseViewer = page.locator('[data-testid="dense-only"]');
    await expect(denseViewer).toHaveScreenshot('dense-viewer.png', {
      maxDiffPixels: 100,
    });
  });

  test('visual regression: sparse viewer', async ({ page }) => {
    await page.waitForTimeout(1000);
    const sparseViewer = page.locator('[data-testid="sparse-only"]');
    await expect(sparseViewer).toHaveScreenshot('sparse-viewer.png', {
      maxDiffPixels: 100,
    });
  });

  test('visual regression: overlay viewer', async ({ page }) => {
    await page.waitForTimeout(1000);
    const overlayViewer = page.locator('[data-testid="overlay"]');
    await expect(overlayViewer).toHaveScreenshot('overlay-viewer.png', {
      maxDiffPixels: 100,
    });
  });

  test('visual regression: ROI overlay viewer', async ({ page }) => {
    await page.waitForTimeout(1000);
    const roiViewer = page.locator('[data-testid="roi-overlay"]');
    await expect(roiViewer).toHaveScreenshot('roi-overlay-viewer.png', {
      maxDiffPixels: 100,
    });
  });

  test('visual regression: template dynamic ROI viewer', async ({ page }) => {
    await page.waitForTimeout(1000);
    const dynViewer = page.locator('[data-testid="template-dynamic"]');
    await expect(dynViewer).toHaveScreenshot('template-dynamic-viewer.png', {
      maxDiffPixels: 120,
    });
  });
});

test.describe('Overlay interaction tests', () => {
  test('viewers respond to window resize', async ({ page }) => {
    await page.goto('/e2e/fixtures/overlay-test.html');

    // Wait for initial render
    await page.waitForFunction(() => {
      return (window as any).__TEST_RESULTS__ !== undefined;
    }, { timeout: 30000 });

    // Get initial canvas size
    const initialSize = await page.locator('[data-testid="dense-only"] canvas').boundingBox();

    // Resize window
    await page.setViewportSize({ width: 800, height: 600 });
    await page.waitForTimeout(500);

    // Verify the canvas is still visible
    const canvas = page.locator('[data-testid="dense-only"] canvas');
    await expect(canvas).toBeVisible();
  });
});
