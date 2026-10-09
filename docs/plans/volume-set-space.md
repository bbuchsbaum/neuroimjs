# Volume Set Space — integration note (S01)

Mote: epic `bd-01M4F0F3NEHM9RXDCCF8YCHD3Z`, this note is the S01 record (`bd-01M4F0F3ZXYBX40TMBJQMK8GS9`).
Side quest, off-roadmap. No release, publication or public-API promotion is implied.

## Baseline (2026-10-09)

- Branch `feat/volume-set-browser`, HEAD `efcdc0fc3bfb`. All volume-set work is **untracked**:
  `examples/volume-set/` (main.ts 1717 lines, render.ts, data.ts, vs-data-plugin.ts, smooth-pool.ts,
  smooth.worker.ts, vite.config.ts, index.html), `src/volumeset/` (VolumeSet, stats, seriation, smooth,
  clusterExtent) and `tests/VolumeSet.test.ts`. A tar snapshot of the baseline was taken before editing
  (SHA-256 prefixes: main.ts `8a52cdda37a1`, stats.ts `eb625fa70456`, VolumeSet.ts `54b2fb19ecc3`,
  VolumeSet.test.ts `04bb4e406b60`).
- `src/volumeset` is not exported from `src/index.ts` or `src/browser.ts`; everything below stays
  internal (demo + tests) until the parent graduation task decides otherwise.

### Prerequisite issues: what the source actually provides

All remain **open**; none is closed by this work. Status is evidence of a reusable seam only.

| Issue | Provides today (source evidence) | Gap relevant to Space |
|---|---|---|
| `bd-01M4E3CVN4…` VolumeSet data model | `VolumeSet.fromVolumes`, masked Float32 members, `where`, slicing, pixel↔grid | Mask = template ∩ *any member finite & non-zero*; no coverage/support provenance (added in `basis.ts`) |
| `bd-01M4E3CW9EX8…` statistics & orderings | `correlationMatrix` (pairwise deletion), LOO r/distance, robust z, seriation + OLO, cluster suggestion. Runs on the main thread, not a worker | Pairwise deletion is not a common-support basis; Space needs one explicit basis |
| `bd-01M4E3CX0PK8…` montage renderer | One shared canvas, `drawCell`, under/over image caches, crop windows | Reused as-is for Space thumbnails |
| `bd-01M4E3CXJN36…` subject rail | `drawRail`, hover/select linkage, copy TSV | Reused; Space feeds focus/hover |
| `bd-01M4E3CY1ESA…` ortho scrub | `renderOrtho`, `goBack`, `prevMode`, ←/→ subject stepping | `goBack` must return to Space |
| `bd-01M4E3CYGAQX…` facet grid | `drawFacet`, focus window | Unchanged |
| `bd-01M4E3CZ1A41…` similarity matrix | `drawSimMatrix` (no dendrogram drawn) | Must consume the same basis as Space; neighbour highlight |
| `bd-01M4E3CZS9VR…` demo + data server | `vs-data-plugin.ts` (env-driven local data); path is `examples/volume-set`, not `demos/` | Needs a synthetic, committed-safe data mode for tests and screenshots |

## Identity and state model

- **Member identity**: `subject` within one set. Model/contrast/statistic are *analysis context*, not identity.
  All Space structures (basis, layout, neighbours) are keyed by subject ID string, never by array index.
- **Basis identity** (`SimilarityBasis.key`): basis version + data fingerprint (member IDs in order, a sampled
  value checksum, mask size) + support policy parameters + statistic/model/contrast labels. The analysis
  cache key (`model|contrast|stat`) is *not* sufficient on its own; the fingerprint guards a dataset that
  changes under the same labels.
- **Layout identity**: `basis.key | method | params | solver version`.
- **focus** = `state.subject` (durable, URL). **hover** = transient pointer/keyboard preview, never
  written to URL, never replaces focus. **subset**: not in v1 (N02).
- **Display state** (shared, never refits): orientation, slice, cursor, threshold, range, smoothing,
  min-cluster filter, anatomical crop (`state.zoom`), sort order.
- **Embedding viewport** (`state.space`, URL `sv=s,cx,cy`): Space pan/zoom in embedding units.
  Separate from `state.zoom`, which remains the anatomical crop shared by Montage/Facet/Space thumbnails.

