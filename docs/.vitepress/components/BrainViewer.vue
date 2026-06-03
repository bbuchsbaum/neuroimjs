<script setup lang="ts">
/**
 * Live, in-browser neuroimjs viewer. Renders a real NIfTI volume with the actual
 * WebGL viewer from the library.
 *
 * All heavy, browser-only code (PIXI, the library, the NIfTI reader) is pulled in
 * via a dynamic import inside onMounted so it never executes during SSR / `docs:build`.
 */
import { ref, onMounted, onBeforeUnmount } from 'vue'
import type { ViewerMode } from '../theme/lib'

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
  }>(),
  {
    mode: 'ortho',
    height: 480,
    crosshair: true,
    showSlider: false,
  },
)

const el = ref<HTMLElement | null>(null)
const state = ref<'loading' | 'ready' | 'error'>('loading')
const message = ref('Loading brain volume…')
let handle: { destroy(): void } | undefined

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
      <div v-if="state !== 'ready'" class="brain-viewer__overlay" :class="state">
        <div v-if="state === 'loading'" class="brain-viewer__spinner" />
        <p>{{ state === 'error' ? '⚠ ' + message : message }}</p>
      </div>
    </div>
    <figcaption v-if="caption">{{ caption }}</figcaption>
  </figure>
</template>
