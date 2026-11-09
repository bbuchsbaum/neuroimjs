# NFTab Summary Profile 0.1.0 (draft)

This optional NFTab extension exchanges stored estimates and interval bounds.
It builds on neuromosaic's summary tables and brainflow2's interval vocabulary.
A producer needs one table descriptor and four columns. Design declarations,
plot instructions, and calculation support are optional.

This is a reviewable draft, not a released compatibility promise. The prose,
schemas, registry, and conformance fixtures form one contract. Disagreement
between them is a specification defect. MUST, SHOULD, and MAY describe
requirements, recommendations, and permitted choices respectively.

## 1. Start here

In an otherwise valid NFTab manifest:

```yaml
extensions:
  x-summary:
    version: "0.1.0"
    tables:
      effects:
        table: {path: summaries.csv, format: csv}
        statistic: mean
        counting_unit: subject
        unit: percent_signal_change
```

```csv
condition,estimate,lower,upper,interval_kind,interval_level,df,n
A,2,1,3,ci_t,0.95,9,10
B,4,3,5,ci_t,0.95,9,10
```

These are illustrative stored bounds, not a calculation fixture. For estimates
without intervals, write `interval_kind: none` and empty bounds. Do not invent
an interval, sample size, design, or method to fill a column.

The `x-summary` object can also be saved as `summary.json` or `summary.yaml`
beside the tables. This standalone descriptor is NOT a complete NFTab dataset.
Embedding it does not relax NFTab's feature or observation-table requirements.
Paths are relative to the manifest or standalone descriptor, MUST remain inside
the package, and MUST NOT be absolute paths or network URLs.

## 2. Table descriptor

`version` selects the contract release; producers need not specify component
versions. `tables` maps local names to descriptors. Each descriptor requires:

| Field | Meaning |
| --- | --- |
| `table` | Relative `path` and `format` (`csv` or `tsv` in 0.1). |
| `statistic` | `mean`, `median`, or `custom`; what `estimate` represents. |
| `counting_unit` | A nonempty singular name for what `n` counts, e.g. `subject`, `voxel`, `trial`. |

Optional fields are `unit` (measurement unit), `definition` (required for a
custom statistic), `design`, `plot`, and `extensions` (tool-owned `x-` keys).
An absent unit means unspecified, not dimensionless. All rows in a table share
the statistic, counting unit, and measurement unit. Use another table when
these differ. A mean of subject differences is `mean`; record the contrast in
`definition`, including its direction. No expression language is introduced.

Grouping columns such as condition, region, and model term are ordinary extra
columns. Their names MUST NOT collide with reserved summary columns. Region
hierarchy SHOULD use `region_level`, not `level`. No row identifier or grouping
key is mandatory: row order and multiplicity are preserved on a lossless round
trip. The same estimate can appear on separate rows with different intervals.

## 3. Summary rows

Canonical writers use these names. Readers may accept aliases at their boundary.
There are no table-level interval defaults and no column-mapping language.

| Column | Requirement and meaning |
| --- | --- |
| `estimate` | Required; finite number or null when unavailable. |
| `lower`, `upper` | Required; both finite numbers or both null. |
| `interval_kind` | Required; canonical registry ID. |
| `interval_level` | Required for kinds taking a level; strictly between 0 and 1. Otherwise absent/null, including `custom`. |
| `df` | Positive finite number for `ci_t` and `wsci_cm` when bounds exist; fractional values allowed. Otherwise optional/null. |
| `n` | Optional nonnegative integer; number of contributing counting units, not necessarily input rows. |
| `sd` | Optional nonnegative number; sample SD of analysis values before interval-specific normalization, using denominator n−1. |
| `se` | Optional nonnegative number; standard error used by the declared interval method. |
| `method` | Optional nonempty description or identifier of how the estimate and uncertainty were obtained. |
| `interval_reason` | Required nonempty text when a requested interval has no bounds. |
| `interval_definition` | Required nonempty text for `custom`; describes this row's bounds. |
| `original_kind` | Optional original unknown ID, preserved when importing as `custom`. |
| `mean_voxel_se` | Optional nonnegative input for `heuristic_se`; MUST NOT be represented as `se`. |

`interval_level` means confidence coverage for `ci_t`, `ci_normal`, and
`wsci_cm`; central probability mass for `quantile_range`; and the normal-quantile
calibration parameter for `heuristic_se`. It is never inferred from the bounds.

Finite bounds require a finite estimate and `lower <= upper`. The estimate
need not lie inside arbitrary custom bounds. Generic validators MUST NOT
recompute bounds, infer SE, or require `df = n−1`: model-derived intervals can
have other degrees of freedom. Optional method-specific inputs are not required
merely to display stored bounds.

There are three interval states, without a separate status column:

