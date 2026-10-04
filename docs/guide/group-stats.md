# Group Statistics & Overlay Review

Given one statistic map per subject — first-level contrasts, β maps, z maps — neuroimjs computes voxelwise group summaries (mean, SD, effect size, one-sample / Welch / paired t, sign consistency, leave-one-out) and organises subjects × contrasts for interactive review. Every function on this page is exported from both `neuroimjs` and `neuroimjs/browser` (import from one entry per app); outputs are ordinary volumes you can threshold, cluster, write to NIfTI, or display.

## 1. Stack subjects into a 4D volume

The group functions start from a 4D `NeuroVec` whose fourth axis is **subjects**. `computeSufficientStats` and the paired, consistency and service APIs take that vec directly. The one-sample and two-sample summary functions (`meanVolume`, `oneSampleTVolume`, `welchTVolume`, …) take the `SufficientStats` computed from it. Build the vec from per-subject volumes:

```ts
import { createReviewVecFromVolumes } from 'neuroimjs'

const faces  = createReviewVecFromVolumes(faceMaps)    // [x, y, z, nSubjects]
const houses = createReviewVecFromVolumes(houseMaps)
```

`createReviewVecFromVolumes` checks that every volume matches the first in dimensions, axes and affine, and throws otherwise — subjects must already be in a common space. It keeps the first volume's full geometry and returns a `Float32NeuroVec` when every input is Float32, otherwise a `Float64NeuroVec` (integer and Float64 inputs are never narrowed).

## 2. One-sample maps

`computeSufficientStats` makes two passes over the data (one for the mean, one for squared deviations around it) and caches per-voxel count, mean and sum of squared deviations; the summary functions read from it.

```ts
import {
  computeSufficientStats, meanVolume, standardDeviationVolume, effectVolume, oneSampleTVolume,
} from 'neuroimjs'

const stats = computeSufficientStats(faces)   // all subjects; or pass indices, e.g. [0, 2, 4]
const mean = meanVolume(stats)
const sd   = standardDeviationVolume(stats)   // sample SD (n − 1)
const d    = effectVolume(stats)              // mean / sd  (Cohen's d)
const t    = oneSampleTVolume(stats)          // mean / (sd / √n)
```

For a voxel whose six subjects have values 1…6, these give mean `3.5`, SD `1.8708`, d `1.8708` and t `4.5826`.

All outputs are `Float64NeuroVol` on the input vec's spatial grid (the space of `vec.getVolume(0)`). Details that matter for real data:

- **Non-finite values are skipped per voxel.** A subject with `NaN` (or `±Infinity`) at a voxel simply doesn't count there; `stats.count[i]` holds the per-voxel n, and t uses that n.
- **Undefined statistics are `NaN`, not 0**: the mean where no subject has data, and SD / d / t where fewer than two subjects contribute. Where the variance is exactly zero, SD is `0` while d and t are `NaN`.
- Sums and squared deviations use compensated (Neumaier) summation around the mean, so maps with a large common offset do not lose precision.
- No degrees of freedom or p-values are returned; the maps are test statistics only.

## 3. Two-sample and paired maps

```ts
import {
  welchTVolume, differenceOfMeansVolume,
  pairedDifferenceTVolume, pairedDifferenceMeanVolume, pairedDifferenceEffectVolume, pairedDifferenceVec,
} from 'neuroimjs'

// Independent groups: subsets of one vec, or two vecs on the same grid
const groupA = computeSufficientStats(faces, [0, 1, 2])
const groupB = computeSufficientStats(faces, [3, 4, 5])
const tWelch = welchTVolume(groupA, groupB)               // (meanA − meanB) / √(varA/nA + varB/nB)
const dMeans = differenceOfMeansVolume(groupA, groupB)

// Within-subject contrast: faces − houses, subject by subject
const tPaired = pairedDifferenceTVolume(faces, houses)
const dPaired = pairedDifferenceEffectVolume(faces, houses)
const mPaired = pairedDifferenceMeanVolume(faces, houses)
const diffs   = pairedDifferenceVec(faces, houses)        // the per-subject difference maps (4D)
```

