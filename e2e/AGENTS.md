<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-02-13 | Updated: 2026-02-13 -->

# e2e

## Purpose
Playwright end-to-end tests that exercise the browser-based viewer components with real WebGL rendering. Tests load HTML fixtures, interact with viewers, and compare visual snapshots.

## Key Files

| File | Description |
|------|-------------|
| `orthogonal-viewer.spec.ts` | Orthogonal 3-view viewer E2E tests |
| `overlay.spec.ts` | Volume overlay rendering tests |
| `simple-ortho-roi.spec.ts` | ROI overlay on orthogonal viewer tests |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `fixtures/` | HTML pages loaded by E2E tests |
| `overlay.spec.ts-snapshots/` | Visual regression baseline screenshots |

## For AI Agents

### Working In This Directory
- Run with `npm run test:e2e` (requires `npx playwright install` first).
- Fixtures in `fixtures/` are standalone HTML pages that load the Vite bundle.
- Snapshot baselines are platform-specific (chromium-darwin).
- Update snapshots with `npm run test:e2e:update`.

### Testing Requirements
```bash
npm run build:vite       # Must build browser bundle first
npm run test:e2e         # Run E2E tests
npm run test:e2e:headed  # Run with visible browser
```

<!-- MANUAL: -->
