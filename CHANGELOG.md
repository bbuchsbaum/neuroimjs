# Changelog

All notable changes to neuroimjs are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/). Add an entry under **Unreleased**
in the pull request that makes the change.

## Unreleased

### Changed

- Require Node.js 22 or later (`engines.node` was `>=20.19`). pixi.js 8, a
  runtime dependency, reads `navigator` when it loads, so `require('neuroimjs')`
  and `import 'neuroimjs'` already threw `ReferenceError: navigator is not
  defined` on Node 20, which reached end of life in April 2026.
- The display logger starts at WARN instead of DEBUG, so viewers no longer flood
  the host console. Opt in with `NEUROIMJS_LOG_LEVEL` / `NEUROIMJS_DEBUG`
  (global or environment variable) or `setLogLevel()` / `enableDebugLogging()`;
  the logging controls are exported from both entry points. (#5)

### Fixed

- `readVol` and the other NIfTI readers work when the library runs inside a
  `vm` context without a dynamic-import hook (vitest/vite-node on Node < 26,
  Jest). They failed with `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`.
- Disposing a `SliceView` or `OrthogonalImageViewer` cancels its pending resize
  frames, so a resize just before `dispose()` no longer runs against the
  destroyed PIXI application. `OrthogonalImageViewer.dispose()` is idempotent
  and `SliceView.isDisposed` is new. (#2)
- `OrthogonalImageViewer` handles ArrowLeft/ArrowRight only when focus is on the
  page itself or inside one of its slice panes, so sliders and text fields
  elsewhere on the page keep their arrow keys. (#3)

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
