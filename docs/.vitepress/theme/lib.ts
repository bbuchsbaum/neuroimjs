/**
 * Client-only helpers for the live <BrainViewer /> embeds.
 *
 * IMPORTANT: this module statically imports PIXI/WebGL-dependent code, so it must
 * NEVER be imported at the top level of a component or theme file. Pull it in only
 * via a dynamic `await import('../theme/lib')` from inside `onMounted`, which runs
 * exclusively on the client and keeps it out of the SSR bundle.
 */
import * as nifti from 'nifti-reader-js'
import {
  VolStack,
  VolLayer,
  ColorMapFactory,
  FloatNeuroVol,
  NeuroSpace,
  SimpleOrthogonalViewer,
  SingleSliceViewer,
  ViewSynchronizer,
  LayerControlPanel,
} from 'neuroimjs'

// Importing the class registers <layer-control-panel>; reference it so the
// import is not dropped as unused.
void LayerControlPanel

/** `trio` = three SingleSliceViewers linked by a ViewSynchronizer. */
export type ViewerMode = 'ortho' | 'trio' | 'axial' | 'coronal' | 'sagittal'

export interface LoadedVolume {
  vol: FloatNeuroVol
  space: NeuroSpace
  range: [number, number]
}

export interface MountOptions {
  crosshair?: boolean
  showSlider?: boolean
  /** Show anatomical orientation labels (L/R/A/P/S/I) pinned to the viewport edges. */
  orientationLabels?: boolean
}

/** Handle returned by {@link mountViewer}. */
export interface ViewerHandle {
  destroy(): void
  /** Toggle the anatomical orientation labels at runtime. */
  setOrientationLabels(visible: boolean): void
}

const volumeCache = new Map<string, Promise<LoadedVolume>>()

/**
 * Fetch a (optionally gzipped) NIfTI file and turn it into a Float32 volume with a
 * robust display range. Memoized by URL: pages with several embeds, and SPA
 * navigation between pages, download and decode the template once. Volumes are
 * never mutated by the viewers, so sharing one instance is safe.
 */
export function loadNiftiVolume(url: string): Promise<LoadedVolume> {
  let pending = volumeCache.get(url)
  if (!pending) {
    pending = decodeNiftiVolume(url)
    pending.catch(() => volumeCache.delete(url))
    volumeCache.set(url, pending)
  }
  return pending
}

async function decodeNiftiVolume(url: string): Promise<LoadedVolume> {
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`Could not fetch volume (${resp.status}) — ${url}`)

  let buffer: ArrayBuffer = await resp.arrayBuffer()
  if (nifti.isCompressed(buffer)) buffer = nifti.decompress(buffer)
  if (!nifti.isNIFTI(buffer)) throw new Error('File is not a valid NIfTI volume')

  const header = nifti.readHeader(buffer)
  const imgBuffer = nifti.readImage(header, buffer)

  const dim = Array.from(header.dims.slice(1, 4)) as number[]
  const spacing = Array.from(header.pixDims.slice(1, 4)) as number[]
  const affine = header.affine as number[][]
  const origin = [affine[0][3], affine[1][3], affine[2][3]] as number[]
  const space = new NeuroSpace(dim, spacing, origin, undefined, affine)

  const N = nifti.NIFTI1
  let raw: ArrayLike<number>
  switch (header.datatypeCode) {
    case N.TYPE_INT8: raw = new Int8Array(imgBuffer); break
    case N.TYPE_UINT8: raw = new Uint8Array(imgBuffer); break
    case N.TYPE_INT16: raw = new Int16Array(imgBuffer); break
    case N.TYPE_UINT16: raw = new Uint16Array(imgBuffer); break
    case N.TYPE_INT32: raw = new Int32Array(imgBuffer); break
    case N.TYPE_UINT32: raw = new Uint32Array(imgBuffer); break
    case N.TYPE_FLOAT32: raw = new Float32Array(imgBuffer); break
    case N.TYPE_FLOAT64: raw = new Float64Array(imgBuffer); break
    default: throw new Error(`Unsupported NIfTI datatype ${header.datatypeCode}`)
  }

  const slope = header.scl_slope && header.scl_slope !== 0 ? header.scl_slope : 1
  const intercept = header.scl_inter || 0
  const floatData = new Float32Array(raw.length)
  for (let i = 0; i < raw.length; i++) floatData[i] = raw[i] * slope + intercept

  // Robust window: 2nd–99.5th percentile of a subsample, with a min/max fallback.
  const sample: number[] = []
  const step = Math.max(1, Math.floor(floatData.length / 250_000))
  for (let i = 0; i < floatData.length; i += step) sample.push(floatData[i])
  sample.sort((a, b) => a - b)
  const pick = (p: number) =>
    sample[Math.min(sample.length - 1, Math.max(0, Math.floor(p * (sample.length - 1))))]
  let rangeMin = pick(0.02)
  let rangeMax = pick(0.995)
  if (!Number.isFinite(rangeMin) || rangeMin >= rangeMax) {
    rangeMin = floatData.reduce((a, b) => Math.min(a, b), Infinity)
    rangeMax = floatData.reduce((a, b) => Math.max(a, b), -Infinity)
  }

  return { vol: new FloatNeuroVol(space, floatData), space, range: [rangeMin, rangeMax] }
}

