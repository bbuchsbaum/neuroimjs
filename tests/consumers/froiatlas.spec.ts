/**
 * FROIAtlas (React/Vite app) — imports 'neuroimjs', aliased to the ES browser
 * bundle. See pages/froiatlas.ts for the mirrored call sequence.
 */
import { expect, test } from '@playwright/test';
import { runContractPage } from './support';

test('FROIAtlas SliceViewer call surface works against the packed ES bundle', async ({ page }) => {
  const report = await runContractPage(page, '/froiatlas.html', [
    'loadModule',
    'initViewer',
    'goToPeak',
    'crosshairToggle',
    'addOverlay',
    'updateLayerVolume',
    'removeLayer',
    'dispose',
  ]);
  expect(String(report.results.updateLayerVolume)).toMatch(/hot/i);
});
