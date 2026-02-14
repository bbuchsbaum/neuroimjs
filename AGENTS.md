<!-- Generated: 2026-02-13 | Updated: 2026-02-13 -->

# neuroimjs

## Purpose
A comprehensive neuroimaging library for JavaScript/TypeScript providing volumetric data structures, NIfTI I/O, spatial processing, statistical analysis, and WebGL-based slice visualization. Supports both Node.js (full API) and browser (display-focused) environments.

## Key Files

| File | Description |
|------|-------------|
| `src/index.ts` | Node.js entry point — full public API |
| `src/browser.ts` | Browser entry point — display-safe subset |
| `src/types.ts` | Core type definitions (TypedArray, coordinates, shapes, errors) |
| `package.json` | Dependencies and build/test/demo scripts |
| `vite.config.ts` | Vite config for browser ES/UMD bundle |
| `vitest.config.ts` | Vitest test runner configuration |
| `playwright.config.ts` | Playwright E2E test configuration |
| `tsconfig.json` | Root TypeScript config |
| `CLAUDE.md` | AI assistant instructions for this codebase |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `src/` | All source code (see `src/AGENTS.md`) |
| `tests/` | Unit and integration tests (see `tests/AGENTS.md`) |
| `docs/` | Design docs and migration guides (see `docs/AGENTS.md`) |
| `e2e/` | Playwright end-to-end tests (see `e2e/AGENTS.md`) |
| `examples/` | Usage examples and demo HTML pages (see `examples/AGENTS.md`) |
| `output/` | Generated slice images from demos (not source-controlled) |
| `archive/` | Deprecated code kept for reference |
| `scripts/` | One-off migration and utility scripts |

## For AI Agents

### Working In This Directory
- Dual entry points: `src/index.ts` (Node) and `src/browser.ts` (browser). Browser entry excludes Node-specific modules (fs, canvas).
- Build produces CJS, ESM, and type declarations plus a Vite browser bundle.
- MobX for reactive display state, PIXI.js v8 for WebGL rendering.
- TypedArrays back all volume data — never use plain `number[]` for voxel storage.

### Build & Test
```bash
npm run build          # Full CJS + ESM + types
npm run build:vite     # Browser bundle
npm test               # Vitest (jsdom environment)
npm run test:e2e       # Playwright browser tests
npm run test:types     # tsc --noEmit type check
```

### Coordinate Systems
Three coordinate spaces: **grid** (integer voxel [i,j,k]), **world** (mm via affine), **image** (rendered pixel). `CoordinateTransformer` converts between them.

### Key Dependencies
- `pixi.js` ^8.4 — WebGL rendering
- `mobx` ^6.13 — reactive state
- `pako` — gzip for NIfTI I/O
- `nifti-reader-js` — NIfTI parsing (devDep, used at build)
- `chroma-js` — color interpolation for colormaps
- `lit` / `lit-element` — web components for UI controls

<!-- MANUAL: -->
