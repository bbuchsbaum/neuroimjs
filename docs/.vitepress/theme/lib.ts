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
} from 'neuroimjs'

export type ViewerMode = 'ortho' | 'axial' | 'coronal' | 'sagittal'

export interface LoadedVolume {
  vol: FloatNeuroVol
  space: NeuroSpace
  range: [number, number]
}

export interface MountOptions {
  crosshair?: boolean
  showSlider?: boolean
}

/**
 * Fetch a (optionally gzipped) NIfTI file and turn it into a Float32 volume with a
 * robust display range. Mirrors the loader used in the repo's example HTML pages.
 */
export async function loadNiftiVolume(url: string): Promise<LoadedVolume> {
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
): Promise<{ destroy(): void }> {
  const { vol, range } = loaded
  const grayscale = ColorMapFactory.createGrayscale({ range })
  const layer = new VolLayer('volume', vol, grayscale, range)
  const stack = new VolStack(layer)

  const crosshair = opts.crosshair ?? true
  const showSlider = opts.showSlider ?? false

  if (mode === 'ortho') {
    const viewer = await SimpleOrthogonalViewer.create(el, stack, {
      layout: 'top-bottom',
      showCrosshair: crosshair,
      showSlider,
    })
    return { destroy: () => (viewer as any).destroy?.() }
  }

  const width = el.clientWidth || 512
  const height = el.clientHeight || 512
  const factory = {
    axial: SingleSliceViewer.createAxial,
    coronal: SingleSliceViewer.createCoronal,
    sagittal: SingleSliceViewer.createSagittal,
  }[mode]

  const viewer = await factory(el, stack, { showCrosshair: crosshair, showSlider, width, height })
  return { destroy: () => (viewer as any).destroy?.() }
}