* `none`: both bounds null; no level, reason, or interval definition is needed.
* A known requested kind with unavailable bounds: both bounds null, the kind
  and its required level retained, and `interval_reason` supplied. Do not replace
  unavailable bounds with a zero-width interval.
* `custom`: stored finite bounds and an `interval_definition`; preserve the
  unknown source ID in `original_kind` when present. No computation is implied.

A missing estimate MUST also have null bounds. Zero observations can therefore
be represented without omitting the row. One observation can have an estimate
but unavailable sample-SD-based bounds. Constant observations with at least two
values may legitimately have zero-width bounds. These examples describe stored
meaning; 0.1 does not certify a calculator.

CSV/TSV use UTF-8, a header, decimal-point numbers, and an empty field for null
in reserved numeric/text columns. Headers MUST be unique. Readers MUST ignore
empty lines after the last record; an empty line between records is an error. Fields containing a
delimiter, quote, or newline are quoted, with embedded quotes doubled. Literal
`NA` text is not a null marker. `NaN` and infinities MUST NOT be written as
numbers. JSON fixture rows use explicit null. Writers MUST retain float64
precision (round-trip-safe decimal serialization). Extra columns carry scalar
strings, numbers, booleans, or null in JSON fixtures. In CSV/TSV, readers MUST
preserve non-reserved columns as text (including leading zeros), with empty
fields treated as null, rather than guessing their types. Plotting may interpret
these text values for display; it must not change their stored representation.

## 4. Interval vocabulary and interpretation

`interval-kinds.json` is the single machine-readable registry. Its formula text
is descriptive data, never executable code. `ci_t` describes
`estimate ± t((1+level)/2, df) × SE`; it does not specify how SE or df were
estimated. The first future calculator profile will cover the unweighted sample
mean. Model estimates may already be stored and rendered in 0.1.

`sd`, `se`, and `heuristic_se` MUST NOT be labelled confidence intervals.
`quantile_range` is the central empirical quantile range using type-7
interpolation, not a confidence or prediction interval. It may accompany a
mean or median: its bounds do not depend on that centre. `wsci_cm` describes
Cousineau–Morey intervals for within-subject comparisons, not uncertainty for
between-group comparisons or a substitute for a paired-contrast test.

The registry records applicable statistics, level semantics, whether computation
needs a design, and whether one cell's values suffice. These are mathematical
requirements, not a tool's capability declaration. `custom` can represent any
statistic. An unknown statistic uses `statistic: custom` plus `definition`.

The reference English label comes from `label`, substituting 100×level for
`{percent}` without a default level. Custom labels use `interval_definition`.
Localized renderers may translate labels but MUST retain the kind, level, and
qualifications. Mixed kinds or levels MUST NOT acquire one misleading common
interval label. Renderers MUST use stored bounds and MUST NOT recalculate them
from `n`, `sd`, `se`, or `design`.

## 5. Importing older or unfamiliar tables

Aliases are reader behavior, not canonical schema fields. For existing tools:

* Map `value` to `estimate`, `conf_level` to `interval_level`, and recognized
  bound pairs such as `conf.low/conf.high` or `lwr/upr` to `lower/upper`.
* A bare `level` column MUST NOT be assumed to mean interval level.
* `ci95_t` and `wsci95_cm` supply a kind and level 0.95. If another supplied
  level disagrees, reject the declaration; do not choose one silently.
* Legacy brainflow **population recipe v1** `ci95` means `ci_t` at 0.95.
  Legacy brainflow **trace** `ci95` means `quantile_range` at 0.95. Without
  source context, treat stored bounds as custom; never guess which meaning.
* An unfamiliar kind, on a row or at a frame boundary, becomes `custom` with
  `original_kind` preserved. Keep a supplied definition; otherwise use
  `Unknown interval kind: <original_kind>`. Missing kind with stored bounds
  becomes custom with `Definition not supplied`.
* Malformed known metadata (such as `ci_t` without a level) is invalid. It
  MUST NOT be downgraded to custom. Conflicting aliases are also invalid.

Readers MUST preserve unfamiliar definition text and bounds. Original unknown
parameters MAY be retained under tool-specific provenance. A canonical custom
row does not pretend their meaning is understood. A newer canonical kind can
be displayed this way by an older reader; it cannot claim calculator support.

## 6. Optional design

A table's `design` block describes the source observations, not plotting
channels. It requires `subject`, `within` (factor names mapped to their declared
level arrays), and `between` (factor names). Optional `repeat` lists repeated
measurement columns. Empty within/between declarations are allowed. Column
names refer to source observations, which need not be shipped to display a
summary. No design is required solely to store `wsci_cm` bounds.

