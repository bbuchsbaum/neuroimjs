import { expect, test, Page } from '@playwright/test';

const DEMO_URL = '/examples/multi-panel-custom-layout.html';

async function waitForReady(page: Page) {
  await page.goto(DEMO_URL);
  // Wait for status to say "Ready"
  await page.waitForFunction(
    () => document.getElementById('status')?.textContent === 'Ready',
    { timeout: 45000 }
  );
  // Give ResizeObserver time to fire and re-fit content
  await page.waitForTimeout(500);
}

test.describe('Multi-panel custom layout demo', () => {
  test.beforeEach(async ({ page }) => {
    await waitForReady(page);
  });

  test('all three canvases are visible and non-trivially sized', async ({ page }) => {
    for (const id of ['axial-container', 'sagittal-container', 'coronal-container']) {
      const canvas = page.locator(`#${id} canvas`).first();
      await expect(canvas).toBeVisible({ timeout: 10000 });
      const box = await canvas.boundingBox();
      expect(box, `${id} canvas should have a bounding box`).toBeTruthy();
      expect(box!.width, `${id} canvas width`).toBeGreaterThan(50);
      expect(box!.height, `${id} canvas height`).toBeGreaterThan(50);
    }
  });

  test('canvases render non-black content (brain is visible)', async ({ page }, testInfo) => {
    // Use screenshot byte size as a proxy: a non-trivial PNG is much larger than a black canvas
    for (const id of ['axial-container', 'sagittal-container', 'coronal-container']) {
      const container = page.locator(`#${id}`);
      const shot = await container.screenshot();
      testInfo.attach(`${id}.png`, { body: shot, contentType: 'image/png' });
      // A black canvas PNG is typically < 1KB; a brain render is >> 3KB
      expect(shot.byteLength, `${id} screenshot should contain rendered content`).toBeGreaterThan(3000);
    }
  });

  test('views loaded shows 3 / 3', async ({ page }) => {
    const text = await page.locator('#views-loaded').textContent();
    expect(text).toBe('3 / 3');
  });

  test('synchronizer toggle works', async ({ page }) => {
    const syncBtn = page.locator('#toggle-sync');
    await syncBtn.click();
    const statusText = await page.locator('#sync-status').textContent();
    expect(statusText).toBe('OFF');
  });
});