## Integration map (anchors in `examples/volume-set/main.ts`)

| Anchor | Change |
|---|---|
| `Mode`, `readState`, `writeState` | add `'space'`; `sv` viewport; validate/ignore malformed values |
| `Analysis`, `analyse` | add `basis: SimilarityBasis`; `sim` and `seriation` now come from the basis (eligible members), excluded members appended in ID order; LOO stays pairwise and is labelled so |
| new `layoutFor(a)` | `EmbeddingJobs` cache keyed by layout identity; NMDS runs in `embed.worker.ts` on the distance matrix only |
| `scheduleDraw`, `render` | dispatch `drawSpace`; display-only paths never touch the layout cache |
| `drawCell`, `underImage`, `overImage` | reused for thumbnails (same pixels/colours as Montage) |
| `drawOverlay` | hover enlargement + neighbour links drawn on the overlay canvas |
| `drawSide`, `drawSimMatrix` | Space panel: basis/stress/provenance, neighbours, member list; matrix highlights focus row + true neighbours |
| `drawRail` | unchanged; Space hover/focus feed `hover`/`state.subject` |
| `renderOrtho`, `goBack`, `updateOrthoHead` | `prevMode` may be `'space'`; back label follows it |
| slice | one `<input type=range>` bound to `state.slice`/cursor axis for Montage/Facet/Space |
| workers | `SmoothPool` unchanged; new single embedding worker owned by `EmbeddingJobs`, terminated on dispose |

## Transition table

| Event | Basis | Layout | Viewport `sv` | Focus | Slice/cursor |
|---|---|---|---|---|---|
| slice / wheel / slider / ↑↓ | keep | keep (no job) | keep | keep | change |
| cursor click on a pixel | keep | keep | keep | set to clicked member | change |
| threshold, range, smoothing, min-cluster, crop | keep | keep | keep | keep | keep |
| sort order | keep | keep (montage/rail reorder only) | keep | keep | keep |
| orientation | keep | keep | keep | keep | slice := cursor plane in new orientation |
| contrast / model / statistic | new basis | new/cached layout; stale results never commit | reset to fit if basis key changes | keep if subject ID exists in new set, else first eligible | keep cursor |
| member missing in new set | — | — | — | falls back by ID lookup, never by index | — |
| Space → Ortho (dbl-click, Enter, Open) | keep | keep | kept in state | the opened member | Ortho may move cursor |
| Ortho → Space (Back/Esc) | keep | keep | restored | member shown in Ortho | **Ortho's current cursor wins** (no stale saved slice) |
| async layout result for old key | — | dropped unless key is current | — | — | — |
| dispose / page unload | — | worker terminated, pending promises rejected | — | — | — |

## Similarity basis (S02)

Default: signed Pearson r on the **common support** — analysis-mask voxels where every eligible member
is finite — with dissimilarity `1 − r ∈ [0, 2]`. Analysis mask = VolumeSet mask (template brain mask ∩
voxels where at least one member is finite and non-zero); finite zeros inside it are valid data.
Exclusion, in order: all-missing → coverage below `minCoverage` (default 0.9 of the mask) → constant on
its finite voxels → constant on the support. If the support has fewer than `minSupport` voxels the basis
reports `insufficient-support` and no layout is fitted (documented fallback; other views keep working).
The existing pairwise `correlationMatrix` keeps its API semantics; the demo switches its matrix and
seriation to the basis (deliberate compatibility change, recorded in the side panel label).

## Synthetic specimens and tests planned before editing

- Unit: hand-computed support/coverage/r on tiny arrays (true zeros, NaNs, constants, unequal coverage,
  sign inversion, scale/offset invariance), mismatched geometry rejection.
- NMDS: R `MASS::isoMDS` / `smacof` goldens with recorded versions; independent stress recompute;
  ties, duplicates, anticorrelation, known planar geometry, planted noisy groups, forced non-convergence,
  n = 0…3, all-tied, all-coincident.
- Jobs: delayed fake runner for A→B→A, coalescing, dispose during work, failure + retry, LRU bound,
  zero jobs during display-only actions.
- Synthetic data server mode (`VS_SYNTHETIC=1`): anisotropic, translated, non-cubic grid; 17 members
  with two planted groups, an outlier, a sign flip, an identical-pattern pair (r = 1, not identical
  bytes), a low-coverage member and a constant member; plus 50- and 200-member sets for performance.