In the synthetic example (values 1…6 split 3/3), Welch t is `-3.6742` and the difference of means is `-3`. Paired functions require both vecs to have the same subject count and geometry; all accept an optional subject-index list as the last argument.

## 4. Consistency across subjects

Group t can be driven by a few strong subjects. `consistencyVolume` reports, per voxel, how many subjects exceed a cutoff **in the direction of the group mean**:

```ts
import { consistencyVolume } from 'neuroimjs'

const prop  = consistencyVolume(faces, { cutoff: 3 })                    // proportion of subjects
const count = consistencyVolume(faces, { cutoff: 3, output: 'count' })   // number of subjects
```

Where the group mean is positive, a subject counts if its value is ≥ `cutoff`; where it is negative, if ≤ `-cutoff`. For values 1…6 and `cutoff: 3`, that is 4 of 6 subjects: `0.6667`, or `4` as a count. Voxels with a mean of exactly 0 get 0; voxels with no data get `NaN`.

## 5. Leave-one-out

To check whether a single subject drives an effect — or to build an unbiased group map for that subject's ROI definition — remove it from the sufficient statistics without recomputing:

```ts
import { subtractSubjectFromStats } from 'neuroimjs'

const withoutFirst = subtractSubjectFromStats(stats, 0)
meanVolume(withoutFirst)         // the 1…6 voxel now has mean 4 (n = 5)
oneSampleTVolume(withoutFirst)
```

## 6. `OverlaySummaryService`

`OverlaySummaryService` wraps one 4D vec and exposes the same summaries as methods, with optional caching of the sufficient statistics per subject subset:

```ts
import { OverlaySummaryService } from 'neuroimjs'

const service = new OverlaySummaryService(faces, { cache: 'assume-immutable' })

service.mean()
service.oneSampleT()                    // all subjects
service.oneSampleT([0, 2, 4])           // a subset
service.leaveOneOutT(2)                 // group t without subject 2
service.consistency({ cutoff: 3 })
```

Caching is **off** by default (`cache: 'none'`) because `NeuroVec` exposes its backing array: if you mutate the data in place, cached statistics go stale. Enable `'assume-immutable'` only when the data will not change, and call `service.clearCache()` if it does.

## 7. Reviewing subjects × contrasts

`OverlayReviewSession` holds a validated dataset — a template (anatomical underlay), one or more contrasts, and subject metadata — plus the current subject and contrast:

```ts
import { OverlayReviewSession } from 'neuroimjs'

const session = new OverlayReviewSession({
  template,                                         // NeuroVol on the same grid
  contrasts: [
    { id: 'faces',  label: 'Faces > baseline',  vec: faces, displayRange: [-8, 8] },
    { id: 'houses', label: 'Houses > baseline', vec: houses },   // range taken from the data
  ],
  subjects: faceMaps.map((_, i) => ({ id: `sub-${String(i + 1).padStart(2, '0')}`, group: i < 3 ? 'A' : 'B' })),
})

session.setSubjectIndex(3)
const vol = session.getSubjectVolume()             // index 3 (sub-04), contrast 'faces'
session.getDisplayRange()                          // [-8, 8]
session.setContrast('houses')
```

Validation (also available standalone as `validateOverlayReviewDataset`) rejects contrasts whose spatial grid differs from the template, contrasts with different subject counts, duplicate contrast or subject ids, and subject lists of the wrong length — e.g. `Subject metadata length 1 does not match contrast subject count 6`. Omit `subjects` to get `subject-1`, `subject-2`, … . Each contrast's display range is fixed once at construction — the given `displayRange`, else the min/max over **all** subjects — so colours stay comparable while you page through subjects.

::: info Browser UI
`SubjectOverlayViewer` (a viewer bound to an `OverlayReviewSession` that can also show group summary layers) and the `OverlayReviewPanel` web component are exported from `neuroimjs/browser`. See the [Viewers](/guide/viewers) guide for the display side.
:::
