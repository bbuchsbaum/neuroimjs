import { expect, test, Page } from '@playwright/test';

/**
 * The backed-plots demo: a real SimpleOrthogonalViewer over the MNI template
 * with a plot of the data behind the map beside it.
 */
const URL = '/examples/backed/viewer.html';

async function ready(page: Page) {
  await page.goto(URL);
  await page.waitForFunction(() => (window as any).__BACKED__?.ready === true, { timeout: 60000 });
}

const title = (page: Page) => page.locator('.nij-plot-title').textContent();
const layer = (page: Page, id: string) =>
  page.evaluate((id) => (window as any).__BACKED__.viewer.listLayers().find((l: any) => l.id === id) ?? null, id);

test.describe('Backed plots in the viewer', () => {
  test.beforeEach(async ({ page }) => ready(page));

  test('opens plotting the right fusiform, marked on the brain and flagged circular', async ({ page }) => {
    expect(await title(page)).toBe('8 mm sphere at 42 −52 −18 (MNI)');
    await expect(page.locator('.nij-plot-warn')).toContainText('Circular');
    expect((await layer(page, 'backed-probe'))?.visible).toBe(true);
  });

  test('a click on the brain plots the data there', async ({ page }) => {
    const before = await title(page);
    const box = (await page.locator('#viewer').boundingBox())!;
    // The axial view is the lower-left cell of the ortho layout. The viewer
    // tracks the pointer on move, so move there first, as a person would.
    const x = box.x + box.width * 0.2, y = box.y + box.height * 0.72;
    await page.mouse.move(x - 4, y - 4);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.up();
    await expect.poll(() => title(page)).not.toBe(before);
    expect(await title(page)).toMatch(/^8 mm sphere at /);
    const voxels = await page.evaluate(() => (window as any).__BACKED__.panel.scene().voxels);
    expect(voxels).toBeGreaterThan(0);
  });

  test('a hover preview returns to the clicked point when the pointer leaves', async ({ page }) => {
    const committed = await title(page);
    const box = (await page.locator('#viewer').boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.15, box.y + box.height * 0.65);
    await page.mouse.move(box.x + box.width * 0.18, box.y + box.height * 0.68);
    await expect.poll(() => title(page)).not.toBe(committed);
    await page.mouse.move(box.x + box.width + 300, box.y + 20);
    await expect.poll(() => title(page)).toBe(committed);
  });

  test('reading a probe is fast enough to follow the pointer', async ({ page }) => {
    const ms = await page.evaluate(async () => {
      const { view } = (window as any).__BACKED__;
      const pts = [[40, -50, -16], [-40, -54, -18], [0, -88, 0], [20, 10, 30], [42, -52, -18]];
      const t0 = performance.now();
      for (const p of pts) await view.probeAt(p);
      return (performance.now() - t0) / pts.length;
    });
    expect(ms).toBeLessThan(50);
  });

  test("pointing at a subject in the plot shows that subject's map", async ({ page }) => {
    const line = page.locator('.nij-subject-line').nth(2);
    const d = (await line.getAttribute('d'))!;
    const [x, y] = d.slice(1).split('L')[0].split(',').map(Number);
    const svg = page.locator('.nij-plot-svg');
    const box = (await svg.boundingBox())!;
    const vb = await svg.evaluate((s: SVGSVGElement) => s.viewBox.baseVal.width);
    await page.mouse.move(box.x + (x * box.width) / vb, box.y + (y * box.width) / vb);
    await expect.poll(async () => (await layer(page, 'backed-subject'))?.visible).toBe(true);
    await expect(page.locator('.nij-hot-label')).toHaveText(/^sub-\d\d$/);
    await page.mouse.move(5, 5);
    await expect.poll(async () => (await layer(page, 'backed-subject'))?.visible).toBe(false);
  });
});
