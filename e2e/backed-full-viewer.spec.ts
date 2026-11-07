import { expect, test, Page } from '@playwright/test';

/**
 * The full viewer: three synchronized SingleSliceViewers over one VolStack,
 * the layer sidebar, and the plot of the data behind the map. The probe is
 * configurable, and the cluster probe follows the sidebar's threshold.
 */
const URL = '/examples/backed/full-viewer.html';

async function ready(page: Page) {
  await page.goto(URL);
  await page.waitForFunction(() => (window as any).__BACKED__?.ready === true, { timeout: 60000 });
}
const title = (page: Page) => page.locator('.nij-plot-title').textContent();
const voxels = (page: Page) => page.evaluate(() => (window as any).__BACKED__.panel.scene().voxels as number);

test.describe('Backed plots in the full viewer', () => {
  test.beforeEach(async ({ page }) => ready(page));

  test('opens on the clicked cluster, and the sidebar lists only the user’s layers', async ({ page }) => {
    expect(await title(page)).toBe('cluster at 42 −52 −18, t > 3.1 (MNI)');
    await expect(page.locator('.nij-plot-warn')).toContainText('faces − houses, t > 3.1');
    const options = await page.locator('layer-control-panel select[aria-label="Select layer"] option').allTextContents();
    expect(options.map((o) => o.trim())).toEqual(['anatomy', 'faces − houses (t)']);
    const ids = await page.evaluate(() => (window as any).__BACKED__.stack.getLayerIds());
    expect(ids).toContain('backed-probe');
  });

  test('the threshold control in the sidebar reshapes the cluster being plotted', async ({ page }) => {
    const before = await voxels(page);
    const panel = page.locator('layer-control-panel');
    await panel.locator('select[aria-label="Select layer"]').selectOption('faces − houses (t)');
    const hi = panel.locator('input[aria-label="Threshold high"]');
    await hi.fill('2.3');
    await hi.press('Enter');
    await expect.poll(() => title(page)).toBe('cluster at 42 −52 −18, t > 2.3 (MNI)');
    expect(await voxels(page)).toBeGreaterThan(before);
    await expect(page.locator('.nij-plot-warn')).toContainText('t > 2.3');
    // The colour key in the fourth square follows the same threshold.
    await expect(page.locator('#legend .nij-legend-tick')).toContainText(['0', '2.3']);
  });

  test('the fourth square holds the map’s colour key and histogram, following the cursor', async ({ page }) => {
    const legend = page.locator('#legend .nij-legend');
    await expect(legend.locator('.nij-legend-title')).toHaveText('faces − houses (t)');
    await expect(legend.locator('.nij-legend-readout')).toHaveText(/^t = \d+(\.\d+)? at 42 −52 −18$/);
    await expect(legend.locator('.nij-legend-bar')).toHaveAttribute('data-thresholded', 'true');
    const painted = await legend.locator('canvas').evaluate((c: HTMLCanvasElement) => {
      const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
      return n;
    });
    expect(painted).toBeGreaterThan(500);
    const box = (await page.locator('#coronal').boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5);
    await page.mouse.move(box.x + box.width * 0.32, box.y + box.height * 0.52);
    await page.mouse.down();
    await page.mouse.up();
    await expect(legend.locator('.nij-legend-readout')).not.toHaveText(/at 42 −52 −18/);
  });

  test('the probe is configurable: sphere, radius, voxel, back to cluster', async ({ page }) => {
    await page.getByRole('button', { name: 'Sphere' }).click();
    await expect.poll(() => title(page)).toBe('8 mm sphere at 42 −52 −18 (MNI)');
    await page.getByLabel('Sphere radius').selectOption('4');
    await expect.poll(() => title(page)).toBe('4 mm sphere at 42 −52 −18 (MNI)');
    await page.getByRole('button', { name: 'Voxel' }).click();
    await expect.poll(() => voxels(page)).toBe(1);
    await page.getByRole('button', { name: 'Cluster' }).click();
    await expect.poll(() => title(page)).toBe('cluster at 42 −52 −18, t > 3.1 (MNI)');
  });

  test('a click in any view plots there, and a hover preview returns when the pointer leaves', async ({ page }) => {
    await page.getByRole('button', { name: 'Sphere' }).click();
    const committed = await title(page);
    const box = (await page.locator('#coronal').boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5);
    await page.mouse.move(box.x + box.width * 0.32, box.y + box.height * 0.52);
    await expect.poll(() => title(page)).not.toBe(committed);
    await page.mouse.move(box.x + box.width + 400, box.y + 10); // into the sidebar
    await expect.poll(() => title(page)).toBe(committed);
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5);
    await page.mouse.move(box.x + box.width * 0.32, box.y + box.height * 0.52);
    await page.mouse.down();
    await page.mouse.up();
    await page.mouse.move(box.x + box.width + 400, box.y + 10);
    await expect.poll(() => title(page)).not.toBe(committed);
  });
});
