import { expect, test, Page } from '@playwright/test';

const VIEW_URL = '/e2e/fixtures/simple-ortho-roi.html';

async function waitForSimpleViewer(page: Page) {
  await page.goto(VIEW_URL);
  await page.waitForFunction(() => (window as any).__SIMPLE_ORTHO_READY__ === true, { timeout: 45000 });
}

test.describe('SimpleOrthogonalViewer • template + red ROI', () => {
  test.beforeEach(async ({ page }) => {
    await waitForSimpleViewer(page);
  });

  test('renders three views and two layers', async ({ page }) => {
    const canvases = page.locator('[data-view] canvas');
    await expect(canvases).toHaveCount(3);

    const layers = await page.evaluate(() => (window as any).__SIMPLE_ORTHO_TEST__?.getLayers());
    const ids = layers.map((l: any) => l.id);
    expect(ids).toEqual(['mni-template', 'roi-sphere']);

    const roi = layers.find((l: any) => l.id === 'roi-sphere');
    expect(roi.colormapName).toBe('RedOverlay');
    expect(roi.alpha).toBeCloseTo(0.7, 1);

    const roiCount = await page.evaluate(() => (window as any).__SIMPLE_ORTHO_TEST__?.roiCount);
    expect(roiCount).toBeGreaterThan(500);
  });

  test('center voxel shows red overlay influence', async ({ page }) => {
    await page.waitForTimeout(150);
    const shot = await page.locator('[data-view="axial"]').screenshot();
    const redStats = await page.evaluate(async (pngBase64: string) => {
      const binary = atob(pngBase64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: 'image/png' });
      const img = await createImageBitmap(blob);
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return { error: 'no ctx' };
      ctx.drawImage(img, 0, 0);
      const cx = Math.floor(img.width / 2);
      const cy = Math.floor(img.height / 2);
      const size = 80;
      const data = ctx.getImageData(Math.max(0, cx - size / 2), Math.max(0, cy - size / 2), size, size).data;
      let maxDelta = -Infinity;
      let best = [0, 0, 0, 0];
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const a = data[i + 3];
        const delta = r - Math.max(g, b);
        if (delta > maxDelta) {
          maxDelta = delta;
          best = [r, g, b, a];
        }
      }
      return { maxDelta, best };
    }, shot.toString('base64'));

    expect(redStats.error).toBeUndefined();
    const [r, g, b, a] = redStats.best;
    expect(redStats.maxDelta).toBeGreaterThan(15);
    expect(r).toBeGreaterThan(g);
    expect(r).toBeGreaterThan(b);
    expect(a).toBeGreaterThan(30);

    const state = await page.evaluate(() => (window as any).__SIMPLE_ORTHO_TEST__?.getState());
    expect(state.layers).toHaveLength(2);
  });

  test('coronal and sagittal panels render with overlay', async ({ page }, testInfo) => {
    for (const name of ['coronal', 'sagittal']) {
      const panel = page.locator(`[data-view="${name}"]`);
      await expect(panel.locator('canvas')).toBeVisible({ timeout: 15000 });
      await page.waitForTimeout(100);
      const shot = await panel.screenshot();
      testInfo.attach(`${name}-roi.png`, { body: shot, contentType: 'image/png' });
      expect(shot.byteLength).toBeGreaterThan(3000);
    }
  });
});
