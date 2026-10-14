import { expect, test } from '@playwright/test';

test('Space embeds supplied maps twice with isolated state, events and intact caller buffers', async ({ page }, info) => {
  const errors: string[] = [];
  const unwantedRequests: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname.includes('/vs/') || url.hostname.includes('google')) unwantedRequests.push(request.url());
  });
  await page.goto('/space.html');
  await page.waitForFunction(() => !!window.spaceContract);
  const initial = await page.evaluate(async () => {
    const api = window.spaceContract;
    const input = api.dataset('first');
    const before = input.members[0].t![1600];
    const first = api.mount('first', input);
    const second = api.mount('second', api.dataset('second', 'beta'), { statistic: 'beta' });
    await Promise.all([first.ready, second.ready]);
    return { first: await first.getState(), second: await second.getState(), before, after: input.members[0].t![1600], bytes: input.members[0].t!.byteLength };
  });
  expect(initial.first.statistic).toBe('t');
  expect(initial.first.mode).toBe('space');
  expect(initial.second.statistic).toBe('beta');
  expect(initial.after).toBe(initial.before);
  expect(initial.bytes).toBe(16 * 18 * 14 * 4);
  const states = await page.evaluate(async () => {
    const first = window.spaceContract.handles.get('first')!;
    const second = window.spaceContract.handles.get('second')!;
    const ortho = await first.setState({ mode: 'ortho', selectedMemberId: 'first-s02', worldCoord: [0, 0, 0] });
    await first.setState({ worldCoord: [2, 4, 6] });
    const back = await first.setState({ mode: 'space' });
    return { ortho, back, second: await second.getState() };
  });
  expect(states.ortho).toMatchObject({ mode: 'ortho', selectedMemberId: 'first-s02', worldCoord: [0, 0, 0] });
  expect(states.back).toMatchObject({ mode: 'space', selectedMemberId: 'first-s02', worldCoord: [2, 4, 6] });
  expect(states.second).toEqual(initial.second);
  const frame = page.frameLocator('#first iframe');
  await page.evaluate(() => window.spaceContract.handles.get('first')!.setState({ mode: 'ortho' }));
  await frame.locator('.ortho-head .back').click();
  await expect.poll(() => page.evaluate(async () => (await window.spaceContract.handles.get('first')!.getState()).mode)).toBe('space');
  await frame.locator('.space-members button').filter({ hasText: 's03' }).first().click();
  await expect.poll(() => page.evaluate(async () => (await window.spaceContract.handles.get('first')!.getState()).selectedMemberId)).toBe('first-s03');
  expect(await page.evaluate(() => window.spaceContract.events.some(e => e.host === 'first' && e.type === 'statechange' && e.source === 'user'))).toBe(true);
  expect(new URL(page.url()).search).toBe('');
  expect(unwantedRequests).toEqual([]);
  expect(errors).toEqual([]);
  await page.locator('#first').screenshot({ path: info.outputPath('space-embedded.png') });
  await page.evaluate(() => { for (const handle of window.spaceContract.handles.values()) handle.dispose(); });
  await expect(page.locator('iframe')).toHaveCount(0);
});

test('Space handles mixed-statistic facets and rejects empty analyses without losing the current view', async ({ page }) => {
  await page.goto('/space.html');
  await page.waitForFunction(() => !!window.spaceContract);
  const result = await page.evaluate(async () => {
    const api = window.spaceContract;
    const t = api.dataset('mixed-t', 't');
    const beta = api.dataset('mixed-beta', 'beta');
    const empty = api.dataset('empty', 't');
    for (const member of empty.members) member.t!.fill(NaN);
    const handle = api.mount('first', { ...t, members: [...t.members,
      ...beta.members.map(member => ({ ...member, contrast: 'beta-cue' })),
      ...empty.members.map(member => ({ ...member, model: 'empty' }))] });
    await handle.ready;
    const facet = await handle.setState({ mode: 'facet' });
    const rejectSwitch = await handle.setState({ model: 'empty', contrast: 'cue' }).then(() => false, () => true);
    const afterSwitch = await handle.getState();
    const rejectReplace = await handle.setData(empty).then(() => false, () => true);
    const afterReplace = await handle.getState();
    const failedMount = api.mount('second', empty);
    const rejectMount = await failedMount.ready.then(() => false, () => true);
    failedMount.dispose();
    const explicit = api.mount('second', { ...empty, members: [
      ...empty.members.map(member => ({ ...member, model: 'empty' })), ...t.members,
    ] }, { model: 'model', contrast: 'cue', statistic: 't' });
    await explicit.ready;
    await explicit.setData({ ...empty, members: [
      ...empty.members.map(member => ({ ...member, model: 'empty' })), ...t.members,
    ] }, { model: 'model', contrast: 'cue', statistic: 't' });
    explicit.dispose();
    return { facet, rejectSwitch, afterSwitch, rejectReplace, afterReplace, rejectMount };
  });
  expect(result.facet.mode).toBe('facet');
  expect(result.rejectSwitch).toBe(true);
  expect(result.afterSwitch).toEqual(result.facet);
  expect(result.rejectReplace).toBe(true);
  expect(result.afterReplace).toEqual(result.facet);
  expect(result.rejectMount).toBe(true);
  await expect(page.locator('iframe')).toHaveCount(1);
  await page.evaluate(() => window.spaceContract.handles.get('first')!.setState({ mode: 'space' }));
  const frame = page.frameLocator('#first iframe');
  await frame.locator('#sx-traj').click();
  await expect(frame.locator('#status')).not.toContainText('Error:');
  await page.evaluate(() => window.spaceContract.handles.get('first')!.dispose());
});

