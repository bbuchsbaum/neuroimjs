import chroma from 'chroma-js';
import { ColorMap } from '../../src/display/ColorMap';
import { sliceFullGrid, type SetOrientation, type SliceGrid } from '../../src/volumeset/VolumeSet';

export const THEME = {
  bg: '#0d0e14',
  panel: '#15161f',
  panelAlt: '#101119',
  line: '#262838',
  lineStrong: '#3a3d52',
  text: '#e6e6ef',
  muted: '#8a8ca3',
  faint: '#5d6078',
  brand: '#9b86ff',
  accent: '#22d3ee',
  warn: '#f5a524',
};

export const FONT = {
  sans: 'Inter, ui-sans-serif, system-ui, sans-serif',
  mono: '"JetBrains Mono", ui-monospace, Menlo, monospace',
};

/** Unicode minus for display. */
export function fmt(v: number, digits = 2): string {
  if (!Number.isFinite(v)) return '–';
  const s = Math.abs(v).toFixed(digits);
  return v < 0 && Number(s) !== 0 ? `−${s}` : s;
}

/**
 * Diverging map whose arms start saturated at the threshold and lighten
 * toward the range limit, so near-threshold voxels stay visible on anatomy.
 * Negative: deep blue -> light blue; positive: crimson -> orange -> gold.
 */
export function thresholdedDiverging(range: number, thr: number): ColorMap {
  const pos = chroma.scale(['#c41e3a', '#ee6a2f', '#ffc94a']).mode('lch');
  const neg = chroma.scale(['#2a55d0', '#2f8ff0', '#86d4ff']).mode('lch');
  const steps = 512;
  const t0 = Math.min(thr, range * 0.999);
  const colors: [number, number, number, number][] = [];
  for (let s = 0; s < steps; s++) {
    const v = -range + (2 * range * s) / (steps - 1);
    const a = Math.abs(v);
    const f = a <= t0 ? 0 : Math.min(1, (a - t0) / (range - t0 || 1));
    const c = (v >= 0 ? pos : neg)(f).rgb();
    // Just-suprathreshold voxels are slightly translucent so isolated noise reads quieter than clusters.
    const alpha = 0.72 + 0.28 * Math.min(1, f / 0.35);
    colors.push([c[0] / 255, c[1] / 255, c[2] / 255, alpha]);
  }
  return new ColorMap(colors, { range: [-range, range], threshold: [-thr, thr] });
}

/** Composite a grayscale underlay slice and a colour-mapped overlay slice into RGBA. */
export function compose(under: SliceGrid, underRange: [number, number], over: SliceGrid | null, cmap: ColorMap): ImageData {
  const { width, height } = under;
  const img = new ImageData(width, height);
  const px = img.data;
  const [lo, hi] = underRange;
  const span = hi - lo || 1;
  for (let p = 0; p < width * height; p++) {
    const u = under.data[p];
    const g = Number.isFinite(u) ? Math.max(0, Math.min(255, ((u - lo) / span) * 255)) : 0;
    px[p * 4] = g;
    px[p * 4 + 1] = g;
    px[p * 4 + 2] = g;
    px[p * 4 + 3] = 255;
  }
  if (over) {
    const o = cmap.fillImageData(new ImageData(width, height), over.data).data;
    for (let p = 0; p < width * height; p++) {
      const a = o[p * 4 + 3] / 255;
      if (a === 0) continue;
      for (let c = 0; c < 3; c++) px[p * 4 + c] = o[p * 4 + c] * a + px[p * 4 + c] * (1 - a);
    }
  }
  return img;
}

export function underlaySlice(dim: readonly number[], t1: ArrayLike<number>, o: SetOrientation, index: number): SliceGrid {
  return sliceFullGrid(dim, t1, o, index);
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Fit n cells of aspect (w/h) into W x H, maximising cell size. */
export function fitGrid(n: number, W: number, H: number, aspect: number, gapX: number, gapY: number): { cols: number; cw: number; ch: number } {
  let best = { cols: 1, cw: 0, ch: 0 };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    let cw = (W - gapX * (cols - 1)) / cols;
    let ch = cw / aspect;
    if (ch * rows + gapY * (rows - 1) > H) {
      ch = (H - gapY * (rows - 1)) / rows;
      cw = ch * aspect;
    }
    if (cw > best.cw) best = { cols, cw, ch };
  }
  return best;
}

/** Maps between slice-pixel space (a crop window) and a destination rect. */
export class CellView {
  constructor(
    readonly crop: Rect,
    readonly dest: Rect
  ) {}
  toScreen(col: number, row: number): [number, number] {
    return [
      this.dest.x + ((col + 0.5 - this.crop.x) / this.crop.w) * this.dest.w,
      this.dest.y + ((row + 0.5 - this.crop.y) / this.crop.h) * this.dest.h,
    ];
  }
  toSlice(x: number, y: number): [number, number] {
    return [
      Math.floor(this.crop.x + ((x - this.dest.x) / this.dest.w) * this.crop.w),
      Math.floor(this.crop.y + ((y - this.dest.y) / this.dest.h) * this.crop.h),
    ];
  }
  contains(x: number, y: number): boolean {
    const d = this.dest;
    return x >= d.x && x < d.x + d.w && y >= d.y && y < d.y + d.h;
  }
}

/** Fit a crop window into a rect preserving aspect; returns the placed view. */
export function placeCrop(crop: Rect, r: Rect): CellView {
  const s = Math.min(r.w / crop.w, r.h / crop.h);
  const w = crop.w * s;
  const h = crop.h * s;
  // Whole-pixel destination rects: voxel edges then land on pixel boundaries when magnified.
  const x = Math.round(r.x + (r.w - w) / 2);
  const y = Math.round(r.y + (r.h - h) / 2);
  return new CellView(crop, { x, y, w: Math.round(w), h: Math.round(h) });
}

