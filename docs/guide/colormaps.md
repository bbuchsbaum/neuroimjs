# Colormaps & Layers

Color mapping and layer compositing turn raw intensities into a readable image. Both are <span class="stability-badge stable">stable</span> parts of the viewer stack.

## Colormaps

`ColorMapFactory` builds `ColorMap` objects from presets or custom stops.

```ts
import { ColorMapFactory } from 'neuroimjs'

// Built-in presets — config carries the display range
const gray = ColorMapFactory.createGrayscale({ range: [0, 1000] })
const hot  = ColorMapFactory.createHot({ range: [3, 8] })

// Diverging — (negative, neutral, positive, steps?, config?) — for signed stats
const div = ColorMapFactory.createDiverging('#2166ac', '#ffffff', '#b2182b', 256, { range: [-5, 5] })

// From a named preset
const viridis = ColorMapFactory.fromPreset('viridis', { range: [0, 1] })

// Custom — from a list of colors…
const custom = ColorMapFactory.fromColors(['#000', '#7c5cff', '#22d3ee'], { range: [0, 1] })

// …or an interpolated multi-stop scale — (colorStops, steps?, config?)
const banded = ColorMapFactory.createMultiStop(
  ['#000000', '#7c5cff', '#22d3ee'],
  256,
  { range: [0, 1] },
)
```

List everything available:

```ts
ColorMapFactory.getAvailablePresets()   // ['grayscale', 'hot', 'viridis', …]
```

::: tip NaN voxels
Non-finite voxels (`NaN`, `Infinity`, `-Infinity`) render as fully transparent pixels. They are treated as no-data values before color lookup, so they do not appear as opaque black.
:::

## Layers

A `VolLayer` binds a volume to a colormap and a display range; a `VolStack` composites layers bottom-to-top.

```ts
import { VolLayer, VolStack, ColorMapFactory } from 'neuroimjs'

// Anatomical base
const base = new VolLayer('t1', t1Vol, ColorMapFactory.createGrayscale({ range: t1Range }), t1Range)

// Stat overlay
const overlay = new VolLayer('zmap', zVol, ColorMapFactory.createHot({ range: [3, 8] }), [3, 8])

const stack = new VolStack(base, overlay)
```

### Thresholding & opacity

Each `VolLayer` exposes observable rendering parameters — `range` (the display window `[min, max]`), `threshold` (`[low, high]` mask), and `opacity` — so you can show only suprathreshold voxels of an overlay above an anatomical underlay.

```ts
overlay.range = [3, 8]            // display window
overlay.threshold = [3.1, 8]     // voxels outside this range become transparent
overlay.opacity = 0.8            // blend over the layer beneath
```

Then feed the stack to any viewer:

```ts
await SimpleOrthogonalViewer.create(container, stack, { showCrosshair: true })
```

## Choosing a colormap

| Data | Suggested map |
|---|---|
| Anatomical (T1/T2) | `createGrayscale` |
| Positive stats (z, t, F) | `createHot` |
| Signed contrasts | `createDiverging` |
| Labels / parcellations | `createCategorical` |
| Continuous, perceptual | `fromPreset('viridis')` |
