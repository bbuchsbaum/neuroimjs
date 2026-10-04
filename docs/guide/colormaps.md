# Colormaps & Layers

Color mapping and layer compositing turn raw intensities into a readable image. Both are <span class="stability-badge stable">stable</span> parts of the viewer stack.

## Colormaps

`ColorMapFactory` builds `ColorMap` objects from built-in maps, named presets, or custom stops. Every factory takes an optional config with `range` (the display window), `threshold`, and `alpha`.

```ts
import { ColorMapFactory } from 'neuroimjs/browser'

// Built-in maps
const gray = ColorMapFactory.createGrayscale({ range: [0, 1000] })
const hot  = ColorMapFactory.createHot({ range: [3, 8] })   // black → red → yellow → white

// Diverging — (negative, neutral, positive, steps?, config?) — for signed stats
const div = ColorMapFactory.createDiverging('#2166ac', '#ffffff', '#b2182b', 256, { range: [-5, 5] })

// Named preset — names are case-sensitive
const viridis = ColorMapFactory.fromPreset('Viridis', { range: [0, 1] })

// Custom — from a list of colors…
const custom = ColorMapFactory.fromColors(['#000', '#7c5cff', '#22d3ee'], { range: [0, 1] })

// …an interpolated multi-stop scale — (colorStops, steps?, config?)
const banded = ColorMapFactory.createMultiStop(['#000000', '#7c5cff', '#22d3ee'], 256, { range: [0, 1] })

// …or a two-color gradient — (start, end, steps?, config?)
const reds = ColorMapFactory.createGradient('#000000', '#ff0000', 256, { range: [0, 1] })

// Labels: n distinct colors, range defaults to [0, n − 1]
const labels = ColorMapFactory.createCategorical(12)
```

`fromPreset` names are **case-sensitive** and throw on a miss: `fromPreset('viridis')` → `Error: Unknown preset: viridis`. `'hot'` is not a preset — use `createHot`. The full list:

```ts
ColorMapFactory.getAvailablePresets()
// ['OrRd', 'PuBu', 'BuPu', 'Oranges', 'BuGn', 'YlOrBr', 'YlGn', 'Reds', 'RdPu', 'Greens',
//  'YlGnBu', 'Purples', 'GnBu', 'Greys', 'YlOrRd', 'PuRd', 'Blues', 'PuBuGn', 'Viridis',
//  'Spectral', 'RdYlGn', 'RdBu', 'PiYG', 'PRGn', 'RdYlBu', 'BrBG', 'RdGy', 'PuOr', 'Set2',
//  'Accent', 'Set1', 'Set3', 'Dark2', 'Paired', 'Pastel2', 'Pastel1',
//  'BlueRed', 'Inferno', 'Grayscale']
```

These are the ColorBrewer scales plus `Viridis`, `BlueRed` (reversed `RdBu`), `Inferno`, and `Grayscale`. Where a viewer method accepts a colormap **name** as a string (e.g. `SimpleOrthogonalViewer.updateLayer`), matching is case-insensitive, `'hot'` and `'gray'`/`'grey'` are accepted, and an unknown name silently falls back to grayscale.

::: tip NaN voxels
Non-finite voxels (`NaN`, `Infinity`, `-Infinity`) render as fully transparent pixels. They are treated as no-data values before color lookup, so they do not appear as opaque black.
:::

## Thresholds

A threshold `[low, high]` hides voxels **strictly inside** the interval; values `<= low` or `>= high` are drawn. `[0, 0]` (the default) disables thresholding, and `low > high` is rejected (reset to `[0, 0]`).

| Goal | Threshold | Shown |
|---|---|---|
| Two-sided z map | `[-2.3, 2.3]` | `z <= -2.3` and `z >= 2.3` |
| Positive only | `[zMin - 1, 3.1]` | `z >= 3.1` |
| Negative only | `[-3.1, zMax + 1]` | `z <= -3.1` |

Checked against the rendered alpha channel: with `[-2.3, 2.3]`, the values `-4, -2.3, -1, 0, 2, 2.3, 4, NaN` come out opaque, opaque, hidden, hidden, hidden, opaque, opaque, hidden. Note that `[3.1, 8]` does **not** mean “show 3.1 to 8” — it hides everything between 3.1 and 8.

