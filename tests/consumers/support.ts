import { expect, type Page } from '@playwright/test';
import type { ConsumerReport } from './pages/harness';

/**
 * The consumer root (a temporary npm project with the packed tarball
 * installed) and the URL serving the built contract pages. Both are set by
 * scripts/verify-consumers.mjs; run the suite through `npm run test:consumers`.
 */
export function consumerEnvironment(): { root: string; baseURL: string } {
  const root = process.env.NEUROIMJS_CONSUMER_ROOT;
  const baseURL = process.env.NEUROIMJS_CONSUMER_BASE_URL;
  if (!root || !baseURL) {
    throw new Error('Consumer contract specs run against the packed tarball: use `npm run test:consumers`.');
  }
  return { root, baseURL };
}

/**
 * Load a contract page, wait for its call sequence to finish, and fail with
 * the first broken step (and any page errors) if it did not complete.
 */
export async function runContractPage(page: Page, path: string, expectedSteps: string[]): Promise<ConsumerReport> {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') pageErrors.push(message.text());
  });
  await page.goto(path);
  await page.waitForFunction(
    () => (globalThis as unknown as { __CONSUMER__?: ConsumerReport }).__CONSUMER__?.done === true,
    undefined,
    { timeout: 45_000 }
  );
  const report = await page.evaluate(
    () => (globalThis as unknown as { __CONSUMER__: ConsumerReport }).__CONSUMER__
  );
  const failure = report.error
    ? `step "${report.error.step}" failed: ${report.error.message}\n${report.error.stack ?? ''}`
    : null;
  expect(failure, `page errors: ${pageErrors.join('\n') || 'none'}`).toBeNull();
  expect(report.steps).toEqual(expectedSteps);
  expect(pageErrors.filter(text => !/deprecat/i.test(text))).toEqual([]);
  return report;
}
