# Multi-Layer Alignment

A `VolStack` can hold layers on different voxel grids, for example a 2 mm statistical map over a 1 mm template. This page explains how the viewers place such layers and how to choose the behaviour.

## The reference layer

Layer 0 of the stack is the **reference**. It fixes the slice index, the image space of each view, the crosshair and navigation. A layer on the same grid as the reference (same dimensions, spacing and origin) simply shares its transform; alignment only matters for layers on other grids.

## Strategies

| Strategy | What it does |
|---|---|
| `'world'` (default) | Slices each layer on its **own** grid, at the plane nearest the reference plane, and draws it at its true world position. Where the reference plane falls outside the layer's slab, the layer is not drawn. This applies when the layer's grid is an axis-aligned rescaling or shift of the reference grid; any other layer falls back to `'auto'`. |
| `'auto'` | Picks one of the three heuristics below per layer. This was the default before 0.5.0. |
| `'center'` | Fits the layer's slice to the reference slice, aligning their centres. |
| `'corner'` | Fits the layer's slice to the reference slice, aligning their corners. |
| `'overlap'` | Fits the layer's slice to the reference slice to maximise overlap. |

The three heuristics reuse the reference slice index for every layer and fit slice bounds rather than world positions, so an overlay on a different grid can be drawn at the wrong anatomical position. Use them only to reproduce pre-0.5 behaviour or for data whose affines you do not trust.

## Choosing a strategy

```ts
import { SimpleOrthogonalViewer } from 'neuroimjs/browser'

// At construction (applies to all three views)
const viewer = await SimpleOrthogonalViewer.create(container, stack, {
  alignmentStrategy: 'world',
})

// Later, without rebuilding the viewer
viewer.setAlignmentStrategy('auto')
```

Lower-level code that builds an `ImageLayer` directly passes the strategy in its alignment options and can change it with `setAlignmentStrategy`:

```ts
import { ImageLayer } from 'neuroimjs/browser'

const imageLayer = new ImageLayer(stack, { strategy: 'world' })
imageLayer.setAlignmentStrategy('center')
```

`AlignmentStrategyType` and `AlignmentManagerOptions` are exported as types.

## Checklist for overlays

1. **Check the geometry.** `getVolumeGeometry(vol)` shows each volume's dimensions, spacing, origin, orientation and affine. Layers drawn by `'world'` must share the reference's world frame (the same scanner or template space).
2. **Put the finest grid first.** Layer 0 sets the slice positions and the image resolution, so a high-resolution anatomical underlay makes a good reference.
3. **Expect gaps at the edges.** With `'world'`, an overlay with a smaller field of view is drawn only where it has data.
4. **Same grid required?** If your pipeline expects identical grids, call `assertSameVolumeGeometry(reference, overlay)` before building the stack so a mismatch fails loudly.
