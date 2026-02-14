<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-02-13 | Updated: 2026-02-13 -->

# utils

## Purpose
Display-specific utility functions.

## Key Files

| File | Description |
|------|-------------|
| `debounce.ts` | Debounce utility for rate-limiting UI updates during rapid slice navigation |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `__tests__/` | Debounce unit tests |

## For AI Agents

### Working In This Directory
- `debounce` is used by slice controllers to prevent excessive re-renders during continuous scrolling/dragging.

### Testing Requirements
- Tests in `__tests__/debounce.test.ts`.

<!-- MANUAL: -->