test('Space can inspect a single map even when an embedding is unavailable', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/space.html');
  await page.waitForFunction(() => !!window.spaceContract);
  const result = await page.evaluate(async () => {
    const api = window.spaceContract;
    const data = api.dataset('single', 't');
    const handle = api.mount('first', { ...data, members: data.members.slice(0, 1) });
    await handle.ready;
    return handle.setState({ mode: 'ortho', selectedMemberId: 'single-s01', worldCoord: [0, 0, 0] });
  });
  expect(result).toMatchObject({ mode: 'ortho', selectedMemberId: 'single-s01' });
  await expect(page.frameLocator('#first iframe').locator('.ortho-host canvas').first()).toBeVisible();
  expect(errors).toEqual([]);
  await page.evaluate(() => window.spaceContract.handles.get('first')!.dispose());
});

test('Space rejects invalid state atomically and serializes transitions across disjoint sources', async ({ page }) => {
  await page.goto('/space.html');
  await page.waitForFunction(() => !!window.spaceContract);
  const result = await page.evaluate(async () => {
    const api = window.spaceContract;
    const t = api.dataset('t-only', 't');
    const beta = api.dataset('beta-only', 'beta');
    const data = { ...t, members: [...t.members, ...beta.members.map(({ se: _se, ...member }) => ({ ...member, model: 'other', contrast: 'disjoint' }))] };
    const handle = api.mount('first', data);
    await handle.ready;
    const before = await handle.setState({ worldCoord: [2, 4, 6] });
    const invalid = [{ model: 'missing' }, { mode: 'bogus' }, { worldCoord: [999, 0, 0] }, { range: 0 }];
    const failures = [];
    for (const patch of invalid) {
      failures.push(await handle.setState(patch as never).then(() => false, () => true));
      failures.push(JSON.stringify(await handle.getState()) === JSON.stringify(before));
    }
    const sagittal = await handle.setState({ orientation: 'sagittal' });
    const ordered = await Promise.all([handle.setState({ threshold: 0.1 }), handle.setState({ threshold: 0.2 })]);
    return { failures, sagittal, ordered };
  });
  expect(result.failures).toEqual(Array(8).fill(true));
  expect(result.ordered.map(state => state.threshold)).toEqual([0.1, 0.2]);
  const frame = page.frameLocator('#first iframe');
  await expect(frame.locator('#slice')).toHaveValue('9');
  const switched = await page.evaluate(() => window.spaceContract.handles.get('first')!.setState({ model: 'other' }));
  expect(switched).toMatchObject({ model: 'other', contrast: 'disjoint', statistic: 'beta' });
  await expect(frame.locator('#contrast')).toHaveValue('disjoint');
  await expect(frame.locator('#stat option')).toHaveText(['β']);
  await expect(frame.locator('#sx-colour option[value="rel"]')).toHaveCount(0);
  await expect(frame.locator('#sx-noise')).toHaveCount(0);
  await expect(frame.locator('#sx-explain')).toHaveCount(0);
  await page.evaluate(() => window.spaceContract.handles.get('first')!.dispose());
});