/** Build a VolStack and mount the requested viewer into `el`. */
export async function mountViewer(
  el: HTMLElement,
  mode: ViewerMode,
  loaded: LoadedVolume,
  opts: MountOptions = {},
): Promise<ViewerHandle> {
  const { vol, range } = loaded
  const grayscale = ColorMapFactory.createGrayscale({ range })
  const layer = new VolLayer('volume', vol, grayscale, range)
  const stack = new VolStack(layer)

  const crosshair = opts.crosshair ?? true
  const showSlider = opts.showSlider ?? false
  const orientationLabels = opts.orientationLabels ?? false

  if (mode === 'ortho') {
    const viewer = await SimpleOrthogonalViewer.create(el, stack, {
      layout: 'top-bottom',
      showCrosshair: crosshair,
      showSlider,
      showOrientationLabels: orientationLabels,
    })
    return {
      destroy: () => viewer.dispose(),
      setOrientationLabels: (v: boolean) => viewer.setOrientationLabelsVisible(v),
    }
  }

  if (mode === 'trio') {
    el.style.display = 'grid'
    el.style.gridTemplateColumns = 'repeat(3, minmax(0, 1fr))'
    el.style.gap = '6px'
    const cells = [0, 1, 2].map(() => el.appendChild(document.createElement('div')))
    const opts = { showCrosshair: crosshair, showSlider, showOrientationLabels: orientationLabels }
    const axial = await SingleSliceViewer.createAxial(cells[0], stack, opts)
    const coronal = await SingleSliceViewer.createCoronal(cells[1], stack, opts)
    const sagittal = await SingleSliceViewer.createSagittal(cells[2], stack, opts)
    const sync = ViewSynchronizer.createOrthogonal(axial, sagittal, coronal)
    const views = [axial, coronal, sagittal]
    return {
      destroy: () => {
        sync.dispose()
        views.forEach((v) => v.dispose())
      },
      setOrientationLabels: (v: boolean) => views.forEach((view) => view.setOrientationLabelsVisible(v)),
    }
  }

  const width = el.clientWidth || 512
  const height = el.clientHeight || 512
  const factory = {
    axial: SingleSliceViewer.createAxial,
    coronal: SingleSliceViewer.createCoronal,
    sagittal: SingleSliceViewer.createSagittal,
  }[mode]

  const viewer = await factory(el, stack, {
    showCrosshair: crosshair,
    showSlider,
    width,
    height,
    showOrientationLabels: orientationLabels,
  })
  return {
    destroy: () => viewer.dispose(),
    setOrientationLabels: (v: boolean) => viewer.setOrientationLabelsVisible(v),
  }
}

// ---------------------------------------------------------------------------
// Workbench: the full viewer with an overlay and the LayerControlPanel.
// ---------------------------------------------------------------------------

/** A named peak in the synthetic statistical map (MNI mm). */
export interface DemoPeak {
  label: string
  mni: [number, number, number]
  /**
   * Relative cluster strength; the sign marks task-positive vs task-negative.
   * Not the rendered value, which also includes the sub-lobes around the peak.
   */
  weight: number
}

/**
 * Peaks for a synthetic "right-hand finger tapping" z-map: task-positive motor
 * network and a task-negative default-mode response. Illustrative only.
 */
export const DEMO_PEAKS: DemoPeak[] = [
  { label: 'L motor cortex', mni: [-38, -22, 56], weight: 7.5 },
  { label: 'SMA', mni: [-2, -6, 56], weight: 5.5 },
  { label: 'R cerebellum', mni: [20, -52, -24], weight: 5 },
  { label: 'Precuneus', mni: [0, -56, 30], weight: -4.5 },
  { label: 'Medial PFC', mni: [0, 52, -4], weight: -4 },
]