- Browser (Playwright, synthetic only): S1–S3 still render; S4 Space overview/dense/excluded; slider
  moves all members; no refit during scrub; Space→Ortho→Space restoration; keyboard traversal.

## Evidence record (S10, 2026-10-09)

Environment: Apple M3 Max, 14 cores, 36 GB, macOS (Darwin 23.3), Node 26.7, Playwright Chromium 1234
headless, 1440×900, load average 13–18 during runs (shared machine; treat times as upper bounds).

| Gate | Command | Result |
|---|---|---|
| Types | `npm run test:types` | exit 0 |
| Focused units | `npx vitest run tests/VolumeSet*.test.ts` | 6 files, 107 tests pass (basis 12, NMDS 38, jobs 6, space 8, synthetic 17, existing VolumeSet 26) |
| Full units | `npx vitest run --exclude '.claude/**' …` | 103 files, 1289 pass, 8 skipped. Without the exclude, 8 files fail: stale copies under `.claude/worktrees/agent-*` (consumer specs), pre-existing and unrelated |
| Lint | `npm run lint` | 0 errors (599 pre-existing warnings); new src/tests files lint clean |
| Library build | `npm run build:vite` | exit 0 |
| Demo build | `vite build --config examples/volume-set/vite.config.ts` | exit 0; `embed.worker` chunk 11.3 kB |
| Browser gate | `npm run test:e2e:volume-set` (synthetic only) | 15/15 pass |

Performance (`node e2e/volume-set/bench.mjs`; scrub = slider input → drawn frame, two full sweeps of the
axial slider; refits counted from the job controller):

| Set | View | Ready (ms) | Fit (ms, worker) | Method / status | Scrub p50 / p95 (ms) | Refits | Heap (MB) | Canvases | Workers | LOD |
|---|---|---|---|---|---|---|---|---|---|---|
| synth 17 | Space | 631 | 34 | metric-smacof / degenerate-fallback | 16.7 / 17.3 | 0 | 20 | 7 | 1 | thumbs |
| synth 17 | Montage | 448 | – | – | 16.7 / 17.5 | 0 | 28 | 6 | 0 | – |
| synth50 | Space | 1892 | 91 | nmds / converged | 16.7 / 18.2 | 0 | 21 | 7 | 1 | thumbs |
| synth200 | Space | 7826 | 1444 | nmds / converged | 16.7 / 17.6 | 0 | 38 | 7 | 1 | marks |
| synth200 | Montage | 7186 | – | – | 25.1 / 41.5 | 0 | 58 | 6 | 0 | – |
| real glm4 cue, 17 (local only) | Space | 2396 | 25 | nmds / converged | 16.7 / 17.2 | 0 | 73 | 7 | 1 | thumbs |
| real glm4 cue, 17 (local only) | Montage | 2360 | – | – | 26.5 / 33.0 | 0 | 51 | 6 | 0 | – |

Budget chosen from this baseline: scrub p95 ≤ one 60 Hz frame plus 10% (≈ 18.5 ms) for Space at all
measured sizes; fits run in the worker and never block slicing. Degradation strategy: thumbnails →
anchor marks with labels (hover/keyboard enlargement) when the per-map area drops below ~44 px. Ready time
is dominated by loading the maps, not by the layout.

Real data (17 subjects, glm4, t; aggregates only, nothing committed): all members eligible;
common support 235,619 of 235,643 mask voxels; basis r differs from the old pairwise r by at most
9.5e-5; NMDS converged without degeneracy for cue / delayearly / delaylate with Stress-1 0.173 / 0.154 /
0.164, best start reached by 1 / 4 / 1 of 9 starts (local minima are present and reported), mean
3-neighbour preservation 0.49 / 0.57 / 0.59.

Finding during integration: on the strongly clustered synthetic set, NMDS reached Stress-1 ≈ 1e-12 by
collapsing each group to a point (classical NMDS degeneracy). The solver now detects this and falls
back to a labelled metric SMACOF of 1 − r (`degenerate-fallback`), keeping the nonmetric stress for the
record.

