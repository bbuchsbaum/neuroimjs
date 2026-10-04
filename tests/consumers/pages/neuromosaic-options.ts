/**
 * Type contract for the option objects neuromosaic's adapter.js passes.
 *
 * The adapter is plain JavaScript, so an option renamed in neuroimjs would be
 * ignored silently at runtime (the viewer just falls back to its default).
 * The consumer-runner type-checks this file against the packed tarball's
 * declarations: `satisfies` rejects any key the options interfaces no longer
 * declare, and the literal values must still be accepted.
 */
import type {
  CrossHairOptions,
  OrientationLabelOptions,
  SimpleOrthogonalViewerOptions,
  SliceInterpolation,
  ViewerTheme,
} from 'neuroimjs/browser';

const theme = {
  backgroundColor: 0x0b0d12,
  crosshair: { crossColor: 0x9fd4ff, crossAlpha: 0.9, haloColor: 0x000000, haloAlpha: 0.6 },
  orientationLabels: { color: 0xe8eef7, alpha: 0.9, shadowAlpha: 0.7 },
} satisfies ViewerTheme;

const crosshairOptions = {
  crossThickness: 1,
  crosshairGap: 22,
  ...theme.crosshair,
} satisfies CrossHairOptions;

const orientationLabelOptions = {
  fontSize: 11,
  fontWeight: '600',
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif",
  letterSpacing: 0.6,
  strokeWidth: 0,
  shadowBlur: 3,
  margin: 5,
  anchor: 'image',
  ...theme.orientationLabels,
} satisfies OrientationLabelOptions;

export const neuromosaicViewerOptions = {
  layout: 'ortho',
  showCrosshair: true,
  showSlider: false,
  showOrientationLabels: true,
  gapPx: 1,
  cellPaddingPx: 24,
  stackBelowPx: 520,
  stackedLegendHeightPx: 292,
  stackMode: 'single',
  backgroundColor: theme.backgroundColor,
  focusOutline: null,
  crosshairOptions,
  orientationLabelOptions,
} satisfies SimpleOrthogonalViewerOptions;

export const neuromosaicInterpolations = ['cubic', 'smooth'] satisfies SliceInterpolation[];
