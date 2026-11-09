/**
 * The NFTab Summary Profile's interval registry (interval-kinds.json,
 * version 0.1.0), as vendored from neurotabs. Do not edit by hand:
 * tests/tabs/summary.test.ts checks it equals the pinned artifact.
 */
export const SUMMARY_REGISTRY_VERSION = '0.1.0';

export interface IntervalKind {
  id: string;
  statistics: string[];
  level: 'none' | 'confidence' | 'central_mass' | 'calibration';
  label: string;
  formula?: string;
  needs_design: boolean;
  single_cell: boolean;
}

export const INTERVAL_KINDS: readonly IntervalKind[] = [
  {
    "id": "none",
    "statistics": [
      "mean",
      "median",
      "custom"
    ],
    "level": "none",
    "label": "No interval",
    "formula": "No bounds",
    "needs_design": false,
    "single_cell": false
  },
  {
    "id": "sd",
    "statistics": [
      "mean"
    ],
    "level": "none",
    "label": "± SD",
    "formula": "estimate ± sample SD (n−1)",
    "needs_design": false,
    "single_cell": true
  },
  {
    "id": "se",
    "statistics": [
      "mean"
    ],
    "level": "none",
    "label": "± SE",
    "formula": "estimate ± SE",
    "needs_design": false,
    "single_cell": true
  },
  {
    "id": "ci_normal",
    "statistics": [
      "mean",
      "custom"
    ],
    "level": "confidence",
    "label": "{percent}% CI (normal)",
    "formula": "estimate ± normal_quantile((1+level)/2) × SE",
    "needs_design": false,
    "single_cell": true
  },
  {
    "id": "ci_t",
    "statistics": [
      "mean",
      "custom"
    ],
    "level": "confidence",
    "label": "{percent}% CI (t)",
    "formula": "estimate ± t_quantile((1+level)/2, df) × SE",
    "needs_design": false,
    "single_cell": true
  },
  {
    "id": "quantile_range",
    "statistics": [
      "mean",
      "median"
    ],
    "level": "central_mass",
    "label": "{percent}% quantile range",
    "formula": "type-7 sample quantiles at (1−level)/2 and (1+level)/2",
    "needs_design": false,
    "single_cell": true
  },
  {
    "id": "wsci_cm",
    "statistics": [
      "mean"
    ],
    "level": "confidence",
    "label": "{percent}% within-subject CI (Cousineau–Morey)",
    "formula": "raw cell mean ± t_quantile((1+level)/2, n−1) × normalized SE × sqrt(J/(J−1))",
    "needs_design": true,
    "single_cell": false
  },
  {
    "id": "heuristic_se",
    "statistics": [
      "mean"
    ],
    "level": "calibration",
    "label": "Heuristic band ({percent}% calibration; not a CI)",
    "formula": "regional mean ± normal_quantile((1+level)/2) × mean_voxel_se",
    "needs_design": false,
    "single_cell": false
  },
  {
    "id": "custom",
    "statistics": [
      "mean",
      "median",
      "custom"
    ],
    "level": "none",
    "label": "{definition}",
    "formula": "Stored bounds; see interval_definition",
    "needs_design": false,
    "single_cell": false
  }
] as const as readonly IntervalKind[];
