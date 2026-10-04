# npm Scripts and Testing

Contributor reference for the scripts in `package.json`. Releases are covered in [`RELEASING.md`](../RELEASING.md).

## Building

```bash
npm run build              # Full build: CJS + ESM + type declarations
npm run build:cjs          # CommonJS only
npm run build:esm          # ES modules only
npm run build:types        # Type declarations only
npm run build:vite         # Browser bundles (dist/neuroimjs.es.js, UMD)
npm run build:quick        # Quick CJS build during development
```

## Testing

```bash
npm test                   # Vitest (jsdom); watch mode in a terminal
npm test -- --run --silent # One pass, quiet (what CI runs)
npm run test:watch         # Watch mode
npm run test:types         # tsc --noEmit
npm run test:specific -- tests/io.test.ts   # One file, verbose reporter
npm run test:debug         # Verbose, no coverage
npm run test:alignment     # Multi-layer alignment integration tests
npm run test:conformance   # NIfTI decoders vs nibabel-generated fixtures
npm run conformance:generate   # Regenerate those fixtures (needs uv; pins Python + nibabel)
npm run test:e2e           # Playwright browser tests (starts `npm run dev`)
npm run test:e2e:update    # Refresh Playwright screenshot baselines
npm run test:package       # Check the packed tarball
npm run test:consumers     # Downstream consumer contract tests against the tarball
```

Unit tests live in `tests/` and in `src/**/__tests__/`; Playwright tests in `e2e/`. PIXI.js and canvas are mocked in `tests/setup.ts`. Only Linux Playwright baselines are committed, because CI renders on Ubuntu.

A filter narrows a run to matching test names:

```bash
npm run test:specific -- -t "should cache alignment"
```

When a test builds layers on volumes of different sizes, choose slice indices that are valid for every volume in the stack: the pinned axis of the view (k for axial, j for coronal, i for sagittal) bounds the index.

## Checks run before a release

```bash
npm run verify:release     # types, lint, unit tests, builds, bundle size,
                           # package and consumer checks, API docs, npm audit
npm run lint               # ESLint on src and tests
npm run lint:ci            # ESLint with the CI warning budget
npm run check:bundle-size
npm run audit:prod         # npm audit of runtime dependencies
```

`prepublishOnly` runs `verify:release`.

## Documentation site

```bash
npm run docs:dev           # TypeDoc API + VitePress dev server
npm run docs:build         # Static site in docs/.vitepress/dist
npm run docs:preview       # Serve the built site
npm run docs:api           # Regenerate docs/api only
```

## Demos

```bash
npm run demo:composable    # Index of the composable-view demos (Vite dev server)
npm run demo:single-view   # Single axial view
npm run demo:two-view      # Two synchronized views
npm run demo:multi-panel   # Custom multi-panel layout
npm run demo:multi-layer   # Multi-layer viewer
npm run demo:overlay-review    # Group overlay review with synthetic data
npm run demo:simple-ortho  # Builds the UMD bundle, then serves the classic 3-view page
npm run serve:examples     # Static server for the repository (http-server)
```

The Vite demos import the library from `src/` and need no build. Node demos (`demo:ortho`, `demo:extract`, `demo:test-ortho`, `demo:load`, `demo:thumbs`) run TypeScript under `tsx`; some need local data files, and those that write images use the `canvas` dev dependency.
