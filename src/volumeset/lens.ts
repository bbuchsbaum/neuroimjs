/**
 * Sarkar–Brown graphical fisheye in screen space (display only).
 *
 * With focus c, lens radius R and distortion D ≥ 0, a point at distance d from c
 * has normalised radial distance x = d / R. Inside the lens (x < 1) it is moved
 * along the same ray to normalised distance
 *
 *   G(x) = (D + 1)·x / (D·x + 1),
 *
 * which fixes the focus (G(0) = 0) and the boundary (G(1) = 1) and pushes points
 * outward in between. At and beyond the radius the map is the identity, so the
 * layout outside the lens never moves and the map is continuous at the boundary.
 * The local radial magnification is G'(x) = (D + 1) / (D·x + 1)²: D + 1 at the
 * focus, falling to 1/(D + 1) at the rim. G is strictly increasing with closed-form
 * inverse x = y / (D + 1 − D·y), used to map clicks back through the lens.
 *
 * Browser-safe and dependency-free.
 */

export interface FisheyePoint {
  x: number;
  y: number;
  /** Local radial magnification G'(x) (1 outside the lens), for sizing glyphs. */
  scale: number;
}

function clampD(distortion: number): number {
  return Number.isFinite(distortion) && distortion > 0 ? distortion : 0;
}

/**
 * Apply the fisheye centred at (cx, cy). Negative or non-finite `distortion` is
 * treated as 0 (identity); a non-positive `radius` disables the lens.
 */
export function fisheye(
  px: number,
  py: number,
  cx: number,
  cy: number,
  radius: number,
  distortion: number,
): FisheyePoint {
  const D = clampD(distortion);
  const dx = px - cx;
  const dy = py - cy;
  const d = Math.hypot(dx, dy);
  if (!(radius > 0) || D === 0 || d >= radius) return { x: px, y: py, scale: 1 };
  const x = d / radius;
  const denom = D * x + 1;
  const scale = (D + 1) / (denom * denom);
  if (d === 0) return { x: px, y: py, scale };
  const k = (D + 1) / denom; // G(x)/x: factor applied to the offset from the focus
  return { x: cx + dx * k, y: cy + dy * k, scale };
}

/** Inverse of `fisheye` for the same lens: the original point that displays at (x, y). */
export function inverseFisheye(
  x: number,
  y: number,
  cx: number,
  cy: number,
  radius: number,
  distortion: number,
): { x: number; y: number } {
  const D = clampD(distortion);
  const dx = x - cx;
  const dy = y - cy;
  const d = Math.hypot(dx, dy);
  if (!(radius > 0) || D === 0 || d >= radius || d === 0) return { x, y };
  const g = d / radius;
  const k = 1 / (D + 1 - D * g); // x/G(x) expressed in terms of G
  return { x: cx + dx * k, y: cy + dy * k };
}
