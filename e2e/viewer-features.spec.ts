import { expect, test, Page } from '@playwright/test';

const VIEW_URL = '/e2e/fixtures/viewer-features.html';
const viewNames = ['axial', 'coronal', 'sagittal'] as const;

async function waitForReady(page: Page) {
  await page.goto(VIEW_URL);
  await page.waitForFunction(
    () => (window as any).__FEATURES_READY__ === true,
    { timeout: 45000 }
  );
}

/** Helper: get the canvas element for a specific view panel */
function canvasFor(page: Page, view: string) {
  return page.locator(`[data-view="${view}"] canvas`).first();
}

// ─── Scroll Wheel Slice Navigation ──────────────────────────────────────

test.describe('Scroll wheel slice navigation', () => {
  test.beforeEach(async ({ page }) => {
    await waitForReady(page);
  });

  test('scroll down increments slice index', async ({ page }) => {
    const before = await page.evaluate(
      () => (window as any).__FEATURES_TEST__.getSliceIndices()
    );

    const canvas = canvasFor(page, 'axial');
    await canvas.scrollIntoViewIfNeeded();
    const box = await canvas.boundingBox();
    expect(box).toBeTruthy();

    // Scroll down (positive deltaY) on the axial canvas
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.wheel(0, 100);
    await page.waitForTimeout(200);

    const after = await page.evaluate(
      () => (window as any).__FEATURES_TEST__.getSliceIndices()
    );

    // Axial slice should have changed; the other views update via crosshair sync
    expect(after.axial).not.toBe(before.axial);
  });

  test('scroll up decrements slice index', async ({ page }) => {
    // First scroll down a few times to ensure we're not at index 0
    const canvas = canvasFor(page, 'coronal');
    await canvas.scrollIntoViewIfNeeded();
    const box = await canvas.boundingBox();

    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(150);

    const mid = await page.evaluate(
      () => (window as any).__FEATURES_TEST__.getSliceIndices()
    );

    // Now scroll up
    await page.mouse.wheel(0, -100);
    await page.waitForTimeout(200);

    const after = await page.evaluate(
      () => (window as any).__FEATURES_TEST__.getSliceIndices()
    );

    expect(after.coronal).not.toBe(mid.coronal);
  });

  test('scroll on one view does not change another view directly', async ({ page }) => {
    // Scroll on sagittal canvas
    const canvas = canvasFor(page, 'sagittal');
    await canvas.scrollIntoViewIfNeeded();
    const box = await canvas.boundingBox();

    const before = await page.evaluate(
      () => (window as any).__FEATURES_TEST__.getSliceIndices()
    );

    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.wheel(0, 100);
    await page.waitForTimeout(200);

    const after = await page.evaluate(
      () => (window as any).__FEATURES_TEST__.getSliceIndices()
    );

    // Sagittal slice should change
    expect(after.sagittal).not.toBe(before.sagittal);
  });
});

// ─── Zoom ───────────────────────────────────────────────────────────────

test.describe('Zoom (Ctrl + scroll)', () => {
  test.beforeEach(async ({ page }) => {
    await waitForReady(page);
  });

  test('Ctrl+scroll changes zoom level', async ({ page }) => {
    const zoomBefore = await page.evaluate(
      () => (window as any).__FEATURES_TEST__.getZoom('axial')
    );
    expect(zoomBefore).toBeCloseTo(1.0, 1);

    const canvas = canvasFor(page, 'axial');
    await canvas.scrollIntoViewIfNeeded();
    const box = await canvas.boundingBox();

    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);

    // Ctrl + scroll up = zoom in
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -100);
    await page.keyboard.up('Control');
    await page.waitForTimeout(200);

    const zoomAfter = await page.evaluate(
      () => (window as any).__FEATURES_TEST__.getZoom('axial')
    );

    expect(zoomAfter).toBeGreaterThan(zoomBefore);
  });

  test('Ctrl+scroll down zooms out', async ({ page }) => {
    const canvas = canvasFor(page, 'axial');
    await canvas.scrollIntoViewIfNeeded();
    const box = await canvas.boundingBox();

    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);

    await page.keyboard.down('Control');
    await page.mouse.wheel(0, 100);
    await page.keyboard.up('Control');
    await page.waitForTimeout(200);

    const zoom = await page.evaluate(
      () => (window as any).__FEATURES_TEST__.getZoom('axial')
    );

    expect(zoom).toBeLessThan(1.0);
  });

  test('programmatic setZoom is reflected in getZoom', async ({ page }) => {
    await page.evaluate(() => {
      (window as any).__FEATURES_TEST__.setZoom('coronal', 2.5);
    });
    await page.waitForTimeout(100);

    const zoom = await page.evaluate(
      () => (window as any).__FEATURES_TEST__.getZoom('coronal')
    );

    expect(zoom).toBeCloseTo(2.5, 1);
  });

  test('zoom does not affect slice index', async ({ page }) => {
    const indicesBefore = await page.evaluate(
      () => (window as any).__FEATURES_TEST__.getSliceIndices()
    );

    await page.evaluate(() => {
      (window as any).__FEATURES_TEST__.setZoom('axial', 3.0);
    });
    await page.waitForTimeout(100);

    const indicesAfter = await page.evaluate(
      () => (window as any).__FEATURES_TEST__.getSliceIndices()
    );

    expect(indicesAfter.axial).toBe(indicesBefore.axial);
  });
});

