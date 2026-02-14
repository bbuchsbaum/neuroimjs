<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-02-13 | Updated: 2026-02-13 -->

# resampling

## Purpose
Volume resampling and interpolation. Supports nearest-neighbor, trilinear, cubic, and sinc interpolation methods for transforming volumes between different coordinate spaces or resolutions.

## Key Files

| File | Description |
|------|-------------|
| `IResampler.ts` | Interface and option types: `IResampler`, `InterpolationMethod`, `ResampleOptions`, `TransformOptions` |
| `Resampler.ts` | `Resampler` implementation and `addResamplingToNeuroVol` mixin |

## For AI Agents

### Working In This Directory
- `Resampler` takes a source volume and target space, producing a resampled volume.
- `addResamplingToNeuroVol` augments volumes with `.resample()` method.
- Interpolation quality: nearest < linear < cubic < sinc.
- Used for atlas registration and multi-resolution analysis.

### Testing Requirements
- Tests in `tests/resampling/Resampler.test.ts`.

<!-- MANUAL: -->
