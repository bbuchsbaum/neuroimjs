/**
 * neuroimjs-vscode (VS Code custom editor webview) — imports
 * 'neuroimjs/browser'. See pages/vscode.ts for the mirrored call sequence;
 * the runner also type-checks that file against the tarball's declarations.
 */
import { expect, test } from '@playwright/test';
import { runContractPage } from './support';

const STEPS = [
  'registerPanel',
  'createBaseView',
  'createOrthogonalViews',
  'syncedCoordinate',
  'syncControl',
  'crosshairAndResize',
  'addOverlay',
  'dispose',
];

test('neuroimjs-vscode webview call surface works against neuroimjs/browser', async ({ page }) => {
  const report = await runContractPage(page, '/vscode.html', STEPS);
  expect(report.results.addOverlay).toMatchObject({ stackLength: 2 });
});

test('known gap: <layer-control-panel> lists overlays added to its volStack later', async ({ page }) => {
  // viewerApp.ts adds overlays with `layerPanel.volStack.addLayer(...)` after
  // assigning the stack. LayerControlPanel reads the layer ids only when
  // `volStack` is assigned (initializeFromVolStack) and does not observe the
  // stack, so the extension's overlays never appear in the panel's layer
  // selector. Expected to fail until the panel observes VolStack mutations;
  // Playwright reports it as unexpectedly passing once that is fixed, at which
  // point drop test.fail().
  test.fail(true, 'bd-01M41YY40G9ZGA6958PXB7NSVX: LayerControlPanel does not observe VolStack#addLayer');
  const report = await runContractPage(page, '/vscode.html', STEPS);
  expect(report.results.addOverlay).toMatchObject({ panelListsOverlay: true });
});
