# Controls (UI Components)

The viewers are deliberately UI-free. For the common controls — pick a layer, change its colormap, window and threshold it, fade it — neuroimjs ships two [Lit](https://lit.dev) web components:

- **`<layer-control-panel>`** (`LayerControlPanel`): display controls for the layers of a `VolStack`, bound to any viewer.
- **`<overlay-review-panel>`** (`OverlayReviewPanel`): subject-by-subject and group-summary review of first-level maps, bound to a `SubjectOverlayViewer`.

Both are browser-only and exported from the **`neuroimjs/browser`** entry, not the main `neuroimjs` entry. Importing that module registers the elements (and the panel's internal `<range-slider>`) with `customElements`.

::: warning Don't mix entry points in one app
Import the viewer, the `VolLayer`s, `VolStack` and `ColorMapFactory` from `neuroimjs/browser` too. That bundle carries its own copy of every class, so a viewer from the main `neuroimjs` entry does not recognise the panel's `ColorMap` objects (`updateLayer` checks `instanceof ColorMap`) and every colormap the panel applies renders as **grayscale**. The main entry also statically imports Node's `fs` and `path`. See [Viewers](/guide/viewers#simpleorthogonalviewer).
:::

<ViewerWorkbench />

The viewer above is `SimpleOrthogonalViewer` (layout `'left-tall'`) with a T1 underlay and a synthetic z-map overlay (`BlueRed`, threshold `[-2.3, 2.3]`), a `<layer-control-panel>` bound as below, and a coordinate/value readout built from `onCoordChange` and `getValue`.

## LayerControlPanel

### Wiring it to a viewer

```html
<div id="viewer" style="height: 520px"></div>
<aside><layer-control-panel></layer-control-panel></aside>
```

```ts
import { SimpleOrthogonalViewer, LayerControlPanel } from 'neuroimjs/browser'
import type { LayerControlName, LayerControlState } from 'neuroimjs/browser'

const viewer = await SimpleOrthogonalViewer.create(viewerEl, stack, { layout: 'left-tall' })

const panel = document.querySelector('layer-control-panel') as LayerControlPanel
panel.viewer = viewer      // updates go through viewer.updateLayer (cache + redraw)
panel.volStack = stack     // the panel reads layers and values from the stack
await panel.updateComplete
panel.selectLayer('z-stat')
```

The panel is driven entirely by **properties**, not attributes: `volStack`, `viewer` and friends are objects, so set them from script (or with your framework's property binding). On binding it selects the first layer of the stack; call `selectLayer` to start elsewhere. `updateComplete` (standard Lit) resolves after the panel has read the stack.

### Properties

| Property | Type | Purpose |
|---|---|---|
| `volStack` | `VolStack \| undefined` | The layers to control. Required (or `imageLayer`). |
| `imageLayer` | `ImageLayer \| undefined` | Alternative source: the panel uses `imageLayer.getVolStack()`. Use with a `SingleSliceViewer`: `panel.imageLayer = axial.getImageLayer() ?? undefined` (`getImageLayer()` returns `ImageLayer \| null`). |
| `viewer` | `any` (duck-typed) | Optional; not type-checked, so any object is accepted. If it has an `updateLayer` method (`SimpleOrthogonalViewer`), edits go through `viewer.updateLayer`; otherwise, if it has `applyToImageLayers` (`OrthogonalImageViewer`), through that plus a redraw of each `getSliceViewer(view)`. Leave unset for [composable views](/guide/composable-views#a-layer-panel-for-composable-views), which re-render from the shared `VolLayer`s by themselves. |
| `visibleControls` | `LayerControlName[] \| null` | Show a subset of `'layer'`, `'visibility'`, `'colormap'`, `'range'`, `'threshold'`, `'opacity'`. `null` (default) shows everything. Programmatic state is always complete. |

The layer selector appears only when the stack has more than one layer. The panel snapshots the layer list when `volStack` (or `imageLayer`) is assigned; after adding or removing layers, re-assign it:

```ts
import { VolLayer, ColorMapFactory } from 'neuroimjs/browser'

viewer.addLayer(new VolLayer('mask', statVol, ColorMapFactory.fromPreset('Greens', { range: [0, 1] }), [0, 1]))

panel.volStack = undefined   // the panel snapshots the layer list on binding;
panel.volStack = stack       // re-assign to pick up added or removed layers
```

Re-binding selects the first layer again; per-layer reset defaults already captured are kept.

A compact, threshold-only panel created from script:

```ts
const panel = document.createElement('layer-control-panel') as LayerControlPanel
panel.setAttribute('theme', 'dark')
panel.visibleControls = ['threshold', 'opacity'] satisfies LayerControlName[]
document.querySelector('aside')!.append(panel)
panel.viewer = viewer
panel.volStack = stack
```

### What the controls do

- **Colormap**: a select over the built-in presets, with a gradient swatch. A layer whose colormap is not a preset keeps it until you pick another.
- **Range**: the display window, as a dual slider plus numeric fields. When the data straddle zero the slider domain is symmetric (±max |value|).
- **Threshold**: the *hidden band* — values strictly between low and high are transparent ("Values between low and high are hidden"). A link toggle keeps it symmetric (`low = −high`); it starts on when the data span zero and the threshold is already symmetric, as for a z-map at `[-2.3, 2.3]`. Keep layer thresholds **finite**: for a one-sided overlay use `[zMin - 1, cutoff]`, not `[-Infinity, cutoff]` (see [Thresholds](/guide/colormaps#thresholds)). A layer with an infinite bound shows a blank field, and `applyState` and **Reset** throw for it.
- **Opacity**: 0–1.
- **Visibility** checkbox and a **Reset** button that restores the values captured when the panel was bound.

Numeric fields accept `-`, the Unicode minus `−` and an en dash as signs, and display negatives with `−`.

### Methods

```ts
panel.selectLayer('z-stat')
const s: LayerControlState = panel.getState()
// { layerId: 'z-stat', range: [-5, 5], threshold: [-2.3, 2.3], colormap: 'BlueRed', opacity: 0.85, visible: true }

panel.applyState({ threshold: [-3.1, 3.1], opacity: 0.7 })          // selected layer
panel.applyState({ layerId: 'T1w', range: [0, 800] })               // any layer (also selects it)

panel.resetToDefaults()               // back to the values captured at binding time
panel.setDefaultsFromCurrent('z-stat') // make the current state the new baseline
```

| Method | Behaviour |
|---|---|
| `selectLayer(id)` | Point the controls at a layer. Throws for an unknown id. |
| `getState(id?)` | Detached `LayerControlState` snapshot (`layerId`, `range`, `threshold`, `colormap`, `opacity`, `visible`) of the selected or named layer. |
| `applyState(partial)` | Selects `partial.layerId` (default: current), validates (finite increasing `range`, finite `threshold`, `opacity` in [0, 1], boolean `visible`; throws otherwise), applies through the same path as the widgets, emits `layer-control-change`, and returns the new state. Omitted fields keep their values; `colormap` is a preset name. |
| `resetToDefaults(id?)` | `applyState` with the defaults captured at binding time (or by `setDefaultsFromCurrent`). |
| `setDefaultsFromCurrent(id?)` | Make the layer's current state its reset baseline — e.g. after swapping the map behind a stable layer id. |

`getState` / `applyState` round-trip through JSON, so they are the natural way to persist panel state or sync it with a URL.

### Events

The panel dispatches one event, **`layer-control-change`**, with the new `LayerControlState` as `detail`. It bubbles and is `composed`, so it crosses shadow roots.

```ts
panel.addEventListener('layer-control-change', (e) => {
  const { layerId, range, threshold, colormap, opacity, visible } = (e as CustomEvent<LayerControlState>).detail
  history.replaceState(null, '', `#${layerId}=${threshold.join(',')}`)
})
```

It fires for every user edit (continuously while a slider is dragged — debounce expensive handlers) and for `applyState` / `resetToDefaults`. It does not fire for `selectLayer` or `setDefaultsFromCurrent`. The internal sliders also emit `range-update` events that bubble out of the panel; ignore them.

### Theming

The panel adopts the host page's palette through CSS custom properties, which inherit into its shadow DOM:

```css
layer-control-panel {
  --lcp-accent: #7c5cff;        /* active toggles, slider fill, focus */
  --lcp-ink: #1c2226;           /* primary text */
  --lcp-muted: #66717b;         /* labels, captions */
  --lcp-surface: #ffffff;       /* inputs, selects */
  --lcp-rule: #e2e5e6;          /* hairlines */
  --lcp-rule-strong: #c9cfd2;   /* input borders, inactive track */
  --lcp-bg: transparent;
  --lcp-pad: 0;
}
```

Other tokens: `--lcp-ink-2`, `--lcp-accent-soft`, `--lcp-thumb`, `--lcp-edge`, `--lcp-track-edge`, `--lcp-hatch`, `--lcp-shadow-color`, and the geometry tokens `--lcp-hit` (slider hit box), `--lcp-r` (thumb radius) and `--lcp-input-h`. Most colour tokens fall back to a matching `--nm-*` page token and then to a literal: `--lcp-ink`, `--lcp-ink-2`, `--lcp-muted`, `--lcp-rule`, `--lcp-rule-strong`, `--lcp-accent`, `--lcp-accent-soft` and `--lcp-surface` (and `--lcp-thumb`, which follows `--lcp-surface`), so a page that defines `--nm-ink`, `--nm-accent`, … gets a matching panel for free. `--lcp-bg`, `--lcp-shadow-color`, `--lcp-edge`, `--lcp-track-edge` and `--lcp-hatch` have literal defaults only. The `--nm-*` fallbacks apply to the light theme; `theme="dark"` uses literals.

Add `theme="dark"` for the built-in dark palette. On coarse pointers (touch) the hit targets grow automatically.

For structural tweaks, style the exposed parts with `::part()`: `panel`, `section` (plus one of `layer`, `colormap`, `range`, `threshold`, `opacity` on each section), `header`, `label`, `input`, `select`, `swatch`, `slider`, `link`, `caption`, `toggle`, `footer`, `reset`.

```css
layer-control-panel::part(label) { letter-spacing: 0; text-transform: none; }
layer-control-panel::part(section threshold) { padding-top: 8px; border-top: 1px solid #e2e5e6; }
layer-control-panel::part(reset) { display: none; }
```

The host is `display: block` and fills its container (`width: 100%; height: 100%`); size the container.

## Framework integration

The pattern is the same everywhere: render the element, then assign object properties and add event listeners from code once it exists. Dispose the viewer on unmount.

### Vue 3

Tell the template compiler the tag is a custom element (VitePress / `@vitejs/plugin-vue`):

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [
    vue({
      template: {
        compilerOptions: { isCustomElement: (tag) => tag === 'layer-control-panel' || tag === 'overlay-review-panel' },
      },
    }),
  ],
})
```

In VitePress the same `vue` options go under `vue:` in `.vitepress/config.ts`.

```vue
<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { SimpleOrthogonalViewer } from 'neuroimjs/browser'
import type { LayerControlPanel, LayerControlState } from 'neuroimjs/browser'

const stage = ref<HTMLElement | null>(null)
const panel = ref<LayerControlPanel | null>(null)
let viewer: SimpleOrthogonalViewer | undefined

onMounted(async () => {
  const stack = await buildStack()   // your loader: VolLayers -> VolStack
  viewer = await SimpleOrthogonalViewer.create(stage.value!, stack)
  panel.value!.viewer = viewer
  panel.value!.volStack = stack
})

onBeforeUnmount(() => viewer?.dispose())

function onChange(e: Event) {
  console.log((e as CustomEvent<LayerControlState>).detail)
}
</script>

<template>
  <div ref="stage" style="height: 520px" />
  <layer-control-panel ref="panel" @layer-control-change="onChange" />
</template>
```

Vue binds `@layer-control-change` to the DOM event directly. Do not make the viewer or stack deeply reactive (`ref(viewer)`): they are MobX/PIXI objects; keep them in plain variables or `shallowRef`.

### React

React 19 sets known properties on custom elements, but object props still arrive after mount and custom events need listeners, so use a ref for both (this works in React 18 too):

```tsx
import { useEffect, useRef } from 'react'
import { SimpleOrthogonalViewer } from 'neuroimjs/browser'
import type { LayerControlPanel, LayerControlState, VolStack } from 'neuroimjs/browser'

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'layer-control-panel': React.DetailedHTMLProps<React.HTMLAttributes<LayerControlPanel>, LayerControlPanel> & { theme?: 'dark' }
    }
  }
}

export function BrainPanel({ stack }: { stack: VolStack }) {
  const stageRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<LayerControlPanel>(null)

  useEffect(() => {
    const panel = panelRef.current!
    const onChange = (e: Event) => console.log((e as CustomEvent<LayerControlState>).detail)
    panel.addEventListener('layer-control-change', onChange)

    let viewer: SimpleOrthogonalViewer | undefined
    let cancelled = false
    SimpleOrthogonalViewer.create(stageRef.current!, stack).then((v) => {
      if (cancelled) return v.dispose()
      viewer = v
      panel.viewer = v
      panel.volStack = stack
    })

    return () => {
      cancelled = true
      panel.removeEventListener('layer-control-change', onChange)
      viewer?.dispose()
    }
  }, [stack])

  return (
    <div className="brain">
      <div ref={stageRef} style={{ height: 520 }} />
      <layer-control-panel ref={panelRef} theme="dark" />
    </div>
  )
}
```

The `cancelled` flag matters under React StrictMode, which mounts, unmounts and re-mounts effects in development: a viewer that finishes creating after its effect was cleaned up is disposed immediately.

::: warning One copy of the bundle
Custom-element names are global. Loading `neuroimjs/browser` twice (two bundles, or a micro-frontend that ships its own copy) throws on the second `customElements.define`, as does another library that defines `<range-slider>`.
:::

## Overlay review: SubjectOverlayViewer + OverlayReviewPanel

For quality control of first-level maps across subjects: browse one subject's map over a template, compare it with a group summary (mean, t, effect size, or the proportion of subjects exceeding a cutoff), and hold the current subject out of that summary to spot outliers. `examples/overlay-review-demo.html` in the repository is a complete page.

`SubjectOverlayViewer` wraps a `SimpleOrthogonalViewer` with three layers — `'template'`, `'active-subject'` and (on demand) `'summary'` — driven by an `OverlayReviewDataset`. All maps of a contrast are packed into one 4-D vector with `createReviewVecFromVolumes`, and must share the template's geometry.

```ts
import {
  SubjectOverlayViewer,
  OverlayReviewPanel,
  createReviewVecFromVolumes,
} from 'neuroimjs/browser'
import type { OverlayReviewDataset } from 'neuroimjs/browser'

const dataset: OverlayReviewDataset = {
  template: templateVol,
  subjects: memoryMaps.map((_, i) => ({ id: `sub-${String(i + 1).padStart(2, '0')}` })),
  contrasts: [
    { id: 'memory', label: 'Memory > Baseline', vec: createReviewVecFromVolumes(memoryMaps), displayRange: [-6, 6] },
    { id: 'faces', label: 'Faces > Shapes', vec: createReviewVecFromVolumes(faceMaps), displayRange: [-6, 6] },
  ],
}

const review = await SubjectOverlayViewer.create(viewerEl, dataset, {
  layout: 'left-tall',
  showOrientationLabels: true,
  subjectThreshold: [-3, 3],
  templateRange: [0, 115],
})

const panel = document.querySelector('overlay-review-panel') as OverlayReviewPanel
panel.setReviewViewer(review)
panel.setCutoff(3)
panel.setView('group')     // or 'subject'
panel.setReducer('tstat')  // 'mean' | 'tstat' | 'effect' | 'consistency'
```

`SubjectOverlayViewerOptions` accepts every `SimpleOrthogonalViewer` option plus `initialContrastId`, `initialSubjectIndex`, the layer ids (`templateLayerId`, `subjectLayerId`, `summaryLayerId`), and `templateColormap`, `templateRange`, `subjectColormap`, `subjectThreshold`, `subjectAlpha`. Call `setReviewViewer` (or assign `panel.viewer`) before any other panel method; they throw without a viewer.

The panel's UI covers contrast, view (subject / group summary), hold-out, reducer, cutoff, subject stepping and cine playback, with a value readout at the crosshair and a legend. The same operations are methods:

```ts
panel.setSubjectIndex(4)
panel.setHoldout(true)        // group summary without the current subject
panel.startCine()             // step through subjects at panel.cineFps
panel.stopCine()
panel.getPanelState()         // { view, holdout, mode, reducerId, subjectIndex, contrastId, cutoff, cinePlaying }
panel.getReadout()            // { voxel, subject, summary, consistentCount, validCount } | null

review.getViewer().setWorldCoord([-42, -58, -12])   // the underlying SimpleOrthogonalViewer
review.dispose()
```

Also: `setContrastId`, `setMode` (`'browse' | 'summary' | 'holdout'`, kept for compatibility), `stepSubject(±1)`, `toggleCine`, `refreshSummary`, `legendSpec()`. Properties: `reducers`, `cutoffMax` (default 10), `cineFps` (default 3), `summaryDebounceMs` (default 100; the consistency reducer is recomputed after this delay while you scrub). Cine is disabled for the consistency reducer in hold-out mode, where each step is a full recomputation.

Summaries are pluggable. A reducer receives the sufficient statistics of the included subjects (all of them, or all but the current one in hold-out mode):

```ts
import { standardDeviationVolume, DEFAULT_OVERLAY_REVIEW_REDUCERS } from 'neuroimjs/browser'
import type { OverlayReviewReducer } from 'neuroimjs/browser'

const sd: OverlayReviewReducer = {
  id: 'sd',
  label: 'SD',
  kind: 'signed',
  defaultRange: [0, 3],
  defaultThreshold: [0, 0],
  compute: ({ stats }) => standardDeviationVolume(stats),
}
panel.reducers = [...DEFAULT_OVERLAY_REVIEW_REDUCERS, sd]
panel.setReducer('sd')
```

The context also carries `vec`, `subjectIndices`, `cutoff`, `displayRange` and a cached `OverlaySummaryService`. Without `defaultThreshold`, a `'signed'` reducer is thresholded symmetrically at the cutoff.

`OverlayReviewPanel` dispatches no DOM events (observe the viewer, or poll `getPanelState()` after your own calls), and its styling is fixed: a light card 260–360 px wide, with no `::part()` or custom-property hooks.
