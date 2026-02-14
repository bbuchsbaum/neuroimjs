# Migration to Composable Views

This guide helps you migrate from `SimpleOrthogonalViewer` or `OrthogonalImageViewer` to the new composable views API when you need custom layouts.

## Should You Migrate?

**Keep using SimpleOrthogonalViewer if:**
- ✅ You're happy with the standard 3-view layout
- ✅ You don't need custom panel arrangements
- ✅ Your application doesn't require complex view coordination

**Consider migrating to composable views if:**
- 🎯 You need custom panel layouts or arrangements
- 🔗 You want to place views in different windows or applications
- ⚙️ You need fine-grained control over synchronization
- 📡 You want to integrate views with your own event system
- 🎨 You need non-standard view combinations (e.g., two axial views)

## No Breaking Changes

**Important:** The new composable views API is **purely additive**. All existing code continues to work:

```typescript
// This still works exactly as before
const viewer = await SimpleOrthogonalViewer.create(container, volStack);
```

You only need to migrate if you want to use the new features.

## Migration Examples

### Example 1: Standard 3-View Layout

#### Before (SimpleOrthogonalViewer)

```typescript
import { VolStack, SimpleOrthogonalViewer } from 'neuroimjs';

const volStack = await VolStack.fromNifti('brain.nii.gz');

const viewer = await SimpleOrthogonalViewer.create(
  document.getElementById('viewer-container'),
  volStack,
  {
    layout: 'left-tall',
    showCrosshair: true,
    showSlider: true
  }
);

// Listen to events
viewer.onCoordChange(coord => {
  console.log('Coordinate:', coord);
});
```

#### After (Composable Views)

```typescript
import { VolStack, SingleSliceViewer, ViewSynchronizer } from 'neuroimjs';

const volStack = await VolStack.fromNifti('brain.nii.gz');

// Create three separate views
const axial = await SingleSliceViewer.createAxial(
  document.getElementById('axial-panel'),
  volStack,
  { showCrosshair: true, showSlider: true }
);

const sagittal = await SingleSliceViewer.createSagittal(
  document.getElementById('sagittal-panel'),
  volStack,
  { showCrosshair: true, showSlider: true }
);

const coronal = await SingleSliceViewer.createCoronal(
  document.getElementById('coronal-panel'),
  volStack,
  { showCrosshair: true, showSlider: true }
);

// Synchronize them
const sync = ViewSynchronizer.createOrthogonal(
  axial,
  sagittal,
  coronal
);

// Listen to events (per view)
axial.onCoordChange(coord => {
  console.log('Coordinate:', coord);
});
```

**Key Differences:**
- You create views individually instead of all at once
- You explicitly synchronize them with `ViewSynchronizer`
- You have separate containers for each view
- Events are per-view instead of global

**Benefits:**
- Full control over layout (use any CSS)
- Can disable synchronization at runtime
- Can add/remove views dynamically
- Each view can have independent settings

---

### Example 2: Two-View Layout (Not Possible Before)

#### New Capability

```typescript
// Create just two views (couldn't do this easily before!)
const axial = await SingleSliceViewer.createAxial(leftPanel, volStack);
const sagittal = await SingleSliceViewer.createSagittal(rightPanel, volStack);

const sync = new ViewSynchronizer({ syncOnHover: false });
sync.addView('axial', axial);
sync.addView('sagittal', sagittal);
```

---

### Example 3: Custom Panel Layout

#### Before (Not Possible)

With `SimpleOrthogonalViewer`, you were limited to two layout options: `'left-tall'` or `'top-bottom'`.

#### After (Fully Customizable)

```html
<style>
  .viewer-grid {
    display: grid;
    grid-template-columns: 2fr 1fr;
    grid-template-rows: 2fr 1fr;
    gap: 10px;
    height: 100vh;
  }

  .axial-large {
    grid-row: 1 / 3; /* Span two rows */
  }
</style>

<div class="viewer-grid">
  <div id="axial" class="axial-large"></div>
  <div id="sagittal"></div>
  <div id="coronal"></div>
</div>
```

```typescript
// Create views in custom layout
const axial = await SingleSliceViewer.createAxial(
  document.getElementById('axial'),
  volStack
);

const sagittal = await SingleSliceViewer.createSagittal(
  document.getElementById('sagittal'),
  volStack
);

const coronal = await SingleSliceViewer.createCoronal(
  document.getElementById('coronal'),
  volStack
);

const sync = ViewSynchronizer.createOrthogonal(axial, sagittal, coronal);
```

---

### Example 4: Controlling Synchronization

#### Before (Always Synchronized)

