<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-02-13 | Updated: 2026-02-13 -->

# logging

## Purpose
Configurable logging system for display components. Provides per-module log levels to control verbosity during development and debugging.

## Key Files

| File | Description |
|------|-------------|
| `Logger.ts` | `Logger` class — configurable logger with level filtering |
| `LoggerConfig.ts` | `LoggerConfig` — global log level configuration per module |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `__tests__/` | Logger unit tests |

## For AI Agents

### Working In This Directory
- Import `Logger` and create per-module instances with a module name.
- Set log levels via `LoggerConfig` to control output during debugging.
- See `LOGGING_GUIDE.md` for usage patterns.

### Testing Requirements
- Tests in `__tests__/Logger.test.ts`.

<!-- MANUAL: -->
