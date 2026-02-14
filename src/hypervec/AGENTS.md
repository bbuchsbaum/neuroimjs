<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-02-13 | Updated: 2026-02-13 -->

# hypervec

## Purpose
5D+ hyperdimensional data structures for complex neuroimaging datasets (e.g., multi-run, multi-condition fMRI). Extends the 4D NeuroVec concept with arbitrary additional dimensions.

## Key Files

| File | Description |
|------|-------------|
| `INeuroHyperVec.ts` | Interface: `INeuroHyperVec`, `DimensionInfo`, `ReductionOp`, `ReductionOptions`, `FeatureExtractionOptions` |
| `NeuroHyperVec.ts` | `DenseNeuroHyperVec` implementation and `createNeuroHyperVec` factory |

## For AI Agents

### Working In This Directory
- HyperVec extends NeuroVec with named extra dimensions (`DimensionInfo`).
- Supports reduction operations across dimensions (mean, max, etc.).
- Feature extraction collapses dimensions for machine learning pipelines.

### Testing Requirements
- Tests in `tests/hypervec/NeuroHyperVec.test.ts`.

<!-- MANUAL: -->
