import { expect, test } from '@playwright/test';

/** Stored summaries (NFTab Summary Profile) read from summary.json and drawn as stored. */
test('stored summaries are drawn as stored, with each interval named', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/examples/backed/summary/index.html');
  await page.waitForFunction(() => (window as any).__SUMMARY_READY__ === true, { timeout: 30000 });
  const panels = page.locator('.nij-plot');
  await expect(panels).toHaveCount(2);
  await expect(panels.nth(0).locator('.nij-plot-foot')).toHaveText('Bars: 95% CI (t). Stored values, drawn as stored; nothing is recalculated.');
  await expect(panels.nth(1).locator('.nij-plot-foot')).toContainText('Bars differ between rows: 95% within-subject CI (Cousineau–Morey) (7 rows); 90% CI (t) (1 row).');
  await expect(panels.nth(1).locator('.nij-facet')).toHaveText(['FFA', 'PPA']);
  // Point at the row without bounds: its interval and the stored reason are shown.
  const dots = panels.nth(1).locator('.nij-mean');
  const n = await dots.count();
  let found = false;
  for (let i = 0; i < n && !found; i++) {
    const box = (await dots.nth(i).boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    found = /Fewer than two subjects with both cells/.test((await panels.nth(1).locator('.nij-tip').textContent()) ?? '');
  }
  expect(found).toBe(true);
  expect(errors).toEqual([]);
});
