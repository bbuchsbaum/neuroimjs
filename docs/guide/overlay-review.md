# Group Overlay Review

The overlay review tools are for quality-checking a group analysis: step through each subject's statistical map over a common template, compare it with the group, and spot subjects that disagree. <span class="stability-badge experimental">experimental</span>

There are three parts, usable separately:

| Piece | Entry point | Role |
|---|---|---|
| `OverlayReviewSession`, `createReviewVecFromVolumes` | both | Validated dataset: a template, one or more contrasts (one 4D vector each, subjects along the 4th axis), subject metadata, and the current subject and contrast. |
| `OverlaySummaryService` and the summary functions | both | Voxelwise group statistics: mean, standard deviation, effect size, one-sample t, leave-one-out versions, sign consistency, paired differences and Welch's t. |
| `SubjectOverlayViewer`, `<overlay-review-panel>` | `neuroimjs/browser` only | A `SimpleOrthogonalViewer` with template, subject and summary layers, and a Lit control panel to drive it. |

## Building a dataset

Each contrast holds one map per subject in a 4D vector. `createReviewVecFromVolumes` stacks 3D volumes into one; all of them, and the template, must be on the same grid (dimensions, axes and affine), or validation throws.

```ts
import {
  createReviewVecFromVolumes, OverlayReviewSession, OverlaySummaryService,
} from 'neuroimjs'

// template: a NeuroVol; facesMaps: one NeuroVol per subject, same grid
const dataset = {
  template,
  contrasts: [{ id: 'faces', label: 'Faces > Shapes', vec: createReviewVecFromVolumes(facesMaps) }],
  // optional: subjects: [{ id: 'sub-01', label: 'Subject 01', group: 'A' }, …]
}

const session = new OverlayReviewSession(dataset)
session.subjectCount                 // number of subjects
session.getSubjectVolume(2)          // the third subject's map
session.getDisplayRange()            // fixed display window for the current contrast
```

Each contrast's display window is fixed when the session is created, either from its `displayRange` or from the range of all its data, so the colour scale does not jump as you browse. Without `subjects`, the subjects are named `subject-1`, `subject-2`, ….

## Group statistics

`OverlaySummaryService` computes summaries from one contrast's vector. Every method takes an optional list of subject indices, so you can summarise a subgroup:

```ts
const summary = new OverlaySummaryService(session.getContrast('faces').vec)

const groupT = summary.oneSampleT()              // one-sample t over all subjects
const holdoutMean = summary.leaveOneOutMean(2)   // group mean without the third subject
const agree = summary.consistency({ cutoff: 3 }) // share of subjects with |value| >= 3 and the sign of the mean
```

The results are `Float64NeuroVol`s on the template grid. Voxels where a statistic is undefined (for example zero variance) are `NaN` and render transparent. The service recomputes on every call by default; pass `{ cache: 'assume-immutable' }` to cache statistics when the data will not change. The standalone functions (`computeSufficientStats`, `meanVolume`, `oneSampleTVolume`, `welchTVolume`, `pairedDifferenceTVolume`, …) expose the same computations for custom pipelines.

## Viewer and panel (browser)

```html
<div id="viewer" style="width: 900px; height: 600px"></div>
<overlay-review-panel id="panel"></overlay-review-panel>
```

```ts
import { SubjectOverlayViewer, OverlayReviewPanel } from 'neuroimjs/browser'

void OverlayReviewPanel   // importing the class registers <overlay-review-panel>

const reviewer = await SubjectOverlayViewer.create(document.getElementById('viewer')!, dataset, {
  subjectThreshold: [-3, 3],   // hide subject values between -3 and 3
  showCrosshair: true,
})

const panel = document.getElementById('panel') as OverlayReviewPanel
panel.setReviewViewer(reviewer)
panel.setReducer('tstat')      // 'mean' | 'tstat' | 'effect' | 'consistency'
panel.setView('group')         // or 'subject'
```

`SubjectOverlayViewer.create` takes every `SimpleOrthogonalViewer` option plus review options (colormaps, thresholds and opacity for the template and subject layers, and the initial subject and contrast). The viewer can also be driven without the panel:

```ts
reviewer.setSubjectIndex(3)
reviewer.setContrast('faces')
reviewer.setSymmetricThreshold(2.3)              // subject layer: hide |value| < 2.3
reviewer.setSummaryVolume(groupT, { range: [-8, 8] })
reviewer.setOverlayOrder('summary-over-subject')
reviewer.getViewer()                             // the underlying SimpleOrthogonalViewer
reviewer.dispose()
```

The panel has a **subject** view (browse individual maps) and a **group** view (the selected summary over all subjects, or with `setHoldout(true)` over all subjects except the current one), a cutoff control, cine playback through subjects, and a readout of the values under the crosshair. Pass your own `reducers` to add summaries beyond the four built-in ones (`DEFAULT_OVERLAY_REVIEW_REDUCERS`).

To try it, run `npm run demo:overlay-review` in the repository: it opens `examples/overlay-review-demo.html`, which uses synthetic data.
