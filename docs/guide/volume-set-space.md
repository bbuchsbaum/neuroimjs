<script setup>
import { withBase } from 'vitepress'
</script>

# Compare subject maps in Space

Space places aligned subject maps by their whole-volume spatial similarity and
draws each one as a slice. Use it to inspect an unusual subject, compare patterns,
and move from a set overview into one subject's orthogonal views.

<a :href="withBase('/space/?mode=space')">Open the synthetic Space demo</a>.
The demo generates 17 fictional subjects and three contrasts. It includes a
sign-flipped map, an outlier, identical patterns, and maps with missing coverage.
It contains no participant data; its synthetic fixtures load from the same site.

The supported `neuroimjs/space` API embeds this integrated viewer in an HTML page
or report. Each viewer uses an isolated iframe, so its styles, keyboard handling,
and navigation do not change the surrounding report. Multiple viewers can run
independently. The underlying analysis modules remain internal.

## Embed in a page or report

Install `neuroimjs`, then copy the packaged frame directory into your site's
public assets. Copy the whole directory: it contains the app and its workers.
From your project's directory:

```bash
node --input-type=module -e '
import { cpSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
cpSync(dirname(fileURLToPath(import.meta.resolve("neuroimjs/space/frame/index.html"))),
  "public/neuroimjs-space", { recursive: true });
'
```

Serve the page and these assets from the **same origin over HTTP or HTTPS**.
The frame files must come from the same package version as `mountSpace`.
Direct `file://` viewing and a single self-contained HTML file are not supported
by this API. No hosted service is required; a local web server works.

Give the viewer a sized container:

```html
<div id="subject-maps" style="height: 720px; width: 100%"></div>
```

This complete JavaScript example supplies four synthetic maps. Replace the
generated arrays with your data, keeping the shared grid and x-fastest indexing
(`i + nx * (j + ny * k)`). Bundle this module with your application's usual tool.

```ts
import { mountSpace, type SpaceDataset } from 'neuroimjs/space';

const dimensions = [8, 8, 8] as const;
const size = 8 * 8 * 8;
const data: SpaceDataset = {
  id: 'report-maps',
  grid: {
    dimensions,
    affine: [[2, 0, 0, -8], [0, 2, 0, -8], [0, 0, 2, -8], [0, 0, 0, 1]],
  },
  template: Float32Array.from({ length: size }, (_, g) => 50 + g % 8),
  mask: new Uint8Array(size).fill(1),
  members: Array.from({ length: 4 }, (_, m) => ({
    id: `map-${m}`, subject: `s${m}`, model: 'glm', contrast: 'cue',
    t: Float32Array.from({ length: size }, (_, g) =>
      3 * Math.sin((g % 8) / 2 + m) + Math.cos(Math.floor(g / 8) / 3)),
  })),
};

const viewer = mountSpace(document.querySelector<HTMLElement>('#subject-maps')!, {
  assetBaseUrl: '/neuroimjs-space/',
  data,
  initialState: { mode: 'space', model: 'glm', contrast: 'cue', statistic: 't' },
});
await viewer.ready;
await viewer.setState({ selectedMemberId: 'map-1', worldCoord: [0, 0, 0] });
const unsubscribe = viewer.on('statechange', ({ state }) => {
  console.log(state.selectedMemberId, state.worldCoord);
});
// When removing the report panel:
// unsubscribe();
// viewer.dispose();
```

### Data and geometry contract

All maps, the anatomical template, mask, and optional atlas must share one grid.
The current API accepts **axis-aligned RAS+** geometry with positive voxel sizes
and arbitrary finite translation. It rejects flipped, permuted, oblique, and
sheared affines; resample those inputs into a common supported grid first.

`template` and map arrays are full-grid `Float32Array`s; `mask` is a full-grid
`Uint8Array`. Each member supplies `t`, `beta`, or both. Every subject in a given
model/contrast must share at least one statistic. Optional `se` arrays supply
standard errors for beta-based noise calculations. Missing map values may be
`NaN`; infinities are rejected. The template must be finite and the mask nonempty.
An analysis with no finite, nonzero map values inside the mask cannot be opened.

IDs use letters, digits, `.`, `_`, or `-`, begin with a letter or digit, and are
at most 128 characters. Each member ID and model/contrast/subject combination
must be unique. Optional atlas labels are an `Int32Array` with a region table;
optional covariates are subject records of numbers, strings, or `null`.

