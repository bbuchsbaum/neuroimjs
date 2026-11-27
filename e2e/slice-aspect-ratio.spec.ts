import { expect, test } from '@playwright/test';

const reportedSpacing = [2.344, 2.344, 3.99] as const;
const views = [
  { name: 'axial', axes: 'AXIAL_LPI', spacing: reportedSpacing, aspect: 1, voxel: [11, 13, 16] },
  { name: 'coronal', axes: 'CORONAL_LIP', spacing: reportedSpacing, aspect: 3.99 / 2.344, voxel: [11, 16, 13] },
  { name: 'sagittal', axes: 'SAGITTAL_AIL', spacing: reportedSpacing, aspect: 3.99 / 2.344, voxel: [16, 20, 13] },
  { name: 'axial with wider voxels', axes: 'AXIAL_LPI', spacing: [3.99, 2.344, 2.344], aspect: 2.344 / 3.99, voxel: [11, 13, 16] },
] as const;

for (const { name, axes, spacing, aspect, voxel } of views) {
  test(`${name} fits physical voxel spacing and picks the displayed voxel`, async ({ page }) => {
    await page.route('**/slice-aspect-ratio-test.html', route => route.fulfill({
      contentType: 'text/html',
      body: '<!DOCTYPE html><div id="viewer" style="width: 360px; height: 260px"></div>',
    }));
    await page.goto('/slice-aspect-ratio-test.html');

    const viewer = await page.evaluateHandle(async ({ axes, spacing }) => {
      const browserEntry = '/src/browser.ts';
      const {
        AxisSet3D, ColorMapFactory, FloatNeuroVol, NeuroSpace, SingleSliceViewer, VolLayer, VolStack,
      }: typeof import('../src/browser') = await import(browserEntry);
      const space = new NeuroSpace([32, 32, 32], spacing, [0, 0, 0], AxisSet3D.AXIAL_LPI);
      const volume = new FloatNeuroVol(space, new Float32Array(space.size).fill(1));
      const colorMap = ColorMapFactory.createGrayscale({ range: [0, 1] });
      const stack = new VolStack(
        new VolLayer('underlay', volume, colorMap, [0, 1]),
        new VolLayer('overlay', volume, colorMap, [0, 1]),
      );
      return SingleSliceViewer.create(document.getElementById('viewer')!, stack, AxisSet3D[axes], {
        initialCoord: space.gridToCoord([16, 16, 16]),
        showCrosshair: true,
      });
    }, { axes, spacing });

    try {
      const bounds = await viewer.evaluate(viewer => {
        const [underlay, overlay] = viewer.getViewer().view.mainContainer.children[0].children;
        const base = underlay.getBounds();
        const top = overlay.getBounds();
        return {
          underlay: [base.x, base.y, base.width, base.height],
          overlay: [top.x, top.y, top.width, top.height],
        };
      });
      const [, , width, height] = bounds.underlay;
      expect(height / width).toBeCloseTo(aspect, 8);
      expect(Math.max(width / 360, height / 260)).toBeCloseTo(1, 8);
      expect(bounds.overlay).toEqual(bounds.underlay);

      const cropped = await viewer.evaluate(viewer => {
        const view = viewer.getViewer().view;
        view.setFitRegion({ x0: 4, y0: 4, x1: 28, y1: 28 });
        view.setZoom(1.1);
        view.setPan({ x: 6, y: -4 });
        const sprite = view.mainContainer.children[0].children[0].getBounds();
        const canvas = view.getCanvas().getBoundingClientRect();
        return { x: sprite.x + canvas.x, y: sprite.y + canvas.y, width: sprite.width, height: sprite.height };
      });
      expect(cropped.height / cropped.width).toBeCloseTo(aspect, 8);

      // Click the centre of texel (11, 13). The image's Y axis runs upwards.
      await page.mouse.click(cropped.x + cropped.width * 11.5 / 32, cropped.y + cropped.height * (32 - 13.5) / 32);
      await expect.poll(() => viewer.evaluate(viewer => {
        const space = viewer.getImageLayer().neuroSpace;
        return space.coordToGrid(viewer.getCurrentCoord()).map(Math.round);
      })).toEqual([...voxel]);
    } finally {
      await viewer.evaluate(viewer => viewer.dispose());
      await viewer.dispose();
    }
  });
}