/** Small deterministic PRNG (LCG) so the demo map is identical on every load. */
function seeded(seed: number): () => number {
  let s = seed >>> 0
  return () => ((s = (1664525 * s + 1013904223) >>> 0) / 4294967296)
}

/**
 * Build a synthetic z-map on the grid of `loaded`: a Gaussian cluster (sigma
 * 6 mm) at each of {@link DEMO_PEAKS}, with four jittered narrower sub-lobes so
 * the clusters are not perfect spheres, plus a smooth low-amplitude background field. Restricted
 * to voxels inside the head.
 */
export function makeDemoStatMap(loaded: LoadedVolume, peaks: DemoPeak[] = DEMO_PEAKS): FloatNeuroVol {
  const { vol, space, range } = loaded
  const [nx, ny, nz] = space.dim
  const anat = vol.getData() as Float32Array
  const out = new Float32Array(nx * ny * nz)
  const inHead = range[0] + 0.2 * (range[1] - range[0])

  // Expand each peak into a main lobe plus jittered sub-lobes, then scatter
  // weak blobs of both signs across the brain as sub-threshold texture.
  const rand = seeded(20240611)
  const jitter = (s: number) => (rand() - 0.5) * 2 * s
  const blobs: { c: number[]; a: number; s2: number }[] = []
  for (const p of peaks) {
    blobs.push({ c: p.mni, a: p.weight * 0.6, s2: 2 * 6 * 6 })
    for (let n = 0; n < 4; n++) {
      blobs.push({
        c: [p.mni[0] + jitter(8), p.mni[1] + jitter(8), p.mni[2] + jitter(6)],
        a: p.weight * (0.12 + 0.12 * rand()),
        s2: 2 * (3.5 + 2 * rand()) ** 2,
      })
    }
  }
  for (let n = 0; n < 50; n++) {
    blobs.push({
      c: [jitter(65), -18 + jitter(80), 12 + jitter(55)],
      a: jitter(2.6),
      s2: 2 * (4 + 3 * rand()) ** 2,
    })
  }
  const reach2 = 3 * 3 * Math.max(...blobs.map((b) => b.s2)) / 2

  // world = A·[i,j,k,1]; precompute the affine rows once.
  const o = space.gridToCoord([0, 0, 0])
  const di = space.gridToCoord([1, 0, 0]).map((v, a) => v - o[a])
  const dj = space.gridToCoord([0, 1, 0]).map((v, a) => v - o[a])
  const dk = space.gridToCoord([0, 0, 1]).map((v, a) => v - o[a])

  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      const bx = o[0] + j * dj[0] + k * dk[0]
      const by = o[1] + j * dj[1] + k * dk[1]
      const bz = o[2] + j * dj[2] + k * dk[2]
      const row = (k * ny + j) * nx
      for (let i = 0; i < nx; i++) {
        const idx = row + i
        if (anat[idx] < inHead) continue
        const x = bx + i * di[0]
        const y = by + i * di[1]
        const z = bz + i * di[2]
        let v = 0
        for (const b of blobs) {
          const d2 = (x - b.c[0]) ** 2 + (y - b.c[1]) ** 2 + (z - b.c[2]) ** 2
          if (d2 < reach2) v += b.a * Math.exp(-d2 / b.s2)
        }
        out[idx] = v
      }
    }
  }
  return new FloatNeuroVol(space, out)
}

export interface Workbench {
  viewer: SimpleOrthogonalViewer
  stack: VolStack
  destroy(): void
}

/**
 * Mount a SimpleOrthogonalViewer showing `loaded` with a thresholded,
 * diverging z-map overlay. Wire the returned `stack`/`viewer` to a
 * `<layer-control-panel>` for interactive display controls.
 */
export async function mountWorkbench(el: HTMLElement, loaded: LoadedVolume): Promise<Workbench> {
  const { vol, range } = loaded
  const anat = new VolLayer('T1w', vol, ColorMapFactory.createGrayscale({ range }), range)
  const stat = makeDemoStatMap(loaded)
  // VolLayer's range/threshold/opacity arguments are authoritative; they
  // override whatever the colormap was created with.
  const overlay = new VolLayer('z-stat', stat, ColorMapFactory.fromPreset('BlueRed'), [-6, 6], [-2.3, 2.3], 0.9)

  const stack = new VolStack(anat)
  stack.addLayer(overlay)

  const viewer = await SimpleOrthogonalViewer.create(el, stack, {
    layout: 'left-tall',
    showCrosshair: true,
    showOrientationLabels: true,
  })
  viewer.setWorldCoord(DEMO_PEAKS[0].mni)
  return { viewer, stack, destroy: () => viewer.dispose() }
}
