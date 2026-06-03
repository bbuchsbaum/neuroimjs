# Composable Views

When `SimpleOrthogonalViewer` isn't flexible enough — you want planes in separate panels, across windows, or wired into your own UI — drop down to **`SingleSliceViewer`** and connect them with **`ViewSynchronizer`**.

## Why composable views?

- 🎯 Place each plane anywhere in a custom layout (CSS Grid, flex, separate panels).
- 🔗 Wire views across different windows or applications.
- ⚙️ Full control over *how* views synchronize (click vs hover, which axes).
- 📡 Type-safe, event-driven coordination.

## A single view

```ts
import { SingleSliceViewer } from 'neuroimjs'

const axial = await SingleSliceViewer.createAxial(container, stack, {
  showCrosshair: true,
  showSlider: true,
  width: 512,
  height: 512,
})
```

There are matching factories `createSagittal` and `createCoronal`, plus a general `create` for arbitrary orientations.

### Events

```ts
axial.onCoordChange((coord) => { /* [x,y,z] mm */ })
axial.onSliceChange((index) => { /* slice changed */ })
axial.onPointerMove(({ imageCoord, worldCoord }) => {
  // imageCoord: pixel in the slice (or null outside)
  // worldCoord: anatomical mm (or null outside)
})

axial.setCrosshairVisible(false)
axial.setCoord([0, -18, 20])
const c = axial.getCurrentCoord()
```

## Synchronizing views

Create three independent views, then synchronize them into a linked orthogonal set:

```ts
import { SingleSliceViewer, ViewSynchronizer } from 'neuroimjs'

const axial    = await SingleSliceViewer.createAxial(axialEl, stack)
const sagittal = await SingleSliceViewer.createSagittal(sagEl, stack)
const coronal  = await SingleSliceViewer.createCoronal(corEl, stack)

const sync = ViewSynchronizer.createOrthogonal(axial, sagittal, coronal)
```

Now moving the crosshair in any view updates the others. Because the views are plain objects you own, you can lay them out however you like:

```html
<div class="grid">
  <div id="axial"></div>
  <div id="sagittal"></div>
  <div id="coronal"></div>
  <aside id="readout">…your own coordinate panel…</aside>
</div>
```

## Custom view sets

`ViewSynchronizer.fromViews` accepts any named set of views, so you can synchronize, say, two axial views of different subjects for comparison:

```ts
const sync = ViewSynchronizer.fromViews({ left: subjA, right: subjB })
```

## Patterns

- **Side-by-side comparison** — two synchronized axials of pre/post or two subjects.
- **Dashboard embedding** — one plane in a corner of a larger app, driven programmatically via `setCoord`.
- **Cross-window** — forward `onCoordChange` over `postMessage` to mirror a view in a popout.

This is the layer external applications should build on for anything beyond the stock 3-up layout.
