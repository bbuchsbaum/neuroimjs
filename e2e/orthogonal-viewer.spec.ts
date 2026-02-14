import { expect, test, Page } from '@playwright/test';

const VIEW_URL = '/e2e/fixtures/orthogonal-viewer.html';

async function waitForViewerReady(page: Page) {
  await page.goto(VIEW_URL);
  await page.waitForFunction(() => (window as any).__ORTHO_READY__ === true, { timeout: 45000 });
}

const viewNames = ['axial', 'coronal', 'sagittal'] as const;

test.describe('OrthogonalImageViewer • MNI template', () => {
  test.beforeEach(async ({ page }) => {
    await waitForViewerReady(page);
  });

  test('renders three template slices', async ({ page }) => {
    for (const name of viewNames) {
      const canvas = page.locator(`[data-view="${name}"] canvas`).first();
      await expect(canvas, `${name} canvas should be visible`).toBeVisible({ timeout: 15000 });
      const box = await canvas.boundingBox();
      expect(box?.width).toBeGreaterThan(180);
      expect(box?.height).toBeGreaterThan(180);
    }

    const dims = await page.evaluate(() => (window as any).__ORTHO_TEST__?.dims);
    expect(Array.isArray(dims)).toBe(true);
    expect(dims.length).toBe(3);
  });

  test('visual evidence: each panel shows a rendered slice', async ({ page }, testInfo) => {
    for (const name of viewNames) {
      const panel = page.locator(`[data-view="${name}"]`);
      await expect(panel.locator('canvas').first()).toBeVisible({ timeout: 15000 });
      await page.waitForTimeout(120); // allow first draw to settle
      const shot = await panel.screenshot();
      testInfo.attach(`${name}-panel.png`, { body: shot, contentType: 'image/png' });
      expect(shot.byteLength).toBeGreaterThan(4000);
    }
  });

  test('crosshair toggles and coordinates stay in sync', async ({ page }) => {
    const initial = await page.evaluate(() => (window as any).__ORTHO_TEST__.getCoords());

    const targetWorld = await page.evaluate(() => {
      const testApi = (window as any).__ORTHO_TEST__;
      const [dx, dy, dz] = testApi.dims;
      const coord = [
        Math.floor(dx * 0.62),
        Math.floor(dy * 0.38),
        Math.floor(dz * 0.55),
      ];
      testApi.setVoxelCoord(coord);
      return testApi.voxelToWorld(coord);
    });

    await page.waitForTimeout(120);

    const after = await page.evaluate(() => (window as any).__ORTHO_TEST__.getCoords());

    expect(after.global[0]).not.toBeCloseTo(initial.global[0]);
    expect(after.global[1]).not.toBeCloseTo(initial.global[1]);
    expect(after.global[2]).not.toBeCloseTo(initial.global[2]);

    for (const name of viewNames) {
      const coords = (after as any)[name];
      expect(coords[0]).toBeCloseTo(targetWorld[0], 3);
      expect(coords[1]).toBeCloseTo(targetWorld[1], 3);
      expect(coords[2]).toBeCloseTo(targetWorld[2], 3);
    }

    const crosshairOn = await page.evaluate(() => (window as any).__ORTHO_TEST__.hasCrosshair());
    expect(crosshairOn).toBe(true);

    await page.evaluate(() => (window as any).__ORTHO_TEST__.toggleCrosshair(false));
    await page.waitForTimeout(40);
    const crosshairOff = await page.evaluate(() => (window as any).__ORTHO_TEST__.hasCrosshair());
    expect(crosshairOff).toBe(false);

    await page.evaluate(() => (window as any).__ORTHO_TEST__.toggleCrosshair(true));
    await page.waitForTimeout(40);
    const crosshairRestored = await page.evaluate(() => (window as any).__ORTHO_TEST__.hasCrosshair());
    expect(crosshairRestored).toBe(true);
  });
});
