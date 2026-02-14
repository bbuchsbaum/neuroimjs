<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-02-13 | Updated: 2026-02-13 -->

# testing

## Purpose
Test utility factories for creating synthetic neuroimaging data in tests.

## Key Files

| File | Description |
|------|-------------|
| `TestVolumeFactory.ts` | `TestVolumeFactory` — creates test volumes with known patterns (gradient, sphere, checkerboard, etc.) for unit tests |

## For AI Agents

### Working In This Directory
- Use `TestVolumeFactory` in tests instead of loading real NIfTI files for speed.
- Factory creates `DenseNeuroVol` instances with configurable dimensions and fill patterns.
- Exported from the public API for downstream test use.

<!-- MANUAL: -->