For a one-sided threshold, take the open end from the data, and put it **strictly beyond** the data:

```ts
const [zMin, zMax] = zVol.getRange()        // finite min/max; NaN voxels are skipped
const positiveOnly: [number, number] = [zMin - 1, 3.1]
const negativeOnly: [number, number] = [-3.1, zMax + 1]
```

The margin matters because the band is open: a voxel *equal* to `low` is drawn. `[zMin, 3.1]` would draw the minimum voxels, and for a map that is `0` everywhere outside the brain (min `0`) that is the whole background, painted in the colormap's bottom colour. Keep both bounds finite, too. The renderer accepts `±Infinity`, but the [layer control panel](/guide/controls#what-the-controls-do) does not: once a layer's threshold is infinite, `applyState` and the panel's **Reset** throw for that layer (`applyState` validates the current threshold even when you don't pass one), and `JSON.stringify` (e.g. persisting `viewer.getState()`) turns `±Infinity` into `null`.

## Layers

A `VolLayer` binds a volume to a colormap, a display range, a threshold, and an opacity; a `VolStack` composites layers bottom-to-top.

```ts
import { VolLayer, VolStack, ColorMapFactory } from 'neuroimjs/browser'

// Anatomical base — (id, volume, colormap, range?, threshold?, opacity?)
const base = new VolLayer('t1', t1Vol, ColorMapFactory.createGrayscale(), t1Range)

// Positive z overlay: window 3–8, hide everything below 3.1, 80 % opacity
const [zMin] = zVol.getRange()
const overlay = new VolLayer('zmap', zVol, ColorMapFactory.createHot(), [3, 8], [zMin - 1, 3.1], 0.8)

const stack = new VolStack(base, overlay)
```

`VolLayer` owns range and threshold: its constructor pushes its own values into the colormap, overriding whatever the colormap config said. A colormap `range` is replaced by the layer's `range` argument, or by the volume's full `getRange()` if you omit it; a colormap `threshold` is replaced by the layer's `threshold`, or by `[0, 0]` (no threshold) if you omit it. Set them on the layer.

Then feed the stack to any viewer:

```ts
import { SimpleOrthogonalViewer } from 'neuroimjs/browser'

const viewer = await SimpleOrthogonalViewer.create(container, stack, { showCrosshair: true })
```

### Changing display settings

Don't assign `layer.range`, `layer.threshold` or `layer.opacity` directly — that updates the field but not the colormap or the cached slices, so nothing re-renders correctly. Use the setters. They work before a viewer exists and on a live one: each setter updates the colormap and bumps the layer's texture version, and every view built on the stack re-renders by itself. That includes all three views of a `SimpleOrthogonalViewer` (its per-view image layers share the stack's `VolLayer` objects) and any set of [composable views](/guide/composable-views#a-layer-panel-for-composable-views).

```ts
overlay.setRange([4, 9])
overlay.setThreshold([zMin - 1, 4])
overlay.setOpacity(0.5)
overlay.setColormap(ColorMapFactory.fromPreset('Inferno'))
overlay.setVisible(true)

// Or, on a SimpleOrthogonalViewer, one call by layer id; colormap may be a name
viewer.updateLayer('zmap', { range: [4, 9], threshold: [zMin - 1, 4], alpha: 0.5, colormap: 'inferno' })
```

`updateLayer` is the convenience path: one call, colormap *names* (case-insensitive; unknown names fall back to grayscale), and it frees the layer's superseded textures immediately rather than leaving them to the texture cache's eviction.

## Choosing a colormap

| Data | Suggested map |
|---|---|
| Anatomical (T1/T2) | `createGrayscale` |
| Positive stats (z, t, F) | `createHot` with threshold `[min − 1, cutoff]` (finite, below the data minimum; see [Thresholds](#thresholds)) |
| Signed contrasts | `createDiverging` or `fromPreset('BlueRed')` with threshold `[-cutoff, cutoff]` |
| Labels / parcellations | `createCategorical` |
| Continuous, perceptual | `fromPreset('Viridis')` or `fromPreset('Inferno')` |
