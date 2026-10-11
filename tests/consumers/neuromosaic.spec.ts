/**
 * neuromosaic (R package, htmlwidgets volume viewer) — UMD global consumer.
 * See pages/neuromosaic.js for the mirrored call sequence and the list of
 * tolerated internals it relies on; pages/neuromosaic-options.ts is the
 * type-level half of the contract (checked by the runner with tsc).
 */
import { expect, test } from '@playwright/test';
import { runContractPage } from './support';

test('neuromosaic adapter call surface works against the packed UMD bundle', async ({ page }) => {
  const report = await runContractPage(page, '/neuromosaic.html', [
    'global',
    'decodeAsset',
    'assertSameVolumeGeometry',
    'volumeDataAccess',
    'presetRegistry',
    'customColorMap',
    'volLayers',
    'createViewer',
    'viewerDom',
    'stackedView',
    'cursor',
    'controlPanel',
    'updateLayerVolume',
    'setTheme',
    'exportPng',
    'dispose',
  ]);
  expect(report.results.decodeAsset).toEqual([16, 18, 15]);
  expect(report.results.cursor).toBeGreaterThan(3);
});