```typescript
const viewer = await SimpleOrthogonalViewer.create(container, volStack);

// All three views are always synchronized
// No way to disable this
```

#### After (Full Control)

```typescript
const axial = await SingleSliceViewer.createAxial(panel1, volStack);
const sagittal = await SingleSliceViewer.createSagittal(panel2, volStack);

const sync = new ViewSynchronizer({ syncOnHover: false });
sync.addView('axial', axial);
sync.addView('sagittal', sagittal);

// Toggle synchronization on/off
document.getElementById('sync-toggle').addEventListener('click', () => {
  sync.toggle();
});

// Enable/disable programmatically
sync.disable(); // Views are now independent
sync.enable();  // Views are synchronized again
```

---

### Example 5: Event Handling

#### Before (Global Events)

```typescript
const viewer = await SimpleOrthogonalViewer.create(container, volStack);

viewer.onSliceChange(({ view, index }) => {
  console.log(`${view} view changed to slice ${index}`);
});

viewer.onCoordChange(coord => {
  console.log('Coordinate changed:', coord);
});
```

#### After (Per-View Events)

```typescript
const axial = await SingleSliceViewer.createAxial(panel, volStack);

// More granular event control
axial.onCoordChange(coord => {
  console.log('Axial coordinate:', coord);
});

axial.onSliceChange(index => {
  console.log('Axial slice:', index);
});

axial.onPointerMove(({ imageCoord, volumeCoord, worldCoord }) => {
  console.log('Mouse image position:', imageCoord);
  console.log('Mouse volume position:', volumeCoord);
  console.log('Mouse world position:', worldCoord);
});

axial.onPointerDown(({ worldCoord }) => {
  console.log('Clicked at:', worldCoord);
});
```

**Benefits:**
- Know which specific view triggered the event
- Access to more event types (pointerMove, pointerDown)
- Can handle events differently per view

---

### Example 6: Accessing Coordinate Information

#### Before

```typescript
const viewer = await SimpleOrthogonalViewer.create(container, volStack);

// Access through the internal OrthogonalImageViewer
const coord = viewer.getCurrentCoord();
```

#### After

```typescript
const axial = await SingleSliceViewer.createAxial(panel, volStack);

// Direct access
const coord = axial.getCurrentCoord();
const sliceIndex = axial.getCurrentSliceIndex();
const mouseImage = axial.getMouseImagePosition();
const mouseVolume = axial.getMouseVolumeCoordinate();
const mouseWorld = axial.getMouseWorldCoordinate();

// Access coordinate transformer
const transformer = axial.getCoordinateTransformer();
```

---

### Example 7: Dynamic View Management

#### Before (Static)

```typescript
// Cannot add/remove views after creation
const viewer = await SimpleOrthogonalViewer.create(container, volStack);
```

#### After (Dynamic)

```typescript
const sync = new ViewSynchronizer();

// Start with two views
const axial = await SingleSliceViewer.createAxial(panel1, volStack);
const sagittal = await SingleSliceViewer.createSagittal(panel2, volStack);

sync.addView('axial', axial);
sync.addView('sagittal', sagittal);

// Later, add a third view
const coronal = await SingleSliceViewer.createCoronal(panel3, volStack);
sync.addView('coronal', coronal);

// Remove a view
sync.removeView('sagittal');

// Check what views are active
console.log(sync.getViewIds()); // ['axial', 'coronal']
```

---

## API Mapping

### SimpleOrthogonalViewer → Composable Views

| SimpleOrthogonalViewer | Composable Views |
|------------------------|------------------|
| `SimpleOrthogonalViewer.create()` | `SingleSliceViewer.createAxial/Sagittal/Coronal()` + `ViewSynchronizer` |
| `viewer.onCoordChange()` | `viewer.onCoordChange()` (per view) |
| `viewer.onSliceChange()` | `viewer.onSliceChange()` (per view) |
| `viewer.getCurrentCoord()` | `viewer.getCurrentCoord()` |
| `viewer.setCoord()` | `viewer.setCoord()` or `sync.syncCoordinate()` |
| `layout: 'left-tall'` | Custom CSS layout |
| N/A (always synced) | `sync.enable()` / `sync.disable()` / `sync.toggle()` |
| N/A | `viewer.onPointerMove()` |
| N/A | `viewer.onPointerDown()` |
| N/A | `viewer.getCoordinateTransformer()` |
| N/A | `sync.addView()` / `sync.removeView()` |

---

## Step-by-Step Migration

### Step 1: Identify Your Layout Needs

