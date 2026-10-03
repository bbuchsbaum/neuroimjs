import type { CrossHairOptions } from './CrossHair';
import type { OrientationLabelOptions } from './OrientationLabelLayer';

/**
 * Runtime-changeable colours of a slice viewer's stage and annotations.
 *
 * Every field is optional; omitted fields keep their current value, so a
 * theme switch can be expressed as a partial update. Apply with `setTheme()`
 * on {@link SimpleOrthogonalViewer}, {@link OrthogonalImageViewer},
 * {@link SingleSliceViewer} or {@link SliceViewer}; no viewer rebuild is
 * needed.
 *
 * @example
 * viewer.setTheme({
 *   backgroundColor: 0xfafaf7,
 *   crosshair: { crossColor: 0x1c2226, crossAlpha: 0.55, haloColor: 0xffffff, haloAlpha: 0.6 },
 *   orientationLabels: { color: 0x3e4952, alpha: 0.9, shadowAlpha: 0 },
 * });
 */
export interface ViewerTheme {
  /** Canvas clear colour (PIXI numeric colour). */
  backgroundColor?: number;
  /** Canvas clear alpha in [0, 1]. */
  backgroundAlpha?: number;
  /** Crosshair styling (colour, alpha, halo, width, gap). */
  crosshair?: CrossHairOptions;
  /** Orientation label styling (colour, alpha, stroke, shadow, font). */
  orientationLabels?: OrientationLabelOptions;
}
