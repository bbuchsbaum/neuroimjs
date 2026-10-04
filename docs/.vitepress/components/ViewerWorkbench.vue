<script setup lang="ts">
/**
 * The full neuroimjs viewer: SimpleOrthogonalViewer with a statistical overlay,
 * the <layer-control-panel> web component, a toolbar, and a live readout.
 *
 * Browser-only code is pulled in with a dynamic import inside onMounted so it
 * never runs during SSR / `docs:build`.
 */
import { ref, shallowRef, onMounted, onBeforeUnmount } from 'vue'
import type { Workbench, DemoPeak } from '../theme/lib'

const props = withDefaults(defineProps<{ height?: number; src?: string }>(), { height: 560 })

const stage = ref<HTMLElement | null>(null)
const panel = ref<HTMLElement | null>(null)
const state = ref<'loading' | 'ready' | 'error'>('loading')
const message = ref('Loading brain volume…')
const peaks = shallowRef<DemoPeak[]>([])
const crosshair = ref(true)
const labels = ref(true)
const readout = ref({ mm: '—', anat: '—', z: '—' })
let bench: Workbench | undefined
let offCoord: (() => void) | undefined
// Set on unmount; checked after every await so a viewer created after the
// user navigated away is disposed instead of leaked.
let unmounted = false

const fmt = (v: number | null, d = 2) =>
  v === null ? '—' : v.toFixed(d).replace(/^-/, '−')

function updateReadout(coord: number[]) {
  if (!bench) return
  readout.value = {
    mm: coord.map((c) => Math.round(c)).join(', '),
    anat: fmt(bench.viewer.getValue('T1w', coord), 0),
    z: fmt(bench.viewer.getValue('z-stat', coord)),
  }
}

function goTo(p: DemoPeak) {
  bench?.viewer.setWorldCoord(p.mni)
}

function toggleCrosshair() {
  crosshair.value = !crosshair.value
  bench?.viewer.setCrosshairVisible(crosshair.value)
}

function toggleLabels() {
  labels.value = !labels.value
  bench?.viewer.setOrientationLabelsVisible(labels.value)
}

function resetView() {
  bench?.viewer.resetAllViews()
}

function snapshot() {
  if (!bench) return
  const a = document.createElement('a')
  a.href = bench.viewer.toDataURL('axial')
  a.download = 'neuroimjs-axial.png'
  a.click()
}

onMounted(async () => {
  try {
    const src = props.src ?? `${import.meta.env.BASE_URL}data/mni152_t1.nii.gz`
    const lib = await import('../theme/lib')
    if (unmounted) return
    peaks.value = lib.DEMO_PEAKS

    message.value = 'Decoding NIfTI…'
    const loaded = await lib.loadNiftiVolume(src)
    if (unmounted) return

    message.value = 'Building overlay & rendering…'
    // Let the status message paint before the (synchronous) overlay build.
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r)))
    if (unmounted || !stage.value) return
    const created = await lib.mountWorkbench(stage.value, loaded)
    if (unmounted) {
      created.destroy()
      return
    }
    bench = created

    const el = panel.value as any
    el.viewer = bench.viewer
    el.volStack = bench.stack
    await el.updateComplete
    el.selectLayer('z-stat')

    offCoord = bench.viewer.onCoordChange(updateReadout)
    updateReadout(bench.viewer.getWorldCoord())
    state.value = 'ready'
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error('[ViewerWorkbench]', err)
    state.value = 'error'
    message.value = err?.message ?? String(err)
  }
})

onBeforeUnmount(() => {
  unmounted = true
  offCoord?.()
  bench?.destroy()
  bench = undefined
})
</script>

<template>
  <figure class="workbench">
    <div class="workbench__toolbar" role="toolbar" aria-label="Viewer controls">
      <span class="workbench__group">
        <span class="workbench__label">Jump to</span>
        <button v-for="p in peaks" :key="p.label" class="workbench__chip" :class="p.weight > 0 ? 'pos' : 'neg'" :disabled="state !== 'ready'" @click="goTo(p)">
          {{ p.label }}
        </button>
      </span>
      <span class="workbench__group">
        <button class="workbench__btn" :aria-pressed="crosshair" :disabled="state !== 'ready'" @click="toggleCrosshair">Crosshair</button>
        <button class="workbench__btn" :aria-pressed="labels" :disabled="state !== 'ready'" @click="toggleLabels">Labels</button>
        <button class="workbench__btn" :disabled="state !== 'ready'" @click="resetView">Reset zoom</button>
        <button class="workbench__btn" :disabled="state !== 'ready'" @click="snapshot">PNG</button>
      </span>
    </div>

    <div class="workbench__body">
      <div class="workbench__stage" :style="{ height: `${height}px` }">
        <div ref="stage" class="workbench__canvas" />
        <div v-if="state !== 'ready'" class="brain-viewer__overlay" :class="state">
          <div v-if="state === 'loading'" class="brain-viewer__spinner" />
          <p>{{ state === 'error' ? '⚠ ' + message : message }}</p>
        </div>
      </div>
      <aside class="workbench__side">
        <layer-control-panel ref="panel" />
      </aside>
    </div>

    <figcaption class="workbench__readout" aria-live="polite">
      <span><b>MNI</b> {{ readout.mm }} mm</span>
      <span><b>T1w</b> {{ readout.anat }}</span>
      <span><b>z</b> {{ readout.z }}</span>
      <span class="workbench__note">Synthetic z-map (illustrative) on the MNI152 template.</span>
    </figcaption>
  </figure>
</template>

<style scoped>
.workbench {
  container-type: inline-size;
  margin: 24px 0;
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  overflow: hidden;
  background: var(--vp-c-bg-soft);
}
.workbench__toolbar {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 8px 16px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--vp-c-divider);
}
.workbench__group {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.workbench__label {
  font-size: 12px;
  color: var(--vp-c-text-2);
  margin-right: 2px;
}
.workbench__chip,
.workbench__btn {
  font-size: 12px;
  line-height: 1;
  padding: 6px 9px;
  border-radius: 6px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  cursor: pointer;
}
.workbench__chip.pos { border-left: 3px solid #d6604d; }
.workbench__chip.neg { border-left: 3px solid #4393c3; }
.workbench__btn[aria-pressed='true'] {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
}
.workbench__chip:hover:not(:disabled),
.workbench__btn:hover:not(:disabled) { border-color: var(--vp-c-brand-1); }
.workbench__chip:disabled,
.workbench__btn:disabled { opacity: 0.5; cursor: default; }
.workbench__body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 280px;
}
.workbench__stage {
  position: relative;
  background: #000;
  min-width: 0;
}
.workbench__canvas {
  position: absolute;
  inset: 0;
}
.workbench__side {
  padding: 12px;
  border-left: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg);
  overflow-y: auto;
}
.workbench__readout {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 18px;
  padding: 8px 12px;
  border-top: 1px solid var(--vp-c-divider);
  font: 12px var(--vp-font-family-mono);
  color: var(--vp-c-text-1);
}
.workbench__readout b { color: var(--vp-c-text-2); font-weight: 600; margin-right: 4px; }
.workbench__note {
  margin-left: auto;
  font-family: var(--vp-font-family-base);
  color: var(--vp-c-text-3);
}
/* In a narrow column (e.g. a docs page with sidebar), put the panel below the
   viewer so the three planes keep the full width. */
@container (max-width: 880px) {
  .workbench__body { grid-template-columns: 1fr; }
  .workbench__side { border-left: none; border-top: 1px solid var(--vp-c-divider); }
}
</style>
