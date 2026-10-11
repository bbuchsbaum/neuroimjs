# Volume Set Space v2: interpretation and interaction

Follows Space v1 (`docs/plans/volume-set-space.md`). Maintainer's scope (2026-10-09): pair agreement maps,
colour by cursor value and covariates, the honesty layers (fit halos, stability, region-conditioned
layout) made intuitive and attractive, and the interaction items (aligned transitions, lasso subsets,
contrast trajectories, fisheye lens, density contours). The kernel-weighted "probe map" is out of scope.

Ground rules carried over from v1: positions are data and never move for display reasons, except
through an explicitly labelled lens or an animated transition between two fits; numbers stay raw;
nothing implies inference, subtypes or significance; every member stays reachable; synthetic data
for committed tests. Ownership: Space UI moves into `examples/volume-set/space-view.ts` (one writer);
the parallel hill-climb session keeps `main.ts`, `render.ts` and `index.html`.

## Items

| ID | Item | Contract (what it shows, and the honesty rule) | Mote |
|---|---|---|---|
| V2-01 | Pair agreement map | Per-voxel contribution c_v = z_a(v)·z_b(v)/n on the common support, with z from the support's mean and population SD, so Σc_v = r exactly. Agreement in warm colours, disagreement in cool. Shown as a pair card (A, B, agreement) anchored on the link between two maps, plus "open in Ortho". The card states the share of r from this slice and from positive versus negative products. | new |
| V2-02 | Colour by channel | A channel select: none, value at cursor (raw), or covariates from `participants.tsv` (with coverage as a built-in QC field). Encoded as the ring or frame colour, with a legend that has units and a missing-value swatch. Cursor scrubbing recolours without a refit. | N01 |
| V2-03 | Fit halos | Each map's share of the stress numerator, shown as a soft halo: wider and paler means placed less faithfully. Legend and definition included; no good/bad cutoff. | new |
| V2-04 | Stability clouds | A spatial block bootstrap: resample brain blocks (default 12 mm cubes, 24 replicates) and refit warm-started from the current layout. Each replicate is Procrustes-aligned to the layout and drawn as a translucent cloud plus a 68% ellipse per map, filling in progressively from a worker. Labelled "where a map would sit if the brain's regions were resampled", not a confidence interval for a biological quantity. | new |
| V2-05 | Region-conditioned layout | "Similarity within: whole brain or a sphere of r mm at the cursor", applied explicitly (never on cursor move). It uses the same basis policy restricted to the sphere, reports support, has an informative state when too small, transitions with display alignment, and restores the whole-brain view exactly. | X02 |
| V2-06 | Aligned animated transitions | When the displayed layout changes (contrast, statistic or region), the new fit is Procrustes-aligned (rotation, reflection, uniform scale, translation) to the displayed one by shared IDs and tweened in about 500 ms (instant with reduced motion). Labelled as presentation alignment, and the canonical pose is restored on reload. | new |
| V2-07 | Lasso subsets | Shift-drag lasso in Space, with add/remove and clear. The subset shows in Space, the rail and the matrix. The panel shows n, the subset mean map against the mean of the rest (a labelled descriptive difference with no test), and the source-space medoid. The subset goes in the URL; no refit. | N02 |
| V2-08 | Contrast trajectories | Pooled mode with an explicit contract: one basis over subject × contrast maps on their common support, one fit, and each subject's contrasts joined by a path in contrast order. Colours mark contrasts. Path lengths are labelled as 2D approximations of 1 − r within that single fit; no arrows between separate fits. | N03 |
| V2-09 | Fisheye lens | Toggle (L): a Sarkar–Brown graphical fisheye around the pointer, which magnifies points and thumbnails inside a drawn lens boundary. Display only; anchors outside the lens stay put. | new |
| V2-10 | Density contours | Gaussian KDE in layout coordinates (Scott bandwidth), 3 iso-levels by marching squares, drawn faintly behind the maps. On by default in the marks level of detail. | new |
| V2-11 | Qualification | Unit tests per module; e2e for each interaction; visual round v1 with the same three critics and rubric; evidence and limits appended to this note. | new |

## Order

1. Pure modules with unit tests, in parallel and outside the reserved paths: `src/volumeset/contrib.ts`,
   `procrustes.ts`, `contours.ts` (KDE + marching squares), `stability.ts` (block bootstrap replicates,
   with the fit injected), basis voxel-subset option.
2. After the hill-climb session commits: extract Space UI into `space-view.ts` (no behaviour change, gate
   green), then V2-06 (transitions underpin V2-05/08), V2-01, V2-02, V2-03, V2-10, V2-09, V2-07, V2-04,
   V2-05, V2-08.
3. V2-11.
