# neuroimjs — Audit & Fix Plan

_10-agent end-to-end audit, 2026-06-02. Work items are tracked in `mote` (run `mote ready`)._

## ✅ Resolution (2026-06-02 — all 26 tracked beads completed)

Every item below has been fixed, each with a regression/invariant/golden test, and the
library is now in a publishable state.

**Final state:**
- **Tests:** 962 passing / 0 failing / 8 skipped (was 883 passing / 3 failing). +79 net tests.
- **Types:** `tsc --noEmit` clean under full `strict`.
- **Lint:** `npm run lint` restored (ESLint 9 flat config) and exits 0.
- **Package:** `npm run build` produces a complete artifact (CJS + ESM + types + browser ES/UMD);
  `npm pack` ships **0 test files** (was 57); `prepublishOnly` now also builds the browser bundle.

**P0 correctness (data/pixel-corruption bugs) — all fixed & tested:** NIfTI `scl_slope`/`scl_inter`
on read; big-endian byte-swap; write-path qform + dtype rounding; `reorient()` world-coordinate
preservation (affine∘permutation); spacing-aware (mm) spherical ROI/searchlight; dilate/erode
`Number.MIN_VALUE`→±Infinity; `Resampler.transform()` implemented; `temporalFilter` real DFT
band-pass; `getSliceAt` world-routed sampling; BigNeuroVec X↔Z transpose; ColorMap NaN→transparent;
sprite-pool leak; cubic/Lanczos boundary bias.

**P1 publish/test:** build no longer ships tests (+ removed `TestVolumeFactory` export); `exports`
types-first; ESLint restored; PIXI-v8 mocks fixed + e2e excluded from vitest; comprehensive
invariant/golden tests added.

**P2 consolidation:** dual NIfTI impls merged; triple ROI hierarchy consolidated (NeuroAtlas
migrated, legacy `ROI.ts` deleted); NeuroSpace mutable-getter leak + affine-spacing fixed; vec
temporal math deduped (`temporalOps.ts`); dead code removed (`roi/Searchlight.ts`, ColorMap LUT,
worker stub now throws); viewer architecture documented + canonical API designated.

**P3 hygiene:** stats overflow/NaN-safety; separable Gaussian + kernel-size; stale `cypress` dep
removed; `as any` surfaced as lint warnings.

> A few items were intentionally deferred to a **major version** (they are public-API breaking):
> unifying the `NeuroVec`/`INeuroVec` interfaces, and structurally merging the two viewer
> coordination mechanisms (MobX vs EventEmitter). Both are documented; current behavior is preserved.

---

## Verdict (original audit — for reference)

A capable, ambitious neuroimaging library with **good architectural bones and several genuinely
strong subsystems, but not yet production-sound or publish-ready at `0.1.0`.** The problems are
concentrated and fixable, not foundational.

| Question | Verdict |
|---|---|
| Sound? | **No (yet)** — ~13 silent-correctness bugs in core ops (reorient, slicing, NIfTI scaling/endianness, searchlight geometry, resampling, filtering) that produce wrong numbers/pixels with no error. |
| Well-architected? | **Partially** — clean layering & dependency direction, but grown by accretion ("two or three of everything"). |
| Well-tested? | **Mixed** — strong culture (883 passing, assertion-dense, clean strict types) but tests ratify bugs and use fixtures that hide the worst ones. |
| Modular? | **At the boundaries yes**, within them duplicative + dead-code-laden. |

**Empirically verified:** `tsc --noEmit` clean (full `strict`); vitest **883 passed / 3 failed / 8 skipped**
(3 real failures from PIXI-v8 mock gaps; 6 false e2e collection failures).

## Per-domain grades

| Domain | Sound | Arch | Test | Modular |
|---|:--:|:--:|:--:|:--:|
| Geometry & coordinates | D | C | C− | B |
| 3D volume structures | C+ | B+ | B− | B |
| 4D/5D vec & hypervec | C− | C | D+ | C− |
| I/O (NIfTI) | D | C− | D | D |
| Display core (MVC/viewers) | C+ | C | C | C+ |
| Layers & colormaps | D+ | C | C− | C+ |
| Display infra | C+ | C | B− | B− |
| Spatial & resampling | D+ | C+ | D | C+ |
| Stats/searchlight/ROI/atlas | D+ | D | C− | D |
| Test/build/packaging | B (types) | — | A− (quality) | D (packaging) |

## Five systemic patterns

