# Plan: plots backed by the data behind a map

Status: core built (phase 1 below); the rest agreed. Touches three repos:
neurotabs (format), neuroimjs (reader, extraction, plots, viewer link),
fmriregdsl (first consumer).

## 0. Constraints

- **JS/TS only.** Nothing in the plotting path depends on R. neurotabs is
  the format: files with a written spec. The R package is one tool that
  writes them; neuroimjs reads them and, where needed, writes them too.
- **Static hosting.** A study must be servable from a plain static host
  (GitHub Pages, S3, Netlify): every read is an HTTP GET of a file, with
  Range requests for large data. No server, no endpoint, no runtime
  computation outside the browser.

## 1. Goal

Click (or hover) a place on a map in the neuroimjs viewer and get a plot of
the data that produced the map at that place: per-subject points, condition
means with honest error bars, time courses for FIR or spline models,
covariate scatter. Let the user slice (keep some levels) and collapse
(average over a factor) from the plot itself. When a map has no backing
data, nothing appears and nothing breaks: the hover stays exactly as it is.

## 2. What already exists

**neurotabs (R).** NFTab is a manifest plus one observation table. Rows are
observations at a declared grain (`observation_axes`, e.g. subject ×
condition × run). Columns carry `semantic_role` (`subject`, `group`,
`condition`, `covariate`, ...). Features resolve per row to a volume (`ref`,
e.g. a NIfTI with selector `{"index": {"t": k}}`) or a 1D vector (`columns`,
e.g. ROI values with `axis_domains` labels). `x-masked-volume` maps a vector
over voxels back to the grid. `nf_analyze()` runs exploratory term tests and
returns an nftab of test rows (`term`, `stat_kind`, `df_*`, features `stat`,
`p_value`, `estimate`). Manifests can be written as YAML or JSON.

Gaps for this work:
- A volume feature can't declare non-spatial axes, so an FIR lag or spline
  basis axis has nowhere to live except as extra rows.
- A result map doesn't record what it was computed from, so a viewer can't
  find the data behind a `stat` map.
- Getting values at one voxel means reading every row's whole volume. That's
  fine in R but too slow in a browser.

**fmriregdsl studio (React).** `explore.jsx` already does the experience we
want for one specific case, in about 1000 lines of hand-written SVG: a
cluster table, then a response panel with strip plots, `by`/`split`
controls, fitted curves from the HRF basis, modulation curves, covariate
scatter, subject hover linked to the viewer, and the circular-vs-LOSO
reading. The data comes from `fmridsl_response()` in R (the explore cache:
in-mask betas per subject × condition × basis, plus basis curves). This is
the prior art to generalise, and also the first thing to replace.

**neuroimjs.**
- `SingleSliceViewer` emits `pointerMove`, `pointerDown` and `coordChanged`
  with grid and world coordinates. `OrthogonalImageViewer` has the hover
  outline and readout.
- `VolumeSet` is already a browser-side nftab in miniature: masked Float32
  members on a shared grid, each with `meta`, plus `gridToMask`.
- `OverlayReviewDataset` already handles per-subject browsing.
- Controls are Lit components. There is no plotting code in the library, and
  no NFTab reader.

## 3. The shapes the plot must cover

| Backing data | Default plot |
|---|---|
| One value per subject (a contrast or coefficient map each) | Swarm of subjects + mean ± 95% CI |
| … plus a between-subject group | Same, coloured/split by group |
| Subject × within factor(s) (± group) | Interaction plot: means ± within-subject CI, faint per-subject lines |
| Subject × condition × lag (FIR) | Time course: mean line + CI ribbon per condition |
| Subject × condition × basis coefficient (spline, multi-basis HRF) | Reconstructed curve (basis matrix × betas), ribbon over subjects |
| Numeric covariate in the design | Scatter + fit line + r, still per subject |
| Parametric modulator | Curves at −1 SD / mean / +1 SD (as the studio does now) |
| ROI vectors (`columns`, `roi` axis) | Same plots; the probe is the clicked atlas parcel |
| `nf_analyze()` test rows | Plots the source data via the provenance link; the test's estimate goes on as a reference |
| Group map with no backing | No plot panel; hover unchanged |

All of these come from a single rule. Each one is a design table joined to a
value per row (optionally with one extra axis), reduced over a spatial
probe, collapsed, and summarised. That's why one small grammar can cover
them, rather than nine separate widgets.

## 4. Architecture

Five layers, each usable without the ones above it:

```
 Viewer events ──► Probe ──► Backing.extract() ──► Frame ops ──► PlotSpec ──► Renderer
 (where)           (which     (values per row      (slice,       (what to     (SVG)
                    voxels)    [× axis])            collapse,     draw)
                                                    summarise)
```