/**
 * Draw a cell in two layers: the anatomy is always smoothly resampled; the statistical
 * overlay switches to nearest-neighbour (crisp voxels) above 3x magnification.
 */
export function drawCellImage(ctx: CanvasRenderingContext2D, under: CanvasImageSource, over: CanvasImageSource, view: CellView): void {
  const { crop, dest } = view;
  ctx.save();
  ctx.beginPath();
  ctx.rect(dest.x, dest.y, dest.w, dest.h);
  ctx.clip();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(under, crop.x, crop.y, crop.w, crop.h, dest.x, dest.y, dest.w, dest.h);
  ctx.imageSmoothingEnabled = dest.w / crop.w < 3;
  ctx.drawImage(over, crop.x, crop.y, crop.w, crop.h, dest.x, dest.y, dest.w, dest.h);
  ctx.restore();
}

/** Thin crosshair with an open gap at the cursor, clipped to the image. */
export function drawCrosshair(ctx: CanvasRenderingContext2D, view: CellView, col: number, row: number, alpha = 0.75): void {
  const [x, y] = view.toScreen(col, row);
  const d = view.dest;
  if (x < d.x || x > d.x + d.w || y < d.y || y > d.y + d.h) return;
  const gap = Math.max(5, Math.min(10, d.w * 0.05));
  ctx.save();
  ctx.beginPath();
  ctx.rect(d.x, d.y, d.w, d.h);
  ctx.clip();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = THEME.accent;
  ctx.lineWidth = 1;
  const px = Math.round(x) + 0.5;
  const py = Math.round(y) + 0.5;
  ctx.beginPath();
  ctx.moveTo(d.x, py);
  ctx.lineTo(px - gap, py);
  ctx.moveTo(px + gap, py);
  ctx.lineTo(d.x + d.w, py);
  ctx.moveTo(px, d.y);
  ctx.lineTo(px, py - gap);
  ctx.moveTo(px, py + gap);
  ctx.lineTo(px, d.y + d.h);
  ctx.stroke();
  ctx.restore();
}

/** Orientation letters at the edges of an image rect. */
export function drawOrientationLetters(ctx: CanvasRenderingContext2D, d: Rect, o: SetOrientation, size = 11): void {
  const [left, right, top, bottom] =
    o === 'axial' ? ['L', 'R', 'A', 'P'] : o === 'coronal' ? ['L', 'R', 'S', 'I'] : ['A', 'P', 'S', 'I'];
  ctx.save();
  ctx.font = `600 ${size}px ${FONT.sans}`;
  ctx.fillStyle = 'rgba(230,230,239,0.85)';
  ctx.shadowColor = 'rgba(0,0,0,0.9)';
  ctx.shadowBlur = 3;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillText(left, d.x + 4, d.y + 3);
  ctx.textAlign = 'right';
  ctx.fillText(right, d.x + d.w - 4, d.y + 3);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(top, d.x + d.w / 2, d.y + 3);
  ctx.textBaseline = 'bottom';
  ctx.fillText(bottom, d.x + d.w / 2, d.y + d.h - 2);
  ctx.restore();
}

/** HiDPI canvas setup; returns a 2D context in CSS pixels. */
export function hidpi(canvas: HTMLCanvasElement, W: number, H: number): CanvasRenderingContext2D {
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

/** Labelled horizontal colour bar for the thresholded diverging map. */
export function drawColorbar(canvas: HTMLCanvasElement, cmap: ColorMap, range: number, thr: number, digits: number): void {
  const W = canvas.parentElement!.clientWidth;
  const H = 34;
  const ctx = hidpi(canvas, W, H);
  ctx.clearRect(0, 0, W, H);
  const barH = 10;
  const x = (v: number): number => ((v + range) / (2 * range)) * (W - 1);
  for (let px = 0; px < W; px++) {
    const v = -range + (2 * range * px) / (W - 1);
    if (Math.abs(v) < thr) {
      ctx.fillStyle = THEME.line;
      ctx.fillRect(px, 0, 1, barH);
    } else {
      // Drawn over mid-grey anatomy so the translucency near threshold is shown honestly.
      const c = cmap.getColor(v);
      ctx.fillStyle = '#8c8c8c';
      ctx.fillRect(px, 0, 1, barH);
      ctx.fillStyle = `rgba(${c[0] * 255},${c[1] * 255},${c[2] * 255},${c[3] ?? 1})`;
      ctx.fillRect(px, 0, 1, barH);
    }
  }
  ctx.fillStyle = THEME.muted;
  ctx.font = `11px ${FONT.mono}`;
  ctx.textBaseline = 'top';
  const ticks: [number, CanvasTextAlign][] = [
    [-range, 'left'],
    [range, 'right'],
  ];
  if (thr > 0 && thr < range * 0.85) {
    ticks.push([-thr, 'center'], [thr, 'center']);
  } else {
    ticks.push([0, 'center']);
  }
  for (const [v, align] of ticks) {
    ctx.textAlign = align;
    ctx.fillRect(Math.round(x(v)) - (align === 'right' ? 1 : 0), barH, 1, 4);
    ctx.fillText(fmt(v, digits), x(v), barH + 6);
  }
}

/** Sequential single-hue ramp (panel -> brand -> near-white) for similarity values. */
export const simRamp = chroma.scale(['#1b1b2b', '#4b3d99', '#9b86ff', '#ece8ff']).mode('lch');
