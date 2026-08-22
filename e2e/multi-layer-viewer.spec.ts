import { expect, test, Page } from '@playwright/test';

const DEMO_URL = '/examples/multi-layer-viewer.html';

async function waitForReady(page: Page) {
  await page.goto(DEMO_URL);
  // Wait for status bar to say "Ready"
  await page.waitForFunction(
    () => document.getElementById('status')?.textContent === 'Ready',
    { timeout: 60000 }
  );
  // Give ResizeObserver and PIXI time to settle
  await page.waitForTimeout(1000);
}

test.describe('Multi-layer viewer demo', () => {
  test.beforeEach(async ({ page }) => {
    await waitForReady(page);
  });

  test('three canvases are visible with rendered content', async ({ page }, testInfo) => {
    for (const id of ['axial-container', 'sagittal-container', 'coronal-container']) {
      const canvas = page.locator(`#${id} canvas`).first();
      await expect(canvas).toBeVisible({ timeout: 10000 });
      const box = await canvas.boundingBox();
      expect(box, `${id} should have a bounding box`).toBeTruthy();
      expect(box!.width, `${id} width`).toBeGreaterThan(50);
      expect(box!.height, `${id} height`).toBeGreaterThan(50);

      // Screenshot size proxy: a brain render is >> 3KB
      const shot = await page.locator(`#${id}`).screenshot();
      testInfo.attach(`${id}.png`, { body: shot, contentType: 'image/png' });
      expect(shot.byteLength, `${id} should contain rendered content`).toBeGreaterThan(3000);
    }
  });

  test('layer control panel initializes with two layers', async ({ page }) => {
    const panel = page.locator('layer-control-panel');
    await expect(panel).toBeVisible();

    // The layer selector should have two options
    const options = panel.locator('select[aria-label="Select layer"] option');
    await expect(options).toHaveCount(2);

    // Check layer names
    const firstText = await options.nth(0).textContent();
    const secondText = await options.nth(1).textContent();
    expect(firstText?.trim()).toBe('T1-background');
    expect(secondText?.trim()).toBe('activation');
  });

  test('layer selection switches control values', async ({ page }) => {
    const panel = page.locator('layer-control-panel');

    const layerSelect = panel.getByLabel('Select layer');

    // Read the initial alpha value (T1-background should be opacity=1)
    const alphaSlider = panel.getByLabel('Alpha', { exact: true });
    await expect(alphaSlider).toHaveValue('1');

    // Select the activation layer
    await layerSelect.selectOption('activation');

    // Alpha should now be 0.7 for the activation layer
    await expect(alphaSlider).toHaveValue('0.7');
    await expect(panel.getByLabel('Colormap')).toHaveValue('Hot');
  });

  test('sync toggle works', async ({ page }) => {
    const syncBtn = page.locator('#toggle-sync');
    await syncBtn.click();
    const statusText = await page.locator('#sync-status').textContent();
    expect(statusText).toBe('OFF');

    // Badges should show INDEPENDENT
    const badge = page.locator('#axial-sync');
    await expect(badge).toHaveText('INDEPENDENT');
  });

  test('crosshair toggle works', async ({ page }) => {
    // Take a screenshot before toggling
    const before = await page.locator('#axial-container').screenshot();

    // Toggle crosshairs off
    await page.locator('#toggle-crosshair').click();
    await page.waitForTimeout(500);

    // Take screenshot after toggling — should differ (crosshair gone)
    const after = await page.locator('#axial-container').screenshot();

    // The screenshots should differ (crosshair lines removed)
    expect(Buffer.compare(before, after)).not.toBe(0);
  });

  test('view info shows Ready for all views', async ({ page }) => {
    for (const id of ['axial-info', 'sagittal-info', 'coronal-info']) {
      const text = await page.locator(`#${id}`).textContent();
      expect(text).toBe('Ready');
    }
  });

  test('coordinate display updates on click', async ({ page }) => {
    // Click in the axial view to trigger coordinate update
    const axialContainer = page.locator('#axial-container');
    await axialContainer.click({ position: { x: 100, y: 100 } });
    await page.waitForTimeout(500);

    // The coord display should show world coordinates (not the initial "-")
    const coordText = await page.locator('#coord-display').textContent();
    expect(coordText).toContain('World:');
    expect(coordText).toContain('Slices:');
  });
});