Scrub *during* a running fit (synth200, Montage → Space so the fit starts on a loaded set; 92 slider
steps while `layout === 'pending'`; load average 4–6): p50 16.7 ms, p95 18.1 ms, max 72.1 ms; fit
1493 ms in the worker. The two-rAF method quantises latency to whole frames, so these show "no dropped
frames" rather than sub-frame cost.

### Independent review (fresh-context subagent) and disposition

| # | Finding | Disposition |
|---|---|---|
| 1 | Clicking an ID/dot under the enlarged preview moved the cursor | Fixed: labels/dots are select-only and take precedence over pictures and the preview; e2e test added (thumbs and marks) |
| 2 | n = 3 with an r = 1 pair drawn apart (triangle test had no roundoff tolerance) | Fixed in `nmds.ts` (1e-9 relative tolerance); unit test added that fails on the old code |
| 3 | Matrix stale on slice change under "value at cursor" order | Fixed: slice changes redraw the panel when sort = cursor; e2e compares matrix vs rail order across planes |
| 4 | Canvas legend called exact placement "nonmetric MDS" | Fixed (`methodShort`) |
| 5 | Fallback reported "converged" at the iteration cap | Fixed (checks `converged`) |
| 6 | "Stress-1 NaN" caption for one placed map | Fixed (omitted when not finite) |
| 7 | Hover/enlargement keyed by set index across sources | Fixed: keyed by member ID |
| 8 | Disposal on bfcache `pagehide` left Space stuck | Fixed: dispose only when not persisted; controller recreated lazily |
| 9 | Coverage rule could exclude every member when each map stops at its own mask | Fixed: coverage is relative to the median map; unit test added |
| 10 | `layout` URL value ignored; not-placed strip truncation silent; slice label assumed grid axis = world axis; modifier+arrow intercepted; mask rule absent from basis key | Fixed (warning + rewrite; "+N more"; world axis from the affine; modifiers pass through; key includes mask rule) |
| 10 | Superseded fits not cancelled; viewport from a URL not tied to a basis on first load; sampled fingerprint | Accepted and documented (README limitations / here) |
| docs | README fit-time claim contradicted the record; "rank order" wrong for the metric fallback; partial collapse undocumented | Fixed |
| tests | Weak method assertion; reduced motion / narrow width / label clicks untested | Fixed: 4 browser tests added (15 total). Not added: worker-runner unit test (jsdom has no Worker; covered by the browser gate) and an injected failure→Retry browser test |

Final manifest (uncommitted; SHA-256 prefixes, 2026-10-09, HEAD efcdc0fc3bfb + working tree):

```
54b2fb19ecc3 src/volumeset/VolumeSet.ts
cd23e4909ccc src/volumeset/basis.ts
fe504dd0a980 src/volumeset/clusterExtent.ts
b7c4311916cc src/volumeset/embeddingJobs.ts
4f4b303d6235 src/volumeset/nmds.ts
a7a6359ff3d4 src/volumeset/seriation.ts
5c3e34986c1f src/volumeset/smooth.ts
eb625fa70456 src/volumeset/stats.ts
52fae5d6f5c5 examples/volume-set/data.ts
5e6228cc8026 examples/volume-set/embed-runner.ts
4ff32ac7e51e examples/volume-set/embed.worker.ts
e9387efd9f4e examples/volume-set/main.ts
4670e042e59e examples/volume-set/render.ts
d9f95fed5988 examples/volume-set/smooth-pool.ts
949092764d96 examples/volume-set/smooth.worker.ts
575c76f19d93 examples/volume-set/space.ts
f99aeda6cd54 examples/volume-set/synthetic.ts
0ee583cd8c4e examples/volume-set/vite.config.ts
996b502bd271 examples/volume-set/vs-data-plugin.ts
a316e81e83d1 examples/volume-set/index.html
04bb4e406b60 tests/VolumeSet.test.ts
e4b7407fe767 tests/VolumeSetBasis.test.ts
c721e02d7ff7 tests/VolumeSetJobs.test.ts
98bbf84c5d7a tests/VolumeSetNmds.test.ts
e3cfb52366b2 tests/VolumeSetSpace.test.ts
e6ba99d1ec82 tests/VolumeSetSynthetic.test.ts
fa783844a4c3 e2e/volume-set/bench.mjs
2402a2ec5709 e2e/volume-set/space.spec.ts
d78c7c9f7097 playwright.volume-set.config.ts
```