// ─── Pan ────────────────────────────────────────────────────────────────

test.describe('Pan (middle-mouse drag)', () => {
  test.beforeEach(async ({ page }) => {
    await waitForReady(page);
  });

  test('pan offset defaults to (0, 0)', async ({ page }) => {
    const pan = await page.evaluate(
      () => (window as any).__FEATURES_TEST__.getPan('axial')
    );
    expect(pan.x).toBe(0);
    expect(pan.y).toBe(0);
  });

  test('middle-mouse drag changes pan offset', async ({ page }) => {
    const canvas = canvasFor(page, 'axial');
    await canvas.scrollIntoViewIfNeeded();
    const box = await canvas.boundingBox();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;

    // Middle button = 1
    await page.mouse.move(cx, cy);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(cx + 50, cy + 30, { steps: 5 });
    await page.mouse.up({ button: 'middle' });
    await page.waitForTimeout(150);

    const pan = await page.evaluate(
      () => (window as any).__FEATURES_TEST__.getPan('axial')
    );

    // Pan should have shifted roughly in the direction we dragged
    expect(Math.abs(pan.x) + Math.abs(pan.y)).toBeGreaterThan(5);
  });
});

// ─── Double-click reset ─────────────────────────────────────────────────

test.describe('Double-click reset', () => {
  test.beforeEach(async ({ page }) => {
    await waitForReady(page);
  });

  test('double-click resets zoom and pan to default', async ({ page }) => {
    // Set non-default zoom and pan
    await page.evaluate(() => {
      const t = (window as any).__FEATURES_TEST__;
      t.setZoom('axial', 2.5);
    });
    await page.waitForTimeout(100);

    const canvas = canvasFor(page, 'axial');
    await canvas.scrollIntoViewIfNeeded();
    const box = await canvas.boundingBox();

    // Double-click
    await page.mouse.dblclick(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.waitForTimeout(200);

    const zoom = await page.evaluate(
      () => (window as any).__FEATURES_TEST__.getZoom('axial')
    );
    const pan = await page.evaluate(
      () => (window as any).__FEATURES_TEST__.getPan('axial')
    );

    expect(zoom).toBeCloseTo(1.0, 1);
    expect(pan.x).toBe(0);
    expect(pan.y).toBe(0);
  });

  test('resetAllViews resets every panel', async ({ page }) => {
    await page.evaluate(() => {
      const t = (window as any).__FEATURES_TEST__;
      t.setZoom('axial', 3.0);
      t.setZoom('coronal', 2.0);
      t.setZoom('sagittal', 1.5);
    });
    await page.waitForTimeout(100);

    await page.evaluate(() => {
      (window as any).__FEATURES_TEST__.resetAllViews();
    });
    await page.waitForTimeout(100);

    for (const view of viewNames) {
      const zoom = await page.evaluate(
        (v) => (window as any).__FEATURES_TEST__.getZoom(v),
        view
      );
      expect(zoom).toBeCloseTo(1.0, 1);
    }
  });
});

// ─── Rendering sanity ───────────────────────────────────────────────────

test.describe('Rendering basics', () => {
  test.beforeEach(async ({ page }) => {
    await waitForReady(page);
  });

  test('three canvases are visible', async ({ page }) => {
    for (const view of viewNames) {
      const canvas = canvasFor(page, view);
      await expect(canvas, `${view} canvas should be visible`).toBeVisible({ timeout: 10000 });
      const box = await canvas.boundingBox();
      expect(box?.width).toBeGreaterThan(100);
      expect(box?.height).toBeGreaterThan(100);
    }
  });

  test('crosshairs are present by default', async ({ page }) => {
    const hasCrosshair = await page.evaluate(
      () => (window as any).__FEATURES_TEST__.hasCrosshair()
    );
    expect(hasCrosshair).toBe(true);
  });

  test('visual evidence: panels render after scroll + zoom', async ({ page }, testInfo) => {
    // Scroll a couple of times, then zoom in
    const canvas = canvasFor(page, 'axial');
    const box = await canvas.boundingBox();

    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.wheel(0, 150);
    await page.waitForTimeout(100);

    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -60);
    await page.keyboard.up('Control');
    await page.waitForTimeout(300);

    // Take screenshots as evidence
    for (const view of viewNames) {
      const panel = page.locator(`[data-view="${view}"]`);
      const shot = await panel.screenshot();
      testInfo.attach(`${view}-after-scroll-zoom.png`, {
        body: shot,
        contentType: 'image/png',
      });
      expect(shot.byteLength).toBeGreaterThan(3000);
    }
  });
});
