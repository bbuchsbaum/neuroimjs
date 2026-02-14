<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-02-13 | Updated: 2026-02-13 -->

# atlas

## Purpose
Brain atlas integration. Provides atlas loading and TemplateFlow template retrieval for standard neuroimaging reference spaces (MNI152, etc.).

## Key Files

| File | Description |
|------|-------------|
| `NeuroAtlas.ts` | `NeuroAtlas` — atlas loading, label lookup, coordinate-to-region mapping |
| `TemplateFlow.ts` | `TemplateFlow` — client for fetching standard templates from TemplateFlow |

## For AI Agents

### Working In This Directory
- `NeuroAtlas` loads parcellation volumes and provides label-based queries.
- `TemplateFlow` fetches templates by name/resolution (e.g., MNI152NLin2009aAsym).
- Used by the display system for coordinate annotation.

### Testing Requirements
- Tests in `tests/NeuroAtlas.test.ts`.

<!-- MANUAL: -->
