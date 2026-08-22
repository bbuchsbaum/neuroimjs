import { expect, test } from '@playwright/test';

test('parallel searchlights match the sequential oracle in a real worker', async ({ page }) => {
  await page.goto('/e2e/fixtures/searchlight-worker.html');
  await expect(page.locator('#status')).toHaveText('passed');

  const result = await page.evaluate(() =>
    (window as typeof window & {
      searchlightWorkerResult?: {
        count?: number;
        progress?: number[];
        workerSupported?: boolean;
        error?: string;
      };
    }).searchlightWorkerResult
  );

  expect(result?.error).toBeUndefined();
  expect(result?.workerSupported).toBe(true);
  expect(result?.count).toBe(20);
  expect(result?.progress?.at(-1)).toBe(1);
});
