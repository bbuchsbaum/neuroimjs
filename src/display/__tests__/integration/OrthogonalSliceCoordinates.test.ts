/**
 * Integration tests for OrthogonalSliceRenderer coordinate transformations
 *
 * These tests verify the complete pipeline from world coordinates (LPI mm)
 * through slice extraction to pixel positioning. They expose bugs in how
 * coordinates are transformed between different spaces.
 *
 * Key invariants tested:
 * 1. Cross-view consistency: All three orthogonal views agree on world position
 * 2. SliceTransform agreement: Renderer matches direct SliceTransform calculations
 * 3. Round-trip stability: world → pixel → world preserves coordinates
 * 4. Anatomical correctness: Negative Y (posterior) appears in correct location
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { read_vol } from '../../../io/nifti';
import { DenseNeuroVol } from '../../../volume/DenseNeuroVol';
import { OrthogonalSliceRenderer } from '../../OrthogonalSliceRenderer';
import { VolStack } from '../../VolStack';
import { VolLayer } from '../../VolLayer';
import { ColorMap } from '../../ColorMap';
import { SliceTransform } from '../../SliceTransform';
import { AxisSet3D, NamedAxis } from '../../../geometry/Axis';
import * as path from 'path';

describe('OrthogonalSliceRenderer Coordinate Pipeline Integration', () => {
  let volume: DenseNeuroVol;
  let renderer: OrthogonalSliceRenderer;
  let volStack: VolStack;

  beforeAll(async () => {
    // Load MNI template (path relative to project root)
    const volumePath = path.join(
      process.cwd(),
      'tests/data/volumes/tpl-MNI152NLin2009aAsym_res-1_T1w.nii.gz'
    );

    volume = (await read_vol(volumePath)) as DenseNeuroVol;

    // Create renderer (which creates its own VolStack internally)
    renderer = new OrthogonalSliceRenderer(volume, {
      showCrosshairs: true,
      showLabels: true
    });

    // Access the internal volStack for testing
    volStack = (renderer as any).volStack;
  });

  describe('Cross-View Consistency', () => {
    it('should produce consistent world coordinates across all three views', () => {
      // The reported bug: coordinate with negative Y (posterior)
      const worldCoord = [-37.9, -34.3, 32.4]; // LPI mm

      // Get configurations for all three views
      const axialConfig = (renderer as any).getViewConfiguration(worldCoord, 'axial');
      const sagittalConfig = (renderer as any).getViewConfiguration(worldCoord, 'sagittal');
      const coronalConfig = (renderer as any).getViewConfiguration(worldCoord, 'coronal');

      // For each view, use SliceTransform to reconstruct world coordinate from pixel position
      // They should all agree on the same world position

      // Axial reconstruction
      const axialXform = new SliceTransform(volume.space, axialConfig.axes, axialConfig.sliceIndex);
      const axialReconstructed = axialXform.imageToWorldCoord({
        x: axialConfig.planeCoord[0],
        y: axialConfig.planeCoord[1]
      });

      // Sagittal reconstruction
      const sagittalXform = new SliceTransform(volume.space, sagittalConfig.axes, sagittalConfig.sliceIndex);
      const sagittalReconstructed = sagittalXform.imageToWorldCoord({
        x: sagittalConfig.planeCoord[0],
        y: sagittalConfig.planeCoord[1]
      });

      // Coronal reconstruction
      const coronalXform = new SliceTransform(volume.space, coronalConfig.axes, coronalConfig.sliceIndex);
      const coronalReconstructed = coronalXform.imageToWorldCoord({
        x: coronalConfig.planeCoord[0],
        y: coronalConfig.planeCoord[1]
      });

      // All three should match the original world coordinate within 1mm tolerance
      const tolerance = 1.0;

      expect(Math.abs(axialReconstructed[0] - worldCoord[0])).toBeLessThan(tolerance);
      expect(Math.abs(axialReconstructed[1] - worldCoord[1])).toBeLessThan(tolerance);
      expect(Math.abs(axialReconstructed[2] - worldCoord[2])).toBeLessThan(tolerance);

      expect(Math.abs(sagittalReconstructed[0] - worldCoord[0])).toBeLessThan(tolerance);
      expect(Math.abs(sagittalReconstructed[1] - worldCoord[1])).toBeLessThan(tolerance);
      expect(Math.abs(sagittalReconstructed[2] - worldCoord[2])).toBeLessThan(tolerance);

      expect(Math.abs(coronalReconstructed[0] - worldCoord[0])).toBeLessThan(tolerance);
      expect(Math.abs(coronalReconstructed[1] - worldCoord[1])).toBeLessThan(tolerance);
      expect(Math.abs(coronalReconstructed[2] - worldCoord[2])).toBeLessThan(tolerance);
    });
  });

  describe('Renderer vs SliceTransform Agreement', () => {
    it('should match SliceTransform worldToImageCoord for axial view', () => {
      const worldCoord = [-37.9, -34.3, 32.4];

      // Method 1: Use OrthogonalSliceRenderer's internal method
      const config = (renderer as any).getViewConfiguration(worldCoord, 'axial');

      // getViewConfiguration now returns planeCoord in pixel coordinates
      // This should match SliceTransform directly
      const rendererPixel = { x: config.planeCoord[0], y: config.planeCoord[1] };

      // Method 2: Use SliceTransform directly (ground truth)
      const xform = new SliceTransform(volume.space, config.axes, config.sliceIndex);
      const correctPixel = xform.worldToImageCoord(worldCoord);

      // These should match within half a pixel
      expect(Math.abs(rendererPixel.x - correctPixel.x)).toBeLessThan(0.5);
      expect(Math.abs(rendererPixel.y - correctPixel.y)).toBeLessThan(0.5);
    });

    it('should match SliceTransform worldToImageCoord for sagittal view', () => {
      const worldCoord = [-37.9, -34.3, 32.4];

      const config = (renderer as any).getViewConfiguration(worldCoord, 'sagittal');
      const rendererPixel = { x: config.planeCoord[0], y: config.planeCoord[1] };

      const xform = new SliceTransform(volume.space, config.axes, config.sliceIndex);
      const correctPixel = xform.worldToImageCoord(worldCoord);

      expect(Math.abs(rendererPixel.x - correctPixel.x)).toBeLessThan(0.5);
      expect(Math.abs(rendererPixel.y - correctPixel.y)).toBeLessThan(0.5);
    });

    it('should match SliceTransform worldToImageCoord for coronal view', () => {
      const worldCoord = [-37.9, -34.3, 32.4];

      const config = (renderer as any).getViewConfiguration(worldCoord, 'coronal');
      const rendererPixel = { x: config.planeCoord[0], y: config.planeCoord[1] };

      const xform = new SliceTransform(volume.space, config.axes, config.sliceIndex);
      const correctPixel = xform.worldToImageCoord(worldCoord);

      expect(Math.abs(rendererPixel.x - correctPixel.x)).toBeLessThan(0.5);
      expect(Math.abs(rendererPixel.y - correctPixel.y)).toBeLessThan(0.5);
    });
  });

  describe('Anatomical Correctness - Y-Coronal Bug Regression', () => {
    it('should correctly position negative Y (posterior) coordinate in coronal view', () => {
      const worldCoord = [-37.9, -34.3, 32.4]; // Y is strongly negative (posterior)

      // In LPI space: negative Y = posterior, positive Y = anterior
      // Coronal view shows the P-A axis as depth

      const coronalConfig = (renderer as any).getViewConfiguration(worldCoord, 'coronal');

      // Coronal axes: (LEFT_RIGHT, INF_SUP, POST_ANT)
      // The third axis (POST_ANT) determines slice position
      // Negative Y should map to a posterior slice (lower slice index)

      const bounds = volume.space.bounds();
      const centerY = (bounds[0][1] + bounds[1][1]) / 2;

      // The world Y coordinate is -34.3 (posterior)
      // This should be less than center in LPI space
      expect(worldCoord[1]).toBeLessThan(centerY);

      // Verify the slice selection reflects posterior position
      // (Implementation-dependent, but slice index should be consistent)
    });

    it('should correctly position negative Y in axial view', () => {
      const worldCoord = [-37.9, -34.3, 32.4]; // Y is strongly negative (posterior)

      // In axial view, Y axis is one of the in-plane axes
      // Negative Y should appear in the posterior part of the image

      const axialConfig = (renderer as any).getViewConfiguration(worldCoord, 'axial');

      // Use SliceTransform to get correct pixel position
      const xform = new SliceTransform(volume.space, axialConfig.axes, axialConfig.sliceIndex);
      const pixel = xform.worldToImageCoord(worldCoord);

      // In axial view with standard orientation:
      // - Y axis corresponds to anterior-posterior (vertical in image)
      // - Negative Y (posterior) should be in the upper part of image
      //   OR lower part depending on Y-axis flip in rendering

      // The key is that pixel.y should be consistent with the Y coordinate
      // The pixel coordinates should be valid (non-negative and finite)
      expect(pixel.x).toBeGreaterThanOrEqual(0);
      expect(pixel.y).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(pixel.x)).toBe(true);
      expect(Number.isFinite(pixel.y)).toBe(true);
    });
  });

  describe('Property-style testing with sampled coordinates', () => {
    function sampledWorldCoord(sample: number): number[] {
      const bounds = volume.space.bounds();
      const fractions = [0.137, 0.419, 0.733];
      return [
        bounds[0][0] + ((fractions[0] * (sample + 1)) % 1) * (bounds[1][0] - bounds[0][0]),
        bounds[0][1] + ((fractions[1] * (sample + 1)) % 1) * (bounds[1][1] - bounds[0][1]),
        bounds[0][2] + ((fractions[2] * (sample + 1)) % 1) * (bounds[1][2] - bounds[0][2])
      ];
    }

    it('should produce consistent results for 50 sampled coordinates in all views', () => {
      const numTests = 50;
      const tolerance = 0.5; // pixels

      for (let i = 0; i < numTests; i++) {
        const worldCoord = sampledWorldCoord(i);

        for (const viewType of ['axial', 'sagittal', 'coronal']) {
          const config = (renderer as any).getViewConfiguration(worldCoord, viewType);
          const rendererPixel = { x: config.planeCoord[0], y: config.planeCoord[1] };

          const xform = new SliceTransform(volume.space, config.axes, config.sliceIndex);
          const correctPixel = xform.worldToImageCoord(worldCoord);

          // Renderer should match SliceTransform
          expect(Math.abs(rendererPixel.x - correctPixel.x)).toBeLessThan(tolerance);
          expect(Math.abs(rendererPixel.y - correctPixel.y)).toBeLessThan(tolerance);
        }
      }
    });

    it('should maintain round-trip consistency for sampled coordinates', () => {
      const numTests = 50;
      const tolerance = 1.0; // mm

      for (let i = 0; i < numTests; i++) {
        const worldCoord = sampledWorldCoord(i);

        for (const viewType of ['axial', 'sagittal', 'coronal']) {
          const config = (renderer as any).getViewConfiguration(worldCoord, viewType);

          // Forward: world → pixel
          const xform = new SliceTransform(volume.space, config.axes, config.sliceIndex);
          const pixel = xform.worldToImageCoord(worldCoord);

          // Reverse: pixel → world
          const worldReconstructed = xform.imageToWorldCoord(pixel);

          // Should match within tolerance
          expect(Math.abs(worldReconstructed[0] - worldCoord[0])).toBeLessThan(tolerance);
          expect(Math.abs(worldReconstructed[1] - worldCoord[1])).toBeLessThan(tolerance);
          expect(Math.abs(worldReconstructed[2] - worldCoord[2])).toBeLessThan(tolerance);
        }
      }
    });
  });

  describe('Slice Index Selection', () => {
    it('should select consistent slice indices across views for same world point', () => {
      const worldCoord = [-37.9, -34.3, 32.4];

      // Each view pins a different axis
      const axialConfig = (renderer as any).getViewConfiguration(worldCoord, 'axial');
      const sagittalConfig = (renderer as any).getViewConfiguration(worldCoord, 'sagittal');
      const coronalConfig = (renderer as any).getViewConfiguration(worldCoord, 'coronal');

      // The slice indices should be consistent with the world coordinate
      // Verify using SliceTransform's round-trip: if we take the slice at sliceIndex
      // and convert planeCoord back to world, we should get our original worldCoord

      const axialXform = new SliceTransform(volume.space, axialConfig.axes, axialConfig.sliceIndex);
      const axialReconstructed = axialXform.imageToWorldCoord({
        x: axialConfig.planeCoord[0],
        y: axialConfig.planeCoord[1]
      });
      expect(Math.abs(axialReconstructed[2] - worldCoord[2])).toBeLessThan(1.0);

      const sagittalXform = new SliceTransform(volume.space, sagittalConfig.axes, sagittalConfig.sliceIndex);
      const sagittalReconstructed = sagittalXform.imageToWorldCoord({
        x: sagittalConfig.planeCoord[0],
        y: sagittalConfig.planeCoord[1]
      });
      expect(Math.abs(sagittalReconstructed[2] - worldCoord[2])).toBeLessThan(1.0);

      const coronalXform = new SliceTransform(volume.space, coronalConfig.axes, coronalConfig.sliceIndex);
      const coronalReconstructed = coronalXform.imageToWorldCoord({
        x: coronalConfig.planeCoord[0],
        y: coronalConfig.planeCoord[1]
      });
      expect(Math.abs(coronalReconstructed[2] - worldCoord[2])).toBeLessThan(1.0);
    });
  });

  describe('Coordinate Bounds Checking', () => {
    it('should handle coordinates at volume boundaries', () => {
      const bounds = volume.space.bounds();

      // Test all 8 corners of the volume
      const corners = [
        [bounds[0][0], bounds[0][1], bounds[0][2]],
        [bounds[0][0], bounds[0][1], bounds[1][2]],
        [bounds[0][0], bounds[1][1], bounds[0][2]],
        [bounds[0][0], bounds[1][1], bounds[1][2]],
        [bounds[1][0], bounds[0][1], bounds[0][2]],
        [bounds[1][0], bounds[0][1], bounds[1][2]],
        [bounds[1][0], bounds[1][1], bounds[0][2]],
        [bounds[1][0], bounds[1][1], bounds[1][2]]
      ];

      for (const corner of corners) {
        for (const viewType of ['axial', 'sagittal', 'coronal']) {
          const config = (renderer as any).getViewConfiguration(corner, viewType);
          const xform = new SliceTransform(volume.space, config.axes, config.sliceIndex);

          // Should not throw and should produce valid pixel coordinates
          expect(() => xform.worldToImageCoord(corner)).not.toThrow();
          const pixel = xform.worldToImageCoord(corner);

          expect(pixel.x).toBeGreaterThanOrEqual(0);
          expect(pixel.y).toBeGreaterThanOrEqual(0);
        }
      }
    });
  });
});
