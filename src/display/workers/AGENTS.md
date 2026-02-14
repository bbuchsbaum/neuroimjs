<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-02-13 | Updated: 2026-02-13 -->

# workers

## Purpose
Web Worker infrastructure for offloading slice extraction and image processing from the main thread. Keeps the UI responsive during heavy volume operations.

## Key Files

| File | Description |
|------|-------------|
| `SliceWorker.ts` | Web Worker entry point — handles slice extraction, processing, and resampling messages |
| `WorkerPool.ts` | Pool of reusable Web Workers with task queuing |
| `WorkerService.ts` | High-level service API that dispatches tasks to the worker pool |

## For AI Agents

### Working In This Directory
- Workers communicate via `postMessage` with typed data from `../types/display.ts`.
- `WorkerService` is the public interface — consumers don't interact with workers directly.
- Worker pool size adapts to `navigator.hardwareConcurrency`.
- See `WORKER_USAGE.md` for integration patterns.

### Testing Requirements
- Workers require a real browser environment — test via E2E tests.
- Unit tests can mock `WorkerService` responses.

<!-- MANUAL: -->