1. **Accretion ("two of everything").** Two NIfTI impls; two viewer stacks; three ROI hierarchies; dual `NeuroVec`/`INeuroVec`; triplicated colormap + temporal-stats code; two caches + an ad-hoc `Map`. `_improved`/`Enhanced`/`Simple` prefixes are the tell.
2. **The same bug, copy-pasted.** `Number.MIN_VALUE`-as-"most-negative" in both `getRange` and `dilate`; mm-vs-voxel confusion across geometry/ROI/searchlight.
3. **Tests that ratify bugs.** reorient asserted by value-equality (bakes in wrong answer); `getSliceAt` tested for non-singularity not values; I/O self-round-trips where reader+writer bugs cancel; loose interpolation tolerances; isotropic/cubic-only fixtures.
4. **Aspirational code presented as working.** `transform()`, `temporalFilter`, `buildLookupTable`, the display worker stack, AFNI format, hypervec `glm`/`save`/`view`/`correlateAlong`.
5. **Leaked mutable state.** `NeuroSpace.origin`/`spacing` getters, axial `getSlice` subarray, `FacadeVolLayer` stale state.

## Genuine strengths (preserve these)

- Clean `tsc --noEmit` under full `strict`.
- Correct numerical cores: connected-components BFS, stats (two-pass variance, Bessel), interpolation interior math (Catmull-Rom, Lanczos), guided/bilateral filters (He et al.).
- Solid infra primitives: `LRUCache`, object pools, `debounce`/`throttle`, `Logger`.
- Clean seams: geometry/data have zero display deps; PIXI isolated; colormap/VolLayer renderer-agnostic.
- Correct dual CJS/ESM packaging; sensible peerDependency classification.

## Fix plan (tracked in mote — `mote ready`)

### P0 — Release-blocking correctness (data/pixel corruption)
- `bd-…PHA4` io: apply scl_slope/scl_inter on read
- `bd-…HP31` io: byte-swap big-endian image data on read
- `bd-…E6J0` io: write-path correctness (qform, scl, dtype rescale, writeVec order)
- `bd-…8GTZ` geometry: reorient() preserve world coordinates
- `bd-…VD05` analysis: spacing-aware sphericalROI + searchlight radius (mm vs voxel)
- `bd-…1FNJ` spatial/volume: Number.MIN_VALUE bug (dilate/erode, getRange)
- `bd-…Z474` resampling: Resampler.transform() no-op
- `bd-…1CGH` vec: temporalFilter silent no-op
- `bd-…WBXS` volume: getSliceAt identity-transform (wrong slices; feeds live crosshair)
- `bd-…F770` vec: BigNeuroVec X↔Z transpose (non-cubic)
- `bd-…EQ8G` colormap: NaN voxels → transparent, not opaque black
- `bd-…PGFF` display: sprite pool leak in releaseActiveContainers
- `bd-…D9CD` resampling: cubic/Lanczos boundary renormalization bias

### P1 — Publish blockers + test integrity
- `bd-…KA8W` build: stop shipping test files + TestVolumeFactory export
- `bd-…D5QY` build: exports types-first + restore lint
- `bd-…3GZ4` test: fix PIXI v8 mock; exclude e2e/ from vitest
- `bd-…NGCF` test: add invariant + golden tests (reorient/getSliceAt/NIfTI fixture/anisotropic)

### P2 — Architecture consolidation (do after same-area P0)
- `bd-…JJX3` io: consolidate the two NIfTI implementations into one
- `bd-…TFP3` analysis: consolidate the triple ROI hierarchy (migrate NeuroAtlas)
- `bd-…JDW4` display: consolidate the two viewer stacks and Slice* naming
- `bd-…H2T6` geometry: stop leaking internal mutable arrays + slice aliasing
- `bd-…B0FA` vec: unify NeuroVec/INeuroVec and dedupe temporal math
- `bd-…3SD9` cleanup: remove or wire dead/aspirational code

### P3 — Hygiene
- `bd-…JQT0` analysis: stats robustness (NaN handling, seeded RNG, spread overflow)
- `bd-…BEAW` spatial: separable Gaussian + correct kernel-size formula
- `bd-…P33Z` hygiene: repo cleanup (root .md dumps, stale deps, display as-any)

## Recommended order

1. **P0 first**, starting with NIfTI scaling/endianness (`…PHA4`, `…HP31`) and reorient/searchlight spacing
   (`…8GTZ`, `…VD05`) — these silently corrupt the exact data the library exists to handle.
2. Land **P1 test integrity** alongside P0 so fixes are locked in by invariant/golden tests rather than
   bug-ratifying assertions.
3. **P2 consolidation** per area only after that area's P0 correctness lands (e.g. merge the two NIfTI
   impls after the I/O fixes).
4. **P3 hygiene** last.

_Bead IDs above are abbreviated; run `mote show <full-id>` or `mote ready` for full IDs, bodies, and file:line references._
