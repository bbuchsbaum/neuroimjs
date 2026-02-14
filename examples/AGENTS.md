<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-02-13 | Updated: 2026-02-13 -->

# examples

## Purpose
Usage examples and interactive demos for neuroimjs. Includes both Node.js scripts (tsx-based) for server-side slice extraction and HTML pages for browser-based viewer demos.

## Key Files

| File | Description |
|------|-------------|
| `composable-views-index.html` | Index page linking all composable view demos |
| `single-axial-view.html` | Single axial slice viewer demo |
| `two-view-sync.html` | Two synchronized slice views demo |
| `multi-panel-custom-layout.html` | Custom multi-panel layout demo |
| `multi-layer-viewer.html` | Multi-layer overlay viewer demo |
| `load_image.ts` | Node.js NIfTI loading example |
| `extract_orthogonal_slices.ts` | Node.js orthogonal slice extraction |
| `orthogonal_slice_demo.ts` | Node.js orthogonal slicing demo |
| `thumbnails.ts` | Thumbnail generation script |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `simple_viewer/` | Minimal standalone viewer example |
| `sliceviewer/` | SliceViewer component example |
| `umd/` | UMD bundle usage example |
| `mona_lisa/` | Fun non-medical image viewer demo |
| `rain/` | Rain effect demo |

## For AI Agents

### Working In This Directory
- HTML demos load the Vite browser bundle from `dist/`.
- Run `npm run build:vite` before testing HTML demos.
- Node.js examples run with `tsx` (e.g., `npm run demo:ortho`).
- The MNI152 template NIfTI is bundled in `simple_viewer/` and `sliceviewer/`.

<!-- MANUAL: -->
