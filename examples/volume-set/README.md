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
  parameters (`neuroimjs-nmds-smacof`, seed 1, random starts scaled to the set size (128 for up to 50 maps, 32 up to 100, else 8), 500 iterations, tolerance 1e-7), all
  shown in the panel. The URL stores the view (`mode=space&layout=nmds`), the focused subject, the
  slice and the layout viewport (`sv=zoom,cx,cy`), so a link reopens the same state.

### Controls (Space)

| Action | Effect |
|---|---|
| click a map | set the cursor at that voxel, focus the map and open it in the **peek** |
| P | open (or close) the peek for the focused map |
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

**Positions.** Pictures are nudged apart so none overlaps another. Every picture moved by more than a fifth of
its width keeps a mark at its exact fitted position, joined by a faint line: a dot, or a ring when that
position falls inside another map's picture. The caption under the layout counts every moved picture.
On a narrow window the toolbar switches to short labels ("Halos", "Side by side").

**Peek.** A small slice viewer for one map, placed where it covers the fewest pictures (never the side
panel). It has its own plane (A/C/S) and slice (slider or wheel), reads the raw value under the pointer
in mm, and uses the shared threshold, range, smoothing and cluster filter. It follows the focused map
(arrow keys, IDs, the Maps list); a picture clicked in another contrast's side-by-side panel shows that
contrast. A click inside it places the shared cursor; a double-click or "Ortho" opens Ortho at that voxel.
Close it with ×, Esc, P, a click on empty space, or by leaving Space; drag its header to move it.

### Layers (toolbar above the layout)

Each layer is off by default, is written to the URL only while it is on, and never moves a fitted position.

| Layer | URL | What it shows |
|---|---|---|
| Mark: value at cursor | `sc=cursor` | a bar under each map in its raw value at the cursor, on its own scale up to the largest value (grey below threshold, dashed for no data) |
| Mark: covariate | `sc=cov:<column>` | a column of the optional `participants.tsv` beside the data (`VS_DATA_ROOT/participants.tsv`; synthetic mode provides age, site, mean FD) |
| Compare (neighbour table, or `C` over a hovered map) | `cp=<id>` | where the focused map and another agree (green) or disagree (magenta): per-voxel z_a·z_b/n on the common support, which sums exactly to r; with a per-slice profile (click to jump) |
| Fit halos (`H`) | `sh=1` | each map's share of the layout's misfit (all faint, the focused map clear; its share and rank in the panel) |
| Stability | `sb=1` | 24 block-bootstrap refits (12 mm cubes of the compared voxels resampled, warm-started, aligned): dots and a 68% ellipse per map, the focused map's spread and rank in the panel; up to 100 maps |
| Density | `sd=on/off` | 50 / 80 / 95% contours of where maps concentrate; on by default for dense sets |
| Magnifier (`L`) | not stored | a 2.2× loupe under the pointer; nothing moves |
| Similarity: sphere | `sr=i,j,k,mm` | similarity within a 10, 15 or 25 mm sphere, first applied at the cursor; widening keeps the centre, moving the cursor never refits, re-centring is a panel button; the sphere is outlined on the Mean picture |
| Contrasts side by side | `st=1` | every contrast drawn at the current layout's positions, one panel each, with same-subject r across contrasts in the panel (no new fit) |
| Group (Shift-drag, Shift+Alt-drag removes, Esc clears) | `ss=<ids>` | the selected maps marked in the layout and on the rail, with group mean, others' mean and difference on this slice, and the medoid |

When the displayed fit changes (contrast, statistic or region), the new layout is aligned
to the old one by rotation, reflection and uniform scale only and animated (instant with reduced
motion); reloading the URL shows the canonical pose. Agreement maps, group differences, halos and
stability are descriptive; none is a significance test. A pooled 2D fit over subject × contrast maps
was tried and removed: on real data it could not place a subject's contrast maps together even
though they are each other's most similar maps.

### What drives the layout (Explain, reliability)

| Control | URL | What it shows |
|---|---|---|
| Explain | `sx=all\|focused\|group` | the layout's dissimilarity split by voxel: what separates all maps (beyond the noise floor), where the focused map differs from the rest, or where a lasso group differs from the others. Each voxel's term sums exactly to the dissimilarity named. For a focused map the panel ranks parcels by **×typical**: the map's share of its own divergence in the parcel ÷ the median, over all placed maps, of each map's own share there (parcels under 20 voxels show –), with the map's rank among all maps beside it; raw shares would list the same parcels for every map, because every map diverges most where the signal is. ×typical has no noise model, so a large ratio on a tiny share (or in a low-signal parcel) deserves caution. For all maps the panel ranks parcels by share, density (share ÷ share of voxels), share beyond noise and per-parcel I², reports how concentrated the top parcels are (against size, and against random splits for groups) and the mass outside the parcellation, and lists the parcels the layout depends on most (exact leave-one-parcel-out correlation, no refit). Clicking a parcel marks every map by its mean z there (`sc=parcel:<id>`) and goes to it. |
| Mark: reliability | `sc=rel` | ρ per map: 1 − noise variance ÷ spatial variance (t-maps: noise ≈ 1 per voxel; β-maps: SE², loaded on demand). Low-ρ maps correlate weakly with everyone and sit at the edge for that reason alone. A yardstick on the layout shows how far apart two noisy copies of one map would sit; when that 1 − r is below every observed pair (the usual case), the caption says its length is extrapolated. On a noise-corrected layout there is no yardstick: two noisy copies of one map would coincide. |
| Correct for noise | `sn=1` | lays out by r ÷ √(ρᵢρⱼ) (Spearman's correction, clamped to ±1; maps with ρ < .1 are set aside), animating from the uncorrected layout so you can see which maps moved |
| Mark: a covariate | `sc=cov:<column>` | also fits the covariate to the layout (envfit: a gradient arrow for numbers, centroids for categories) with a permutation p-value; valid because the covariate did not build the layout |

Explain is descriptive: maps are z-scored (pattern, not amplitude), voxels are spatially correlated,
and the layout was built from the same voxels. The noise floor counts independent measurement noise;
maps that differ in reliability add more, so the remainder is an upper bound on true pattern
differences. I² assumes calibrated first-level SEs and averages about .1 even without heterogeneity.
Parcels come from the template's parcellation via [neuroatlasjs](https://github.com/bbuchsbaum/neuroatlasjs)
(Schaefer covers cortex only); Explain runs on up to 100 placed maps.

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
