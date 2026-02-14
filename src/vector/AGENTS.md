<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-02-13 | Updated: 2026-02-13 -->

# vector

## Purpose
Large-scale 4D vector implementations for handling very large fMRI datasets that may not fit in memory as a single contiguous array.

## Key Files

| File | Description |
|------|-------------|
| `BigNeuroVec.ts` | `BigNeuroVec` and `bigNeuroVecSeq` — chunked 4D storage that breaks data into manageable blocks |

## For AI Agents

### Working In This Directory
- `BigNeuroVec` splits the time dimension into chunks for memory-efficient access.
- `bigNeuroVecSeq` creates a sequence of BigNeuroVec chunks.
- Useful for datasets too large for a single TypedArray (> 2GB).

### Testing Requirements
- Tests in `tests/BigNeuroVec.test.ts`.

<!-- MANUAL: -->
