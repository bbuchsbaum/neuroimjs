# Volume-set browser

A demo for looking at a *set* of aligned maps (for example one contrast map per subject in MNI space)
side by side. It is a side quest, not a published API: everything in `src/volumeset/` is internal.

```bash
VS_DATA_ROOT=/path/to/contrasts npm run demo:volume-set   # your real maps (the default)
npm run demo:volume-set:synthetic                          # generated set, no private data
npm run test:e2e:volume-set                                # browser gate (synthetic data only)
```

The real-data demo needs only `VS_DATA_ROOT` (a folder of `<model>/sub-*/…nii.gz` contrast maps on the
MNI152NLin2009cAsym 2 mm grid). The template, brain mask and Schaefer atlas are downloaded once from the
public TemplateFlow archive into `examples/volume-set/.cache/templateflow/` (git-ignored); set
`VS_TEMPLATE_DIR` to use another copy. Real data is never copied into the repository.

`VS_SYNTHETIC=1` serves a generated set: a non-cubic, anisotropic grid with a translated affine and
17 subjects with planted structure (two groups, an outlier, a sign flip, an identical-pattern pair, a
low-coverage map and a constant map), plus 50- and 200-member sets (`synth50`, `synth200`).

## Views

| View | What it is for |
|---|---|
| **Montage** | every map on one slice, ordered by similarity or another sort key |
| **Ortho** | one map in the orthogonal viewer; ← → step through subjects with the cursor fixed |
| **Facet** | subject × contrast grid |
| **Space** | maps placed by whole-volume similarity, each drawn as its current slice |

All views share one cursor, orientation, slice, threshold, colour range, smoothing, cluster filter,
anatomical crop and focused subject. The rail below shows every subject's raw value at the cursor.

## Space

**What a position means.** Each map is placed by nonmetric multidimensional scaling (NMDS, 2D) of the
dissimilarity `1 − r`. Here `r` is the signed Pearson correlation between two maps' raw values on the
*common support*: the analysis-mask voxels where every compared map is finite. Nearby maps have
similar whole-volume patterns.

- **The picture is not the position.** A map is placed by its whole volume but drawn as one slice, so
  two maps can look different on this slice and still sit together.
- **Axes, orientation, gaps and group shapes are not results.** The layout is a 2D approximation:
  of the rank order of `1 − r` for NMDS, or of `1 − r` itself for the metric fallback. The side panel's neighbour table lists each map's true nearest maps by `1 − r`, with
  their rank on screen. When the nearest map on screen is not a true neighbour, the panel says so.
- **Fit quality.** Stress-1 (Kruskal) is √(Σ(d − d̂)² / Σd²), where d̂ is the monotone (isotonic) fit
  to the layout distances. No stress value is universally good or bad. The Shepard plot shows each
  pair's layout distance against `1 − r` with the monotone fit. The panel also reports the number of
  starts (a classical start plus seeded random starts) and how many reached the best solution.
- **Degenerate fits.** With strongly clustered data, NMDS can reach zero stress by collapsing each
  group to a point. The solver detects this (Stress-1 below 1e-4 with distinct maps at near-zero
  distance) and shows a metric MDS of `1 − r` instead, labelled as such. Partial collapse at a higher
  stress is not detected.
- **Very small sets.** With three or fewer comparable maps, or when every pair is equally dissimilar,
  the maps are placed exactly and the layout is labelled "exact placement, not MDS".
- **Exact duplicates of pattern** (`r = 1`, for example one map equal to 2× another plus a constant)
  share one anchor marked `+n`. Every ID stays selectable. They are not reported as duplicate files.
- **Not placed.** Some maps cannot be compared: a map with data on fewer than 90% as many mask voxels
  as the median map, or a constant map. These appear in a strip below the layout with the reason, are
  excluded from the similarity matrix (hatched), and stay available in every other view.
- **Missing coverage** inside the mask is hatched on every picture, so it never reads as
  "below threshold". Threshold, smoothing and the cluster filter change only the pictures. Positions,
  neighbours and every number stay raw.
- **Reproducibility.** The layout is a pure function of the data, the basis policy (version
  `common-support-pearson/1`, minimum coverage 0.9 × the median map, minimum support 30 voxels) and the solver
  parameters (`neuroimjs-nmds-smacof`, seed 1, 8 random starts, 500 iterations, tolerance 1e-7), all
  shown in the panel. The URL stores the view (`mode=space&layout=nmds`), the focused subject, the
  slice and the layout viewport (`sv=zoom,cx,cy`), so a link reopens the same state.

### Controls (Space)

| Action | Effect |
|---|---|
| click a map | set the cursor at that voxel and focus the map |
| click an ID, a dot or a list entry | focus the map without moving the cursor (IDs and dots win over pictures beneath them) |
| hover (or keyboard focus) | enlarge the map after a short pause; a line joins it to its true position |
| double-click, Enter, or "Open in Ortho" | open the focused map in Ortho; Esc / Back returns with the viewport |
| wheel, PageUp/PageDown, the slice slider | change the shared slice for every map |
| ⌘/Ctrl + wheel, + / − | zoom the layout (never the anatomy) |
| drag | pan the layout |
| arrow keys | move focus to the nearest map in that direction; ↓ from the bottom enters the not-placed strip |
| 0 or Fit | fit the whole layout |
| R | retry a failed layout |

The anatomical crop (zoom inside each picture) is set in Montage or Facet and shared by Space.

### Limitations

- Correlation compares spatial patterns. It ignores amplitude, and it does not account for voxelwise
  precision or degrees of freedom. A t-map and a β-map give different layouts.
- The layout is computed on the main analysis mask (template brain mask ∩ voxels where any map is
  non-zero). It is not ROI-specific, and it is not a test: it does not show subtypes or significance.
- The NMDS optimum is not guaranteed global. The starts statistic shows how stable it is, not that it
  is correct.
- Layouts are fitted in a worker, so slicing stays responsive while a fit runs. The fit took about
  25 ms for the 17-subject sets and 1.4 s for 200 maps (`docs/plans/volume-set-space.md`, evidence
  record); larger sets were not qualified. Superseded fits are not cancelled: after rapid source
  changes they run to completion, one after another, before the current one.
- The similarity basis itself is computed on the main thread when a set loads (about 0.1 s for 17
  subjects at 2 mm).
