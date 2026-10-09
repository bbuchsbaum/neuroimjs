import { test, expect, type Page } from '@playwright/test';

/**
 * Volume Set Space gate (synthetic data only). Roles of the synthetic subjects
 * (examples/volume-set/synthetic.ts): s01-s07 group A, s08-s12 group B, s13
 * outlier, s14 sign flip, s15 = 2*s01 + 0.5 (same pattern, different bytes),
 * s16 low coverage (excluded from the basis), s17 constant (excluded).
 */

interface Thumb {
  id: string;
  contrast: string;
  dest: { x: number; y: number; w: number; h: number };
  crop: { x: number; y: number; w: number; h: number };
}

interface Probe {
  runs: number;
  cached: number;
  pending: number;
  workers: number;
  layout: string;
  key: string | null;
  method: string | null;
  status: string | null;
  stress1: number | null;
  lod: string | null;
  coords: number[];
  ids: string[];
  placed: { id: string; x: number; y: number; group: string[] | null }[];
  notPlaced: string[];
  thumbs: Thumb[];
  enlarged: string | null;
  neighbors: string[];
}

const probe = (page: Page): Promise<Probe> =>
  page.evaluate(() => {
    const p = (window as unknown as { __vsSpace: Record<string, unknown> }).__vsSpace;
    const out: Record<string, unknown> = {};
    for (const k of ['runs', 'cached', 'pending', 'workers', 'layout', 'key', 'method', 'status', 'stress1', 'lod', 'coords', 'ids', 'placed', 'notPlaced', 'thumbs', 'enlarged', 'neighbors'])
      out[k] = p[k];
    return out as unknown as Probe;
  });

const url = (page: Page): URLSearchParams => new URL(page.url()).searchParams;

async function open(page: Page, query: string, space = true): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`/?${query}`);
  // Optional chaining throughout: a cold dev server may reload the page once while optimising dependencies.
  await page.waitForFunction(() => (window as unknown as { __vsReady?: boolean }).__vsReady === true, null, { timeout: 90_000 });
  if (space) await waitLayout(page);
  await settle(page);
  expect(errors).toEqual([]);
}

const waitLayout = (page: Page): Promise<unknown> =>
  page.waitForFunction(() => (window as unknown as { __vsSpace?: { layout: string; pending: number } }).__vsSpace?.layout === 'ready', null, { timeout: 90_000 });

const waitMode = (page: Page, mode: string): Promise<unknown> =>
  page.waitForFunction((m) => new URL(location.href).searchParams.get('mode') === m, mode, { timeout: 30_000 });

/** Wait for two animation frames (coalesced redraws flush on rAF). */
const settle = (page: Page): Promise<void> => page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));

/** Hash of the canvas pixels inside a CSS-pixel rect of the main set canvas. */
async function pixelHash(page: Page, r: Thumb['dest']): Promise<number> {
  return page.evaluate((r) => {
    const c = document.querySelector('canvas.montage') as HTMLCanvasElement;
    const dpr = c.width / c.clientWidth;
    const d = c.getContext('2d')!.getImageData(Math.round(r.x * dpr), Math.round(r.y * dpr), Math.max(1, Math.round(r.w * dpr)), Math.max(1, Math.round(r.h * dpr))).data;
    let h = 2166136261;
    for (let i = 0; i < d.length; i++) h = Math.imul(h ^ d[i], 16777619) >>> 0;
    return h;
  }, r);
}