The API copies input arrays when submitted. It does not detach or mutate your
buffers. Optional analyses show availability based on the supplied arrays;
embedded viewers do not fetch the demonstration dataset or external fonts.

### State and lifetime

| Operation | Contract |
|---|---|
| `ready` | Resolves after the supplied data and initial view are usable; rejects on startup failure. |
| `setState(patch)` | Applies a validated partial state and returns its snapshot. Background fitting can continue afterward. |
| `getState()` | Returns a copy of the current supported state. |
| `setData(data, initialState?)` | Loads a fresh isolated frame, replacing the current one after startup succeeds. A failed replacement leaves the current view usable. |
| `on(event, callback)` | Subscribes to `statechange`, `statuschange`, or `error`; returns an unsubscribe function. Events carry the dataset revision. |
| `dispose()` | Removes the frame, ends its workers, and rejects pending work with `AbortError`. Calling it again is harmless. |

State version 1 covers view mode, model, contrast, statistic, focused member ID,
world cursor, orientation, threshold, and colour range. The cursor uses
voxel-centre positions: a supplied world coordinate snaps to the
nearest in-grid voxel and snapshots report that voxel's world coordinate.
Advanced Space options
such as lasso selection, comparison overlays, and layout zoom remain local to
the viewer and are not part of this snapshot. `statuschange` distinguishes
loading and fitting from readiness. Keep the containing element at a nonzero
size, and call `dispose()` when removing it from your application.

## Inspect one subject

1. Open **Space** and choose a contrast and statistic. A position compares the
   whole map; changing the displayed slice leaves the fitted positions fixed.
2. Click a subject ID to focus it. Click its picture to place the shared cursor
   and open a larger **peek**. The peek has its own orientation and slice.
3. Press **Enter** or choose **Open in Ortho** to inspect the focused subject in
   three planes. Arrow keys step through subjects while retaining the cursor.
4. Return to Space with **Back** or **Esc**. The focused subject, cursor, and
   layout viewport are retained.

Montage, Facet, Space, and Ortho share the subject selection, cursor, colour
range, threshold, and display filters. In the standalone demo, copying the URL
preserves the view and its controls; it does not copy or upload the underlying
data. Embedded viewers use the state API and leave the report URL unchanged.

## Read the layout

The default comparison is signed Pearson correlation on common finite voxels
inside the analysis mask. NMDS approximates the rank order of `1 − r` in two
dimensions. Maps with insufficient coverage or constant values are listed as
**not placed** and remain available for inspection.

Nearby pictures suggest similar patterns, but inspect the neighbour table and
fit diagnostics before drawing conclusions. Pictures may be moved apart for
legibility; position marks and connecting lines show their fitted anchors.
Thresholding, smoothing, and cluster filtering affect the pictures, not the
raw similarity calculation.

- **Compare** shows where two standardized maps agree or disagree.
- **Explain** summarizes voxel and parcel contributions to the displayed
  dissimilarity. Focus a map to inspect its unusual parcel contributions.
- **Reliability** estimates how measurement noise affects pattern comparisons
  when beta and standard-error maps are available. Noise correction is optional
  and assumes calibrated standard errors.
- **Group** selects maps for descriptive mean and difference views.

The axes have no anatomical meaning. Distances, apparent clusters, Explain
maps, and stability clouds do not establish significant differences or subject
subtypes. Correlation ignores amplitude, and a beta-map layout can differ from
a t-map layout. A spherical region can restrict the comparison explicitly;
moving the cursor alone never refits it.

## Run locally

From a source checkout:

```bash
npm ci
npm run demo:volume-set:synthetic
```

Open the local address printed by Vite, then select Space. This development
demo also provides 50- and 200-map synthetic sets for inspecting denser layouts.

For your own maps, follow the
[volume-set setup guide](https://github.com/bbuchsbaum/neuroimjs/blob/main/examples/volume-set/README.md).
The current loader expects its documented model/subject directory layout and
MNI152NLin2009cAsym 2 mm grid. It does not resample arbitrary input grids.
Keep private data local; the documentation build always uses generated data.

The setup guide also documents keyboard controls, URL parameters, the exact
similarity policy, and limitations of the optional analyses.
