# Architecture Decision Records

This directory records significant design decisions for neuroimjs: the context behind each one, the options considered, and the consequences. The format is lightweight [MADR](https://adr.github.io/madr/).

## Index

| ADR | Title | Status | Date |
|---|---|---|---|
| [0001](./0001-canonical-4d-layout.md) | Canonical 4D layout and storage | Proposed | 2026-10-03 |
| [0002](./0002-sparse-api-shape.md) | Sparse volume and vector representation | Proposed | 2026-10-03 |
| [0003](./0003-slice-renderer-substrate.md) | Rendering substrate for the GPU slice pipeline | Proposed | 2026-10-03 |
| [0004](./0004-nifti-transform-selection.md) | Choosing between the NIfTI qform and sform | Proposed | 2026-10-03 |

## Process

1. **Proposed.** Anyone may open a PR that adds `NNNN-short-title.md`, using the next free number. Each ADR has the following sections: Status, Date, Context, Decision drivers, Considered options (with honest pros and cons), Recommendation, Consequences/migration, and Open questions. Claims about current behaviour must cite `file:line` at a named commit or branch. External conventions must cite a URL.
2. **Accepted, Rejected or Superseded.** Only the maintainer changes the status, by editing the Status line, usually in the PR that starts the implementation. When an ADR is accepted, record the answers to its open questions in the ADR itself.
3. **Immutable once accepted.** To change an accepted decision, write a new ADR and mark the old one `Superseded by ADR-NNNN`. Do not rewrite it.

ADRs describe intent. The stability page in the guide and the changelog describe what has shipped.
