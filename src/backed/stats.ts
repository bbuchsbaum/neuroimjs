/** Small, exact statistics for summaries: means, t quantiles, intervals. */

export function mean(xs: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += xs[i];
  return s / xs.length;
}

export function sd(xs: ArrayLike<number>): number {
  const n = xs.length;
  if (n < 2) return NaN;
  const m = mean(xs);
  let s = 0;
  for (let i = 0; i < n; i++) s += (xs[i] - m) ** 2;
  return Math.sqrt(s / (n - 1));
}

function lgamma(z: number): number {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let x = z, y = z;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (const cj of c) ser += cj / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

function betacf(x: number, a: number, b: number): number {
  const tiny = 1e-30;
  let c = 1, d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < tiny) d = tiny;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c; if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d; h *= d * c;
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d; if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c; if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-12) break;
  }
  return h;
}

/** Regularized incomplete beta I_x(a, b). */
export function betaInc(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * betacf(x, a, b)) / a : 1 - (bt * betacf(1 - x, b, a)) / b;
}

/** Two-sided p for a t statistic. */
export function tPValue(t: number, df: number): number {
  return betaInc(df / (df + t * t), df / 2, 0.5);
}

/** Upper quantile of Student's t: P(T <= q) = p. */
export function tQuantile(p: number, df: number): number {
  if (!(df > 0)) return NaN;
  const target = 2 * (1 - p); // two-sided tail
  let lo = 0, hi = 1;
  while (tPValue(hi, df) > target) hi *= 2;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (tPValue(mid, df) > target) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

export interface Fit {
  slope: number; intercept: number; r: number; p: number; n: number;
  /** Half-width of the 95% CI of the fitted mean at x. */
  band: (x: number) => number;
}

/** Least-squares line and Pearson r. */
export function fitLine(xs: number[], ys: number[]): Fit {
  const n = xs.length;
  const mx = mean(xs), my = mean(ys);
  let sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; sxy += (xs[i] - mx) * (ys[i] - my);
  }
  const slope = sxy / sxx;
  const r = sxy / Math.sqrt(sxx * syy);
  const t = (r * Math.sqrt(n - 2)) / Math.sqrt(Math.max(1e-300, 1 - r * r));
  const intercept = my - slope * mx;
  let rss = 0;
  for (let i = 0; i < n; i++) rss += (ys[i] - intercept - slope * xs[i]) ** 2;
  const s = Math.sqrt(rss / (n - 2));
  const q = tQuantile(0.975, n - 2);
  const band = (x: number) => q * s * Math.sqrt(1 / n + (x - mx) ** 2 / sxx);
  return { slope, intercept, r, p: n > 2 ? tPValue(t, n - 2) : NaN, n, band };
}