test('Space treats supplied atlas and covariate labels as text, with exact subject identities', async ({ page }, info) => {
  const errors: string[] = [];
  const unexpected: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.hostname !== '127.0.0.1' || url.pathname.includes('/vs/')) unexpected.push(request.url());
  });
  await page.goto('/space.html');
  await page.waitForFunction(() => !!window.spaceContract);
  const hostile = '<img src="https://invalid.example/space-probe" onerror="window.__injected=1">';
  await page.evaluate(async (label) => {
    const api = window.spaceContract;
    const base = api.dataset('metadata');
    const members = base.members.map(member => ({ ...member, subject: `sub-${member.subject}` }));
    const data = { ...base, members, atlas: { name: label, labels: new Int32Array(base.template.length).fill(1), regions: [{ id: 1, label }] },
      covariates: members.map(member => ({ subject: member.subject, values: { [label]: label } })) };
    await api.mount('first', data, { worldCoord: [0, 0, 0] }).ready;
  }, hostile);
  const frame = page.frameLocator('#first iframe');
  await expect(frame.locator('#sx-colour option')).toContainText([`Mark: ${hostile}`]);
  await frame.locator('#sx-colour').selectOption(`cov:${hostile}`);
  await expect(frame.locator('#side-body')).toContainText(hostile);
  await frame.locator('#sx-explain').click();
  await expect(frame.locator('#side-body')).toContainText('Explain');
  await expect(frame.locator('button[data-parcel="1"]').first()).toHaveText(hostile);
  expect(await frame.locator('button[data-parcel="1"]').first().getAttribute('title')).toContain(hostile);
  // The atlas readout follows the pointer. Exercise its HTML sink on a real
  // picture, rather than expecting a coordinate readout before hovering.
  await page.evaluate(() => window.spaceContract.handles.get('first')!.setState({ mode: 'montage' }));
  const picture = await frame.locator('body').evaluate(() => {
    const probe = (window as unknown as { __vsSpace: { thumbs: { dest: { x: number; y: number; w: number; h: number } }[] } }).__vsSpace;
    return probe.thumbs[0].dest;
  });
  await frame.locator('canvas.montage').hover({ position: { x: picture.x + picture.w / 2, y: picture.y + picture.h / 2 } });
  await expect(frame.locator('#readout-text')).toContainText(hostile);
  await expect(frame.locator('img[src*="space-probe"]')).toHaveCount(0);
  expect(await frame.locator('body').evaluate(() => (window as unknown as { __injected?: number }).__injected)).toBeUndefined();
  expect(unexpected).toEqual([]);
  expect(errors).toEqual([]);
  await page.evaluate(() => window.spaceContract.handles.get('first')!.setState({ mode: 'space' }));
  await page.screenshot({ path: info.outputPath('space-report.png'), fullPage: true });
  await page.evaluate(() => window.spaceContract.handles.get('first')!.dispose());
  await expect.poll(() => page.workers().length).toBe(0);
});

test('Space replacement commits the latest dataset and preserves the active view after invalid replacement', async ({ page }) => {
  await page.goto('/space.html');
  await page.waitForFunction(() => !!window.spaceContract);
  const result = await page.evaluate(async () => {
    const api = window.spaceContract;
    const handle = api.mount('first', api.dataset('original'));
    await handle.ready;
    const superseded = handle.setData(api.dataset('superseded')).then(() => 'resolved', (error: Error) => error.name);
    await handle.setData(api.dataset('replacement'), { selectedMemberId: 'replacement-s03' });
    const installed = await handle.getState();
    const bad = api.dataset('bad');
    const invalid = { ...bad, grid: { ...bad.grid, affine: [[-2, 0, 0, 0], [0, 2, 0, 0], [0, 0, 2, 0], [0, 0, 0, 1]] } };
    const rejected = await handle.setData(invalid).then(() => false, () => true);
    return { superseded: await superseded, installed, rejected, after: await handle.getState() };
  });
  expect(result.superseded).toBe('AbortError');
  expect(result.installed.selectedMemberId).toBe('replacement-s03');
  expect(result.rejected).toBe(true);
  expect(result.after).toEqual(result.installed);
  await expect(page.locator('iframe')).toHaveCount(1);
  await page.evaluate(() => window.spaceContract.handles.get('first')!.dispose());
});

test('Space disposal during startup rejects readiness and leaves no frame or workers', async ({ page }) => {
  await page.goto('/space.html');
  await page.waitForFunction(() => !!window.spaceContract);
  const result = await page.evaluate(async () => {
    const api = window.spaceContract;
    const handle = api.mount('first', api.dataset('disposed'));
    const ready = handle.ready.then(() => 'resolved', (error: Error) => error.name);
    handle.dispose();
    handle.dispose();
    return { ready: await ready, state: await handle.getState().then(() => 'resolved', (error: Error) => error.name) };
  });
  expect(result).toEqual({ ready: 'AbortError', state: 'AbortError' });
  await expect(page.locator('iframe')).toHaveCount(0);
  expect(page.workers()).toHaveLength(0);
});