For a future Cousineau–Morey calculator, this draft fixes the intended subset:
crossed within factors; J is the product of their declared level counts;
between factors are constant per subject; subject IDs are unique across groups;
duplicate subject×cell values are invalid unless repeats are declared, in which
case finite repeats are averaged equally before normalization. A cell with no
finite repeats is missing. Structural and value-missing cells both trigger
complete-subject exclusion per outcome and between-subject group. No imputation
or silently smaller J is permitted. Normalization occurs within each group;
centres use raw retained cell means; corrected SE uses √(J/(J−1)); df is the
retained group sample size minus one. J<2 or n<2 gives unavailable bounds.
Ordinary and within-subject intervals calculated together use that same retained
sample. Record exclusions in method provenance.

These preprocessing rules are design guidance for 0.2 fixtures, NOT 0.1
calculator conformance. General contrasts, weighting, nested factors, and mixed
models are outside this computation subset; their stored summaries remain
representable. No general computation-recipe language is introduced.

## 7. Optional plot

Each table may have a `plot` block. Its table reference is implicit by placement.
Required `mark` is `point`, `line`, or `interval`. Optional `x`, `color`, `facet`,
and `detail` name columns in that summary table. `order` maps factor columns to
ordered scalar level arrays; levels present in the table MUST be included when
an order is given. `y_label` is optional. Centre and bounds are always the
canonical columns; units come from the table descriptor.

The plot profile does not aggregate, transform, filter, or join observations.
Raw-data overlays, paired subject lines, layouts, and tool-specific marks remain
internal or in tool extensions. Unsupported marks may fall back to a table
display with a notice; they MUST NOT trigger statistical recomputation.

## 8. Lifecycle and compatibility

A profile-aware operation that changes observations, combines datasets, or
changes referenced table content MUST drop affected summary/plot declarations
and warn unless it implements a preservation rule defined by this extension.
0.1 permits preservation only for unchanged copies (including a relocation that
copies referenced files and preserves relative links). A producer cannot make
an unsafe operation safe by setting a `safe: true` flag. Dropping a declaration
does not authorize deleting source files. Generic NFTab readers may ignore this
extension, as core NFTab already permits; this draft does not change their core
conformance. Tools claiming summary-aware transformation support must follow
this rule. Neurotabs drops `x-summary` with a warning on observation-changing
verbs and copies its table files during `nf_write()`. Byte-identical row copies
may preserve the descriptor. Direct manual edits to an R object bypass these
verb checks; callers must drop or regenerate summaries after such edits.

The three components (registry, summary, plot) have separate versions in
`compatibility.json`. Producers write only its contract version. Adopters vendor
the pinned artifact and verify its SHA-256 file inventory offline; the manifest
itself is pinned by the adopter's recorded SHA-256. It cannot hash itself.
Runtime network fetches are unnecessary. Runtime copies under `inst/schema/summary`
are generated from the authoritative files, never edited separately.

Additive compatible changes increment a minor version; removals or changed
requirements require a breaking release (a new minor while pre-1.0, a new major
afterward). A published kind ID NEVER changes meaning, even in a major release:
use a new ID. Display-only wording fixes may be patches. Readers MUST NOT
claim support for an unknown contract version merely because its major is zero.

## 9. Conformance and implementation status

Reader, writer, and renderer roles are separately claimed. Calculator conformance
is reserved for later method profiles; no 0.1 consumer must implement statistics.
The fixture corpus in `conformance/summary/cases.json` contains canonical rows,
invalid rows, boundary imports, and expected labels. Its zero/one/constant cases
are stored-output cases, not raw-input numerical benchmarks. Round trips compare
values and nulls, not whitespace or CSV column order. Row order is preserved.
`roundtrip.csv` carries the same valid rows in the actual table format; omitted
optional fields become empty cells. Its precision and text identifiers MUST
survive a read/write/read cycle. An absent optional field and an explicit null
have the same meaning.

JSON Schemas check structure and conditional requirements. A semantic pass also
checks finite numbers, bound ordering, registry applicability, referenced columns,
and file resolution. Passing the JSON Schema alone is not full conformance.
The R function `nf_validate_summary()` checks descriptors, table contents, plot
references, and file paths. It accepts a standalone descriptor file, an NFTab
manifest file, a descriptor list with an explicit root, or an `nftab` object.
It returns `valid`, `errors`, `warnings`, and validated `tables`. Core
`nf_validate()` remains separate, so generic NFTab reading is unaffected.
`nf_write()` checks attached summaries before writing and copies their tables
without numeric reserialization. It rejects paths colliding with core output
files or different summary data already at the destination. The optional
`jsonvalidate` dependency is required for summary validation and safe copying.

0.2 calculator fixtures will use float64 expected values and explicit absolute
and relative tolerances; float32 conversion paths require separate checks.
The current draft's tests qualify the artifact and neurotabs validation/copy
paths; legacy-import and label examples also use a small test adapter.
They do not certify brainflow2 or neuromosaic, nor modify their implementations.
Release 1.0 requires independent producer/consumer round trips, including a third
producer, rather than a count of schema-valid writers alone.
