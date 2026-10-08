import { expect, test } from '@playwright/test';

test('mounting three slice views preserves fixed-height grid cells', async ({ page }) => {
  await page.goto('/e2e/fixtures/grid-host-sizing.html');
  await page.waitForFunction(() => (window as any).ready === true || (window as any).error);
  const state = await page.evaluate(() => ({
    error: (window as any).error,
    cells: [...document.querySelectorAll<HTMLElement>('.cell')].map(cell => ({
      height: cell.getBoundingClientRect().height,
      inlineHeight: cell.style.height,
      canvas: !!cell.querySelector('canvas'),
    })),
  }));
  expect(state.error).toBeUndefined();
  expect(state.cells).toHaveLength(3);
  for (const cell of state.cells) {
    expect(cell.height).toBe(300);
    expect(cell.inlineHeight).toBe('');
    expect(cell.canvas).toBe(true);
  }
  await page.waitForTimeout(1200);
  expect(await page.locator('.cell').evaluateAll(cells => cells.map(cell => cell.getBoundingClientRect().height)))
    .toEqual([300, 300, 300]);
});