### 4.1 `src/tabs/`: NFTab reader (neuroimjs)
- `NFTab.open(source)`, where `source` is a URL base or a map of files.
  Parses `nftab.json` (YAML through an optional `yaml` peer dependency),
  the CSV/TSV observation table, and the resource registry.
- Resolves `columns` features, `ref`/`nifti` features (selector `index.t`,
  using the existing NIfTI reader) and `x-masked-volume`.
- `design()` returns a `Frame` of the scalar columns with their roles and
  levels.
- Core-conformant in the spec's sense: an unsupported backend gives an
  explicit error.

### 4.2 `Backing`: the one interface everything else depends on
```ts
interface Backing {
  design: Frame;                       // one row per observation
  axis?: { name: string; values: number[]; unit?: string;
           basis?: Float32Array /* time × nbasis, for reconstruction */ };
  provenance?: Provenance;             // from x-backing
  extract(probe: Probe, opts?: { reduce?: 'mean' | 'median' }): Promise<Frame>;
}
```
Implementations:
- `MemoryBacking`: a `VolumeSet`, generalised so members can carry an
  axis. Instant, so hover can drive it.
- `PackBacking`: HTTP Range reads of a voxel-major probe pack (§5.3), one
  small read per probed voxel run. Usable for hover once a voxel is cached.
- `ColumnsBacking`: ROI vectors.
- No remote backing. A static host has nothing to answer a POST, and
  everything a probe needs is computed in the browser.

Static-host sizes, which decide between the two:
- `MemoryBacking` fetches the NIfTIs and holds every row's in-mask values.
  24 subjects × 6 conditions × 200k voxels is about 115 MB as Float32: fine.
- `PackBacking` is for studies too large to hold. 40 subjects × 6
  conditions × 12 lags × 200k voxels is about 2.3 GB; one voxel is a
  single ~11 KB Range read. Static hosts honour Range requests. The pack
  is stored raw or chunk-compressed, never gzipped as a whole, since a
  gzip stream cannot be read from the middle.

### 4.3 `Probe`
Probe kinds: `voxel`, `sphere(r mm)`, `cluster(labelVol, id)`,
`parcel(atlas, label)`, and `mask(vol)`. Each one resolves to grid indices
plus a short description ("sphere 6 mm at −42 −58 −12, 33 voxels") that is
shown on the plot. Probes are values with a stable `key()`, so extraction
results can be cached by key.

### 4.4 `Frame` and its operations
A tiny columnar table (typed arrays plus string columns), with no
dependencies. The operations:
- `where(col, levels)`: slice.
- `collapse(cols)`: average over factors. **It always works subject-aware:
  first within subject, then across subjects.** Runs or trials are never
  treated as independent observations.
- `summarise(by, stat)`: computes `mean`, `se`, `ci95` (t-based), or
  `ci95_within` (Cousineau–Morey) for within-subject factors.

