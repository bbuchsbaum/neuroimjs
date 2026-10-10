# Volume Set Space v3: what drives the layout, and how much of it is noise

Follows Space v2 (`docs/plans/volume-set-space-v2.md`). Parcels come from neuroatlasjs (devDependency,
pinned GitHub commit; dogfooded, with friction logged upstream). Space code stays in
`examples/volume-set/space-view.ts` / `space-extras.ts`; numerics in `src/volumeset/explain.ts` and
`src/volumeset/reliability.ts` (pure, worker-safe, unit-tested against independent references).

Ground rules from v1/v2 hold: positions are data; numbers are raw or exactly defined; nothing implies
inference; every decomposition is checked to sum to the quantity it claims to explain.

## Definitions

Let zᵢ be map i standardised on the basis support S (|S| = N, mean 0, population SD 1), so
rᵢⱼ = (1/N)·Σᵥ zᵢzⱼ and 1 − rᵢⱼ = (1/2N)·Σᵥ (zᵢ − zⱼ)². With β and SE frames (data.ts STAT_FRAME 0 and 3),
let σᵢ be the SD of βᵢ over S, so the noise variance of zᵢ(v) is SEᵢ(v)²/σᵢ².

| Quantity | Definition | Sums to (exact; unit-tested) |
|---|---|---|
| Dispersion D(v) | (1/2N)·Σᵢ<ⱼ (zᵢ − zⱼ)² = (k/2N)·Σᵢ (zᵢ − z̄)² | Σᵢ<ⱼ (1 − rᵢⱼ) |
| Noise floor F(v) | expected D(v) if every map had the same true pattern: (k/2N)·(k−1)/k·Σᵢ SEᵢ(v)²/σᵢ² (to be derived and tested by simulation) | expected Σᵢ<ⱼ (1 − rᵢⱼ) under shared pattern |
| Focused map i | signed: zᵢ − z̄₋ᵢ; squared share (1/2N)·(zᵢ − z̄₋ᵢ)² plus the others' baseline (1/2N)·s²₋ᵢ(v) | mean over j≠i of (1 − rᵢⱼ) |
| Groups A, B | (1/2N)·[(z̄_A − z̄_B)² + s²_A + s²_B] for the between-group mean; within-group means carry n/(n−1) | between-group mean dissimilarity (and the stated within-group form) |
| Reliability ρᵢ | 1 − mean_S(SEᵢ²)/Var_S(βᵢ) | — (noise ceiling √(ρᵢρⱼ); Spearman-corrected r = r/√(ρᵢρⱼ), clamped, flagged when ρ is small) |
| Heterogeneity | per parcel on parcel-mean β and SE: Q, I² = max(0, (Q − (k−1))/Q), τ² (DerSimonian–Laird) | — (simulation: homogeneous data gives E[I²] ≈ 0) |

## Items

| ID | Item | Contract |
|---|---|---|
| V3-01 | Reliability and noise ceiling | Load β and SE lazily (only when used), cached per analysis. ρᵢ per map as a Mark; a noise scale bar ("two noisy copies of one map would sit this far apart", 1 − ρ̄); panel lists maps by ρ. States that SEs are assumed calibrated. |
| V3-02 | Exact decomposition | `explain.ts`: dispersion, focused-map and group terms on the basis z, noise floor subtracted; scope follows existing state (nothing / focused / lasso group). Picture in the reference column; signed map for a focused map. |
| V3-03 | Parcel shares via neuroatlasjs | Build a `VolumeAtlas` from the template dseg + tsv; per-parcel sums of each term; ranked table with share and per-voxel density, mass outside the atlas, concentration ("x% in k parcels") with a random-split reference; rows jump to the slice. Synthetic mode gets a small generated parcellation. |
| V3-04 | Noise-corrected layout option | Spearman-corrected similarity as an alternative basis (in the key), shown via the existing aligned transition; maps with low ρ flagged; never the default. |
| V3-05 | Parcel brushing | Click a parcel row: Marks show each map's parcel-mean z; the parcel is outlined on the Mean picture. |
| V3-06 | Parcel influence | Leave-one-parcel-out dissimilarities from the per-parcel sums (no refit); rank parcels by the Mantel correlation of full vs reduced dissimilarities and by the current layout's stress against the reduced ones. |
| V3-07 | Heterogeneity per parcel | Q, I², τ² on parcel means; table column and an I² mask over the divergence picture; labelled "effect heterogeneity (β)" vs "pattern divergence (z)". |
| V3-08 | Covariate arrows | envfit-style vectors for participants.tsv columns on the layout, with permutation p-values (valid: covariates did not build the layout). Voxel/parcel arrows deferred (circular). |
| V3-09 | Qualification | Unit identities, simulations, e2e for each item, a hill-climb round, evidence in this note. |

## Order

V3-01, then V3-02 + V3-03, then V3-04 and V3-05, then V3-06 to V3-08, then V3-09. V3-01 comes first because it
does not need parcels and may change how every existing layout should be read.
