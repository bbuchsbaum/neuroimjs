# Changelog

All notable changes to neuroimjs are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/). Add an entry under **Unreleased**
in the pull request that makes the change.

## Unreleased

### Added

- Alignment strategy `'world'`: a layer on a different voxel grid from layer 0
  (voxel size, dimensions or origin) is sliced on its own grid at the plane
  nearest the reference plane and drawn at its world position. It is left out
  where the reference plane falls outside its slab.
  `SimpleOrthogonalViewerOptions.alignmentStrategy` sets it at construction;
  `OrthogonalImageViewer` per-view layers now inherit the strategy. (#6)

### Changed

- Require Node.js 22 or later (`engines.node` was `>=20.19`). pixi.js 8, a
  runtime dependency, reads `navigator` when it loads, so `require('neuroimjs')`
  and `import 'neuroimjs'` already threw `ReferenceError: navigator is not
  defined` on Node 20, which reached end of life in April 2026.
- **Behaviour change:** `ImageLayer` defaults to `alignmentStrategy: 'world'`
  (was `'auto'`), also when alignment options omit `strategy`. Overlays on a
  different grid from layer 0 were previously drawn at the reference slice index
  and fitted to the slice bounds, which misregistered them. Same-grid stacks are
  unaffected. Pass `alignmentStrategy: 'auto'` / `{ strategy: 'auto' }` or call
  `setAlignmentStrategy('auto')` for the old behaviour. (#6)

### Fixed

- `readVol` and the other NIfTI readers work when the library runs inside a
  `vm` context without a dynamic-import hook (vitest/vite-node on Node < 26,
  Jest). They failed with `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`.
- A pooled sprite reused as a reference sprite no longer keeps the position and
  pivot of its previous use as an offset overlay (`SpritePool.acquire` resets
  them). (#6)

### Security

- Update axios to 1.20.0 (high-severity advisory affecting 1.0.0–1.19.0).

### Tests and CI

- The unit and browser suites no longer need git-ignored data or the network.
  `scripts/prepare-test-data.mjs` (a vitest and Playwright global setup) copies
  the committed MNI152 template into `tests/data/` after a SHA-256 check. The
  Glasser and Schaefer loader tests run against synthetic files with the
  published geometry, datatypes and label formats; set
  `NEUROIMJS_NETWORK_TESTS=1` to use the real downloads (weekly `network` job).
- Commit Linux baselines for the `overlay.spec.ts` screenshots; the old local
  baselines predated the single application of layer opacity and the viewer
  filling its container.
- CI runs on Node 22 (canonical), 24 and 26, and uploads Playwright results on
  failure.

## 0.4.0 - 2026-09-24

Changes up to this version are described in the commit history up to the
`v0.4.0` tag.
