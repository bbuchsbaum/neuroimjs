import { expect, test } from '@playwright/test';

test('scatter fields match the sequential oracle and preserve affine in a real worker', async ({ page }) => {
  await page.goto('/e2e/fixtures/scatter-field-worker.html');
  await expect(page.locator('#status')).not.toHaveText('running');

  const result = await page.evaluate(() =>
    (window as typeof window & {
      scatterFieldWorkerResult?: {
        maxValue?: number;
        nonZeroCount?: number;
        workerSupported?: boolean;
        error?: string;
      };
    }).scatterFieldWorkerResult
  );

  expect(result?.error).toBeUndefined();
  await expect(page.locator('#status')).toHaveText('passed');
  expect(result?.workerSupported).toBe(true);
  expect(result?.maxValue).toBeGreaterThan(0);
  expect(result?.nonZeroCount).toBeGreaterThan(0);
});
