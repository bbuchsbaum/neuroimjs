<script setup lang="ts">
/**
 * Live, in-browser neuroimjs viewer. Renders a real NIfTI volume with the actual
 * WebGL viewer from the library.
 *
 * All heavy, browser-only code (PIXI, the library, the NIfTI reader) is pulled in
 * via a dynamic import inside onMounted so it never executes during SSR / `docs:build`.
 */
import { ref, onMounted, onBeforeUnmount } from 'vue'
import type { ViewerMode, ViewerHandle } from '../theme/lib'

const props = withDefaults(
  defineProps<{
    mode?: ViewerMode
    /** Volume URL. Defaults to the bundled MNI152 template. */
    src?: string
    /** Stage height in px. */
    height?: number
    caption?: string
    crosshair?: boolean
    showSlider?: boolean
    /** Show anatomical orientation labels (L/R/A/P/S/I). */
    labels?: boolean
  }>(),
  {
    mode: 'ortho',
    height: 480,
    crosshair: true,
    showSlider: false,
    labels: true,
  },
)

const el = ref<HTMLElement | null>(null)
const state = ref<'loading' | 'ready' | 'error'>('loading')
const message = ref('Loading brain volume…')
const labelsOn = ref(props.labels)
let handle: ViewerHandle | undefined

function toggleLabels() {
  labelsOn.value = !labelsOn.value
  handle?.setOrientationLabels(labelsOn.value)
}

onMounted(async () => {
  try {
    const base = import.meta.env.BASE_URL
    const src = props.src ?? `${base}data/mni152_t1.nii.gz`
    const lib = await import('../theme/lib')

    message.value = 'Decoding NIfTI…'
    const loaded = await lib.loadNiftiVolume(src)

    message.value = 'Rendering…'
    handle = await lib.mountViewer(el.value!, props.mode, loaded, {
      crosshair: props.crosshair,
      showSlider: props.showSlider,
      orientationLabels: labelsOn.value,
    })
    state.value = 'ready'
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error('[BrainViewer]', err)
    state.value = 'error'
    message.value = err?.message ?? String(err)
  }
})

onBeforeUnmount(() => {
  try {
    handle?.destroy()
  } catch {
    /* viewer may not expose destroy(); ignore */
  }
})
</script>

<template>
  <figure class="brain-viewer">
    <div class="brain-viewer__stage" :style="{ height: `${height}px` }">
      <div ref="el" class="brain-viewer__canvas" />
      <button
        v-if="state === 'ready'"
        type="button"
        class="brain-viewer__toggle"
        :class="{ 'is-on': labelsOn }"
        :aria-pressed="labelsOn"
        title="Toggle anatomical orientation labels (L/R/A/P/S/I)"
        @click="toggleLabels"
      >
        <span class="brain-viewer__toggle-dot" />
        Labels
      </button>
      <div v-if="state !== 'ready'" class="brain-viewer__overlay" :class="state">
        <div v-if="state === 'loading'" class="brain-viewer__spinner" />
        <p>{{ state === 'error' ? '⚠ ' + message : message }}</p>
      </div>
    </div>
    <figcaption v-if="caption">{{ caption }}</figcaption>
  </figure>
</template>

<style scoped>
.brain-viewer__stage {
  position: relative;
}

.brain-viewer__toggle {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 5px 11px;
  font-size: 12px;
  font-weight: 500;
  font-family: inherit;
  color: var(--vp-c-text-1);
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 999px;
  cursor: pointer;
  opacity: 0.55;
  transition: opacity 0.15s ease, border-color 0.15s ease;
}

.brain-viewer__stage:hover .brain-viewer__toggle {
  opacity: 1;
}

.brain-viewer__toggle:hover {
  border-color: var(--vp-c-brand-1);
}

.brain-viewer__toggle-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--vp-c-divider);
  transition: background 0.15s ease;
}

.brain-viewer__toggle.is-on {
  opacity: 1;
}

.brain-viewer__toggle.is-on .brain-viewer__toggle-dot {
  background: var(--vp-c-brand-1);
}
</style>