The subject column comes from `semantic_role: subject`. Whether a factor is
within or between subjects is inferred from the design: it is within if its
levels vary inside a subject. This is the same partition `nf_analyze`
makes. Numbers are checked in tests against expected values committed to
the repo (computed once, e.g. R's `qt`), so the test suite needs no R.
Comparing against neurotabs output stays possible as an optional, dev-time
cross-check.

### 4.5 `PlotSpec` and `inferSpec`
A small declarative spec that can be serialised to JSON:
```ts
{ y: 'value', x: 'condition' | '<axis>', color?: 'group', facet?: string,
  keep?: Record<string, string[]>, collapse?: string[],
  summary: 'mean_ci' | 'mean_se' | 'none', error: 'auto' | 'between' | 'within',
  subjects: 'points' | 'lines' | 'hidden', reference?: number /* e.g. 0 or the test estimate */ }
```
`inferSpec(backing)` chooses the default from the table in §3. The panel's
controls only edit the spec: clicking a legend entry adds a `keep` and
dragging a factor off the axis adds a `collapse`. So every view on screen
can be reproduced from its spec, and the "R for this view" button keeps
working.

### 4.6 Renderer
A self-made SVG renderer rather than a charting dependency. The marks we
need are few (point/swarm, line, ribbon, errorbar, axes, legend), and the
studio's code already has the hard parts: nice ticks, swarm layout, t
quantiles. Keeping it in-house means:
- no extra weight in the bundle,
- crisp output at any zoom level,
- SVG/PNG export for free,
- and the same theme tokens as `ViewerTheme`.

The renderer ships in two forms, matching the library's existing controls:
a framework-free `PlotPanel` class and a `<nij-plot>` Lit element.
Transitions between specs animate, so collapsing a factor visibly merges
the points.

### 4.7 Linking to the viewer: `BackedView`
`BackedView.attach(viewer, backing, { mode: 'click' | 'hover', probe: 'voxel' | {sphere: 6} })`.
- **Commit.** `pointerDown` or `coordChanged` sets the probe.
- **Preview.** `pointerMove` is throttled with rAF, takes effect only when
  extraction is cheap (memory, or pack plus cache), and draws a ghost
  behind the committed plot.
- **Reverse links.** Hovering a subject in the plot emits `focusMember`,
  which the host can route to `OverlayReview` to show that subject's map.
  Hovering a lag emits `focusAxis`.
- **Absent backing.** If there is no backing, `attach` is a no-op.

### 4.8 Circularity is first-class
If the probe was chosen from the very map the backing produced (from the
`x-backing` provenance plus a peak or cluster probe), the plot is labelled
*circular* by default (`BackedView` does this unless the map is declared
independent). It offers an independent contrast, and a leave-one-subject-out
reading computed in the browser when the backing is in memory and carries
the selecting map's design. For pack-backed studies the warning stands and
the plot points to an independent contrast. The studio already handles this; the library has to
keep it, not lose it.

## 5. neurotabs additions (all `x-` extensions, nothing breaking)

1. **Extra axes on volume features.**
   - Allow `axes: [x, y, z, lag]`, where the first three axes are spatial
     by the support.
   - `axis_domains.lag` gains `values` (or a `labels` table) and `unit`.
   - A new `x-basis` extension holds a time grid × nbasis matrix table, so
     viewers can reconstruct spline and HRF-basis curves from coefficients.
2. **`x-backing` (provenance)** on result datasets. It records:
   - `source` (relative manifest path) and `feature`,
   - `formula` and `subject`,
   - `selection`: which test or contrast defined the map, so that viewers
     can detect circularity.

   `nf_analyze()` writes this automatically, and fmriregdsl writes it for
   its first-level and group maps.
3. **`x-probe-pack`: a voxel-major sidecar** made for interactive reads.
   - A JSON header points to a little-endian Float32 blob laid out as
     `[in-mask voxel][row][axis]`, plus the `x-masked-volume` index map.
   - A Node CLI in neuroimjs writes it from the NIfTIs:
     `neuroimjs pack nftab.json --feature beta` (also writes `nftab.json`
     beside a YAML manifest). neurotabs may add `nf_pack()` for R users, but
     nothing depends on it.
   - Size check: 40 subjects × 6 conditions × 12 lags × 200k voxels comes to
     about 2.3 GB on disk. One voxel is still a single ~11 KB range read,
     and the browser never holds the whole thing.
4. **Probing is defined by the TS implementation** (`src/backed/`). An
   `nf_probe()` in R, if added, is a convenience that must match it.

## 6. Phases

| # | Repo | Work | Done when |
|---|---|---|---|
| 1 | neuroimjs | Probes, summaries, `PlotSpec`, SVG renderer, `PlotPanel`, `BackedView` | **Done.** Critic rounds at equilibrium; 2344 tests green |
| 2 | neuroimjs | NFTab reader (`src/tabs/`, from `neuroimjs/browser`) into `MemoryBacking`, following `x-backing`; reader tests on real NIfTI files; static demo site (`npm run build:backed-demo`, `npm run test:backed-static`) | **Done.** The site serves from a plain directory under a subpath, makes no request outside it, reads 60 rows behind the group map, and plots on click. The neurotabs faces-demo example reads too (its NIfTI is not in the repo, which the reader reports) |
| 3 | neurotabs | Spec text for the extensions; `nf_analyze` writes `x-backing` | **Drafted** in neurotabs `spec/extensions/` (`x-backing`, `x-volume-series`, which replaces axis_domains values and `x-basis`); `x-probe-pack` and the R writer remain. neuroimjs also reads the Summary Profile 0.1 (`x-summary`) and passes its conformance fixtures |
| 4 | neuroimjs | `neuroimjs pack` CLI; `PackBacking` over Range reads; in-browser LOSO for memory backings | A 2 GB-class study plots from a static host in < 150 ms per click |
| 5 | fmriregdsl | Write the explore cache as an nftab + `x-backing`; swap `explore.jsx` plots for `PlotPanel` | End-to-end test still recovers the planted face effect |
| 6 | neuroimjs | Consumer contract test for the studio; CHANGELOG; release | `npm run test:consumers` green |

Phases 2 and 3 can proceed in parallel once the extension shapes are agreed.

## 7. Decisions (all agreed)

1. **Renderer.** The recommendation is the in-house SVG renderer described
   in §4.6. The alternative is Observable Plot: faster to start, but it adds
   d3 and is harder to animate and theme to match the viewer.
2. **Manifest format in the browser.** The recommendation is JSON-first,
   with YAML through an optional peer dependency; `neuroimjs pack` writes
   `nftab.json` beside a YAML manifest.
3. **Parquet observation tables.** The recommendation is to defer them
   (CSV/TSV only in v1), because parquet would mean a WASM dependency.
4. **Hover vs click default.** The recommendation is click to commit, with
   hover preview on by default only when the backing is local.
5. **No R at runtime, static hosting.** See §0.
