import { expect, test } from '@playwright/test';

/**
 * The built site works from a plain static directory: every file it asks for
 * is under its own folder, nothing comes from a server-side API or another
 * host, and the plot reads the data behind the map from the NFTab files.
 */
test('the static site reads the map and the data behind it from files beside the page', async ({ page, baseURL }) => {
  const requests: string[] = [];
  const failures: string[] = [];
  const errors: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  page.on('requestfailed', (r) => failures.push(`${r.url()} ${r.failure()?.errorText}`));
  page.on('response', (r) => { if (r.status() >= 400) failures.push(`${r.url()} ${r.status()}`); });
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/backed-demo/');
  await page.waitForFunction(() => (window as any).__BACKED__?.ready === true, { timeout: 60000 });

  await expect(page.locator('#status')).toHaveText(/^60 rows from faces-houses-betas\./);
  await expect(page.locator('.nij-plot-title')).toHaveText('cluster at 42 −52 −18, t > 3.1 (MNI152NLin2009aAsym)');
  await expect(page.locator('.nij-plot-warn')).toContainText('faces − houses, t > 3.1');

  // The threshold control still drives the plot.
  const layers = page.locator('layer-control-panel');
  await layers.locator('select[aria-label="Select layer"]').selectOption('faces − houses (t)');
  const hi = layers.locator('input[aria-label="Threshold high"]');
  await hi.fill('2.3');
  await hi.press('Enter');
  await expect(page.locator('.nij-plot-title')).toHaveText('cluster at 42 −52 −18, t > 2.3 (MNI152NLin2009aAsym)');

  const own = `${baseURL}/backed-demo/`;
  const outside = requests.filter((u) => !u.startsWith(own) && !u.startsWith('data:') && !u.startsWith('blob:'));
  expect(outside, 'requests outside the site folder').toEqual([]);
  expect(requests.some((u) => u.endsWith('/data/betas/maps/sub-20_betas.nii.gz'))).toBe(true);
  expect(failures).toEqual([]);
  expect(errors).toEqual([]);
});