Ask yourself:
- Do I need a custom layout? → Use composable views
- Do I need to control synchronization? → Use composable views
- Is the standard 3-view layout fine? → Keep using `SimpleOrthogonalViewer`

### Step 2: Plan Your HTML Structure

```html
<!-- Old: Single container -->
<div id="viewer"></div>

<!-- New: Separate containers -->
<div class="viewer-grid">
  <div id="axial-panel"></div>
  <div id="sagittal-panel"></div>
  <div id="coronal-panel"></div>
</div>
```

### Step 3: Update Your JavaScript

Replace:
```typescript
const viewer = await SimpleOrthogonalViewer.create(container, volStack);
```

With:
```typescript
const axial = await SingleSliceViewer.createAxial(axialPanel, volStack);
const sagittal = await SingleSliceViewer.createSagittal(sagPanel, volStack);
const coronal = await SingleSliceViewer.createCoronal(coronalPanel, volStack);
const sync = ViewSynchronizer.createOrthogonal(axial, sagittal, coronal);
```

### Step 4: Update Event Handlers

Replace global event handlers with per-view handlers:

```typescript
// Old
viewer.onCoordChange(coord => { /* ... */ });

// New
axial.onCoordChange(coord => { /* ... */ });
sagittal.onCoordChange(coord => { /* ... */ });
coronal.onCoordChange(coord => { /* ... */ });

// Or listen to the synchronizer if you only care about global changes
sync.syncCoordinate(coord); // This triggers all views
```

### Step 5: Test

1. Build your application
2. Verify all three views appear
3. Test that clicking in one view updates the others
4. Test your custom layout works as expected

---

## Common Pitfalls

### Pitfall 1: Forgetting to Create the Synchronizer

**Problem:**
```typescript
const axial = await SingleSliceViewer.createAxial(panel1, volStack);
const sagittal = await SingleSliceViewer.createSagittal(panel2, volStack);

// Views are created but NOT synchronized!
// Clicking in one view won't update the other
```

**Solution:**
```typescript
const sync = new ViewSynchronizer();
sync.addView('axial', axial);
sync.addView('sagittal', sagittal);
```

### Pitfall 2: Not Handling Resize Events

**Problem:**
```typescript
// Views created but don't resize with window
window.addEventListener('resize', () => {
  // Views don't automatically resize!
});
```

**Solution:**
```typescript
window.addEventListener('resize', () => {
  axial.handleResize();
  sagittal.handleResize();
  coronal.handleResize();
});
```

### Pitfall 3: Forgetting to Dispose

**Problem:**
```typescript
// When removing views, not cleaning up properly
// This causes memory leaks!
```

**Solution:**
```typescript
// When removing views
sync.removeView('axial');
axial.dispose();

// When destroying everything
sync.dispose();
axial.dispose();
sagittal.dispose();
coronal.dispose();
```

---

## Gradual Migration Strategy

You don't have to migrate everything at once:

### Phase 1: Keep Existing Code

```typescript
// Keep using SimpleOrthogonalViewer where it works
const mainViewer = await SimpleOrthogonalViewer.create(container, volStack);
```

### Phase 2: Add New Features with Composable Views

```typescript
// Add a separate single view using new API
const detailView = await SingleSliceViewer.createAxial(
  detailPanel,
  volStack,
  { showCrosshair: false }
);
```

### Phase 3: Gradually Replace

As you need more flexibility, replace `SimpleOrthogonalViewer` instances with composable views.

---

## When NOT to Migrate

**Don't migrate if:**
- The standard layout works for you
- You don't need custom layouts or synchronization control
- Your application is working fine and doesn't need new features
- You don't have time for testing

**Remember:** There are no breaking changes. You can keep using the old API indefinitely.

---

## Getting Help

If you encounter issues during migration:

1. Check the [Composable Views Guide](COMPOSABLE_VIEWS.md)
2. Look at the [examples](../examples/)
3. Review the [API Reference](COMPOSABLE_VIEWS.md#api-reference)
4. Open an issue on GitHub

---

## Summary

| Feature | SimpleOrthogonalViewer | Composable Views |
|---------|----------------------|------------------|
| **Setup Complexity** | Low (one call) | Medium (multiple calls) |
| **Flexibility** | Low (2 layouts) | High (infinite layouts) |
| **Sync Control** | None (always on) | Full (on/off, hover/click) |
| **Event Granularity** | View-specific | View-specific + more types |
| **Dynamic Views** | No | Yes |
| **Learning Curve** | Low | Medium |
| **Use Case** | Standard layouts | Custom applications |

Choose composable views when you need flexibility and control. Stick with `SimpleOrthogonalViewer` when simplicity is more important.