async function setSlider(page: Page, value: number): Promise<void> {
  await page.evaluate((v) => {
    const el = document.querySelector('#slice') as HTMLInputElement;
    el.value = String(v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

const SPACE = 'mode=space&model=synth&contrast=cue&stat=t&orient=axial';

test.describe('Space (S4)', () => {
  test('places comparable maps, keeps every identity, and explains exclusions', async ({ page }, info) => {
    await open(page, SPACE);
    const p = await probe(page);
    expect(p.layout).toBe('ready');
    // This fixture's groups make the nonmetric fit collapse; the labelled metric fallback must be used.
    expect(p.method).toBe('metric-smacof');
    expect(p.status).toBe('degenerate-fallback');
    await expect(page.locator('#side')).toContainText('Metric MDS of 1 − r');
    expect(p.notPlaced.sort()).toEqual(['s16', 's17']);
    expect(p.placed.map((q) => q.id).sort()).toEqual(['s01', 's02', 's03', 's04', 's05', 's06', 's07', 's08', 's09', 's10', 's11', 's12', 's13', 's14', 's15']);
    // Same pattern (r = 1) shares one anchor but keeps both IDs.
    const s01 = p.placed.find((q) => q.id === 's01')!;
    expect(s01.group?.sort()).toEqual(['s01', 's15']);
    // Every member, placed or not, is reachable from the accessible list.
    const listed = await page.locator('.space-members button').allTextContents();
    expect(listed.sort()).toEqual(Array.from({ length: 17 }, (_, i) => `s${String(i + 1).padStart(2, '0')}`));
    await expect(page.locator('#side')).toContainText('s16: finite on');
    await expect(page.locator('#side')).toContainText('s17: constant map');
    // The layout is not collapsed: distinct non-identical patterns are visibly apart.
    const pts = p.placed.filter((q) => q.id !== 's15');
    let minGap = Infinity;
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) minGap = Math.min(minGap, Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y));
    expect(minGap).toBeGreaterThan(2);
    // The mean reference is drawn outside the layout and labelled.
    const thumbs = p.thumbs;
    const mean = thumbs.find((t) => t.id === 'mean')!;
    const plotLeft = Math.min(...p.placed.map((q) => q.x));
    expect(mean.dest.x + mean.dest.w).toBeLessThan(plotLeft);
    await info.attach('S4-space-overview', { body: await page.screenshot(), contentType: 'image/png' });
  });

  test('uses one uniform scale and keeps coordinates through display-only changes', async ({ page }) => {
    await open(page, SPACE);
    const p0 = await probe(page);
    const runs0 = p0.runs;
    // Uniform scale: screen distances are proportional to embedding distances on both axes.
    const ratio: number[] = [];
    for (let i = 1; i < p0.placed.length; i++) {
      const a = p0.placed[0];
      const b = p0.placed[i];
      const ia = p0.ids.indexOf(a.id);
      const ib = p0.ids.indexOf(b.id);
      const de = Math.hypot(p0.coords[2 * ia] - p0.coords[2 * ib], p0.coords[2 * ia + 1] - p0.coords[2 * ib + 1]);
      if (de > 1e-6) ratio.push(Math.hypot(a.x - b.x, a.y - b.y) / de);
    }
    for (const r of ratio) expect(r).toBeCloseTo(ratio[0], 6);
    // Scrub the shared slider end to end, then change threshold, range, smoothing, cluster filter, sort, orientation.
    const max = Number(await page.locator('#slice').getAttribute('max'));
    for (let v = 0; v <= max; v++) await setSlider(page, v);
    await settle(page);
    await page.fill('#thr', '3.1');
    await page.press('#thr', 'Enter');
    await page.locator('#thr').dispatchEvent('change');
    await page.selectOption('#minc', '10');
    await page.selectOption('#smooth', 'light');
    await page.waitForFunction(() => !/Smoothing/.test(document.querySelector('#status')?.textContent ?? ''), null, { timeout: 60_000 });
    await page.selectOption('#sort', 'id');
    await page.click('[data-orient="coronal"]');
    await settle(page);
    const p1 = await probe(page);
    expect(p1.runs).toBe(runs0);
    expect(p1.key).toBe(p0.key);
    expect(p1.coords).toEqual(p0.coords);
  });

  test('one slider moves every displayed map to the same plane', async ({ page }) => {
    await open(page, SPACE);
    const max = Number(await page.locator('#slice').getAttribute('max'));
    await setSlider(page, Math.round(max * 0.4));
    await settle(page);
    const before = await probe(page);
    const h0 = await Promise.all(before.thumbs.map((t) => pixelHash(page, t.dest)));
    await setSlider(page, Math.round(max * 0.6));
    await settle(page);
    const after = await probe(page);
    expect(after.thumbs.map((t) => t.id)).toEqual(before.thumbs.map((t) => t.id));
    const h1 = await Promise.all(after.thumbs.map((t) => pixelHash(page, t.dest)));
    // Every cell (members, not-placed members and the mean) shows a new plane.
    h1.forEach((h, i) => expect(h, before.thumbs[i].id).not.toBe(h0[i]));
    expect(url(page).get('slice')).toBe(String(Math.round(max * 0.6)));
    await expect(page.locator('#slice-label')).toContainText(`Axial ${Math.round(max * 0.6) + 1}/${max + 1}`);
    await expect(page.locator('#slice-label')).toContainText('z = ');
    // Keyboard stepping and the slider share one state.
    await page.locator('canvas.montage').focus();
    await page.keyboard.press('PageUp');
    await settle(page);
    expect(await page.locator('#slice').inputValue()).toBe(String(Math.round(max * 0.6) + 1));
    // Endpoint clamping.
    await setSlider(page, max + 50);
    await settle(page);
    expect(Number(url(page).get('slice'))).toBeLessThanOrEqual(max);
    expect((await probe(page)).runs).toBe(before.runs);
  });

  test('a click on a thumbnail pixel places the cursor through the cell transform, matching Montage', async ({ page }) => {
    // The focused map is drawn last, so its picture is never covered.
    await open(page, `${SPACE}&subject=s03`);
    const p = await probe(page);
    const t = p.thumbs.find((x) => x.id === 's03')!;
    // A point 30%/60% into the image.
    const px = t.dest.x + t.dest.w * 0.3;
    const py = t.dest.y + t.dest.h * 0.6;
    const box = (await page.locator('canvas.montage').boundingBox())!;
    await page.mouse.click(box.x + px, box.y + py);
    await settle(page);
    const col = Math.floor(t.crop.x + ((px - t.dest.x) / t.dest.w) * t.crop.w);
    const row = Math.floor(t.crop.y + ((py - t.dest.y) / t.dest.h) * t.crop.h);
    const slice = Number(url(page).get('slice'));
    const ny = 44;
    expect(url(page).get('subject')).toBe('s03');
    expect(url(page).get('cursor')).toBe(`${col},${ny - 1 - row},${slice}`);
    // The same relative point in the Montage cell of s03 gives the same voxel.
    const spaceCursor = url(page).get('cursor');
    await page.click('[data-mode="montage"]');
    await settle(page);
    const m = (await probe(page)).thumbs.find((x) => x.id === 's03')!;
    const mx = m.dest.x + ((col + 0.5 - m.crop.x) / m.crop.w) * m.dest.w;
    const my = m.dest.y + ((row + 0.5 - m.crop.y) / m.crop.h) * m.dest.h;
    await page.mouse.click(box.x + mx, box.y + my);
    await settle(page);
    expect(url(page).get('cursor')).toBe(spaceCursor);
  });

  test('hover enlarges after an intent delay and never refits; labels select without moving the cursor', async ({ page }) => {
    await open(page, `${SPACE}&subject=s09`);
    const p = await probe(page);
    const t = p.thumbs.find((x) => x.id === 's09')!;
    const box = (await page.locator('canvas.montage').boundingBox())!;
    await page.mouse.move(box.x + t.dest.x + t.dest.w / 2, box.y + t.dest.y + t.dest.h / 2);
    expect((await probe(page)).enlarged).toBeNull();
    await page.waitForTimeout(400);
    expect((await probe(page)).enlarged).toBe('s09');
    await page.mouse.move(box.x + 2, box.y + box.height - 2);
    await settle(page);
    expect((await probe(page)).enlarged).toBeNull();
    // Selecting from the accessible list changes focus, not the cursor.
    const cursor = url(page).get('cursor');
    await page.click('.space-members button:has-text("s12")');
    await settle(page);
    expect(url(page).get('subject')).toBe('s12');
    expect(url(page).get('cursor')).toBe(cursor);
    expect((await probe(page)).neighbors.length).toBeGreaterThanOrEqual(3);
    await expect(page.locator('#side')).toContainText('Neighbours');
    expect((await probe(page)).runs).toBe(p.runs);
  });

  test('keyboard reaches every placed and not-placed map; Enter opens Ortho and Escape returns with the viewport', async ({ page }) => {
    await open(page, `${SPACE}&subject=s01`);
    const canvasEl = page.locator('canvas.montage');
    // Zoom the layout so there is a viewport to restore.
    const box = (await canvasEl.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.4);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -300);
    await page.keyboard.up('Control');
    await settle(page);
    const sv = url(page).get('sv');
    expect(sv).not.toBeNull();
    await page.click('[data-mode="space"]'); // a no-op re-render must keep the viewport
    await settle(page);
    expect(url(page).get('sv')).toBe(sv);
    await canvasEl.focus();
    const seen = new Set<string>();
    for (const key of ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp']) {
      for (let i = 0; i < 20; i++) {
        await page.keyboard.press(key);
        await settle(page);
        seen.add(url(page).get('subject')!);
      }
    }
    expect(seen.size).toBeGreaterThanOrEqual(8);
    // Not-placed maps are reachable: ArrowDown from the bottom-most placed map enters the strip.
    await page.click('.space-members button:has-text("s16")');
    await settle(page);
    await canvasEl.focus();
    await page.keyboard.press('ArrowRight');
    await settle(page);
    expect(url(page).get('subject')).toBe('s17');
    // Enter opens Ortho for the focused map; Escape restores Space, viewport and focus.
    await page.keyboard.press('Enter');
    await waitMode(page, 'ortho');
    expect(url(page).get('back')).toBe('space');
    await expect(page.locator('.ortho-head .back')).toContainText('Space');
    // Move the cursor in Ortho with the go-to box: Space must come back on the new plane.
    await page.fill('#goto', '10, -20, 15');
    await page.press('#goto', 'Enter');
    await settle(page);
    const cursor = url(page).get('cursor')!;
    await page.keyboard.press('Escape');
    await waitMode(page, 'space');
    await waitLayout(page);
    await settle(page);
    expect(url(page).get('mode')).toBe('space');
    expect(url(page).get('sv')).toBe(sv);
    expect(url(page).get('subject')).toBe('s17');
    expect(url(page).get('cursor')).toBe(cursor);
    expect(url(page).get('slice')).toBe(cursor.split(',')[2]);
  });

  test('double-click opens Ortho and the restored URL returns to Space', async ({ page }) => {
    await open(page, `${SPACE}&subject=s05`);
    const p = await probe(page);
    // Labels are drawn above pictures and take precedence, so double-click s05's own (focused, always drawn) label.
    const t = p.thumbs.find((x) => x.id === 's05')!;
    const anchor = p.placed.find((q) => q.id === 's05')!;
    const box = (await page.locator('canvas.montage').boundingBox())!;
    await page.mouse.dblclick(box.x + anchor.x, box.y + t.dest.y + t.dest.h + 8);
    await waitMode(page, 'ortho');
    expect(url(page).get('subject')).toBe('s05');
    // Reload the Ortho URL: Back still goes to Space.
    await page.reload();
    await page.waitForSelector('.ortho-head');
    await expect(page.locator('.ortho-head .back')).toContainText('Space');
    await page.click('.ortho-head .back');
    await waitMode(page, 'space');
    await waitLayout(page);
    expect(url(page).get('mode')).toBe('space');
  });

  test('switching the source refits once, never installs a stale layout, and reuses the cache on return', async ({ page }) => {
    await open(page, SPACE);
    const k0 = (await probe(page)).key;
    const c0 = (await probe(page)).coords;
    const runs0 = (await probe(page)).runs;
    // Rapid A -> B -> C -> A: only the final layout may be on screen.
    await page.selectOption('#contrast', 'delayearly');
    await page.selectOption('#contrast', 'delaylate');
    await page.selectOption('#contrast', 'cue');
    await page.waitForFunction(() => (window as unknown as { __vsSpace: { layout: string; pending: number } }).__vsSpace.pending === 0, null, { timeout: 60_000 });
    await settle(page);
    const p = await probe(page);
    expect(p.key).toBe(k0);
    expect(p.coords).toEqual(c0);
    expect(p.layout).toBe('ready');
    expect(p.runs - runs0).toBeLessThanOrEqual(2);
    // A different statistic is a different basis: new key, fresh fit, viewport reset.
    await page.selectOption('#stat', 'beta');
    await page.waitForFunction((k) => {
      const s = (window as unknown as { __vsSpace: { layout: string; key: string } }).__vsSpace;
      return s.layout === 'ready' && s.key !== k;
    }, k0, { timeout: 60_000 });
    expect((await probe(page)).key).toContain('stat=beta');
    expect(url(page).get('sv')).toBeNull();
  });

  test('old and malformed URLs load with documented defaults', async ({ page }) => {
    await open(page, 'mode=bogus&model=synth&contrast=cue&sv=abc,1&layout=umap', false);
    expect(url(page).get('mode')).toBe('montage');
    expect(url(page).get('sv')).toBeNull();
    await open(page, `${SPACE}&sv=99,0,0&subject=nobody`);
    expect(url(page).get('sv')).toBeNull();
    expect((await probe(page)).layout).toBe('ready');
  });

  test('S1-S3 still render: Montage, Ortho and Facet', async ({ page }, info) => {
    await open(page, 'mode=montage&model=synth&contrast=cue&sort=similarity', false);
    expect((await probe(page)).thumbs.length).toBe(18);
    await info.attach('S1-montage', { body: await page.screenshot(), contentType: 'image/png' });
    await open(page, 'mode=facet&model=synth&contrast=cue&facets=cue,delayearly,delaylate', false);
    // Facet may wrap subjects into bands, repeating the mean column per band.
    expect((await probe(page)).thumbs.filter((t) => t.id !== 'mean').length).toBe(3 * 17);
    await info.attach('S3-facet', { body: await page.screenshot(), contentType: 'image/png' });
    await open(page, 'mode=ortho&model=synth&contrast=cue&subject=s04&sort=cursor', false);
    await page.waitForSelector('.ortho-head');
    await expect(page.locator('.ortho-head .subj')).toHaveText('sub-s04');
    await info.attach('S2-ortho', { body: await page.screenshot(), contentType: 'image/png' });
  });

  test('dense set (200 maps) switches to anchor marks and stays navigable', async ({ page }, info) => {
    await open(page, 'mode=space&model=synth200&contrast=cue');
    const p = await probe(page);
    expect(p.placed.length).toBe(200);
    expect(p.lod).toBe('marks');
    expect(await page.locator('.space-members button').count()).toBe(200);
    await page.locator('canvas.montage').focus();
    await page.keyboard.press('ArrowRight');
    await settle(page);
    expect(url(page).get('subject')).toMatch(/^n\d{3}$/);
    await info.attach('S4-space-dense', { body: await page.screenshot(), contentType: 'image/png' });
  });

  test('clicking an ID label or anchor dot selects without moving the cursor, even under the preview', async ({ page }) => {
    // Thumbnails: hover a label long enough for the enlarged preview to appear, then click it.
    await open(page, `${SPACE}&subject=s13`);
    const box = (await page.locator('canvas.montage').boundingBox())!;
    const cursor = url(page).get('cursor');
    const labels = await page.evaluate(() => {
      const g = (window as unknown as { __vsSpace: { placed: { id: string; x: number; y: number }[] } }).__vsSpace;
      return g.placed;
    });
    const target = labels.find((q) => q.id === 's14')!;
    const t = (await probe(page)).thumbs.find((x) => x.id === 's14')!;
    // The ID label sits just below the picture, centred on the anchor.
    const lx = target.x;
    const ly = t.dest.y + t.dest.h + 8;
    await page.mouse.move(box.x + lx, box.y + ly);
    await page.waitForTimeout(400);
    expect((await probe(page)).enlarged).toBe('s14');
    await page.mouse.click(box.x + lx, box.y + ly);
    await settle(page);
    expect(url(page).get('subject')).toBe('s14');
    expect(url(page).get('cursor')).toBe(cursor);
    // Marks (dense): a click on a dot selects only.
    await open(page, 'mode=space&model=synth200&contrast=cue');
    const c0 = url(page).get('cursor');
    const p = await probe(page);
    // A dot that no other anchor's dot or label (drawn to the right of its dot) covers.
    const covered = (d: { x: number; y: number }, q: { x: number; y: number }): boolean =>
      Math.hypot(q.x - d.x, q.y - d.y) < 16 || (d.x >= q.x && d.x <= q.x + 60 && Math.abs(d.y - q.y) < 10);
    const dot = p.placed.find((d) => p.placed.every((q) => q === d || !covered(d, q)))!;
    expect(dot).toBeDefined();
    await page.mouse.move(box.x + dot.x, box.y + dot.y);
    await page.waitForTimeout(400);
    await page.mouse.click(box.x + dot.x, box.y + dot.y);
    await settle(page);
    expect(url(page).get('subject')).toBe(dot.id);
    expect(url(page).get('cursor')).toBe(c0);
  });

  test('reduced motion: keyboard focus enlarges immediately', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page, `${SPACE}&subject=s02`);
    await page.locator('canvas.montage').focus();
    await page.keyboard.press('ArrowRight');
    await settle(page);
    const p = await probe(page);
    expect(p.enlarged).toBe(url(page).get('subject'));
  });

  test('narrow window: every map stays reachable and thumbnails keep their aspect', async ({ page }, info) => {
    await page.setViewportSize({ width: 900, height: 700 });
    await open(page, SPACE);
    const p = await probe(page);
    expect(p.placed.length + p.notPlaced.length).toBe(17);
    expect(await page.locator('.space-members button').count()).toBe(17);
    for (const t of p.thumbs) expect(t.dest.w / t.dest.h).toBeCloseTo(t.crop.w / t.crop.h, 1);
    // Every placed anchor lies inside the canvas.
    const box = (await page.locator('canvas.montage').boundingBox())!;
    for (const q of p.placed) {
      expect(q.x).toBeGreaterThanOrEqual(0);
      expect(q.x).toBeLessThanOrEqual(box.width);
      expect(q.y).toBeGreaterThanOrEqual(0);
      expect(q.y).toBeLessThanOrEqual(box.height);
    }
    // Touch-sized targets in the member list.
    const h = await page.locator('.space-members button').first().evaluate((el) => el.getBoundingClientRect().height);
    expect(h).toBeGreaterThanOrEqual(24);
    await info.attach('S4-space-narrow', { body: await page.screenshot(), contentType: 'image/png' });
  });

  test('with "value at cursor" order, scrubbing keeps the matrix in display order', async ({ page }) => {
    await open(page, `${SPACE}&sort=cursor`);
    const max = Number(await page.locator('#slice').getAttribute('max'));
    await setSlider(page, Math.round(max * 0.3));
    await settle(page);
    await settle(page);
    const orders = (): Promise<[string[], string[]]> =>
      page.evaluate(() => {
        const w = window as unknown as { __vsMatrixOrder: string[]; __vsRailOrder: string[] };
        return [w.__vsMatrixOrder, w.__vsRailOrder];
      });
    const [m0, r0] = await orders();
    expect(m0).toEqual(r0);
    // Scrub to a plane where the order is different, then compare again.
    let changed = false;
    for (const f of [0.5, 0.7, 0.2]) {
      await setSlider(page, Math.round(max * f));
      await settle(page);
      await settle(page);
      const [m1, r1] = await orders();
      expect(m1).toEqual(r1);
      if (r1.join() !== r0.join()) changed = true;
    }
    expect(changed).toBe(true);
    expect((await probe(page)).runs).toBe(1);
  });
});
